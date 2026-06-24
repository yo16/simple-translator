/**
 * @jest-environment jsdom
 */

/**
 * MetricsDisplay コンポーネントの単体テスト
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

jest.mock("../../src/components/MetricsDisplay.module.css", () => ({}));

// ============================================================
// テスト対象
// ============================================================

import { MetricsDisplay } from "../../src/components/MetricsDisplay";
import type { Metrics } from "../../src/lib/types";

// ============================================================
// テストヘルパー
// ============================================================

function renderMetricsDisplay(metrics: Metrics | null) {
  return render(React.createElement(MetricsDisplay, { metrics }));
}

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
// セットアップ / ティアダウン
// ============================================================

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// テストスイート
// ============================================================

describe("MetricsDisplay", () => {
  // ----------------------------------------------------------
  // 1. metrics=null のとき何も表示しない
  // ----------------------------------------------------------
  describe("metrics=null", () => {
    it("metrics が null のとき何も描画しない（レイテンシ情報要素が存在しない）", () => {
      const { container } = renderMetricsDisplay(null);
      expect(container.firstChild).toBeNull();
    });

    it("metrics が null のときレイテンシ情報の aria-label 要素が存在しない", () => {
      renderMetricsDisplay(null);
      expect(screen.queryByLabelText("レイテンシ情報")).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 2. metrics 値の表示
  // ----------------------------------------------------------
  describe("metrics 値の ms 表示", () => {
    it("metrics が非 null のときレイテンシ情報要素が表示される", () => {
      renderMetricsDisplay(makeMetrics());
      expect(screen.getByLabelText("レイテンシ情報")).toBeInTheDocument();
    });

    it("speechMs が ms 単位で表示される", () => {
      renderMetricsDisplay(makeMetrics({ speechMs: 150 }));
      expect(screen.getByText(/150ms/)).toBeInTheDocument();
    });

    it("translationMs が ms 単位で表示される", () => {
      renderMetricsDisplay(makeMetrics({ translationMs: 250 }));
      expect(screen.getByText(/250ms/)).toBeInTheDocument();
    });

    it("ttsMs が ms 単位で表示される", () => {
      renderMetricsDisplay(makeMetrics({ ttsMs: 350 }));
      expect(screen.getByText(/350ms/)).toBeInTheDocument();
    });

    it("totalMs が ms 単位で表示される", () => {
      renderMetricsDisplay(makeMetrics({ totalMs: 750 }));
      expect(screen.getByText(/750ms/)).toBeInTheDocument();
    });

    it("全メトリクス値が同時に表示される", () => {
      renderMetricsDisplay(
        makeMetrics({ speechMs: 100, translationMs: 200, ttsMs: 300, totalMs: 600 })
      );
      expect(screen.getByText(/100ms/)).toBeInTheDocument();
      expect(screen.getByText(/200ms/)).toBeInTheDocument();
      expect(screen.getByText(/300ms/)).toBeInTheDocument();
      expect(screen.getByText(/600ms/)).toBeInTheDocument();
    });

    it("0ms の値も表示される", () => {
      renderMetricsDisplay(
        makeMetrics({ speechMs: 0, translationMs: 0, ttsMs: 0, totalMs: 0 })
      );
      const zeroElements = screen.getAllByText(/0ms/);
      expect(zeroElements.length).toBeGreaterThanOrEqual(1);
    });
  });
});
