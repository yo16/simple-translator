/**
 * server/utteranceBuffer.ts の単体テスト（タスク .5）
 *
 * UtteranceBufferManager の純粋ロジックを検証する。
 * I/O なし、GCP 通信なし。フェイクタイマーを使用してタイマー動作を検証する。
 */

import { UtteranceBufferManager, UtteranceBufferConfig } from "../../server/utteranceBuffer";
import { UtteranceCommitReason } from "../../server/types";

// ---------------------------------------------------------------------------
// ヘルパー: テスト用のデフォルト設定
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<UtteranceBufferConfig> = {}): UtteranceBufferConfig {
  return {
    silenceMs: 1000,
    maxChars: 80,
    maxSeconds: 10000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. addFinal — 文字数上限（maxChars）での即時確定
// ---------------------------------------------------------------------------
describe("addFinal — 文字数上限（maxChars）での即時確定", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("addFinal でバッファが maxChars 未満の場合は確定されない", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ maxChars: 10 }), onCommit);

    // Act
    mgr.addFinal("abc"); // 3 文字 < 10

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
    expect(mgr.isEmpty()).toBe(false);
    expect(mgr.getText()).toBe("abc");
  });

  test("addFinal でバッファが maxChars ちょうどになると即座に確定され reason が 'maxChars' になる", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ maxChars: 5 }), onCommit);

    // Act
    mgr.addFinal("hello"); // 5 文字 >= 5

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("hello", "maxChars");
  });

  test("addFinal でバッファが maxChars を超えると即座に確定され reason が 'maxChars' になる", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ maxChars: 5 }), onCommit);

    // Act
    mgr.addFinal("helloworld"); // 10 文字 >= 5

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("helloworld", "maxChars");
  });

  test("複数回の addFinal でバッファ合計が maxChars を超えると確定される", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ maxChars: 10 }), onCommit);

    // Act
    mgr.addFinal("hello");    // 5 文字 < 10
    mgr.addFinal("world!");   // 合計 11 文字 >= 10

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("helloworld!", "maxChars");
  });

  test("maxChars での確定後にバッファがクリアされる（isEmpty=true, getText=''）", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ maxChars: 5 }), onCommit);

    // Act
    mgr.addFinal("hello");

    // Assert: バッファがクリアされていること
    expect(mgr.isEmpty()).toBe(true);
    expect(mgr.getText()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 2. addFinal — 無音タイマー（silenceMs）での確定
// ---------------------------------------------------------------------------
describe("addFinal — 無音タイマー（silenceMs）での確定", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("addFinal 後に silenceMs 経過する前はコールバックが呼ばれない", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("hello");

    // Act: silenceMs の直前（999ms）まで進める
    jest.advanceTimersByTime(999);

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("addFinal 後に silenceMs 経過すると 'silence' で確定される", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("hello");

    // Act: silenceMs 経過
    jest.advanceTimersByTime(1000);

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("hello", "silence");
  });

  test("silence 確定時に reason が 'silence' で、正しいテキストがコールバックに渡る", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 500 }), onCommit);
    mgr.addFinal("テスト発話");

    // Act
    jest.advanceTimersByTime(500);

    // Assert
    expect(onCommit).toHaveBeenCalledWith("テスト発話", "silence");
  });

  test("silence 確定後にバッファがクリアされる", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("hello");

    // Act
    jest.advanceTimersByTime(1000);

    // Assert
    expect(mgr.isEmpty()).toBe(true);
    expect(mgr.getText()).toBe("");
  });

  test("複数の addFinal 後に最後の addFinal から silenceMs 経過で確定される", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("hello ");

    // Act: 500ms 後に追加の final
    jest.advanceTimersByTime(500);
    mgr.addFinal("world");

    // Act: さらに 500ms（最初の addFinal から1000ms だが、タイマーはリセットされているはず）
    jest.advanceTimersByTime(500);

    // Assert: まだ確定されていない（最後の addFinal から 500ms しか経っていない）
    expect(onCommit).not.toHaveBeenCalled();

    // Act: さらに 500ms（最後の addFinal から 1000ms）
    jest.advanceTimersByTime(500);

    // Assert: 今度は確定される
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("hello world", "silence");
  });
});

