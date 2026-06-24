/**
 * @jest-environment jsdom
 */

/**
 * useWebSocketWithAudio カスタムフックの単体テスト
 *
 * createWebSocketClient / WebSocketClient を jest.mock で差し替え、
 * 受信コールバックの dispatch 委譲・アンマウントガード・stale closure 対策を検証する。
 */

import { renderHook, act } from "@testing-library/react";
import { useWebSocketWithAudio } from "../../src/hooks/useWebSocket";
import type { UseWebSocketOptions } from "../../src/hooks/useWebSocket";
import type { AppAction, Settings } from "../../src/lib/types";
import type { WebSocketCallbacks } from "../../src/lib/websocketClient";

// ============================================================
// jest.mock — websocketClient 全体をモック
// ============================================================

// createWebSocketClient が呼ばれたときのコールバックを外部から参照するための変数
let capturedCallbacks: WebSocketCallbacks = {};

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockSendAudio = jest.fn();
const mockSendCommit = jest.fn();
const mockSendStop = jest.fn();
const mockSendStart = jest.fn();

jest.mock("../../src/lib/websocketClient", () => ({
  createWebSocketClient: jest.fn((callbacks: WebSocketCallbacks) => {
    capturedCallbacks = callbacks;
    return {
      connect: mockConnect,
      disconnect: mockDisconnect,
      sendAudio: mockSendAudio,
      sendCommit: mockSendCommit,
      sendStop: mockSendStop,
      sendStart: mockSendStart,
    };
  }),
  WebSocketClient: jest.fn(),
}));

// ============================================================
// テストヘルパー
// ============================================================

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    sourceLanguage: "ja-JP",
    targetLanguage: "en-US",
    enableTts: false,
    enableInterimTranslation: false,
    chunkMs: 250,
    silenceMs: 1000,
    maxChars: 80,
    maxSeconds: 10,
    ...overrides,
  };
}

// ============================================================
// セットアップ / ティアダウン
// ============================================================

