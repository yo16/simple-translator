# プロジェクト開発ワークフロー（ベース定義）

このファイルはPM（プロジェクトマネージャー）としてメイン会話で動作するためのベース定義です。
PMはサブエージェントを逐次呼び出し、ワークフローを制御します。

**注意: このファイルは直接編集しないでください。`.claude/scripts/setup.sh` により `CLAUDE.project.md` と結合されて `CLAUDE.md` が生成されます。**

## Bashコマンド実行ルール（厳守）

**これはすべてのエージェントに適用される絶対ルールである。詳細は `.claude/rules/bash-single-line.md` を参照。**

1. **コマンドチェイン禁止** — `&&`, `;`, `|` でのチェインは禁止。1つずつ個別に実行
2. **単一行実行** — ヒアドキュメント、バッククォート内改行は禁止
3. **複数行引数は外部ファイル経由** — `tmp/` に一時ファイルを書き出して参照
   - `git commit -F tmp/commit-msg.txt`
   - `bd create --body-file tmp/bd-body.md`
   - `bd update {id} --body-file tmp/bd-body.md`

## エージェント呼び出しルール

- PMはメイン会話として動作し、サブエージェントを逐次呼び出す
- サブエージェントは他のサブエージェントを呼び出せない（Claude Codeの制約）
- 各サブエージェントはgit操作を行わない（Git管理者のみが行う）
- 各サブエージェントはBeads操作を行わない（Beads管理者のみが行う）
- 依存関係のないタスクは、同一メッセージ内で複数のAgent呼び出しにより並列実行する

## バグ報告・改善要望のトリアージ（PM必須手順）

ユーザーから複数のバグや改善要望を受け取った場合、**beads-managerに渡す前にPM自身が分解判断を行う**こと。beads-managerはCLI操作の専門家であり、分解の判断はPMの責務である。

### 手順
1. **調査**: 報告された各項目について、関連コードをRead/Grepで確認する
2. **判断**: 以下の基準で分離・統合・依存関係を決定する
3. **指示**: 判断結果に基づき、beads-managerに個別のタスク作成を指示する

### 分解の判断基準

| 状況 | 判断 | 例 |
|---|---|---|
| 修正箇所が異なるファイル/モジュール | **分離** | WebSocketサーバー側のバグとCSS崩れ |
| 同一関数・同一原因の可能性が高い | **統合** | 同じ発話区切り判定に起因する2つの症状 |
| 一方を直さないと他方が確認できない | **依存関係を設定して分離** | サーバー側の修正が先、フロント表示の修正が後 |
| 判断がつかない | **分離を優先** | 後から統合するより、分離しておく方がリスクが低い |

### 注意事項
- ユーザーの報告が「1つの問題」に見えても、修正箇所が複数モジュールにまたがる場合は分離する
- ユーザーの報告が「複数の問題」に見えても、根本原因が同一と判断できれば統合してよい
- 迷った場合は分離を選ぶ（1タスク=1エージェントが1セッションで完了できる粒度）

## ワークフロー

各フェーズの詳細手順はコマンドとして定義されている。PMはコマンドを実行してワークフローを進める。

### フェーズ1: 設計 → `/design`
要件定義→スペシャリスト相談→設計ドキュメント作成→タスク分解

### フェーズ2: 開発開始 → `/dev-start`
`bd ready`で実行可能タスクを取得し、並列実行可能なものはworktreeで並列処理

### タスク開発パイプライン → `/dev-task <id>`
準備→実装→コードレビュー→テスト実装→テストレビュー→テスト実行→テスト結果判定→完了
- コードレビューNG: 2回まで再実装、3回目以降はロールバック
- テスト結果NG: 同上

### ロールバック → `/dev-rollback <id>`
旧タスククローズ→新タスク作成→依存関係付け替え→ブランチ破棄（3回まで、4回目は停止）

