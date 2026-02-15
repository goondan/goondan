export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | string;

export interface MessageContentPart {
  type: string;
  text?: string;
  [key: string]: JsonValue | undefined;
}

export interface MessageData {
  role: MessageRole;
  content: string | MessageContentPart[];
}

export type MessageSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };

export interface Message {
  readonly id: string;
  readonly data: MessageData;
  metadata: Record<string, JsonValue>;
  readonly createdAt: Date;
  readonly source: MessageSource;
}

export type MessageEvent =
  | { type: 'append'; message: Message }
  | { type: 'replace'; targetId: string; message: Message }
  | { type: 'remove'; targetId: string }
  | { type: 'truncate' };

export interface ConversationState {
  readonly baseMessages: Message[];
  readonly events: MessageEvent[];
  readonly nextMessages: Message[];
  toLlmMessages(): MessageData[];
}

export interface ExecutionContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly traceId: string;
}

export interface ToolCallResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output?: JsonValue;
  readonly status: 'ok' | 'error';
  readonly error?: {
    name?: string;
    message: string;
    code?: string;
    suggestion?: string;
    helpUrl?: string;
  };
}

export interface EventSource {
  readonly kind: 'agent' | 'connector';
  readonly name: string;
  readonly [key: string]: JsonValue | undefined;
}

export interface ReplyChannel {
  readonly target: string;
  readonly correlationId: string;
}

export interface TurnPrincipal {
  readonly type: string;
  readonly id: string;
  readonly attributes?: Record<string, JsonValue>;
}

export interface TurnAuth {
  readonly principal?: TurnPrincipal;
  readonly attributes?: Record<string, JsonValue>;
}

export interface AgentEvent {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
  readonly traceId?: string;
  readonly metadata?: JsonObject;
  readonly input?: string;
  readonly instanceKey?: string;
  readonly source: EventSource;
  readonly auth?: TurnAuth;
  readonly replyTo?: ReplyChannel;
}

export interface AgentRuntimeRequestOptions {
  timeoutMs?: number;
}

export interface AgentRuntimeRequestResult {
  eventId: string;
  target: string;
  response?: JsonValue;
  correlationId: string;
}

export interface AgentRuntimeSendResult {
  eventId: string;
  target: string;
  accepted: boolean;
}

export interface AgentRuntimeSpawnOptions {
  instanceKey?: string;
  cwd?: string;
}

export interface AgentRuntimeSpawnResult {
  target: string;
  instanceKey: string;
  spawned: boolean;
  cwd?: string;
}

export interface AgentRuntimeListOptions {
  includeAll?: boolean;
}

export interface SpawnedAgentInfo {
  target: string;
  instanceKey: string;
  ownerAgent: string;
  ownerInstanceKey: string;
  createdAt: string;
  cwd?: string;
}

export interface AgentRuntimeListResult {
  agents: SpawnedAgentInfo[];
}

export interface AgentToolRuntime {
  request(
    target: string,
    event: AgentEvent,
    options?: AgentRuntimeRequestOptions
  ): Promise<AgentRuntimeRequestResult>;
  send(target: string, event: AgentEvent): Promise<AgentRuntimeSendResult>;
  spawn(target: string, options?: AgentRuntimeSpawnOptions): Promise<AgentRuntimeSpawnResult>;
  list(options?: AgentRuntimeListOptions): Promise<AgentRuntimeListResult>;
}

export interface ToolContext extends ExecutionContext {
  readonly toolCallId: string;
  readonly message: Message;
  readonly workdir: string;
  readonly logger: Console;
  readonly runtime?: AgentToolRuntime;
}

export type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;

export interface ToolCatalogItem {
  name: string;
  description?: string;
  parameters?: JsonObject;
  source?: {
    type: 'config' | 'extension' | 'mcp';
    name: string;
    mcp?: {
      extensionName: string;
      serverName?: string;
    };
  };
}

export interface Turn {
  readonly id: string;
  readonly startedAt: Date;
}

export interface TurnResult {
  readonly turnId: string;
  readonly responseMessage?: Message;
  readonly finishReason: 'text_response' | 'max_steps' | 'error';
  readonly error?: {
    message: string;
    code?: string;
  };
}

