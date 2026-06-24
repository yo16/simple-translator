/**
 * server/textToSpeech.ts の単体テスト
 *
 * Cloud Text-to-Speech クライアントはモックで差し替え、GCP への実通信は行わない。
 * synthesize()、isTtsEnabled()、getTtsClient() / setTtsClient() / resetTtsClient() を検証する。
 */

import {
  synthesize,
  isTtsEnabled,
  getTtsClient,
  setTtsClient,
  resetTtsClient,
} from "../../server/textToSpeech";

// ---------------------------------------------------------------------------
// テストヘルパー: モッククライアントのファクトリ
// ---------------------------------------------------------------------------

/**
 * `synthesizeSpeech` メソッドを持つ最小スタブを生成する。
 * `audioContent` を指定しない場合、デフォルトで Uint8Array([1, 2, 3]) を返す。
 */
function makeMockClient(audioContent: Uint8Array | Buffer | string | null = new Uint8Array([1, 2, 3])) {
  return {
    synthesizeSpeech: jest.fn().mockResolvedValue([{ audioContent }]),
  };
}

// ---------------------------------------------------------------------------
// 各テスト後にモジュールレベルのクライアントと env をリセットする
// ---------------------------------------------------------------------------
let originalEnableTts: string | undefined;

beforeEach(() => {
  originalEnableTts = process.env.ENABLE_TTS;
});

afterEach(() => {
  resetTtsClient();
  // env を元の値へ復元（テスト間の漏れを防ぐ）
  if (originalEnableTts === undefined) {
    delete process.env.ENABLE_TTS;
  } else {
    process.env.ENABLE_TTS = originalEnableTts;
  }
});

// ---------------------------------------------------------------------------
// 1. synthesize() — 合成結果の返却
// ---------------------------------------------------------------------------
describe("synthesize() — 合成結果の返却", () => {
  test("Uint8Array の audioContent が返ったとき、対応する base64 文字列を返す", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" のバイト列
    const mockClient = makeMockClient(bytes);

    // Act
    const result = await synthesize("hello", "en-US", mockClient as never);

    // Assert: null でない
    expect(result).not.toBeNull();
    // デコードすると元のバイト列に一致する
    const decoded = Buffer.from(result!, "base64");
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  test("Buffer の audioContent が返ったとき、対応する base64 文字列を返す", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const buf = Buffer.from([10, 20, 30, 40, 50]);
    const mockClient = makeMockClient(buf);

    // Act
    const result = await synthesize("hello", "en-US", mockClient as never);

    // Assert
    expect(result).not.toBeNull();
    const decoded = Buffer.from(result!, "base64");
    expect(Array.from(decoded)).toEqual(Array.from(buf));
  });

  test("base64 デコード後のバイト列が元のバイト列と完全に一致する", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const original = new Uint8Array([0xff, 0x00, 0x80, 0x40, 0x20]);
    const mockClient = makeMockClient(original);

    // Act
    const base64Result = await synthesize("test", "ja-JP", mockClient as never);

    // Assert
    expect(base64Result).not.toBeNull();
    const restored = Buffer.from(base64Result!, "base64");
    expect(Array.from(restored)).toEqual(Array.from(original));
  });
});

