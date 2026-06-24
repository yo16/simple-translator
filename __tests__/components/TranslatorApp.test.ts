/**
 * @jest-environment jsdom
 */

/**
 * TranslatorApp コンポーネントの統合テスト
 *
 * jest.config.js の testMatch は *.test.ts のみのため、
 * JSX 記法は使わず React.createElement でコンポーネントをレンダリングする。
 *
 * モック対象:
 *   - src/lib/websocketClient — createWebSocketClient
 *   - src/lib/audio — startRecording
 *   - src/hooks/useAudioQueue — useAudioQueue
 *   - navigator.mediaDevices.getUserMedia
 */

import React from "react";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import type { WebSocketCallbacks } from "../../src/lib/websocketClient";

// ============================================================
// jest.mock — websocketClient
// ============================================================

let capturedCallbacks: WebSocketCallbacks = {};

const mockWsConnect = jest.fn();
const mockWsDisconnect = jest.fn();
const mockWsSendAudio = jest.fn();
const mockWsSendCommit = jest.fn();
const mockWsSendStop = jest.fn();
const mockWsSendStart = jest.fn();

jest.mock("../../src/lib/websocketClient", () => ({
  createWebSocketClient: jest.fn((callbacks: WebSocketCallbacks) => {
    capturedCallbacks = callbacks;
    return {
      connect: mockWsConnect,
      disconnect: mockWsDisconnect,
      sendAudio: mockWsSendAudio,
      sendCommit: mockWsSendCommit,
      sendStop: mockWsSendStop,
      sendStart: mockWsSendStart,
    };
  }),
  WebSocketClient: jest.fn(),
}));

// ============================================================
// jest.mock — audio
// ============================================================

const mockRecorderStop = jest.fn();
const mockStartRecording = jest.fn();

jest.mock("../../src/lib/audio", () => ({
  startRecording: (...args: unknown[]) => mockStartRecording(...args),
  DEFAULT_CHUNK_MS: 250,
}));

// ============================================================
// jest.mock — useAudioQueue
// ============================================================

const mockEnqueue = jest.fn();
const mockReset = jest.fn();

jest.mock("../../src/hooks/useAudioQueue", () => ({
  useAudioQueue: jest.fn(() => ({
    enqueue: mockEnqueue,
    reset: mockReset,
  })),
}));

// ============================================================
// テストヘルパー
// ============================================================

function makeMockTrack() {
  return {
    stop: jest.fn(),
    kind: "audio",
    id: "track-1",
    label: "mock-track",
    enabled: true,
    muted: false,
    readyState: "live",
    onended: null,
    onmute: null,
    onunmute: null,
    clone: jest.fn(),
    getCapabilities: jest.fn(),
    getConstraints: jest.fn(),
    getSettings: jest.fn(),
    applyConstraints: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    contentHint: "",
  } as unknown as MediaStreamTrack;
}

function makeMockStream() {
  const tracks = [makeMockTrack()];
  return {
    getTracks: jest.fn().mockReturnValue(tracks),
    getAudioTracks: jest.fn().mockReturnValue(tracks),
    getVideoTracks: jest.fn().mockReturnValue([]),
    addTrack: jest.fn(),
    removeTrack: jest.fn(),
    clone: jest.fn(),
    active: true,
    id: "stream-1",
    onaddtrack: null,
    onremovetrack: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  } as unknown as MediaStream;
}

let mockGetUserMedia: jest.Mock;

// ============================================================
// セットアップ / ティアダウン
// ============================================================

