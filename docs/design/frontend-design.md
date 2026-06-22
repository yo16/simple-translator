# フロントエンド設計

## 関連ドキュメント

- [設計概要 (overview.md)](./overview.md)
- [アプリ全体アーキテクチャ (app-architecture.md)](./app-architecture.md)
- [WebSocketプロトコル設計 (websocket-protocol.md)](./websocket-protocol.md)
- [サーバー設計 (server-design.md)](./server-design.md)
- [スタイリング設計 (styling-design.md)](./styling-design.md)
- [セキュリティ設計 (security-design.md)](./security-design.md)
- 要件定義: [docs/requirements.md](../requirements.md)（§8.2 / §10 / §11 / §12 / §16）

---

## 役割

Next.js（App Router）の画面とクライアント処理を担う（要件 §8.2）。

- マイク入力 / 音声チャンク生成
- WebSocket 接続・送受信
- interim / final / 翻訳結果 / レイテンシ / エラー表示
- 合成音声の再生
- 言語選択・発話区切り設定・TTS ON/OFF の UI

画面は1ページのみ（要件 §11）。GCP には一切アクセスしない。

---

## コンポーネントツリー

```text
app/layout.tsx                (Server Component)
  └─ app/page.tsx             (Server Component) ← TranslatorApp を描画するのみ
       └─ TranslatorApp.tsx   ("use client")     ← 全状態を保持・配布
            ├─ LanguageSelector.tsx   入力/出力言語選択
            ├─ Recorder.tsx           接続/切断/録音開始/停止/手動区切り ボタン群・状態表示
            ├─ TranscriptView.tsx     interim/final/翻訳/レイテンシ/エラー 表示
            └─ SettingsPanel.tsx      chunkMs/silenceMs/maxChars/maxSeconds/TTS/interim翻訳
```

