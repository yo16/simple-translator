/**
 * @jest-environment jsdom
 */

/**
 * useAudioQueue カスタムフックの単体テスト
 *
 * AudioContext / atob などのブラウザ API は global モックで差し替える。
 * jest.config.js の testEnvironment（node）は変更せず、このファイル先頭の
 * docblock（@jest-environment jsdom）でファイル単位で jsdom を使用する。
 *
 * renderHook は @testing-library/react を使用する（JSX 記法不要）。
 */

import { renderHook, act } from "@testing-library/react";
import { useAudioQueue } from "../../src/hooks/useAudioQueue";

// ============================================================
// モック AudioContext の型定義
// ============================================================

interface MockAudioBufferSource {
  buffer: AudioBuffer | null;
  connect: jest.Mock;
  start: jest.Mock;
  onended: (() => void) | null;
}

interface MockAudioContext {
  state: AudioContextState;
  currentTime: number;
  destination: AudioDestinationNode;
  decodeAudioData: jest.Mock;
  createBufferSource: jest.Mock;
  resume: jest.Mock;
  close: jest.Mock;
}

// ============================================================
// MockAudioBuffer — AudioBuffer の代替
// ============================================================

function makeMockAudioBuffer(duration = 1.0): AudioBuffer {
  return { duration } as unknown as AudioBuffer;
}

// ============================================================
// MockAudioContext ファクトリ
// ============================================================