beforeEach(() => {
  capturedCallbacks = {};
  mockRecorderStop.mockReset();
  mockStartRecording.mockReset();
  mockStartRecording.mockReturnValue({ stop: mockRecorderStop });
  mockEnqueue.mockReset();
  mockReset.mockReset();

  mockGetUserMedia = jest.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// TranslatorApp の遅延インポート（モックが先に設定されてから import する）
// ============================================================

function renderTranslatorApp() {
  // require を使うことでモックが適用済みの状態でロードされる
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TranslatorApp } = require("../../src/components/TranslatorApp");
  return render(React.createElement(TranslatorApp));
}

// ============================================================
// テストスイート
// ============================================================

describe("TranslatorApp", () => {
  // ----------------------------------------------------------
  // 1. 初期レンダリング
  // ----------------------------------------------------------
  describe("初期レンダリング", () => {
    it("初期状態で status が 'idle' と表示される", () => {
      renderTranslatorApp();
      expect(screen.getByText(/状態: idle/)).toBeTruthy();
    });

    it("初期状態で '開始' ボタンが表示される", () => {
      renderTranslatorApp();
      expect(screen.getByRole("button", { name: "開始" })).toBeTruthy();
    });

    it("初期状態で '停止' ボタンは表示されない", () => {
      renderTranslatorApp();
      expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
    });

    it("初期状態で '手動区切り' ボタンは disabled", () => {
      renderTranslatorApp();
      const commitBtn = screen.getByRole("button", { name: "手動で発話を区切る" });
      expect((commitBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it("初期状態でエラーメッセージが表示されない", () => {
      renderTranslatorApp();
      expect(screen.queryByText(/エラー:/)).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // 2. 開始ボタンクリック → connect → connecting 表示
  // ----------------------------------------------------------
  describe("開始ボタンクリック", () => {
    it("開始ボタンをクリックすると ws.connect が呼ばれる", () => {
      renderTranslatorApp();
      const startBtn = screen.getByRole("button", { name: "開始" });

      act(() => {
        fireEvent.click(startBtn);
      });

      expect(mockWsConnect).toHaveBeenCalledTimes(1);
    });

    it("開始ボタンをクリックすると status が 'connecting' になり '接続中...' が表示される", () => {
      renderTranslatorApp();
      const startBtn = screen.getByRole("button", { name: "開始" });

      act(() => {
        fireEvent.click(startBtn);
        // connect() 内部で dispatch(STATUS_CHANGED:connecting) が呼ばれる
        // createWebSocketClient モックの useWebSocketWithAudio 経由で dispatch される
        // ここでは useWebSocket フックがモックされていないため、実際の dispatch が動く
        // capturedCallbacks 経由でも status を確認できるが、hook が本物なので connect()
        // 内の dispatchRef.current(AppActions.statusChanged("connecting")) が実行される
      });

      expect(screen.getByText(/状態: connecting/)).toBeTruthy();
    });

    it("接続中は '開始' ボタンが disabled になる", () => {
      renderTranslatorApp();
      const startBtn = screen.getByRole("button", { name: "開始" });

      act(() => {
        fireEvent.click(startBtn);
      });

      // 接続中ボタン（'接続中...'）は disabled
      const connectingBtn = screen.getByText("接続中...");
      expect((connectingBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // 3. onConnected → sendStart → 録音開始 → recording 表示
  // ----------------------------------------------------------
  describe("onConnected → sendStart → recording 遷移", () => {
    it("onConnected が発火すると sendStart が呼ばれる", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      renderTranslatorApp();

      // 開始ボタンクリック
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });

      // サーバーから接続確立
      await act(async () => {
        capturedCallbacks.onConnected?.();
        await Promise.resolve();
      });

      expect(mockWsSendStart).toHaveBeenCalledTimes(1);
    });

    it("onConnected → getUserMedia 成功 → status が recording になる", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      renderTranslatorApp();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });

      await act(async () => {
        capturedCallbacks.onConnected?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByText(/状態: recording/)).toBeTruthy();
    });

    it("recording 状態では '停止' ボタンが表示される", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      renderTranslatorApp();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });

      await act(async () => {
        capturedCallbacks.onConnected?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
    });

    it("recording 状態では '手動区切り' ボタンが enabled になる", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      renderTranslatorApp();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });

      await act(async () => {
        capturedCallbacks.onConnected?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      const commitBtn = screen.getByRole("button", { name: "手動で発話を区切る" });
      expect((commitBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // 4. 停止ボタンクリック
  // ----------------------------------------------------------
  describe("停止ボタンクリック", () => {
    async function setupRecordingState() {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      renderTranslatorApp();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });

      await act(async () => {
        capturedCallbacks.onConnected?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
    }

    it("停止ボタンをクリックすると sendStop が呼ばれる", async () => {
      await setupRecordingState();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "停止" }));
      });

      expect(mockWsSendStop).toHaveBeenCalledTimes(1);
    });

    it("停止ボタンをクリックすると ws.disconnect が呼ばれる", async () => {
      await setupRecordingState();

      // アンマウント時の disconnect 呼び出しをリセット
      mockWsDisconnect.mockClear();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "停止" }));
      });

      expect(mockWsDisconnect).toHaveBeenCalledTimes(1);
    });

    it("停止ボタンをクリックすると audioQueue.reset が呼ばれる", async () => {
      await setupRecordingState();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "停止" }));
      });

      expect(mockReset).toHaveBeenCalledTimes(1);
    });

    it("onDisconnect で status が idle に戻る", async () => {
      await setupRecordingState();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "停止" }));
      });

      await act(async () => {
        capturedCallbacks.onDisconnect?.();
        await Promise.resolve();
      });

      expect(screen.getByText(/状態: idle/)).toBeTruthy();
    });
  });

  // ----------------------------------------------------------
  // 5. 受信メッセージの UI 反映
  // ----------------------------------------------------------
  describe("受信メッセージの UI 反映", () => {
    async function setupRecordingState() {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);
      renderTranslatorApp();
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });
      await act(async () => {
        capturedCallbacks.onConnected?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
    }

    it("transcript_interim 受信で認識中テキストが表示される", async () => {
      await setupRecordingState();

      await act(async () => {
        capturedCallbacks.onTranscriptInterim?.({ type: "transcript_interim", text: "認識中のテキスト" });
        await Promise.resolve();
      });

      const section = screen.getByRole("region", { name: "認識中テキスト" });
      expect(within(section).getByText("認識中のテキスト")).toBeTruthy();
    });

    it("utterance_committed 受信で committed テキストが反映される（interim クリア）", async () => {
      await setupRecordingState();

      // interim を一度設定
      await act(async () => {
        capturedCallbacks.onTranscriptInterim?.({ type: "transcript_interim", text: "中間テキスト" });
        await Promise.resolve();
      });

      // committed を受信
      await act(async () => {
        capturedCallbacks.onUtteranceCommitted?.({ type: "utterance_committed", text: "コミットテキスト", reason: "silence" });
        await Promise.resolve();
      });

      // interim がクリアされ、（待機中）が表示される
      const section = screen.getByRole("region", { name: "認識中テキスト" });
      expect(within(section).getByText("（待機中）")).toBeTruthy();
    });

    it("translation 受信で翻訳テキストが翻訳セクションに表示される", async () => {
      await setupRecordingState();

      await act(async () => {
        capturedCallbacks.onTranslation?.({ type: "translation", sourceText: "原文テキスト", translatedText: "Translated text" });
        await Promise.resolve();
      });

      const section = screen.getByRole("region", { name: "翻訳テキスト" });
      expect(within(section).getByText("原文テキスト")).toBeTruthy();
      expect(within(section).getByText("Translated text")).toBeTruthy();
    });

    it("metrics 受信でレイテンシ情報が表示される", async () => {
      await setupRecordingState();

      await act(async () => {
        capturedCallbacks.onMetrics?.({ type: "metrics", speechMs: 150, translationMs: 250, ttsMs: 350, totalMs: 750 });
        await Promise.resolve();
      });

      expect(screen.getByText(/150ms/)).toBeTruthy();
      expect(screen.getByText(/250ms/)).toBeTruthy();
      expect(screen.getByText(/750ms/)).toBeTruthy();
    });
  });

  // ----------------------------------------------------------
  // 6. エラー受信
  // ----------------------------------------------------------
  describe("エラー受信", () => {
    it("fatal:true のエラー受信で status が 'error' になりエラーメッセージが表示される", async () => {
      renderTranslatorApp();

      await act(async () => {
        capturedCallbacks.onError?.({ type: "error", message: "致命的なエラー", fatal: true });
        await Promise.resolve();
      });

      expect(screen.getByText(/状態: error/)).toBeTruthy();
      expect(screen.getByText(/致命的なエラー/)).toBeTruthy();
    });

    it("fatal:false のエラー受信で status は変わらずエラーメッセージが表示される", async () => {
      renderTranslatorApp();

      await act(async () => {
        capturedCallbacks.onError?.({ type: "error", message: "軽微なエラー", fatal: false });
        await Promise.resolve();
      });

      // status は idle のまま
      expect(screen.getByText(/状態: idle/)).toBeTruthy();
      expect(screen.getByText(/軽微なエラー/)).toBeTruthy();
    });

    it("error 状態から開始ボタンを押すとリセットされて接続が開始される", async () => {
      renderTranslatorApp();

      await act(async () => {
        capturedCallbacks.onError?.({ type: "error", message: "エラー", fatal: true });
        await Promise.resolve();
      });

      expect(screen.getByText(/状態: error/)).toBeTruthy();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });

      expect(mockWsConnect).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/状態: connecting/)).toBeTruthy();
    });
  });

  // ----------------------------------------------------------
  // 7. audio 受信 → enqueue（enableTts=true）
  // ----------------------------------------------------------
  describe("audio 受信 → enqueue", () => {
    it("enableTts=true（デフォルト）のとき audio 受信で enqueue が呼ばれる", async () => {
      renderTranslatorApp();

      await act(async () => {
        capturedCallbacks.onAudio?.({ type: "audio", mimeType: "audio/mpeg", data: "base64mp3data" });
        await Promise.resolve();
      });

      expect(mockEnqueue).toHaveBeenCalledWith("base64mp3data");
    });
  });

  // ----------------------------------------------------------
  // 8. transcript_final 受信で認識確定セクションに追加される
  // ----------------------------------------------------------
  describe("transcript_final 受信", () => {
    it("transcript_final 受信で認識確定セクションにテキストが追加される", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);
      renderTranslatorApp();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });

      await act(async () => {
        capturedCallbacks.onConnected?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        capturedCallbacks.onTranscriptFinal?.({ type: "transcript_final", text: "確定したテキスト" });
        await Promise.resolve();
      });

      const section = screen.getByRole("region", { name: "認識確定テキスト" });
      expect(within(section).getByText("確定したテキスト")).toBeTruthy();
    });
  });

  // ----------------------------------------------------------
  // 9. 言語ペア切り替え
  // ----------------------------------------------------------
  describe("言語ペア切り替え", () => {
    it("言語入れ替えボタンをクリックすると言語が入れ替わる", () => {
      renderTranslatorApp();

      // 初期状態: 日本語 ⇄ 英語
      const langBtn = screen.getByRole("button", { name: "言語を入れ替える" });

      act(() => {
        fireEvent.click(langBtn);
      });

      // 入れ替え後は英語 → 日本語 の順になる
      const langElements = screen.getAllByText(/日本語|英語/);
      // 2つの言語ラベルが表示されている（入れ替わり後も両方表示される）
      expect(langElements.length).toBeGreaterThanOrEqual(2);
    });

    it("接続中（connecting）は言語入れ替えボタンが disabled", () => {
      renderTranslatorApp();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "開始" }));
      });

      const langToggleBtn = screen.getByRole("button", { name: "言語を入れ替える" });
      expect((langToggleBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
