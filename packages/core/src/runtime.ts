import { bindingIssues, enabledExtensions, instanceIssues, toolEntry, type ProvidedExtension } from "./binding.ts";
import { prepareRuntimeConfig } from "./config.ts";
import { GoondanConfigError, GoondanExecutionError, raiseIssues } from "./errors.ts";
import { fold, JOURNAL_VERSION } from "./fold.ts";
import { inlineHookIdentifier } from "./effective.ts";
import { compareText, isRecord, jsonEqual, jsonText, jsonType, ownKeys, toJson } from "./json.ts";
import {
  approvalReason, decisionIssue, effectiveCall, interruptedMessage, isTerminalStatus,
  newOperation, patchIssue, patchedCall, pendingToolContent, validationFailedMessage,
} from "./operation.ts";
import { addUsage, failRun, finishRun, flattenRuns, startRun, totalUsage, zeroUsage, type RunNode, type RunSink } from "./runs.ts";
import { validateJsonValue } from "./schema.ts";
import {
  appendMessages, controlResult, inputTextOf, isControlIssue, isMessage, isMessageArray,
  isModelInput, isModelResult, isPartArray, isToolCall, isToolResult, normalizeModelResponse,
  normalizeToolReturn, repairToolPairs, stageValueIssue, textOf,
} from "./stage.ts";
import { MemoryStore } from "./store.ts";
import { TemplateRenderer } from "./template.ts";
import {
  type AgentRunResult, type AgentSpec, type ExecutionContext, type ExtensionInstance,
  type FinishReason, type GoondanFunction, type HookContext, type InlineHookSpec,
  type JournalEvent, type JournalState, type Json, type LoadedConfig, type Message,
  type ModelInput, type ModelResult, type NewJournalEvent, type ObservationalEvent,
  type OperationDecision, type Part, type PendingOperation, type RouteEndpoint, type RouteSpec,
  type RunHandle, type RunInput, type RunKind, type RunOptions, type RuntimeBindings, type RuntimeEvent,
  type StoreLease, type Tool, type ToolCall, type ToolContext, type ToolDefinition,
  type ToolResult, type ToolReturn, type TurnError, type TurnResult, type Usage, type ValueName,
} from "./types.ts";

const noLog = { info() {}, warn() {}, error() {} };

function reason(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function id(): string { return globalThis.crypto.randomUUID(); }
function abortFailure(cause?: unknown): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["aborted"], message: "aborted" }, cause === undefined ? undefined : { cause });
}
function runtimeFailure(message: string, cause?: unknown): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["runtime_error"], message }, cause === undefined ? undefined : { cause });
}
function routeFailure(message: string, cause?: unknown): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["route_error"], message }, cause === undefined ? undefined : { cause });
}
function operationFailure(message: string): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["operation_invalid"], message });
}
function inputFailure(message: string): GoondanExecutionError {
  return new GoondanExecutionError({ where: "runtime", codes: ["input_invalid"], message });
}
function isJsonValue(value: unknown): value is Json {
  const kind = jsonType(value);
  if (kind === "invalid") return false;
  if (kind === "array" && Array.isArray(value)) return value.every(isJsonValue);
  if (kind === "object" && isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) =>
      typeof key === "string"
      && Object.prototype.propertyIsEnumerable.call(value, key)
      && isJsonValue(value[key]));
  }
  return true;
}
function detail(error: GoondanExecutionError, attempt: number): TurnError {
  const value: TurnError = { where: error.where, codes: [...error.codes], message: error.message, attempt };
  if (error.toolCall !== undefined) value.toolCall = structuredClone(error.toolCall);
  return value;
}
function executionFailure(where: ValueName | "model" | "tool" | "runtime", code: string, message: string, attempt: number, toolCall?: ToolCall, cause?: unknown): GoondanExecutionError {
  const failure = new GoondanExecutionError({ where, codes: [code], message, attempt, toolCall }, cause === undefined ? undefined : { cause });
  return failure;
}
function modelCodes(error: unknown): string[] {
  if (isRecord(error) && typeof error.code === "string" && error.code.length > 0) return ["model_error", error.code];
  return ["model_error"];
}

class Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
  constructor() {
    let resolveValue = (_value: T): void => undefined;
    let rejectValue = (_reason?: unknown): void => undefined;
    this.promise = new Promise<T>((resolve, reject) => { resolveValue = resolve; rejectValue = reject; });
    this.resolve = resolveValue;
    this.reject = rejectValue;
  }
}

class Mutex {
  #tail: Promise<void> = Promise.resolve();
  async run<T>(body: () => Promise<T> | T): Promise<T> {
    const before = this.#tail;
    let release = (): void => undefined;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try { return await body(); } finally { release(); }
  }
}

interface SessionRuntime {
  sessionId: string;
  mutex: Mutex;
  appendMutex: Mutex;
  leaseMutex: Mutex;
  events: JournalEvent[];
  state: JournalState;
  loaded: boolean;
  recovered: boolean;
  actors: Map<string, Actor>;
  waits: Map<string, Set<string>>;
  lease?: StoreLease;
  leaseController?: AbortController;
  leaseRenewal?: Promise<void>;
  leaseFailure?: GoondanExecutionError;
  controllers: Set<AbortController>;
  turn?: ActiveTurn;
}

type InputOrigin = "host" | "route" | "tool" | "hook" | "operation";
interface InputRequest {
  target: string;
  messages: Message[];
  origin: InputOrigin;
  kind: RunKind;
  routeIndex?: number;
  routeSource?: string;
  parentExecutionId?: string;
  operationId?: string;
  followsRoutes: boolean;
  preserveMessages?: boolean;
  waiter?: Deferred<Message>;
  turn?: ActiveTurn;
  reserved?: true;
}

interface Actor {
  agent: string;
  instance: string;
  stateful: boolean;
  queue: InputRequest[];
  running?: ExecutionGroup;
}

interface ExecutionGroup {
  turn: ActiveTurn;
  actor: Actor;
  executionId: string;
  requests: InputRequest[];
  routeRequested: boolean;
  singleOutputRequested: boolean;
  controller: AbortController;
  deferred: Deferred<AgentRunResult>;
  state?: ExecutionState;
}

interface OutputEntry { route: number; order: number; message: Message; finishReason: FinishReason }
interface ActiveTurn {
  session: SessionRuntime;
  turnId: string;
  controller: AbortController;
  deferred: Deferred<TurnResult>;
  actors: Map<string, Actor>;
  executions: Map<string, ExecutionGroup>;
  functions: Map<string, number>;
  waits: Map<string, Set<string>>;
  runs: RunNode[];
  outputs: OutputEntry[];
  outputOrder: number;
  activity: number;
  failed?: unknown;
  closing: boolean;
}

interface AsyncHookTask { sessionId: string; settled: boolean; message?: Message; promise: Promise<void>; controller: AbortController }
interface ExecutionState {
  group: ExecutionGroup;
  agent: string;
  spec: AgentSpec;
  instance: string;
  executionId: string;
  turnId: string;
  parentExecutionId?: string;
  operationId?: string;
  input: Message[];
  startInput: Message[];
  conversation: Message[];
  inputKind: "start" | "steer";
  step: number;
  retryCount: number;
  usage: Usage;
  finishReason?: FinishReason;
  completion?: Message;
  extensions: Map<string, ExtensionInstance>;
  pendingHooks: Map<string, AsyncHookTask>;
  runNode: RunNode;
}

interface HookStageResult {
  value: unknown;
  approvals: string[];
  execution?: Record<string, Json>;
  result?: ToolReturn;
  retry?: { target: "model" | "tool"; afterMs?: number };
  complete?: Message;
}

interface ToolEntry {
  name: string;
  definition: ToolDefinition;
  approval: boolean;
  host?: Tool;
  agent?: string;
}

interface EntryMessage {
  id: string;
  role: Message["role"];
  content: Part[];
  source?: string;
  key?: string;
  keep?: boolean;
  meta?: Record<string, Json>;
}

function endpointKey(endpoint: RouteEndpoint): string { return typeof endpoint === "string" ? endpoint : `@fn:${endpoint.fn}`; }
function sameEndpoint(left: RouteEndpoint, right: string): boolean { return endpointKey(left) === right; }
function scopeKey(sessionId: string, agent: string): string { return JSON.stringify([sessionId, agent]); }
function cloneMessages(messages: readonly Message[]): Message[] { return messages.map((message) => structuredClone(message)); }

export class Goondan {
  readonly #bindings: RuntimeBindings;
  readonly #store;
  readonly #renderer: TemplateRenderer;
  readonly #sessions = new Map<string, SessionRuntime>();
  readonly #instances = new Map<string, Map<string, ExtensionInstance>>();
  readonly #pendingByInstance = new Map<string, Map<string, AsyncHookTask>>();
  readonly #tasks = new Set<Promise<void>>();
  readonly #detachedControllers = new Set<AbortController>();
  readonly #sessionWork = new Map<string, number>();
  #closed = false;
  readonly loaded: LoadedConfig;
  readonly sessions: { delete(sessionId: string): Promise<void> };
  readonly operations: {
    list(sessionId?: string): Promise<PendingOperation[]>;
    decide(sessionId: string, operationId: string, value: OperationDecision): Promise<PendingOperation>;
  };

