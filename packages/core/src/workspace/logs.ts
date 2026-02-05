/**
 * 로그 시스템
 * @see /docs/specs/workspace.md - 섹션 6, 7, 11: 로그 스키마 및 JSONL Writer
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { JsonObject } from '../types/json.js';
import type {
  LlmMessageLogRecord,
  LlmMessage,
  SwarmEventLogRecord,
  SwarmEventKind,
  AgentEventLogRecord,
  AgentEventKind,
} from './types.js';

/**
 * JsonlWriter - Append-only JSONL Writer
 */
export class JsonlWriter<T> {
  constructor(private readonly filePath: string) {}

  /**
   * 단일 레코드 추가
   */
  async append(record: T): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(this.filePath, line, 'utf8');
  }

  /**
   * 여러 레코드 추가
   */
  async appendMany(records: T[]): Promise<void> {
    if (records.length === 0) return;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await fs.appendFile(this.filePath, lines, 'utf8');
  }

  /**
   * 레코드 순회 (async generator)
   */
  async *read(): AsyncGenerator<T> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      for (const line of content.split('\n')) {
        if (line.trim()) {
          yield JSON.parse(line) as T;
        }
      }
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== 'ENOENT') {
        throw err;
      }
      // 파일이 없으면 빈 generator
    }
  }

  /**
   * 모든 레코드 읽기
   */
  async readAll(): Promise<T[]> {
    const records: T[] = [];
    for await (const record of this.read()) {
      records.push(record);
    }
    return records;
  }
}

/**
 * LlmMessageLogger 로그 입력 타입
 */
export interface LlmMessageLogInput {
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId: string;
  stepId?: string;
  stepIndex?: number;
  message: LlmMessage;
}

/**
 * LlmMessageLogger - LLM 메시지 로거
 */
export class LlmMessageLogger {
  private readonly writer: JsonlWriter<LlmMessageLogRecord>;

  constructor(filePath: string) {
    this.writer = new JsonlWriter<LlmMessageLogRecord>(filePath);
  }

  /**
   * LLM 메시지 기록
   */
  async log(input: LlmMessageLogInput): Promise<void> {
    const record: LlmMessageLogRecord = {
      type: 'llm.message',
      recordedAt: new Date().toISOString(),
      instanceId: input.instanceId,
      instanceKey: input.instanceKey,
      agentName: input.agentName,
      turnId: input.turnId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      message: input.message,
    };

    await this.writer.append(record);
  }

  /**
   * 모든 레코드 읽기
   */
  async readAll(): Promise<LlmMessageLogRecord[]> {
    return this.writer.readAll();
  }

  /**
   * 레코드 순회
   */
  read(): AsyncGenerator<LlmMessageLogRecord> {
    return this.writer.read();
  }
}

/**
 * SwarmEventLogger 로그 입력 타입
 */
export interface SwarmEventLogInput {
  kind: SwarmEventKind;
  instanceId: string;
  instanceKey: string;
  swarmName: string;
  agentName?: string;
  data?: JsonObject;
}

/**
 * SwarmEventLogger - Swarm 이벤트 로거
 */
export class SwarmEventLogger {
  private readonly writer: JsonlWriter<SwarmEventLogRecord>;

  constructor(filePath: string) {
    this.writer = new JsonlWriter<SwarmEventLogRecord>(filePath);
  }

  /**
   * Swarm 이벤트 기록
   */
  async log(input: SwarmEventLogInput): Promise<void> {
    const record: SwarmEventLogRecord = {
      type: 'swarm.event',
      recordedAt: new Date().toISOString(),
      kind: input.kind,
      instanceId: input.instanceId,
      instanceKey: input.instanceKey,
      swarmName: input.swarmName,
      agentName: input.agentName,
      data: input.data,
    };

    await this.writer.append(record);
  }

  /**
   * 모든 레코드 읽기
   */
  async readAll(): Promise<SwarmEventLogRecord[]> {
    return this.writer.readAll();
  }

  /**
   * 레코드 순회
   */
  read(): AsyncGenerator<SwarmEventLogRecord> {
    return this.writer.read();
  }
}

/**
 * AgentEventLogger 로그 입력 타입
 */
export interface AgentEventLogInput {
  kind: AgentEventKind;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId?: string;
  stepId?: string;
  stepIndex?: number;
  data?: JsonObject;
}

/**
 * AgentEventLogger - Agent 이벤트 로거
 */
export class AgentEventLogger {
  private readonly writer: JsonlWriter<AgentEventLogRecord>;

  constructor(filePath: string) {
    this.writer = new JsonlWriter<AgentEventLogRecord>(filePath);
  }

  /**
   * Agent 이벤트 기록
   */
  async log(input: AgentEventLogInput): Promise<void> {
    const record: AgentEventLogRecord = {
      type: 'agent.event',
      recordedAt: new Date().toISOString(),
      kind: input.kind,
      instanceId: input.instanceId,
      instanceKey: input.instanceKey,
      agentName: input.agentName,
      turnId: input.turnId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      data: input.data,
    };

    await this.writer.append(record);
  }

  /**
   * 모든 레코드 읽기
   */
  async readAll(): Promise<AgentEventLogRecord[]> {
    return this.writer.readAll();
  }

  /**
   * 레코드 순회
   */
  read(): AsyncGenerator<AgentEventLogRecord> {
    return this.writer.read();
  }
}
