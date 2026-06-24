/**
 * WebSocketClient の単体テスト
 *
 * ブラウザの WebSocket グローバルに依存するため、global.WebSocket を
 * 手動制御できるモッククラスに差し替える方式を採用する。
 * jest.config.js の testEnvironment（node）はそのままで動作する。
 */

import { WebSocketClient, createWebSocketClient } from "../../src/lib/websocketClient";
import type { WebSocketCallbacks } from "../../src/lib/websocketClient";
import type { Settings } from "../../src/lib/types";

// ============================================================
// MockWebSocket — global.WebSocket の代替
// ============================================================

class MockWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  send = jest.fn();
  close = jest.fn().mockImplementation(() => {
    this.readyState = MockWebSocket.CLOSED as number;
    this.onclose?.();
  });

  /** テスト側から接続確立を発火する */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN as number;
    this.onopen?.();
  }

  /** テスト側からメッセージ受信を発火する */
  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }

  /** テスト側から接続切断を発火する（intentional でない切断） */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED as number;
    this.onclose?.();
  }

  /** テスト側から onerror を発火する */
  simulateError(): void {
    this.onerror?.(new Event("error"));
  }

  constructor(url: string) {
    this.url = url;
    // インスタンス生成時にリストへ追加（テスト側から参照できるように）
    MockWebSocket._instances.push(this);
  }

  // 生成されたインスタンスを追跡する（最後のインスタンスを取得するため）
  static _instances: MockWebSocket[] = [];

  static getLastInstance(): MockWebSocket {
    return MockWebSocket._instances[MockWebSocket._instances.length - 1];
  }

  static clearInstances(): void {
    MockWebSocket._instances = [];
  }
}

// ============================================================
// テストヘルパー
// ============================================================

/** デフォルトの Settings オブジェクト */
function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    sourceLanguage: "ja-JP",
    targetLanguage: "en-US",
    enableTts: false,
    enableInterimTranslation: false,
    chunkMs: 500,
    silenceMs: 1000,
    maxChars: 80,
    maxSeconds: 10,
    ...overrides,
  };
}

/** デフォルトのコールバックモック群を生成する */
function makeCallbacks(): Required<WebSocketCallbacks> {
  return {
    onTranscriptInterim: jest.fn(),
    onTranscriptFinal: jest.fn(),
    onUtteranceCommitted: jest.fn(),
    onTranslation: jest.fn(),
    onAudio: jest.fn(),
    onMetrics: jest.fn(),
    onError: jest.fn(),
    onDisconnect: jest.fn(),
    onConnected: jest.fn(),
  };
}

// ============================================================
// セットアップ / ティアダウン
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalWebSocket: any;

beforeEach(() => {
  // global.WebSocket を MockWebSocket に差し替える
  originalWebSocket = (global as Record<string, unknown>).WebSocket;
  (global as Record<string, unknown>).WebSocket = MockWebSocket;
  MockWebSocket.clearInstances();
});

