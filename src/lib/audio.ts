/**
 * 音声入力ユーティリティ
 *
 * MediaRecorder を使ったマイク録音チャンクの生成と、
 * Blob → ArrayBuffer → base64 変換を提供する。
 *
 * SSR 安全性: MediaRecorder / ArrayBuffer 等のブラウザ API は
 * 関数内でのみ参照し、モジュールトップレベルでは評価しない。
 */

// ============================================================
// 定数
// ============================================================

/**
 * 録音チャンクの送信間隔（ms）の既定値。
 * チャンク間隔の上書きは startRecording の chunkMs 引数で行う。
 */
export const DEFAULT_CHUNK_MS = 250;

/**
 * MediaRecorder の優先 mimeType。
 * フォールバック順に試みる。
 */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

// ============================================================
// 型定義
// ============================================================

/** 録音チャンクを受け取るコールバック型 */
export type OnChunkCallback = (base64: string) => void;

/** 録音制御ハンドル（startRecording の戻り値） */
export interface RecorderHandle {
  /** 録音を停止し、MediaStream トラックを解放する */
  stop: () => void;
}

// ============================================================
// base64 変換ユーティリティ
// ============================================================

/**
 * ArrayBuffer を base64 文字列に変換する。
 *
 * 変換方式: Uint8Array → チャンク分割 btoa
 * - `btoa(String.fromCharCode(...uint8Array))` は大きい配列でコールスタック超過のため禁止。
 * - Uint8Array を CHUNK_SIZE 単位で分割し、各チャンクを String.fromCharCode で変換後 btoa を呼ぶ。
 * - 各チャンクの base64 文字列を結合して完全な base64 を生成する。
 *
 * @param buffer 変換元 ArrayBuffer
 * @returns base64 文字列
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const uint8Array = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192; // 8 KB ずつ処理してスタックオーバーフローを防ぐ
  let binary = "";

  for (let offset = 0; offset < uint8Array.length; offset += CHUNK_SIZE) {
    const chunk = uint8Array.subarray(offset, offset + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

/**
 * Blob を base64 文字列に変換する（非同期）。
 *
 * 内部で Blob.arrayBuffer() → arrayBufferToBase64 を呼ぶ。
 *
 * @param blob 変換元 Blob
 * @returns base64 文字列
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

// ============================================================
// MediaRecorder サポート確認
// ============================================================

/**
 * ブラウザが対応している mimeType を返す。
 * 優先度順に `PREFERRED_MIME_TYPES` を試し、最初に対応しているものを返す。
 * 全て非対応の場合は undefined を返す。
 *
 * SSR 時（typeof window === "undefined"）は undefined を返す。
 */
export function getSupportedMimeType(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (typeof MediaRecorder === "undefined") return undefined;

  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return undefined;
}

// ============================================================
// 録音制御
// ============================================================

/**
 * MediaStream からマイク録音を開始する。
 *
 * - `audio/webm;codecs=opus` を優先し、非対応時はフォールバックを試みる。
 * - 全 mimeType が非対応の場合は console.warn を出し、デフォルト（mimeType 未指定）で続行する。
 * - `timeslice = chunkMs` で ondataavailable を定期発火させ、各チャンクを base64 変換してコールバックへ渡す。
 *
 * @param stream    getUserMedia で取得した MediaStream
 * @param onChunk   base64 変換済みチャンクを受け取るコールバック
 * @param chunkMs   チャンク間隔（ms）。既定は DEFAULT_CHUNK_MS
 * @returns 録音停止用ハンドル
 */
export function startRecording(
  stream: MediaStream,
  onChunk: OnChunkCallback,
  chunkMs: number = DEFAULT_CHUNK_MS,
): RecorderHandle {
  const supportedMimeType = getSupportedMimeType();

  if (supportedMimeType === undefined) {
    console.warn(
      "[audio.ts] No preferred mimeType supported by this browser. " +
        "Falling back to browser default. Audio encoding may differ from expected WebM/Opus.",
    );
  }

  const options: MediaRecorderOptions = supportedMimeType
    ? { mimeType: supportedMimeType }
    : {};

  const recorder = new MediaRecorder(stream, options);

  recorder.ondataavailable = (event: BlobEvent) => {
    const blob = event.data;
    if (blob.size === 0) return;

    // 非同期で base64 変換してコールバックへ渡す
    blobToBase64(blob)
      .then((base64) => {
        onChunk(base64);
      })
      .catch((err: unknown) => {
        console.error("[audio.ts] Failed to convert blob to base64:", err);
      });
  };

  recorder.start(chunkMs);

  return {
    stop: () => {
      if (
        recorder.state === "recording" ||
        recorder.state === "paused"
      ) {
        recorder.stop();
      }
      // MediaStream トラックを解放してマイクアクセスを終了する
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
