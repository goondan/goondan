/**
 * Turn 실행 구현
 * @see /docs/specs/runtime.md - 2.4 Turn 타입, 5. Turn 실행 흐름
 */

import type { JsonObject, JsonValue } from '../types/json.js';
import type {
  TurnStatus,
  TurnOrigin,
  TurnAuth,
  LlmMessage,
  AgentEvent,
  TurnMessageState,
  TurnMetrics,
  TokenUsage,
  MessageEvent,
  ToolCall,
} from './types.js';
import { createTurnMessageState, computeNextMessages } from './types.js';
import type { AgentInstance } from './agent-instance.js';
import type { SwarmInstance } from './swarm-instance.js';
import type { Step, StepRunner, RuntimePipelineExecutor } from './step-runner.js';
import type { ObjectRefLike } from '../types/object-ref.js';
import type {
  EventBus as PipelineEventBus,
  TurnContext as PipelineTurnContext,
  MessageEvent as PipelineMessageEvent,
  LlmMessage as PipelineLlmMessage,
  ToolResult as PipelineToolResult,
  TurnAuth as PipelineTurnAuth,
} from '../pipeline/context.js';

const NOOP_PIPELINE_EVENT_BUS: PipelineEventBus = {
  emit: () => {},
  on: () => () => {},
};

/**
 * Turn 메시지 이벤트 로그 타입
 */
export type TurnMessageEventType =
  | 'system_message'
  | 'llm_message'
  | 'replace'
  | 'remove'
  | 'truncate';

/**
 * messages/base.jsonl 기록용 ToolCall 타입
 */
export interface PersistedToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
  [key: string]: JsonValue;
}

/**
 * messages/base.jsonl 기록용 LlmMessage 타입
 */
export type PersistedLlmMessage =
  | (JsonObject & { id: string; role: 'system'; content: string })
  | (JsonObject & { id: string; role: 'user'; content: string; attachments?: JsonObject[] })
  | (JsonObject & { id: string; role: 'assistant'; content?: string; toolCalls?: PersistedToolCall[] })
  | (JsonObject & { id: string; role: 'tool'; toolCallId: string; toolName: string; output: JsonValue });

/**
 * Turn base 로그 인터페이스
 */
export interface TurnMessageBaseLogger {
  log(input: {
    traceId: string;
    instanceId: string;
    instanceKey: string;
    agentName: string;
    turnId: string;
    messages: PersistedLlmMessage[];
    sourceEventCount?: number;
  }): Promise<void> | void;
}

/**
 * Turn event 로그 인터페이스
 */
export interface TurnMessageEventLogger {
  log(input: {
    traceId: string;
    instanceId: string;
    instanceKey: string;
    agentName: string;
    turnId: string;
    seq: number;
    eventType: TurnMessageEventType;
    payload: JsonObject;
    stepId?: string;
  }): Promise<void> | void;
  clear(): Promise<void> | void;
}

/**
 * Turn 메시지 상태 로거
 */
export interface TurnMessageStateLogger {
  base: TurnMessageBaseLogger;
  events: TurnMessageEventLogger;
}

/**
 * Turn 시작 시 메시지 상태 복원 스냅샷
 *
 * - baseMessages + events를 Runtime이 fold하여 초기 nextMessages를 복원한다.
 * - events를 디스크에서 소모 처리해야 할 경우 clearRecoveredEvents를 사용한다.
 */
export interface TurnMessageStateRecoverySnapshot {
  baseMessages: LlmMessage[];
  events: MessageEvent[];
  clearRecoveredEvents?: () => Promise<void> | void;
}

/**
 * Turn: AgentInstance가 "하나의 입력 이벤트"를 처리하는 단위
 *
 * 규칙:
 * - MUST: 작업이 소진될 때까지 Step 반복 후 제어 반납
 * - MUST: NextMessages = BaseMessages + SUM(Events) 규칙으로 LLM 입력 메시지를 계산
 * - MUST: origin과 auth는 Turn 생애주기 동안 불변
 */
export interface Turn {
  /** Turn 고유 ID */
  readonly id: string;

  /** 추적 ID (MUST: Turn마다 생성/보존, Step/ToolCall/Event 로그로 전파) */
  readonly traceId: string;

