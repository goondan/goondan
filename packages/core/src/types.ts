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
export interface ModelResult { message: Message; usage?: Usage; finishReason: "stop" | "tool" | "length" | "other" }
export interface ToolCall { id: string; name: string; args: Json }
export interface ToolResult { callId: string; name: string; args: Json; content: Part[]; isError?: boolean; keep?: boolean; meta?: Record<string, Json> }
export type ErrorLocation = ValueName | "model" | "tool" | "runtime";
export interface TurnError { where: ErrorLocation; codes: string[]; message: string; attempt: number; toolCall?: ToolCall }
export interface Append { append: Message[] }
export interface Retry { retry: true; target: "model" | "tool"; conversation?: Message[]; afterMs?: number }
export interface ToolExecution { call: ToolCall; execution?: Record<string, Json> }
export interface Approval { approval: { reason: string } }
export interface Fail { fail: true }

export interface InputRule { fields?: Record<string, string>; template?: string; fn?: string }
export interface SystemBlockSpec { text?: string; template?: string; cache?: boolean }
export interface ExtensionUse { options?: Record<string, Json>; enabled?: boolean }
export interface ToolUse { tool?: string; agent?: string; hint?: string; approval?: "required" }
export interface InlineHookSpec { name?: string; extension?: string; fn?: string; agent?: string | string[]; template?: string; using?: "input" | "conversation" | { fn: string }; when?: { fn: string }; mode?: "sync" | "async"; optional?: boolean; role?: "user" | "system"; timeout?: number }
export interface AgentSpec { description?: string; model?: string; config?: string; params?: Record<string, Json>; input?: "asis" | InputRule; systemMessage?: SystemBlockSpec | SystemBlockSpec[]; tools?: Array<string | ToolUse>; extensions?: Record<string, ExtensionUse>; hooks?: Partial<Record<ValueName, InlineHookSpec[]>> }
export interface CarrySpec { message?: "output" | { fn: string } | { template: string }; conversation?: "none" | "asis" | { fn: string } }
export interface RouteSpec { from: string; to: string; when?: { fn: string }; carry?: CarrySpec }
export interface GoondanConfig { version: number; name: string; agents: Record<string, AgentSpec>; flow: { in: string; routes?: RouteSpec[] } }
export interface LoadedConfig { directory: string; config: GoondanConfig; templates: ReadonlyMap<string, string> }

