/**
 * server/session.ts の STT 配線テスト（タスク .4）
 *
 * Session クラスの onAudioChunk → createSpeechStream 配線を検証する。
 * GCP（Speech-to-Text）への実通信は行わない。
 * createSpeechStream を jest.mock() でモック化し、モックストリームを注入する。
 *
 * モック方式:
 *   jest.mock("../../server/speechStream") で speechStream モジュール全体をモックし、
 *   createSpeechStream が SpeechStreamHandle 互換のスタブを返すよう設定する。
 *   各テストでモックストリームに対してコールバック（onInterim/onFinal/onError）を
 *   手動で呼び出し、Session の ws.send 呼び出しを検証する。
 *
 * タスク .8 対応:
 *   onFinal → addFinalToBuffer → onUtteranceCommitted が translate/synthesize を
 *   呼ぶようになったため、GCP 実通信を遮断するためにモックする。
 *   既存テストの検証意図（STT配線、transcript_final/interim 送信等）は変えない。
 */

import WebSocket from "ws";
import { Session } from "../../server/session";
import { ClientMessage } from "../../server/schema";
import { createSpeechStream } from "../../server/speechStream";

// ---------------------------------------------------------------------------
// speechStream モジュール全体をモック化する
// ---------------------------------------------------------------------------
jest.mock("../../server/speechStream");

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

const mockCreateSpeechStream = createSpeechStream as jest.MockedFunction<typeof createSpeechStream>;

// ---------------------------------------------------------------------------
// ヘルパー: 最小 WebSocket スタブ（既存 session.test.ts と同じ方式）
// ---------------------------------------------------------------------------
function createMockWs() {
  return {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    close: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// ヘルパー: ws.send に渡された JSON をパースして返す
// ---------------------------------------------------------------------------
function getSentMessages(mockWs: ReturnType<typeof createMockWs>): Record<string, unknown>[] {
  return mockWs.send.mock.calls.map((args) => JSON.parse(args[0] as string));
}

// ---------------------------------------------------------------------------
// ヘルパー: 有効な start メッセージ
// ---------------------------------------------------------------------------
function makeStartMsg(overrides: Partial<{
  sourceLanguage: "ja-JP" | "en-US";
  silenceMs: number;
  maxChars: number;
  maxSeconds: number;
}> = {}): ClientMessage {
  return {
    type: "start",
    sourceLanguage: overrides.sourceLanguage ?? "ja-JP",
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
// ヘルパー: SpeechStreamHandle 互換スタブを生成し、createSpeechStream のモックに設定する
// 捕捉したコールバック（onInterim/onFinal/onError）をテスト側から呼べるよう返す
// ---------------------------------------------------------------------------
function setupMockSpeechStream() {
  const streamHandle = {
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  };

  let capturedOnInterim: ((text: string) => void) | null = null;
  let capturedOnFinal: ((text: string) => void) | null = null;
  let capturedOnError: ((message: string, fatal: boolean) => void) | null = null;

  mockCreateSpeechStream.mockImplementation((options) => {
    capturedOnInterim = options.onInterim;
    capturedOnFinal = options.onFinal;
    capturedOnError = options.onError;
    return streamHandle;
  });

  return {
    streamHandle,
    triggerInterim: (text: string) => {
      if (capturedOnInterim) capturedOnInterim(text);
    },
    triggerFinal: (text: string) => {
      if (capturedOnFinal) capturedOnFinal(text);
    },
    triggerError: (message: string, fatal: boolean) => {
      if (capturedOnError) capturedOnError(message, fatal);
    },
  };
}

// ---------------------------------------------------------------------------
// 各テスト後のクリーンアップ
// ---------------------------------------------------------------------------
afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. STT ストリームの生成（start → audio）
// ---------------------------------------------------------------------------
describe("Session STT 配線 — STT ストリームの生成", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("start 後に audio を受信すると createSpeechStream が1回だけ呼ばれる", () => {
    // Arrange
    const { streamHandle } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());

    // Act
    session.handleMessage({ type: "audio", data: "SGVsbG8=" }); // base64("Hello")

    // Assert
    expect(mockCreateSpeechStream).toHaveBeenCalledTimes(1);

    session.dispose();
    streamHandle.destroy.mockClear();
  });

  test("audio を複数回受信しても createSpeechStream は1回しか呼ばれない（ストリームを切り直さない）", () => {
    // Arrange
    const { streamHandle } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());

    // Act
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });
    session.handleMessage({ type: "audio", data: "V29ybGQ=" }); // base64("World")
    session.handleMessage({ type: "audio", data: "AAAA" });

    // Assert: 3回 audio を受信しても createSpeechStream は1回のみ
    expect(mockCreateSpeechStream).toHaveBeenCalledTimes(1);

    session.dispose();
    streamHandle.destroy.mockClear();
  });

  test("start 時の sourceLanguage が createSpeechStream の languageCode に渡る（ja-JP）", () => {
    // Arrange
    setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ sourceLanguage: "ja-JP" }));

    // Act
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Assert
    expect(mockCreateSpeechStream).toHaveBeenCalledWith(
      expect.objectContaining({ languageCode: "ja-JP" })
    );

    session.dispose();
  });

  test("start 時の sourceLanguage が createSpeechStream の languageCode に渡る（en-US）", () => {
    // Arrange
    setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ sourceLanguage: "en-US" }));

    // Act
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Assert
    expect(mockCreateSpeechStream).toHaveBeenCalledWith(
      expect.objectContaining({ languageCode: "en-US" })
    );

    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// 2. audio の base64 → Buffer 変換と write
