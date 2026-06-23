/**
 * WebSocketサーバー基盤 結合テスト（タスク .3）
 *
 * startServer() をインプロセスで起動し、ws クライアントで接続・メッセージ送受信を検証する。
 * GCPへの実通信は行わない。プロダクションコードは変更しない。
 * ポート 0（OS割り当て）を使用（衝突回避）。
 */

import type { AddressInfo } from "net";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import { startServer } from "../../server/index";

// ---------------------------------------------------------------------------
// ヘルパー: 有効な start メッセージ
// ---------------------------------------------------------------------------
const validStart = {
  type: "start",
  sourceLanguage: "ja-JP",
  targetLanguage: "en-US",
  enableTts: false,
  enableInterimTranslation: false,
  chunkMs: 250,
  silenceMs: 60000, // テスト中に無音タイマーが発火しないよう大きめに
  maxChars: 80,
  maxSeconds: 600,  // テスト中に最大時間タイマーが発火しないよう大きめに
};

// ---------------------------------------------------------------------------
// ヘルパー: サーバーが listening 状態になるまで待つ
// ---------------------------------------------------------------------------
function waitForListening(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (wss.address()) {
      // 既に listening 中
      resolve();
      return;
    }
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
}

// ---------------------------------------------------------------------------
// ヘルパー: WS接続して open イベントを待つ
// ---------------------------------------------------------------------------
function connectWs(url: string, timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WebSocket connection to ${url} timed out`));
    }, timeoutMs);

    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// ヘルパー: WS接続して close コードを待つ（接続が即拒否される場合用）
// ---------------------------------------------------------------------------
function connectAndGetCloseCode(url: string, timeoutMs = 5000): Promise<{ opened: boolean; closeCode: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let opened = false;

    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ opened, closeCode: -1 });
    }, timeoutMs);

    ws.on("open", () => {
      opened = true;
    });

    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve({ opened, closeCode: code });
    });

    ws.on("error", () => {
      // エラーは無視（close イベントで判定）
    });
  });
}

// ---------------------------------------------------------------------------
// ヘルパー: 送信して次のメッセージを待つ
// ---------------------------------------------------------------------------
function sendAndWaitMessage(
  ws: WebSocket,
  payload: object,
  timeoutMs = 5000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for message from server"));
    }, timeoutMs);

    ws.once("message", (raw) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(raw.toString()));
      } catch {
        reject(new Error(`Failed to parse server message: ${raw}`));
      }
    });

    ws.send(JSON.stringify(payload));
  });
}

// ---------------------------------------------------------------------------
// ヘルパー: 接続が維持されているか確認
// ---------------------------------------------------------------------------
function isConnectionAlive(ws: WebSocket): boolean {
  return ws.readyState === WebSocket.OPEN;
}

// ---------------------------------------------------------------------------
// テストスイート
// ---------------------------------------------------------------------------
describe("WebSocketサーバー基盤 結合テスト (.3)", () => {
  let wss: WebSocketServer;
  let port: number;
  let wsUrl: string;

  beforeAll(async () => {
    // ポート 0 でサーバーを起動（OS が空きポートを割り当てる）
    wss = startServer(0);
    await waitForListening(wss);
    port = (wss.address() as AddressInfo).port;
    wsUrl = `ws://localhost:${port}/ws`;
  }, 10000);

  afterAll(async () => {
    // サーバーをクローズ（open handleの終了を待つ）
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  // -------------------------------------------------------------------------
  // ケース1: /ws パスへ正常接続
  // -------------------------------------------------------------------------
  test(
    "ケース1: ws://localhost:{PORT}/ws へ接続できること (open イベント)",
    async () => {
      // Act
      const ws = await connectWs(wsUrl);

      // Assert
      expect(ws.readyState).toBe(WebSocket.OPEN);

      // Cleanup
      ws.close();
      await new Promise<void>((r) => ws.once("close", r));
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース2: /ws 以外のパスへ接続すると拒否される
  // -------------------------------------------------------------------------
  test(
    "ケース2: /foo など /ws 以外のパスへ接続すると拒否される（open しないか即 close）",
    async () => {
      // Arrange: /foo というパスに接続試みる
      const invalidUrl = `ws://localhost:${port}/foo`;

      // Act
      const result = await connectAndGetCloseCode(invalidUrl);

      // Assert: 接続が拒否される（open 後即 close か、そもそも open しない）
      if (result.opened) {
        // 接続後即座にサーバーが close するケース (code 1008 = Policy Violation)
        expect(result.closeCode).toBe(1008);
      } else {
        // 接続自体が拒否されるケース（upgrade 拒否などで close code が返る）
        expect(result.closeCode).not.toBe(-1);
      }
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース3: start 前に audio を送ると error(fatal:false)・接続維持
  // -------------------------------------------------------------------------
  test(
    "ケース3: start 前に audio を送ると type:\"error\", fatal:false が返り接続は維持される",
    async () => {
      // Arrange
      const ws = await connectWs(wsUrl);

      try {
        // Act: start 前に audio メッセージを送信
        const audioMsg = { type: "audio", data: "SGVsbG8=" }; // "Hello" in base64
        const response = await sendAndWaitMessage(ws, audioMsg);

        // Assert: error メッセージが返る
        expect(response.type).toBe("error");
        expect(response.fatal).toBe(false);

        // Assert: 接続が維持されている
        expect(isConnectionAlive(ws)).toBe(true);
      } finally {
        ws.close();
        await new Promise<void>((r) => ws.once("close", r));
      }
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース4: start 前に commit を送ると error(fatal:false)・接続維持
  // -------------------------------------------------------------------------
  test(
    "ケース4: start 前に commit を送ると type:\"error\", fatal:false が返り接続は維持される",
    async () => {
      // Arrange
      const ws = await connectWs(wsUrl);

      try {
        // Act: start 前に commit メッセージを送信
        const response = await sendAndWaitMessage(ws, { type: "commit" });

        // Assert: error メッセージが返る
        expect(response.type).toBe("error");
        expect(response.fatal).toBe(false);

        // Assert: 接続が維持されている
        expect(isConnectionAlive(ws)).toBe(true);
      } finally {
        ws.close();
        await new Promise<void>((r) => ws.once("close", r));
      }
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース4b: start 前に stop を送ると error(fatal:false)・接続維持
  // -------------------------------------------------------------------------
  test(
    "ケース4b: start 前に stop を送ると type:\"error\", fatal:false が返り接続は維持される",
    async () => {
      // Arrange
      const ws = await connectWs(wsUrl);

      try {
        // Act: start 前に stop メッセージを送信
        const response = await sendAndWaitMessage(ws, { type: "stop" });

        // Assert: error メッセージが返る
        expect(response.type).toBe("error");
        expect(response.fatal).toBe(false);

        // Assert: 接続が維持されている
        expect(isConnectionAlive(ws)).toBe(true);
      } finally {
        ws.close();
        await new Promise<void>((r) => ws.once("close", r));
      }
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース5: 不正な JSON を送ると error(fatal:false)・接続維持
  // -------------------------------------------------------------------------
  test(
    "ケース5: 不正な JSON（パース不可の文字列）を送ると type:\"error\", fatal:false が返り接続は維持される",
    async () => {
      // Arrange
      const ws = await connectWs(wsUrl);

      try {
        // Act: パース不可な文字列を送信
        const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timed out")), 5000);

          ws.once("message", (raw) => {
            clearTimeout(timer);
            try {
              resolve(JSON.parse(raw.toString()));
            } catch {
              reject(new Error("Failed to parse server message"));
            }
          });

          // 不正なJSON文字列を直接送信
          ws.send("this is not json {{{");
        });

        // Assert: error メッセージが返る
        expect(response.type).toBe("error");
        expect(response.fatal).toBe(false);

        // Assert: 接続が維持されている
        expect(isConnectionAlive(ws)).toBe(true);
      } finally {
        ws.close();
        await new Promise<void>((r) => ws.once("close", r));
      }
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース6a: 未知の type を送ると error(fatal:false)・接続維持
  // -------------------------------------------------------------------------
  test(
    "ケース6a: スキーマ不一致（未知の type）を送ると type:\"error\", fatal:false が返り接続は維持される",
    async () => {
      // Arrange
      const ws = await connectWs(wsUrl);

      try {
        // Act: 未知の type のメッセージを送信
        const response = await sendAndWaitMessage(ws, { type: "unknown_type", data: "test" });

        // Assert: error メッセージが返る
        expect(response.type).toBe("error");
        expect(response.fatal).toBe(false);

        // Assert: 接続が維持されている
        expect(isConnectionAlive(ws)).toBe(true);
      } finally {
        ws.close();
        await new Promise<void>((r) => ws.once("close", r));
      }
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース6b: 同一言語ペアの start を送ると error(fatal:false)・接続維持
  // -------------------------------------------------------------------------
  test(
    "ケース6b: スキーマ不一致（同一言語ペアの start）を送ると type:\"error\", fatal:false が返り接続は維持される",
    async () => {
      // Arrange
      const ws = await connectWs(wsUrl);

      try {
        // Act: sourceLanguage === targetLanguage の start を送信（スキーマ違反）
        const invalidStart = {
          ...validStart,
          sourceLanguage: "ja-JP",
          targetLanguage: "ja-JP",
        };
        const response = await sendAndWaitMessage(ws, invalidStart);

        // Assert: error メッセージが返る
        expect(response.type).toBe("error");
        expect(response.fatal).toBe(false);

        // Assert: 接続が維持されている
        expect(isConnectionAlive(ws)).toBe(true);
      } finally {
        ws.close();
        await new Promise<void>((r) => ws.once("close", r));
      }
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース7: 正しい start を送るとセッションが初期化される
  // -------------------------------------------------------------------------
  test(
    "ケース7: 正しい start を送るとセッションが初期化され、audio を送っても \"未初期化\" エラーが返らない",
    async () => {
      // Arrange
      const ws = await connectWs(wsUrl);

      try {
        // Act 1: 正しい start メッセージを送信
        // start は成功時にはメッセージを返さないため、
        // start 後に audio を送り、「未初期化」エラーが来ないことで間接的に確認する
        ws.send(JSON.stringify(validStart));

        // start 処理を待つ（少し待機）
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Act 2: start 後に audio を送信
        const audioMsg = { type: "audio", data: "SGVsbG8=" };

        // start 後の audio に対して「未初期化」エラーが来るかどうかを確認
        // タイムアウト内にメッセージが来なければ、エラーが来なかった（= 初期化成功）とみなす
        const errorReceived = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            // タイムアウト = エラーメッセージが来なかった = セッション初期化成功
            resolve(false);
          }, 1000);

          ws.once("message", (raw) => {
            clearTimeout(timer);
            try {
              const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
              if (
                msg.type === "error" &&
                typeof msg.message === "string" &&
                msg.message.toLowerCase().includes("not initialized")
              ) {
                resolve(true); // 未初期化エラーが来た
              } else {
                resolve(false); // その他のメッセージ（エラーではない）
              }
            } catch {
              resolve(false);
            }
          });

          ws.send(JSON.stringify(audioMsg));
        });

        // Assert: 「未初期化」エラーが来ないこと（= start が成功してセッションが初期化された）
        expect(errorReceived).toBe(false);

        // Assert: 接続が維持されている
        expect(isConnectionAlive(ws)).toBe(true);
      } finally {
        ws.close();
        await new Promise<void>((r) => ws.once("close", r));
      }
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース8: close 後もサーバーが新規接続を受け付けられる
  // -------------------------------------------------------------------------
  test(
    "ケース8: クライアントが close してもサーバーがクラッシュせず新規接続を引き続き受け付けられる",
    async () => {
      // Arrange: 1つ目の接続を確立して close する
      const ws1 = await connectWs(wsUrl);

      await new Promise<void>((resolve) => {
        ws1.on("close", () => resolve());
        ws1.close(1000, "test disconnect");
      });

      // 少し待ってサーバーの close 処理が完了するのを確認
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Act: 2つ目の接続を試みる（サーバーが新規接続を受け付けられるか）
      const ws2 = await connectWs(wsUrl);

      // Assert: 2つ目の接続が成功していること
      expect(ws2.readyState).toBe(WebSocket.OPEN);

      // Cleanup
      ws2.close();
      await new Promise<void>((r) => ws2.once("close", r));
    },
    10000
  );

  // -------------------------------------------------------------------------
  // ケース9（セキュリティ）: エラーメッセージに内部スタックトレースが含まれない
  // -------------------------------------------------------------------------
  test(
    "ケース9（セキュリティ）: エラーメッセージに内部スタックトレース情報（\"at \", \"Error:\", \"node_modules\", ファイルパス）が含まれないこと",
    async () => {
      // Arrange
      const ws = await connectWs(wsUrl);

      try {
        // Act: 不正な JSON を送信してエラーレスポンスを取得
        const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timed out")), 5000);

          ws.once("message", (raw) => {
            clearTimeout(timer);
            try {
              resolve(JSON.parse(raw.toString()));
            } catch {
              reject(new Error("Failed to parse server message"));
            }
          });

          ws.send("invalid json !!!");
        });

        // Assert: error メッセージが返る
        expect(response.type).toBe("error");

        // Assert: message フィールドにスタックトレースが含まれない
        const message = String(response.message ?? "");
        expect(message).not.toMatch(/at\s+\w+/); // "at functionName" パターン（スタックトレース）
        expect(message).not.toContain("Error:");
        expect(message).not.toContain("node_modules");
        expect(message).not.toContain("server/");

        // Assert: 必要最低限のフィールドのみ含む
        expect(response).toHaveProperty("type");
        expect(response).toHaveProperty("message");
        expect(response).toHaveProperty("fatal");
      } finally {
        ws.close();
        await new Promise<void>((r) => ws.once("close", r));
      }
    },
    10000
  );
});
