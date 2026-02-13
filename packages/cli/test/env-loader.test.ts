import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadRuntimeEnv } from '../src/services/env.js';

describe('loadRuntimeEnv', () => {
  it('시스템 env를 유지하고 --env-file > .env.local > .env 순서로 값을 채운다', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-cli-env-'));

    try {
      await writeFile(
        path.join(rootDir, '.env'),
        ['SHARED=from-dotenv', 'DOT_ENV_ONLY=dot-env', 'QUOTED="hello world"'].join('\n'),
        'utf8',
      );
      await writeFile(
        path.join(rootDir, '.env.local'),
        ['SHARED=from-local', 'LOCAL_ONLY=dot-env-local'].join('\n'),
        'utf8',
      );
      await writeFile(
        path.join(rootDir, 'custom.env'),
        ['SHARED=from-custom', 'CUSTOM_ONLY=custom-file'].join('\n'),
        'utf8',
      );

      const env = await loadRuntimeEnv(
        {
          SHARED: 'from-system',
          SYSTEM_ONLY: 'system',
        },
        {
          projectRoot: rootDir,
          envFile: './custom.env',
        },
      );

      expect(env.SHARED).toBe('from-system');
      expect(env.SYSTEM_ONLY).toBe('system');
      expect(env.CUSTOM_ONLY).toBe('custom-file');
      expect(env.LOCAL_ONLY).toBe('dot-env-local');
      expect(env.DOT_ENV_ONLY).toBe('dot-env');
      expect(env.QUOTED).toBe('hello world');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('--env-file이 지정됐는데 파일이 없으면 오류를 반환한다', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-cli-env-'));

    try {
      await expect(
        loadRuntimeEnv(
          {},
          {
            projectRoot: rootDir,
            envFile: 'missing.env',
          },
        ),
      ).rejects.toThrow(/--env-file로 지정한 파일을 찾을 수 없습니다/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
