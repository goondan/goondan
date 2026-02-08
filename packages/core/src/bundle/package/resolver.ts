/**
 * DependencyResolver 구현
 * @see /docs/specs/bundle_package.md - 9. 구성 병합/로드 순서
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'yaml';
import type { Resource } from '../../types/resource.js';
import type { PackageRef, PackageSpec, ResolvedDependency } from './types.js';
import type { PackageManager } from './manager.js';
import { parsePackageRef } from './ref-parser.js';

import { DependencyResolutionError } from './errors.js';
import type { ResourceMetadata } from '../../types/resource.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafePackageRelativePath(pathValue: string): boolean {
  if (path.isAbsolute(pathValue)) {
    return false;
  }

  const normalized = pathValue.replace(/\\/g, '/');
  return !normalized.split('/').includes('..');
}

function assertSafePackagePath(
  pathValue: string,
  fieldPath: string,
  packageRef: string
): void {
  if (!isSafePackageRelativePath(pathValue)) {
    throw new DependencyResolutionError(
      `Unsafe path in ${fieldPath}: "${pathValue}"`,
      {
        packageRef,
        suggestion:
          'Use paths relative to package root/spec.dist without absolute paths or ".." segments.',
      }
    );
  }
}

function assertSafeResourceEntryPath(resource: Resource, packageRef: string): void {
  const spec = resource.spec;
  if (!isRecord(spec)) {
    return;
  }

  const entry = spec.entry;
  if (typeof entry !== 'string') {
    return;
  }

  if (!isSafePackageRelativePath(entry)) {
    throw new DependencyResolutionError(
      `Unsafe path in resource spec.entry: "${entry}"`,
      {
        packageRef,
        suggestion:
          'Use spec.entry as a spec.dist-relative path without absolute paths or ".." segments.',
      }
    );
  }
}

/**
 * Package 메타데이터에서 버전 추출
 */
function getPackageVersion(metadata: ResourceMetadata): string {
  return metadata.version ?? '0.0.0';
}

/**
 * DependencyResolver 인터페이스
 */
export interface DependencyResolver {
  /**
   * 패키지의 모든 의존성을 해석
   *
   * @param pkg 패키지 리소스
   * @param pkgPath 패키지 로컬 경로
   * @returns 해석된 의존성 목록 (의존성 순서대로)
   */
  resolve(
    pkg: Resource<PackageSpec>,
    pkgPath: string
  ): Promise<ResolvedDependency[]>;

  /**
   * 패키지의 리소스 파일 로드
   *
   * @param pkgPath 패키지 로컬 경로
   * @param resources resources 목록
   * @param dist dist 폴더 목록
   */
  loadResources(
    pkgPath: string,
    resources: string[] | undefined,
    dist: string[]
  ): Promise<Resource[]>;
}

/**
 * DependencyResolver 생성
 */
