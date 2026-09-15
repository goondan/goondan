export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ValueName = "input" | "conversation" | "modelInput" | "modelResult" | "toolCall" | "toolResult" | "output" | "error";
export type Role = "system" | "user" | "assistant" | "tool";

export type Part =
  | { type: "text"; text: string }
  | { type: "json"; value: Json }
  | { type: "image"; url: string; mediaType: string }
  | { type: "media"; ref: string; mediaType: string }
  | { type: "tool.call"; callId: string; name: string; args: Json }
  | { type: "tool.result"; callId: string; content: Part[]; isError?: boolean };

export interface Message { id: string; role: Role; content: Part[]; source: string; key?: string; keep?: boolean; meta?: Record<string, Json> }
export interface Block { text: string; cache?: boolean; source: string }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ToolDefinition { name: string; description: string; input: Record<string, Json> }
export interface ModelInput { system: Block[]; messages: Message[]; tools: ToolDefinition[]; options: Record<string, Json> }
/** A model result's usage: every key may be left out, and a missing key counts as 0. */
export interface ModelResult { message: Message; usage?: Partial<Usage>; finishReason: "stop" | "tool" | "length" | "other" }
export interface ToolCall { id: string; name: string; args: Json }
export interface ToolResult { callId: string; name: string; args: Json; content: Part[]; isError?: boolean; keep?: boolean; meta?: Record<string, Json> }
export type ErrorLocation = ValueName | "model" | "tool" | "runtime";
export interface TurnError { where: ErrorLocation; codes: string[]; message: string; attempt: number; toolCall?: ToolCall }
export interface Append { append: Message[] }
export interface Retry { retry: true; target: "model" | "tool"; afterMs?: number }
export interface ToolExecution { call: ToolCall; execution?: Record<string, Json> }
export interface Approval { approval: { reason: string } }

export interface InputRule { fields?: Record<string, string>; template?: string; fn?: string }
export interface SystemBlockSpec { text?: string; template?: string; cache?: boolean }
export interface ExtensionUse { options?: Record<string, Json>; enabled?: boolean }
export interface ToolUse { tool?: string; agent?: string; hint?: string; approval?: "required" }
export interface InlineHookSpec { name?: string; extension?: string; fn?: string; agent?: string | string[]; template?: string; using?: "input" | "conversation" | { fn: string }; when?: { fn: string }; mode?: "sync" | "async"; optional?: boolean; role?: "user" | "system"; timeout?: number }
export interface AgentSpec { description?: string; model?: string; config?: string; params?: Record<string, Json>; input?: "asis" | InputRule; systemMessage?: SystemBlockSpec | SystemBlockSpec[]; tools?: Array<string | ToolUse>; extensions?: Record<string, ExtensionUse>; hooks?: Partial<Record<ValueName, InlineHookSpec[]>> }
export interface CarrySpec { message?: "output" | { fn: string } | { template: string }; conversation?: "none" | "asis" | { fn: string } }
export interface RouteSpec { from: string; to: string; when?: { fn: string }; carry?: CarrySpec }
export interface GoondanConfig { version: number; name: string; agents: Record<string, AgentSpec>; flow: { in: string; routes?: RouteSpec[] } }
/** A loaded configuration with the templates and nested configurations the reference phase read. */
export interface LoadedConfig { directory: string; config: GoondanConfig; templates: ReadonlyMap<string, string>; nested?: ReadonlyMap<string, LoadedConfig> }

/** The schema keywords a configuration error can name. */
export type SchemaKeyword =
  | "type" | "const" | "enum" | "required" | "additionalProperties" | "propertyNames"
  | "minProperties" | "minItems" | "uniqueItems" | "minLength" | "pattern" | "exclusiveMinimum"
  | "oneOf" | "anyOf" | "not" | "false";
/** The closed set of configuration error codes both hosts report. */
export type ConfigIssueCode =
  | "load.not_found" | "load.not_yaml" | "load.yaml" | "load.not_object"
  | "load.duplicate_resource" | "load.resource_cycle"
  | `schema.${SchemaKeyword}` | "config.not_json"
  | "reference.agent" | "reference.inherit" | "reference.inherit_cycle" | "reference.extension"
  | "reference.duplicate_tool" | "reference.duplicate_hook"
  | "flow.no_route" | "flow.cycle" | "flow.carry_conversation"
  | "template.not_found" | "template.syntax" | "template.unsupported"
  | "binding.model" | "binding.tool" | "binding.duplicate_tool" | "binding.function"
  | "binding.extension" | "binding.port" | "binding.extension_hook";