  constructor(input: LoadedConfig | unknown, bindings: RuntimeBindings) {
    if (bindings.maxRetries !== undefined && (!Number.isInteger(bindings.maxRetries) || bindings.maxRetries < 0)) throw new TypeError("maxRetries must be an integer of 0 or more");
    const loaded = prepareRuntimeConfig(input, bindings.directory);
    raiseIssues(bindingIssues(loaded.config, bindings));
    this.loaded = loaded;
    this.#bindings = bindings;
    this.#store = bindings.store ?? new MemoryStore();
    this.#renderer = new TemplateRenderer(loaded.templates, loaded.directory);
    this.sessions = { delete: async (sessionId) => this.#deleteSession(sessionId) };
    this.operations = {
      list: async (sessionId) => this.#listOperations(sessionId),
      decide: async (sessionId, operationId, value) => this.#decideOperation(sessionId, operationId, value),
    };
  }

  async run(input: RunInput, options: RunOptions = {}): Promise<RunHandle> {
    if (this.#closed) throw runtimeFailure("The runtime is closed");
    if (options.signal?.aborted) throw abortFailure(options.signal.reason);
    this.#validateInput(input, options.meta);
    if (options.agent !== undefined && options.startAgent !== undefined) {
      throw routeFailure("a run declares either agent or startAgent, not both");
    }
    const requested = options.agent ?? options.startAgent;
    if (requested !== undefined && !Object.hasOwn(this.loaded.config.agents, requested)) {
      throw routeFailure(`Unknown agent: ${requested}`);
    }
    const sessionId = options.sessionId ?? id();
    const session = this.#session(sessionId);
    const accepted = await session.mutex.run(async () => {
      if (this.#closed) throw runtimeFailure("The runtime is closed");
      if (options.signal?.aborted) throw abortFailure(options.signal.reason);
      await this.#load(session);
      if (!session.turn) {
        const acquired = session.lease === undefined;
        if (acquired) this.#installLease(session, await this.#waitLease(session.sessionId, options.signal));
        try {
          await this.#refresh(session);
          await this.#recover(session);
          if (options.signal?.aborted) throw abortFailure(options.signal.reason);
          const started = await this.#startTurn(session, input, options);
          session.turn = started.turn;
          return started;
        } catch (error) {
          if (acquired && !session.turn && (this.#sessionWork.get(session.sessionId) ?? 0) === 0) {
            await this.#releaseLease(session);
          }
          throw error;
        }
      } else {
        if (options.signal?.aborted) throw abortFailure(options.signal.reason);
        const inputId = await this.#acceptHostInput(session.turn, input, options);
        return { turn: session.turn, inputId };
      }
    });
    const result = this.#resultFor(accepted.turn.deferred.promise, options.signal);
    void result.catch(() => undefined);
    return { sessionId, turnId: accepted.turn.turnId, inputId: accepted.inputId, result };
  }

  abort(sessionId: string): boolean {
    if (this.#closed) return false;
    const turn = this.#sessions.get(sessionId)?.turn;
    if (!turn) return false;
    turn.controller.abort(abortFailure());
    return true;
  }

  async idle(): Promise<void> {
    while (true) {
      const turns = [...this.#sessions.values()].flatMap((session) => session.turn ? [session.turn.deferred.promise] : []);
      const pending = [...this.#tasks, ...turns];
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  #validateInput(input: unknown, meta: unknown): void {
    if (!isJsonValue(input)) throw inputFailure("run input must be a JSON value");
    if (meta === undefined) return;
    if (!isRecord(meta) || !isJsonValue(meta)) throw inputFailure("run meta must be a JSON object");
    const reserved = ownKeys(meta).find((key) => ["kind", "from", "instance", "operationId"].includes(key));
    if (reserved !== undefined) throw inputFailure(`run meta uses the reserved key ${reserved}`);
  }

  #resultFor(result: Promise<TurnResult>, signal?: AbortSignal): Promise<TurnResult> {
    if (!signal) return result;
    return new Promise<TurnResult>((resolve, reject) => {
      const aborted = (): void => reject(abortFailure(signal.reason));
      signal.addEventListener("abort", aborted, { once: true });
      void result.then(
        (value) => { signal.removeEventListener("abort", aborted); resolve(value); },
        (error: unknown) => { signal.removeEventListener("abort", aborted); reject(error); },
      );
      if (signal.aborted) aborted();
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const session of this.#sessions.values()) session.turn?.controller.abort(abortFailure());
    for (const controller of this.#detachedControllers) controller.abort(abortFailure());
    for (const tasks of this.#pendingByInstance.values()) for (const task of tasks.values()) task.controller.abort(abortFailure());
    await Promise.allSettled([...this.#tasks]);
    for (const instances of this.#instances.values()) await this.#dispose(instances);
    this.#instances.clear();
    for (const session of this.#sessions.values()) await this.#releaseLease(session);
  }

  #session(sessionId: string): SessionRuntime {
    const current = this.#sessions.get(sessionId);
    if (current) return current;
    const created: SessionRuntime = {
      sessionId,
      mutex: new Mutex(),
      appendMutex: new Mutex(),
      leaseMutex: new Mutex(),
      events: [],
      state: { version: 1, sessionId, head: 0, conversations: [], operations: [], turns: [], executions: [] },
      loaded: false,
      recovered: false,
      actors: new Map(),
      waits: new Map(),
      controllers: new Set(),
    };
    this.#sessions.set(sessionId, created);
    return created;
  }

  async #load(session: SessionRuntime): Promise<void> {
    if (session.loaded) return;
    const events: JournalEvent[] = [];
    for await (const event of this.#store.scan({ sessionId: session.sessionId })) events.push(event);
    session.events = events;
    session.state = fold(session.sessionId, events);
    session.loaded = true;
  }

  async #waitLease(sessionId: string, signal?: AbortSignal): Promise<StoreLease> {
    while (true) {
      if (signal?.aborted) throw abortFailure(signal.reason);
      if (this.#closed) throw runtimeFailure("The runtime is closed");
      const lease = await this.#store.acquireLease(sessionId, id());
      if (lease) return lease;
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
  }

  #installLease(session: SessionRuntime, lease: StoreLease): void {
    session.lease = lease;
    session.leaseFailure = undefined;
    if (lease.expiresAt === null) return;
    const controller = new AbortController();
    session.leaseController = controller;
    const renewal = this.#renewLease(session, lease, controller.signal);
    session.leaseRenewal = renewal;
    void renewal.catch(() => undefined);
  }

  async #renewLease(session: SessionRuntime, lease: StoreLease, signal: AbortSignal): Promise<void> {
    const initial = lease.expiresAt === null ? null : lease.expiresAt - Date.now();
    if (initial === null) return;
    if (initial <= 0) { this.#loseLease(session, new Error("the session lease expired")); return; }
    let minimumTtl = initial;
    while (!signal.aborted && session.lease === lease && lease.expiresAt !== null) {
      const delay = Math.max(1, Math.floor(minimumTtl / 2));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      if (signal.aborted || session.lease !== lease) return;
      try {
        const renewed = await session.leaseMutex.run(() => lease.renew());
        if (!renewed) { this.#loseLease(session, new Error("the session lease renewal was rejected")); return; }
        if (lease.expiresAt === null) return;
        const ttl = lease.expiresAt - Date.now();
        if (ttl <= 0) { this.#loseLease(session, new Error("the renewed session lease expired")); return; }
        minimumTtl = Math.min(minimumTtl, ttl);
      } catch (error) {
        this.#loseLease(session, error);
        return;
      }
    }
  }

  #loseLease(session: SessionRuntime, cause: unknown): void {
    if (session.leaseFailure) return;
    const failure = runtimeFailure(`session lease lost: ${reason(cause)}`, cause);
    session.leaseFailure = failure;
    session.turn?.controller.abort(failure);
    for (const controller of session.controllers) controller.abort(failure);
  }

  async #verifyLease(session: SessionRuntime, lease: StoreLease): Promise<void> {
    if (session.leaseFailure) throw session.leaseFailure;
    try {
      const renewed = await session.leaseMutex.run(() => lease.renew());
      if (!renewed) throw new Error("the session lease was lost");
      if (lease.expiresAt !== null && lease.expiresAt <= Date.now()) throw new Error("the session lease expired");
    } catch (error) {
      this.#loseLease(session, error);
      throw session.leaseFailure ?? runtimeFailure(reason(error), error);
    }
  }

  async #releaseLease(session: SessionRuntime): Promise<void> {
    const lease = session.lease;
    const controller = session.leaseController;
    const renewal = session.leaseRenewal;
    session.lease = undefined;
    session.leaseController = undefined;
    session.leaseRenewal = undefined;
    controller?.abort();
    if (renewal) await Promise.allSettled([renewal]);
    await lease?.release();
  }

  async #append(session: SessionRuntime, events: NewJournalEvent[]): Promise<JournalEvent[]> {
    if (events.length === 0) return [];
    return session.appendMutex.run(async () => {
      const ownLease = session.lease === undefined;
      if (ownLease) this.#installLease(session, await this.#waitLease(session.sessionId));
      const lease = session.lease;
      if (!lease) throw runtimeFailure("the session lease is not held");
      try {
        await this.#verifyLease(session, lease);
        const stored = await this.#store.append(events, { expected: session.state.head, token: lease.token, writeId: id() });
        session.events.push(...stored);
        session.state = fold(session.sessionId, session.events);
        for (const event of stored) await this.#emit(event);
        return stored;
      } catch (error) {
        throw runtimeFailure(reason(error), error);
      } finally {
        if (ownLease && !session.turn) {
          await this.#releaseLease(session);
        }
      }
    });
  }

  #event(sessionId: string, type: string, data: unknown, scope: {
    turnId?: string; inputId?: string; agent?: string; instance?: string; executionId?: string;
    parentExecutionId?: string; operationId?: string; skippable?: true;
  } = {}): NewJournalEvent {
    const event: NewJournalEvent = { version: JOURNAL_VERSION, type, sessionId, data };
    if (scope.turnId !== undefined) event.turnId = scope.turnId;
    if (scope.inputId !== undefined) event.inputId = scope.inputId;
    if (scope.agent !== undefined) event.agent = scope.agent;
    if (scope.instance !== undefined) event.instance = scope.instance;
    if (scope.executionId !== undefined) event.executionId = scope.executionId;
    if (scope.parentExecutionId !== undefined) event.parentExecutionId = scope.parentExecutionId;
    if (scope.operationId !== undefined) event.operationId = scope.operationId;
    if (scope.skippable !== undefined) event.skippable = scope.skippable;
    return event;
  }

  async #recover(session: SessionRuntime): Promise<void> {
    if (session.recovered) return;
    const events: NewJournalEvent[] = [];
    const failure = detail(abortFailure(), 1);
    for (const execution of session.state.executions.filter((item) => item.status === "running")) {
      events.push(this.#event(session.sessionId, "agent.error", { status: "aborted", error: failure, usage: zeroUsage() }, execution));
    }
    for (const turn of session.state.turns.filter((item) => item.status === "running")) {
      events.push(this.#event(session.sessionId, "turn.error", { status: "aborted", error: failure }, { turnId: turn.turnId }));
    }
    const now = Date.now();
    for (const operation of session.state.operations) {
      if (operation.status === "running") {
        events.push(this.#operationEvent(operation, "operation.failed", { updatedAt: now, error: interruptedMessage, errorCode: "execution_interrupted" }));
      } else if (isTerminalStatus(operation.status) && operation.deliveryStatus === "delivering") {
        events.push(this.#operationEvent(operation, "operation.delivery.finished", { updatedAt: now, outcome: "interrupted" }));
      }
    }
    if (events.length > 0) await this.#append(session, events);
    session.recovered = true;
    const operations = session.state.operations.map((item) => structuredClone(item));
    for (const operation of operations) {
      if (operation.status === "approved") this.#track(this.#executeOperation(operation));
      else if (isTerminalStatus(operation.status) && operation.deliveryStatus === "pending") this.#track(this.#deliverOperation(operation));
    }
  }

  async #startTurn(session: SessionRuntime, input: RunInput, options: RunOptions): Promise<{ turn: ActiveTurn; inputId: string }> {
    const turn: ActiveTurn = {
      session,
      turnId: id(),
      controller: new AbortController(),
      deferred: new Deferred<TurnResult>(),
      actors: new Map(),
      executions: new Map(),
      functions: new Map(),
      waits: new Map(),
      runs: [],
      outputs: [],
      outputOrder: 0,
      activity: 0,
      closing: false,
    };
    const inputId = id();
    const stored = await this.#append(session, [
      this.#event(session.sessionId, "turn.start", {}, { turnId: turn.turnId }),
      this.#event(session.sessionId, "input.received", this.#inputData(input, options), { turnId: turn.turnId, inputId }),
    ]);
    const acceptedInputId = stored.find((event) => event.type === "input.received")?.inputId;
    if (acceptedInputId === undefined) throw runtimeFailure("the accepted input has no inputId");
    turn.activity += 1;
    const dispatch = this.#dispatchHost(turn, input, options)
      .catch((error: unknown) => this.#failTurn(turn, error))
      .finally(() => this.#activityDone(turn));
    this.#track(dispatch);
    return { turn, inputId: acceptedInputId };
  }

  async #acceptHostInput(turn: ActiveTurn, input: RunInput, options: RunOptions): Promise<string> {
    if (options.agent !== undefined && options.startAgent !== undefined) throw routeFailure("a run declares either agent or startAgent, not both");
    const inputId = id();
    const stored = await this.#append(turn.session, [this.#event(turn.session.sessionId, "input.received", this.#inputData(input, options), { turnId: turn.turnId, inputId })]);
    const acceptedInputId = stored[0]?.inputId;
    if (acceptedInputId === undefined) throw runtimeFailure("the accepted input has no inputId");
    turn.activity += 1;
    const dispatch = this.#dispatchHost(turn, input, options)
      .catch((error: unknown) => this.#failTurn(turn, error))
      .finally(() => this.#activityDone(turn));
    this.#track(dispatch);
    return acceptedInputId;
  }

  #inputData(input: RunInput, options: RunOptions): Record<string, unknown> {
    const data: Record<string, unknown> = { input: structuredClone(input) };
    if (options.agent !== undefined) data.agent = options.agent;
    if (options.startAgent !== undefined) data.startAgent = options.startAgent;
    if (options.meta !== undefined) data.meta = structuredClone(options.meta);
    return data;
  }

  async #dispatchHost(turn: ActiveTurn, input: RunInput, options: RunOptions): Promise<void> {
    if (options.agent !== undefined && options.startAgent !== undefined) throw routeFailure("a run declares either agent or startAgent, not both");
    const agents = this.loaded.config.agents;
    if (options.agent !== undefined) {
      if (!Object.hasOwn(agents, options.agent)) throw routeFailure(`Unknown agent: ${options.agent}`);
      const request = this.#hostRequest(options.agent, input, false, options.meta);
      const group = this.#enqueue(turn, request);
      if (!group) throw routeFailure("the requested agent did not start");
      return;
    }
    if (options.startAgent !== undefined) {
      if (!Object.hasOwn(agents, options.startAgent)) throw routeFailure(`Unknown agent: ${options.startAgent}`);
      this.#enqueue(turn, this.#hostRequest(options.startAgent, input, this.loaded.config.routes !== undefined, options.meta));
      return;
    }
    const routes = this.loaded.config.routes;
    if (routes === undefined) {
      const first = Object.keys(agents)[0];
      if (first === undefined) throw routeFailure("the configuration has no start agent");
      const group = this.#enqueue(turn, this.#hostRequest(first, input, false, options.meta));
      if (!group) throw routeFailure("the requested agent did not start");
      return;
    }
    const preserveMessages = isMessageArray(input);
    const conditionMessages = this.#entryMessages(input, options.meta);
    const matching: Array<{ route: RouteSpec; index: number }> = [];
    for (const [index, route] of routes.entries()) {
      if (!sameEndpoint(route.from, "$input")) continue;
      if (await this.#routeMatches(route, null, conditionMessages, turn)) matching.push({ route, index });
    }
    if (matching.length === 0) throw routeFailure("no route matched $input");
    await Promise.all(matching.map((item) => {
      const target = item.route.to;
      const source = typeof target === "string" && target !== "$output" ? target : "input";
      const routed = this.#hostMessages(input, source, options.meta);
      return this.#routeTarget(turn, item.route.to, routed, item.index, "$input", undefined, "stop", true, preserveMessages);
    }));
    this.#scheduleReady(turn);
  }

  #hostRequest(agent: string, input: RunInput, followsRoutes: boolean, meta?: Record<string, Json>): InputRequest {
    return {
      target: agent,
      messages: this.#hostMessages(input, agent, meta),
      origin: "host",
      kind: "turn",
      followsRoutes,
      preserveMessages: isMessageArray(input),
    };
  }

  #entryMessages(input: RunInput, meta?: Record<string, Json>): EntryMessage[] {
    const merged = (current?: Record<string, Json>): Record<string, Json> | undefined => {
      if (meta === undefined && current === undefined) return undefined;
      return { ...(meta ?? {}), ...(current ?? {}) };
    };
    if (isMessageArray(input)) return input.map((message) => {
      const copy = structuredClone(message);
      const nextMeta = merged(copy.meta);
      if (nextMeta === undefined) return copy;
      return { ...copy, meta: nextMeta };
    });
    let content: Part[];
    if (isPartArray(input) && input.length > 0) content = structuredClone(input);
    else if (typeof input === "string") content = [{ type: "text", text: input }];
    else content = [{ type: "json", value: structuredClone(input) }];
    const message: EntryMessage = { id: id(), role: "user", content };
    const nextMeta = merged();
    if (nextMeta !== undefined) message.meta = nextMeta;
    return [message];
  }

  #hostMessages(input: RunInput, source: string, meta?: Record<string, Json>): Message[] {
    return this.#entryMessages(input, meta).map((message): Message => ({ ...message, source: message.source ?? source }));
  }

  #rawMessages(input: RunInput, source: string): Message[] {
    if (isMessageArray(input)) return structuredClone(input);
    if (isPartArray(input)) return [{ id: id(), role: "user", content: structuredClone(input), source }];
    if (typeof input === "string") return [{ id: id(), role: "user", content: [{ type: "text", text: input }], source }];
    const json = toJson(input) ?? null;
    return [{ id: id(), role: "user", content: [{ type: "json", value: json }], source }];
  }

  #actor(turn: ActiveTurn, agent: string): Actor {
    const spec = this.loaded.config.agents[agent];
    if (!spec) throw routeFailure(`Unknown agent: ${agent}`);
    const stateful = spec.stateful !== false;
    const key = stateful ? agent : `${agent}:${id()}`;
    const found = stateful ? turn.session.actors.get(key) : turn.actors.get(key);
    if (found) {
      turn.actors.set(key, found);
      return found;
    }
    const actor: Actor = { agent, instance: stateful ? `${turn.session.sessionId}/${agent}` : id(), stateful, queue: [] };
    turn.actors.set(key, actor);
    if (stateful) turn.session.actors.set(key, actor);
    return actor;
  }

  #enqueue(turn: ActiveTurn, request: InputRequest, deferRouteStart = false): ExecutionGroup | undefined {
    if (turn.failed !== undefined || turn.controller.signal.aborted) {
      request.waiter?.reject(abortFailure());
      return undefined;
    }
    request.turn = turn;
    const actor = this.#actor(turn, request.target);
    if (actor.running) {
      actor.queue.push(request);
      if (actor.running.turn !== turn) {
        request.reserved = true;
        turn.activity += 1;
      }
      if (request.origin === "route") actor.running.routeRequested = true;
      if (request.origin === "host" && !request.followsRoutes) actor.running.singleOutputRequested = true;
      return actor.running;
    }
    actor.queue.push(request);
    if (deferRouteStart && actor.stateful && request.origin === "route") return undefined;
    if (actor.stateful && request.origin === "route" && !this.#routeReady(turn, actor.agent)) return undefined;
    return this.#startActor(turn, actor);
  }

  #routeReady(turn: ActiveTurn, target: string): boolean {
    const routes = this.loaded.config.routes ?? [];
    const sources = new Set<string>();
    for (const route of routes) {
      if (endpointKey(route.to) !== target) continue;
      const source = endpointKey(route.from);
      if (source !== "$input" && source !== target && this.#reachableWithout(source, target)) sources.add(source);
    }
    for (const source of sources) if (source.startsWith("@fn:") && (turn.functions.get(source) ?? 0) > 0) return false;
    for (const actor of turn.actors.values()) {
      if (!sources.has(actor.agent)) continue;
      if (actor.running?.turn === turn || actor.queue.some((request) => request.turn === turn)) return false;
    }
    return true;
  }

  #reachableWithout(node: string, excluded: string): boolean {
    const routes = this.loaded.config.routes ?? [];
    const reached = new Set<string>(["$input"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const route of routes) {
        const from = endpointKey(route.from);
        const to = endpointKey(route.to);
        if (to === excluded || from === excluded || !reached.has(from) || reached.has(to)) continue;
        reached.add(to);
        changed = true;
      }
    }
    return reached.has(node);
  }

  #startActor(turn: ActiveTurn, actor: Actor): ExecutionGroup | undefined {
    if (actor.running || actor.queue.length === 0) return actor.running;
    const owner = actor.queue[0]?.turn ?? turn;
    const routeOnly = actor.queue.every((request) => request.origin === "route");
    if (actor.stateful && routeOnly && !this.#routeReady(owner, actor.agent)) return undefined;
    const ordered = actor.queue.splice(0).sort((left, right) => (left.routeIndex ?? -1) - (right.routeIndex ?? -1));
    for (const request of ordered) {
      if (!request.reserved || request.turn === undefined) continue;
      request.reserved = undefined;
      request.turn.activity -= 1;
    }
    for (const request of ordered) {
      request.messages = request.messages.map((message) => this.#kindMessage(
        structuredClone(message),
        "start",
        request.preserveMessages === true,
      ));
    }
    const group: ExecutionGroup = {
      turn: owner,
      actor,
      executionId: id(),
      requests: [...ordered],
      routeRequested: ordered.some((request) => request.followsRoutes),
      singleOutputRequested: ordered.some((request) => request.origin === "host" && !request.followsRoutes),
      controller: new AbortController(),
      deferred: new Deferred<AgentRunResult>(),
    };
    actor.running = group;
    owner.executions.set(group.executionId, group);
    owner.activity += 1;
    void group.deferred.promise.catch(() => undefined);
    const run = this.#runGroup(group, ordered);
    this.#track(run.finally(() => this.#activityDone(owner)));
    return group;
  }

  async #runGroup(group: ExecutionGroup, initial: InputRequest[]): Promise<void> {
    const turn = group.turn;
    const actor = group.actor;
    try {
      const result = await this.#executeAgent(group, initial);
      group.deferred.resolve(result);
      for (const request of group.requests) request.waiter?.resolve(result.output);
      const participants = new Map<ActiveTurn, InputRequest[]>();
      for (const request of group.requests) {
        const owner = request.turn ?? turn;
        const requests = participants.get(owner) ?? [];
        requests.push(request);
        participants.set(owner, requests);
      }
      for (const [owner, requests] of participants) {
        if (requests.some((request) => request.origin === "host" && !request.followsRoutes)) {
          owner.outputs.push({ route: -1, order: owner.outputOrder++, message: result.output, finishReason: result.finishReason });
        }
        if (requests.some((request) => request.followsRoutes)) {
          await this.#routeFrom(owner, actor.agent, result.output, actor.instance, result.finishReason, group.state?.startInput ?? []);
        }
      }
    } catch (error) {
      group.deferred.reject(error);
      for (const request of group.requests) request.waiter?.reject(error);
      for (const request of group.requests) {
        if ((request.followsRoutes || (request.origin === "host" && !request.followsRoutes)) && request.turn) {
          this.#failTurn(request.turn, error);
        }
      }
    } finally {
      actor.running = undefined;
      turn.executions.delete(group.executionId);
      for (const edges of turn.session.waits.values()) edges.delete(group.executionId);
      turn.session.waits.delete(group.executionId);
      const participantTurns = new Set<ActiveTurn>();
      for (const request of group.requests) {
        if (!request.reserved || request.turn === undefined) continue;
        request.reserved = undefined;
        request.turn.activity -= 1;
        participantTurns.add(request.turn);
      }
      if (actor.queue.length > 0) this.#startActor(actor.queue[0]?.turn ?? turn, actor);
      this.#scheduleReady(turn);
      for (const participant of participantTurns) void this.#maybeClose(participant);
    }
  }

  #scheduleReady(turn: ActiveTurn): void {
    for (const actor of turn.actors.values()) {
      if (!actor.running && actor.queue.length > 0) this.#startActor(actor.queue[0]?.turn ?? turn, actor);
    }
  }

  async #executeAgent(group: ExecutionGroup, initial: InputRequest[]): Promise<AgentRunResult> {
    const turn = group.turn;
    const actor = group.actor;
    const spec = this.loaded.config.agents[actor.agent];
    if (!spec) throw routeFailure(`Unknown agent: ${actor.agent}`);
    const first = initial[0];
    const cause = first?.parentExecutionId !== undefined ? { parentExecutionId: first.parentExecutionId }
      : first?.operationId !== undefined ? { operationId: first.operationId } : {};
    const sink: RunSink = { kind: first?.kind ?? "turn", nodes: turn.runs };
    const node = startRun(sink, actor.agent, actor.instance, group.executionId, turn.turnId, cause);
    const extensions = await this.#extensions(actor.agent, spec, turn.session.sessionId, actor.instance, actor.stateful);
    const conversation = actor.stateful
      ? cloneMessages(turn.session.state.conversations.find((item) => item.agent === actor.agent && item.instance === actor.instance)?.messages ?? [])
      : [];
    const state: ExecutionState = {
      group,
      agent: actor.agent,
      spec,
      instance: actor.instance,
      executionId: group.executionId,
      turnId: turn.turnId,
      input: [],
      startInput: [],
      conversation,
      inputKind: "start",
      step: 0,
      retryCount: 0,
      usage: zeroUsage(),
      extensions,
      pendingHooks: this.#pending(actor.instance),
      runNode: node,
    };
    if (cause.parentExecutionId !== undefined) state.parentExecutionId = cause.parentExecutionId;
    if (cause.operationId !== undefined) state.operationId = cause.operationId;
    group.state = state;
    await this.#append(turn.session, [this.#event(turn.session.sessionId, "agent.start", {
      kind: sink.kind,
      input: initial.flatMap((request) => cloneMessages(request.messages)),
    }, this.#scope(state))]);
    try {
      await this.#processInputs(state, initial, "start");
      state.startInput = cloneMessages(state.input);
      await this.#repair(state);
      const result = await this.#modelLoop(state);
      finishRun(node, state.usage, result.finishReason);
      await this.#append(turn.session, [this.#event(turn.session.sessionId, "agent.done", {
        output: result.output,
        finishReason: result.finishReason,
        usage: state.usage,
      }, this.#scope(state))]);
      return result;
    } catch (caught) {
      const error = turn.controller.signal.aborted || group.controller.signal.aborted ? abortFailure(caught) : this.#asExecutionError(caught);
      failRun(node, state.usage);
      await this.#append(turn.session, [this.#event(turn.session.sessionId, "agent.error", {
        status: error.codes.includes("aborted") ? "aborted" : "failed",
        error: detail(error, state.retryCount + 1),
        usage: state.usage,
      }, this.#scope(state))]);
      throw error;
    } finally {
      if (!actor.stateful) {
        const pending = state.pendingHooks;
        if (pending.size === 0) this.#pendingByInstance.delete(actor.instance);
        else {
          const discard = Promise.allSettled([...pending.values()].map((task) => task.promise)).then(() => {
            if (this.#pendingByInstance.get(actor.instance) === pending) this.#pendingByInstance.delete(actor.instance);
          });
          this.#track(discard);
        }
        await this.#dispose(extensions);
      }
    }
  }

