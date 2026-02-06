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
export type SwarmInstanceStatus = 'active' | 'idle' | 'terminated';

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
  readonly role: 'system';
  readonly content: string;
}

export interface LlmUserMessage {
  readonly role: 'user';
  readonly content: string;
}

export interface LlmAssistantMessage {
  readonly role: 'assistant';
  readonly content?: string;
  readonly toolCalls?: ToolCall[];
}

export interface LlmToolMessage {
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
  /** 사용량 정보 */
  readonly usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 완료 이유 */
  readonly finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  /** 응답 메타데이터 */
  readonly meta?: JsonObject;
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
  /** 입력 인자 */
  readonly input: JsonObject;
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
  /** 실행 결과 (동기 완료) */
  readonly output?: JsonValue;
  /** 비동기 핸들 */
  readonly handle?: string;
  /** 오류 정보 */
  readonly error?: {
    status: 'error';
    error: {
      message: string;
      name?: string;
      code?: string;
    };
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
// 타입 가드
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
  input: JsonObject,
  id?: string
): ToolCall {
  return {
    id: id ?? generateId(),
    name,
    input,
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
      error: {
        status: 'error',
        error: {
          message: error.message,
          name: error.name,
          code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
        },
      },
    };
  }

  return {
    toolCallId,
    toolName,
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
