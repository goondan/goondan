import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { FileLogService } from '../src/services/logs.js';

async function createStateRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'goondan-cli-logs-'));
}

describe('FileLogService', () => {
  it('active.json의 로그 경로를 사용해 stdout/stderr 로그를 읽는다', async () => {
    const stateRoot = await createStateRoot();

    try {
      const runtimeDir = path.join(stateRoot, 'runtime');
      const logDir = path.join(runtimeDir, 'logs', 'instance-a');
      await mkdir(logDir, { recursive: true });

      const stdoutPath = path.join(logDir, 'orchestrator.stdout.log');
      const stderrPath = path.join(logDir, 'orchestrator.stderr.log');
      await writeFile(stdoutPath, 'a\nb\nc\n', 'utf8');
      await writeFile(stderrPath, 'x\ny\n', 'utf8');

      await writeFile(
        path.join(runtimeDir, 'active.json'),
        JSON.stringify(
          {
            instanceKey: 'instance-a',
            bundlePath: '/tmp/goondan.yaml',
            startedAt: '2026-02-13T00:00:00.000Z',
            watch: false,
            logs: [
              {
                process: 'orchestrator',
                stdout: stdoutPath,
                stderr: stderrPath,
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      const service = new FileLogService({});
      const result = await service.read({
        process: 'orchestrator',
        stream: 'both',
        lines: 2,
        stateRoot,
      });

      expect(result.instanceKey).toBe('instance-a');
      expect(result.chunks.length).toBe(2);
      expect(result.chunks[0]?.lines).toEqual(['b', 'c']);
      expect(result.chunks[1]?.lines).toEqual(['x', 'y']);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('active.json에 로그 정보가 없어도 fallback 경로에서 로그를 읽는다', async () => {
    const stateRoot = await createStateRoot();

    try {
      const logDir = path.join(stateRoot, 'runtime', 'logs', 'instance-b');
      await mkdir(logDir, { recursive: true });
      const stdoutPath = path.join(logDir, 'orchestrator.stdout.log');
      await writeFile(stdoutPath, 'line-1\nline-2\n', 'utf8');

      const service = new FileLogService({});
      const result = await service.read({
        instanceKey: 'instance-b',
        process: 'orchestrator',
        stream: 'stdout',
        lines: 10,
        stateRoot,
      });

      expect(result.instanceKey).toBe('instance-b');
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0]?.path).toBe(stdoutPath);
      expect(result.chunks[0]?.lines).toEqual(['line-1', 'line-2']);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('active 인스턴스가 없고 instance-key도 없으면 오류를 반환한다', async () => {
    const stateRoot = await createStateRoot();

    try {
      const service = new FileLogService({});
      await expect(
        service.read({
          process: 'orchestrator',
          stream: 'stdout',
          lines: 50,
          stateRoot,
        }),
      ).rejects.toThrow(/실행 중인 인스턴스를 찾지 못했습니다/);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
