/**
 * bun-process-spawner.ts -- RuntimeProcessSpawner의 실제 구현체.
 *
 * Orchestrator가 AgentProcess와 ConnectorProcess를 child process로
 * 스폰하는 데 사용한다.
 *
 * fork() (Node/Bun 호환) + IPC 채널을 사용한다.
 */
import { existsSync } from 'node:fs';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { IpcMessage } from '../types.js';
import type { ManagedChildProcess, RuntimeProcessSpawner } from './types.js';

interface BunProcessSpawnerOptions {
  /** 번들 디렉터리 경로 */
  bundleDir: string;

  /** 상태 저장 루트 */
  stateRoot: string;

  /** 스웜 이름 */
  swarmName?: string;

  /** Connector child runner 경로 (선택, 기본값은 자동 탐색) */
  connectorRunnerPath?: string;
}

/**
 * agent-runner.ts 경로를 해석한다.
 */
function resolveAgentRunnerPath(): string {
  const jsPath = fileURLToPath(new URL('../runner/agent-runner.js', import.meta.url));
  if (existsSync(jsPath)) return jsPath;
  return fileURLToPath(new URL('../runner/agent-runner.ts', import.meta.url));
}

/**
 * connector child runner 경로를 해석한다.
 */
function resolveConnectorRunnerPath(): string {
  const jsPath = fileURLToPath(new URL('../runner/runtime-runner-connector-child.js', import.meta.url));
  if (existsSync(jsPath)) return jsPath;
  return fileURLToPath(new URL('../runner/runtime-runner-connector-child.ts', import.meta.url));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIpcMessage(value: unknown): value is IpcMessage {
  if (!isRecord(value)) return false;
  return (
    (value.type === 'event' || value.type === 'shutdown' || value.type === 'shutdown_ack') &&
    typeof value.from === 'string' &&
    typeof value.to === 'string' &&
    'payload' in value
  );
}

function wrapChildProcess(child: ChildProcess): ManagedChildProcess {
  const msgListeners: Array<(message: IpcMessage) => void> = [];
  const exitListeners: Array<(code: number | null) => void> = [];

  child.on('message', (raw: unknown) => {
    if (isIpcMessage(raw)) {
      for (const listener of msgListeners) {
        listener(raw);
      }
    }
  });

  child.on('exit', (code: number | null) => {
    for (const listener of exitListeners) {
      listener(code);
    }
  });

  return {
    get pid() {
      return child.pid ?? -1;
    },
    send(message: IpcMessage): void {
      if (child.connected && typeof child.send === 'function') {
        child.send(message);
      }
    },
    kill(signal?: 'SIGTERM' | 'SIGKILL'): void {
      child.kill(signal ?? 'SIGTERM');
    },
    onMessage(listener: (message: IpcMessage) => void): void {
      msgListeners.push(listener);
    },
    onExit(listener: (code: number | null) => void): void {
      exitListeners.push(listener);
    },
  };
}

export class BunProcessSpawner implements RuntimeProcessSpawner {
  private readonly bundleDir: string;
  private readonly stateRoot: string;
  private readonly swarmName: string | undefined;
  private readonly connectorRunnerPath: string;

  constructor(options: BunProcessSpawnerOptions) {
    this.bundleDir = options.bundleDir;
    this.stateRoot = options.stateRoot;
    this.swarmName = options.swarmName;
    this.connectorRunnerPath = options.connectorRunnerPath ?? resolveConnectorRunnerPath();
  }

  spawnAgent(agentName: string, instanceKey: string): ManagedChildProcess {
    const agentRunnerPath = resolveAgentRunnerPath();
    const forkArgs = [
      '--bundle-dir', this.bundleDir,
      '--agent-name', agentName,
      '--instance-key', instanceKey,
      '--state-root', this.stateRoot,
    ];

    if (this.swarmName) {
      forkArgs.push('--swarm-name', this.swarmName);
    }

    const child = fork(agentRunnerPath, forkArgs, {
      cwd: this.bundleDir,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    return wrapChildProcess(child);
  }

  spawnConnector(_name: string): ManagedChildProcess {
    const child = fork(this.connectorRunnerPath, [], {
      cwd: this.bundleDir,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    return wrapChildProcess(child);
  }
}
