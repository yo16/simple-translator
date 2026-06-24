/**
 * server/session.ts — 統合パイプラインテスト（タスク .8）
 *
 * onUtteranceCommitted が起動する runPostCommitPipeline（Translation → TTS → metrics）を検証する。
 * GCP（translate / textToSpeech）への実通信は行わない。すべてモック化する。
 * speechStream はテストに不要なため、createSpeechStream もモック化する。
 *
 * パイプライン送信順序（仕様通り）:
 *   utterance_committed → translation → (audio: TTS有効時) → metrics
 *
 * タイマー方針:
 *   このテストファイルのテストは「silence タイマー発火で確定を起こす」ケースを含まない。
 *   commit / handleMessage で直接確定を起こすため、フェイクタイマーは不要。
 *   実タイマーのまま（jest.useFakeTimers() を使わない）ことで、
 *   setImmediate ベースの flushPromises が Jest 29 でも正しく動作する。
 *
 * 非同期パイプライン完了待ち:
 *   runPostCommitPipeline は Promise チェーン（translate await → synthesize await → send）。
 *   モックは即時 resolve/reject するため、setImmediate で Microtask + Macrotask を
 *   一巡させれば全 await が解決する。
 *   待ち漏れ防止: translation/audio/metrics が「送信される」テストは、
 *   flush 前に send が呼ばれていないことを構造上確認できる
 *   （commit の直後は同期的に utterance_committed のみ送信され、パイプラインは非同期）。
 */

import WebSocket from "ws";
import { Session } from "../../server/session";
import { ClientMessage } from "../../server/schema";

// ---------------------------------------------------------------------------
// モック化: translate / textToSpeech / speechStream
// ---------------------------------------------------------------------------
jest.mock("../../server/translate");
jest.mock("../../server/textToSpeech");
jest.mock("../../server/speechStream");

import { translate } from "../../server/translate";
import { isTtsEnabled, synthesize } from "../../server/textToSpeech";

const mockTranslate = translate as jest.MockedFunction<typeof translate>;
const mockIsTtsEnabled = isTtsEnabled as jest.MockedFunction<typeof isTtsEnabled>;
const mockSynthesize = synthesize as jest.MockedFunction<typeof synthesize>;

// ---------------------------------------------------------------------------
// ヘルパー: 非同期パイプライン（Promise チェーン）を完全解決する
//
// 実タイマー環境のため setImmediate が本物であり、
// Node.js のイベントループで全 Microtask が解決された後に呼ばれる。
// runPostCommitPipeline の await 連鎖（translate → synthesize → send）が
// 全て即時 resolve/reject するモックであれば、setImmediate 1回で十分解決する。
// ---------------------------------------------------------------------------
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// ヘルパー: 最小 WebSocket スタブ
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
// ヘルパー: 有効な start メッセージ（TTS有効/無効を切り替え可能）
// silenceMs / maxSeconds は大きめにして意図しないタイマー発火を防ぐ
// ---------------------------------------------------------------------------
function makeStartMsg(overrides: Partial<{
  sourceLanguage: "ja-JP" | "en-US";
  targetLanguage: "ja-JP" | "en-US";
  enableTts: boolean;
  silenceMs: number;
  maxChars: number;
  maxSeconds: number;
}> = {}): ClientMessage {
  return {
    type: "start",
    sourceLanguage: overrides.sourceLanguage ?? "ja-JP",
    targetLanguage: overrides.targetLanguage ?? "en-US",
    enableTts: overrides.enableTts ?? true,
    enableInterimTranslation: false,
    chunkMs: 250,
    silenceMs: overrides.silenceMs ?? 60000,
    maxChars: overrides.maxChars ?? 80,
    maxSeconds: overrides.maxSeconds ?? 600,
  };
}

