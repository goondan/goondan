/**
 * 패키지 캐시 관리
 * @see /docs/specs/bundle_package.md - 5. 다운로드 및 캐시 규칙
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { PackageRef } from './types.js';
import { parseGitUrl } from './git.js';

/**
 * 패키지 캐시 옵션
 */
export interface PackageCacheOptions {
  /** 캐시 디렉토리 */
  cacheDir: string;
}

/**
 * 패키지 캐시 인터페이스
 */
export interface PackageCache {
  /**
   * 패키지가 캐시에 있는지 확인
   */
  has(ref: PackageRef): Promise<boolean>;

  /**
   * 캐시된 패키지 경로 반환
   */
  get(ref: PackageRef): Promise<string | null>;

  /**
   * 패키지를 캐시에 저장
   */
  set(ref: PackageRef, sourcePath: string): Promise<void>;

  /**
   * 캐시된 패키지 삭제
   */
  delete(ref: PackageRef): Promise<void>;

  /**
   * 전체 캐시 삭제
   */
  clear(): Promise<void>;

  /**
   * 캐시 디렉토리 경로 반환
   */
  getCacheDir(): string;
}

/**
 * 기본 캐시 디렉토리 반환
 */
export function getCacheDir(stateRootDir?: string): string {
  if (stateRootDir) {
    return path.join(stateRootDir, 'packages');
  }

  // 기본 경로: ~/.goondan/packages
  return path.join(os.homedir(), '.goondan', 'packages');
}

/**
 * 패키지 참조에 대한 캐시 경로 생성
 */
export function getPackageCachePath(cacheDir: string, ref: PackageRef): string {
  switch (ref.type) {
    case 'registry': {
      // @scope/name/version 또는 name/version
      const scopePart = ref.scope ? ref.scope : '';
      const namePart = ref.name ?? 'unknown';
      const versionPart = ref.version ?? 'latest';

      if (scopePart) {
        return path.join(cacheDir, scopePart, namePart, versionPart);
      }
      return path.join(cacheDir, namePart, versionPart);
    }

    case 'git': {
      // git/owner/repo/ref 형식
      const gitInfo = parseGitUrl(ref.url);
      const refPart = ref.ref ?? 'default';
      const pathPart = ref.path ? `-${ref.path.replace(/\//g, '-')}` : '';

      return path.join(
        cacheDir,
        'git',
        gitInfo.owner,
        gitInfo.repo,
        `${refPart}${pathPart}`
      );
    }

    case 'local': {
      // 로컬 참조는 캐시하지 않고 원본 경로 반환
      return ref.url;
    }

    default:
      throw new Error(`Unknown package ref type: ${ref.type}`);
  }
}

/**
 * PackageCache 생성
 */
export function createPackageCache(options: PackageCacheOptions): PackageCache {
  const { cacheDir } = options;

  return {
    async has(ref: PackageRef): Promise<boolean> {
      if (ref.type === 'local') {
        // 로컬 참조는 캐시 여부가 아닌 존재 여부 확인
        try {
          await fs.access(ref.url);
          return true;
        } catch {
          return false;
        }
      }

      const cachePath = getPackageCachePath(cacheDir, ref);

      try {
        const stat = await fs.stat(cachePath);
        if (!stat.isDirectory()) {
          return false;
        }

        // goondan.yaml 존재 확인
        await fs.access(path.join(cachePath, 'goondan.yaml'));
        return true;
      } catch {
        return false;
      }
    },

    async get(ref: PackageRef): Promise<string | null> {
      const exists = await this.has(ref);
      if (!exists) {
        return null;
      }

      return getPackageCachePath(cacheDir, ref);
    },

    async set(ref: PackageRef, sourcePath: string): Promise<void> {
      if (ref.type === 'local') {
        // 로컬 참조는 캐시하지 않음
        return;
      }

      const cachePath = getPackageCachePath(cacheDir, ref);

      // 캐시 디렉토리 생성
      await fs.mkdir(cachePath, { recursive: true });

      // 소스 파일 복사
      await copyDirectory(sourcePath, cachePath);
    },

    async delete(ref: PackageRef): Promise<void> {
      if (ref.type === 'local') {
        return;
      }

      const cachePath = getPackageCachePath(cacheDir, ref);

      try {
        await fs.rm(cachePath, { recursive: true, force: true });
      } catch {
        // 이미 없는 경우 무시
      }
    },

    async clear(): Promise<void> {
      try {
        const entries = await fs.readdir(cacheDir);

        for (const entry of entries) {
          await fs.rm(path.join(cacheDir, entry), { recursive: true, force: true });
        }
      } catch {
        // 캐시 디렉토리가 없는 경우 무시
      }
    },

    getCacheDir(): string {
      return cacheDir;
    },
  };
}

/**
 * 디렉토리 복사
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * 오래된 캐시 정리
 */
export async function cleanPackageCache(
  cacheDir: string,
  maxAgeMs: number
): Promise<void> {
  const now = Date.now();

  async function cleanDir(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // goondan.yaml이 있으면 패키지 디렉토리
          const pkgYamlPath = path.join(entryPath, 'goondan.yaml');

          try {
            // goondan.yaml 존재 확인
            await fs.access(pkgYamlPath);

            // 디렉토리 수정 시간 확인
            const stat = await fs.stat(entryPath);
            const age = now - stat.mtimeMs;

            if (age > maxAgeMs) {
              await fs.rm(entryPath, { recursive: true, force: true });
            }
          } catch {
            // goondan.yaml이 없으면 재귀적으로 하위 디렉토리 확인
            await cleanDir(entryPath);
          }
        }
      }

      // 빈 디렉토리 삭제
      const remaining = await fs.readdir(dirPath);
      if (remaining.length === 0 && dirPath !== cacheDir) {
        await fs.rmdir(dirPath);
      }
    } catch {
      // 디렉토리 접근 오류 무시
    }
  }

  await cleanDir(cacheDir);
}

/**
 * 파일 해시 계산
 */
export async function computeFileHash(
  filePath: string,
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha512'
): Promise<string> {
  const content = await fs.readFile(filePath);
  const hash = crypto.createHash(algorithm);
  hash.update(content);
  return hash.digest('hex');
}

/**
 * 무결성 문자열 생성
 */
export function createIntegrity(hash: string, algorithm: string = 'sha512'): string {
  const base64Hash = Buffer.from(hash, 'hex').toString('base64');
  return `${algorithm}-${base64Hash}`;
}

/**
 * 무결성 검증
 */
export async function verifyIntegrity(
  filePath: string,
  expectedIntegrity: string
): Promise<boolean> {
  const match = /^(sha\d+)-(.+)$/.exec(expectedIntegrity);
  if (!match) {
    return false;
  }

  const algorithm = match[1];
  const expectedBase64 = match[2];

  const actualHash = await computeFileHash(filePath, algorithm as 'sha512');
  const actualBase64 = Buffer.from(actualHash, 'hex').toString('base64');

  return actualBase64 === expectedBase64;
}
