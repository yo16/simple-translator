# simple-translator

音声翻訳アプリ（技術調査用）。マイク入力音声を別言語のテキスト＋音声として出力する逐次通訳に近いアプリ。

## プロジェクト概要

- ブラウザのマイク入力を Google Cloud Speech-to-Text でストリーミング音声認識する
- 認識した発話を Google Cloud Translation で翻訳する
- 翻訳テキストを Google Cloud Text-to-Speech で音声合成してブラウザで再生する
- 対応言語: 日本語 ⇔ 英語（MVP）

ローカル環境のみで動作する技術調査用アプリ。デプロイ・本番運用は対象外。

## システム構成

```
Browser
  ↓
Next.js (http://localhost:3000)
  ↓ WebSocket (ws://localhost:3001/ws)
Local Node.js WebSocket Server
  ↓
Google Cloud Speech-to-Text / Translation / Text-to-Speech
```

## Windowsローカル起動手順

### 前提環境

- Node.js LTS (推奨: v20以上)
- npm
- Google Cloud CLI

### セットアップ

1. リポジトリをクローンする
2. 依存パッケージをインストールする:

   ```bash
   npm install
   ```

3. 環境変数ファイルを作成する:

   ```bash
   copy .env.local.example .env.local
   ```

4. `.env.local` を編集して `GOOGLE_CLOUD_PROJECT` に GCP プロジェクト ID を設定する

5. アプリを起動する:

   ```bash
   npm run dev
   ```

   - Next.js dev server: http://localhost:3000
   - WebSocket server: ws://localhost:3001/ws

## GCP認証（ADC）設定

### Application Default Credentials の設定

GCP API はローカルの Application Default Credentials（ADC）を使用する。ブラウザ側には認証情報を置かない。

```bash
gcloud auth application-default login
```

ブラウザが開いたら Google アカウントでログインし、権限を付与する。

### 必要な GCP API

GCP コンソールで以下の API を有効にする:

- Cloud Speech-to-Text API
- Cloud Translation API
- Cloud Text-to-Speech API

### 環境変数

`.env.local.example` を参照して `.env.local` を設定する。  
`.env.local` はコミットしない（`.gitignore` で除外済み）。

## 開発

```bash
# 両サーバー同時起動
npm run dev

# 型チェック（フロントエンド）
npm run typecheck

# 型チェック（WebSocketサーバー）
npm run typecheck:server

# lint
npm run lint

# テスト
npm test
```