export interface ToolContext { input: Json; conversation: readonly Message[]; agent: string; conversationId: string; turnId: string; toolCall: ToolCall; execution?: Record<string, Json>; signal: AbortSignal; agents: { run(name: string, value: Json): Promise<AgentRunResult> } }
export interface Tool { name: string; description: string; input: Record<string, Json>; execute(input: Json, ctx: ToolContext): Promise<ToolResult> | ToolResult }
export interface Model { generate(input: ModelInput, ctx: { agent: string; conversationId: string; turnId: string; step: number; signal: AbortSignal; onTextDelta(delta: string): void }): Promise<ModelResult> }
export interface ConversationStore { load(conversationId: string, agent: string): Promise<Message[]>; append(conversationId: string, agent: string, messages: Message[]): Promise<void>; replace(conversationId: string, agent: string, messages: Message[]): Promise<void>; finish(conversationId: string, agent: string, state: { status: "done" | "error"; turnId: string; output?: Message; error?: TurnError }): Promise<void> }
export type OperationStatus = "pending" | "approved" | "running" | "completed" | "rejected" | "cancelled" | "failed";
export type OperationDeliveryStatus = "pending" | "delivering" | "delivered";
export type OperationErrorCode = "validation_failed" | "execution_failed" | "execution_interrupted";
export interface PendingOperation { operationId: string; deliveryId: string; agent: string; conversationId: string; turnId: string; toolCall: ToolCall; resolvedToolCall?: ToolCall; inputPatch?: Record<string, Json>; execution?: Record<string, Json>; context?: Record<string, Json>; reasons: string[]; status: OperationStatus; deliveryStatus: OperationDeliveryStatus; createdAt: number; updatedAt: number; result?: ToolResult; error?: string; errorCode?: OperationErrorCode; deliveredAt?: number }
export type OperationUpdate = Partial<Pick<PendingOperation, "status" | "deliveryStatus" | "resolvedToolCall" | "inputPatch" | "result" | "error" | "errorCode" | "updatedAt" | "deliveredAt">>;
export interface OperationStore { list(conversationId?: string): Promise<PendingOperation[]>; get(conversationId: string, operationId: string): Promise<PendingOperation | undefined>; save(operation: PendingOperation): Promise<void>; transition(conversationId: string, operationId: string, from: OperationStatus[], update: OperationUpdate): Promise<PendingOperation | undefined>; claimDelivery(conversationId: string, operationId: string, updatedAt: number): Promise<PendingOperation | undefined>; releaseDelivery(conversationId: string, operationId: string, deliveryId: string, updatedAt: number): Promise<PendingOperation | undefined> }
export interface ApprovalRequest { operationId: string; conversationId: string; turnId: string; agent: string; toolCall: ToolCall; reasons: string[] }
export interface OperationDecision { decision: "approved" | "rejected"; inputPatch?: Record<string, Json> }
export interface OperationCompletion { type: "operation_completion"; deliveryId: string; operationId: string; conversationId: string; agent: string; status: "completed" | "rejected" | "cancelled" | "failed"; toolCall: ToolCall; result?: ToolResult; error?: string; errorCode?: OperationErrorCode }
export interface RuntimeHost { captureOperationContext?(request: ApprovalRequest): Promise<Record<string, Json>> | Record<string, Json>; requestApproval?(request: ApprovalRequest): Promise<void> | void; validateOperationInputPatch?(operation: PendingOperation, patch: Record<string, Json>): Promise<boolean> | boolean; validateOperation?(operation: PendingOperation): Promise<boolean> | boolean; deliverOperationCompletion?(completion: OperationCompletion): Promise<void> | void; emit?(event: RuntimeEvent): Promise<void> | void; now?(): number; id?(): string }
export interface Logger { info(message: string, fields?: Record<string, Json>): void; warn(message: string, fields?: Record<string, Json>): void; error(message: string, fields?: Record<string, Json>): void }
export interface HookSpec { input?: "input" | "conversation" | "self"; appendOnly?: boolean; asyncSafe?: boolean; timeout?: number }
export interface ExecutionControl { complete(output: Message): void }
export interface HookContext { execution: ExecutionControl; agent: string; conversationId: string; turnId: string; step?: number; retryCount: number; input: Json; conversation: readonly Message[]; signal: AbortSignal; agents: { run(name: string, value: Json, options?: { conversation?: Message[]; signal?: AbortSignal }): Promise<AgentRunResult> }; model: { run(messages: Message[], options?: { maxSteps?: number; signal?: AbortSignal }): Promise<AgentRunResult> }; render(template: string, variables: Record<string, Json>): Promise<string>; message: { user(text: string, extra?: MessageExtra): Message; system(text: string, extra?: MessageExtra): Message }; append(...items: Message[]): Append; log: Logger }
export interface MessageExtra { key?: string; keep?: boolean; meta?: Record<string, Json> }
export type HookResult = Json | Message[] | Message | ModelInput | ModelResult | ToolCall | ToolResult | Append | Retry | ToolExecution | Approval | Fail | { result: ToolResult } | undefined;
export type HookFunction = (value: HookResult | TurnError, ctx: HookContext) => Promise<HookResult> | HookResult;
export interface ExtensionInstance { hooks?: Partial<Record<ValueName, HookFunction>>; tools?: Tool[]; on?: Partial<Record<RuntimeEventName, (event: RuntimeEvent) => Promise<void> | void>>; dispose?(): Promise<void> | void }
export interface ExtensionDefinition { name: string; options?: { validate(value: Json): Json }; requires?: Record<string, unknown>; hooks?: Partial<Record<ValueName, HookSpec>>; create(input: { options: Json; ports: Record<string, unknown>; agent: { name: string; spec: AgentSpec }; log: Logger }): Promise<ExtensionInstance> | ExtensionInstance }
export interface FunctionContext { agent: string; conversationId: string; turnId: string; input: Json; conversation: readonly Message[] }
export type GoondanFunction = (value: Json, ctx: FunctionContext) => Promise<Json | undefined> | Json | undefined;
export interface RuntimeBindings { models: Record<string, Model>; tools?: Record<string, Tool>; functions?: Record<string, GoondanFunction>; extensions?: Record<string, ExtensionDefinition>; ports?: Record<string, unknown>; conversationStore?: ConversationStore; operationStore?: OperationStore; host?: RuntimeHost; logger?: Logger; maxSteps?: number; maxRetries?: number }
export interface AgentRunResult { output: Message; outputs?: Message[]; usage?: Usage; finishReason: string; status: "done" | "failed" }
export interface RunOptions { conversationId: string; agent?: string; startAgent?: string; conversation?: Message[]; signal?: AbortSignal }
export type RuntimeEventName = "turn.start" | "turn.done" | "turn.error" | "step.start" | "step.done" | "step.error" | "step.textDelta" | "tool.start" | "tool.done" | "tool.error" | "humanApproval.created" | "humanTask.created" | "hook.applied" | "hook.skipped" | "hook.failed";
export interface RuntimeEvent { name: RuntimeEventName; agent: string; conversationId: string; turnId: string; at: number; data: Record<string, Json> }