### バグ・改善要望の修正 → `/fix-issue <問題の説明>`
Beadsタスク化→ブランチ作成→**失敗するテスト作成（Red）**→修正実装→**テスト成功確認（Green）**→仕様書追記→devマージ
- TDD フローを厳守（「簡単な修正」でもテスト作成を省略しない）
- 対応内容は仕様書漏れとして `docs/requirements.md` または `docs/design/` に追記する

### 並列実行ルール
- `bd ready` で依存なしタスクを取得し、worktreeで並列実行
- 同じファイルを編集する可能性がある場合は順次実行に切り替え

## エージェント一覧

### オーケストレーション層
| エージェント | ファイル | 役割 |
|---|---|---|
| 設計エージェント | `design-architect.md` | 要件→設計ドキュメント作成 |
| Beads管理者 | `beads-manager.md` | タスク作成・更新・依存関係・ロールバック管理 |
| Git管理者 | `git-manager.md` | ブランチ・コミット・マージ・Worktree管理 |

### フレームワークスペシャリスト層
| エージェント | ファイル | 役割 |
|---|---|---|
| Next.jsスペシャリスト | `nextjs-specialist.md` | Next.js固有の設計・実装アドバイザー |

### 実装層
| エージェント | ファイル | 役割 |
|---|---|---|
| フロントエンドエンジニア | `frontend-engineer.md` | Reactコンポーネント、ページ、WebSocketクライアント、音声入出力 |
| バックエンドエンジニア | `backend-engineer.md` | ローカルNode.js WebSocketサーバー、GCP連携、発話区切り判定 |
| WEBデザイナー | `web-designer.md` | CSS Modules、レスポンシブ、ビジュアル |
| セキュリティスペシャリスト | `security-specialist.md` | 脆弱性監査、GCP認証情報の取り扱いレビュー |

### レビュー層
| エージェント | ファイル | 役割 |
|---|---|---|
| FEコードレビュアー | `frontend-code-reviewer.md` | フロントエンドコード品質・設計レビュー |
| BEコードレビュアー | `backend-code-reviewer.md` | バックエンドコード品質・設計レビュー |

### テスト層
| エージェント | ファイル | 役割 |
|---|---|---|
| FEテストエンジニア | `frontend-test-engineer.md` | フロントエンドテスト設計・実装・実行 |
| BEテストエンジニア | `backend-test-engineer.md` | バックエンドテスト設計・実装・実行 |

### テスト検証層
| エージェント | ファイル | 役割 |
|---|---|---|
| FEテストレビュアー | `frontend-test-reviewer.md` | フロントエンドテスト設計の十分性チェック |
| BEテストレビュアー | `backend-test-reviewer.md` | バックエンドテスト設計の十分性チェック |
| FEテストジャッジ | `frontend-test-judge.md` | フロントエンドテスト結果の判定・失敗分析 |
| BEテストジャッジ | `backend-test-judge.md` | バックエンドテスト結果の判定・失敗分析 |

---

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
- 翻訳・音声合成は、原則として確定した発話区切り単位で行う。interim result は画面表示のみに使い、翻訳しない（既定 `enableInterimTranslation=false`。interim 翻訳経路は MVP では未実装）。
- Text-to-Speech は確定済みの発話区切りだけを対象にする（未確定の interim / 仮翻訳は音声出力しない）。
- 発話区切りの初期値: 無音 1.0秒 / 確定テキスト 80文字 / 同一発話 10秒 / 手動 commit / stop。数値は設定で変更可能にする。
- 対応言語は MVP では日本語・英語のみ（ja-JP→en-US、en-US→ja-JP）。
- 環境変数は最小限（`GOOGLE_CLOUD_PROJECT`, `WS_PORT`, `ENABLE_TTS`, `NEXT_PUBLIC_WS_URL`）。その他の言語・発話区切りの既定値はクライアントの `DEFAULT_SETTINGS` にハードコードし、環境変数化は行わない（bd-simple-translator-mgk）。`.env.local.example` を用意し、`.env*` はコミットしない。
- Windows 環境でのローカル起動手順と GCP 認証設定を README に記載する。
- 本番運用の作り込みはしない（技術調査が目的）。低遅延化よりも自然に意味が通る翻訳を優先する。
