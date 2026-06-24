/**
 * server/speechStream.ts の単体テスト（タスク .4）
 *
 * Cloud Speech-to-Text Streaming クライアントはモックで差し替え、GCP への実通信は行わない。
 * createSpeechStream()、getSpeechClient() / setSpeechClient() / resetSpeechClient() を検証する。
 *
 * モック方式:
 *   streamingRecognize を jest.fn() として、戻り値に手動 EventEmitter 風スタブを使用する。
 *   スタブは { write, end, destroy, on } を持ち、on() は mockReturnThis() でチェーンを実現する。
 *   ハンドラは on() 呼び出し時にキャプチャし、テスト側から手動で emit 相当の呼び出しを行う。
 */

import {
  createSpeechStream,
  getSpeechClient,
  setSpeechClient,
  resetSpeechClient,
  SpeechStreamOptions,
} from "../../server/speechStream";
import { SpeechClient } from "@google-cloud/speech";

// ---------------------------------------------------------------------------
// テストヘルパー: streamingRecognize のモックストリームスタブ
// ---------------------------------------------------------------------------

/**
 * .on("data", ...).on("error", ...).on("end", ...) チェーンに対応するスタブ。
 * on() 呼び出し時にハンドラをキャプチャし、テスト側から手動でトリガーできる。
 */
function createMockRecognizeStream() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  const stream = {
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) {
        handlers[event] = [];
      }
      handlers[event].push(handler);
      return stream; // チェーンのため this 相当を返す
    }),
    // テスト側からイベントをトリガーするためのヘルパー
    emit(event: string, ...args: unknown[]) {
      const eventHandlers = handlers[event] ?? [];
      eventHandlers.forEach((h) => h(...args));
    },
  };

  return stream;
}

type MockRecognizeStream = ReturnType<typeof createMockRecognizeStream>;

/**
 * streamingRecognize を差し替えたモック SpeechClient を生成する。
 */
function createMockSpeechClient(mockStream: MockRecognizeStream) {
  return {
    streamingRecognize: jest.fn().mockReturnValue(mockStream),
  } as unknown as SpeechClient;
}

// ---------------------------------------------------------------------------
// 各テスト後にシングルトンをリセットする
// ---------------------------------------------------------------------------
afterEach(() => {
  resetSpeechClient();
});

// ---------------------------------------------------------------------------
// ヘルパー: デフォルトの SpeechStreamOptions を生成する
// ---------------------------------------------------------------------------
function makeOptions(overrides: Partial<SpeechStreamOptions> = {}): SpeechStreamOptions {
  return {
    languageCode: "ja-JP",
    onInterim: jest.fn(),
    onFinal: jest.fn(),
    onError: jest.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. streamingRecognize の設定検証
// ---------------------------------------------------------------------------
describe("createSpeechStream() — streamingRecognize の設定", () => {
  test("languageCode='ja-JP' で createSpeechStream を呼ぶと encoding=WEBM_OPUS / sampleRateHertz=48000 / enableAutomaticPunctuation=true / interimResults=true で streamingRecognize が呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const options = makeOptions({ languageCode: "ja-JP" });

    // Act
    createSpeechStream(options, mockClient);

    // Assert
    expect(mockClient.streamingRecognize).toHaveBeenCalledTimes(1);
    const callArg = (mockClient.streamingRecognize as jest.Mock).mock.calls[0][0];
    expect(callArg.config.encoding).toBe("WEBM_OPUS");
    expect(callArg.config.sampleRateHertz).toBe(48000);
    expect(callArg.config.enableAutomaticPunctuation).toBe(true);
    expect(callArg.interimResults).toBe(true);
    expect(callArg.config.languageCode).toBe("ja-JP");
  });

  test("languageCode が config.languageCode としてそのまま渡る（2文字化されない）: ja-JP → ja-JP", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const options = makeOptions({ languageCode: "ja-JP" });

    // Act
    createSpeechStream(options, mockClient);

    // Assert
    const callArg = (mockClient.streamingRecognize as jest.Mock).mock.calls[0][0];
    expect(callArg.config.languageCode).toBe("ja-JP");
    expect(callArg.config.languageCode).not.toBe("ja");
  });

  test("languageCode が config.languageCode としてそのまま渡る（2文字化されない）: en-US → en-US", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const options = makeOptions({ languageCode: "en-US" });

    // Act
    createSpeechStream(options, mockClient);

    // Assert
    const callArg = (mockClient.streamingRecognize as jest.Mock).mock.calls[0][0];
    expect(callArg.config.languageCode).toBe("en-US");
    expect(callArg.config.languageCode).not.toBe("en");
  });
});