function makeMockAudioContext(overrides: Partial<MockAudioContext> = {}): MockAudioContext {
  const ctx: MockAudioContext = {
    state: "running",
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    decodeAudioData: jest.fn().mockResolvedValue(makeMockAudioBuffer()),
    // 呼ぶたびに新しい source オブジェクトを返す（同一参照だと buffer の上書きで順序検証が壊れる）
    createBufferSource: jest.fn().mockImplementation((): MockAudioBufferSource => ({
      buffer: null,
      connect: jest.fn(),
      start: jest.fn(),
      onended: null,
    })),
    resume: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return ctx;
}

// ============================================================
// AudioContext コンストラクタモック管理
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalAudioContext: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalAtob: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AudioContextMockConstructor: jest.Mock;
let lastMockCtx: MockAudioContext;

beforeEach(() => {
  originalAudioContext = (window as Record<string, unknown>).AudioContext;
  originalAtob = (window as Record<string, unknown>).atob;

  // atob モック（base64 → binary string）
  (global as Record<string, unknown>).atob = (b64: string): string =>
    Buffer.from(b64, "base64").toString("binary");

  // AudioContext コンストラクタモック
  // 毎回新しい MockAudioContext インスタンスを生成し lastMockCtx に記録する
  AudioContextMockConstructor = jest.fn().mockImplementation(() => {
    lastMockCtx = makeMockAudioContext();
    return lastMockCtx;
  });

  (window as Record<string, unknown>).AudioContext = AudioContextMockConstructor;
});

afterEach(() => {
  (window as Record<string, unknown>).AudioContext = originalAudioContext;
  (global as Record<string, unknown>).atob = originalAtob;
  jest.clearAllMocks();
});

// ============================================================
// テスト用 base64 文字列（内容は任意）
// ============================================================

const TEST_BASE64 = Buffer.from("test-audio-data").toString("base64");

// ============================================================
// テストスイート
// ============================================================

describe("useAudioQueue", () => {
  // ----------------------------------------------------------
  // 1. 遅延生成
  // ----------------------------------------------------------
  describe("遅延生成", () => {
    it("フックを render しただけでは AudioContext が生成されない", () => {
      renderHook(() => useAudioQueue());
      expect(AudioContextMockConstructor).not.toHaveBeenCalled();
    });

    it("最初の enqueue で AudioContext が生成される", async () => {
      const { result } = renderHook(() => useAudioQueue());

      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        // Promise キューを flush
        await Promise.resolve();
      });

      expect(AudioContextMockConstructor).toHaveBeenCalledTimes(1);
    });

    it("2回目以降の enqueue では AudioContext が再生成されない", async () => {
      const { result } = renderHook(() => useAudioQueue());

      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await Promise.resolve();
      });

      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await Promise.resolve();
      });

      expect(AudioContextMockConstructor).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // 2. decodeAudioData → 再生
  // ----------------------------------------------------------
  describe("decodeAudioData → 再生", () => {
    it("enqueue すると decodeAudioData が呼ばれ、createBufferSource → connect → start で再生される", async () => {
      const { result } = renderHook(() => useAudioQueue());

      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        // 非同期処理を flush する（複数の Promise 連鎖に対応）
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      const ctx = lastMockCtx;
      expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);

      const source = ctx.createBufferSource.mock.results[0].value as MockAudioBufferSource;
      expect(source.connect).toHaveBeenCalledWith(ctx.destination);
      expect(source.start).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // 3. FIFO 順序（連続再生スケジュール）
  // ----------------------------------------------------------
  describe("FIFO 順序", () => {
    it("複数 enqueue でデコード解決順に関わらず enqueue 順（FIFO）に start される", async () => {
      // デコード1枚目: 遅延解決（200ms）、2枚目: 即時解決
      // enqueue 順: chunk1 → chunk2
      // 期待: chunk1 のソースが先に start され、chunk2 が後

      const mockAudioBuffer1 = makeMockAudioBuffer(1.0);
      const mockAudioBuffer2 = makeMockAudioBuffer(0.5);

      let resolveChunk1: (buf: AudioBuffer) => void;
      const chunk1Promise = new Promise<AudioBuffer>((resolve) => {
        resolveChunk1 = resolve;
      });

      let decodeCallCount = 0;
      AudioContextMockConstructor.mockImplementation(() => {
        lastMockCtx = makeMockAudioContext({
          currentTime: 0,
          decodeAudioData: jest.fn().mockImplementation(() => {
            decodeCallCount++;
            if (decodeCallCount === 1) {
              // chunk1: 遅延解決
              return chunk1Promise;
            } else {
              // chunk2: 即時解決
              return Promise.resolve(mockAudioBuffer2);
            }
          }),
        });
        return lastMockCtx;
      });

      const { result } = renderHook(() => useAudioQueue());

      // chunk1 と chunk2 を順に enqueue
      await act(async () => {
        result.current.enqueue(TEST_BASE64); // chunk1（遅延デコード）
        result.current.enqueue(TEST_BASE64); // chunk2（即時デコード）
        await Promise.resolve();
      });

      // chunk1 のデコードを解決する（chunk2 はすでに解決済み）
      await act(async () => {
        resolveChunk1!(mockAudioBuffer1);
        // Promise チェーンが settle するのを待つ
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      const ctx = lastMockCtx;
      const sources = ctx.createBufferSource.mock.results.map(
        (r) => r.value as MockAudioBufferSource
      );

      // 2つの source が生成されている（createBufferSource の呼ばれた順 = FIFO 順）
      expect(sources).toHaveLength(2);
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(2);

      // buffer に正しい AudioBuffer が設定されていることで enqueue 順を確認
      expect(sources[0].buffer).toBe(mockAudioBuffer1);
      expect(sources[1].buffer).toBe(mockAudioBuffer2);
    });

    it("連続再生：2枚目の startTime は 1枚目の startTime + duration（単調増加）", async () => {
      const mockAudioBuffer1 = makeMockAudioBuffer(1.5);
      const mockAudioBuffer2 = makeMockAudioBuffer(2.0);

      let decodeCallCount = 0;
      AudioContextMockConstructor.mockImplementation(() => {
        lastMockCtx = makeMockAudioContext({
          currentTime: 0,
          decodeAudioData: jest.fn().mockImplementation(() => {
            decodeCallCount++;
            return decodeCallCount === 1
              ? Promise.resolve(mockAudioBuffer1)
              : Promise.resolve(mockAudioBuffer2);
          }),
        });
        return lastMockCtx;
      });

      const { result } = renderHook(() => useAudioQueue());

      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      const ctx = lastMockCtx;
      const sources = ctx.createBufferSource.mock.results.map(
        (r) => r.value as MockAudioBufferSource
      );

      // 2つの source の start 引数を取得
      const startTime1 = sources[0].start.mock.calls[0][0] as number;
      const startTime2 = sources[1].start.mock.calls[0][0] as number;

      // 2枚目の開始時刻 = 1枚目の開始時刻 + 1枚目の duration
      expect(startTime2).toBeCloseTo(startTime1 + mockAudioBuffer1.duration, 5);
      // 単調増加
      expect(startTime2).toBeGreaterThan(startTime1);
    });
  });

  // ----------------------------------------------------------
  // 4. suspended resume
  // ----------------------------------------------------------
  describe("suspended resume", () => {
    it("ctx.state が suspended のとき enqueue で resume が呼ばれる", async () => {
      AudioContextMockConstructor.mockImplementation(() => {
        lastMockCtx = makeMockAudioContext({ state: "suspended" });
        return lastMockCtx;
      });

      const { result } = renderHook(() => useAudioQueue());

      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(lastMockCtx.resume).toHaveBeenCalledTimes(1);
    });

    it("ctx.state が running のとき resume は呼ばれない", async () => {
      AudioContextMockConstructor.mockImplementation(() => {
        lastMockCtx = makeMockAudioContext({ state: "running" });
        return lastMockCtx;
      });

      const { result } = renderHook(() => useAudioQueue());

      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(lastMockCtx.resume).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 5. アンマウント close
  // ----------------------------------------------------------
  describe("アンマウント close", () => {
    it("unmount で AudioContext.close() が呼ばれる", async () => {
      const { result, unmount } = renderHook(() => useAudioQueue());

      // AudioContext を生成するために enqueue を一度呼ぶ
      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      const ctx = lastMockCtx;
      expect(ctx.close).not.toHaveBeenCalled();

      act(() => {
        unmount();
      });

      expect(ctx.close).toHaveBeenCalledTimes(1);
    });

    it("AudioContext が未生成の状態でアンマウントしても close は呼ばれない", () => {
      const { unmount } = renderHook(() => useAudioQueue());

      // enqueue を呼ばずにアンマウント
      act(() => {
        unmount();
      });

      // AudioContext が生成されていないので close は呼ばれない
      expect(AudioContextMockConstructor).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 6. アンマウント後 enqueue ガード
  // ----------------------------------------------------------
  describe("アンマウント後 enqueue ガード", () => {
    it("unmount 後に enqueue を呼んでも新しい AudioContext が生成されない（リークしない）", async () => {
      const { result, unmount } = renderHook(() => useAudioQueue());

      // 先に enqueue して AudioContext を生成
      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      const ctorCallsBeforeUnmount = AudioContextMockConstructor.mock.calls.length;

      // アンマウント
      act(() => {
        unmount();
      });

      // アンマウント後に enqueue を呼ぶ
      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      // AudioContext のコンストラクタ呼び出し回数が増えていない
      expect(AudioContextMockConstructor).toHaveBeenCalledTimes(ctorCallsBeforeUnmount);
    });

    it("AudioContext 未生成のまま unmount 後に enqueue しても AudioContext が生成されない", async () => {
      const { result, unmount } = renderHook(() => useAudioQueue());

      // enqueue せずにアンマウント
      act(() => {
        unmount();
      });

      // アンマウント後に enqueue を呼ぶ
      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(AudioContextMockConstructor).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 7. reset
  // ----------------------------------------------------------
  describe("reset", () => {
    it("reset() で AudioContext.close() が呼ばれる", async () => {
      const { result } = renderHook(() => useAudioQueue());

      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      const ctx = lastMockCtx;

      await act(async () => {
        result.current.reset();
        await Promise.resolve();
      });

      expect(ctx.close).toHaveBeenCalledTimes(1);
    });

    it("reset() 後に enqueue すると新しい AudioContext が生成される", async () => {
      const { result } = renderHook(() => useAudioQueue());

      // 1回目の enqueue
      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(AudioContextMockConstructor).toHaveBeenCalledTimes(1);

      // reset で AudioContext を破棄
      await act(async () => {
        result.current.reset();
        await Promise.resolve();
      });

      // 2回目の enqueue で新しい AudioContext が生成される
      await act(async () => {
        result.current.enqueue(TEST_BASE64);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(AudioContextMockConstructor).toHaveBeenCalledTimes(2);
    });

    it("reset() は AudioContext が未生成のとき close を呼ばない", async () => {
      const { result } = renderHook(() => useAudioQueue());

      // enqueue せずに reset
      await act(async () => {
        result.current.reset();
        await Promise.resolve();
      });

      // AudioContext 未生成なのでコンストラクタも close も呼ばれない
      expect(AudioContextMockConstructor).not.toHaveBeenCalled();
    });
  });
});
