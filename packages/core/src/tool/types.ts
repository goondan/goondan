/**
 * Tool 시스템 타입 정의
 * @see /docs/specs/tool.md
 */

import type { JsonValue, JsonObject } from '../types/json.js';
import type { JsonSchema } from '../types/json-schema.js';
import type { Resource } from '../types/resource.js';
import type { ToolSpec, ToolExport } from '../types/specs/tool.js';
import type { SwarmSpec, AgentSpec } from '../types/specs/index.js';

// =============================================================================
// Tool Handler
// =============================================================================

/**
 * Tool 핸들러 함수 시그니처
 * @param ctx - 실행 컨텍스트
 * @param input - LLM이 전달한 입력 (parameters 스키마와 일치)
 * @returns 동기 또는 비동기 결과
 */
export type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;

// =============================================================================
// Tool Call (Tool 시스템 고유 - pipeline의 ToolCall과 'arguments' vs 'input' 차이)
// =============================================================================

/**
 * Tool 호출 정보
 * @see /docs/specs/tool.md - 5.2 ToolCall 구조
 */
export interface ToolCall {
  /** tool call ID (LLM이 생성) */
  id: string;

  /** 호출할 tool export name */
  name: string;

  /** LLM이 전달한 인자 (JSON) */
  args: JsonObject;
}

// =============================================================================
// Tool Context
// =============================================================================

/**
 * SwarmInstance 참조 (간략화)
 */
export interface SwarmInstance {
  id: string;
  swarmName: string;
  status: string;
  [key: string]: JsonValue | undefined;
}

/**
 * Turn 참조 (Tool 시스템용 간략화)
 */
export interface Turn {
  id: string;
  instanceId?: string;
  agentName?: string;
  input?: string;
  messages: LlmMessage[];
  toolResults: ToolResult[] | Map<string, ToolResult>;
  origin?: JsonObject;
  auth?: TurnAuth;
  metadata?: JsonObject;
  summary?: string;
}

/**
 * TurnAuth (간략화)
 */
export interface TurnAuth {
  actor?: {
    type: 'user' | 'system';
    id: string;
    display?: string;
  };
  subjects?: {
    global?: string;
    user?: string;
  };
  userId?: string;
  tenantId?: string;
  [key: string]: JsonValue | undefined;
}

/**
 * Step 참조 (Tool 시스템용 간략화)
 */
export interface Step {
  id: string;
  index: number;
  turnId?: string;
  llmResult?: LlmResult;
  pendingToolCalls?: ToolCall[];
  startedAt?: Date;
  endedAt?: Date;
}

/**
 * LLM 결과 (간략화)
 */
export interface LlmResult {
  message?: LlmMessage;
  content?: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
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
 * LLM 메시지
 */
export interface LlmMessage {
  role: string;
  content?: string;
  [key: string]: JsonValue | undefined;
}

/**
 * SwarmBundle API (간략화)
 */
export interface SwarmBundleApi {
  openChangeset(options?: { reason?: string }): Promise<{ changesetId: string }>;
  commitChangeset(options: {
    changesetId: string;
    message?: string;
  }): Promise<{ success: boolean }>;
}

/**
 * OAuth API
 */
export interface OAuthApi {
  getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
}

export interface OAuthTokenRequest {
  oauthAppRef: { kind: string; name: string };
  scopes?: string[];
  minTtlSeconds?: number;
}

export type OAuthTokenResult =
  | OAuthTokenReady
  | OAuthAuthorizationRequired
  | OAuthTokenError;

export interface OAuthTokenReady {
  status: 'ready';
  accessToken: string;
  tokenType: string;
  expiresAt?: string;
  scopes: string[];
}

export interface OAuthAuthorizationRequired {
  status: 'authorization_required';
  authSessionId: string;
  authorizationUrl: string;
  expiresAt: string;
  message: string;
}

export interface OAuthTokenError {
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}

/**
 * EventBus (간략화)
 */
export interface EventBus {
  emit?: (event: string, data?: unknown) => void;
  on?: (event: string, handler: (data: unknown) => void) => (() => void) | void;
  off?: (event: string, handler: (data: unknown) => void) => void;
}

/**
 * Tool 실행 컨텍스트
 */
export interface ToolContext {
  /** SwarmInstance 참조 */
  instance: SwarmInstance;

  /** Swarm 리소스 정의 */
  swarm: Resource<SwarmSpec>;

  /** Agent 리소스 정의 */
  agent: Resource<AgentSpec>;

