import type { TranscriptState } from "../lib/types";
import styles from "./TranscriptView.module.css";

// ============================================================
// Props 型定義
// ============================================================

export interface TranscriptViewProps {
  /** トランスクリプト状態 */
  transcript: TranscriptState;
}

// ============================================================
// コンポーネント実装
// ============================================================

/**
 * TranscriptView: interim / 確定発話 / 翻訳結果のリスト表示。
 *
 * - interim はイタリック体で「変化中」を視覚的に示す
 * - finals は確定済みテキストの履歴リスト
 * - translations はソーステキストと翻訳テキストのペアリスト
 *
 * aria-label は既存テスト（TranslatorApp.test.ts）に合わせた値を使用:
 *   - "認識中テキスト"
 *   - "認識確定テキスト"
 *   - "翻訳テキスト"
 */
export function TranscriptView({ transcript }: TranscriptViewProps) {
  const { interim, finals, translations } = transcript;

  return (
    <div className={styles.transcriptView}>
      {/* 認識途中テキスト */}
      <section
        className={styles.section}
        aria-label="認識中テキスト"
      >
        <h2 className={styles.sectionTitle}>認識中</h2>
        <p className={styles.interim}>
          {interim ? <em>{interim}</em> : "（待機中）"}
        </p>
      </section>

      {/* 認識確定テキスト履歴 */}
      <section
        className={styles.section}
        aria-label="認識確定テキスト"
      >
        <h2 className={styles.sectionTitle}>認識確定</h2>
        {finals.length === 0 ? (
          <p>（なし）</p>
        ) : (
          <ul className={styles.list}>
            {finals.map((text, i) => (
              <li key={i} className={styles.listItem}>
                {text}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 翻訳結果履歴 */}
      <section
        className={styles.section}
        aria-label="翻訳テキスト"
      >
        <h2 className={styles.sectionTitle}>翻訳</h2>
        {translations.length === 0 ? (
          <p>（なし）</p>
        ) : (
          <ul className={styles.list}>
            {translations.map((t, i) => (
              <li key={i} className={styles.listItem}>
                <span className={styles.source}>{t.sourceText}</span>
                <span className={styles.arrow} aria-hidden="true"> → </span>
                <span className={styles.translated}>{t.translatedText}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