  /** 소속된 AgentInstance 참조 */
  readonly agentInstance: AgentInstance;

  /** 입력 이벤트 */
  readonly inputEvent: AgentEvent;

  /** 호출 맥락 (불변) */
  readonly origin: TurnOrigin;

  /** 인증 컨텍스트 (불변) */
  readonly auth: TurnAuth;

  /** Turn 메시지 상태 (base + events + 계산 결과) */
  readonly messageState: TurnMessageState;

  /**
   * 누적된 LLM 메시지 (messageState.nextMessages에 대한 편의 접근)
   * @deprecated messageState.nextMessages를 사용하세요
   */
  readonly messages: LlmMessage[];

  /** 실행된 Step 목록 */
  readonly steps: Step[];

  /** 현재 Step 인덱스 */
  currentStepIndex: number;

  /** Turn 상태 */
  status: TurnStatus;

  /** Turn 시작 시각 */
  readonly startedAt: Date;

  /** Turn 종료 시각 (완료 시 설정) */
  completedAt?: Date;

  /** Turn 메타데이터 (확장용) */
  metadata: JsonObject;

  /** Turn 메트릭 (완료 시 설정) */
  metrics?: TurnMetrics;
}

/**
 * TurnContext: Turn 실행 컨텍스트
 */
export interface TurnContext {
  turn: Turn;
  agentInstance: AgentInstance;
  swarmInstance: SwarmInstance;
}

/**
 * 고유 ID 생성
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * JsonObject 타입 가드
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * ObjectRefLike 해석
 */
function resolveObjectRef(ref: ObjectRefLike, fallbackKind: string): { kind: string; name: string } {
  if (typeof ref === 'string') {
    const [kind, name] = ref.split('/');

    if (kind && name) {
      return { kind, name };
    }

    return { kind: fallbackKind, name: ref };
  }

  return {
    kind: ref.kind,
    name: ref.name,
  };
}

/**
 * 빈 리소스 생성
 */
function createPlaceholderResource(ref: ObjectRefLike, fallbackKind: string): {
  apiVersion: string;
  kind: string;
  metadata: { name: string };
  spec: JsonObject;
} {
  const resolved = resolveObjectRef(ref, fallbackKind);
  return {
    apiVersion: 'goondan.io/v1alpha1',
    kind: resolved.kind,
    metadata: { name: resolved.name },
    spec: {},
  };
}

/**
 * Turn 생성
 *
 * @param agentInstance - 소속된 AgentInstance
 * @param event - 입력 이벤트
 * @param baseMessages - 이전 Turn에서 가져온 기준 메시지
 * @returns Turn
 */
export function createTurn(
  agentInstance: AgentInstance,
  event: AgentEvent,
  baseMessages?: LlmMessage[]
): Turn {
  const messageState = createTurnMessageState(baseMessages);

  return {
    id: generateId('turn'),
    traceId: generateId('trace'),
    agentInstance,
    inputEvent: event,
    origin: event.origin ?? {},
    auth: event.auth ?? {},
    messageState,
    messages: messageState.nextMessages,
    steps: [],
    currentStepIndex: 0,
    status: 'pending',
    startedAt: new Date(),
    metadata: {},
  };
}

/**
 * TurnRunner 옵션
 */
export interface TurnRunnerOptions {
  stepRunner: StepRunner;
  maxStepsPerTurn?: number;
  pipelineExecutor?: RuntimePipelineExecutor;
  pipelineEventBus?: PipelineEventBus;
  logger?: Console;
  messageStateLogger?: (agentInstance: AgentInstance) => TurnMessageStateLogger | undefined;
  messageStateRecovery?: (
    agentInstance: AgentInstance
  ) => Promise<TurnMessageStateRecoverySnapshot | undefined>;
  flushExtensionState?: (agentInstance: AgentInstance) => Promise<void> | void;
  extensionLoaderFactory?: (agentInstance: AgentInstance) => Promise<unknown> | unknown;
  onTurnSettled?: (turn: Turn) => Promise<void> | void;
}

/**
 * TurnRunner: Turn 실행 로직
 */
export interface TurnRunner {
  /**
   * Turn 실행
   *
   * @param agentInstance - AgentInstance
   * @param event - 입력 이벤트
   * @returns 완료된 Turn
   */
  run(agentInstance: AgentInstance, event: AgentEvent): Promise<Turn>;
}

