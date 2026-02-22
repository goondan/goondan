import path from 'node:path';
import os from 'node:os';
import { access, readFile } from 'node:fs/promises';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FileInstanceStore } from '../src/services/instances.js';

async function createTempStateRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'goondan-instance-store-'));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPidAlive(pid: number | undefined): boolean {
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

async function readPidFromFile(pidFilePath: string): Promise<number | undefined> {
  try {
    const raw = await readFile(pidFilePath, 'utf8');
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function waitForPidFromFile(pidFilePath: string, timeoutMs: number): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = await readPidFromFile(pidFilePath);
    if (pid !== undefined) {
      return pid;
    }
    await sleep(25);
  }
  return undefined;
}

async function spawnMockRuntimeRunner(instanceKey: string, stateRoot: string): Promise<{
  child: ReturnType<typeof spawn>;
  cleanup: () => Promise<void>;
}> {
  const runnerDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-instance-runner-'));
  const runnerPath = path.join(runnerDir, 'runtime-runner.js');
  await writeFile(runnerPath, "setInterval(() => {}, 1000);\n", 'utf8');

  const child = spawn(
    process.execPath,
    [
      runnerPath,
      '--instance-key',
      instanceKey,
      '--state-root',
      stateRoot,
    ],
    {
      stdio: 'ignore',
    },
  );

  const cleanup = async (): Promise<void> => {
    await terminateProcess(child.pid);
    await rm(runnerDir, { recursive: true, force: true });
  };

  return { child, cleanup };
}

async function spawnMockRuntimeRunnerWithChild(instanceKey: string, stateRoot: string): Promise<{
  child: ReturnType<typeof spawn>;
  childPidPath: string;
  cleanup: () => Promise<void>;
}> {
  const runnerDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-instance-runner-tree-'));
  const runnerPath = path.join(runnerDir, 'runtime-runner.js');
  const workerPath = path.join(runnerDir, 'agent-or-connector-child.js');
  const childPidPath = path.join(runnerDir, 'child.pid');

  await writeFile(workerPath, "setInterval(() => {}, 1000);\n", 'utf8');

  const runnerScript = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    `const child = spawn(process.execPath, [${JSON.stringify(workerPath)}], { stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid ?? ''), 'utf8');`,
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n');
  await writeFile(runnerPath, runnerScript, 'utf8');

  const child = spawn(
    process.execPath,
    [
      runnerPath,
      '--instance-key',
      instanceKey,
      '--state-root',
      stateRoot,
    ],
    {
      stdio: 'ignore',
    },
  );

  const cleanup = async (): Promise<void> => {
    const childPid = await readPidFromFile(childPidPath);
    await terminateProcess(childPid);
    await terminateProcess(child.pid);
    await rm(runnerDir, { recursive: true, force: true });
  };

  return { child, childPidPath, cleanup };
}

async function terminateProcess(pid: number | undefined): Promise<void> {
  if (!pid || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // 이미 종료된 경우 무시
  }
}

describe('FileInstanceStore.list', () => {
  it('runtime active 인스턴스를 오케스트레이터 레코드로 반환한다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
      const runtimeDir = path.join(stateRoot, 'runtime');
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(
        path.join(runtimeDir, 'active.json'),
        JSON.stringify(
          {
            instanceKey: 'instance-live',
            bundlePath: '/tmp/goondan.yaml',
            startedAt: '2026-02-13T00:00:00.000Z',
            watch: false,
            pid: process.pid,
          },
          null,
          2,
        ),
        'utf8',
      );

      const store = new FileInstanceStore({});
      const rows = await store.list({
        limit: 20,
        all: true,
        stateRoot,
      });

      expect(rows.length).toBe(1);
      expect(rows[0]?.key).toBe('instance-live');
      expect(rows[0]?.status).toBe('running');
      expect(rows[0]?.agent).toBe('orchestrator');
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('workspace 인스턴스 메타가 있어도 list에는 반영하지 않는다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
      const workspaceDir = path.join(stateRoot, 'workspaces', 'instance-live', 'instances', 'instance-live');
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        path.join(workspaceDir, 'metadata.json'),
        JSON.stringify(
          {
            agentName: 'telegram-evolver',
            status: 'idle',
            createdAt: '2026-02-12 10:00:00',
            updatedAt: '2026-02-12 10:00:00',
          },
          null,
          2,
        ),
        'utf8',
      );

      const runtimeDir = path.join(stateRoot, 'runtime');
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(
        path.join(runtimeDir, 'active.json'),
        JSON.stringify(
          {
            instanceKey: 'instance-live',
            bundlePath: '/tmp/goondan.yaml',
            startedAt: '2026-02-13T00:00:00.000Z',
            watch: false,
          },
          null,
          2,
        ),
        'utf8',
      );

      const store = new FileInstanceStore({});
      const rows = await store.list({
        limit: 20,
        all: true,
        stateRoot,
      });

      expect(rows.length).toBe(1);
      expect(rows[0]?.key).toBe('instance-live');
      expect(rows[0]?.agent).toBe('orchestrator');
      expect(rows[0]?.status).toBe('running');
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('runtime active가 없으면 legacy/workspace 인스턴스가 있어도 빈 목록을 반환한다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
      const workspaceInstanceDir = path.join(stateRoot, 'workspaces', 'workspace-a', 'instances', 'instance-z');
      await mkdir(workspaceInstanceDir, { recursive: true });
      await writeFile(path.join(workspaceInstanceDir, 'metadata.json'), JSON.stringify({ agentName: 'workspace' }), 'utf8');

      const legacyInstanceDir = path.join(stateRoot, 'instances', 'legacy-workspace', 'legacy-instance');
      await mkdir(legacyInstanceDir, { recursive: true });
      await writeFile(path.join(legacyInstanceDir, 'meta.json'), JSON.stringify({ agent: 'legacy' }), 'utf8');

      const store = new FileInstanceStore({});
      const rows = await store.list({
        limit: 20,
        all: true,
        stateRoot,
      });

      expect(rows.length).toBe(0);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('active.json이 없어도 같은 state-root의 runtime-runner를 목록에 포함한다', async () => {
    const stateRoot = await createTempStateRoot();
    const key = 'instance-detached';
    const runtime = await spawnMockRuntimeRunner(key, stateRoot);

    try {
      await sleep(80);

      const store = new FileInstanceStore({});
      const rows = await store.list({
        limit: 20,
        all: true,
        stateRoot,
      });

      expect(rows.some((row) => row.key === key)).toBe(true);
      const target = rows.find((row) => row.key === key);
      expect(target?.status).toBe('running');
      expect(target?.agent).toBe('orchestrator');
    } finally {
      await runtime.cleanup();
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('runtime-runner 문자열만 포함한 shell 래퍼 프로세스는 목록에서 제외한다', async () => {
    const stateRoot = await createTempStateRoot();
    const fakeKey = 'instance-shell-wrapper';
    const child = spawn(
      '/bin/zsh',
      ['-c', `sleep 3; echo runtime-runner.js --instance-key ${fakeKey} --state-root ${stateRoot} >/dev/null`],
      {
        stdio: 'ignore',
      },
    );

    try {
      await sleep(80);

      const store = new FileInstanceStore({});
      const rows = await store.list({
        limit: 20,
        all: true,
        stateRoot,
      });

      expect(rows.some((row) => row.key === fakeKey)).toBe(false);
    } finally {
      await terminateProcess(child.pid);
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('active pid가 살아있지 않으면 terminated 상태를 반환한다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
      const runtimeDir = path.join(stateRoot, 'runtime');
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(
        path.join(runtimeDir, 'active.json'),
        JSON.stringify(
          {
            instanceKey: 'instance-live',
            bundlePath: '/tmp/goondan.yaml',
            startedAt: '2026-02-13T00:00:00.000Z',
            watch: false,
            pid: 999999,
          },
          null,
          2,
        ),
        'utf8',
      );

      const store = new FileInstanceStore({});
      const rows = await store.list({
        limit: 20,
        all: true,
        stateRoot,
      });

      expect(rows.length).toBe(1);
      expect(rows[0]?.status).toBe('terminated');
      expect(rows[0]?.agent).toBe('orchestrator');
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('nested workspace 인스턴스 디렉터리를 삭제한다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
      const target = path.join(stateRoot, 'workspaces', 'workspace-a', 'instances', 'instance-z');
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, 'meta.json'), JSON.stringify({ agent: 'a' }), 'utf8');

      const store = new FileInstanceStore({});
      const deleted = await store.delete({
        key: 'instance-z',
        force: false,
        stateRoot,
      });

      expect(deleted).toBe(true);
      expect(await pathExists(target)).toBe(false);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('active runtime 인스턴스 삭제 시 active.json 및 로그 디렉터리를 정리한다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
      const runtimeDir = path.join(stateRoot, 'runtime');
      const logDir = path.join(runtimeDir, 'logs', 'instance-live');
      await mkdir(logDir, { recursive: true });
      await writeFile(path.join(logDir, 'orchestrator.stdout.log'), 'hello\n', 'utf8');

      await writeFile(
        path.join(runtimeDir, 'active.json'),
        JSON.stringify(
          {
            instanceKey: 'instance-live',
            bundlePath: '/tmp/goondan.yaml',
            startedAt: '2026-02-13T00:00:00.000Z',
            watch: false,
            pid: 999999,
          },
          null,
          2,
        ),
        'utf8',
      );

      const store = new FileInstanceStore({});
      const deleted = await store.delete({
        key: 'instance-live',
        force: true,
        stateRoot,
      });

      expect(deleted).toBe(true);
      expect(await pathExists(path.join(runtimeDir, 'active.json'))).toBe(false);
      expect(await pathExists(logDir)).toBe(false);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('active가 아니어도 같은 state-root runtime-runner pid를 종료한다', async () => {
    const stateRoot = await createTempStateRoot();
    const key = 'instance-detached-delete';
    const runtime = await spawnMockRuntimeRunner(key, stateRoot);

    try {
      await sleep(80);

      const store = new FileInstanceStore({});
      const deleted = await store.delete({
        key,
        force: true,
        stateRoot,
      });

      expect(deleted).toBe(true);

      await sleep(80);
      expect(isPidAlive(runtime.child.pid)).toBe(false);
    } finally {
      await runtime.cleanup();
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('force 삭제 시 runtime-runner의 자식 프로세스도 함께 종료한다', async () => {
    const stateRoot = await createTempStateRoot();
    const key = 'instance-detached-delete-tree';
    const runtime = await spawnMockRuntimeRunnerWithChild(key, stateRoot);

    try {
      const childPid = await waitForPidFromFile(runtime.childPidPath, 1_000);
      expect(childPid).toBeDefined();
      if (childPid === undefined) {
        throw new Error('mock child pid를 읽지 못했습니다.');
      }

      const store = new FileInstanceStore({});
      const deleted = await store.delete({
        key,
        force: true,
        stateRoot,
      });

      expect(deleted).toBe(true);

      await sleep(120);
      expect(isPidAlive(runtime.child.pid)).toBe(false);
      expect(isPidAlive(childPid)).toBe(false);
    } finally {
      await runtime.cleanup();
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('active runtime pid가 대상 인스턴스와 일치하지 않으면 삭제를 중단한다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
      const runtimeDir = path.join(stateRoot, 'runtime');
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(
        path.join(runtimeDir, 'active.json'),
        JSON.stringify(
          {
            instanceKey: 'instance-live',
            bundlePath: '/tmp/goondan.yaml',
            startedAt: '2026-02-13T00:00:00.000Z',
            watch: false,
            pid: process.pid,
          },
          null,
          2,
        ),
        'utf8',
      );

      const store = new FileInstanceStore({});
      await expect(
        store.delete({
          key: 'instance-live',
          force: true,
          stateRoot,
        }),
      ).rejects.toThrow(/일치하지 않아 삭제를 중단/);

      expect(await pathExists(path.join(runtimeDir, 'active.json'))).toBe(true);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