beforeEach(() => {
  capturedCallbacks = {};
  jest.clearAllMocks();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// テストスイート
// ============================================================

describe("useWebSocketWithAudio", () => {
  // ----------------------------------------------------------
  // 1. 初期化 — createWebSocketClient の呼び出し
  // ----------------------------------------------------------
  describe("初期化", () => {
    it("マウント時に createWebSocketClient が1回呼ばれる", () => {
      const dispatch = jest.fn();
      const { createWebSocketClient } = jest.requireMock("../../src/lib/websocketClient");
      renderHook(() => useWebSocketWithAudio(dispatch));
      expect(createWebSocketClient).toHaveBeenCalledTimes(1);
    });

    it("アンマウント時に disconnect が呼ばれる", () => {
      const dispatch = jest.fn();
      const { unmount } = renderHook(() => useWebSocketWithAudio(dispatch));
      act(() => {
        unmount();
      });
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // 2. connect / disconnect が clientRef に委譲される
  // ----------------------------------------------------------
  describe("connect() / disconnect()", () => {
    it("connect() を呼ぶと client.connect が呼ばれ、dispatch(STATUS_CHANGED:connecting) される", () => {
      const dispatch = jest.fn();
      const { result } = renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        result.current.connect();
      });

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "STATUS_CHANGED", status: "connecting" })
      );
    });

    it("disconnect() を呼ぶと client.disconnect が呼ばれる", () => {
      const dispatch = jest.fn();
      const { result } = renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        result.current.disconnect();
      });

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // 3. sendAudio / sendCommit / sendStop / sendStart の委譲
  // ----------------------------------------------------------
  describe("send 系メソッド", () => {
    it("sendAudio(base64) が client.sendAudio に委譲される", () => {
      const dispatch = jest.fn();
      const { result } = renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        result.current.sendAudio("base64data");
      });

      expect(mockSendAudio).toHaveBeenCalledWith("base64data");
    });

    it("sendCommit() が client.sendCommit に委譲される", () => {
      const dispatch = jest.fn();
      const { result } = renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        result.current.sendCommit();
      });

      expect(mockSendCommit).toHaveBeenCalledTimes(1);
    });

    it("sendStop() が client.sendStop に委譲される", () => {
      const dispatch = jest.fn();
      const { result } = renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        result.current.sendStop();
      });

      expect(mockSendStop).toHaveBeenCalledTimes(1);
    });

    it("sendStart(settings) が client.sendStart に委譲される", () => {
      const dispatch = jest.fn();
      const { result } = renderHook(() => useWebSocketWithAudio(dispatch));
      const settings = makeSettings();

      act(() => {
        result.current.sendStart(settings);
      });

      expect(mockSendStart).toHaveBeenCalledWith(settings);
    });
  });

  // ----------------------------------------------------------
  // 4. 受信コールバック → dispatch への橋渡し
  // ----------------------------------------------------------
  describe("受信コールバック → dispatch", () => {
    it("onConnected で dispatch(STATUS_CHANGED:connected) が呼ばれる", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        capturedCallbacks.onConnected?.();
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "STATUS_CHANGED", status: "connected" })
      );
    });

    it("onDisconnect で dispatch(STATUS_CHANGED:idle) が呼ばれる", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        capturedCallbacks.onDisconnect?.();
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "STATUS_CHANGED", status: "idle" })
      );
    });

    it("onTranscriptInterim で dispatch(INTERIM) が呼ばれる", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        capturedCallbacks.onTranscriptInterim?.({ type: "transcript_interim", text: "認識中のテキスト" });
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "INTERIM", text: "認識中のテキスト" })
      );
    });

    it("onTranscriptFinal で dispatch(FINAL) が呼ばれる", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        capturedCallbacks.onTranscriptFinal?.({ type: "transcript_final", text: "確定テキスト" });
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "FINAL", text: "確定テキスト" })
      );
    });

    it("onUtteranceCommitted で dispatch(COMMITTED) が呼ばれる", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        capturedCallbacks.onUtteranceCommitted?.({ type: "utterance_committed", text: "コミットテキスト", reason: "silence" });
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "COMMITTED", text: "コミットテキスト", reason: "silence" })
      );
    });

    it("onTranslation で dispatch(TRANSLATION) が呼ばれる", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        capturedCallbacks.onTranslation?.({ type: "translation", sourceText: "原文", translatedText: "Translation" });
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "TRANSLATION", sourceText: "原文", translatedText: "Translation" })
      );
    });

    it("onMetrics で dispatch(METRICS) が呼ばれる", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        capturedCallbacks.onMetrics?.({ type: "metrics", speechMs: 100, translationMs: 200, ttsMs: 300, totalMs: 600 });
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "METRICS",
          metrics: expect.objectContaining({ speechMs: 100, translationMs: 200, ttsMs: 300, totalMs: 600 }),
        })
      );
    });

    it("onError で dispatch(ERROR) が呼ばれる", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        capturedCallbacks.onError?.({ type: "error", message: "エラーメッセージ", fatal: true });
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ERROR", message: "エラーメッセージ", fatal: true })
      );
    });
  });

  // ----------------------------------------------------------
  // 5. onAudio → options.onAudioReceived への委譲
  // ----------------------------------------------------------
  describe("onAudio → onAudioReceived", () => {
    it("options.onAudioReceived が呼ばれる", () => {
      const dispatch = jest.fn();
      const onAudioReceived = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch, { onAudioReceived }));

      act(() => {
        capturedCallbacks.onAudio?.({ type: "audio", mimeType: "audio/mpeg", data: "base64mp3" });
      });

      expect(onAudioReceived).toHaveBeenCalledWith("base64mp3");
    });

    it("onAudioReceived が未指定のとき dispatch は呼ばれない（audio はスキップ）", () => {
      const dispatch = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch));

      const callsBefore = dispatch.mock.calls.length;
      act(() => {
        capturedCallbacks.onAudio?.({ type: "audio", mimeType: "audio/mpeg", data: "base64mp3" });
      });

      // dispatch が audio のために新たに呼ばれていない
      expect(dispatch).toHaveBeenCalledTimes(callsBefore);
    });
  });

  // ----------------------------------------------------------
  // 6. options.onConnected コールバック
  // ----------------------------------------------------------
  describe("options.onConnected コールバック", () => {
    it("onConnected オプションが接続確立時に呼ばれる", () => {
      const dispatch = jest.fn();
      const onConnected = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch, { onConnected }));

      act(() => {
        capturedCallbacks.onConnected?.();
      });

      expect(onConnected).toHaveBeenCalledTimes(1);
    });

    it("onConnected オプションが呼ばれるときも dispatch(STATUS_CHANGED:connected) は変わらず呼ばれる", () => {
      const dispatch = jest.fn();
      const onConnected = jest.fn();
      renderHook(() => useWebSocketWithAudio(dispatch, { onConnected }));

      act(() => {
        capturedCallbacks.onConnected?.();
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "STATUS_CHANGED", status: "connected" })
      );
      expect(onConnected).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // 7. アンマウント後のコールバックガード（isUnmountedRef）
  // ----------------------------------------------------------
  describe("アンマウント後ガード", () => {
    it("アンマウント後に onConnected コールバックが呼ばれても dispatch されない", () => {
      const dispatch = jest.fn();
      const { unmount } = renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        unmount();
      });

      const callsBefore = dispatch.mock.calls.length;
      act(() => {
        capturedCallbacks.onConnected?.();
      });

      expect(dispatch).toHaveBeenCalledTimes(callsBefore);
    });

    it("アンマウント後に onTranscriptInterim コールバックが呼ばれても dispatch されない", () => {
      const dispatch = jest.fn();
      const { unmount } = renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        unmount();
      });

      const callsBefore = dispatch.mock.calls.length;
      act(() => {
        capturedCallbacks.onTranscriptInterim?.({ type: "transcript_interim", text: "アンマウント後のテキスト" });
      });

      expect(dispatch).toHaveBeenCalledTimes(callsBefore);
    });

    it("アンマウント後に onError コールバックが呼ばれても dispatch されない", () => {
      const dispatch = jest.fn();
      const { unmount } = renderHook(() => useWebSocketWithAudio(dispatch));

      act(() => {
        unmount();
      });

      const callsBefore = dispatch.mock.calls.length;
      act(() => {
        capturedCallbacks.onError?.({ type: "error", message: "遅延エラー", fatal: false });
      });

      expect(dispatch).toHaveBeenCalledTimes(callsBefore);
    });

    it("アンマウント後に onAudio コールバックが呼ばれても onAudioReceived は呼ばれない", () => {
      const dispatch = jest.fn();
      const onAudioReceived = jest.fn();
      const { unmount } = renderHook(() =>
        useWebSocketWithAudio(dispatch, { onAudioReceived })
      );

      act(() => {
        unmount();
      });

      act(() => {
        capturedCallbacks.onAudio?.({ type: "audio", mimeType: "audio/mpeg", data: "base64mp3" });
      });

      expect(onAudioReceived).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 8. stale closure 対策（dispatchRef が最新の dispatch を保持）
  // ----------------------------------------------------------
  describe("stale closure 対策", () => {
    it("dispatch が差し替えられても最新の dispatch が呼ばれる", () => {
      const dispatch1 = jest.fn();
      const dispatch2 = jest.fn();

      // dispatch1 でマウントし、dispatch2 に差し替える
      const { rerender } = renderHook(
        ({ dispatch }: { dispatch: React.Dispatch<AppAction> }) =>
          useWebSocketWithAudio(dispatch),
        { initialProps: { dispatch: dispatch1 as React.Dispatch<AppAction> } }
      );

      act(() => {
        rerender({ dispatch: dispatch2 as React.Dispatch<AppAction> });
      });

      // コールバック発火 → 最新の dispatch2 が呼ばれるべき
      act(() => {
        capturedCallbacks.onTranscriptInterim?.({ type: "transcript_interim", text: "テスト" });
      });

      expect(dispatch2).toHaveBeenCalled();
      // dispatch1 は（rerenderで差し替えられた後は）呼ばれない
      // （初期化時 rerender 前の発火はないので dispatch1 は 0 回）
      expect(dispatch1).not.toHaveBeenCalled();
    });
  });
});