/**
 * Step 계속 여부 판단
 */
function shouldContinueStepLoop(step: Step): boolean {
  // 1. Step 실패 시 중단
  if (step.status === 'failed') {
    return false;
  }

  // 2. LLM이 tool call 없이 응답 완료
  if (
    step.llmResult?.meta.finishReason === 'stop' &&
    (!step.toolCalls || step.toolCalls.length === 0)
  ) {
    return false;
  }

  // 3. Tool call이 있으면 계속
  if (step.toolCalls && step.toolCalls.length > 0) {
    return true;
  }

  // 4. 기본: 중단
  return false;
}

/**
 * 에러 직렬화
 */
function serializeError(error: unknown): JsonObject {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }
  return { message: String(error) };
}

/**
 * 빈 TokenUsage 생성
 */
function emptyTokenUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/**
 * TurnRunner 구현
 */
class TurnRunnerImpl implements TurnRunner {
  private readonly stepRunner: StepRunner;
  private readonly maxStepsPerTurn: number;
  private readonly pipelineExecutor?: RuntimePipelineExecutor;
  private readonly pipelineEventBus: PipelineEventBus;
  private readonly logger: Console;
  private readonly messageStateLogger?: (
    agentInstance: AgentInstance
  ) => TurnMessageStateLogger | undefined;
  private readonly messageStateRecovery?: (
    agentInstance: AgentInstance
  ) => Promise<TurnMessageStateRecoverySnapshot | undefined>;
  private readonly flushExtensionState?: (agentInstance: AgentInstance) => Promise<void> | void;
  private readonly extensionLoaderFactory?: (
    agentInstance: AgentInstance
  ) => Promise<unknown> | unknown;
  private readonly onTurnSettled?: (turn: Turn) => Promise<void> | void;
  private readonly extensionLoaderInitSet = new Set<string>();

  constructor(options: TurnRunnerOptions) {
    this.stepRunner = options.stepRunner;
    this.maxStepsPerTurn = options.maxStepsPerTurn ?? 32;
    this.pipelineExecutor = options.pipelineExecutor;
    this.pipelineEventBus = options.pipelineEventBus ?? NOOP_PIPELINE_EVENT_BUS;
    this.logger = options.logger ?? console;
    this.messageStateLogger = options.messageStateLogger;
    this.messageStateRecovery = options.messageStateRecovery;
    this.flushExtensionState = options.flushExtensionState;
    this.extensionLoaderFactory = options.extensionLoaderFactory;
    this.onTurnSettled = options.onTurnSettled;
  }

