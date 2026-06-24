/**
 * audio.ts の単体テスト
 *
 * ブラウザ API（MediaRecorder / Blob / atob / btoa）に依存するため、
 * global モックで差し替える方式を採用する。
 * jest.config.js の testEnvironment（node）はそのままで動作する。
 */

import {
  DEFAULT_CHUNK_MS,
  arrayBufferToBase64,
  blobToBase64,
  getSupportedMimeType,
  startRecording,
} from "../../src/lib/audio";

// ============================================================
// グローバル btoa / atob のポリフィル（Node.js 環境では未定義の場合がある）
// ============================================================

// Node.js 16+ では global.btoa / global.atob が存在するが、
// 念のため Buffer ベースの実装で上書きして一貫性を保つ
const originalBtoa = (global as Record<string, unknown>).btoa;
const originalAtob = (global as Record<string, unknown>).atob;

beforeAll(() => {
  (global as Record<string, unknown>).btoa = (str: string): string =>
    Buffer.from(str, "binary").toString("base64");
  (global as Record<string, unknown>).atob = (b64: string): string =>
    Buffer.from(b64, "base64").toString("binary");
});

afterAll(() => {
  (global as Record<string, unknown>).btoa = originalBtoa;
  (global as Record<string, unknown>).atob = originalAtob;
});

// ============================================================
// MockMediaRecorder — global.MediaRecorder の代替
// ============================================================

class MockMediaRecorder {
  static isTypeSupported: jest.Mock = jest.fn();

  stream: MediaStream;
  options: MediaRecorderOptions;
  state: RecordingState = "inactive";

  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  start: jest.Mock;
  stop: jest.Mock;

  constructor(stream: MediaStream, options: MediaRecorderOptions = {}) {
    this.stream = stream;
    this.options = options;
    this.start = jest.fn().mockImplementation(() => {
      this.state = "recording";
    });
    this.stop = jest.fn().mockImplementation(() => {
      this.state = "inactive";
    });
    MockMediaRecorder._instances.push(this);
  }

  /** テスト側から ondataavailable を発火する */
  simulateDataAvailable(blob: Blob): void {
    const event = { data: blob } as BlobEvent;
    this.ondataavailable?.(event);
  }

  static _instances: MockMediaRecorder[] = [];

  static getLastInstance(): MockMediaRecorder {
    return MockMediaRecorder._instances[MockMediaRecorder._instances.length - 1];
  }

  static clearInstances(): void {
    MockMediaRecorder._instances = [];
  }
}

// ============================================================
// MockMediaStream — startRecording に渡す MediaStream の代替
// ============================================================

function makeMockStream(): MediaStream {
  const track = { stop: jest.fn() } as unknown as MediaStreamTrack;
  return {
    getTracks: jest.fn().mockReturnValue([track]),
  } as unknown as MediaStream;
}

// ============================================================
// セットアップ / ティアダウン
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalMediaRecorder: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalWindow: any;

beforeEach(() => {
  originalMediaRecorder = (global as Record<string, unknown>).MediaRecorder;
  (global as Record<string, unknown>).MediaRecorder = MockMediaRecorder;

  // window が未定義の場合の getSupportedMimeType テスト用
  originalWindow = (global as Record<string, unknown>).window;

  MockMediaRecorder.clearInstances();
  MockMediaRecorder.isTypeSupported.mockReset();
});

afterEach(() => {
  (global as Record<string, unknown>).MediaRecorder = originalMediaRecorder;
  (global as Record<string, unknown>).window = originalWindow;
  jest.clearAllMocks();
});

// ============================================================
// テストスイート
// ============================================================

