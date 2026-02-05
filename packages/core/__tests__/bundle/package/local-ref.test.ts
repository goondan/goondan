/**
 * 로컬 패키지 참조 테스트
 * @see /docs/specs/bundle_package.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createPackageManager,
  parsePackageRef,
  formatPackageRef,
  createDependencyResolver,
  isLocalRef,
} from '../../../src/bundle/package/index.js';

describe('Local Package Reference', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('parsePackageRef - local', () => {
    it('should parse file: prefix', () => {
      const ref = parsePackageRef('file:../sample-1-coding-swarm');

      expect(ref.type).toBe('local');
      expect(ref.url).toBe('../sample-1-coding-swarm');
    });

    it('should parse link: prefix', () => {
      const ref = parsePackageRef('link:../linked-package');

      expect(ref.type).toBe('local');
      expect(ref.url).toBe('../linked-package');
    });

    it('should parse absolute paths', () => {
      const ref = parsePackageRef('file:/absolute/path/to/package');

      expect(ref.type).toBe('local');
      expect(ref.url).toBe('/absolute/path/to/package');
    });
  });

  describe('isLocalRef', () => {
    it('should return true for file: refs', () => {
      expect(isLocalRef('file:../package')).toBe(true);
      expect(isLocalRef('file:/absolute/path')).toBe(true);
    });

    it('should return true for link: refs', () => {
      expect(isLocalRef('link:../package')).toBe(true);
    });

    it('should return false for other refs', () => {
      expect(isLocalRef('@goondan/base')).toBe(false);
      expect(isLocalRef('git+https://github.com/org/repo.git')).toBe(false);
    });
  });

  describe('formatPackageRef - local', () => {
    it('should format local ref', () => {
      const ref = parsePackageRef('file:../sample-package');
      const formatted = formatPackageRef(ref);

      expect(formatted).toBe('file:../sample-package');
    });
  });

  describe('PackageManager - fetch local', () => {
    it('should fetch local package by path', async () => {
      // 임시 패키지 디렉토리 생성
      const pkgDir = path.join(tempDir, 'my-package');
      await fs.mkdir(pkgDir, { recursive: true });

      // package.yaml 생성
      const packageYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: my-package
  version: "1.0.0"
spec:
  dependencies: []
  resources: []
  dist:
    - dist/
`;
      await fs.writeFile(path.join(pkgDir, 'package.yaml'), packageYaml);

      // PackageManager로 fetch
      const manager = createPackageManager({ cacheDir: tempDir });
      const ref = parsePackageRef(`file:${pkgDir}`);
      const localPath = await manager.fetch(ref);

      expect(localPath).toBe(pkgDir);
    });

    it('should throw error for non-existent local package', async () => {
      const manager = createPackageManager({ cacheDir: tempDir });
      const ref = parsePackageRef('file:/non/existent/path');

      await expect(manager.fetch(ref)).rejects.toThrow();
    });
  });

  describe('PackageManager - getPackageManifest', () => {
    it('should read package.yaml', async () => {
      const pkgDir = path.join(tempDir, 'test-package');
      await fs.mkdir(pkgDir, { recursive: true });

      const packageYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: test-package
  version: "2.0.0"
spec:
  dependencies:
    - "@goondan/utils@^1.0.0"
  resources:
    - tools/file.yaml
  dist:
    - dist/
`;
      await fs.writeFile(path.join(pkgDir, 'package.yaml'), packageYaml);

      const manager = createPackageManager({ cacheDir: tempDir });
      const manifest = await manager.getPackageManifest(pkgDir);

      expect(manifest.kind).toBe('Package');
      expect(manifest.metadata.name).toBe('test-package');
      expect(manifest.metadata.version).toBe('2.0.0');
      expect(manifest.spec.dependencies).toContain('@goondan/utils@^1.0.0');
      expect(manifest.spec.resources).toContain('tools/file.yaml');
    });
  });

  describe('DependencyResolver - local dependencies', () => {
    it('should resolve local package dependency chain', async () => {
      // 패키지 A (root)
      const pkgA = path.join(tempDir, 'pkg-a');
      await fs.mkdir(pkgA, { recursive: true });
      await fs.mkdir(path.join(pkgA, 'dist'), { recursive: true });

      // 패키지 B (dependency of A)
      const pkgB = path.join(tempDir, 'pkg-b');
      await fs.mkdir(pkgB, { recursive: true });
      await fs.mkdir(path.join(pkgB, 'dist'), { recursive: true });

      // pkg-b의 package.yaml
      const pkgBYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: pkg-b
  version: "1.0.0"
spec:
  dependencies: []
  resources: []
  dist:
    - dist/
`;
      await fs.writeFile(path.join(pkgB, 'package.yaml'), pkgBYaml);

      // pkg-a의 package.yaml (pkg-b를 의존)
      const pkgAYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: pkg-a
  version: "1.0.0"
spec:
  dependencies:
    - "file:${pkgB}"
  resources: []
  dist:
    - dist/
`;
      await fs.writeFile(path.join(pkgA, 'package.yaml'), pkgAYaml);

      // Resolver 생성 및 해석
      const manager = createPackageManager({ cacheDir: tempDir });
      const resolver = createDependencyResolver(manager);

      const manifest = await manager.getPackageManifest(pkgA);
      const resolved = await resolver.resolve(manifest, pkgA);

      // pkg-b가 먼저 오고 pkg-a가 나중에 와야 함
      expect(resolved.length).toBe(2);
      expect(resolved[0]?.name).toBe('pkg-b');
      expect(resolved[1]?.name).toBe('pkg-a');
    });
  });
});