`"use client"` 境界は `TranslatorApp` の1箇所に集約する（[app-architecture.md](./app-architecture.md#clientserver-component-境界) 参照）。

---

## 各コンポーネントの責務

### TranslatorApp（最上位 Client Component）

- `useReducer` でアプリ全体状態を保持、`useState` で `Settings` を保持。
- `useWebSocket(settings)` / `useRecorder(onChunk)` / `useAudioQueue()` を統合。
- 受信メッセージを reducer へディスパッチし、状態を子へ props で配る。
- 接続/録音のハンドラ（`connect` / `disconnect` / `startRecording` / `stopRecording` / `commit`）を子へ渡す。

### LanguageSelector

- 入力/出力言語の選択（MVPは `ja-JP` / `en-US` の2値、要件 §11.2）。
- 「日本語→英語」「英語→日本語」のペアのみ許可。同一言語の選択を防ぐ。
- 接続中（recording 中）は変更不可にする。

### Recorder

- ボタン群: 接続 / 切断 / 録音開始 / 録音停止 / 手動区切り（要件 §11.1）。
- `AppStatus` に応じてボタンの活性/非活性を切り替える。
  - `idle` → 接続のみ可
  - `connected` → 録音開始・切断可
  - `recording` → 録音停止・手動区切り可
- 現在の状態テキストを表示する（状態表示, 要件 §11.1）。

### TranscriptView

- 認識途中テキスト欄（interim、変化し得る旨が分かる表示）
- 認識確定テキスト欄（finals 履歴）
- 翻訳テキスト欄（translations 履歴）
- 簡易レイテンシ表示（[§7](#レイテンシ表示)）
- エラー表示（要件 §11.1）

### SettingsPanel

- 音声再生 ON/OFF（`enableTts`）
- 発話区切り設定: `chunkMs` / `silenceMs` / `maxChars` / `maxSeconds`（要件 §11.1 / §13.3、数値変更可）
- interim 仮翻訳モード ON/OFF（初期 OFF、要件 §13.4）
- 値は接続前に確定し、`start` メッセージへ反映する。録音中の変更反映は MVP対象外（再接続で反映）。

---

## 状態管理とフック

外部ライブラリ不要。`useReducer` + `useState` + カスタムフック（[app-architecture.md](./app-architecture.md#状態管理方針) 参照）。

### reducer 状態（設計例）

```ts
// src/lib/types.ts （設計指針）
type AppStatus =
  | "idle" | "connecting" | "connected"
  | "recording" | "disconnected" | "error";

interface TranscriptState {
  interim: string;            // 表示専用。次の interim/final で置換
  finals: string[];           // 認識確定の履歴
  committed: string;          // 直近の確定発話
  translations: { sourceText: string; translatedText: string }[];
}

interface Metrics {
  speechMs: number; translationMs: number; ttsMs: number; totalMs: number;
  playbackStartedAt?: number; // クライアントで記録（再生開始時刻）
}

interface AppState {
  status: AppStatus;
  transcript: TranscriptState;
  metrics: Metrics | null;
  error: string | null;
}
```

### reducer アクション

| アクション | 契機 |
|---|---|
| `STATUS_CHANGED` | 接続状態の変化 |
| `INTERIM` | `transcript_interim` 受信 → `interim` を置換 |
| `FINAL` | `transcript_final` 受信 → `finals` に追加 |
| `COMMITTED` | `utterance_committed` 受信 → `committed` 更新・`interim` クリア |
| `TRANSLATION` | `translation` 受信 → `translations` に追加 |
| `METRICS` | `metrics` 受信 → `metrics` 更新 |
| `ERROR` | `error` 受信 → `error` 更新（fatal なら status=error） |
| `RESET` | 切断・新規セッション |

### カスタムフック

#### useWebSocket(settings)

- `connect()` で WebSocket を開き、open 後に `start`（settings 反映）を送る。
- `sendAudio(base64)` / `commit()` / `stop()` / `disconnect()` を提供。
- `onMessage` を JSON パースし、`type` で reducer アクションへ振り分ける。
- 接続先は `process.env.NEXT_PUBLIC_WS_URL`（[websocket-protocol.md](./websocket-protocol.md#接続) 参照）。

#### useRecorder(onChunk)

- `getUserMedia({ audio: true })` → `MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" })`。
- `start(chunkMs)` で `timeslice = chunkMs`（既定500ms）で録音開始（要件 §12.2）。
- `ondataavailable` で Blob を受け取り `onChunk(blob)` を呼ぶ。
- `stop()` で録音停止・トラック解放。

#### useAudioQueue()

- 受信音声の FIFO 再生（[§6](#音声再生)）。

---

## 音声送信フロー

```text
useRecorder.ondataavailable(blob)
  → blob.arrayBuffer()
  → arrayBuffer を base64 化（btoa + Uint8Array、またはチャンク分割で安全に変換）
  → useWebSocket.sendAudio(base64)  → { type:"audio", data } 送信
```

base64 変換は大きい Blob でスタックオーバーフローしないよう、`Uint8Array` をチャンク単位で処理する実装方針とする。

---

## 音声再生

Next.jsスペシャリストの助言に従い、FIFO 再生キューで重ならないよう再生する。

### 方針（`src/lib/audio.ts` / `useAudioQueue`）

- 受信 `audio`（mp3 base64）を `ArrayBuffer` に戻す。
- `AudioContext.decodeAudioData(arrayBuffer)` → `AudioBufferSourceNode` で再生。
- **複数の翻訳音声が重ならないよう FIFO キュー**にする。前の `onended` で次を再生する。

### AutoPlay Policy 対策

- `AudioContext` は**ユーザー操作イベント内（接続ボタン押下時など）で遅延生成・resume** する。
- ページ読み込み時に自動生成しない（ブラウザのオートプレイ制限を回避）。

### 再生開始時刻の記録

- 各音声の再生開始時に `playbackStartedAt` を記録し、レイテンシ表示に使う（[§7](#レイテンシ表示)）。

---

## レイテンシ表示

要件 §16 の各時刻・区分を画面に表示する。

| 表示 | 取得元 |
|---|---|
| 音声認識時間 | `metrics.speechMs`（サーバー） |
| 翻訳時間 | `metrics.translationMs`（サーバー） |
| 音声合成時間 | `metrics.ttsMs`（サーバー） |
| 合計待ち時間 | `metrics.totalMs` + クライアントの再生開始までの差分 |
| 再生開始時刻 | クライアントで記録（§6.3） |

サーバー計測の詳細は [server-design.md](./server-design.md#レイテンシ計測) を参照。
コンソール出力も併用してよい（要件 §16）。

---

## エラー・状態表示

- `error` 受信時はエラー欄に表示。`fatal:true` の場合は status=error にして再接続を促す。
- 接続/録音の状態は `AppStatus` を文字列で表示する。
- マイク許可拒否（`getUserMedia` 失敗）はクライアント側エラーとして表示する。

---

## テスト方針（概要）

テスト必須ルールに従う。詳細はテストエージェントが設計する。

| 対象 | 種別 | 例 |
|---|---|---|
| reducer | 単体（Jest） | 各アクションでの状態遷移 |
| base64変換 / 言語ペア検証 | 単体（Jest） | 変換の往復、同一言語の拒否 |
| 各コンポーネント | コンポーネント（React Testing Library） | ボタン活性制御、表示更新 |
| ユーザーフロー | E2E（Playwright） | 接続→録音→停止のUI遷移（WebSocketはモック/スタブ） |

MediaRecorder / AudioContext / WebSocket はテスト時にモック化する。
