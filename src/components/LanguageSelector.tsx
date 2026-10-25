import { SUPPORTED_LANGUAGES, languageLabel } from "../lib/languages";
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
  /** 入力言語変更ハンドラ */
  onSourceChange: (lang: SupportedLanguage) => void;
  /** 出力言語変更ハンドラ */
  onTargetChange: (lang: SupportedLanguage) => void;
  /** 入出力言語ペア入れ替えハンドラ */
  onSwap: () => void;
}

// ============================================================
// コンポーネント実装
// ============================================================

/**
 * LanguageSelector: 入出力言語の選択ドロップダウンと入れ替えボタン。
 *
 * SUPPORTED_LANGUAGES（5言語）を選択肢として表示する。
 * source === target を防ぐため、各 select で相手側の言語を disabled にする。
 * 接続中（connecting / connected / recording）は変更不可。
 */
export function LanguageSelector({
  sourceLanguage,
  targetLanguage,
  status,
  onSourceChange,
  onTargetChange,
  onSwap,
}: LanguageSelectorProps) {
  const isDisabled =
    status === "connecting" || status === "connected" || status === "recording";

  const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onSourceChange(e.target.value as SupportedLanguage);
  };

  const handleTargetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onTargetChange(e.target.value as SupportedLanguage);
  };

  return (
    <div className={styles.languageSelector}>
      {/* 入力言語 select: 出力言語と同じ選択肢を disabled にして source===target を防ぐ */}
      <select
        className={styles.languageSelect}
        value={sourceLanguage}
        onChange={handleSourceChange}
        disabled={isDisabled}
        aria-label="入力言語"
      >
        {SUPPORTED_LANGUAGES.map((code) => (
          <option key={code} value={code} disabled={code === targetLanguage}>
            {languageLabel(code)}
          </option>
        ))}
      </select>

      {/* 入れ替えボタン */}
      <button
        type="button"
        onClick={onSwap}
        disabled={isDisabled}
        className={styles.swapBtn}
        aria-label="入力言語と出力言語を入れ替える"
      >
        ⇄
      </button>

      {/* 出力言語 select: 入力言語と同じ選択肢を disabled にして source===target を防ぐ */}
      <select
        className={styles.languageSelect}
        value={targetLanguage}
        onChange={handleTargetChange}
        disabled={isDisabled}
        aria-label="出力言語"
      >
        {SUPPORTED_LANGUAGES.map((code) => (
          <option key={code} value={code} disabled={code === sourceLanguage}>
            {languageLabel(code)}
          </option>
        ))}
      </select>
    </div>
  );
}
