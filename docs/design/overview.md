# 設計概要（overview）

技術調査用の音声翻訳アプリ（逐次通訳に近い体験）の設計エントリーポイント。
ワークフロー分割時は本ドキュメントから読み始めること。

---

## 1. 設計ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| [app-architecture.md](./app-architecture.md) | 全体構成、プロセス構成、ディレクトリ、Client/Server境界、状態管理、データフロー |
| [websocket-protocol.md](./websocket-protocol.md) | WebSocketメッセージ仕様（start/audio/commit/stop ／ transcript_interim/transcript_final/utterance_committed/translation/audio/metrics/error）、zod検証 |
| [server-design.md](./server-design.md) | WebSocketサーバー処理（セッション管理、音声認識、発話バッファ、発話区切り判定、翻訳、音声合成、レイテンシ、エラー） |
| [gcp-integration.md](./gcp-integration.md) | Speech-to-Text(Streaming) / Translation(v2) / Text-to-Speech の実装方針、音声形式、ADC認証 |
| [frontend-design.md](./frontend-design.md) | コンポーネント設計、状態管理フック、音声入出力、レイテンシ表示 |
| [styling-design.md](./styling-design.md) | CSS Modules + CSS変数によるデザイントークン・最低限レイアウト |
| [security-design.md](./security-design.md) | GCP認証情報の取り扱い（サーバー側のみ）、環境変数、NEXT_PUBLIC_ ルール |

要件定義の正本: [docs/requirements.md](../requirements.md)

---

## 2. 要件の要約

- マイク入力音声を別言語の「テキスト＋音声」で出力する逐次通訳アプリ（要件 §1/§2）。
- UX: 「話す → 少し待つ → 翻訳テキスト表示 → 翻訳音声再生」。完全な同時通訳は目指さない（要件 §2）。
- 低遅延化より、自然に意味が通る翻訳を優先する（要件 §4）。
- ローカル環境専用。デプロイ・DB・認証・履歴永続化はしない（要件 §4/§7）。
- 使用 GCP は3つに限定: Speech-to-Text / Translation / Text-to-Speech。Media Translation API は不使用（要件 §5）。
- 対応言語は MVP で日本語・英語のみ（ja-JP⇄en-US、要件 §11.2）。
- 画面は1ページ（要件 §11）。

### 対象外（実装しない）

デプロイ / Cloud Run / Docker / DB / ユーザー認証 / 会話履歴の永続保存 / 複数ユーザー対応 / 話者識別 / 言語自動判定 / 管理画面 / 本番ログ基盤 / 課金管理 / 完全な同時通訳 / Media Translation / ストリーミングTTSの本格検証（要件 §7）。

---

## 3. 全体アーキテクチャ方針

### プロセス構成

ローカルで2プロセスを `concurrently` 同時起動する（要件 §8/§20）。

```text
Browser
  ▼
Next.js dev server (3000)  … 画面・マイク・WebSocketクライアント・音声再生・設定UI
  ▼ WebSocket (ws://localhost:3001/ws)
Local Node.js WebSocket Server (WS_PORT=3001)  … セッション管理・発話区切り判定・GCP連携
  ├─▶ Cloud Speech-to-Text (Streaming)
  ├─▶ Cloud Translation (v2 Basic)
  └─▶ Cloud Text-to-Speech (MP3)
```

Next.js の Route Handler では完結させず独立 WebSocketサーバーにする（長時間双方向gRPCストリーム・ステートフルセッション・Edge制約回避・GCP認証の分離のため）。詳細は [app-architecture.md](./app-architecture.md#なぜ-nextjs-route-handler-ではなく独立wsサーバーなのか)。

### フロント/サーバー責務分担

- Next.js: 画面とクライアント処理のみ。GCP には触れない。
- WebSocketサーバー: GCP client library を使うのはここだけ（[security-design.md](./security-design.md#最重要原則-gcp認証情報をクライアントに置かない)）。

### 状態管理

外部ライブラリ不要。`useReducer` + `useState` + カスタムフック（`useWebSocket` / `useRecorder` / `useAudioQueue`）。`"use client"` 境界は `TranslatorApp` の1箇所に集約（[frontend-design.md](./frontend-design.md#状態管理とフック)）。

---

## 4. 重要な技術判断

| 項目 | 判断 | 参照 |
|---|---|---|
| 音声形式 | WebM/Opus（48kHz）。STT へ `encoding: WEBM_OPUS`。MVPで PCM変換しない | [gcp-integration.md](./gcp-integration.md#音声形式) |
| STTストリーム | **セッション中切り直さない**（WebM/Opusのヘッダは最初のチャンクのみ）。発話区切りの「確定」はサーバー内の発話バッファを論理的に確定・クリアする操作 | [gcp-integration.md](./gcp-integration.md#stt-ストリーム維持) / [server-design.md](./server-design.md#発話バッファと発話区切り判定) |
| Translation | MVP（ja⇄en）は v2 (Basic) を採用。将来 v3 移行余地あり | [gcp-integration.md](./gcp-integration.md#cloud-translationv2-basic) |
| 発話区切り初期値 | 無音1.0秒 / 確定80文字 / 同一発話10秒 / 手動commit / stop（設定で変更可） | [server-design.md](./server-design.md#発話区切り判定) |
| interim | 表示のみ。初期は翻訳しない（`ENABLE_INTERIM_TRANSLATION=false`）。TTSは確定発話のみ | [server-design.md](./server-design.md#音声認識要件-152) |
| TTS出力 | MP3（`audio/mpeg`）。クライアントは `decodeAudioData` で FIFO 再生 | [frontend-design.md](./frontend-design.md#音声再生) |
| 環境変数 | 要件 §18 最小セット + `NEXT_PUBLIC_WS_URL`。GCP変数に `NEXT_PUBLIC_` を付けない | [security-design.md](./security-design.md#環境変数) |
| レイテンシ | speechMs/translationMs/ttsMs/totalMs を metrics で送信＋クライアントで再生開始時刻を記録 | [websocket-protocol.md](./websocket-protocol.md#metricsレイテンシ計測) / [server-design.md](./server-design.md#レイテンシ計測) |

---

## 5. メッセージ仕様（要約）

JSON テキストフレーム。音声は base64 で JSON に格納。

| 方向 | type |
|---|---|
| client → server | `start` / `audio` / `commit` / `stop` |
| server → client | `transcript_interim` / `transcript_final` / `utterance_committed` / `translation` / `audio` / `metrics` / `error` |

受信（client→server）はサーバー側 zod で検証。確定シーケンスは `utterance_committed → translation → (TTS時) audio → metrics`。
詳細は [websocket-protocol.md](./websocket-protocol.md)。

---

## 6. 技術スタック（要約）

| レイヤ | 技術 |
|---|---|
| フロント | Next.js (App Router) / React / TypeScript / MediaRecorder / WebSocket API |
| スタイル | CSS Modules + CSS変数（**Tailwind禁止**） |
| サーバー | Node.js / TypeScript / `ws` / `tsx` / zod |
| GCP | `@google-cloud/speech`(Streaming) / `@google-cloud/translate`(v2) / `@google-cloud/text-to-speech` |
| 認証 | ローカル ADC（`gcloud auth application-default login`）。アプリ認証なし |
| テスト | Jest（単体・結合）+ Playwright（E2E） |

DBは使用しない。本番運用の作り込みはしない（要件 §4）。
