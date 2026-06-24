/**
 * WebSocket クライアントライブラリ
 *
 * ブラウザのネイティブ WebSocket API を使い、ローカル Node.js WebSocket サーバー
 * (ws://localhost:3001/ws) への接続・送受信を担う。
 *
 * SSR 時に評価されても安全にするため、WebSocket インスタンスの生成は
 * connect() 呼び出し時にのみ行う（モジュールトップレベルでは new しない）。
 */

import type {
  Settings,
  TranscriptInterimMessage,
  TranscriptFinalMessage,
  UtteranceCommittedMessage,
  TranslationMessage,
  AudioServerMessage,
  MetricsMessage,
  ErrorMessage,
} from "./types";

// ============================================================
// コールバック型
// ============================================================

export interface WebSocketCallbacks {
  onTranscriptInterim?: (msg: TranscriptInterimMessage) => void;
  onTranscriptFinal?: (msg: TranscriptFinalMessage) => void;
  onUtteranceCommitted?: (msg: UtteranceCommittedMessage) => void;
  onTranslation?: (msg: TranslationMessage) => void;
  onAudio?: (msg: AudioServerMessage) => void;
  onMetrics?: (msg: MetricsMessage) => void;
  onError?: (msg: ErrorMessage) => void;
  onDisconnect?: () => void;
  onConnected?: () => void;
}

// ============================================================
// 再接続設定
// ============================================================

/** 自動再接続を試みる最大回数 */
const MAX_RECONNECT_ATTEMPTS = 3;
/** 再接続間隔（ms）。試行ごとに 2 倍に増加（指数バックオフ） */
const RECONNECT_BASE_DELAY_MS = 1000;

// ============================================================
// WebSocketClient クラス
// ============================================================

export class WebSocketClient {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private callbacks: WebSocketCallbacks = {};

  /** 自動再接続を有効にするか */
  private autoReconnect: boolean;
  /** 現在の再接続試行回数 */
  private reconnectAttempts = 0;
  /** 明示的に disconnect() が呼ばれたか（自動再接続を止めるフラグ） */
  private intentionalClose = false;
  /** 再接続タイマー ID */
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param url        接続先 WebSocket URL。省略時は NEXT_PUBLIC_WS_URL 環境変数 → 既定値を使用
   * @param callbacks  受信コールバック群（あとから setCallbacks() でも変更可能）
   * @param autoReconnect 自動再接続を有効にするか（既定 false。MVP では最小限）
   */
  constructor(
    url?: string,
    callbacks: WebSocketCallbacks = {},
    autoReconnect = false,
  ) {
    this.url =
      url ??
      (typeof process !== "undefined"
        ? process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws"
        : "ws://localhost:3001/ws");
    this.callbacks = callbacks;
    this.autoReconnect = autoReconnect;
  }

  // ----------------------------------------------------------
  // コールバック登録 / 差し替え
  // ----------------------------------------------------------

  /** コールバックを一括で登録する。既存のコールバックは上書きされる */
  setCallbacks(callbacks: WebSocketCallbacks): void {
    this.callbacks = callbacks;
  }

