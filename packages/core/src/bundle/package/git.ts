/**
 * Git 패키지 다운로드
 * @see /docs/specs/bundle_package.md - Git 참조
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { PackageRef } from './types.js';
import { PackageFetchError } from './errors.js';

/**
 * Git URL 정보
 */
export interface GitUrlInfo {
  /** 프로토콜 (https, ssh, git) */
  protocol: string;
  /** 호스트명 */
  host: string;
  /** 소유자/조직 */
  owner: string;
  /** 저장소 이름 */
  repo: string;
}

/**
 * Git URL 파싱
 */
export function parseGitUrl(url: string): GitUrlInfo {
  // SSH 형식: git@host:owner/repo.git
  const sshMatch = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (sshMatch) {
    return {
      protocol: 'ssh',
      host: sshMatch[1] ?? '',
      owner: sshMatch[2] ?? '',
      repo: (sshMatch[3] ?? '').replace(/\.git$/, ''),
    };
  }

  // URL 형식: protocol://host/owner/repo.git
  const urlMatch = /^(https?|ssh|git):\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (urlMatch) {
    return {
      protocol: urlMatch[1] ?? 'https',
      host: urlMatch[2] ?? '',
      owner: urlMatch[3] ?? '',
      repo: (urlMatch[4] ?? '').replace(/\.git$/, ''),
    };
  }

  // 간단한 형식: host/owner/repo
  const simpleMatch = /^([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (simpleMatch) {
    return {
      protocol: 'https',
      host: simpleMatch[1] ?? '',
      owner: simpleMatch[2] ?? '',
      repo: (simpleMatch[3] ?? '').replace(/\.git$/, ''),
    };
  }

  throw new Error(`Invalid git URL: ${url}`);
}

/**
 * Git clone 인자 생성 옵션
 */
export interface BuildGitCloneArgsOptions {
  /** Git URL */
  url: string;
  /** 타겟 디렉토리 */
  targetDir: string;
  /** Git ref (branch, tag) */
  ref?: string;
  /** Shallow clone depth */
  depth?: number;
  /** Submodule 포함 여부 */
  recursive?: boolean;
}

/**
 * Git clone 명령어 인자 생성
 */
export function buildGitCloneArgs(options: BuildGitCloneArgsOptions): string[] {
  const args: string[] = ['clone'];

  if (options.ref) {
    args.push('--branch', options.ref);
  }

  if (options.depth !== undefined) {
    args.push('--depth', String(options.depth));
  }

  if (options.recursive) {
    args.push('--recursive');
  }

  args.push(options.url, options.targetDir);

  return args;
}

/**
 * Commit hash인지 확인
 */
export function isCommitHash(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref);
}

/**
 * Git Fetcher 옵션
 */
export interface GitFetcherOptions {
  /** 캐시 디렉토리 */
  cacheDir: string;
  /** Shallow clone 사용 여부 */
  shallow?: boolean;
}

/**
 * Git Fetcher 인터페이스
 */
export interface GitFetcher {
  /**
   * 캐시 키 생성
   */
  getCacheKey(ref: PackageRef): string;

  /**
   * 캐시 경로 반환
   */
  getCachePath(ref: PackageRef): string;

  /**
   * Git 저장소 가져오기
   */
  fetch(ref: PackageRef): Promise<string>;
}

/**
 * Git Fetcher 생성
 */
export function createGitFetcher(options: GitFetcherOptions): GitFetcher {
  const { cacheDir, shallow = true } = options;

  function getCacheKey(ref: PackageRef): string {
    const gitInfo = parseGitUrl(ref.url);
    const refPart = ref.ref ?? 'default';
    const pathPart = ref.path ? `-${ref.path.replace(/\//g, '-')}` : '';

    return `${gitInfo.owner}-${gitInfo.repo}-${refPart}${pathPart}`;
  }

  function getCachePath(ref: PackageRef): string {
    const key = getCacheKey(ref);
    return path.join(cacheDir, 'git', key);
  }

  async function fetch(ref: PackageRef): Promise<string> {
    const cachePath = getCachePath(ref);

    // 이미 캐시에 있는지 확인
    try {
      await fs.access(cachePath);
      return ref.path ? path.join(cachePath, ref.path) : cachePath;
    } catch {
      // 캐시 없음, 계속 진행
    }

    // 캐시 디렉토리 생성
    await fs.mkdir(path.dirname(cachePath), { recursive: true });

    // Git clone 실행
    const cloneArgs = buildGitCloneArgs({
      url: ref.url,
      targetDir: cachePath,
      ref: ref.ref && !isCommitHash(ref.ref) ? ref.ref : undefined,
      depth: shallow ? 1 : undefined,
    });

    await runGitCommand(cloneArgs);

    // Commit hash인 경우 checkout
    if (ref.ref && isCommitHash(ref.ref)) {
      await runGitCommand(['checkout', ref.ref], { cwd: cachePath });
    }

    return ref.path ? path.join(cachePath, ref.path) : cachePath;
  }

  return {
    getCacheKey,
    getCachePath,
    fetch,
  };
}

/**
 * Git 명령어 실행
 */
async function runGitCommand(
  args: string[],
  options?: { cwd?: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new PackageFetchError(`Git command failed: git ${args.join(' ')}`, {
            packageRef: args[args.length - 1] ?? '',
            statusCode: code ?? undefined,
          })
        );
      }
    });

    proc.on('error', (error) => {
      reject(
        new PackageFetchError(`Git command error: ${error.message}`, {
          packageRef: args[args.length - 1] ?? '',
          cause: error,
        })
      );
    });
  });
}