// ---------------------------------------------------------------------------
// 3. maxSeconds タイマー — 空→非空で開始、発火で確定
// ---------------------------------------------------------------------------
describe("maxSeconds タイマー — バッファが空→非空になった時点で開始", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("addFinal 後に maxSeconds 未満では確定されない", () => {
    // Arrange: silenceMs を maxSeconds より大きくして silence タイマーが先に発火しないようにする
    mgr = new UtteranceBufferManager(makeConfig({ maxSeconds: 10000, silenceMs: 99999 }), onCommit);
    mgr.addFinal("hello");

    // Act: maxSeconds の直前（9999ms）まで進める
    jest.advanceTimersByTime(9999);

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("addFinal 後に maxSeconds 経過すると 'maxSeconds' で確定される", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ maxSeconds: 10000, silenceMs: 99999 }), onCommit);
    mgr.addFinal("long utterance");

    // Act
    jest.advanceTimersByTime(10000);

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("long utterance", "maxSeconds");
  });

  test("2回目の addFinal でも maxSeconds タイマーは最初の addFinal から計測される", () => {
    // Arrange: maxSeconds=5000, silenceMs=99999（silenceタイマーが先に発火しないよう）
    mgr = new UtteranceBufferManager(
      makeConfig({ maxSeconds: 5000, silenceMs: 99999 }),
      onCommit
    );
    mgr.addFinal("first");

    // Act: 4000ms 後に2回目の addFinal
    jest.advanceTimersByTime(4000);
    mgr.addFinal("second");

    // Act: さらに 1000ms（最初の addFinal から合計 5000ms）
    jest.advanceTimersByTime(1000);

    // Assert: 確定される（maxSeconds タイマーは最初の addFinal 起点）
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("firstsecond", "maxSeconds");
  });

  test("maxSeconds 確定後にバッファがクリアされる", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ maxSeconds: 5000, silenceMs: 99999 }), onCommit);
    mgr.addFinal("text");

    // Act
    jest.advanceTimersByTime(5000);

    // Assert
    expect(mgr.isEmpty()).toBe(true);
    expect(mgr.getText()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 4. notifyAudio — 無音タイマーのリセット（.3 誤発火バグ対策検証）
// ---------------------------------------------------------------------------
describe("notifyAudio — 無音タイマーのリセット", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("notifyAudio が silenceMs の途中でタイマーをリセットする（初回の silenceMs 経過では確定しない）", () => {
    // Arrange: silenceMs=1000
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("hello");

    // Act: 600ms 後に notifyAudio でリセット
    jest.advanceTimersByTime(600);
    mgr.notifyAudio();

    // Act: さらに 600ms（最初の addFinal から 1200ms だが、notifyAudio からは 600ms）
    jest.advanceTimersByTime(600);

    // Assert: まだ確定されていない（notifyAudio からのリセット後 600ms しか経っていない）
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("notifyAudio 後に silenceMs 経過すると確定される", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("hello");

    // Act: 600ms 後に notifyAudio
    jest.advanceTimersByTime(600);
    mgr.notifyAudio();

    // Act: さらに 1000ms（notifyAudio からの silenceMs 経過）
    jest.advanceTimersByTime(1000);

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("hello", "silence");
  });

  test("バッファが空のときの notifyAudio はタイマーを起動しない（空バッファへの silence 誤発火防止）", () => {
    // Arrange: バッファが空の状態で notifyAudio
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 100 }), onCommit);

    // Act: 空バッファで notifyAudio → 十分な時間を進める
    mgr.notifyAudio();
    jest.advanceTimersByTime(1000);

    // Assert: コールバックが呼ばれない
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("複数回の notifyAudio でタイマーが都度リセットされ、最後の notifyAudio から silenceMs 後に確定", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("speech");

    // Act: 300ms → notifyAudio → 300ms → notifyAudio → 300ms → notifyAudio
    jest.advanceTimersByTime(300);
    mgr.notifyAudio();
    jest.advanceTimersByTime(300);
    mgr.notifyAudio();
    jest.advanceTimersByTime(300);
    mgr.notifyAudio();

    // 最後の notifyAudio から 999ms — まだ確定されない
    jest.advanceTimersByTime(999);
    expect(onCommit).not.toHaveBeenCalled();

    // 最後の notifyAudio から 1000ms — 確定される
    jest.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("speech", "silence");
  });
});

