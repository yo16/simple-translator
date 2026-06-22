# GCP連携設計

## 関連ドキュメント

- [設計概要 (overview.md)](./overview.md)
- [アプリ全体アーキテクチャ (app-architecture.md)](./app-architecture.md)
- [サーバー設計 (server-design.md)](./server-design.md)
- [WebSocketプロトコル設計 (websocket-protocol.md)](./websocket-protocol.md)
- [セキュリティ設計 (security-design.md)](./security-design.md)
- 要件定義: [docs/requirements.md](../requirements.md)（§5 GCPサービス / §12 音声 / §17 認証）

---

## 使用するGCPサービス（3つに限定）

要件 §5 に従い、以下の3つのみ使用する。**Media Translation API は使用しない。**

| サービス | パッケージ | 用途 |
|---|---|---|
| Cloud Speech-to-Text | `@google-cloud/speech` | ストリーミング音声認識 |
| Cloud Translation | `@google-cloud/translate` | テキスト翻訳（v2 Basic） |
| Cloud Text-to-Speech | `@google-cloud/text-to-speech` | 翻訳結果の音声合成 |

すべてローカル WebSocketサーバー（`server/`）でのみ使用する。Next.js 側からは一切 import しない（[security-design.md](./security-design.md) 参照）。

---

## 認証（ADC）

要件 §17 に従い、ローカルの Application Default Credentials を使用する。

```bash
gcloud auth application-default login
```

- 各 client library は引数なしで生成し、ADC を自動取得させる。
  - 例: `new SpeechClient()` / `new Translate({ projectId })` / `new TextToSpeechClient()`
- `GOOGLE_CLOUD_PROJECT` を環境変数で渡す（プロジェクトID）。
- **サービスアカウントキーJSONは使わない**。鍵ファイルをリポジトリに置かない（[security-design.md](./security-design.md#認証情報) 参照）。
- ブラウザ側に認証情報を一切置かない。

---

## 音声形式

### 採用形式: WebM/Opus

| 項目 | 値 |
|---|---|
| ブラウザ取得 | MediaRecorder（`audio/webm;codecs=opus`） |
| STT への指定 | `encoding: WEBM_OPUS` |
| サンプルレート | `sampleRateHertz: 48000` |
| MVPでのPCM変換 | **行わない**（要件 §12.3。実装コストをかけない） |

MediaRecorder 標準出力をそのまま使えるため、変換コストを避けられる。
ブラウザにより `audio/webm;codecs=opus` が使えない場合のフォールバックは MVP対象外とする（Chrome/Edge を想定）。

### STT ストリーム維持

**重要**: STTストリームはセッション中、切り直さない。

- WebM/Opus のコンテナヘッダ（EBML / クラスタ情報）は MediaRecorder の **最初のチャンクのみ**に含まれる。
- ストリームを途中で切って新規ストリームに後続チャンクを流すと、ヘッダ欠落でデコードできない。
- よって、**発話区切りの「確定」は STTストリームを切る操作ではなく、サーバー内の発話バッファを論理的に確定・クリアする操作**とする（[server-design.md](./server-design.md#発話バッファと発話区切り判定) 参照）。

#### ストリーム時間上限

Speech-to-Text Streaming には1ストリームの時間上限がある。MVPでは長時間会話を対象外（要件 §23）とするため、上限到達時は `error`（`fatal:false`）でクライアントへ通知し、再接続を促す。自動再ストリーミングは作り込まない。

---

## Cloud Speech-to-Text（Streaming）

### リクエスト設定（設計例）

```ts
// server/speechStream.ts （設計指針）
const streamingConfig = {
  config: {
    encoding: "WEBM_OPUS",
    sampleRateHertz: 48000,
    languageCode: sourceLanguage,   // "ja-JP" | "en-US"
    enableAutomaticPunctuation: true,
  },
  interimResults: true,             // interim 表示のため必須
};

const recognizeStream = speechClient
  .streamingRecognize(streamingConfig)
  .on("error", onError)
  .on("data", onData);             // data.results[0].isFinal で分岐
```

### 結果の扱い

| 結果 | 判定 | 処理 |
|---|---|---|
| interim | `results[0].isFinal === false` | `transcript_interim` を即時送信（表示のみ） |
| final | `results[0].isFinal === true` | 発話バッファへ追加 → `transcript_final` 送信 → 区切り判定 |

`enableAutomaticPunctuation` を有効にして、句読点付きの自然なテキストを得る（翻訳品質優先、要件 §4）。

### 音声チャンクの書き込み

- 受信した base64 → `Buffer.from(data, "base64")` → `recognizeStream.write(buffer)`。
- チャンク間隔は `chunkMs`（既定500ms）。クライアント側の MediaRecorder の timeslice に対応する。

---

## Cloud Translation（v2 Basic）

### 採用バージョン: v2 (Basic)

MVP（ja⇄en のみ）ではシンプルさを優先し、`@google-cloud/translate` の `v2.Translate` を採用する。

```ts
// server/translate.ts （設計指針）
import { v2 } from "@google-cloud/translate";
const translate = new v2.Translate({ projectId: process.env.GOOGLE_CLOUD_PROJECT });

async function translateText(text: string, target: "ja" | "en"): Promise<string> {
  const [translated] = await translate.translate(text, target);
  return translated;
}
```

### 言語コード変換

| プロトコル上の言語 | Translation 用コード |
|---|---|
| `ja-JP` | `ja` |
| `en-US` | `en` |

`source` は省略して自動判定でも可だが、MVPでは `targetLanguage` から明示的に target を決める。

### v3 への移行余地

将来、用語集（glossary）・モデル選択・多言語拡張が必要になった場合は Cloud Translation v3（`@google-cloud/translate` の `TranslationServiceClient`）への移行を検討する。MVPでは v2 で十分（要件 §4「不要な仕組みは排除」）。

---

## Cloud Text-to-Speech

### リクエスト設定（設計例）

```ts
// server/textToSpeech.ts （設計指針）
const request = {
  input: { text: translatedText },
  voice: { languageCode: targetLanguage, ssmlGender: "NEUTRAL" }, // "ja-JP" | "en-US"
  audioConfig: { audioEncoding: "MP3" },
};
const [response] = await ttsClient.synthesizeSpeech(request);
const base64 = Buffer.from(response.audioContent).toString("base64");
```

### 出力形式

| 項目 | 値 |
|---|---|
| エンコード | MP3（`audio/mpeg`） |
| 対象 | 確定発話区切りの翻訳結果のみ（要件 §13.5） |
| 合成方式 | 同期合成（`synthesizeSpeech`）。MVPはストリーミングTTS不要（要件 §23） |

`targetLanguage` を `voice.languageCode` に直接指定する（`ja-JP` / `en-US`）。
クライアントは base64 を `decodeAudioData` で再生する（[frontend-design.md](./frontend-design.md#音声再生) 参照）。

---

## クライアント生成方針

- 各 client は **サーバープロセス起動時に1度だけ生成**して使い回す（接続ごとに作らない）。
  - `SpeechClient` / `v2.Translate` / `TextToSpeechClient`
- STT の `streamingRecognize` ストリームのみセッション（接続）単位で生成する。

---

## テスト方針（GCP連携）

実APIには接続しない。`speechStream.ts` / `translate.ts` / `textToSpeech.ts` をモック化して結合テストを行う（[server-design.md](./server-design.md#テスト方針概要) 参照）。
ラッパー関数の入出力（言語コード変換、base64 化、`isFinal` 分岐）は単体テストで検証する。