// ---------------------------------------------------------------------------
// 各テスト後のクリーンアップ
// ---------------------------------------------------------------------------
afterEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// 1. 正常フロー: メッセージ送信順序の検証
// ===========================================================================
describe("正常フロー — utterance_committed → translation → audio → metrics の送信順序", () => {
  test("commit で確定後に utterance_committed → translation → audio → metrics の順でメッセージが送信される", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello, world.");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockResolvedValue("bW9ja2F1ZGlv"); // base64 mock

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("こんにちは世界。");

    // Act: commit で発話確定（同期的に utterance_committed のみ送信、パイプラインは非同期起動）
    session.handleMessage({ type: "commit" });

    // 待ち漏れ防止の構造確認:
    // commit 直後（flush 前）は utterance_committed のみ送信されており translation/audio/metrics はまだ送信されない
    const msgsBefore = getSentMessages(mockWs);
    expect(msgsBefore.map((m) => m.type)).not.toContain("translation");

    // パイプライン（Promise チェーン）完了を待つ
    await flushPromises();

    // Assert: 送信されたメッセージの type を順序通りに取得
    const messages = getSentMessages(mockWs);
    const types = messages.map((m) => m.type);

    expect(types).toContain("utterance_committed");
    expect(types).toContain("translation");
    expect(types).toContain("audio");
    expect(types).toContain("metrics");

    // 順序を検証: utterance_committed < translation < audio < metrics
    const idxCommitted = types.indexOf("utterance_committed");
    const idxTranslation = types.indexOf("translation");
    const idxAudio = types.indexOf("audio");
    const idxMetrics = types.indexOf("metrics");

    expect(idxCommitted).toBeLessThan(idxTranslation);
    expect(idxTranslation).toBeLessThan(idxAudio);
    expect(idxAudio).toBeLessThan(idxMetrics);

    session.dispose();
  });

  test("TTS 無効時は utterance_committed → translation → metrics の順（audio なし）", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello, world.");
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("こんにちは。");

    // Act
    session.handleMessage({ type: "commit" });

    // flush 前は translation が存在しないことを確認（待ち漏れ防止構造）
    expect(getSentMessages(mockWs).map((m) => m.type)).not.toContain("translation");

    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const types = messages.map((m) => m.type);

    expect(types).toContain("utterance_committed");
    expect(types).toContain("translation");
    expect(types).not.toContain("audio");
    expect(types).toContain("metrics");

    const idxCommitted = types.indexOf("utterance_committed");
    const idxTranslation = types.indexOf("translation");
    const idxMetrics = types.indexOf("metrics");

    expect(idxCommitted).toBeLessThan(idxTranslation);
    expect(idxTranslation).toBeLessThan(idxMetrics);

    session.dispose();
  });
});

// ===========================================================================
// 2. translation メッセージの内容検証
// ===========================================================================
describe("translation メッセージの内容", () => {
  test("translation メッセージの sourceText が確定テキストと一致し translatedText が translate の戻り値と一致する", async () => {
    // Arrange
    const sourceText = "翻訳元のテキスト";
    const translatedText = "Translated text";
    mockTranslate.mockResolvedValue(translatedText);
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer(sourceText);

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const translationMsg = messages.find((m) => m.type === "translation");
    expect(translationMsg).toBeDefined();
    expect(translationMsg!.sourceText).toBe(sourceText);
    expect(translationMsg!.translatedText).toBe(translatedText);

    session.dispose();
  });

  test("translation メッセージに sourceText と translatedText フィールドが存在する", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Some translation");
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("テスト発話");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const translationMsg = messages.find((m) => m.type === "translation");
    expect(translationMsg).toBeDefined();
    expect(typeof translationMsg!.sourceText).toBe("string");
    expect(typeof translationMsg!.translatedText).toBe("string");

    session.dispose();
  });
});

