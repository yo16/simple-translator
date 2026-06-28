import { SUPPORTED_LANGUAGES, SupportedLanguage } from "./types";

/**
 * ドロップダウン表示順の配列（types.ts の SUPPORTED_LANGUAGES と同一集合）。
 * クライアント側でのみ使用。GCPコードはここに含めない。
 */
export { SUPPORTED_LANGUAGES };

/**
 * 各言語の UI 表示名。
 */
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  "ja-JP": "日本語",
  "en-US": "英語",
  "zh-CN": "中国語(簡体)",
  "zh-TW": "中国語(繁体)",
  "ko-KR": "韓国語",
};

/**
 * 言語コードから表示名を返すヘルパー。
 * 未知のコードの場合はコードそのものを返す。
 */
export function languageLabel(code: SupportedLanguage): string {
  return LANGUAGE_LABELS[code] ?? code;
}
