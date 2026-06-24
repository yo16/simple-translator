# simple-translator

音声翻訳アプリ（技術調査用）。マイク入力音声を別言語のテキスト＋音声として出力する、逐次通訳に近いアプリ。

> **本アプリは技術調査を目的としたローカル専用アプリです。本番運用・デプロイは対象外です。**
> 対象外: デプロイ / Cloud Run / Docker / DB / ユーザー認証 / 会話履歴の永続保存 / 複数ユーザー対応

## 概要

- ブラウザのマイク入力を Google Cloud Speech-to-Text でストリーミング音声認識する
- 認識した発話を Google Cloud Translation で翻訳する
- 翻訳テキストを Google Cloud Text-to-Speech で音声合成してブラウザで再生する
- 対応言語（MVP）: 日本語 ⇔ 英語（ja-JP / en-US）

### システム構成

```
Browser
  ↓
Next.js（http://localhost:3000）
  ↓ WebSocket（ws://localhost:3001/ws）
Local Node.js WebSocket Server
  ↓
Google Cloud Speech-to-Text
  ↓
Google Cloud Translation
  ↓
Google Cloud Text-to-Speech
  ↓
Browser（合成音声を再生）
```

Next.js とローカル Node.js WebSocket サーバーを同一リポジトリで起動します。`npm run dev` 実行時に `concurrently` によって両サーバーが同時に起動します。

**GCP client library（`@google-cloud/*`）はローカル WebSocket サーバー側でのみ使用します。GCP 認証情報をブラウザ側（クライアント）には置きません。**

---

## 前提条件

### Node.js / npm

`package.json` に `engines` フィールドの指定はありませんが、使用する Next.js 15 および React 19 の要件に合わせて **Node.js v20 以上（LTS 推奨）** を使用してください。

```powershell
node --version
npm --version
```

### Google Cloud の準備

1. GCP プロジェクトを作成する（既存のプロジェクトを使う場合は不要）
2. GCP コンソールで以下の 3 つの API を有効にする

   | API名 |
   |---|
   | Cloud Speech-to-Text API |
   | Cloud Translation API |
   | Cloud Text-to-Speech API |

3. Google Cloud CLI をインストールする（未インストールの場合）
   - [Google Cloud CLI インストールガイド](https://cloud.google.com/sdk/docs/install?hl=ja)

---

## セットアップ

### 1. GCP 認証（Application Default Credentials）の設定

GCP API はローカルの Application Default Credentials（ADC）を使用します。サービスアカウントキー JSON は使用しません。

```powershell
gcloud auth application-default login
```

ブラウザが開いたら Google アカウントでログインし、権限を付与します。

> **注意**: GCP 認証情報はローカル WebSocket サーバープロセスのみが使用します。ブラウザ側には認証情報を一切渡しません。GCP 関連の環境変数（`GOOGLE_CLOUD_PROJECT` 等）に `NEXT_PUBLIC_` プレフィックスを付けないでください。

### 2. 依存パッケージのインストール

```powershell
npm install
```

### 3. 環境変数ファイルの作成

`.env.local.example` をコピーして `.env.local` を作成します。

```powershell
Copy-Item .env.local.example .env.local
```

`.env.local` を編集し、`GOOGLE_CLOUD_PROJECT` に GCP プロジェクト ID を設定します。

```powershell
notepad .env.local
```

### 4. 環境変数の説明

| 変数名 | 既定値 | 説明 |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | （空・要設定） | GCP プロジェクト ID。必須。 |
| `WS_PORT` | `3001` | WebSocket サーバーのポート番号 |
| `DEFAULT_SOURCE_LANGUAGE` | `ja-JP` | 音声認識のデフォルト入力言語 |
| `DEFAULT_TARGET_LANGUAGE` | `en-US` | 翻訳のデフォルト出力言語 |
| `ENABLE_TTS` | `true` | Text-to-Speech の有効/無効 |
| `ENABLE_INTERIM_TRANSLATION` | `false` | 認識途中結果の仮翻訳の有効/無効（調査用。通常は `false`） |
| `DEFAULT_CHUNK_MS` | `500` | 音声チャンク送信間隔（ミリ秒） |
| `DEFAULT_SILENCE_MS` | `1000` | 発話区切り判定の無音時間しきい値（ミリ秒） |
| `DEFAULT_MAX_CHARS` | `80` | 発話区切り判定の最大文字数 |
| `DEFAULT_MAX_SECONDS` | `10` | 発話区切り判定の最大秒数 |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3001/ws` | フロントエンドの WebSocket 接続先 URL |

> `.env.local` はコミットしません（`.gitignore` で除外済み）。`.env.local.example` のみリポジトリに含まれています。

---

## 起動

```powershell
npm run dev
```

このコマンドで `concurrently` により以下の 2 つのサーバーが同時に起動します。

| サーバー | スクリプト | URL |
|---|---|---|
| Next.js（フロントエンド） | `npm run dev:web` | http://localhost:3000 |
| Node.js WebSocket サーバー | `npm run dev:ws` | ws://localhost:3001/ws |

---

## 動作確認

1. ブラウザで `http://localhost:3000` を開く
2. 入力言語・出力言語を選択する（日本語 ⇔ 英語）
3. 「接続」ボタンを押して WebSocket サーバーに接続する
4. 「録音開始」ボタンを押してマイクへの権限を許可し、話す
5. 画面に認識途中テキストが表示されることを確認する
6. 発話後、少し待つと翻訳テキストが表示され、翻訳音声が再生されることを確認する

---

## テスト

```powershell
# 単体・結合テスト（Jest）
npm test

# E2E テスト（Playwright）
npm run test:e2e
```

> E2E テストを実行する前に `npm run dev` でサーバーを起動しておいてください。

---

## 開発用スクリプト一覧

| スクリプト | 内容 |
|---|---|
| `npm run dev` | Next.js + WebSocket サーバーを同時起動（開発用） |
| `npm run dev:web` | Next.js dev server のみ起動 |
| `npm run dev:ws` | WebSocket サーバーのみ起動（`tsx --watch`） |
| `npm run build` | Next.js 本番ビルド |
| `npm run lint` | ESLint によるコード検査 |
| `npm run typecheck` | TypeScript 型チェック（フロントエンド） |
| `npm run typecheck:server` | TypeScript 型チェック（WebSocket サーバー） |
| `npm test` | Jest による単体・結合テスト |
| `npm run test:e2e` | Playwright による E2E テスト |

---

## 注意事項・制約

### GCP 認証情報について

- GCP client library（`@google-cloud/speech` / `@google-cloud/translate` / `@google-cloud/text-to-speech`）は **ローカル WebSocket サーバー（`server/` 配下）でのみ使用します**
- ブラウザ側（Next.js `src/` 配下）には GCP の認証情報・client library を一切置きません
- サービスアカウントキー JSON は使用しません。ローカルの ADC（`gcloud auth application-default login`）を使用します
- `.env.local` の `GOOGLE_CLOUD_PROJECT` 等の GCP 関連変数に `NEXT_PUBLIC_` を付けないでください（ブラウザバンドルに埋め込まれてしまいます）

### 本アプリの制限事項

- 完全な同時通訳ではなく、発話後に少し待つと翻訳が流れる逐次通訳に近い体験です
- 翻訳・音声合成は確定した発話区切り単位で行います（認識途中結果は画面表示のみ）
- 対応言語は日本語・英語のみ（ja-JP ⇄ en-US）
- ローカル環境専用。デプロイ・本番運用は対象外です
- 長時間の連続会話・複数ユーザー同時接続は対象外です
