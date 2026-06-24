/**
 * @jest-environment jsdom
 */

/**
 * LanguageSelector コンポーネントの単体テスト
 *
 * jest.config.js の testMatch は *.test.ts のみのため、
 * JSX 記法は使わず React.createElement でコンポーネントをレンダリングする。
 *
 * CSS Modules は ts-jest が解釈できないため jest.mock で空オブジェクトに差し替える。
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// ============================================================
// CSS Modules モック
// ============================================================

jest.mock("../../src/components/LanguageSelector.module.css", () => ({}));

// ============================================================
// テスト対象
// ============================================================

import { LanguageSelector } from "../../src/components/LanguageSelector";
import type { LanguageSelectorProps } from "../../src/components/LanguageSelector";

// ============================================================
// テストヘルパー
// ============================================================

function renderLanguageSelector(props: LanguageSelectorProps) {
  return render(React.createElement(LanguageSelector, props));
}

function makeDefaultProps(overrides: Partial<LanguageSelectorProps> = {}): LanguageSelectorProps {
  return {
    sourceLanguage: "ja-JP",
    targetLanguage: "en-US",
    status: "idle",
    onToggle: jest.fn(),
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

describe("LanguageSelector", () => {
  // ----------------------------------------------------------
  // 1. 言語表示
  // ----------------------------------------------------------
  describe("言語ラベルの表示", () => {
    it("sourceLanguage='ja-JP' のとき「日本語」が表示される", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "ja-JP" }));
      const labels = screen.getAllByText("日本語");
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });

    it("targetLanguage='en-US' のとき「英語」が表示される", () => {
      renderLanguageSelector(makeDefaultProps({ targetLanguage: "en-US" }));
      const labels = screen.getAllByText("英語");
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });

    it("sourceLanguage='en-US', targetLanguage='ja-JP' の両方が表示される", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "en-US", targetLanguage: "ja-JP" }));
      expect(screen.getByText("英語")).toBeInTheDocument();
      expect(screen.getByText("日本語")).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 2. 入れ替えボタンの操作
  // ----------------------------------------------------------
  describe("入れ替えボタン", () => {
    it("入れ替えボタンが表示される", () => {
      renderLanguageSelector(makeDefaultProps());
      expect(screen.getByRole("button", { name: "言語を入れ替える" })).toBeInTheDocument();
    });

    it("idle 状態で入れ替えボタンをクリックすると onToggle が呼ばれる", () => {
      const onToggle = jest.fn();
      renderLanguageSelector(makeDefaultProps({ status: "idle", onToggle }));
      fireEvent.click(screen.getByRole("button", { name: "言語を入れ替える" }));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("idle 状態で入れ替えボタンは enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "idle" }));
      expect(screen.getByRole("button", { name: "言語を入れ替える" })).not.toBeDisabled();
    });
  });

  // ----------------------------------------------------------
  // 3. recording / connecting 中は disabled
  // ----------------------------------------------------------
  describe("接続中・録音中は入れ替えボタンが disabled", () => {
    it("status='recording' のとき入れ替えボタンが disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "recording" }));
      expect(screen.getByRole("button", { name: "言語を入れ替える" })).toBeDisabled();
    });

    it("status='connecting' のとき入れ替えボタンが disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "connecting" }));
      expect(screen.getByRole("button", { name: "言語を入れ替える" })).toBeDisabled();
    });

    it("status='connected' のとき入れ替えボタンが disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "connected" }));
      expect(screen.getByRole("button", { name: "言語を入れ替える" })).toBeDisabled();
    });

    it("status='error' のとき入れ替えボタンは enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "error" }));
      expect(screen.getByRole("button", { name: "言語を入れ替える" })).not.toBeDisabled();
    });
  });
});
