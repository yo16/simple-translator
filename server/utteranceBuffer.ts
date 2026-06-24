import { UtteranceCommitReason } from "./types";

// ============================================================
// 発話バッファ設定
// ============================================================

export interface UtteranceBufferConfig {
  /** 無音タイマー: 最後に final/audio を受けてからのミリ秒数。超過で確定 */
  silenceMs: number;
  /** 文字数上限: バッファのテキスト長がこれを超えたら即座に確定 */
  maxChars: number;
  /** 最大発話タイマー: バッファが非空になってからのミリ秒数。超過で確定 */
  maxSeconds: number;
}

// ============================================================
// 確定コールバック型
// ============================================================

export type UtteranceCommitCallback = (
  text: string,
  reason: UtteranceCommitReason
) => void;

// ============================================================
// UtteranceBufferManager クラス（純粋ロジック、I/O なし）
// ============================================================

/**
 * 発話バッファと発話区切り判定を担う純粋ロジッククラス。
 *
 * - STT final result を蓄積する
 * - 無音タイマー / 最大発話タイマー / 文字数チェック / commit / stop で確定を判定する
 * - 確定時にコールバックを呼ぶ。I/O・WebSocket 送信は行わない
 * - interim result はバッファに入れない（タイマー・文字数判定に使わない）
 */
export class UtteranceBufferManager {
  private readonly config: UtteranceBufferConfig;
  private readonly onCommit: UtteranceCommitCallback;

  private finals: string[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private maxDurationTimer: NodeJS.Timeout | null = null;

  constructor(config: UtteranceBufferConfig, onCommit: UtteranceCommitCallback) {
    this.config = config;
    this.onCommit = onCommit;
  }

  // ----------------------------------------------------------
  // 公開メソッド
  // ----------------------------------------------------------

  /**
   * STT final result をバッファへ追加する。
   *
   * - バッファが空→非空になった時点で最大発話タイマーを開始する
   * - final 追加後に文字数チェックを行い、超過で即座に確定する
   * - 文字数未超過の場合は無音タイマーをリセットする
   */
  addFinal(text: string): void {
    const wasEmpty = this.finals.length === 0;
    this.finals.push(text);

    // バッファが空→非空になった時点で最大発話タイマーを開始
    if (wasEmpty) {
      this.startMaxDurationTimer();
    }

    // 文字数上限チェック（同期的）
    const totalChars = this.finals.join("").length;
    if (totalChars >= this.config.maxChars) {
      this.commit("maxChars");
      return;
    }

    // 無音タイマーリセット
    this.resetSilenceTimer();
  }

  /**
   * 音声受信通知。audio チャンク受信のたびに呼ぶことで無音タイマーをリセットする。
   *
   * バッファが空の場合（まだ final がない状態）は無音タイマーを操作しない。
   * 理由: バッファが空のまま無音タイマーを起動すると、空バッファへの
   * silence 確定を誤発火する可能性があるため。
   */
  notifyAudio(): void {
    if (this.finals.length > 0) {
      this.resetSilenceTimer();
    }
  }

  /**
   * 手動 commit。バッファが非空なら即時確定する。
   * バッファが空の場合はコールバックを呼ばない。
   */
  commitManual(): void {
    this.commit("commit");
  }

  /**
   * stop による確定。バッファが非空なら即時確定する。
   * バッファが空の場合はコールバックを呼ばない。
   */
  commitStop(): void {
    this.commit("stop");
  }

  /**
   * バッファが空かどうかを返す。
   */
  isEmpty(): boolean {
    return this.finals.length === 0;
  }

  /**
   * バッファの現在のテキストを返す（確定はしない）。
   */
  getText(): string {
    return this.finals.join("");
  }

  /**
   * タイマーをすべてクリアしてリソースを解放する。
   * 接続 close 時や Session.dispose() から呼ぶこと。
   * destroy() 後にこのインスタンスを使ってはならない。
   */
  destroy(): void {
    this.clearSilenceTimer();
    this.clearMaxDurationTimer();
  }

  // ----------------------------------------------------------
  // プライベート: 確定ロジック
  // ----------------------------------------------------------

  /**
   * バッファを確定する共通処理。
   * 空バッファに対してはコールバックを呼ばない。
   */
  private commit(reason: UtteranceCommitReason): void {
    const text = this.finals.join("");
    if (text.length === 0) {
      // 空バッファは確定しない
      return;
    }

    // タイマーをクリア
    this.clearSilenceTimer();
    this.clearMaxDurationTimer();

    // バッファをクリア
    this.finals = [];

    // コールバックで通知（I/O はここでは行わない）
    this.onCommit(text, reason);
  }

  // ----------------------------------------------------------
  // プライベート: タイマー管理
  // ----------------------------------------------------------

  /**
   * 無音タイマーをリセット（クリアして再起動）する。
   * バッファが空の場合でも呼ばれる可能性があるが、
   * タイマー発火時に空チェックを行うため問題ない。
   */
  private resetSilenceTimer(): void {
    this.clearSilenceTimer();

    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      // 空バッファへの silence は commit() 内で弾く
      this.commit("silence");
    }, this.config.silenceMs);
  }

  /**
   * 最大発話タイマーを開始する。
   * バッファが空→非空になった時点で1度だけ呼ぶ。
   */
  private startMaxDurationTimer(): void {
    // 念のため既存タイマーをクリア
    this.clearMaxDurationTimer();

    this.maxDurationTimer = setTimeout(() => {
      this.maxDurationTimer = null;
      this.commit("maxSeconds");
    }, this.config.maxSeconds);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearMaxDurationTimer(): void {
    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }
}