export function createDependencyResolver(
  manager: PackageManager
): DependencyResolver {
  async function resolve(
    pkg: Resource<PackageSpec>,
    pkgPath: string
  ): Promise<ResolvedDependency[]> {
    const resolved = new Map<string, ResolvedDependency>();
    const order = new ResolutionOrder();
    const visiting = new Set<string>();
    const resolvedVersionsByName = new Map<string, Set<string>>();

    // 현재 패키지 키 (Package의 metadata에는 version 필드가 포함될 수 있음)
    const currentKey = `${pkg.metadata.name}@${getPackageVersion(pkg.metadata)}`;

    function registerResolvedVersion(packageName: string, packageVersion: string): void {
      const existing = resolvedVersionsByName.get(packageName);
      if (!existing) {
        resolvedVersionsByName.set(packageName, new Set([packageVersion]));
        return;
      }

      existing.add(packageVersion);
      if (existing.size > 1) {
        throw new DependencyResolutionError(
          `Version conflict for ${packageName}`,
          {
            packageRef: packageName,
            conflictingVersions: Array.from(existing),
            suggestion:
              'Manually align dependency version ranges or use explicit overrides.',
          }
        );
      }
    }

    // 재귀적으로 의존성 해석
    async function resolveRecursive(
      packageResource: Resource<PackageSpec>,
      packagePath: string,
      packageKey: string
    ): Promise<void> {
      // 순환 의존성 검사
      if (visiting.has(packageKey)) {
        const chain = Array.from(visiting);
        chain.push(packageKey);

        throw new DependencyResolutionError('Circular dependency detected', {
          packageRef: packageKey,
          dependencyChain: chain,
        });
      }

      // 이미 해석됨
      if (resolved.has(packageKey)) {
        return;
      }

      visiting.add(packageKey);
      registerResolvedVersion(
        packageResource.metadata.name,
        getPackageVersion(packageResource.metadata)
      );

      const deps = packageResource.spec.dependencies ?? [];
      const depKeys: string[] = [];

      // 의존성 먼저 해석
      for (const depRef of deps) {
        const ref = parsePackageRef(depRef);
        const depPath = await manager.fetch(ref);
        const depManifest = await manager.getPackageManifest(depPath);

        const depKey = `${depManifest.metadata.name}@${getPackageVersion(depManifest.metadata)}`;
        depKeys.push(depKey);

        await resolveRecursive(depManifest, depPath, depKey);
      }

      // 현재 패키지 리소스 로드
      const resources = await loadResourcesInternal(
        packagePath,
        packageResource.spec.exports,
        packageResource.spec.dist
      );

      // 현재 패키지 해석 정보 저장
      const ref: PackageRef = {
        type: 'local',
        url: packagePath,
      };

      resolved.set(packageKey, {
        name: packageResource.metadata.name,
        version: getPackageVersion(packageResource.metadata),
        localPath: packagePath,
        resources,
        ref,
      });

      order.add(packageKey, depKeys);

      visiting.delete(packageKey);
    }

    await resolveRecursive(pkg, pkgPath, currentKey);

    // 의존성 순서대로 정렬하여 반환
    const orderedKeys = order.getOrder();
    const result: ResolvedDependency[] = [];

    for (const key of orderedKeys) {
      const dep = resolved.get(key);
      if (dep) {
        result.push(dep);
      }
    }

    return result;
  }

  async function loadResourcesInternal(
    pkgPath: string,
    resources: string[] | undefined,
    dist: string[]
  ): Promise<Resource[]> {
    for (let i = 0; i < dist.length; i++) {
      assertSafePackagePath(dist[i] ?? '', `spec.dist[${i}]`, pkgPath);
    }

    if (!resources || resources.length === 0) {
      return [];
    }

    const result: Resource[] = [];

    // dist 폴더 기준으로 리소스 경로 해석
    const distPath = dist.length > 0 ? path.join(pkgPath, dist[0] ?? '') : pkgPath;

    for (let i = 0; i < resources.length; i++) {
      const resourcePath = resources[i] ?? '';
      assertSafePackagePath(resourcePath, `spec.exports[${i}]`, pkgPath);

      const fullPath = path.join(distPath, resourcePath);

      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const parsed = yaml.parse(content) as Resource;

        if (parsed && typeof parsed === 'object') {
          assertSafeResourceEntryPath(parsed, pkgPath);
          result.push(parsed);
        }
      } catch (error) {
        if (error instanceof DependencyResolutionError) {
          throw error;
        }
        // 파일을 읽을 수 없는 경우 경고하고 계속
        console.warn(`Failed to load resource: ${fullPath}`, error);
      }
    }

    return result;
  }

  return {
    resolve,
    loadResources: loadResourcesInternal,
  };
}

/**
 * 의존성 순서 계산
 *
 * 위상 정렬(Topological Sort)을 사용하여
 * 의존성이 먼저 오도록 순서 결정
 */
export class ResolutionOrder {
  private nodes = new Map<string, string[]>();

  /**
   * 노드와 의존성 추가
   */
  add(key: string, dependencies: string[]): void {
    this.nodes.set(key, dependencies);
  }

  /**
   * 위상 정렬된 순서 반환
   */
  getOrder(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (key: string): void => {
      if (visited.has(key)) {
        return;
      }

      if (visiting.has(key)) {
        throw new DependencyResolutionError('Circular dependency detected', {
          packageRef: key,
          dependencyChain: Array.from(visiting),
        });
      }

      visiting.add(key);

      const deps = this.nodes.get(key) ?? [];
      for (const dep of deps) {
        visit(dep);
      }

      visiting.delete(key);
      visited.add(key);
      result.push(key);
    };

    for (const key of this.nodes.keys()) {
      visit(key);
    }

    return result;
  }
}