  /** コールバックを個別に追加・差し替えする */
  updateCallbacks(callbacks: Partial<WebSocketCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // ----------------------------------------------------------
  // 接続管理
  // ----------------------------------------------------------

  /**
   * WebSocket 接続を開始する。
   * すでに接続中の場合は何もしない。
   */
  connect(): void {
    if (
      this.ws !== null &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.intentionalClose = false;
    this._openConnection();
  }

  /**
   * WebSocket 接続を明示的に切断する。
   * 自動再接続を無効化してから close する。
   */
  disconnect(): void {
    this.intentionalClose = true;
    this._clearReconnectTimer();

    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** 現在の接続状態を返す */
  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  // ----------------------------------------------------------
  // 送信メソッド
  // ----------------------------------------------------------

  /**
   * start メッセージを送信する（セッション開始）。
   * Settings の全フィールドを start メッセージ仕様に従って送る。
   */
  sendStart(config: Settings): void {
    this._send({
      type: "start",
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      enableTts: config.enableTts,
      enableInterimTranslation: config.enableInterimTranslation,
      chunkMs: config.chunkMs,
      silenceMs: config.silenceMs,
      maxChars: config.maxChars,
      maxSeconds: config.maxSeconds,
    });
  }

  /**
   * audio メッセージを送信する（音声チャンク）。
   * 接続中（readyState === OPEN）でない場合はサイレントに無視する（例外も onError も呼ばない）。
   * sendAudio は録音中に高頻度で呼ばれるため、この仕様とする。
   */
  sendAudio(base64: string): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      // サイレント無視
      return;
    }
    // _send を介さず直接送信してオーバーヘッドを最小化する
    this.ws.send(JSON.stringify({ type: "audio", data: base64 }));
  }

  /**
   * commit メッセージを送信する（手動発話区切り）。
   */
  sendCommit(): void {
    this._send({ type: "commit" });
  }

  /**
   * stop メッセージを送信する（セッション停止）。
   */
  sendStop(): void {
    this._send({ type: "stop" });
  }

  // ----------------------------------------------------------
  // 内部実装
  // ----------------------------------------------------------

  /** WebSocket を生成してイベントハンドラを設定する */
  private _openConnection(): void {
    // ブラウザ API を直接使用する（SSR 時の安全のため connect() 内でのみ呼ぶ）
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.callbacks.onConnected?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      this._handleMessage(event.data);
    };

    ws.onclose = () => {
      this.ws = null;
      this.callbacks.onDisconnect?.();

      if (!this.intentionalClose && this.autoReconnect) {
        this._scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // WebSocket の onerror は MessageEvent ではなく Event を受け取る。
      // 詳細なエラー情報はブラウザ API では取得できないため、汎用メッセージを onError へ渡す。
      this.callbacks.onError?.({
        type: "error",
        message: "WebSocket connection error",
        fatal: false,
      });
    };
  }

  /** 受信メッセージを JSON パースし、type でコールバックへ振り分ける */
  private _handleMessage(data: unknown): void {
    let parsed: Record<string, unknown>;

    // JSON パースエラーは握り潰さず onError へ転送する
    try {
      parsed = JSON.parse(String(data)) as Record<string, unknown>;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.callbacks.onError?.({
        type: "error",
        message: `JSON parse error: ${detail}`,
        fatal: false,
      });
      return;
    }

    const msgType = parsed.type;

    switch (msgType) {
      case "transcript_interim":
        this.callbacks.onTranscriptInterim?.({
          type: "transcript_interim",
          text: String(parsed.text ?? ""),
        });
        break;

      case "transcript_final":
        this.callbacks.onTranscriptFinal?.({
          type: "transcript_final",
          text: String(parsed.text ?? ""),
        });
        break;

      case "utterance_committed":
        this.callbacks.onUtteranceCommitted?.({
          type: "utterance_committed",
          text: String(parsed.text ?? ""),
          reason: (parsed.reason as UtteranceCommittedMessage["reason"]) ?? "stop",
        });
        break;

      case "translation":
        this.callbacks.onTranslation?.({
          type: "translation",
          sourceText: String(parsed.sourceText ?? ""),
          translatedText: String(parsed.translatedText ?? ""),
        });
        break;

      case "audio":
        this.callbacks.onAudio?.({
          type: "audio",
          mimeType: "audio/mpeg",
          data: String(parsed.data ?? ""),
        });
        break;

      case "metrics":
        this.callbacks.onMetrics?.({
          type: "metrics",
          speechMs: Number(parsed.speechMs ?? 0),
          translationMs: Number(parsed.translationMs ?? 0),
          ttsMs: Number(parsed.ttsMs ?? 0),
          totalMs: Number(parsed.totalMs ?? 0),
        });
        break;

      case "error":
        this.callbacks.onError?.({
          type: "error",
          message: String(parsed.message ?? "Unknown error"),
          fatal: Boolean(parsed.fatal),
        });
        break;

      default:
        // 未知の type は安全に無視する（onError は呼ばない）
        break;
    }
  }

  /**
   * JSON シリアライズして送信する。
   * 接続中でない場合は onError を呼ぶ（sendAudio 以外の送信失敗は通知する）。
   */
  private _send(message: Record<string, unknown>): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onError?.({
        type: "error",
        message: `Cannot send message (type="${String(message.type)}"): WebSocket is not open`,
        fatal: false,
      });
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /** 指数バックオフで再接続をスケジュールする */
  private _scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      // 上限に達したら自動再接続をあきらめる
      this.callbacks.onError?.({
        type: "error",
        message: `WebSocket reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`,
        fatal: true,
      });
      return;
    }

    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts += 1;

    this.reconnectTimerId = setTimeout(() => {
      this.reconnectTimerId = null;
      if (!this.intentionalClose) {
        this._openConnection();
      }
    }, delay);
  }

  /** スケジュール済みの再接続タイマーをキャンセルする */
  private _clearReconnectTimer(): void {
    if (this.reconnectTimerId !== null) {
      clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }
  }
}

// ============================================================
// ファクトリ関数（useWebSocket フックから利用しやすい形）
// ============================================================

/**
 * WebSocketClient インスタンスを生成して返す。
 *
 * @param callbacks     受信コールバック群
 * @param url           接続先 URL（省略時は環境変数 or 既定値）
 * @param autoReconnect 自動再接続を有効にするか（既定 false）
 */
export function createWebSocketClient(
  callbacks: WebSocketCallbacks = {},
  url?: string,
  autoReconnect = false,
): WebSocketClient {
  return new WebSocketClient(url, callbacks, autoReconnect);
}
