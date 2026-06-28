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
import { render, screen, fireEvent, within } from "@testing-library/react";
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
import { SUPPORTED_LANGUAGES, languageLabel } from "../../src/lib/languages";

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
    onSourceChange: jest.fn(),
    onTargetChange: jest.fn(),
    onSwap: jest.fn(),
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
  // 1. 基本レンダリング
  // ----------------------------------------------------------
  describe("基本レンダリング", () => {
    it("入力言語 select が表示される", () => {
      renderLanguageSelector(makeDefaultProps());
      expect(screen.getByRole("combobox", { name: "入力言語" })).toBeInTheDocument();
    });

    it("出力言語 select が表示される", () => {
      renderLanguageSelector(makeDefaultProps());
      expect(screen.getByRole("combobox", { name: "出力言語" })).toBeInTheDocument();
    });

    it("入れ替えボタンが表示される", () => {
      renderLanguageSelector(makeDefaultProps());
      expect(
        screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" }),
      ).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 2. 選択肢の表示（SUPPORTED_LANGUAGES 全5言語・languageLabel 準拠）
  // ----------------------------------------------------------
  describe("選択肢の表示", () => {
    it("入力言語 select に SUPPORTED_LANGUAGES の全5言語が option として表示される", () => {
      renderLanguageSelector(makeDefaultProps());
      const sourceSelect = screen.getByRole("combobox", { name: "入力言語" });
      const options = within(sourceSelect).getAllByRole("option");
      expect(options).toHaveLength(SUPPORTED_LANGUAGES.length);
    });

    it("出力言語 select に SUPPORTED_LANGUAGES の全5言語が option として表示される", () => {
      renderLanguageSelector(makeDefaultProps());
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      const options = within(targetSelect).getAllByRole("option");
      expect(options).toHaveLength(SUPPORTED_LANGUAGES.length);
    });

    it("入力言語 select の各 option テキストが languageLabel 準拠である", () => {
      renderLanguageSelector(makeDefaultProps());
      const sourceSelect = screen.getByRole("combobox", { name: "入力言語" });
      SUPPORTED_LANGUAGES.forEach((code) => {
        expect(
          within(sourceSelect).getByRole("option", { name: languageLabel(code) }),
        ).toBeInTheDocument();
      });
    });

    it("出力言語 select の各 option テキストが languageLabel 準拠である", () => {
      renderLanguageSelector(makeDefaultProps());
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      SUPPORTED_LANGUAGES.forEach((code) => {
        expect(
          within(targetSelect).getByRole("option", { name: languageLabel(code) }),
        ).toBeInTheDocument();
      });
    });

    it("zh-CN の表示名が「中国語(簡体)」", () => {
      // zh-CN を source にして入力言語 select で確認
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "zh-CN", targetLanguage: "ja-JP" }));
      const sourceSelect = screen.getByRole("combobox", { name: "入力言語" });
      expect(
        within(sourceSelect).getByRole("option", { name: "中国語(簡体)" }),
      ).toBeInTheDocument();
    });

    it("zh-TW の表示名が「中国語(繁体)」", () => {
      renderLanguageSelector(makeDefaultProps());
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      expect(
        within(targetSelect).getByRole("option", { name: "中国語(繁体)" }),
      ).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 3. source===target ガード（相互 disabled）
  // ----------------------------------------------------------
  describe("source===target ガード（相互 disabled）", () => {
    it("出力言語 select で sourceLanguage と同じ option が disabled（ja-JP→en-US 時、出力の ja-JP が disabled）", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "ja-JP", targetLanguage: "en-US" }));
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      expect(within(targetSelect).getByRole("option", { name: "日本語" })).toBeDisabled();
    });

    it("入力言語 select で targetLanguage と同じ option が disabled（ja-JP→en-US 時、入力の en-US が disabled）", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "ja-JP", targetLanguage: "en-US" }));
      const sourceSelect = screen.getByRole("combobox", { name: "入力言語" });
      expect(within(sourceSelect).getByRole("option", { name: "英語" })).toBeDisabled();
    });

    it("出力言語 select で sourceLanguage 以外の option は disabled でない（en-US は有効）", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "ja-JP", targetLanguage: "en-US" }));
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      expect(within(targetSelect).getByRole("option", { name: "英語" })).not.toBeDisabled();
    });

    it("入力言語 select で targetLanguage 以外の option は disabled でない（ja-JP は有効）", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "ja-JP", targetLanguage: "en-US" }));
      const sourceSelect = screen.getByRole("combobox", { name: "入力言語" });
      expect(within(sourceSelect).getByRole("option", { name: "日本語" })).not.toBeDisabled();
    });

    it("sourceLanguage='zh-CN', targetLanguage='ko-KR' のとき出力の zh-CN が disabled", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "zh-CN", targetLanguage: "ko-KR" }));
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      expect(within(targetSelect).getByRole("option", { name: "中国語(簡体)" })).toBeDisabled();
    });

    it("sourceLanguage='zh-CN', targetLanguage='ko-KR' のとき入力の ko-KR が disabled", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "zh-CN", targetLanguage: "ko-KR" }));
      const sourceSelect = screen.getByRole("combobox", { name: "入力言語" });
      expect(within(sourceSelect).getByRole("option", { name: "韓国語" })).toBeDisabled();
    });

    it("sourceLanguage='en-US', targetLanguage='ja-JP' のとき出力の en-US が disabled（入れ替え後のペア検証）", () => {
      renderLanguageSelector(makeDefaultProps({ sourceLanguage: "en-US", targetLanguage: "ja-JP" }));
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      expect(within(targetSelect).getByRole("option", { name: "英語" })).toBeDisabled();
    });
  });

  // ----------------------------------------------------------
  // 4. コールバック
  // ----------------------------------------------------------
  describe("コールバック", () => {
    it("入力言語 select を変更すると onSourceChange が新言語コードで呼ばれる", () => {
      const onSourceChange = jest.fn();
      renderLanguageSelector(makeDefaultProps({ onSourceChange }));
      const sourceSelect = screen.getByRole("combobox", { name: "入力言語" });
      fireEvent.change(sourceSelect, { target: { value: "zh-CN" } });
      expect(onSourceChange).toHaveBeenCalledWith("zh-CN");
      expect(onSourceChange).toHaveBeenCalledTimes(1);
    });

    it("出力言語 select を変更すると onTargetChange が新言語コードで呼ばれる", () => {
      const onTargetChange = jest.fn();
      renderLanguageSelector(makeDefaultProps({ onTargetChange }));
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      fireEvent.change(targetSelect, { target: { value: "ko-KR" } });
      expect(onTargetChange).toHaveBeenCalledWith("ko-KR");
      expect(onTargetChange).toHaveBeenCalledTimes(1);
    });

    it("入れ替えボタンをクリックすると onSwap が呼ばれる", () => {
      const onSwap = jest.fn();
      renderLanguageSelector(makeDefaultProps({ status: "idle", onSwap }));
      fireEvent.click(screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" }));
      expect(onSwap).toHaveBeenCalledTimes(1);
    });

    it("入力言語 select 変更時に onTargetChange は呼ばれない", () => {
      const onTargetChange = jest.fn();
      renderLanguageSelector(makeDefaultProps({ onTargetChange }));
      const sourceSelect = screen.getByRole("combobox", { name: "入力言語" });
      fireEvent.change(sourceSelect, { target: { value: "zh-CN" } });
      expect(onTargetChange).not.toHaveBeenCalled();
    });

    it("出力言語 select 変更時に onSourceChange は呼ばれない", () => {
      const onSourceChange = jest.fn();
      renderLanguageSelector(makeDefaultProps({ onSourceChange }));
      const targetSelect = screen.getByRole("combobox", { name: "出力言語" });
      fireEvent.change(targetSelect, { target: { value: "ko-KR" } });
      expect(onSourceChange).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // 5. status による disabled 制御
  // ----------------------------------------------------------
  describe("status による disabled 制御", () => {
    it("status='connecting' のとき入力言語 select が disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "connecting" }));
      expect(screen.getByRole("combobox", { name: "入力言語" })).toBeDisabled();
    });

    it("status='connecting' のとき出力言語 select が disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "connecting" }));
      expect(screen.getByRole("combobox", { name: "出力言語" })).toBeDisabled();
    });

    it("status='connecting' のとき入れ替えボタンが disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "connecting" }));
      expect(
        screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" }),
      ).toBeDisabled();
    });

    it("status='connected' のとき入力言語 select が disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "connected" }));
      expect(screen.getByRole("combobox", { name: "入力言語" })).toBeDisabled();
    });

    it("status='connected' のとき出力言語 select が disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "connected" }));
      expect(screen.getByRole("combobox", { name: "出力言語" })).toBeDisabled();
    });

    it("status='connected' のとき入れ替えボタンが disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "connected" }));
      expect(
        screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" }),
      ).toBeDisabled();
    });

    it("status='recording' のとき入力言語 select が disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "recording" }));
      expect(screen.getByRole("combobox", { name: "入力言語" })).toBeDisabled();
    });

    it("status='recording' のとき出力言語 select が disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "recording" }));
      expect(screen.getByRole("combobox", { name: "出力言語" })).toBeDisabled();
    });

    it("status='recording' のとき入れ替えボタンが disabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "recording" }));
      expect(
        screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" }),
      ).toBeDisabled();
    });

    it("status='idle' のとき入力言語 select が enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "idle" }));
      expect(screen.getByRole("combobox", { name: "入力言語" })).not.toBeDisabled();
    });

    it("status='idle' のとき出力言語 select が enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "idle" }));
      expect(screen.getByRole("combobox", { name: "出力言語" })).not.toBeDisabled();
    });

    it("status='idle' のとき入れ替えボタンが enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "idle" }));
      expect(
        screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" }),
      ).not.toBeDisabled();
    });

    it("status='disconnected' のとき入力言語 select が enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "disconnected" }));
      expect(screen.getByRole("combobox", { name: "入力言語" })).not.toBeDisabled();
    });

    it("status='disconnected' のとき出力言語 select が enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "disconnected" }));
      expect(screen.getByRole("combobox", { name: "出力言語" })).not.toBeDisabled();
    });

    it("status='disconnected' のとき入れ替えボタンが enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "disconnected" }));
      expect(
        screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" }),
      ).not.toBeDisabled();
    });

    it("status='error' のとき入力言語 select が enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "error" }));
      expect(screen.getByRole("combobox", { name: "入力言語" })).not.toBeDisabled();
    });

    it("status='error' のとき出力言語 select が enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "error" }));
      expect(screen.getByRole("combobox", { name: "出力言語" })).not.toBeDisabled();
    });

    it("status='error' のとき入れ替えボタンが enabled", () => {
      renderLanguageSelector(makeDefaultProps({ status: "error" }));
      expect(
        screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" }),
      ).not.toBeDisabled();
    });
  });

  // ----------------------------------------------------------
  // 6. aria-label
  // ----------------------------------------------------------
  describe("aria-label", () => {
    it("入力言語 select に aria-label='入力言語' が付与されている", () => {
      renderLanguageSelector(makeDefaultProps());
      const el = screen.getByRole("combobox", { name: "入力言語" });
      expect(el).toHaveAttribute("aria-label", "入力言語");
    });

    it("出力言語 select に aria-label='出力言語' が付与されている", () => {
      renderLanguageSelector(makeDefaultProps());
      const el = screen.getByRole("combobox", { name: "出力言語" });
      expect(el).toHaveAttribute("aria-label", "出力言語");
    });

    it("入れ替えボタンに aria-label='入力言語と出力言語を入れ替える' が付与されている", () => {
      renderLanguageSelector(makeDefaultProps());
      const el = screen.getByRole("button", { name: "入力言語と出力言語を入れ替える" });
      expect(el).toHaveAttribute("aria-label", "入力言語と出力言語を入れ替える");
    });
  });
});