// ---------------------------------------------------------------------------
describe("Session STT 配線 — audio の base64→Buffer 変換", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("audio の base64 data が Buffer に変換されてストリームの write に渡る", () => {
    // Arrange
    const { streamHandle } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());

    // base64("Hello") = "SGVsbG8="
    const base64Data = "SGVsbG8=";
    const expectedBuffer = Buffer.from(base64Data, "base64");

    // Act
    session.handleMessage({ type: "audio", data: base64Data });

    // Assert: write に Buffer が渡ること
    expect(streamHandle.write).toHaveBeenCalledTimes(1);
    const writtenArg = streamHandle.write.mock.calls[0][0] as Buffer;
    expect(Buffer.isBuffer(writtenArg)).toBe(true);
    expect(writtenArg).toEqual(expectedBuffer);

    session.dispose();
  });

  test("複数回 audio を受信すると write がその回数分だけ呼ばれる", () => {
    // Arrange
    const { streamHandle } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());

    // Act
    session.handleMessage({ type: "audio", data: "AAAA" });
    session.handleMessage({ type: "audio", data: "BBBB" });

    // Assert
    expect(streamHandle.write).toHaveBeenCalledTimes(2);

    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// 3. onFinal コールバック → transcript_final 送信 + バッファ蓄積
// ---------------------------------------------------------------------------
describe("Session STT 配線 — onFinal コールバック", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("onFinal が発火すると transcript_final が ws.send される", () => {
    // Arrange
    const { triggerFinal } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act: STT の onFinal コールバックをトリガー
    triggerFinal("こんにちは世界");

    // Assert
    const messages = getSentMessages(mockWs);
    const finalMessages = messages.filter((m) => m.type === "transcript_final");
    expect(finalMessages).toHaveLength(1);
    expect(finalMessages[0].text).toBe("こんにちは世界");

    session.dispose();
  });

  test("onFinal で渡されたテキストが発話バッファに蓄積され、その後の commit で utterance_committed が送信される", () => {
    // Arrange
    const { triggerFinal } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerFinal("発話テキスト");
    session.handleMessage({ type: "commit" });

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toBe("発話テキスト");
    expect(committed[0].reason).toBe("commit");

    // タスク .8 対応: commit で起動した非同期パイプラインの Promise を flush
    jest.runAllTicks();

    session.dispose();
  });

  test("onFinal が複数回発火するとテキストが結合されてバッファに蓄積される", () => {
    // Arrange
    const { triggerFinal } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ maxChars: 1000 })); // 大きな制限で途中確定しない
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerFinal("first sentence. ");
    triggerFinal("second sentence.");

    // commit で確定
    session.handleMessage({ type: "commit" });

    // Assert
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toContain("first sentence.");
    expect(committed[0].text).toContain("second sentence.");

    // タスク .8 対応: commit で起動した非同期パイプラインの Promise を flush
    jest.runAllTicks();

    session.dispose();
  });

  test("transcript_final メッセージの type が 'transcript_final' で text が文字列", () => {
    // Arrange
    const { triggerFinal } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerFinal("test transcript");

    // Assert
    const messages = getSentMessages(mockWs);
    const finalMsg = messages.find((m) => m.type === "transcript_final");
    expect(finalMsg).toBeDefined();
    expect(typeof finalMsg!.text).toBe("string");

    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// 4. onInterim コールバック → transcript_interim 送信（バッファには入らない）
// ---------------------------------------------------------------------------
describe("Session STT 配線 — onInterim コールバック", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("onInterim が発火すると transcript_interim が ws.send される", () => {
    // Arrange
    const { triggerInterim } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerInterim("interim text...");

    // Assert
    const messages = getSentMessages(mockWs);
    const interimMessages = messages.filter((m) => m.type === "transcript_interim");
    expect(interimMessages).toHaveLength(1);
    expect(interimMessages[0].text).toBe("interim text...");

    session.dispose();
  });

  test("onInterim が発火してもバッファには蓄積されず、commit しても utterance_committed が送信されない", () => {
    // Arrange
    const { triggerInterim } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act: interim のみ（final なし）
    triggerInterim("interim only");
    session.handleMessage({ type: "commit" });

    // Assert: utterance_committed は送信されない
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(0);

    session.dispose();
  });

  test("transcript_interim メッセージの type が 'transcript_interim' で text が文字列", () => {
    // Arrange
    const { triggerInterim } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerInterim("interim test");

    // Assert
    const messages = getSentMessages(mockWs);
    const interimMsg = messages.find((m) => m.type === "transcript_interim");
    expect(interimMsg).toBeDefined();
    expect(typeof interimMsg!.text).toBe("string");

    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// 5. onError コールバック → error メッセージ送信（fatal=false で接続維持）
// ---------------------------------------------------------------------------
describe("Session STT 配線 — onError コールバック", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("onError が fatal=false で発火すると error メッセージが ws.send される", () => {
    // Arrange
    const { triggerError } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerError("Speech recognition stream timed out. Please stop and restart recording.", false);

    // Assert
    const messages = getSentMessages(mockWs);
    const errorMessages = messages.filter((m) => m.type === "error");
    expect(errorMessages).toHaveLength(1);
    expect(errorMessages[0].fatal).toBe(false);

    session.dispose();
  });

  test("onError が fatal=false で発火しても ws.close は呼ばれない（接続維持）", () => {
    // Arrange
    const { triggerError } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerError("Speech recognition error. Please try again.", false);

    // Assert: close は呼ばれない
    expect(mockWs.close).not.toHaveBeenCalled();

    session.dispose();
  });

  test("error メッセージの type が 'error' で message が文字列、fatal が boolean", () => {
    // Arrange
    const { triggerError } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerError("some error message", false);

    // Assert
    const messages = getSentMessages(mockWs);
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(typeof errorMsg!.message).toBe("string");
    expect(typeof errorMsg!.fatal).toBe("boolean");

    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// 6. セキュリティ: STT エラーメッセージに GCP 内部詳細が含まれない
// ---------------------------------------------------------------------------
describe("Session STT 配線 — セキュリティ: エラーメッセージの内容", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("onError で渡されたメッセージがそのまま error.message として送信される（session は中継するだけ）", () => {
    // Arrange
    const { triggerError } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // onError に渡されるのは speechStream が汎用化したメッセージ
    const sanitizedMessage = "Speech recognition error. Please try again.";

    // Act
    triggerError(sanitizedMessage, false);

    // Assert: セッションはメッセージを変更せずに中継する
    const messages = getSentMessages(mockWs);
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg!.message).toBe(sanitizedMessage);

    session.dispose();
  });

  test("error メッセージにスタックトレースが含まれない", () => {
    // Arrange
    const { triggerError } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    triggerError("Speech recognition error. Please try again.", false);

    // Assert
    const messages = getSentMessages(mockWs);
    const errorMsg = messages.find((m) => m.type === "error");
    const messageText = String(errorMsg!.message ?? "");
    expect(messageText).not.toMatch(/at\s+\w+/); // スタックトレース パターン
    expect(messageText).not.toContain("node_modules");

    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// 7. stop メッセージで STT ストリームが終了する
// ---------------------------------------------------------------------------
describe("Session STT 配線 — stop メッセージ", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("stop メッセージを受信するとストリームの end() が呼ばれる", () => {
    // Arrange
    const { streamHandle } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act
    session.handleMessage({ type: "stop" });

    // Assert
    expect(streamHandle.end).toHaveBeenCalledTimes(1);

    session.dispose();
  });

  test("stop 後に dispose を呼んでも二重終了でエラーが起きない", () => {
    // Arrange
    setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg());
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // Act & Assert: 例外が起きないこと
    expect(() => {
      session.handleMessage({ type: "stop" });
      session.dispose();
    }).not.toThrow();
  });
});
