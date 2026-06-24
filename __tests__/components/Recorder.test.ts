/**
 * @jest-environment jsdom
 */

/**
 * Recorder コンポーネントの単体テスト
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

jest.mock("../../src/components/Recorder.module.css", () => ({}));

// ============================================================
// テスト対象
// ============================================================

import { Recorder } from "../../src/components/Recorder";
import type { RecorderProps } from "../../src/components/Recorder";

// ============================================================
// テストヘルパー
// ============================================================

function renderRecorder(props: RecorderProps) {
  return render(React.createElement(Recorder, props));
}

function makeDefaultProps(overrides: Partial<RecorderProps> = {}): RecorderProps {
  return {
    status: "idle",
    error: null,
    onStart: jest.fn(),
    onStop: jest.fn(),
    onCommit: jest.fn(),
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

describe("Recorder", () => {
  // ----------------------------------------------------------
  // 1. status="idle" のときの表示
  // ----------------------------------------------------------
  describe("status='idle'", () => {
    it("「開始」ボタンが表示される", () => {
      renderRecorder(makeDefaultProps({ status: "idle" }));
      expect(screen.getByRole("button", { name: "開始" })).toBeInTheDocument();
    });

    it("「停止」ボタンは表示されない", () => {
      renderRecorder(makeDefaultProps({ status: "idle" }));
      expect(screen.queryByRole("button", { name: "停止" })).not.toBeInTheDocument();
    });

    it("「開始」ボタンをクリックすると onStart が呼ばれる", () => {
      const onStart = jest.fn();
      renderRecorder(makeDefaultProps({ status: "idle", onStart }));
      fireEvent.click(screen.getByRole("button", { name: "開始" }));
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it("「手動区切り」ボタンは disabled", () => {
      renderRecorder(makeDefaultProps({ status: "idle" }));
      const commitBtn = screen.getByRole("button", { name: "手動で発話を区切る" });
      expect(commitBtn).toBeDisabled();
    });

    it("録音中インジケーターは表示されない", () => {
      renderRecorder(makeDefaultProps({ status: "idle" }));
      expect(screen.queryByLabelText("録音中")).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 2. status="recording" のときの表示
  // ----------------------------------------------------------
  describe("status='recording'", () => {
    it("「停止」ボタンが表示される", () => {
      renderRecorder(makeDefaultProps({ status: "recording" }));
      expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    });

    it("「開始」ボタンは表示されない", () => {
      renderRecorder(makeDefaultProps({ status: "recording" }));
      expect(screen.queryByRole("button", { name: "開始" })).not.toBeInTheDocument();
    });

    it("録音中インジケーターが表示される", () => {
      renderRecorder(makeDefaultProps({ status: "recording" }));
      expect(screen.getByLabelText("録音中")).toBeInTheDocument();
    });

    it("「停止」ボタンをクリックすると onStop が呼ばれる", () => {
      const onStop = jest.fn();
      renderRecorder(makeDefaultProps({ status: "recording", onStop }));
      fireEvent.click(screen.getByRole("button", { name: "停止" }));
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it("「手動区切り」ボタンが enabled", () => {
      renderRecorder(makeDefaultProps({ status: "recording" }));
      const commitBtn = screen.getByRole("button", { name: "手動で発話を区切る" });
      expect(commitBtn).not.toBeDisabled();
    });

    it("「手動区切り」ボタンをクリックすると onCommit が呼ばれる", () => {
      const onCommit = jest.fn();
      renderRecorder(makeDefaultProps({ status: "recording", onCommit }));
      fireEvent.click(screen.getByRole("button", { name: "手動で発話を区切る" }));
      expect(onCommit).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // 3. status="connecting" のときの表示
  // ----------------------------------------------------------
  describe("status='connecting'", () => {
    it("「接続中...」テキストのボタンが表示される", () => {
      renderRecorder(makeDefaultProps({ status: "connecting" }));
      expect(screen.getByText("接続中...")).toBeInTheDocument();
    });

    it("開始ボタン（接続中...）が disabled", () => {
      renderRecorder(makeDefaultProps({ status: "connecting" }));
      const btn = screen.getByText("接続中...");
      expect(btn).toBeDisabled();
    });

    it("「停止」ボタンは表示されない", () => {
      renderRecorder(makeDefaultProps({ status: "connecting" }));
      expect(screen.queryByRole("button", { name: "停止" })).not.toBeInTheDocument();
    });

    it("「手動区切り」ボタンは disabled", () => {
      renderRecorder(makeDefaultProps({ status: "connecting" }));
      const commitBtn = screen.getByRole("button", { name: "手動で発話を区切る" });
      expect(commitBtn).toBeDisabled();
    });
  });

  // ----------------------------------------------------------
  // 4. error が非 null のときのエラー表示
  // ----------------------------------------------------------
  describe("error が非 null", () => {
    it("エラーメッセージが表示される", () => {
      renderRecorder(makeDefaultProps({ error: "接続に失敗しました" }));
      expect(screen.getByText(/接続に失敗しました/)).toBeInTheDocument();
    });

    it("status='error' のときも「開始」ボタンが表示される（再試行導線）", () => {
      renderRecorder(makeDefaultProps({ status: "error", error: "エラーが発生しました" }));
      expect(screen.getByRole("button", { name: "開始" })).toBeInTheDocument();
    });

    it("status='error' のとき「開始」ボタンをクリックすると onStart が呼ばれる", () => {
      const onStart = jest.fn();
      renderRecorder(makeDefaultProps({ status: "error", error: "エラー", onStart }));
      fireEvent.click(screen.getByRole("button", { name: "開始" }));
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it("error が null のときエラーメッセージは表示されない", () => {
      renderRecorder(makeDefaultProps({ error: null }));
      expect(screen.queryByText(/エラー:/)).not.toBeInTheDocument();
    });
  });
});
