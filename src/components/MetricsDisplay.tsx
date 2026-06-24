import type { Metrics } from "../lib/types";
import styles from "./MetricsDisplay.module.css";

// ============================================================
// Props 型定義
// ============================================================

export interface MetricsDisplayProps {
  /** レイテンシ情報（null の場合は非表示） */
  metrics: Metrics | null;
}

// ============================================================
// コンポーネント実装
// ============================================================

/**
 * MetricsDisplay: speechMs / translationMs / ttsMs / totalMs を ms 単位で表示。
 *
 * metrics が null の場合は何も描画しない。
 */
export function MetricsDisplay({ metrics }: MetricsDisplayProps) {
  if (!metrics) {
    return null;
  }

  const { clientPlaybackWaitMs } = metrics;
  const hasClientWait = clientPlaybackWaitMs !== undefined;

  return (
    <div className={styles.metricsDisplay} aria-label="レイテンシ情報">
      <strong className={styles.heading}>レイテンシ: </strong>
      <span className={styles.item}>音声認識 {metrics.speechMs}ms</span>
      <span className={styles.separator} aria-hidden="true">{" | "}</span>
      <span className={styles.item}>翻訳 {metrics.translationMs}ms</span>
      <span className={styles.separator} aria-hidden="true">{" | "}</span>
      <span className={styles.item}>音声合成 {metrics.ttsMs}ms</span>
      <span className={styles.separator} aria-hidden="true">{" | "}</span>
      <span className={styles.item}>合計 {metrics.totalMs}ms</span>
      {hasClientWait && (
        <>
          <span className={styles.separator} aria-hidden="true">{" | "}</span>
          <span className={styles.item}>
            再生までのクライアント待ち {Math.round(clientPlaybackWaitMs)}ms
          </span>
          <span className={styles.separator} aria-hidden="true">{" | "}</span>
          <span className={styles.item}>
            合計待ち時間（再生まで） {Math.round(metrics.totalMs + clientPlaybackWaitMs)}ms
          </span>
        </>
      )}
    </div>
  );
}
