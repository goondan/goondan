import { TemplateRenderer } from "./template.ts";
import { MemoryConversationStore, MemoryOperationStore } from "./store.ts";
import { prepareRuntimeConfig } from "./config.ts";
import { bindingIssues, instanceIssues, toolEntry, type ProvidedExtension } from "./binding.ts";
import { GoondanConfigError, GoondanExecutionError, isGoondanConfigError, raiseIssues } from "./errors.ts";
import { isJsonObject, jsonEqual, jsonText } from "./json.ts";
import { inlineHookIdentifier, isValueName } from "./effective.ts";
import {
  approvalReason, completionInput, decisionIssue, decisionUpdate, effectiveCall, interruptedMessage,
  isTerminalStatus, newOperation, patchIssue, patchedCall, pendingToolContent, validationFailedMessage,
} from "./operation.ts";
import {
  appendMessages, controlResult, inputTextOf, isControlIssue, isMessage, isMessageArray, isModelInput, isModelResult,
  isPartArray, isToolCall, isToolResult, repairToolPairs, stageValueIssue, textOf, type ControlResult,
} from "./stage.ts";
import {
  abortRun, addUsage, detachedSink, failRun, finishRun, flattenRuns, recordModelCall, startRun, totalUsage, zeroUsage,
  type RunLineage, type RunNode, type RunSink,
} from "./runs.ts";
import {
  type AgentRunResult, type AgentSpec, type ApprovalRequest, type Block,
  type ExtensionInstance, type HookContext, type HookResult, type InlineHookSpec, type Json,
  type LoadedConfig, type Message, type GoondanFunction, type ModelInput, type ModelResult, type Part,
  type RouteSpec, type RunInput, type RunKind, type RunOptions, type RuntimeBindings, type RuntimeEvent, type ErrorLocation, type RuntimeEventName,
  type OperationCompletion, type OperationDecision, type OperationStatus, type OperationUpdate,
  type MessageExtra, type PendingOperation, type Tool, type ToolCall, type ToolContext,
  type ToolDefinition, type ToolResult, type TurnError, type TurnResult, type Usage, type ValueName,
} from "./types.ts";

const noLog = { info() {}, warn() {}, error() {} };
type PipelineValue = HookResult | TurnError;

/** The execution error of an aborted agent run: `where` `runtime`, `codes` `["aborted"]`. */
function abortFailure(cause?: unknown): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["aborted"], message: "aborted" }, cause === undefined ? undefined : { cause });
}

/**
 * 에이전트 실행 밖에서 발생한 route 조건 오류나 진행할 route가 없는 오류입니다.
 */
function routeFailure(message: string, cause?: unknown): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["route_error"], message }, cause === undefined ? undefined : { cause });
}

/** The execution error of a run that could not prepare its extension instances. */
function preparationFailure(error: unknown): GoondanExecutionError {
  if (error instanceof GoondanExecutionError) return error;
  return new GoondanExecutionError({ where: "runtime", codes: ["runtime_error"], message: reason(error) }, { cause: error });
}

/** The execution error the runtime reports when a request names an operation it cannot act on. */
function operationInvalid(message: string): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["operation_invalid"], message });
}

/** The execution error every request a closed runtime refuses reports. */
function closedFailure(): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["runtime_error"], message: "The runtime is closed" });
}

/**
 * The codes of a model failure: `model_error`, followed by the `code` the thrown error declared when
 * that is a non-empty string. The second code belongs to the model implementation.
 */
function modelErrorCodes(error: unknown): string[] {
  const code: unknown = isObject(error) ? error.code : undefined;
  return typeof code === "string" && code !== "" ? ["model_error", code] : ["model_error"];
}

/** The execution error one failure reports at the attempt of the agent run that is reporting it. */
function failureDetail(failure: GoondanExecutionError, attempt: number): TurnError {
  const detail: TurnError = { where: failure.where, codes: failure.codes, message: failure.message, attempt };
  if (failure.toolCall !== undefined) detail.toolCall = failure.toolCall;
  return detail;
}

/** Whether a failure already reports an abort, which no other location turns into its own failure. */
function carriesAbort(error: unknown): error is GoondanExecutionError {
  return error instanceof GoondanExecutionError && error.codes.includes("aborted");
}

/**
 * The `where`, `codes` and `error` of one failure that is reported outside the stage order: an
 * extension preparation that failed, and the runs the configuration error of one such preparation
 * fails on its way out. A configuration error reports the codes of its issues in order.
 */
function failureData(error: unknown): Record<string, Json> {
  const issues = isGoondanConfigError(error) ? error.issues : undefined;
  return {
    where: "runtime",
    codes: issues ? issues.map((issue) => issue.code) : ["runtime_error"],
    error: reason(error),
  };
}

function reason(error: unknown): string { return error instanceof Error ? error.message : String(error); }
/**
 * Disposes the instances of one execution scope in creation order. A failed clean-up never keeps the
 * remaining instances from being disposed and never replaces the failure that started the clean-up.
 */
async function disposeAll(instances: ReadonlyMap<string, ExtensionInstance>): Promise<void> {
  for (const instance of instances.values()) {
    try { await instance.dispose?.(); } catch { /* A failed clean-up is never reported in its place. */ }
  }
}
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function toolCalls(result: ModelResult): ToolCall[] { return result.message.content.filter((part): part is Extract<Part, { type: "tool.call" }> => part.type === "tool.call").map((part) => ({ id: part.callId, name: part.name, args: part.args })); }

/** The call a `target: tool` retry processes again, with everything its `toolCall` stage produced. */
interface RetryToolStage { call: ToolCall; execution?: Record<string, Json>; remainingCalls: ToolCall[]; approvals: string[] }
/**
 * One entry of an agent's effective `tools` list. `name` is the exposed name, which is the binding
 * key of a host tool, the name of an extension tool or the agent name of an agent tool.
 */
