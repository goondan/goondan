/**
 * DependencyResolver 테스트
 * @see /docs/specs/bundle_package.md - 9. 구성 병합/로드 순서
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  DependencyResolver,
  createDependencyResolver,
  ResolutionOrder,
} from '../../../src/bundle/package/resolver.js';
import { createPackageManager } from '../../../src/bundle/package/manager.js';
import type { Resource } from '../../../src/types/resource.js';
import type { PackageSpec } from '../../../src/bundle/package/types.js';
import { DependencyResolutionError } from '../../../src/bundle/package/errors.js';

describe('DependencyResolver', () => {
  let tempDir: string;
  let resolver: DependencyResolver;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-resolver-test-'));
    const manager = createPackageManager({
      cacheDir: tempDir,
      registry: 'https://registry.goondan.io',
    });
    resolver = createDependencyResolver(manager);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createPackageDir(
    name: string,
    spec: {
      version?: string;
      dependencies?: string[];
      resources?: string[];
      resourceContents?: Array<{ path: string; content: Resource }>;
    }
  ): Promise<string> {
    const pkgDir = path.join(tempDir, name.replace('@', '').replace('/', '-'));
    await fs.mkdir(path.join(pkgDir, 'dist'), { recursive: true });

    const packageVersion = spec.version ?? '1.0.0';

    await fs.writeFile(
      path.join(pkgDir, 'package.yaml'),
      `apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "${name}"
  version: "${packageVersion}"
spec:
  ${spec.dependencies ? `dependencies:\n    ${spec.dependencies.map((d) => `- "${d}"`).join('\n    ')}` : ''}
  ${spec.resources ? `resources:\n    ${spec.resources.map((r) => `- ${r}`).join('\n    ')}` : ''}
  dist:
    - dist/
`
    );

    // 리소스 파일 생성
    if (spec.resourceContents) {
      for (const { path: rPath, content } of spec.resourceContents) {
        const fullPath = path.join(pkgDir, 'dist', rPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(
          fullPath,
          `apiVersion: ${content.apiVersion}
kind: ${content.kind}
metadata:
  name: ${content.metadata.name}
spec:
  ${Object.entries(content.spec).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n  ')}
`
        );
      }
    }

    return pkgDir;
  }

  describe('resolve', () => {
    it('의존성 없는 패키지를 해석해야 한다', async () => {
      const pkgDir = await createPackageDir('simple-pkg', {
        resources: ['tools/test.yaml'],
        resourceContents: [
          {
            path: 'tools/test.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'test-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const packageResource: Resource<PackageSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Package',
        metadata: { name: 'simple-pkg', version: '1.0.0' },
        spec: {
          resources: ['tools/test.yaml'],
          dist: ['dist/'],
        },
      };

      const result = await resolver.resolve(packageResource, pkgDir);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('simple-pkg');
      expect(result[0]?.resources).toHaveLength(1);
      expect(result[0]?.resources[0]?.kind).toBe('Tool');
    });

    it('단일 의존성을 해석해야 한다', async () => {
      // 의존성 패키지 생성
      const depDir = await createPackageDir('@goondan/utils', {
        resources: ['tools/util.yaml'],
        resourceContents: [
          {
            path: 'tools/util.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'util-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      // 메인 패키지 생성
      const mainDir = await createPackageDir('main-pkg', {
        dependencies: [`file:${depDir}`],
        resources: ['tools/main.yaml'],
        resourceContents: [
          {
            path: 'tools/main.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'main-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const packageResource: Resource<PackageSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Package',
        metadata: { name: 'main-pkg', version: '1.0.0' },
        spec: {
          dependencies: [`file:${depDir}`],
          resources: ['tools/main.yaml'],
          dist: ['dist/'],
        },
      };

      const result = await resolver.resolve(packageResource, mainDir);

      // 의존성 -> 현재 순서로 반환
      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('@goondan/utils');
      expect(result[1]?.name).toBe('main-pkg');
    });

    it('중첩 의존성을 재귀적으로 해석해야 한다', async () => {
      // 레벨 3 패키지
      const level3Dir = await createPackageDir('level3', {
        resources: ['tools/l3.yaml'],
        resourceContents: [
          {
            path: 'tools/l3.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'l3-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      // 레벨 2 패키지 (레벨 3 의존)
      const level2Dir = await createPackageDir('level2', {
        dependencies: [`file:${level3Dir}`],
        resources: ['tools/l2.yaml'],
        resourceContents: [
          {
            path: 'tools/l2.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'l2-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      // 레벨 1 패키지 (레벨 2 의존)
      const level1Dir = await createPackageDir('level1', {
        dependencies: [`file:${level2Dir}`],
        resources: ['tools/l1.yaml'],
        resourceContents: [
          {
            path: 'tools/l1.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'l1-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const packageResource: Resource<PackageSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Package',
        metadata: { name: 'level1', version: '1.0.0' },
        spec: {
          dependencies: [`file:${level2Dir}`],
          resources: ['tools/l1.yaml'],
          dist: ['dist/'],
        },
      };

      const result = await resolver.resolve(packageResource, level1Dir);

      // 의존성 순서: level3 -> level2 -> level1
      expect(result).toHaveLength(3);
      expect(result[0]?.name).toBe('level3');
      expect(result[1]?.name).toBe('level2');
      expect(result[2]?.name).toBe('level1');
    });

    it('순환 의존성을 감지하고 에러를 던져야 한다', async () => {
      // 순환 참조 생성 (A -> B -> A)
      const pkgADir = path.join(tempDir, 'pkg-a');
      const pkgBDir = path.join(tempDir, 'pkg-b');

      await fs.mkdir(path.join(pkgADir, 'dist'), { recursive: true });
      await fs.mkdir(path.join(pkgBDir, 'dist'), { recursive: true });

      // pkg-a는 pkg-b 의존
      await fs.writeFile(
        path.join(pkgADir, 'package.yaml'),
        `apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: pkg-a
  version: "1.0.0"
spec:
  dependencies:
    - "file:${pkgBDir}"
  dist:
    - dist/
`
      );

      // pkg-b는 pkg-a 의존 (순환)
      await fs.writeFile(
        path.join(pkgBDir, 'package.yaml'),
        `apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: pkg-b
  version: "1.0.0"
spec:
  dependencies:
    - "file:${pkgADir}"
  dist:
    - dist/
`
      );

      const packageResource: Resource<PackageSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Package',
        metadata: { name: 'pkg-a', version: '1.0.0' },
        spec: {
          dependencies: [`file:${pkgBDir}`],
          dist: ['dist/'],
        },
      };

      await expect(resolver.resolve(packageResource, pkgADir)).rejects.toThrow(
        DependencyResolutionError
      );
    });

    it('동일 패키지 중복 의존성은 한 번만 포함해야 한다', async () => {
      // 공통 의존성
      const commonDir = await createPackageDir('common', {
        resources: ['tools/common.yaml'],
        resourceContents: [
          {
            path: 'tools/common.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'common-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      // 두 개의 패키지가 동일한 common 의존
      const depADir = await createPackageDir('dep-a', {
        dependencies: [`file:${commonDir}`],
        resources: ['tools/a.yaml'],
        resourceContents: [
          {
            path: 'tools/a.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'a-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const depBDir = await createPackageDir('dep-b', {
        dependencies: [`file:${commonDir}`],
        resources: ['tools/b.yaml'],
        resourceContents: [
          {
            path: 'tools/b.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'b-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const mainDir = await createPackageDir('main', {
        dependencies: [`file:${depADir}`, `file:${depBDir}`],
        resources: ['tools/main.yaml'],
        resourceContents: [
          {
            path: 'tools/main.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'main-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const packageResource: Resource<PackageSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Package',
        metadata: { name: 'main', version: '1.0.0' },
        spec: {
          dependencies: [`file:${depADir}`, `file:${depBDir}`],
          resources: ['tools/main.yaml'],
          dist: ['dist/'],
        },
      };

      const result = await resolver.resolve(packageResource, mainDir);

      // common은 한 번만 포함
      const commonCount = result.filter((d) => d.name === 'common').length;
      expect(commonCount).toBe(1);
    });

    it('동일 패키지의 상이한 버전이 동시에 해석되면 충돌로 거부해야 한다', async () => {
      const sharedV1Dir = await createPackageDir('shared-lib', {
        version: '1.0.0',
        resources: ['tools/shared-v1.yaml'],
        resourceContents: [
          {
            path: 'tools/shared-v1.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'shared-v1-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const sharedV2Dir = await createPackageDir('shared-lib-v2', {
        version: '2.0.0',
        resources: ['tools/shared-v2.yaml'],
        resourceContents: [
          {
            path: 'tools/shared-v2.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'shared-v2-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      await fs.writeFile(
        path.join(sharedV2Dir, 'package.yaml'),
        `apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "shared-lib"
  version: "2.0.0"
spec:
  resources:
    - tools/shared-v2.yaml
  dist:
    - dist/
`
      );

      const depADir = await createPackageDir('dep-a-versioned', {
        dependencies: [`file:${sharedV1Dir}`],
        resources: ['tools/a.yaml'],
        resourceContents: [
          {
            path: 'tools/a.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'a-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const depBDir = await createPackageDir('dep-b-versioned', {
        dependencies: [`file:${sharedV2Dir}`],
        resources: ['tools/b.yaml'],
        resourceContents: [
          {
            path: 'tools/b.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'b-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const mainDir = await createPackageDir('main-versioned', {
        dependencies: [`file:${depADir}`, `file:${depBDir}`],
        resources: ['tools/main.yaml'],
        resourceContents: [
          {
            path: 'tools/main.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'main-tool' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const packageResource: Resource<PackageSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Package',
        metadata: { name: 'main-versioned', version: '1.0.0' },
        spec: {
          dependencies: [`file:${depADir}`, `file:${depBDir}`],
          resources: ['tools/main.yaml'],
          dist: ['dist/'],
        },
      };

      await expect(resolver.resolve(packageResource, mainDir)).rejects.toThrow(
        DependencyResolutionError
      );
    });
  });

  describe('ResolutionOrder', () => {
    it('의존성 순서를 계산해야 한다', () => {
      const order = new ResolutionOrder();

      order.add('c', []);
      order.add('b', ['c']);
      order.add('a', ['b']);

      const sorted = order.getOrder();
      expect(sorted).toEqual(['c', 'b', 'a']);
    });

    it('다중 의존성 순서를 계산해야 한다', () => {
      const order = new ResolutionOrder();

      order.add('d', []);
      order.add('c', ['d']);
      order.add('b', ['d']);
      order.add('a', ['b', 'c']);

      const sorted = order.getOrder();
      // d가 b, c보다 먼저, b와 c가 a보다 먼저
      expect(sorted.indexOf('d')).toBeLessThan(sorted.indexOf('b'));
      expect(sorted.indexOf('d')).toBeLessThan(sorted.indexOf('c'));
      expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('a'));
      expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('a'));
    });

    it('순환 의존성을 감지해야 한다', () => {
      const order = new ResolutionOrder();

      order.add('a', ['b']);
      order.add('b', ['a']);

      expect(() => order.getOrder()).toThrow();
    });
  });

  describe('loadResources', () => {
    it('resources 목록의 YAML을 로드해야 한다', async () => {
      const pkgDir = await createPackageDir('resource-test', {
        resources: ['tools/tool1.yaml', 'extensions/ext1.yaml'],
        resourceContents: [
          {
            path: 'tools/tool1.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'tool1' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
          {
            path: 'extensions/ext1.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Extension',
              metadata: { name: 'ext1' },
              spec: { runtime: 'node', entry: './index.js' },
            },
          },
        ],
      });

      const resources = await resolver.loadResources(
        pkgDir,
        ['tools/tool1.yaml', 'extensions/ext1.yaml'],
        ['dist/']
      );

      expect(resources).toHaveLength(2);
      expect(resources[0]?.kind).toBe('Tool');
      expect(resources[1]?.kind).toBe('Extension');
    });

    it('resources가 없으면 빈 배열을 반환해야 한다', async () => {
      const pkgDir = await createPackageDir('no-resources', {
        dist: ['dist/'],
      });

      const resources = await resolver.loadResources(pkgDir, undefined, ['dist/']);

      expect(resources).toHaveLength(0);
    });

    it('spec.resources 경로에 ../가 포함되면 거부해야 한다', async () => {
      const pkgDir = await createPackageDir('unsafe-resource-path', {
        resources: ['tools/tool1.yaml'],
      });

      await expect(
        resolver.loadResources(pkgDir, ['../outside.yaml'], ['dist/'])
      ).rejects.toThrow(DependencyResolutionError);
    });

    it('spec.dist 경로가 절대 경로면 거부해야 한다', async () => {
      const pkgDir = await createPackageDir('unsafe-dist-path', {
        resources: ['tools/tool1.yaml'],
      });

      await expect(
        resolver.loadResources(pkgDir, ['tools/tool1.yaml'], ['/absolute/path'])
      ).rejects.toThrow(DependencyResolutionError);
    });

    it('리소스 spec.entry에 ../가 포함되면 거부해야 한다', async () => {
      const pkgDir = await createPackageDir('unsafe-entry-path', {
        resources: ['tools/tool1.yaml'],
        resourceContents: [
          {
            path: 'tools/tool1.yaml',
            content: {
              apiVersion: 'agents.example.io/v1alpha1',
              kind: 'Tool',
              metadata: { name: 'tool1' },
              spec: { runtime: 'node', entry: '../outside.js' },
            },
          },
        ],
      });

      await expect(
        resolver.loadResources(pkgDir, ['tools/tool1.yaml'], ['dist/'])
      ).rejects.toThrow(DependencyResolutionError);
    });
  });
});
