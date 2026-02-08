/**
 * SwarmBundleManager 구현
 * @see /docs/specs/changeset.md - 3. SwarmBundleManager 역할
 */

import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type {
  SwarmBundleRef,
  SwarmBundleManager,
  OpenChangesetInput,
  OpenChangesetResult,
  CommitChangesetInput,
  CommitChangesetResult,
  ChangesetPolicy,
  OpenChangesetHint,
} from './types.js';
import { formatSwarmBundleRef } from './types.js';
import {
  execGit,
  getHeadCommitSha,
  parseGitStatus,
  categorizeChangedFiles,
  createWorktree,
  removeWorktree,
} from './git.js';
import { validateChangesetPolicy } from './policy.js';

function parsePorcelainLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function parseConflictingFilesFromPorcelain(output: string): string[] {
  const files = new Set<string>();
  for (const line of parsePorcelainLines(output)) {
    const statusPart = line.substring(0, 2);
    if (
      statusPart.includes('U') ||
      statusPart === 'AA' ||
      statusPart === 'DD'
    ) {
      const filePath = line.substring(3).trim();
      if (filePath.length > 0) {
        files.add(filePath);
      }
    }
  }
  return Array.from(files);
}

function extractCommitSha(ref: SwarmBundleRef): string | null {
  if (!ref.startsWith('git:')) {
    return null;
  }
  const commitSha = ref.slice(4);
  return commitSha.length > 0 ? commitSha : null;
}

function isConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('conflict') ||
    message.includes('not possible to fast-forward') ||
    message.includes('merge') && message.includes('abort')
  );
}

/**
 * SwarmBundleManager 생성 옵션
 */
export interface SwarmBundleManagerOptions {
  /**
   * SwarmBundle 루트 디렉터리 (Git 저장소)
   */
  swarmBundleRoot: string;

  /**
   * Goondan 홈 디렉터리 (System State Root)
   */
  goondanHome: string;

  /**
   * 워크스페이스 ID
   */
  workspaceId: string;

  /**
   * Swarm 수준 Changeset 정책
   */
  swarmPolicy?: ChangesetPolicy;

  /**
   * Agent 수준 Changeset 정책
   */
  agentPolicy?: ChangesetPolicy;
}

/**
 * Changeset 메타데이터
 */
interface ChangesetMetadata {
  changesetId: string;
  baseRef: SwarmBundleRef;
  workdir: string;
  reason?: string;
  createdAt: string;
}

/**
 * SwarmBundleManager 구현체
 */
export class SwarmBundleManagerImpl implements SwarmBundleManager {
  private readonly swarmBundleRoot: string;
  private readonly goondanHome: string;
  private readonly workspaceId: string;
  private readonly swarmPolicy?: ChangesetPolicy;
  private readonly agentPolicy?: ChangesetPolicy;

  /**
   * 열린 changeset 목록
   */
  private readonly openChangesets: Map<string, ChangesetMetadata> = new Map();

  /**
   * 현재 활성 Ref (캐시)
   */
  private cachedActiveRef?: SwarmBundleRef;

  constructor(options: SwarmBundleManagerOptions) {
    this.swarmBundleRoot = options.swarmBundleRoot;
    this.goondanHome = options.goondanHome;
    this.workspaceId = options.workspaceId;
    this.swarmPolicy = options.swarmPolicy;
    this.agentPolicy = options.agentPolicy;
  }

  /**
   * 현재 활성 SwarmBundleRef를 반환한다.
   */
  async getActiveRef(): Promise<SwarmBundleRef> {
    const commitSha = await getHeadCommitSha(this.swarmBundleRoot);
    const ref = formatSwarmBundleRef(commitSha);
    this.cachedActiveRef = ref;
    return ref;
  }

  /**
   * 동기적으로 캐시된 활성 Ref를 반환한다.
   * 캐시가 없으면 동기적으로 Git을 호출하지 않고 빈 문자열을 반환한다.
   */
  getActiveRefSync(): SwarmBundleRef {
    return this.cachedActiveRef ?? '';
  }

