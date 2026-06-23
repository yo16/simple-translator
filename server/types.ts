// ============================================================
// セッション設定
// ============================================================

export type SupportedLanguage = "ja-JP" | "en-US";

export interface SessionConfig {
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  enableTts: boolean;
  enableInterimTranslation: boolean;
  chunkMs: number;
  silenceMs: number;
  maxChars: number;
  maxSeconds: number;
}

// ============================================================
// 発話区切り理由
// ============================================================

export type UtteranceCommitReason =
  | "silence"
  | "maxChars"
  | "maxSeconds"
  | "commit"
  | "stop";

// ============================================================
// レイテンシ計測用タイムスタンプ
// ============================================================

export interface TimingMarks {
  /** 発話開始時刻（最初の audio/interim を受け取った時刻）。BigInt nanoseconds */
  speechStartedAt: bigint | null;
  /** 発話区切り確定時刻 */
  committedAt: bigint | null;
  /** Translation 呼び出し開始時刻 */
  translationStartedAt: bigint | null;
  /** Translation 結果受信時刻 */
  translationEndedAt: bigint | null;
  /** TTS 呼び出し開始時刻 */
  ttsStartedAt: bigint | null;
  /** TTS 結果受信時刻 */
  ttsEndedAt: bigint | null;
}

// ============================================================
// STT ストリームハンドル（speechStream.ts が返す）
// ============================================================

export interface SpeechStreamHandle {
  write(chunk: Buffer): void;
  end(): void;
  destroy(): void;
}

// ============================================================
// 発話バッファ（utteranceBuffer.ts が管理）
// ============================================================

export interface UtteranceBuffer {
  finals: string[];
  startedAt: bigint | null;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  maxDurationTimer: ReturnType<typeof setTimeout> | null;
}

// ============================================================
// セッション状態
// ============================================================

export interface SessionState {
  initialized: boolean;
  config: SessionConfig | null;
  speech: SpeechStreamHandle | null;
  buffer: UtteranceBuffer;
  timing: TimingMarks;
}

// ============================================================
// server → client メッセージ型
// ============================================================

export interface TranscriptInterimMessage {
  type: "transcript_interim";
  text: string;
}

export interface TranscriptFinalMessage {
  type: "transcript_final";
  text: string;
}

export interface UtteranceCommittedMessage {
  type: "utterance_committed";
  text: string;
  reason: UtteranceCommitReason;
}

export interface TranslationMessage {
  type: "translation";
  sourceText: string;
  translatedText: string;
}

export interface AudioServerMessage {
  type: "audio";
  mimeType: "audio/mpeg";
  data: string; // base64 encoded MP3
}

export interface MetricsMessage {
  type: "metrics";
  speechMs: number;
  translationMs: number;
  ttsMs: number;
  totalMs: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
  fatal: boolean;
}

export type ServerMessage =
  | TranscriptInterimMessage
  | TranscriptFinalMessage
  | UtteranceCommittedMessage
  | TranslationMessage
  | AudioServerMessage
  | MetricsMessage
  | ErrorMessage;
