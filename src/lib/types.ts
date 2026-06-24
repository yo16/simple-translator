// ============================================================
// 共通
// ============================================================

export type SupportedLanguage = "ja-JP" | "en-US";

export type UtteranceCommitReason =
  | "silence"
  | "maxChars"
  | "maxSeconds"
  | "commit"
  | "stop";

// ============================================================
// アプリケーション状態
// ============================================================

export type AppStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "recording"
  | "disconnected"
  | "error";

export interface TranscriptState {
  /** 認識途中結果（表示専用。次のinterim/finalで置換） */
  interim: string;
  /** 認識確定の履歴 */
  finals: string[];
  /** 直近の確定発話 */
  committed: string;
  /** 翻訳結果の履歴 */
  translations: { sourceText: string; translatedText: string }[];
}

export interface Metrics {
  speechMs: number;
  translationMs: number;
  ttsMs: number;
  totalMs: number;
  /** クライアントで記録する再生開始時刻（Unix milliseconds） */
  playbackStartedAt?: number;
  /** クライアントで計測した「audio受信〜再生開始」の待ち時間（ms） */
  clientPlaybackWaitMs?: number;
}

export interface AppState {
  status: AppStatus;
  transcript: TranscriptState;
  metrics: Metrics | null;
  error: string | null;
}

// ============================================================
// 設定
// ============================================================

export interface Settings {
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
// reducer アクション
// ============================================================

export type AppAction =
  | { type: "STATUS_CHANGED"; status: AppStatus }
  | { type: "INTERIM"; text: string }
  | { type: "FINAL"; text: string }
  | { type: "COMMITTED"; text: string; reason: UtteranceCommitReason }
  | { type: "TRANSLATION"; sourceText: string; translatedText: string }
  | { type: "METRICS"; metrics: Metrics }
  | { type: "PLAYBACK_WAIT"; waitMs: number }
  | { type: "ERROR"; message: string; fatal: boolean }
  | { type: "RESET" };

// ============================================================
// client → server メッセージ型（フロント送信用）
// ============================================================

export interface StartMessage {
  type: "start";
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  enableTts: boolean;
  enableInterimTranslation: boolean;
  chunkMs: number;
  silenceMs: number;
  maxChars: number;
  maxSeconds: number;
}

export interface AudioClientMessage {
  type: "audio";
  /** base64 エンコードされた WebM/Opus 音声チャンク */
  data: string;
}

export interface CommitMessage {
  type: "commit";
}

export interface StopMessage {
  type: "stop";
}

export type ClientMessage =
  | StartMessage
  | AudioClientMessage
  | CommitMessage
  | StopMessage;

// ============================================================
// server → client メッセージ型（フロント受信用）
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
  /** base64 エンコードされた MP3 音声 */
  data: string;
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
