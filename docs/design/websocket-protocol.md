# WebSocketプロトコル設計

## 関連ドキュメント

- [設計概要 (overview.md)](./overview.md)
- [アプリ全体アーキテクチャ (app-architecture.md)](./app-architecture.md)
- [サーバー設計 (server-design.md)](./server-design.md)
- [GCP連携設計 (gcp-integration.md)](./gcp-integration.md)
- [フロントエンド設計 (frontend-design.md)](./frontend-design.md)
- [セキュリティ設計 (security-design.md)](./security-design.md)
- 要件定義: [docs/requirements.md](../requirements.md)（§14 メッセージ仕様 / §16 レイテンシ）

---

## 接続

| 項目 | 値 |
|---|---|
| エンドポイント | `ws://localhost:3001/ws` |
| URL の取得元（クライアント） | 環境変数 `NEXT_PUBLIC_WS_URL`（既定 `ws://localhost:3001/ws`） |
| ポートの設定元（サーバー） | 環境変数 `WS_PORT`（既定 `3001`） |
| サブプロトコル | 使用しない |
| メッセージ形式 | UTF-8 JSON テキストフレーム（バイナリフレームは使わない。音声は base64 で JSON に格納） |

音声をバイナリフレームではなく base64 JSON にする理由: メッセージ種別の判別・zodバリデーション・ログ取得を一貫した方式で扱うため。MVPでは効率より実装の単純さを優先する（要件 §4）。

---

## メッセージ全体像

| 方向 | type | 用途 |
|---|---|---|
| client → server | `start` | セッション開始・パラメータ設定 |
| client → server | `audio` | 音声チャンク送信 |
| client → server | `commit` | 手動の発話区切り |
| client → server | `stop` | セッション停止 |
| server → client | `transcript_interim` | 認識途中結果（表示のみ） |
| server → client | `transcript_final` | 認識確定結果 |
| server → client | `utterance_committed` | 発話区切り確定 |
| server → client | `translation` | 翻訳結果 |
| server → client | `audio` | 合成音声（mp3 base64） |
| server → client | `metrics` | レイテンシ計測 |
| server → client | `error` | エラー通知 |

すべてのメッセージは `type: string` を必ず持つ。共通の型定義は `src/lib/types.ts`（フロント）と `server/types.ts`（サーバー）に置き、内容は一致させる。

---

## client → server メッセージ

### `start`（セッション開始）

