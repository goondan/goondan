/**
 * Runtime 타입 정의
 * @see /docs/specs/runtime.md - 2. 핵심 타입 정의
 */

import type { JsonValue, JsonObject } from '../types/json.js';
import type { ToolExport } from '../types/specs/tool.js';
import type { Resource } from '../types/resource.js';
import type { ToolSpec } from '../types/specs/tool.js';

/**
 * SwarmBundleRef: 특정 SwarmBundle 스냅샷을 식별하는 불변 식별자
 *
 * 규칙:
 * - MUST: 동일 SwarmBundleRef는 동일한 Bundle 콘텐츠를 재현 가능해야 한다
 * - SHOULD: Git 기반 구현에서는 commit SHA를 사용한다
 */
export type SwarmBundleRef = string;

/**
 * SwarmInstance 상태
 */
export type SwarmInstanceStatus = 'active' | 'idle' | 'paused' | 'terminated';

/**
 * AgentInstance 상태
 */
export type AgentInstanceStatus = 'idle' | 'processing' | 'terminated';

/**
 * Turn 상태
 */
export type TurnStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted';

/**
 * Step 상태
 */
export type StepStatus =
  | 'pending'
  | 'config'
  | 'tools'
  | 'blocks'
  | 'llmInput'
  | 'llmCall'
  | 'toolExec'
  | 'post'
  | 'completed'
  | 'failed';

/**
 * AgentEvent 타입
 */
export type AgentEventType =
  | 'user.input'
  | 'agent.delegate'
  | 'agent.delegationResult'
  | 'auth.granted'
  | 'system.wakeup'
  | string;

/**
 * TurnOrigin: Turn의 호출 맥락 정보
 *
 * 규칙:
 * - SHOULD: Connector가 ingress 이벤트 변환 시 채운다
 */
export interface TurnOrigin {
  /** Connector 이름 */
  connector?: string;
  /** 채널 식별자 (예: Slack channel ID) */
  channel?: string;
  /** 스레드 식별자 (예: Slack thread_ts) */
  threadTs?: string;
  /** 추가 맥락 정보 */
  [key: string]: JsonValue | undefined;
}

/**
 * TurnAuth: Turn의 인증 컨텍스트
 *
 * 규칙:
 * - MUST: 에이전트 간 handoff 시 변경 없이 전달되어야 한다
 * - MUST: subjectMode=user인 OAuthApp 사용 시 auth가 필수이다
 */
export interface TurnAuth {
  /** 행위자 정보 */
  actor?: {
    type: 'user' | 'system' | 'agent';
    id: string;
    display?: string;
  };
  /** OAuth subject 조회용 키 */
  subjects?: {
    /** 전역 토큰용 (예: "slack:team:T111") */
    global?: string;
    /** 사용자 토큰용 (예: "slack:user:T111:U234567") */
    user?: string;
  };
  /** 추가 인증 메타데이터 */
  [key: string]: JsonValue | undefined;
}

// ============================================================
// LLM Message 타입
// ============================================================

/**
 * LlmMessage: LLM과의 대화 메시지 단위
 *
 * 규칙:
 * - MUST: Turn.messages에 순서대로 누적
 * - MUST: 다음 Step의 입력 컨텍스트로 사용
 */
export type LlmMessage =
  | LlmSystemMessage
  | LlmUserMessage
  | LlmAssistantMessage
  | LlmToolMessage;

export interface LlmSystemMessage {
  readonly id: string;
  readonly role: 'system';
  readonly content: string;
}

export interface LlmUserMessage {
  readonly id: string;
  readonly role: 'user';
  readonly content: string;
  readonly attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  readonly type: 'image' | 'file';
  readonly url?: string;
  readonly base64?: string;
  readonly mimeType?: string;
}

export interface LlmAssistantMessage {
  readonly id: string;
  readonly role: 'assistant';
  readonly content?: string;
  readonly toolCalls?: ToolCall[];
}

export interface LlmToolMessage {
  readonly id: string;
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: JsonValue;
}

/**
 * LlmResult: LLM 호출 결과
 */
export interface LlmResult {
  /** 응답 메시지 */
  readonly message: LlmAssistantMessage;
  /** 응답 메타데이터 */
  readonly meta: {
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    model?: string;
    finishReason?: string;
  };
}

// ============================================================
// MessageEvent 타입
// ============================================================

/**
 * MessageEvent: Turn 메시지 상태 변경 이벤트
 *
 * NextMessages = BaseMessages + SUM(Events) 공식으로 계산
 */
export type MessageEvent =
  | SystemMessageEvent
  | LlmMessageEvent
  | ReplaceEvent
  | RemoveEvent
  | TruncateEvent;

export interface SystemMessageEvent {
  readonly type: 'system_message';
  readonly seq: number;
  readonly message: LlmSystemMessage;
}

export interface LlmMessageEvent {
  readonly type: 'llm_message';
  readonly seq: number;
  readonly message: LlmUserMessage | LlmAssistantMessage | LlmToolMessage;
}

export interface ReplaceEvent {
  readonly type: 'replace';
  readonly seq: number;
  readonly targetId: string;
  readonly message: LlmMessage;
}

