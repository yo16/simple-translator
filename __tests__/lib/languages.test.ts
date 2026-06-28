/**
 * src/lib/languages.ts の単体テスト
 *
 * クライアントサイドの表示名レジストリ（LANGUAGE_LABELS / languageLabel）を検証する。
 * GCP通信なし・jsdom不要。testEnvironment: 'node' で動作する。
 */

import { SUPPORTED_LANGUAGES } from "../../src/lib/types";
import { LANGUAGE_LABELS, languageLabel } from "../../src/lib/languages";

// ---------------------------------------------------------------------------
// 1. SUPPORTED_LANGUAGES — 対応言語リスト
// ---------------------------------------------------------------------------
describe("SUPPORTED_LANGUAGES", () => {
  test("ちょうど5言語を含む", () => {
    // Assert
    expect(SUPPORTED_LANGUAGES).toHaveLength(5);
  });

  test("ja-JP を含む", () => {
    expect(SUPPORTED_LANGUAGES).toContain("ja-JP");
  });

  test("en-US を含む", () => {
    expect(SUPPORTED_LANGUAGES).toContain("en-US");
  });

  test("zh-CN を含む", () => {
    expect(SUPPORTED_LANGUAGES).toContain("zh-CN");
  });

  test("zh-TW を含む", () => {
    expect(SUPPORTED_LANGUAGES).toContain("zh-TW");
  });

  test("ko-KR を含む", () => {
    expect(SUPPORTED_LANGUAGES).toContain("ko-KR");
  });
});

// ---------------------------------------------------------------------------
// 2. LANGUAGE_LABELS — キー網羅性
// ---------------------------------------------------------------------------
describe("LANGUAGE_LABELS — キー網羅性", () => {
  test("LANGUAGE_LABELS のキーが SUPPORTED_LANGUAGES と完全一致する（漏れなし）", () => {
    // Arrange
    const labelKeys = Object.keys(LANGUAGE_LABELS).sort();
    const supportedSorted = [...SUPPORTED_LANGUAGES].sort();

    // Assert
    expect(labelKeys).toEqual(supportedSorted);
  });

  test("SUPPORTED_LANGUAGES の各コードに対応するラベルが undefined でない", () => {
    // Arrange / Assert
    for (const code of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_LABELS[code]).toBeDefined();
      expect(typeof LANGUAGE_LABELS[code]).toBe("string");
      expect(LANGUAGE_LABELS[code].length).toBeGreaterThan(0);
    }
  });

  test("余分なキー（SUPPORTED_LANGUAGES に含まれない）が存在しない", () => {
    // Arrange
    const extraKeys = Object.keys(LANGUAGE_LABELS).filter(
      (k) => !(SUPPORTED_LANGUAGES as readonly string[]).includes(k)
    );

    // Assert
    expect(extraKeys).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. LANGUAGE_LABELS — 各言語の表示名
// ---------------------------------------------------------------------------
describe("LANGUAGE_LABELS — 各言語の表示名", () => {
  test("ja-JP の表示名が '日本語' である", () => {
    expect(LANGUAGE_LABELS["ja-JP"]).toBe("日本語");
  });

  test("en-US の表示名が '英語' である", () => {
    expect(LANGUAGE_LABELS["en-US"]).toBe("英語");
  });

  test("zh-CN の表示名が '中国語(簡体)' である", () => {
    expect(LANGUAGE_LABELS["zh-CN"]).toBe("中国語(簡体)");
  });

  test("zh-TW の表示名が '中国語(繁体)' である", () => {
    expect(LANGUAGE_LABELS["zh-TW"]).toBe("中国語(繁体)");
  });

  test("ko-KR の表示名が '韓国語' である", () => {
    expect(LANGUAGE_LABELS["ko-KR"]).toBe("韓国語");
  });
});

// ---------------------------------------------------------------------------
// 4. languageLabel() — ヘルパー関数
// ---------------------------------------------------------------------------
describe("languageLabel()", () => {
  test("ja-JP を渡すと '日本語' を返す", () => {
    expect(languageLabel("ja-JP")).toBe("日本語");
  });

  test("en-US を渡すと '英語' を返す", () => {
    expect(languageLabel("en-US")).toBe("英語");
  });

  test("zh-CN を渡すと '中国語(簡体)' を返す", () => {
    expect(languageLabel("zh-CN")).toBe("中国語(簡体)");
  });

  test("zh-TW を渡すと '中国語(繁体)' を返す", () => {
    expect(languageLabel("zh-TW")).toBe("中国語(繁体)");
  });

  test("ko-KR を渡すと '韓国語' を返す", () => {
    expect(languageLabel("ko-KR")).toBe("韓国語");
  });

  test("各 SUPPORTED_LANGUAGES コードに対して非空文字列を返す", () => {
    for (const code of SUPPORTED_LANGUAGES) {
      const label = languageLabel(code);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
