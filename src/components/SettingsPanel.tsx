import type { AppStatus, Settings } from "../lib/types";
import styles from "./SettingsPanel.module.css";

// ============================================================
// Props 型定義
// ============================================================

export interface SettingsPanelProps {
  /** 現在の設定値 */
  settings: Settings;
  /** アプリ状態（接続中・録音中は変更不可） */
  status: AppStatus;
  /** 設定値変更ハンドラ */
  onSettingsChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

// ============================================================
// コンポーネント実装
// ============================================================

/**
 * SettingsPanel: 発話区切り・TTS・interim翻訳設定の変更 UI。
 *
 * 設定変更は props の onSettingsChange 経由で親 state に反映される。
 * 実際のサーバーへの start メッセージ送信は TranslatorApp 側が担う。
 * 接続中（connecting / connected / recording）は入力を disabled にする。
 */
export function SettingsPanel({
  settings,
  status,
  onSettingsChange,
}: SettingsPanelProps) {
  const isDisabled =
    status === "connecting" || status === "connected" || status === "recording";

  return (
    <details className={styles.settingsPanel}>
      <summary className={styles.summary}>設定</summary>
      <div className={styles.body}>
        {/* TTS（音声再生） */}
        <label className={styles.row}>
          <span className={styles.label}>TTS（音声再生）</span>
          <input
            type="checkbox"
            checked={settings.enableTts}
            onChange={(e) => onSettingsChange("enableTts", e.target.checked)}
            disabled={isDisabled}
            className={styles.checkbox}
          />
        </label>

        {/* interim 仮翻訳 */}
        <label className={styles.row}>
          <span className={styles.label}>interim 翻訳</span>
          <input
            type="checkbox"
            checked={settings.enableInterimTranslation}
            onChange={(e) =>
              onSettingsChange("enableInterimTranslation", e.target.checked)
            }
            disabled={isDisabled}
            className={styles.checkbox}
          />
        </label>

        {/* チャンク間隔 */}
        <label className={styles.row}>
          <span className={styles.label}>チャンク間隔(ms)</span>
          <input
            type="number"
            value={settings.chunkMs}
            onChange={(e) =>
              onSettingsChange("chunkMs", Number(e.target.value))
            }
            disabled={isDisabled}
            min={50}
            max={5000}
            className={styles.numberInput}
          />
        </label>

        {/* 無音判定(ms) */}
        <label className={styles.row}>
          <span className={styles.label}>無音判定(ms)</span>
          <input
            type="number"
            value={settings.silenceMs}
            onChange={(e) =>
              onSettingsChange("silenceMs", Number(e.target.value))
            }
            disabled={isDisabled}
            min={100}
            max={10000}
            className={styles.numberInput}
          />
        </label>

        {/* 最大文字数 */}
        <label className={styles.row}>
          <span className={styles.label}>最大文字数</span>
          <input
            type="number"
            value={settings.maxChars}
            onChange={(e) =>
              onSettingsChange("maxChars", Number(e.target.value))
            }
            disabled={isDisabled}
            min={10}
            max={500}
            className={styles.numberInput}
          />
        </label>

        {/* 最大秒数 */}
        <label className={styles.row}>
          <span className={styles.label}>最大秒数</span>
          <input
            type="number"
            value={settings.maxSeconds}
            onChange={(e) =>
              onSettingsChange("maxSeconds", Number(e.target.value))
            }
            disabled={isDisabled}
            min={1}
            max={60}
            className={styles.numberInput}
          />
        </label>
      </div>
    </details>
  );
}