// ---------------------------------------------------------------------------
// 2. handle.write() — Buffer がストリームへ渡る
// ---------------------------------------------------------------------------
describe("createSpeechStream() — handle.write() の動作", () => {
  test("handle.write(Buffer) を呼ぶとモックストリームの write が同じ Buffer で呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const options = makeOptions();
    const handle = createSpeechStream(options, mockClient);
    const chunk = Buffer.from([0x01, 0x02, 0x03]);

    // Act
    handle.write(chunk);

    // Assert
    expect(mockStream.write).toHaveBeenCalledTimes(1);
    expect(mockStream.write).toHaveBeenCalledWith(chunk);
  });

  test("複数回 write しても呼び出し回数分だけストリームの write が呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const handle = createSpeechStream(makeOptions(), mockClient);
    const buf1 = Buffer.from("chunk1");
    const buf2 = Buffer.from("chunk2");

    // Act
    handle.write(buf1);
    handle.write(buf2);

    // Assert
    expect(mockStream.write).toHaveBeenCalledTimes(2);
    expect(mockStream.write).toHaveBeenNthCalledWith(1, buf1);
    expect(mockStream.write).toHaveBeenNthCalledWith(2, buf2);
  });
});

// ---------------------------------------------------------------------------
// 3. data イベント — isFinal=true → onFinal が呼ばれ onInterim は呼ばれない
// ---------------------------------------------------------------------------
describe("createSpeechStream() — data イベント / isFinal=true", () => {
  test("isFinal=true の data イベントで onFinal(transcript) が呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onInterim = jest.fn();
    const onFinal = jest.fn();
    const options = makeOptions({ onInterim, onFinal });
    createSpeechStream(options, mockClient);

    // Act
    mockStream.emit("data", {
      results: [{ alternatives: [{ transcript: "こんにちは" }], isFinal: true }],
    });

    // Assert
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith("こんにちは");
    expect(onInterim).not.toHaveBeenCalled();
  });

  test("isFinal=true で複数回 data を emit すると onFinal が複数回呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onFinal = jest.fn();
    createSpeechStream(makeOptions({ onFinal }), mockClient);

    // Act
    mockStream.emit("data", {
      results: [{ alternatives: [{ transcript: "first" }], isFinal: true }],
    });
    mockStream.emit("data", {
      results: [{ alternatives: [{ transcript: "second" }], isFinal: true }],
    });

    // Assert
    expect(onFinal).toHaveBeenCalledTimes(2);
    expect(onFinal).toHaveBeenNthCalledWith(1, "first");
    expect(onFinal).toHaveBeenNthCalledWith(2, "second");
  });
});

// ---------------------------------------------------------------------------
// 4. data イベント — isFinal=false → onInterim が呼ばれ onFinal は呼ばれない
// ---------------------------------------------------------------------------
describe("createSpeechStream() — data イベント / isFinal=false", () => {
  test("isFinal=false の data イベントで onInterim(transcript) が呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onInterim = jest.fn();
    const onFinal = jest.fn();
    const options = makeOptions({ onInterim, onFinal });
    createSpeechStream(options, mockClient);

    // Act
    mockStream.emit("data", {
      results: [{ alternatives: [{ transcript: "hello" }], isFinal: false }],
    });

    // Assert
    expect(onInterim).toHaveBeenCalledTimes(1);
    expect(onInterim).toHaveBeenCalledWith("hello");
    expect(onFinal).not.toHaveBeenCalled();
  });

  test("isFinal=false → isFinal=true の順で data を emit すると onInterim → onFinal の順に呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onInterim = jest.fn();
    const onFinal = jest.fn();
    createSpeechStream(makeOptions({ onInterim, onFinal }), mockClient);

    // Act
    mockStream.emit("data", {
      results: [{ alternatives: [{ transcript: "interim text" }], isFinal: false }],
    });
    mockStream.emit("data", {
      results: [{ alternatives: [{ transcript: "final text" }], isFinal: true }],
    });

    // Assert
    expect(onInterim).toHaveBeenCalledTimes(1);
    expect(onInterim).toHaveBeenCalledWith("interim text");
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith("final text");
  });
});

