import { WebSocket } from "ws";
import {
  SessionState,
  SessionConfig,
  ServerMessage,
  UtteranceCommitReason,
  TimingMarks,
  UtteranceBuffer,
} from "./types";
import { ClientMessage, StartMessage } from "./schema";

// ============================================================
// Session クラス
// ============================================================

/**
 * 1接続 = 1 Session。
 * WebSocket 接続ごとに生成し、close 時に dispose() を呼ぶ。
 *
 * 後続タスク（.4 STT / .5 発話バッファ / .8 統合）との接続点:
 *   - onAudioChunk(data: Buffer): STT ストリームへの書き込み（.4 で実装）
 *   - commitUtterance(reason): 発話バッファ確定・Translation・TTS パイプライン（.5/.8 で実装）
 */
export class Session {
  private readonly ws: WebSocket;
  private state: SessionState;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.state = {
      initialized: false,
      config: null,
      speech: null,
      buffer: Session.createEmptyBuffer(),
      timing: Session.createEmptyTiming(),
    };
  }

  // ----------------------------------------------------------
  // 公開ハンドラ：index.ts からディスパッチされる
  // ----------------------------------------------------------

  /** 受信済みの検証済みメッセージをディスパッチする */
  handleMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case "start":
        this.handleStart(msg);
        break;
      case "audio":
        this.handleAudio(msg.data);
        break;
      case "commit":
        this.handleCommit();
        break;
      case "stop":
        this.handleStop();
        break;
    }
  }

  // ----------------------------------------------------------
  // 各メッセージハンドラ（プライベート）
  // ----------------------------------------------------------

  private handleStart(msg: StartMessage): void {
    if (this.state.initialized) {
      // 既に初期化済みの場合：セッションをリセットして再初期化する。
      // 再 start は設定変更（言語切り替えなど）のユースケースを想定し、
      // エラーとせずクリーンアップ後に受け入れる。
      this.cleanupBuffer();
      this.cleanupSpeech();
      console.log("[Session] Re-initializing session with new config");
    }

    const config: SessionConfig = {
      sourceLanguage: msg.sourceLanguage,
      targetLanguage: msg.targetLanguage,
      enableTts: msg.enableTts,
      enableInterimTranslation: msg.enableInterimTranslation,
      chunkMs: msg.chunkMs,
      silenceMs: msg.silenceMs,
      maxChars: msg.maxChars,
      maxSeconds: msg.maxSeconds,
    };

    this.state = {
      initialized: true,
      config,
      speech: null, // STT ストリームは .4 で設定する
      buffer: Session.createEmptyBuffer(),
      timing: Session.createEmptyTiming(),
    };

    console.log("[Session] Session initialized:", config);
  }

  private handleAudio(base64Data: string): void {
    if (!this.state.initialized || !this.state.config) {
      this.sendError("Session not initialized. Send 'start' message first.", false);
      return;
    }

    // レイテンシ計測: 最初の audio 受信で speechStartedAt を記録
    if (this.state.timing.speechStartedAt === null) {
      this.state.timing.speechStartedAt = process.hrtime.bigint();
    }

    // STT ストリームへの書き込み接続点（.4 で実装）
    this.onAudioChunk(base64Data);
  }

  private handleCommit(): void {
    if (!this.state.initialized || !this.state.config) {
      this.sendError("Session not initialized. Send 'start' message first.", false);
      return;
    }

    // バッファが空なら無視（設計: §websocket-protocol.md commit 仕様）
    const bufferText = this.state.buffer.finals.join("");
    if (bufferText.length === 0) {
      console.log("[Session] Commit received but buffer is empty, ignoring.");
      return;
    }

    // 発話バッファ確定の接続点（.5/.8 で実装）
    this.commitUtterance("commit");
  }

  private handleStop(): void {
    if (!this.state.initialized || !this.state.config) {
      this.sendError("Session not initialized. Send 'start' message first.", false);
      return;
    }

    // 残バッファがあれば確定（.5/.8 で実装）
    const bufferText = this.state.buffer.finals.join("");
    if (bufferText.length > 0) {
      this.commitUtterance("stop");
    }

    // STT ストリーム終了（.4 で実装）
    if (this.state.speech) {
      try {
        this.state.speech.end();
      } catch (err) {
        console.error("[Session] Error ending speech stream:", err);
      }
      this.state.speech = null;
    }

    console.log("[Session] Recording stopped.");
  }

  // ----------------------------------------------------------
  // 後続タスクとの接続点
  // ----------------------------------------------------------

  /**
   * 音声チャンクを受信したときの処理接続点。
   * タスク .4（STT 連携）でこのメソッドを実装する。
   * 現時点では受信ログのみ出力する。
   */
  protected onAudioChunk(base64Data: string): void {
    // .4 で: Buffer.from(base64Data, "base64") → STT ストリームへ write
    console.log(`[Session] Audio chunk received (${base64Data.length} base64 chars)`);
  }

  /**
   * 発話バッファ確定処理の接続点。
   * タスク .5（utteranceBuffer）・.8（Translation/TTS 統合）で実装する。
   * 現時点ではバッファテキストを収集して utterance_committed を送信し、バッファをクリアする。
   */
  protected commitUtterance(reason: UtteranceCommitReason): void {
    const text = this.state.buffer.finals.join("");
    if (text.length === 0) {
      return;
    }

    this.state.timing.committedAt = process.hrtime.bigint();

    // utterance_committed を送信
    this.send({ type: "utterance_committed", text, reason });

    // バッファとタイマーをクリア
    this.cleanupBuffer();

    // .5/.8 で: Translation → TTS → metrics の順に送信する
    console.log(`[Session] Utterance committed: "${text}" (reason: ${reason})`);
  }

  // ----------------------------------------------------------
  // 発話バッファ操作（.5 の utteranceBuffer.ts が置き換える想定）
  // ----------------------------------------------------------

  /**
   * STT final result をバッファへ追加する。
   * タスク .4 から呼ばれる想定。
   * 文字数上限チェック・無音タイマーリセット・最大発話タイマー起動は .5 で実装。
   */
  public addFinalToBuffer(text: string): void {
    if (!this.state.initialized || !this.state.config) {
      return;
    }

    const wasEmpty = this.state.buffer.finals.length === 0;
    this.state.buffer.finals.push(text);

    // 最大発話タイマー: バッファが空→非空になった時点で開始（.5 で本実装）
    if (wasEmpty) {
      const maxMs = this.state.config.maxSeconds * 1000;
      this.state.buffer.maxDurationTimer = setTimeout(() => {
        this.commitUtterance("maxSeconds");
      }, maxMs);
    }

    // 文字数上限チェック（.5 で本実装）
    const totalChars = this.state.buffer.finals.join("").length;
    if (totalChars >= this.state.config.maxChars) {
      this.commitUtterance("maxChars");
      return;
    }

    // 無音タイマーのリセット（.5 で本実装）
    this.resetSilenceTimer();
  }

  /**
   * 無音タイマーをリセットする。
   * audio チャンク受信・final 追加のたびに呼ばれる。
   */
  private resetSilenceTimer(): void {
    if (!this.state.config) return;

    if (this.state.buffer.silenceTimer !== null) {
      clearTimeout(this.state.buffer.silenceTimer);
    }

    this.state.buffer.silenceTimer = setTimeout(() => {
      const bufferText = this.state.buffer.finals.join("");
      if (bufferText.length > 0) {
        this.commitUtterance("silence");
      }
    }, this.state.config.silenceMs);
  }

  // ----------------------------------------------------------
  // クリーンアップ
  // ----------------------------------------------------------

  private cleanupBuffer(): void {
    if (this.state.buffer.silenceTimer !== null) {
      clearTimeout(this.state.buffer.silenceTimer);
    }
    if (this.state.buffer.maxDurationTimer !== null) {
      clearTimeout(this.state.buffer.maxDurationTimer);
    }
    this.state.buffer = Session.createEmptyBuffer();
  }

  private cleanupSpeech(): void {
    if (this.state.speech) {
      try {
        this.state.speech.destroy();
      } catch (err) {
        console.error("[Session] Error destroying speech stream:", err);
      }
      this.state.speech = null;
    }
  }

  /**
   * 接続 close 時に呼ぶ。タイマーとSTTストリームを解放する。
   */
  public dispose(): void {
    this.cleanupBuffer();
    this.cleanupSpeech();
    console.log("[Session] Session disposed.");
  }

  // ----------------------------------------------------------
  // 送信ヘルパー
  // ----------------------------------------------------------

  /** サーバー→クライアントのメッセージを送信する */
  public send(msg: ServerMessage): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[Session] Attempted to send message but WebSocket is not open.");
      return;
    }
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error("[Session] Failed to send message:", err);
    }
  }

  /**
   * エラーをクライアントへ返す。
   * fatal=true の場合は送信後に接続を閉じる。
   * error.message に内部スタックトレースを含めない。
   */
  public sendError(message: string, fatal: boolean): void {
    this.send({ type: "error", message, fatal });
    if (fatal) {
      try {
        this.ws.close(1011, message);
      } catch (err) {
        console.error("[Session] Error closing WebSocket after fatal error:", err);
      }
    }
  }

  // ----------------------------------------------------------
  // 状態アクセサ（テスト・後続タスク用）
  // ----------------------------------------------------------

  public get isInitialized(): boolean {
    return this.state.initialized;
  }

  public get config(): SessionConfig | null {
    return this.state.config;
  }

  public get buffer(): UtteranceBuffer {
    return this.state.buffer;
  }

  public get timing(): TimingMarks {
    return this.state.timing;
  }

  /** STT ストリームを設定する（タスク .4 から呼ばれる） */
  public set speechStream(handle: import("./types").SpeechStreamHandle | null) {
    this.state.speech = handle;
  }

  public get speechStream(): import("./types").SpeechStreamHandle | null {
    return this.state.speech;
  }

  // ----------------------------------------------------------
  // 静的ファクトリ
  // ----------------------------------------------------------

  private static createEmptyBuffer(): UtteranceBuffer {
    return {
      finals: [],
      startedAt: null,
      silenceTimer: null,
      maxDurationTimer: null,
    };
  }

  private static createEmptyTiming(): TimingMarks {
    return {
      speechStartedAt: null,
      committedAt: null,
      translationStartedAt: null,
      translationEndedAt: null,
      ttsStartedAt: null,
      ttsEndedAt: null,
    };
  }
}
