/**
 * @jest-environment jsdom
 */

/**
 * TranscriptView コンポーネントの単体テスト
 *
 * jest.config.js の testMatch は *.test.ts のみのため、
 * JSX 記法は使わず React.createElement でコンポーネントをレンダリングする。
 *
 * CSS Modules は ts-jest が解釈できないため jest.mock で空オブジェクトに差し替える。
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// ============================================================
// CSS Modules モック
// ============================================================

jest.mock("../../src/components/TranscriptView.module.css", () => ({}));

// ============================================================
// テスト対象
// ============================================================

import { TranscriptView } from "../../src/components/TranscriptView";
import type { TranscriptState } from "../../src/lib/types";

// ============================================================
// テストヘルパー
// ============================================================

function renderTranscriptView(transcript: TranscriptState) {
  return render(React.createElement(TranscriptView, { transcript }));
}

function makeEmptyTranscript(overrides: Partial<TranscriptState> = {}): TranscriptState {
  return {
    interim: "",
    finals: [],
    committed: "",
    translations: [],
    ...overrides,
  };
}

// ============================================================
// セットアップ / ティアダウン
// ============================================================

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// テストスイート
// ============================================================

describe("TranscriptView", () => {
  // ----------------------------------------------------------
  // 1. aria-label リージョン
  // ----------------------------------------------------------
  describe("aria-label リージョン", () => {
    it("「認識中テキスト」aria-label のセクションが存在する", () => {
      renderTranscriptView(makeEmptyTranscript());
      expect(screen.getByRole("region", { name: "認識中テキスト" })).toBeInTheDocument();
    });

    it("「認識確定テキスト」aria-label のセクションが存在する", () => {
      renderTranscriptView(makeEmptyTranscript());
      expect(screen.getByRole("region", { name: "認識確定テキスト" })).toBeInTheDocument();
    });

    it("「翻訳テキスト」aria-label のセクションが存在する", () => {
      renderTranscriptView(makeEmptyTranscript());
      expect(screen.getByRole("region", { name: "翻訳テキスト" })).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 2. interim テキストの表示
  // ----------------------------------------------------------
  describe("interim テキスト", () => {
    it("interim が空文字のとき「（待機中）」が表示される", () => {
      renderTranscriptView(makeEmptyTranscript({ interim: "" }));
      expect(screen.getByText("（待機中）")).toBeInTheDocument();
    });

    it("interim に値があるとき、そのテキストが認識中セクションに表示される", () => {
      renderTranscriptView(makeEmptyTranscript({ interim: "認識中のテキスト" }));
      expect(screen.getByText("認識中のテキスト")).toBeInTheDocument();
    });

    it("interim に値があるとき「（待機中）」は表示されない", () => {
      renderTranscriptView(makeEmptyTranscript({ interim: "何か話している" }));
      expect(screen.queryByText("（待機中）")).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 3. finals（確定発話履歴）の表示
  // ----------------------------------------------------------
  describe("finals（確定発話）", () => {
    it("finals が空のとき「（なし）」が認識確定セクションに表示される", () => {
      renderTranscriptView(makeEmptyTranscript({ finals: [] }));
      const section = screen.getByRole("region", { name: "認識確定テキスト" });
      expect(section).toHaveTextContent("（なし）");
    });

    it("finals に1件あるときそのテキストがリスト表示される", () => {
      renderTranscriptView(makeEmptyTranscript({ finals: ["確定したテキスト"] }));
      expect(screen.getByText("確定したテキスト")).toBeInTheDocument();
    });

    it("finals に複数件あるとき全テキストがリスト表示される", () => {
      renderTranscriptView(makeEmptyTranscript({ finals: ["一文目", "二文目", "三文目"] }));
      expect(screen.getByText("一文目")).toBeInTheDocument();
      expect(screen.getByText("二文目")).toBeInTheDocument();
      expect(screen.getByText("三文目")).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 4. translations（翻訳結果）の表示
  // ----------------------------------------------------------
  describe("translations（翻訳結果）", () => {
    it("translations が空のとき「（なし）」が翻訳セクションに表示される", () => {
      renderTranscriptView(makeEmptyTranscript({ translations: [] }));
      const section = screen.getByRole("region", { name: "翻訳テキスト" });
      expect(section).toHaveTextContent("（なし）");
    });

    it("translations に1件あるとき sourceText と translatedText が表示される", () => {
      renderTranscriptView(
        makeEmptyTranscript({
          translations: [{ sourceText: "こんにちは", translatedText: "Hello" }],
        })
      );
      expect(screen.getByText("こんにちは")).toBeInTheDocument();
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });

    it("translations に複数件あるとき全ペアが表示される", () => {
      renderTranscriptView(
        makeEmptyTranscript({
          translations: [
            { sourceText: "おはよう", translatedText: "Good morning" },
            { sourceText: "ありがとう", translatedText: "Thank you" },
          ],
        })
      );
      expect(screen.getByText("おはよう")).toBeInTheDocument();
      expect(screen.getByText("Good morning")).toBeInTheDocument();
      expect(screen.getByText("ありがとう")).toBeInTheDocument();
      expect(screen.getByText("Thank you")).toBeInTheDocument();
    });
  });
});
