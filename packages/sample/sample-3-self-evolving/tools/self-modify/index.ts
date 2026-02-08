/**
 * Self-Modify Tool
 *
 * 에이전트가 자신의 프롬프트와 설정을 수정할 수 있게 해주는 도구입니다.
 * Changeset 시스템을 통해 안전하게 변경을 관리합니다.
 *
 * @see /docs/specs/changeset.md
 * @see /docs/specs/tool.md
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

// ============================================================
// Types
// ============================================================

/**
 * JSON 기본 타입
 */
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

/**
 * SwarmBundleRef는 특정 SwarmBundle 스냅샷을 식별하는 불변 식별자이다.
 * Git 기반 구현에서는 "git:<commit-sha>" 형식을 사용한다.
 * @see /docs/specs/changeset.md
 */
type SwarmBundleRef = string;

/**
 * openChangeset 입력
 */
interface OpenChangesetInput {
  reason?: string;
}

/**
 * openChangeset 힌트
 */
interface OpenChangesetHint {
  bundleRootInWorkdir: string;
  recommendedFiles: string[];
}

/**
 * openChangeset 결과
 */
interface OpenChangesetResult {
  changesetId: string;
  baseRef: SwarmBundleRef;
  workdir: string;
  hint?: OpenChangesetHint;
}

/**
 * commitChangeset 입력
 */
interface CommitChangesetInput {
  changesetId: string;
  message?: string;
}

/**
 * 커밋 요약
 */
interface CommitSummary {
  filesChanged: string[];
  filesAdded: string[];
  filesDeleted: string[];
}

/**
 * 커밋 오류
 */
interface CommitError {
  code: string;
  message: string;
  violatedFiles?: string[];
}

/**
 * commitChangeset 결과
 */
interface CommitChangesetResult {
  status: 'ok' | 'rejected' | 'failed';
  changesetId: string;
  baseRef: SwarmBundleRef;
  newRef?: SwarmBundleRef;
  summary?: CommitSummary;
  error?: CommitError;
}

/**
 * SwarmBundle API 인터페이스 (Extension/Tool에서 사용)
 * @see /docs/specs/changeset.md
 */
interface SwarmBundleApi {
  openChangeset: (input?: OpenChangesetInput) => Promise<OpenChangesetResult>;
  commitChangeset: (input: CommitChangesetInput) => Promise<CommitChangesetResult>;
  getActiveRef: () => SwarmBundleRef;
}

/**
 * Tool Context (간소화된 버전)
 *
 * 실제 Runtime에서는 @goondan/core에서 제공하는
 * 전체 ToolContext를 사용합니다.
 */
interface ToolContext {
  /**
   * SwarmBundle 변경 API
   */
  swarmBundle: SwarmBundleApi;

  /**
   * 로거
   */
  logger?: Console;

  /**
   * SwarmBundle 루트 경로
   * (Runtime에서 제공, 여기서는 process.cwd() 사용)
   */
  swarmBundleRoot?: string;
}

/**
 * Tool Handler 시그니처
 */
type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;

// ============================================================
// Git Utilities
// ============================================================

/**
 * Git 명령어를 실행합니다.
 */
