export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ValueName =
  | "onInput" | "onPrompt" | "onStep" | "onModelInput" | "onModelResult"
  | "onToolCall" | "onToolResult" | "onOutput" | "onError";
export type Role = "system" | "user" | "assistant" | "tool";

export type Part =
  | { type: "text"; text: string }
  | { type: "json"; value: Json }
  | { type: "image"; url: string; mediaType: string }
  | { type: "media"; ref: string; mediaType: string }
  | { type: "tool.call"; callId: string; name: string; args: Json }
  | { type: "tool.result"; callId: string; content: Part[]; isError?: boolean };

export interface Message { id: string; role: Role; content: Part[]; source: string; key?: string; keep?: boolean; meta?: Record<string, Json> }
export interface DraftMessage { id?: string; role: Role; content: Part[]; source?: string; key?: string; keep?: boolean; meta?: Record<string, Json> }
export interface Block { text: string; cache?: boolean; source: string }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ToolDefinition { name: string; description: string; input: Record<string, Json> }
export interface ModelInput { system: Block[]; messages: Message[]; tools: ToolDefinition[]; options: Record<string, Json> }
export type FinishReason = "stop" | "tool" | "length" | "other";
export interface ModelResult { message: Message; usage?: Partial<Usage>; finishReason: FinishReason }
export interface ModelResponse { message: DraftMessage; usage?: Partial<Usage>; finishReason: FinishReason }
export interface ToolCall { id: string; name: string; args: Json }
export interface ToolResult { callId: string; name: string; args: Json; content: Part[]; isError?: boolean; keep?: boolean; meta?: Record<string, Json> }
export interface ToolResultValue { content: Part[]; isError?: boolean; keep?: boolean; meta?: Record<string, Json> }
export type ToolReturn = Json | Part[] | ToolResultValue;
export type ErrorLocation = ValueName | "model" | "tool" | "runtime";
export interface TurnError { where: ErrorLocation; codes: string[]; message: string; attempt: number; toolCall?: ToolCall }
export interface Retry { retry: true; target: "model" | "tool"; afterMs?: number }
export interface ToolExecution { call: ToolCall; execution?: Record<string, Json> }
export interface Approval { approval: { reason: string } }
export interface Complete { complete: Message }

export interface InputRule { fields?: Record<string, string>; template?: string; fn?: string }
export interface SystemBlockSpec { text?: string; template?: string; cache?: boolean }
export interface ExtensionUse { options?: Record<string, Json>; enabled?: boolean }
export interface ToolUse { tool?: string; agent?: string; hint?: string; approval?: "required" }
export interface InlineHookSpec {
  name?: string;
  extension?: string;
  fn?: string;
  agent?: string | string[];
  template?: string;
  when?: { fn: string };
  mode?: "sync" | "async";
  optional?: boolean;
  role?: "user" | "system";
  timeout?: number;
}
export interface AgentSpec {
  description?: string;
  model?: string;
  stateful?: boolean;
  params?: Record<string, Json>;
  input?: "asis" | InputRule;
  systemMessage?: SystemBlockSpec | SystemBlockSpec[];
  tools?: Array<string | ToolUse>;
  extensions?: Record<string, ExtensionUse>;
  hooks?: Partial<Record<ValueName, InlineHookSpec[]>>;
}
export interface FunctionNode { fn: string }
export type RouteEndpoint = string | FunctionNode;
export type RouteWhen = { fn: string } | { output: string | Record<string, Json> };
export interface RouteSpec { from: RouteEndpoint; to: RouteEndpoint; when?: RouteWhen }
export interface GoondanConfig { version: number; name: string; agents: Record<string, AgentSpec>; routes?: RouteSpec[] }
export interface LoadedConfig { directory: string; config: GoondanConfig; templates: ReadonlyMap<string, string> }

export type SchemaKeyword =
  | "type" | "const" | "enum" | "required" | "additionalProperties" | "propertyNames"
  | "minProperties" | "minItems" | "uniqueItems" | "minLength" | "pattern" | "exclusiveMinimum"
  | "oneOf" | "anyOf" | "not" | "false";
export type ConfigIssueCode =
  | "load.not_found" | "load.not_yaml" | "load.yaml" | "load.not_object"
  | "load.duplicate_resource" | "load.resource_cycle"
  | `schema.${SchemaKeyword}` | "config.not_json"
  | "reference.agent" | "reference.inherit" | "reference.inherit_cycle" | "reference.extension"
  | "reference.duplicate_tool"
  | "routes.reserved" | "routes.no_input" | "routes.unreachable" | "routes.cycle" | "routes.wait_cycle"
  | "template.not_found" | "template.syntax" | "template.unsupported"
  | "binding.model" | "binding.tool" | "binding.duplicate_tool" | "binding.function"
  | "binding.extension" | "binding.port" | "binding.extension_hook";
