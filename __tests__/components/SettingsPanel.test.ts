/**
 * @jest-environment jsdom
 */

/**
 * SettingsPanel コンポーネントの単体テスト
 *
 * jest.config.js の testMatch は *.test.ts のみのため、
 * JSX 記法は使わず React.createElement でコンポーネントをレンダリングする。
 *
 * CSS Modules は ts-jest が解釈できないため jest.mock で空オブジェクトに差し替える。
 *
 * <details> / <summary> 要素の open 制御が jsdom では完全に動作しないため、
 * テスト内で open 属性を直接設定してコンテンツを表示させる。
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// ============================================================
// CSS Modules モック
// ============================================================

jest.mock("../../src/components/SettingsPanel.module.css", () => ({}));

// ============================================================
// テスト対象
// ============================================================

import { SettingsPanel } from "../../src/components/SettingsPanel";
import type { SettingsPanelProps } from "../../src/components/SettingsPanel";
import type { Settings } from "../../src/lib/types";

// ============================================================
// テストヘルパー
// ============================================================

function makeDefaultSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    sourceLanguage: "ja-JP",
    targetLanguage: "en-US",
    enableTts: true,
    enableInterimTranslation: false,
    chunkMs: 250,
    silenceMs: 1000,
    maxChars: 80,
    maxSeconds: 10,
    ...overrides,
  };
}

function makeDefaultProps(overrides: Partial<SettingsPanelProps> = {}): SettingsPanelProps {
  return {
    settings: makeDefaultSettings(),
    status: "idle",
    onSettingsChange: jest.fn(),
    ...overrides,
  };
}

/**
 * SettingsPanel は <details> 要素を使用しており、jsdom ではデフォルトで閉じている。
 * open 属性を設定してコンテンツを展開した状態でレンダリングする。
 */
