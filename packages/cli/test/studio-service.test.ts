import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DefaultStudioService } from '../src/services/studio.js';
import type { DeleteInstanceRequest, InstanceRecord, InstanceStore, ListInstancesRequest } from '../src/types.js';

async function createStateRoot(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'goondan-cli-studio-'));
}

function createInstanceStoreStub(rows: InstanceRecord[]): InstanceStore {
  return {
    async list(_request: ListInstancesRequest): Promise<InstanceRecord[]> {
      return rows;
    },
    async delete(_request: DeleteInstanceRequest): Promise<boolean> {
      return false;
    },
  };
}

describe('DefaultStudioService', () => {
  it('messages/runtime-events/log를 집계해 visualization을 만든다', async () => {
    const stateRoot = await createStateRoot();
    const instanceKey = 'instance-1';
    const workspaceRoot = path.join(stateRoot, 'workspaces', 'swarm-a', 'instances', instanceKey);
    const messageDir = path.join(workspaceRoot, 'messages');
    const logDir = path.join(stateRoot, 'runtime', 'logs', instanceKey);

    try {
      await mkdir(messageDir, { recursive: true });
      await mkdir(logDir, { recursive: true });

      await writeFile(
        path.join(workspaceRoot, 'metadata.json'),
        JSON.stringify({
          status: 'idle',
          agentName: 'coder',
          instanceKey,
          createdAt: '2026-02-18T12:00:00.000Z',
          updatedAt: '2026-02-18T12:00:00.000Z',
        }),
        'utf8',
      );

      await writeFile(
        path.join(messageDir, 'base.jsonl'),
        [
          JSON.stringify({
            id: 'm-1',
            createdAt: '2026-02-18T12:00:01.000Z',
            source: { type: 'user' },
            data: { role: 'user', content: 'hello studio' },
          }),
          JSON.stringify({
            id: 'm-2',
            createdAt: '2026-02-18T12:00:02.000Z',
            source: { type: 'assistant', stepId: 's1' },
            data: { role: 'assistant', content: 'hi user' },
          }),
        ].join('\n') + '\n',
        'utf8',
      );

      await writeFile(
        path.join(messageDir, 'events.jsonl'),
        JSON.stringify({
          type: 'append',
          message: {
            id: 'm-3',
            createdAt: '2026-02-18T12:00:03.000Z',
            source: { type: 'tool', toolCallId: 'tc-1', toolName: 'wait__seconds' },
            data: { role: 'tool', content: 'done' },
          },
        }) + '\n',
        'utf8',
      );

      await writeFile(
        path.join(messageDir, 'runtime-events.jsonl'),
        [
          JSON.stringify({
            type: 'tool.called',
            timestamp: '2026-02-18T12:00:04.000Z',
            agentName: 'coder',
            toolCallId: 'tc-2',
            toolName: 'slack__send',
            stepId: 's1',
            turnId: 't1',
          }),
          JSON.stringify({
            type: 'tool.completed',
            timestamp: '2026-02-18T12:00:05.000Z',
            agentName: 'coder',
            toolCallId: 'tc-2',
            toolName: 'slack__send',
            status: 'ok',
            duration: 10,
            stepId: 's1',
            turnId: 't1',
          }),
        ].join('\n') + '\n',
        'utf8',
      );

      await writeFile(
        path.join(logDir, 'orchestrator.stdout.log'),
        '[goondan-runtime][chat/telegram] emitted event name=message.received instanceKey=instance-1\n',
        'utf8',
      );

      const instanceStore = createInstanceStoreStub([
        {
          key: instanceKey,
          status: 'running',
          agent: 'orchestrator',
          createdAt: '2026-02-18 12:00:00',
          updatedAt: '2026-02-18 12:00:00',
        },
      ]);

      const service = new DefaultStudioService({}, instanceStore);
      const visualization = await service.loadVisualization({
        stateRoot,
        instanceKey,
        maxRecentEvents: 3,
      });

      expect(visualization.instanceKey).toBe(instanceKey);
      expect(visualization.participants.some((item) => item.id === 'agent:coder')).toBe(true);
      expect(visualization.participants.some((item) => item.id === 'connector:telegram')).toBe(true);
      expect(visualization.interactions.length).toBeGreaterThan(0);
      expect(visualization.timeline.some((item) => item.subtype === 'tool.called')).toBe(true);
      expect(visualization.timeline.some((item) => item.subtype === 'connector.emitted')).toBe(true);
      expect(visualization.recentEvents.length).toBe(3);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('studio 서버가 정적 자산과 인스턴스 API를 제공한다', async () => {
    const stateRoot = await createStateRoot();
    const instanceStore = createInstanceStoreStub([
      {
        key: 'instance-a',
        status: 'running',
        agent: 'orchestrator',
        createdAt: '2026-02-18 10:00:00',
        updatedAt: '2026-02-18 10:00:00',
      },
    ]);
    const service = new DefaultStudioService({}, instanceStore);

    const server = await service.startServer({
      stateRoot,
      host: '127.0.0.1',
      port: 0,
    });

    try {
      const indexRes = await fetch(server.url);
      const indexText = await indexRes.text();
      expect(indexRes.status).toBe(200);
      expect(indexText).toContain('Goondan Studio');

      const cssRes = await fetch(`${server.url}/studio.css`);
      const cssText = await cssRes.text();
      expect(cssRes.status).toBe(200);
      expect(cssText).toContain('--bg-0');

      const instancesRes = await fetch(`${server.url}/api/instances`);
      const instancesPayload = (await instancesRes.json()) as { items?: Array<{ key: string }> };
      expect(instancesRes.status).toBe(200);
      expect(instancesPayload.items?.[0]?.key).toBe('instance-a');
    } finally {
      await server.close();
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('connector 로그 타임스탬프가 없어도 시각화 호출 간 이벤트 시간이 고정된다', async () => {
    const stateRoot = await createStateRoot();
    const instanceKey = 'instance-stable';
    const workspaceRoot = path.join(stateRoot, 'workspaces', 'swarm-stable', 'instances', instanceKey);
    const messageDir = path.join(workspaceRoot, 'messages');
    const logDir = path.join(stateRoot, 'runtime', 'logs', instanceKey);
    const logPath = path.join(logDir, 'orchestrator.stdout.log');

    try {
      await mkdir(messageDir, { recursive: true });
      await mkdir(logDir, { recursive: true });
      await writeFile(path.join(messageDir, 'base.jsonl'), '', 'utf8');
      await writeFile(
        logPath,
        '[goondan-runtime][chat/slack] emitted event name=app_mention instanceKey=instance-stable\n',
        'utf8',
      );

      const fixedEpochSeconds = 1_700_000_000;
      await utimes(logPath, fixedEpochSeconds, fixedEpochSeconds);

      const service = new DefaultStudioService({}, createInstanceStoreStub([]));
      const first = await service.loadVisualization({
        stateRoot,
        instanceKey,
        maxRecentEvents: 5,
      });
      const second = await service.loadVisualization({
        stateRoot,
        instanceKey,
        maxRecentEvents: 5,
      });

      await writeFile(
        logPath,
        [
          '[goondan-runtime][chat/slack] emitted event name=app_mention instanceKey=instance-stable',
          '[goondan-runtime][chat/slack] emitted event name=app_mention instanceKey=other-instance',
        ].join('\n') + '\n',
        'utf8',
      );

      const third = await service.loadVisualization({
        stateRoot,
        instanceKey,
        maxRecentEvents: 5,
      });

      const firstConnector = first.timeline.find((item) => item.kind === 'connector-log');
      const secondConnector = second.timeline.find((item) => item.kind === 'connector-log');
      const thirdConnectorEvents = third.timeline.filter((item) => item.kind === 'connector-log');

      expect(firstConnector).toBeDefined();
      expect(secondConnector).toBeDefined();
      expect(firstConnector?.at).toBe(secondConnector?.at);
      expect(thirdConnectorEvents.length).toBe(1);
      expect(thirdConnectorEvents[0]?.source).toBe('connector:slack');
      expect(firstConnector?.at).toBe(thirdConnectorEvents[0]?.at);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