// ---------------------------------------------------------------------------
// 2. synthesize() — MP3 / audioConfig の検証
// ---------------------------------------------------------------------------
describe("synthesize() — MP3 / audioConfig の検証", () => {
  test("synthesizeSpeech が audioConfig.audioEncoding === 'MP3' で呼ばれる", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    await synthesize("hello", "en-US", mockClient as never);

    // Assert
    expect(mockClient.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        audioConfig: expect.objectContaining({
          audioEncoding: "MP3",
        }),
      })
    );
  });

  test("synthesizeSpeech の呼び出し引数に input.text が正しく含まれる", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();
    const inputText = "こんにちは";

    // Act
    await synthesize(inputText, "ja-JP", mockClient as never);

    // Assert
    expect(mockClient.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { text: inputText },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// 3. synthesize() — 言語コードがフルコードのまま渡る（重要）
// ---------------------------------------------------------------------------
describe("synthesize() — 言語コードがフルコードのまま渡る", () => {
  test("'en-US' を渡すと voice.languageCode が 'en-US' のまま API に渡る（2文字変換されない）", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    await synthesize("hello", "en-US", mockClient as never);

    // Assert: フルコードのまま渡ること
    const callArg = mockClient.synthesizeSpeech.mock.calls[0][0] as { voice: { languageCode: string } };
    expect(callArg.voice.languageCode).toBe("en-US");
  });

  test("'ja-JP' を渡すと voice.languageCode が 'ja-JP' のまま API に渡る（2文字変換されない）", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    await synthesize("こんにちは", "ja-JP", mockClient as never);

    // Assert: フルコードのまま渡ること
    const callArg = mockClient.synthesizeSpeech.mock.calls[0][0] as { voice: { languageCode: string } };
    expect(callArg.voice.languageCode).toBe("ja-JP");
  });

  test("toHaveBeenCalledWith を使って voice.languageCode === 'en-US' を検証する", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    await synthesize("hello world", "en-US", mockClient as never);

    // Assert
    expect(mockClient.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: expect.objectContaining({
          languageCode: "en-US",
        }),
      })
    );
  });

  test("toHaveBeenCalledWith を使って voice.languageCode === 'ja-JP' を検証する", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    await synthesize("日本語のテキスト", "ja-JP", mockClient as never);

    // Assert
    expect(mockClient.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: expect.objectContaining({
          languageCode: "ja-JP",
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// 4. synthesize() — ENABLE_TTS=false でスキップ
// ---------------------------------------------------------------------------
describe("synthesize() — ENABLE_TTS=false でスキップ", () => {
  test("ENABLE_TTS='false' のとき synthesize() が null を返す", async () => {
    // Arrange
    process.env.ENABLE_TTS = "false";
    const mockClient = makeMockClient();

    // Act
    const result = await synthesize("hello", "en-US", mockClient as never);

    // Assert
    expect(result).toBeNull();
  });

  test("ENABLE_TTS='false' のとき synthesizeSpeech が呼ばれない", async () => {
    // Arrange
    process.env.ENABLE_TTS = "false";
    const mockClient = makeMockClient();

    // Act
    await synthesize("hello", "en-US", mockClient as never);

    // Assert
    expect(mockClient.synthesizeSpeech).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. synthesize() — ENABLE_TTS デフォルト（未設定）
// ---------------------------------------------------------------------------
describe("synthesize() — ENABLE_TTS 未設定（デフォルト有効）", () => {
  test("ENABLE_TTS が未設定のとき synthesize() が null でない値を返す（合成が実行される）", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    const result = await synthesize("hello", "en-US", mockClient as never);

    // Assert
    expect(result).not.toBeNull();
  });

  test("ENABLE_TTS が未設定のとき synthesizeSpeech が1回呼ばれる", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    await synthesize("hello", "en-US", mockClient as never);

    // Assert
    expect(mockClient.synthesizeSpeech).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. isTtsEnabled() / ENABLE_TTS その他の値
// ---------------------------------------------------------------------------
describe("isTtsEnabled() — 単体検証", () => {
  test("ENABLE_TTS が未設定のとき isTtsEnabled() は true を返す", () => {
    // Arrange
    delete process.env.ENABLE_TTS;

    // Act & Assert
    expect(isTtsEnabled()).toBe(true);
  });

  test("ENABLE_TTS='false' のとき isTtsEnabled() は false を返す", () => {
    // Arrange
    process.env.ENABLE_TTS = "false";

    // Act & Assert
    expect(isTtsEnabled()).toBe(false);
  });

  test("ENABLE_TTS='0' のとき isTtsEnabled() は true を返す（'false' 以外は有効）", () => {
    // Arrange
    process.env.ENABLE_TTS = "0";

    // Act & Assert
    expect(isTtsEnabled()).toBe(true);
  });

  test("ENABLE_TTS='true' のとき isTtsEnabled() は true を返す", () => {
    // Arrange
    process.env.ENABLE_TTS = "true";

    // Act & Assert
    expect(isTtsEnabled()).toBe(true);
  });

  test("ENABLE_TTS='' (空文字列) のとき isTtsEnabled() は true を返す（'false' 以外は有効）", () => {
    // Arrange
    process.env.ENABLE_TTS = "";

    // Act & Assert
    expect(isTtsEnabled()).toBe(true);
  });

  test("ENABLE_TTS='False'（大文字混じり）のとき isTtsEnabled() は true を返す（厳密一致）", () => {
    // Arrange
    process.env.ENABLE_TTS = "False";

    // Act & Assert
    expect(isTtsEnabled()).toBe(true);
  });
});

describe("synthesize() — ENABLE_TTS その他の値で合成が実行される", () => {
  test("ENABLE_TTS='0' のとき synthesize() が null でない値を返す（有効扱い）", async () => {
    // Arrange
    process.env.ENABLE_TTS = "0";
    const mockClient = makeMockClient();

    // Act
    const result = await synthesize("hello", "en-US", mockClient as never);

    // Assert
    expect(result).not.toBeNull();
    expect(mockClient.synthesizeSpeech).toHaveBeenCalledTimes(1);
  });

  test("ENABLE_TTS='true' のとき synthesize() が null でない値を返す（有効扱い）", async () => {
    // Arrange
    process.env.ENABLE_TTS = "true";
    const mockClient = makeMockClient();

    // Act
    const result = await synthesize("hello", "en-US", mockClient as never);

    // Assert
    expect(result).not.toBeNull();
    expect(mockClient.synthesizeSpeech).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 7. synthesize() — 空テキストのスキップ
// ---------------------------------------------------------------------------
describe("synthesize() — 空テキストのスキップ", () => {
  test("空文字列 '' を渡すと synthesizeSpeech が呼ばれず null を返す", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    const result = await synthesize("", "en-US", mockClient as never);

    // Assert
    expect(result).toBeNull();
    expect(mockClient.synthesizeSpeech).not.toHaveBeenCalled();
  });

  test("空白のみ '   ' を渡すと synthesizeSpeech が呼ばれず null を返す", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    const result = await synthesize("   ", "en-US", mockClient as never);

    // Assert
    expect(result).toBeNull();
    expect(mockClient.synthesizeSpeech).not.toHaveBeenCalled();
  });

  test("タブや改行のみの文字列でも API を呼ばず null を返す", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient();

    // Act
    const result = await synthesize("\t\n", "ja-JP", mockClient as never);

    // Assert
    expect(result).toBeNull();
    expect(mockClient.synthesizeSpeech).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. synthesize() — エラー伝播
// ---------------------------------------------------------------------------
describe("synthesize() — エラー伝播", () => {
  test("synthesizeSpeech が reject すると synthesize() が例外を投げる", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = {
      synthesizeSpeech: jest.fn().mockRejectedValue(new Error("GCP internal error details")),
    };

    // Act & Assert
    await expect(
      synthesize("hello", "en-US", mockClient as never)
    ).rejects.toThrow();
  });

  test("GCP の内部詳細メッセージがそのまま外部に漏れず、汎用メッセージで包まれる", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const gcpInternalError = new Error(
      "PERMISSION_DENIED: Cloud Text-to-Speech API has not been used in project xyz before"
    );
    const mockClient = {
      synthesizeSpeech: jest.fn().mockRejectedValue(gcpInternalError),
    };

    // Act
    let thrownError: Error | undefined;
    try {
      await synthesize("hello", "en-US", mockClient as never);
    } catch (e) {
      thrownError = e as Error;
    }

    // Assert: 汎用メッセージで包まれていること（GCP 詳細がそのまま出ない）
    expect(thrownError).toBeDefined();
    expect(thrownError!.message).not.toBe(
      "PERMISSION_DENIED: Cloud Text-to-Speech API has not been used in project xyz before"
    );
    expect(thrownError!.message).toBe("Text-to-Speech failed. Please try again.");
  });

  test("synthesizeSpeech が文字列エラーで reject しても汎用メッセージの例外が投げられる", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = {
      synthesizeSpeech: jest.fn().mockRejectedValue("some string error"),
    };

    // Act & Assert
    await expect(
      synthesize("hello", "en-US", mockClient as never)
    ).rejects.toThrow("Text-to-Speech failed. Please try again.");
  });

  test("audioContent が null の場合 synthesize() は null を返す（例外を投げない）", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const mockClient = makeMockClient(null);

    // Act
    const result = await synthesize("hello", "en-US", mockClient as never);

    // Assert: audioContent が null のときは null を返す（クラッシュしない）
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. getTtsClient() / setTtsClient() / resetTtsClient() — シングルトン制御
// ---------------------------------------------------------------------------
describe("setTtsClient() / getTtsClient() / resetTtsClient() — シングルトン制御", () => {
  test("setTtsClient() で差し替えたクライアントが getTtsClient() で取得できる", () => {
    // Arrange
    const mockClient = makeMockClient();

    // Act
    setTtsClient(mockClient as never);

    // Assert
    expect(getTtsClient()).toBe(mockClient);
  });

  test("getTtsClient() を2回呼んでも同一インスタンスが返る（シングルトン）", () => {
    // Arrange
    const mockClient = makeMockClient();
    setTtsClient(mockClient as never);

    // Act
    const first = getTtsClient();
    const second = getTtsClient();

    // Assert
    expect(first).toBe(second);
  });

  test("resetTtsClient() 後に setTtsClient() で別のクライアントに差し替えられる", () => {
    // Arrange
    const firstMock = makeMockClient(new Uint8Array([1]));
    const secondMock = makeMockClient(new Uint8Array([2]));
    setTtsClient(firstMock as never);

    // Act: リセットしてから別のモックを設定
    resetTtsClient();
    setTtsClient(secondMock as never);

    // Assert
    expect(getTtsClient()).toBe(secondMock);
    expect(getTtsClient()).not.toBe(firstMock);
  });

  test("setTtsClient() で差し替えたモックが synthesize() 呼び出し時に使用される", async () => {
    // Arrange
    delete process.env.ENABLE_TTS;
    const bytes = new Uint8Array([99, 98, 97]);
    const mockClient = makeMockClient(bytes);
    setTtsClient(mockClient as never);

    // Act: 第3引数なしで呼ぶ（シングルトンが使われる）
    const result = await synthesize("hello", "en-US");

    // Assert
    expect(result).not.toBeNull();
    expect(mockClient.synthesizeSpeech).toHaveBeenCalledTimes(1);
    // デコードすると元のバイト列に一致する
    const decoded = Buffer.from(result!, "base64");
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});
