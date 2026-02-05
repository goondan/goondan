/**
 * Pipeline Context 타입 정의
 * @see /docs/specs/pipeline.md - 4. 컨텍스트 구조
 */

import type { JsonObject, JsonValue, Resource } from '../types/index.js';
import type { PipelinePoint } from './types.js';

/**
 * 간소화된 SwarmInstance 참조 (실제 런타임에서 확장)
 */
export interface SwarmInstanceRef {
  /** Instance 고유 식별자 */
  id: string;
  /** Instance 키 */
  key: string;
}

/**
 * 간소화된 EventBus 인터페이스 (실제 런타임에서 확장)
 */
export interface EventBus {
  emit: (event: string, data?: unknown) => void;
  on: (event: string, handler: (data: unknown) => void) => () => void;
}

/**
 * LLM 메시지 타입
 */
export interface LlmMessage {
  role: string;
  content?: string;
  [key: string]: JsonValue | undefined;
}

/**
 * 기본 파이프라인 컨텍스트
 * 모든 파이프라인 컨텍스트의 기반 인터페이스
 */
export interface BasePipelineContext {
  /** 현재 SwarmInstance 참조 */
  instance: SwarmInstanceRef;
  /** Swarm 리소스 정의 */
  swarm: Resource<JsonObject>;
  /** 현재 Agent 리소스 정의 */
  agent: Resource<JsonObject>;
  /** 현재 Effective Config */
  effectiveConfig: JsonObject;
  /** 이벤트 버스 */
  events: EventBus;
  /** 로거 */
  logger: Console;
}

/**
 * Turn 인증 정보
 */
export interface TurnAuth {
  /** 호출자 정보 */
  actor?: {
    type: 'user' | 'system';
    id: string;
    display?: string;
  };
  /** Subject 식별자 (OAuth 토큰 조회용) */
  subjects?: {
    global?: string;
    user?: string;
  };
}

/**
 * Turn 정보
 */
export interface Turn {
  /** Turn 고유 식별자 */
  id: string;
  /** Turn 입력 텍스트 */
  input: string;
  /** 누적된 LLM 메시지 */
  messages: LlmMessage[];
  /** Tool 실행 결과 */
  toolResults: ToolResult[];
  /** 호출 원점 정보 (Connector 등) */
  origin?: JsonObject;
  /** 인증 컨텍스트 */
  auth?: TurnAuth;
  /** 메타데이터 */
  metadata?: JsonObject;
  /** Turn 요약 (turn.post에서 생성) */
  summary?: string;
}

/**
 * Turn 컨텍스트
 * Turn 레벨 파이프라인 포인트(turn.pre, turn.post)에서 사용
 */
export interface TurnContext extends BasePipelineContext {
  /** 현재 Turn */
  turn: Turn;
}

/**
 * LLM 호출 결과
 */
export interface LlmResult {
  /** LLM 응답 메시지 */
  message: LlmMessage;
  /** tool call 목록 */
  toolCalls: ToolCall[];
  /** 사용량/메타 정보 */
  meta?: {
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    model?: string;
    finishReason?: string;
  };
}

/**
 * Step 정보
 */
export interface Step {
  /** Step 고유 식별자 */
  id: string;
  /** Step 인덱스 (Turn 내에서 0부터 시작) */
  index: number;
  /** LLM 호출 결과 */
  llmResult?: LlmResult;
  /** Step 시작 시간 */
  startedAt: Date;
  /** Step 종료 시간 */
  endedAt?: Date;
}

/**
 * Tool Catalog 항목
 */
export interface ToolCatalogItem {
  /** 도구 이름 (LLM에 노출되는 이름) */
  name: string;
  /** 도구 설명 */
  description?: string;
  /** 입력 파라미터 JSON Schema */
  parameters?: JsonObject;
  /** 원본 Tool 리소스 (있는 경우) */
  tool?: Resource<JsonObject> | null;
  /** Tool export 정의 (있는 경우) */
  export?: JsonObject | null;
  /** 도구 출처 정보 */
  source?: {
    type: 'static' | 'dynamic' | 'mcp';
    extension?: string;
    mcpServer?: string;
  };
}

