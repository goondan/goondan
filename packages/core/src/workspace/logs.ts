/**
 * 로그 시스템
 * @see /docs/specs/workspace.md - 섹션 6, 7, 11: 로그 스키마 및 JSONL Writer
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { JsonObject } from '../types/json.js';

/**
 * NodeJS.ErrnoException 타입 가드
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
import type {
  LlmMessage,
  MessageBaseLogRecord,
  MessageEventLogRecord,
  MessageEventType,
  SwarmEventLogRecord,
  SwarmEventKind,
  AgentEventLogRecord,
  AgentEventKind,
  TurnMetricsLogRecord,
  TokenUsage,
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
          // JSON.parse 결과를 제네릭 T로 변환 (JSONL Writer/Reader 대칭 구조)
          const parsed: unknown = JSON.parse(line);
          yield parsed as T;
        }
      }
    } catch (err) {
      if (isNodeError(err) && err.code !== 'ENOENT') {
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

  /**
   * 파일을 잘라내고 모든 레코드를 다시 기록 (rewrite용)
   */
  async truncateAndWriteAll(records: T[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    if (records.length === 0) {
      await fs.writeFile(this.filePath, '', 'utf8');
      return;
    }
    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await fs.writeFile(this.filePath, lines, 'utf8');
  }
}

/**
 * MessageBaseLogger Delta Append 입력 타입
 */
export interface MessageBaseDeltaInput {
  traceId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId: string;
  startSeq: number;
  messages: LlmMessage[];
}

/**
 * MessageBaseLogger Rewrite 입력 타입
 */
export interface MessageBaseRewriteInput {
  traceId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId: string;
  messages: LlmMessage[];
}

/**
 * MessageBaseLogger - Message base Delta 로거
 *
 * Delta Append: 새 메시지만 개별 레코드로 추가
 * Rewrite: mutation 이벤트 발생 시 전체 메시지를 다시 기록
 */
export class MessageBaseLogger {
  private readonly writer: JsonlWriter<MessageBaseLogRecord>;

  constructor(filePath: string) {
    this.writer = new JsonlWriter<MessageBaseLogRecord>(filePath);
  }

  /**
   * Delta Append: 새 메시지를 개별 레코드로 추가
   */
  async appendDelta(input: MessageBaseDeltaInput): Promise<void> {
    let seq = input.startSeq;
    for (const msg of input.messages) {
      await this.writer.append({
        type: 'message.base',
        recordedAt: new Date().toISOString(),
        traceId: input.traceId,
        instanceId: input.instanceId,
        instanceKey: input.instanceKey,
        agentName: input.agentName,
        turnId: input.turnId,
        message: msg,
        seq,
      });
      seq++;
    }
  }

  /**
   * Rewrite: 전체 메시지를 파일에 다시 기록 (mutation 이벤트 발생 시)
   */
  async rewrite(input: MessageBaseRewriteInput): Promise<void> {
    const records: MessageBaseLogRecord[] = [];
    let seq = 0;
    for (const msg of input.messages) {
      records.push({
        type: 'message.base',
        recordedAt: new Date().toISOString(),
        traceId: input.traceId,
        instanceId: input.instanceId,
        instanceKey: input.instanceKey,
        agentName: input.agentName,
        turnId: input.turnId,
        message: msg,
        seq,
      });
      seq++;
    }
    await this.writer.truncateAndWriteAll(records);
  }

  /**
   * 모든 레코드 읽기
   */
  async readAll(): Promise<MessageBaseLogRecord[]> {
    return this.writer.readAll();
  }

  /**
   * 레코드 순회
   */
  read(): AsyncGenerator<MessageBaseLogRecord> {
    return this.writer.read();
  }
}

/**
 * MessageEventLogger 로그 입력 타입
 */
export interface MessageEventLogInput {
  traceId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId: string;
  seq: number;
  eventType: MessageEventType;
  payload: JsonObject;
  stepId?: string;
}

/**
 * MessageEventLogger - Turn 메시지 이벤트 로거
 */
export class MessageEventLogger {
  private readonly writer: JsonlWriter<MessageEventLogRecord>;
  private readonly logFilePath: string;

  constructor(filePath: string) {
    this.logFilePath = filePath;
    this.writer = new JsonlWriter<MessageEventLogRecord>(filePath);
  }

  /**
   * 메시지 이벤트 기록
   */
  async log(input: MessageEventLogInput): Promise<void> {
    const record: MessageEventLogRecord = {
      type: 'message.event',
      recordedAt: new Date().toISOString(),
      traceId: input.traceId,
      instanceId: input.instanceId,
      instanceKey: input.instanceKey,
      agentName: input.agentName,
      turnId: input.turnId,
      seq: input.seq,
      eventType: input.eventType,
      payload: input.payload,
      stepId: input.stepId,
    };

    await this.writer.append(record);
  }

  /**
   * 모든 레코드 읽기
   */
  async readAll(): Promise<MessageEventLogRecord[]> {
    return this.writer.readAll();
  }

  /**
   * 레코드 순회
   */
  read(): AsyncGenerator<MessageEventLogRecord> {
    return this.writer.read();
  }

  /**
   * 파일 내용 비우기 (base 반영 성공 후)
   */
  async clear(): Promise<void> {
    await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
    await fs.writeFile(this.logFilePath, '', 'utf8');
  }
}

/**
 * SwarmEventLogger 로그 입력 타입
 */
export interface SwarmEventLogInput {
  traceId: string;
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
      traceId: input.traceId,
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
  traceId: string;
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
      traceId: input.traceId,
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

/**
 * TurnMetricsLogger 로그 입력 타입
 */
export interface TurnMetricsLogInput {
  traceId: string;
  turnId: string;
  stepId?: string;
  instanceId: string;
  agentName: string;
  latencyMs: number;
  tokenUsage: TokenUsage;
  toolCallCount: number;
  errorCount: number;
}

/**
 * TurnMetricsLogger - Turn/Step 메트릭 로거
 */
export class TurnMetricsLogger {
  private readonly writer: JsonlWriter<TurnMetricsLogRecord>;

  constructor(filePath: string) {
    this.writer = new JsonlWriter<TurnMetricsLogRecord>(filePath);
  }

  /**
   * Turn 메트릭 기록
   */
  async log(input: TurnMetricsLogInput): Promise<void> {
    const record: TurnMetricsLogRecord = {
      type: 'metrics.turn',
      recordedAt: new Date().toISOString(),
      traceId: input.traceId,
      turnId: input.turnId,
      stepId: input.stepId,
      instanceId: input.instanceId,
      agentName: input.agentName,
      latencyMs: input.latencyMs,
      tokenUsage: input.tokenUsage,
      toolCallCount: input.toolCallCount,
      errorCount: input.errorCount,
    };

    await this.writer.append(record);
  }

  /**
   * 모든 레코드 읽기
   */
  async readAll(): Promise<TurnMetricsLogRecord[]> {
    return this.writer.readAll();
  }

  /**
   * 레코드 순회
   */
  read(): AsyncGenerator<TurnMetricsLogRecord> {
    return this.writer.read();
  }
}
