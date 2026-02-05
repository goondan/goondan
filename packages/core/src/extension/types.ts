/**
 * Extension 시스템 타입 정의
 * @see /docs/specs/extension.md
 */

import type { JsonObject, JsonValue } from '../types/json.js';
import type { Resource } from '../types/resource.js';
import type { ObjectRefLike } from '../types/object-ref.js';
import type { ExtensionSpec } from '../types/specs/extension.js';
import type { SwarmSpec } from '../types/specs/swarm.js';
import type { AgentSpec } from '../types/specs/agent.js';
import type { ToolSpec } from '../types/specs/tool.js';
import type { ModelSpec } from '../types/specs/model.js';
import type { ConnectorSpec } from '../types/specs/connector.js';
import type { OAuthAppSpec } from '../types/specs/oauth-app.js';

// ============================================================================
// Pipeline Types
// ============================================================================

/**
 * 모든 파이프라인 포인트
 */
export type PipelinePoint =
  // Turn 레벨
  | 'turn.pre'
  | 'turn.post'
  // Step 레벨
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmCall'
  | 'step.llmError'
  | 'step.post'
  // ToolCall 레벨
  | 'toolCall.pre'
  | 'toolCall.exec'
  | 'toolCall.post'
  // Workspace 레벨
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

/**
 * Mutator 포인트 (순차 실행으로 컨텍스트 변형)
 */
export type MutatorPoint =
  | 'turn.pre'
  | 'turn.post'
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmError'
  | 'step.post'
  | 'toolCall.pre'
  | 'toolCall.post'
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

/**
 * Middleware 포인트 (next() 기반 래핑)
 */
export type MiddlewarePoint =
  | 'step.llmCall'
  | 'toolCall.exec';

/**
 * Mutator 핸들러
 */
export type MutatorHandler<T extends PipelineContext = PipelineContext> = (
  ctx: T
) => Promise<T> | T;

/**
 * Middleware 핸들러
 */
export type MiddlewareHandler<T extends PipelineContext = PipelineContext, R = unknown> = (
  ctx: T,
  next: (ctx: T) => Promise<R>
) => Promise<R>;

/**
 * 핸들러 옵션
 */
export interface HandlerOptions {
  /** 실행 우선순위 (낮을수록 먼저 실행, 기본: 0) */
  priority?: number;
  /** 식별자 (reconcile용) */
  id?: string;
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * 기본 파이프라인 컨텍스트
 */
export interface PipelineContext {
  [key: string]: unknown;
}

/**
 * LLM 메시지 타입
 */
export type LlmMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  type: 'image' | 'file';
  url?: string;
  base64?: string;
  mimeType?: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content?: string;
  toolCalls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  toolCallId: string;
  toolName: string;
  output: JsonValue;
}

/**
 * Tool 호출 정보
 */
export interface ToolCall {
  id: string;
  name: string;
  input: JsonObject;
}

/**
 * Tool 실행 결과
 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: JsonValue;
  status: 'success' | 'error';
  error?: {
    name: string;
    message: string;
    code?: string;
  };
}

/**
 * Turn 인증 컨텍스트
 */
export interface TurnAuth {
  actor?: {
    type: 'user' | 'system';
    id: string;
    display?: string;
    isAdmin?: boolean;
  };
  subjects?: {
    global?: string;
    user?: string;
  };
}

/**
 * Turn 정보
 */
export interface Turn {
  id: string;
  input: string;
  messages: LlmMessage[];
  toolResults: ToolResult[];
  origin?: JsonObject;
  auth?: TurnAuth;
  metadata?: JsonObject;
  summary?: string;
}

/**
 * Step 정보
 */
export interface Step {
  id: string;
  index: number;
  llmResult?: LlmResult;
  startedAt: Date;
  endedAt?: Date;
  metadata?: JsonObject;
}

/**
 * LLM 호출 결과
 */
