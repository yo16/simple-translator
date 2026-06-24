/**
 * README.md 整合性検証テスト
 *
 * README の記載内容が実ファイル（package.json / .env.local.example）と
 * 一致しているかを静的に検証する。
 * 将来 scripts や env 変数が変わって README が古くなる（ドキュメント drift）
 * のを自動検出するためのテスト。
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

// ファイルを一度だけ読み込む
let readmeContent: string;
let pkg: { scripts: Record<string, string>; [key: string]: unknown };
let envExampleContent: string;

beforeAll(() => {
  readmeContent = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
  pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')
  ) as typeof pkg;
  envExampleContent = fs.readFileSync(
    path.join(ROOT, '.env.local.example'),
    'utf-8'
  );
});

// ---------------------------------------------------------------------------
// ヘルパー: .env.local.example から変数名リストを動的にパースする
// ---------------------------------------------------------------------------
function parseEnvVarNames(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim())
    .filter((name) => name.length > 0);
}

// ---------------------------------------------------------------------------
// ヘルパー: README から `npm run <name>` および `npm test` を抽出する
// ---------------------------------------------------------------------------
function extractNpmScriptReferences(content: string): string[] {
  const refs = new Set<string>();

  // `npm run <name>` の形式を抽出
  const runPattern = /`npm run ([a-z:]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = runPattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  // テーブル内の `npm run <name>` も抽出（バッククォートなし）
  const tablePattern = /\|\s*`npm run ([a-z:]+)`/g;
  while ((match = tablePattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  // `npm test` は "test" スクリプトへの参照として扱う
  if (/`npm test`/.test(content)) {
    refs.add('test');
  }

  return Array.from(refs);
}

// ===========================================================================
// 1. README.md が存在し空でない
// ===========================================================================
describe('README.md の存在と内容', () => {
  test('README.md ファイルが存在する', () => {
    const readmePath = path.join(ROOT, 'README.md');
    expect(fs.existsSync(readmePath)).toBe(true);
  });

  test('README.md が空でない（1000文字以上）', () => {
    expect(readmeContent.length).toBeGreaterThan(1000);
  });
});

// ===========================================================================
// 2. npm スクリプトの整合
// ===========================================================================
describe('npm スクリプトの整合性', () => {
  test('README に登場する npm run <name> は package.json scripts に実在する', () => {
    const refs = extractNpmScriptReferences(readmeContent);
    // 少なくともいくつかのスクリプト参照が抽出されていることを確認
    expect(refs.length).toBeGreaterThan(0);

    for (const scriptName of refs) {
      expect(pkg.scripts[scriptName]).toBeDefined();
    }
  });

  test('README に `npm run dev` の記載がある', () => {
    expect(readmeContent).toMatch(/`npm run dev`/);
  });

  test('README に `npm test` の記載がある', () => {
    expect(readmeContent).toMatch(/`npm test`/);
  });

  test('README に `npm run test:e2e` の記載がある', () => {
    expect(readmeContent).toMatch(/`npm run test:e2e`/);
  });

  test('dev スクリプトが package.json に存在する', () => {
    expect(pkg.scripts['dev']).toBeDefined();
  });

  test('test スクリプトが package.json に存在する', () => {
    expect(pkg.scripts['test']).toBeDefined();
  });

  test('test:e2e スクリプトが package.json に存在する', () => {
    expect(pkg.scripts['test:e2e']).toBeDefined();
  });
});

// ===========================================================================
// 3. 環境変数の整合
// ===========================================================================
describe('環境変数の整合性', () => {
  test('.env.local.example から環境変数名リストを動的にパースできる', () => {
    const varNames = parseEnvVarNames(envExampleContent);
    expect(varNames.length).toBeGreaterThan(0);
  });

  test('.env.local.example の全変数名が README に記載されている', () => {
    const varNames = parseEnvVarNames(envExampleContent);
    for (const varName of varNames) {
      expect(readmeContent).toContain(varName);
    }
  });

  test('README に記載された環境変数名が .env.local.example に実在する', () => {
    const varNames = parseEnvVarNames(envExampleContent);
    // README の環境変数テーブルから変数名を抽出（| `VAR_NAME` | の形式）
    const readmeVarPattern = /\|\s*`([A-Z_][A-Z0-9_]*)`\s*\|/g;
    let match: RegExpExecArray | null;
    const referencedVars: string[] = [];

    while ((match = readmeVarPattern.exec(readmeContent)) !== null) {
      const candidate = match[1];
      // 大文字・アンダースコアのみの変数名パターンを対象とする
      if (/^[A-Z][A-Z0-9_]+$/.test(candidate)) {
        referencedVars.push(candidate);
      }
    }

    // 少なくともいくつかの環境変数が抽出できていること
    expect(referencedVars.length).toBeGreaterThan(0);

    for (const varName of referencedVars) {
      expect(varNames).toContain(varName);
    }
  });

  // 個別変数の存在確認（必須変数）
  const requiredVarNames = [
    'GOOGLE_CLOUD_PROJECT',
    'WS_PORT',
    'DEFAULT_SOURCE_LANGUAGE',
    'DEFAULT_TARGET_LANGUAGE',
    'ENABLE_TTS',
    'ENABLE_INTERIM_TRANSLATION',
    'DEFAULT_CHUNK_MS',
    'DEFAULT_SILENCE_MS',
    'DEFAULT_MAX_CHARS',
    'DEFAULT_MAX_SECONDS',
    'NEXT_PUBLIC_WS_URL',
  ];

  test.each(requiredVarNames)(
    '環境変数 "%s" が README に記載されている',
    (varName) => {
      expect(readmeContent).toContain(varName);
    }
  );

  test.each(requiredVarNames)(
    '環境変数 "%s" が .env.local.example に存在する',
    (varName) => {
      const varNames = parseEnvVarNames(envExampleContent);
      expect(varNames).toContain(varName);
    }
  );
});

// ===========================================================================
// 4. GCP 3サービスの限定
// ===========================================================================
describe('GCP サービスの記載制限', () => {
  test('README に "Speech-to-Text" が記載されている', () => {
    expect(readmeContent).toContain('Speech-to-Text');
  });

  test('README に "Translation" が記載されている', () => {
    expect(readmeContent).toContain('Translation');
  });

  test('README に "Text-to-Speech" が記載されている', () => {
    expect(readmeContent).toContain('Text-to-Speech');
  });

  test('README に "Media Translation" が記載されていない（使用禁止サービス）', () => {
    expect(readmeContent).not.toContain('Media Translation');
  });
});

// ===========================================================================
// 5. 必須手順の存在
// ===========================================================================
describe('必須セットアップ手順の記載', () => {
  test('README に "gcloud auth application-default login" が記載されている', () => {
    expect(readmeContent).toContain('gcloud auth application-default login');
  });

  test('README に "npm install" が記載されている', () => {
    expect(readmeContent).toContain('npm install');
  });

  test('README に "http://localhost:3000" が記載されている', () => {
    expect(readmeContent).toContain('http://localhost:3000');
  });
});

// ===========================================================================
// 6. GCP認証情報をクライアントに置かない注意の存在
// ===========================================================================
describe('GCP認証情報のクライアント配置禁止に関する記載', () => {
  test('README に NEXT_PUBLIC_ プレフィックスの警告が記載されている', () => {
    expect(readmeContent).toContain('NEXT_PUBLIC_');
  });

  test('README にブラウザ側への認証情報配置禁止の記載がある', () => {
    // "ブラウザ側" または "クライアント" に関連する禁止事項の記載
    const hasBrowserSideWarning =
      readmeContent.includes('ブラウザ側') ||
      readmeContent.includes('クライアント');
    expect(hasBrowserSideWarning).toBe(true);
  });

  test('README に GCP 認証情報をブラウザに渡さない旨の記載がある', () => {
    // "認証情報" と "ブラウザ" が README 内に共存していること
    expect(readmeContent).toContain('認証情報');
    const hasBrowserMention =
      readmeContent.includes('ブラウザ') ||
      readmeContent.includes('browser');
    expect(hasBrowserMention).toBe(true);
  });
});

// ===========================================================================
// 7. ポート整合性
// ===========================================================================
describe('ポート番号の整合性', () => {
  test('README に WebSocket URL "ws://localhost:3001/ws" が記載されている', () => {
    expect(readmeContent).toContain('ws://localhost:3001/ws');
  });

  test('.env.local.example の WS_PORT が 3001 である', () => {
    const wsPortLine = envExampleContent
      .split('\n')
      .find((line) => line.startsWith('WS_PORT='));
    expect(wsPortLine).toBeDefined();
    expect(wsPortLine).toBe('WS_PORT=3001');
  });

  test('.env.local.example の NEXT_PUBLIC_WS_URL がポート 3001 を含む', () => {
    const wsUrlLine = envExampleContent
      .split('\n')
      .find((line) => line.startsWith('NEXT_PUBLIC_WS_URL='));
    expect(wsUrlLine).toBeDefined();
    expect(wsUrlLine).toContain('3001');
  });

  test('README の WS_PORT 既定値 "3001" と .env.local.example の WS_PORT が一致する', () => {
    // README のテーブルから WS_PORT の既定値を抽出
    // 形式: | `WS_PORT` | `3001` | ...
    const wsPortMatch = readmeContent.match(
      /WS_PORT.*?\|\s*`?(\d+)`?\s*\|/
    );
    expect(wsPortMatch).not.toBeNull();
    const readmePort = wsPortMatch![1];

    const wsPortLine = envExampleContent
      .split('\n')
      .find((line) => line.startsWith('WS_PORT='));
    const envPort = wsPortLine?.split('=')[1]?.trim();

    expect(readmePort).toBe(envPort);
  });

  test('README の NEXT_PUBLIC_WS_URL がポート 3001 を参照している', () => {
    const wsUrlMatch = readmeContent.match(
      /NEXT_PUBLIC_WS_URL.*?ws:\/\/localhost:(\d+)\/ws/
    );
    expect(wsUrlMatch).not.toBeNull();
    expect(wsUrlMatch![1]).toBe('3001');
  });
});
