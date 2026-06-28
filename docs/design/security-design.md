# セキュリティ設計

## 関連ドキュメント

- [設計概要 (overview.md)](./overview.md)
- [アプリ全体アーキテクチャ (app-architecture.md)](./app-architecture.md)
- [GCP連携設計 (gcp-integration.md)](./gcp-integration.md)
- [サーバー設計 (server-design.md)](./server-design.md)
- 要件定義: [docs/requirements.md](../requirements.md)（§4 / §17 認証 / §18 環境変数）

---

## スコープ

ローカル環境専用・技術調査用アプリのため、本番セキュリティの作り込みはしない（要件 §4）。
本設計の主眼は **GCP認証情報をブラウザに漏らさないこと** に絞る。アプリのユーザー認証は作らない（要件 §7）。

### 対象外

- ユーザー認証 / 認可
- WSの TLS 化・本番用アクセス制御
- 本番用ログ基盤・監査
- レート制限・WAF 等

これらは要件 §7 の対象外に従い実装しない。

---

## 最重要原則: GCP認証情報をクライアントに置かない

要件 §17 / CLAUDE.md プロジェクト固有ルールの最優先事項。

| 原則 | 実装 |
|---|---|
| GCP client library はサーバーのみ | `@google-cloud/*` を import するのは `server/` 配下のみ。`src/`（Next.js）からは一切 import しない |
| 認証情報はサーバープロセスにのみ存在 | ADC（後述）。ブラウザに鍵・トークンを渡さない |
| バンドルへの混入防止 | `server/` を Next.js の `tsconfig.json` include から除外（[app-architecture.md](./app-architecture.md#tsconfig-分離方針) 参照） |
| 念のための保険 | `next.config.ts` の `serverExternalPackages` に `@google-cloud/*` を記載してよい（ただし本来 Next.js から import しない設計） |

クライアントが GCP に到達する経路は WebSocket 経由のサーバーのみ。ブラウザは GCP エンドポイントを直接知らない。

---

## 認証情報（ADC）

要件 §17 に従う。

- ローカルの Application Default Credentials を使用する。

```bash
gcloud auth application-default login
```

- **サービスアカウントキーJSONを使わない**。鍵ファイルをリポジトリに置かない・コミットしない。
- `.gitignore` に資格情報・`.env*`（後述）が含まれることを確認する。
- 詳細な client 生成方針は [gcp-integration.md](./gcp-integration.md#認証adc) を参照。

---

## 環境変数

要件 §18 の最小セット + クライアント用 `NEXT_PUBLIC_WS_URL`。`.env.local.example` を用意しコミットする。実体の `.env*` はコミットしない（`.env.local.example` のみ例外）。

### 一覧

| 変数 | 既定値 | 利用プロセス | クライアント露出 |
|---|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | （要設定） | サーバー | **不可** |
| `WS_PORT` | `3001` | サーバー | 不可 |
| `ENABLE_TTS` | `true` | サーバー | 不可 |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3001/ws` | クライアント | 可（接続先URLのみ） |

> 言語ペア・発話区切りのしきい値（チャンク間隔・無音時間・最大文字数・最大秒数など）は環境変数化せず、クライアントの `DEFAULT_SETTINGS` に既定値を固定する（bd-simple-translator-mgk）。

### NEXT_PUBLIC_ の取り扱い（厳守）

- `NEXT_PUBLIC_` を付けた変数は **ブラウザバンドルに埋め込まれる**。
- **GCP関連の変数（`GOOGLE_CLOUD_PROJECT` 等）に `NEXT_PUBLIC_` を絶対に付けない。**
- `NEXT_PUBLIC_` を付けてよいのは、ブラウザに見えても問題ない値のみ（本アプリでは WS の接続先 URL だけ）。

### デフォルト値の配布

`DEFAULT_*` 系はサーバー側のデフォルトとして使う。クライアントの初期 `Settings` は、ハードコードした既定値（要件 §13.3 と一致）から開始し、`start` メッセージでサーバーへ送る。クライアントが GCP関連の env を読む必要はない。

---

## WebSocket の取り扱い

- ローカル（`localhost`）専用。外部公開しない。
- 受信メッセージ（client → server）は zod で検証する（[websocket-protocol.md](./websocket-protocol.md#バリデーション方針zod) 参照）。不正メッセージは `error`（`fatal:false`）で拒否。
- `audio.data` は base64 文字列のみ受理。サイズ上限の厳密な制御は MVP対象外だが、極端に大きいフレームは拒否してよい。
- Origin チェック等の本番制御は対象外（ローカル前提）。

---

## エラー情報

- クライアントへ返す `error.message` に、GCP の内部詳細・スタックトレース・認証情報を含めない。
- 詳細はサーバーのコンソールログにのみ出力する（本番ログ基盤は作らない、要件 §7）。
- 区分は [server-design.md](./server-design.md#エラー処理) を参照。

---

## 依存・レビュー観点

- 新規ライブラリ追加時は要件で許可された範囲（要件 §9 / CLAUDE.md 技術スタック）に収める。
- セキュリティスペシャリストのレビュー観点:
  - `src/`（クライアント側）に `@google-cloud/*` の import が無いこと
  - `NEXT_PUBLIC_` が付いた GCP 変数が無いこと
  - 鍵ファイル・`.env*` がコミット対象に含まれていないこと
