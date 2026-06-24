# WebSocketサーバー設計

## 関連ドキュメント

- [設計概要 (overview.md)](./overview.md)
- [アプリ全体アーキテクチャ (app-architecture.md)](./app-architecture.md)
- [WebSocketプロトコル設計 (websocket-protocol.md)](./websocket-protocol.md)
- [GCP連携設計 (gcp-integration.md)](./gcp-integration.md)
- [セキュリティ設計 (security-design.md)](./security-design.md)
- 要件定義: [docs/requirements.md](../requirements.md)（§15 サーバー処理 / §13 発話区切り / §16 レイテンシ）

---

## 役割

ローカル Node.js WebSocketサーバー（Next.jsとは別プロセス）。GCP API との接続を一手に担う（要件 §8.3）。

- クライアントから音声チャンクを受け取る
- Speech-to-Text Streaming へ音声を送る
- interim / final 認識結果を処理する
- 発話バッファを管理し、発話区切りを判定する
- 確定発話を Translation → Text-to-Speech へ渡す
- 結果・エラー・レイテンシをクライアントへ返す

GCP client library を使うのは **このプロセスのみ**（[security-design.md](./security-design.md) 参照）。

---

## モジュール構成

```text
server/
  index.ts          # ws.Server 起動、接続ごとに Session を生成
  session.ts        # 1接続=1セッション。状態保持とオーケストレーション
  speechStream.ts   # Speech-to-Text Streaming ラッパー
  translate.ts      # Cloud Translation ラッパー
  textToSpeech.ts   # Cloud Text-to-Speech ラッパー
  utteranceBuffer.ts# 発話バッファ・発話区切り判定（純粋ロジック）
  schema.ts         # zod 受信スキーマ（websocket-protocol.md §5）
  types.ts          # サーバー側型・メッセージ型
```

### 責務分離の方針

- `utteranceBuffer.ts` は I/O を持たない純粋ロジックにし、単体テストしやすくする（テスト必須ルール）。
- GCP 呼び出しは `speechStream.ts` / `translate.ts` / `textToSpeech.ts` に閉じ込め、`session.ts` から差し替え可能にする（テスト時にモック化）。

---

## プロセス起動

```text
tsx --watch server/index.ts
```

