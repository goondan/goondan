/**
 * PackageManager 구현
 * @see /docs/specs/bundle_package.md
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'yaml';
import type { PackageRef, PackageSpec } from './types.js';
import type { Resource } from '../../types/resource.js';
import {
  parsePackageRef,
  formatPackageRef,
} from './ref-parser.js';
import {
  createPackageCache,
  getCacheDir,
  type PackageCache,
} from './cache.js';
import { createGitFetcher, type GitFetcher } from './git.js';
import { PackageNotFoundError, PackageFetchError } from './errors.js';

/**
 * PackageManager 옵션
 */
export interface PackageManagerOptions {
  /** 캐시 디렉토리 */
  cacheDir?: string;
  /** 기본 레지스트리 URL */
  registry?: string;
  /** scope별 레지스트리 매핑 */
  scopedRegistries?: Record<string, string>;
  /** 인증 토큰 */
  token?: string;
}

/**
 * 패키지 fetch 옵션
 */
export interface PackageFetchOptions {
  /** 캐시 무시하고 강제 다운로드 */
  force?: boolean;
}

/**
 * PackageManager 인터페이스
 */
export interface PackageManager {
  /**
   * 패키지 참조 문자열을 PackageRef로 해석
   */
  resolve(refString: string): Promise<PackageRef>;

  /**
   * 패키지 다운로드 및 캐시
   * @returns 로컬 캐시 경로
   */
  fetch(ref: PackageRef, options?: PackageFetchOptions): Promise<string>;

  /**
   * 패키지 매니페스트(package.yaml) 읽기
   */
  getPackageManifest(pkgPath: string): Promise<Resource<PackageSpec>>;

  /**
   * 캐시 디렉토리 경로 반환
   */
  getCache(): string;

  /**
   * 캐시 비우기
   */
  clearCache(): Promise<void>;

  /**
   * 기본 레지스트리 URL 반환
   */
  getRegistry(): string;

  /**
   * scope에 해당하는 레지스트리 URL 반환
   */
  getRegistryForScope(scope: string): string;
}

/**
 * PackageManager 생성
 */
export function createPackageManager(options: PackageManagerOptions = {}): PackageManager {
  const cacheDir = options.cacheDir ?? getCacheDir();
  const registry = options.registry ?? 'https://registry.goondan.io';
  const scopedRegistries = options.scopedRegistries ?? {};

  const cache = createPackageCache({ cacheDir });
  const gitFetcher = createGitFetcher({ cacheDir });

  async function resolve(refString: string): Promise<PackageRef> {
    return parsePackageRef(refString);
  }

  async function fetch(ref: PackageRef, options?: PackageFetchOptions): Promise<string> {
    const { force = false } = options ?? {};

    // 로컬 참조인 경우
    if (ref.type === 'local') {
      return fetchLocal(ref);
    }

    // 캐시 확인 (force가 아닌 경우)
    if (!force) {
      const cachedPath = await cache.get(ref);
      if (cachedPath) {
        return cachedPath;
      }
    }

    // Git 참조인 경우
    if (ref.type === 'git') {
      return fetchGit(ref, gitFetcher);
    }

    // 레지스트리 참조인 경우
    if (ref.type === 'registry') {
      return fetchRegistry(ref, cache, registry, scopedRegistries);
    }

    throw new PackageFetchError(`Unknown ref type: ${ref.type}`, {
      packageRef: formatPackageRef(ref),
    });
  }

  async function getPackageManifest(pkgPath: string): Promise<Resource<PackageSpec>> {
    const manifestPath = path.join(pkgPath, 'package.yaml');

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const parsed = yaml.parse(content) as Resource<PackageSpec>;

      // 기본 검증
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid package.yaml: not an object');
      }

      if (parsed.kind !== 'Package') {
        throw new Error(`Invalid package.yaml: expected kind "Package", got "${parsed.kind}"`);
      }

      return parsed;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new PackageNotFoundError(`package.yaml not found in ${pkgPath}`, {
          packageRef: pkgPath,
        });
      }
      throw error;
    }
  }

  return {
    resolve,
    fetch,
    getPackageManifest,
    getCache: () => cacheDir,
    clearCache: () => cache.clear(),
    getRegistry: () => registry,
    getRegistryForScope: (scope: string) => scopedRegistries[scope] ?? registry,
  };
}

/**
 * 로컬 패키지 fetch
 */
async function fetchLocal(ref: PackageRef): Promise<string> {
  const localPath = ref.url;

  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    throw new PackageNotFoundError(`Local package not found: ${localPath}`, {
      packageRef: localPath,
    });
  }
}

/**
 * Git 패키지 fetch
 */
async function fetchGit(ref: PackageRef, gitFetcher: GitFetcher): Promise<string> {
  return gitFetcher.fetch(ref);
}

/**
 * 레지스트리 패키지 fetch
 *
 * 주의: 실제 레지스트리 구현은 추후 추가 예정
 * 현재는 캐시된 패키지만 반환
 */
async function fetchRegistry(
  ref: PackageRef,
  cache: PackageCache,
  defaultRegistry: string,
  scopedRegistries: Record<string, string>
): Promise<string> {
  // 레지스트리 URL 결정
  const registryUrl = ref.scope
    ? (scopedRegistries[ref.scope] ?? defaultRegistry)
    : defaultRegistry;

  // 캐시된 패키지 확인
  const cachedPath = await cache.get(ref);
  if (cachedPath) {
    return cachedPath;
  }

  // TODO: 실제 레지스트리에서 다운로드 구현
  // 1. GET /<scope>/<name>/<version> 로 메타데이터 조회
  // 2. dist.tarball URL에서 tarball 다운로드
  // 3. integrity 검증
  // 4. 캐시에 압축 해제

  throw new PackageNotFoundError(
    `Package not found: ${formatPackageRef(ref)} (registry: ${registryUrl})`,
    {
      packageRef: formatPackageRef(ref),
      registry: registryUrl,
    }
  );
}
