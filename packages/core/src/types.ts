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
export interface AgentSpec { description?: string; model?: string; stateful?: boolean; params?: Record<string, Json>; input?: "asis" | InputRule; systemMessage?: SystemBlockSpec | SystemBlockSpec[]; tools?: Array<string | ToolUse>; extensions?: Record<string, ExtensionUse>; hooks?: Partial<Record<ValueName, InlineHookSpec[]>> }
export type RouteWhen = { fn: string } | { output: string | Record<string, Json> };
export interface RouteSpec { from: string; to: string; when?: RouteWhen }
export interface GoondanConfig { version: number; name: string; agents: Record<string, AgentSpec>; routes?: RouteSpec[] }
/** 참조 단계에서 읽은 템플릿을 포함한 구성입니다. */
export interface LoadedConfig { directory: string; config: GoondanConfig; templates: ReadonlyMap<string, string> }

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
  | "routes.reserved" | "routes.no_input" | "routes.no_output" | "routes.no_route"
  | "routes.unreachable" | "routes.cycle" | "routes.wait_cycle"
  | "template.not_found" | "template.syntax" | "template.unsupported"
  | "binding.model" | "binding.tool" | "binding.duplicate_tool" | "binding.function"
  | "binding.extension" | "binding.port" | "binding.extension_hook";
/** One configuration error: its code, the JSON Pointer it applies to and a host message. */
export interface ConfigIssue { code: ConfigIssueCode; path: string; message: string }

/**
 * 도구 구현이 인수와 함께 받는 컨텍스트입니다. `agent`는 호출한 에이전트의 선언 이름이고,
 * `conversation`은 저장된 대화의 사본입니다.
 */
export interface ToolContext { input: readonly Message[] | { type: "operation_execution"; operationId: string }; conversation: readonly Message[]; agent: string; sessionId: string; turnId: string; toolCall: ToolCall; execution: Record<string, Json>; signal: AbortSignal; agents: { run(name: string, value: RunInput): Promise<AgentRunResult> } }
export interface Tool { name: string; description: string; input: Record<string, Json>; execute(input: Json, ctx: ToolContext): Promise<ToolResult> | ToolResult }
/**
 * 모델 구현이 모델 입력과 함께 받는 컨텍스트입니다. `agent`는 선언 이름이며 `step`은 재시도를
 * 포함해 1부터 세는 모델 호출 번호입니다.
 */
export interface ModelContext { agent: string; sessionId: string; turnId: string; step: number; signal: AbortSignal; onTextDelta(delta: string): void }
export interface Model { generate(input: ModelInput, ctx: ModelContext): Promise<ModelResult> }
/**
 * 대화 저장소는 서로 다른 `(sessionId, agent)` 조합을 분리하고 저장한 메시지를 같은 JSON 값으로
 * 반환해야 합니다. `agent`는 선언 이름입니다.
 */
export interface ConversationStore { load(sessionId: string, agent: string): Promise<Message[]>; append(sessionId: string, agent: string, messages: Message[]): Promise<void>; replace(sessionId: string, agent: string, messages: Message[]): Promise<void>; deleteSession(sessionId: string): Promise<void> }
export type OperationStatus = "pending" | "approved" | "running" | "completed" | "rejected" | "cancelled" | "failed";
export type OperationDeliveryStatus = "pending" | "delivering" | "delivered";
export type OperationErrorCode = "validation_failed" | "execution_failed" | "execution_interrupted";
/** 저장된 승인 작업입니다. `agent`는 실행하고 완료를 전달할 에이전트의 선언 이름입니다. */
export interface PendingOperation { operationId: string; deliveryId: string; agent: string; sessionId: string; turnId: string; instance: string; parentInstance: string | null; parentTurnId: string | null; rootTurnId: string; toolCall: ToolCall; resolvedToolCall?: ToolCall; inputPatch?: Record<string, Json>; execution?: Record<string, Json>; context?: Record<string, Json>; reasons: string[]; status: OperationStatus; deliveryStatus: OperationDeliveryStatus; createdAt: number; updatedAt: number; result?: ToolResult; error?: string; errorCode?: OperationErrorCode; deliveredAt?: number }
export type OperationUpdate = Partial<Pick<PendingOperation, "status" | "deliveryStatus" | "resolvedToolCall" | "inputPatch" | "result" | "error" | "errorCode" | "updatedAt" | "deliveredAt">>;
export interface OperationStore { list(sessionId?: string): Promise<PendingOperation[]>; get(sessionId: string, operationId: string): Promise<PendingOperation | undefined>; save(operation: PendingOperation): Promise<void>; transition(sessionId: string, operationId: string, from: OperationStatus[], update: OperationUpdate): Promise<PendingOperation | undefined>; claimDelivery(sessionId: string, operationId: string, updatedAt: number): Promise<PendingOperation | undefined>; releaseDelivery(sessionId: string, operationId: string, deliveryId: string, updatedAt: number): Promise<PendingOperation | undefined> }
export interface ApprovalRequest { operationId: string; sessionId: string; turnId: string; agent: string; instance: string; parentInstance: string | null; parentTurnId: string | null; rootTurnId: string; toolCall: ToolCall; reasons: string[] }
export interface OperationDecision { decision: "approved" | "rejected"; inputPatch?: Record<string, Json> }
export interface OperationCompletion { type: "operation_completion"; deliveryId: string; operationId: string; sessionId: string; agent: string; turnId: string; instance: string; parentInstance: string | null; parentTurnId: string | null; rootTurnId: string; status: "completed" | "rejected" | "cancelled" | "failed"; toolCall: ToolCall; result?: ToolResult; error?: string; errorCode?: OperationErrorCode }
export interface RuntimeHost { captureOperationContext?(request: ApprovalRequest): Promise<Record<string, Json>> | Record<string, Json>; requestApproval?(request: ApprovalRequest): Promise<void> | void; validateOperationInputPatch?(operation: PendingOperation, patch: Record<string, Json>): Promise<boolean> | boolean; validateOperation?(operation: PendingOperation): Promise<boolean> | boolean; deliverOperationCompletion?(completion: OperationCompletion): Promise<void> | void; emit?(event: RuntimeEvent): Promise<void> | void }
export interface Logger { info(message: string, fields?: Record<string, Json>): void; warn(message: string, fields?: Record<string, Json>): void; error(message: string, fields?: Record<string, Json>): void }
export interface ExecutionControl { complete(output: Message): void }
/**
 * 확장 훅이 값과 함께 받는 컨텍스트입니다. `agent`는 실행의 에이전트 선언 이름이며,
 * `conversation` a copy of the conversation stored so far and `signal` the notice that the hook
 * should stop, which fires on a timeout, an abort and, for an asynchronous hook, on `close()`.
 */
