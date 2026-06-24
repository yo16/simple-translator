/**
 * server/translate.ts の単体テスト
 *
 * Cloud Translation v2 クライアントはモックで差し替え、GCP への実通信は行わない。
 * translate()、toTranslationLangCode()、getTranslateClient() / setTranslateClient() /
 * resetTranslateClient() を検証する。
 */

import {
  translate,
  toTranslationLangCode,
  getTranslateClient,
  setTranslateClient,
  resetTranslateClient,
} from "../../server/translate";

// ---------------------------------------------------------------------------
// テストヘルパー: モッククライアントのファクトリ
// ---------------------------------------------------------------------------

/**
 * `translate` メソッドを持つ最小スタブを生成する。
 * `returnValue` を指定しない場合、デフォルトで空文字列を返す。
 */
function makeMockClient(returnValue: [string, unknown] = ["", {}]) {
  return {
    translate: jest.fn().mockResolvedValue(returnValue),
  };
}

// ---------------------------------------------------------------------------
// 各テスト後にモジュールレベルのクライアントをリセットする
// ---------------------------------------------------------------------------
afterEach(() => {
  resetTranslateClient();
});

// ---------------------------------------------------------------------------
// 1. translate() — 翻訳結果の返却
// ---------------------------------------------------------------------------
describe("translate() — 翻訳結果の返却", () => {
  test("モッククライアントが [訳文, metadata] を返すとき、translate() が訳文文字列を返す", async () => {
    // Arrange
    const mockClient = makeMockClient(["こんにちは", {}]);

    // Act
    const result = await translate("Hello", "en-US", "ja-JP", mockClient as never);

    // Assert
    expect(result).toBe("こんにちは");
  });

  test("日本語→英語の翻訳結果が正しく返される", async () => {
    // Arrange
    const mockClient = makeMockClient(["Good morning", {}]);

    // Act
    const result = await translate("おはようございます", "ja-JP", "en-US", mockClient as never);

    // Assert
    expect(result).toBe("Good morning");
  });

  test("モッククライアントが空文字列の訳文を返すとき、空文字列が返る", async () => {
    // Arrange
    const mockClient = makeMockClient(["", {}]);

    // Act
    const result = await translate("test", "en-US", "ja-JP", mockClient as never);

    // Assert
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 2. translate() — 空文字列・空白のみの早期リターン
// ---------------------------------------------------------------------------
describe("translate() — 空文字列・空白のみの早期リターン", () => {
  test("空文字列 '' を渡すと、モッククライアントの translate が呼ばれず空文字列が返る", async () => {
    // Arrange
    const mockClient = makeMockClient(["これは呼ばれない", {}]);

    // Act
    const result = await translate("", "en-US", "ja-JP", mockClient as never);

    // Assert
    expect(result).toBe("");
    expect(mockClient.translate).not.toHaveBeenCalled();
  });

  test("空白のみ '   ' を渡すと、モッククライアントの translate が呼ばれず空文字列が返る", async () => {
    // Arrange
    const mockClient = makeMockClient(["これは呼ばれない", {}]);

    // Act
    const result = await translate("   ", "en-US", "ja-JP", mockClient as never);

    // Assert
    expect(result).toBe("");
    expect(mockClient.translate).not.toHaveBeenCalled();
  });

  test("タブや改行のみの文字列でも API を呼ばず空文字列が返る", async () => {
    // Arrange
    const mockClient = makeMockClient(["これは呼ばれない", {}]);

    // Act
    const result = await translate("\t\n", "en-US", "ja-JP", mockClient as never);

    // Assert
    expect(result).toBe("");
    expect(mockClient.translate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. translate() — 言語コード変換（最重要: ja-JP/en-US → ja/en に変換されること）
// ---------------------------------------------------------------------------
describe("translate() — 言語コード変換", () => {
  test("en-US→ja-JP 指定のとき、モッククライアントに { from: 'en', to: 'ja' } で渡る", async () => {
    // Arrange
    const mockClient = makeMockClient(["こんにちは", {}]);

    // Act
    await translate("Hello", "en-US", "ja-JP", mockClient as never);

    // Assert: 2文字コードに変換されていること
    expect(mockClient.translate).toHaveBeenCalledWith("Hello", { from: "en", to: "ja" });
  });

  test("ja-JP→en-US 指定のとき、モッククライアントに { from: 'ja', to: 'en' } で渡る", async () => {
    // Arrange
    const mockClient = makeMockClient(["Good morning", {}]);

    // Act
    await translate("おはようございます", "ja-JP", "en-US", mockClient as never);

    // Assert: 2文字コードに変換されていること
    expect(mockClient.translate).toHaveBeenCalledWith("おはようございます", { from: "ja", to: "en" });
  });

  test("ja-JP/en-US のような長形式コードがそのまま API に渡らない（渡るのは 2文字コードのみ）", async () => {
    // Arrange
    const mockClient = makeMockClient(["translation", {}]);

    // Act
    await translate("text", "ja-JP", "en-US", mockClient as never);

    // Assert: 第2引数オブジェクトに ja-JP / en-US が含まれないこと
    const callArg = mockClient.translate.mock.calls[0][1] as { from: string; to: string };
    expect(callArg.from).not.toContain("-");
    expect(callArg.to).not.toContain("-");
  });
});

// ---------------------------------------------------------------------------
// 4. translate() — API 呼び出しパラメータ（text が正しく渡ること）
// ---------------------------------------------------------------------------
describe("translate() — API 呼び出しパラメータ", () => {
  test("翻訳対象のテキストがモッククライアントの第1引数として正しく渡る", async () => {
    // Arrange
    const mockClient = makeMockClient(["result", {}]);
    const inputText = "This is a test sentence.";

    // Act
    await translate(inputText, "en-US", "ja-JP", mockClient as never);

    // Assert
    expect(mockClient.translate).toHaveBeenCalledWith(inputText, expect.any(Object));
  });

  test("日本語テキストもそのまま第1引数として渡る", async () => {
    // Arrange
    const mockClient = makeMockClient(["result", {}]);
    const inputText = "これはテストの文章です。";

    // Act
    await translate(inputText, "ja-JP", "en-US", mockClient as never);

    // Assert
    expect(mockClient.translate).toHaveBeenCalledWith(inputText, expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// 5. translate() — エラー伝播
// ---------------------------------------------------------------------------
describe("translate() — エラー伝播", () => {
  test("モッククライアントの translate が reject すると、translate() が例外を投げる", async () => {
    // Arrange
    const mockClient = {
      translate: jest.fn().mockRejectedValue(new Error("GCP internal error details")),
    };

    // Act & Assert
    await expect(
      translate("Hello", "en-US", "ja-JP", mockClient as never)
    ).rejects.toThrow();
  });

  test("GCP の内部詳細メッセージがそのまま外部に漏れず、汎用メッセージで包まれる", async () => {
    // Arrange: GCP 固有の詳細エラーを投げるモック
    const gcpInternalError = new Error("PERMISSION_DENIED: Cloud Translation API has not been used in project xyz before");
    const mockClient = {
      translate: jest.fn().mockRejectedValue(gcpInternalError),
    };

    // Act
    let thrownError: Error | undefined;
    try {
      await translate("Hello", "en-US", "ja-JP", mockClient as never);
    } catch (e) {
      thrownError = e as Error;
    }

    // Assert: 汎用メッセージで包まれていること（GCP 詳細がそのまま出ない）
    expect(thrownError).toBeDefined();
    expect(thrownError!.message).not.toBe("PERMISSION_DENIED: Cloud Translation API has not been used in project xyz before");
    expect(thrownError!.message).toBe("Translation failed. Please try again.");
  });

  test("モッククライアントが文字列エラーで reject しても例外が投げられる", async () => {
    // Arrange
    const mockClient = {
      translate: jest.fn().mockRejectedValue("some string error"),
    };

    // Act & Assert
    await expect(
      translate("Hello", "en-US", "ja-JP", mockClient as never)
    ).rejects.toThrow("Translation failed. Please try again.");
  });
});

// ---------------------------------------------------------------------------
// 6. toTranslationLangCode() — 言語コード変換の単体検証
// ---------------------------------------------------------------------------
describe("toTranslationLangCode() — 単体検証", () => {
  test("'ja-JP' → 'ja' に変換される", () => {
    // Act & Assert
    expect(toTranslationLangCode("ja-JP")).toBe("ja");
  });

  test("'en-US' → 'en' に変換される", () => {
    // Act & Assert
    expect(toTranslationLangCode("en-US")).toBe("en");
  });

  test("'ja'（既に2文字コード）はそのまま 'ja' が返る（冪等性）", () => {
    // Act & Assert
    expect(toTranslationLangCode("ja")).toBe("ja");
  });

  test("'en'（既に2文字コード）はそのまま 'en' が返る（冪等性）", () => {
    // Act & Assert
    expect(toTranslationLangCode("en")).toBe("en");
  });

  test("想定外の形式 'zh-CN' でも先頭部分 'zh' が返る", () => {
    // Act & Assert
    expect(toTranslationLangCode("zh-CN")).toBe("zh");
  });

  test("想定外の形式 'fr-FR' でも先頭部分 'fr' が返る", () => {
    // Act & Assert
    expect(toTranslationLangCode("fr-FR")).toBe("fr");
  });

  test("'-' を含まない単純文字列はそのまま返る", () => {
    // Act & Assert
    expect(toTranslationLangCode("xyz")).toBe("xyz");
  });

  test("複数のハイフンがある場合も最初の '-' より前の部分だけが返る", () => {
    // Arrange: e.g., "zh-Hans-CN" のような形式
    // Act & Assert
    expect(toTranslationLangCode("zh-Hans-CN")).toBe("zh");
  });
});

// ---------------------------------------------------------------------------
// 7. setTranslateClient() / getTranslateClient() / resetTranslateClient() — シングルトン制御
// ---------------------------------------------------------------------------
describe("setTranslateClient() / getTranslateClient() / resetTranslateClient() — シングルトン制御", () => {
  test("setTranslateClient() で差し替えたクライアントが getTranslateClient() で取得できる", () => {
    // Arrange
    const mockClient = makeMockClient();

    // Act
    setTranslateClient(mockClient as never);

    // Assert
    expect(getTranslateClient()).toBe(mockClient);
  });

  test("getTranslateClient() を2回呼んでも同一インスタンスが返る（シングルトン）", () => {
    // Arrange: resetTranslateClient() で null に戻した状態から
    // (afterEach で resetTranslateClient() 済みのため GOOGLE_CLOUD_PROJECT を仮設定)
    // シングルトン動作確認のため setTranslateClient でモックを設定して同一性を確認する
    const mockClient = makeMockClient();
    setTranslateClient(mockClient as never);

    // Act
    const first = getTranslateClient();
    const second = getTranslateClient();

    // Assert
    expect(first).toBe(second);
  });

  test("resetTranslateClient() 後に setTranslateClient() で別のクライアントに差し替えられる", () => {
    // Arrange
    const firstMock = makeMockClient(["first result", {}]);
    const secondMock = makeMockClient(["second result", {}]);
    setTranslateClient(firstMock as never);

    // Act: リセットしてから別のモックを設定
    resetTranslateClient();
    setTranslateClient(secondMock as never);

    // Assert
    expect(getTranslateClient()).toBe(secondMock);
    expect(getTranslateClient()).not.toBe(firstMock);
  });

  test("setTranslateClient() で差し替えたモックが translate() 呼び出し時に使用される", async () => {
    // Arrange: モジュールレベルのシングルトンを差し替え
    const mockClient = makeMockClient(["モジュールレベルの差し替え結果", {}]);
    setTranslateClient(mockClient as never);

    // Act: 第4引数なしで呼ぶ（シングルトンが使われる）
    const result = await translate("Hello", "en-US", "ja-JP");

    // Assert
    expect(result).toBe("モジュールレベルの差し替え結果");
    expect(mockClient.translate).toHaveBeenCalledTimes(1);
  });
});
