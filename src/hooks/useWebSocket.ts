"use client";

/**
 * useWebSocket カスタムフック
 *
 * WebSocketClient を React ライフサイクルに統合するラッパー。
 *
 * 設計方針:
 * - WebSocketClient のインスタンスは useRef で保持する（再レンダリングで再生成しない）。
 * - 受信コールバックは useRef で最新の dispatch を参照することで stale closure を回避する。
 * - アンマウント時に disconnect() してリソースリークを防ぐ。
 * - SSR 安全: WebSocketClient の connect() は明示的に呼ぶまで WebSocket を生成しない。
 */

import { useCallback, useEffect, useRef } from "react";
import { createWebSocketClient, WebSocketClient } from "../lib/websocketClient";
import type { AppAction, Settings } from "../lib/types";
import { AppActions } from "../lib/appReducer";

// ============================================================
// 型定義
// ============================================================

/** useWebSocket の戻り値 */
export interface UseWebSocketReturn {
  /** WebSocket 接続を開始する */
  connect: () => void;
  /** WebSocket 接続を切断する */
  disconnect: () => void;
  /** 音声チャンク（base64）を送信する */
  sendAudio: (base64: string) => void;
  /** 手動発話区切りを送信する */
  sendCommit: () => void;
  /** セッション停止メッセージを送信する */
  sendStop: () => void;
  /** セッション開始メッセージを送信する */
  sendStart: (settings: Settings) => void;
}

// ============================================================
// フック実装
// ============================================================

/**
 * WebSocketClient を React ライフサイクルに対応させるラッパーフック。
 *
 * @param dispatch  useReducer の dispatch 関数
 * @param onConnected  接続確立時に呼ばれるコールバック
 * @returns WebSocket 操作メソッド群
 */
export function useWebSocket(
  dispatch: React.Dispatch<AppAction>,
  onConnected?: () => void,
): UseWebSocketReturn {
  /**
   * アンマウント済みフラグ。
   * アンマウント後に非同期コールバックが dispatch を呼ばないよう制御する。
   */
  const isUnmountedRef = useRef<boolean>(false);

  /**
   * WebSocketClient インスタンス。
   * useRef で保持して再レンダリングで再生成されないようにする。
   */
  const clientRef = useRef<WebSocketClient | null>(null);

  /**
   * 最新の dispatch を参照するための ref。
   * コールバック内で参照することで stale closure を避ける。
   */
  const dispatchRef = useRef<React.Dispatch<AppAction>>(dispatch);

  /**
   * 最新の onConnected を参照するための ref。
   */
  const onConnectedRef = useRef<(() => void) | undefined>(onConnected);

  // dispatch / onConnected が変わるたびに ref を最新化する
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  // ----------------------------------------------------------
  // WebSocketClient の初期化（マウント時に1回）
  // ----------------------------------------------------------

  useEffect(() => {
    isUnmountedRef.current = false;

    // コールバックは ref を介して最新の dispatch を参照する（stale closure 対策）
    const client = createWebSocketClient({
      onConnected: () => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.statusChanged("connected"));
        onConnectedRef.current?.();
      },

      onDisconnect: () => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.statusChanged("idle"));
      },

      onTranscriptInterim: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.interim(msg.text));
      },

      onTranscriptFinal: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.final(msg.text));
      },

      onUtteranceCommitted: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.committed(msg.text, msg.reason));
      },

      onTranslation: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(
          AppActions.translation(msg.sourceText, msg.translatedText),
        );
      },

      onAudio: () => {
        // audio メッセージの enqueue は TranslatorApp 側で useAudioQueue を使って行う。
        // useWebSocket は audio メッセージをそのまま上位に渡す仕組みが必要だが、
        // reducer の AppAction に audio 用アクションがないため、
        // audio コールバックは onAudioReceived 経由で TranslatorApp に委譲する。
        // ここでは何もしない（onAudioReceived を別途提供）
      },

      onMetrics: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(
          AppActions.metrics({
            speechMs: msg.speechMs,
            translationMs: msg.translationMs,
            ttsMs: msg.ttsMs,
            totalMs: msg.totalMs,
          }),
        );
      },

      onError: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.error(msg.message, msg.fatal));
      },
    });

    clientRef.current = client;

    return () => {
      isUnmountedRef.current = true;
      // アンマウント時に接続を切断する
      client.disconnect();
      clientRef.current = null;
    };
  }, []); // 初回マウント時のみ実行。コールバックは ref 経由で参照するため依存不要

  // ----------------------------------------------------------
  // 公開メソッド
  // ----------------------------------------------------------

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;
    clientRef.current?.connect();
    dispatchRef.current(AppActions.statusChanged("connecting"));
  }, []);

  const disconnect = useCallback(() => {
    if (isUnmountedRef.current) return;
    clientRef.current?.disconnect();
    // onDisconnect コールバックで idle に戻る
  }, []);

  const sendAudio = useCallback((base64: string) => {
    clientRef.current?.sendAudio(base64);
  }, []);

  const sendCommit = useCallback(() => {
    clientRef.current?.sendCommit();
  }, []);

  const sendStop = useCallback(() => {
    clientRef.current?.sendStop();
  }, []);

  const sendStart = useCallback((settings: Settings) => {
    clientRef.current?.sendStart(settings);
  }, []);

  return {
    connect,
    disconnect,
    sendAudio,
    sendCommit,
    sendStop,
    sendStart,
  };
}

