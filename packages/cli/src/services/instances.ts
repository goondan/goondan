import path from 'node:path';
import { readdir, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configError } from '../errors.js';
import type { DeleteInstanceRequest, InstanceRecord, InstanceStore, ListInstancesRequest } from '../types.js';
import { exists, formatDate, isObjectRecord } from '../utils.js';
import { resolveStateRoot } from './config.js';

interface ActiveRuntimeState {
  instanceKey: string;
  bundlePath: string;
  startedAt: string;
  watch: boolean;
  pid?: number;
}

type TerminationStatus = 'not_running' | 'terminated' | 'mismatch' | 'failed';

const execFileAsync = promisify(execFile);

function parseActiveRuntimeState(raw: string): ActiveRuntimeState | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return undefined;
    }

    const instanceKey = parsed['instanceKey'];
    const bundlePath = parsed['bundlePath'];
    const startedAt = parsed['startedAt'];
    const watch = parsed['watch'];
    const pidValue = parsed['pid'];
    const pid = typeof pidValue === 'number' && Number.isInteger(pidValue) && pidValue > 0 ? pidValue : undefined;

    if (
      typeof instanceKey !== 'string' ||
      typeof bundlePath !== 'string' ||
      typeof startedAt !== 'string' ||
      typeof watch !== 'boolean'
    ) {
      return undefined;
    }

    return {
      instanceKey,
      bundlePath,
      startedAt,
      watch,
      pid,
    };
  } catch {
    return undefined;
  }
}

function toDisplayDate(value: string): string | undefined {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return formatDate(parsed);
}

function isProcessAlive(pid: number): boolean {
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

async function readProcessCommand(pid: number): Promise<string | undefined> {
  try {
    const result = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
    const text = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function isManagedRuntimeCommand(command: string, instanceKey: string): boolean {
  const hasRunnerName = command.includes('runtime-runner.js') || command.includes('runtime-runner.ts');
  const hasInstanceFlag = command.includes('--instance-key');
  const hasInstanceKey = command.includes(instanceKey);
  return hasRunnerName && hasInstanceFlag && hasInstanceKey;
}

async function terminateRuntimeProcess(pid: number, force: boolean, instanceKey: string): Promise<TerminationStatus> {
  if (!isProcessAlive(pid)) {
    return 'not_running';
  }

  const command = await readProcessCommand(pid);
  if (!command || !isManagedRuntimeCommand(command, instanceKey)) {
    return 'mismatch';
  }

  if (force) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 프로세스 종료 경쟁 상태는 무시한다.
    }
    await sleep(20);
    return isProcessAlive(pid) ? 'failed' : 'terminated';
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return 'failed';
  }

  for (let index = 0; index < 10; index += 1) {
    await sleep(50);
    if (!isProcessAlive(pid)) {
      return 'terminated';
    }
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // 이미 종료된 경우 무시한다.
  }

  await sleep(20);
  return isProcessAlive(pid) ? 'failed' : 'terminated';
}

async function collectDeleteTargetsForKey(stateRoot: string, key: string): Promise<string[]> {
  const targets = new Set<string>();

  targets.add(path.join(stateRoot, 'workspaces', key));
  targets.add(path.join(stateRoot, 'instances', key));

  const workspacesRoot = path.join(stateRoot, 'workspaces');
  if (await exists(workspacesRoot)) {
    const workspaces = await readdir(workspacesRoot, { withFileTypes: true });
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) {
        continue;
      }
      targets.add(path.join(workspacesRoot, workspace.name, 'instances', key));
    }
  }

  const instancesRoot = path.join(stateRoot, 'instances');
  if (await exists(instancesRoot)) {
    const workspaceCandidates = await readdir(instancesRoot, { withFileTypes: true });
    for (const workspace of workspaceCandidates) {
      if (!workspace.isDirectory()) {
        continue;
      }
      targets.add(path.join(instancesRoot, workspace.name, key));
    }
  }

  return [...targets];
}

function buildActiveInstanceRecord(active: ActiveRuntimeState): InstanceRecord {
  const startedAt = toDisplayDate(active.startedAt) ?? formatDate(new Date());

  let status = 'running';
  if (active.pid && !isProcessAlive(active.pid)) {
    status = 'terminated';
  }

  return {
    key: active.instanceKey,
    agent: 'orchestrator',
    status,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

export class FileInstanceStore implements InstanceStore {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
  }

  async list(request: ListInstancesRequest): Promise<InstanceRecord[]> {
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const activePath = path.join(stateRoot, 'runtime', 'active.json');
    if (!(await exists(activePath))) {
      return [];
    }

    const rawActive = await readFile(activePath, 'utf8');
    const active = parseActiveRuntimeState(rawActive);
    if (!active) {
      return [];
    }

    const record = buildActiveInstanceRecord(active);
    if (request.agent && record.agent.toLowerCase() !== request.agent.toLowerCase()) {
      return [];
    }

    if (request.all) {
      return [record];
    }

    return request.limit > 0 ? [record] : [];
  }

  async delete(request: DeleteInstanceRequest): Promise<boolean> {
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    let deleted = false;

    const activePath = path.join(stateRoot, 'runtime', 'active.json');
    if (await exists(activePath)) {
      const rawActive = await readFile(activePath, 'utf8');
      const active = parseActiveRuntimeState(rawActive);
      if (active && active.instanceKey === request.key) {
        if (active.pid) {
          const termination = await terminateRuntimeProcess(active.pid, request.force, request.key);
          if (termination === 'mismatch') {
            throw configError(
              `PID ${active.pid} 프로세스가 대상 인스턴스(${request.key})와 일치하지 않아 삭제를 중단했습니다.`,
              `ps -p ${active.pid} -o pid,ppid,stat,etime,command 로 확인하세요.`,
            );
          }
          if (termination === 'failed') {
            throw configError(
              `PID ${active.pid} 프로세스를 종료하지 못해 삭제를 중단했습니다.`,
              '--force 옵션으로 재시도하거나 프로세스를 수동 종료 후 다시 실행하세요.',
            );
          }
        }
        await rm(activePath, { force: true });
        await rm(path.join(stateRoot, 'runtime', 'logs', request.key), { recursive: true, force: true });
        deleted = true;
      }
    }

    const targets = await collectDeleteTargetsForKey(stateRoot, request.key);
    for (const target of targets) {
      if (!(await exists(target))) {
        continue;
      }
      await rm(target, { recursive: true, force: true });
      deleted = true;
    }

    return deleted;
  }
}
