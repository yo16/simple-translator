# アプリ全体アーキテクチャ設計

## 関連ドキュメント

- [設計概要 (overview.md)](./overview.md)
- [WebSocketプロトコル設計 (websocket-protocol.md)](./websocket-protocol.md)
- [サーバー設計 (server-design.md)](./server-design.md)
- [GCP連携設計 (gcp-integration.md)](./gcp-integration.md)
- [フロントエンド設計 (frontend-design.md)](./frontend-design.md)
- [スタイリング設計 (styling-design.md)](./styling-design.md)
- [セキュリティ設計 (security-design.md)](./security-design.md)
- 要件定義: [docs/requirements.md](../requirements.md)

---

## 目的とスコープ

技術調査用の逐次通訳アプリ。マイク入力音声を別言語の「テキスト＋音声」として出力する。
完全な同時通訳ではなく、「話す → 少し待つ → 翻訳テキスト表示 → 翻訳音声再生」のUXを目標とする（要件 §2）。

低遅延化よりも、自然に意味が通る翻訳を優先する（要件 §4）。

### 対象外（実装しない）

要件 §7 に従い、以下は実装しない。本設計でも一切扱わない。

- デプロイ / Cloud Run / Docker
- DB / 会話履歴の永続保存
- ユーザー認証
- 複数ユーザー対応 / 話者識別 / 言語自動判定
- 管理画面 / 本番用ログ基盤 / 課金管理
- 完全な同時通訳 / ストリーミングTTSの本格検証 / Media Translation API

---

## プロセス構成

ローカル環境でのみ動作する。**2つの独立したプロセス**を `concurrently` で同時起動する。

```text
Browser
  │
  ▼
[プロセスA] Next.js dev server (http://localhost:3000)
  │  - 画面表示 / マイク入力 / 音声チャンク生成
  │  - WebSocketクライアント / 合成音声再生 / 設定UI
  │
  ▼ WebSocket (ws://localhost:3001/ws)
[プロセスB] Local Node.js WebSocket Server (ws://localhost:3001)
  │  - セッション管理 / 発話区切り判定
  │  - GCP client library 呼び出し（このプロセスのみ）
  │
  ├─▶ Google Cloud Speech-to-Text (Streaming)
  ├─▶ Google Cloud Translation (v2 Basic)
  └─▶ Google Cloud Text-to-Speech
```

### なぜ Next.js Route Handler ではなく独立WSサーバーなのか

要件 §25 および技術判断に基づく。

| 観点 | 説明 |
|---|---|
| 長時間双方向ストリーム | Speech-to-Text Streaming は長時間維持する gRPC 双方向ストリーム。HTTP Route Handler のリクエスト/レスポンスモデルに不向き |
| ステートフルセッション | 発話バッファ・STTストリームを接続単位で保持する必要があり、ステートレス前提の Route Handler と相性が悪い |
| Edge Runtime制約回避 | Next.js の実行環境制約（Node API・gRPCの利用制限）を回避できる |
| 関心の分離 | GCP client library を Next.js から完全に分離し、認証情報をブラウザバンドルへ混入させない（[security-design.md](./security-design.md) 参照） |

---

## ディレクトリ構成

要件 §19 を踏襲しつつ、Next.jsスペシャリストの助言を反映する。

```text
simple-translator/
  src/
    app/
      layout.tsx          # ルートレイアウト（Server Component）
      page.tsx            # トップページ（Server Component, TranslatorApp を読み込むだけ）
      globals.css         # グローバルCSS / デザイントークン定義
    components/
      TranslatorApp.tsx   # "use client" 境界。アプリ全体状態を保持（最上位 Client Component）
      Recorder.tsx        # 録音/接続コントロール
      LanguageSelector.tsx# 入力/出力言語選択
      TranscriptView.tsx  # interim/final/翻訳/レイテンシ表示
      SettingsPanel.tsx   # 発話区切り設定・TTS ON/OFF
    lib/
      audio.ts            # 音声再生（AudioContext / FIFOキュー）
      websocketClient.ts  # WebSocket接続ユーティリティ
      types.ts            # フロント/共通の型・メッセージ型
    hooks/
      useWebSocket.ts     # WebSocket接続フック
      useRecorder.ts      # MediaRecorderフック
      useAudioQueue.ts    # 音声FIFO再生フック
  server/                 # ★Next.jsとは別プロセス。tsconfig include/paths から除外
    index.ts              # WebSocketサーバー起動・接続管理
    session.ts            # セッション単位の処理オーケストレーション
    speechStream.ts       # Speech-to-Text Streaming ラッパー
    translate.ts          # Cloud Translation ラッパー
    textToSpeech.ts       # Cloud Text-to-Speech ラッパー
    utteranceBuffer.ts    # 発話バッファ・発話区切り判定
    schema.ts             # zod による受信メッセージスキーマ
    types.ts              # サーバー側型
  package.json
  next.config.ts
  tsconfig.json           # Next.js用（server/ を除外）
  tsconfig.server.json    # サーバー用（任意・tsx 実行のため必須ではない）
  README.md
  .env.local.example      # コミットする（実体 .env.local はコミットしない）
```

> 注: 要件 §19 では `useWebSocket` 等のフックや `TranslatorApp` は明示されていないが、状態集約のため追加する。`session.ts`・`schema.ts` も同様に責務分離のため追加する。

### tsconfig 分離方針

- `src/` 側の `tsconfig.json` の `include` から `server/` を除外する。
- `server/` 配下の GCP client library が Next.js のバンドル対象・型解決対象に入らないようにする。
- `server/index.ts` は `tsx --watch server/index.ts` で直接実行する（ビルド不要）。

