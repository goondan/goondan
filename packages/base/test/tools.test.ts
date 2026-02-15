import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentsHandlers, bashHandlers, fileSystemHandlers } from '../src/tools/index.js';
import type { AgentEvent, AgentToolRuntime, JsonObject, JsonValue } from '../src/types.js';
import { isJsonObject } from '../src/utils.js';
import { createTempWorkspace, createToolContext } from './helpers.js';

function assertJsonObject(value: JsonValue): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error('Expected JSON object output');
  }
  return value;
}

describe('base tools', () => {
  it('bash__exec executes shell command', async () => {
    const workspace = await createTempWorkspace();
    try {
      const ctx = createToolContext(workspace.path);
      const output = await bashHandlers.exec(ctx, { command: 'printf hello' });
      const result = assertJsonObject(output);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
    } finally {
      await workspace.cleanup();
    }
  });

  it('bash__script executes script file with args', async () => {
    const workspace = await createTempWorkspace();
    try {
      const scriptPath = join(workspace.path, 'script.sh');
      await writeFile(scriptPath, 'echo "script:$1"\n', 'utf8');
      await chmod(scriptPath, 0o755);

      const ctx = createToolContext(workspace.path);
      const output = await bashHandlers.script(ctx, {
        path: 'script.sh',
        args: ['ok'],
      });
      const result = assertJsonObject(output);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('script:ok');
    } finally {
      await workspace.cleanup();
    }
  });

  it('file-system handlers support write/read/list/mkdir', async () => {
    const workspace = await createTempWorkspace();
    try {
      const ctx = createToolContext(workspace.path);

      const mkdirResult = await fileSystemHandlers.mkdir(ctx, {
        path: 'logs',
      });
      const mkdirOutput = assertJsonObject(mkdirResult);
      expect(mkdirOutput.created).toBe(true);

      const writeResult = await fileSystemHandlers.write(ctx, {
        path: 'logs/a.txt',
        content: 'alpha',
      });
      const writeOutput = assertJsonObject(writeResult);
      expect(writeOutput.written).toBe(true);

      const readResult = await fileSystemHandlers.read(ctx, {
        path: 'logs/a.txt',
      });
      const readOutput = assertJsonObject(readResult);
      expect(readOutput.content).toBe('alpha');

      const listResult = await fileSystemHandlers.list(ctx, {
        path: 'logs',
      });
      const listOutput = assertJsonObject(listResult);
      const entriesValue = listOutput.entries;
      expect(Array.isArray(entriesValue)).toBe(true);

      const savedContent = await readFile(join(workspace.path, 'logs/a.txt'), 'utf8');
      expect(savedContent).toBe('alpha');
    } finally {
      await workspace.cleanup();
    }
  });

  it('agents__request/send call runtime abstraction', async () => {
    const captured: AgentEvent[] = [];
    const capturedSpawns: Array<{ target: string; instanceKey?: string; cwd?: string }> = [];

    const runtime: AgentToolRuntime = {
      async request(target, event) {
        captured.push(event);
        const correlationId = event.replyTo ? event.replyTo.correlationId : 'missing';
        return {
          eventId: event.id,
          target,
          correlationId,
          response: { ok: true, target },
        };
      },
      async send(target, event) {
        captured.push(event);
        return {
          eventId: event.id,
          target,
          accepted: true,
        };
      },
      async spawn(target, options) {
        capturedSpawns.push({
          target,
          instanceKey: options?.instanceKey,
          cwd: options?.cwd,
        });
        return {
          target,
          instanceKey: options?.instanceKey ?? 'spawned-instance',
          spawned: true,
          cwd: options?.cwd,
        };
      },
      async list() {
        return {
          agents: [
            {
              target: 'reviewer',
              instanceKey: 'spawned-instance',
              ownerAgent: 'planner',
              ownerInstanceKey: 'instance',
              createdAt: '2026-02-15T00:00:00.000Z',
            },
          ],
        };
      },
    };

    const workspace = await createTempWorkspace();
    try {
      const ctx = createToolContext(workspace.path, runtime);
      const requestResult = await agentsHandlers.request(ctx, {
        target: 'reviewer',
        input: 'check this',
      });

      const requestOutput = assertJsonObject(requestResult);
      expect(requestOutput.target).toBe('reviewer');
      expect(requestOutput.response).toEqual({ ok: true, target: 'reviewer' });

      const sendResult = await agentsHandlers.send(ctx, {
        target: 'planner',
        input: 'fire and forget',
      });
      const sendOutput = assertJsonObject(sendResult);
      expect(sendOutput.accepted).toBe(true);
      expect(captured.length).toBe(2);
      const firstCaptured = captured[0];
      const secondCaptured = captured[1];
      if (!firstCaptured || !secondCaptured) {
        throw new Error('Expected two captured events');
      }
      expect(firstCaptured.replyTo).toBeDefined();
      expect(secondCaptured.replyTo).toBeUndefined();
      expect(firstCaptured.instanceKey).toBe('instance-1');
      expect(secondCaptured.instanceKey).toBe('instance-1');

      const spawnResult = await agentsHandlers.spawn(ctx, {
        target: 'reviewer',
        instanceKey: 'reviewer:1',
        cwd: './apps/reviewer',
      });
      const spawnOutput = assertJsonObject(spawnResult);
      expect(spawnOutput.instanceKey).toBe('reviewer:1');
      expect(capturedSpawns.length).toBe(1);
      const firstSpawn = capturedSpawns[0];
      if (!firstSpawn) {
        throw new Error('Expected one captured spawn request');
      }
      expect(firstSpawn.cwd).toBe('./apps/reviewer');

      const listResult = await agentsHandlers.list(ctx, {
        includeAll: true,
      });
      const listOutput = assertJsonObject(listResult);
      expect(listOutput.count).toBe(1);
    } finally {
      await workspace.cleanup();
    }
  });
});