| 項目 | 内容 |
|---|---|
| 待受ポート | `WS_PORT`（既定 3001） |
| パス | `/ws` のみ受け付ける |
| ライブラリ | `ws`（WebSocketServer） |
| TypeScript実行 | `tsx`（ビルド不要・ホットリロード） |
| tsconfig | Next.js の `tsconfig.json` から `server/` を除外（[app-architecture.md](./app-architecture.md#tsconfig-分離方針) 参照） |

`index.ts` は接続受理時に `Session` を1つ生成し、`close` 時に破棄する。

---

## セッションライフサイクル

1接続 = 1 `Session`。状態は接続スコープに閉じる（DB・グローバル状態なし）。

```text
[connection open]
  → Session 生成（未初期化）
[recv start]
  → パラメータ確定 / STTストリーム開始 / 発話バッファ初期化
[recv audio]*
  → base64 デコード → STTストリームへ write（※生の音声チャンクでは無音タイマーをリセットしない）
  → STT interim → transcript_interim 送信（表示のみ）→ utteranceBuffer.notifyInterim() で無音タイマーをリセット
  → STT final   → 発話バッファへ追加（addFinal が無音タイマーをリセット）→ transcript_final 送信 → 区切り判定
[recv commit]
  → 発話バッファを即時確定
[recv stop]
  → 残バッファを確定 → STTストリーム終了（接続は維持）
[connection close]
  → STTストリーム破棄 / タイマー解除 / Session 破棄
```

### セッション状態

```ts
// server/types.ts （設計例）
interface SessionState {
  initialized: boolean;
  config: SessionConfig;          // start で確定した言語/しきい値/フラグ
  speech: SpeechStreamHandle | null;
  buffer: UtteranceBuffer;        // 発話バッファ
  timers: { silence?: NodeJS.Timeout; maxDuration?: NodeJS.Timeout };
  timing: TimingMarks;            // レイテンシ計測用の時刻群
}
```

---

## 音声認識（要件 §15.2）

- 受信した `audio.data`（base64 / WebM Opus）をデコードし、**維持している単一のSTTストリーム**へ書き込む。
- **STTストリームはセッション中切り直さない**。WebM/Opus のコンテナヘッダは最初のチャンクのみに含まれるため、ストリームを切ると後続チャンクがデコード不能になる（[gcp-integration.md](./gcp-integration.md#stt-ストリーム維持) 参照）。
- STT のレスポンスを `isFinal` で分岐する。
  - interim → `transcript_interim` を即時送信（要件 §15.2）。発話バッファには入れない。**`utteranceBuffer.notifyInterim()` を呼び、無音タイマーをリセットする**（話している間は確定させないため）。
  - final → 発話バッファへ追加（`addFinal` が無音タイマーをリセットする）し、`transcript_final` を送信。直後に区切り判定を行う。

> **無音は「STT結果（interim/final）が止まったこと」で検出する。生の音声チャンク受信では無音タイマーをリセットしない**（`bd-simple-translator-cbv` で修正）。
> 理由: `MediaRecorder` は `timeslice`（既定250ms）ごとに**無音でも音声チャンクを送り続ける**ため、音声チャンクでリセットすると無音タイマーが永久にリセットされ発火しない。「ユーザーが話しているか」を判定しているのは Google STT のエンドポイント検出であり、無音時は STT が interim/final を出さなくなる。よって無音の検出は STT 結果の停止で行うのが正しい（[外部依存の前提](#外部依存の前提) 参照）。

### STTストリームの時間制限への対処

Speech-to-Text Streaming には1ストリームあたりの時間上限がある。MVPでは長時間会話を対象外とする（要件 §23）ため、上限到達時は `error`（`fatal:false`）を返し、クライアントへ再接続を促す方針とする。自動再ストリーミングの作り込みはしない（[gcp-integration.md](./gcp-integration.md#stt-ストリーム維持) 参照）。

---

## 発話バッファと発話区切り判定

### 発話バッファ（要件 §15.3）

- STT の final result を蓄積する（`finals: string[]` または連結文字列）。
- 確定時、バッファ全体を1つの発話テキストとして確定し、バッファを空にする。

### 発話区切り判定

以下のいずれかで確定する（要件 §13.2 / §13.3）。初期値は設定で変更可能。

| 条件 | 初期値 | 判定方法 | `reason` |
|---|---|---|---|
| 無音継続 | `silenceMs` = 1000 | 最後の **STT結果（interim/final）** を受けてからの経過時間がしきい値超過。**生の音声チャンク受信ではリセットしない**（`bd-simple-translator-cbv` で修正） | `silence` |
| 文字数上限 | `maxChars` = 80 | バッファの確定テキスト長がしきい値超過 | `maxChars` |
| 発話秒数上限 | `maxSeconds` = 10 | 発話開始からの経過時間がしきい値超過 | `maxSeconds` |
| 手動 commit | - | `commit` メッセージ受信 | `commit` |
| 停止 stop | - | `stop` メッセージ受信 | `stop` |

### タイマー設計

- **無音タイマー**: **STT結果（interim/final）を受けたとき**にリセットする `silenceMs` のタイマー。発火時に非空バッファを確定。リセット契機は次の2つに限る（`bd-simple-translator-cbv` で修正）:
  - interim 受信時: `utteranceBuffer.notifyInterim()`（旧 `notifyAudio()` をリネーム）でリセット。話している間は確定させない。
  - final 受信時: `addFinal` がリセット。
  - **生の音声チャンク（audio 受信）ではリセットしない**。MediaRecorder は無音でもチャンクを送出するため、音声でリセットすると無音タイマーが永久に発火しない（[音声認識](#音声認識要件-152) 節および [外部依存の前提](#外部依存の前提) 参照）。
- **最大発話タイマー**: 発話開始（バッファが空→非空になった時点）で `maxSeconds` のタイマーを開始。確定時にクリア。
- **文字数**: final 追加のたびに同期的にチェック。

> interim result はタイマーや文字数判定に使わない（後から変化し得るため、要件 §13.4）。判定対象は final と各タイマーのみ。ただし**無音タイマーのリセット契機としては interim も使う**（STT結果が出ている間＝発話中とみなす）。

### 確定後の処理シーケンス

```text
確定検知
  → utterance_committed 送信（text, reason）
  → Translation 実行（§7）
  → translation 送信
  → (enableTts) Text-to-Speech 実行（§8）→ audio 送信
  → metrics 送信（§9）
  → バッファ/タイマーをクリア
```

`utteranceBuffer.ts` は「いつ確定するか」を判定する純粋ロジックとして実装し、確定後の I/O は `session.ts` が担う。

---

## 翻訳（要件 §15.4）

- 確定発話テキストを Cloud Translation（v2 Basic）へ渡す。
- `sourceLanguage` / `targetLanguage` は言語コードから2文字コードへ変換して渡す（`ja-JP`→`ja`、`en-US`→`en`）。
- 結果を `translation`（sourceText / translatedText）で返す。
- interim の仮翻訳は初期 OFF（`enableInterimTranslation=false`）。ON の場合のみ interim を翻訳して表示用に返すが、**TTSは行わない**（要件 §13.5）。

詳細は [gcp-integration.md](./gcp-integration.md#translation) を参照。

---

## 音声合成（要件 §15.5）

- `enableTts=true` のときのみ、翻訳結果を Cloud Text-to-Speech へ渡す。
- 出力は MP3（`audio/mpeg`）。base64 にして `audio` メッセージで返す。
- **確定発話区切りのみが対象**。interim・仮翻訳は音声化しない（要件 §13.5）。
- MVPでは同期合成でよい（要件 §15.5 / §23）。

詳細は [gcp-integration.md](./gcp-integration.md#text-to-speech) を参照。

---

## レイテンシ計測（要件 §16）

`session.ts` が時刻を記録し、確定シーケンスの最後に `metrics` を送る。

| 計測区間 | 計算 |
|---|---|
| `speechMs` | 発話開始（最初の audio チャンク受信）〜 発話区切り確定 |
| `translationMs` | Translation 呼び出し前 〜 結果受信 |
| `ttsMs` | TTS 呼び出し前 〜 結果受信 |
| `totalMs` | 発話開始（最初の audio チャンク受信）〜 TTS完了（TTS無効時は翻訳完了まで） |

クライアント側で「再生開始時刻」を別途記録し、画面に合計待ち時間を表示する（[frontend-design.md](./frontend-design.md#レイテンシ表示) 参照）。

時刻は `process.hrtime.bigint()` ベースで取得し、ms に換算する。

---

## エラー処理（要件 §15.6）

| 種別 | 対応 | `fatal` |
|---|---|---|
| 受信メッセージのバリデーション失敗 | `error` を返し継続 | false |
| `start` 前の audio/commit/stop | `error` を返し継続 | false |
| Translation / TTS の一時エラー | `error` を返し継続（その発話のみ失敗） | false |
| STTストリームのエラー / 時間上限到達 | `error` を返す（再接続を促す） | false |
| WebSocket / プロセスレベルの致命的障害 | `error` を返し接続終了 | true |

- 原則 WebSocket 接続は維持する。致命的な場合のみ終了（要件 §15.6）。
- エラーメッセージはクライアント表示用とし、GCP の内部詳細やスタックトレースをそのまま流さない（[security-design.md](./security-design.md#エラー情報) 参照）。

---

## 外部依存の前提

発話区切り（特に無音タイマー）の設計は、以下の外部コンポーネントの挙動を前提とする（`bd-simple-translator-cbv` で明文化）。

- **MediaRecorder は無音でもチャンクを送出する**: クライアントの `MediaRecorder` は `timeslice`（既定250ms）ごとに音声データを emit する。ユーザーが無言でもマイク入力（環境音・無音）がチャンクとして送られ続ける。したがって「音声チャンクが届いたこと」は「ユーザーが話していること」を意味しない。
- **STT が自前でエンドポイント（発話/無音）検出を行う**: Google Speech-to-Text Streaming は音声を解析し、発話中は interim/final 結果を返し、無音区間では結果を出さなくなる。よって「ユーザーが話しているか／黙ったか」の判定は STT 結果の有無で行うのが正しい。

この前提から、**無音は「生の音声チャンクが止まったこと」ではなく「STT結果（interim/final）が止まったこと」で検出する**。

---

## テスト方針（概要）

テスト必須ルールに従い、最低限以下を対象にする。詳細はテストエージェントが設計する。

| 対象 | 種別 | 例 |
|---|---|---|
| `utteranceBuffer.ts` | 単体（Jest） | 無音/文字数/秒数/commit/stop での確定タイミング。**無音ケースは `notifyInterim()`/`addFinal` でリセットされること、および生の音声チャンク相当ではリセットされず silenceMs 経過で確定することを検証**（`bd-simple-translator-cbv`） |
| `schema.ts`（zod） | 単体（Jest） | 正常/異常メッセージの受理・拒否、言語ペア同一の拒否 |
| `session.ts` | 結合（Jest, GCPモック） | start→audio→final→確定→translation→audio の一連フロー |
| WebSocketサーバー | 結合（Jest + ws クライアント） | 接続・start前エラー・stop時の残バッファ確定 |

GCP 呼び出しはモック化し、実APIへは接続しない。
