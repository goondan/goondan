/**
 * Git 작업 도구
 *
 * git.status - 상태 확인
 * git.diff - 변경 사항 확인
 * git.log - 커밋 로그
 * git.commit - 커밋 생성
 * git.branch - 브랜치 관리
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { JsonObject, ToolHandler, ToolContext } from '@goondan/core';

const execAsync = promisify(exec);

function getWorkDir(): string {
  return process.env.GOONDAN_WORK_DIR || process.cwd();
}

async function gitCommand(args: string, cwd?: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, {
    cwd: cwd || getWorkDir(),
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

interface GitLogInput {
  limit?: number;
  oneline?: boolean;
  branch?: string;
}

interface GitDiffInput {
  staged?: boolean;
  file?: string;
}

interface GitCommitInput {
  message: string;
  files?: string[];
  all?: boolean;
}

interface GitBranchInput {
  action?: 'list' | 'create' | 'delete' | 'checkout';
  name?: string;
}

export const handlers: Record<string, ToolHandler> = {
  /**
   * Git 상태 확인
   */
  'git.status': async (_ctx: ToolContext, _input: JsonObject) => {
    try {
      const status = await gitCommand('status --porcelain');
      const branch = await gitCommand('branch --show-current');

      const lines = status.split('\n').filter(Boolean);
      const staged: string[] = [];
      const modified: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        const code = line.slice(0, 2);
        const file = line.slice(3);

        if (code[0] === 'A' || code[0] === 'M' || code[0] === 'D' || code[0] === 'R') {
          staged.push(file);
        }
        if (code[1] === 'M' || code[1] === 'D') {
          modified.push(file);
        }
        if (code === '??') {
          untracked.push(file);
        }
      }

      return {
        branch,
        staged,
        modified,
        untracked,
        clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
        summary: `${staged.length} staged, ${modified.length} modified, ${untracked.length} untracked`,
      };
    } catch (error) {
      const err = error as { message?: string };
      return {
        error: 'Git 저장소가 아니거나 git이 설치되지 않았습니다.',
        details: err.message,
      };
    }
  },

  /**
   * 변경 사항 확인
   */
  'git.diff': async (_ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<GitDiffInput>;

    try {
      let cmd = 'diff';
      if (payload.staged) {
        cmd += ' --staged';
      }
      if (payload.file) {
        cmd += ` -- "${payload.file}"`;
      }

      const diff = await gitCommand(cmd);

      if (!diff) {
        return {
          empty: true,
          message: payload.staged ? '스테이지된 변경 사항이 없습니다.' : '변경 사항이 없습니다.',
        };
      }

      // diff를 파일별로 분리
      const files: Array<{ file: string; additions: number; deletions: number; preview: string }> = [];
      const sections = diff.split(/^diff --git /m).filter(Boolean);

      for (const section of sections) {
        const lines = section.split('\n');
        const headerMatch = lines[0]?.match(/a\/(.+?) b\//);
        const file = headerMatch?.[1] || 'unknown';

        let additions = 0;
        let deletions = 0;
        const changeLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            additions++;
            changeLines.push(line);
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            deletions++;
            changeLines.push(line);
          }
        }

        files.push({
          file,
          additions,
          deletions,
          preview: changeLines.slice(0, 20).join('\n'),
        });
      }

      return {
        staged: !!payload.staged,
        filesChanged: files.length,
        files,
        rawDiff: diff.length > 5000 ? diff.slice(0, 5000) + '\n... (truncated)' : diff,
      };
    } catch (error) {
      const err = error as { message?: string };
      return { error: err.message };
    }
  },

  /**
   * 커밋 로그
   */
  'git.log': async (_ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<GitLogInput>;
    const limit = payload.limit ?? 10;

    try {
      let cmd = `log -${limit}`;
      if (payload.oneline) {
        cmd += ' --oneline';
      } else {
        cmd += ' --pretty=format:"%H|%an|%ae|%ar|%s"';
      }
      if (payload.branch) {
        cmd += ` ${payload.branch}`;
      }

      const log = await gitCommand(cmd);
      const lines = log.split('\n').filter(Boolean);

      if (payload.oneline) {
        return {
          count: lines.length,
          commits: lines.map((line) => {
            const [hash, ...messageParts] = line.split(' ');
            return { hash, message: messageParts.join(' ') };
          }),
        };
      }

      const commits = lines.map((line) => {
        const [hash, author, email, date, message] = line.split('|');
        return { hash, author, email, date, message };
      });

      return {
        count: commits.length,
        commits,
      };
    } catch (error) {
      const err = error as { message?: string };
      return { error: err.message };
    }
  },

  /**
   * 커밋 생성
   */
  'git.commit': async (_ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<GitCommitInput>;
    const message = payload.message;

    if (!message) {
      throw new Error('커밋 메시지가 필요합니다.');
    }

    try {
      // 파일 스테이징
      if (payload.all) {
        await gitCommand('add -A');
      } else if (payload.files && payload.files.length > 0) {
        for (const file of payload.files) {
          await gitCommand(`add "${file}"`);
        }
      }

      // 스테이지된 파일 확인
      const staged = await gitCommand('diff --staged --name-only');
      if (!staged) {
        return {
          error: 'commit_failed',
          message: '스테이지된 변경 사항이 없습니다.',
        };
      }

      // 커밋 생성
      const result = await gitCommand(`commit -m "${message.replace(/"/g, '\\"')}"`);

      // 새 커밋 해시 가져오기
      const hash = await gitCommand('rev-parse --short HEAD');

      return {
        success: true,
        hash,
        message,
        filesCommitted: staged.split('\n').filter(Boolean),
        result,
      };
    } catch (error) {
      const err = error as { message?: string };
      return {
        error: 'commit_failed',
        message: err.message,
      };
    }
  },

  /**
   * 브랜치 관리
   */
  'git.branch': async (_ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<GitBranchInput>;
    const action = payload.action || 'list';

    try {
      switch (action) {
        case 'list': {
          const current = await gitCommand('branch --show-current');
          const branches = await gitCommand('branch -a');
          const branchList = branches
            .split('\n')
            .map((b) => b.trim().replace(/^\* /, ''))
            .filter(Boolean);

          return {
            current,
            branches: branchList,
          };
        }

        case 'create': {
          if (!payload.name) {
            throw new Error('브랜치 이름이 필요합니다.');
          }
          await gitCommand(`branch "${payload.name}"`);
          return {
            action: 'created',
            branch: payload.name,
          };
        }

        case 'checkout': {
          if (!payload.name) {
            throw new Error('브랜치 이름이 필요합니다.');
          }
          await gitCommand(`checkout "${payload.name}"`);
          const current = await gitCommand('branch --show-current');
          return {
            action: 'checkout',
            branch: current,
          };
        }

        case 'delete': {
          if (!payload.name) {
            throw new Error('브랜치 이름이 필요합니다.');
          }
          await gitCommand(`branch -d "${payload.name}"`);
          return {
            action: 'deleted',
            branch: payload.name,
          };
        }

        default:
          throw new Error(`지원하지 않는 작업: ${action}`);
      }
    } catch (error) {
      const err = error as { message?: string };
      return { error: err.message };
    }
  },
};
