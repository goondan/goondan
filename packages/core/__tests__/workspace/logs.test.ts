/**
 * 로그 시스템 테스트
 * @see /docs/specs/workspace.md - 섹션 6, 7: Message State Log, Event Log 스키마
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  JsonlWriter,
  MessageBaseLogger,
  MessageEventLogger,
  SwarmEventLogger,
  AgentEventLogger,
  TurnMetricsLogger,
} from '../../src/workspace/logs.js';
import type {
  MessageBaseLogRecord,
  MessageEventLogRecord,
  SwarmEventLogRecord,
  AgentEventLogRecord,
  TurnMetricsLogRecord,
} from '../../src/workspace/types.js';

describe('JsonlWriter', () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    logFile = path.join(tempDir, 'test.jsonl');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('append', () => {
    it('레코드를 JSON 라인으로 추가해야 한다', async () => {
      const writer = new JsonlWriter<{ id: number; name: string }>(logFile);
      await writer.append({ id: 1, name: 'test' });

      const content = await fs.readFile(logFile, 'utf8');
      expect(content.trim()).toBe('{"id":1,"name":"test"}');
    });

    it('여러 레코드를 각각 한 줄로 추가해야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(logFile);
      await writer.append({ id: 1 });
      await writer.append({ id: 2 });
      await writer.append({ id: 3 });

      const content = await fs.readFile(logFile, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);
      expect(JSON.parse(lines[0])).toEqual({ id: 1 });
      expect(JSON.parse(lines[1])).toEqual({ id: 2 });
      expect(JSON.parse(lines[2])).toEqual({ id: 3 });
    });

    it('디렉터리가 없으면 자동으로 생성해야 한다', async () => {
      const nestedFile = path.join(tempDir, 'a', 'b', 'c', 'test.jsonl');
      const writer = new JsonlWriter<{ data: string }>(nestedFile);
      await writer.append({ data: 'test' });

      const exists = await fs
        .stat(nestedFile)
        .then(s => s.isFile())
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('appendMany', () => {
    it('여러 레코드를 한 번에 추가해야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(logFile);
      await writer.appendMany([{ id: 1 }, { id: 2 }, { id: 3 }]);

      const content = await fs.readFile(logFile, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);
    });

    it('빈 배열은 파일을 변경하지 않아야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(logFile);
      await writer.appendMany([]);

      const exists = await fs
        .stat(logFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('read (async generator)', () => {
    it('파일의 모든 레코드를 순회해야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(logFile);
      await writer.append({ id: 1 });
      await writer.append({ id: 2 });
      await writer.append({ id: 3 });

      const records: Array<{ id: number }> = [];
      for await (const record of writer.read()) {
        records.push(record);
      }

      expect(records).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it('파일이 없으면 빈 generator를 반환해야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(path.join(tempDir, 'nonexistent.jsonl'));
      const records: Array<{ id: number }> = [];
      for await (const record of writer.read()) {
        records.push(record);
      }
      expect(records).toEqual([]);
    });

    it('빈 줄을 무시해야 한다', async () => {
      await fs.writeFile(logFile, '{"id":1}\n\n{"id":2}\n\n', 'utf8');

      const writer = new JsonlWriter<{ id: number }>(logFile);
      const records: Array<{ id: number }> = [];
      for await (const record of writer.read()) {
        records.push(record);
      }
      expect(records).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('readAll', () => {
    it('모든 레코드를 배열로 반환해야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(logFile);
      await writer.append({ id: 1 });
      await writer.append({ id: 2 });

      const records = await writer.readAll();
      expect(records).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('파일이 없으면 빈 배열을 반환해야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(path.join(tempDir, 'nonexistent.jsonl'));
      const records = await writer.readAll();
      expect(records).toEqual([]);
    });
  });

  describe('truncateAndWriteAll', () => {
    it('파일을 잘라내고 새 레코드를 기록해야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(logFile);
      await writer.append({ id: 1 });
      await writer.append({ id: 2 });

      await writer.truncateAndWriteAll([{ id: 10 }, { id: 20 }]);

      const records = await writer.readAll();
      expect(records).toEqual([{ id: 10 }, { id: 20 }]);
    });

    it('빈 배열로 호출하면 파일을 비워야 한다', async () => {
      const writer = new JsonlWriter<{ id: number }>(logFile);
      await writer.append({ id: 1 });

      await writer.truncateAndWriteAll([]);

      const records = await writer.readAll();
      expect(records).toEqual([]);
    });

    it('디렉터리가 없으면 자동으로 생성해야 한다', async () => {
      const nestedFile = path.join(tempDir, 'x', 'y', 'z', 'test.jsonl');
      const writer = new JsonlWriter<{ data: string }>(nestedFile);
      await writer.truncateAndWriteAll([{ data: 'hello' }]);

      const records = await writer.readAll();
      expect(records).toEqual([{ data: 'hello' }]);
    });
  });

  describe('UTF-8 인코딩', () => {
    it('유니코드 문자를 올바르게 처리해야 한다', async () => {
      const writer = new JsonlWriter<{ message: string }>(logFile);
      await writer.append({ message: '안녕하세요 Hello' });

      const records = await writer.readAll();
      expect(records[0].message).toBe('안녕하세요 Hello');
    });

    it('이모지를 올바르게 처리해야 한다', async () => {
      const writer = new JsonlWriter<{ emoji: string }>(logFile);
      await writer.append({ emoji: 'a b c' });

      const records = await writer.readAll();
      expect(records[0].emoji).toBe('a b c');
    });
  });
});

describe('MessageBaseLogger', () => {
  let tempDir: string;
  let logFile: string;
  let logger: MessageBaseLogger;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    logFile = path.join(tempDir, 'base.jsonl');
    logger = new MessageBaseLogger(logFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('appendDelta', () => {
    it('각 메시지를 개별 레코드로 기록해야 한다', async () => {
      await logger.appendDelta({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        startSeq: 0,
        messages: [
          { id: 'msg-001', role: 'user', content: 'Hello' },
          { id: 'msg-002', role: 'assistant', content: 'Hi' },
        ],
      });

      const records = await logger.readAll();
      expect(records.length).toBe(2);
      expect(records[0].type).toBe('message.base');
      expect(records[0].traceId).toBe('trace-a1b2c3');
      expect(records[0].instanceId).toBe('default-cli');
      expect(records[0].message).toEqual({ id: 'msg-001', role: 'user', content: 'Hello' });
      expect(records[0].seq).toBe(0);
      expect(records[1].message).toEqual({ id: 'msg-002', role: 'assistant', content: 'Hi' });
      expect(records[1].seq).toBe(1);
    });

    it('startSeq 오프셋이 올바르게 반영되어야 한다', async () => {
      await logger.appendDelta({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-002',
        startSeq: 3,
        messages: [
          { id: 'msg-004', role: 'user', content: 'Question' },
        ],
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].seq).toBe(3);
    });

    it('recordedAt을 자동으로 설정해야 한다', async () => {
      const before = new Date().toISOString();
      await logger.appendDelta({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        startSeq: 0,
        messages: [{ id: 'msg-001', role: 'user', content: 'Hello' }],
      });
      const after = new Date().toISOString();

      const records = await logger.readAll();
      expect(records[0].recordedAt >= before).toBe(true);
      expect(records[0].recordedAt <= after).toBe(true);
    });

    it('빈 메시지 배열은 아무 것도 기록하지 않아야 한다', async () => {
      await logger.appendDelta({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        startSeq: 0,
        messages: [],
      });

      const records = await logger.readAll();
      expect(records.length).toBe(0);
    });
  });

  describe('rewrite', () => {
    it('기존 레코드를 모두 교체해야 한다', async () => {
      // 먼저 초기 데이터 기록
      await logger.appendDelta({
        traceId: 'trace-old',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        startSeq: 0,
        messages: [
          { id: 'msg-001', role: 'user', content: 'Hello' },
          { id: 'msg-002', role: 'assistant', content: 'Hi' },
        ],
      });

      // rewrite로 교체
      await logger.rewrite({
        traceId: 'trace-new',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-002',
        messages: [
          { id: 'msg-001', role: 'user', content: 'Updated Hello' },
        ],
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].traceId).toBe('trace-new');
      expect(records[0].message).toEqual({ id: 'msg-001', role: 'user', content: 'Updated Hello' });
      expect(records[0].seq).toBe(0);
    });

    it('빈 메시지로 rewrite하면 파일이 비어야 한다', async () => {
      await logger.appendDelta({
        traceId: 'trace-old',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        startSeq: 0,
        messages: [{ id: 'msg-001', role: 'user', content: 'Hello' }],
      });

      await logger.rewrite({
        traceId: 'trace-new',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-002',
        messages: [],
      });

      const records = await logger.readAll();
      expect(records.length).toBe(0);
    });
  });
});

describe('MessageEventLogger', () => {
  let tempDir: string;
  let logFile: string;
  let logger: MessageEventLogger;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    logFile = path.join(tempDir, 'events.jsonl');
    logger = new MessageEventLogger(logFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('log', () => {
    it('MessageEventLogRecord를 기록해야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        seq: 1,
        eventType: 'llm_message',
        payload: { message: { id: 'msg-001', role: 'user', content: 'Hello' } },
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].type).toBe('message.event');
      expect(records[0].traceId).toBe('trace-a1b2c3');
      expect(records[0].seq).toBe(1);
      expect(records[0].eventType).toBe('llm_message');
    });

    it('stepId를 선택적으로 기록할 수 있어야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        seq: 1,
        eventType: 'llm_message',
        payload: { message: { id: 'msg-001', role: 'assistant', content: 'Hi' } },
        stepId: 'step-xyz789',
      });

      const records = await logger.readAll();
      expect(records[0].stepId).toBe('step-xyz789');
    });
  });

  describe('clear', () => {
    it('파일 내용을 비워야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        seq: 1,
        eventType: 'llm_message',
        payload: { message: { id: 'msg-001', role: 'user', content: 'Hello' } },
      });

      let records = await logger.readAll();
      expect(records.length).toBe(1);

      await logger.clear();

      records = await logger.readAll();
      expect(records.length).toBe(0);
    });
  });
});

describe('SwarmEventLogger', () => {
  let tempDir: string;
  let logFile: string;
  let logger: SwarmEventLogger;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    logFile = path.join(tempDir, 'events.jsonl');
    logger = new SwarmEventLogger(logFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('log', () => {
    it('SwarmEventLogRecord를 기록해야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        kind: 'swarm.created',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        swarmName: 'default',
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].type).toBe('swarm.event');
      expect(records[0].traceId).toBe('trace-a1b2c3');
      expect(records[0].kind).toBe('swarm.created');
    });

    it('agentName과 data를 선택적으로 기록할 수 있어야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        kind: 'agent.created',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        swarmName: 'default',
        agentName: 'planner',
        data: { reason: 'initial' },
      });

      const records = await logger.readAll();
      expect(records[0].agentName).toBe('planner');
      expect(records[0].data).toEqual({ reason: 'initial' });
    });
  });
});

describe('AgentEventLogger', () => {
  let tempDir: string;
  let logFile: string;
  let logger: AgentEventLogger;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    logFile = path.join(tempDir, 'events.jsonl');
    logger = new AgentEventLogger(logFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('log', () => {
    it('AgentEventLogRecord를 기록해야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        kind: 'turn.started',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].type).toBe('agent.event');
      expect(records[0].traceId).toBe('trace-a1b2c3');
      expect(records[0].kind).toBe('turn.started');
    });

    it('turnId, stepId, stepIndex, data를 선택적으로 기록할 수 있어야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        kind: 'step.started',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        stepId: 'step-001',
        stepIndex: 0,
        data: { info: 'test' },
      });

      const records = await logger.readAll();
      expect(records[0].turnId).toBe('turn-001');
      expect(records[0].stepId).toBe('step-001');
      expect(records[0].stepIndex).toBe(0);
      expect(records[0].data).toEqual({ info: 'test' });
    });
  });
});

describe('TurnMetricsLogger', () => {
  let tempDir: string;
  let logFile: string;
  let logger: TurnMetricsLogger;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    logFile = path.join(tempDir, 'turns.jsonl');
    logger = new TurnMetricsLogger(logFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('log', () => {
    it('TurnMetricsLogRecord를 기록해야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        turnId: 'turn-abc123',
        instanceId: 'default-cli',
        agentName: 'planner',
        latencyMs: 3200,
        tokenUsage: { prompt: 150, completion: 30, total: 180 },
        toolCallCount: 1,
        errorCount: 0,
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].type).toBe('metrics.turn');
      expect(records[0].traceId).toBe('trace-a1b2c3');
      expect(records[0].latencyMs).toBe(3200);
      expect(records[0].tokenUsage.total).toBe(180);
      expect(records[0].toolCallCount).toBe(1);
      expect(records[0].errorCount).toBe(0);
    });

    it('stepId를 선택적으로 기록할 수 있어야 한다', async () => {
      await logger.log({
        traceId: 'trace-a1b2c3',
        turnId: 'turn-abc123',
        stepId: 'step-xyz789',
        instanceId: 'default-cli',
        agentName: 'planner',
        latencyMs: 1200,
        tokenUsage: { prompt: 100, completion: 20, total: 120 },
        toolCallCount: 0,
        errorCount: 0,
      });

      const records = await logger.readAll();
      expect(records[0].stepId).toBe('step-xyz789');
    });
  });
});
