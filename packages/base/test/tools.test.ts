import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  agentsHandlers,
  bashHandlers,
  fileSystemHandlers,
  selfRestartHandlers,
  waitHandlers,
} from '../src/tools/index.js';
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
    const capturedRequestOptions: Array<{ timeoutMs?: number; async?: boolean } | undefined> = [];
    const capturedSpawns: Array<{ target: string; instanceKey?: string; cwd?: string }> = [];

    const runtime: AgentToolRuntime = {
      async request(target, event, options) {
        captured.push(event);
        capturedRequestOptions.push(options);
        const correlationId = event.replyTo ? event.replyTo.correlationId : 'missing';
        return {
          eventId: event.id,
          target,
          correlationId,
          response: { ok: true, target },
          accepted: true,
          async: options?.async ?? false,
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
      async catalog() {
        return {
          swarmName: 'brain',
          entryAgent: 'coordinator',
          selfAgent: 'coordinator',
          availableAgents: ['builder', 'coordinator', 'researcher', 'reviewer'],
          callableAgents: ['builder', 'researcher', 'reviewer'],
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
      expect(requestOutput.async).toBe(false);

      const asyncRequestResult = await agentsHandlers.request(ctx, {
        target: 'reviewer',
        input: 'check async',
        async: true,
      });
      const asyncRequestOutput = assertJsonObject(asyncRequestResult);
      expect(asyncRequestOutput.async).toBe(true);
      expect(asyncRequestOutput.accepted).toBe(true);

      await expect(
        agentsHandlers.request(ctx, {
          target: 'reviewer',
        }),
      ).rejects.toThrow("'input' must be a non-empty string");

      const sendResult = await agentsHandlers.send(ctx, {
        target: 'planner',
        input: 'fire and forget',
      });
      const sendOutput = assertJsonObject(sendResult);
      expect(sendOutput.accepted).toBe(true);

      await expect(
        agentsHandlers.send(ctx, {
          target: 'planner',
        }),
      ).rejects.toThrow("'input' must be a non-empty string");

      expect(captured.length).toBe(3);
      const firstCaptured = captured[0];
      const secondCaptured = captured[1];
      const thirdCaptured = captured[2];
      if (!firstCaptured || !secondCaptured || !thirdCaptured) {
        throw new Error('Expected three captured events');
      }
      expect(firstCaptured.replyTo).toBeDefined();
      expect(secondCaptured.replyTo).toBeDefined();
      expect(thirdCaptured.replyTo).toBeUndefined();
      expect(firstCaptured.instanceKey).toBe('instance-1');
      expect(secondCaptured.instanceKey).toBe('instance-1');
      expect(thirdCaptured.instanceKey).toBe('instance-1');
      expect(capturedRequestOptions[0]).toEqual({ timeoutMs: 60_000, async: false });
      expect(capturedRequestOptions[1]).toEqual({ timeoutMs: 60_000, async: true });

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

      const catalogResult = await agentsHandlers.catalog(ctx, {});
      const catalogOutput = assertJsonObject(catalogResult);
      expect(catalogOutput.swarmName).toBe('brain');
      expect(catalogOutput.availableCount).toBe(4);
      expect(catalogOutput.callableCount).toBe(3);
    } finally {
      await workspace.cleanup();
    }
  });

  it('wait__seconds delays for the requested duration', async () => {
    const workspace = await createTempWorkspace();
    vi.useFakeTimers();
    try {
      const ctx = createToolContext(workspace.path);
      const promise = waitHandlers.seconds(ctx, {
        seconds: 1.5,
      });
      await vi.advanceTimersByTimeAsync(1500);

      const output = await promise;
      const result = assertJsonObject(output);
      expect(result.waitedSeconds).toBe(1.5);
      expect(result.waitedMs).toBe(1500);

      await expect(
        waitHandlers.seconds(ctx, {
          seconds: 301,
        }),
      ).rejects.toThrow("'seconds' must be less than or equal to 300");
    } finally {
      vi.useRealTimers();
      await workspace.cleanup();
    }
  });

  it('self-restart__request returns runtime restart signal payload', async () => {
    const workspace = await createTempWorkspace();
    try {
      const ctx = createToolContext(workspace.path);
      const output = await selfRestartHandlers.request(ctx, {
        reason: 'update:coordinator-prompt',
      });
      const result = assertJsonObject(output);

      expect(result.ok).toBe(true);
      expect(result.restartRequested).toBe(true);
      expect(result.restartReason).toBe('update:coordinator-prompt');
    } finally {
      await workspace.cleanup();
    }
  });
});