  async run(agentInstance: AgentInstance, event: AgentEvent): Promise<Turn> {
    await this.ensureExtensionLoaderInitialized(agentInstance);

    const recoveredState = await this.recoverMessageStateAtTurnStart(agentInstance);
    if (recoveredState.initialMessages) {
      const history = agentInstance.conversationHistory;
      history.splice(0, history.length, ...recoveredState.initialMessages);
    }

    // 1. Turn 생성 (복원 메시지 또는 이전 대화 히스토리를 baseMessages로)
    const turn = createTurn(
      agentInstance,
      event,
      recoveredState.initialMessages ?? agentInstance.conversationHistory
    );

    if (recoveredState.recoveredEventCount > 0) {
      turn.metadata['recoveredMessageEventCount'] = recoveredState.recoveredEventCount;
    }
    if (recoveredState.clearError) {
      turn.metadata['recoveredMessageEventClearError'] = serializeError(recoveredState.clearError);
    }

    agentInstance.currentTurn = turn;
    agentInstance.status = 'processing';

    // 메트릭 수집용
    let totalToolCallCount = 0;
    let totalErrorCount = 0;
    const totalTokenUsage = emptyTokenUsage();

    try {
      // 2. turn.pre 파이프라인 실행
      const preContext = await this.runTurnMutator(
        'turn.pre',
        this.createPipelineTurnContext(turn, agentInstance)
      );
      this.applyTurnPipelineContext(turn, preContext);

      // 3. 초기 사용자 메시지를 이벤트로 추가
      if (event.input) {
        const userMessage: LlmMessage = {
          id: generateId('msg'),
          role: 'user',
          content: event.input,
        };
        this.appendMessageEvent(turn, {
          type: 'llm_message',
          seq: turn.messageState.events.length,
          message: userMessage,
        });
      }

      // 4. Step 루프
      turn.status = 'running';

      // 4.0 paused 상태 확인 (MUST: paused 상태에서는 새 Turn을 실행해서는 안 된다)
      if (agentInstance.swarmInstance.status === 'paused') {
        turn.status = 'interrupted';
        turn.completedAt = new Date();
        turn.metadata['interruptReason'] = 'instance_paused';
        return turn;
      }

      while (turn.currentStepIndex < this.maxStepsPerTurn) {
        // 4.1 Step 실행
        const step = await this.stepRunner.run(turn);
        turn.steps.push(step);

        // 4.1.1 메트릭 수집
        totalToolCallCount += step.toolCalls.length;
        if (step.status === 'failed') {
          totalErrorCount++;
        }
        if (step.llmResult?.meta.usage) {
          totalTokenUsage.promptTokens += step.llmResult.meta.usage.promptTokens;
          totalTokenUsage.completionTokens += step.llmResult.meta.usage.completionTokens;
          totalTokenUsage.totalTokens += step.llmResult.meta.usage.totalTokens;
        }

        // 4.2 Step 결과 평가
        if (shouldContinueStepLoop(step)) {
          turn.currentStepIndex++;
          continue;
        }

        // 4.3 루프 종료 조건 충족
        break;
      }

      // 5. Step 제한 도달 확인
      if (turn.currentStepIndex >= this.maxStepsPerTurn) {
        turn.metadata['stepLimitReached'] = true;
      }

      // 6. turn.post 파이프라인 실행
      const postContext = await this.runTurnMutator(
        'turn.post',
        this.createPipelineTurnContext(turn, agentInstance)
      );
      this.applyTurnPipelineContext(turn, postContext);

      if (this.flushExtensionState) {
        try {
          await this.flushExtensionState(agentInstance);
        } catch (error) {
          this.logger.error('[turn.flushExtensionState] failed', error);
          turn.metadata['extensionStateFlushError'] = serializeError(error);
        }
      }

      // 7. Turn 완료
      turn.status = 'completed';
      turn.completedAt = new Date();

      // 7.5 대화 히스토리 저장 (다음 Turn에서 이전 대화 맥락으로 사용)
      const history = agentInstance.conversationHistory;
      history.splice(0, history.length);
      for (const msg of turn.messageState.nextMessages) {
        history.push(msg);
      }
    } catch (error) {
      // 8. 에러 처리
      turn.status = 'failed';
      turn.completedAt = new Date();
      turn.metadata['error'] = serializeError(error);
      totalErrorCount++;
    } finally {
      // 9. 정리
      agentInstance.currentTurn = null;
      agentInstance.completedTurnCount++;
      agentInstance.lastActivityAt = new Date();
      agentInstance.status = 'idle';

      // 9.1 Turn 메트릭 기록
      const endTime = turn.completedAt ?? new Date();
      turn.metrics = {
        latencyMs: endTime.getTime() - turn.startedAt.getTime(),
        stepCount: turn.steps.length,
        toolCallCount: totalToolCallCount,
        errorCount: totalErrorCount,
        tokenUsage: totalTokenUsage,
      };

      try {
        await this.persistMessageState(turn, agentInstance);
      } catch (persistError) {
        this.logger.error('[turn.persistMessageState] failed', persistError);
        turn.metadata['messageStatePersistenceError'] = serializeError(persistError);
      }

      if (this.onTurnSettled) {
        try {
          await this.onTurnSettled(turn);
        } catch (settledError) {
          this.logger.error('[turn.settled] callback failed', settledError);
          turn.metadata['onTurnSettledError'] = serializeError(settledError);
        }
      }
    }

    return turn;
  }

  private async ensureExtensionLoaderInitialized(agentInstance: AgentInstance): Promise<void> {
    if (!this.extensionLoaderFactory) {
      return;
    }

    if (this.extensionLoaderInitSet.has(agentInstance.id)) {
      return;
    }

    try {
      await this.extensionLoaderFactory(agentInstance);
      this.extensionLoaderInitSet.add(agentInstance.id);
    } catch (error) {
      this.logger.error('[turn.extensionLoader] initialization failed', error);
    }
  }