export interface ConfigIssue { code: ConfigIssueCode; path: string; message: string }

export interface Logger {
  info(message: string, fields?: Record<string, Json>): void;
  warn(message: string, fields?: Record<string, Json>): void;
  error(message: string, fields?: Record<string, Json>): void;
}
export interface ExecutionContext {
  agent: string;
  sessionId: string;
  turnId: string;
  instance: string;
  executionId: string;
  parentExecutionId?: string;
  operationId?: string;
  signal: AbortSignal;
  log: Logger;
}
export interface AgentInvoker { run(name: string, value: RunInput): Promise<Message> }
export interface ToolContext extends ExecutionContext {
  input: readonly Message[] | { type: "operation_execution"; operationId: string };
  conversation: readonly Message[];
  toolCall: ToolCall;
  execution: Record<string, Json>;
  agents: AgentInvoker;
}
export interface Tool { name: string; description: string; input: Record<string, Json>; execute(input: Json, ctx: ToolContext): Promise<ToolReturn> | ToolReturn }
export interface ModelContext extends ExecutionContext { step: number; onTextDelta(delta: string): void }
export interface Model { generate(input: ModelInput, ctx: ModelContext): Promise<ModelResponse> }

export type OperationStatus = "pending" | "approved" | "running" | "completed" | "rejected" | "cancelled" | "failed";
export type OperationDeliveryStatus = "pending" | "delivering" | "delivered";
export type OperationErrorCode = "validation_failed" | "execution_failed" | "execution_interrupted";
export interface PendingOperation {
  operationId: string;
  deliveryId: string;
  agent: string;
  sessionId: string;
  turnId: string;
  instance: string;
  executionId: string;
  parentExecutionId?: string;
  toolCall: ToolCall;
  reasons: string[];
  status: OperationStatus;
  deliveryStatus: OperationDeliveryStatus;
  createdAt: number;
  updatedAt: number;
  execution?: Record<string, Json>;
  inputPatch?: Record<string, Json>;
  resolvedToolCall?: ToolCall;
  result?: ToolResult;
  error?: string;
  errorCode?: OperationErrorCode;
  deliveredAt?: number;
}
export interface OperationDecision { decision: "approved" | "rejected" | "cancelled"; inputPatch?: Record<string, Json> }

export type HookResult = Json | Message[] | Message | ModelInput | ModelResult | ToolCall | ToolResult | Retry | ToolExecution | Approval | Complete | { result: ToolReturn } | undefined;
export type HookFunction = (value: unknown, ctx: HookContext) => Promise<HookResult> | HookResult;
export interface HookContext extends ExecutionContext {
  inputKind?: "start" | "steer";
  step?: number;
  retryCount: number;
  input: readonly Message[];
  conversation: readonly Message[];
  agents: AgentInvoker;
  model: { run(messages: Message[]): Promise<ModelResult> };
  render(template: string, variables: Record<string, Json>): Promise<string>;
  message: { user(text: string, extra?: MessageExtra): Message; system(text: string, extra?: MessageExtra): Message };
  append(...messages: Message[]): { append: Message[] };
  execution: { complete(message: Message): void };
}
export interface MessageExtra { key?: string; keep?: boolean; meta?: Record<string, Json> }
export interface ExtensionInstance {
  hooks?: Partial<Record<ValueName, HookFunction>>;
  tools?: Tool[];
  on?: Partial<Record<string, (event: RuntimeEvent) => Promise<void> | void>>;
  dispose?(): Promise<void> | void;
}
export interface ExtensionDefinition {
  name: string;
  options?: { validate(value: Json): Promise<Json | undefined> | Json | undefined };
  requires?: readonly string[];
  hooks?: readonly ValueName[];
  tools?: readonly string[];
  create(input: { options: Json; ports: Record<string, unknown>; agent: { name: string; spec: AgentSpec }; log: Logger }): Promise<ExtensionInstance> | ExtensionInstance;
}

export interface FunctionContext extends ExecutionContext {
  location: string;
  value: Json;
  input: readonly Message[];
  conversation: readonly Message[];
  inputKind?: "start" | "steer";
  step?: number;
  retryCount?: number;
  agents?: AgentInvoker;
  model?: { run(messages: Message[]): Promise<ModelResult> };
  render?: (template: string, variables: Record<string, Json>) => Promise<string>;
  message?: { user(text: string, extra?: MessageExtra): Message; system(text: string, extra?: MessageExtra): Message };
}
export interface RouteFunctionContext { sessionId: string; turnId: string; route: number; signal: AbortSignal; log: Logger }
export type GoondanFunction = (value: unknown, context?: FunctionContext | RouteFunctionContext) => Promise<unknown> | unknown;