/**
 * Context Block
 */
export interface ContextBlock {
  /** 블록 타입 */
  type: string;
  /** 블록 데이터 */
  data?: JsonValue;
  /** 블록 항목 목록 (리스트형 블록) */
  items?: JsonValue[];
  /** 블록 우선순위 (높을수록 먼저 표시) */
  priority?: number;
}

/**
 * Step 컨텍스트
 * Step 레벨 파이프라인 포인트에서 사용
 */
export interface StepContext extends TurnContext {
  /** 현재 Step */
  step: Step;
  /** 현재 Step에서 LLM에 노출되는 도구 목록 */
  toolCatalog: ToolCatalogItem[];
  /** 컨텍스트 블록 */
  blocks: ContextBlock[];
  /** 현재 활성화된 SwarmBundleRef */
  activeSwarmRef: string;
}

/**
 * Tool Call 정보
 */
export interface ToolCall {
  /** tool call 고유 식별자 (LLM이 생성) */
  id: string;
  /** 호출할 도구 이름 */
  name: string;
  /** 도구 입력 */
  input: JsonObject;
}

/**
 * Tool 실행 결과
 */
export interface ToolResult {
  /** 대응하는 tool call ID */
  toolCallId: string;
  /** 도구 이름 */
  toolName: string;
  /** 실행 결과 */
  output: JsonValue;
  /** 실행 상태 */
  status: 'success' | 'error';
  /** 오류 정보 (status가 error인 경우) */
  error?: {
    name: string;
    message: string;
    code?: string;
  };
}

/**
 * ToolCall 컨텍스트
 * ToolCall 레벨 파이프라인 포인트에서 사용
 */
export interface ToolCallContext extends StepContext {
  /** 현재 실행 중인 tool call */
  toolCall: ToolCall;
  /** Tool 실행 결과 (toolCall.post에서 사용) */
  toolResult?: ToolResult;
}

/**
 * Workspace 컨텍스트
 * Workspace 레벨 파이프라인 포인트에서 사용
 */
export interface WorkspaceContext extends BasePipelineContext {
  /** workspace 이벤트 종류 */
  eventType: 'repoAvailable' | 'worktreeMounted';
  /** 레포지토리/worktree 경로 */
  path: string;
  /** 추가 메타데이터 */
  metadata?: JsonObject;
}

/**
 * LLM Error 컨텍스트
 * step.llmError 파이프라인 포인트에서 사용
 */
export interface LlmErrorContext extends StepContext {
  /** 발생한 오류 */
  error: Error;
  /** 재시도 횟수 */
  retryCount: number;
  /** 재시도 여부 결정 */
  shouldRetry: boolean;
  /** 재시도 지연 시간 (ms) */
  retryDelayMs: number;
}

/**
 * 파이프라인 포인트별 컨텍스트 타입 매핑
 */
export interface PipelineContextMap {
  'turn.pre': TurnContext;
  'turn.post': TurnContext;
  'step.pre': StepContext;
  'step.config': StepContext;
  'step.tools': StepContext;
  'step.blocks': StepContext;
  'step.llmCall': StepContext;
  'step.llmError': LlmErrorContext;
  'step.post': StepContext;
  'toolCall.pre': ToolCallContext;
  'toolCall.exec': ToolCallContext;
  'toolCall.post': ToolCallContext;
  'workspace.repoAvailable': WorkspaceContext;
  'workspace.worktreeMounted': WorkspaceContext;
}

/**
 * 파이프라인 포인트에서 컨텍스트 타입 추론
 */
export type ContextForPoint<T extends PipelinePoint> = PipelineContextMap[T];

/**
 * Middleware 포인트별 결과 타입 매핑
 */
export interface PipelineResultMap {
  'step.llmCall': LlmResult;
  'toolCall.exec': ToolResult;
}

/**
 * Middleware 포인트에서 결과 타입 추론
 */
export type ResultForPoint<T extends PipelinePoint> = T extends keyof PipelineResultMap
  ? PipelineResultMap[T]
  : never;