export interface RemoveEvent {
  readonly type: 'remove';
  readonly seq: number;
  readonly targetId: string;
}

export interface TruncateEvent {
  readonly type: 'truncate';
  readonly seq: number;
}

/**
 * TurnMessageState: Turn의 메시지 상태 모델
 *
 * NextMessages = BaseMessages + SUM(Events)
 */
export interface TurnMessageState {
  readonly baseMessages: LlmMessage[];
  readonly events: MessageEvent[];
  readonly nextMessages: LlmMessage[];
}

// ============================================================
// Tool 관련 타입
// ============================================================

/**
 * ToolCall: LLM이 요청한 도구 호출
 */
export interface ToolCall {
  /** Tool call 고유 ID */
  readonly id: string;
  /** 도구 이름 */
  readonly name: string;
  /** LLM이 전달한 인자 (JSON) */
  readonly args: JsonObject;
}

/**
 * ToolResult: 도구 실행 결과
 *
 * 규칙:
 * - MUST: 동기 완료 시 output 포함
 * - MAY: 비동기 제출 시 handle 포함
 * - MUST: 오류 시 error 정보를 output에 포함 (예외 전파 금지)
 */
export interface ToolResult {
  /** 해당 tool call ID */
  readonly toolCallId: string;
  /** 도구 이름 */
  readonly toolName: string;
  /** 결과 상태 */
  readonly status: 'ok' | 'error' | 'pending';
  /** 실행 결과 (동기 완료) */
  readonly output?: JsonValue;
  /** 비동기 핸들 */
  readonly handle?: string;
  /** 오류 정보 (status === 'error' 시) */
  readonly error?: {
    name: string;
    message: string;
    code?: string;
    /** 사용자에게 제시할 해결 제안 */
    suggestion?: string;
    /** 관련 도움말 URL */
    helpUrl?: string;
  };
}

/**
 * ContextBlock: Step 컨텍스트에 주입되는 블록
 */
export interface ContextBlock {
  /** 블록 타입 */
  readonly type: string;
  /** 블록 데이터 */
  readonly data?: JsonValue;
  /** 블록 아이템 목록 */
  readonly items?: JsonValue[];
}

/**
 * ToolCatalogItem: Step에서 LLM에 노출되는 도구 항목
 */
export interface ToolCatalogItem {
  /** 도구 이름 */
  readonly name: string;
  /** 도구 설명 */
  readonly description?: string;
  /** 파라미터 스키마 (JSON Schema) */
  readonly parameters?: JsonObject;
  /** 원본 Tool 리소스 참조 */
  readonly tool?: Resource<ToolSpec> | null;
  /** Tool export 정보 */
  readonly export?: ToolExport | null;
  /** 도구 소스 정보 (MCP, Extension 등) */
  readonly source?: JsonObject;
}

// ============================================================
// AgentEvent 타입
// ============================================================

/**
 * AgentEvent: AgentInstance로 전달되는 이벤트
 */
export interface AgentEvent {
  /** 이벤트 ID */
  readonly id: string;
  /** 이벤트 타입 */
  readonly type: AgentEventType;
  /** 입력 텍스트 (user input 등) */
  readonly input?: string;
  /** 호출 맥락 (Connector 정보 등) */
  readonly origin?: TurnOrigin;
  /** 인증 컨텍스트 */
  readonly auth?: TurnAuth;
  /** 이벤트 메타데이터 */
  readonly metadata?: JsonObject;
  /** 이벤트 생성 시각 */
  readonly createdAt: Date;
}

// ============================================================
// MessageEvent 타입 가드
// ============================================================

export function isSystemMessageEvent(event: MessageEvent): event is SystemMessageEvent {
  return event.type === 'system_message';
}

export function isLlmMessageEvent(event: MessageEvent): event is LlmMessageEvent {
  return event.type === 'llm_message';
}

export function isReplaceMessageEvent(event: MessageEvent): event is ReplaceEvent {
  return event.type === 'replace';
}

export function isRemoveMessageEvent(event: MessageEvent): event is RemoveEvent {
  return event.type === 'remove';
}

export function isTruncateMessageEvent(event: MessageEvent): event is TruncateEvent {
  return event.type === 'truncate';
}

// ============================================================
// TurnMessageState 계산
// ============================================================

/**
 * MessageEvent에서 nextMessages를 재계산
 *
 * 규칙:
 * - MUST: nextMessages = fold(baseMessages, events)
 */
export function computeNextMessages(
  baseMessages: readonly LlmMessage[],
  events: readonly MessageEvent[]
): LlmMessage[] {
  let messages = [...baseMessages];

  for (const event of events) {
    switch (event.type) {
      case 'system_message':
        messages.push(event.message);
        break;
      case 'llm_message':
        messages.push(event.message);
        break;
      case 'replace': {
        const idx = messages.findIndex((m) => m.id === event.targetId);
        if (idx >= 0) {
          messages[idx] = event.message;
        }
        break;
      }
      case 'remove':
        messages = messages.filter((m) => m.id !== event.targetId);
        break;
      case 'truncate':
        messages = [];
        break;
    }
  }

  return messages;
}

