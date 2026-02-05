/**
 * Git 작업 유틸리티
 * @see /docs/specs/changeset.md - 4.6, 5.7 Git 명령어
 */

import { spawn } from 'node:child_process';
import type { CommitSummary, GitStatusEntry, GitStatusCode } from './types.js';

/**
 * Git 명령어를 실행한다.
 * @param cwd - 작업 디렉터리
 * @param args - Git 명령어 인자
 * @returns 표준 출력
 * @throws Git 명령어 실행 실패 시
 */
export async function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Git command failed: git ${args.join(' ')}\n${stderr}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * HEAD commit SHA를 조회한다.
 * @param repoDir - Git 저장소 경로
 * @returns commit SHA (40자)
 */
export async function getHeadCommitSha(repoDir: string): Promise<string> {
  const output = await execGit(repoDir, ['rev-parse', 'HEAD']);
  return output.trim();
}

/**
 * 디렉터리가 Git 저장소인지 확인한다.
 * @param dir - 확인할 디렉터리 경로
 * @returns Git 저장소 여부
 */
export async function isGitRepository(dir: string): Promise<boolean> {
  try {
    await execGit(dir, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Git status --porcelain 출력을 파싱한다.
 * @param output - git status --porcelain 출력
 * @returns GitStatusEntry 배열
 */
export function parseGitStatus(output: string): GitStatusEntry[] {
  if (!output.trim()) {
    return [];
  }

  return output
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      // Git status porcelain 형식: XY PATH
      // X: staged 상태, Y: working tree 상태
      // 처음 2문자가 상태 코드, 3번째 문자는 공백, 이후가 경로

      // ?? (untracked), A  (staged new), M (modified), D (deleted), R (renamed)
      const statusPart = line.substring(0, 2);
      let status: GitStatusCode;

      if (statusPart === '??') {
        status = '?';
      } else if (statusPart.startsWith('A')) {
        status = 'A';
      } else if (statusPart.includes('M')) {
        status = 'M';
      } else if (statusPart.includes('D')) {
        status = 'D';
      } else if (statusPart.startsWith('R')) {
        status = 'R';
      } else {
        // 기타 상태는 M으로 처리
        status = 'M';
      }

      // 경로 추출 (3번째 문자부터)
      const pathPart = line.substring(3);

      // 이름 변경의 경우 "old -> new" 형식에서 new 경로만 추출
      let path = pathPart;
      if (status === 'R' && pathPart.includes(' -> ')) {
        const parts = pathPart.split(' -> ');
        path = parts[1] ?? pathPart;
      }

      return { status, path };
    });
}

/**
 * GitStatusEntry 배열을 CommitSummary로 분류한다.
 * @param entries - GitStatusEntry 배열
 * @returns CommitSummary
 */
export function categorizeChangedFiles(entries: GitStatusEntry[]): CommitSummary {
  const filesAdded: string[] = [];
  const filesChanged: string[] = [];
  const filesDeleted: string[] = [];

  for (const entry of entries) {
    switch (entry.status) {
      case 'A':
      case '?':
        filesAdded.push(entry.path);
        break;
      case 'M':
      case 'R':
        filesChanged.push(entry.path);
        break;
      case 'D':
        filesDeleted.push(entry.path);
        break;
    }
  }

  return { filesChanged, filesAdded, filesDeleted };
}

/**
 * Git worktree를 생성한다.
 * @param repoDir - Git 저장소 경로
 * @param worktreeDir - worktree 경로
 * @param commitRef - 체크아웃할 commit (기본값: HEAD)
 */
export async function createWorktree(
  repoDir: string,
  worktreeDir: string,
  commitRef: string = 'HEAD'
): Promise<void> {
  await execGit(repoDir, ['worktree', 'add', worktreeDir, commitRef]);
}

/**
 * Git worktree를 제거한다.
 * @param repoDir - Git 저장소 경로
 * @param worktreeDir - 제거할 worktree 경로
 */
export async function removeWorktree(
  repoDir: string,
  worktreeDir: string
): Promise<void> {
  try {
    await execGit(repoDir, ['worktree', 'remove', worktreeDir, '--force']);
  } catch {
    // worktree가 이미 제거되었거나 존재하지 않는 경우 무시
  }
}