export interface LlmResult {
  message: AssistantMessage;
  toolCalls: ToolCall[];
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
 * 컨텍스트 블록
 */
export interface ContextBlock {
  type: string;
  data?: JsonValue;
  items?: JsonValue[];
  priority?: number;
  [key: string]: JsonValue | undefined;
}

/**
 * Tool Catalog 항목
 */
export interface ToolCatalogItem {
  name: string;
  description?: string;
  parameters?: JsonObject;
  tool?: Resource<ToolSpec> | null;
  export?: ToolExportSpec | null;
  source?: {
    type: 'static' | 'dynamic' | 'mcp';
    extension?: string;
    mcpServer?: string;
  };
}

export interface ToolExportSpec {
  name: string;
  description: string;
  parameters?: JsonObject;
  auth?: {
    scopes?: string[];
  };
}

/**
 * Effective Config
 */
export interface EffectiveConfig {
  swarm: Resource<SwarmSpec>;
  agents: Map<string, Resource<AgentSpec>>;
  models: Map<string, Resource<ModelSpec>>;
  tools: Map<string, Resource<ToolSpec>>;
  extensions: Map<string, Resource<ExtensionSpec>>;
  connectors: Map<string, Resource<ConnectorSpec>>;
  oauthApps: Map<string, Resource<OAuthAppSpec>>;
  revision: number;
  swarmBundleRef: string;
}

/**
 * Turn 컨텍스트
 */
export interface TurnContext extends PipelineContext {
  turn: Turn;
  swarm: Resource<SwarmSpec>;
  agent: Resource<AgentSpec>;
  effectiveConfig: EffectiveConfig;
}

/**
 * Step 컨텍스트
 */
export interface StepContext extends TurnContext {
  step: Step;
  blocks: ContextBlock[];
  toolCatalog: ToolCatalogItem[];
  activeSwarmRef: string;
}

/**
 * ToolCall 컨텍스트
 */
export interface ToolCallContext extends StepContext {
  toolCall: ToolCall;
  toolResult?: ToolResult;
}

/**
 * Workspace 컨텍스트
 */
export interface WorkspaceContext extends PipelineContext {
  path: string;
  type: 'repo' | 'worktree';
  metadata?: JsonObject;
}

/**
 * LLM 에러 컨텍스트
 */
export interface LlmErrorContext extends StepContext {
  error: Error;
  retryCount: number;
  shouldRetry: boolean;
  retryDelayMs: number;
}

// ============================================================================
// API Types
// ============================================================================

/**
 * 이벤트 핸들러
 */
export type EventHandler = (payload: JsonObject) => void | Promise<void>;

/**
 * 이벤트 버스 인터페이스
 */
export interface EventBus {
  /**
   * 이벤트 발행
   */
  emit(type: string, payload?: JsonObject): void;

  /**
   * 이벤트 구독
   * @returns 구독 해제 함수
   */
  on(type: string, handler: EventHandler): () => void;

  /**
   * 일회성 이벤트 구독
   * @returns 구독 해제 함수
   */
  once(type: string, handler: EventHandler): () => void;

  /**
   * 구독 해제
   */
  off(type: string, handler: EventHandler): void;
}

/**
 * 파이프라인 API 인터페이스
 */
export interface PipelineApi {
  /**
   * Mutator 등록
   */
  mutate<T extends MutatorPoint>(
    point: T,
    handler: MutatorHandler<ContextForPoint<T>>,
    options?: HandlerOptions
  ): void;

  /**
   * Middleware 등록
   */
  wrap<T extends MiddlewarePoint>(
    point: T,
    handler: MiddlewareHandler<ContextForPoint<T>, ResultForPoint<T>>,
    options?: HandlerOptions
  ): void;
}

/**
 * 포인트별 컨텍스트 타입 매핑
 */
export type ContextForPoint<T extends PipelinePoint> =
  T extends 'turn.pre' | 'turn.post' ? TurnContext :
  T extends 'step.pre' | 'step.config' | 'step.tools' | 'step.blocks' | 'step.llmCall' | 'step.post' ? StepContext :
  T extends 'step.llmError' ? LlmErrorContext :
  T extends 'toolCall.pre' | 'toolCall.exec' | 'toolCall.post' ? ToolCallContext :
  T extends 'workspace.repoAvailable' | 'workspace.worktreeMounted' ? WorkspaceContext :
  PipelineContext;

/**
 * 포인트별 결과 타입 매핑
 */
export type ResultForPoint<T extends PipelinePoint> =
  T extends 'step.llmCall' ? LlmResult :
  T extends 'toolCall.exec' ? ToolResult :
  unknown;

/**
 * 동적 Tool 정의
 */
export interface DynamicToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: DynamicToolHandler;
  metadata?: {
    source?: string;
    version?: string;
    [key: string]: JsonValue | undefined;
  };
}

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonObject;
  properties?: Record<string, JsonObject>;
  required?: string[];
  [key: string]: JsonValue | undefined;
}

export type DynamicToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;

/**
 * Tool 컨텍스트
 */
export interface ToolContext extends StepContext {
  oauth: OAuthApi;
  swarmBundle: SwarmBundleApi;
  liveConfig: LiveConfigApi;
  events: EventBus;
  logger: Console;
}

/**
 * Tool Registry API 인터페이스
 */
export interface ToolRegistryApi {
  /**
   * 동적 Tool 등록
   */
  register(toolDef: DynamicToolDefinition): void;

  /**
   * Tool 등록 해제
   */
  unregister(name: string): void;

  /**
   * Tool 조회
   */
  get(name: string): DynamicToolDefinition | undefined;

