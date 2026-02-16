import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { closeSync, existsSync, openSync } from 'node:fs';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYamlDocuments, WorkspacePaths } from '@goondan/runtime';
import { configError } from '../errors.js';
import { loadRuntimeEnv } from './env.js';
import type {
  ExitCode,
  RuntimeController,
  RuntimeRestartRequest,
  RuntimeRestartResult,
  RuntimeStartRequest,
  RuntimeStartResult,
} from '../types.js';
import { exists, isObjectRecord } from '../utils.js';
import { resolveStateRoot } from './config.js';
import { resolveManifestPath } from './path.js';

interface ProcessLogFile {
  process: string;
  stdout: string;
  stderr: string;
}

interface RunnerReadyMessage {
  type: 'ready';
  instanceKey: string;
  pid: number;
}

interface RunnerStartErrorMessage {
  type: 'start_error';
  message: string;
}

interface RuntimeStateFile {
  instanceKey: string;
  bundlePath: string;
  startedAt: string;
  watch: boolean;
  swarm?: string;
  pid?: number;
  logs?: ProcessLogFile[];
}

function isRunnerReadyMessage(message: unknown): message is RunnerReadyMessage {
  if (!isObjectRecord(message)) {
    return false;
  }

  return message.type === 'ready' && typeof message.instanceKey === 'string' && typeof message.pid === 'number';
}

function isRunnerStartErrorMessage(message: unknown): message is RunnerStartErrorMessage {
  if (!isObjectRecord(message)) {
    return false;
  }

  return message.type === 'start_error' && typeof message.message === 'string';
}

