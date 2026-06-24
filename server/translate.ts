import { v2 } from "@google-cloud/translate";

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
// 言語コード変換
// ============================================================

/**
 * プロトコル言語コード（例: "ja-JP", "en-US"）を
 * Cloud Translation v2 Basic API 用の2文字コード（例: "ja", "en"）へ変換する。
 *
 * "-" で分割して先頭部分を返す。既に2文字コード（"ja", "en"）の場合もそのまま返る。
 *
 * @param code プロトコル言語コード（例: "ja-JP", "en-US", "ja"）
 * @returns Translation API 用の言語コード（例: "ja", "en"）
 */
export function toTranslationLangCode(code: string): string {
  return code.split("-")[0];
}

// ============================================================
// 翻訳関数
// ============================================================

/**
 * テキストを翻訳する。
 *
 * - 空文字列（または空白のみ）を渡した場合は API を呼ばずに空文字列を返す。
 * - 言語コードは `ja-JP` / `en-US` 形式で受け取り、内部で2文字コード（`ja` / `en`）へ
 *   変換してから Translation API の `from` / `to` に渡す。
 * - client 引数を指定した場合はそのインスタンスを使用する（テスト注入用）。
 *   省略時は getTranslateClient() が返すシングルトンを使用する。
 *
 * @param text 翻訳対象のテキスト
 * @param sourceLanguage 翻訳元言語コード（例: "ja-JP", "en-US"）
 * @param targetLanguage 翻訳先言語コード（例: "ja-JP", "en-US"）
 * @param client テスト用クライアント注入（省略可）
 * @returns 翻訳結果テキスト
 */
export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  client?: v2.Translate
): Promise<string> {
  // 空文字列・空白のみの場合は早期リターン（API呼び出しなし）
  if (text.trim().length === 0) {
    return "";
  }

  const translateClient = client ?? getTranslateClient();

  // プロトコル言語コード（ja-JP / en-US）を Translation API 用2文字コード（ja / en）へ変換
  const from = toTranslationLangCode(sourceLanguage);
  const to = toTranslationLangCode(targetLanguage);

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
