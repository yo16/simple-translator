/**
 * 無音による発話確定（silence commit）の TDD Red テスト
 *
 * バグ: handleAudio が音声チャンク受信のたびに utteranceBuffer.notifyAudio() を
 * 呼んで無音タイマーをリセットするため、MediaRecorder が無音中も音声チャンクを
 * 送り続ける状況では無音タイマーが永久にリセットされ、発火しない。
 *
 * 修正後の期待動作:
 *   - 無音タイマーは STT の結果活動（interim/final）でリセットされる
 *   - 生の音声チャンクではリセットされない
 *
 * このファイルのテストは修正前（現在のコード）では失敗し、
 * 修正後（バグ修正済みコード）で成功することを確認するためのもの。
 */

import WebSocket from "ws";
import { Session } from "../../server/session";
import { ClientMessage } from "../../server/schema";
import { createSpeechStream } from "../../server/speechStream";

// ---------------------------------------------------------------------------
// モック設定（session.stt.test.ts と同じ方式）
// ---------------------------------------------------------------------------
jest.mock("../../server/speechStream");
jest.mock("../../server/translate");
jest.mock("../../server/textToSpeech");

import { translate } from "../../server/translate";
import { isTtsEnabled, synthesize } from "../../server/textToSpeech";

const mockTranslate = translate as jest.MockedFunction<typeof translate>;
const mockIsTtsEnabled = isTtsEnabled as jest.MockedFunction<typeof isTtsEnabled>;
const mockSynthesize = synthesize as jest.MockedFunction<typeof synthesize>;

const mockCreateSpeechStream = createSpeechStream as jest.MockedFunction<typeof createSpeechStream>;

// ---------------------------------------------------------------------------
// ヘルパー: WebSocket スタブ
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
// ヘルパー: start メッセージ生成（silenceMs をカスタマイズ可能）
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
    silenceMs: overrides.silenceMs ?? 1000,
    maxChars: overrides.maxChars ?? 80,
    maxSeconds: overrides.maxSeconds ?? 600,
  };
}