export interface StepResult {
  status: 'completed' | 'failed';
  hasToolCalls: boolean;
  toolCalls: { id: string; name: string; args: JsonObject }[];
  toolResults: ToolCallResult[];
  metadata: Record<string, JsonValue>;
}

export interface TurnMiddlewareContext extends ExecutionContext {
  readonly inputEvent: AgentEvent;
  readonly conversationState: ConversationState;
  emitMessageEvent(event: MessageEvent): void;
  metadata: Record<string, JsonValue>;
  next(): Promise<TurnResult>;
}

export interface StepMiddlewareContext extends ExecutionContext {
  readonly turn: Turn;
  readonly stepIndex: number;
  readonly conversationState: ConversationState;
  emitMessageEvent(event: MessageEvent): void;
  toolCatalog: ToolCatalogItem[];
  metadata: Record<string, JsonValue>;
  next(): Promise<StepResult>;
}

export interface ToolCallMiddlewareContext extends ExecutionContext {
  readonly stepIndex: number;
  readonly toolName: string;
  readonly toolCallId: string;
  args: JsonObject;
  metadata: Record<string, JsonValue>;
  next(): Promise<ToolCallResult>;
}

export type TurnMiddleware = (ctx: TurnMiddlewareContext) => Promise<TurnResult>;
export type StepMiddleware = (ctx: StepMiddlewareContext) => Promise<StepResult>;
export type ToolCallMiddleware = (
  ctx: ToolCallMiddlewareContext
) => Promise<ToolCallResult>;

export interface PipelineRegistry {
  register(type: 'turn', middleware: TurnMiddleware): void;
  register(type: 'step', middleware: StepMiddleware): void;
  register(type: 'toolCall', middleware: ToolCallMiddleware): void;
}

export interface ExtensionApi {
  pipeline: PipelineRegistry;
  tools: {
    register(item: ToolCatalogItem, handler: ToolHandler): void;
  };
  state: {
    get(): Promise<JsonValue | null>;
    set(value: JsonValue): Promise<void>;
  };
  events: {
    on(event: string, handler: (...args: unknown[]) => void): () => void;
    emit(event: string, ...args: unknown[]): void;
  };
  logger: Console;
}

export type ConnectorEventMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'file'; url: string; name: string };

export interface ConnectorEvent {
  name: string;
  message: ConnectorEventMessage;
  properties: Record<string, string>;
  instanceKey: string;
}

export interface ConnectorContext {
  emit(event: ConnectorEvent): Promise<void>;
  config: Record<string, string>;
  secrets: Record<string, string>;
  logger: Console;
}

export interface ResourceMetadata {
  name: string;
  labels?: Record<string, string>;
}

export interface ResourceManifest<TKind extends string, TSpec> {
  apiVersion: 'goondan.ai/v1';
  kind: TKind;
  metadata: ResourceMetadata;
  spec: TSpec;
}

export interface ToolExportSpec {
  name: string;
  description?: string;
  parameters?: JsonObject;
}

export interface ToolManifestSpec {
  entry: string;
  errorMessageLimit?: number;
  exports: ToolExportSpec[];
}

export interface ExtensionManifestSpec {
  entry: string;
  config?: JsonObject;
}

export interface ConnectorManifestSpec {
  entry: string;
  events?: Array<{
    name: string;
    properties?: Record<string, { type: 'string' | 'number' | 'boolean'; optional?: boolean }>;
  }>;
}

export type ValueSource =
  | { value: string; valueFrom?: never }
  | { value?: never; valueFrom: { env: string } };

export interface ConnectionManifestSpec {
  connectorRef: string;
  swarmRef?: string;
  config?: Record<string, ValueSource>;
  secrets?: Record<string, ValueSource>;
  verify?: {
    webhook?: {
      signingSecret: ValueSource;
    };
  };
  ingress?: {
    rules?: Array<{
      match?: {
        event?: string;
        properties?: Record<string, string | number | boolean>;
      };
      route: {
        agentRef?: string;
      };
    }>;
  };
}
