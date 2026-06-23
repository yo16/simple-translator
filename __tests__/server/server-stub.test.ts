/**
 * WebSocketサーバースタブ 起動・接続テスト（結合テスト）
 *
 * server/index.ts を子プロセスで起動し、ws クライアントで接続できることを検証する。
 * GCPへの実通信は行わない（server/index.ts はスタブのみ）。
 * プロダクションコードは変更しない。
 */
import * as cp from 'child_process';
import * as path from 'path';
import * as net from 'net';
import WebSocket from 'ws';

const ROOT = path.resolve(__dirname, '..', '..');
const WS_PORT = 3199;
const WS_URL = `ws://localhost:${WS_PORT}/ws`;
const SERVER_FILE = path.join(ROOT, 'server', 'index.ts');

// node --import tsx/esm でTypeScriptを直接実行する
// .cmd spawnのセキュリティ警告を避けるため、Node.jsバイナリを直接使用する
const NODE_BIN = process.execPath;

/** ポートが LISTEN 状態になるまで最大 timeoutMs 待つ */
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function tryConnect() {
      const socket = new net.Socket();
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Port ${port} did not open within ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 100);
        }
      });
      socket.connect(port, '127.0.0.1');
    }

    tryConnect();
  });
}

/** 子プロセスとその子孫を強制終了する */
function killProcess(proc: cp.ChildProcess): void {
  if (proc.killed) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      // Windows ではツリー全体を kill
      cp.spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)]);
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    // 既に終了している場合は無視
  }
}

describe('WebSocketサーバースタブ 起動・接続テスト', () => {
  let serverProcess: cp.ChildProcess | null = null;

  beforeAll(async () => {
    // Arrange: node --import tsx/esm で server/index.ts を子プロセス起動
    serverProcess = cp.spawn(
      NODE_BIN,
      ['--import', 'tsx/esm', SERVER_FILE],
      {
        env: {
          ...process.env,
          WS_PORT: String(WS_PORT),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    serverProcess.on('error', (err) => {
      console.error('[server process error]', err);
    });

    // ポートが開くまで最大 12 秒待つ
    await waitForPort(WS_PORT, 12000);
  }, 15000);

  afterAll((done) => {
    if (serverProcess) {
      killProcess(serverProcess);
    }
    // ポート解放を少し待つ
    setTimeout(done, 500);
  });

  test(
    'WS クライアントが ws://localhost:{PORT}/ws に接続できること',
    async () => {
      // Act: WebSocket 接続を試みる
      const connected = await new Promise<boolean>((resolve, reject) => {
        const client = new WebSocket(WS_URL);
        const timer = setTimeout(() => {
          client.terminate();
          reject(new Error('WebSocket connection timed out'));
        }, 5000);

        client.on('open', () => {
          clearTimeout(timer);
          client.close();
          resolve(true);
        });

        client.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      // Assert
      expect(connected).toBe(true);
    },
    10000
  );

  test(
    'サーバーが複数クライアントの接続を同時に受け入れること',
    async () => {
      // Act: 2 つの WebSocket クライアントを同時に接続
      const results = await Promise.all([
        new Promise<boolean>((resolve, reject) => {
          const client = new WebSocket(WS_URL);
          const timer = setTimeout(() => {
            client.terminate();
            reject(new Error('Client 1 connection timed out'));
          }, 5000);
          client.on('open', () => {
            clearTimeout(timer);
            client.close();
            resolve(true);
          });
          client.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        }),
        new Promise<boolean>((resolve, reject) => {
          const client = new WebSocket(WS_URL);
          const timer = setTimeout(() => {
            client.terminate();
            reject(new Error('Client 2 connection timed out'));
          }, 5000);
          client.on('open', () => {
            clearTimeout(timer);
            client.close();
            resolve(true);
          });
          client.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        }),
      ]);

      // Assert: 両方の接続が成功していること
      expect(results[0]).toBe(true);
      expect(results[1]).toBe(true);
    },
    10000
  );

  test(
    '接続後にクライアントが close すると切断できること',
    async () => {
      // Act: 接続してから明示的に close
      const result = await new Promise<string>((resolve, reject) => {
        const client = new WebSocket(WS_URL);
        const timer = setTimeout(() => {
          client.terminate();
          reject(new Error('Connection timed out'));
        }, 5000);

        client.on('open', () => {
          // 接続確立後に close を送る
          client.close(1000, 'test done');
        });

        client.on('close', (code) => {
          clearTimeout(timer);
          resolve(`closed:${code}`);
        });

        client.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      // Assert: 正常クローズコード 1000 で閉じられること
      expect(result).toBe('closed:1000');
    },
    10000
  );
});