interface ToolEntry {
  name: string;
  /** The definition the model receives, with the entry's `hint` already appended. */
  definition: ToolDefinition;
  execute(input: Json, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}
/** What a model call may still announce: a text chunk of a call that has not returned yet. */
interface Streaming { active: boolean }
/** One scheduled asynchronous conversation hook of an execution scope. */
interface AsyncHookTask { promise: Promise<void>; settled: boolean; messages?: Message[] }
/** What every hook of one value processing stage produced. */
interface StageRun {
  value: PipelineValue;
  /** The approval reasons `{approval}` results added, in the order the hooks returned them. */
  approvals: string[];
  /** The `execution` of the last `{call, execution}` result, which replaces earlier ones. */
  execution?: Record<string, Json>;
  /** The tool result a `{result}` result supplied; the remaining hooks do not run. */
  result?: ToolResult;
  /** The retry a `{retry}` result requested; the remaining hooks do not run. */
  retry?: { target: "model" | "tool"; afterMs?: number };
}
/** route 실행이 `$output`에 전달한 출력과 각 실행의 종료 사유입니다. */
interface RouteRunResult { outputs: Message[]; finishReasons: string[] }
/**
 * 호스트가 중단하거나 실행 중 입력을 보낼 세션과 흐름 실행 여부입니다. 승인 작업의 독립 실행은
 * `host`가 `null`이며 `close()`만 중단합니다.
 */
interface RunScope { host: string | null; foreground: boolean }
/** The options an agent run takes; the public {@link RunOptions} never carries a conversation. */
interface AgentRunOptions { sessionId: string; signal?: AbortSignal; foreground: boolean; lineage: RunLineage }
interface RunRegistration { signal: AbortSignal; release(): void }
interface QueuedSteer { value: Json; agent?: string }
interface PendingRouteInput { routeIndex: number; order: number; messages: Message[] }
interface RouteCompletion { token: string; agent: string; input: PendingRouteInput[]; result?: AgentRunResult; error?: unknown }
interface TurnState {
  completion?: Message; retryTool?: RetryToolStage; agent: string; instance: string; scope: RunScope;
  agentSpec: AgentSpec; sessionId: string; turnId: string; parentInstance: string | null;
  parentTurnId: string | null; rootTurnId: string; input: Message[]; conversation: Message[];
  step: number; retryCount: number; signal: AbortSignal; messageNumber: number;
  /** The usage of the model responses this run received itself; a sub-run keeps its own. */
  usage: Usage;
  /** The records of the runs this one started, in the order it started them. */
  runs: RunNode[];
  extensions: Map<string, ExtensionInstance>; pending: Map<string, AsyncHookTask>; asyncController: AbortController;
  /**
   * The calls of the model response being processed whose result this run already stored. A retry
   * does not follow a request for one of them; every new response starts the set again, so a call a
   * new response repeats always runs.
   */
  storedCalls: Set<string>;
  /** An approved operation's execution is not an agent run, so `execution.complete` has no effect. */
  operation: boolean;
  operationInput?: { type: "operation_execution"; operationId: string };
  /** A failure inside the `error` stage is never sent to the `error` stage again. */
  handlingError: boolean;
  emitting: Promise<void>;
}

/** 문자열 결합에서 생길 수 있는 충돌 없이 `(sessionId, agent)` 조합을 구분합니다. */
function scopeKey(sessionId: string, agent: string): string { return JSON.stringify([sessionId, agent]); }

export class Goondan {
  readonly #renderer: TemplateRenderer;
  readonly #bindings: RuntimeBindings;
  readonly #store;
  readonly #operationStore;
  readonly #instances = new Map<string, Map<string, ExtensionInstance>>();
  readonly #pendingHooks = new Map<string, Map<string, AsyncHookTask>>();
  /** 실행 범위별 비동기 훅 작업에 세션 삭제나 객체 종료를 알립니다. */
  readonly #asyncControllers = new Map<string, AbortController>();
  /** 실행 중인 턴마다 하나씩 두며, 호스트가 중단할 수 있는 세션별로 묶은 컨트롤러입니다. */
  readonly #controllers = new Map<string, Set<AbortController>>();
  /** `close()`만 중단하는 승인 작업 실행의 컨트롤러입니다. */
  readonly #detached = new Set<AbortController>();
  readonly #queuedInput = new Map<string, QueuedSteer[]>();
  readonly #operationExecutions = new Map<string, Promise<void>>();
  /** 이 객체가 실행 중인 완료 전달 작업입니다. 복구할 때에는 그대로 둡니다. */
  readonly #deliveries = new Map<string, Promise<void>>();
  readonly #activeTurns = new Map<string, Promise<TurnResult>>();
  readonly #turnTails = new Map<string, Promise<void>>();
  readonly #turnCounts = new Map<string, number>();
  readonly #agentTails = new Map<string, Promise<void>>();
  readonly #foregroundAgents = new Map<string, Map<string, number>>();
  /** `idle()`이 기다리는 비동기 훅, 작업 실행과 완료 전달입니다. */
  readonly #tasks = new Set<Promise<void>>();
  #closed = false;
  readonly loaded: LoadedConfig;
  readonly sessions: { delete(sessionId: string): Promise<void> };
  constructor(input: LoadedConfig | unknown, bindings: RuntimeBindings) {
    const retries = bindings.maxRetries;
    if (retries !== undefined && (!Number.isInteger(retries) || retries < 0)) throw new TypeError("maxRetries must be an integer of 0 or more");
    const steps = bindings.maxSteps;
    if (steps !== undefined && (!Number.isInteger(steps) || steps < 1)) throw new TypeError("maxSteps must be an integer of 1 or more");
    const loaded = prepareRuntimeConfig(input, bindings.directory);
    raiseIssues(bindingIssues(loaded.config, bindings));
    this.loaded = loaded;
    this.#bindings = bindings;
    this.#store = bindings.conversationStore ?? new MemoryConversationStore();
    this.#operationStore = bindings.operationStore ?? new MemoryOperationStore();
    this.#renderer = new TemplateRenderer(loaded.templates, loaded.directory);
    this.sessions = { delete: async (sessionId) => { await this.#deleteSession(sessionId); } };
  }

  run(input: RunInput, options: RunOptions): Promise<TurnResult> {
    try { this.#hostSession(options.sessionId); } catch (error) { return Promise.reject(error); }
    return this.#enqueueRun(input, options, { parentInstance: null, parentTurnId: null, rootTurnId: this.#id() });
  }

  #enqueueRun(input: RunInput, options: RunOptions, lineage: RunLineage): Promise<TurnResult> {
    if (this.#closed) return Promise.reject(closedFailure());
    const sessionId = options.sessionId;
    const previous = this.#turnTails.get(sessionId) ?? Promise.resolve();
    this.#turnCounts.set(sessionId, (this.#turnCounts.get(sessionId) ?? 0) + 1);
    const running = previous.catch(() => undefined).then(async () => {
      if (this.#closed) throw closedFailure();
      const turn = this.#executeTurn(input, options, { host: sessionId, foreground: true }, { kind: "turn", nodes: [] }, lineage);
      this.#activeTurns.set(sessionId, turn);
      try { return await turn; }
      finally { if (this.#activeTurns.get(sessionId) === turn) this.#activeTurns.delete(sessionId); }
    });
    const tail = running.then(() => undefined, () => undefined);
    this.#turnTails.set(sessionId, tail);
    void tail.finally(() => {
      const count = (this.#turnCounts.get(sessionId) ?? 1) - 1;
      if (count === 0) { this.#turnCounts.delete(sessionId); if (this.#turnTails.get(sessionId) === tail) this.#turnTails.delete(sessionId); }
      else this.#turnCounts.set(sessionId, count);
    });
    return running;
  }

  async #executeTurn(input: RunInput, options: RunOptions, scope: RunScope, sink: RunSink, lineage: RunLineage): Promise<TurnResult> {
    if (options.agent !== undefined && options.startAgent !== undefined) throw routeFailure("a turn declares either agent or startAgent, not both");
    if (options.startAgent !== undefined && !Object.hasOwn(this.loaded.config.agents, options.startAgent)) throw routeFailure(`Unknown agent: ${options.startAgent}`);
    if (options.agent !== undefined && !Object.hasOwn(this.loaded.config.agents, options.agent)) throw routeFailure(`Unknown agent: ${options.agent}`);
    const routes = this.loaded.config.routes;
    // A start agent that no route continues from cannot progress, so no agent runs at all.
    if (options.startAgent !== undefined && routes && !routes.some((route) => route.from === options.startAgent)) {
      throw routeFailure(`No route starts from ${options.startAgent}`);
    }
    const registration = this.#register(scope, options.signal);
    const start = sink.nodes.length;
    try {
      let routed: RouteRunResult;
      if (options.agent !== undefined) {
        const messages = this.#toMessages(input, options.agent);
        const result = await this.#runAgent(options.agent, messages, { sessionId: options.sessionId, signal: registration.signal, foreground: true, lineage }, scope, sink);
        routed = { outputs: [result.output], finishReasons: [result.finishReason] };
      } else if (routes === undefined) {
        const agent = options.startAgent ?? Object.keys(this.loaded.config.agents)[0];
        if (agent === undefined) throw routeFailure("the goondan declares no agent");
        const result = await this.#runAgent(agent, this.#toMessages(input, agent), { sessionId: options.sessionId, signal: registration.signal, foreground: true, lineage }, scope, sink);
        routed = { outputs: [result.output], finishReasons: [result.finishReason] };
      } else {
        routed = await this.#runRoutes(input, options.startAgent, { sessionId: options.sessionId, signal: registration.signal, foreground: true, lineage }, scope, sink);
      }
      const [first] = routed.outputs;
      if (first === undefined) throw routeFailure("the routes reached no output");
      // Several outputs are joined into a new message that carries no optional field and is stored
      // in no conversation; a single output is that output itself.
      const output: Message = routed.outputs.length === 1 ? first : this.#goondanOutput(routed.outputs);
      const finishReason = routed.finishReasons.every((value) => value === routed.finishReasons[0]) ? routed.finishReasons[0] ?? "stop" : "other";
      const runs = flattenRuns(sink.nodes.slice(start));
      return { output, outputs: routed.outputs, usage: totalUsage(runs), finishReason, status: "done", runs };
    } finally { registration.release(); }
  }

  /**
   * `$output`에 둘 이상의 메시지가 도달했을 때 만드는 대표 출력입니다. 출력 텍스트를 빈 줄로
   * 연결한 `text` 부분 하나와 `goondan` source를 가집니다.
   */
  #goondanOutput(outputs: readonly Message[]): Message {
    return { id: this.#id(), role: "assistant", source: "goondan", content: [{ type: "text", text: outputs.map((item) => textOf(item.content)).join("\n\n") }] };
  }

  /**
   * 실행 하나의 중단 컨트롤러를 등록합니다. 같은 호스트 세션에서 시작한 하위 실행도 함께
   * 중단하며 `release()`는 이 컨트롤러만 제거합니다.
   */
  #register(scope: RunScope, parent?: AbortSignal): RunRegistration {
    const controller = new AbortController();
    let set: Set<AbortController>;
    if (scope.host === null) set = this.#detached;
    else {
      const existing = this.#controllers.get(scope.host);
      set = existing ?? new Set<AbortController>();
      if (!existing) this.#controllers.set(scope.host, set);
    }
    set.add(controller);
    const onAbort = () => { controller.abort(); };
    if (parent) { if (parent.aborted) controller.abort(); else parent.addEventListener("abort", onAbort, { once: true }); }
    return {
      signal: controller.signal,
      release: () => {
        parent?.removeEventListener("abort", onAbort);
        set.delete(controller);
        if (scope.host !== null && set.size === 0) this.#controllers.delete(scope.host);
      },
    };
  }

  /** Records background work so that `idle()` can wait for it. */
  #track(work: Promise<unknown>): void {
    const entry = work.then(() => undefined, () => undefined);
    this.#tasks.add(entry);
    void entry.then(() => { this.#tasks.delete(entry); });
  }

  /** Resolves when the work the runtime carries on outside a host request has finished. */
  async idle(): Promise<void> {
    while (this.#tasks.size > 0) await Promise.all([...this.#tasks]);
  }

  /** The stored operations in creation order, of one conversation or of the whole store. */
  async listOperations(sessionId?: string): Promise<PendingOperation[]> { return this.#operationStore.list(sessionId); }

  /**
   * Approves or rejects a pending operation. The decision returns as soon as it is recorded and never
   * waits for the execution or the completion delivery it starts.
   */
  async decideOperation(sessionId: string, operationId: string, resolution: OperationDecision): Promise<PendingOperation> {
    if (this.#closed) throw closedFailure();
    const operation = await this.#operationStore.get(sessionId, operationId);
    if (!operation) throw operationInvalid(`Unknown operation: ${operationId}`);
    const invalid = decisionIssue(resolution);
    if (invalid) throw operationInvalid(invalid);
    const update = resolution.inputPatch === undefined
      ? decisionUpdate(resolution.decision)
      : await this.#patchUpdate(resolution, operation);
    const updated = await this.#transition(operation, ["pending"], update);
    // A decision that arrives for an operation which is no longer pending changes nothing.
    if (!updated) return (await this.#operationStore.get(sessionId, operationId)) ?? operation;
    if (updated.status === "approved") this.#startOperation(updated);
    else this.#startDelivery(updated);
    return updated;
  }

  /** The update of an approval that carries an input patch, once the host has allowed the patch. */
  async #patchUpdate(resolution: OperationDecision, operation: PendingOperation): Promise<OperationUpdate> {
    const invalid = patchIssue(resolution, operation);
    if (invalid) throw operationInvalid(invalid);
    const patch = this.#json(resolution.inputPatch, "the operation inputPatch");
    if (!isJsonObject(patch)) throw operationInvalid("an operation inputPatch is a JSON object");
    const host = this.#bindings.host;
    let allowed: unknown;
    // A host that cannot validate the patch, refuses it or fails did not allow the patch.
    if (host?.validateOperationInputPatch) {
      try { allowed = await host.validateOperationInputPatch(structuredClone(operation), patch); }
      catch { allowed = false; }
    }
    if (allowed !== true) throw operationInvalid("the host did not allow the operation inputPatch");
    const call = patchedCall(operation.toolCall, patch);
    if (!call) throw operationInvalid("an input patched tool call takes JSON object arguments");
    return decisionUpdate("approved", patch, call);
  }

  /** Cancels an operation that has not started running; a running or settled one does not change. */
  async cancelOperation(sessionId: string, operationId: string): Promise<PendingOperation> {
    if (this.#closed) throw closedFailure();
    const operation = await this.#operationStore.get(sessionId, operationId);
    if (!operation) throw operationInvalid(`Unknown operation: ${operationId}`);
    const updated = await this.#transition(operation, ["pending", "approved"], { status: "cancelled" });
    if (!updated) return (await this.#operationStore.get(sessionId, operationId)) ?? operation;
    this.#startDelivery(updated);
    return updated;
  }

  /**
   * Continues the operations a previous runtime left in the store. The request returns once every
   * pending approval was requested again and the remaining work was started, and reports the first
   * failed approval request after processing every operation.
   */
  async recoverOperations(sessionId?: string): Promise<void> {
    if (this.#closed) throw closedFailure();
    let first: unknown;
    for (const operation of await this.#operationStore.list(sessionId)) {
      // Work this runtime is still carrying out is not treated as interrupted.
      if (this.#operationExecutions.has(operation.operationId) || this.#deliveries.has(operation.operationId)) continue;
      if (operation.status === "pending") {
        try { await this.#requestApproval(operation); } catch (error) { if (first === undefined) first = error; }
        continue;
      }
      if (operation.status === "approved") { this.#startOperation(operation); continue; }
      if (operation.status === "running") {
        const failed = await this.#transition(operation, ["running"], { status: "failed", error: interruptedMessage, errorCode: "execution_interrupted" });
        if (failed) this.#startDelivery(failed);
        continue;
      }
      if (operation.deliveryStatus === "delivered") continue;
      const ready = operation.deliveryStatus === "delivering"
        ? await this.#operationStore.releaseDelivery(operation.sessionId, operation.operationId, operation.deliveryId, this.#now())
        : operation;
      if (ready) this.#startDelivery(ready);
    }
    if (first !== undefined) throw first;
  }

  /** Asks the host to decide a pending operation, with a request rebuilt from the stored record. */
  async #requestApproval(operation: PendingOperation): Promise<void> {
    const host = this.#bindings.host;
    if (!host?.requestApproval) return;
    await host.requestApproval({
      operationId: operation.operationId, sessionId: operation.sessionId, turnId: operation.turnId,
      agent: operation.agent, instance: operation.instance, parentInstance: operation.parentInstance,
      parentTurnId: operation.parentTurnId, rootTurnId: operation.rootTurnId,
      toolCall: structuredClone(operation.toolCall), reasons: [...operation.reasons],
    });
  }
  steer(sessionId: string, input: Json, options: { agent?: string } = {}): void {
    this.#hostSession(sessionId);
    if (this.#closed) return;
    if (options.agent !== undefined && !Object.hasOwn(this.loaded.config.agents, options.agent)) throw this.#steerFailure(`Unknown agent: ${options.agent}`);
    const foreground = this.#foregroundAgents.get(sessionId);
    let agent = options.agent;
    if (agent !== undefined && (foreground?.get(agent) ?? 0) > 1) throw this.#steerFailure(`More than one ${agent} execution is running`);
    if (agent === undefined && foreground) {
      const running = [...foreground.entries()].flatMap(([name, count]) => Array.from({ length: count }, () => name));
      if (running.length === 1) agent = running[0];
      else if (running.length > 1) throw this.#steerFailure("agent is required while more than one route execution is running");
    }
    const queue = this.#queuedInput.get(sessionId) ?? [];
    const item: QueuedSteer = { value: structuredClone(input) };
    if (agent !== undefined) item.agent = agent;
    queue.push(item); this.#queuedInput.set(sessionId, queue);
  }
  abort(sessionId: string): boolean {
    this.#hostSession(sessionId);
    if (this.#closed) return false;
    const controllers = this.#controllers.get(sessionId);
    if (!controllers || controllers.size === 0) return false;
    for (const controller of [...controllers]) controller.abort();
    return true;
  }
  /**
   * Stops every run, asynchronous hook, operation execution and completion delivery, and disposes the
   * extension instances. What an operation left in the store stays as it is, so the recovery of a new
   * runtime built on the same store continues it.
   */
  async close(): Promise<void> { await this.#shutdown(); }

  /** 군단 객체가 가진 실행과 비동기 작업을 종료합니다. */
  async #shutdown(): Promise<void> {
    this.#closed = true;
    // Only the runtime the host created holds runs, detached executions and the steering queue.
    for (const controllers of this.#controllers.values()) for (const controller of [...controllers]) controller.abort();
    for (const controller of [...this.#detached]) controller.abort();
    this.#queuedInput.clear();
    // 종료된 객체는 비동기 훅에 중단을 알리고 이후 결과를 반영하지 않습니다.
    for (const controller of this.#asyncControllers.values()) controller.abort();
    this.#asyncControllers.clear();
    this.#pendingHooks.clear();
    for (const byConversation of this.#instances.values()) await disposeAll(byConversation);
    this.#instances.clear();
  }

  /** 일치한 route를 실행하고, 독립 분기는 동시에 시작하며 stateful 입력은 합칩니다. */
  async #runRoutes(input: RunInput, startAgent: string | undefined, options: AgentRunOptions, scope: RunScope, sink: RunSink): Promise<RouteRunResult> {
    const routes = this.loaded.config.routes ?? [];
    const pending = new Map<string, PendingRouteInput[]>();
    const running = new Map<string, Promise<RouteCompletion>>();
    const active = new Map<string, number>();
    const outputs: Array<{ route: number; order: number; message: Message; finishReason: string }> = [];
    let order = 0;
    const departures = this.#departureSets(routes);
    const entryAgent = startAgent ?? routes.find((route) => route.from === "$input" && route.to !== "$output")?.to ?? Object.keys(this.loaded.config.agents)[0] ?? "goondan";
    const turnInput = this.#toMessages(input, entryAgent);
    const add = (agent: string, item: PendingRouteInput): void => { pending.set(agent, [...(pending.get(agent) ?? []), item]); };
    const routeMessage = (target: string, from: string, instance: string, message: Message): Message => ({
      id: this.#id(), role: "user", source: target, content: structuredClone(message.content), meta: { from, instance },
    });
    const dispatch = async (from: string, result: AgentRunResult | undefined, initial: RunInput | undefined): Promise<void> => {
      const candidates = routes.map((route, index) => ({ route, index })).filter(({ route }) => route.from === from);
      const matched: Array<{ route: RouteSpec; index: number; messages: Message[] }> = [];
      for (const candidate of candidates) {
        const messages = initial === undefined
          ? result === undefined ? [] : candidate.route.to === "$output" ? [] : [routeMessage(candidate.route.to, from, result.instance, result.output)]
          : candidate.route.to === "$output" ? [] : this.#toMessages(initial, candidate.route.to);
        const conditionInput = from === "$input" && initial !== undefined
          ? this.#toMessages(initial, candidate.route.to === "$output" ? entryAgent : candidate.route.to)
          : turnInput;
        const output = result?.output ?? null;
        const text = result ? textOf(result.output.content) : inputTextOf(conditionInput);
        if (await this.#routeMatches(candidate.route, output, text, conditionInput)) matched.push({ ...candidate, messages });
      }
      if (matched.length === 0) throw routeFailure(`No route matched from ${from}`);
      for (const candidate of matched) {
        if (candidate.route.to === "$output") {
          if (result) outputs.push({ route: candidate.index, order: order++, message: result.output, finishReason: result.finishReason });
          continue;
        }
        add(candidate.route.to, { routeIndex: candidate.index, order: order++, messages: candidate.messages });
      }
    };
    if (startAgent !== undefined) add(startAgent, { routeIndex: -1, order: order++, messages: this.#toMessages(input, startAgent) });
    else await dispatch("$input", undefined, input);

    const launch = (agent: string, items: PendingRouteInput[]): void => {
      const token = this.#id();
      active.set(agent, (active.get(agent) ?? 0) + 1);
      const messages = items.sort((left, right) => left.routeIndex - right.routeIndex || left.order - right.order).flatMap((item) => item.messages);
      const promise = this.#runAgent(agent, messages, options, scope, sink).then(
        (result): RouteCompletion => ({ token, agent, input: items, result }),
        (error): RouteCompletion => ({ token, agent, input: items, error }),
      );
      running.set(token, promise);
    };
    const startReady = (): boolean => {
      let started = false;
      for (const [agent, items] of [...pending]) {
        if (items.length === 0) { pending.delete(agent); continue; }
        if (this.#agent(agent).stateful === false) {
          pending.delete(agent);
          for (const item of items) launch(agent, [item]);
          started = true;
          continue;
        }
        if ((active.get(agent) ?? 0) > 0) continue;
        const waits = [...(departures.get(agent) ?? [])].some((source) => (active.get(source) ?? 0) > 0 || (pending.get(source)?.length ?? 0) > 0);
        if (waits) continue;
        pending.delete(agent); launch(agent, items); started = true;
      }
      return started;
    };
    const stopBranches = async (error: unknown): Promise<never> => {
      if (scope.host !== null) for (const controller of this.#controllers.get(scope.host) ?? []) controller.abort();
      await Promise.allSettled(running.values());
      throw error;
    };

    while (pending.size > 0 || running.size > 0) {
      startReady();
      if (running.size === 0) throw routeFailure("Stateful route inputs cannot make progress");
      const completed = await Promise.race(running.values());
      running.delete(completed.token);
      active.set(completed.agent, Math.max(0, (active.get(completed.agent) ?? 1) - 1));
      if (completed.error !== undefined) return await stopBranches(completed.error);
      if (completed.result) {
        try { await dispatch(completed.agent, completed.result, undefined); }
        catch (error) { return await stopBranches(error); }
      }
    }
    outputs.sort((left, right) => left.route - right.route || left.order - right.order);
    return { outputs: outputs.map((item) => item.message), finishReasons: outputs.map((item) => item.finishReason) };
  }

  async #routeMatches(route: RouteSpec, output: Message | null, text: string, input: Message[]): Promise<boolean> {
    if (!route.when) return true;
    if ("fn" in route.when) {
      let decision: Json;
      try { decision = await this.#callFunction(route.when.fn, this.#json({ output, text, input }, "route condition")); }
      catch (error) { throw routeFailure(`The route condition ${route.when.fn} failed: ${reason(error)}`, error); }
      if (typeof decision !== "boolean") throw routeFailure(`The route condition ${route.when.fn} must return true or false`);
      return decision;
    }
    if (typeof route.when.output === "string") return text === route.when.output;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return false; }
    if (!isObject(parsed)) return false;
    return Object.entries(route.when.output).every(([key, value]) => Object.hasOwn(parsed, key) && jsonEqual(this.#json(parsed[key], key), value));
  }

  #departureSets(routes: readonly RouteSpec[]): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const agents = Object.keys(this.loaded.config.agents);
    for (const target of agents) {
      const reachable = new Set<string>();
      const queue = ["$input"];
      while (queue.length > 0) {
        const from = queue.shift();
        if (from === undefined) continue;
        for (const route of routes) {
          if (route.from !== from || route.to === "$output" || route.to === target || reachable.has(route.to)) continue;
          reachable.add(route.to); queue.push(route.to);
        }
      }
      const reachesTarget = (start: string): boolean => {
        const seen = new Set<string>(); const work = [start];
        while (work.length > 0) {
          const from = work.shift(); if (from === undefined || seen.has(from)) continue; seen.add(from);
          for (const route of routes) { if (route.from !== from) continue; if (route.to === target) return true; if (route.to !== "$output") work.push(route.to); }
        }
        return false;
      };
      result.set(target, new Set([...reachable].filter((agent) => reachesTarget(agent))));
    }
    return result;
  }

  /** 에이전트 하나를 실행하고 stateful 인스턴스의 실행을 직렬화합니다. */
  async #runAgent(agent: string, rawInput: Message[], options: AgentRunOptions, scope: RunScope, sink: RunSink): Promise<AgentRunResult> {
    const spec = this.#agent(agent);
    if (spec.stateful === false) return await this.#runAgentNow(agent, rawInput, options, scope, sink);
    const key = scopeKey(options.sessionId, agent);
    const previous = this.#agentTails.get(key) ?? Promise.resolve();
    const running = previous.catch(() => undefined).then(() => this.#runAgentNow(agent, rawInput, options, scope, sink));
    const tail = running.then(() => undefined, () => undefined);
    this.#agentTails.set(key, tail);
    void tail.finally(() => { if (this.#agentTails.get(key) === tail) this.#agentTails.delete(key); });
    return await running;
  }

  async #runAgentNow(agent: string, rawInput: Message[], options: AgentRunOptions, scope: RunScope, sink: RunSink): Promise<AgentRunResult> {
    // An execution that was told to stop starts no further run, so a sub-run announces nothing.
    if (options.signal?.aborted) throw abortFailure();
    const spec = this.#agent(agent);
    const registration = this.#register(scope, options.signal);
    const turnId = this.#id();
    const stateful = spec.stateful !== false;
    const instance = stateful ? `${options.sessionId}/${agent}` : this.#id();
    const node = startRun(sink, agent, instance, turnId, options.lineage);
    let state: TurnState;
    try {
      const extensions = await this.#extensions(agent, spec, options.sessionId, instance, stateful);
      const loaded = stateful ? await this.#store.load(options.sessionId, agent) : [];
      state = this.#state(agent, instance, spec, rawInput, options.sessionId, turnId, options.lineage, loaded, registration.signal, scope, extensions, node.children);
    } catch (error) {
      // A run that could not prepare its extension instances reports turn.error without turn.start.
      await this.#preparationError(error, agent, options.sessionId, turnId, instance, options.lineage);
      registration.release();
      throw isGoondanConfigError(error) ? error : preparationFailure(error);
    }
    try {
      const result = await this.#runStages(state);
      finishRun(node, state.usage, result.finishReason);
      return result;
    } catch (error) {
      try {
        // A failure the `error` stage recovered from still ends the run normally.
        const result = await this.#handleError(error, state);
        finishRun(node, state.usage, result.finishReason);
        return result;
      } catch (failed) {
        // A failed run still reports the usage of the model responses it received.
        if (carriesAbort(failed)) abortRun(node, state.usage); else failRun(node, state.usage);
        throw failed;
      }
    } finally {
      registration.release();
      this.#unmarkForeground(state);
      if (!stateful) {
        state.asyncController.abort();
        await disposeAll(state.extensions);
        state.pending.clear();
      }
    }
  }

  /** Steps 1 to 6 of the stage order of one agent run. */
  async #runStages(state: TurnState): Promise<AgentRunResult> {
    state.input = await this.#input(state);
    state.input = await this.#applyInputRule(state);
    this.#markForeground(state);
    await this.#emit("turn.start", state, { input: this.#json(state.input, "input") });
    state.conversation.push(...state.input); await this.#append(state, state.input);
    // Tool call parts a failed or aborted run left unpaired are repaired before the first safe point.
    await this.#repair(state);
    // The conversation stage runs once per agent run, right after the first safe conversation point.
    await this.#safePoint(state);
    const conversation = (await this.#pipeline("conversation", state.conversation, state)).value;
    if (!isMessageArray(conversation)) throw new GoondanExecutionError({ where: "conversation", codes: ["value_invalid"], message: "the conversation value is not an array of messages" });
    if (conversation !== state.conversation) { state.conversation = conversation; await this.#replace(state); }
    return await this.#modelLoop(state);
  }

  /**
   * Removes the `tool.call` and `tool.result` parts of the stored conversation whose counterpart is
   * missing, so that the `conversation` stage and the model receive paired calls only.
   */
  async #repair(state: TurnState): Promise<void> {
    const repaired = repairToolPairs(state.conversation);
    if (!repaired) return;
    state.conversation = repaired;
    await this.#replace(state);
  }

  /**
   * Handles a safe conversation point: the host's steered input first, then the results of the
   * asynchronous hooks that have finished. Both are appended to the conversation and stored. An
   * execution that was told to stop stores nothing, so it takes neither: the steered values stay in
   * the queue and the finished tasks stay in the scope for the next execution that reaches a point.
   */
  async #safePoint(state: TurnState): Promise<void> {
    if (state.signal.aborted) return;
    await this.#drainSteering(state);
    await this.#drainPending(state);
  }

  async #preparationError(error: unknown, agent: string, sessionId: string, turnId: string, instance: string, lineage: RunLineage): Promise<void> {
    // No extension instance exists in this scope, so the event only reaches the host.
    await this.#deliver({ name: "turn.error", agent, sessionId, turnId, instance, ...lineage, at: Date.now(), data: failureData(error) }, new Map());
  }

  /** Steps 3 to 6 of the stage order: model input, model call, tool calls and the output stage. */
  async #modelLoop(state: TurnState): Promise<AgentRunResult> {
      const spec = state.agentSpec;
      for (;;) {
        if (state.signal.aborted) throw abortFailure();
        // A run with a message scheduled skips the safe point and the modelInput stage.
        if (state.completion) return await this.#finishToolTurn(state.completion, state);
        // A run that used up its model calls stops before the safe point and the modelInput stage.
        const limit = this.#bindings.maxSteps;
        if (limit !== undefined && state.step >= limit) {
          throw new GoondanExecutionError({ where: "runtime", codes: ["runtime_error"], message: `The agent run reached its limit of ${String(limit)} model calls` });
        }
        // Every model call after the first one starts at a safe conversation point.
        if (state.step > 0) await this.#safePoint(state);
        const modelInput = await this.#modelInput(state);
        // The call number belongs to the call that is starting, so a `modelInput` hook's `model.run`
        // still reports the number of the last call the run started.
        state.step += 1;
        const step = state.step;
        await this.#emit("step.start", state, { step, messages: modelInput.messages.length, tools: modelInput.tools.map((tool) => tool.name) });
        let modelResult: ModelResult;
        const streaming: Streaming = { active: true };
        try {
          if (state.signal.aborted) throw abortFailure();
          // The model implementation receives a copy, so what it keeps never changes the conversation.
          const raw = await this.#model(spec).generate(structuredClone(modelInput), {
            agent: state.agent, sessionId: state.sessionId, turnId: state.turnId, step, signal: state.signal,
            onTextDelta: (delta) => { this.#textDelta(state, streaming, step, delta); },
          });
          streaming.active = false;
          // A result that arrives after the abort was signalled is not used.
          if (state.signal.aborted) throw abortFailure();
          // The runtime fills `id` and `source` and checks the form before the modelResult hooks run.
          modelResult = this.#modelResult(raw);
        } catch (error) {
          streaming.active = false;
          const message = reason(error);
          const aborted = state.signal.aborted;
          const failed = error instanceof GoondanExecutionError ? error : new GoondanExecutionError({ where: "model", codes: modelErrorCodes(error), message }, { cause: error });
          await this.#emit("step.error", state, { step, error: message, codes: aborted ? ["aborted"] : failed.codes });
          throw aborted ? abortFailure(error) : failed;
        }
        addUsage(state.usage, modelResult.usage);
        await this.#emit("step.done", state, { step, finishReason: modelResult.finishReason });
        const stage = await this.#pipeline("modelResult", modelResult, state);
        if (stage.retry) {
          // The message of a retried model result is not stored.
          state.retryCount += 1;
          await this.#waitForRetry(state, stage.retry.afterMs);
          continue;
        }
        if (!isModelResult(stage.value)) throw new GoondanExecutionError({ where: "modelResult", codes: ["value_invalid"], message: "the modelResult value is not a model result" });
        modelResult = stage.value;
        state.conversation.push(modelResult.message); await this.#append(state, [modelResult.message]);
        const calls = toolCalls(modelResult);
        if (calls.length > 0) {
          // Every response starts its own batch, so a call a new response repeats always runs again.
          state.storedCalls.clear();
          let ended: Message | undefined;
          for (const [index, call] of calls.entries()) ended = (await this.#executeTool(call, state, calls.slice(index + 1))) ?? ended;
          if (ended) return this.#finishToolTurn(ended, state);
          continue;
        }
        const outputValue = (await this.#pipeline("output", modelResult.message, state)).value;
        if (!isMessage(outputValue)) throw new GoondanExecutionError({ where: "output", codes: ["value_invalid"], message: "the output value is not a message" });
        state.conversation[state.conversation.length - 1] = outputValue;
        await this.#replace(state);
        return await this.#finish(state, outputValue, modelResult.finishReason);
      }
  }

  /**
   * Announces one text chunk of the model call that is running. A chunk that arrives after the call
   * returned or after the abort was signalled, and a chunk that is not a string, is not announced.
   */
  #textDelta(state: TurnState, streaming: Streaming, step: number, delta: unknown): void {
    if (!streaming.active || typeof delta !== "string" || state.signal.aborted) return;
    void this.#emit("step.textDelta", state, { step, delta });
  }

  /**
   * Fills the `id` and `source` a model implementation may omit, then checks the model result form.
   * A model implementation that answered with something other than an object is reported the same
   * way, as an invalid `modelResult` value and never as a model failure.
   */
  #modelResult(raw: unknown): ModelResult {
    const message: unknown = isObject(raw) ? raw.message : undefined;
    let filled: unknown = raw;
    if (isObject(raw) && isObject(message)) {
      const complete: Record<string, unknown> = { ...message };
      if (complete.id === undefined) complete.id = this.#id();
      if (complete.source === undefined) complete.source = "model";
      filled = { ...raw, message: complete };
    }
    const issue = stageValueIssue("modelResult", filled);
    if (issue) throw new GoondanExecutionError({ where: "modelResult", codes: ["value_invalid"], message: issue });
    if (!isModelResult(filled)) throw new GoondanExecutionError({ where: "modelResult", codes: ["value_invalid"], message: "the modelResult value is not a model result" });
    return filled;
  }

  #retryLimit(): number { return this.#bindings.maxRetries ?? 3; }

  /**
   * Waits for a retry request's `afterMs`. An execution told to stop never follows the request, and
   * one told to stop while it waits stops waiting at once and fails with the abort.
   */
  async #waitForRetry(state: TurnState, afterMs: number | undefined): Promise<void> {
    if (afterMs !== undefined && afterMs > 0 && !state.signal.aborted) {
      await new Promise<void>((settle) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stop = (): void => { if (timer !== undefined) clearTimeout(timer); settle(); };
        timer = setTimeout(() => { state.signal.removeEventListener("abort", stop); settle(); }, afterMs);
        state.signal.addEventListener("abort", stop, { once: true });
      });
    }
    if (state.signal.aborted) throw abortFailure();
  }

  /** Whether the runtime follows a retry request for this failure. */
  #canRetry(target: "model" | "tool", turnError: TurnError, state: TurnState): boolean {
    if (state.retryCount >= this.#retryLimit()) return false;
    if (target === "model") return turnError.where === "model";
    const pending = state.retryTool;
    if (turnError.where !== "tool" || !pending) return false;
    // A call whose result this run already stored is not run again.
    return !state.storedCalls.has(pending.call.id);
  }

  async #handleError(error: unknown, state: TurnState): Promise<AgentRunResult> {
      // A configuration error of an extension preparation fails the whole turn unchanged. The run
      // that was waiting for it still ends, so it announces the turn.error its turn.start expects.
      if (isGoondanConfigError(error)) {
        await this.#emit("turn.error", state, failureData(error));
        throw error;
      }
      // An aborted run reports the abort whatever failed, and never reaches the error stage.
      const aborted = state.signal.aborted;
      const attempt = state.retryCount + 1;
      const turnError: TurnError = aborted
        ? { where: "runtime", codes: ["aborted"], message: "aborted", attempt }
        : error instanceof GoondanExecutionError
          ? failureDetail(error, attempt)
          : { where: "runtime", codes: ["runtime_error"], message: reason(error), attempt };
      // Only a model or tool failure reaches the error stage, and never a failure raised inside it.
      if (!aborted && !state.handlingError && (turnError.where === "model" || turnError.where === "tool")) {
        state.handlingError = true;
        let stage: StageRun | undefined;
        let hookError: unknown;
        try { stage = await this.#pipeline("error", turnError, state); }
        catch (failure) { hookError = failure; }
        finally { state.handlingError = false; }
        if (hookError !== undefined) return await this.#handleError(hookError, state);
        const retry = stage?.retry;
        if (retry && this.#canRetry(retry.target, turnError, state)) {
          state.retryCount += 1;
          try {
            await this.#waitForRetry(state, retry.afterMs);
            if (retry.target === "tool" && state.retryTool) {
              const pending = state.retryTool;
              let ended = await this.#dispatchTool(pending.call, pending.execution, pending.remainingCalls, pending.approvals, state);
              // The calls of the same model response that have not run yet keep their own remainder.
              const remaining = pending.remainingCalls;
              for (const [index, call] of remaining.entries()) ended = (await this.#executeTool(call, state, remaining.slice(index + 1))) ?? ended;
              state.retryTool = undefined;
              if (ended) return await this.#finishToolTurn(ended, state);
            }
            return await this.#modelLoop(state);
          } catch (retryError) { return await this.#handleError(retryError, state); }
        }
      }
      await this.#emit("turn.error", state, { where: turnError.where, codes: turnError.codes, error: turnError.message });
      // The thrown execution error carries the same fields the `error` stage received.
      throw new GoondanExecutionError(turnError, { cause: error instanceof Error ? error : undefined });
  }

  /** Runs the output stage of a run that ends with a message `execution.complete` scheduled. */
  async #finishToolTurn(ended: Message, state: TurnState): Promise<AgentRunResult> {
    const endedValue = (await this.#pipeline("output", ended, state)).value;
    if (!isMessage(endedValue)) throw new GoondanExecutionError({ where: "output", codes: ["value_invalid"], message: "the output value is not a message" });
    state.conversation.push(endedValue); await this.#append(state, [endedValue]);
    return await this.#finish(state, endedValue, "tool");
  }

  async #finish(state: TurnState, output: Message, finishReason: string): Promise<AgentRunResult> {
    await this.#emit("turn.done", state, { output: this.#json(output, "turn.done"), steps: state.step, usage: this.#json(state.usage, "usage") });
    return { output, usage: state.usage, finishReason, status: "done", instance: state.instance };
  }

  #state(agent: string, instance: string, agentSpec: AgentSpec, input: Message[], sessionId: string, turnId: string, lineage: RunLineage, conversation: Message[], signal: AbortSignal, scope: RunScope, extensions: Map<string, ExtensionInstance>, runs: RunNode[]): TurnState {
    const key = scopeKey(sessionId, agent); const stateful = agentSpec.stateful !== false;
    let pending = stateful ? this.#pendingHooks.get(key) : undefined;
    if (!pending) { pending = new Map(); if (agentSpec.stateful !== false) this.#pendingHooks.set(key, pending); }
    let asyncController = stateful ? this.#asyncControllers.get(key) : undefined;
    if (!asyncController) { asyncController = new AbortController(); if (stateful) this.#asyncControllers.set(key, asyncController); }
    return { agent, instance, scope, agentSpec, sessionId, turnId, ...lineage, input, conversation, step: 0, retryCount: 0, signal, messageNumber: 0, usage: zeroUsage(), runs, extensions, pending, asyncController, storedCalls: new Set<string>(), operation: false, handlingError: false, emitting: Promise.resolve() };
  }

  #childLineage(state: TurnState): RunLineage {
    return { parentInstance: state.instance, parentTurnId: state.turnId, rootTurnId: state.rootTurnId };
  }

  /** Where the sub-runs of one agent run record themselves; an asynchronous hook records nothing. */
  #sink(state: TurnState, kind: RunKind, asynchronous = false): RunSink {
    return asynchronous ? detachedSink(kind) : { kind, nodes: state.runs };
  }

  /**
   * Prepares the extension instances of one execution scope, in the declaration order of the
   * effective configuration. A failed preparation disposes what it already created and stores
   * nothing, so the next run in the same scope prepares again from the start.
   */
  async #extensions(agent: string, spec: AgentSpec, sessionId: string, instance: string, cache: boolean): Promise<Map<string, ExtensionInstance>> {
    const key = cache ? scopeKey(sessionId, agent) : instance; const cached = cache ? this.#instances.get(key) : undefined; if (cached) return cached;
    const instances = new Map<string, ExtensionInstance>();
    const dispose = async (): Promise<void> => { await disposeAll(instances); };
    try {
      for (const [name, use] of Object.entries(spec.extensions ?? {})) {
        if (use.enabled === false) continue;
        const definition = this.#bindings.extensions?.[name]; if (!definition) throw new Error(`Unknown extension: ${name}`);
        // The validator may be asynchronous: its result is awaited here so that a rejection fails
        // the preparation instead of escaping, and so that the value it returns is the create input.
        const options: Json = use.options ?? {}; const validated = (await definition.options?.validate(options)) ?? options;
        // Only the ports the definition requires are handed to the extension.
        const ports: Record<string, unknown> = {};
        for (const port of definition.requires ?? []) ports[port] = this.#bindings.ports?.[port];
        instances.set(name, await definition.create({ options: validated, ports, agent: { name: agent, spec }, log: this.#bindings.logger ?? noLog }));
      }
    } catch (error) {
      await dispose();
      throw error;
    }
    const provided = new Map<string, ProvidedExtension>();
    for (const [name, instance] of instances) {
      provided.set(name, { stages: Object.keys(instance.hooks ?? {}).filter(isValueName), tools: (instance.tools ?? []).map((tool) => tool.name) });
    }
    const issues = instanceIssues(agent, spec, this.#bindings, provided);
    if (issues.length > 0) {
      await dispose();
      throw new GoondanConfigError(issues);
    }
    if (cache) this.#instances.set(key, instances); return instances;
  }

  /** Renders a declared template, reporting a failure as the execution error of its own location. */
  #render(template: string, variables: Record<string, Json>, where: ErrorLocation, code: string): string {
    try {
      return this.#renderer.render(template, variables);
    } catch (error) {
      throw new GoondanExecutionError({ where, codes: [code], message: error instanceof Error ? error.message : String(error) }, { cause: error });
    }
  }

  async #input(state: TurnState): Promise<Message[]> {
    const value = (await this.#pipeline("input", state.input, state)).value;
    if (!isMessageArray(value)) throw new GoondanExecutionError({ where: "input", codes: ["value_invalid"], message: "the input value is not an array of messages" });
    return value;
  }

  /**
   * Turns the agent input into the first user message. `fn` wins over `template`, and a value that is
   * not a string becomes JSON text. The message carries the declared agent name as its `source`.
   */
  async #applyInputRule(state: TurnState): Promise<Message[]> {
    const rule = state.agentSpec.input ?? "asis";
    const messages: Message[] = [];
    for (const message of state.input) {
      const content: Part[] = [];
      for (const part of message.content) {
        if (part.type !== "json") { content.push(structuredClone(part)); continue; }
        let text: string;
        if (rule !== "asis" && typeof rule.fn === "string") text = await this.#inputPartText(part.value, rule.fn);
        else if (rule !== "asis" && typeof rule.template === "string") text = this.#render(rule.template, isObject(part.value) ? this.#jsonRecord(part.value) : { text: part.value }, "input", "runtime_error");
        else text = jsonText(part.value);
        content.push({ type: "text", text });
      }
      messages.push({ ...structuredClone(message), content });
    }
    return messages;
  }

  /**
   * The message text an `input.fn` produced. A failing call is a `runtime_error` of the `input`
   * location and a result that is not JSON a `value_invalid` of the same location.
   */
  async #inputPartText(input: Json, name: string): Promise<string> {
    const fn: GoondanFunction | undefined = this.#bindings.functions?.[name];
    if (!fn) throw new GoondanExecutionError({ where: "input", codes: ["runtime_error"], message: `Unknown function: ${name}` });
    let returned: Json | undefined;
    try { returned = await fn(structuredClone(input)); }
    catch (error) { throw new GoondanExecutionError({ where: "input", codes: ["runtime_error"], message: reason(error) }, { cause: error }); }
    let value: Json;
    try { value = this.#json(returned, `the result of the function ${name}`); }
    catch (error) { throw new GoondanExecutionError({ where: "input", codes: ["value_invalid"], message: reason(error) }, { cause: error }); }
    return typeof value === "string" ? value : jsonText(value);
  }

  /** The model input of step 3 before any `modelInput` hook: the value `model.run` also starts from. */
  #baseModelInput(state: TurnState): ModelInput {
    const tools = this.#tools(state).map((entry) => entry.definition);
    const declared = state.agentSpec.systemMessage;
    const blocks = Array.isArray(declared) ? declared : declared ? [declared] : [];
    const variables: Record<string, Json> = {
      params: state.agentSpec.params ?? {}, tools: this.#json(tools, "modelInput"),
      agent: { name: state.agent }, model: state.agentSpec.model ?? "",
      input: this.#json(state.input, "input"), inputText: inputTextOf(state.input),
    };
    const system = blocks.map((block, index) => {
      const text = typeof block.text === "string" ? block.text : this.#render(block.template ?? "", variables, "modelInput", "runtime_error");
      // Only a block that declared `cache: true` carries the hint; the field is absent otherwise.
      const made: Block = { text, source: `system:${String(index)}` };
      if (block.cache === true) made.cache = true;
      return made;
    });
    return { system, messages: structuredClone(state.conversation), tools, options: {} };
  }

  async #modelInput(state: TurnState): Promise<ModelInput> {
    const value = (await this.#pipeline("modelInput", this.#baseModelInput(state), state)).value;
    if (!isModelInput(value)) throw new GoondanExecutionError({ where: "modelInput", codes: ["value_invalid"], message: "the modelInput value is not a model input" });
    return value;
  }

  /**
   * The effective `tools` list of one agent run, in declaration order. The exposed name of a host
   * tool is its binding key, not the name its implementation carries, and it decides the definition
   * the model receives, the settings that apply and the implementation a call runs.
   */
  #tools(state: TurnState): ToolEntry[] {
    const hostTools = this.#bindings.tools ?? {};
    const extensionTools = new Map<string, Tool>();
    for (const instance of state.extensions.values()) {
      for (const tool of instance.tools ?? []) if (!extensionTools.has(tool.name)) extensionTools.set(tool.name, tool);
    }
    const entries: ToolEntry[] = [];
    for (const use of state.agentSpec.tools ?? []) {
      const resolved = toolEntry(use);
      if (!resolved) continue;
      if (resolved.agent) { entries.push(this.#agentTool(resolved.name, state)); continue; }
      const tool = Object.hasOwn(hostTools, resolved.name) ? hostTools[resolved.name] : extensionTools.get(resolved.name);
      if (!tool) throw new Error(`Unknown tool: ${resolved.name}`);
      const hint = typeof use === "object" && typeof use.hint === "string" && use.hint !== "" ? `\n${use.hint}` : "";
      entries.push({
        name: resolved.name,
        definition: { name: resolved.name, description: tool.description + hint, input: tool.input },
        // The implementation keeps its own receiver, so a class based tool keeps its prototype.
        execute: (input, ctx) => tool.execute(input, ctx),
      });
    }
    return entries;
  }

  /** One `tools` entry that exposes an agent of the same configuration; a call runs only that agent. */
  #agentTool(target: string, state: TurnState): ToolEntry {
    const spec = this.#agent(target);
    return {
      name: target,
      definition: { name: target, description: spec.description ?? `Run ${target}`, input: { type: "object" } },
      execute: async (input, ctx) => {
        // 대상은 부모 실행에서 파생한 세션에서 route를 따르지 않고 실행합니다.
        const result = await this.#runAgent(target, this.#toMessages(input, target), { sessionId: `${ctx.sessionId}#${ctx.turnId}#${target}`, signal: ctx.signal, foreground: false, lineage: this.#childLineage(state) }, { host: state.scope.host, foreground: false }, this.#sink(state, "tool"));
        return { callId: ctx.toolCall.id, name: target, args: input, content: result.output.content };
      },
    };
  }

  /** The approval reason the `tools` entry of one exposed name adds, if it declares one. */
  #approvalReasons(spec: AgentSpec, name: string): string[] {
    for (const use of spec.tools ?? []) {
      const resolved = toolEntry(use);
      if (!resolved || resolved.name !== name) continue;
      return typeof use === "object" && use.approval === "required" ? [approvalReason(name)] : [];
    }
    return [];
  }
  #model(spec: AgentSpec) { const model = spec.model ? this.#bindings.models[spec.model] : undefined; if (!model) throw new Error(`Unknown model: ${String(spec.model)}`); return model; }

  /**
   * Decides what one requested call becomes once its `toolCall` hooks ran: a supplied tool result, a
   * failure for a call the agent cannot make, an approval operation or a tool run.
   */
  async #executeTool(original: ToolCall, state: TurnState, remainingCalls: ToolCall[]): Promise<Message | undefined> {
    const stage = await this.#pipeline("toolCall", original, state, original.id);
    // A hook that supplied a tool result skips the availability check and any approval.
    if (stage.result) { await this.#appendToolResult(stage.result, state, original.id); return state.completion; }
    if (!isToolCall(stage.value)) throw new GoondanExecutionError({ where: "toolCall", codes: ["value_invalid"], message: "the toolCall value is not a tool call" });
    return await this.#dispatchTool(stage.value, stage.execution, remainingCalls, stage.approvals, state);
  }

  /**
   * Processes the call a finished `toolCall` stage produced: the availability check, an approval
   * operation or the tool run. A `target: tool` retry starts again from here and never runs the
   * `toolCall` hooks a second time.
   */
  async #dispatchTool(call: ToolCall, execution: Record<string, Json> | undefined, remainingCalls: ToolCall[], approvals: string[], state: TurnState): Promise<Message | undefined> {
    state.retryTool = { call, execution, remainingCalls, approvals };
    // Only an exposed name of the effective tools list can run or become an approval operation.
    const entry = this.#tools(state).find((candidate) => candidate.name === call.name);
    if (!entry) throw new GoondanExecutionError({ where: "tool", codes: ["tool_unavailable"], message: `Tool ${call.name} is not available to ${state.agent}`, toolCall: call });
    const reasons = [...approvals, ...this.#approvalReasons(state.agentSpec, call.name)];
    if (reasons.length > 0) {
      await this.#createOperation(call, execution, reasons, state);
      state.retryTool = undefined;
      return state.completion;
    }
    const ended = await this.#runTool(entry, call, execution, state);
    state.retryTool = undefined;
    return ended;
  }

  /**
   * Turns one call into an approval operation: the host captures its context, the runtime stores the
   * operation and the pending tool result, announces the operation and asks the host for a decision.
   */
  async #createOperation(call: ToolCall, execution: Record<string, Json> | undefined, reasons: string[], state: TurnState): Promise<void> {
    const operationId = this.#id();
    const request: ApprovalRequest = {
      operationId, sessionId: state.sessionId, turnId: state.turnId, agent: state.agent,
      instance: state.instance, parentInstance: state.parentInstance, parentTurnId: state.parentTurnId,
      rootTurnId: state.rootTurnId,
      toolCall: structuredClone(call), reasons: [...reasons],
    };
    // A failed capture stores neither the operation nor the pending tool result.
    const context = await this.#captureContext(request, call);
    const operation = newOperation({
      operationId, agent: state.agent, sessionId: state.sessionId, turnId: state.turnId,
      instance: state.instance, parentInstance: state.parentInstance, parentTurnId: state.parentTurnId,
      rootTurnId: state.rootTurnId, toolCall: call, reasons, execution, context, now: this.#now(),
    });
    await this.#operationStore.save(operation);
    // The pending tool result is the runtime's own value, so the toolResult hooks never see it. The
    // JSON part and the `meta` carry equal but separate values, so neither can change the other.
    const message: Message = {
      id: this.#id(), role: "tool", source: "tool",
      content: [{ type: "tool.result", callId: call.id, content: [{ type: "json", value: pendingToolContent(operationId) }] }],
      meta: pendingToolContent(operationId),
    };
    state.conversation.push(message); await this.#append(state, [message]);
    state.storedCalls.add(call.id);
    await this.#emit("humanApproval.created", state, { operationId, tool: call.name, callId: call.id, reasons: [...reasons] });
    const host = this.#bindings.host;
    if (!host?.requestApproval) return;
    // A failed request leaves the operation pending, so recovery asks for the decision again.
    try { await host.requestApproval({ ...request, toolCall: structuredClone(call), reasons: [...reasons] }); }
    catch (error) { throw new GoondanExecutionError({ where: "tool", codes: ["runtime_error"], message: reason(error), toolCall: call }, { cause: error }); }
  }

  /** The operation context the host captured, or `undefined` when the host captures none. */
  async #captureContext(request: ApprovalRequest, call: ToolCall): Promise<Record<string, Json> | undefined> {
    const host = this.#bindings.host;
    if (!host?.captureOperationContext) return undefined;
    let captured: unknown;
    try { captured = await host.captureOperationContext(request); }
    catch (error) { throw new GoondanExecutionError({ where: "tool", codes: ["runtime_error"], message: reason(error), toolCall: call }, { cause: error }); }
    if (captured === undefined || captured === null) return undefined;
    let value: Json | undefined;
    try { value = isObject(captured) ? this.#json(captured, "the captured operation context") : undefined; }
    catch { value = undefined; }
    if (!isJsonObject(value)) throw new GoondanExecutionError({ where: "tool", codes: ["runtime_error"], message: "captureOperationContext did not return a JSON object", toolCall: call });
    return value;
  }

  /** Records a conditional transition; a closed runtime leaves every stored operation as it is. */
  async #transition(operation: PendingOperation, from: OperationStatus[], update: OperationUpdate): Promise<PendingOperation | undefined> {
    if (this.#closed) return undefined;
    return await this.#operationStore.transition(operation.sessionId, operation.operationId, from, { ...update, updatedAt: this.#now() });
  }

  /** Records that an approved operation did not pass its pre-run validation and delivers the failure. */
  async #failValidation(operation: PendingOperation, message: string): Promise<void> {
    const failed = await this.#transition(operation, ["approved"], { status: "failed", error: message, errorCode: "validation_failed" });
    if (failed) this.#startDelivery(failed);
  }

  /** Starts an approved operation's execution as background work; one execution per operation. */
  #startOperation(operation: PendingOperation): void {
    if (this.#closed || this.#operationExecutions.has(operation.operationId)) return;
    const execution = this.#executeOperation(operation).finally(() => { this.#operationExecutions.delete(operation.operationId); });
    this.#operationExecutions.set(operation.operationId, execution);
    this.#track(execution);
  }

  /** 승인 작업의 에이전트를 찾고 선언되지 않은 이름이면 검증 실패로 기록합니다. */
  async #executeOperation(operation: PendingOperation): Promise<void> {
    const current = await this.#operationStore.get(operation.sessionId, operation.operationId);
    if (!current || current.status !== "approved") return;
    const spec = this.loaded.config.agents[current.agent];
    if (!spec) { await this.#failValidation(current, `Unknown agent: ${current.agent}`); return; }
    await this.#runOperation(current, current.agent, spec);
  }

  /**
   * Runs an approved operation in the runtime that owns its agent, detached from the conversation.
   * Everything the tool needs is resolved before the operation becomes `running`, so a failure of the
   * preparation is a validation failure and never reaches the tool.
   */
  async #runOperation(operation: PendingOperation, agent: string, spec: AgentSpec): Promise<void> {
    const scope: RunScope = { host: null, foreground: false };
    const registration = this.#register(scope);
    const stateful = spec.stateful !== false;
    let state: TurnState | undefined;
    try {
      const call = effectiveCall(operation);
      let entry: ToolEntry | undefined;
      try {
        const instance = operation.instance;
        const conversation = stateful ? await this.#store.load(operation.sessionId, agent) : [];
        const extensions = await this.#extensions(agent, spec, operation.sessionId, instance, stateful);
        state = this.#state(agent, instance, spec, [], operation.sessionId, operation.turnId, {
          parentInstance: operation.parentInstance,
          parentTurnId: operation.parentTurnId,
          rootTurnId: operation.rootTurnId,
        }, conversation, registration.signal, scope, extensions, []);
        state.operationInput = { type: "operation_execution", operationId: operation.operationId };
        // An operation execution is not an agent run, so `execution.complete` cannot end one.
        state.operation = true;
        entry = this.#tools(state).find((candidate) => candidate.name === call.name);
      } catch (error) { await this.#failValidation(operation, reason(error)); return; }
      if (!state || !entry) { await this.#failValidation(operation, `Tool ${call.name} is not available to ${operation.agent}`); return; }
      const host = this.#bindings.host;
      if (host?.validateOperation) {
        let valid: unknown;
        try { valid = await host.validateOperation(structuredClone(operation)); }
        catch (error) { await this.#failValidation(operation, reason(error)); return; }
        if (valid !== true) { await this.#failValidation(operation, validationFailedMessage); return; }
      }
      const running = await this.#transition(operation, ["approved"], { status: "running" });
      // An operation cancelled before this transition never runs its tool.
      if (!running) return;
      await this.#runOperationTool(running, state, entry, call);
    } finally {
      registration.release();
      if (!stateful && state) {
        state.asyncController.abort();
        await disposeAll(state.extensions);
        state.pending.clear();
      }
    }
  }

  /** Runs a `running` operation's tool and its `toolResult` stage, then records what it produced. */
  async #runOperationTool(operation: PendingOperation, state: TurnState, entry: ToolEntry, call: ToolCall): Promise<void> {
    const data: Record<string, Json> = { tool: call.name, callId: call.id, args: call.args, operationId: operation.operationId };
    try {
      await this.#emit("tool.start", state, { ...data });
      const raw = await entry.execute(call.args, {
        input: state.operationInput ?? state.input, conversation: structuredClone(state.conversation), agent: operation.agent,
        sessionId: operation.sessionId, turnId: operation.turnId, toolCall: call,
        execution: operation.execution ?? {}, signal: state.signal,
        // An approved operation's execution has its own lifetime, so its sub-runs record nothing.
        agents: { run: (name, value) => this.#runAgent(name, this.#toMessages(value, name), { sessionId: `${operation.sessionId}#${operation.turnId}#${name}`, signal: state.signal, foreground: false, lineage: this.#childLineage(state) }, state.scope, detachedSink("tool")) },
      });
      const result = this.#toolResult(await this.#pipeline("toolResult", this.#checkToolResult(raw, call.id), state, call.id));
      await this.#emit("tool.done", state, { ...data, result: this.#json(result, "toolResult") });
      const completed = await this.#transition(operation, ["running"], { status: "completed", result });
      if (completed) this.#startDelivery(completed);
    } catch (error) {
      const message = reason(error);
      await this.#emit("tool.error", state, { ...data, error: message, codes: ["tool_error"] });
      const failed = await this.#transition(operation, ["running"], { status: "failed", error: message, errorCode: "execution_failed" });
      if (failed) this.#startDelivery(failed);
    }
  }

  /**
   * Starts the single completion delivery of a terminal operation as background work. A decision, a
   * cancellation and an execution never wait for it.
   */
  #startDelivery(operation: PendingOperation): void {
    if (this.#closed || !isTerminalStatus(operation.status) || operation.deliveryStatus === "delivered") return;
    if (this.#deliveries.has(operation.operationId)) return;
    const work = this.#deliverOperation(operation).finally(() => { this.#deliveries.delete(operation.operationId); });
    this.#deliveries.set(operation.operationId, work);
    this.#track(work);
  }

  /**
   * Delivers one completion input. A failure only puts the delivery back to `pending`, leaving the
   * outcome of the operation untouched, and is never reported to the request that started it.
   */
  async #deliverOperation(operation: PendingOperation): Promise<void> {
    if (this.#closed || !isTerminalStatus(operation.status)) return;
    const claimed = await this.#operationStore.claimDelivery(operation.sessionId, operation.operationId, this.#now());
    if (!claimed || !isTerminalStatus(claimed.status)) return;
    const completion = completionInput(claimed, claimed.status);
    try {
      const host = this.#bindings.host;
      if (host?.deliverOperationCompletion) await host.deliverOperationCompletion(completion);
      else await this.#deliverByTurn(claimed, completion);
      await this.#transition(claimed, [claimed.status], { deliveryStatus: "delivered", deliveredAt: this.#now() });
    } catch (error) {
      this.#bindings.logger?.warn(`The completion delivery of the operation ${claimed.operationId} failed`, { error: reason(error) });
      if (this.#closed) return;
      await this.#operationStore.releaseDelivery(claimed.sessionId, claimed.operationId, claimed.deliveryId, this.#now());
    }
  }

  /** Delivers a completion by running the operation's agent once the conversation has no other turn. */
  async #deliverByTurn(operation: PendingOperation, completion: OperationCompletion): Promise<void> {
    await this.#enqueueRun(this.#json(completion, "the operation completion"), { sessionId: operation.sessionId, agent: operation.agent }, {
      parentInstance: operation.instance,
      parentTurnId: operation.turnId,
      rootTurnId: operation.rootTurnId,
    });
  }

  /**
   * Runs one tool of an agent run and stores its result through the `toolResult` stage. Every attempt
   * announces `tool.start` and then exactly one of `tool.done` and `tool.error`, so a failed form
   * check and a failed required `toolResult` hook are announced with their own codes as well.
   */
  async #runTool(entry: ToolEntry, call: ToolCall, execution: Record<string, Json> | undefined, state: TurnState): Promise<Message | undefined> {
    // An execution that was told to stop starts no further tool.
    if (state.signal.aborted) throw abortFailure();
    const data: Record<string, Json> = { tool: call.name, callId: call.id, args: call.args };
    await this.#emit("tool.start", state, { ...data });
    let result: ToolResult;
    try {
      result = await entry.execute(call.args, {
        input: state.input, conversation: structuredClone(state.conversation), agent: state.agent,
        sessionId: state.sessionId, turnId: state.turnId, toolCall: call,
        execution: execution ?? {}, signal: state.signal,
        agents: { run: (name, value) => this.#runAgent(name, this.#toMessages(value, name), { sessionId: `${state.sessionId}#${state.turnId}#${name}`, signal: state.signal, foreground: false, lineage: this.#childLineage(state) }, { host: state.scope.host, foreground: false }, this.#sink(state, "tool")) },
      });
      // A result that arrives after the abort was signalled is not used.
      if (state.signal.aborted) throw abortFailure();
    } catch (error) {
      // A configuration error of an extension preparation never becomes a tool failure, but the
      // attempt still ends, so it announces the tool.error its tool.start expects.
      if (isGoondanConfigError(error)) { await this.#emit("tool.error", state, { ...data, error: reason(error), codes: error.issues.map((issue) => issue.code) }); throw error; }
      // An agent tool whose target run was stopped stays an abort instead of becoming a tool failure.
      const carried = carriesAbort(error);
      const aborted = carried || state.signal.aborted;
      const message = reason(error);
      await this.#emit("tool.error", state, { ...data, error: message, codes: aborted ? ["aborted"] : ["tool_error"] });
      if (carried) throw error;
      throw aborted ? abortFailure(error) : new GoondanExecutionError({ where: "tool", codes: ["tool_error"], message, toolCall: call }, { cause: error });
    }
    let finalResult: ToolResult;
    try {
      finalResult = await this.#appendToolResult(this.#checkToolResult(result, call.id), state, call.id);
    } catch (error) {
      // A configuration error of an extension preparation never becomes a tool result failure, but
      // the attempt still ends, so it announces the tool.error its tool.start expects.
      if (isGoondanConfigError(error)) { await this.#emit("tool.error", state, { ...data, error: reason(error), codes: error.issues.map((issue) => issue.code) }); throw error; }
      // The successful tool is never run again, so the failure keeps the location it happened at.
      const failure = error instanceof GoondanExecutionError
        ? error
        : new GoondanExecutionError({ where: "toolResult", codes: ["hook_error"], message: reason(error) }, { cause: error });
      await this.#emit("tool.error", state, { ...data, error: failure.message, codes: [...failure.codes] });
      throw failure;
    }
    await this.#emit("tool.done", state, { ...data, result: this.#json(finalResult, "toolResult") });
    if (state.completion) return state.completion;
    return undefined;
  }

  /** Checks the form a tool implementation returned before the `toolResult` hooks see it. */
  #checkToolResult(result: ToolResult, callId: string): ToolResult {
    const issue = stageValueIssue("toolResult", result, callId);
    if (issue) throw new GoondanExecutionError({ where: "toolResult", codes: ["value_invalid"], message: issue });
    return result;
  }

  #toolResult(stage: StageRun): ToolResult {
    if (!isToolResult(stage.value)) throw new GoondanExecutionError({ where: "toolResult", codes: ["value_invalid"], message: "the toolResult value is not a tool result" });
    return stage.value;
  }

  /** Runs the `toolResult` stage and stores the tool result message it produced. */
  async #appendToolResult(result: ToolResult, state: TurnState, callId: string): Promise<ToolResult> {
    const transformed = this.#toolResult(await this.#pipeline("toolResult", result, state, callId));
    const part: Part = transformed.isError === undefined
      ? { type: "tool.result", callId: transformed.callId, content: transformed.content }
      : { type: "tool.result", callId: transformed.callId, content: transformed.content, isError: transformed.isError };
    const message: Message = { id: this.#id(), role: "tool", source: "tool", content: [part] };
    if (transformed.keep !== undefined) message.keep = transformed.keep;
    if (transformed.meta !== undefined) message.meta = transformed.meta;
    state.conversation.push(message); await this.#append(state, [message]);
    state.storedCalls.add(callId);
    return transformed;
  }

  /**
   * Runs the hooks of one value processing stage in declaration order. The result of a synchronous
   * hook becomes the current value of the next one, and a `{result}` or `{retry}` control result
   * leaves the remaining hooks of the stage unrun.
   */
  async #pipeline(name: ValueName, initial: PipelineValue, state: TurnState, callId?: string): Promise<StageRun> {
    const run: StageRun = { value: initial, approvals: [] };
    for (const spec of state.agentSpec.hooks?.[name] ?? []) {
      // An execution that was told to stop starts no further hook.
      if (state.signal.aborted) throw abortFailure();
      const identifier = inlineHookIdentifier(spec, this.loaded.directory) ?? name;
      if (spec.mode === "async") { await this.#schedule(name, spec, state, identifier, run.value); continue; }
      try {
        const received = await this.#received(name, spec, state, run.value);
        if (spec.when) {
          const decision = await this.#callFunction(spec.when.fn, received);
          if (typeof decision !== "boolean") throw new Error(`The hook condition ${spec.when.fn} must return true or false`);
          if (!decision) { await this.#emit("hook.skipped", state, { value: name, hook: identifier }); continue; }
        }
        const result = await this.#invoke(name, spec, state, identifier, received, false, this.#conversationOf(name, state, run.value));
        // A result that arrives after the abort was signalled is not used.
        if (state.signal.aborted) throw abortFailure();
        this.#applyResult(name, run, result, state, callId);
        await this.#emit("hook.applied", state, { value: name, hook: identifier });
      } catch (error) {
        // A configuration error of an extension preparation is never a hook failure.
        if (isGoondanConfigError(error)) throw error;
        // An abort is never swallowed by an optional hook and never announced as a hook failure.
        if (state.signal.aborted) throw abortFailure(error);
        await this.#emit("hook.failed", state, { value: name, hook: identifier, error: reason(error) });
        // Only an inline hook that declares `agent` is optional without saying so.
        if (!(spec.optional ?? spec.agent !== undefined)) throw new GoondanExecutionError({ where: name, codes: ["hook_error"], message: reason(error) }, { cause: error });
      }
      if (run.result !== undefined || run.retry !== undefined) return run;
    }
    return run;
  }

  /** The value one hook receives, following its `using`. Every hook gets a copy. */
  async #received(name: ValueName, spec: InlineHookSpec, state: TurnState, current: PipelineValue): Promise<Json> {
    if (spec.using === "input") return this.#json(state.input, name);
    // Inside the conversation stage `using: conversation` sees the appends of the earlier hooks.
    if (spec.using === "conversation") return this.#json(name === "conversation" ? current : state.conversation, name);
    if (isObject(spec.using)) return await this.#callFunction(spec.using.fn, this.#json(current, name));
    return this.#json(current, name);
  }

  /** The conversation a hook context carries: the stage's current value inside the conversation stage. */
  #conversationOf(name: ValueName, state: TurnState, current: PipelineValue): Message[] {
    return structuredClone(name === "conversation" && isMessageArray(current) ? current : state.conversation);
  }

  /** Applies one synchronous hook result to the stage, or reports why the result is not usable. */
  #applyResult(name: ValueName, run: StageRun, result: HookResult, state: TurnState, callId: string | undefined): void {
    // A result that is null or absent leaves the current value unchanged.
    if (result === undefined || result === null) return;
    // A hook result is a JSON value; anything else fails the hook.
    const value = this.#json(result, "the hook result");
    const control = controlResult(name, value, callId);
    if (control !== undefined) {
      if (isControlIssue(control)) throw new Error(control.issue);
      this.#applyControl(name, run, control, state);
      return;
    }
    const issue = stageValueIssue(name, value, callId);
    if (issue) throw new Error(issue);
    run.value = value;
  }

  #applyControl(name: ValueName, run: StageRun, control: ControlResult, state: TurnState): void {
    if (control.kind === "append") { run.value = this.#applyAppend(name, run.value, control.messages); return; }
    // A later `execution` replaces the value an earlier hook attached.
    if (control.kind === "call") { run.value = control.call; if (control.execution !== undefined) run.execution = control.execution; return; }
    if (control.kind === "approval") { run.approvals.push(control.reason); return; }
    if (control.kind === "result") { run.result = control.result; return; }
    // A modelResult hook that asks for a retry beyond the limit fails.
    if (name === "modelResult" && state.retryCount >= this.#retryLimit()) throw new Error("this agent run already reached its retry limit");
    run.retry = control.afterMs === undefined ? { target: control.target } : { target: control.target, afterMs: control.afterMs };
  }

  #applyAppend(name: ValueName, current: PipelineValue, messages: Message[]): PipelineValue {
    if (name === "conversation" && isMessageArray(current)) return [...current, ...appendMessages(current, messages)];
    if (name === "modelInput" && isModelInput(current)) return { ...current, messages: [...current.messages, ...appendMessages(current.messages, messages)] };
    throw new Error(`an append result is not allowed for the ${name} value`);
  }

  /** Schedules an asynchronous conversation hook, which never holds up the stage it belongs to. */
  async #schedule(name: ValueName, spec: InlineHookSpec, state: TurnState, identifier: string, current: PipelineValue): Promise<void> {
    let received: Json;
    try {
      received = await this.#received(name, spec, state, current);
      if (spec.when) {
        const decision = await this.#callFunction(spec.when.fn, received);
        if (typeof decision !== "boolean") throw new Error(`The hook condition ${spec.when.fn} must return true or false`);
        if (!decision) { await this.#emit("hook.skipped", state, { value: name, hook: identifier }); return; }
      }
    } catch (error) {
      await this.#emit("hook.failed", state, { value: name, hook: identifier, error: reason(error) });
      return;
    }
    // One task per identifier and execution scope: a repeat while one is pending is not scheduled.
    if (state.pending.has(identifier)) return;
    // The task keeps the conversation of the moment it was scheduled, with the earlier hooks applied.
    const conversation = this.#conversationOf(name, state, current);
    const task: AsyncHookTask = { settled: false, promise: Promise.resolve() };
    task.promise = (async (): Promise<void> => {
      try {
        const result = await this.#invoke(name, spec, state, identifier, received, true, conversation);
        if (state.asyncController.signal.aborted) return;
        if (result !== undefined && result !== null) {
          const control = controlResult("conversation", this.#json(result, "the hook result"));
          if (control === undefined || isControlIssue(control) || control.kind !== "append") throw new Error("an asynchronous hook returns an append result, null or nothing");
          task.messages = control.messages;
        }
        await this.#emit("hook.applied", state, { value: name, hook: identifier });
      } catch (error) {
        task.messages = undefined;
        if (!state.asyncController.signal.aborted) await this.#emit("hook.failed", state, { value: name, hook: identifier, error: reason(error) });
      } finally { task.settled = true; }
    })();
    state.pending.set(identifier, task);
    this.#track(task.promise);
  }

  /**
   * Runs one hook body, honouring its `timeout`. The body is told to stop when the limit elapses or
   * the execution is aborted, and the result it returns afterwards is not used.
   */
  async #invoke(name: ValueName, spec: InlineHookSpec, state: TurnState, identifier: string, received: Json, asynchronous: boolean, conversation: Message[]): Promise<HookResult> {
    const controller = new AbortController();
    const parent = asynchronous ? state.asyncController.signal : state.signal;
    const stop = (): void => { controller.abort(); };
    if (parent.aborted) controller.abort(); else parent.addEventListener("abort", stop, { once: true });
    const active = { value: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const body = this.#body(name, spec, state, identifier, controller.signal, asynchronous, conversation, active);
      const timeout = spec.timeout;
      if (timeout === undefined) return await body(received);
      return await new Promise<HookResult>((resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error(`The hook did not finish within ${String(timeout)}ms`)); }, timeout);
        body(received).then(resolve, reject);
      });
    } finally {
      active.value = false;
      if (timer !== undefined) clearTimeout(timer);
      parent.removeEventListener("abort", stop);
    }
  }

  /** The body of one hook: an extension's stage function, or the inline `fn`, `agent`, `template` chain. */
  #body(name: ValueName, spec: InlineHookSpec, state: TurnState, identifier: string, signal: AbortSignal, asynchronous: boolean, conversation: Message[], active: { value: boolean }): (received: Json) => Promise<HookResult> {
    if (spec.extension) {
      const hook = state.extensions.get(spec.extension)?.hooks?.[name];
      if (!hook) throw new Error(`The ${spec.extension} extension provides no ${name} hook`);
      const context = this.#hookContext(state, identifier, name, asynchronous, signal, conversation, active);
      return async (received) => await hook(received, context);
    }
    return async (received) => {
      let value: Json = received;
      if (spec.fn) {
        value = await this.#callFunction(spec.fn, value);
        // A function that answered with nothing ends the hook without a result.
        if (value === null) return undefined;
      }
      if (spec.agent) {
        const names = Array.isArray(spec.agent) ? spec.agent : [spec.agent];
        // Every agent starts in declaration order and the hook waits for all of them, failing when one did.
        const sink = this.#sink(state, "hook", asynchronous);
        const settled = await Promise.allSettled(names.map((target) => this.#runAgent(target, this.#toMessages(value, target), { sessionId: this.#derivedSession(state, target), signal, foreground: false, lineage: this.#childLineage(state) }, { host: state.scope.host, foreground: false }, sink)));
        const outputs: string[] = [];
        for (const outcome of settled) {
          if (outcome.status === "rejected") continue;
          outputs.push(textOf(outcome.value.output.content));
        }
        const rejected = settled.find((outcome) => outcome.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason instanceof Error ? rejected.reason : new Error(reason(rejected.reason));
        value = outputs.join("\n");
      }
      if (spec.template) value = this.#renderer.render(spec.template, { text: value, input: this.#json(state.input, "input"), inputText: inputTextOf(state.input), params: state.agentSpec.params ?? {} });
      // The inline result becomes a message only at the stages that take one; elsewhere it is the result.
      if (name !== "conversation" && name !== "modelInput" && name !== "output") return value;
      const text = typeof value === "string" ? value : jsonText(value);
      if (name === "output") return this.#message(identifier, "assistant", text, state.turnId, ++state.messageNumber);
      return { append: [this.#message(identifier, spec.role ?? "user", text, state.turnId, ++state.messageNumber)] };
    };
  }

  #derivedSession(state: TurnState, target: string): string { return `${state.sessionId}#${state.turnId}#${target}`; }

  #hookContext(state: TurnState, source: string, phase: ValueName, asynchronous: boolean, signal: AbortSignal, conversation: Message[], active: { value: boolean }): HookContext {
    const make = (role: "user" | "system", text: string, extra?: MessageExtra): Message => {
      const message = this.#message(source, role, text, state.turnId, ++state.messageNumber);
      if (extra?.key !== undefined) message.key = extra.key;
      if (extra?.keep !== undefined) message.keep = extra.keep;
      if (extra?.meta !== undefined) message.meta = extra.meta;
      return message;
    };
    return {
      execution: { complete: (output) => { this.#complete(state, output, phase, asynchronous, active); } },
      agent: state.agent, sessionId: state.sessionId, turnId: state.turnId,
      step: state.step || undefined, retryCount: state.retryCount,
      input: structuredClone(state.input), conversation, signal,
      agents: { run: async (name, value) => await this.#runAgent(name, this.#toMessages(value, name), { sessionId: this.#derivedSession(state, name), signal, foreground: false, lineage: this.#childLineage(state) }, { host: state.scope.host, foreground: false }, this.#sink(state, "hook", asynchronous)) },
      model: { run: async (messages) => await this.#runModel(state, messages, signal, asynchronous) },
      render: async (template, variables) => this.#renderer.render(template, variables),
      message: { user: (text, extra) => make("user", text, extra), system: (text, extra) => make("system", text, extra) },
      append: (...items) => ({ append: items }),
      log: this.#bindings.logger ?? noLog,
    };
  }

  /** Schedules the final assistant message of the current agent run; see `execution.complete`. */
  #complete(state: TurnState, output: Message, phase: ValueName, asynchronous: boolean, active: { value: boolean }): void {
    if (asynchronous || phase !== "toolResult") throw new Error("execution.complete belongs to a synchronous toolResult hook");
    if (!active.value) throw new Error("execution.complete cannot be called once the hook has returned");
    if (!isMessage(output) || output.role !== "assistant") throw new Error("execution.complete requires an assistant message");
    if (state.completion) throw new Error("this agent run already scheduled a message");
    // An approved operation's execution is not an agent run, so a correct call has no effect.
    if (state.operation) return;
    state.completion = structuredClone(output);
  }

  /**
   * One model call from a hook: no stage hooks, nothing stored and no tool call executed. A call a
   * synchronous hook made records a `model` entry in the turn; a failed call records zero usage.
   */
  async #runModel(state: TurnState, messages: Message[], signal: AbortSignal, asynchronous: boolean): Promise<ModelResult> {
    if (!isMessageArray(messages)) throw new Error("model.run requires an array of messages");
    const sink = this.#sink(state, "model", asynchronous);
    const base = this.#baseModelInput(state);
    const input: ModelInput = { system: base.system, messages: structuredClone(messages), tools: base.tools, options: {} };
    let result: ModelResult;
    try {
      // The call carries the number of the last model call the run started, and announces no text chunk.
      result = this.#modelResult(await this.#model(state.agentSpec).generate(structuredClone(input), { agent: state.agent, sessionId: state.sessionId, turnId: state.turnId, step: state.step, signal, onTextDelta() { /* 훅의 모델 호출은 텍스트 델타를 알리지 않습니다. */ } }));
    } catch (error) {
      recordModelCall(sink, state.agent, state.instance, state.turnId, {
        parentInstance: state.parentInstance,
        parentTurnId: state.parentTurnId,
        rootTurnId: state.rootTurnId,
      });
      throw error;
    }
    const usage = zeroUsage();
    addUsage(usage, result.usage);
    recordModelCall(sink, state.agent, state.instance, state.turnId, {
      parentInstance: state.parentInstance,
      parentTurnId: state.parentTurnId,
      rootTurnId: state.rootTurnId,
    }, { usage, finishReason: result.finishReason });
    return result;
  }
  /** Appends messages unless the run was aborted; an aborted run stores nothing more. */
  async #append(state: TurnState, messages: Message[]): Promise<void> { if (state.signal.aborted || messages.length === 0 || state.agentSpec.stateful === false) return; await this.#store.append(state.sessionId, state.agent, messages); }
  async #replace(state: TurnState): Promise<void> { if (state.signal.aborted || state.agentSpec.stateful === false) return; await this.#store.replace(state.sessionId, state.agent, state.conversation); }
  /**
   * Applies the results of the asynchronous hooks that have finished, in the order they were
   * scheduled. A task that is still running stays in the map and is looked at again at the next
   * safe conversation point. The runtime never waits for one.
   */
  async #drainPending(state: TurnState): Promise<void> {
    for (const [identifier, task] of [...state.pending]) {
      if (!task.settled) continue;
      state.pending.delete(identifier);
      const messages = task.messages;
      if (!messages || messages.length === 0) continue;
      const added = appendMessages(state.conversation, messages);
      if (added.length === 0) continue;
      state.conversation.push(...added);
      await this.#append(state, added);
    }
  }
  /** 호스트가 보낸 실행 중 입력을 해당 흐름 실행의 대화에 추가합니다. */
  async #drainSteering(state: TurnState): Promise<void> {
    const host = state.scope.host;
    if (!state.scope.foreground || host === null) return;
    const queue = this.#queuedInput.get(host);
    if (!queue?.length) return;
    const accepted = queue.filter((item) => item.agent === undefined || item.agent === state.agent);
    const remaining = queue.filter((item) => item.agent !== undefined && item.agent !== state.agent);
    if (remaining.length === 0) this.#queuedInput.delete(host); else this.#queuedInput.set(host, remaining);
    const messages = accepted.map((item) => this.#message("user", "user", typeof item.value === "string" ? item.value : jsonText(item.value), state.turnId, ++state.messageNumber));
    state.conversation.push(...messages);
    await this.#append(state, messages);
  }
  /**
   * Calls a host function with a copy of one JSON value. A function that returns nothing returned
   * `null`, and a value that is not JSON fails the call.
   */
  async #callFunction(name: string, value: Json): Promise<Json> {
    const fn: GoondanFunction | undefined = this.#bindings.functions?.[name];
    if (!fn) throw new Error(`Unknown function: ${name}`);
    return this.#json(await fn(this.#json(value, name)), `the result of the function ${name}`);
  }
  /**
   * Announces one event of a run. Deliveries of the same run are chained, so every receiver sees the
   * events in the order they happened even when a `step.textDelta` delivery is not awaited.
   */
  async #emit(name: RuntimeEventName, state: TurnState, data: Record<string, Json>): Promise<void> {
    const event: RuntimeEvent = {
      name, agent: state.agent, sessionId: state.sessionId, turnId: state.turnId,
      instance: state.instance, parentInstance: state.parentInstance, parentTurnId: state.parentTurnId,
      rootTurnId: state.rootTurnId, at: Date.now(), data,
    };
    const delivery = state.emitting.then(() => this.#deliver(event, state.extensions));
    state.emitting = delivery;
    await delivery;
  }
  /**
   * Delivers one event to the host of the runtime the host created and then to the extension
   * instances of the run's scope, in creation order. A receiver failure is ignored.
   */
  async #deliver(event: RuntimeEvent, extensions: ReadonlyMap<string, ExtensionInstance>): Promise<void> {
    const host = this.#bindings.host;
    if (host?.emit) { try { await host.emit(event); } catch { /* A failed receiver never stops the run. */ } }
    for (const instance of extensions.values()) {
      const handler = instance.on?.[event.name];
      if (!handler) continue;
      try { await handler(event); } catch { /* A failed receiver never stops the run. */ }
    }
  }
  #message(source: string, role: "user" | "system" | "assistant", text: string, turnId: string, number: number): Message { return { id: `${turnId}:${String(number)}:${this.#id()}`, role, source, content: [{ type: "text", text }] }; }
  #messageWithParts(source: string, content: Part[]): Message { return { id: this.#id(), role: "user", source, content: structuredClone(content) }; }
  #toMessages(input: RunInput, source: string): Message[] {
    if (isMessageArray(input)) return structuredClone(input);
    if (isPartArray(input)) return [this.#messageWithParts(source, input)];
    const value = this.#json(input, "run input");
    if (typeof value === "string") return [this.#messageWithParts(source, [{ type: "text", text: value }])];
    return [this.#messageWithParts(source, [{ type: "json", value }])];
  }
  #hostSession(sessionId: string): void {
    if (sessionId.includes("#")) throw new GoondanExecutionError({ where: "runtime", codes: ["runtime_error"], message: "A host sessionId cannot contain #" });
  }
  #steerFailure(message: string): GoondanExecutionError {
    return new GoondanExecutionError({ where: "runtime", codes: ["steer_invalid"], message });
  }
  #markForeground(state: TurnState): void {
    const sessionId = state.scope.host;
    if (!state.scope.foreground || sessionId === null) return;
    const agents = this.#foregroundAgents.get(sessionId) ?? new Map<string, number>();
    agents.set(state.agent, (agents.get(state.agent) ?? 0) + 1);
    this.#foregroundAgents.set(sessionId, agents);
  }
  #unmarkForeground(state: TurnState): void {
    const sessionId = state.scope.host;
    if (!state.scope.foreground || sessionId === null) return;
    const agents = this.#foregroundAgents.get(sessionId); if (!agents) return;
    const count = (agents.get(state.agent) ?? 1) - 1;
    if (count === 0) agents.delete(state.agent); else agents.set(state.agent, count);
    if (agents.size === 0) this.#foregroundAgents.delete(sessionId);
  }
  async #deleteSession(sessionId: string): Promise<void> {
    this.#hostSession(sessionId);
    if (this.#closed) throw closedFailure();
    if ((this.#turnCounts.get(sessionId) ?? 0) > 0) throw new GoondanExecutionError({ where: "runtime", codes: ["runtime_error"], message: "The session has a running or queued turn" });
    for (const [key, instances] of [...this.#instances]) {
      const parsed: unknown = JSON.parse(key);
      if (!Array.isArray(parsed) || typeof parsed[0] !== "string") continue;
      if (parsed[0] !== sessionId && !parsed[0].startsWith(`${sessionId}#`)) continue;
      await disposeAll(instances); this.#instances.delete(key); this.#pendingHooks.delete(key);
    }
    for (const [key, controller] of [...this.#asyncControllers]) {
      const parsed: unknown = JSON.parse(key);
      if (!Array.isArray(parsed) || typeof parsed[0] !== "string") continue;
      if (parsed[0] !== sessionId && !parsed[0].startsWith(`${sessionId}#`)) continue;
      controller.abort();
      this.#asyncControllers.delete(key);
      this.#pendingHooks.delete(key);
    }
    this.#queuedInput.delete(sessionId);
    await this.#store.deleteSession(sessionId);
  }
  #id(): string { return globalThis.crypto.randomUUID(); }
  #now(): number { return Date.now(); }
  /** The declared agent of this configuration; an inherited object key never names one. */
  #agent(name: string): AgentSpec {
    const spec = Object.hasOwn(this.loaded.config.agents, name) ? this.loaded.config.agents[name] : undefined;
    if (!spec) throw new Error(`Unknown agent: ${name}`);
    return spec;
  }
  /** Narrows a host value to JSON. An object member that is `undefined` is left out, as in JSON. */
  #json(value: unknown, at: string): Json { if (value === undefined) return null; if (value === null || typeof value === "string" || typeof value === "boolean") return value; if (typeof value === "number" && Number.isFinite(value)) return value; if (Array.isArray(value)) return value.map((item) => this.#json(item, at)); if (isObject(value)) { const result: Record<string, Json> = {}; for (const [key, child] of Object.entries(value)) { if (child === undefined) continue; result[key] = this.#json(child, at); } return result; } throw new Error(`${at} is not JSON serializable`); }
  #jsonRecord(value: Record<string, unknown>): Record<string, Json> { const result: Record<string, Json> = {}; for (const [key, child] of Object.entries(value)) result[key] = this.#json(child, key); return result; }
}

/**
 * `loadConfig` 결과나 구성 문서에서 군단 객체를 만듭니다. 스키마, 참조, 바인딩 검증을 먼저
 * 수행하므로 유효하지 않은 구성으로 실행 엔진을 시작하지 않습니다.
 */
export function createGoondan(config: LoadedConfig | unknown, bindings: RuntimeBindings): Goondan { return new Goondan(config, bindings); }