describe("audio.ts", () => {
  // ----------------------------------------------------------
  // 1. DEFAULT_CHUNK_MS
  // ----------------------------------------------------------
  describe("DEFAULT_CHUNK_MS", () => {
    it("250 である", () => {
      expect(DEFAULT_CHUNK_MS).toBe(250);
    });
  });

  // ----------------------------------------------------------
  // 2. arrayBufferToBase64
  // ----------------------------------------------------------
  describe("arrayBufferToBase64", () => {
    it("既知のバイト列を base64 に変換し、atob でデコードすると元のバイト列に戻る", () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const base64 = arrayBufferToBase64(bytes.buffer);

      // atob でデコードして元のバイト列と一致するか確認
      const decoded = atob(base64);
      const decodedBytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        decodedBytes[i] = decoded.charCodeAt(i);
      }

      expect(Array.from(decodedBytes)).toEqual(Array.from(bytes));
    });

    it("大きめのバッファ（>8192バイト）でスタックオーバーフローせず正しく変換される", () => {
      // チャンク分割（CHUNK_SIZE=8192）の検証: 8192バイトを超えるバッファでも正しく動作すること
      const size = 10000;
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        bytes[i] = i % 256;
      }

      const base64 = arrayBufferToBase64(bytes.buffer);
      expect(typeof base64).toBe("string");
      expect(base64.length).toBeGreaterThan(0);

      // atob でデコードして元に戻ることを確認
      const decoded = atob(base64);
      expect(decoded.length).toBe(size);
      for (let i = 0; i < size; i++) {
        expect(decoded.charCodeAt(i)).toBe(i % 256);
      }
    });

    it("空の ArrayBuffer を変換すると空文字列を返す", () => {
      const buffer = new ArrayBuffer(0);
      const base64 = arrayBufferToBase64(buffer);
      expect(base64).toBe("");
    });
  });

  // ----------------------------------------------------------
  // 3. blobToBase64
  // ----------------------------------------------------------
  describe("blobToBase64", () => {
    it("Blob を base64 に変換し、atob でデコードすると元のバイト列に戻る", async () => {
      const bytes = new Uint8Array([65, 66, 67]); // "ABC"

      // Node.js 18+ には global.Blob が存在する
      // arrayBuffer() メソッドを持つ Blob モックを作成
      const mockBlob = {
        size: bytes.length,
        arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer),
      } as unknown as Blob;

      const base64 = await blobToBase64(mockBlob);

      const decoded = atob(base64);
      const decodedBytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        decodedBytes[i] = decoded.charCodeAt(i);
      }

      expect(Array.from(decodedBytes)).toEqual(Array.from(bytes));
    });

    it("大きい Blob（>8192バイト）でも正しく変換される", async () => {
      const size = 9000;
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        bytes[i] = (i * 3) % 256;
      }

      const mockBlob = {
        size: bytes.length,
        arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer),
      } as unknown as Blob;

      const base64 = await blobToBase64(mockBlob);
      const decoded = atob(base64);

      expect(decoded.length).toBe(size);
      for (let i = 0; i < size; i++) {
        expect(decoded.charCodeAt(i)).toBe((i * 3) % 256);
      }
    });
  });

  // ----------------------------------------------------------
  // 4. getSupportedMimeType
  // ----------------------------------------------------------
  describe("getSupportedMimeType", () => {
    it("window が未定義のとき undefined を返す", () => {
      // window を undefined に設定してSSR環境をシミュレート
      (global as Record<string, unknown>).window = undefined;

      const result = getSupportedMimeType();
      expect(result).toBeUndefined();
    });

    it('"audio/webm;codecs=opus" がサポートされていればそれを返す', () => {
      // window を存在する状態にする
      (global as Record<string, unknown>).window = global;

      MockMediaRecorder.isTypeSupported.mockImplementation(
        (mimeType: string) => mimeType === "audio/webm;codecs=opus"
      );

      const result = getSupportedMimeType();
      expect(result).toBe("audio/webm;codecs=opus");
    });

    it('"audio/webm;codecs=opus" が非対応で "audio/webm" がサポートされているとき "audio/webm" を返す', () => {
      (global as Record<string, unknown>).window = global;

      MockMediaRecorder.isTypeSupported.mockImplementation(
        (mimeType: string) => mimeType === "audio/webm"
      );

      const result = getSupportedMimeType();
      expect(result).toBe("audio/webm");
    });

    it('"audio/ogg;codecs=opus" がサポートされているとき（上位2つが非対応）そちらを返す', () => {
      (global as Record<string, unknown>).window = global;

      MockMediaRecorder.isTypeSupported.mockImplementation(
        (mimeType: string) => mimeType === "audio/ogg;codecs=opus"
      );

      const result = getSupportedMimeType();
      expect(result).toBe("audio/ogg;codecs=opus");
    });

    it("全ての mimeType が非対応のとき undefined を返す", () => {
      (global as Record<string, unknown>).window = global;

      MockMediaRecorder.isTypeSupported.mockReturnValue(false);

      const result = getSupportedMimeType();
      expect(result).toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // 5. startRecording
  // ----------------------------------------------------------
  describe("startRecording", () => {
    beforeEach(() => {
      // window を存在する状態にする（getSupportedMimeType のため）
      (global as Record<string, unknown>).window = global;
    });

    it("サポートされた mimeType（audio/webm;codecs=opus）で MediaRecorder が生成される", () => {
      MockMediaRecorder.isTypeSupported.mockImplementation(
        (mimeType: string) => mimeType === "audio/webm;codecs=opus"
      );

      const stream = makeMockStream();
      const onChunk = jest.fn();

      startRecording(stream, onChunk);

      const recorder = MockMediaRecorder.getLastInstance();
      expect(recorder).toBeDefined();
      expect(recorder.options.mimeType).toBe("audio/webm;codecs=opus");
    });

    it("start(chunkMs) が既定値（250）で呼ばれる", () => {
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);

      const stream = makeMockStream();
      const onChunk = jest.fn();

      startRecording(stream, onChunk);

      const recorder = MockMediaRecorder.getLastInstance();
      expect(recorder.start).toHaveBeenCalledWith(DEFAULT_CHUNK_MS);
    });

    it("chunkMs を指定すると start() がその値で呼ばれる", () => {
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);

      const stream = makeMockStream();
      const onChunk = jest.fn();

      startRecording(stream, onChunk, 500);

      const recorder = MockMediaRecorder.getLastInstance();
      expect(recorder.start).toHaveBeenCalledWith(500);
    });

    it("ondataavailable に Blob を発火すると onChunk が base64 文字列で呼ばれる", async () => {
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);

      const stream = makeMockStream();
      const onChunk = jest.fn();

      startRecording(stream, onChunk);

      const recorder = MockMediaRecorder.getLastInstance();

      // Blob モック（size > 0 でないと無視される）
      const bytes = new Uint8Array([1, 2, 3]);
      const mockBlob = {
        size: bytes.length,
        arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer),
      } as unknown as Blob;

      recorder.simulateDataAvailable(mockBlob);

      // 非同期変換を待つ
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(onChunk).toHaveBeenCalledTimes(1);
      // base64 文字列が渡されていることを確認
      const base64 = onChunk.mock.calls[0][0] as string;
      expect(typeof base64).toBe("string");
      expect(base64.length).toBeGreaterThan(0);

      // デコードして元のバイト列と一致するか確認
      const decoded = atob(base64);
      expect(decoded.charCodeAt(0)).toBe(1);
      expect(decoded.charCodeAt(1)).toBe(2);
      expect(decoded.charCodeAt(2)).toBe(3);
    });

    it("size=0 の Blob が来ても onChunk は呼ばれない", async () => {
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);

      const stream = makeMockStream();
      const onChunk = jest.fn();

      startRecording(stream, onChunk);

      const recorder = MockMediaRecorder.getLastInstance();
      const emptyBlob = { size: 0 } as unknown as Blob;
      recorder.simulateDataAvailable(emptyBlob);

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(onChunk).not.toHaveBeenCalled();
    });

    it("stop() で recorder.stop が呼ばれ、stream のトラックが解放される", () => {
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);

      const stream = makeMockStream();
      const onChunk = jest.fn();

      const handle = startRecording(stream, onChunk);

      // recording 状態に設定
      const recorder = MockMediaRecorder.getLastInstance();
      recorder.state = "recording";

      handle.stop();

      expect(recorder.stop).toHaveBeenCalledTimes(1);

      // stream のトラック（track.stop）が呼ばれていることを確認
      const tracks = stream.getTracks();
      tracks.forEach((track) => {
        expect(track.stop).toHaveBeenCalledTimes(1);
      });
    });

    it("stop() で state が inactive のとき recorder.stop は呼ばれない", () => {
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);

      const stream = makeMockStream();
      const onChunk = jest.fn();

      const handle = startRecording(stream, onChunk);

      // start() が呼ばれると MockMediaRecorder の実装で "recording" になるが、
      // テスト目的でここで "inactive" に戻す
      const recorder = MockMediaRecorder.getLastInstance();
      recorder.state = "inactive";

      handle.stop();

      // inactive 状態なので recorder.stop は呼ばれない
      expect(recorder.stop).not.toHaveBeenCalled();
      // stream のトラックは状態に関わらず解放される
      const tracks = stream.getTracks();
      tracks.forEach((track) => {
        expect(track.stop).toHaveBeenCalledTimes(1);
      });
    });
  });
});