  /**
   * 새 Changeset을 열고 Git worktree를 생성한다.
   */
  async openChangeset(input?: OpenChangesetInput): Promise<OpenChangesetResult> {
    // 1. changesetId 생성
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const changesetId = `cs-${timestamp}-${randomSuffix}`;

    // 2. worktree 경로 결정
    // <goondanHome>/worktrees/<workspaceId>/changesets/<changesetId>/
    const workdir = path.join(
      this.goondanHome,
      'worktrees',
      this.workspaceId,
      'changesets',
      changesetId
    );

    // 3. worktree 부모 디렉터리 생성
    await fs.mkdir(path.dirname(workdir), { recursive: true });

    // 4. 현재 HEAD의 commit SHA 조회
    const headSha = await getHeadCommitSha(this.swarmBundleRoot);
    const baseRef = formatSwarmBundleRef(headSha);

    // 5. Git worktree 생성
    await createWorktree(this.swarmBundleRoot, workdir);

    // 6. 힌트 생성
    const hint: OpenChangesetHint = {
      bundleRootInWorkdir: '.',
      recommendedFiles: [
        'goondan.yaml',
        'resources/**',
        'prompts/**',
        'tools/**',
        'extensions/**',
      ],
    };

    // 7. 메타데이터 저장
    const metadata: ChangesetMetadata = {
      changesetId,
      baseRef,
      workdir,
      reason: input?.reason,
      createdAt: new Date().toISOString(),
    };
    this.openChangesets.set(changesetId, metadata);

    // 8. 결과 반환
    return {
      changesetId,
      baseRef,
      workdir,
      hint,
    };
  }

