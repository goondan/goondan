/**
 * Bash Tool - bash 명령어 실행
 * @see /docs/specs/tool.md
 */

import { spawn, type ChildProcess } from 'child_process';
import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

/** bash.exec 입력 타입 */
interface BashExecInput {
  command: string;
  timeout?: number;
  cwd?: string;
}

/** bash.exec 출력 타입 */
interface BashExecOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal: string | null;
  timedOut: boolean;
}

/** 기본 타임아웃 (30초) */
const DEFAULT_TIMEOUT_MS = 30_000;

/** stdout/stderr 최대 길이 (100KB) */
const MAX_OUTPUT_LENGTH = 100_000;

/**
 * 출력 문자열을 최대 길이로 자름
 */
function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) {
    return output;
  }
  const truncationSuffix = '\n... (output truncated)';
  const maxContentLength = maxLength - truncationSuffix.length;
  return output.slice(0, maxContentLength) + truncationSuffix;
}

/** executeBashCommand 옵션 타입 */
interface ExecuteBashOptions {
  timeout: number;
  cwd: string | undefined;
  logger: Console | undefined;
}

/**
 * bash 명령어 실행
 */
async function executeBashCommand(
  command: string,
  options: ExecuteBashOptions
): Promise<BashExecOutput> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const childProcess: ChildProcess = spawn('bash', ['-c', command], {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // stdout 수집
    childProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // stderr 수집
    childProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // 타임아웃 처리
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      options.logger?.warn?.(`[bash.exec] Timeout after ${options.timeout}ms, killing process`);
      childProcess.kill('SIGTERM');

      // SIGTERM으로 종료되지 않으면 SIGKILL
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill('SIGKILL');
        }
      }, 1000);
    }, options.timeout);

    // 에러 처리
    childProcess.on('error', (error: Error) => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      reject(new Error(`프로세스 실행 실패: ${error.message}`));
    });

    // 종료 처리
    childProcess.on('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      resolve({
        exitCode: exitCode ?? -1,
        stdout: truncateOutput(stdout, MAX_OUTPUT_LENGTH),
        stderr: truncateOutput(stderr, MAX_OUTPUT_LENGTH),
        signal: signal,
        timedOut,
      });
    });
  });
}

/**
 * Tool handlers
 */
/**
 * JsonObject에서 BashExecInput을 파싱
 */
function parseBashExecInput(input: JsonObject): BashExecInput {
  const command = input['command'];
  const timeout = input['timeout'];
  const cwd = input['cwd'];

  if (typeof command !== 'string') {
    throw new Error('command는 문자열이어야 합니다.');
  }

  const result: BashExecInput = { command };

  if (typeof timeout === 'number') {
    result.timeout = timeout;
  }

  if (typeof cwd === 'string') {
    result.cwd = cwd;
  }

  return result;
}

export const handlers: Record<string, ToolHandler> = {
  /**
   * bash.exec - bash 명령어 실행
   */
  'bash.exec': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseBashExecInput(input);
    const { command, timeout, cwd } = parsed;

    // 입력 검증
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('command는 비어있지 않은 문자열이어야 합니다.');
    }

    // 타임아웃 설정
    const effectiveTimeout = timeout !== undefined && typeof timeout === 'number' && timeout > 0
      ? timeout
      : DEFAULT_TIMEOUT_MS;

    // cwd 검증
    const effectiveCwd = cwd !== undefined && typeof cwd === 'string' && cwd.trim() !== ''
      ? cwd
      : undefined;

    ctx.logger?.debug?.(`[bash.exec] Executing: ${command}`);
    if (effectiveCwd) {
      ctx.logger?.debug?.(`[bash.exec] Working directory: ${effectiveCwd}`);
    }

    // 명령어 실행
    const result = await executeBashCommand(command, {
      timeout: effectiveTimeout,
      cwd: effectiveCwd,
      logger: ctx.logger,
    });

    ctx.logger?.debug?.(`[bash.exec] Exit code: ${result.exitCode}, timedOut: ${result.timedOut}`);

    // 타임아웃 시 에러 throw
    if (result.timedOut) {
      throw new Error(
        `명령어 실행 타임아웃 (${effectiveTimeout}ms): ${command}\n` +
        `stdout: ${result.stdout}\n` +
        `stderr: ${result.stderr}`
      );
    }

    // 비정상 종료 시에도 결과는 반환 (LLM이 판단하도록)
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      signal: result.signal,
      success: result.exitCode === 0,
    };
  },
};
