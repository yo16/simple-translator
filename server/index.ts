import { WebSocketServer, WebSocket, RawData } from "ws";
import { IncomingMessage } from "http";
import { clientMessageSchema } from "./schema";
import { Session } from "./session";

const WS_PORT = parseInt(process.env.WS_PORT ?? "3001", 10);
const WS_PATH = "/ws";

// ============================================================
// WebSocketServer の起動
// ============================================================

/**
 * WebSocketServer を起動して返す。
 * テスト容易性のため関数として切り出す（index.ts から export）。
 */
export function startServer(port: number = WS_PORT): WebSocketServer {
  const wss = new WebSocketServer({ port, path: WS_PATH });

  wss.on("listening", () => {
    console.log(`[WS Server] Listening on ws://localhost:${port}${WS_PATH}`);
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // /ws 以外のパスへの接続を拒否
    // ws ライブラリは path オプションでフィルタするが、
    // WebSocketServer の handleProtocols などの経由で異なるパスが来た場合の保険として
    // req.url も確認する。
    const url = req.url ?? "";
    // クエリ文字列を除いたパス部分を比較
    const pathname = url.split("?")[0];
    if (pathname !== WS_PATH) {
      console.warn(`[WS Server] Rejecting connection to unknown path: ${url}`);
      ws.close(1008, "Invalid path");
      return;
    }

    console.log("[WS Server] Client connected");

    const session = new Session(ws);

    ws.on("message", (rawData: RawData) => {
      let text: string;

      // バイナリフレームは受け付けない（音声は base64 JSON で送る設計）
      if (Buffer.isBuffer(rawData)) {
        text = rawData.toString("utf8");
      } else if (rawData instanceof ArrayBuffer) {
        text = Buffer.from(rawData).toString("utf8");
      } else {
        // Buffer[] の場合
        text = Buffer.concat(rawData as Buffer[]).toString("utf8");
      }

      // JSON パース
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        session.sendError("Invalid JSON message", false);
        return;
      }

      // zod バリデーション
      const result = clientMessageSchema.safeParse(parsed);
      if (!result.success) {
        const issue = result.error.issues[0];
        const userMessage = issue
          ? `Invalid message: ${issue.message}`
          : "Invalid message format";
        session.sendError(userMessage, false);
        return;
      }

      // 検証済みメッセージをセッションへ渡す
      try {
        session.handleMessage(result.data);
      } catch (err) {
        console.error("[WS Server] Unexpected error in session.handleMessage:", err);
        session.sendError("Internal server error", false);
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      console.log(`[WS Server] Client disconnected (code=${code}, reason=${reason.toString()})`);
      session.dispose();
    });

    ws.on("error", (err: Error) => {
      console.error("[WS Server] WebSocket error:", err.message);
      // エラー後 close イベントが発火するため、dispose は close イベントで行う
    });
  });

  wss.on("error", (err: Error) => {
    console.error("[WS Server] Server error:", err.message);
  });

  return wss;
}

// ============================================================
// エントリポイント（tsx server/index.ts で直接実行される場合）
// ============================================================

// このファイルが直接実行された場合のみサーバーを起動する（import 時は起動しない）
if (require.main === module) {
  startServer();
}
