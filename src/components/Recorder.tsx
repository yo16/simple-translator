import type { AppStatus } from "../lib/types";
import styles from "./Recorder.module.css";

// ============================================================
// Props 型定義
// ============================================================

export interface RecorderProps {
  /** 現在のアプリ状態 */
  status: AppStatus;
  /** エラーメッセージ（あれば表示） */
  error: string | null;
  /** 開始ボタン押下ハンドラ */
  onStart: () => void;
  /** 停止ボタン押下ハンドラ */
  onStop: () => void;
  /** 手動区切りボタン押下ハンドラ */
  onCommit: () => void;
}

// ============================================================
// コンポーネント実装
// ============================================================

/**
 * Recorder: 録音操作ボタン群と状態表示のプレゼンテーションコンポーネント。
 *
 * 状態に応じたボタン活性/非活性:
 * - idle / error → 開始ボタンのみ有効
 * - connecting / connected → 接続中表示（disabled）
 * - recording → 停止・手動区切り有効
 */
export function Recorder({
  status,
  error,
  onStart,
  onStop,
  onCommit,
}: RecorderProps) {
  const isConnecting = status === "connecting" || status === "connected";
  const isRecording = status === "recording";

  return (
    <div className={styles.recorder}>
      {/* ステータス表示 */}
      <div className={styles.status}>
        <span>状態: {status}</span>
        {error && (
          <span className={styles.errorText}>{" | "}エラー: {error}</span>
        )}
      </div>

      {/* 録音中インジケーター */}
      {isRecording && (
        <div className={styles.recordingIndicator} aria-live="polite" aria-label="録音中">
          <span className={styles.recordingDot} aria-hidden="true" />
          <span>録音中</span>
        </div>
      )}

      {/* 操作ボタン群 */}
      <div className={styles.controls}>
        {isRecording ? (
          <button
            type="button"
            onClick={onStop}
            className={`${styles.btn} ${styles.btnStop}`}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={isConnecting}
            className={`${styles.btn} ${styles.btnStart}`}
          >
            {isConnecting ? "接続中..." : "開始"}
          </button>
        )}

        <button
          type="button"
          onClick={onCommit}
          disabled={!isRecording}
          className={styles.btn}
          aria-label="手動で発話を区切る"
        >
          手動区切り
        </button>
      </div>
    </div>
  );
}