afterEach(() => {
  // global.WebSocket を元に戻す
  (global as Record<string, unknown>).WebSocket = originalWebSocket;
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ============================================================
// テストスイート
// ============================================================

describe("WebSocketClient", () => {
  // ----------------------------------------------------------
  // 1. 接続
  // ----------------------------------------------------------
  describe("connect()", () => {
    it("デフォルト URL（ws://localhost:3001/ws）で WebSocket を生成する", () => {
      const client = new WebSocketClient();
      client.connect();

      const mockWs = MockWebSocket.getLastInstance();
      expect(mockWs).toBeDefined();
      expect(mockWs.url).toBe("ws://localhost:3001/ws");
    });

    it("コンストラクタで指定した URL を使う", () => {
      const customUrl = "ws://example.com:9999/ws";
      const client = new WebSocketClient(customUrl);
      client.connect();

      const mockWs = MockWebSocket.getLastInstance();
      expect(mockWs.url).toBe(customUrl);
    });

    it("NEXT_PUBLIC_WS_URL 環境変数が設定されているときはその URL を使う", () => {
      const envUrl = "ws://env-server:4000/ws";
      const originalEnv = process.env.NEXT_PUBLIC_WS_URL;
      process.env.NEXT_PUBLIC_WS_URL = envUrl;

      // url 引数なしで生成（環境変数を参照させる）
      const client = new WebSocketClient();
      client.connect();

      const mockWs = MockWebSocket.getLastInstance();
      expect(mockWs.url).toBe(envUrl);

      // 環境変数を元に戻す
      if (originalEnv === undefined) {
        delete process.env.NEXT_PUBLIC_WS_URL;
      } else {
        process.env.NEXT_PUBLIC_WS_URL = originalEnv;
      }
    });

    it("すでに OPEN 状態のとき connect() を呼んでも新しい WebSocket を生成しない", () => {
      const client = new WebSocketClient();
      client.connect();

      const firstMockWs = MockWebSocket.getLastInstance();
      firstMockWs.simulateOpen();

      client.connect(); // 2 回目の呼び出し

      // インスタンスは 1 つのみ（再生成されない）
      expect(MockWebSocket._instances).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------
  // 2. onopen → onConnected
  // ----------------------------------------------------------
  describe("onopen → onConnected", () => {
    it("接続確立（onopen）で onConnected コールバックが呼ばれる", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();

      MockWebSocket.getLastInstance().simulateOpen();

      expect(callbacks.onConnected).toHaveBeenCalledTimes(1);
    });

    it("接続確立後、readyState が OPEN を返す", () => {
      const client = new WebSocketClient();
      client.connect();

      MockWebSocket.getLastInstance().simulateOpen();

      expect(client.readyState).toBe(MockWebSocket.OPEN);
    });
  });

  // ----------------------------------------------------------
  // 3. 送信メソッド
  // ----------------------------------------------------------
  describe("sendStart()", () => {
    it("接続後に sendStart(config) を呼ぶと start メッセージが送信される", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      const config = makeSettings({ sourceLanguage: "ja-JP", targetLanguage: "en-US", enableTts: true });
      client.sendStart(config);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe("start");
      expect(sent.sourceLanguage).toBe("ja-JP");
      expect(sent.targetLanguage).toBe("en-US");
      expect(sent.enableTts).toBe(true);
      expect(sent.enableInterimTranslation).toBe(false);
      expect(sent.chunkMs).toBe(500);
      expect(sent.silenceMs).toBe(1000);
      expect(sent.maxChars).toBe(80);
      expect(sent.maxSeconds).toBe(10);
    });

    it("未接続状態で sendStart() を呼ぶと onError が呼ばれ ws.send は呼ばれない", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      // simulateOpen しない（CONNECTING のまま）

      client.sendStart(makeSettings());

      const mockWs = MockWebSocket.getLastInstance();
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(callbacks.onError).toHaveBeenCalledTimes(1);
      expect((callbacks.onError as jest.Mock).mock.calls[0][0]).toMatchObject({
        type: "error",
        fatal: false,
      });
    });
  });

  describe("sendAudio()", () => {
    it("接続後（readyState=OPEN）に sendAudio を呼ぶと audio メッセージが送信される", () => {
      const client = new WebSocketClient();
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      client.sendAudio("base64audiodata");

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe("audio");
      expect(sent.data).toBe("base64audiodata");
    });

    it("未接続時に sendAudio を呼んでも ws.send が呼ばれず onError も呼ばれない", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      // simulateOpen しない

      client.sendAudio("base64audiodata");

      const mockWs = MockWebSocket.getLastInstance();
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it("disconnect() 後に sendAudio を呼んでも ws.send が呼ばれず onError も呼ばれない", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      client.disconnect();
      client.sendAudio("base64audiodata");

      expect(mockWs.send).not.toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });
  });

  describe("sendCommit()", () => {
    it("接続後に sendCommit() を呼ぶと commit メッセージが送信される", () => {
      const client = new WebSocketClient();
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      client.sendCommit();

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe("commit");
    });
  });

  describe("sendStop()", () => {
    it("接続後に sendStop() を呼ぶと stop メッセージが送信される", () => {
      const client = new WebSocketClient();
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      client.sendStop();

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe("stop");
    });
  });

  // ----------------------------------------------------------
  // 4. 受信コールバック
  // ----------------------------------------------------------
  describe("受信コールバック", () => {
    function setupConnectedClient(): { client: WebSocketClient; callbacks: Required<WebSocketCallbacks>; mockWs: MockWebSocket } {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();
      return { client, callbacks, mockWs };
    }

    it("transcript_interim メッセージで onTranscriptInterim が呼ばれる", () => {
      const { callbacks, mockWs } = setupConnectedClient();

      mockWs.simulateMessage(JSON.stringify({ type: "transcript_interim", text: "認識中のテキスト" }));

      expect(callbacks.onTranscriptInterim).toHaveBeenCalledTimes(1);
      expect(callbacks.onTranscriptInterim).toHaveBeenCalledWith({
        type: "transcript_interim",
        text: "認識中のテキスト",
      });
    });

    it("transcript_final メッセージで onTranscriptFinal が呼ばれる", () => {
      const { callbacks, mockWs } = setupConnectedClient();

      mockWs.simulateMessage(JSON.stringify({ type: "transcript_final", text: "確定したテキスト" }));

      expect(callbacks.onTranscriptFinal).toHaveBeenCalledTimes(1);
      expect(callbacks.onTranscriptFinal).toHaveBeenCalledWith({
        type: "transcript_final",
        text: "確定したテキスト",
      });
    });

    it("utterance_committed メッセージで onUtteranceCommitted が呼ばれる", () => {
      const { callbacks, mockWs } = setupConnectedClient();

      mockWs.simulateMessage(JSON.stringify({
        type: "utterance_committed",
        text: "発話区切り確定テキスト",
        reason: "silence",
      }));

      expect(callbacks.onUtteranceCommitted).toHaveBeenCalledTimes(1);
      expect(callbacks.onUtteranceCommitted).toHaveBeenCalledWith({
        type: "utterance_committed",
        text: "発話区切り確定テキスト",
        reason: "silence",
      });
    });

    it("translation メッセージで onTranslation が呼ばれる", () => {
      const { callbacks, mockWs } = setupConnectedClient();

      mockWs.simulateMessage(JSON.stringify({
        type: "translation",
        sourceText: "原文テキスト",
        translatedText: "Translated text",
      }));

      expect(callbacks.onTranslation).toHaveBeenCalledTimes(1);
      expect(callbacks.onTranslation).toHaveBeenCalledWith({
        type: "translation",
        sourceText: "原文テキスト",
        translatedText: "Translated text",
      });
    });

    it("audio メッセージで onAudio が呼ばれる", () => {
      const { callbacks, mockWs } = setupConnectedClient();

      mockWs.simulateMessage(JSON.stringify({
        type: "audio",
        mimeType: "audio/mpeg",
        data: "base64mp3data",
      }));

      expect(callbacks.onAudio).toHaveBeenCalledTimes(1);
      expect(callbacks.onAudio).toHaveBeenCalledWith({
        type: "audio",
        mimeType: "audio/mpeg",
        data: "base64mp3data",
      });
    });

    it("metrics メッセージで onMetrics が呼ばれ各フィールドが正しく渡る", () => {
      const { callbacks, mockWs } = setupConnectedClient();

      mockWs.simulateMessage(JSON.stringify({
        type: "metrics",
        speechMs: 1200,
        translationMs: 300,
        ttsMs: 800,
        totalMs: 2300,
      }));

      expect(callbacks.onMetrics).toHaveBeenCalledTimes(1);
      expect(callbacks.onMetrics).toHaveBeenCalledWith({
        type: "metrics",
        speechMs: 1200,
        translationMs: 300,
        ttsMs: 800,
        totalMs: 2300,
      });
    });

    it("error メッセージで onError が呼ばれる", () => {
      const { callbacks, mockWs } = setupConnectedClient();

      mockWs.simulateMessage(JSON.stringify({
        type: "error",
        message: "Speech-to-Text streaming failed",
        fatal: false,
      }));

      expect(callbacks.onError).toHaveBeenCalledTimes(1);
      expect(callbacks.onError).toHaveBeenCalledWith({
        type: "error",
        message: "Speech-to-Text streaming failed",
        fatal: false,
      });
    });

    it("fatal=true の error メッセージで fatal フラグが正しく渡る", () => {
      const { callbacks, mockWs } = setupConnectedClient();

      mockWs.simulateMessage(JSON.stringify({
        type: "error",
        message: "Fatal error",
        fatal: true,
      }));

      expect(callbacks.onError).toHaveBeenCalledWith({
        type: "error",
        message: "Fatal error",
        fatal: true,
      });
    });

    it("utterance_committed の reason が各パターンで正しく渡る", () => {
      const { callbacks, mockWs } = setupConnectedClient();
      const reasons = ["silence", "maxChars", "maxSeconds", "commit", "stop"] as const;

      reasons.forEach((reason) => {
        mockWs.simulateMessage(JSON.stringify({ type: "utterance_committed", text: "text", reason }));
      });

      expect(callbacks.onUtteranceCommitted).toHaveBeenCalledTimes(reasons.length);
      reasons.forEach((reason, i) => {
        expect((callbacks.onUtteranceCommitted as jest.Mock).mock.calls[i][0].reason).toBe(reason);
      });
    });
  });

  // ----------------------------------------------------------
  // 5. JSON パースエラー
  // ----------------------------------------------------------
  describe("JSON パースエラー", () => {
    it("不正な JSON を受信すると onError が呼ばれ例外でクラッシュしない", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      expect(() => {
        mockWs.simulateMessage("this is not valid JSON{{{");
      }).not.toThrow();

      expect(callbacks.onError).toHaveBeenCalledTimes(1);
      expect((callbacks.onError as jest.Mock).mock.calls[0][0]).toMatchObject({
        type: "error",
        fatal: false,
      });
      expect((callbacks.onError as jest.Mock).mock.calls[0][0].message).toContain("JSON parse error");
    });
  });

  // ----------------------------------------------------------
  // 6. 未知の type
  // ----------------------------------------------------------
  describe("未知の type", () => {
    it("未知の type のメッセージでクラッシュせずどのコールバックも呼ばれない", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      expect(() => {
        mockWs.simulateMessage(JSON.stringify({ type: "unknown_type_xyz", data: "something" }));
      }).not.toThrow();

      expect(callbacks.onTranscriptInterim).not.toHaveBeenCalled();
      expect(callbacks.onTranscriptFinal).not.toHaveBeenCalled();
      expect(callbacks.onUtteranceCommitted).not.toHaveBeenCalled();
      expect(callbacks.onTranslation).not.toHaveBeenCalled();
      expect(callbacks.onAudio).not.toHaveBeenCalled();
      expect(callbacks.onMetrics).not.toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 7. 切断
  // ----------------------------------------------------------
  describe("切断", () => {
    it("onclose で onDisconnect が呼ばれる", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      mockWs.simulateClose();

      expect(callbacks.onDisconnect).toHaveBeenCalledTimes(1);
    });

    it("disconnect() を呼ぶと ws.close が呼ばれる", () => {
      const client = new WebSocketClient();
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      client.disconnect();

      expect(mockWs.close).toHaveBeenCalledTimes(1);
    });

    it("disconnect() 後は readyState が CLOSED を返す", () => {
      const client = new WebSocketClient();
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      client.disconnect();

      expect(client.readyState).toBe(MockWebSocket.CLOSED);
    });

    it("onerror が発火すると onError コールバックが呼ばれる", () => {
      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();

      mockWs.simulateError();

      expect(callbacks.onError).toHaveBeenCalledTimes(1);
      expect(callbacks.onError).toHaveBeenCalledWith({
        type: "error",
        message: "WebSocket connection error",
        fatal: false,
      });
    });
  });

  // ----------------------------------------------------------
  // 8. 自動再接続
  // ----------------------------------------------------------
  describe("自動再接続", () => {
    it("autoReconnect=false（デフォルト）のとき、意図しない切断で再接続しない", () => {
      const client = new WebSocketClient(undefined, {}, false);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      const instancesBefore = MockWebSocket._instances.length;
      mockWs.simulateClose();

      expect(MockWebSocket._instances).toHaveLength(instancesBefore);
    });

    it("autoReconnect=true のとき、意図しない onclose で再接続が試みられる（1回目）", () => {
      jest.useFakeTimers();

      const client = new WebSocketClient(undefined, {}, true);
      client.connect();
      const firstMockWs = MockWebSocket.getLastInstance();
      firstMockWs.simulateOpen();

      // 意図しない切断
      firstMockWs.simulateClose();

      expect(MockWebSocket._instances).toHaveLength(1); // まだ再接続していない

      // バックオフ遅延を進める（1回目: 1000ms）
      jest.advanceTimersByTime(1000);

      expect(MockWebSocket._instances).toHaveLength(2); // 再接続試行で新しいインスタンスが生成された
    });

    it("autoReconnect=true のとき、最大3回まで再接続を試みる", () => {
      jest.useFakeTimers();

      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks, true);
      client.connect();

      // 初回接続を open させ、意図しない切断を発生させる
      // onopen で reconnectAttempts がリセットされるため、
      // open せずに close を繰り返すことで上限到達を検証する
      // ---
      // 接続1: close → schedule(attempt=0→1, delay=1000) → advance → WS#2 生成
      MockWebSocket._instances[0].simulateClose();
      jest.advanceTimersByTime(1000);

      // 接続2: close → schedule(attempt=1→2, delay=2000) → advance → WS#3 生成
      MockWebSocket._instances[1].simulateClose();
      jest.advanceTimersByTime(2000);

      // 接続3: close → schedule(attempt=2→3, delay=4000) → advance → WS#4 生成
      MockWebSocket._instances[2].simulateClose();
      jest.advanceTimersByTime(4000);

      // 接続4: close → attempt=3 >= MAX(3) → onError(fatal:true)
      MockWebSocket._instances[3].simulateClose();

      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ fatal: true })
      );
    });

    it("disconnect() を呼んだ後は onclose が来ても再接続しない", () => {
      jest.useFakeTimers();

      const callbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, callbacks, true);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      const instancesBefore = MockWebSocket._instances.length;
      client.disconnect(); // intentionalClose = true になる

      // タイマーを進めても再接続しない
      jest.advanceTimersByTime(5000);

      expect(MockWebSocket._instances).toHaveLength(instancesBefore);
      // onError(fatal: true) も呼ばれない
      expect(callbacks.onError).not.toHaveBeenCalledWith(
        expect.objectContaining({ fatal: true })
      );
    });

    it("autoReconnect=true で再接続中に disconnect() を呼ぶと再接続タイマーがキャンセルされる", () => {
      jest.useFakeTimers();

      const client = new WebSocketClient(undefined, {}, true);
      client.connect();
      const firstMockWs = MockWebSocket.getLastInstance();
      firstMockWs.simulateOpen();

      // 意図しない切断（再接続タイマーがスケジュールされる）
      firstMockWs.simulateClose();
      const instancesAfterClose = MockWebSocket._instances.length;

      // タイマーが発火する前に disconnect() を呼ぶ
      client.disconnect();

      // タイマーを進めても再接続しない
      jest.advanceTimersByTime(5000);

      expect(MockWebSocket._instances).toHaveLength(instancesAfterClose); // 新しいインスタンスは生成されない
    });
  });

  // ----------------------------------------------------------
  // 9. コールバック差し替え
  // ----------------------------------------------------------
  describe("setCallbacks / updateCallbacks", () => {
    it("setCallbacks で全コールバックを一括差し替えできる", () => {
      const initialCallbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, initialCallbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      const newCallbacks = makeCallbacks();
      client.setCallbacks(newCallbacks);

      mockWs.simulateMessage(JSON.stringify({ type: "transcript_interim", text: "テスト" }));

      expect(initialCallbacks.onTranscriptInterim).not.toHaveBeenCalled();
      expect(newCallbacks.onTranscriptInterim).toHaveBeenCalledTimes(1);
    });

    it("updateCallbacks で特定コールバックのみ差し替えできる", () => {
      const initialCallbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, initialCallbacks);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      const newOnTranscriptFinal = jest.fn();
      client.updateCallbacks({ onTranscriptFinal: newOnTranscriptFinal });

      // transcript_interim → 元のコールバックが呼ばれる
      mockWs.simulateMessage(JSON.stringify({ type: "transcript_interim", text: "テスト中間" }));
      expect(initialCallbacks.onTranscriptInterim).toHaveBeenCalledTimes(1);

      // transcript_final → 新しいコールバックが呼ばれる
      mockWs.simulateMessage(JSON.stringify({ type: "transcript_final", text: "テスト確定" }));
      expect(initialCallbacks.onTranscriptFinal).not.toHaveBeenCalled();
      expect(newOnTranscriptFinal).toHaveBeenCalledTimes(1);
      expect(newOnTranscriptFinal).toHaveBeenCalledWith({
        type: "transcript_final",
        text: "テスト確定",
      });
    });

    it("updateCallbacks で onConnected のみ差し替えても他のコールバックは維持される", () => {
      const initialCallbacks = makeCallbacks();
      const client = new WebSocketClient(undefined, initialCallbacks);

      const newOnConnected = jest.fn();
      client.updateCallbacks({ onConnected: newOnConnected });

      client.connect();
      MockWebSocket.getLastInstance().simulateOpen();

      expect(newOnConnected).toHaveBeenCalledTimes(1);
      expect(initialCallbacks.onConnected).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 10. createWebSocketClient ファクトリ
  // ----------------------------------------------------------
  describe("createWebSocketClient()", () => {
    it("WebSocketClient インスタンスを返す", () => {
      const client = createWebSocketClient();
      expect(client).toBeInstanceOf(WebSocketClient);
    });

    it("コールバックを受け取り接続時に呼ばれる", () => {
      const callbacks = makeCallbacks();
      const client = createWebSocketClient(callbacks);
      client.connect();

      MockWebSocket.getLastInstance().simulateOpen();

      expect(callbacks.onConnected).toHaveBeenCalledTimes(1);
    });

    it("URL を指定して生成できる", () => {
      const customUrl = "ws://custom:8080/ws";
      const client = createWebSocketClient({}, customUrl);
      client.connect();

      expect(MockWebSocket.getLastInstance().url).toBe(customUrl);
    });

    it("autoReconnect=true を渡すと自動再接続が有効になる", () => {
      jest.useFakeTimers();

      const client = createWebSocketClient({}, undefined, true);
      client.connect();
      const mockWs = MockWebSocket.getLastInstance();
      mockWs.simulateOpen();

      mockWs.simulateClose();
      jest.advanceTimersByTime(1000);

      // 再接続されて新しいインスタンスが生成されている
      expect(MockWebSocket._instances).toHaveLength(2);
    });
  });
});