async function execGit(cwd: string, args: string[]): Promise<string> {
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

// ============================================================
// Helper Functions
// ============================================================

/**
 * SwarmBundle 루트 경로를 가져옵니다.
 */
function getSwarmBundleRoot(ctx: ToolContext): string {
  // Runtime에서 제공하는 경로를 우선 사용
  if (ctx.swarmBundleRoot) {
    return ctx.swarmBundleRoot;
  }

  // 환경변수에서 가져오기
  if (process.env['GOONDAN_BUNDLE_ROOT']) {
    return process.env['GOONDAN_BUNDLE_ROOT'];
  }

  // 기본값: 현재 작업 디렉터리
  return process.cwd();
}

/**
 * 프롬프트 파일의 절대 경로를 반환합니다.
 */
function resolvePromptPath(bundleRoot: string, promptPath: string): string {
  if (path.isAbsolute(promptPath)) {
    return promptPath;
  }
  return path.join(bundleRoot, promptPath);
}

/**
 * 파일이 존재하는지 확인합니다.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Tool Handlers
// ============================================================

/**
 * self.read-prompt: 현재 시스템 프롬프트를 읽습니다.
 */
async function readPrompt(
  ctx: ToolContext,
  input: JsonObject
): Promise<JsonValue> {
  const bundleRoot = getSwarmBundleRoot(ctx);
  const promptPath = String(input['promptPath'] ?? 'prompts/evolving.system.md');
  const fullPath = resolvePromptPath(bundleRoot, promptPath);

  // 파일 존재 확인
  if (!(await fileExists(fullPath))) {
    return {
      success: false,
      error: `Prompt file not found: ${promptPath}`,
      path: fullPath,
    };
  }

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const stat = await fs.stat(fullPath);

    return {
      success: true,
      path: promptPath,
      fullPath,
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to read prompt: ${message}`,
      path: promptPath,
    };
  }
}

/**
 * self.update-prompt: 시스템 프롬프트를 수정합니다.
 *
 * Changeset을 열고 프롬프트 파일을 수정한 후 커밋합니다.
 * 변경 사항은 다음 Step부터 적용됩니다.
 */
async function updatePrompt(
  ctx: ToolContext,
  input: JsonObject
): Promise<JsonValue> {
  const newContent = input['newContent'];
  if (typeof newContent !== 'string') {
    return {
      success: false,
      error: 'newContent is required and must be a string',
    };
  }

  const promptPath = String(input['promptPath'] ?? 'prompts/evolving.system.md');
  const reason = String(input['reason'] ?? 'Self-modification by agent');

  // 1. Changeset 열기
  ctx.logger?.debug?.(`Opening changeset for prompt update: ${promptPath}`);

  let changesetResult: OpenChangesetResult;
  try {
    changesetResult = await ctx.swarmBundle.openChangeset({
      reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to open changeset: ${message}`,
      stage: 'openChangeset',
    };
  }

  const { changesetId, workdir, baseRef } = changesetResult;

  ctx.logger?.debug?.(`Changeset opened: ${changesetId}`);
  ctx.logger?.debug?.(`Workdir: ${workdir}`);
  ctx.logger?.debug?.(`Base ref: ${baseRef}`);

  // 2. workdir에서 프롬프트 파일 수정
  const targetPath = path.join(workdir, promptPath);

  try {
    // 부모 디렉터리 생성
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    // 파일 쓰기
    await fs.writeFile(targetPath, newContent, 'utf-8');

    ctx.logger?.debug?.(`Prompt file written: ${targetPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to write prompt file: ${message}`,
      stage: 'writeFile',
      changesetId,
    };
  }

  // 3. Changeset 커밋
  const commitMessage = `Update prompt: ${promptPath}\n\nReason: ${reason}`;

  let commitResult: CommitChangesetResult;
  try {
    commitResult = await ctx.swarmBundle.commitChangeset({
      changesetId,
      message: commitMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to commit changeset: ${message}`,
      stage: 'commitChangeset',
      changesetId,
    };
  }

  // 4. 결과 반환
  if (commitResult.status === 'ok') {
    // CommitSummary를 JsonObject로 변환
    const summaryObj: JsonValue = commitResult.summary
      ? {
          filesChanged: commitResult.summary.filesChanged,
          filesAdded: commitResult.summary.filesAdded,
          filesDeleted: commitResult.summary.filesDeleted,
        }
      : null;

    return {
      success: true,
      changesetId,
      baseRef,
      newRef: commitResult.newRef ?? null,
      promptPath,
      summary: summaryObj,
      message: 'Prompt updated successfully. Changes will take effect in the next Step.',
    };
  } else if (commitResult.status === 'rejected') {
    return {
      success: false,
      error: commitResult.error?.message ?? 'Changeset rejected by policy',
      code: commitResult.error?.code ?? null,
      violatedFiles: commitResult.error?.violatedFiles ?? null,
      stage: 'policyValidation',
      changesetId,
    };
  } else {
    return {
      success: false,
      error: commitResult.error?.message ?? 'Changeset commit failed',
      code: commitResult.error?.code ?? null,
      stage: 'commit',
      changesetId,
    };
  }
}

/**
 * self.view-changes: 프롬프트 변경 이력을 조회합니다.
 */
async function viewChanges(
  ctx: ToolContext,
  input: JsonObject
): Promise<JsonValue> {
  const bundleRoot = getSwarmBundleRoot(ctx);
  const maxCount = Number(input['maxCount'] ?? 10);
  const promptPath = input['promptPath'];

  try {
    // Git log 명령어 구성
    const gitArgs = [
      'log',
      `--max-count=${maxCount}`,
      '--format=%H|%s|%ai|%an',
      '--',
    ];

    // 특정 파일만 조회
    if (typeof promptPath === 'string' && promptPath.length > 0) {
      gitArgs.push(promptPath);
    } else {
      gitArgs.push('prompts/', 'resources/');
    }

    const output = await execGit(bundleRoot, gitArgs);

    if (!output.trim()) {
      return {
        success: true,
        changes: [],
        message: 'No changes found in the specified paths.',
      };
    }

    const changes = output
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [commitSha, subject, date, author] = line.split('|');
        return {
          commitSha: commitSha ?? '',
          subject: subject ?? '',
          date: date ?? '',
          author: author ?? '',
        };
      });

    // 현재 활성 ref 조회
    const activeRef = ctx.swarmBundle.getActiveRef();

    return {
      success: true,
      activeRef,
      totalCount: changes.length,
      changes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to retrieve change history: ${message}`,
    };
  }
}

// ============================================================
// Exports
// ============================================================

/**
 * Tool Handler 맵
 *
 * Runtime은 이 객체를 사용하여 tool call을 핸들러에 매핑합니다.
 */
export const handlers: Record<string, ToolHandler> = {
  'self.read-prompt': readPrompt,
  'self.update-prompt': updatePrompt,
  'self.view-changes': viewChanges,
};
