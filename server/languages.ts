import { SupportedLanguage } from "./types";

/**
 * 1言語のGCP各APIコードをまとめたエントリ型。
 */
export interface LanguageEntry {
  /** Cloud Speech-to-Text の recognition languageCode */
  sttCode: string;
  /** Cloud Translation v2 の target/source コード */
  translationCode: string;
  /** Cloud Text-to-Speech の voice.languageCode */
  ttsLanguageCode: string;
  /**
   * Cloud Text-to-Speech の voice.name。
   * NEUTRAL が使えない言語では必須。
   * ja-JP / en-US は未指定（既存動作を保持）。
   */
  ttsVoiceName?: string;
  /** Cloud Text-to-Speech の voice.ssmlGender */
  ttsGender: "NEUTRAL" | "MALE" | "FEMALE";
}

/**
 * 言語レジストリ（第1陣: ja-JP, en-US, zh-CN, zh-TW, ko-KR）。
 * STT / Translation / TTS の各処理はこのレジストリのフィールドを参照する。
 * プロトコルコードを各APIに素通ししてはならない。
 *
 * 注意:
 * - ja-JP / en-US は ttsVoiceName を付けない（既存TTS挙動・既存テストを保持）。
 * - zh-CN / zh-TW の STT コードには script subtag が含まれる（cmn-Hans-CN / cmn-Hant-TW）。
 * - zh-CN / zh-TW の Translation コードは zh-CN / zh-TW（split("-")[0] では簡繁を区別できない）。
 */
export const LANGUAGE_REGISTRY: Record<SupportedLanguage, LanguageEntry> = {
  "ja-JP": {
    sttCode: "ja-JP",
    translationCode: "ja",
    ttsLanguageCode: "ja-JP",
    ttsGender: "NEUTRAL",
  },
  "en-US": {
    sttCode: "en-US",
    translationCode: "en",
    ttsLanguageCode: "en-US",
    ttsGender: "NEUTRAL",
  },
  "zh-CN": {
    sttCode: "cmn-Hans-CN",
    translationCode: "zh-CN",
    ttsLanguageCode: "cmn-CN",
    ttsVoiceName: "cmn-CN-Wavenet-A",
    ttsGender: "FEMALE",
  },
  "zh-TW": {
    sttCode: "cmn-Hant-TW",
    translationCode: "zh-TW",
    ttsLanguageCode: "cmn-TW",
    ttsVoiceName: "cmn-TW-Wavenet-A",
    ttsGender: "FEMALE",
  },
  "ko-KR": {
    sttCode: "ko-KR",
    translationCode: "ko",
    ttsLanguageCode: "ko-KR",
    ttsVoiceName: "ko-KR-Neural2-A",
    ttsGender: "FEMALE",
  },
};

/**
 * 言語コードに対応するレジストリエントリを返す。
 */
export function getLanguageEntry(code: SupportedLanguage): LanguageEntry {
  return LANGUAGE_REGISTRY[code];
}

/**
 * 言語コードに対応する STT languageCode を返す。
 */
export function sttCodeOf(code: SupportedLanguage): string {
  return LANGUAGE_REGISTRY[code].sttCode;
}

/**
 * 言語コードに対応する Translation target/source コードを返す。
 */
export function translationCodeOf(code: SupportedLanguage): string {
  return LANGUAGE_REGISTRY[code].translationCode;
}

/**
 * 言語コードに対応する TTS languageCode を返す。
 */
export function ttsLanguageCodeOf(code: SupportedLanguage): string {
  return LANGUAGE_REGISTRY[code].ttsLanguageCode;
}