```json
{
  "type": "start",
  "sourceLanguage": "ja-JP",
  "targetLanguage": "en-US",
  "enableTts": true,
  "enableInterimTranslation": false,
  "chunkMs": 250,
  "silenceMs": 1000,
  "maxChars": 80,
  "maxSeconds": 10
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"start"` | ○ | 固定 |
| `sourceLanguage` | `"ja-JP" \| "en-US"` | ○ | 入力言語（MVPは2値のみ） |
| `targetLanguage` | `"ja-JP" \| "en-US"` | ○ | 出力言語（sourceと異なること） |
| `enableTts` | `boolean` | ○ | TTS有効/無効 |
| `enableInterimTranslation` | `boolean` | △ | 省略時 false。interim 仮翻訳モード（初期OFF）。クライアントは常に送信するが、サーバーschemaでは optional（省略時 false）。なお実装ではサーバーは interim 翻訳経路を持たず、本フラグは予約扱い（bd-simple-translator-mgk、[server-design.md](./server-design.md#翻訳要件-154) 参照） |
| `chunkMs` | `number` | ○ | 音声チャンク間隔(ms)。既定250（bd-simple-translator-mgk） |
| `silenceMs` | `number` | ○ | 無音区切り判定(ms)。既定1000 |
| `maxChars` | `number` | ○ | 確定テキスト最大文字数。既定80 |
| `maxSeconds` | `number` | ○ | 同一発話最大秒数。既定10 |

> 要件 §14.2 の `start` 例に `enableInterimTranslation` を追加している（要件 §13.4 のモードをプロトコルで制御するため）。フロント型は必須・サーバーschemaは optional（省略時 false）という実態（bd-simple-translator-mgk）。

### `audio`（音声チャンク）

```json
{
  "type": "audio",
  "data": "GkXfo59ChoEBQ...（base64 encoded WebM/Opus chunk）"
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"audio"` | ○ | 固定 |
| `data` | `string`（base64） | ○ | MediaRecorder の Blob を base64 化したもの。WebM/Opus |

> 音声形式は WebM/Opus（48kHz）。STTストリームは同一セッション中切り直さない（コンテナヘッダが最初のチャンクのみに含まれるため）。詳細は [gcp-integration.md](./gcp-integration.md#音声形式) を参照。

### `commit`（手動区切り）

```json
{ "type": "commit" }
```

現在の発話バッファを即時に確定する。空バッファなら無視する。

### `stop`（セッション停止）

```json
{ "type": "stop" }
```

録音停止に伴う停止。残った発話バッファがあれば確定してから STTストリームを終了する。

---

## server → client メッセージ

### `transcript_interim`（認識途中結果）

```json
{ "type": "transcript_interim", "text": "今日は雨が降っているので" }
```

| フィールド | 型 | 説明 |
|---|---|---|
| `text` | `string` | 途中認識結果。**表示専用**。翻訳・TTS対象外（要件 §13.4/§13.5） |

### `transcript_final`（認識確定結果）

```json
{ "type": "transcript_final", "text": "今日は雨が降っているので" }
```

STT の final result。発話バッファへ追加される単位。

### `utterance_committed`（発話区切り確定）

```json
{ "type": "utterance_committed", "text": "今日は雨が降っているので、屋内に行きましょう", "reason": "silence" }
```

| フィールド | 型 | 説明 |
|---|---|---|
| `text` | `string` | 確定した発話全体 |
| `reason` | `"silence" \| "maxChars" \| "maxSeconds" \| "commit" \| "stop"` | 区切りが発生した理由（任意・調査用） |

> 要件 §14.3 に `reason` は無いが、発話区切り挙動の調査（要件 §3「発話区切りの調整による使い勝手を確認」）に有用なため追加する。クライアント側は無くても動作可能。

### `translation`（翻訳結果）

```json
{
  "type": "translation",
  "sourceText": "今日は雨が降っているので、屋内に行きましょう",
  "translatedText": "Since it is raining today, let's go indoors."
}
```

### `audio`（合成音声）

```json
{
  "type": "audio",
  "mimeType": "audio/mpeg",
  "data": "//uQxAAAAAAAA...（base64 encoded mp3）"
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `mimeType` | `"audio/mpeg"` | TTS出力は MP3（[gcp-integration.md](./gcp-integration.md#text-to-speech) 参照） |
| `data` | `string`（base64） | クライアントは `AudioContext.decodeAudioData` で再生 |

確定した発話区切りに対してのみ送られる。クライアントは FIFO キューで重ならないよう再生する（[frontend-design.md](./frontend-design.md#音声再生) 参照）。

### `metrics`（レイテンシ計測）

```json
{
  "type": "metrics",
  "speechMs": 1200,
  "translationMs": 300,
  "ttsMs": 800,
  "totalMs": 2300
}
```

| フィールド | 型 | 区分（要件 §16） |
|---|---|---|
| `speechMs` | `number` | 音声認識にかかった時間（音声送信開始〜発話区切り確定） |
| `translationMs` | `number` | 翻訳にかかった時間 |
| `ttsMs` | `number` | 音声合成にかかった時間 |
| `totalMs` | `number` | 合計待ち時間 |

サーバーは発話区切り確定〜翻訳〜TTS完了の各区間を計測して送る。
クライアントは別途「再生開始時刻」を保持し、画面に総合レイテンシを表示する（要件 §16）。
計測の詳細は [server-design.md](./server-design.md#レイテンシ計測) を参照。

### `error`（エラー）

```json
{ "type": "error", "message": "Speech-to-Text streaming failed", "fatal": false }
```

| フィールド | 型 | 説明 |
|---|---|---|
| `message` | `string` | エラー内容（ユーザー表示用に過度な内部情報を含めない） |
| `fatal` | `boolean` | true の場合は接続終了。false なら接続維持（要件 §15.6） |

> `fatal` は要件 §15.6「致命的なエラーの場合のみ接続終了」をクライアントに伝えるため追加。

---

## バリデーション方針（zod）

サーバー側で **受信メッセージ（client → server）を zod で検証**する。`server/schema.ts` に集約する。

```ts
// server/schema.ts （設計例。実装時の指針）
import { z } from "zod";

const LanguageEnum = z.enum(["ja-JP", "en-US"]);

export const startSchema = z.object({
  type: z.literal("start"),
  sourceLanguage: LanguageEnum,
  targetLanguage: LanguageEnum,
  enableTts: z.boolean(),
  enableInterimTranslation: z.boolean().optional().default(false),
  chunkMs: z.number().int().positive(),
  silenceMs: z.number().int().positive(),
  maxChars: z.number().int().positive(),
  maxSeconds: z.number().int().positive(),
}).refine((m) => m.sourceLanguage !== m.targetLanguage, {
  message: "sourceLanguage and targetLanguage must differ",
});

export const audioSchema = z.object({
  type: z.literal("audio"),
  data: z.string().min(1),
});

export const commitSchema = z.object({ type: z.literal("commit") });
export const stopSchema = z.object({ type: z.literal("stop") });

export const clientMessageSchema = z.discriminatedUnion("type", [
  startSchema, audioSchema, commitSchema, stopSchema,
]);
```

> 上記コードは設計指針であり、実装時に最新の zod API へ整合させる。

### バリデーションルール

- パース失敗・スキーマ不一致 → `error`（`fatal:false`）を返し、接続は維持する。
- `start` 前に `audio`/`commit`/`stop` を受けた場合 → `error`（`fatal:false`）を返す。
- `start` の言語ペアが同一 → `error`（`fatal:false`）。
- server → client メッセージは型を共有するのみでランタイム検証は行わない（自プロセス生成のため）。

---

## メッセージ順序の保証

1セッション内で、1つの発話区切りに対するサーバー応答は次の順序で送られる。

```text
utterance_committed → translation → (enableTts時) audio → metrics
```

interim/final は録音中に随時送られ、上記の確定シーケンスと並行し得る。
クライアントは `type` で判別して状態を更新する（順序前提で受信ロジックを組まない）。
