/**
 * package.json 設定バリデーションテスト
 *
 * プロジェクトの初期セットアップとして必須となるスクリプト・依存関係の存在を検証する。
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

describe('package.json 設定バリデーション', () => {
  let pkg: Record<string, unknown>;

  beforeAll(() => {
    const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8');
    pkg = JSON.parse(raw) as Record<string, unknown>;
  });

  // -----------------------------------------------------------------------
  // scripts
  // -----------------------------------------------------------------------
  describe('必須 scripts の存在', () => {
    const requiredScripts = [
      'dev',
      'dev:web',
      'dev:ws',
      'build',
      'lint',
      'typecheck',
      'typecheck:server',
      'test',
      'test:e2e',
    ];

    test.each(requiredScripts)('scripts["%s"] が定義されている', (scriptName) => {
      const scripts = pkg.scripts as Record<string, unknown>;
      expect(scripts).toBeDefined();
      expect(scripts[scriptName]).toBeDefined();
      expect(typeof scripts[scriptName]).toBe('string');
    });
  });

  // -----------------------------------------------------------------------
  // dependencies
  // -----------------------------------------------------------------------
  describe('必須 dependencies の存在', () => {
    const requiredDependencies = [
      'next',
      'react',
      'react-dom',
      'ws',
      'zod',
      '@google-cloud/speech',
      '@google-cloud/translate',
      '@google-cloud/text-to-speech',
    ];

    test.each(requiredDependencies)('dependencies["%s"] が定義されている', (depName) => {
      const dependencies = pkg.dependencies as Record<string, unknown>;
      expect(dependencies).toBeDefined();
      expect(dependencies[depName]).toBeDefined();
      expect(typeof dependencies[depName]).toBe('string');
    });
  });

  // -----------------------------------------------------------------------
  // devDependencies
  // -----------------------------------------------------------------------
  describe('主要 devDependencies の存在', () => {
    const requiredDevDependencies = [
      'typescript',
      'tsx',
      'concurrently',
      'jest',
      'ts-jest',
      '@playwright/test',
    ];

    test.each(requiredDevDependencies)('devDependencies["%s"] が定義されている', (depName) => {
      const devDependencies = pkg.devDependencies as Record<string, unknown>;
      expect(devDependencies).toBeDefined();
      expect(devDependencies[depName]).toBeDefined();
      expect(typeof devDependencies[depName]).toBe('string');
    });
  });

  // -----------------------------------------------------------------------
  // scripts の内容チェック
  // -----------------------------------------------------------------------
  describe('scripts の内容検証', () => {
    let scripts: Record<string, string>;

    beforeAll(() => {
      scripts = pkg.scripts as Record<string, string>;
    });

    test('dev スクリプトは dev:web と dev:ws を並列実行する', () => {
      expect(scripts['dev']).toContain('dev:web');
      expect(scripts['dev']).toContain('dev:ws');
    });

    test('dev:ws スクリプトは tsx で server/index.ts を起動する', () => {
      expect(scripts['dev:ws']).toContain('tsx');
      expect(scripts['dev:ws']).toContain('server/index.ts');
    });

    test('test:e2e スクリプトは playwright test を実行する', () => {
      expect(scripts['test:e2e']).toContain('playwright');
    });
  });
});