  #scope(state: ExecutionState): {
    turnId: string; agent: string; instance: string; executionId: string;
    parentExecutionId?: string; operationId?: string;
  } {
    const scope: {
      turnId: string; agent: string; instance: string; executionId: string;
      parentExecutionId?: string; operationId?: string;
    } = { turnId: state.turnId, agent: state.agent, instance: state.instance, executionId: state.executionId };
    if (state.parentExecutionId !== undefined) scope.parentExecutionId = state.parentExecutionId;
    if (state.operationId !== undefined) scope.operationId = state.operationId;
    return scope;
  }

  async #processInputs(state: ExecutionState, requests: InputRequest[], kind: "start" | "steer"): Promise<void> {
    const transformed: Message[] = [];
    for (const request of requests) {
      state.input = request.messages.map((message) => this.#kindMessage(structuredClone(message), kind, request.preserveMessages === true));
      state.inputKind = kind;
      const inputStage = await this.#hooks("onInput", state.input, state);
      if (!isMessageArray(inputStage.value)) throw executionFailure("onInput", "value_invalid", "onInput did not return messages", state.retryCount + 1);
      const ruled = await this.#applyInputRule(inputStage.value, state);
      transformed.push(...ruled);
    }
    state.input = transformed;
    const prompt = await this.#hooks("onPrompt", transformed, state);
    if (!isMessageArray(prompt.value)) throw executionFailure("onPrompt", "value_invalid", "onPrompt did not return messages", state.retryCount + 1);
    state.input = cloneMessages(prompt.value);
    await this.#appendMessages(state, prompt.value);
  }

  #kindMessage(message: Message, kind: "start" | "steer", preserve: boolean): Message {
    if (preserve) return message;
    if (message.meta?.kind !== undefined) return message;
    return { ...message, meta: { ...(message.meta ?? {}), kind } };
  }

  async #applyInputRule(messages: Message[], state: ExecutionState): Promise<Message[]> {
    const rule = state.spec.input;
    if (rule === "asis") return cloneMessages(messages);
    const result: Message[] = [];
    for (const message of messages) {
      const content: Part[] = [];
      for (const part of message.content) {
        if (part.type !== "json") { content.push(structuredClone(part)); continue; }
        let text: string;
        if (rule?.fn) {
          try {
            const returned = await this.#function(rule.fn, part.value, state, "onInput");
            const json = returned === undefined ? null : toJson(returned);
            if (json === undefined) throw executionFailure("onInput", "value_invalid", "the input function did not return JSON", state.retryCount + 1);
            text = typeof json === "string" ? json : jsonText(json);
          } catch (error) {
            if (error instanceof GoondanExecutionError) throw error;
            throw executionFailure("onInput", "runtime_error", reason(error), state.retryCount + 1, undefined, error);
          }
        } else if (rule?.template) {
          try {
            const variables = isRecord(part.value) ? structuredClone(part.value) : { text: structuredClone(part.value) };
            text = this.#renderer.render(rule.template, variables);
          } catch (error) {
            throw executionFailure("onInput", "runtime_error", reason(error), state.retryCount + 1, undefined, error);
          }
        } else text = jsonText(part.value);
        content.push({ type: "text", text });
      }
      result.push({ ...message, content });
    }
    return result;
  }

  async #repair(state: ExecutionState): Promise<void> {
    const repaired = repairToolPairs(state.conversation);
    if (!repaired) return;
    const events: NewJournalEvent[] = [];
    for (const message of state.conversation) {
      const next = repaired.find((candidate) => candidate.id === message.id);
      if (!next) events.push(this.#event(state.group.turn.session.sessionId, "conversation.message.removed", { messageId: message.id }, this.#scope(state)));
      else if (!jsonEqual(message, next)) events.push(this.#event(state.group.turn.session.sessionId, "conversation.message.replaced", { messageId: message.id, message: next }, this.#scope(state)));
    }
    await this.#append(state.group.turn.session, events);
    state.conversation = cloneMessages(repaired);
  }

  async #safePoint(state: ExecutionState): Promise<boolean> {
    if (state.group.turn.controller.signal.aborted || state.group.controller.signal.aborted) throw abortFailure();
    await this.#drainAsync(state);
    const queue = state.group.actor.queue.splice(0);
    if (queue.length > 0) {
      state.group.requests.push(...queue);
      if (queue.some((request) => request.followsRoutes)) state.group.routeRequested = true;
      await this.#processInputs(state, queue, "steer");
    }
    return queue.length > 0;
  }

  async #modelLoop(state: ExecutionState): Promise<AgentRunResult> {
    while (true) {
      await this.#safePoint(state);
      const stepStage = await this.#hooks("onStep", cloneMessages(state.conversation), state);
      if (!isMessageArray(stepStage.value)) throw executionFailure("onStep", "value_invalid", "onStep did not return messages", state.retryCount + 1);
      await this.#replaceConversation(state, stepStage.value);
      let modelInput = await this.#modelInput(state);
      const inputStage = await this.#hooks("onModelInput", modelInput, state);
      if (!isModelInput(inputStage.value)) throw executionFailure("onModelInput", "value_invalid", "onModelInput did not return a model input", state.retryCount + 1);
      modelInput = inputStage.value;
      let modelResult: ModelResult;
      try {
        modelResult = await this.#callModel(state, modelInput);
      } catch (error) {
        const failure = this.#asExecutionError(error, "model", modelCodes(error));
        const handled = await this.#handleError(failure, state);
        if (handled && state.retryCount < (this.#bindings.maxRetries ?? 3)) {
          await this.#waitRetry(handled.afterMs, state);
          state.retryCount += 1;
          continue;
        }
        throw failure;
      }
      addUsage(state.usage, modelResult.usage);
      const resultStage = await this.#hooks("onModelResult", modelResult, state);
      if (resultStage.retry) {
        if (state.retryCount >= (this.#bindings.maxRetries ?? 3)) throw executionFailure("onModelResult", "hook_error", "retry limit reached", state.retryCount + 1);
        await this.#waitRetry(resultStage.retry.afterMs, state);
        state.retryCount += 1;
        continue;
      }
      if (!isModelResult(resultStage.value)) throw executionFailure("onModelResult", "value_invalid", "onModelResult did not return a model result", state.retryCount + 1);
      modelResult = resultStage.value;
      await this.#appendMessages(state, [modelResult.message]);
      const calls = modelResult.message.content.filter((part) => part.type === "tool.call");
      if (calls.length === 0) {
        if (state.group.actor.queue.length > 0 && await this.#safePoint(state)) continue;
        return this.#finish(state, modelResult.message, modelResult.finishReason);
      }
      let completion: Message | undefined;
      for (const part of calls) {
        const result = await this.#processTool({ id: part.callId, name: part.name, args: part.args }, state);
        if (result.complete !== undefined) completion = result.complete;
      }
      if (completion) {
        await this.#safePoint(state);
        return this.#finish(state, completion, "tool", true);
      }
    }
  }

  async #finish(state: ExecutionState, output: Message, finishReason: FinishReason, append = false): Promise<AgentRunResult> {
    const stage = await this.#hooks("onOutput", output, state);
    if (!isMessage(stage.value) || stage.value.role !== "assistant") throw executionFailure("onOutput", "value_invalid", "onOutput did not return an assistant message", state.retryCount + 1);
    if (append) await this.#appendMessages(state, [stage.value]);
    else if (!jsonEqual(stage.value, output)) await this.#replaceMessage(state, output.id, stage.value);
    state.finishReason = finishReason;
    return { output: stage.value, usage: structuredClone(state.usage), finishReason, status: "done", instance: state.instance, executionId: state.executionId };
  }

  async #callModel(state: ExecutionState, input: ModelInput): Promise<ModelResult> {
    const modelName = state.spec.model;
    const model = modelName === undefined ? undefined : this.#bindings.models[modelName];
    if (!model) throw runtimeFailure(`No model is bound for ${state.agent}`);
    state.step += 1;
    const step = state.step;
    await this.#observed("step.start", state, { step });
    let active = true;
    try {
      const response = await model.generate(structuredClone(input), {
        ...this.#executionContext(state),
        step,
        onTextDelta: (delta) => {
          if (!active || typeof delta !== "string") return;
          void this.#observed("step.textDelta", state, { step, delta });
        },
      });
      active = false;
      const normalized = normalizeModelResponse(response, id());
      if (!normalized.value) {
        const failure = executionFailure("onModelResult", "value_invalid", normalized.issue ?? "invalid model response", state.retryCount + 1);
        await this.#observed("step.error", state, { step, codes: failure.codes, error: failure.message });
        throw failure;
      }
      await this.#observed("step.done", state, { step, finishReason: normalized.value.finishReason });
      return normalized.value;
    } catch (error) {
      active = false;
      if (error instanceof GoondanExecutionError && error.where === "onModelResult") throw error;
      const failure = state.group.turn.controller.signal.aborted || state.group.controller.signal.aborted
        ? abortFailure(error)
        : error instanceof GoondanExecutionError
        ? error
        : new GoondanExecutionError({
          where: "model",
          codes: modelCodes(error),
          message: reason(error),
          attempt: state.retryCount + 1,
        }, { cause: error });
      await this.#observed("step.error", state, { step, codes: failure.codes, error: failure.message });
      throw failure;
    }
  }

  async #modelInput(state: ExecutionState): Promise<ModelInput> {
    const system = [];
    const tools = (await this.#tools(state)).map((entry) => entry.definition);
    const declarations = Array.isArray(state.spec.systemMessage) ? state.spec.systemMessage : state.spec.systemMessage ? [state.spec.systemMessage] : [];
    for (const [index, block] of declarations.entries()) {
      let text: string;
      try {
        text = block.text ?? (block.template ? this.#renderer.render(block.template, {
          params: structuredClone(state.spec.params ?? {}),
          tools: toJson(tools) ?? [],
          agent: { name: state.agent },
          model: state.spec.model ?? "",
          input: toJson(state.input) ?? [],
          inputText: inputTextOf(state.input),
        }) : "");
      } catch (error) {
        throw executionFailure("onModelInput", "runtime_error", reason(error), state.retryCount + 1, undefined, error);
      }
      system.push({ text, source: `system:${String(index)}`, ...(block.cache === true ? { cache: true } : {}) });
    }
    return { system, messages: cloneMessages(state.conversation), tools, options: {} };
  }

  async #processTool(original: ToolCall, state: ExecutionState): Promise<{ complete?: Message }> {
    const callStage = await this.#hooks("onToolCall", original, state, original.id);
    const call = isToolCall(callStage.value) ? callStage.value : original;
    if (callStage.result !== undefined) {
      const normalized = normalizeToolReturn(callStage.result, call);
      if (!normalized.value) throw executionFailure("onToolResult", "value_invalid", normalized.issue ?? "invalid tool result", state.retryCount + 1, call);
      const accepted = await this.#acceptToolResult(normalized.value, state, call);
      return accepted.complete === undefined ? {} : { complete: accepted.complete };
    }
    const entries = await this.#tools(state);
    const entry = entries.find((item) => item.name === call.name);
    if (!entry) return this.#executeTool(call, state, undefined, callStage.execution);
    const reasons = [...callStage.approvals];
    if (entry.approval) reasons.push(approvalReason(entry.name));
    if (reasons.length > 0) {
      await this.#createOperation(state, call, reasons, callStage.execution);
      return {};
    }
    return this.#executeTool(call, state, entry, callStage.execution);
  }

  async #executeTool(call: ToolCall, state: ExecutionState, entry: ToolEntry | undefined, execution?: Record<string, Json>): Promise<{ complete?: Message }> {
    while (true) {
      let started = false;
      try {
        if (!entry) throw executionFailure("tool", "tool_unavailable", `Tool ${call.name} is not available`, state.retryCount + 1, call);
        await this.#observed("tool.start", state, { tool: call.name, callId: call.id, args: call.args });
        started = true;
        const returned = entry.agent
          ? { content: (await this.#callAgent(state, entry.agent, call.args, "tool", this.#executionContext(state).signal)).content }
          : await entry.host?.execute(call.args, this.#toolContext(state, call, execution));
        const normalized = normalizeToolReturn(returned, call);
        if (!normalized.value) throw executionFailure("onToolResult", "value_invalid", normalized.issue ?? "invalid tool result", state.retryCount + 1);
        const accepted = await this.#acceptToolResult(normalized.value, state, call);
        await this.#observed("tool.done", state, { tool: call.name, callId: call.id, args: call.args, result: accepted.result });
        return accepted.complete === undefined ? {} : { complete: accepted.complete };
      } catch (error) {
        const failure = state.group.turn.controller.signal.aborted || state.group.controller.signal.aborted ? abortFailure(error)
          : error instanceof GoondanExecutionError && (error.where === "onToolResult" || error.where === "tool" || error.codes.includes("aborted"))
          ? error : executionFailure("tool", "tool_error", reason(error), state.retryCount + 1, call, error);
        if (started) await this.#observed("tool.error", state, { tool: call.name, callId: call.id, args: call.args, codes: failure.codes, error: failure.message });
        if (failure.where === "onToolResult" || failure.codes.includes("aborted")) throw failure;
        const handled = await this.#handleError(failure, state);
        if (!handled || state.retryCount >= (this.#bindings.maxRetries ?? 3)) throw failure;
        await this.#waitRetry(handled.afterMs, state);
        state.retryCount += 1;
      }
    }
  }

  async #acceptToolResult(result: ToolResult, state: ExecutionState, call: ToolCall): Promise<{ complete?: Message; result: ToolResult }> {
    const stage = await this.#hooks("onToolResult", result, state, call.id);
    if (!isToolResult(stage.value)) throw executionFailure("onToolResult", "value_invalid", "onToolResult did not return a tool result", state.retryCount + 1);
    const accepted = stage.value;
    const message: Message = {
      id: id(),
      role: "tool",
      source: "tool",
      content: [{ type: "tool.result", callId: accepted.callId, content: accepted.content, ...(accepted.isError === undefined ? {} : { isError: accepted.isError }) }],
    };
    if (accepted.keep !== undefined) message.keep = accepted.keep;
    if (accepted.meta !== undefined) message.meta = accepted.meta;
    await this.#appendMessages(state, [message]);
    const complete = stage.complete ?? state.completion;
    return complete === undefined ? { result: accepted } : { complete, result: accepted };
  }

  async #handleError(error: GoondanExecutionError, state: ExecutionState): Promise<{ target: "model" | "tool"; afterMs?: number } | undefined> {
    if (error.codes.includes("aborted")) return undefined;
    const stage = await this.#hooks("onError", detail(error, state.retryCount + 1), state, error.toolCall?.id);
    if (!stage.retry) return undefined;
    if ((error.where === "model" && stage.retry.target !== "model") || (error.where === "tool" && stage.retry.target !== "tool")) return undefined;
    return stage.retry;
  }

  async #waitRetry(afterMs: number | undefined, state: ExecutionState): Promise<void> {
    if (afterMs === undefined || afterMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, afterMs);
      AbortSignal.any([state.group.turn.controller.signal, state.group.controller.signal])
        .addEventListener("abort", () => { clearTimeout(timer); reject(abortFailure()); }, { once: true });
    });
  }

  async #hooks(name: ValueName, initial: unknown, state: ExecutionState, callId?: string): Promise<HookStageResult> {
    let current = structuredClone(initial);
    const result: HookStageResult = { value: current, approvals: [] };
    for (const spec of state.spec.hooks?.[name] ?? []) {
      const identifier = inlineHookIdentifier(spec, this.loaded.directory) ?? name;
      if (spec.mode === "async") {
        this.#scheduleHook(name, spec, identifier, current, state);
        continue;
      }
      const before = current;
      try {
        const applied = await this.#withTimeout(spec, state, async (signal) => {
          if (spec.when) {
            const condition = await this.#function(spec.when.fn, current, state, `${name}.when`, signal, { stage: name, source: identifier });
            if (condition !== true && condition !== false) throw new Error("hook when did not return a boolean");
            if (!condition) return { skipped: true, value: current };
          }
          const invoked = await this.#invokeHook(name, spec, identifier, current, state, signal);
          return { skipped: false, value: invoked };
        });
        if (applied.skipped) { await this.#observed("hook.skipped", state, { value: name, hook: identifier }); continue; }
        const control = controlResult(name, applied.value, callId);
        if (control && isControlIssue(control)) throw new Error(control.issue);
        if (control) {
          if (control.kind === "append") {
            if (name === "onModelInput" && isModelInput(current)) {
              current = { ...current, messages: [...current.messages, ...appendMessages(current.messages, control.messages)] };
            } else if (isMessageArray(current)) current = [...current, ...appendMessages(current, control.messages)];
          }
          else if (control.kind === "call") { current = control.call; result.execution = control.execution; }
          else if (control.kind === "approval") result.approvals.push(control.reason);
          else if (control.kind === "result") { result.result = control.result; await this.#observed("hook.applied", state, { value: name, hook: identifier }); break; }
          else if (control.kind === "retry") {
            if (name === "onModelResult" && state.retryCount >= (this.#bindings.maxRetries ?? 3)) throw new Error("retry limit reached");
            result.retry = control;
            await this.#observed("hook.applied", state, { value: name, hook: identifier });
            break;
          }
          else { result.complete = control.output; await this.#observed("hook.applied", state, { value: name, hook: identifier }); break; }
        } else if (applied.value !== null && applied.value !== undefined) {
          current = this.#applyHookValue(name, spec, identifier, current, applied.value);
        }
        const issue = stageValueIssue(name, current, callId);
        if (issue) throw new Error(issue);
        result.value = current;
        await this.#observed("hook.applied", state, { value: name, hook: identifier });
      } catch (error) {
        if (state.group.turn.controller.signal.aborted || state.group.controller.signal.aborted) throw abortFailure(error);
        await this.#observed("hook.failed", state, { value: name, hook: identifier, error: reason(error) });
        if (spec.optional === true) { current = before; result.value = before; continue; }
        throw executionFailure(name, "hook_error", reason(error), state.retryCount + 1, undefined, error);
      }
    }
    result.value = current;
    return result;
  }

  #applyHookValue(name: ValueName, spec: InlineHookSpec, identifier: string, current: unknown, value: unknown): unknown {
    const augmentation = name === "onPrompt" || name === "onStep" || name === "onModelInput";
    if (augmentation && ((spec.fn !== undefined && spec.role !== undefined) || spec.agent !== undefined || spec.template !== undefined)) {
      const message = this.#hookMessage(value, spec.role ?? "user", identifier);
      if (name === "onModelInput" && isModelInput(current)) return { ...current, messages: [...current.messages, ...appendMessages(current.messages, [message])] };
      if (isMessageArray(current)) return [...current, ...appendMessages(current, [message])];
    }
    if (name === "onOutput" && (spec.agent !== undefined || spec.template !== undefined) && isMessage(current)) {
      const content = isMessage(value) ? value.content : [{ type: "text", text: typeof value === "string" ? value : jsonText(toJson(value) ?? null) }];
      return { id: current.id, role: "assistant", content, source: identifier };
    }
    return value;
  }

  #hookMessage(value: unknown, role: "user" | "system", source: string): Message {
    if (isMessage(value)) return { id: id(), role, content: structuredClone(value.content), source };
    if (typeof value === "string") return { id: id(), role, content: [{ type: "text", text: value }], source };
    const json = toJson(value);
    if (json === undefined) throw new Error("hook result is not JSON");
    return { id: id(), role, content: [{ type: "text", text: jsonText(json) }], source };
  }

  #asyncHookMessage(value: unknown, role: "user" | "system", source: string): Message {
    if (isMessage(value)) return { id: id(), role, content: structuredClone(value.content), source };
    if (typeof value === "string") return { id: id(), role, content: [{ type: "text", text: value }], source };
    const json = toJson(value);
    if (json === undefined) throw new Error("hook result is not JSON");
    return { id: id(), role, content: [{ type: "json", value: json }], source };
  }

  async #invokeHook(name: ValueName, spec: InlineHookSpec, identifier: string, value: unknown, state: ExecutionState, signal: AbortSignal): Promise<unknown> {
    if (spec.extension) {
      const hook = state.extensions.get(spec.extension)?.hooks?.[name];
      if (!hook) throw new Error(`extension ${spec.extension} does not provide ${name}`);
      const invocation = { active: true, allowComplete: name === "onToolResult" };
      try {
        return await hook(structuredClone(value), this.#hookContext(state, identifier, signal, name, invocation));
      } finally {
        invocation.active = false;
      }
    }
    if (spec.fn) {
      const returned = await this.#function(spec.fn, value, state, name, signal, { stage: name, source: identifier });
      if (returned !== undefined && returned !== null && toJson(returned) === undefined) {
        throw new Error("hook result is not JSON");
      }
      return returned;
    }
    if (spec.agent) {
      const names = Array.isArray(spec.agent) ? spec.agent : [spec.agent];
      const settled = await Promise.allSettled(names.map((agent) => this.#callAgent(state, agent, value, "hook", signal)));
      if (signal.aborted) throw abortFailure(signal.reason);
      const failed = settled.find((item) => item.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      const outputs = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
      if (Array.isArray(spec.agent)) return outputs.map((message) => textOf(message.content)).join("\n");
      return outputs[0];
    }
    if (spec.template) return this.#renderer.render(spec.template, this.#templateVariables(state, value));
    throw new Error("hook has no implementation");
  }

  async #withTimeout<T>(spec: InlineHookSpec, state: ExecutionState, body: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const executionSignal = AbortSignal.any([state.group.turn.controller.signal, state.group.controller.signal]);
    if (spec.timeout === undefined) return body(executionSignal);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("hook timeout")); }, spec.timeout);
      executionSignal.addEventListener("abort", () => { if (timer) clearTimeout(timer); controller.abort(); reject(abortFailure()); }, { once: true });
    });
    try { return await Promise.race([body(controller.signal), timeout]); }
    finally { if (timer) clearTimeout(timer); }
  }

  #scheduleHook(name: ValueName, spec: InlineHookSpec, identifier: string, value: unknown, state: ExecutionState): void {
    if (state.pendingHooks.has(identifier)) return;
    const controller = new AbortController();
    const detachedState = this.#asyncState(state, controller);
    this.#detachedControllers.add(controller);
    state.group.turn.session.controllers.add(controller);
    const task: AsyncHookTask = {
      sessionId: state.group.turn.session.sessionId,
      settled: false,
      promise: Promise.resolve(),
      controller,
    };
    const promise = (async () => {
      try {
        if (spec.when) {
          const condition = await this.#function(spec.when.fn, value, detachedState, `${name}.when`, controller.signal, { stage: name, source: identifier });
          if (condition === false) { await this.#observed("hook.skipped", state, { value: name, hook: identifier }); return; }
          if (condition !== true) throw new Error("hook when did not return a boolean");
        }
        const output = await this.#invokeHook(name, spec, identifier, value, detachedState, controller.signal);
        if (output !== undefined && output !== null) task.message = this.#asyncHookMessage(output, spec.role ?? "user", identifier);
        await this.#observed("hook.applied", state, { value: name, hook: identifier });
      } catch (error) {
        await this.#observed("hook.failed", state, { value: name, hook: identifier, error: reason(error) });
      } finally {
        task.settled = true;
        this.#detachedControllers.delete(controller);
        state.group.turn.session.controllers.delete(controller);
      }
    })();
    task.promise = promise;
    state.pendingHooks.set(identifier, task);
    this.#track(promise);
  }

  #asyncState(state: ExecutionState, controller: AbortController): ExecutionState {
    const turn: ActiveTurn = {
      session: state.group.turn.session,
      turnId: state.turnId,
      controller,
      deferred: new Deferred<TurnResult>(),
      actors: new Map(),
      executions: new Map(),
      functions: new Map(),
      waits: new Map(),
      runs: [],
      outputs: [],
      outputOrder: 0,
      activity: 0,
      closing: false,
    };
    const actor: Actor = { agent: state.agent, instance: state.instance, stateful: true, queue: [] };
    const group: ExecutionGroup = {
      turn,
      actor,
      executionId: state.executionId,
      requests: [],
      routeRequested: false,
      singleOutputRequested: false,
      controller,
      deferred: new Deferred<AgentRunResult>(),
    };
    return {
      ...state,
      group,
      input: cloneMessages(state.input),
      startInput: cloneMessages(state.startInput),
      conversation: cloneMessages(state.conversation),
      usage: zeroUsage(),
    };
  }

  async #drainAsync(state: ExecutionState): Promise<void> {
    const messages: Message[] = [];
    for (const [identifier, task] of state.pendingHooks) {
      if (!task.settled) break;
      if (task.message) messages.push(task.message);
      state.pendingHooks.delete(identifier);
    }
    if (messages.length > 0) await this.#appendMessages(state, appendMessages(state.conversation, messages));
  }

  #pending(instance: string): Map<string, AsyncHookTask> {
    const found = this.#pendingByInstance.get(instance);
    if (found) return found;
    const created = new Map<string, AsyncHookTask>();
    this.#pendingByInstance.set(instance, created);
    return created;
  }

  #executionContext(state: ExecutionState, signal?: AbortSignal): ExecutionContext {
    const activeSignal = signal ?? AbortSignal.any([state.group.turn.controller.signal, state.group.controller.signal]);
    const context: ExecutionContext = {
      agent: state.agent,
      sessionId: state.group.turn.session.sessionId,
      turnId: state.turnId,
      instance: state.instance,
      executionId: state.executionId,
      signal: activeSignal,
      log: this.#bindings.logger ?? noLog,
    };
    if (state.parentExecutionId !== undefined) context.parentExecutionId = state.parentExecutionId;
    if (state.operationId !== undefined) context.operationId = state.operationId;
    return context;
  }

  #hookContext(
    state: ExecutionState,
    source: string,
    signal: AbortSignal,
    stage: ValueName,
    invocation?: { active: boolean; allowComplete: boolean },
  ): HookContext {
    const context: HookContext = {
      ...this.#executionContext(state, signal),
      retryCount: state.retryCount,
      input: cloneMessages(state.input),
      conversation: cloneMessages(state.conversation),
      agents: { run: async (name, value) => this.#callAgent(state, name, value, "hook", signal) },
      model: { run: async (messages) => this.#runHookModel(state, messages, signal) },
      render: async (template, variables) => this.#renderer.render(template, variables),
      message: {
        user: (text, extra) => this.#message("user", text, source, extra),
        system: (text, extra) => this.#message("system", text, source, extra),
      },
      append: (...messages) => ({ append: cloneMessages(messages) }),
      execution: {
        complete: (message) => {
          if (!invocation?.active || !invocation.allowComplete) {
            throw new Error("execution.complete is available while a synchronous onToolResult extension hook runs");
          }
          if (!isMessage(message) || message.role !== "assistant") throw new Error("execution.complete needs an assistant message");
          if (state.completion !== undefined) throw new Error("this agent run already scheduled a message");
          state.completion = structuredClone(message);
        },
      },
    };
    if (stage === "onInput" || stage === "onPrompt") context.inputKind = state.inputKind;
    if (state.step > 0) context.step = state.step;
    return context;
  }

  #message(role: "user" | "system", text: string, source: string, extra?: { key?: string; keep?: boolean; meta?: Record<string, Json> }): Message {
    const message: Message = { id: id(), role, content: [{ type: "text", text }], source };
    if (extra?.key !== undefined) message.key = extra.key;
    if (extra?.keep !== undefined) message.keep = extra.keep;
    if (extra?.meta !== undefined) message.meta = structuredClone(extra.meta);
    return message;
  }

  async #runHookModel(state: ExecutionState, messages: Message[], signal: AbortSignal): Promise<ModelResult> {
    const modelName = state.spec.model;
    const model = modelName === undefined ? undefined : this.#bindings.models[modelName];
    if (!model) throw runtimeFailure(`No model is bound for ${state.agent}`);
    const base = await this.#modelInput(state);
    const response = await model.generate({ ...base, messages: cloneMessages(messages), options: {} }, {
      ...this.#executionContext(state, signal), step: state.step, onTextDelta() {},
    });
    const normalized = normalizeModelResponse(response, id());
    if (!normalized.value) throw new Error(normalized.issue ?? "invalid model response");
    addUsage(state.usage, normalized.value.usage);
    return normalized.value;
  }

  async #function(
    name: string,
    value: unknown,
    state: ExecutionState,
    location: string,
    signal: AbortSignal = state.group.turn.controller.signal,
    hook?: { stage: ValueName; source: string },
  ): Promise<unknown> {
    const fn: GoondanFunction | undefined = this.#bindings.functions?.[name];
    if (!fn) throw new Error(`Function ${name} is not bound`);
    const context = {
      ...this.#executionContext(state, signal),
      location,
      value: toJson(value) ?? null,
      input: cloneMessages(state.input),
      conversation: cloneMessages(state.conversation),
    };
    if (!hook) return fn(structuredClone(value), context);
    return fn(structuredClone(value), { ...context, ...this.#hookContext(state, hook.source, signal, hook.stage) });
  }

  #templateVariables(state: ExecutionState, value: unknown): Record<string, Json> {
    return {
      input: toJson(state.input) ?? null,
      inputText: inputTextOf(state.input),
      text: toJson(value) ?? null,
      params: structuredClone(state.spec.params ?? {}),
    };
  }

  async #callAgent(state: ExecutionState, target: string, value: unknown, kind: "tool" | "hook", signal?: AbortSignal): Promise<Message> {
    if (!Object.hasOwn(this.loaded.config.agents, target)) throw new Error(`Unknown agent: ${target}`);
    if (signal?.aborted) throw abortFailure(signal.reason);
    const json = toJson(value);
    if (json === undefined) throw new Error("agent input is not JSON");
    const messages = this.#rawMessages(json, target);
    const request: InputRequest = {
      target,
      messages,
      origin: kind,
      kind,
      parentExecutionId: state.executionId,
      followsRoutes: false,
      preserveMessages: isMessageArray(json),
      waiter: new Deferred<Message>(),
    };
    const actor = this.#actor(state.group.turn, target);
    const targetExecution = actor.running?.executionId;
    if (targetExecution && this.#wouldCycle(state.group.turn.session, state.executionId, targetExecution)) throw new Error("agent execution wait cycle");
    const group = this.#enqueue(state.group.turn, request);
    if (!group || !request.waiter) throw new Error("agent execution did not start");
    if (this.#wouldCycle(state.group.turn.session, state.executionId, group.executionId)) {
      const index = actor.queue.indexOf(request);
      if (index >= 0) {
        actor.queue.splice(index, 1);
        this.#releaseRequest(request);
      }
      throw new Error("agent execution wait cycle");
    }
    const edges = state.group.turn.session.waits.get(state.executionId) ?? new Set<string>();
    edges.add(group.executionId);
    state.group.turn.session.waits.set(state.executionId, edges);
    const cancelled = new Promise<Message>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        const queued = actor.queue.indexOf(request);
        if (queued >= 0) {
          actor.queue.splice(queued, 1);
          this.#releaseRequest(request);
        }
        const exclusive = actor.running === group && group.requests.length === 1 && actor.queue.length === 0
          && !group.routeRequested && !group.singleOutputRequested;
        if (exclusive) group.controller.abort(abortFailure(signal.reason));
        reject(abortFailure(signal.reason));
      }, { once: true });
    });
    try { return signal ? await Promise.race([request.waiter.promise, cancelled]) : await request.waiter.promise; }
    finally { edges.delete(group.executionId); }
  }

  #releaseRequest(request: InputRequest): void {
    if (!request.reserved || request.turn === undefined) return;
    request.reserved = undefined;
    request.turn.activity -= 1;
    void this.#maybeClose(request.turn);
  }

  #wouldCycle(session: SessionRuntime, from: string, to: string): boolean {
    if (from === to) return true;
    const seen = new Set<string>();
    const visit = (node: string): boolean => {
      if (node === from) return true;
      if (seen.has(node)) return false;
      seen.add(node);
      for (const next of session.waits.get(node) ?? []) if (visit(next)) return true;
      return false;
    };
    return visit(to);
  }

  #toolContext(state: ExecutionState, call: ToolCall, execution?: Record<string, Json>): ToolContext {
    return {
      ...this.#executionContext(state),
      input: cloneMessages(state.input),
      conversation: cloneMessages(state.conversation),
      toolCall: structuredClone(call),
      execution: structuredClone(execution ?? {}),
      agents: { run: async (name, value) => this.#callAgent(state, name, value, "tool", this.#executionContext(state).signal) },
    };
  }

  async #tools(state: ExecutionState): Promise<ToolEntry[]> {
    const extensionTools = new Map<string, Tool>();
    for (const instance of state.extensions.values()) for (const tool of instance.tools ?? []) extensionTools.set(tool.name, tool);
    const entries: ToolEntry[] = [];
    for (const declared of state.spec.tools ?? []) {
      const resolved = toolEntry(declared);
      if (!resolved) continue;
      const use = typeof declared === "string" ? undefined : declared;
      const hint = use?.hint ? `\n${use.hint}` : "";
      if (resolved.agent) {
        const target = this.loaded.config.agents[resolved.name];
        entries.push({
          name: resolved.name,
          definition: { name: resolved.name, description: `${target?.description ?? `Run ${resolved.name}`}${hint}`, input: { type: "object" } },
          approval: use?.approval === "required",
          agent: resolved.name,
        });
      } else {
        const tool = this.#bindings.tools?.[resolved.name] ?? extensionTools.get(resolved.name);
        if (!tool) continue;
        entries.push({
          name: resolved.name,
          definition: { name: resolved.name, description: `${tool.description}${hint}`, input: tool.input },
          approval: use?.approval === "required",
          host: tool,
        });
      }
    }
    return entries;
  }

  async #extensions(agent: string, spec: AgentSpec, sessionId: string, instanceId: string, cache: boolean): Promise<Map<string, ExtensionInstance>> {
    const key = scopeKey(sessionId, agent);
    if (cache) {
      const found = this.#instances.get(key);
      if (found) return found;
    }
    const instances = new Map<string, ExtensionInstance>();
    try {
      for (const name of enabledExtensions(spec)) {
        const definition = this.#bindings.extensions?.[name];
        if (!definition) continue;
        const use = spec.extensions?.[name];
        let options: Json = use?.options ?? {};
        if (definition.options) options = (await definition.options.validate(options)) ?? options;
        const ports: Record<string, unknown> = {};
        for (const port of definition.requires ?? []) if (this.#bindings.ports && Object.hasOwn(this.#bindings.ports, port)) ports[port] = this.#bindings.ports[port];
        const created = await definition.create({ options, ports, agent: { name: agent, spec }, log: this.#bindings.logger ?? noLog });
        instances.set(name, created);
      }
      const provided = new Map<string, ProvidedExtension>();
      for (const [name, instance] of instances) provided.set(name, { stages: Object.keys(instance.hooks ?? {}), tools: (instance.tools ?? []).map((tool) => tool.name) });
      raiseIssues(instanceIssues(agent, spec, this.#bindings, provided));
    } catch (error) {
      await this.#dispose(instances);
      throw error;
    }
    if (cache) this.#instances.set(key, instances);
    void instanceId;
    return instances;
  }

  async #dispose(instances: ReadonlyMap<string, ExtensionInstance>): Promise<void> {
    for (const instance of instances.values()) try { await instance.dispose?.(); } catch { /* 정리 실패는 실행 결과를 바꾸지 않습니다. */ }
  }

  async #appendMessages(state: ExecutionState, messages: readonly Message[]): Promise<void> {
    if (messages.length === 0) return;
    const events = messages.map((message) => this.#event(state.group.turn.session.sessionId, "conversation.message.appended", { message }, this.#scope(state)));
    await this.#append(state.group.turn.session, events);
    state.conversation.push(...cloneMessages(messages));
  }

  async #replaceMessage(state: ExecutionState, messageId: string, message: Message): Promise<void> {
    await this.#append(state.group.turn.session, [this.#event(state.group.turn.session.sessionId, "conversation.message.replaced", { messageId, message }, this.#scope(state))]);
    const index = state.conversation.findIndex((item) => item.id === messageId);
    if (index >= 0) state.conversation[index] = structuredClone(message);
  }

  async #replaceConversation(state: ExecutionState, next: Message[]): Promise<void> {
    if (jsonEqual(state.conversation, next)) return;
    const events = this.#conversationDiff(state, state.conversation, next);
    await this.#append(state.group.turn.session, events);
    state.conversation = cloneMessages(next);
  }

  #conversationDiff(state: ExecutionState, before: readonly Message[], after: readonly Message[]): NewJournalEvent[] {
    const event = (type: string, data: unknown): NewJournalEvent => this.#event(state.group.turn.session.sessionId, type, data, this.#scope(state));
    const suffix = before.length >= after.length && jsonEqual(before.slice(before.length - after.length), after);
    if (suffix) return [event("conversation.truncated", { keepLast: after.length })];
    const beforeIds = before.map((message) => message.id);
    const afterIds = after.map((message) => message.id);
    if (jsonEqual(beforeIds, afterIds)) return after.flatMap((message, index) => jsonEqual(message, before[index]) ? [] : [event("conversation.message.replaced", { messageId: message.id, message })]);
    const prefix = jsonEqual(beforeIds, afterIds.slice(0, beforeIds.length));
    if (prefix) {
      const events: NewJournalEvent[] = [];
      before.forEach((message, index) => { if (!jsonEqual(message, after[index])) events.push(event("conversation.message.replaced", { messageId: message.id, message: after[index] })); });
      after.slice(before.length).forEach((message) => events.push(event("conversation.message.appended", { message })));
      return events;
    }
    return [
      ...before.map((message) => event("conversation.message.removed", { messageId: message.id })),
      ...after.map((message) => event("conversation.message.appended", { message })),
    ];
  }

  async #routeFrom(
    turn: ActiveTurn,
    source: string,
    output: Message,
    instance: string,
    finishReason: FinishReason,
    input: Message[],
  ): Promise<void> {
    const routes = this.loaded.config.routes;
    if (!routes) return;
    const candidates: Array<{ route: RouteSpec; index: number }> = [];
    const matching: Array<{ route: RouteSpec; index: number }> = [];
    for (const [index, route] of routes.entries()) {
      if (!sameEndpoint(route.from, source)) continue;
      candidates.push({ route, index });
      if (!await this.#routeMatches(route, output, input, turn)) continue;
      matching.push({ route, index });
    }
    if (candidates.length > 0 && matching.length === 0) throw routeFailure(`no route matched ${source}`);
    await Promise.all(matching.map(async ({ route, index }) => {
      const messages: Message[] = typeof route.to === "string" && route.to !== "$output"
        ? [{ id: id(), role: "user", content: structuredClone(output.content), source: route.to, meta: { from: source, instance } }]
        : [structuredClone(output)];
      await this.#routeTarget(turn, route.to, messages, index, source, instance, finishReason, true);
    }));
    this.#scheduleReady(turn);
  }

  async #routeTarget(
    turn: ActiveTurn,
    target: RouteEndpoint,
    messages: Message[],
    routeIndex: number,
    source: string,
    sourceInstance: string | undefined,
    finishReason: FinishReason,
    deferRouteStart = false,
    preserveMessages = false,
  ): Promise<void> {
    if (target === "$output") {
      for (const message of messages) turn.outputs.push({ route: routeIndex, order: turn.outputOrder++, message: structuredClone(message), finishReason });
      return;
    }
    if (typeof target === "string") {
      const routed = sourceInstance === undefined && source !== "$input"
        ? messages.map((message) => ({ ...structuredClone(message), meta: { from: source } }))
        : cloneMessages(messages);
      this.#enqueue(turn, {
        target,
        messages: routed,
        origin: "route",
        kind: "turn",
        routeIndex,
        routeSource: source,
        followsRoutes: true,
        preserveMessages,
      }, deferRouteStart);
      return;
    }
    const task = this.#runRouteFunction(turn, target.fn, messages, routeIndex, sourceInstance)
      .catch((error: unknown) => { this.#failTurn(turn, error); });
    this.#track(task);
  }

  async #runRouteFunction(turn: ActiveTurn, fnName: string, input: Message[], routeIndex: number, _sourceInstance?: string): Promise<void> {
    const fn = this.#bindings.functions?.[fnName];
    if (!fn) throw routeFailure(`Function ${fnName} is not bound`);
    turn.activity += 1;
    const functionKey = `@fn:${fnName}`;
    turn.functions.set(functionKey, (turn.functions.get(functionKey) ?? 0) + 1);
    try {
      let output: Message[] | undefined;
      try {
        const returned = await fn(cloneMessages(input), { sessionId: turn.session.sessionId, turnId: turn.turnId, route: routeIndex, signal: turn.controller.signal, log: this.#bindings.logger ?? noLog });
        if (returned !== undefined && returned !== null) {
          if (!isMessageArray(returned)) throw new Error("route function did not return messages");
          output = returned;
        }
        await this.#append(turn.session, [this.#event(turn.session.sessionId, "route.function", { route: routeIndex, fn: fnName, status: "done", input, ...(output === undefined ? {} : { output }) }, { turnId: turn.turnId })]);
      } catch (error) {
        const failure = routeFailure(reason(error), error);
        await this.#append(turn.session, [this.#event(turn.session.sessionId, "route.function", { route: routeIndex, fn: fnName, status: "error", input, error: detail(failure, 1) }, { turnId: turn.turnId })]);
        this.#failTurn(turn, failure);
        throw failure;
      }
      if (!output) return;
      const routes = this.loaded.config.routes ?? [];
      const matching: Array<{ route: RouteSpec; index: number }> = [];
      let candidateCount = 0;
      for (const [index, route] of routes.entries()) {
        if (!sameEndpoint(route.from, functionKey)) continue;
        candidateCount += 1;
        if (await this.#routeMatches(route, output, input, turn)) matching.push({ route, index });
      }
      if (candidateCount > 0 && matching.length === 0) throw routeFailure(`no route matched ${fnName}`);
      await Promise.all(matching.map((item) => this.#routeTarget(turn, item.route.to, cloneMessages(output), item.index, fnName, undefined, "stop", true)));
    } finally {
      const remaining = (turn.functions.get(functionKey) ?? 1) - 1;
      if (remaining === 0) turn.functions.delete(functionKey); else turn.functions.set(functionKey, remaining);
      this.#scheduleReady(turn);
      await this.#activityDone(turn);
    }
  }

  async #routeMatches(route: RouteSpec, output: Message | Message[] | null, input: EntryMessage[], turn: ActiveTurn): Promise<boolean> {
    if (!route.when) return true;
    const text = output === null
      ? inputTextOf(input)
      : Array.isArray(output)
      ? output.map((message) => textOf(message.content)).join("")
      : textOf(output.content);
    if ("output" in route.when) {
      if (typeof route.when.output === "string") return text === route.when.output;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!isRecord(parsed)) return false;
        return Object.entries(route.when.output).every(([key, value]) => Object.hasOwn(parsed, key) && jsonEqual(parsed[key], value));
      } catch { return false; }
    }
    const fn = this.#bindings.functions?.[route.when.fn];
    if (!fn) throw routeFailure(`Function ${route.when.fn} is not bound`);
    try {
      const value = await fn({ output, text, input }, { sessionId: turn.session.sessionId, turnId: turn.turnId, route: this.loaded.config.routes?.indexOf(route) ?? -1, signal: turn.controller.signal, log: this.#bindings.logger ?? noLog });
      if (value !== true && value !== false) throw new Error("route condition did not return a boolean");
      return value;
    } catch (error) { throw routeFailure(reason(error), error); }
  }

  async #activityDone(turn: ActiveTurn): Promise<void> {
    turn.activity -= 1;
    await this.#maybeClose(turn);
  }

  async #maybeClose(turn: ActiveTurn): Promise<void> {
    if (turn.closing || turn.activity > 0) return;
    if ([...turn.actors.values()].some((actor) => actor.running?.turn === turn || actor.queue.some((request) => request.turn === turn))) return;
    turn.closing = true;
    await turn.session.mutex.run(async () => {
      if (turn.session.turn !== turn) return;
      try {
        if (turn.failed !== undefined || turn.controller.signal.aborted) await this.#closeFailedTurn(turn);
        else await this.#closeSuccessfulTurn(turn);
      } catch (error) {
        const failure = turn.session.leaseFailure ?? this.#asExecutionError(error);
        turn.deferred.reject(failure);
      } finally {
        turn.session.turn = undefined;
        if ((this.#sessionWork.get(turn.session.sessionId) ?? 0) === 0) {
          await this.#releaseLease(turn.session);
        }
      }
    });
  }

  async #closeSuccessfulTurn(turn: ActiveTurn): Promise<void> {
    turn.outputs.sort((left, right) => left.route - right.route || left.order - right.order);
    const outputs = turn.outputs.map((entry) => entry.message);
    const runs = flattenRuns(turn.runs);
    const result: TurnResult = { turnId: turn.turnId, outputs, usage: totalUsage(runs), status: "done", runs };
    if (outputs.length > 0) {
      result.output = outputs.map((message) => textOf(message.content)).join("\n\n");
      const reasons = new Set(turn.outputs.map((entry) => entry.finishReason));
      result.finishReason = reasons.size === 1 ? turn.outputs[0]?.finishReason ?? "other" : "other";
    }
    await this.#append(turn.session, [this.#event(turn.session.sessionId, "turn.done", { result }, { turnId: turn.turnId })]);
    turn.deferred.resolve(result);
  }

  async #closeFailedTurn(turn: ActiveTurn): Promise<void> {
    const signalReason = turn.controller.signal.reason;
    const failure = turn.controller.signal.aborted
      ? signalReason instanceof GoondanExecutionError ? signalReason : abortFailure(turn.failed)
      : this.#asExecutionError(turn.failed);
    await this.#append(turn.session, [this.#event(turn.session.sessionId, "turn.error", {
      status: failure.codes.includes("aborted") ? "aborted" : "failed",
      error: detail(failure, 1),
    }, { turnId: turn.turnId })]);
    turn.deferred.reject(turn.failed instanceof GoondanConfigError ? turn.failed : failure);
  }

  #failTurn(turn: ActiveTurn, error: unknown): void {
    if (turn.failed !== undefined) return;
    turn.failed = error;
    for (const actor of turn.actors.values()) {
      const retained: InputRequest[] = [];
      for (const request of actor.queue) {
        if (request.turn !== turn) { retained.push(request); continue; }
        request.waiter?.reject(error);
        this.#releaseRequest(request);
      }
      actor.queue = retained;
    }
    for (const group of turn.executions.values()) if (group.state?.executionId !== this.#executionIdOf(error)) group.controller.abort(error);
  }

  #executionIdOf(_error: unknown): string | undefined { return undefined; }

  #asExecutionError(error: unknown, where: "model" | "tool" | "runtime" = "runtime", codes: string[] = ["runtime_error"], toolCall?: ToolCall): GoondanExecutionError {
    if (error instanceof GoondanExecutionError) return error;
    return new GoondanExecutionError({ where, codes, message: reason(error), attempt: 1, toolCall }, { cause: error });
  }

  async #observed(type: ObservationalEvent["type"], state: ExecutionState, data: Record<string, unknown>): Promise<void> {
    const event: ObservationalEvent = {
      type,
      sessionId: state.group.turn.session.sessionId,
      turnId: state.turnId,
      agent: state.agent,
      instance: state.instance,
      executionId: state.executionId,
      at: Date.now(),
      data,
      observational: true,
    };
    if (state.parentExecutionId !== undefined) event.parentExecutionId = state.parentExecutionId;
    if (state.operationId !== undefined) event.operationId = state.operationId;
    await this.#emit(event, state.extensions);
  }

  async #emit(event: RuntimeEvent, extensions?: ReadonlyMap<string, ExtensionInstance>): Promise<void> {
    try { await this.#bindings.host?.emit?.(structuredClone(event)); } catch { /* 관측 수신자 실패는 실행을 바꾸지 않습니다. */ }
    const targets = extensions ?? (event.instance ? this.#instances.get(scopeKey(event.sessionId, event.agent ?? "")) : undefined);
    if (!targets) return;
    for (const instance of targets.values()) {
      const receiver = instance.on?.[event.type];
      try { await receiver?.(structuredClone(event)); } catch { /* 관측 수신자 실패는 실행을 바꾸지 않습니다. */ }
    }
  }

  #track(task: Promise<void>): void {
    this.#tasks.add(task);
    void task.then(
      () => this.#tasks.delete(task),
      () => this.#tasks.delete(task),
    );
  }

  #beginSessionWork(sessionId: string): void {
    this.#sessionWork.set(sessionId, (this.#sessionWork.get(sessionId) ?? 0) + 1);
  }

  #endSessionWork(sessionId: string): void {
    const remaining = (this.#sessionWork.get(sessionId) ?? 1) - 1;
    if (remaining === 0) this.#sessionWork.delete(sessionId);
    else this.#sessionWork.set(sessionId, remaining);
  }

  async #releaseIdleLease(session: SessionRuntime): Promise<void> {
    await session.mutex.run(async () => {
      if (session.turn || (this.#sessionWork.get(session.sessionId) ?? 0) > 0) return;
      await this.#releaseLease(session);
    });
  }

  // 승인 작업 메서드는 아래 절에서 저널 전이와 완료 입력 전달을 구현합니다.
  async #createOperation(state: ExecutionState, call: ToolCall, reasons: string[], execution?: Record<string, Json>): Promise<void> {
    const operation = newOperation({
      operationId: id(), agent: state.agent, sessionId: state.group.turn.session.sessionId,
      turnId: state.turnId, instance: state.instance, executionId: state.executionId,
      parentExecutionId: state.parentExecutionId, toolCall: call, reasons, execution, now: Date.now(),
    });
    const pending: ToolResult = {
      callId: call.id, name: call.name, args: structuredClone(call.args),
      content: [{ type: "json", value: pendingToolContent(operation.operationId) }],
      meta: pendingToolContent(operation.operationId),
    };
    const message: Message = {
      id: id(), role: "tool", source: "tool",
      content: [{ type: "tool.result", callId: call.id, content: pending.content }],
      meta: pending.meta,
    };
    await this.#append(state.group.turn.session, [
      this.#operationEvent(operation, "operation.created", { operation }),
      this.#event(operation.sessionId, "conversation.message.appended", { message }, this.#scope(state)),
    ]);
    state.conversation.push(message);
  }

  #operationEvent(operation: PendingOperation, type: string, data: unknown): NewJournalEvent {
    return this.#event(operation.sessionId, type, data, {
      turnId: operation.turnId, agent: operation.agent, instance: operation.instance,
      executionId: operation.executionId, operationId: operation.operationId,
      parentExecutionId: operation.parentExecutionId,
    });
  }

  async #listOperations(sessionId?: string): Promise<PendingOperation[]> {
    if (sessionId !== undefined) {
      const events: JournalEvent[] = [];
      for await (const event of this.#store.scan({ sessionId })) events.push(event);
      return structuredClone(fold(sessionId, events).operations);
    }
    const bySession = new Map<string, JournalEvent[]>();
    for await (const event of this.#store.scan()) {
      const list = bySession.get(event.sessionId) ?? [];
      list.push(event);
      bySession.set(event.sessionId, list);
    }
    const operations: PendingOperation[] = [];
    for (const [key, events] of bySession) operations.push(...fold(key, events).operations);
    return structuredClone(operations.sort((left, right) => left.createdAt - right.createdAt || compareText(left.sessionId, right.sessionId)));
  }

  async #decideOperation(sessionId: string, operationId: string, value: OperationDecision): Promise<PendingOperation> {
    if (this.#closed) throw runtimeFailure("The runtime is closed");
    const issue = decisionIssue(value);
    if (issue) throw operationFailure(issue);
    const session = this.#session(sessionId);
    return session.mutex.run(async () => {
      await this.#load(session);
      const ownLease = !session.lease;
      if (ownLease) this.#installLease(session, await this.#waitLease(sessionId));
      try {
        await this.#refresh(session);
        const operation = session.state.operations.find((item) => item.operationId === operationId);
        if (!operation) throw operationFailure("operation does not exist");
        if (operation.status !== "pending") return structuredClone(operation);
        const patchProblem = patchIssue(value, operation);
        if (patchProblem) throw operationFailure(patchProblem);
        let resolved: ToolCall | undefined;
        if (value.inputPatch !== undefined) {
          resolved = patchedCall(operation.toolCall, value.inputPatch);
          if (!resolved || !await this.#validOperationCall(operation, resolved)) throw operationFailure("operation inputPatch does not satisfy the tool schema");
        }
        const data: Record<string, unknown> = { updatedAt: Date.now() };
        if (value.inputPatch !== undefined && resolved !== undefined) { data.inputPatch = value.inputPatch; data.resolvedToolCall = resolved; }
        const type = value.decision === "approved" ? "operation.approved" : value.decision === "rejected" ? "operation.rejected" : "operation.cancelled";
        await this.#append(session, [this.#operationEvent(operation, type, data)]);
        const updated = session.state.operations.find((item) => item.operationId === operationId);
        if (!updated) throw operationFailure("operation disappeared");
        if (updated.status === "approved") this.#track(this.#executeOperation(structuredClone(updated)));
        else this.#track(this.#deliverOperation(structuredClone(updated)));
        return structuredClone(updated);
      } finally {
        if (ownLease) await this.#releaseLease(session);
      }
    });
  }

  async #refresh(session: SessionRuntime): Promise<void> {
    await session.appendMutex.run(async () => {
      const events: JournalEvent[] = [];
      for await (const event of this.#store.scan({ sessionId: session.sessionId })) events.push(event);
      session.events = events;
      session.state = fold(session.sessionId, events);
    });
  }

  async #validOperationCall(operation: PendingOperation, call: ToolCall): Promise<boolean> {
    const spec = this.loaded.config.agents[operation.agent];
    if (!spec) return false;
    const fake = await this.#operationState(operation, spec);
    try {
      const entry = (await this.#tools(fake)).find((item) => item.name === call.name);
      return entry !== undefined && validateJsonValue(entry.definition.input, call.args).length === 0;
    } finally { if (spec.stateful === false) await this.#dispose(fake.extensions); }
  }

  async #operationState(operation: PendingOperation, spec: AgentSpec, controller = new AbortController()): Promise<ExecutionState> {
    const turn: ActiveTurn = {
      session: this.#session(operation.sessionId), turnId: operation.turnId, controller,
      deferred: new Deferred<TurnResult>(), actors: new Map(), executions: new Map(), functions: new Map(), waits: new Map(), runs: [], outputs: [], outputOrder: 0, activity: 0, closing: false,
    };
    const actor: Actor = { agent: operation.agent, instance: spec.stateful === false ? id() : operation.instance, stateful: spec.stateful !== false, queue: [] };
    const group: ExecutionGroup = { turn, actor, executionId: operation.executionId, requests: [], routeRequested: false, singleOutputRequested: false, controller, deferred: new Deferred<AgentRunResult>() };
    const extensions = await this.#extensions(operation.agent, spec, operation.sessionId, actor.instance, spec.stateful !== false);
    const conversation = spec.stateful === false ? [] : cloneMessages(turn.session.state.conversations
      .find((item) => item.agent === operation.agent && item.instance === operation.instance)?.messages ?? []);
    const state: ExecutionState = {
      group, agent: operation.agent, spec, instance: actor.instance, executionId: operation.executionId,
      turnId: operation.turnId, operationId: operation.operationId, input: [], startInput: [], conversation, inputKind: "start",
      step: 0, retryCount: 0, usage: zeroUsage(), extensions, pendingHooks: this.#pending(actor.instance),
      runNode: { record: { agent: operation.agent, instance: actor.instance, executionId: operation.executionId, turnId: operation.turnId, operationId: operation.operationId, kind: "tool", usage: zeroUsage(), status: "failed" }, children: [] },
    };
    return state;
  }

  async #executeOperation(operation: PendingOperation): Promise<void> {
    const controller = new AbortController();
    this.#detachedControllers.add(controller);
    this.#beginSessionWork(operation.sessionId);
    const session = this.#session(operation.sessionId);
    session.controllers.add(controller);
    try {
      await session.mutex.run(async () => {
        if (controller.signal.aborted || this.#closed) throw abortFailure(controller.signal.reason);
        await this.#load(session);
        if (!session.lease) this.#installLease(session, await this.#waitLease(operation.sessionId, controller.signal));
      });
      if (controller.signal.aborted || this.#closed) return;
      await this.#refresh(session);
      if (controller.signal.aborted || this.#closed) return;
      const current = session.state.operations.find((item) => item.operationId === operation.operationId);
      if (!current || current.status !== "approved") return;
      const call = effectiveCall(current);
      const spec = this.loaded.config.agents[current.agent];
      if (!spec || !await this.#validOperationCall(current, call)) {
        if (controller.signal.aborted || this.#closed) return;
        await this.#append(session, [this.#operationEvent(current, "operation.failed", { updatedAt: Date.now(), error: validationFailedMessage, errorCode: "validation_failed" })]);
        const failed = session.state.operations.find((item) => item.operationId === current.operationId);
        if (failed && !controller.signal.aborted && !this.#closed) this.#track(this.#deliverOperation(structuredClone(failed)));
        return;
      }
      if (controller.signal.aborted || this.#closed) return;
      await this.#append(session, [this.#operationEvent(current, "operation.execution.started", { updatedAt: Date.now() })]);
      if (controller.signal.aborted || this.#closed) return;
      const state = await this.#operationState(current, spec, controller);
      state.input = [];
      const entry = (await this.#tools(state)).find((item) => item.name === call.name);
      if (!entry) throw new Error(validationFailedMessage);
      await this.#observed("tool.start", state, { tool: call.name, callId: call.id, args: call.args });
      try {
        const returned = entry.agent
          ? { content: (await this.#callOperationAgent(current, entry.agent, call.args, controller.signal)).content }
          : await entry.host?.execute(call.args, { ...this.#toolContext(state, call, current.execution), input: { type: "operation_execution", operationId: current.operationId } });
        if (controller.signal.aborted || this.#closed) return;
        const normalized = normalizeToolReturn(returned, call);
        if (!normalized.value) throw new Error(normalized.issue ?? "invalid tool result");
        const stage = await this.#hooks("onToolResult", normalized.value, state, call.id);
        if (!isToolResult(stage.value)) throw new Error("onToolResult did not return a tool result");
        if (controller.signal.aborted || this.#closed) return;
        await this.#append(session, [this.#operationEvent(current, "operation.completed", { updatedAt: Date.now(), result: stage.value })]);
        await this.#observed("tool.done", state, { tool: call.name, callId: call.id, args: call.args, result: stage.value });
      } catch (error) {
        if (controller.signal.aborted || this.#closed) return;
        await this.#append(session, [this.#operationEvent(current, "operation.failed", { updatedAt: Date.now(), error: reason(error), errorCode: "execution_failed" })]);
        await this.#observed("tool.error", state, { tool: call.name, callId: call.id, args: call.args, codes: ["tool_error"], error: reason(error) });
      } finally { if (spec.stateful === false) await this.#dispose(state.extensions); }
      const ended = session.state.operations.find((item) => item.operationId === current.operationId);
      if (ended && !controller.signal.aborted && !this.#closed) this.#track(this.#deliverOperation(structuredClone(ended)));
    } finally {
      this.#detachedControllers.delete(controller);
      session.controllers.delete(controller);
      this.#endSessionWork(operation.sessionId);
      await this.#releaseIdleLease(session);
    }
  }

  async #callOperationAgent(operation: PendingOperation, target: string, value: Json, signal: AbortSignal): Promise<Message> {
    const session = this.#session(operation.sessionId);
    let turn = session.turn;
    if (!turn) {
      turn = {
        session, turnId: operation.turnId, controller: new AbortController(), deferred: new Deferred<TurnResult>(),
        actors: new Map(), executions: new Map(), functions: new Map(), waits: new Map(), runs: [], outputs: [], outputOrder: 0, activity: 0, closing: false,
      };
      signal.addEventListener("abort", () => turn?.controller.abort(abortFailure(signal.reason)), { once: true });
    }
    const waiter = new Deferred<Message>();
    const request: InputRequest = { target, messages: this.#rawMessages(value, target), origin: "operation", kind: "tool", operationId: operation.operationId, followsRoutes: false, waiter };
    const group = this.#enqueue(turn, request);
    if (!group) throw new Error("operation agent did not start");
    const cancelled = new Promise<Message>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const queued = group.actor.queue.indexOf(request);
        if (queued >= 0) group.actor.queue.splice(queued, 1);
        if (group.requests.length === 1 && group.actor.queue.length === 0 && !group.routeRequested && !group.singleOutputRequested) {
          group.controller.abort(abortFailure(signal.reason));
        }
        reject(abortFailure(signal.reason));
      }, { once: true });
    });
    return Promise.race([waiter.promise, cancelled]);
  }

  #completionValue(operation: PendingOperation): Record<string, unknown> {
    const value: Record<string, unknown> = {
      type: "operation_completion", deliveryId: operation.deliveryId, operationId: operation.operationId,
      sessionId: operation.sessionId, agent: operation.agent, turnId: operation.turnId,
      instance: operation.instance, executionId: operation.executionId, status: operation.status,
      toolCall: operation.toolCall,
    };
    if (operation.result !== undefined) value.result = operation.result;
    if (operation.error !== undefined) value.error = operation.error;
    if (operation.errorCode !== undefined) value.errorCode = operation.errorCode;
    return value;
  }

  async #deliverOperation(operation: PendingOperation): Promise<void> {
    if (!isTerminalStatus(operation.status)) return;
    const controller = new AbortController();
    this.#detachedControllers.add(controller);
    this.#beginSessionWork(operation.sessionId);
    const session = this.#session(operation.sessionId);
    session.controllers.add(controller);
    try {
      await session.mutex.run(async () => {
        if (controller.signal.aborted || this.#closed) return;
        await this.#load(session);
        if (!session.lease) this.#installLease(session, await this.#waitLease(operation.sessionId, controller.signal));
        if (controller.signal.aborted || this.#closed) return;
        await this.#refresh(session);
        if (controller.signal.aborted || this.#closed) return;
        let current = session.state.operations.find((item) => item.operationId === operation.operationId);
        if (!current) {
          await this.#orphaned(operation);
          return;
        }
        if (current.deliveryStatus !== "pending") return;
        await this.#append(session, [this.#operationEvent(current, "operation.delivery.claimed", { updatedAt: Date.now() })]);
        if (controller.signal.aborted || this.#closed) return;
        current = session.state.operations.find((item) => item.operationId === operation.operationId);
        if (!current) return;
        const inputId = id();
        let turn = session.turn;
        if (!turn) {
          turn = {
            session, turnId: id(), controller: new AbortController(), deferred: new Deferred<TurnResult>(), actors: new Map(), executions: new Map(), functions: new Map(), waits: new Map(), runs: [], outputs: [], outputOrder: 0, activity: 0, closing: false,
          };
          session.turn = turn;
          controller.signal.addEventListener("abort", () => turn?.controller.abort(abortFailure(controller.signal.reason)), { once: true });
          await this.#append(session, [
            this.#event(session.sessionId, "turn.start", {}, { turnId: turn.turnId }),
            this.#event(session.sessionId, "input.received", { input: this.#completionValue(current) }, { turnId: turn.turnId, inputId, operationId: current.operationId }),
          ]);
        } else await this.#append(session, [this.#event(session.sessionId, "input.received", { input: this.#completionValue(current) }, { turnId: turn.turnId, inputId, operationId: current.operationId })]);
        if (controller.signal.aborted || this.#closed) return;
        const message: Message = { id: id(), role: "user", source: current.agent, content: [{ type: "json", value: toJson(this.#completionValue(current)) ?? null }], meta: { operationId: current.operationId } };
        this.#enqueue(turn, { target: current.agent, messages: [message], origin: "operation", kind: "turn", operationId: current.operationId, followsRoutes: false });
        await this.#append(session, [this.#operationEvent(current, "operation.delivery.finished", { updatedAt: Date.now(), outcome: "delivered", deliveredAt: Date.now() })]);
        queueMicrotask(() => { if (turn) void this.#maybeClose(turn); });
      });
    } finally {
      this.#detachedControllers.delete(controller);
      session.controllers.delete(controller);
      this.#endSessionWork(operation.sessionId);
      await this.#releaseIdleLease(session);
    }
  }

  async #orphaned(operation: PendingOperation): Promise<void> {
    const event: ObservationalEvent = {
      type: "operation.completion.orphaned", sessionId: operation.sessionId, operationId: operation.operationId,
      at: Date.now(), data: { operationId: operation.operationId, deliveryId: operation.deliveryId }, observational: true,
    };
    await this.#emit(event);
  }

  async #deleteSession(sessionId: string): Promise<void> {
    if (this.#closed) throw runtimeFailure("The runtime is closed");
    const session = this.#session(sessionId);
    await session.mutex.run(async () => {
      await this.#load(session);
      if (session.turn || (this.#sessionWork.get(sessionId) ?? 0) > 0
        || session.state.operations.some((operation) => operation.status === "running" || operation.deliveryStatus === "delivering")) {
        throw runtimeFailure("the session has active work");
      }
      const lease = await this.#store.acquireLease(sessionId, id());
      if (!lease) throw runtimeFailure("the session lease is held");
      try {
        await this.#refresh(session);
        if (session.state.turns.some((turn) => turn.status === "running") || session.state.operations.some((operation) => operation.status === "running" || operation.deliveryStatus === "delivering")) throw runtimeFailure("the session has active work");
        const pending: Promise<void>[] = [];
        for (const tasks of this.#pendingByInstance.values()) {
          for (const task of tasks.values()) {
            if (task.sessionId !== sessionId) continue;
            task.controller.abort(abortFailure());
            pending.push(task.promise);
          }
        }
        await Promise.allSettled(pending);
        for (const [instance, tasks] of this.#pendingByInstance) {
          for (const [identifier, task] of tasks) if (task.sessionId === sessionId) tasks.delete(identifier);
          if (tasks.size === 0) this.#pendingByInstance.delete(instance);
        }
        for (const [key, instances] of this.#instances) {
          if (!key.startsWith(`[${JSON.stringify(sessionId)},`)) continue;
          await this.#dispose(instances);
          this.#instances.delete(key);
        }
        await this.#store.deleteSession(sessionId, { token: lease.token });
        session.events = [];
        session.state = fold(sessionId, []);
        session.recovered = false;
      } finally { await lease.release(); }
    });
  }
}

export function createGoondan(config: LoadedConfig | unknown, bindings: RuntimeBindings): Goondan {
  return new Goondan(config, bindings);
}