  /**
   * 모든 Tool 목록
   */
  list(): DynamicToolDefinition[];
}

/**
 * SwarmBundle API 인터페이스
 */
export interface SwarmBundleApi {
  /**
   * Changeset 열기
   */
  openChangeset(input?: OpenChangesetInput): Promise<OpenChangesetResult>;

  /**
   * Changeset 커밋
   */
  commitChangeset(input: CommitChangesetInput): Promise<CommitChangesetResult>;

  /**
   * 현재 활성 SwarmBundleRef 조회
   */
  getActiveRef?(): string;
}

export interface OpenChangesetInput {
  reason?: string;
}

export interface OpenChangesetResult {
  changesetId: string;
  baseRef: string;
  workdir: string;
  hint?: {
    bundleRootInWorkdir: string;
    recommendedFiles: string[];
  };
}

export interface CommitChangesetInput {
  changesetId: string;
  message?: string;
}

export interface CommitChangesetResult {
  status: 'ok' | 'rejected' | 'failed';
  changesetId: string;
  baseRef: string;
  newRef?: string;
  summary?: {
    filesChanged: string[];
    filesAdded: string[];
    filesDeleted: string[];
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Live Config API 인터페이스
 */
export interface LiveConfigApi {
  /**
   * Config 변경 패치 제안
   */
  proposePatch(patch: LiveConfigPatch): Promise<void>;

  /**
   * 현재 Effective Config 조회
   */
  getEffectiveConfig(): EffectiveConfig;

  /**
   * 현재 revision 조회
   */
  getRevision?(): number;
}

export interface LiveConfigPatch {
  scope: 'swarm' | 'agent';
  applyAt: 'step.config' | 'immediate';
  patch: {
    type: 'json6902';
    ops: JsonPatchOperation[];
  };
  source: {
    type: 'tool' | 'extension';
    name: string;
  };
  reason?: string;
}

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: JsonValue;
  from?: string;
}

/**
 * OAuth API 인터페이스
 */
export interface OAuthApi {
  /**
   * Access Token 획득
   */
  getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
}

export interface OAuthTokenRequest {
  oauthAppRef: ObjectRefLike;
  scopes?: string[];
  minTtlSeconds?: number;
}

export type OAuthTokenResult =
  | OAuthTokenReady
  | OAuthTokenAuthorizationRequired
  | OAuthTokenError;

export interface OAuthTokenReady {
  status: 'ready';
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  scopes: string[];
}

export interface OAuthTokenAuthorizationRequired {
  status: 'authorization_required';
  authSessionId: string;
  authorizationUrl: string;
  expiresAt: string;
  message: string;
  deviceCode?: {
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  };
}

export interface OAuthTokenError {
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}

// ============================================================================
// ExtensionApi
// ============================================================================

/**
 * Extension API 인터페이스
 * Extension의 register() 함수에 전달됨
 */
export interface ExtensionApi<
  TState = JsonObject,
  _TConfig = JsonObject
> {
  /**
   * Extension 리소스 정의
   */
  extension: Resource<ExtensionSpec>;

  /**
   * 파이프라인 등록 API
   */
  pipelines: PipelineApi;

  /**
   * Tool 등록 API
   */
  tools: ToolRegistryApi;

  /**
   * 이벤트 버스
   */
  events: EventBus;

  /**
   * SwarmBundle Changeset API
   */
  swarmBundle: SwarmBundleApi;

  /**
   * Live Config API
   */
  liveConfig: LiveConfigApi;

  /**
   * OAuth API
   */
  oauth: OAuthApi;

  /**
   * 확장별 상태 저장소
   */
  extState: () => TState;

  /**
   * 인스턴스 공유 상태
   */
  instance: {
    shared: JsonObject;
  };

  /**
   * 로거
   */
  logger?: Console;
}

/**
 * Extension 등록 함수 시그니처
 */
export type RegisterFunction<TState = JsonObject, TConfig = JsonObject> = (
  api: ExtensionApi<TState, TConfig>
) => Promise<void> | void;

// ============================================================================
// State Store Types
// ============================================================================

/**
 * 상태 저장소 인터페이스
 */
export interface StateStore {
  /**
   * Extension별 상태 조회
   * 반환된 객체를 원하는 타입으로 사용 가능
   */
  getExtensionState(extensionName: string): JsonObject;

  /**
   * 인스턴스 공유 상태 조회
   */
  getSharedState(): JsonObject;

  /**
   * Extension 상태 초기화
   */
  clearExtensionState(extensionName: string): void;

  /**
   * 모든 상태 초기화
   */
  clearAll(): void;
}

// ============================================================================
// Loader Types
// ============================================================================

/**
 * Extension 로드 결과
 */
export interface ExtensionLoadResult {
  name: string;
  status: 'loaded' | 'failed';
  error?: Error;
}