// ============================================================
// audio コールバックを別途注入するための拡張版フック
// ============================================================

/** useWebSocket の拡張オプション */
export interface UseWebSocketOptions {
  /** audio メッセージ受信時のコールバック（base64 文字列を受け取る） */
  onAudioReceived?: (base64: string) => void;
  /** 接続確立時のコールバック */
  onConnected?: () => void;
}

/**
 * audio コールバックを含む拡張版 useWebSocket フック。
 *
 * @param dispatch  useReducer の dispatch 関数
 * @param options   拡張オプション（onAudioReceived / onConnected）
 * @returns WebSocket 操作メソッド群
 */
export function useWebSocketWithAudio(
  dispatch: React.Dispatch<AppAction>,
  options: UseWebSocketOptions = {},
): UseWebSocketReturn {
  const isUnmountedRef = useRef<boolean>(false);
  const clientRef = useRef<WebSocketClient | null>(null);
  const dispatchRef = useRef<React.Dispatch<AppAction>>(dispatch);
  const onAudioReceivedRef = useRef<((base64: string) => void) | undefined>(
    options.onAudioReceived,
  );
  const onConnectedRef = useRef<(() => void) | undefined>(options.onConnected);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    onAudioReceivedRef.current = options.onAudioReceived;
  }, [options.onAudioReceived]);

  useEffect(() => {
    onConnectedRef.current = options.onConnected;
  }, [options.onConnected]);

  useEffect(() => {
    isUnmountedRef.current = false;

    const client = createWebSocketClient({
      onConnected: () => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.statusChanged("connected"));
        onConnectedRef.current?.();
      },

      onDisconnect: () => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.statusChanged("idle"));
      },

      onTranscriptInterim: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.interim(msg.text));
      },

      onTranscriptFinal: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.final(msg.text));
      },

      onUtteranceCommitted: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.committed(msg.text, msg.reason));
      },

      onTranslation: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(
          AppActions.translation(msg.sourceText, msg.translatedText),
        );
      },

      onAudio: (msg) => {
        if (isUnmountedRef.current) return;
        onAudioReceivedRef.current?.(msg.data);
      },

      onMetrics: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(
          AppActions.metrics({
            speechMs: msg.speechMs,
            translationMs: msg.translationMs,
            ttsMs: msg.ttsMs,
            totalMs: msg.totalMs,
          }),
        );
      },

      onError: (msg) => {
        if (isUnmountedRef.current) return;
        dispatchRef.current(AppActions.error(msg.message, msg.fatal));
      },
    });

    clientRef.current = client;

    return () => {
      isUnmountedRef.current = true;
      client.disconnect();
      clientRef.current = null;
    };
  }, []); // 初回マウント時のみ実行。コールバックは ref 経由で参照するため依存不要

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;
    clientRef.current?.connect();
    dispatchRef.current(AppActions.statusChanged("connecting"));
  }, []);

  const disconnect = useCallback(() => {
    if (isUnmountedRef.current) return;
    clientRef.current?.disconnect();
  }, []);

  const sendAudio = useCallback((base64: string) => {
    clientRef.current?.sendAudio(base64);
  }, []);

  const sendCommit = useCallback(() => {
    clientRef.current?.sendCommit();
  }, []);

  const sendStop = useCallback(() => {
    clientRef.current?.sendStop();
  }, []);

  const sendStart = useCallback((settings: Settings) => {
    clientRef.current?.sendStart(settings);
  }, []);

  return {
    connect,
    disconnect,
    sendAudio,
    sendCommit,
    sendStop,
    sendStart,
  };
}