export interface HookContext { execution: ExecutionControl; agent: string; sessionId: string; turnId: string; step: number | undefined; retryCount: number; input: readonly Message[]; conversation: readonly Message[]; signal: AbortSignal; agents: { run(name: string, value: RunInput): Promise<AgentRunResult> }; model: { run(messages: Message[]): Promise<ModelResult> }; render(template: string, variables: Record<string, Json>): Promise<string>; message: { user(text: string, extra?: MessageExtra): Message; system(text: string, extra?: MessageExtra): Message }; append(...items: Message[]): Append; log: Logger }
export interface MessageExtra { key?: string; keep?: boolean; meta?: Record<string, Json> }
export type HookResult = Json | Message[] | Message | ModelInput | ModelResult | ToolCall | ToolResult | Append | Retry | ToolExecution | Approval | { result: ToolResult } | undefined;
export type HookFunction = (value: HookResult | TurnError, ctx: HookContext) => Promise<HookResult> | HookResult;
export interface ExtensionInstance { hooks?: Partial<Record<ValueName, HookFunction>>; tools?: Tool[]; on?: Partial<Record<RuntimeEventName, (event: RuntimeEvent) => Promise<void> | void>>; dispose?(): Promise<void> | void }
/**
 * A host extension. `requires` names the ports it needs, `hooks` the value stages it provides and
 * `tools` the tool names it provides; a list with at least one entry counts as a declaration the
 * binding phase checks.
 */
export interface ExtensionDefinition { name: string; options?: { validate(value: Json): Promise<Json | undefined> | Json | undefined }; requires?: readonly string[]; hooks?: readonly ValueName[]; tools?: readonly string[]; create(input: { options: Json; ports: Record<string, unknown>; agent: { name: string; spec: AgentSpec }; log: Logger }): Promise<ExtensionInstance> | ExtensionInstance }
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
export interface AgentRunResult { output: Message; usage: Usage; finishReason: string; status: "done"; instance: string }
/** How an agent run or a hook model call was started; see `에이전트 실행 기록`. */
export type RunKind = "turn" | "tool" | "hook" | "model";
/**
 * One entry of a turn result's `runs`. `usage` counts only the model responses that run received
 * itself, and `finishReason` is present only on an entry whose `status` is `done`.
 */
export interface AgentRunRecord { agent: string; instance: string; turnId: string; parentInstance: string | null; parentTurnId: string | null; rootTurnId: string; kind: RunKind; usage: Usage; finishReason?: string; status: "done" | "failed" | "aborted" }
/** The result of a successful turn. `usage` is the sum of every entry of `runs`. */
export interface TurnResult { output: Message; outputs: Message[]; usage: Usage; finishReason: string; status: "done"; runs: AgentRunRecord[] }
/** `agent`는 지정한 에이전트만 실행하고 `startAgent`는 지정한 에이전트부터 route를 진행합니다. */
export type RunInput = Json | Part[] | Message[];
export interface RunOptions { sessionId: string; agent?: string; startAgent?: string; signal?: AbortSignal }
/** The closed set of event names the runtime announces. */
export type RuntimeEventName = "turn.start" | "turn.done" | "turn.error" | "step.start" | "step.done" | "step.error" | "step.textDelta" | "tool.start" | "tool.done" | "tool.error" | "humanApproval.created" | "hook.applied" | "hook.skipped" | "hook.failed";
/** 실행 이벤트입니다. 부모가 없는 최상위 실행은 두 부모 식별자가 `null`입니다. */
export interface RuntimeEvent { name: RuntimeEventName; agent: string; sessionId: string; turnId: string; instance: string; parentInstance: string | null; parentTurnId: string | null; rootTurnId: string; at: number; data: Record<string, Json> }
