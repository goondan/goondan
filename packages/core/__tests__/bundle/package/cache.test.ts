/**
 * 패키지 캐시 테스트
 * @see /docs/specs/bundle_package.md - 5. 다운로드 및 캐시 규칙
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PackageCache,
  createPackageCache,
  getCacheDir,
  getPackageCachePath,
  cleanPackageCache,
} from '../../../src/bundle/package/cache.js';
import type { PackageRef } from '../../../src/bundle/package/types.js';

describe('Package Cache', () => {
  let tempDir: string;
  let cache: PackageCache;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-cache-test-'));
    cache = createPackageCache({ cacheDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getCacheDir', () => {
    it('기본 캐시 디렉토리를 반환해야 한다', () => {
      const defaultDir = getCacheDir();
      expect(defaultDir).toContain('packages');
    });

    it('stateRootDir이 주어지면 해당 경로 기준으로 반환해야 한다', () => {
      const dir = getCacheDir('/custom/state');
      expect(dir).toBe('/custom/state/packages');
    });
  });

  describe('getPackageCachePath', () => {
    it('레지스트리 패키지 경로를 생성해야 한다', () => {
      const ref: PackageRef = {
        type: 'registry',
        url: 'https://registry.goondan.io',
        scope: '@goondan',
        name: 'base',
        version: '1.0.0',
      };

      const cachePath = getPackageCachePath(tempDir, ref);
      expect(cachePath).toBe(path.join(tempDir, '@goondan', 'base', '1.0.0'));
    });

    it('scope 없는 패키지 경로를 생성해야 한다', () => {
      const ref: PackageRef = {
        type: 'registry',
        url: 'https://registry.goondan.io',
        name: 'simple-pkg',
        version: '2.0.0',
      };

      const cachePath = getPackageCachePath(tempDir, ref);
      expect(cachePath).toBe(path.join(tempDir, 'simple-pkg', '2.0.0'));
    });

    it('git 패키지 경로를 생성해야 한다 (URL hash 기반)', () => {
      const ref: PackageRef = {
        type: 'git',
        url: 'https://github.com/goondan/tools.git',
        ref: 'v1.0.0',
      };

      const cachePath = getPackageCachePath(tempDir, ref);
      // git 캐시 경로는 URL 해시와 ref를 포함
      expect(cachePath).toContain('git');
      expect(cachePath).toContain('goondan');
      expect(cachePath).toContain('tools');
    });

    it('로컬 참조는 원본 경로를 그대로 반환해야 한다', () => {
      const ref: PackageRef = {
        type: 'local',
        url: '/absolute/path/to/package',
      };

      const cachePath = getPackageCachePath(tempDir, ref);
      expect(cachePath).toBe('/absolute/path/to/package');
    });
  });

  describe('PackageCache', () => {
    describe('has', () => {
      it('캐시에 없는 패키지에 대해 false를 반환해야 한다', async () => {
        const ref: PackageRef = {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'base',
          version: '1.0.0',
        };

        const exists = await cache.has(ref);
        expect(exists).toBe(false);
      });

      it('캐시에 있는 패키지에 대해 true를 반환해야 한다', async () => {
        const ref: PackageRef = {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'base',
          version: '1.0.0',
        };

        // 캐시 디렉토리 생성
        const cachePath = getPackageCachePath(tempDir, ref);
        await fs.mkdir(cachePath, { recursive: true });
        await fs.writeFile(path.join(cachePath, 'goondan.yaml'), 'test');

        const exists = await cache.has(ref);
        expect(exists).toBe(true);
      });
    });

    describe('get', () => {
      it('캐시된 패키지 경로를 반환해야 한다', async () => {
        const ref: PackageRef = {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'base',
          version: '1.0.0',
        };

        const cachePath = getPackageCachePath(tempDir, ref);
        await fs.mkdir(cachePath, { recursive: true });
        await fs.writeFile(path.join(cachePath, 'goondan.yaml'), 'test');

        const result = await cache.get(ref);
        expect(result).toBe(cachePath);
      });

      it('캐시에 없으면 null을 반환해야 한다', async () => {
        const ref: PackageRef = {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'nonexistent',
          version: '1.0.0',
        };

        const result = await cache.get(ref);
        expect(result).toBeNull();
      });
    });

    describe('set', () => {
      it('패키지를 캐시에 저장해야 한다', async () => {
        const ref: PackageRef = {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'new-pkg',
          version: '1.0.0',
        };

        // 소스 디렉토리 생성
        const sourceDir = path.join(tempDir, 'source');
        await fs.mkdir(sourceDir, { recursive: true });
        await fs.writeFile(path.join(sourceDir, 'goondan.yaml'), 'content');

        await cache.set(ref, sourceDir);

        const exists = await cache.has(ref);
        expect(exists).toBe(true);
      });
    });

    describe('delete', () => {
      it('캐시된 패키지를 삭제해야 한다', async () => {
        const ref: PackageRef = {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'to-delete',
          version: '1.0.0',
        };

        const cachePath = getPackageCachePath(tempDir, ref);
        await fs.mkdir(cachePath, { recursive: true });
        await fs.writeFile(path.join(cachePath, 'goondan.yaml'), 'test');

        await cache.delete(ref);

        const exists = await cache.has(ref);
        expect(exists).toBe(false);
      });

      it('존재하지 않는 패키지 삭제 시 에러를 던지지 않아야 한다', async () => {
        const ref: PackageRef = {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'nonexistent',
          version: '1.0.0',
        };

        await expect(cache.delete(ref)).resolves.not.toThrow();
      });
    });

    describe('clear', () => {
      it('모든 캐시를 삭제해야 한다', async () => {
        // 여러 패키지 캐시 생성
        const refs: PackageRef[] = [
          { type: 'registry', url: 'https://registry.goondan.io', scope: '@goondan', name: 'pkg1', version: '1.0.0' },
          { type: 'registry', url: 'https://registry.goondan.io', scope: '@goondan', name: 'pkg2', version: '1.0.0' },
        ];

        for (const ref of refs) {
          const cachePath = getPackageCachePath(tempDir, ref);
          await fs.mkdir(cachePath, { recursive: true });
          await fs.writeFile(path.join(cachePath, 'goondan.yaml'), 'test');
        }

        await cache.clear();

        for (const ref of refs) {
          const exists = await cache.has(ref);
          expect(exists).toBe(false);
        }
      });
    });

    describe('getCacheDir', () => {
      it('캐시 디렉토리 경로를 반환해야 한다', () => {
        expect(cache.getCacheDir()).toBe(tempDir);
      });
    });
  });

  describe('cleanPackageCache', () => {
    it('지정된 시간보다 오래된 캐시를 삭제해야 한다', async () => {
      const ref: PackageRef = {
        type: 'registry',
        url: 'https://registry.goondan.io',
        scope: '@goondan',
        name: 'old-pkg',
        version: '1.0.0',
      };

      const cachePath = getPackageCachePath(tempDir, ref);
      await fs.mkdir(cachePath, { recursive: true });
      await fs.writeFile(path.join(cachePath, 'goondan.yaml'), 'test');

      // 파일 수정 시간을 과거로 설정
      const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30일 전
      await fs.utimes(cachePath, oldTime, oldTime);

      // 7일 이상 된 캐시 정리
      await cleanPackageCache(tempDir, 7 * 24 * 60 * 60 * 1000);

      const exists = await cache.has(ref);
      expect(exists).toBe(false);
    });
  });
});
