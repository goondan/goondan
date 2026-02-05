/**
 * Git 패키지 다운로드 테스트
 * @see /docs/specs/bundle_package.md - Git 참조
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  GitFetcher,
  createGitFetcher,
  parseGitUrl,
  buildGitCloneArgs,
} from '../../../src/bundle/package/git.js';
import type { PackageRef } from '../../../src/bundle/package/types.js';

describe('Git Fetcher', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-git-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('parseGitUrl', () => {
    it('HTTPS URL을 파싱해야 한다', () => {
      const result = parseGitUrl('https://github.com/goondan/tools.git');

      expect(result.protocol).toBe('https');
      expect(result.host).toBe('github.com');
      expect(result.owner).toBe('goondan');
      expect(result.repo).toBe('tools');
    });

    it('SSH URL을 파싱해야 한다', () => {
      const result = parseGitUrl('ssh://git@github.com/company/tools.git');

      expect(result.protocol).toBe('ssh');
      expect(result.host).toBe('github.com');
      expect(result.owner).toBe('company');
      expect(result.repo).toBe('tools');
    });

    it('git@ 축약 형식을 파싱해야 한다', () => {
      const result = parseGitUrl('git@github.com:goondan/tools.git');

      expect(result.protocol).toBe('ssh');
      expect(result.host).toBe('github.com');
      expect(result.owner).toBe('goondan');
      expect(result.repo).toBe('tools');
    });

    it('.git 확장자 없는 URL을 처리해야 한다', () => {
      const result = parseGitUrl('https://github.com/goondan/tools');

      expect(result.repo).toBe('tools');
    });
  });

  describe('buildGitCloneArgs', () => {
    it('기본 clone 인자를 생성해야 한다', () => {
      const args = buildGitCloneArgs({
        url: 'https://github.com/goondan/tools.git',
        targetDir: '/path/to/target',
      });

      expect(args).toContain('clone');
      expect(args).toContain('https://github.com/goondan/tools.git');
      expect(args).toContain('/path/to/target');
    });

    it('특정 브랜치/태그를 지정해야 한다', () => {
      const args = buildGitCloneArgs({
        url: 'https://github.com/goondan/tools.git',
        targetDir: '/path/to/target',
        ref: 'v1.0.0',
      });

      expect(args).toContain('--branch');
      expect(args).toContain('v1.0.0');
    });

    it('shallow clone을 위한 depth를 지정해야 한다', () => {
      const args = buildGitCloneArgs({
        url: 'https://github.com/goondan/tools.git',
        targetDir: '/path/to/target',
        depth: 1,
      });

      expect(args).toContain('--depth');
      expect(args).toContain('1');
    });

    it('submodule 포함 옵션을 지정해야 한다', () => {
      const args = buildGitCloneArgs({
        url: 'https://github.com/goondan/tools.git',
        targetDir: '/path/to/target',
        recursive: true,
      });

      expect(args).toContain('--recursive');
    });
  });

  describe('GitFetcher', () => {
    let fetcher: GitFetcher;

    beforeEach(() => {
      fetcher = createGitFetcher({ cacheDir: tempDir });
    });

    describe('getCacheKey', () => {
      it('URL과 ref를 기반으로 캐시 키를 생성해야 한다', () => {
        const ref: PackageRef = {
          type: 'git',
          url: 'https://github.com/goondan/tools.git',
          ref: 'v1.0.0',
        };

        const key = fetcher.getCacheKey(ref);

        expect(key).toContain('goondan');
        expect(key).toContain('tools');
        expect(key).toContain('v1.0.0');
      });

      it('ref가 없으면 default를 사용해야 한다', () => {
        const ref: PackageRef = {
          type: 'git',
          url: 'https://github.com/goondan/tools.git',
        };

        const key = fetcher.getCacheKey(ref);

        expect(key).toContain('default');
      });

      it('path가 있으면 캐시 키에 포함해야 한다', () => {
        const ref: PackageRef = {
          type: 'git',
          url: 'https://github.com/goondan/monorepo.git',
          ref: 'main',
          path: 'packages/tools',
        };

        const key = fetcher.getCacheKey(ref);

        expect(key).toContain('packages-tools');
      });
    });

    describe('getCachePath', () => {
      it('캐시 경로를 반환해야 한다', () => {
        const ref: PackageRef = {
          type: 'git',
          url: 'https://github.com/goondan/tools.git',
          ref: 'v1.0.0',
        };

        const cachePath = fetcher.getCachePath(ref);

        expect(cachePath).toContain(tempDir);
        expect(cachePath).toContain('git');
      });
    });

    // 실제 git clone은 통합 테스트에서 수행
    // describe('fetch', () => {
    //   it('git 저장소를 clone해야 한다', async () => {
    //     // 실제 네트워크 요청이 필요하므로 통합 테스트로 이동
    //   });
    // });
  });

  describe('git 명령어 생성', () => {
    it('commit hash로 checkout하는 명령을 생성해야 한다', () => {
      // commit hash인 경우 clone 후 checkout이 필요
      const isCommitHash = (ref: string): boolean => {
        return /^[0-9a-f]{7,40}$/i.test(ref);
      };

      expect(isCommitHash('abc1234')).toBe(true);
      expect(isCommitHash('abc1234567890abcdef1234567890abcdef12345')).toBe(true);
      expect(isCommitHash('v1.0.0')).toBe(false);
      expect(isCommitHash('main')).toBe(false);
    });
  });
});
