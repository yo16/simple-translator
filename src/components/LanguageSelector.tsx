import type { AppStatus, SupportedLanguage } from "../lib/types";
import styles from "./LanguageSelector.module.css";

// ============================================================
// Props 型定義
// ============================================================

export interface LanguageSelectorProps {
  /** 入力言語 */
  sourceLanguage: SupportedLanguage;
  /** 出力言語 */
  targetLanguage: SupportedLanguage;
  /** アプリ状態（接続中・録音中は変更不可） */
  status: AppStatus;
  /** 言語ペア入れ替えハンドラ */
  onToggle: () => void;
}

// ============================================================
// ヘルパー
// ============================================================

function languageLabel(lang: SupportedLanguage): string {
  return lang === "ja-JP" ? "日本語" : "英語";
}

// ============================================================
// コンポーネント実装
// ============================================================

/**
 * LanguageSelector: 入出力言語ペアの表示と入れ替えボタン。
 *
 * MVPでは ja-JP / en-US の2値のみ対応。
 * 接続中（connecting / connected / recording）は変更不可。
 */
export function LanguageSelector({
  sourceLanguage,
  targetLanguage,
  status,
  onToggle,
}: LanguageSelectorProps) {
  const isDisabled =
    status === "connecting" || status === "connected" || status === "recording";

  return (
    <div className={styles.languageSelector}>
      <span className={styles.language}>{languageLabel(sourceLanguage)}</span>
      <button
        type="button"
        onClick={onToggle}
        disabled={isDisabled}
        className={styles.toggleBtn}
        aria-label="言語を入れ替える"
      >
        ⇄
      </button>
      <span className={styles.language}>{languageLabel(targetLanguage)}</span>
    </div>
  );
}
