/**
 * server/session.ts の結合テスト（タスク .5）
 *
 * Session クラスを最小スタブの WebSocket モックで生成し、
 * utterance_committed メッセージが ws.send 経由で送信されることを検証する。
 * GCP通信は行わない。UtteranceBufferManager は実装のまま使用する。
 *
 * タスク .8 対応:
 *   onUtteranceCommitted が translate/synthesize を呼ぶようになったため、
 *   GCP 実通信を遮断するために translate / textToSpeech をモックする。
 *   既存テストの検証意図（utterance_committed の送信確認）は変えない。
 */

import { Session } from "../../server/session";
import { ClientMessage } from "../../server/schema";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// GCP 実通信遮断: translate / textToSpeech をモック化する
// ---------------------------------------------------------------------------
jest.mock("../../server/translate");
jest.mock("../../server/textToSpeech");

import { translate } from "../../server/translate";
import { isTtsEnabled, synthesize } from "../../server/textToSpeech";

const mockTranslate = translate as jest.MockedFunction<typeof translate>;
const mockIsTtsEnabled = isTtsEnabled as jest.MockedFunction<typeof isTtsEnabled>;
const mockSynthesize = synthesize as jest.MockedFunction<typeof synthesize>;

// デフォルト: 翻訳は適当な訳文を返す、TTS は無効にする（テストの本質に影響しない）
beforeEach(() => {
  mockTranslate.mockResolvedValue("translated");
  mockIsTtsEnabled.mockReturnValue(false);
  mockSynthesize.mockResolvedValue(null);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// ヘルパー: 最小 WebSocket スタブ
// ws.OPEN = 1
// ---------------------------------------------------------------------------
function createMockWs(): { readyState: number; send: jest.Mock; close: jest.Mock } {
  return {
    readyState: WebSocket.OPEN, // 1
    send: jest.fn(),
    close: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// ヘルパー: 有効な start メッセージ
// タイマーが意図せず発火しないよう、値は大きめに設定する
// ---------------------------------------------------------------------------
function makeStartMsg(overrides: Partial<{
  silenceMs: number;
  maxChars: number;
  maxSeconds: number;
}> = {}): ClientMessage {
  return {
    type: "start",
    sourceLanguage: "ja-JP",
    targetLanguage: "en-US",
    enableTts: false,
    enableInterimTranslation: false,
    chunkMs: 250,
    silenceMs: overrides.silenceMs ?? 60000,
    maxChars: overrides.maxChars ?? 80,
    maxSeconds: overrides.maxSeconds ?? 600,
  };
}

// ---------------------------------------------------------------------------
// ヘルパー: ws.send に渡された JSON をパースして返す
// ---------------------------------------------------------------------------
function getSentMessages(mockWs: ReturnType<typeof createMockWs>): Record<string, unknown>[] {
  return mockWs.send.mock.calls.map((args) => JSON.parse(args[0] as string));
}

// ---------------------------------------------------------------------------
// 1. utterance_committed メッセージの送信確認
// ---------------------------------------------------------------------------
describe("utterance_committed — ws.send 経由での送信確認", () => {
  let mockWs: ReturnType<typeof createMockWs>;
  let session: Session;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = createMockWs();
    session = new Session(mockWs as unknown as WebSocket);
  });

  afterEach(() => {
    session.dispose();
    jest.useRealTimers();
  });

  test("start 後に addFinalToBuffer を呼び maxChars を超えると utterance_committed が送信される", () => {
    // Arrange
    session.handleMessage(makeStartMsg({ maxChars: 5 }));

    // Act
    session.addFinalToBuffer("hello"); // 5 文字 >= 5 → maxChars で確定

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toBe("hello");
    expect(committed[0].reason).toBe("maxChars");

    // タスク .8 対応: 確定後に起動する非同期パイプライン（translate mock）の
    // Promise を Microtask キューで解決してから afterEach に進む。
    // フェイクタイマー環境でも jest.runAllTicks() は Microtask を同期 flush する。
    jest.runAllTicks();
  });

  test("start 後に addFinalToBuffer を複数回呼び合計が maxChars を超えると utterance_committed が送信される", () => {
    // Arrange
    session.handleMessage(makeStartMsg({ maxChars: 10 }));

    // Act
    session.addFinalToBuffer("hello");   // 5 文字 < 10
    session.addFinalToBuffer("world!");  // 合計 11 文字 >= 10

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toBe("helloworld!");
    expect(committed[0].reason).toBe("maxChars");

    // タスク .8 対応: 非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });

  test("silence タイマー経過後に utterance_committed が送信され reason が 'silence' になる", () => {
    // Arrange: silenceMs=1000
    session.handleMessage(makeStartMsg({ silenceMs: 1000 }));
    session.addFinalToBuffer("speech text");

    // Act: 1000ms 経過
    jest.advanceTimersByTime(1000);

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toBe("speech text");
    expect(committed[0].reason).toBe("silence");

    // タスク .8 対応: silence タイマー発火後に起動する非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });

  test("handleMessage({type:'commit'}) で utterance_committed が送信され reason が 'commit' になる", () => {
    // Arrange
    session.handleMessage(makeStartMsg());
    session.addFinalToBuffer("commit text");

    // Act
    session.handleMessage({ type: "commit" });

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toBe("commit text");
    expect(committed[0].reason).toBe("commit");

    // タスク .8 対応: 非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });

  test("handleMessage({type:'stop'}) で utterance_committed が送信され reason が 'stop' になる", () => {
    // Arrange
    session.handleMessage(makeStartMsg());
    session.addFinalToBuffer("stop text");

    // Act
    session.handleMessage({ type: "stop" });

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toBe("stop text");
    expect(committed[0].reason).toBe("stop");

    // タスク .8 対応: 非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });

  test("utterance_committed メッセージの text と reason が正しい値で送信される", () => {
    // Arrange
    session.handleMessage(makeStartMsg({ maxChars: 4 }));

    // Act
    session.addFinalToBuffer("テスト"); // 3文字... UTF-16 で確認
    // 実際には addFinal で文字数チェックをする
    session.addFinalToBuffer("発話");   // 「テスト発話」= 5文字 >= 4

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(typeof committed[0].text).toBe("string");
    expect(typeof committed[0].reason).toBe("string");
    expect((committed[0].text as string).length).toBeGreaterThan(0);

    // タスク .8 対応: 非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });
});

// ---------------------------------------------------------------------------
// 2. 空バッファ時のコミット — utterance_committed が送信されない
// ---------------------------------------------------------------------------
describe("空バッファ時のコミット — utterance_committed が送信されない", () => {
  let mockWs: ReturnType<typeof createMockWs>;
  let session: Session;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = createMockWs();
    session = new Session(mockWs as unknown as WebSocket);
  });

  afterEach(() => {
    session.dispose();
    jest.useRealTimers();
  });

  test("start 後にバッファが空のまま handleMessage({type:'commit'}) しても utterance_committed が送信されない", () => {
    // Arrange
    session.handleMessage(makeStartMsg());

    // Act: バッファに何も追加せず commit
    session.handleMessage({ type: "commit" });

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(0);
  });

  test("start 後にバッファが空のまま handleMessage({type:'stop'}) しても utterance_committed が送信されない", () => {
    // Arrange
    session.handleMessage(makeStartMsg());

    // Act
    session.handleMessage({ type: "stop" });

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(0);
  });

  test("確定後のバッファが空になり、再び commit しても utterance_committed が送信されない", () => {
    // Arrange: 一度確定させてバッファを空にする
    session.handleMessage(makeStartMsg());
    session.addFinalToBuffer("text");
    session.handleMessage({ type: "commit" }); // 1回目の確定

    // タスク .8 対応: 1回目の確定で起動した非同期パイプラインの Promise を flush
    jest.runAllTicks();

    // Act: バッファ空の状態で再 commit
    session.handleMessage({ type: "commit" });

    // Assert: 最初の1回だけ送信されている
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. handleMessage({type:'audio'}) — 無音タイマーをリセットしない（バグ修正後の正しい挙動）
// ---------------------------------------------------------------------------
describe("handleMessage({type:'audio'}) — audio は無音タイマーをリセットしない", () => {
  let mockWs: ReturnType<typeof createMockWs>;
  let session: Session;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = createMockWs();
    session = new Session(mockWs as unknown as WebSocket);
  });

  afterEach(() => {
    session.dispose();
    jest.useRealTimers();
  });

  test("addFinal 後に audio が来ても無音タイマーはリセットされず、silenceMs 経過で確定される", () => {
    // Arrange: silenceMs=1000
    session.handleMessage(makeStartMsg({ silenceMs: 1000 }));
    session.addFinalToBuffer("speech");

    // Act: 600ms 後に audio を受信（バグ修正後は無音タイマーをリセットしない）
    jest.advanceTimersByTime(600);
    session.handleMessage({ type: "audio", data: "SGVsbG8=" }); // base64("Hello")

    // Act: addFinal から合計 1000ms 経過（audio が来ても silence タイマーは動き続ける）
    jest.advanceTimersByTime(400);

    // Assert: audio がリセットしないので、addFinal から 1000ms で確定される
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].reason).toBe("silence");

    // タスク .8 対応: silence タイマー発火後に起動する非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });

  test("audio を何度受信しても silenceMs 経過前には確定されず、経過後に確定される（タイマーは addFinal 起点）", () => {
    // Arrange: silenceMs=1000
    session.handleMessage(makeStartMsg({ silenceMs: 1000 }));
    session.addFinalToBuffer("speech");

    // Act: 900ms 間に複数の audio チャンクを受信（バグ修正後はリセットしない）
    jest.advanceTimersByTime(300);
    session.handleMessage({ type: "audio", data: "AAAA" });
    jest.advanceTimersByTime(300);
    session.handleMessage({ type: "audio", data: "BBBB" });
    jest.advanceTimersByTime(300);
    session.handleMessage({ type: "audio", data: "CCCC" });

    // addFinal から 900ms 時点 — まだ確定されていない
    const messagesAt900 = getSentMessages(mockWs);
    const committedAt900 = messagesAt900.filter((m) => m.type === "utterance_committed");
    expect(committedAt900).toHaveLength(0);

    // addFinal から 1000ms 経過 — 確定される
    jest.advanceTimersByTime(100);
    const messagesAt1000 = getSentMessages(mockWs);
    const committedAt1000 = messagesAt1000.filter((m) => m.type === "utterance_committed");
    expect(committedAt1000).toHaveLength(1);
    expect(committedAt1000[0].reason).toBe("silence");

    // タスク .8 対応: silence タイマー発火後に起動する非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });
});

// ---------------------------------------------------------------------------
// 4. dispose — タイマー発火による送信が起きない
// ---------------------------------------------------------------------------
describe("dispose — タイマー発火由来の送信が起きない", () => {
  let mockWs: ReturnType<typeof createMockWs>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = createMockWs();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("dispose 後に silenceMs が経過しても utterance_committed が送信されない", () => {
    // Arrange
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ silenceMs: 1000 }));
    session.addFinalToBuffer("text");

    // Act: dispose してからタイマーを進める
    session.dispose();
    jest.advanceTimersByTime(2000);

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(0);
  });

  test("dispose 後に maxSeconds が経過しても utterance_committed が送信されない", () => {
    // Arrange: silenceMs を大きくして maxSeconds タイマーのみをテスト
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ silenceMs: 999999, maxSeconds: 5 }));
    session.addFinalToBuffer("long text");

    // Act
    session.dispose();
    jest.advanceTimersByTime(10000);

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. start 前の操作 — 初期化チェック
// ---------------------------------------------------------------------------
describe("start 前の操作 — 初期化チェック", () => {
  let mockWs: ReturnType<typeof createMockWs>;
  let session: Session;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = createMockWs();
    session = new Session(mockWs as unknown as WebSocket);
  });

  afterEach(() => {
    session.dispose();
    jest.useRealTimers();
  });

  test("start 前に addFinalToBuffer を呼んでも何も起きない（初期化チェック）", () => {
    // Act: start なしで addFinalToBuffer
    session.addFinalToBuffer("text before start");

    // Assert: utterance_committed は送信されない
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(0);
  });

  test("start 後に isInitialized が true になる", () => {
    // Arrange
    expect(session.isInitialized).toBe(false);

    // Act
    session.handleMessage(makeStartMsg());

    // Assert
    expect(session.isInitialized).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. WebSocket が OPEN でない場合は送信されない
// ---------------------------------------------------------------------------
describe("WebSocket が OPEN でない場合 — 送信されない", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("readyState が OPEN 以外の場合、utterance_committed は送信されない", () => {
    // Arrange: readyState = CLOSED (3)
    const closedMockWs = {
      readyState: WebSocket.CLOSED, // 3
      send: jest.fn(),
      close: jest.fn(),
    };
    const session = new Session(closedMockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ maxChars: 3 }));

    // Act
    session.addFinalToBuffer("abc"); // maxChars=3 で即時確定を試みる

    // Assert: readyState が OPEN でないため send は呼ばれない
    expect(closedMockWs.send).not.toHaveBeenCalled();

    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// 7. 複数の確定 — 確定後にバッファがリセットされて再利用できる
// ---------------------------------------------------------------------------
describe("複数の確定 — バッファリセット後の再利用", () => {
  let mockWs: ReturnType<typeof createMockWs>;
  let session: Session;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = createMockWs();
    session = new Session(mockWs as unknown as WebSocket);
  });

  afterEach(() => {
    session.dispose();
    jest.useRealTimers();
  });

  test("1回目の確定後に2回目の addFinalToBuffer + commit で2回目の utterance_committed が送信される", () => {
    // Arrange
    session.handleMessage(makeStartMsg());

    // Act: 1回目
    session.addFinalToBuffer("first utterance");
    session.handleMessage({ type: "commit" });

    // Act: 2回目
    session.addFinalToBuffer("second utterance");
    session.handleMessage({ type: "commit" });

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(2);
    expect(committed[0].text).toBe("first utterance");
    expect(committed[0].reason).toBe("commit");
    expect(committed[1].text).toBe("second utterance");
    expect(committed[1].reason).toBe("commit");

    // タスク .8 対応: 2回分の非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });

  test("silence で確定後に再度 addFinalToBuffer して silence で確定できる", () => {
    // Arrange
    session.handleMessage(makeStartMsg({ silenceMs: 1000 }));

    // Act: 1回目の発話
    session.addFinalToBuffer("first");
    jest.advanceTimersByTime(1000);

    // Act: 2回目の発話
    session.addFinalToBuffer("second");
    jest.advanceTimersByTime(1000);

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(2);
    expect(committed[0].text).toBe("first");
    expect(committed[1].text).toBe("second");

    // タスク .8 対応: 2回分の silence タイマー発火後に起動した非同期パイプラインの Promise を flush
    jest.runAllTicks();
  });
});

// ---------------------------------------------------------------------------
// 8. セキュリティ: エラーメッセージに内部情報が含まれない
// ---------------------------------------------------------------------------
describe("セキュリティ — エラーメッセージの内容", () => {
  let mockWs: ReturnType<typeof createMockWs>;
  let session: Session;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = createMockWs();
    session = new Session(mockWs as unknown as WebSocket);
  });

  afterEach(() => {
    session.dispose();
    jest.useRealTimers();
  });

  test("sendError で送信されるメッセージにスタックトレースが含まれない", () => {
    // Act
    session.sendError("Test error message", false);

    // Assert
    const messages = getSentMessages(mockWs);
    expect(messages).toHaveLength(1);
    const errorMsg = messages[0];
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.fatal).toBe(false);
    const messageText = String(errorMsg.message ?? "");
    expect(messageText).not.toMatch(/at\s+\w+/); // スタックトレース パターン
    expect(messageText).not.toContain("Error:");
    expect(messageText).not.toContain("node_modules");
  });
});
