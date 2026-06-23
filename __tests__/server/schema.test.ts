/**
 * server/schema.ts の zodスキーマ検証テスト
 *
 * clientMessageSchema および各個別スキーマの正常系・異常系・境界値を検証する。
 * プロダクションコードは変更しない。GCP通信は行わない（純粋関数の検証のみ）。
 */

import {
  clientMessageSchema,
  startSchema,
  audioClientSchema,
  commitSchema,
  stopSchema,
} from "../../server/schema";

// ---------------------------------------------------------------------------
// テストヘルパー: 有効な start メッセージのベースオブジェクト
// ---------------------------------------------------------------------------
const validStart = {
  type: "start" as const,
  sourceLanguage: "ja-JP" as const,
  targetLanguage: "en-US" as const,
  enableTts: true,
  chunkMs: 250,
  silenceMs: 1000,
  maxChars: 80,
  maxSeconds: 10,
};

// ---------------------------------------------------------------------------
// 1. clientMessageSchema — 正常系
// ---------------------------------------------------------------------------
describe("clientMessageSchema — 正常系", () => {
  test("start メッセージ（全フィールド指定）が parse 成功する", () => {
    // Arrange
    const input = { ...validStart, enableInterimTranslation: true };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("start");
    }
  });

  test("start メッセージで enableInterimTranslation を省略すると既定値 false になる", () => {
    // Arrange: enableInterimTranslation を含まない
    const input = { ...validStart };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "start") {
      expect(result.data.enableInterimTranslation).toBe(false);
    }
  });

  test("audio メッセージが parse 成功する", () => {
    // Arrange
    const input = { type: "audio", data: "SGVsbG8gV29ybGQ=" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("audio");
    }
  });

  test("commit メッセージが parse 成功する", () => {
    // Arrange
    const input = { type: "commit" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("commit");
    }
  });

  test("stop メッセージが parse 成功する", () => {
    // Arrange
    const input = { type: "stop" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("stop");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. clientMessageSchema — 同一言語ペア拒否（重要）
// ---------------------------------------------------------------------------
describe("clientMessageSchema — 同一言語ペア拒否", () => {
  test("sourceLanguage === targetLanguage (ja-JP / ja-JP) でバリデーションエラーになる", () => {
    // Arrange
    const input = {
      ...validStart,
      sourceLanguage: "ja-JP" as const,
      targetLanguage: "ja-JP" as const,
    };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("targetLanguage");
    }
  });

  test("sourceLanguage === targetLanguage (en-US / en-US) でバリデーションエラーになる", () => {
    // Arrange
    const input = {
      ...validStart,
      sourceLanguage: "en-US" as const,
      targetLanguage: "en-US" as const,
    };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message;
      expect(message).toContain("must differ");
    }
  });

  test("sourceLanguage !== targetLanguage (ja-JP / en-US) は正常に parse 成功する", () => {
    // Arrange
    const input = {
      ...validStart,
      sourceLanguage: "ja-JP" as const,
      targetLanguage: "en-US" as const,
    };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  test("sourceLanguage !== targetLanguage (en-US / ja-JP) は正常に parse 成功する", () => {
    // Arrange
    const input = {
      ...validStart,
      sourceLanguage: "en-US" as const,
      targetLanguage: "ja-JP" as const,
    };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. clientMessageSchema — 異常系: 未知の type
// ---------------------------------------------------------------------------
describe("clientMessageSchema — 未知の type 拒否", () => {
  test("未知の type が拒否される", () => {
    // Arrange
    const input = { type: "unknown" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("type フィールドが欠落したメッセージが拒否される", () => {
    // Arrange
    const input = { sourceLanguage: "ja-JP", targetLanguage: "en-US" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("type が null のメッセージが拒否される", () => {
    // Arrange
    const input = { type: null };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("空オブジェクトが拒否される", () => {
    // Arrange
    const input = {};

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. startSchema — 必須フィールド欠落・型不正
// ---------------------------------------------------------------------------
describe("startSchema — 必須フィールド欠落・型不正", () => {
  test("sourceLanguage が欠落すると拒否される", () => {
    // Arrange
    const { sourceLanguage, ...input } = validStart;

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("targetLanguage が欠落すると拒否される", () => {
    // Arrange
    const { targetLanguage, ...input } = validStart;

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("enableTts が欠落すると拒否される", () => {
    // Arrange
    const { enableTts, ...input } = validStart;

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("chunkMs が欠落すると拒否される", () => {
    // Arrange
    const { chunkMs, ...input } = validStart;

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("sourceLanguage が不正な言語コード（zh-CN）のとき拒否される", () => {
    // Arrange
    const input = { ...validStart, sourceLanguage: "zh-CN" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("targetLanguage が不正な言語コード（fr-FR）のとき拒否される", () => {
    // Arrange
    const input = { ...validStart, targetLanguage: "fr-FR" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("chunkMs が負の数のとき拒否される", () => {
    // Arrange
    const input = { ...validStart, chunkMs: -1 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("chunkMs がゼロのとき拒否される", () => {
    // Arrange
    const input = { ...validStart, chunkMs: 0 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("silenceMs が非整数（浮動小数点）のとき拒否される", () => {
    // Arrange
    const input = { ...validStart, silenceMs: 1000.5 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("maxChars が負の数のとき拒否される", () => {
    // Arrange
    const input = { ...validStart, maxChars: -80 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("maxSeconds が非整数（文字列）のとき拒否される", () => {
    // Arrange
    const input = { ...validStart, maxSeconds: "10" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("enableTts が文字列のとき拒否される", () => {
    // Arrange
    const input = { ...validStart, enableTts: "true" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. audioClientSchema — data フィールド検証
// ---------------------------------------------------------------------------
describe("audioClientSchema — data フィールド検証", () => {
  test("data が空文字列のとき拒否される", () => {
    // Arrange
    const input = { type: "audio", data: "" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("data が 1 文字以上のとき parse 成功する", () => {
    // Arrange
    const input = { type: "audio", data: "A" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  test("data フィールドが欠落すると拒否される", () => {
    // Arrange
    const input = { type: "audio" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  test("data が数値のとき拒否される", () => {
    // Arrange
    const input = { type: "audio", data: 12345 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. commitSchema / stopSchema — 正常系と余分なフィールド
// ---------------------------------------------------------------------------
describe("commitSchema / stopSchema — 正常系", () => {
  test("commit は { type: 'commit' } のみで parse 成功する", () => {
    // Arrange / Act
    const result = commitSchema.safeParse({ type: "commit" });

    // Assert
    expect(result.success).toBe(true);
  });

  test("stop は { type: 'stop' } のみで parse 成功する", () => {
    // Arrange / Act
    const result = stopSchema.safeParse({ type: "stop" });

    // Assert
    expect(result.success).toBe(true);
  });

  test("commit に余分なフィールドがあっても parse 成功する（strip）", () => {
    // Arrange: zod はデフォルトで余分なキーをストリップする
    const input = { type: "commit", extra: "field" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  test("stop に余分なフィールドがあっても parse 成功する（strip）", () => {
    // Arrange
    const input = { type: "stop", extra: "field" };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. 境界値テスト
// ---------------------------------------------------------------------------
describe("境界値テスト", () => {
  test("chunkMs が 1（最小正の整数）のとき parse 成功する", () => {
    // Arrange
    const input = { ...validStart, chunkMs: 1 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  test("maxChars が 1（最小正の整数）のとき parse 成功する", () => {
    // Arrange
    const input = { ...validStart, maxChars: 1 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  test("silenceMs が 1（最小正の整数）のとき parse 成功する", () => {
    // Arrange
    const input = { ...validStart, silenceMs: 1 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  test("maxSeconds が 1（最小正の整数）のとき parse 成功する", () => {
    // Arrange
    const input = { ...validStart, maxSeconds: 1 };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  test("audio の data が非常に長い base64 文字列でも parse 成功する", () => {
    // Arrange: 10000文字の文字列
    const input = { type: "audio", data: "A".repeat(10000) };

    // Act
    const result = clientMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. startSchema 単体のテスト（同一言語ペアは拒否されないことを確認）
// ---------------------------------------------------------------------------
describe("startSchema 単体 — 同一言語ペアは拒否されない", () => {
  test("startSchema 単体では sourceLanguage === targetLanguage でもエラーにならない", () => {
    // Arrange: startSchema 単体には同一言語ペアの制約がない
    const input = {
      ...validStart,
      sourceLanguage: "ja-JP" as const,
      targetLanguage: "ja-JP" as const,
    };

    // Act
    const result = startSchema.safeParse(input);

    // Assert: startSchema 単体ではエラーにならない
    expect(result.success).toBe(true);
  });

  test("clientMessageSchema 経由では同一言語ペアがエラーになる（対比確認）", () => {
    // Arrange
    const input = {
      ...validStart,
      sourceLanguage: "ja-JP" as const,
      targetLanguage: "ja-JP" as const,
    };

    // Act
    const resultViaBase = startSchema.safeParse(input);
    const resultViaFull = clientMessageSchema.safeParse(input);

    // Assert: startSchema 単体は成功、clientMessageSchema はエラー
    expect(resultViaBase.success).toBe(true);
    expect(resultViaFull.success).toBe(false);
  });
});