function renderSettingsPanelOpen(props: SettingsPanelProps) {
  const { container } = render(React.createElement(SettingsPanel, props));
  const details = container.querySelector("details");
  if (details) {
    details.open = true;
  }
  return { container };
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

describe("SettingsPanel", () => {
  // ----------------------------------------------------------
  // 1. 現在値の反映（制御コンポーネント）
  // ----------------------------------------------------------
  describe("現在値の反映", () => {
    it("silenceMs の値が input に反映される", () => {
      const settings = makeDefaultSettings({ silenceMs: 2000 });
      renderSettingsPanelOpen(makeDefaultProps({ settings }));
      const inputs = screen.getAllByRole("spinbutton");
      const silenceInput = inputs.find(
        (el) => (el as HTMLInputElement).value === "2000"
      ) as HTMLInputElement;
      expect(silenceInput).toBeDefined();
      expect(silenceInput.value).toBe("2000");
    });

    it("maxChars の値が input に反映される", () => {
      const settings = makeDefaultSettings({ maxChars: 120 });
      renderSettingsPanelOpen(makeDefaultProps({ settings }));
      const inputs = screen.getAllByRole("spinbutton");
      const maxCharsInput = inputs.find(
        (el) => (el as HTMLInputElement).value === "120"
      ) as HTMLInputElement;
      expect(maxCharsInput).toBeDefined();
      expect(maxCharsInput.value).toBe("120");
    });

    it("maxSeconds の値が input に反映される", () => {
      const settings = makeDefaultSettings({ maxSeconds: 15 });
      renderSettingsPanelOpen(makeDefaultProps({ settings }));
      const inputs = screen.getAllByRole("spinbutton");
      const maxSecondsInput = inputs.find(
        (el) => (el as HTMLInputElement).value === "15"
      ) as HTMLInputElement;
      expect(maxSecondsInput).toBeDefined();
      expect(maxSecondsInput.value).toBe("15");
    });

    it("enableTts=true のとき TTS チェックボックスが checked", () => {
      const settings = makeDefaultSettings({ enableTts: true });
      renderSettingsPanelOpen(makeDefaultProps({ settings }));
      const checkboxes = screen.getAllByRole("checkbox");
      const ttsCheckbox = checkboxes[0] as HTMLInputElement;
      expect(ttsCheckbox.checked).toBe(true);
    });

    it("enableTts=false のとき TTS チェックボックスが unchecked", () => {
      const settings = makeDefaultSettings({ enableTts: false });
      renderSettingsPanelOpen(makeDefaultProps({ settings }));
      const checkboxes = screen.getAllByRole("checkbox");
      const ttsCheckbox = checkboxes[0] as HTMLInputElement;
      expect(ttsCheckbox.checked).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // 2. 数値入力変更 → onSettingsChange が数値型で呼ばれる
  // ----------------------------------------------------------
  describe("数値入力の変更", () => {
    it("silenceMs 入力変更で onSettingsChange('silenceMs', number) が呼ばれる", () => {
      const onSettingsChange = jest.fn();
      const settings = makeDefaultSettings({ silenceMs: 1000 });
      renderSettingsPanelOpen(makeDefaultProps({ settings, onSettingsChange }));

      const inputs = screen.getAllByRole("spinbutton");
      const silenceInput = inputs.find(
        (el) => (el as HTMLInputElement).value === "1000"
      ) as HTMLInputElement;

      fireEvent.change(silenceInput, { target: { value: "2000" } });
      expect(onSettingsChange).toHaveBeenCalledWith("silenceMs", 2000);
      // 数値型であることを確認
      const calledValue = (onSettingsChange as jest.Mock).mock.calls[0][1];
      expect(typeof calledValue).toBe("number");
    });

    it("maxChars 入力変更で onSettingsChange('maxChars', number) が呼ばれる", () => {
      const onSettingsChange = jest.fn();
      const settings = makeDefaultSettings({ maxChars: 80 });
      renderSettingsPanelOpen(makeDefaultProps({ settings, onSettingsChange }));

      const inputs = screen.getAllByRole("spinbutton");
      const maxCharsInput = inputs.find(
        (el) => (el as HTMLInputElement).value === "80"
      ) as HTMLInputElement;

      fireEvent.change(maxCharsInput, { target: { value: "100" } });
      expect(onSettingsChange).toHaveBeenCalledWith("maxChars", 100);
      const calledValue = (onSettingsChange as jest.Mock).mock.calls[0][1];
      expect(typeof calledValue).toBe("number");
    });

    it("maxSeconds 入力変更で onSettingsChange('maxSeconds', number) が呼ばれる", () => {
      const onSettingsChange = jest.fn();
      const settings = makeDefaultSettings({ maxSeconds: 10 });
      renderSettingsPanelOpen(makeDefaultProps({ settings, onSettingsChange }));

      const inputs = screen.getAllByRole("spinbutton");
      const maxSecondsInput = inputs.find(
        (el) => (el as HTMLInputElement).value === "10"
      ) as HTMLInputElement;

      fireEvent.change(maxSecondsInput, { target: { value: "20" } });
      expect(onSettingsChange).toHaveBeenCalledWith("maxSeconds", 20);
      const calledValue = (onSettingsChange as jest.Mock).mock.calls[0][1];
      expect(typeof calledValue).toBe("number");
    });
  });

  // ----------------------------------------------------------
  // 3. チェックボックス変更 → onSettingsChange が boolean 型で呼ばれる
  // ----------------------------------------------------------
  describe("チェックボックスの変更", () => {
    it("enableTts チェックボックス変更で onSettingsChange('enableTts', boolean) が呼ばれる", () => {
      const onSettingsChange = jest.fn();
      // enableTts=true の状態からクリックすると false になる
      const settings = makeDefaultSettings({ enableTts: true });
      renderSettingsPanelOpen(makeDefaultProps({ settings, onSettingsChange }));

      const checkboxes = screen.getAllByRole("checkbox");
      const ttsCheckbox = checkboxes[0];
      // fireEvent.click でチェックボックスをトグルする（jsdom が checked をトグルして change を発火）
      fireEvent.click(ttsCheckbox);

      expect(onSettingsChange).toHaveBeenCalledWith("enableTts", false);
      const calledValue = (onSettingsChange as jest.Mock).mock.calls[0][1];
      expect(typeof calledValue).toBe("boolean");
    });

    it("enableInterimTranslation チェックボックス変更で onSettingsChange が呼ばれる", () => {
      const onSettingsChange = jest.fn();
      // enableInterimTranslation=false の状態からクリックすると true になる
      const settings = makeDefaultSettings({ enableInterimTranslation: false });
      renderSettingsPanelOpen(makeDefaultProps({ settings, onSettingsChange }));

      const checkboxes = screen.getAllByRole("checkbox");
      const interimCheckbox = checkboxes[1];
      // fireEvent.click でチェックボックスをトグルする（jsdom が checked をトグルして change を発火）
      fireEvent.click(interimCheckbox);

      expect(onSettingsChange).toHaveBeenCalledWith("enableInterimTranslation", true);
      const calledValue = (onSettingsChange as jest.Mock).mock.calls[0][1];
      expect(typeof calledValue).toBe("boolean");
    });
  });

  // ----------------------------------------------------------
  // 4. recording 中は入力が disabled
  // ----------------------------------------------------------
  describe("recording 中は入力 disabled", () => {
    it("status='recording' のとき数値入力が disabled", () => {
      renderSettingsPanelOpen(makeDefaultProps({ status: "recording" }));
      const inputs = screen.getAllByRole("spinbutton");
      inputs.forEach((input) => {
        expect(input).toBeDisabled();
      });
    });

    it("status='recording' のときチェックボックスが disabled", () => {
      renderSettingsPanelOpen(makeDefaultProps({ status: "recording" }));
      const checkboxes = screen.getAllByRole("checkbox");
      checkboxes.forEach((checkbox) => {
        expect(checkbox).toBeDisabled();
      });
    });

    it("status='connecting' のとき数値入力が disabled", () => {
      renderSettingsPanelOpen(makeDefaultProps({ status: "connecting" }));
      const inputs = screen.getAllByRole("spinbutton");
      inputs.forEach((input) => {
        expect(input).toBeDisabled();
      });
    });

    it("status='idle' のとき数値入力が enabled", () => {
      renderSettingsPanelOpen(makeDefaultProps({ status: "idle" }));
      const inputs = screen.getAllByRole("spinbutton");
      inputs.forEach((input) => {
        expect(input).not.toBeDisabled();
      });
    });
  });
});