/** One configuration error: its code, the JSON Pointer it applies to and a host message. */
export interface ConfigIssue { code: ConfigIssueCode; path: string; message: string }

/**
 * What a tool implementation receives besides its arguments. `agent` is the agent path of the run
 * that calls the tool, `conversation` a copy of its stored conversation and `execution` the value a
 * `toolCall` hook attached, `{}` when there is none.
 */
export interface ToolContext { input: Json; conversation: readonly Message[]; agent: string; conversationId: string; turnId: string; toolCall: ToolCall; execution: Record<string, Json>; signal: AbortSignal; agents: { run(name: string, value: Json): Promise<AgentRunResult> } }
export interface Tool { name: string; description: string; input: Record<string, Json>; execute(input: Json, ctx: ToolContext): Promise<ToolResult> | ToolResult }
/**
 * What a model implementation receives besides the model input. `agent` is the agent path of the run
 * that calls the model and `step` its model call number, which starts at 1 and counts retries;
 * `onTextDelta` announces a chunk of the assistant text that is being generated.
 */
export interface ModelContext { agent: string; conversationId: string; turnId: string; step: number; signal: AbortSignal; onTextDelta(delta: string): void }
export interface Model { generate(input: ModelInput, ctx: ModelContext): Promise<ModelResult> }
/**
 * Where conversations live. `agent` is an agent path: a store must keep different
 * (conversationId, agent) pairs apart and return each stored message as the same JSON value.
 */
export interface ConversationStore { load(conversationId: string, agent: string): Promise<Message[]>; append(conversationId: string, agent: string, messages: Message[]): Promise<void>; replace(conversationId: string, agent: string, messages: Message[]): Promise<void> }
export type OperationStatus = "pending" | "approved" | "running" | "completed" | "rejected" | "cancelled" | "failed";
export type OperationDeliveryStatus = "pending" | "delivering" | "delivered";
export type OperationErrorCode = "validation_failed" | "execution_failed" | "execution_interrupted";
/** A stored operation. `agent` is the agent path the runtime runs and delivers the completion to. */
export interface PendingOperation { operationId: string; deliveryId: string; agent: string; conversationId: string; turnId: string; toolCall: ToolCall; resolvedToolCall?: ToolCall; inputPatch?: Record<string, Json>; execution?: Record<string, Json>; context?: Record<string, Json>; reasons: string[]; status: OperationStatus; deliveryStatus: OperationDeliveryStatus; createdAt: number; updatedAt: number; result?: ToolResult; error?: string; errorCode?: OperationErrorCode; deliveredAt?: number }
export type OperationUpdate = Partial<Pick<PendingOperation, "status" | "deliveryStatus" | "resolvedToolCall" | "inputPatch" | "result" | "error" | "errorCode" | "updatedAt" | "deliveredAt">>;
export interface OperationStore { list(conversationId?: string): Promise<PendingOperation[]>; get(conversationId: string, operationId: string): Promise<PendingOperation | undefined>; save(operation: PendingOperation): Promise<void>; transition(conversationId: string, operationId: string, from: OperationStatus[], update: OperationUpdate): Promise<PendingOperation | undefined>; claimDelivery(conversationId: string, operationId: string, updatedAt: number): Promise<PendingOperation | undefined>; releaseDelivery(conversationId: string, operationId: string, deliveryId: string, updatedAt: number): Promise<PendingOperation | undefined> }
export interface ApprovalRequest { operationId: string; conversationId: string; turnId: string; agent: string; toolCall: ToolCall; reasons: string[] }
export interface OperationDecision { decision: "approved" | "rejected"; inputPatch?: Record<string, Json> }
export interface OperationCompletion { type: "operation_completion"; deliveryId: string; operationId: string; conversationId: string; agent: string; status: "completed" | "rejected" | "cancelled" | "failed"; toolCall: ToolCall; result?: ToolResult; error?: string; errorCode?: OperationErrorCode }
export interface RuntimeHost { captureOperationContext?(request: ApprovalRequest): Promise<Record<string, Json>> | Record<string, Json>; requestApproval?(request: ApprovalRequest): Promise<void> | void; validateOperationInputPatch?(operation: PendingOperation, patch: Record<string, Json>): Promise<boolean> | boolean; validateOperation?(operation: PendingOperation): Promise<boolean> | boolean; deliverOperationCompletion?(completion: OperationCompletion): Promise<void> | void; emit?(event: RuntimeEvent): Promise<void> | void }
export interface Logger { info(message: string, fields?: Record<string, Json>): void; warn(message: string, fields?: Record<string, Json>): void; error(message: string, fields?: Record<string, Json>): void }
export interface ExecutionControl { complete(output: Message): void }
/**
 * What an extension hook receives besides its value. `agent` is the agent path of the run,
 * `conversation` a copy of the conversation stored so far and `signal` the notice that the hook
 * should stop, which fires on a timeout, an abort and, for an asynchronous hook, on `close()`.
 */
