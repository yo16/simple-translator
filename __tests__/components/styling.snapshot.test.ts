/**
 * @jest-environment jsdom
 */

/**
 * スタイリング回帰検出スナップショットテスト (hfk.13)
 *
 * CSS Modules を「キー名をそのまま返す identity プロキシ」でモックすることで、
 * styles.recordButton → "recordButton" となり、スナップショットに
 * class="recordButton ..." が現れ、クラス名の付与/削除の回帰を検出できる。
 *
 * jest.config.js の testMatch は *.test.ts のみのため、
 * JSX 記法は使わず React.createElement でコンポーネントをレンダリングする。
 */

import React from "react";
import { render, cleanup } from "@testing-library/react";

// ============================================================
// CSS Modules モック — identity プロキシ（クラス名をそのまま返す）
//
// jest.mock() はファイル先頭にホイストされるため、
// const 変数を参照するとホイスト前参照エラーになる。
// ファクトリ関数をインラインで記述して回避する。
//
// ts-jest + esModuleInterop: true の環境では、
//   import styles from "./Foo.module.css"
// は ts-jest の __importDefault ヘルパーを経由し、
// ファクトリの戻り値オブジェクトの `.default` プロパティを取り出す。
// そのため { __esModule: true, default: proxy } 形式で返す必要がある。
// ============================================================

jest.mock("../../src/components/Recorder.module.css", () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) }),
}));
jest.mock("../../src/components/LanguageSelector.module.css", () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) }),
}));
jest.mock("../../src/components/TranscriptView.module.css", () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) }),
}));
jest.mock("../../src/components/SettingsPanel.module.css", () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) }),
}));
jest.mock("../../src/components/MetricsDisplay.module.css", () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) }),
}));
jest.mock("../../src/components/TranslatorApp.module.css", () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) }),
}));

// ============================================================
// jest.mock — TranslatorApp の依存モジュール
// ============================================================

jest.mock("../../src/lib/websocketClient", () => ({
  createWebSocketClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendAudio: jest.fn(),
    sendCommit: jest.fn(),
    sendStop: jest.fn(),
    sendStart: jest.fn(),
  })),
  WebSocketClient: jest.fn(),
}));

jest.mock("../../src/lib/audio", () => ({
  startRecording: jest.fn(() => ({ stop: jest.fn() })),
  DEFAULT_CHUNK_MS: 250,
}));

jest.mock("../../src/hooks/useAudioQueue", () => ({
  useAudioQueue: jest.fn(() => ({
    enqueue: jest.fn(),
    reset: jest.fn(),
  })),
}));

// ============================================================
// テスト対象コンポーネントのインポート
// ============================================================

import { Recorder } from "../../src/components/Recorder";
import { LanguageSelector } from "../../src/components/LanguageSelector";
import { TranscriptView } from "../../src/components/TranscriptView";
import { SettingsPanel } from "../../src/components/SettingsPanel";
import { MetricsDisplay } from "../../src/components/MetricsDisplay";

// ============================================================
// テストヘルパー
// ============================================================

function makeDefaultSettings() {
  return {
    sourceLanguage: "ja-JP" as const,
    targetLanguage: "en-US" as const,
    enableTts: true,
    enableInterimTranslation: false,
    chunkMs: 250,
    silenceMs: 1000,
    maxChars: 80,
    maxSeconds: 10,
  };
}

function makeEmptyTranscript() {
  return {
    interim: "",
    finals: [],
    committed: "",
    translations: [],
  };
}

// ============================================================
// セットアップ / ティアダウン
// ============================================================

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

// ============================================================
// テストスイート
// ============================================================

// ----------------------------------------------------------
// Recorder スナップショット
// ----------------------------------------------------------

