/**
 * appReducer の単体テスト
 *
 * 純粋関数のため jsdom 不要。jest.config.js のデフォルト（node）で動作する。
 */

import { appReducer, initialState, AppActions } from "../../src/lib/appReducer";
import type { AppState, AppAction, Metrics } from "../../src/lib/types";

// ============================================================
// テストヘルパー
// ============================================================

/** テスト用の基本 state を返す（deepCopy して使う） */
function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    ...initialState,
    transcript: { ...initialState.transcript },
    ...overrides,
  };
}

/** Metrics オブジェクトを生成する */
function makeMetrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    speechMs: 100,
    translationMs: 200,
    ttsMs: 300,
    totalMs: 600,
    ...overrides,
  };
}

// ============================================================
// テストスイート
// ============================================================

describe("appReducer", () => {
  // ----------------------------------------------------------
  // 1. STATUS_CHANGED
  // ----------------------------------------------------------
  describe("STATUS_CHANGED アクション", () => {
    it("status が指定した値に変わる", () => {
      const state = makeState({ status: "idle" });
      const next = appReducer(state, AppActions.statusChanged("connecting"));
      expect(next.status).toBe("connecting");
    });

    it("idle → recording への遷移で他のフィールドは変わらない", () => {
      const state = makeState({ status: "idle" });
      const next = appReducer(state, AppActions.statusChanged("recording"));
      expect(next.transcript).toEqual(state.transcript);
      expect(next.metrics).toEqual(state.metrics);
      expect(next.error).toEqual(state.error);
    });

    it("各ステータス値に遷移できる", () => {
      const statuses = ["idle", "connecting", "connected", "recording", "disconnected", "error"] as const;
      statuses.forEach((s) => {
        const next = appReducer(makeState(), AppActions.statusChanged(s));
        expect(next.status).toBe(s);
      });
    });
  });

  // ----------------------------------------------------------
  // 2. INTERIM
  // ----------------------------------------------------------
  describe("INTERIM アクション", () => {
    it("transcript.interim が更新される", () => {
      const state = makeState();
      const next = appReducer(state, AppActions.interim("認識中のテキスト"));
      expect(next.transcript.interim).toBe("認識中のテキスト");
    });

    it("transcript の他フィールド（finals / committed / translations）は変わらない", () => {
      const state = makeState({
        transcript: {
          interim: "",
          finals: ["確定1"],
          committed: "コミット済み",
          translations: [{ sourceText: "src", translatedText: "tgt" }],
        },
      });
      const next = appReducer(state, AppActions.interim("中間テキスト"));
      expect(next.transcript.finals).toEqual(["確定1"]);
      expect(next.transcript.committed).toBe("コミット済み");
      expect(next.transcript.translations).toEqual([{ sourceText: "src", translatedText: "tgt" }]);
    });

    it("空文字列で interim をクリアできる", () => {
      const state = makeState({ transcript: { ...initialState.transcript, interim: "前の中間テキスト" } });
      const next = appReducer(state, AppActions.interim(""));
      expect(next.transcript.interim).toBe("");
    });
  });

  // ----------------------------------------------------------
  // 3. FINAL
  // ----------------------------------------------------------
  describe("FINAL アクション", () => {
    it("transcript.interim がクリアされる", () => {
      const state = makeState({ transcript: { ...initialState.transcript, interim: "中間テキスト" } });
      const next = appReducer(state, AppActions.final("確定テキスト"));
      expect(next.transcript.interim).toBe("");
    });

    it("transcript.finals に新しいテキストが追加される", () => {
      const state = makeState({ transcript: { ...initialState.transcript, finals: ["確定1"] } });
      const next = appReducer(state, AppActions.final("確定2"));
      expect(next.transcript.finals).toEqual(["確定1", "確定2"]);
    });

    it("finals が空の状態から追加できる", () => {
      const state = makeState();
      const next = appReducer(state, AppActions.final("最初の確定"));
      expect(next.transcript.finals).toEqual(["最初の確定"]);
    });

    it("committed / translations は変わらない", () => {
      const state = makeState({
        transcript: {
          ...initialState.transcript,
          committed: "コミット済み",
          translations: [{ sourceText: "s", translatedText: "t" }],
        },
      });
      const next = appReducer(state, AppActions.final("確定テキスト"));
      expect(next.transcript.committed).toBe("コミット済み");
      expect(next.transcript.translations).toEqual([{ sourceText: "s", translatedText: "t" }]);
    });
  });

  // ----------------------------------------------------------
  // 4. COMMITTED
  // ----------------------------------------------------------
  describe("COMMITTED アクション", () => {
    it("transcript.interim がクリアされる", () => {
      const state = makeState({ transcript: { ...initialState.transcript, interim: "中間テキスト" } });
      const next = appReducer(state, AppActions.committed("コミットテキスト", "silence"));
      expect(next.transcript.interim).toBe("");
    });

    it("transcript.committed が更新される", () => {
      const state = makeState();
      const next = appReducer(state, AppActions.committed("新しいコミット", "maxChars"));
      expect(next.transcript.committed).toBe("新しいコミット");
    });

    it("finals / translations は変わらない", () => {
      const state = makeState({
        transcript: {
          ...initialState.transcript,
          finals: ["確定1", "確定2"],
          translations: [{ sourceText: "s", translatedText: "t" }],
        },
      });
      const next = appReducer(state, AppActions.committed("コミット", "stop"));
      expect(next.transcript.finals).toEqual(["確定1", "確定2"]);
      expect(next.transcript.translations).toEqual([{ sourceText: "s", translatedText: "t" }]);
    });

    it("各 reason（silence / maxChars / maxSeconds / commit / stop）で動作する", () => {
      const reasons = ["silence", "maxChars", "maxSeconds", "commit", "stop"] as const;
      reasons.forEach((reason) => {
        const state = makeState();
        const next = appReducer(state, AppActions.committed("テキスト", reason));
        expect(next.transcript.committed).toBe("テキスト");
      });
    });
  });

  // ----------------------------------------------------------
  // 5. TRANSLATION
  // ----------------------------------------------------------
  describe("TRANSLATION アクション", () => {
    it("transcript.translations に翻訳結果が追加される", () => {
      const state = makeState();
      const next = appReducer(state, AppActions.translation("原文", "Translation"));
      expect(next.transcript.translations).toEqual([
        { sourceText: "原文", translatedText: "Translation" },
      ]);
    });

    it("既存の翻訳履歴に追記される（上書きではない）", () => {
      const state = makeState({
        transcript: {
          ...initialState.transcript,
          translations: [{ sourceText: "既存原文", translatedText: "Existing" }],
        },
      });
      const next = appReducer(state, AppActions.translation("新原文", "New translation"));
      expect(next.transcript.translations).toHaveLength(2);
      expect(next.transcript.translations[0]).toEqual({ sourceText: "既存原文", translatedText: "Existing" });
      expect(next.transcript.translations[1]).toEqual({ sourceText: "新原文", translatedText: "New translation" });
    });

    it("interim / finals / committed は変わらない", () => {
      const state = makeState({
        transcript: {
          interim: "中間",
          finals: ["確定"],
          committed: "コミット",
          translations: [],
        },
      });
      const next = appReducer(state, AppActions.translation("原文", "翻訳"));
      expect(next.transcript.interim).toBe("中間");
      expect(next.transcript.finals).toEqual(["確定"]);
      expect(next.transcript.committed).toBe("コミット");
    });
  });

  // ----------------------------------------------------------
  // 6. METRICS
  // ----------------------------------------------------------
  describe("METRICS アクション", () => {
    it("metrics が更新される", () => {
      const state = makeState();
      const metrics = makeMetrics();
      const next = appReducer(state, AppActions.metrics(metrics));
      expect(next.metrics).toMatchObject({
        speechMs: 100,
        translationMs: 200,
        ttsMs: 300,
        totalMs: 600,
      });
    });

    it("既存の playbackStartedAt が引き継がれる", () => {
      const state = makeState({
        metrics: makeMetrics({ playbackStartedAt: 12345 }),
      });
      const newMetrics = makeMetrics({ speechMs: 500 });
      const next = appReducer(state, AppActions.metrics(newMetrics));
      expect(next.metrics?.playbackStartedAt).toBe(12345);
    });

    it("初回 METRICS では playbackStartedAt が undefined になる（既存 metrics が null）", () => {
      const state = makeState({ metrics: null });
      const next = appReducer(state, AppActions.metrics(makeMetrics()));
      expect(next.metrics?.playbackStartedAt).toBeUndefined();
    });

    it("metrics 更新で transcript / status は変わらない", () => {
      const state = makeState({
        status: "recording",
        transcript: { ...initialState.transcript, interim: "中間テキスト" },
      });
      const next = appReducer(state, AppActions.metrics(makeMetrics()));
      expect(next.status).toBe("recording");
      expect(next.transcript.interim).toBe("中間テキスト");
    });
  });

  // ----------------------------------------------------------
  // 7. ERROR
  // ----------------------------------------------------------
  describe("ERROR アクション", () => {
    it("fatal:true の場合 status が 'error' に変わる", () => {
      const state = makeState({ status: "recording" });
      const next = appReducer(state, AppActions.error("致命的エラー", true));
      expect(next.status).toBe("error");
    });

    it("fatal:false の場合 status は変わらない", () => {
      const state = makeState({ status: "recording" });
      const next = appReducer(state, AppActions.error("軽微なエラー", false));
      expect(next.status).toBe("recording");
    });

    it("error メッセージが state.error に設定される", () => {
      const state = makeState();
      const next = appReducer(state, AppActions.error("エラーメッセージ", false));
      expect(next.error).toBe("エラーメッセージ");
    });

    it("transcript / metrics は変わらない", () => {
      const state = makeState({
        transcript: { ...initialState.transcript, interim: "テキスト" },
        metrics: makeMetrics(),
      });
      const next = appReducer(state, AppActions.error("エラー", true));
      expect(next.transcript.interim).toBe("テキスト");
      expect(next.metrics).toMatchObject({ speechMs: 100 });
    });
  });

  // ----------------------------------------------------------
  // 8. RESET
  // ----------------------------------------------------------
  describe("RESET アクション", () => {
    it("initialState に戻る", () => {
      const state: AppState = {
        status: "recording",
        transcript: {
          interim: "中間テキスト",
          finals: ["確定1", "確定2"],
          committed: "コミット済み",
          translations: [{ sourceText: "s", translatedText: "t" }],
        },
        metrics: makeMetrics(),
        error: "何らかのエラー",
      };
      const next = appReducer(state, AppActions.reset());
      expect(next).toEqual(initialState);
    });

    it("status が idle になる", () => {
      const state = makeState({ status: "error" });
      const next = appReducer(state, AppActions.reset());
      expect(next.status).toBe("idle");
    });

    it("transcript がクリアされる", () => {
      const state = makeState({
        transcript: {
          interim: "中間",
          finals: ["f1"],
          committed: "コミット",
          translations: [{ sourceText: "s", translatedText: "t" }],
        },
      });
      const next = appReducer(state, AppActions.reset());
      expect(next.transcript.interim).toBe("");
      expect(next.transcript.finals).toEqual([]);
      expect(next.transcript.committed).toBe("");
      expect(next.transcript.translations).toEqual([]);
    });

    it("metrics が null になる", () => {
      const state = makeState({ metrics: makeMetrics() });
      const next = appReducer(state, AppActions.reset());
      expect(next.metrics).toBeNull();
    });

    it("error が null になる", () => {
      const state = makeState({ error: "エラーメッセージ" });
      const next = appReducer(state, AppActions.reset());
      expect(next.error).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // 9. 未知 action（exhaustive default）
  // ----------------------------------------------------------
  describe("未知 action", () => {
    it("未知の type で state をそのまま返す（破壊しない）", () => {
      const state = makeState({ status: "recording" });
      // TypeScript の型システムを回避して未知アクションを渡す
      const unknownAction = { type: "UNKNOWN_ACTION_XYZ" } as unknown as AppAction;
      const next = appReducer(state, unknownAction);
      expect(next).toBe(state); // 同一参照
    });
  });

  // ----------------------------------------------------------
  // 10. 純粋性（入力 state を mutate しない）
  // ----------------------------------------------------------
  describe("純粋性（入力 state の不変性）", () => {
    it("STATUS_CHANGED は入力 state を変更しない", () => {
      const state = makeState({ status: "idle" });
      const stateBefore = JSON.stringify(state);
      appReducer(state, AppActions.statusChanged("recording"));
      expect(JSON.stringify(state)).toBe(stateBefore);
    });

    it("INTERIM は入力 state を変更しない", () => {
      const state = makeState({ transcript: { ...initialState.transcript, interim: "元のテキスト" } });
      const stateBefore = JSON.stringify(state);
      appReducer(state, AppActions.interim("新しいテキスト"));
      expect(JSON.stringify(state)).toBe(stateBefore);
    });

    it("FINAL は入力 state を変更しない（finals 配列の参照も変わらない）", () => {
      const originalFinals = ["確定1"];
      const state = makeState({ transcript: { ...initialState.transcript, finals: originalFinals } });
      appReducer(state, AppActions.final("確定2"));
      expect(state.transcript.finals).toEqual(["確定1"]); // 元の配列は変わっていない
      expect(state.transcript.finals).toBe(originalFinals); // 元の配列の参照も維持
    });

    it("TRANSLATION は入力 state を変更しない（translations 配列の参照も変わらない）", () => {
      const originalTranslations = [{ sourceText: "s", translatedText: "t" }];
      const state = makeState({ transcript: { ...initialState.transcript, translations: originalTranslations } });
      appReducer(state, AppActions.translation("新原文", "新翻訳"));
      expect(state.transcript.translations).toHaveLength(1);
      expect(state.transcript.translations).toBe(originalTranslations);
    });

    it("METRICS は入力 state を変更しない", () => {
      const state = makeState({ metrics: makeMetrics() });
      const stateBefore = JSON.stringify(state);
      appReducer(state, AppActions.metrics(makeMetrics({ speechMs: 999 })));
      expect(JSON.stringify(state)).toBe(stateBefore);
    });

    it("ERROR は入力 state を変更しない", () => {
      const state = makeState({ status: "recording" });
      const stateBefore = JSON.stringify(state);
      appReducer(state, AppActions.error("エラー", true));
      expect(JSON.stringify(state)).toBe(stateBefore);
    });

    it("RESET は入力 state を変更しない", () => {
      const state: AppState = {
        status: "recording",
        transcript: {
          interim: "中間",
          finals: ["確定"],
          committed: "コミット",
          translations: [{ sourceText: "s", translatedText: "t" }],
        },
        metrics: makeMetrics(),
        error: "エラー",
      };
      const stateBefore = JSON.stringify(state);
      appReducer(state, AppActions.reset());
      expect(JSON.stringify(state)).toBe(stateBefore);
    });
  });

  // ----------------------------------------------------------
  // 11. PLAYBACK_WAIT アクション
  // ----------------------------------------------------------
  describe("PLAYBACK_WAIT アクション", () => {
    it("metrics が非 null のとき clientPlaybackWaitMs が設定される", () => {
      const state = makeState({ metrics: makeMetrics() });
      const next = appReducer(state, AppActions.playbackWait(123));
      expect(next.metrics?.clientPlaybackWaitMs).toBe(123);
    });

    it("metrics が null のとき state がそのまま返る（クラッシュしない）", () => {
      const state = makeState({ metrics: null });
      const next = appReducer(state, AppActions.playbackWait(123));
      expect(next).toBe(state);
    });

    it("metrics が null のとき metrics は null のまま", () => {
      const state = makeState({ metrics: null });
      const next = appReducer(state, AppActions.playbackWait(999));
      expect(next.metrics).toBeNull();
    });

    it("waitMs=0 でも正しく設定される", () => {
      const state = makeState({ metrics: makeMetrics() });
      const next = appReducer(state, AppActions.playbackWait(0));
      expect(next.metrics?.clientPlaybackWaitMs).toBe(0);
    });

    it("PLAYBACK_WAIT は入力 state を mutate しない", () => {
      const state = makeState({ metrics: makeMetrics() });
      const stateBefore = JSON.stringify(state);
      appReducer(state, AppActions.playbackWait(100));
      expect(JSON.stringify(state)).toBe(stateBefore);
    });

    it("他のフィールド（status / transcript / error）は変わらない", () => {
      const state = makeState({
        status: "recording",
        metrics: makeMetrics(),
        transcript: { ...initialState.transcript, interim: "中間テキスト" },
        error: "既存エラー",
      });
      const next = appReducer(state, AppActions.playbackWait(50));
      expect(next.status).toBe("recording");
      expect(next.transcript.interim).toBe("中間テキスト");
      expect(next.error).toBe("既存エラー");
    });
  });

  // ----------------------------------------------------------
  // 12. METRICS アクションによる clientPlaybackWaitMs クリア
  // ----------------------------------------------------------
  describe("METRICS アクションによる clientPlaybackWaitMs クリア", () => {
    it("METRICS アクションで clientPlaybackWaitMs が undefined にクリアされる", () => {
      const state = makeState({
        metrics: makeMetrics({ clientPlaybackWaitMs: 200 }),
      });
      const next = appReducer(state, AppActions.metrics(makeMetrics()));
      expect(next.metrics?.clientPlaybackWaitMs).toBeUndefined();
    });

    it("METRICS → PLAYBACK_WAIT → METRICS の順で古い待ち時間が次の METRICS でクリアされる", () => {
      // Step1: METRICS で metrics を設定
      const state1 = appReducer(makeState(), AppActions.metrics(makeMetrics({ totalMs: 500 })));
      expect(state1.metrics?.clientPlaybackWaitMs).toBeUndefined();

      // Step2: PLAYBACK_WAIT で clientPlaybackWaitMs を設定
      const state2 = appReducer(state1, AppActions.playbackWait(150));
      expect(state2.metrics?.clientPlaybackWaitMs).toBe(150);

      // Step3: 次の METRICS が来たら clientPlaybackWaitMs がクリアされる
      const state3 = appReducer(state2, AppActions.metrics(makeMetrics({ totalMs: 600 })));
      expect(state3.metrics?.clientPlaybackWaitMs).toBeUndefined();
      expect(state3.metrics?.totalMs).toBe(600);
    });
  });

  // ----------------------------------------------------------
  // 13. AppActions ヘルパー
  // ----------------------------------------------------------
  describe("AppActions ヘルパー", () => {
    it("statusChanged が正しい型の action を返す", () => {
      const action = AppActions.statusChanged("connected");
      expect(action).toEqual({ type: "STATUS_CHANGED", status: "connected" });
    });

    it("interim が正しい型の action を返す", () => {
      const action = AppActions.interim("テキスト");
      expect(action).toEqual({ type: "INTERIM", text: "テキスト" });
    });

    it("final が正しい型の action を返す", () => {
      const action = AppActions.final("確定テキスト");
      expect(action).toEqual({ type: "FINAL", text: "確定テキスト" });
    });

    it("committed が正しい型の action を返す", () => {
      const action = AppActions.committed("コミット", "silence");
      expect(action).toEqual({ type: "COMMITTED", text: "コミット", reason: "silence" });
    });

    it("translation が正しい型の action を返す", () => {
      const action = AppActions.translation("原文", "翻訳");
      expect(action).toEqual({ type: "TRANSLATION", sourceText: "原文", translatedText: "翻訳" });
    });

    it("metrics が正しい型の action を返す", () => {
      const m = makeMetrics();
      const action = AppActions.metrics(m);
      expect(action).toEqual({ type: "METRICS", metrics: m });
    });

    it("error が正しい型の action を返す", () => {
      const action = AppActions.error("エラー", true);
      expect(action).toEqual({ type: "ERROR", message: "エラー", fatal: true });
    });

    it("reset が正しい型の action を返す", () => {
      const action = AppActions.reset();
      expect(action).toEqual({ type: "RESET" });
    });

    it("playbackWait が正しい型の action を返す", () => {
      const action = AppActions.playbackWait(42);
      expect(action).toEqual({ type: "PLAYBACK_WAIT", waitMs: 42 });
    });
  });
});
