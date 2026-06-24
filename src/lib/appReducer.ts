/**
 * アプリケーション状態 reducer
 *
 * useReducer で使用する純粋関数。
 * テストしやすさのため TranslatorApp から分離し、単独でエクスポートする。
 */

import type {
  AppState,
  AppAction,
  AppStatus,
  TranscriptState,
  Metrics,
  UtteranceCommitReason,
} from "./types";

// ============================================================
// 初期状態
// ============================================================

export const initialTranscriptState: TranscriptState = {
  interim: "",
  finals: [],
  committed: "",
  translations: [],
};

export const initialState: AppState = {
  status: "idle",
  transcript: initialTranscriptState,
  metrics: null,
  error: null,
};

// ============================================================
// reducer
// ============================================================

/**
 * AppState の reducer。
 *
 * @param state  現在の状態
 * @param action ディスパッチされたアクション
 * @returns 新しい状態
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "STATUS_CHANGED": {
      return {
        ...state,
        status: action.status,
        // error 状態へ遷移する場合以外は error をクリアしない
        // （エラーメッセージは ERROR アクションで設定する）
      };
    }

    case "INTERIM": {
      return {
        ...state,
        transcript: {
          ...state.transcript,
          interim: action.text,
        },
      };
    }

    case "FINAL": {
      return {
        ...state,
        transcript: {
          ...state.transcript,
          interim: "",
          finals: [...state.transcript.finals, action.text],
        },
      };
    }

    case "COMMITTED": {
      return {
        ...state,
        transcript: {
          ...state.transcript,
          interim: "",
          committed: action.text,
        },
      };
    }

    case "TRANSLATION": {
      return {
        ...state,
        transcript: {
          ...state.transcript,
          translations: [
            ...state.transcript.translations,
            {
              sourceText: action.sourceText,
              translatedText: action.translatedText,
            },
          ],
        },
      };
    }

    case "METRICS": {
      const prev: Metrics | null = state.metrics;
      const updated: Metrics = {
        ...action.metrics,
        // playbackStartedAt はクライアント側で別途設定するため、既存値を引き継ぐ
        playbackStartedAt: prev?.playbackStartedAt,
        // 新しい発話の metrics が来たら clientPlaybackWaitMs をクリア（古い待ち時間を引きずらない）
        clientPlaybackWaitMs: undefined,
      };
      return {
        ...state,
        metrics: updated,
      };
    }

    case "PLAYBACK_WAIT": {
      // metrics が null のときは無視（クラッシュしない）
      if (state.metrics === null) return state;
      return {
        ...state,
        metrics: {
          ...state.metrics,
          clientPlaybackWaitMs: action.waitMs,
        },
      };
    }

    case "ERROR": {
      const nextStatus: AppStatus = action.fatal ? "error" : state.status;
      return {
        ...state,
        status: nextStatus,
        error: action.message,
      };
    }

    case "RESET": {
      return {
        ...initialState,
        // status は idle に戻す（initialState のまま）
      };
    }

    default: {
      // TypeScript exhaustive check
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _: never = action;
      return state;
    }
  }
}

// ============================================================
// action creator ヘルパー（テスト・呼び出し元で使いやすくする）
// ============================================================

export const AppActions = {
  statusChanged: (status: AppStatus): AppAction => ({
    type: "STATUS_CHANGED",
    status,
  }),
  interim: (text: string): AppAction => ({
    type: "INTERIM",
    text,
  }),
  final: (text: string): AppAction => ({
    type: "FINAL",
    text,
  }),
  committed: (text: string, reason: UtteranceCommitReason): AppAction => ({
    type: "COMMITTED",
    text,
    reason,
  }),
  translation: (sourceText: string, translatedText: string): AppAction => ({
    type: "TRANSLATION",
    sourceText,
    translatedText,
  }),
  metrics: (metrics: Metrics): AppAction => ({
    type: "METRICS",
    metrics,
  }),
  playbackWait: (waitMs: number): AppAction => ({
    type: "PLAYBACK_WAIT",
    waitMs,
  }),
  error: (message: string, fatal: boolean): AppAction => ({
    type: "ERROR",
    message,
    fatal,
  }),
  reset: (): AppAction => ({
    type: "RESET",
  }),
} as const;
