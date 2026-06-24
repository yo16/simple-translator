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
import { UtteranceBufferManager } from "./utteranceBuffer";
import { createSpeechStream } from "./speechStream";
import { translate } from "./translate";
import { synthesize, isTtsEnabled } from "./textToSpeech";

// ============================================================
// Session クラス
// ============================================================

/**
 * 1接続 = 1 Session。
 * WebSocket 接続ごとに生成し、close 時に dispose() を呼ぶ。
 *
 * 後続タスク（.4 STT / .8 Translation/TTS 統合）との接続点:
 *   - onAudioChunk(data: Buffer): STT ストリームへの書き込み（.4 で実装）
 *   - 確定後の Translation / TTS パイプライン（.8 で実装）
 *
 * 発話バッファ・区切り判定は UtteranceBufferManager へ委譲する。
 */
export class Session {
  private readonly ws: WebSocket;
  private state: SessionState;

  /** 発話バッファ・区切り判定マネージャー（start で再生成） */
  private utteranceBuffer: UtteranceBufferManager | null = null;

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
      this.cleanupUtteranceBuffer();
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
      maxSeconds: msg.maxSeconds, // 秒単位のまま保持（UtteranceBufferConfig へ渡す際にms変換）
    };

    this.state = {
      initialized: true,
      config,
      speech: null, // STT ストリームは .4 で設定する
      buffer: Session.createEmptyBuffer(),
      timing: Session.createEmptyTiming(),
    };

    // UtteranceBufferManager を生成（確定コールバックで utterance_committed を送信）
    this.utteranceBuffer = new UtteranceBufferManager(
      {
        silenceMs: config.silenceMs,
        maxChars: config.maxChars,
        maxSeconds: config.maxSeconds * 1000, // 秒→ミリ秒変換（SessionConfig は秒単位）
      },
      (text, reason) => {
        this.onUtteranceCommitted(text, reason);
      }
    );

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

    // 無音タイマーリセット（audio 受信通知）
    if (this.utteranceBuffer !== null) {
      this.utteranceBuffer.notifyAudio();
    }

    // STT ストリームへの書き込み接続点（.4 で実装）
    this.onAudioChunk(base64Data);
  }

  private handleCommit(): void {
    if (!this.state.initialized || !this.state.config) {
      this.sendError("Session not initialized. Send 'start' message first.", false);
      return;
    }

    if (this.utteranceBuffer === null) {
      return;
    }

    // 空バッファの場合は commitManual() 内で無視される（コールバックを呼ばない）
    this.utteranceBuffer.commitManual();
  }

  private handleStop(): void {
    if (!this.state.initialized || !this.state.config) {
      this.sendError("Session not initialized. Send 'start' message first.", false);
      return;
    }

    if (this.utteranceBuffer !== null) {
      // 空バッファの場合は commitStop() 内で無視される（コールバックを呼ばない）
      this.utteranceBuffer.commitStop();
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
   * 音声チャンクを受信したときの処理。
   * STT ストリームが未生成なら生成し、base64 → Buffer 変換後に write する。
   *
   * - ストリームはセッション中切り直さない（WebM/Opus コンテナヘッダは最初のチャンクのみ）。
   * - interim コールバック → transcript_interim 送信（表示のみ）
   * - final コールバック → transcript_final 送信 + addFinalToBuffer（発話バッファ蓄積）
   * - error コールバック → sendError(message, false)（接続維持）
   * - 無音タイマーリセットは handleAudio が notifyAudio() で既に行うため、ここでは行わない。
   */
  protected onAudioChunk(base64Data: string): void {
    if (!this.state.initialized || !this.state.config) {
      // handleAudio が既にガードしているが念のため
      return;
    }

    // STT ストリームが未生成の場合のみ生成する（セッション中切り直さない）
    if (this.state.speech === null) {
      const sourceLanguage = this.state.config.sourceLanguage;

      const speechHandle = createSpeechStream({
        languageCode: sourceLanguage, // フルコード（"ja-JP" / "en-US"）のまま渡す
        onInterim: (text: string) => {
          // 表示専用: transcript_interim を送信（翻訳・TTS は行わない）
          this.send({ type: "transcript_interim", text });
        },
        onFinal: (text: string) => {
          // transcript_final を送信し、発話バッファへ蓄積する
          this.send({ type: "transcript_final", text });
          this.addFinalToBuffer(text);
        },
        onError: (message: string, fatal: boolean) => {
          // fatal:false の場合は接続を維持してクライアントに通知する
          this.sendError(message, fatal);
        },
      });

      this.state.speech = speechHandle;
      console.log(`[Session] STT stream created for language: ${sourceLanguage}`);
    }

    // base64 → Buffer 変換後に STT ストリームへ書き込む
    try {
      const buffer = Buffer.from(base64Data, "base64");
      this.state.speech.write(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Session] Error writing audio chunk to STT stream:", message);
      this.sendError("Failed to process audio chunk.", false);
    }
  }

  /**
   * 発話バッファが確定されたときに UtteranceBufferManager のコールバックから呼ばれる。
   * utterance_committed を送信し、Translation → TTS → metrics の非同期パイプラインを起動する。
   *
   * このメソッドは同期的に呼ばれる（UtteranceBufferManager のコールバック）ため、
   * 非同期処理は runPostCommitPipeline に委譲し、未処理 Promise rejection を残さないよう
   * .catch() で全例外を捕捉して sendError(_, false) に変換する。
   */
  protected onUtteranceCommitted(text: string, reason: UtteranceCommitReason): void {
    if (text.length === 0) {
      return;
    }

    this.state.timing.committedAt = process.hrtime.bigint();

    // utterance_committed を送信（送信順序: utterance_committed → translation → audio → metrics）
    this.send({ type: "utterance_committed", text, reason });

    console.log(`[Session] Utterance committed: "${text}" (reason: ${reason})`);

    // Translation → TTS → metrics の非同期パイプラインを起動する。
    // 未処理 Promise rejection を残さないよう .catch() で例外を捕捉する。
    this.runPostCommitPipeline(text).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Session] Unexpected error in post-commit pipeline:", message);
      this.sendError("Internal server error during translation/synthesis.", false);
    });
  }

  /**
   * 発話確定後の Translation → TTS → metrics パイプライン。
   *
   * 送信順序: translation → (audio) → metrics
   *
   * タイミング計測:
   *   - speechMs: speechStartedAt〜committedAt（音声認識にかかった時間）
   *   - translationMs: translationStartedAt〜translationEndedAt
   *   - ttsMs: ttsStartedAt〜ttsEndedAt（TTS無効時は 0）
   *   - totalMs: speechStartedAt〜TTS完了（TTS無効時は翻訳完了まで）
   *
   * GCP 呼び出し失敗時は sendError(message, false) でセッションを継続する。
   */
  private async runPostCommitPipeline(text: string): Promise<void> {
    const config = this.state.config;
    if (!config) {
      return;
    }

    // ----------------------------------------------------------------
    // Translation
    // ----------------------------------------------------------------
    let translatedText: string;

    this.state.timing.translationStartedAt = process.hrtime.bigint();

    try {
      translatedText = await translate(text, config.sourceLanguage, config.targetLanguage);
      this.state.timing.translationEndedAt = process.hrtime.bigint();
    } catch (err) {
      this.state.timing.translationEndedAt = process.hrtime.bigint();
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Session] Translation failed:", message);
      this.sendError("Translation failed. Please try again.", false);
      // 翻訳失敗時は TTS・metrics も送信せずに終了する
      return;
    }

    // translation メッセージを送信
    this.send({
      type: "translation",
      sourceText: text,
      translatedText,
    });

    // ----------------------------------------------------------------
    // Text-to-Speech（TTS有効時のみ）
    // ----------------------------------------------------------------
    let ttsBase64: string | null = null;

    if (isTtsEnabled() && config.enableTts) {
      this.state.timing.ttsStartedAt = process.hrtime.bigint();

      try {
        ttsBase64 = await synthesize(translatedText, config.targetLanguage);
        this.state.timing.ttsEndedAt = process.hrtime.bigint();
      } catch (err) {
        this.state.timing.ttsEndedAt = process.hrtime.bigint();
        const message = err instanceof Error ? err.message : String(err);
        console.error("[Session] Text-to-Speech failed:", message);
        this.sendError("Text-to-Speech failed. Please try again.", false);
        // TTS 失敗時も metrics は送信する（ttsMs は計測済みの時刻から算出）
      }

      // synthesize が null を返した場合（空テキスト等）は audio メッセージを送らない
      if (ttsBase64 !== null) {
        this.send({
          type: "audio",
          mimeType: "audio/mpeg",
          data: ttsBase64,
        });
      }
    }

    // ----------------------------------------------------------------
    // metrics 送信
    // ----------------------------------------------------------------
    const timing = this.state.timing;

    // speechMs: 発話開始〜確定
    const speechMs =
      timing.speechStartedAt !== null && timing.committedAt !== null
        ? Number(timing.committedAt - timing.speechStartedAt) / 1e6
        : 0;

    // translationMs: Translation 呼び出し前〜結果受信
    const translationMs =
      timing.translationStartedAt !== null && timing.translationEndedAt !== null
        ? Number(timing.translationEndedAt - timing.translationStartedAt) / 1e6
        : 0;

    // ttsMs: TTS 呼び出し前〜結果受信（TTS無効時は 0）
    const ttsMs =
      timing.ttsStartedAt !== null && timing.ttsEndedAt !== null
        ? Number(timing.ttsEndedAt - timing.ttsStartedAt) / 1e6
        : 0;

    // totalMs: 発話開始〜TTS完了（TTS無効時は翻訳完了まで）
    const pipelineEnd = timing.ttsEndedAt ?? timing.translationEndedAt;
    const totalMs =
      timing.speechStartedAt !== null && pipelineEnd !== null
        ? Number(pipelineEnd - timing.speechStartedAt) / 1e6
        : 0;

    this.send({
      type: "metrics",
      speechMs,
      translationMs,
      ttsMs,
      totalMs,
    });

    // 次の発話に備えてタイミングをリセットする
    this.state.timing = Session.createEmptyTiming();
  }

  // ----------------------------------------------------------
  // 発話バッファ操作（session.ts の公開 API として維持）
  // ----------------------------------------------------------

  /**
   * STT final result をバッファへ追加する。
   * タスク .4 から呼ばれる想定。
   * 文字数上限チェック・無音タイマーリセット・最大発話タイマー起動は
   * UtteranceBufferManager が担う。
   */
  public addFinalToBuffer(text: string): void {
    if (!this.state.initialized || !this.state.config) {
      return;
    }

    if (this.utteranceBuffer === null) {
      return;
    }

    // UtteranceBufferManager へ委譲
    this.utteranceBuffer.addFinal(text);

    // state.buffer（互換性維持用）を同期する
    // UtteranceBufferManager が管理するため、state.buffer は参照用のスナップショット
    // 実際のタイマー管理は utteranceBuffer が担う
    this.syncBufferState();
  }

  /**
   * state.buffer（UtteranceBuffer 型・互換性維持用）を
   * UtteranceBufferManager の現在状態に同期する。
   *
   * 注意: state.buffer の silenceTimer / maxDurationTimer は
   * UtteranceBufferManager が管理するため null のままとなる。
   * テストや外部参照では getText() / isEmpty() を使うことを推奨する。
   */
  private syncBufferState(): void {
    if (this.utteranceBuffer === null) {
      this.state.buffer = Session.createEmptyBuffer();
    } else {
      // finals の現在値を反映（タイマー参照は null のまま）
      const text = this.utteranceBuffer.getText();
      this.state.buffer = {
        finals: text.length > 0 ? [text] : [],
        startedAt: this.state.buffer.startedAt,
        silenceTimer: null,
        maxDurationTimer: null,
      };
    }
  }

  // ----------------------------------------------------------
  // クリーンアップ
  // ----------------------------------------------------------

  /**
   * UtteranceBufferManager を破棄する。
   * start の再初期化・dispose の両方から呼ばれる。
   */
  private cleanupUtteranceBuffer(): void {
    if (this.utteranceBuffer !== null) {
      this.utteranceBuffer.destroy();
      this.utteranceBuffer = null;
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
    this.cleanupUtteranceBuffer();
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
