import path from 'node:path';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isRunnerReadyMessage, isRunnerStartErrorMessage } from './runtime-runner-protocol.js';

interface ProcessLogFile {
  process: string;
  stdout: string;
  stderr: string;
}

interface RuntimeStateFile {
  instanceKey: string;
  bundlePath: string;
  startedAt: string;
  watch: boolean;
  pid?: number;
  logs?: ProcessLogFile[];
}

export interface ReplacementRunnerInput {
  runnerModulePath: string;
  runnerArgs: string[];
  stateRoot: string;
  instanceKey: string;
  bundlePath: string;
  watch: boolean;
  env: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
}

const STARTUP_TIMEOUT_MS = 5_000;
const ORCHESTRATOR_PROCESS_NAME = 'orchestrator';

function resolveProcessLogPaths(stateRoot: string, instanceKey: string, processName: string): { stdoutPath: string; stderrPath: string } {
  const logDir = path.join(stateRoot, 'runtime', 'logs', instanceKey);
  return {
    stdoutPath: path.join(logDir, `${processName}.stdout.log`),
    stderrPath: path.join(logDir, `${processName}.stderr.log`),
  };
}

function closeFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // 이미 닫힌 fd는 무시
  }
}

function killIfRunning(pid: number | undefined): void {
  if (!pid || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // 이미 종료된 경우 무시
  }
}

async function waitForRunnerReady(
  child: ChildProcess,
  instanceKey: string,
  startupTimeoutMs: number,
  logPaths: { stdoutPath: string; stderrPath: string },
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    const fail = (message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        new Error(
          `${message} (logs: ${logPaths.stdoutPath}, ${logPaths.stderrPath})`,
        ),
      );
    };

    const succeed = (pid: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(pid);
    };

    const timeout = setTimeout(() => {
      killIfRunning(child.pid);
      fail('replacement Orchestrator 시작 확인이 시간 내에 완료되지 않았습니다.');
    }, startupTimeoutMs);

    const onMessage = (message: unknown): void => {
      if (isRunnerReadyMessage(message)) {
        if (message.instanceKey !== instanceKey) {
          fail(
            `replacement Orchestrator instanceKey 불일치: expected=${instanceKey}, actual=${message.instanceKey}`,
          );
          return;
        }
        succeed(message.pid);
        return;
      }

      if (isRunnerStartErrorMessage(message)) {
        fail(`replacement Orchestrator 시작 실패: ${message.message}`);
      }
    };

    const onError = (error: Error): void => {
      fail(`replacement Orchestrator 프로세스 오류: ${error.message}`);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const cause = code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : 'unknown reason';
      fail(`replacement Orchestrator가 초기화 중 종료되었습니다 (${cause}).`);
    };

    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

async function writeRuntimeState(input: {
  stateRoot: string;
  instanceKey: string;
  bundlePath: string;
  watch: boolean;
  pid: number;
  logPaths: { stdoutPath: string; stderrPath: string };
}): Promise<void> {
  const runtimeDir = path.join(input.stateRoot, 'runtime');
  await mkdir(runtimeDir, { recursive: true });

  const state: RuntimeStateFile = {
    instanceKey: input.instanceKey,
    bundlePath: input.bundlePath,
    startedAt: new Date().toISOString(),
    watch: input.watch,
    pid: input.pid,
    logs: [
      {
        process: ORCHESTRATOR_PROCESS_NAME,
        stdout: input.logPaths.stdoutPath,
        stderr: input.logPaths.stderrPath,
      },
    ],
  };

  const activePath = path.join(runtimeDir, 'active.json');
  await writeFile(activePath, JSON.stringify(state, null, 2), 'utf8');
}

export async function spawnReplacementRunner(input: ReplacementRunnerInput): Promise<number> {
  const logPaths = resolveProcessLogPaths(input.stateRoot, input.instanceKey, ORCHESTRATOR_PROCESS_NAME);
  await mkdir(path.dirname(logPaths.stdoutPath), { recursive: true });
  const stdoutFd = openSync(logPaths.stdoutPath, 'a');
  const stderrFd = openSync(logPaths.stderrPath, 'a');

  let child: ChildProcess;
  try {
    child = fork(input.runnerModulePath, input.runnerArgs, {
      cwd: path.dirname(input.bundlePath),
      detached: true,
      env: {
        ...input.env,
        GOONDAN_STATE_ROOT: input.stateRoot,
      },
      stdio: ['ignore', stdoutFd, stderrFd, 'ipc'],
    });
  } finally {
    closeFd(stdoutFd);
    closeFd(stderrFd);
  }

  if (!child.pid || child.pid <= 0) {
    throw new Error('replacement Orchestrator 프로세스를 시작하지 못했습니다.');
  }

  const pid = await waitForRunnerReady(child, input.instanceKey, input.startupTimeoutMs ?? STARTUP_TIMEOUT_MS, logPaths)
    .catch((error: unknown) => {
      killIfRunning(child.pid);
      throw error;
    });

  if (child.connected) {
    child.disconnect();
  }
  child.unref();

  await writeRuntimeState({
    stateRoot: input.stateRoot,
    instanceKey: input.instanceKey,
    bundlePath: input.bundlePath,
    watch: input.watch,
    pid,
    logPaths,
  });

  return pid;
}