  /** 현재 Turn */
  turn: Turn;

  /** 현재 Step */
  step: Step;

  /** 현재 Step의 Tool Catalog */
  toolCatalog: ToolCatalogItem[];

  /** SwarmBundle 변경 API */
  swarmBundle: SwarmBundleApi;

  /** OAuth 토큰 접근 API */
  oauth: OAuthApi;

  /** 이벤트 버스 */
  events: EventBus;

  /** 로거 */
  logger: Console;

  /** 다른 에이전트에 작업 위임 */
  delegate?(agentName: string, task: string, context?: string): Promise<JsonValue>;
}

// =============================================================================
// Tool Result (Tool 시스템 고유 - pipeline의 ToolResult와 유사하지만 status 값이 다름)
// =============================================================================

/**
 * Tool 실행 결과
 * pipeline/context.ts의 ToolResult와 유사하지만 status가 'ok' | 'error' | 'pending'
 */
export interface ToolResult {
  /** tool call ID */
  toolCallId: string;

  /** tool name */
  toolName: string;

  /** 결과 상태 */
  status: 'ok' | 'error' | 'pending';

  /** 동기 완료 시 출력값 */
  output?: JsonValue;

  /** 비동기 제출 시 핸들 */
  handle?: string;

  /** 오류 정보 (status='error' 시) */
  error?: ToolError;
}

/**
 * Tool 오류 정보
 */
export interface ToolError {
  /** 오류 메시지 (errorMessageLimit 적용됨) */
  message: string;

  /** 오류 이름/타입 */
  name?: string;

  /** 오류 코드 */
  code?: string;

  /** 사용자 복구를 위한 제안 (SHOULD) */
  suggestion?: string;

  /** 관련 문서 링크 (SHOULD) */
  helpUrl?: string;
}

// =============================================================================
// Tool Catalog (Tool 시스템 고유 - pipeline의 ToolCatalogItem과 유사)
// =============================================================================

/**
 * Tool Catalog 항목
 * pipeline/context.ts의 ToolCatalogItem과 유사하지만 source.type이 다름
 */
export interface ToolCatalogItem {
  /** LLM에 노출되는 Tool 이름 */
  name: string;

  /** LLM에 제공되는 설명 */
  description?: string;

  /** JSON Schema 파라미터 */
  parameters?: JsonSchema;

  /** 원본 Tool 리소스 (동적 등록 시 null) */
  tool?: Resource<ToolSpec> | null;

  /** 원본 Export 정의 (동적 등록 시 null) */
  export?: ToolExport | null;

  /** Tool 출처 정보 */
  source?: ToolSource;
}

/**
 * Tool 출처 정보
 */
export interface ToolSource {
  /** 출처 유형 */
  type: 'config' | 'extension' | 'mcp';

  /** 출처 이름 */
  name: string;

  /** MCP 서버 정보 (type='mcp' 시) */
  mcp?: {
    extensionName: string;
    serverName?: string;
  };
}

// =============================================================================
// Dynamic Tool Definition
// =============================================================================

/**
 * 동적 Tool 정의 (Extension에서 등록)
 */
export interface DynamicToolDefinition {
  /** Tool 이름 */
  name: string;

  /** LLM에 제공되는 설명 */
  description?: string;

  /** JSON Schema 파라미터 */
  parameters?: JsonSchema;

  /** 핸들러 함수 */
  handler: ToolHandler;
}

// =============================================================================
// Tool Registry API
// =============================================================================

/**
 * Tool Registry API
 */
export interface ToolRegistryApi {
  register(toolDef: DynamicToolDefinition): void;
  unregister(name: string): void;
  get(name: string): DynamicToolDefinition | undefined;
  list(): DynamicToolDefinition[];
}

// =============================================================================
// LLM Tool Format
// =============================================================================

/**
 * LLM에 전달되는 Tool 형식
 */
export interface LlmTool {
  name: string;
  description: string;
  parameters: JsonSchema;
}

// =============================================================================
// Async Tool Result
// =============================================================================

/**
 * 비동기 Tool 결과 (핸들러가 반환)
 */
export interface AsyncToolOutput {
  __async: true;
  handle: string;
  message?: string;
  [key: string]: JsonValue | undefined;
}

// =============================================================================
// Handler Validation
// =============================================================================

/**
 * Handler 검증 결과
 */
export interface HandlerValidationResult {
  valid: boolean;
  missingHandlers: string[];
}
