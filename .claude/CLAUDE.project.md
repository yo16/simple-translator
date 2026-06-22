# プロジェクト固有設定

技術調査用の音声翻訳アプリ（マイク入力音声を別言語の音声＋テキストとして出力する逐次通訳に近いアプリ）。
要件定義は `docs/requirements.md` を参照すること。

## システム構成

ローカル環境でのみ動作する。デプロイしない。

```text
Browser
  ↓
Next.js Page (フロント: マイク入力 / 音声チャンク生成 / WebSocket / 表示 / 再生 / 設定UI)
  ↓ WebSocket (ws://localhost:3001/ws)
Local Node.js WebSocket Server (GCP連携 / 発話区切り判定)
  ↓
Google Cloud Speech-to-Text (Streaming)
  ↓
Google Cloud Translation
  ↓
Google Cloud Text-to-Speech
  ↓
Browser (合成音声を再生)
```

- Next.js と ローカル Node.js WebSocket サーバーを同一リポジトリで起動する（`npm run dev` で concurrently により同時起動）。
- GCP client library はローカル WebSocket サーバー側でのみ使用する。**GCP認証情報をブラウザ側に置かない。**

## 技術スタック

### フロントエンド
- フレームワーク: Next.js (App Router)
- React / TypeScript
- マイク入力: MediaRecorder API
- 通信: WebSocket API
- スタイリング: CSS Modules（**Tailwind CSS は禁止**）

### サーバー（ローカル WebSocket サーバー）
- Node.js / TypeScript
- WebSocket: `ws`
- 起動: `tsx server/index.ts`
- GCP: `@google-cloud/speech`（Streaming） / `@google-cloud/translate` / `@google-cloud/text-to-speech`
- バリデーション: zod（WebSocketメッセージ）

### 共通
- DB: **使用しない**
- 認証: **アプリのユーザー認証は作らない**。GCPはローカルの Application Default Credentials（`gcloud auth application-default login`）を使用
- タスク管理: Beads
- テスト: Jest（単体・結合）+ Playwright（E2E）

### 使用するGCPサービス（この3つに限定）
- Cloud Speech-to-Text
- Cloud Translation
- Cloud Text-to-Speech

Media Translation API は使用しない。

## 対象外（実装しない）

デプロイ / Cloud Run / Docker / DB / ユーザー認証 / 会話履歴の永続保存 / 複数ユーザー対応 / 話者識別 / 言語自動判定 / 管理画面 / 課金管理 / 完全な同時通訳。

## Git戦略

### ブランチ構成
- `main`: 正式版ブランチ（エージェント操作禁止）
- `dev`: 開発ブランチ（featureブランチのマージ先）
- `feature/bd-{beads-id}`: タスクごとのブランチ

### ルール
- Git Worktree を使い、並行で進められるタスクは並行で進める
- featureブランチは Beads の ID を使って命名する
- main ブランチはエージェントが操作しない（dev へのマージのみエージェントが行い、dev→main へのマージはユーザーが手動で行う）

## 要件定義ドキュメント

- 配置先: `docs/requirements.md`

## 設計ドキュメント構成

設計エージェント(`design-architect`)が `docs/design/` 以下に作成する設計ドキュメントの一覧。

- `docs/design/overview.md`: 設計概要（各ドキュメントへのリンク集、要件要約、全体アーキテクチャ方針）
- `docs/design/app-architecture.md`: 全体構成、Next.js ページ構成、状態管理、フロント/サーバーの責務分担
- `docs/design/websocket-protocol.md`: WebSocketメッセージ仕様（client→server: start/audio/stop/commit、server→client: transcript_interim/transcript_final/utterance_committed/translation/audio/metrics/error）
- `docs/design/server-design.md`: WebSocketサーバー処理仕様（セッション管理、音声認識、発話バッファ、発話区切り判定、翻訳、音声合成、エラー処理）
- `docs/design/gcp-integration.md`: Cloud Speech-to-Text(Streaming) / Translation / Text-to-Speech の実装方針、音声形式、ADC認証
- `docs/design/frontend-design.md`: コンポーネント設計（Recorder / LanguageSelector / TranscriptView / SettingsPanel）、音声入出力、状態表示、レイテンシ表示
- `docs/design/styling-design.md`: CSS Modules によるデザイントークン・最低限のレイアウト
- `docs/design/security-design.md`: GCP認証情報の取り扱い方針（サーバー側のみ）、環境変数の扱い

## プロジェクト固有ルール

- **GCP認証情報をクライアント（ブラウザ）側に含めない。** GCP client library はローカル WebSocket サーバー側でのみ使用する。
- 翻訳・音声合成は、原則として確定した発話区切り単位で行う。interim result は画面表示のみに使い、初期状態では翻訳しない（`ENABLE_INTERIM_TRANSLATION=false`）。
- Text-to-Speech は確定済みの発話区切りだけを対象にする（未確定の interim / 仮翻訳は音声出力しない）。
- 発話区切りの初期値: 無音 1.0秒 / 確定テキスト 80文字 / 同一発話 10秒 / 手動 commit / stop。数値は設定で変更可能にする。
- 対応言語は MVP では日本語・英語のみ（ja-JP→en-US、en-US→ja-JP）。
- 環境変数は最小限（`GOOGLE_CLOUD_PROJECT`, `WS_PORT`, `DEFAULT_SOURCE_LANGUAGE`, `DEFAULT_TARGET_LANGUAGE`, `ENABLE_TTS`, `ENABLE_INTERIM_TRANSLATION`, `DEFAULT_CHUNK_MS`, `DEFAULT_SILENCE_MS`, `DEFAULT_MAX_CHARS`, `DEFAULT_MAX_SECONDS`）。`.env.local.example` を用意し、`.env*` はコミットしない。
- Windows 環境でのローカル起動手順と GCP 認証設定を README に記載する。
- 本番運用の作り込みはしない（技術調査が目的）。低遅延化よりも自然に意味が通る翻訳を優先する。