  /**
   * Changeset의 변경 사항을 Git commit으로 만들고 활성 Ref를 업데이트한다.
   */
  async commitChangeset(input: CommitChangesetInput): Promise<CommitChangesetResult> {
    const { changesetId, message } = input;

    // 1. changeset 메타데이터 조회
    const metadata = this.openChangesets.get(changesetId);

    // worktree 경로 결정 (메타데이터가 없으면 경로 추측)
    const workdir = metadata?.workdir ?? path.join(
      this.goondanHome,
      'worktrees',
      this.workspaceId,
      'changesets',
      changesetId
    );

    // 2. worktree 존재 확인
    const exists = await fs.access(workdir).then(() => true).catch(() => false);
    if (!exists) {
      return {
        status: 'failed',
        changesetId,
        baseRef: metadata?.baseRef ?? 'unknown',
        error: {
          code: 'CHANGESET_NOT_FOUND',
          message: `Changeset ${changesetId}를 찾을 수 없습니다.`,
        },
      };
    }

    // 3. baseRef 조회
    const baseRef = metadata?.baseRef ?? formatSwarmBundleRef(
      await getHeadCommitSha(this.swarmBundleRoot)
    );

    // 4. 변경된 파일 목록 조회
    const statusOutput = await execGit(workdir, ['status', '--porcelain']);
    const conflictingFiles = parseConflictingFilesFromPorcelain(statusOutput);
    if (conflictingFiles.length > 0) {
      return {
        status: 'conflict',
        changesetId,
        baseRef,
        error: {
          code: 'MERGE_CONFLICT',
          message:
            '충돌 파일이 남아 있습니다. 충돌을 해결한 뒤 다시 commitChangeset을 호출하세요.',
          conflictingFiles,
        },
      };
    }

    const changedEntries = parseGitStatus(statusOutput);

    // 5. 변경 사항이 없으면 early return
    if (changedEntries.length === 0) {
      // worktree 정리
      await this.cleanupWorktree(changesetId, workdir);

      return {
        status: 'ok',
        changesetId,
        baseRef,
        newRef: baseRef,
        summary: {
          filesChanged: [],
          filesAdded: [],
          filesDeleted: [],
        },
      };
    }

    // 6. ChangesetPolicy 검증
    const changedFilePaths = changedEntries.map(e => e.path);
    const validation = validateChangesetPolicy(
      changedFilePaths,
      this.swarmPolicy,
      this.agentPolicy
    );

    if (!validation.valid) {
      // worktree 정리
      await this.cleanupWorktree(changesetId, workdir);

      return {
        status: 'rejected',
        changesetId,
        baseRef,
        error: {
          code: 'POLICY_VIOLATION',
          message: 'ChangesetPolicy에 의해 허용되지 않은 파일이 변경되었습니다.',
          violatedFiles: validation.violatedFiles,
        },
      };
    }

    // 7. Git 작업 수행
    const branchName = `changeset-${changesetId}`;
    const summary = categorizeChangedFiles(changedEntries);

    try {
      // 7.1. 모든 변경 사항 스테이징
      await execGit(workdir, ['add', '-A']);

      // 7.2. 커밋 생성
      const commitMessage = message ?? `Changeset ${changesetId}`;
      await execGit(workdir, ['commit', '-m', commitMessage]);

      // 7.3. baseRef 이후 정본이 앞섰다면 workdir에서 먼저 병합 시도
      const rootHeadSha = await getHeadCommitSha(this.swarmBundleRoot);
      const baseCommitSha = extractCommitSha(baseRef);
      if (baseCommitSha && baseCommitSha !== rootHeadSha) {
        try {
          await execGit(workdir, ['merge', '--no-ff', '--no-edit', rootHeadSha]);
        } catch (error) {
          const unmergedFiles = await this.collectUnmergedFiles(workdir);
          if (unmergedFiles.length > 0 || isConflictError(error)) {
            return {
              status: 'conflict',
              changesetId,
              baseRef,
              error: {
                code: 'MERGE_CONFLICT',
                message:
                  '다른 changeset이 먼저 반영되었습니다. 충돌 파일을 해결한 뒤 다시 commitChangeset을 호출하세요.',
                conflictingFiles:
                  unmergedFiles.length > 0 ? unmergedFiles : changedFilePaths,
              },
            };
          }
          throw error;
        }
      }

      // 7.4. 새 commit SHA 조회
      const newSha = await getHeadCommitSha(workdir);
      const newRef = formatSwarmBundleRef(newSha);

      // 7.5. SwarmBundleRoot로 변경 사항 반영
      await execGit(this.swarmBundleRoot, ['fetch', workdir, `HEAD:${branchName}`]);
      try {
        await execGit(this.swarmBundleRoot, ['merge', '--ff-only', branchName]);
      } catch (error) {
        const conflictFiles = await this.collectConflictFiles(workdir, changedFilePaths);
        if (!isConflictError(error) && conflictFiles.length === 0) {
          throw error;
        }

        await this.deleteBranch(branchName);
        return {
          status: 'conflict',
          changesetId,
          baseRef,
          error: {
            code: 'MERGE_CONFLICT',
            message:
              'ff-only merge 실패: 다른 changeset이 먼저 반영되었습니다. 충돌 파일을 수정한 뒤 재시도하세요.',
            conflictingFiles: conflictFiles.length > 0 ? conflictFiles : changedFilePaths,
          },
        };
      }

      // 7.6. 정리
      await this.cleanupWorktree(changesetId, workdir);
      await this.deleteBranch(branchName);

      // 캐시 업데이트
      this.cachedActiveRef = newRef;

      // 8. 성공 결과 반환
      return {
        status: 'ok',
        changesetId,
        baseRef,
        newRef,
        summary,
      };
    } catch (error) {
      // worktree 정리 시도
      try {
        await this.cleanupWorktree(changesetId, workdir);
      } catch {
        // 정리 실패 무시
      }
      await this.deleteBranch(branchName);

      return {
        status: 'failed',
        changesetId,
        baseRef,
        error: {
          code: 'GIT_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * 열린 Changeset을 정리(폐기)한다.
   */
  async discardChangeset(changesetId: string): Promise<void> {
    const metadata = this.openChangesets.get(changesetId);

    if (metadata) {
      await this.cleanupWorktree(changesetId, metadata.workdir);
    } else {
      // 메타데이터가 없으면 경로 추측하여 정리 시도
      const workdir = path.join(
        this.goondanHome,
        'worktrees',
        this.workspaceId,
        'changesets',
        changesetId
      );

      const exists = await fs.access(workdir).then(() => true).catch(() => false);
      if (exists) {
        await removeWorktree(this.swarmBundleRoot, workdir);
      }
    }
  }

  /**
   * worktree를 정리한다.
   */
  private async cleanupWorktree(changesetId: string, workdir: string): Promise<void> {
    this.openChangesets.delete(changesetId);
    await removeWorktree(this.swarmBundleRoot, workdir);
  }

  private async collectUnmergedFiles(workdir: string): Promise<string[]> {
    try {
      const output = await execGit(workdir, ['diff', '--name-only', '--diff-filter=U']);
      const fromDiff = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return Array.from(new Set(fromDiff));
    } catch {
      return [];
    }
  }

  private async collectConflictFiles(
    workdir: string,
    fallbackFiles: string[]
  ): Promise<string[]> {
    const unmergedFiles = await this.collectUnmergedFiles(workdir);
    if (unmergedFiles.length > 0) {
      return unmergedFiles;
    }
    return Array.from(new Set(fallbackFiles));
  }

  private async deleteBranch(branchName: string): Promise<void> {
    try {
      await execGit(this.swarmBundleRoot, ['branch', '-D', branchName]);
    } catch {
      // ignore
    }
  }
}
