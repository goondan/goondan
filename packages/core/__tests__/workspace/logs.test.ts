/**
 * 로그 시스템 테스트
 * @see /docs/specs/workspace.md - 섹션 6, 7: LLM Message Log, Event Log 스키마
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  JsonlWriter,
  LlmMessageLogger,
  SwarmEventLogger,
  AgentEventLogger,
} from '../../src/workspace/logs.js';
import type {
  LlmMessageLogRecord,
  SwarmEventLogRecord,
  AgentEventLogRecord,
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

describe('LlmMessageLogger', () => {
  let tempDir: string;
  let logFile: string;
  let logger: LlmMessageLogger;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    logFile = path.join(tempDir, 'llm.jsonl');
    logger = new LlmMessageLogger(logFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('log', () => {
    it('LlmMessageLogRecord를 기록해야 한다', async () => {
      await logger.log({
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        message: { role: 'user', content: 'Hello' },
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].type).toBe('llm.message');
      expect(records[0].instanceId).toBe('default-cli');
      expect(records[0].message.role).toBe('user');
    });

    it('recordedAt을 자동으로 설정해야 한다', async () => {
      const before = new Date().toISOString();
      await logger.log({
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        message: { role: 'user', content: 'Hello' },
      });
      const after = new Date().toISOString();

      const records = await logger.readAll();
      expect(records[0].recordedAt >= before).toBe(true);
      expect(records[0].recordedAt <= after).toBe(true);
    });

    it('모든 LLM 메시지 역할을 기록할 수 있어야 한다', async () => {
      await logger.log({
        instanceId: 'inst',
        instanceKey: 'key',
        agentName: 'agent',
        turnId: 'turn',
        message: { role: 'system', content: 'System prompt' },
      });

      await logger.log({
        instanceId: 'inst',
        instanceKey: 'key',
        agentName: 'agent',
        turnId: 'turn',
        message: { role: 'user', content: 'User message' },
      });

      await logger.log({
        instanceId: 'inst',
        instanceKey: 'key',
        agentName: 'agent',
        turnId: 'turn',
        message: { role: 'assistant', content: 'Assistant response' },
      });

      await logger.log({
        instanceId: 'inst',
        instanceKey: 'key',
        agentName: 'agent',
        turnId: 'turn',
        message: {
          role: 'tool',
          toolCallId: 'call_001',
          toolName: 'test',
          output: { result: 'success' },
        },
      });

      const records = await logger.readAll();
      expect(records.length).toBe(4);
      expect(records.map(r => r.message.role)).toEqual(['system', 'user', 'assistant', 'tool']);
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
        kind: 'swarm.created',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        swarmName: 'default',
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].type).toBe('swarm.event');
      expect(records[0].kind).toBe('swarm.created');
    });

    it('agentName과 data를 선택적으로 기록할 수 있어야 한다', async () => {
      await logger.log({
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
        kind: 'turn.started',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
      expect(records[0].type).toBe('agent.event');
      expect(records[0].kind).toBe('turn.started');
    });

    it('turnId, stepId, stepIndex, data를 선택적으로 기록할 수 있어야 한다', async () => {
      await logger.log({
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
