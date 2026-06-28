import { v2 } from "@google-cloud/translate";
import { SupportedLanguage } from "./types";
import { translationCodeOf } from "./languages";

// ============================================================
// Cloud Translation v2 Basic ラッパー
// ============================================================

/**
 * モジュールレベルのシングルトン Translate クライアント。
 * サーバープロセス起動時に1度だけ生成して使い回す。
 *
 * テスト時は getTranslateClient() をモックすることで差し替え可能。
 */
let _translateClient: v2.Translate | null = null;

/**
 * Translate クライアントを返す（遅延初期化）。
 *
 * テスト容易性のために関数として切り出している。
 * テスト側でこの関数をモックすることで GCP クライアントを差し替えられる。
 *
 * @returns v2.Translate インスタンス
 */
export function getTranslateClient(): v2.Translate {
  if (_translateClient === null) {
    _translateClient = new v2.Translate({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
    });
  }
  return _translateClient;
}

/**
 * テスト用: Translate クライアントを差し替える。
 * テスト終了後に resetTranslateClient() で元に戻すこと。
 *
 * @param client モック Translate インスタンス
 */
export function setTranslateClient(client: v2.Translate): void {
  _translateClient = client;
}

/**
 * テスト用: Translate クライアントをリセットする（null に戻す）。
 */
export function resetTranslateClient(): void {
  _translateClient = null;
}

// ============================================================
// 翻訳関数
// ============================================================

/**
 * テキストを翻訳する。
 *
 * - 空文字列（または空白のみ）を渡した場合は API を呼ばずに空文字列を返す。
 * - 言語コードは SupportedLanguage 型で受け取り、レジストリの translationCode を
 *   Translation API の `from` / `to` に渡す（zh-CN / zh-TW を簡繁区別するため）。
 * - client 引数を指定した場合はそのインスタンスを使用する（テスト注入用）。
 *   省略時は getTranslateClient() が返すシングルトンを使用する。
 *
 * @param text 翻訳対象のテキスト
 * @param sourceLanguage 翻訳元言語（SupportedLanguage: "ja-JP" / "en-US" / "zh-CN" / "zh-TW" / "ko-KR"）
 * @param targetLanguage 翻訳先言語（SupportedLanguage: "ja-JP" / "en-US" / "zh-CN" / "zh-TW" / "ko-KR"）
 * @param client テスト用クライアント注入（省略可）
 * @returns 翻訳結果テキスト
 */
export async function translate(
  text: string,
  sourceLanguage: SupportedLanguage,
  targetLanguage: SupportedLanguage,
  client?: v2.Translate
): Promise<string> {
  // 空文字列・空白のみの場合は早期リターン（API呼び出しなし）
  if (text.trim().length === 0) {
    return "";
  }

  const translateClient = client ?? getTranslateClient();

  // レジストリの translationCode を使って Translation API の from/to を決める
  // （split("-")[0] 方式では zh-CN / zh-TW を区別できないため使用しない）
  const from = translationCodeOf(sourceLanguage);
  const to = translationCodeOf(targetLanguage);

  try {
    const [translated] = await translateClient.translate(text, {
      from,
      to,
    });
    return translated;
  } catch (err) {
    // GCP の内部詳細やスタックトレースをそのまま流さない
    const message = err instanceof Error ? err.message : String(err);
    console.error("[translate] Translation API error:", message);
    throw new Error("Translation failed. Please try again.");
  }
}