// ---------------------------------------------------------------------------
// 5. 空 results / 空 alternatives のガード
// ---------------------------------------------------------------------------
describe("createSpeechStream() — 空 results / 空 alternatives のガード", () => {
  test("results が空配列 [] の data イベントで onInterim / onFinal が呼ばれない", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onInterim = jest.fn();
    const onFinal = jest.fn();
    createSpeechStream(makeOptions({ onInterim, onFinal }), mockClient);

    // Act
    mockStream.emit("data", { results: [] });

    // Assert
    expect(onInterim).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  test("results が undefined の data イベントで onInterim / onFinal が呼ばれない", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onInterim = jest.fn();
    const onFinal = jest.fn();
    createSpeechStream(makeOptions({ onInterim, onFinal }), mockClient);

    // Act
    mockStream.emit("data", {});

    // Assert
    expect(onInterim).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  test("alternatives が空配列 [] の data イベントで onInterim / onFinal が呼ばれない", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onInterim = jest.fn();
    const onFinal = jest.fn();
    createSpeechStream(makeOptions({ onInterim, onFinal }), mockClient);

    // Act
    mockStream.emit("data", {
      results: [{ alternatives: [], isFinal: true }],
    });

    // Assert
    expect(onInterim).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  test("alternatives が undefined の data イベントで onInterim / onFinal が呼ばれない", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onInterim = jest.fn();
    const onFinal = jest.fn();
    createSpeechStream(makeOptions({ onInterim, onFinal }), mockClient);

    // Act
    mockStream.emit("data", {
      results: [{ isFinal: true }],
    });

    // Assert
    expect(onInterim).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. error イベント — タイムアウトエラー
// ---------------------------------------------------------------------------
describe("createSpeechStream() — error イベント / タイムアウト", () => {
  test("error イベントで 'DEADLINE_EXCEEDED' を含むメッセージが来ると onError が fatal=false で呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onError = jest.fn();
    createSpeechStream(makeOptions({ onError }), mockClient);

    // Act
    mockStream.emit("error", new Error("4 DEADLINE_EXCEEDED: context deadline exceeded"));

    // Assert
    expect(onError).toHaveBeenCalledTimes(1);
    const [message, fatal] = (onError as jest.Mock).mock.calls[0];
    expect(fatal).toBe(false);
    // タイムアウト相当の文言を含む汎用メッセージ
    expect(message).toContain("timed out");
  });

  test("error イベントで 'Audio Timeout' を含むメッセージが来ると onError が fatal=false で呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onError = jest.fn();
    createSpeechStream(makeOptions({ onError }), mockClient);

    // Act
    mockStream.emit("error", new Error("Audio Timeout Error: audio data not received"));

    // Assert
    expect(onError).toHaveBeenCalledTimes(1);
    const [message, fatal] = (onError as jest.Mock).mock.calls[0];
    expect(fatal).toBe(false);
    expect(message).toContain("timed out");
  });

  test("error イベントで 'audio timeout'（小文字）を含むメッセージが来ると onError が fatal=false で呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onError = jest.fn();
    createSpeechStream(makeOptions({ onError }), mockClient);

    // Act
    mockStream.emit("error", new Error("audio timeout reached"));

    // Assert
    expect(onError).toHaveBeenCalledTimes(1);
    const [, fatal] = (onError as jest.Mock).mock.calls[0];
    expect(fatal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. error イベント — その他のエラー
// ---------------------------------------------------------------------------
describe("createSpeechStream() — error イベント / その他のエラー", () => {
  test("タイムアウト以外のエラーで onError が fatal=false で呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onError = jest.fn();
    createSpeechStream(makeOptions({ onError }), mockClient);

    // Act
    mockStream.emit("error", new Error("PERMISSION_DENIED: service account has no permission"));

    // Assert
    expect(onError).toHaveBeenCalledTimes(1);
    const [message, fatal] = (onError as jest.Mock).mock.calls[0];
    expect(fatal).toBe(false);
    // GCP 内部の詳細が漏れていないこと（汎用メッセージ）
    expect(message).not.toContain("PERMISSION_DENIED");
    expect(message).not.toContain("service account");
  });

  test("タイムアウト以外のエラーメッセージは汎用的な文言になる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const onError = jest.fn();
    createSpeechStream(makeOptions({ onError }), mockClient);

    // Act
    mockStream.emit("error", new Error("UNAVAILABLE: connection refused"));

    // Assert
    const [message] = (onError as jest.Mock).mock.calls[0];
    // 汎用メッセージであること
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    // GCP 詳細が含まれていないこと
    expect(message).not.toContain("UNAVAILABLE");
    expect(message).not.toContain("connection refused");
  });

  test("タイムアウトエラーはタイムアウト専用メッセージ、その他エラーは別のメッセージになる", () => {
    // Arrange
    const mockStream1 = createMockRecognizeStream();
    const mockClient1 = createMockSpeechClient(mockStream1);
    const onError1 = jest.fn();
    createSpeechStream(makeOptions({ onError: onError1 }), mockClient1);

    const mockStream2 = createMockRecognizeStream();
    const mockClient2 = createMockSpeechClient(mockStream2);
    const onError2 = jest.fn();
    createSpeechStream(makeOptions({ onError: onError2 }), mockClient2);

    // Act
    mockStream1.emit("error", new Error("DEADLINE_EXCEEDED: timeout"));
    mockStream2.emit("error", new Error("INTERNAL: unexpected error"));

    // Assert: タイムアウトと通常エラーでメッセージが異なること
    const [timeoutMessage] = (onError1 as jest.Mock).mock.calls[0];
    const [otherMessage] = (onError2 as jest.Mock).mock.calls[0];
    expect(timeoutMessage).not.toBe(otherMessage);
  });
});

// ---------------------------------------------------------------------------
// 8. handle.end() / handle.destroy()
// ---------------------------------------------------------------------------
describe("createSpeechStream() — handle.end() / handle.destroy()", () => {
  test("handle.end() を呼ぶとモックストリームの end() が呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const handle = createSpeechStream(makeOptions(), mockClient);

    // Act
    handle.end();

    // Assert
    expect(mockStream.end).toHaveBeenCalledTimes(1);
  });

  test("handle.destroy() を呼ぶとモックストリームの destroy() が呼ばれる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const handle = createSpeechStream(makeOptions(), mockClient);

    // Act
    handle.destroy();

    // Assert
    expect(mockStream.destroy).toHaveBeenCalledTimes(1);
  });

  test("handle.end() を複数回呼んでもエラーが起きない", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    const handle = createSpeechStream(makeOptions(), mockClient);

    // Act & Assert: 例外が投げられないこと
    expect(() => {
      handle.end();
      handle.end();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. シングルトン: getSpeechClient / setSpeechClient / resetSpeechClient
// ---------------------------------------------------------------------------
describe("getSpeechClient() / setSpeechClient() / resetSpeechClient() — シングルトン制御", () => {
  test("setSpeechClient() で差し替えたクライアントが getSpeechClient() で取得できる", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);

    // Act
    setSpeechClient(mockClient);

    // Assert
    expect(getSpeechClient()).toBe(mockClient);
  });

  test("getSpeechClient() を2回呼んでも同一インスタンスが返る（シングルトン）", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    setSpeechClient(mockClient);

    // Act
    const first = getSpeechClient();
    const second = getSpeechClient();

    // Assert
    expect(first).toBe(second);
  });

  test("resetSpeechClient() 後に setSpeechClient() で別のクライアントに差し替えられる", () => {
    // Arrange
    const firstStream = createMockRecognizeStream();
    const firstClient = createMockSpeechClient(firstStream);
    const secondStream = createMockRecognizeStream();
    const secondClient = createMockSpeechClient(secondStream);
    setSpeechClient(firstClient);

    // Act
    resetSpeechClient();
    setSpeechClient(secondClient);

    // Assert
    expect(getSpeechClient()).toBe(secondClient);
    expect(getSpeechClient()).not.toBe(firstClient);
  });

  test("setSpeechClient() で差し替えたモックが createSpeechStream() で使用される（引数省略時）", () => {
    // Arrange
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);
    setSpeechClient(mockClient);

    // Act: client 引数なしで呼ぶ（シングルトンが使われる）
    createSpeechStream(makeOptions());

    // Assert: シングルトンのモックが呼ばれていること
    expect(mockClient.streamingRecognize).toHaveBeenCalledTimes(1);
  });

  test("resetSpeechClient() 後に setSpeechClient() なしで createSpeechStream を呼んでも、client 引数を渡せば動作する", () => {
    // Arrange
    resetSpeechClient(); // null に戻す
    const mockStream = createMockRecognizeStream();
    const mockClient = createMockSpeechClient(mockStream);

    // Act: client 引数を明示的に渡す
    expect(() => {
      createSpeechStream(makeOptions(), mockClient);
    }).not.toThrow();

    // Assert
    expect(mockClient.streamingRecognize).toHaveBeenCalledTimes(1);
  });
});