詳細は [server-design.md](./server-design.md#プロセス起動) を参照。

---

## Client/Server Component 境界

Next.jsスペシャリストの助言に従い、`"use client"` の境界を1箇所に集約する。

```text
app/layout.tsx        (Server Component)
  └─ app/page.tsx     (Server Component)  ← データ取得なし。下記を描画するだけ
       └─ TranslatorApp.tsx  ("use client") ← ここから下はすべてクライアント
            ├─ Recorder.tsx
            ├─ LanguageSelector.tsx
            ├─ TranscriptView.tsx
            └─ SettingsPanel.tsx
```

### ルール

- `app/page.tsx` は Server Component のまま維持する。サーバーデータ取得は行わない。
- `TranslatorApp` が `"use client"` を宣言し、WebSocket接続・アプリ全体状態を保持して子コンポーネントへ props で配る。
- マイク / WebSocket / 音声再生 / 設定UI はすべてクライアント側で動作する。
- `lib/*.ts`・`hooks/*.ts` は非コンポーネントのため `"use client"` 不要。Client Component から import されると自動的にクライアントバンドルへ含まれる。
- `middleware.ts` は **作成しない**（認証・リダイレクトの要件がないため）。
- `next.config.ts` の `serverExternalPackages` に `@google-cloud/*` を保険として記載してよいが、設計上 Next.js 側から GCP を import しないため本来不要。

詳細なコンポーネント設計は [frontend-design.md](./frontend-design.md) を参照。

---

## 状態管理方針

外部状態管理ライブラリ（Redux / Zustand / Context）は使用しない。
Next.jsスペシャリストの助言どおり、`useReducer` + `useState` + カスタムフックで構成する。

### 全体状態（`TranslatorApp` 内 `useReducer`）

| 状態カテゴリ | 内容 |
|---|---|
| `AppStatus` | `idle` / `connecting` / `connected` / `recording` / `disconnected` / `error` |
| `TranscriptState` | `interim`（途中認識文字列）、`finals[]`（確定認識履歴）、`committed`（直近の確定発話）、`translations[]`（翻訳結果履歴） |
| `Metrics` | 直近のレイテンシ計測値（speechMs / translationMs / ttsMs / totalMs） |
| `error` | 直近のエラーメッセージ |

### 設定（`useState`）

`Settings`（言語ペア、enableTts、chunkMs、silenceMs、maxChars、maxSeconds、enableInterimTranslation）。
初期値は環境変数由来のデフォルトを使用する（[security-design.md](./security-design.md#環境変数) 参照）。

### カスタムフック

| フック | 責務 |
|---|---|
| `useWebSocket(settings)` | WebSocket接続管理、`start`/`stop`/`commit`/`audio` 送信、受信メッセージのディスパッチ |
| `useRecorder(onChunk)` | MediaRecorder制御、`chunkMs` ごとの Blob を `onChunk` で渡す |
| `useAudioQueue()` | 受信音声(mp3 base64)のFIFO再生 |

詳細は [frontend-design.md](./frontend-design.md#状態管理とフック) を参照。

---

## データフロー（エンドツーエンド）

```text
[録音開始]
  useRecorder → chunkMs ごとに Blob
    → blob.arrayBuffer() → base64
    → useWebSocket: { type:"audio", data } 送信
      → server: STTストリームへ書き込み
        → STT interim  → server: transcript_interim → client: TranscriptState.interim 更新（表示のみ）
        → STT final    → server: 発話バッファへ追加 → transcript_final → client: finals[] 追加
          → 発話区切り判定（無音/文字数/秒数/commit/stop）
            → utterance_committed → client: committed 更新
            → Translation 実行 → translation → client: translations[] 追加
              → (enableTts) TextToSpeech → audio(mp3 base64) → client: useAudioQueue で FIFO 再生
            → metrics → client: Metrics 更新（レイテンシ表示）
```

interim は **画面表示のみ**で翻訳・TTS対象外（要件 §13.4 / §13.5）。
発話区切りの詳細は [server-design.md](./server-design.md#発話区切り判定) を参照。
メッセージ仕様は [websocket-protocol.md](./websocket-protocol.md) を参照。

---

## 同時起動と環境変数

### npm scripts（要件 §20）

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:web\" \"npm run dev:ws\"",
    "dev:web": "next dev",
    "dev:ws": "tsx --watch server/index.ts"
  }
}
```

- `dev:web`: Next.js dev server（ポート3000）
- `dev:ws`: WebSocketサーバー（`WS_PORT`、初期値3001）

### クライアントの接続先

クライアントは `NEXT_PUBLIC_WS_URL`（例 `ws://localhost:3001/ws`）で接続先を取得する。
`NEXT_PUBLIC_` プレフィックスはブラウザに露出してよい値にのみ付与する。
**GCP関連の環境変数には絶対に `NEXT_PUBLIC_` を付けない**（[security-design.md](./security-design.md#環境変数) 参照）。

環境変数の一覧は [security-design.md](./security-design.md#環境変数) に集約する。

---

## 技術スタック要約

| レイヤ | 技術 |
|---|---|
| フロント | Next.js (App Router) / React / TypeScript / MediaRecorder API / WebSocket API |
| スタイル | CSS Modules + CSS Custom Properties（**Tailwind禁止**） |
| サーバー | Node.js / TypeScript / `ws` / `tsx` 実行 / zod |
| GCP | `@google-cloud/speech`(Streaming) / `@google-cloud/translate`(v2) / `@google-cloud/text-to-speech` |
| 認証 | ローカル ADC（`gcloud auth application-default login`）。アプリ認証なし |
| テスト | Jest（単体・結合）+ Playwright（E2E） |

DBは使用しない。
