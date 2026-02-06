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
  getPackageCachePath,
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
  /** 인증 토큰 */
  token?: string;
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
  const registry = options.registry ?? 'https://goondan-registry.yechanny.workers.dev';
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
      return fetchRegistry(ref, cache, registry, scopedRegistries, options?.token);
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
 * @see /docs/specs/bundle_package.md - Section 4.2
 */
async function fetchRegistry(
  ref: PackageRef,
  cache: PackageCache,
  defaultRegistry: string,
  scopedRegistries: Record<string, string>,
  token?: string
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

  // 패키지명과 버전 확인
  const packageName = ref.scope ? `${ref.scope}/${ref.name}` : ref.name;
  const version = ref.version ?? 'latest';

  if (!packageName) {
    throw new PackageNotFoundError('Package name is required', {
      packageRef: formatPackageRef(ref),
    });
  }

  // 1. 패키지 메타데이터 조회
  const metadataUrl = version === 'latest'
    ? `${registryUrl}/${packageName}`
    : `${registryUrl}/${packageName}/${version}`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let metadata: RegistryVersionResponse;
  try {
    const response = await fetch(metadataUrl, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        throw new PackageNotFoundError(
          `Package not found: ${packageName}@${version}`,
          { packageRef: formatPackageRef(ref), registry: registryUrl }
        );
      }
      throw new PackageFetchError(
        `Failed to fetch package metadata: ${response.status} ${response.statusText}`,
        { packageRef: formatPackageRef(ref), registry: registryUrl }
      );
    }

    const data = await response.json() as RegistryMetadataResponse | RegistryVersionResponse;

    // 패키지 전체 메타데이터인 경우 (latest 요청)
    if ('versions' in data && 'dist-tags' in data) {
      const fullMeta = data as RegistryMetadataResponse;
      const resolvedVersion = version === 'latest'
        ? fullMeta['dist-tags']['latest']
        : version;

      if (!resolvedVersion || !fullMeta.versions[resolvedVersion]) {
        throw new PackageNotFoundError(
          `Version not found: ${packageName}@${version}`,
          { packageRef: formatPackageRef(ref), registry: registryUrl }
        );
      }
      metadata = fullMeta.versions[resolvedVersion] as RegistryVersionResponse;
    } else {
      // 특정 버전 메타데이터
      metadata = data as RegistryVersionResponse;
    }
  } catch (error) {
    if (error instanceof PackageNotFoundError || error instanceof PackageFetchError) {
      throw error;
    }
    throw new PackageFetchError(
      `Network error while fetching package: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { packageRef: formatPackageRef(ref), registry: registryUrl }
    );
  }

  // 2. tarball 다운로드
  const tarballUrl = metadata.dist.tarball;
  const expectedIntegrity = metadata.dist.integrity;

  const tarballResponse = await fetch(tarballUrl, { headers });
  if (!tarballResponse.ok) {
    throw new PackageFetchError(
      `Failed to download tarball: ${tarballResponse.status}`,
      { packageRef: formatPackageRef(ref), registry: registryUrl }
    );
  }

  const tarballBuffer = await tarballResponse.arrayBuffer();

  // 3. integrity 검증
  const actualIntegrity = await computeIntegrity(Buffer.from(tarballBuffer));
  if (expectedIntegrity && actualIntegrity !== expectedIntegrity) {
    throw new PackageFetchError(
      `Integrity check failed: expected ${expectedIntegrity}, got ${actualIntegrity}`,
      { packageRef: formatPackageRef(ref), registry: registryUrl }
    );
  }

  // 4. 캐시에 압축 해제
  const cachePath = getPackageCachePath(cache.getCacheDir(), ref);
  await extractTarball(Buffer.from(tarballBuffer), cachePath);

  return cachePath;
}

/**
 * 레지스트리 메타데이터 응답 타입
 */
interface RegistryMetadataResponse {
  name: string;
  description?: string;
  versions: Record<string, RegistryVersionResponse>;
  'dist-tags': Record<string, string>;
}

/**
 * 레지스트리 버전 응답 타입
 */
interface RegistryVersionResponse {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  dist: {
    tarball: string;
    shasum?: string;
    integrity: string;
  };
  bundle?: {
    include?: string[];
    runtime?: string;
  };
}

/**
 * Buffer의 SHA-512 integrity 계산
 */
async function computeIntegrity(buffer: Buffer): Promise<string> {
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha512');
  hash.update(buffer);
  const base64Hash = hash.digest('base64');
  return `sha512-${base64Hash}`;
}

/**
 * tarball을 지정된 경로에 압축 해제
 */
async function extractTarball(buffer: Buffer, destPath: string): Promise<void> {
  const zlib = await import('node:zlib');

  // zlib.gunzip을 Promise로 래핑
  const gunzipAsync = (input: Buffer): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
      zlib.gunzip(input, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  };

  // gzip 압축 해제
  const tarBuffer = await gunzipAsync(buffer);

  // tar 아카이브 파싱 및 추출
  await extractTarBuffer(tarBuffer, destPath);
}

/**
 * tar 버퍼를 파싱하여 파일 추출
 *
 * 간단한 USTAR tar 형식 파서
 */
async function extractTarBuffer(tarBuffer: Buffer, destPath: string): Promise<void> {
  await fs.mkdir(destPath, { recursive: true });

  let offset = 0;
  const BLOCK_SIZE = 512;

  while (offset < tarBuffer.length) {
    // tar 헤더 읽기
    const header = tarBuffer.subarray(offset, offset + BLOCK_SIZE);

    // 빈 블록이면 종료
    if (header.every(b => b === 0)) {
      break;
    }

    // 파일 이름 (0-99)
    const nameEnd = header.indexOf(0, 0);
    const rawName = header.subarray(0, nameEnd > 0 && nameEnd < 100 ? nameEnd : 100).toString('utf8');

    // prefix (345-499, USTAR 형식)
    const prefixEnd = header.indexOf(0, 345);
    const prefix = header.subarray(345, prefixEnd > 345 && prefixEnd < 500 ? prefixEnd : 500).toString('utf8');

    // 전체 경로 구성
    let filePath = prefix ? `${prefix}/${rawName}` : rawName;

    // npm 패키지의 'package/' 접두사 제거
    if (filePath.startsWith('package/')) {
      filePath = filePath.slice(8);
    }

    // 파일 크기 (124-135, octal)
    const sizeStr = header.subarray(124, 136).toString('utf8').trim();
    const fileSize = parseInt(sizeStr, 8) || 0;

    // 파일 타입 (156)
    const typeFlag = header[156];

    offset += BLOCK_SIZE;

    // 디렉토리 또는 파일 처리
    if (filePath && filePath !== '.' && filePath !== '..') {
      const fullPath = path.join(destPath, filePath);

      if (typeFlag === 53 || typeFlag === 0x35 || filePath.endsWith('/')) {
        // 디렉토리
        await fs.mkdir(fullPath, { recursive: true });
      } else if (typeFlag === 48 || typeFlag === 0x30 || typeFlag === 0) {
        // 일반 파일
        const dirPath = path.dirname(fullPath);
        await fs.mkdir(dirPath, { recursive: true });

        const fileData = tarBuffer.subarray(offset, offset + fileSize);
        await fs.writeFile(fullPath, fileData);
      }
    }

    // 다음 블록으로 이동 (512바이트 경계로 정렬)
    const blocks = Math.ceil(fileSize / BLOCK_SIZE);
    offset += blocks * BLOCK_SIZE;
  }
}
