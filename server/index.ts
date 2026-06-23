import { WebSocketServer, WebSocket } from "ws";

const WS_PORT = parseInt(process.env.WS_PORT ?? "3001", 10);

const wss = new WebSocketServer({ port: WS_PORT, path: "/ws" });

wss.on("listening", () => {
  console.log(`[WS Server] Listening on ws://localhost:${WS_PORT}/ws`);
});

wss.on("connection", (ws: WebSocket) => {
  console.log("[WS Server] Client connected");

  ws.on("close", () => {
    console.log("[WS Server] Client disconnected");
  });
});

// NOTE: GCP integration (Speech-to-Text, Translation, Text-to-Speech) will be
// implemented in task .3 (server-design). This stub only starts the WS server.
