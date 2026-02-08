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
import type { ConnectionSpec } from '../types/specs/connection.js';
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
  | 'step.llmInput'
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
  | 'step.llmInput'
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
  id: string;
  role: 'system';
  content: string;
}

export interface UserMessage {
  id: string;
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
  id: string;
  role: 'assistant';
  content?: string;
  toolCalls?: ToolCall[];
}

export interface ToolMessage {
  id: string;
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
  args: JsonObject;
}

/**
 * Tool 실행 결과
 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: JsonValue;
  status: 'ok' | 'error' | 'pending';
  /** 비동기 제출 시 핸들 */
  handle?: string;
  error?: {
    name: string;
    message: string;
    code?: string;
    /** 사용자 복구를 위한 제안 (SHOULD) */
    suggestion?: string;
    /** 관련 문서 링크 (SHOULD) */
    helpUrl?: string;
  };
}

/**
 * 메시지 이벤트 (Turn 중 메시지 변경 이벤트)
 */
export type MessageEvent =
  | { type: 'system_message'; seq: number; message: SystemMessage }
  | { type: 'llm_message'; seq: number; message: UserMessage | AssistantMessage | ToolMessage }
  | { type: 'replace'; seq: number; targetId: string; message: LlmMessage }
  | { type: 'remove'; seq: number; targetId: string }
  | { type: 'truncate'; seq: number };

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
  /** Turn 메시지 상태 (NextMessages = BaseMessages + SUM(Events)) */
  messageState: {
    baseMessages: LlmMessage[];
    events: MessageEvent[];
    nextMessages: LlmMessage[];
  };
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
  connections: Map<string, Resource<ConnectionSpec>>;
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
  /** turn 시작 기준 메시지 (turn.post에서 제공) */
  baseMessages?: LlmMessage[];
  /** turn 중 누적 메시지 이벤트 (turn.post에서 제공) */
  messageEvents?: MessageEvent[];
  /** turn 메시지 이벤트 발행 */
  emitMessageEvent?: (event: MessageEvent) => Promise<void>;
}

/**
 * Step 컨텍스트
 */
export interface StepContext extends TurnContext {
  step: Step;
  blocks: ContextBlock[];
  toolCatalog: ToolCatalogItem[];
  llmInput?: LlmMessage[];
  activeSwarmRef: string;
}

/**
 * LLM Input 컨텍스트
 * step.llmInput 파이프라인 포인트에서 사용
 */
export interface LlmInputContext extends StepContext {
  llmInput: LlmMessage[];
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
  T extends 'step.llmInput' ? LlmInputContext :
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
  status: 'ok' | 'rejected' | 'conflict' | 'failed';
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
   * SwarmBundle Changeset API (선택 - Runtime capability에 따라 제공)
   */
  swarmBundle?: SwarmBundleApi;

  /**
   * Live Config API (선택 - Runtime capability에 따라 제공)
   */
  liveConfig?: LiveConfigApi;

  /**
   * OAuth API
   */
  oauth: OAuthApi;

  /**
   * 확장별 상태 접근 API
   * Extension 인스턴스별 격리된 상태
   */
  state: {
    /** 현재 상태를 반환 */
    get(): TState;
    /** 상태를 교체 (불변 패턴) */
    set(next: TState): void;
  };

  /**
   * 확장별 상태 조회 (top-level shorthand)
   * state.get()과 동일
   */
  getState: () => TState;

  /**
   * 확장별 상태 저장 (top-level shorthand)
   * state.set()과 동일
   */
  setState: (next: TState) => void;

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
export interface StateStorePersistence {
  /**
   * Extension 상태 변경 시 호출
   */
  onExtensionStateChange?: (extensionName: string, state: JsonObject) => void | Promise<void>;

  /**
   * 공유 상태 변경 시 호출
   */
  onSharedStateChange?: (state: JsonObject) => void | Promise<void>;
}

/**
 * StateStore 전체 스냅샷
 */
export interface StateStoreSnapshot {
  extensionStates: Record<string, JsonObject>;
  sharedState: JsonObject;
}

/**
 * StateStore 생성 옵션
 */
export interface CreateStateStoreOptions {
  /**
   * 초기 Extension 상태 (복원용)
   */
  initialExtensionStates?: Record<string, JsonObject>;

  /**
   * 초기 공유 상태 (복원용)
   */
  initialSharedState?: JsonObject;

  /**
   * 영속화 콜백
   */
  persistence?: StateStorePersistence;
}

/**
 * 상태 저장소 인터페이스
 */
export interface StateStore {
  /**
   * Extension별 상태 조회
   */
  getExtensionState(extensionName: string): JsonObject;

  /**
   * Extension별 상태 저장 (불변 패턴 — 새 객체로 교체)
   */
  setExtensionState(extensionName: string, state: JsonObject): void;

  /**
   * 인스턴스 공유 상태 조회
   */
  getSharedState(): JsonObject;

  /**
   * 인스턴스 공유 상태 교체 (불변 패턴)
   */
  setSharedState(state: JsonObject): void;

  /**
   * Extension 상태 초기화
   */
  clearExtensionState(extensionName: string): void;

  /**
   * 모든 상태 초기화
   */
  clearAll(): void;

  /**
   * dirty 상태를 영속 스토리지로 flush
   */
  flush(): Promise<void>;

  /**
   * 외부 스냅샷으로 상태를 재동기화
   */
  rehydrate(snapshot: StateStoreSnapshot): void;
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