  private async recoverMessageStateAtTurnStart(agentInstance: AgentInstance): Promise<{
    initialMessages?: LlmMessage[];
    recoveredEventCount: number;
    clearError?: unknown;
  }> {
    if (!this.messageStateRecovery) {
      return { recoveredEventCount: 0 };
    }

    try {
      const snapshot = await this.messageStateRecovery(agentInstance);
      if (!snapshot) {
        return { recoveredEventCount: 0 };
      }

      const baseMessages = snapshot.baseMessages.map((message) => this.cloneLlmMessage(message));
      const events = snapshot.events.map((event) => this.cloneMessageEvent(event));
      const initialMessages = computeNextMessages(baseMessages, events);

      let clearError: unknown;
      if (events.length > 0 && snapshot.clearRecoveredEvents) {
        try {
          await snapshot.clearRecoveredEvents();
        } catch (error) {
          clearError = error;
          this.logger.error('[turn.recoverMessageState] failed to clear recovered events', error);
        }
      }

      return {
        initialMessages,
        recoveredEventCount: events.length,
        ...(clearError !== undefined ? { clearError } : {}),
      };
    } catch (error) {
      this.logger.error('[turn.recoverMessageState] failed', error);
      return { recoveredEventCount: 0 };
    }
  }

  private cloneLlmMessage(message: LlmMessage): LlmMessage {
    if (message.role === 'system') {
      return {
        id: message.id,
        role: 'system',
        content: message.content,
      };
    }

    if (message.role === 'user') {
      const attachments = message.attachments?.map((attachment) => ({
        type: attachment.type,
        ...(attachment.url !== undefined ? { url: attachment.url } : {}),
        ...(attachment.base64 !== undefined ? { base64: attachment.base64 } : {}),
        ...(attachment.mimeType !== undefined ? { mimeType: attachment.mimeType } : {}),
      }));

      return {
        id: message.id,
        role: 'user',
        content: message.content,
        ...(attachments !== undefined ? { attachments } : {}),
      };
    }

    if (message.role === 'assistant') {
      const toolCalls = message.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: { ...toolCall.args },
      }));

      return {
        id: message.id,
        role: 'assistant',
        ...(message.content !== undefined ? { content: message.content } : {}),
        ...(toolCalls !== undefined ? { toolCalls } : {}),
      };
    }

    return {
      id: message.id,
      role: 'tool',
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      output: message.output,
    };
  }

  private cloneMessageEvent(event: MessageEvent): MessageEvent {
    if (event.type === 'truncate') {
      return {
        type: 'truncate',
        seq: event.seq,
      };
    }

    if (event.type === 'remove') {
      return {
        type: 'remove',
        seq: event.seq,
        targetId: event.targetId,
      };
    }

    if (event.type === 'system_message') {
      return {
        type: 'system_message',
        seq: event.seq,
        message: {
          id: event.message.id,
          role: 'system',
          content: event.message.content,
        },
      };
    }

    if (event.type === 'replace') {
      return {
        type: 'replace',
        seq: event.seq,
        targetId: event.targetId,
        message: this.cloneLlmMessage(event.message),
      };
    }

    const message = event.message;
    if (message.role === 'user') {
      return {
        type: 'llm_message',
        seq: event.seq,
        message: {
          id: message.id,
          role: 'user',
          content: message.content,
          ...(message.attachments !== undefined
            ? {
                attachments: message.attachments.map((attachment) => ({
                  type: attachment.type,
                  ...(attachment.url !== undefined ? { url: attachment.url } : {}),
                  ...(attachment.base64 !== undefined ? { base64: attachment.base64 } : {}),
                  ...(attachment.mimeType !== undefined ? { mimeType: attachment.mimeType } : {}),
                })),
              }
            : {}),
        },
      };
    }

    if (message.role === 'assistant') {
      return {
        type: 'llm_message',
        seq: event.seq,
        message: {
          id: message.id,
          role: 'assistant',
          ...(message.content !== undefined ? { content: message.content } : {}),
          ...(message.toolCalls !== undefined
            ? {
                toolCalls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  name: toolCall.name,
                  args: { ...toolCall.args },
                })),
              }
            : {}),
        },
      };
    }

    return {
      type: 'llm_message',
      seq: event.seq,
      message: {
        id: message.id,
        role: 'tool',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: message.output,
      },
    };
  }

  private async persistMessageState(turn: Turn, agentInstance: AgentInstance): Promise<void> {
    if (!this.messageStateLogger) {
      return;
    }

    const logger = this.messageStateLogger(agentInstance);
    if (!logger) {
      return;
    }

    const instanceId = agentInstance.swarmInstance.id;
    const instanceKey = agentInstance.swarmInstance.instanceKey;
    const agentName = agentInstance.agentName;
    const turnId = turn.id;

    for (const event of turn.messageState.events) {
      await logger.events.log({
        traceId: turn.traceId,
        instanceId,
        instanceKey,
        agentName,
        turnId,
        seq: event.seq,
        eventType: event.type,
        payload: this.toMessageEventPayload(event),
      });
    }

    await logger.base.log({
      traceId: turn.traceId,
      instanceId,
      instanceKey,
      agentName,
      turnId,
      messages: turn.messageState.nextMessages.map((message) =>
        this.toPersistedLlmMessage(message)
      ),
      sourceEventCount: turn.messageState.events.length,
    });

    await logger.events.clear();

    const nextBase = turn.messageState.nextMessages.map((message) => ({ ...message }));
    turn.messageState.baseMessages.splice(0, turn.messageState.baseMessages.length, ...nextBase);
    turn.messageState.events.splice(0, turn.messageState.events.length);

    const recomputed = computeNextMessages(
      turn.messageState.baseMessages,
      turn.messageState.events
    );
    turn.messageState.nextMessages.splice(0, turn.messageState.nextMessages.length, ...recomputed);
  }

  private toPersistedLlmMessage(message: LlmMessage): PersistedLlmMessage {
    if (message.role === 'system') {
      return {
        id: message.id,
        role: 'system',
        content: message.content,
      };
    }

    if (message.role === 'user') {
      const attachments = message.attachments?.map((attachment) => {
        const nextAttachment: JsonObject = {
          type: attachment.type,
        };

        if (attachment.url !== undefined) {
          nextAttachment['url'] = attachment.url;
        }
        if (attachment.base64 !== undefined) {
          nextAttachment['base64'] = attachment.base64;
        }
        if (attachment.mimeType !== undefined) {
          nextAttachment['mimeType'] = attachment.mimeType;
        }

        return nextAttachment;
      });

      return {
        id: message.id,
        role: 'user',
        content: message.content,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      };
    }

    if (message.role === 'assistant') {
      const toolCalls = message.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        arguments: { ...toolCall.args },
      }));

      return {
        id: message.id,
        role: 'assistant',
        ...(message.content !== undefined ? { content: message.content } : {}),
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      };
    }

    return {
      id: message.id,
      role: 'tool',
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      output: message.output,
    };
  }

  private toMessageEventPayload(event: MessageEvent): JsonObject {
    if (event.type === 'truncate') {
      return {};
    }

    if (event.type === 'remove') {
      return { targetId: event.targetId };
    }

    if (event.type === 'replace') {
      return {
        targetId: event.targetId,
        message: this.toPersistedLlmMessage(event.message),
      };
    }

    return {
      message: this.toPersistedLlmMessage(event.message),
    };
  }

  private async runTurnMutator(
    point: 'turn.pre' | 'turn.post',
    context: PipelineTurnContext
  ): Promise<PipelineTurnContext> {
    if (!this.pipelineExecutor) {
      return context;
    }

    return this.pipelineExecutor.runMutators(point, context);
  }

  private createPipelineTurnContext(
    turn: Turn,
    agentInstance: AgentInstance
  ): PipelineTurnContext {
    const baseMessages = turn.messageState.baseMessages.map(
      (message) => this.toPipelineLlmMessage(message)
    );
    const messageEvents = turn.messageState.events.map(
      (event) => this.toPipelineMessageEvent(event)
    );

    return {
      instance: {
        id: agentInstance.swarmInstance.id,
        key: agentInstance.swarmInstance.instanceKey,
      },
      swarm: createPlaceholderResource(agentInstance.swarmInstance.swarmRef, 'Swarm'),
      agent: createPlaceholderResource(agentInstance.agentRef, 'Agent'),
      effectiveConfig: {},
      events: this.pipelineEventBus,
      logger: this.logger,
      turn: {
        id: turn.id,
        input: turn.inputEvent.input,
        messageState: {
          baseMessages,
          events: messageEvents,
          nextMessages: turn.messageState.nextMessages.map((message) => this.toPipelineLlmMessage(message)),
        },
        toolResults: this.collectTurnToolResults(turn),
        auth: this.toPipelineTurnAuth(turn.auth),
        metadata: { ...turn.metadata },
      },
      baseMessages,
      messageEvents,
      emitMessageEvent: async (event) => {
        const runtimeEvent = this.toRuntimeMessageEvent(event);
        if (runtimeEvent) {
          messageEvents.push(event);
          this.appendMessageEvent(turn, runtimeEvent);
        }
      },
    };
  }

  private collectTurnToolResults(turn: Turn): PipelineToolResult[] {
    const results: PipelineToolResult[] = [];

    for (const step of turn.steps) {
      for (const toolResult of step.toolResults) {
        const pipelineResult: PipelineToolResult = {
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          status: toolResult.status,
        };

        if (toolResult.output !== undefined) {
          pipelineResult.output = toolResult.output;
        }

        if (toolResult.handle !== undefined) {
          pipelineResult.handle = toolResult.handle;
        }

        if (toolResult.error !== undefined) {
          pipelineResult.error = { ...toolResult.error };
        }

        results.push(pipelineResult);
      }
    }

    return results;
  }

  private applyTurnPipelineContext(turn: Turn, context: PipelineTurnContext): void {
    const baseSource = context.baseMessages ?? context.turn.messageState.baseMessages;
    const eventSource = context.messageEvents ?? context.turn.messageState.events;

    if (baseSource) {
      turn.messageState.baseMessages.splice(
        0,
        turn.messageState.baseMessages.length,
        ...baseSource.map((message) => this.normalizePipelineLlmMessage(message))
      );
    }

    if (eventSource) {
      const nextEvents: MessageEvent[] = [];
      for (const event of eventSource) {
        const runtimeEvent = this.toRuntimeMessageEvent(event);
        if (runtimeEvent) {
          nextEvents.push(runtimeEvent);
        }
      }

      turn.messageState.events.splice(0, turn.messageState.events.length, ...nextEvents);
    }

    const recomputed = computeNextMessages(
      turn.messageState.baseMessages,
      turn.messageState.events
    );
    turn.messageState.nextMessages.splice(0, turn.messageState.nextMessages.length, ...recomputed);

    if (context.turn.metadata && isJsonObject(context.turn.metadata)) {
      for (const [key, value] of Object.entries(context.turn.metadata)) {
        turn.metadata[key] = value;
      }
    }
  }

  private appendMessageEvent(turn: Turn, event: MessageEvent): void {
    turn.messageState.events.push(event);
    const recomputed = computeNextMessages(
      turn.messageState.baseMessages,
      turn.messageState.events
    );
    turn.messageState.nextMessages.splice(0, turn.messageState.nextMessages.length, ...recomputed);
  }

  private toPipelineTurnAuth(auth: TurnAuth): PipelineTurnAuth | undefined {
    const pipelineAuth: PipelineTurnAuth = {};

    if (auth.actor) {
      pipelineAuth.actor = {
        type: auth.actor.type,
        id: auth.actor.id,
        display: auth.actor.display,
      };
    }

    if (auth.subjects) {
      pipelineAuth.subjects = {
        global: auth.subjects.global,
        user: auth.subjects.user,
      };
    }

    if (pipelineAuth.actor || pipelineAuth.subjects) {
      return pipelineAuth;
    }

    return undefined;
  }

  private toPipelineLlmMessage(message: LlmMessage): PipelineLlmMessage {
    if (message.role === 'system') {
      return {
        id: message.id,
        role: 'system',
        content: message.content,
      };
    }

    if (message.role === 'user') {
      return {
        id: message.id,
        role: 'user',
        content: message.content,
      };
    }

    if (message.role === 'assistant') {
      const assistant: PipelineLlmMessage = {
        id: message.id,
        role: 'assistant',
      };

      if (message.content !== undefined) {
        assistant.content = message.content;
      }

      if (message.toolCalls !== undefined) {
        assistant['toolCalls'] = message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          args: { ...toolCall.args },
        }));
      }

      return assistant;
    }

    return {
      id: message.id,
      role: 'tool',
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      output: message.output,
    };
  }

  private toPipelineMessageEvent(event: MessageEvent): PipelineMessageEvent {
    if (event.type === 'llm_message') {
      return {
        type: 'llm_message',
        seq: event.seq,
        message: this.toPipelineLlmMessage(event.message),
      };
    }

    if (event.type === 'system_message') {
      return {
        type: 'system_message',
        seq: event.seq,
        message: {
          id: event.message.id,
          role: 'system',
          content: event.message.content,
        },
      };
    }

    if (event.type === 'replace') {
      return {
        type: 'replace',
        seq: event.seq,
        targetId: event.targetId,
        message: this.toPipelineLlmMessage(event.message),
      };
    }

    if (event.type === 'remove') {
      return {
        type: 'remove',
        seq: event.seq,
        targetId: event.targetId,
      };
    }

    return {
      type: 'truncate',
      seq: event.seq,
    };
  }

  private toRuntimeMessageEvent(event: PipelineMessageEvent): MessageEvent | null {
    if (event.type === 'truncate') {
      return {
        type: 'truncate',
        seq: event.seq,
      };
    }

    if (event.type === 'remove') {
      return {
        type: 'remove',
        seq: event.seq,
        targetId: event.targetId,
      };
    }

    if (event.type === 'replace') {
      return {
        type: 'replace',
        seq: event.seq,
        targetId: event.targetId,
        message: this.normalizePipelineLlmMessage(event.message),
      };
    }

    if (event.type === 'system_message') {
      return {
        type: 'system_message',
        seq: event.seq,
        message: {
          id: event.message.id,
          role: 'system',
          content: typeof event.message.content === 'string' ? event.message.content : '',
        },
      };
    }

    if (event.type === 'llm_message') {
      const normalized = this.normalizePipelineLlmMessage(event.message);
      if (normalized.role === 'system') {
        return {
          type: 'system_message',
          seq: event.seq,
          message: normalized,
        };
      }

      return {
        type: 'llm_message',
        seq: event.seq,
        message: normalized,
      };
    }

    return null;
  }

  private normalizePipelineLlmMessage(message: PipelineLlmMessage): LlmMessage {
    if (message.role === 'system') {
      return {
        id: message.id,
        role: 'system',
        content: typeof message.content === 'string' ? message.content : '',
      };
    }

    if (message.role === 'user') {
      return {
        id: message.id,
        role: 'user',
        content: typeof message.content === 'string' ? message.content : '',
      };
    }

    if (message.role === 'tool') {
      const toolCallId = typeof message['toolCallId'] === 'string'
        ? message['toolCallId']
        : `toolcall-${message.id}`;
      const toolName = typeof message['toolName'] === 'string'
        ? message['toolName']
        : 'unknown.tool';
      const output = message['output'] ?? null;

      return {
        id: message.id,
        role: 'tool',
        toolCallId,
        toolName,
        output,
      };
    }

    const assistant: {
      id: string;
      role: 'assistant';
      content?: string;
      toolCalls?: ToolCall[];
    } = {
      id: message.id,
      role: 'assistant',
    };

    if (typeof message.content === 'string') {
      assistant.content = message.content;
    }

    const toolCalls = this.extractToolCalls(message['toolCalls']);
    if (toolCalls.length > 0) {
      assistant.toolCalls = toolCalls;
    }

    return assistant;
  }

  private extractToolCalls(value: unknown): ToolCall[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const toolCalls: ToolCall[] = [];
    for (const item of value) {
      if (!isJsonObject(item)) {
        continue;
      }

      const id = item['id'];
      const name = item['name'];
      const args = item['args'];

      if (typeof id !== 'string' || typeof name !== 'string' || !isJsonObject(args)) {
        continue;
      }

      toolCalls.push({
        id,
        name,
        args,
      });
    }

    return toolCalls;
  }
}

/**
 * TurnRunner 생성
 */
export function createTurnRunner(options: TurnRunnerOptions): TurnRunner {
  return new TurnRunnerImpl(options);
}