// ---------------------------------------------------------------------------
// 5. commitManual — 手動確定
// ---------------------------------------------------------------------------
describe("commitManual — 手動確定", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("commitManual でバッファが非空の場合、即時確定され reason が 'commit' になる", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);
    mgr.addFinal("manual commit text");

    // Act
    mgr.commitManual();

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("manual commit text", "commit");
  });

  test("commitManual でバッファが空の場合、コールバックが呼ばれない", () => {
    // Arrange: バッファが空
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);

    // Act
    mgr.commitManual();

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("commitManual 後にバッファがクリアされる", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);
    mgr.addFinal("some text");

    // Act
    mgr.commitManual();

    // Assert
    expect(mgr.isEmpty()).toBe(true);
    expect(mgr.getText()).toBe("");
  });

  test("commitManual 後にタイマーがキャンセルされ、silence による二重確定が起きない", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("text");

    // Act: 手動 commit → さらに時間を進める（silenceタイマーが残っていたら誤発火する）
    mgr.commitManual();
    jest.advanceTimersByTime(2000);

    // Assert: 1回だけ呼ばれる（二重確定なし）
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. commitStop — stop による確定
// ---------------------------------------------------------------------------
describe("commitStop — stop による確定", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("commitStop でバッファが非空の場合、即時確定され reason が 'stop' になる", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);
    mgr.addFinal("stop commit text");

    // Act
    mgr.commitStop();

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("stop commit text", "stop");
  });

  test("commitStop でバッファが空の場合、コールバックが呼ばれない", () => {
    // Arrange: バッファが空
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);

    // Act
    mgr.commitStop();

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("commitStop 後にバッファがクリアされる", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);
    mgr.addFinal("stop text");

    // Act
    mgr.commitStop();

    // Assert
    expect(mgr.isEmpty()).toBe(true);
    expect(mgr.getText()).toBe("");
  });

  test("commitStop 後にタイマーがキャンセルされ、silence による二重確定が起きない", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("text");

    // Act
    mgr.commitStop();
    jest.advanceTimersByTime(2000);

    // Assert: 1回だけ
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 7. 空バッファへの各操作 — コールバックが呼ばれない
// ---------------------------------------------------------------------------
describe("空バッファへの操作 — コールバックが呼ばれない", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("空バッファへの commitManual はコールバックを呼ばない", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);

    // Act
    mgr.commitManual();

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("空バッファへの commitStop はコールバックを呼ばない", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);

    // Act
    mgr.commitStop();

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("空バッファで silence タイマーが発火してもコールバックを呼ばない（notifyAudio が空バッファでタイマー非起動）", () => {
    // Arrange: バッファ空で notifyAudio を呼んでも、silenceMs 後にコールバックが呼ばれない
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 100 }), onCommit);
    mgr.notifyAudio();

    // Act
    jest.advanceTimersByTime(200);

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. destroy — タイマーリーク防止
// ---------------------------------------------------------------------------
describe("destroy — タイマーリーク防止", () => {
  let onCommit: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("destroy 後に silenceMs が経過してもコールバックが呼ばれない", () => {
    // Arrange
    const mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1000 }), onCommit);
    mgr.addFinal("text");

    // Act: destroy してからタイマー時間を進める
    mgr.destroy();
    jest.advanceTimersByTime(2000);

    // Assert: コールバックが呼ばれない（タイマーがキャンセルされている）
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("destroy 後に maxSeconds が経過してもコールバックが呼ばれない", () => {
    // Arrange
    const mgr = new UtteranceBufferManager(
      makeConfig({ maxSeconds: 5000, silenceMs: 99999 }),
      onCommit
    );
    mgr.addFinal("long text");

    // Act
    mgr.destroy();
    jest.advanceTimersByTime(10000);

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("destroy 後に両タイマーが経過してもコールバックが呼ばれない（両タイマー同時確認）", () => {
    // Arrange
    const mgr = new UtteranceBufferManager(
      makeConfig({ silenceMs: 1000, maxSeconds: 2000 }),
      onCommit
    );
    mgr.addFinal("text");

    // Act
    mgr.destroy();
    jest.advanceTimersByTime(5000);

    // Assert
    expect(onCommit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. isEmpty / getText — 状態確認メソッド
// ---------------------------------------------------------------------------
describe("isEmpty / getText — 状態確認メソッド", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("初期状態では isEmpty=true、getText=''", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);

    // Assert
    expect(mgr.isEmpty()).toBe(true);
    expect(mgr.getText()).toBe("");
  });

  test("addFinal 後は isEmpty=false、getText で蓄積テキストが返る", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);

    // Act
    mgr.addFinal("hello");
    mgr.addFinal(" world");

    // Assert
    expect(mgr.isEmpty()).toBe(false);
    expect(mgr.getText()).toBe("hello world");
  });

  test("addFinal のみがバッファに入る（addFinal で追加したテキストが getText に反映される）", () => {
    // Arrange: addFinal を複数回呼んだ結果が getText に結合されて現れる
    mgr = new UtteranceBufferManager(makeConfig(), onCommit);

    // Act
    mgr.addFinal("one");
    mgr.addFinal("two");
    mgr.addFinal("three");

    // Assert
    expect(mgr.getText()).toBe("onetwothree");
  });
});

// ---------------------------------------------------------------------------
// 10. 境界値テスト
// ---------------------------------------------------------------------------
describe("境界値テスト", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("silenceMs=1 のとき、1ms 後に確定される", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 1 }), onCommit);
    mgr.addFinal("a");

    // Act: 0ms — まだ確定されない
    jest.advanceTimersByTime(0);
    expect(onCommit).not.toHaveBeenCalled();

    // Act: 1ms — 確定される
    jest.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledWith("a", "silence");
  });

  test("maxChars=1 のとき、1文字の addFinal で即座に確定される", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ maxChars: 1 }), onCommit);

    // Act
    mgr.addFinal("x");

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("x", "maxChars");
  });

  test("空文字列の addFinal はバッファに追加されるが確定条件を満たさない", () => {
    // Arrange: maxChars=5、空文字を追加しても 0 >= 5 にならない
    mgr = new UtteranceBufferManager(makeConfig({ maxChars: 5 }), onCommit);

    // Act: 空文字を追加（length=0 なので maxChars を超えない）
    mgr.addFinal("");

    // Assert: 確定されない（空文字は isEmpty とみなされないが length チェックに引っかからない）
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("maxSeconds タイマー直前では未確定、直後で確定される（境界）", () => {
    // Arrange
    mgr = new UtteranceBufferManager(
      makeConfig({ maxSeconds: 5000, silenceMs: 99999 }),
      onCommit
    );
    mgr.addFinal("boundary text");

    // Act: 4999ms — まだ確定されない
    jest.advanceTimersByTime(4999);
    expect(onCommit).not.toHaveBeenCalled();

    // Act: 1ms 追加（合計 5000ms）— 確定される
    jest.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledWith("boundary text", "maxSeconds");
  });

  test("silence タイマー直前では未確定、直後で確定される（境界）", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 2000 }), onCommit);
    mgr.addFinal("boundary");

    // Act: 1999ms — まだ確定されない
    jest.advanceTimersByTime(1999);
    expect(onCommit).not.toHaveBeenCalled();

    // Act: 1ms 追加（合計 2000ms）— 確定される
    jest.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledWith("boundary", "silence");
  });
});

// ---------------------------------------------------------------------------
// 11. コールバックテキストと reason の検証
// ---------------------------------------------------------------------------
describe("コールバック — text と reason の正確性", () => {
  let onCommit: jest.Mock;
  let mgr: UtteranceBufferManager;

  beforeEach(() => {
    jest.useFakeTimers();
    onCommit = jest.fn();
  });

  afterEach(() => {
    mgr?.destroy();
    jest.useRealTimers();
  });

  test("複数の addFinal が結合されたテキストがコールバックに渡る", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 500 }), onCommit);
    mgr.addFinal("part1");
    mgr.addFinal("part2");
    mgr.addFinal("part3");

    // Act
    jest.advanceTimersByTime(500);

    // Assert
    expect(onCommit).toHaveBeenCalledWith("part1part2part3", "silence");
  });

  test("日本語テキストが正しくコールバックに渡る", () => {
    // Arrange
    mgr = new UtteranceBufferManager(makeConfig({ silenceMs: 500 }), onCommit);
    mgr.addFinal("こんにちは");
    mgr.addFinal("世界");

    // Act
    jest.advanceTimersByTime(500);

    // Assert
    expect(onCommit).toHaveBeenCalledWith("こんにちは世界", "silence");
  });
});