// ===========================================================================
// 3. TTS 有効/無効の検証
// ===========================================================================
describe("TTS 有効/無効 — audio メッセージの送信制御", () => {
  test("enableTts=true かつ isTtsEnabled()=true のとき audio メッセージが送信される", async () => {
    // Arrange
    const audioBase64 = "bW9ja2F1ZGlvZGF0YQ=="; // base64 mock data
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockResolvedValue(audioBase64);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("こんにちは");

    // Act
    session.handleMessage({ type: "commit" });

    // flush 前は audio が存在しないことを確認（待ち漏れ防止構造）
    expect(getSentMessages(mockWs).map((m) => m.type)).not.toContain("audio");

    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const audioMsg = messages.find((m) => m.type === "audio");
    expect(audioMsg).toBeDefined();
    expect(audioMsg!.data).toBe(audioBase64);
    expect(audioMsg!.mimeType).toBe("audio/mpeg");

    session.dispose();
  });

  test("enableTts=false のとき audio メッセージが送信されない", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(true); // isTtsEnabled は true だが enableTts=false
    mockSynthesize.mockResolvedValue("someBase64");

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("こんにちは");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: enableTts=false なので audio は送信されない
    const messages = getSentMessages(mockWs);
    const audioMsg = messages.find((m) => m.type === "audio");
    expect(audioMsg).toBeUndefined();

    session.dispose();
  });

  test("isTtsEnabled()=false のとき audio メッセージが送信されない", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(false); // 環境変数で TTS 無効
    mockSynthesize.mockResolvedValue("someBase64");

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("こんにちは");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const audioMsg = messages.find((m) => m.type === "audio");
    expect(audioMsg).toBeUndefined();

    session.dispose();
  });

  test("synthesize が null を返すとき audio メッセージが送信されない", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockResolvedValue(null); // 空テキスト等で null を返す

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("こんにちは");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const audioMsg = messages.find((m) => m.type === "audio");
    expect(audioMsg).toBeUndefined();

    session.dispose();
  });

  test("audio メッセージの mimeType が 'audio/mpeg' で data が string（TTS有効時）", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockResolvedValue("YXVkaW9kYXRh");

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const audioMsg = messages.find((m) => m.type === "audio");
    expect(audioMsg).toBeDefined();
    expect(audioMsg!.mimeType).toBe("audio/mpeg");
    expect(typeof audioMsg!.data).toBe("string");

    session.dispose();
  });
});

// ===========================================================================
// 4. metrics メッセージの検証
// ===========================================================================
describe("metrics メッセージの検証", () => {
  test("metrics メッセージが送信され speechMs/translationMs/ttsMs/totalMs が 0 以上の数値", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("テスト発話");

    // Act
    session.handleMessage({ type: "commit" });

    // flush 前は metrics が存在しないことを確認（待ち漏れ防止構造）
    expect(getSentMessages(mockWs).map((m) => m.type)).not.toContain("metrics");

    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const metricsMsg = messages.find((m) => m.type === "metrics");
    expect(metricsMsg).toBeDefined();

    expect(typeof metricsMsg!.speechMs).toBe("number");
    expect(typeof metricsMsg!.translationMs).toBe("number");
    expect(typeof metricsMsg!.ttsMs).toBe("number");
    expect(typeof metricsMsg!.totalMs).toBe("number");

    expect(metricsMsg!.speechMs as number).toBeGreaterThanOrEqual(0);
    expect(metricsMsg!.translationMs as number).toBeGreaterThanOrEqual(0);
    expect(metricsMsg!.ttsMs as number).toBeGreaterThanOrEqual(0);
    expect(metricsMsg!.totalMs as number).toBeGreaterThanOrEqual(0);

    session.dispose();
  });

  test("TTS 無効時は metrics の ttsMs が 0", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const metricsMsg = messages.find((m) => m.type === "metrics");
    expect(metricsMsg).toBeDefined();
    expect(metricsMsg!.ttsMs).toBe(0);

    session.dispose();
  });
});

// ===========================================================================
// 5. 言語コードの検証: translate / synthesize の呼び出し引数
// ===========================================================================
describe("言語コードの検証 — translate / synthesize の呼び出し引数", () => {
  test("translate がフルコード（ja-JP, en-US）で呼ばれる", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Translated text");
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({
      sourceLanguage: "ja-JP",
      targetLanguage: "en-US",
      enableTts: false,
    }));
    session.addFinalToBuffer("発話テキスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: translate がフルコードで呼ばれていること
    expect(mockTranslate).toHaveBeenCalledWith("発話テキスト", "ja-JP", "en-US");

    session.dispose();
  });

  test("synthesize が翻訳後テキストとターゲット言語フルコード（en-US）で呼ばれる", async () => {
    // Arrange
    const translatedText = "Translated speech";
    mockTranslate.mockResolvedValue(translatedText);
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockResolvedValue("audioBase64");

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({
      sourceLanguage: "ja-JP",
      targetLanguage: "en-US",
      enableTts: true,
    }));
    session.addFinalToBuffer("発話テキスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: synthesize が翻訳後テキストとターゲット言語フルコードで呼ばれていること
    expect(mockSynthesize).toHaveBeenCalledWith(translatedText, "en-US");

    session.dispose();
  });

  test("en-US → ja-JP の翻訳で translate が逆の言語コードで呼ばれる", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("翻訳されたテキスト");
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({
      sourceLanguage: "en-US",
      targetLanguage: "ja-JP",
      enableTts: false,
    }));
    session.addFinalToBuffer("Hello world");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    expect(mockTranslate).toHaveBeenCalledWith("Hello world", "en-US", "ja-JP");

    session.dispose();
  });
});

