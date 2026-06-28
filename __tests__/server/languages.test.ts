/**
 * server/languages.ts の単体テスト
 *
 * サーバーサイドのGCPコードレジストリ（LANGUAGE_REGISTRY / ヘルパー関数）を検証する。
 * GCP通信なし。テスト対象はピュアなデータ定義と純粋関数のみ。
 */

import { SUPPORTED_LANGUAGES } from "../../server/types";
import {
  LANGUAGE_REGISTRY,
  getLanguageEntry,
  sttCodeOf,
  translationCodeOf,
  ttsLanguageCodeOf,
} from "../../server/languages";

// ---------------------------------------------------------------------------
// 1. LANGUAGE_REGISTRY — キー網羅性
// ---------------------------------------------------------------------------
describe("LANGUAGE_REGISTRY — キー網羅性", () => {
  test("LANGUAGE_REGISTRY のキーが SUPPORTED_LANGUAGES と完全一致する（漏れなし）", () => {
    // Arrange
    const registryKeys = Object.keys(LANGUAGE_REGISTRY).sort();
    const supportedSorted = [...SUPPORTED_LANGUAGES].sort();

    // Assert
    expect(registryKeys).toEqual(supportedSorted);
  });

  test("SUPPORTED_LANGUAGES の各コードに対してエントリが存在する", () => {
    for (const code of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_REGISTRY[code]).toBeDefined();
    }
  });

  test("余分なキー（SUPPORTED_LANGUAGES に含まれない）が存在しない", () => {
    // Arrange
    const extraKeys = Object.keys(LANGUAGE_REGISTRY).filter(
      (k) => !(SUPPORTED_LANGUAGES as readonly string[]).includes(k)
    );

    // Assert
    expect(extraKeys).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. LANGUAGE_REGISTRY — 各エントリのフィールド存在確認
// ---------------------------------------------------------------------------
describe("LANGUAGE_REGISTRY — 全エントリのフィールド存在確認", () => {
  test("各エントリに sttCode（非空文字列）が存在する", () => {
    for (const code of SUPPORTED_LANGUAGES) {
      const entry = LANGUAGE_REGISTRY[code];
      expect(typeof entry.sttCode).toBe("string");
      expect(entry.sttCode.length).toBeGreaterThan(0);
    }
  });

  test("各エントリに translationCode（非空文字列）が存在する", () => {
    for (const code of SUPPORTED_LANGUAGES) {
      const entry = LANGUAGE_REGISTRY[code];
      expect(typeof entry.translationCode).toBe("string");
      expect(entry.translationCode.length).toBeGreaterThan(0);
    }
  });

  test("各エントリに ttsLanguageCode（非空文字列）が存在する", () => {
    for (const code of SUPPORTED_LANGUAGES) {
      const entry = LANGUAGE_REGISTRY[code];
      expect(typeof entry.ttsLanguageCode).toBe("string");
      expect(entry.ttsLanguageCode.length).toBeGreaterThan(0);
    }
  });

  test("各エントリの ttsGender が 'NEUTRAL' / 'MALE' / 'FEMALE' のいずれかである", () => {
    const validGenders = ["NEUTRAL", "MALE", "FEMALE"];
    for (const code of SUPPORTED_LANGUAGES) {
      const entry = LANGUAGE_REGISTRY[code];
      expect(validGenders).toContain(entry.ttsGender);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. LANGUAGE_REGISTRY — 新規言語（zh-CN）の値検証
// ---------------------------------------------------------------------------
describe("LANGUAGE_REGISTRY — zh-CN エントリ値検証", () => {
  test("zh-CN の sttCode は 'cmn-Hans-CN'（script subtag 付き）", () => {
    // Assert
    expect(LANGUAGE_REGISTRY["zh-CN"].sttCode).toBe("cmn-Hans-CN");
  });

  test("zh-CN の translationCode は 'zh-CN'（簡繁を区別するため split ではなくフルコード）", () => {
    expect(LANGUAGE_REGISTRY["zh-CN"].translationCode).toBe("zh-CN");
  });

  test("zh-CN の ttsLanguageCode は 'cmn-CN'", () => {
    expect(LANGUAGE_REGISTRY["zh-CN"].ttsLanguageCode).toBe("cmn-CN");
  });

  test("zh-CN の ttsVoiceName は 'cmn-CN-Wavenet-A'", () => {
    expect(LANGUAGE_REGISTRY["zh-CN"].ttsVoiceName).toBe("cmn-CN-Wavenet-A");
  });

  test("zh-CN の ttsGender は 'FEMALE'", () => {
    expect(LANGUAGE_REGISTRY["zh-CN"].ttsGender).toBe("FEMALE");
  });
});

// ---------------------------------------------------------------------------
// 4. LANGUAGE_REGISTRY — 新規言語（zh-TW）の値検証
// ---------------------------------------------------------------------------
describe("LANGUAGE_REGISTRY — zh-TW エントリ値検証", () => {
  test("zh-TW の sttCode は 'cmn-Hant-TW'（script subtag 付き）", () => {
    expect(LANGUAGE_REGISTRY["zh-TW"].sttCode).toBe("cmn-Hant-TW");
  });

  test("zh-TW の translationCode は 'zh-TW'（zh-CN と区別される）", () => {
    expect(LANGUAGE_REGISTRY["zh-TW"].translationCode).toBe("zh-TW");
  });

  test("zh-TW の ttsLanguageCode は 'cmn-TW'", () => {
    expect(LANGUAGE_REGISTRY["zh-TW"].ttsLanguageCode).toBe("cmn-TW");
  });

  test("zh-TW の ttsVoiceName は 'cmn-TW-Wavenet-A'", () => {
    expect(LANGUAGE_REGISTRY["zh-TW"].ttsVoiceName).toBe("cmn-TW-Wavenet-A");
  });

  test("zh-TW の ttsGender は 'FEMALE'", () => {
    expect(LANGUAGE_REGISTRY["zh-TW"].ttsGender).toBe("FEMALE");
  });
});

// ---------------------------------------------------------------------------
// 5. LANGUAGE_REGISTRY — 新規言語（ko-KR）の値検証
// ---------------------------------------------------------------------------
describe("LANGUAGE_REGISTRY — ko-KR エントリ値検証", () => {
  test("ko-KR の sttCode は 'ko-KR'", () => {
    expect(LANGUAGE_REGISTRY["ko-KR"].sttCode).toBe("ko-KR");
  });

  test("ko-KR の translationCode は 'ko'", () => {
    expect(LANGUAGE_REGISTRY["ko-KR"].translationCode).toBe("ko");
  });

  test("ko-KR の ttsLanguageCode は 'ko-KR'", () => {
    expect(LANGUAGE_REGISTRY["ko-KR"].ttsLanguageCode).toBe("ko-KR");
  });

  test("ko-KR の ttsVoiceName は 'ko-KR-Neural2-A'", () => {
    expect(LANGUAGE_REGISTRY["ko-KR"].ttsVoiceName).toBe("ko-KR-Neural2-A");
  });

  test("ko-KR の ttsGender は 'FEMALE'", () => {
    expect(LANGUAGE_REGISTRY["ko-KR"].ttsGender).toBe("FEMALE");
  });
});

// ---------------------------------------------------------------------------
// 6. LANGUAGE_REGISTRY — 既存言語（ja-JP / en-US）の回帰テスト
// ---------------------------------------------------------------------------
describe("LANGUAGE_REGISTRY — ja-JP / en-US 既存挙動の回帰防止", () => {
  test("ja-JP の ttsVoiceName は undefined（既存挙動を保持）", () => {
    expect(LANGUAGE_REGISTRY["ja-JP"].ttsVoiceName).toBeUndefined();
  });

  test("ja-JP の ttsGender は 'NEUTRAL'（既存挙動を保持）", () => {
    expect(LANGUAGE_REGISTRY["ja-JP"].ttsGender).toBe("NEUTRAL");
  });

  test("ja-JP の sttCode は 'ja-JP'", () => {
    expect(LANGUAGE_REGISTRY["ja-JP"].sttCode).toBe("ja-JP");
  });

  test("ja-JP の translationCode は 'ja'", () => {
    expect(LANGUAGE_REGISTRY["ja-JP"].translationCode).toBe("ja");
  });

  test("en-US の ttsVoiceName は undefined（既存挙動を保持）", () => {
    expect(LANGUAGE_REGISTRY["en-US"].ttsVoiceName).toBeUndefined();
  });

  test("en-US の ttsGender は 'NEUTRAL'（既存挙動を保持）", () => {
    expect(LANGUAGE_REGISTRY["en-US"].ttsGender).toBe("NEUTRAL");
  });

  test("en-US の sttCode は 'en-US'", () => {
    expect(LANGUAGE_REGISTRY["en-US"].sttCode).toBe("en-US");
  });

  test("en-US の translationCode は 'en'", () => {
    expect(LANGUAGE_REGISTRY["en-US"].translationCode).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// 7. zh-CN / zh-TW の translationCode が区別されること（重要）
// ---------------------------------------------------------------------------
describe("zh-CN と zh-TW の translationCode が区別される", () => {
  test("zh-CN と zh-TW の translationCode は異なる値である", () => {
    expect(LANGUAGE_REGISTRY["zh-CN"].translationCode).not.toBe(
      LANGUAGE_REGISTRY["zh-TW"].translationCode
    );
  });

  test("zh-CN の translationCode を split('-')[0] しても 'zh' になるが、zh-TW とは区別できない（レジストリのフルコード参照が必須）", () => {
    // これは split 方式の危険性を示す回帰テスト
    // レジストリ経由では正しく区別できることを確認する
    expect(LANGUAGE_REGISTRY["zh-CN"].translationCode).toBe("zh-CN");
    expect(LANGUAGE_REGISTRY["zh-TW"].translationCode).toBe("zh-TW");
    // split方式では両方が "zh" になってしまい区別できない
    expect("zh-CN".split("-")[0]).toBe("zh");
    expect("zh-TW".split("-")[0]).toBe("zh");
  });
});

// ---------------------------------------------------------------------------
// 8. getLanguageEntry() ヘルパー
// ---------------------------------------------------------------------------
describe("getLanguageEntry()", () => {
  test("ja-JP のエントリを返す", () => {
    // Act
    const entry = getLanguageEntry("ja-JP");

    // Assert
    expect(entry).toBeDefined();
    expect(entry.sttCode).toBe("ja-JP");
  });

  test("zh-CN のエントリを返す（sttCode が cmn-Hans-CN）", () => {
    // Act
    const entry = getLanguageEntry("zh-CN");

    // Assert
    expect(entry.sttCode).toBe("cmn-Hans-CN");
  });

  test("zh-TW のエントリを返す（sttCode が cmn-Hant-TW）", () => {
    // Act
    const entry = getLanguageEntry("zh-TW");

    // Assert
    expect(entry.sttCode).toBe("cmn-Hant-TW");
  });

  test("ko-KR のエントリを返す（ttsVoiceName が ko-KR-Neural2-A）", () => {
    // Act
    const entry = getLanguageEntry("ko-KR");

    // Assert
    expect(entry.ttsVoiceName).toBe("ko-KR-Neural2-A");
  });
});

// ---------------------------------------------------------------------------
// 9. sttCodeOf() ヘルパー
// ---------------------------------------------------------------------------
describe("sttCodeOf()", () => {
  test("ja-JP → 'ja-JP'", () => {
    expect(sttCodeOf("ja-JP")).toBe("ja-JP");
  });

  test("en-US → 'en-US'", () => {
    expect(sttCodeOf("en-US")).toBe("en-US");
  });

  test("zh-CN → 'cmn-Hans-CN'（script subtag 付き）", () => {
    expect(sttCodeOf("zh-CN")).toBe("cmn-Hans-CN");
  });

  test("zh-TW → 'cmn-Hant-TW'（script subtag 付き）", () => {
    expect(sttCodeOf("zh-TW")).toBe("cmn-Hant-TW");
  });

  test("ko-KR → 'ko-KR'", () => {
    expect(sttCodeOf("ko-KR")).toBe("ko-KR");
  });

  test("zh-CN と zh-TW の sttCode が異なる", () => {
    expect(sttCodeOf("zh-CN")).not.toBe(sttCodeOf("zh-TW"));
  });
});

// ---------------------------------------------------------------------------
// 10. translationCodeOf() ヘルパー
// ---------------------------------------------------------------------------
describe("translationCodeOf()", () => {
  test("ja-JP → 'ja'", () => {
    expect(translationCodeOf("ja-JP")).toBe("ja");
  });

  test("en-US → 'en'", () => {
    expect(translationCodeOf("en-US")).toBe("en");
  });

  test("zh-CN → 'zh-CN'（簡体専用コード）", () => {
    expect(translationCodeOf("zh-CN")).toBe("zh-CN");
  });

  test("zh-TW → 'zh-TW'（繁体専用コード）", () => {
    expect(translationCodeOf("zh-TW")).toBe("zh-TW");
  });

  test("ko-KR → 'ko'", () => {
    expect(translationCodeOf("ko-KR")).toBe("ko");
  });

  test("zh-CN と zh-TW の translationCode が異なる（簡繁区別）", () => {
    expect(translationCodeOf("zh-CN")).not.toBe(translationCodeOf("zh-TW"));
  });
});

// ---------------------------------------------------------------------------
// 11. ttsLanguageCodeOf() ヘルパー
// ---------------------------------------------------------------------------
describe("ttsLanguageCodeOf()", () => {
  test("ja-JP → 'ja-JP'", () => {
    expect(ttsLanguageCodeOf("ja-JP")).toBe("ja-JP");
  });

  test("en-US → 'en-US'", () => {
    expect(ttsLanguageCodeOf("en-US")).toBe("en-US");
  });

  test("zh-CN → 'cmn-CN'", () => {
    expect(ttsLanguageCodeOf("zh-CN")).toBe("cmn-CN");
  });

  test("zh-TW → 'cmn-TW'", () => {
    expect(ttsLanguageCodeOf("zh-TW")).toBe("cmn-TW");
  });

  test("ko-KR → 'ko-KR'", () => {
    expect(ttsLanguageCodeOf("ko-KR")).toBe("ko-KR");
  });
});
