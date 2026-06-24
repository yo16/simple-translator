import { TextToSpeechClient } from "@google-cloud/text-to-speech";

// ============================================================
// Cloud Text-to-Speech ラッパー
// ============================================================

/**
 * モジュールレベルのシングルトン TextToSpeechClient。
 * サーバープロセス起動時に1度だけ生成して使い回す。
 *
 * テスト時は getTtsClient() をモックすることで差し替え可能。
 */
let _ttsClient: TextToSpeechClient | null = null;

/**
 * TextToSpeechClient を返す（遅延初期化）。
 *
 * テスト容易性のために関数として切り出している。
 * テスト側でこの関数をモックすることで GCP クライアントを差し替えられる。
 *
 * @returns TextToSpeechClient インスタンス
 */
export function getTtsClient(): TextToSpeechClient {
  if (_ttsClient === null) {
    // 引数なしで ADC（Application Default Credentials）を自動使用
    _ttsClient = new TextToSpeechClient();
  }
  return _ttsClient as TextToSpeechClient;
}

/**
 * テスト用: TextToSpeechClient を差し替える。
 * テスト終了後に resetTtsClient() で元に戻すこと。
 *
 * @param client モック TextToSpeechClient インスタンス
 */
export function setTtsClient(client: TextToSpeechClient): void {
  _ttsClient = client;
}

/**
 * テスト用: TextToSpeechClient をリセットする（null に戻す）。
 */
export function resetTtsClient(): void {
  _ttsClient = null;
}

// ============================================================
// TTS 有効判定
// ============================================================

/**
 * 環境変数 ENABLE_TTS を都度読み取り、TTS が有効かどうかを返す。
 *
 * - 値が "false"（文字列）の場合も false とみなす（要件に従い）。
 * - 未設定（undefined）の場合は true（有効）とみなす。
 *
 * テスト時は process.env.ENABLE_TTS を書き換えることで挙動を制御できる。
 *
 * @returns TTS が有効なら true、無効なら false
 */
export function isTtsEnabled(): boolean {
  const val = process.env.ENABLE_TTS;
  if (val === undefined) {
    return true;
  }
  return val !== "false";
}

// ============================================================
// 音声合成関数
// ============================================================

/**
 * テキストを Cloud Text-to-Speech API で MP3 音声に同期合成し、
 * base64 文字列として返す。
 *
 * - ENABLE_TTS=false（または "false"）の場合は API を呼ばずに null を返す。
 * - 合成結果は base64 文字列として返す（WebSocket の `audio` メッセージの `data` フィールドに直接使用可能）。
 * - `voice.languageCode` はフルコード（"ja-JP" / "en-US"）のまま渡す（2文字への変換は行わない）。
 * - client 引数を指定した場合はそのインスタンスを使用する（テスト注入用）。
 *   省略時は getTtsClient() が返すシングルトンを使用する。
 *
 * @param text 合成対象のテキスト
 * @param languageCode 音声の言語コード（例: "ja-JP", "en-US"。フルコードのまま渡す）
 * @param client テスト用クライアント注入（省略可）
 * @returns 合成音声の base64 文字列（TTS 無効時・空テキスト時は null）
 */
export async function synthesize(
  text: string,
  languageCode: string,
  client?: TextToSpeechClient
): Promise<string | null> {
  // ENABLE_TTS=false の場合は API を呼ばずに null を返す
  if (!isTtsEnabled()) {
    return null;
  }

  // 空文字列・空白のみの場合は API を呼ばずに null を返す
  if (text.trim().length === 0) {
    return null;
  }

  const ttsClient = client ?? getTtsClient();

  try {
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: {
        // フルコード（"ja-JP" / "en-US"）のまま渡す。2文字変換は行わない
        languageCode,
        ssmlGender: "NEUTRAL",
      },
      audioConfig: {
        audioEncoding: "MP3",
      },
    });

    if (!response.audioContent) {
      console.error("[synthesize] TTS response has no audioContent");
      return null;
    }

    // audioContent は Uint8Array | string のどちらも想定する
    // Buffer に変換してから base64 文字列へ変換する
    const audioBuffer =
      response.audioContent instanceof Uint8Array
        ? Buffer.from(response.audioContent)
        : Buffer.from(response.audioContent as string, "binary");

    return audioBuffer.toString("base64");
  } catch (err) {
    // GCP の内部詳細やスタックトレースをそのまま流さない
    const message = err instanceof Error ? err.message : String(err);
    console.error("[synthesize] Text-to-Speech API error:", message);
    throw new Error("Text-to-Speech failed. Please try again.");
  }
}