// ===========================================================================
// 6. エラー継続: translate が失敗したとき
// ===========================================================================
describe("エラー継続 — translate 失敗", () => {
  test("translate が reject すると error（fatal:false）メッセージが送信される", async () => {
    // Arrange
    mockTranslate.mockRejectedValue(new Error("Translation failed. Please try again."));
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("翻訳失敗テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: error メッセージが送信される
    const messages = getSentMessages(mockWs);
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.fatal).toBe(false);

    session.dispose();
  });

  test("translate が reject すると translation / audio / metrics は送信されない", async () => {
    // Arrange
    mockTranslate.mockRejectedValue(new Error("Translation failed. Please try again."));
    mockIsTtsEnabled.mockReturnValue(true);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("翻訳失敗テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const types = messages.map((m) => m.type);

    expect(types).not.toContain("translation");
    expect(types).not.toContain("audio");
    expect(types).not.toContain("metrics");

    session.dispose();
  });

  test("translate が reject しても ws.close は呼ばれない（接続維持）", async () => {
    // Arrange
    mockTranslate.mockRejectedValue(new Error("Translation failed. Please try again."));
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("翻訳失敗テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: ws.close は呼ばれない（接続維持）
    expect(mockWs.close).not.toHaveBeenCalled();

    session.dispose();
  });

  test("translate が reject すると utterance_committed は依然として送信される", async () => {
    // Arrange: translate は失敗するが utterance_committed は同期的に先送信済み
    mockTranslate.mockRejectedValue(new Error("Translation failed. Please try again."));
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("テスト発話");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: utterance_committed は送信されている
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");
    expect(committed).toHaveLength(1);

    session.dispose();
  });
});

// ===========================================================================
// 7. TTS エラー: synthesize が失敗したとき
// ===========================================================================
describe("TTS エラー — synthesize 失敗", () => {
  test("synthesize が reject すると error（fatal:false）メッセージが送信される", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockRejectedValue(new Error("Text-to-Speech failed. Please try again."));

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("TTS失敗テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.fatal).toBe(false);

    session.dispose();
  });

  test("synthesize が reject しても metrics は送信される（TTS失敗時もメトリクスを返す仕様）", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockRejectedValue(new Error("Text-to-Speech failed. Please try again."));

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("TTS失敗テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: TTS失敗時も metrics は送信される
    const messages = getSentMessages(mockWs);
    const metricsMsg = messages.find((m) => m.type === "metrics");
    expect(metricsMsg).toBeDefined();

    session.dispose();
  });

  test("synthesize が reject しても translation メッセージは送信される", async () => {
    // Arrange
    const translatedText = "Hello";
    mockTranslate.mockResolvedValue(translatedText);
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockRejectedValue(new Error("Text-to-Speech failed. Please try again."));

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("TTS失敗テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: translation は送信済みでエラー前
    const messages = getSentMessages(mockWs);
    const translationMsg = messages.find((m) => m.type === "translation");
    expect(translationMsg).toBeDefined();
    expect(translationMsg!.translatedText).toBe(translatedText);

    session.dispose();
  });

  test("synthesize が reject しても ws.close は呼ばれない（接続維持）", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockRejectedValue(new Error("Text-to-Speech failed. Please try again."));

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("TTS失敗テスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    expect(mockWs.close).not.toHaveBeenCalled();

    session.dispose();
  });
});

// ===========================================================================
// 8. 連続発話: 複数回の確定でパイプラインが独立して動作する
// ===========================================================================
describe("連続発話 — 複数回の発話確定", () => {
  test("2回の発話確定で translation と metrics がそれぞれ2回送信される", async () => {
    // Arrange
    mockTranslate
      .mockResolvedValueOnce("First translation")
      .mockResolvedValueOnce("Second translation");
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));

    // Act: 1発話目
    session.addFinalToBuffer("一つ目の発話");
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Act: 2発話目
    session.addFinalToBuffer("二つ目の発話");
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: translation が2回
    const messages = getSentMessages(mockWs);
    const translationMsgs = messages.filter((m) => m.type === "translation");
    expect(translationMsgs).toHaveLength(2);
    expect(translationMsgs[0].translatedText).toBe("First translation");
    expect(translationMsgs[1].translatedText).toBe("Second translation");

    // Assert: metrics が2回
    const metricsMsgs = messages.filter((m) => m.type === "metrics");
    expect(metricsMsgs).toHaveLength(2);

    // それぞれの metrics の値が number で 0 以上
    for (const metricsMsg of metricsMsgs) {
      expect(typeof metricsMsg.speechMs).toBe("number");
      expect(typeof metricsMsg.translationMs).toBe("number");
      expect(typeof metricsMsg.ttsMs).toBe("number");
      expect(typeof metricsMsg.totalMs).toBe("number");
      expect(metricsMsg.speechMs as number).toBeGreaterThanOrEqual(0);
      expect(metricsMsg.translationMs as number).toBeGreaterThanOrEqual(0);
    }

    session.dispose();
  });

  test("1発話目確定後、2発話目確定で utterance_committed が計2回送信される", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Translated");
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));

    // Act
    session.addFinalToBuffer("first utterance");
    session.handleMessage({ type: "commit" });
    await flushPromises();

    session.addFinalToBuffer("second utterance");
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const committedMsgs = messages.filter((m) => m.type === "utterance_committed");
    expect(committedMsgs).toHaveLength(2);
    expect(committedMsgs[0].text).toBe("first utterance");
    expect(committedMsgs[1].text).toBe("second utterance");

    session.dispose();
  });

  test("TTS 有効で2回発話確定すると audio が2回送信される", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Translated");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize
      .mockResolvedValueOnce("audioBase64_1")
      .mockResolvedValueOnce("audioBase64_2");

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));

    // Act
    session.addFinalToBuffer("first");
    session.handleMessage({ type: "commit" });
    await flushPromises();

    session.addFinalToBuffer("second");
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const audioMsgs = messages.filter((m) => m.type === "audio");
    expect(audioMsgs).toHaveLength(2);
    expect(audioMsgs[0].data).toBe("audioBase64_1");
    expect(audioMsgs[1].data).toBe("audioBase64_2");

    session.dispose();
  });
});

