import { SpeechClient } from "@google-cloud/speech";
import { SpeechStreamHandle } from "./types";

// ============================================================
// Cloud Speech-to-Text Streaming ラッパー
// ============================================================

/**
 * モジュールレベルのシングルトン SpeechClient。
 * サーバープロセス起動時に1度だけ生成して使い回す（遅延初期化）。
 *
 * テスト時は setSpeechClient() でモックに差し替え可能。
 */
let _speechClient: SpeechClient | null = null;

/**
 * SpeechClient を返す（遅延初期化）。
 *
 * テスト容易性のために関数として切り出している。
 * テスト側でこの関数をモックすることで GCP クライアントを差し替えられる。
 *
 * @returns SpeechClient インスタンス
 */
export function getSpeechClient(): SpeechClient {
  if (_speechClient === null) {
    // 引数なしで ADC（Application Default Credentials）を自動使用
    _speechClient = new SpeechClient();
  }
  return _speechClient;
}

/**
 * テスト用: SpeechClient を差し替える。
 * テスト終了後に resetSpeechClient() で元に戻すこと。
 *
 * @param client モック SpeechClient インスタンス
 */
export function setSpeechClient(client: SpeechClient): void {
  _speechClient = client;
}

/**
 * テスト用: SpeechClient をリセットする（null に戻す）。
 */
export function resetSpeechClient(): void {
  _speechClient = null;
}

// ============================================================
// createSpeechStream のオプション型
// ============================================================

export interface SpeechStreamOptions {
  /** 認識言語コード。フルコード（"ja-JP" / "en-US"）のまま渡す。2文字変換は行わない。 */
  languageCode: string;
  /** interim 認識結果のコールバック */
  onInterim: (text: string) => void;
  /** final 認識結果のコールバック */
  onFinal: (text: string) => void;
  /**
   * エラー・時間上限到達時のコールバック。
   * @param message エラーメッセージ（ユーザー表示用。内部詳細は含めない）
   * @param fatal true の場合は致命的エラー（接続終了が必要）。false は継続可能。
   */
  onError: (message: string, fatal: boolean) => void;
}

// ============================================================
// createSpeechStream
// ============================================================

/**
 * Cloud Speech-to-Text Streaming ストリームを生成し、ハンドルを返す。
 *
 * - `streamingRecognize` に WEBM_OPUS / 48000Hz / interimResults:true を設定する。
 * - languageCode はフルコード（"ja-JP" / "en-US"）のまま渡す（2文字変換しない）。
 * - ストリームはセッション中切り直さない（WebM/Opus コンテナヘッダは最初のチャンクのみに含まれるため）。
 * - STT 時間上限到達時は onError("Speech recognition stream timed out...", false) で通知する（MVP方針）。
 *
 * テスト時は client 引数にモック SpeechClient を渡すことで GCP API なしで動作させられる。
 * モックは streamingRecognize が PassThrough 等の双方向ストリームを返す形にする。
 *
 * @param options コールバック群と言語コード
 * @param client テスト用クライアント注入（省略時はシングルトンを使用）
 * @returns SpeechStreamHandle（write / end / destroy）
 */
export function createSpeechStream(
  options: SpeechStreamOptions,
  client?: SpeechClient
): SpeechStreamHandle {
  const { languageCode, onInterim, onFinal, onError } = options;

  const speechClient = client ?? getSpeechClient();

  // streamingRecognize の設定
  // encoding: "WEBM_OPUS" / sampleRateHertz: 48000 / interimResults: true / enableAutomaticPunctuation: true
  const recognizeStream = speechClient
    .streamingRecognize({
      config: {
        encoding: "WEBM_OPUS",
        sampleRateHertz: 48000,
        languageCode,
        enableAutomaticPunctuation: true,
      },
      interimResults: true,
    })
    .on("data", (data: StreamingRecognizeResponse) => {
      // results が空の場合はスキップ
      if (!data.results || data.results.length === 0) {
        return;
      }

      const result = data.results[0];

      // alternatives が空の場合はスキップ
      if (!result.alternatives || result.alternatives.length === 0) {
        return;
      }

      const text = result.alternatives[0].transcript ?? "";

      if (result.isFinal) {
        // final: 発話バッファへ追加する確定テキスト
        console.log(`[speechStream] final: "${text}"`);
        onFinal(text);
      } else {
        // interim: 表示専用・翻訳・TTS は行わない
        console.log(`[speechStream] interim: "${text}"`);
        onInterim(text);
      }
    })
    .on("error", (err: Error) => {
      const message = err.message ?? String(err);
      console.error("[speechStream] STT stream error:", message);

      // STT 時間上限到達のエラーメッセージを判別
      // Google Cloud STT は時間上限に達すると "Audio Timeout Error" / "DEADLINE_EXCEEDED" 等を返す
      const isTimeout =
        message.includes("Audio Timeout") ||
        message.includes("DEADLINE_EXCEEDED") ||
        message.includes("audio timeout");

      if (isTimeout) {
        // 時間上限到達: fatal:false でクライアントへ再接続を促す（MVP方針）
        // 自動再ストリーミングは作り込まない（要件 §23 / gcp-integration.md 方針）
        onError(
          "Speech recognition stream timed out. Please stop and restart recording.",
          false
        );
      } else {
        // その他のSTTエラー: fatal:false で継続（server-design.md エラー処理方針）
        onError("Speech recognition error. Please try again.", false);
      }
    })
    .on("end", () => {
      console.log("[speechStream] STT stream ended.");
    });

  // SpeechStreamHandle として返す
  const handle: SpeechStreamHandle = {
    /**
     * Buffer を STT ストリームへ書き込む。
     * 呼び出し元（session.ts の onAudioChunk）で base64 → Buffer 変換を行い、
     * Buffer を渡すこと。
     */
    write(chunk: Buffer): void {
      try {
        recognizeStream.write(chunk);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[speechStream] Error writing to STT stream:", message);
        onError("Failed to send audio to speech recognition.", false);
      }
    },

    /**
     * STT ストリームへの書き込みを正常終了する。
     * stop メッセージ受信時に呼ぶ。
     */
    end(): void {
      try {
        recognizeStream.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[speechStream] Error ending STT stream:", message);
      }
    },

    /**
     * STT ストリームを強制破棄する。
     * 接続 close・再 start 時のクリーンアップに呼ぶ。
     */
    destroy(): void {
      try {
        recognizeStream.destroy();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[speechStream] Error destroying STT stream:", message);
      }
    },
  };

  return handle;
}

// ============================================================
// 型補助（@google-cloud/speech の内部型）
// ============================================================

/**
 * streamingRecognize の data イベントで受け取るレスポンス型。
 * @google-cloud/speech の型定義から必要な部分のみを抜き出す。
 */
interface StreamingRecognizeResponse {
  results?: Array<{
    alternatives?: Array<{
      transcript?: string;
    }>;
    isFinal?: boolean;
  }>;
}