describe("Recorder スナップショット", () => {
  it("status='idle' の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(Recorder, {
        status: "idle",
        error: null,
        onStart: jest.fn(),
        onStop: jest.fn(),
        onCommit: jest.fn(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("status='recording'（録音インジケーター表示）の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(Recorder, {
        status: "recording",
        error: null,
        onStart: jest.fn(),
        onStop: jest.fn(),
        onCommit: jest.fn(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("status='connecting' の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(Recorder, {
        status: "connecting",
        error: null,
        onStart: jest.fn(),
        onStop: jest.fn(),
        onCommit: jest.fn(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("error が非 null のときのエラー表示クラスが変化しない", () => {
    const { asFragment } = render(
      React.createElement(Recorder, {
        status: "idle",
        error: "接続エラーが発生しました",
        onStart: jest.fn(),
        onStop: jest.fn(),
        onCommit: jest.fn(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });
});

// ----------------------------------------------------------
// LanguageSelector スナップショット
// ----------------------------------------------------------

describe("LanguageSelector スナップショット", () => {
  it("ja-JP → en-US の通常表示（idle）の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(LanguageSelector, {
        sourceLanguage: "ja-JP",
        targetLanguage: "en-US",
        status: "idle",
        onToggle: jest.fn(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("recording 中（disabled）の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(LanguageSelector, {
        sourceLanguage: "ja-JP",
        targetLanguage: "en-US",
        status: "recording",
        onToggle: jest.fn(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });
});

// ----------------------------------------------------------
// TranscriptView スナップショット
// ----------------------------------------------------------

describe("TranscriptView スナップショット", () => {
  it("空状態（interim なし・finals 空・translations 空）の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(TranscriptView, {
        transcript: makeEmptyTranscript(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("interim あり・finals 複数・translations 複数の状態の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(TranscriptView, {
        transcript: {
          interim: "認識中のテキスト",
          finals: ["確定文1", "確定文2"],
          committed: "確定済みバッファ",
          translations: [
            { sourceText: "こんにちは", translatedText: "Hello" },
            { sourceText: "ありがとう", translatedText: "Thank you" },
          ],
        },
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });
});

// ----------------------------------------------------------
// SettingsPanel スナップショット
// ----------------------------------------------------------

describe("SettingsPanel スナップショット", () => {
  it("idle（enabled）状態の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(SettingsPanel, {
        settings: makeDefaultSettings(),
        status: "idle",
        onSettingsChange: jest.fn(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("recording（disabled）状態の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(SettingsPanel, {
        settings: makeDefaultSettings(),
        status: "recording",
        onSettingsChange: jest.fn(),
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });
});

// ----------------------------------------------------------
// MetricsDisplay スナップショット
// ----------------------------------------------------------

describe("MetricsDisplay スナップショット", () => {
  it("metrics 値あり（全 ms 表示）の DOM 構造とクラス名が変化しない", () => {
    const { asFragment } = render(
      React.createElement(MetricsDisplay, {
        metrics: {
          speechMs: 150,
          translationMs: 250,
          ttsMs: 350,
          totalMs: 750,
        },
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("metrics=null のとき何も描画しない（スナップショットが空コンテナ）", () => {
    const { asFragment } = render(
      React.createElement(MetricsDisplay, {
        metrics: null,
      })
    );
    expect(asFragment()).toMatchSnapshot();
  });
});

// ----------------------------------------------------------
// TranslatorApp スナップショット（1ページ全体構造）
// ----------------------------------------------------------

describe("TranslatorApp スナップショット", () => {
  it("idle 初期表示の全体 DOM 構造とクラス名が変化しない", () => {
    // モックが先に設定されてから require でロードする（TranslatorApp.test.ts と同じ方式）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TranslatorApp } = require("../../src/components/TranslatorApp");

    // navigator.mediaDevices をモックしておく（副作用防止）
    const mockGetUserMedia = jest.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    });

    const { asFragment } = render(React.createElement(TranslatorApp));
    expect(asFragment()).toMatchSnapshot();
  });
});