// ===========================================================================
// 9. セキュリティ: エラーメッセージに内部情報が漏れない
// ===========================================================================
describe("セキュリティ — パイプラインエラーの内容", () => {
  test("translate 失敗時の error メッセージにスタックトレースが含まれない", async () => {
    // Arrange
    mockTranslate.mockRejectedValue(new Error("Translation failed. Please try again."));
    mockIsTtsEnabled.mockReturnValue(false);

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: false }));
    session.addFinalToBuffer("エラーテスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert: error メッセージにスタックトレースが含まれない
    const messages = getSentMessages(mockWs);
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    const messageText = String(errorMsg!.message ?? "");
    expect(messageText).not.toMatch(/at\s+\w+/); // スタックトレースパターン
    expect(messageText).not.toContain("node_modules");

    session.dispose();
  });

  test("TTS 失敗時の error メッセージにスタックトレースが含まれない", async () => {
    // Arrange
    mockTranslate.mockResolvedValue("Hello");
    mockIsTtsEnabled.mockReturnValue(true);
    mockSynthesize.mockRejectedValue(new Error("Text-to-Speech failed. Please try again."));

    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);
    session.handleMessage(makeStartMsg({ enableTts: true }));
    session.addFinalToBuffer("TTS エラーテスト");

    // Act
    session.handleMessage({ type: "commit" });
    await flushPromises();

    // Assert
    const messages = getSentMessages(mockWs);
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    const messageText = String(errorMsg!.message ?? "");
    expect(messageText).not.toMatch(/at\s+\w+/);
    expect(messageText).not.toContain("node_modules");

    session.dispose();
  });
});
