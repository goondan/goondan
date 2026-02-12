import path from 'node:path';
import os from 'node:os';
import { access } from 'node:fs/promises';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

describe('FileInstanceStore.list', () => {
  it('workspaces가 없어도 runtime active 인스턴스를 반환한다', async () => {
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
            pid: 12345,
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

  it('동일 키가 있으면 workspace 메타를 유지하면서 running 상태로 병합한다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
      const workspaceDir = path.join(stateRoot, 'workspaces', 'instance-live');
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        path.join(workspaceDir, 'meta.json'),
        JSON.stringify(
          {
            agent: 'telegram-evolver',
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
      expect(rows[0]?.agent).toBe('telegram-evolver');
      expect(rows[0]?.status).toBe('running');
      expect(rows[0]?.createdAt).toBe('2026-02-12 10:00:00');
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('legacy instances 루트(~/.goondan/instances)는 list 기본 조회에서 제외한다', async () => {
    const stateRoot = await createTempStateRoot();

    try {
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