export type JournalEventType =
  | "conversation.message.appended" | "conversation.message.replaced" | "conversation.message.removed" | "conversation.truncated"
  | "operation.created" | "operation.approved" | "operation.rejected" | "operation.cancelled"
  | "operation.execution.started" | "operation.completed" | "operation.failed"
  | "operation.delivery.claimed" | "operation.delivery.finished"
  | "turn.start" | "input.received" | "turn.done" | "turn.error"
  | "agent.start" | "agent.done" | "agent.error" | "route.function" | "snapshot.saved";
export interface NewJournalEvent {
  version: number;
  type: string;
  sessionId: string;
  agent?: string;
  instance?: string;
  turnId?: string;
  executionId?: string;
  inputId?: string;
  parentExecutionId?: string;
  operationId?: string;
  data: unknown;
  skippable?: true;
}
export interface JournalEvent extends NewJournalEvent { seq: number; at: number; writeId: string }
export interface AppendOptions { writeId?: string; expected?: number; token?: number }
export interface ScanOptions { sessionId?: string; fromSeq?: number; limit?: number }
export interface StoreLease {
  token: number;
  expiresAt: number | null;
  renew(): Promise<boolean>;
  release(): Promise<void>;
}
export interface Store {
  append(events: NewJournalEvent[], options?: AppendOptions): Promise<JournalEvent[]>;
  scan(options?: ScanOptions): AsyncIterable<JournalEvent>;
  head(sessionId: string): Promise<number>;
  watch(options?: { sessionId?: string; signal?: AbortSignal }): AsyncIterable<void>;
  acquireLease(sessionId: string, owner: string): Promise<StoreLease | null>;
  deleteSession(sessionId: string, options: { token: number }): Promise<void>;
}

export interface JournalConversation { sessionId: string; agent: string; instance: string; messages: Message[] }
export interface JournalInput { inputId: string; input: Json; agent?: string; startAgent?: string; operationId?: string }
export interface JournalTurn { turnId: string; sessionId: string; status: "running" | "completed" | "failed" | "aborted"; inputs: JournalInput[]; result?: TurnResult; error?: TurnError }
export type RunKind = "turn" | "tool" | "hook";
export interface JournalExecution {
  sessionId: string;
  agent: string;
  instance: string;
  executionId: string;
  turnId: string;
  parentExecutionId?: string;
  operationId?: string;
  kind: RunKind;
  status: "running" | "completed" | "failed" | "aborted";
  input: Message[];
  output?: Message;
  finishReason?: FinishReason;
  usage?: Usage;
  error?: TurnError;
}
export interface JournalState {
  version: number;
  sessionId: string;
  head: number;
  conversations: JournalConversation[];
  operations: PendingOperation[];
  turns: JournalTurn[];
  executions: JournalExecution[];
}

export interface RuntimeHost { emit?(event: RuntimeEvent): Promise<void> | void }
export interface RuntimeBindings {
  models: Record<string, Model>;
  tools?: Record<string, Tool>;
  functions?: Record<string, GoondanFunction>;
  extensions?: Record<string, ExtensionDefinition>;
  ports?: Record<string, unknown>;
  store?: Store;
  host?: RuntimeHost;
  logger?: Logger;
  maxRetries?: number;
  directory?: string;
}
export interface AgentRunResult { output: Message; usage: Usage; finishReason: FinishReason; status: "done"; instance: string; executionId: string }
export interface AgentRunRecord {
  agent: string;
  instance: string;
  executionId: string;
  turnId: string;
  parentExecutionId?: string;
  operationId?: string;
  kind: RunKind;
  usage: Usage;
  finishReason?: FinishReason;
  status: "done" | "failed";
}
export interface TurnResult {
  turnId: string;
  output?: string;
  outputs: Message[];
  usage: Usage;
  finishReason?: FinishReason;
  status: "done";
  runs: AgentRunRecord[];
}
export type RunInput = Json | Part[] | Message[];
export interface RunOptions { sessionId: string; agent?: string; startAgent?: string; signal?: AbortSignal }

export type ObservationalEventName =
  | "step.start" | "step.done" | "step.error" | "step.textDelta"
  | "tool.start" | "tool.done" | "tool.error"
  | "hook.applied" | "hook.skipped" | "hook.failed" | "operation.completion.orphaned";
export type RuntimeEventName = JournalEventType | ObservationalEventName;
export interface ObservationalEvent {
  type: ObservationalEventName;
  sessionId: string;
  turnId?: string;
  agent?: string;
  instance?: string;
  executionId?: string;
  inputId?: string;
  parentExecutionId?: string;
  operationId?: string;
  at: number;
  data: Record<string, unknown>;
  observational: true;
}
export type RuntimeEvent = JournalEvent | ObservationalEvent;
