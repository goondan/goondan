import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { spawnReplacementRunner } from '../src/services/runtime-restart.js';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('spawnReplacementRunner', () => {
  it('replacement runner를 기동하고 active.json을 갱신한다', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-cli-restart-'));
    const stateRoot = path.join(rootDir, 'state');
    const bundlePath = path.join(rootDir, 'goondan.yaml');
    const runnerPath = path.join(rootDir, 'fake-runner-ready.js');
    let pid: number | undefined;

    try {
      await writeFile(bundlePath, 'apiVersion: goondan.ai/v1\n', 'utf8');
      await writeFile(
        runnerPath,
        [
          "function getArg(name) {",
          "  const index = process.argv.indexOf(name);",
          "  if (index === -1) return undefined;",
          "  return process.argv[index + 1];",
          "}",
          "const instanceKey = getArg('--instance-key') ?? 'unknown';",
          "if (typeof process.send === 'function') {",
          "  process.send({ type: 'ready', instanceKey, pid: process.pid });",
          "}",
          "setInterval(() => {}, 1000);",
        ].join('\n'),
        'utf8',
      );

      pid = await spawnReplacementRunner({
        runnerModulePath: runnerPath,
        runnerArgs: ['--bundle-path', bundlePath, '--instance-key', 'sample-key', '--state-root', stateRoot],
        stateRoot,
        instanceKey: 'sample-key',
        bundlePath,
        watch: false,
        env: process.env,
      });

      expect(pid).toBeGreaterThan(0);
      expect(isProcessAlive(pid)).toBe(true);

      const activePath = path.join(stateRoot, 'runtime', 'active.json');
      const activeRaw = await readFile(activePath, 'utf8');
      const activeState: unknown = JSON.parse(activeRaw);
      if (typeof activeState !== 'object' || activeState === null) {
        throw new Error('active.json이 객체가 아닙니다.');
      }

      if (!('pid' in activeState) || typeof activeState.pid !== 'number') {
        throw new Error('active.json pid가 유효하지 않습니다.');
      }

      expect(activeState.pid).toBe(pid);
    } finally {
      if (pid && isProcessAlive(pid)) {
        process.kill(pid, 'SIGTERM');
        await waitForProcessExit(pid);
      }
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('replacement runner가 start_error를 보내면 실패한다', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-cli-restart-'));
    const stateRoot = path.join(rootDir, 'state');
    const bundlePath = path.join(rootDir, 'goondan.yaml');
    const runnerPath = path.join(rootDir, 'fake-runner-error.js');

    try {
      await writeFile(bundlePath, 'apiVersion: goondan.ai/v1\n', 'utf8');
      await writeFile(
        runnerPath,
        [
          "if (typeof process.send === 'function') {",
          "  process.send({ type: 'start_error', message: 'boom' });",
          "}",
          'setTimeout(() => process.exit(1), 10);',
        ].join('\n'),
        'utf8',
      );

      await expect(
        spawnReplacementRunner({
          runnerModulePath: runnerPath,
          runnerArgs: ['--bundle-path', bundlePath, '--instance-key', 'sample-key', '--state-root', stateRoot],
          stateRoot,
          instanceKey: 'sample-key',
          bundlePath,
          watch: false,
          env: process.env,
          startupTimeoutMs: 1500,
        }),
      ).rejects.toThrow(/start_error|시작 실패|boom|replacement Orchestrator/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