function parseRuntimeState(raw: string): RuntimeStateFile | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return undefined;
    }

    const instanceKey = parsed['instanceKey'];
    const bundlePath = parsed['bundlePath'];
    const startedAt = parsed['startedAt'];
    const watch = parsed['watch'];
    const swarmValue = parsed['swarm'];
    const swarm = typeof swarmValue === 'string' && swarmValue.length > 0 ? swarmValue : undefined;
    const pid = parsed['pid'];
    const logs = parseProcessLogs(parsed['logs']);
    const normalizedPid = typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : undefined;

    if (
      typeof instanceKey === 'string' &&
      typeof bundlePath === 'string' &&
      typeof startedAt === 'string' &&
      typeof watch === 'boolean'
    ) {
      return {
        instanceKey,
        bundlePath,
        startedAt,
        watch,
        swarm,
        pid: normalizedPid,
        logs,
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function parseProcessLogs(value: unknown): ProcessLogFile[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const logs: ProcessLogFile[] = [];
  for (const item of value) {
    if (!isObjectRecord(item)) {
      continue;
    }

    const processName = item['process'];
    const stdout = item['stdout'];
    const stderr = item['stderr'];
    if (typeof processName !== 'string' || typeof stdout !== 'string' || typeof stderr !== 'string') {
      continue;
    }

    if (processName.length === 0 || stdout.length === 0 || stderr.length === 0) {
      continue;
    }

    logs.push({
      process: processName,
      stdout,
      stderr,
    });
  }

  return logs.length > 0 ? logs : undefined;
}

interface RunnerStartInput {
  manifestPath: string;
  stateRoot: string;
  env: NodeJS.ProcessEnv;
  instanceKey: string;
  swarm?: string;
  watch: boolean;
}

interface RunnerReadyResult {
  pid: number;
  process: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  completion?: Promise<ExitCode>;
}

const STARTUP_TIMEOUT_MS = 5000;
const ORCHESTRATOR_PROCESS_NAME = 'orchestrator';

function runtimeRunnerPath(): string {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateRoots = [
    path.resolve(sourceDir, '..', '..', 'node_modules', '@goondan', 'runtime'),
    path.resolve(sourceDir, '..', '..', '..', 'node_modules', '@goondan', 'runtime'),
  ];

  let runtimePackageRoot: string | undefined;
  for (const candidate of candidateRoots) {
    if (existsSync(candidate)) {
      runtimePackageRoot = candidate;
      break;
    }
  }

  if (!runtimePackageRoot) {
    throw new Error(`@goondan/runtime 패키지 경로를 찾을 수 없습니다. candidates=${candidateRoots.join(',')}`);
  }

  const distRunnerPath = path.join(runtimePackageRoot, 'dist', 'runner', 'runtime-runner.js');
  if (existsSync(distRunnerPath)) {
    return distRunnerPath;
  }

  const sourceRunnerPath = path.join(runtimePackageRoot, 'src', 'runner', 'runtime-runner.ts');
  if (existsSync(sourceRunnerPath)) {
    return sourceRunnerPath;
  }

  throw new Error(`@goondan/runtime runner 경로를 찾을 수 없습니다: ${runtimePackageRoot}`);
}

function resolveProcessLogPaths(stateRoot: string, instanceKey: string, processName: string): { stdoutPath: string; stderrPath: string } {
  const logDir = path.join(stateRoot, 'runtime', 'logs', instanceKey);
  return {
    stdoutPath: path.join(logDir, `${processName}.stdout.log`),
    stderrPath: path.join(logDir, `${processName}.stderr.log`),
  };
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminatePreviousProcess(previousPid: number | undefined, replacementPid?: number): Promise<void> {
  if (!previousPid || previousPid <= 0) {
    return;
  }

  if (replacementPid && previousPid === replacementPid) {
    return;
  }

  if (!isProcessAlive(previousPid)) {
    return;
  }

  try {
    process.kill(previousPid, 'SIGTERM');
  } catch {
    return;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(50);
    if (!isProcessAlive(previousPid)) {
      return;
    }
  }

  try {
    process.kill(previousPid, 'SIGKILL');
  } catch {
    // 이미 종료된 경우 무시한다.
  }
}

async function readPackageNameFromManifest(manifestPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const docs = parseYamlDocuments(raw);
    for (const doc of docs) {
      if (!isObjectRecord(doc)) {
        continue;
      }

      if (doc['kind'] !== 'Package') {
        continue;
      }

      const metadata = doc['metadata'];
      if (!isObjectRecord(metadata)) {
        continue;
      }

      const name = metadata['name'];
      if (typeof name === 'string' && name.trim().length > 0) {
        return name.trim();
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveDefaultInstanceKey(
  manifestPath: string,
  stateRoot: string,
): Promise<string> {
  const packageName = await readPackageNameFromManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  const workspace = new WorkspacePaths({
    stateRoot,
    projectRoot,
    packageName,
  });
  return workspace.workspaceId;
}

function buildRunnerArgs(input: RunnerStartInput): string[] {
  const args = [
    '--bundle-path',
    input.manifestPath,
    '--instance-key',
    input.instanceKey,
    '--state-root',
    input.stateRoot,
  ];

  if (input.swarm && input.swarm.length > 0) {
    args.push('--swarm', input.swarm);
  }

  if (input.watch) {
    args.push('--watch');
  }

  return args;
}

function killIfRunning(pid: number | undefined): void {
  if (!pid || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // 프로세스가 이미 내려간 경우 무시한다.
  }
}

function closeFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // 이미 닫힌 경우 무시한다.
  }
}

function normalizeExitCode(code: number | null, signal: NodeJS.Signals | null): ExitCode {
  if (signal === 'SIGINT') {
    return 130;
  }

  if (code === 0 || code === 1 || code === 2 || code === 3 || code === 4 || code === 5 || code === 6 || code === 130) {
    return code;
  }

  return 1;
}

export class LocalRuntimeController implements RuntimeController {
  private readonly cwd: string;

  private readonly env: NodeJS.ProcessEnv;

  constructor(cwd: string, env: NodeJS.ProcessEnv) {
    this.cwd = cwd;
    this.env = env;
  }

  async startOrchestrator(request: RuntimeStartRequest): Promise<RuntimeStartResult> {
    const manifestPath = resolveManifestPath(this.cwd, request.bundlePath);
    const hasManifest = await exists(manifestPath);
    if (!hasManifest) {
      throw configError(`Bundle 파일을 찾을 수 없습니다: ${manifestPath}`, '올바른 bundle 경로를 지정하세요.');
    }

    const runtimeEnv = await loadRuntimeEnv(this.env, {
      projectRoot: path.dirname(manifestPath),
      envFile: request.envFile,
    });

    const stateRoot = resolveStateRoot(request.stateRoot, runtimeEnv);
    const runtimeDir = path.join(stateRoot, 'runtime');
    await mkdir(runtimeDir, { recursive: true });
    const foreground = request.foreground ?? false;

    const instanceKey = request.instanceKey ?? (await resolveDefaultInstanceKey(manifestPath, stateRoot));
    const activePath = path.join(runtimeDir, 'active.json');
    if (await exists(activePath)) {
      const rawActive = await readFile(activePath, 'utf8');
      const active = parseRuntimeState(rawActive);
      if (active && active.instanceKey === instanceKey && isProcessAlive(active.pid)) {
        if (foreground) {
          throw configError(
            `이미 실행 중인 Orchestrator 인스턴스가 있습니다: ${instanceKey}`,
            'foreground 모드는 기존 실행 중인 인스턴스에 attach할 수 없습니다. 기존 프로세스를 종료하거나 --instance-key를 변경하세요.',
          );
        }
        return {
          instanceKey,
          pid: active.pid,
        };
      }
    }

    const runner = foreground
      ? await this.startForegroundRunner({
          manifestPath,
          stateRoot,
          env: runtimeEnv,
          instanceKey,
          swarm: request.swarm,
          watch: request.watch,
        })
      : await this.startDetachedRunner({
          manifestPath,
          stateRoot,
          env: runtimeEnv,
          instanceKey,
          swarm: request.swarm,
          watch: request.watch,
        });
    const state: RuntimeStateFile = {
      instanceKey,
      bundlePath: manifestPath,
      startedAt: new Date().toISOString(),
      watch: request.watch,
      swarm: request.swarm,
      pid: runner.pid,
      logs: [
        {
          process: runner.process,
          stdout: runner.stdoutLogPath,
          stderr: runner.stderrLogPath,
        },
      ],
    };

    await writeFile(activePath, JSON.stringify(state, null, 2), 'utf8');

    return {
      instanceKey,
      pid: runner.pid,
      completion: runner.completion,
    };
  }

  async restart(request: RuntimeRestartRequest): Promise<RuntimeRestartResult> {
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const activePath = path.join(stateRoot, 'runtime', 'active.json');
    const hasActive = await exists(activePath);
    if (!hasActive) {
      throw configError('실행 중인 Orchestrator를 찾지 못했습니다.', '먼저 gdn run으로 Orchestrator를 시작하세요.');
    }

    const raw = await readFile(activePath, 'utf8');
    const state = parseRuntimeState(raw);

    if (!state) {
      throw configError('런타임 상태 파일이 손상되었습니다.', 'state-root/runtime/active.json을 정리한 뒤 다시 실행하세요.');
    }

    if (request.instanceKey && request.instanceKey !== state.instanceKey) {
      throw configError(
        `활성 오케스트레이터 인스턴스와 일치하지 않습니다: ${request.instanceKey}`,
        `현재 활성 인스턴스(${state.instanceKey})를 확인하고 다시 시도하세요.`,
      );
    }

    const manifestPath = state.bundlePath;
    const runtimeEnv = await loadRuntimeEnv(this.env, {
      projectRoot: path.dirname(manifestPath),
    });

    await terminatePreviousProcess(state.pid);

    const runner = await this.startDetachedRunner({
      manifestPath,
      stateRoot,
      env: runtimeEnv,
      instanceKey: state.instanceKey,
      swarm: state.swarm,
      watch: state.watch,
    });

    const refreshedState: RuntimeStateFile = {
      instanceKey: state.instanceKey,
      bundlePath: state.bundlePath,
      startedAt: new Date().toISOString(),
      watch: state.watch,
      swarm: state.swarm,
      pid: runner.pid,
      logs: [
        {
          process: runner.process,
          stdout: runner.stdoutLogPath,
          stderr: runner.stderrLogPath,
        },
      ],
    };

    await writeFile(activePath, JSON.stringify(refreshedState, null, 2), 'utf8');

    const restarted = request.instanceKey
      ? [request.instanceKey]
      : request.agent
        ? [request.agent]
        : [state.instanceKey];

    return {
      restarted,
      instanceKey: state.instanceKey,
      pid: runner.pid,
    };
  }

  private async startDetachedRunner(input: RunnerStartInput): Promise<RunnerReadyResult> {
    const logPaths = resolveProcessLogPaths(input.stateRoot, input.instanceKey, ORCHESTRATOR_PROCESS_NAME);
    await mkdir(path.dirname(logPaths.stdoutPath), { recursive: true });
    const stdoutFd = openSync(logPaths.stdoutPath, 'a');
    const stderrFd = openSync(logPaths.stderrPath, 'a');

    const runnerModulePath = runtimeRunnerPath();
    const args = buildRunnerArgs(input);
    let child: ChildProcess;
    try {
      child = fork(runnerModulePath, args, {
        cwd: path.dirname(input.manifestPath),
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
      throw configError('Orchestrator 프로세스를 시작하지 못했습니다.', 'Node 실행 환경과 권한을 확인하세요.');
    }

    const startup = await new Promise<RunnerReadyResult>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        killIfRunning(child.pid);
        cleanup();
        reject(
          configError(
            'Orchestrator 시작 확인이 시간 내에 완료되지 않았습니다.',
            `설정/환경 변수를 확인하고 다시 실행하세요. (logs: ${logPaths.stdoutPath}, ${logPaths.stderrPath})`,
          ),
        );
      }, STARTUP_TIMEOUT_MS);

      const fail = (message: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(
          configError(
            message,
            `gdn validate로 설정을 점검하고, 필요한 환경 변수를 설정한 뒤 다시 실행하세요. (logs: ${logPaths.stdoutPath}, ${logPaths.stderrPath})`,
          ),
        );
      };

      const succeed = (pid: number): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({
          pid,
          process: ORCHESTRATOR_PROCESS_NAME,
          stdoutLogPath: logPaths.stdoutPath,
          stderrLogPath: logPaths.stderrPath,
        });
      };

      const onMessage = (message: unknown): void => {
        if (isRunnerReadyMessage(message)) {
          if (message.instanceKey !== input.instanceKey) {
            fail(`Orchestrator instanceKey 불일치: expected=${input.instanceKey}, actual=${message.instanceKey}`);
            return;
          }
          succeed(message.pid);
          return;
        }

        if (isRunnerStartErrorMessage(message)) {
          fail(`Orchestrator 시작 실패: ${message.message}`);
        }
      };

      const onError = (error: Error): void => {
        fail(`Orchestrator 프로세스 오류: ${error.message}`);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        const cause = code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : 'unknown reason';
        fail(`Orchestrator가 초기화 중 종료되었습니다 (${cause}).`);
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        child.off('message', onMessage);
        child.off('error', onError);
        child.off('exit', onExit);
      };

      child.on('message', onMessage);
      child.on('error', onError);
      child.on('exit', onExit);
    }).catch((error: unknown) => {
      if (child.pid) {
        killIfRunning(child.pid);
      }
      throw error;
    });

    if (child.connected) {
      child.disconnect();
    }
    child.unref();

    return startup;
  }

  private async startForegroundRunner(input: RunnerStartInput): Promise<RunnerReadyResult> {
    const logPaths = resolveProcessLogPaths(input.stateRoot, input.instanceKey, ORCHESTRATOR_PROCESS_NAME);
    const runnerModulePath = runtimeRunnerPath();
    const args = buildRunnerArgs(input);
    const child = fork(runnerModulePath, args, {
      cwd: path.dirname(input.manifestPath),
      detached: false,
      env: {
        ...input.env,
        GOONDAN_STATE_ROOT: input.stateRoot,
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });

    if (!child.pid || child.pid <= 0) {
      throw configError('Orchestrator 프로세스를 시작하지 못했습니다.', 'Node 실행 환경과 권한을 확인하세요.');
    }

    const completion = new Promise<ExitCode>((resolve) => {
      child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        resolve(normalizeExitCode(code, signal));
      });
    });

    const startup = await new Promise<RunnerReadyResult>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        killIfRunning(child.pid);
        cleanup();
        reject(
          configError(
            'Orchestrator 시작 확인이 시간 내에 완료되지 않았습니다.',
            '설정/환경 변수를 확인한 뒤 다시 실행하세요.',
          ),
        );
      }, STARTUP_TIMEOUT_MS);

      const fail = (message: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(
          configError(
            message,
            'gdn validate로 설정을 점검하고, 필요한 환경 변수를 설정한 뒤 다시 실행하세요.',
          ),
        );
      };

      const succeed = (pid: number): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({
          pid,
          process: ORCHESTRATOR_PROCESS_NAME,
          stdoutLogPath: logPaths.stdoutPath,
          stderrLogPath: logPaths.stderrPath,
          completion,
        });
      };

      const onMessage = (message: unknown): void => {
        if (isRunnerReadyMessage(message)) {
          if (message.instanceKey !== input.instanceKey) {
            fail(`Orchestrator instanceKey 불일치: expected=${input.instanceKey}, actual=${message.instanceKey}`);
            return;
          }
          succeed(message.pid);
          return;
        }

        if (isRunnerStartErrorMessage(message)) {
          fail(`Orchestrator 시작 실패: ${message.message}`);
        }
      };

      const onError = (error: Error): void => {
        fail(`Orchestrator 프로세스 오류: ${error.message}`);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        const cause = code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : 'unknown reason';
        fail(`Orchestrator가 초기화 중 종료되었습니다 (${cause}).`);
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        child.off('message', onMessage);
        child.off('error', onError);
        child.off('exit', onExit);
      };

      child.on('message', onMessage);
      child.on('error', onError);
      child.on('exit', onExit);
    }).catch((error: unknown) => {
      if (child.pid) {
        killIfRunning(child.pid);
      }
      throw error;
    });

    if (child.connected) {
      child.disconnect();
    }

    return startup;
  }
}
