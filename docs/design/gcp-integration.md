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

## 言語レジストリ（多言語対応の基盤）

多言語対応（段階導入）にあたり、**1エントリ＝1言語で各APIの言語コードを一元管理する共有モジュール `languages.ts` を新設**する。STT / Translation / TTS の各処理はこのレジストリを参照する実装に統一し、**言語の追加はレジストリへのデータ追加のみで完結**できるようにする（フロント・サーバーで共有する正本）。

### データモデル

```ts
// languages.ts （設計指針。フロント／サーバーで共有）
interface LanguageEntry {
  code: SupportedLanguage;   // protocolコード（BCP-47, 例 "ja-JP"）。WebSocketメッセージで使う正本
  label: string;             // UI表示名（例 "日本語"）
  sttCode: string;           // Speech-to-Text recognition languageCode
  translationCode: string;   // Translation v2 の from/to コード
  ttsLanguageCode: string;   // Text-to-Speech voice.languageCode
  ttsVoiceName?: string;     // TTS voice.name（NEUTRAL非対応言語で必須）
  ttsGender: "NEUTRAL" | "MALE" | "FEMALE";
}
```

- `code` がプロトコル上の正本（WebSocketメッセージの `sourceLanguage` / `targetLanguage`）。各API用コードは `code` から導出せず、必ずレジストリの該当フィールドを引く。
- `SupportedLanguage` は [websocket-protocol.md](./websocket-protocol.md#バリデーション方針zod) の `LanguageEnum` と同一集合にする。

### GCPコード対応表（全13言語・段階導入）

| protocol | 表示名 | STT (recognition) | Translation v2 | TTS languageCode | TTS voice（候補・要 listVoices 検証） | gender |
|---|---|---|---|---|---|---|
| `ja-JP` | 日本語 | `ja-JP` | `ja` | `ja-JP` | `ja-JP-Neural2-B` | NEUTRAL（現状動作） |
| `en-US` | 英語 | `en-US` | `en` | `en-US` | `en-US-Neural2-C` | NEUTRAL（現状動作） |
| `zh-CN` | 中国語(簡体) | `cmn-Hans-CN` | `zh-CN` | `cmn-CN` | `cmn-CN-Wavenet-A` | FEMALE（NEUTRAL不可） |
| `zh-TW` | 中国語(繁体) | `cmn-Hant-TW` | `zh-TW` | `cmn-TW` | `cmn-TW-Wavenet-A` | FEMALE（NEUTRAL不可） |
| `ko-KR` | 韓国語 | `ko-KR` | `ko` | `ko-KR` | `ko-KR-Neural2-A` | FEMALE |
| `fr-FR` | フランス語 | `fr-FR` | `fr` | `fr-FR` | `fr-FR-Neural2-A` | FEMALE |
| `es-ES` | スペイン語 | `es-ES` | `es` | `es-ES` | `es-ES-Neural2-A` | FEMALE |
| `de-DE` | ドイツ語 | `de-DE` | `de` | `de-DE` | `de-DE-Neural2-A` | FEMALE |
| `pt-BR` | ポルトガル語(ブラジル) | `pt-BR` | `pt` | `pt-BR` | `pt-BR-Neural2-A` | FEMALE |
| `th-TH` | タイ語 | `th-TH` | `th` | `th-TH` | `th-TH-Neural2-C` | FEMALE（NEUTRAL不可） |
| `fil-PH` | フィリピン語 | `fil-PH` | `fil`（不可時 `tl` にフォールバック） | `fil-PH` | `fil-PH-Wavenet-A` | FEMALE（NEUTRAL不可） |
| `vi-VN` | ベトナム語 | `vi-VN` | `vi` | `vi-VN` | `vi-VN-Wavenet-A` | FEMALE（NEUTRAL不可） |
| `ms-MY` | マレー語 | `ms-MY` | `ms` | `ms-MY` | `ms-MY-Wavenet-A` | FEMALE（NEUTRAL不可） |

### 段階導入

- **第1陣（先行実装・テスト対象）**: `ja-JP`, `en-US`, `zh-CN`, `zh-TW`, `ko-KR`
- **第2陣（後続）**: `fr-FR`, `es-ES`, `de-DE`, `pt-BR`, `th-TH`, `fil-PH`, `vi-VN`, `ms-MY`

レジストリ構造と本ドキュメントは全13言語を記載するが、実装・テストは第1陣から進める。

### 言語コードの注意点（重要）

- **既存実装はプロトコルの言語コードを各APIへ素通ししていた**。`ja` / `en` がたまたま STT / Translation / TTS のいずれでも有効だったために成立していた。多言語ではコード体系がAPIごとに異なるため、**レジストリ経由に変更が必要**。
- **Translation の従来の `toTranslationLangCode`（`split("-")[0]`）は使えない**。`zh-CN` / `zh-TW` を両方 `zh` に潰してしまい簡体・繁体を区別できない。**レジストリの `translationCode` を使う**（簡繁を `zh-CN` / `zh-TW` として区別）。
- **STT の中国語は script subtag 付き**（`cmn-Hans-CN` / `cmn-Hant-TW`）。プロトコルコード（`zh-CN` / `zh-TW`）とは別物なのでレジストリの `sttCode` を使う。
- `fil-PH` の Translation コードは `fil`。利用不可の場合は `tl` へフォールバックする。

### TTSボイス名の検証方針（重要な前提）

STT / Translation の言語コードは安定しているが、**TTS のボイス名（`ttsVoiceName`）は時期によって提供状況が変動する**。上表のボイス名は候補であり、**実装時に `client.listVoices()` で実在を検証する前提**とする。

- 優先度は **Neural2 > WaveNet > Standard**。
- レジストリ指定のボイスが `listVoices()` の結果に存在しない場合は、**実装側で同一 `ttsLanguageCode` の利用可能ボイスへフォールバックし、ログに記録**する。
- `NEUTRAL` が使えない言語（上表で「NEUTRAL不可」の言語）は `ttsVoiceName` と `ttsGender`（FEMALE 等）を必ず指定する。

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
    languageCode: sttCodeOf(sourceLanguage),  // レジストリの sttCode（例 ja-JP→"ja-JP", zh-CN→"cmn-Hans-CN"）
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

`languageCode` には**レジストリの `sttCode` を使う**（プロトコルコードを素通ししない）。中国語は script subtag 付き（`zh-CN`→`cmn-Hans-CN`、`zh-TW`→`cmn-Hant-TW`）になる点に注意（[言語レジストリ](#言語レジストリ多言語対応の基盤) 参照）。

### 音声チャンクの書き込み

- 受信した base64 → `Buffer.from(data, "base64")` → `recognizeStream.write(buffer)`。
- チャンク間隔は `chunkMs`（既定250ms、bd-simple-translator-mgk）。クライアント側の MediaRecorder の timeslice に対応する。

---

## Cloud Translation（v2 Basic）

### 採用バージョン: v2 (Basic)

多言語対応（段階導入）でもシンプルさを優先し、`@google-cloud/translate` の `v2.Translate` を継続採用する。

```ts
// server/translate.ts （設計指針）
import { v2 } from "@google-cloud/translate";
const translate = new v2.Translate({ projectId: process.env.GOOGLE_CLOUD_PROJECT });

// target はレジストリの translationCode（例 "ja" / "zh-CN" / "zh-TW"）
async function translateText(text: string, target: string): Promise<string> {
  const [translated] = await translate.translate(text, target);
  return translated;
}
```

### 言語コード変換（レジストリ参照）

Translation 用コードは**レジストリの `translationCode` を引く**（[言語レジストリ](#言語レジストリ多言語対応の基盤) 参照）。`targetLanguage` から明示的に target を決める。

- **従来の `split("-")[0]` 方式は使えない**: `zh-CN` / `zh-TW` を両方 `zh` に潰し簡体・繁体を区別できなくなるため。レジストリでは `translationCode` を `zh-CN` / `zh-TW` として保持する。
- `fil-PH` の `translationCode` は `fil`。利用不可の場合は `tl` へフォールバックする。
- `source` は省略して自動判定でも可。

### v3 への移行余地

将来、用語集（glossary）・モデル選択・さらなる多言語拡張が必要になった場合は Cloud Translation v3（`@google-cloud/translate` の `TranslationServiceClient`）への移行を検討する。現時点では v2 で十分（要件 §4「不要な仕組みは排除」）。

---

## Cloud Text-to-Speech

### リクエスト設定（設計例）

```ts
// server/textToSpeech.ts （設計指針）
// entry はレジストリの LanguageEntry（targetLanguage で引く）
const request = {
  input: { text: translatedText },
  voice: {
    languageCode: entry.ttsLanguageCode,        // 例 ja-JP→"ja-JP", zh-CN→"cmn-CN"
    name: entry.ttsVoiceName,                   // listVoices で検証済みのボイス名
    ssmlGender: entry.ttsGender,                // "NEUTRAL" 不可の言語は FEMALE 等
  },
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

`voice` の各値は**レジストリの `ttsLanguageCode` / `ttsVoiceName` / `ttsGender` を引く**（プロトコルコードを素通ししない。例: `zh-CN`→`languageCode: "cmn-CN"`）。ボイス名は起動時の `listVoices()` 検証結果に基づき、無ければ同一 `ttsLanguageCode` 内でフォールバックする（[TTSボイス名の検証方針](#ttsボイス名の検証方針重要な前提) 参照）。
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