// ---------------------------------------------------------------------------
// ヘルパー: SpeechStreamHandle 互換スタブ + コールバックキャプチャ
// ---------------------------------------------------------------------------
function setupMockSpeechStream() {
  const streamHandle = {
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  };

  let capturedOnInterim: ((text: string) => void) | null = null;
  let capturedOnFinal: ((text: string) => void) | null = null;

  mockCreateSpeechStream.mockImplementation((options) => {
    capturedOnInterim = options.onInterim;
    capturedOnFinal = options.onFinal;
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
  };
}

// ---------------------------------------------------------------------------
// 各テスト前後の設定
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.useFakeTimers();
  mockTranslate.mockResolvedValue("translated");
  mockIsTtsEnabled.mockReturnValue(false);
  mockSynthesize.mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 無音による発話確定（silence commit）のバグ修正テスト
// ---------------------------------------------------------------------------
describe("無音による発話確定 — 音声チャンクが無音タイマーをリセットしない（TDD Red）", () => {

  /**
   * テストA: STT final 受信後、音声チャンクが流れ続けても silenceMs 経過で確定する
   *
   * 現状の問題:
   *   handleAudio → notifyAudio() → resetSilenceTimer() が毎チャンクで実行される。
   *   そのため、finalが届いた後も audio チャンクが来るたびにタイマーがリセットされ、
   *   silenceMs が経過しても utterance_committed が送信されない。
   *
   * 修正後の期待:
   *   音声チャンクは無音タイマーに影響せず、finalから silenceMs 経過で確定する。
   *
   * このテストは現状コードで失敗する理由:
   *   audio チャンクを500ms間隔で送ると notifyAudio() がタイマーをリセットし続けるため、
   *   合計 advanceTimersByTime(2000ms) を経過させても utterance_committed が届かない。
   */
  test("テストA: STT final 後に音声チャンクが流れ続けても silenceMs 経過で utterance_committed(reason='silence') が送信される", () => {
    // Arrange
    const silenceMs = 1000;
    const { triggerFinal } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);

    session.handleMessage(makeStartMsg({ silenceMs, maxChars: 200, maxSeconds: 600 }));

    // STT ストリームを生成するために最初の audio を送る
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // STT が final を返す（バッファに追加され、無音タイマー開始）
    triggerFinal("九州では");

    // Act: 音声チャンクを送りながら時間を進める（合計 2000ms > silenceMs=1000ms）
    // 現状コード: audio ごとに notifyAudio() → resetSilenceTimer() が呼ばれるためタイマーがリセットされ続ける
    session.handleMessage({ type: "audio", data: "AAAA" });
    jest.advanceTimersByTime(500);

    session.handleMessage({ type: "audio", data: "BBBB" });
    jest.advanceTimersByTime(500);

    session.handleMessage({ type: "audio", data: "CCCC" });
    jest.advanceTimersByTime(500);

    session.handleMessage({ type: "audio", data: "DDDD" });
    jest.advanceTimersByTime(500);

    // Assert: silenceMs(1000ms)を超える時間が経過したので utterance_committed が送信されているはず
    const messages = getSentMessages(mockWs);
    const committed = messages.filter((m) => m.type === "utterance_committed");

    // 修正前（現状コード）: audio がリセットし続けるため committed は空 → このアサートが失敗（Red）
    // 修正後: audio はリセットしないので、final から1000ms以上経過した時点で確定 → 成功（Green）
    expect(committed).toHaveLength(1);
    expect(committed[0].reason).toBe("silence");
    expect(committed[0].text).toBe("九州では");

    session.dispose();
  });

  /**
   * テストB: interim 受信中は無音タイマーがリセットされ、early commit が起きない
   *
   * シナリオ:
   *   - final("A") → 無音タイマー開始（silenceMs=1000）
   *   - 600ms 経過 → interim("A の続き…") → タイマーがリセットされるべき
   *   - さらに 600ms 経過（final から通算 1200ms） → まだ確定していないはず
   *   - その後 1000ms 経過 → 確定する（reason="silence"）
   *
   * 現状の問題:
   *   interim は notifyAudio() も resetSilenceTimer() も呼ばない。
   *   そのため final から 1000ms 経過した時点（途中で interim が来ても関係なく）で
   *   早期確定してしまう。中間アサート「まだ確定していない」が失敗（Red）。
   *
   * 修正後の期待:
   *   interim 受信でタイマーがリセットされるため、final+600ms+interim+600ms=1200ms 時点では
   *   まだ確定せず、その後さらに silenceMs 経過で確定する。
   */
  test("テストB: STT interim が継続している間は無音タイマーがリセットされ、early commit が起きない", () => {
    // Arrange
    const silenceMs = 1000;
    const { triggerFinal, triggerInterim } = setupMockSpeechStream();
    const mockWs = createMockWs();
    const session = new Session(mockWs as unknown as WebSocket);

    session.handleMessage(makeStartMsg({ silenceMs, maxChars: 200, maxSeconds: 600 }));

    // STT ストリームを生成
    session.handleMessage({ type: "audio", data: "SGVsbG8=" });

    // STT が final を返す（無音タイマー開始: t=0）
    triggerFinal("A");

    // t=600ms 経過 → interim が届く（タイマーがリセットされるべき）
    jest.advanceTimersByTime(600);
    triggerInterim("A の続き…");

    // t=600+600=1200ms 経過（final から通算 1200ms > silenceMs=1000ms）
    jest.advanceTimersByTime(600);

    // 中間アサート: この時点ではまだ確定していないはず（interim がリセットしたなら）
    // 現状コード: interim はリセットしないため、final から 1000ms 経過で早期確定している
    //            → この expect が失敗（Red）
    const messagesAtMidpoint = getSentMessages(mockWs);
    const committedAtMidpoint = messagesAtMidpoint.filter((m) => m.type === "utterance_committed");
    expect(committedAtMidpoint).toHaveLength(0); // まだ確定していない

    // さらに silenceMs 経過（interim からカウントして 1000ms 以上）
    jest.advanceTimersByTime(1000);

    // 最終アサート: 今度は確定している
    const messagesAtEnd = getSentMessages(mockWs);
    const committedAtEnd = messagesAtEnd.filter((m) => m.type === "utterance_committed");
    expect(committedAtEnd).toHaveLength(1);
    expect(committedAtEnd[0].reason).toBe("silence");

    session.dispose();
  });
});
