/**
 * Git 작업 테스트
 * @see /docs/specs/changeset.md - 4.6, 5.7 Git 명령어
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  execGit,
  getHeadCommitSha,
  parseGitStatus,
  categorizeChangedFiles,
  createWorktree,
  removeWorktree,
  isGitRepository,
} from '../../src/changeset/git.js';
import type { GitStatusEntry } from '../../src/changeset/types.js';

describe('Git 작업', () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(async () => {
    // 임시 디렉터리 생성
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-git-test-'));
    repoDir = path.join(tempDir, 'repo');
    await fs.mkdir(repoDir, { recursive: true });

    // Git 레포지토리 초기화
    await execGit(repoDir, ['init']);
    await execGit(repoDir, ['config', 'user.email', 'test@example.com']);
    await execGit(repoDir, ['config', 'user.name', 'Test User']);

    // 초기 커밋 생성
    await fs.writeFile(path.join(repoDir, 'README.md'), '# Test Repo');
    await execGit(repoDir, ['add', '.']);
    await execGit(repoDir, ['commit', '-m', 'Initial commit']);
  });

  afterEach(async () => {
    // 정리
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('execGit', () => {
    it('Git 명령어를 실행하고 결과를 반환해야 한다', async () => {
      const result = await execGit(repoDir, ['status', '--porcelain']);
      expect(typeof result).toBe('string');
    });

    it('유효하지 않은 명령어에 대해 오류를 던져야 한다', async () => {
      await expect(execGit(repoDir, ['invalid-command'])).rejects.toThrow();
    });
  });

  describe('getHeadCommitSha', () => {
    it('HEAD commit SHA를 반환해야 한다', async () => {
      const sha = await getHeadCommitSha(repoDir);

      expect(sha).toMatch(/^[a-f0-9]{40}$/);
    });
  });

  describe('isGitRepository', () => {
    it('Git 저장소인 경우 true를 반환해야 한다', async () => {
      const result = await isGitRepository(repoDir);
      expect(result).toBe(true);
    });

    it('Git 저장소가 아닌 경우 false를 반환해야 한다', async () => {
      const nonGitDir = path.join(tempDir, 'non-git');
      await fs.mkdir(nonGitDir, { recursive: true });

      const result = await isGitRepository(nonGitDir);
      expect(result).toBe(false);
    });
  });

  describe('parseGitStatus', () => {
    it('빈 출력을 빈 배열로 파싱해야 한다', () => {
      const result = parseGitStatus('');
      expect(result).toEqual([]);
    });

    it('추가된 파일(A)을 파싱해야 한다', () => {
      const result = parseGitStatus('A  new-file.ts');
      expect(result).toEqual([{ status: 'A', path: 'new-file.ts' }]);
    });

    it('수정된 파일(M)을 파싱해야 한다', () => {
      const result = parseGitStatus(' M modified-file.ts');
      expect(result).toEqual([{ status: 'M', path: 'modified-file.ts' }]);
    });

    it('삭제된 파일(D)을 파싱해야 한다', () => {
      const result = parseGitStatus(' D deleted-file.ts');
      expect(result).toEqual([{ status: 'D', path: 'deleted-file.ts' }]);
    });

    it('추적되지 않은 파일(??)을 파싱해야 한다', () => {
      const result = parseGitStatus('?? untracked-file.ts');
      expect(result).toEqual([{ status: '?', path: 'untracked-file.ts' }]);
    });

    it('여러 파일을 파싱해야 한다', () => {
      const output = `A  new.ts
 M modified.ts
 D deleted.ts
?? untracked.ts`;

      const result = parseGitStatus(output);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ status: 'A', path: 'new.ts' });
      expect(result[1]).toEqual({ status: 'M', path: 'modified.ts' });
      expect(result[2]).toEqual({ status: 'D', path: 'deleted.ts' });
      expect(result[3]).toEqual({ status: '?', path: 'untracked.ts' });
    });

    it('경로에 공백이 포함된 파일을 처리해야 한다', () => {
      const result = parseGitStatus('?? path with spaces/file.ts');
      expect(result[0]?.path).toBe('path with spaces/file.ts');
    });

    it('이름 변경(R)을 파싱해야 한다', () => {
      const result = parseGitStatus('R  old-name.ts -> new-name.ts');
      expect(result[0]?.status).toBe('R');
    });
  });

  describe('categorizeChangedFiles', () => {
    it('파일을 올바르게 분류해야 한다', () => {
      const entries: GitStatusEntry[] = [
        { status: 'A', path: 'added.ts' },
        { status: '?', path: 'untracked.ts' },
        { status: 'M', path: 'modified.ts' },
        { status: 'D', path: 'deleted.ts' },
        { status: 'R', path: 'renamed.ts' },
      ];

      const result = categorizeChangedFiles(entries);

      expect(result.filesAdded).toEqual(['added.ts', 'untracked.ts']);
      expect(result.filesChanged).toEqual(['modified.ts', 'renamed.ts']);
      expect(result.filesDeleted).toEqual(['deleted.ts']);
    });

    it('빈 배열을 처리해야 한다', () => {
      const result = categorizeChangedFiles([]);

      expect(result.filesAdded).toEqual([]);
      expect(result.filesChanged).toEqual([]);
      expect(result.filesDeleted).toEqual([]);
    });
  });

  describe('createWorktree / removeWorktree', () => {
    it('Git worktree를 생성하고 제거할 수 있어야 한다', async () => {
      const worktreeDir = path.join(tempDir, 'worktree-test');

      // worktree 생성
      await createWorktree(repoDir, worktreeDir);

      // worktree가 존재하는지 확인
      const exists = await fs.access(worktreeDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // README.md가 복사되었는지 확인
      const readmeExists = await fs.access(path.join(worktreeDir, 'README.md')).then(() => true).catch(() => false);
      expect(readmeExists).toBe(true);

      // worktree 제거
      await removeWorktree(repoDir, worktreeDir);

      // worktree가 제거되었는지 확인
      const existsAfter = await fs.access(worktreeDir).then(() => true).catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it('worktree에서 파일을 수정하고 변경 사항을 감지할 수 있어야 한다', async () => {
      const worktreeDir = path.join(tempDir, 'worktree-modify-test');

      await createWorktree(repoDir, worktreeDir);

      // 파일 수정
      await fs.writeFile(path.join(worktreeDir, 'README.md'), '# Modified');
      await fs.writeFile(path.join(worktreeDir, 'new-file.ts'), 'console.log("new")');

      // 변경 사항 감지
      const statusOutput = await execGit(worktreeDir, ['status', '--porcelain']);
      const changes = parseGitStatus(statusOutput);

      expect(changes.length).toBeGreaterThan(0);

      // 정리
      await removeWorktree(repoDir, worktreeDir);
    });
  });
});
