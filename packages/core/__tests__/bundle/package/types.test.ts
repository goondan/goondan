/**
 * Bundle Package 타입 테스트
 * @see /docs/specs/bundle_package.md
 */

import { describe, it, expect } from 'vitest';
import type {
  PackageSpec,
  PackageRef,
  PackageRefType,
  ResolvedDependency,
  PackageMetadata,
  PackageDistInfo,
  LockfileEntry,
  Lockfile,
} from '../../../src/bundle/package/types.js';
import {
  isPackageRef,
  isPackageSpec,
  isResolvedDependency,
} from '../../../src/bundle/package/types.js';
import type { Resource } from '../../../src/types/resource.js';

describe('Bundle Package Types', () => {
  describe('PackageSpec', () => {
    it('dependencies와 exports를 포함할 수 있어야 한다', () => {
      const spec: PackageSpec = {
        dependencies: ['@goondan/core-utils@^0.5.0', '@myorg/slack-toolkit@1.2.0'],
        exports: ['tools/fileRead/tool.yaml', 'extensions/skills/extension.yaml'],
        dist: ['dist/'],
      };

      expect(spec.dependencies).toHaveLength(2);
      expect(spec.exports).toHaveLength(2);
      expect(spec.dist).toEqual(['dist/']);
    });

    it('dependencies가 없어도 유효해야 한다', () => {
      const spec: PackageSpec = {
        exports: ['tools/fileRead/tool.yaml'],
        dist: ['dist/'],
      };

      expect(spec.dependencies).toBeUndefined();
      expect(spec.exports).toHaveLength(1);
    });

    it('exports가 없으면 consume 전용 패키지이다', () => {
      const spec: PackageSpec = {
        dependencies: ['@goondan/base@1.0.0'],
        dist: ['dist/'],
      };

      expect(spec.exports).toBeUndefined();
    });
  });

  describe('PackageRef', () => {
    it('git 타입 참조를 표현할 수 있어야 한다', () => {
      const ref: PackageRef = {
        type: 'git',
        url: 'https://github.com/goondan/slack-tools.git',
        ref: 'v1.0.0',
      };

      expect(ref.type).toBe('git');
      expect(ref.url).toBe('https://github.com/goondan/slack-tools.git');
      expect(ref.ref).toBe('v1.0.0');
    });

    it('local 타입 참조를 표현할 수 있어야 한다', () => {
      const ref: PackageRef = {
        type: 'local',
        url: '../shared-extensions',
      };

      expect(ref.type).toBe('local');
      expect(ref.url).toBe('../shared-extensions');
    });

    it('registry 타입 참조를 표현할 수 있어야 한다', () => {
      const ref: PackageRef = {
        type: 'registry',
        url: 'https://registry.goondan.io',
        scope: '@goondan',
        name: 'base',
        version: '1.0.0',
      };

      expect(ref.type).toBe('registry');
      expect(ref.scope).toBe('@goondan');
      expect(ref.name).toBe('base');
      expect(ref.version).toBe('1.0.0');
    });

    it('subpath를 포함할 수 있어야 한다', () => {
      const ref: PackageRef = {
        type: 'git',
        url: 'https://github.com/goondan/monorepo.git',
        ref: 'main',
        path: 'packages/tools',
      };

      expect(ref.path).toBe('packages/tools');
    });
  });

  describe('PackageRefType', () => {
    it('지원되는 모든 타입을 포함해야 한다', () => {
      const types: PackageRefType[] = ['git', 'local', 'registry'];
      expect(types).toContain('git');
      expect(types).toContain('local');
      expect(types).toContain('registry');
    });
  });

  describe('ResolvedDependency', () => {
    it('해석된 의존성 정보를 포함해야 한다', () => {
      const dep: ResolvedDependency = {
        name: '@goondan/base',
        version: '1.0.0',
        localPath: '/cache/packages/@goondan/base/1.0.0',
        resources: [],
        ref: {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'base',
          version: '1.0.0',
        },
      };

      expect(dep.name).toBe('@goondan/base');
      expect(dep.version).toBe('1.0.0');
      expect(dep.localPath).toBe('/cache/packages/@goondan/base/1.0.0');
    });

    it('리소스 목록을 포함해야 한다', () => {
      const toolResource: Resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: { name: 'fileRead' },
        spec: { runtime: 'node', entry: './index.js' },
      };

      const dep: ResolvedDependency = {
        name: '@goondan/base',
        version: '1.0.0',
        localPath: '/cache/packages/@goondan/base/1.0.0',
        resources: [toolResource],
        ref: {
          type: 'registry',
          url: 'https://registry.goondan.io',
          scope: '@goondan',
          name: 'base',
          version: '1.0.0',
        },
      };

      expect(dep.resources).toHaveLength(1);
      expect(dep.resources[0]?.kind).toBe('Tool');
    });
  });

  describe('PackageMetadata', () => {
    it('패키지 메타데이터를 표현할 수 있어야 한다', () => {
      const metadata: PackageMetadata = {
        name: '@goondan/base',
        description: 'Goondan 기본 Tool/Extension 번들',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: [],
            dist: {
              tarball: 'https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz',
              shasum: 'abc123',
              integrity: 'sha512-...',
            },
          },
        },
        distTags: {
          latest: '1.0.0',
        },
      };

      expect(metadata.name).toBe('@goondan/base');
      expect(metadata.versions['1.0.0']?.dist.tarball).toContain('base-1.0.0.tgz');
    });
  });

  describe('PackageDistInfo', () => {
    it('dist 정보를 포함해야 한다', () => {
      const dist: PackageDistInfo = {
        tarball: 'https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz',
        shasum: 'abc123def456',
        integrity: 'sha512-AAAA...',
      };

      expect(dist.tarball).toContain('.tgz');
      expect(dist.integrity).toMatch(/^sha512-/);
    });
  });

  describe('Lockfile', () => {
    it('lockfile 형식을 표현할 수 있어야 한다', () => {
      const entry: LockfileEntry = {
        version: '1.0.0',
        resolved: 'https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz',
        integrity: 'sha512-AAAA...',
        dependencies: {
          '@goondan/core-utils': '0.5.2',
        },
      };

      const lockfile: Lockfile = {
        lockfileVersion: 1,
        packages: {
          '@goondan/base@1.0.0': entry,
        },
      };

      expect(lockfile.lockfileVersion).toBe(1);
      expect(lockfile.packages['@goondan/base@1.0.0']?.version).toBe('1.0.0');
    });
  });

  describe('타입 가드', () => {
    describe('isPackageRef', () => {
      it('유효한 PackageRef에 대해 true를 반환해야 한다', () => {
        const ref: PackageRef = {
          type: 'git',
          url: 'https://github.com/test/repo.git',
        };
        expect(isPackageRef(ref)).toBe(true);
      });

      it('type이 없으면 false를 반환해야 한다', () => {
        expect(isPackageRef({ url: 'test' })).toBe(false);
      });

      it('url이 없으면 false를 반환해야 한다', () => {
        expect(isPackageRef({ type: 'git' })).toBe(false);
      });

      it('null에 대해 false를 반환해야 한다', () => {
        expect(isPackageRef(null)).toBe(false);
      });
    });

    describe('isPackageSpec', () => {
      it('유효한 PackageSpec에 대해 true를 반환해야 한다', () => {
        const spec: PackageSpec = {
          dist: ['dist/'],
        };
        expect(isPackageSpec(spec)).toBe(true);
      });

      it('dist가 없으면 false를 반환해야 한다', () => {
        expect(isPackageSpec({ resources: [] })).toBe(false);
      });

      it('null에 대해 false를 반환해야 한다', () => {
        expect(isPackageSpec(null)).toBe(false);
      });
    });

    describe('isResolvedDependency', () => {
      it('유효한 ResolvedDependency에 대해 true를 반환해야 한다', () => {
        const dep: ResolvedDependency = {
          name: 'test',
          version: '1.0.0',
          localPath: '/path/to/cache',
          resources: [],
          ref: { type: 'local', url: '/path' },
        };
        expect(isResolvedDependency(dep)).toBe(true);
      });

      it('필수 필드가 없으면 false를 반환해야 한다', () => {
        expect(isResolvedDependency({ name: 'test' })).toBe(false);
        expect(isResolvedDependency({ name: 'test', version: '1.0.0' })).toBe(false);
      });
    });
  });
});