/**
 * 빈 TurnMessageState 생성
 */
export function createTurnMessageState(
  baseMessages?: LlmMessage[]
): TurnMessageState {
  const base = baseMessages ?? [];
  return {
    baseMessages: [...base],
    events: [],
    nextMessages: [...base],
  };
}

// ============================================================
// Observability 타입
// ============================================================

/**
 * Token 사용량
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Step 메트릭
 */
export interface StepMetrics {
  /** Step 실행 시간(ms) */
  latencyMs: number;
  /** Tool 호출 횟수 */
  toolCallCount: number;
  /** 오류 횟수 */
  errorCount: number;
  /** 토큰 사용량 */
  tokenUsage: TokenUsage;
}

/**
 * Turn 메트릭
 */
export interface TurnMetrics {
  /** Turn 전체 실행 시간(ms) */
  latencyMs: number;
  /** Step 수 */
  stepCount: number;
  /** 총 Tool 호출 횟수 */
  toolCallCount: number;
  /** 총 오류 횟수 */
  errorCount: number;
  /** 총 토큰 사용량 */
  tokenUsage: TokenUsage;
}

/**
 * Runtime 이벤트 로그 엔트리
 */
export interface RuntimeLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  traceId?: string;
  context: {
    instanceKey?: string;
    swarmRef?: string;
    agentName?: string;
    turnId?: string;
    stepIndex?: number;
  };
  data?: JsonObject;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * Health Check 결과
 */
export interface HealthCheckResult {
  /** 전체 상태 */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** 활성 인스턴스 수 */
  activeInstances: number;
  /** 현재 실행 중인 Turn 수 */
  activeTurns: number;
  /** 마지막 활동 시각 */
  lastActivityAt?: string;
  /** 구성 요소별 상태 */
  components?: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
  }>;
}

/**
 * 인스턴스 GC 정책
 */
export interface InstanceGcPolicy {
  /** 인스턴스 최대 생존 시간(ms) (0이면 비활성화) */
  ttlMs?: number;
  /** 유휴 상태 최대 시간(ms) (0이면 비활성화) */
  idleTimeoutMs?: number;
  /** GC 검사 간격(ms) */
  checkIntervalMs?: number;
}

// ============================================================
// 민감값 마스킹
// ============================================================

/** 민감 필드 키 패턴 */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /api[_-]?key/i,
];

/**
 * 민감값 마스킹
 *
 * 규칙:
 * - SHOULD: 마스킹된 값은 앞 4자만 노출하고 나머지는 "****"로 대체한다
 */
export function maskSensitiveValue(value: string): string {
  if (value.length <= 4) {
    return '****';
  }
  return value.slice(0, 4) + '****';
}

/**
 * 키 이름이 민감한 필드인지 확인
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * JsonValue가 JsonObject인지 확인하는 타입 가드
 */
function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 객체 내 민감값을 재귀적으로 마스킹
 */
export function maskSensitiveFields(obj: JsonObject): JsonObject {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key) && typeof value === 'string') {
      result[key] = maskSensitiveValue(value);
    } else if (isJsonObject(value)) {
      result[key] = maskSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ============================================================
// LlmMessage 타입 가드
// ============================================================

/**
 * LlmSystemMessage 타입 가드
 */
export function isLlmSystemMessage(msg: LlmMessage): msg is LlmSystemMessage {
  return msg.role === 'system';
}

/**
 * LlmUserMessage 타입 가드
 */
export function isLlmUserMessage(msg: LlmMessage): msg is LlmUserMessage {
  return msg.role === 'user';
}

/**
 * LlmAssistantMessage 타입 가드
 */
export function isLlmAssistantMessage(msg: LlmMessage): msg is LlmAssistantMessage {
  return msg.role === 'assistant';
}

/**
 * LlmToolMessage 타입 가드
 */
export function isLlmToolMessage(msg: LlmMessage): msg is LlmToolMessage {
  return msg.role === 'tool';
}

// ============================================================
// 팩토리 함수
// ============================================================

/**
 * 고유 ID 생성
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * ToolCall 생성
 */
export function createToolCall(
  name: string,
  args: JsonObject,
  id?: string
): ToolCall {
  return {
    id: id ?? generateId(),
    name,
    args,
  };
}

/**
 * ToolResult 생성
 */
export function createToolResult(
  toolCallId: string,
  toolName: string,
  output?: JsonValue,
  error?: Error
): ToolResult {
  if (error) {
    return {
      toolCallId,
      toolName,
      status: 'error',
      error: {
        name: error.name,
        message: error.message,
        code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
      },
    };
  }

  return {
    toolCallId,
    toolName,
    status: 'ok',
    output,
  };
}

/**
 * AgentEvent 생성
 */
export function createAgentEvent(
  type: AgentEventType,
  input?: string,
  origin?: TurnOrigin,
  auth?: TurnAuth,
  metadata?: JsonObject
): AgentEvent {
  return {
    id: generateId(),
    type,
    input,
    origin,
    auth,
    metadata,
    createdAt: new Date(),
  };
}
