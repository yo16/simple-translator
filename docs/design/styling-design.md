# スタイリング設計

## 関連ドキュメント

- [設計概要 (overview.md)](./overview.md)
- [アプリ全体アーキテクチャ (app-architecture.md)](./app-architecture.md)
- [フロントエンド設計 (frontend-design.md)](./frontend-design.md)
- 要件定義: [docs/requirements.md](../requirements.md)（§4 UIは最低限 / §11 画面要件）

---

## 方針

- **CSS Modules + CSS Custom Properties（CSS変数）** を使用する。
- **Tailwind CSS は禁止**（`.claude/rules/no-tailwind.md`）。`@apply`・ユーティリティクラスも一切使わない。
- UIは最低限（要件 §4 / §11）。技術調査が目的のため、装飾は控えめにし、状態と数値が読み取りやすいことを優先する。
- レイアウトは1ページ・縦積み中心。レスポンシブは「狭い画面で破綻しない」程度に留める。

### Tailwind を使わない理由

要素ごとに個別スタイルを散らすと統一的なメンテナンスがしづらいため。デザイントークンを CSS変数に集約し、CSS Modules でコンポーネント単位にスコープする。

---

## ファイル構成

```text
src/app/globals.css           # デザイントークン（CSS変数）・リセット・base
src/components/TranslatorApp.module.css
src/components/Recorder.module.css
src/components/LanguageSelector.module.css
src/components/TranscriptView.module.css
src/components/SettingsPanel.module.css
```

- グローバルに置くのは「デザイントークン」「最小リセット」「body の基本タイポグラフィ」のみ。
- 各コンポーネントの見た目は対応する `*.module.css` に閉じる。

---

## デザイントークン（`globals.css` の `:root`）

```css
:root {
  /* color */
  --color-bg: #f7f7f8;
  --color-surface: #ffffff;
  --color-border: #d9d9e0;
  --color-text: #1c1c20;
  --color-text-muted: #6b6b75;
  --color-accent: #2563eb;
  --color-accent-text: #ffffff;
  --color-interim: #8a8a93;   /* 途中認識は淡色（確定と区別） */
  --color-error: #c0392b;
  --color-success: #15803d;

  /* spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;

  /* radius / font */
  --radius-sm: 4px;
  --radius-md: 8px;
  --font-base: system-ui, -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", Consolas, monospace; /* レイテンシ数値表示用 */
  --fs-sm: 0.85rem;
  --fs-md: 1rem;
  --fs-lg: 1.25rem;
}
```

すべてのコンポーネントは色・余白・角丸・フォントをこれらの変数経由で参照する（直値の色指定を避ける）。

---

## レイアウト指針

- 全体は中央寄せの単一カラム（最大幅 `min(720px, 100%)` 程度）。
- セクション順（縦積み）: 言語選択 → 接続/録音コントロール → 状態/エラー → 認識(interim/final) → 翻訳 → レイテンシ → 設定。
- interim 表示は `--color-interim` の淡色＋斜体などで「未確定」であることを視覚的に示す（要件 §13.4 の性質に対応）。
- レイテンシ数値は `--font-mono` で桁を揃えて表示する。
- ボタンの非活性状態（`disabled`）は明確に区別できる見た目にする（[frontend-design.md](./frontend-design.md#各コンポーネントの責務) の活性制御に対応）。

---

## レスポンシブ

- 基本は1カラムのため大きな分岐は不要。
- 狭い画面（〜480px）でボタン群が折り返しても崩れないよう、`flex-wrap` とギャップで対応する。
- メディアクエリは必要最小限（1〜2ブレークポイント）に留める。

---

## テスト方針（概要）

テスト必須ルールに従う。詳細はテストエージェントが設計する。

- レイアウト崩れ検出: スナップショットテスト＋目視確認用スクリーンショット（Playwright）。
- interim/final/エラーの状態差が視覚的に区別されることを確認する。
- 装飾が最小のため、過度なビジュアルリグレッションは設定しない。
