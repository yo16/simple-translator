/**
 * @jest-environment jsdom
 */

/**
 * useRecorder カスタムフックの単体テスト
 *
 * navigator.mediaDevices.getUserMedia と src/lib/audio.ts の startRecording を
 * jest.mock / global モックで差し替えて検証する。
 */

import { renderHook, act } from "@testing-library/react";
import { useRecorder } from "../../src/hooks/useRecorder";
import type { UseRecorderOptions } from "../../src/hooks/useRecorder";

// ============================================================
// jest.mock — audio モジュール全体をモック
// ============================================================

const mockStartRecording = jest.fn();
const mockStop = jest.fn();

jest.mock("../../src/lib/audio", () => ({
  startRecording: (...args: unknown[]) => mockStartRecording(...args),
  DEFAULT_CHUNK_MS: 250,
}));

// ============================================================
// MediaStream / MediaTrack モックヘルパー
// ============================================================

function makeMockTrack(): MediaStreamTrack {
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

function makeMockStream(tracks: MediaStreamTrack[] = []): MediaStream {
  const mockTracks = tracks.length > 0 ? tracks : [makeMockTrack()];
  return {
    getTracks: jest.fn().mockReturnValue(mockTracks),
    getAudioTracks: jest.fn().mockReturnValue(mockTracks),
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

// ============================================================
// getUserMedia のモック管理
// ============================================================

let mockGetUserMedia: jest.Mock;

beforeEach(() => {
  mockStop.mockReset();
  mockStartRecording.mockReset();
  mockStartRecording.mockReturnValue({ stop: mockStop });

  // navigator.mediaDevices.getUserMedia を差し替え
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
// テストスイート
// ============================================================

describe("useRecorder", () => {
  // ----------------------------------------------------------
  // 1. startMicRecording — 正常系
  // ----------------------------------------------------------
  describe("startMicRecording — 正常系", () => {
    it("getUserMedia が成功すると startRecording が呼ばれ true を返す", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk }));

      let success = false;
      await act(async () => {
        success = await result.current.startMicRecording(250);
      });

      expect(success).toBe(true);
      expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    it("startRecording に stream と onChunk コールバックと chunkMs が渡される", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk }));

      await act(async () => {
        await result.current.startMicRecording(500);
      });

      expect(mockStartRecording).toHaveBeenCalledWith(
        mockStream,
        expect.any(Function),
        500
      );
    });

    it("chunkMs を省略した場合も startRecording が呼ばれる", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk }));

      await act(async () => {
        await result.current.startMicRecording();
      });

      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    it("startRecording に渡された onChunk コールバックが実際の onChunk を呼び出す", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk }));

      await act(async () => {
        await result.current.startMicRecording(250);
      });

      // startRecording に渡されたコールバックを取得して呼び出す
      const capturedOnChunk = mockStartRecording.mock.calls[0][1] as (base64: string) => void;
      capturedOnChunk("base64audiodata");

      expect(onChunk).toHaveBeenCalledWith("base64audiodata");
    });
  });

  // ----------------------------------------------------------
  // 2. startMicRecording — 失敗系（権限拒否）
  // ----------------------------------------------------------
  describe("startMicRecording — 失敗系", () => {
    it("getUserMedia が失敗（権限拒否）すると onError が呼ばれ false を返す", async () => {
      const permissionError = new Error("Permission denied");
      mockGetUserMedia.mockRejectedValue(permissionError);

      const onChunk = jest.fn();
      const onError = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk, onError }));

      let success = true;
      await act(async () => {
        success = await result.current.startMicRecording();
      });

      expect(success).toBe(false);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("Permission denied")
      );
    });

    it("getUserMedia が失敗すると startRecording は呼ばれない", async () => {
      mockGetUserMedia.mockRejectedValue(new Error("No device"));

      const onChunk = jest.fn();
      const onError = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk, onError }));

      await act(async () => {
        await result.current.startMicRecording();
      });

      expect(mockStartRecording).not.toHaveBeenCalled();
    });

    it("Error 以外のオブジェクトが throw された場合も onError が呼ばれる", async () => {
      mockGetUserMedia.mockRejectedValue("string error");

      const onChunk = jest.fn();
      const onError = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk, onError }));

      await act(async () => {
        await result.current.startMicRecording();
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith("マイクへのアクセスに失敗しました");
    });
  });

  // ----------------------------------------------------------
  // 3. stopMicRecording
  // ----------------------------------------------------------
  describe("stopMicRecording", () => {
    it("録音中に stopMicRecording を呼ぶと handle.stop() が呼ばれる", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk }));

      await act(async () => {
        await result.current.startMicRecording();
      });

      act(() => {
        result.current.stopMicRecording();
      });

      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it("未録音状態で stopMicRecording を呼んでもエラーにならない", () => {
      const onChunk = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk }));

      expect(() => {
        act(() => {
          result.current.stopMicRecording();
        });
      }).not.toThrow();

      expect(mockStop).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 4. アンマウント時のクリーンアップ
  // ----------------------------------------------------------
  describe("アンマウント時のクリーンアップ", () => {
    it("録音中にアンマウントすると handle.stop() が呼ばれる", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk = jest.fn();
      const { result, unmount } = renderHook(() => useRecorder({ onChunk }));

      await act(async () => {
        await result.current.startMicRecording();
      });

      act(() => {
        unmount();
      });

      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it("未録音状態でアンマウントしても handle.stop() は呼ばれない", () => {
      const onChunk = jest.fn();
      const { unmount } = renderHook(() => useRecorder({ onChunk }));

      act(() => {
        unmount();
      });

      expect(mockStop).not.toHaveBeenCalled();
    });

    it("アンマウント時に MediaStream のトラックが解放される", async () => {
      const mockTrack = makeMockTrack();
      const mockStream = makeMockStream([mockTrack]);
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk = jest.fn();
      const { result, unmount } = renderHook(() => useRecorder({ onChunk }));

      await act(async () => {
        await result.current.startMicRecording();
      });

      act(() => {
        unmount();
      });

      // handle.stop() 内でトラック解放が行われる（audio.ts の startRecording が実際のモック）
      // ここでは useRecorder のクリーンアップコードが stop を呼んでいることを確認
      expect(mockStop).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // 5. アンマウント後の onChunk ガード
  // ----------------------------------------------------------
  describe("アンマウント後 onChunk ガード", () => {
    it("アンマウント後に startRecording のチャンクコールバックが発火しても onChunk は呼ばれない", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk = jest.fn();
      const { result, unmount } = renderHook(() => useRecorder({ onChunk }));

      await act(async () => {
        await result.current.startMicRecording();
      });

      // コールバック参照を保持してからアンマウント
      const capturedOnChunk = mockStartRecording.mock.calls[0][1] as (base64: string) => void;

      act(() => {
        unmount();
      });

      // アンマウント後にチャンクコールバックを呼ぶ
      act(() => {
        capturedOnChunk("アンマウント後のbase64データ");
      });

      expect(onChunk).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 6. 既存録音中に再度 startMicRecording を呼ぶ
  // ----------------------------------------------------------
  describe("既存録音中の再開始", () => {
    it("録音中に startMicRecording を再度呼ぶと既存の handle.stop() が呼ばれてから新しい録音が始まる", async () => {
      const mockStream1 = makeMockStream();
      const mockStream2 = makeMockStream();
      mockGetUserMedia
        .mockResolvedValueOnce(mockStream1)
        .mockResolvedValueOnce(mockStream2);

      const onChunk = jest.fn();
      const { result } = renderHook(() => useRecorder({ onChunk }));

      // 1回目の録音開始
      await act(async () => {
        await result.current.startMicRecording();
      });

      expect(mockStartRecording).toHaveBeenCalledTimes(1);
      expect(mockStop).not.toHaveBeenCalled();

      // 2回目の録音開始（既存を停止して再開始）
      await act(async () => {
        await result.current.startMicRecording();
      });

      expect(mockStop).toHaveBeenCalledTimes(1); // 既存の handle が stop された
      expect(mockStartRecording).toHaveBeenCalledTimes(2);
    });
  });

  // ----------------------------------------------------------
  // 7. onChunk の最新化（stale closure 対策）
  // ----------------------------------------------------------
  describe("onChunk の最新化", () => {
    it("onChunk が差し替えられても最新の onChunk が呼ばれる", async () => {
      const mockStream = makeMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const onChunk1 = jest.fn();
      const onChunk2 = jest.fn();

      const { result, rerender } = renderHook(
        ({ options }: { options: UseRecorderOptions }) => useRecorder(options),
        { initialProps: { options: { onChunk: onChunk1 } } }
      );

      await act(async () => {
        await result.current.startMicRecording();
      });

      // onChunk を差し替える
      act(() => {
        rerender({ options: { onChunk: onChunk2 } });
      });

      // capturedOnChunk を呼び出す（ref 経由で onChunk2 が呼ばれるはず）
      const capturedOnChunk = mockStartRecording.mock.calls[0][1] as (base64: string) => void;
      act(() => {
        capturedOnChunk("チャンクデータ");
      });

      expect(onChunk2).toHaveBeenCalledWith("チャンクデータ");
      expect(onChunk1).not.toHaveBeenCalled();
    });
  });
});
