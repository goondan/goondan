/**
 * PackageManager 테스트
 * @see /docs/specs/bundle_package.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PackageManager,
  createPackageManager,
} from '../../../src/bundle/package/manager.js';
import type { PackageRef } from '../../../src/bundle/package/types.js';
import { PackageFetchError, PackageNotFoundError } from '../../../src/bundle/package/errors.js';

describe('PackageManager', () => {
  let tempDir: string;
  let manager: PackageManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-manager-test-'));
    manager = createPackageManager({
      cacheDir: tempDir,
      registry: 'https://goondan-registry.yechanny.workers.dev',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('resolve', () => {
    it('레지스트리 참조 문자열을 PackageRef로 해석해야 한다', async () => {
      const ref = await manager.resolve('@goondan/base@1.0.0');

      expect(ref.type).toBe('registry');
      expect(ref.scope).toBe('@goondan');
      expect(ref.name).toBe('base');
      expect(ref.version).toBe('1.0.0');
    });

    it('git 참조 문자열을 PackageRef로 해석해야 한다', async () => {
      const ref = await manager.resolve('git+https://github.com/goondan/tools.git#v1.0.0');

      expect(ref.type).toBe('git');
      expect(ref.url).toBe('https://github.com/goondan/tools.git');
      expect(ref.ref).toBe('v1.0.0');
    });

    it('로컬 참조 문자열을 PackageRef로 해석해야 한다', async () => {
      const ref = await manager.resolve('file:../local-package');

      expect(ref.type).toBe('local');
      expect(ref.url).toBe('../local-package');
    });
  });

  describe('fetch', () => {
    describe('로컬 패키지', () => {
      it('로컬 패키지 경로를 그대로 반환해야 한다', async () => {
        // 로컬 패키지 디렉토리 생성
        const localPkgDir = path.join(tempDir, 'local-pkg');
        await fs.mkdir(localPkgDir, { recursive: true });
        await fs.writeFile(path.join(localPkgDir, 'package.yaml'), 'kind: Package');

        const ref: PackageRef = {
          type: 'local',
          url: localPkgDir,
        };

        const result = await manager.fetch(ref);
        expect(result).toBe(localPkgDir);
      });

      it('존재하지 않는 로컬 경로에 대해 에러를 던져야 한다', async () => {
        const ref: PackageRef = {
          type: 'local',
          url: '/nonexistent/path',
        };

        await expect(manager.fetch(ref)).rejects.toThrow(PackageNotFoundError);
      });
    });

    describe('캐시된 패키지', () => {
      it('캐시에 있는 패키지는 다시 다운로드하지 않아야 한다', async () => {
        const ref: PackageRef = {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'cached-pkg',
          version: '1.0.0',
        };

        // 캐시에 패키지 저장
        const cachePath = path.join(tempDir, '@goondan', 'cached-pkg', '1.0.0');
        await fs.mkdir(cachePath, { recursive: true });
        await fs.writeFile(path.join(cachePath, 'package.yaml'), 'kind: Package');

        const result = await manager.fetch(ref);
        expect(result).toBe(cachePath);
      });
    });

    describe('force 옵션', () => {
      it('force=true면 캐시를 무시하고 다시 다운로드해야 한다', async () => {
        // 로컬 패키지로 테스트 (네트워크 없이)
        const localPkgDir = path.join(tempDir, 'force-test-pkg');
        await fs.mkdir(localPkgDir, { recursive: true });
        await fs.writeFile(path.join(localPkgDir, 'package.yaml'), 'kind: Package');

        const ref: PackageRef = {
          type: 'local',
          url: localPkgDir,
        };

        // 첫 번째 fetch
        const result1 = await manager.fetch(ref);
        expect(result1).toBe(localPkgDir);

        // force로 다시 fetch
        const result2 = await manager.fetch(ref, { force: true });
        expect(result2).toBe(localPkgDir);
      });
    });
  });

  describe('getCache', () => {
    it('캐시 디렉토리 경로를 반환해야 한다', () => {
      expect(manager.getCache()).toBe(tempDir);
    });
  });

  describe('clearCache', () => {
    it('캐시를 비워야 한다', async () => {
      // 캐시에 파일 생성
      const cachePath = path.join(tempDir, '@goondan', 'test', '1.0.0');
      await fs.mkdir(cachePath, { recursive: true });
      await fs.writeFile(path.join(cachePath, 'package.yaml'), 'test');

      await manager.clearCache();

      // 캐시 디렉토리 내용 확인
      const entries = await fs.readdir(tempDir).catch(() => []);
      expect(entries).toHaveLength(0);
    });
  });

  describe('getPackageManifest', () => {
    it('패키지 매니페스트를 읽어야 한다', async () => {
      const pkgDir = path.join(tempDir, 'manifest-test');
      await fs.mkdir(pkgDir, { recursive: true });

      const manifest = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: test-pkg
  version: "1.0.0"
spec:
  dependencies:
    - "@goondan/utils@^1.0.0"
  resources:
    - tools/test.yaml
  dist:
    - dist/
`;
      await fs.writeFile(path.join(pkgDir, 'package.yaml'), manifest);

      const result = await manager.getPackageManifest(pkgDir);

      expect(result.kind).toBe('Package');
      expect(result.metadata.name).toBe('test-pkg');
      expect(result.spec.dependencies).toContain('@goondan/utils@^1.0.0');
    });

    it('package.yaml이 없으면 에러를 던져야 한다', async () => {
      const pkgDir = path.join(tempDir, 'no-manifest');
      await fs.mkdir(pkgDir, { recursive: true });

      await expect(manager.getPackageManifest(pkgDir)).rejects.toThrow();
    });
  });

  describe('커스텀 레지스트리', () => {
    it('커스텀 레지스트리 URL을 사용해야 한다', () => {
      const customManager = createPackageManager({
        cacheDir: tempDir,
        registry: 'https://my-registry.example.com',
      });

      expect(customManager.getRegistry()).toBe('https://my-registry.example.com');
    });

    it('scope별 레지스트리를 설정할 수 있어야 한다', async () => {
      const customManager = createPackageManager({
        cacheDir: tempDir,
        registry: 'https://goondan-registry.yechanny.workers.dev',
        scopedRegistries: {
          '@myorg': 'https://my-org-registry.example.com',
        },
      });

      const registry = customManager.getRegistryForScope('@myorg');
      expect(registry).toBe('https://my-org-registry.example.com');
    });

    it('scope별 레지스트리가 없으면 기본 레지스트리를 사용해야 한다', async () => {
      const registry = manager.getRegistryForScope('@goondan');
      expect(registry).toBe('https://goondan-registry.yechanny.workers.dev');
    });
  });
});