export interface HookContext { execution: ExecutionControl; agent: string; conversationId: string; turnId: string; step?: number; retryCount: number; input: Json; conversation: readonly Message[]; signal: AbortSignal; agents: { run(name: string, value: Json): Promise<AgentRunResult> }; model: { run(messages: Message[]): Promise<ModelResult> }; render(template: string, variables: Record<string, Json>): Promise<string>; message: { user(text: string, extra?: MessageExtra): Message; system(text: string, extra?: MessageExtra): Message }; append(...items: Message[]): Append; log: Logger }
export interface MessageExtra { key?: string; keep?: boolean; meta?: Record<string, Json> }
export type HookResult = Json | Message[] | Message | ModelInput | ModelResult | ToolCall | ToolResult | Append | Retry | ToolExecution | Approval | { result: ToolResult } | undefined;
export type HookFunction = (value: HookResult | TurnError, ctx: HookContext) => Promise<HookResult> | HookResult;
export interface ExtensionInstance { hooks?: Partial<Record<ValueName, HookFunction>>; tools?: Tool[]; on?: Partial<Record<RuntimeEventName, (event: RuntimeEvent) => Promise<void> | void>>; dispose?(): Promise<void> | void }
/**
 * A host extension. `requires` names the ports it needs, `hooks` the value stages it provides and
 * `tools` the tool names it provides; a list with at least one entry counts as a declaration the
 * binding phase checks.
 */
export interface ExtensionDefinition { name: string; options?: { validate(value: Json): Promise<Json | undefined> | Json | undefined }; requires?: readonly string[]; hooks?: readonly ValueName[]; tools?: readonly string[]; create(input: { options: Json; ports: Record<string, unknown>; agent: { name: string; path: string; spec: AgentSpec }; log: Logger }): Promise<ExtensionInstance> | ExtensionInstance }
/**
 * A host function a configuration references by name. It takes a copy of one JSON value and returns
 * a JSON value; returning nothing counts as returning `null`.
 */
export type GoondanFunction = (value: Json) => Promise<Json | undefined> | Json | undefined;
export interface RuntimeBindings {
  models: Record<string, Model>; tools?: Record<string, Tool>; functions?: Record<string, GoondanFunction>;
  extensions?: Record<string, ExtensionDefinition>; ports?: Record<string, unknown>;
  conversationStore?: ConversationStore; operationStore?: OperationStore; host?: RuntimeHost; logger?: Logger;
  /** The model call limit of one agent run: an integer of 1 or more, or no limit when it is absent. */
  maxSteps?: number;
  maxRetries?: number;
  /** The configuration directory for a configuration document that was not read from a file. */
  directory?: string;
}
/** The result of one agent run: its output message, its own model usage and how it ended. */
export interface AgentRunResult { output: Message; usage: Usage; finishReason: string; status: "done" }
/** How an agent run or a hook model call was started; see `에이전트 실행 기록`. */
export type RunKind = "flow" | "nested" | "tool" | "hook" | "model";
/**
 * One entry of a turn result's `runs`. `usage` counts only the model responses that run received
 * itself, and `finishReason` is present only on an entry whose `status` is `done`.
 */
export interface AgentRunRecord { agent: string; turnId: string; kind: RunKind; usage: Usage; finishReason?: string; status: "done" | "failed" }
/** The result of a successful turn. `usage` is the sum of every entry of `runs`. */
export interface TurnResult { output: Message; outputs: Message[]; usage: Usage; finishReason: string; status: "done"; runs: AgentRunRecord[] }
/** `agent` is an agent path and runs only that agent; `startAgent` is a top-level agent name. */
export interface RunOptions { conversationId: string; agent?: string; startAgent?: string; signal?: AbortSignal }
/** The closed set of event names the runtime announces. */
export type RuntimeEventName = "turn.start" | "turn.done" | "turn.error" | "step.start" | "step.done" | "step.error" | "step.textDelta" | "tool.start" | "tool.done" | "tool.error" | "humanApproval.created" | "hook.applied" | "hook.skipped" | "hook.failed";
/** One execution event. `agent` is the agent path of the run that announced it, `at` its epoch milliseconds. */
export interface RuntimeEvent { name: RuntimeEventName; agent: string; conversationId: string; turnId: string; at: number; data: Record<string, Json> }
