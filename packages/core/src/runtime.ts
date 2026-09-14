import { TemplateRenderer } from "./template.ts";
import { MemoryConversationStore, MemoryOperationStore } from "./store.ts";
import { loadConfig } from "./config.ts";
import { resolve } from "node:path";
import {
  type AgentRunResult, type AgentSpec, type Append, type ExtensionInstance, type HookContext,
  type HookResult, type InlineHookSpec, type Json, type LoadedConfig, type Message, type GoondanFunction,
  type ModelInput, type ModelResult, type Part, type RunOptions, type RuntimeBindings, type RuntimeEvent,
  type RuntimeEventName, type OperationCompletion, type OperationDecision, type PendingOperation, type Tool, type ToolCall, type ToolExecution, type ToolResult, type TurnError,
  type Usage, type ValueName,
} from "./types.ts";

type Listener = (event: RuntimeEvent) => Promise<void> | void;
const noLog = { info() {}, warn() {}, error() {} };
type PipelineValue = HookResult | TurnError;

class RuntimeFailure extends Error {
  constructor(readonly detail: Omit<TurnError, "attempt">, options?: ErrorOptions) { super(detail.message, options); this.name = "RuntimeFailure"; }
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isAppend(value: unknown): value is Append { return isObject(value) && "append" in value && Array.isArray(value.append); }
function isRetry(value: unknown): value is { retry: true; target: "model" | "tool"; conversation?: Message[]; afterMs?: number } { return isObject(value) && "retry" in value && value.retry === true && "target" in value && (value.target === "model" || value.target === "tool"); }
function isFail(value: unknown): value is { fail: true } { return isObject(value) && "fail" in value && value.fail === true; }
function isApproval(value: unknown): value is { approval: { reason: string } } { return isObject(value) && "approval" in value && isObject(value.approval) && typeof value.approval.reason === "string"; }
function hasToolResult(value: unknown): value is { result: ToolResult } { return isObject(value) && "result" in value && isObject(value.result) && typeof value.result.callId === "string"; }
function isToolExecution(value: unknown): value is ToolExecution { return isObject(value) && "call" in value && isObject(value.call) && typeof value.call.id === "string"; }
function isMessage(value: unknown): value is Message { return isObject(value) && typeof value.id === "string" && typeof value.role === "string" && Array.isArray(value.content); }
function isMessageArray(value: unknown): value is Message[] { return Array.isArray(value) && value.every(isMessage); }
function isToolResult(value: unknown): value is ToolResult { return isObject(value) && typeof value.callId === "string" && typeof value.name === "string" && Array.isArray(value.content); }
function isToolCall(value: unknown): value is ToolCall { return isObject(value) && typeof value.id === "string" && typeof value.name === "string" && "args" in value; }
function isModelInput(value: unknown): value is ModelInput { return isObject(value) && Array.isArray(value.system) && Array.isArray(value.messages) && Array.isArray(value.tools) && isObject(value.options); }
function isModelResult(value: unknown): value is ModelResult { return isObject(value) && isMessage(value.message) && typeof value.finishReason === "string"; }
function textOf(parts: Part[]): string { return parts.map((part) => part.type === "text" ? part.text : part.type === "json" ? JSON.stringify(part.value) : "").join(""); }
function addUsage(total: Usage, usage?: Usage): void { if (!usage) return; total.input += usage.input; total.output += usage.output; total.cacheRead += usage.cacheRead; total.cacheWrite += usage.cacheWrite; }
function toolCalls(result: ModelResult): ToolCall[] { return result.message.content.filter((part): part is Extract<Part, { type: "tool.call" }> => part.type === "tool.call").map((part) => ({ id: part.callId, name: part.name, args: part.args })); }

export class RuntimeEvents {
  readonly #listeners = new Set<Listener>();
  on(listener: Listener): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  async emit(event: RuntimeEvent): Promise<void> { for (const listener of this.#listeners) await listener(event); }
}

interface RetryToolStage { call: ToolCall; execution?: Record<string, Json>; remainingCalls: ToolCall[] }
interface FlowRunResult { outputs: Message[]; usage: Usage; finishReasons: string[] }
interface TurnState { completion?: Message; retryTool?: RetryToolStage; agent: string; agentSpec: AgentSpec; conversationId: string; turnId: string; input: Json; conversation: Message[]; step: number; retryCount: number; signal: AbortSignal; messageNumber: number; usage: Usage; extensions: Map<string, ExtensionInstance>; pending: Map<string, Promise<Message[] | undefined>>; approvals: string[] }

export class GoondanRuntime {
  readonly events = new RuntimeEvents();
  readonly #renderer: TemplateRenderer;
  readonly #bindings: RuntimeBindings;
  readonly #store;
  readonly #operationStore;
  readonly #instances = new Map<string, Map<string, ExtensionInstance>>();
  readonly #pendingHooks = new Map<string, Map<string, Promise<Message[] | undefined>>>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #queuedInput = new Map<string, Json[]>();
  readonly #nested = new Map<string, GoondanRuntime>();
  readonly #retryCounts = new Map<string, number>();
  readonly #operationExecutions = new Map<string, Promise<void>>();
  readonly #activeRuns = new Map<string, Promise<AgentRunResult>>();
  constructor(readonly loaded: LoadedConfig, bindings: RuntimeBindings) {
    this.#bindings = bindings;
    this.#store = bindings.conversationStore ?? new MemoryConversationStore();
    this.#operationStore = bindings.operationStore ?? new MemoryOperationStore();
    this.#renderer = new TemplateRenderer(loaded.templates);
    this.#renderer.validate();
  }

  async runTurn(input: Json, options: RunOptions): Promise<AgentRunResult> {
    const running = this.#runTurn(input, options);
    this.#activeRuns.set(options.conversationId, running);
    try { return await running; } finally { if (this.#activeRuns.get(options.conversationId) === running) this.#activeRuns.delete(options.conversationId); }
  }

  async #runTurn(input: Json, options: RunOptions): Promise<AgentRunResult> {
    if (options.agent && options.startAgent) throw new Error("RunOptions cannot include both agent and startAgent");
    const agent = options.startAgent ?? options.agent ?? this.loaded.config.flow.in;
    const flow = await this.#runFlow(agent, input, options, true);
    const outputs = flow.outputs;
    if (outputs.length === 0) throw new Error("Flow produced no output");
    const first = outputs[0]; if (!first) throw new Error("Flow produced no output");
    const output = outputs.length === 1 ? first : this.#message("flow", "assistant", outputs.map((item) => textOf(item.content)).join("\n\n"), "flow-output", 0);
    const finishReason = flow.finishReasons.every((reason) => reason === flow.finishReasons[0]) ? flow.finishReasons[0] ?? "stop" : "other";
    return { output, outputs, usage: flow.usage, finishReason, status: "done" };
  }

  async dispatch(input: Json, options: RunOptions): Promise<AgentRunResult> { return this.runTurn(input, options); }
  async listOperations(conversationId?: string): Promise<PendingOperation[]> { return this.#operationStore.list(conversationId); }
  async decideOperation(conversationId: string, operationId: string, resolution: OperationDecision): Promise<PendingOperation> {
    const operation = await this.#operationStore.get(conversationId, operationId);
    if (!operation) throw new Error(`Unknown operation: ${operationId}`);
    let resolvedToolCall: ToolCall | undefined; let inputPatch: Record<string, Json> | undefined;
    if (resolution.inputPatch) {
      if (resolution.decision !== "approved") throw new Error("Operation inputPatch is only valid for approval");
      if (!isObject(operation.toolCall.args)) throw new Error("Operation inputPatch requires object tool arguments");
      const valid = await this.#bindings.host?.validateOperationInputPatch?.(operation, resolution.inputPatch) ?? false;
      if (!valid) throw new Error("Operation inputPatch validation failed");
      inputPatch = structuredClone(resolution.inputPatch); resolvedToolCall = { ...operation.toolCall, args: { ...operation.toolCall.args, ...inputPatch } };
    }
    const updated = await this.#operationStore.transition(conversationId, operationId, ["pending"], { status: resolution.decision, inputPatch, resolvedToolCall, updatedAt: this.#now() });
    if (!updated) return (await this.#operationStore.get(conversationId, operationId)) ?? operation;
    if (resolution.decision === "approved") this.#startOperation(updated);
    else await this.#deliverOperation(updated);
    return updated;
  }
  async cancelOperation(conversationId: string, operationId: string): Promise<PendingOperation> {
    const operation = await this.#operationStore.get(conversationId, operationId);
    if (!operation) throw new Error(`Unknown operation: ${operationId}`);
    const updated = await this.#operationStore.transition(conversationId, operationId, ["pending", "approved"], { status: "cancelled", updatedAt: this.#now() });
    if (!updated) return (await this.#operationStore.get(conversationId, operationId)) ?? operation;
    await this.#deliverOperation(updated); return updated;
  }
  async recoverOperations(conversationId?: string): Promise<void> {
    for (const operation of await this.#operationStore.list(conversationId)) {
      if (operation.status === "pending") await this.#requestApproval(operation);
      else if (operation.status === "approved") this.#startOperation(operation);
      else if (operation.status === "running") {
        const failed = await this.#operationStore.transition(operation.conversationId, operation.operationId, ["running"], { status: "failed", error: "Operation execution outcome is unknown because the runtime stopped", errorCode: "execution_interrupted", updatedAt: this.#now() });
        if (failed) await this.#deliverOperation(failed);
      } else if (operation.status === "completed" || operation.status === "rejected" || operation.status === "cancelled" || operation.status === "failed") {
        const recoverable = operation.deliveryStatus === "delivering" ? await this.#operationStore.releaseDelivery(operation.conversationId, operation.operationId, operation.deliveryId, this.#now()) : operation;
        if (recoverable && recoverable.deliveryStatus !== "delivered") await this.#deliverOperation(recoverable);
      }
    }
  }
  async #requestApproval(operation: PendingOperation): Promise<void> { await this.#bindings.host?.requestApproval?.({ operationId: operation.operationId, conversationId: operation.conversationId, turnId: operation.turnId, agent: operation.agent, toolCall: structuredClone(operation.toolCall), reasons: structuredClone(operation.reasons) }); }
  steer(conversationId: string, input: Json): void { const queue = this.#queuedInput.get(conversationId) ?? []; queue.push(input); this.#queuedInput.set(conversationId, queue); }
  abort(conversationId: string): boolean { const controller = this.#controllers.get(conversationId); if (!controller) return false; controller.abort(); return true; }
  async close(): Promise<void> { for (const controller of this.#controllers.values()) controller.abort(); for (const byConversation of this.#instances.values()) for (const instance of byConversation.values()) await instance.dispose?.(); for (const runtime of this.#nested.values()) await runtime.close(); this.#instances.clear(); this.#nested.clear(); }

  async maintain(conversationId: string, agent = this.loaded.config.flow.in): Promise<Message[]> {
    const spec = this.#agent(agent); const conversation = await this.#store.load(conversationId, agent);
    const state = await this.#state(agent, spec, null, conversationId, conversation, undefined);
    const result = await this.#pipeline("conversation", conversation, state);
    if (!isMessageArray(result)) throw new Error("conversation hook returned an invalid value");
    if (result !== conversation) await this.#store.replace(conversationId, agent, result);
    return result;
  }

  async prewarm(conversationId: string, agent = this.loaded.config.flow.in): Promise<ModelResult> {
    const spec = this.#agent(agent); const conversation = await this.maintain(conversationId, agent);
    const state = await this.#state(agent, spec, null, conversationId, conversation, undefined);
    const input = await this.#modelInput(state);
    return this.#model(spec).generate(input, { agent, conversationId, turnId: state.turnId, step: 1, signal: state.signal, onTextDelta: (delta) => { void this.#emit("step.textDelta", state, { step: 1, delta }); } });
  }

  async #runFlow(agent: string, input: Json, options: RunOptions, followRoutes: boolean): Promise<FlowRunResult> {
    const result = await this.#runAgent(agent, input, options);
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; addUsage(usage, result.usage);
    if (!followRoutes || options.agent !== undefined || !this.loaded.config.flow.routes) return { outputs: [result.output], usage, finishReasons: [result.finishReason] };
    const conversation = await this.#store.load(options.conversationId, agent);
    const conversationValue = this.#json(conversation, "flow.conversation");
    const routes = this.loaded.config.flow.routes.filter((route) => route.from === agent);
    const matched: typeof routes = [];
    for (const route of routes) if (!route.when || await this.#callFunction(route.when.fn, { output: textOf(result.output.content), input, conversation: conversationValue }, agent, options.conversationId, "flow", conversation)) matched.push(route);
    if (matched.length === 0) throw new Error(`No flow route matched from ${agent}`);
    const outputs: Message[] = []; const finishReasons: string[] = [];
    for (const route of matched) {
      if (route.to === "out") { outputs.push(result.output); finishReasons.push(result.finishReason); }
      else {
        const carriedInput = await this.#carry(route.carry?.message, result.output, input, conversation, agent, options.conversationId);
        const carriedConversation = await this.#carryConversation(route.carry?.conversation, conversation, agent, options.conversationId);
        const child = await this.#runFlow(route.to, carriedInput, { ...options, agent: undefined, startAgent: undefined, conversation: carriedConversation }, true);
        outputs.push(...child.outputs); addUsage(usage, child.usage); finishReasons.push(...child.finishReasons);
      }
    }
    return { outputs, usage, finishReasons };
  }

  async #carry(spec: "output" | { fn: string } | { template: string } | undefined, output: Message, input: Json, conversation: Message[], agent: string, conversationId: string): Promise<Json> {
    const text = textOf(output.content);
    const conversationValue = this.#json(conversation, "carry.conversation");
    if (!spec || spec === "output") return text;
    if ("fn" in spec) return (await this.#callFunction(spec.fn, { output: text, input, conversation: conversationValue }, agent, conversationId, "carry", conversation)) ?? null;
    return this.#renderer.render(spec.template, { output: text, input, conversation: conversationValue });
  }

  async #carryConversation(spec: "none" | "asis" | { fn: string } | undefined, conversation: Message[], agent: string, conversationId: string): Promise<Message[] | undefined> {
    if (!spec || spec === "none") return undefined;
    if (spec === "asis") return structuredClone(conversation);
    const transformed = await this.#callFunction(spec.fn, this.#json(conversation, "carry.conversation"), agent, conversationId, "carry", conversation);
    if (!isMessageArray(transformed)) throw new Error(`Carry function ${spec.fn} returned an invalid conversation`);
    return transformed;
  }

  async #runAgent(agent: string, rawInput: Json, options: RunOptions): Promise<AgentRunResult> {
    const spec = this.#agent(agent);
    if (spec.config) {
      const path = resolve(this.loaded.directory, spec.config); let nested = this.#nested.get(path);
      if (!nested) { const loaded = await loadConfig(path); nested = createRuntime(loaded, this.#bindings); this.#nested.set(path, nested); }
      return nested.runTurn(rawInput, { conversationId: options.conversationId, signal: options.signal });
    }
    const external = options.signal; const controller = new AbortController();
    if (external) external.addEventListener("abort", () => controller.abort(), { once: true });
    this.#controllers.set(options.conversationId, controller);
    const loaded = options.conversation ?? await this.#store.load(options.conversationId, agent);
    const state = await this.#state(agent, spec, rawInput, options.conversationId, loaded, controller.signal);
    try {
      state.input = await this.#input(state);
      await this.#emit("turn.start", state, { input: state.input });
      const inputMessage = await this.#inputMessage(state);
      state.conversation.push(inputMessage); await this.#store.append(state.conversationId, agent, [inputMessage]);
      return await this.#continueAgent(state);
    } catch (error) {
      return await this.#handleError(error, state, options);
    } finally { this.#controllers.delete(options.conversationId); }
  }

  async #continueAgent(state: TurnState): Promise<AgentRunResult> {
      const agent = state.agent; const spec = state.agentSpec;
      while (this.#bindings.maxSteps === undefined || state.step < this.#bindings.maxSteps) {
        state.signal.throwIfAborted();
        await this.#drainSteering(state);
        await this.#drainPending(state);
        const conversationValue = await this.#pipeline("conversation", state.conversation, state);
        if (!isMessageArray(conversationValue)) throw new Error("conversation hook returned an invalid value");
        if (conversationValue !== state.conversation) { state.conversation = conversationValue; await this.#store.replace(state.conversationId, agent, state.conversation); }
        state.step += 1;
        const modelInput = await this.#modelInput(state);
        if (state.completion) return this.#finishToolTurn(state.completion, state);
        await this.#emit("step.start", state, { step: state.step, messages: modelInput.messages.length, tools: modelInput.tools.map((tool) => tool.name) });
        let modelResult: ModelResult;
        try {
          modelResult = await this.#model(spec).generate(modelInput, { agent, conversationId: state.conversationId, turnId: state.turnId, step: state.step, signal: state.signal, onTextDelta: (delta) => { void this.#emit("step.textDelta", state, { step: state.step, delta }); } });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.#emit("step.error", state, { step: state.step, error: message, codes: ["model_error"] });
          throw new RuntimeFailure({ where: "model", codes: [state.signal.aborted ? "aborted" : "model_error"], message }, { cause: error });
        }
        addUsage(state.usage, modelResult.usage);
        const transformed = await this.#pipeline("modelResult", modelResult, state);
        if (isRetry(transformed)) {
          if (transformed.target !== "model") throw new Error("modelResult can only retry the model stage");
          continue;
        }
        if (!isModelResult(transformed)) throw new Error("modelResult hook returned an invalid value");
        modelResult = transformed;
        state.conversation.push(modelResult.message); await this.#store.append(state.conversationId, agent, [modelResult.message]);
        await this.#emit("step.done", state, { step: state.step, finishReason: modelResult.finishReason });
        const calls = toolCalls(modelResult);
        if (calls.length > 0) {
          let ended: Message | undefined;
          for (const [index, call] of calls.entries()) ended = (await this.#executeTool(call, state, calls.slice(index + 1))) ?? ended;
          if (ended) return this.#finishToolTurn(ended, state);
          continue;
        }
        const outputValue = await this.#pipeline("output", modelResult.message, state);
        if (!isMessage(outputValue)) throw new Error("output hook returned an invalid value");
        state.conversation[state.conversation.length - 1] = outputValue;
        await this.#store.replace(state.conversationId, agent, state.conversation);
        await this.#store.finish(state.conversationId, agent, { status: "done", turnId: state.turnId, output: outputValue });
        await this.#emit("turn.done", state, { output: textOf(outputValue.content), steps: state.step, usage: this.#json(state.usage, "usage") });
        this.#retryCounts.delete(`${state.conversationId}:${agent}`);
        return { output: outputValue, usage: state.usage, finishReason: modelResult.finishReason, status: "done" };
      }
      throw new Error(`Maximum steps exceeded: ${String(this.#bindings.maxSteps)}`);
  }

  async #handleError(error: unknown, state: TurnState, options: RunOptions): Promise<AgentRunResult> {
      const agent = state.agent;
      const turnError: TurnError = error instanceof RuntimeFailure
        ? { ...error.detail, attempt: state.retryCount + 1 }
        : { where: "runtime", codes: [state.signal.aborted ? "aborted" : "runtime_error"], message: error instanceof Error ? error.message : String(error), attempt: state.retryCount + 1 };
      const handled = await this.#pipeline("error", turnError, state);
      if (isRetry(handled) && state.retryCount < (this.#bindings.maxRetries ?? 3) && (handled.target === "model" || state.retryTool !== undefined)) {
        state.retryCount += 1; this.#retryCounts.set(`${state.conversationId}:${agent}`, state.retryCount);
        if (handled.conversation) { state.conversation = handled.conversation; await this.#store.replace(state.conversationId, agent, state.conversation); }
        if (handled.afterMs) await new Promise((resolveWait) => setTimeout(resolveWait, handled.afterMs));
        try {
          if (handled.target === "tool" && state.retryTool) {
            const stage = state.retryTool;
            let ended = await this.#runApprovedTool(stage.call, stage.execution, state);
            for (const call of stage.remainingCalls) ended = (await this.#executeTool(call, state, [])) ?? ended;
            state.retryTool = undefined;
            if (ended) return this.#finishToolTurn(ended, state);
          }
          return await this.#continueAgent(state);
        } catch (retryError) { return this.#handleError(retryError, state, options); }
      }
      await this.#store.finish(state.conversationId, agent, { status: "error", turnId: state.turnId, error: turnError });
      await this.#emit("turn.error", state, { error: turnError.message, codes: turnError.codes });
      this.#retryCounts.delete(`${state.conversationId}:${agent}`);
      throw error;
  }

  async #finishToolTurn(ended: Message, state: TurnState): Promise<AgentRunResult> {
    const endedValue = await this.#pipeline("output", ended, state); if (!isMessage(endedValue)) throw new Error("output hook returned an invalid value");
    state.conversation.push(endedValue); await this.#store.append(state.conversationId, state.agent, [endedValue]);
    await this.#store.finish(state.conversationId, state.agent, { status: "done", turnId: state.turnId, output: endedValue });
    await this.#emit("turn.done", state, { output: textOf(endedValue.content), steps: state.step, usage: this.#json(state.usage, "usage") });
    this.#retryCounts.delete(`${state.conversationId}:${state.agent}`);
    return { output: endedValue, usage: state.usage, finishReason: "tool", status: "done" };
  }

  async #state(agent: string, agentSpec: AgentSpec, input: Json, conversationId: string, conversation: Message[], signal?: AbortSignal): Promise<TurnState> {
    const turnId = this.#id();
    const key = `${conversationId}:${agent}`; let pending = this.#pendingHooks.get(key);
    if (!pending) { pending = new Map(); this.#pendingHooks.set(key, pending); }
    return { agent, agentSpec, conversationId, turnId, input, conversation, step: 0, retryCount: this.#retryCounts.get(key) ?? 0, signal: signal ?? new AbortController().signal, messageNumber: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, extensions: await this.#extensions(agent, agentSpec, conversationId), pending, approvals: [] };
  }

  async #extensions(agent: string, spec: AgentSpec, conversationId: string): Promise<Map<string, ExtensionInstance>> {
    const key = `${conversationId}:${agent}`; const cached = this.#instances.get(key); if (cached) return cached;
    const instances = new Map<string, ExtensionInstance>();
    for (const [name, use] of Object.entries(spec.extensions ?? {})) {
      if (use.enabled === false) continue;
      const definition = this.#bindings.extensions?.[name]; if (!definition) throw new Error(`Unknown extension: ${name}`);
      for (const port of Object.keys(definition.requires ?? {})) if (!(port in (this.#bindings.ports ?? {}))) throw new Error(`Extension ${name} requires port ${port}`);
      const options: Json = use.options ?? {}; const validated = definition.options?.validate(options) ?? options;
      instances.set(name, await definition.create({ options: validated, ports: this.#bindings.ports ?? {}, agent: { name: agent, spec }, log: this.#bindings.logger ?? noLog }));
    }
    this.#instances.set(key, instances); return instances;
  }

  async #input(state: TurnState): Promise<Json> { const value = await this.#pipeline("input", state.input, state); return this.#json(value, "input"); }
  async #inputMessage(state: TurnState): Promise<Message> {
    const rule = state.agentSpec.input ?? "asis"; let text: string;
    if (rule === "asis") text = typeof state.input === "string" ? state.input : JSON.stringify(state.input);
    else if (rule.fn) text = String((await this.#callFunction(rule.fn, state.input, state.agent, state.conversationId, state.turnId, state.conversation)) ?? "");
    else if (rule.template) text = this.#renderer.render(rule.template, isObject(state.input) ? this.#jsonRecord(state.input) : { text: state.input });
    else text = typeof state.input === "string" ? state.input : JSON.stringify(state.input);
    return this.#message(state.agent, "user", text, state.turnId, ++state.messageNumber);
  }

  async #modelInput(state: TurnState): Promise<ModelInput> {
    const tools = this.#tools(state).map((tool) => ({ name: tool.name, description: tool.description + this.#hint(state.agentSpec, tool.name), input: tool.input }));
    const blocks = Array.isArray(state.agentSpec.systemMessage) ? state.agentSpec.systemMessage : state.agentSpec.systemMessage ? [state.agentSpec.systemMessage] : [];
    const system = blocks.map((block, index) => ({ text: block.text ?? this.#renderer.render(block.template ?? "", { params: state.agentSpec.params ?? {}, tools, agent: { name: state.agent }, model: state.agentSpec.model ?? "" }), cache: block.cache, source: `system:${String(index)}` }));
    const base: ModelInput = { system, messages: structuredClone(state.conversation), tools, options: {} };
    const value = await this.#pipeline("modelInput", base, state); if (!isModelInput(value)) throw new Error("modelInput hook returned an invalid value"); return value;
  }

  #tools(state: TurnState): Tool[] {
    const available = { ...(this.#bindings.tools ?? {}) };
    for (const instance of state.extensions.values()) for (const tool of instance.tools ?? []) available[tool.name] = tool;
    const selected: Tool[] = [];
    for (const use of state.agentSpec.tools ?? []) {
      const name = typeof use === "string" ? use : use.tool;
      if (name) { const tool = available[name]; if (!tool) throw new Error(`Unknown tool: ${name}`); selected.push(tool); }
      else if (typeof use === "object" && use.agent) {
        const target = use.agent; const spec = this.#agent(target);
        selected.push({ name: target, description: spec.description ?? `Run ${target}`, input: { type: "object" }, execute: async (input, context) => {
          const result = await this.#runAgent(target, input, { conversationId: `${context.conversationId}:${context.turnId}:${target}`, signal: context.signal });
          return { callId: context.toolCall.id, name: target, args: input, content: result.output.content };
        } });
      }
    }
    return selected;
  }
  #hint(spec: AgentSpec, name: string): string { const use = (spec.tools ?? []).find((item) => typeof item !== "string" && item.tool === name); return typeof use === "object" && use.hint ? `\n${use.hint}` : ""; }
  #model(spec: AgentSpec) { const model = spec.model ? this.#bindings.models[spec.model] : undefined; if (!model) throw new Error(`Unknown model: ${String(spec.model)}`); return model; }

  async #executeTool(original: ToolCall, state: TurnState, _remainingCalls: ToolCall[]): Promise<Message | undefined> {
    let call = original; let execution: Record<string, Json> | undefined; state.approvals.length = 0;
    const transformed = await this.#pipeline("toolCall", call, state);
    if (hasToolResult(transformed)) { await this.#appendToolResult(transformed.result, state); return undefined; }
    if (isToolExecution(transformed)) { call = transformed.call; execution = transformed.execution; }
    else if (isToolCall(transformed)) call = transformed;
    const use = (state.agentSpec.tools ?? []).find((item) => typeof item !== "string" && (item.tool === call.name || item.agent === call.name));
    const reasons = [...state.approvals];
    if (typeof use === "object" && use.approval === "required") reasons.push(`Tool ${call.name} requires approval`);
    if (reasons.length > 0) {
      await this.#drainPending(state);
      const operationId = this.#id(); const now = this.#now();
      const request = { operationId, conversationId: state.conversationId, turnId: state.turnId, agent: state.agent, toolCall: structuredClone(call), reasons };
      const context = await this.#bindings.host?.captureOperationContext?.(request);
      const pending: PendingOperation = { operationId, deliveryId: `operation:${operationId}:completion`, agent: state.agent, conversationId: state.conversationId, turnId: state.turnId, toolCall: structuredClone(call), execution: execution ? structuredClone(execution) : undefined, context, reasons, status: "pending", deliveryStatus: "pending", createdAt: now, updatedAt: now };
      await this.#operationStore.save(pending);
      await this.#appendToolResult({ callId: call.id, name: call.name, args: call.args, content: [{ type: "json", value: { status: "pending", operationId } }], meta: { operationId, status: "pending" } }, state);
      await this.#emit("humanApproval.created", state, { operationId, tool: call.name, callId: call.id, reasons });
      await this.#requestApproval(pending);
      return undefined;
    }
    state.retryTool = { call, execution, remainingCalls: _remainingCalls };
    const ended = await this.#runApprovedTool(call, execution, state);
    state.retryTool = undefined;
    return ended;
  }

  #startOperation(operation: PendingOperation): void {
    if (this.#operationExecutions.has(operation.operationId)) return;
    const execution = this.#executeOperation(operation).finally(() => { this.#operationExecutions.delete(operation.operationId); });
    this.#operationExecutions.set(operation.operationId, execution); void execution;
  }

  async #executeOperation(operation: PendingOperation): Promise<void> {
    const current = await this.#operationStore.get(operation.conversationId, operation.operationId);
    if (!current || current.status !== "approved") return;
    const valid = await this.#bindings.host?.validateOperation?.(current) ?? true;
    if (!valid) { const failed = await this.#operationStore.transition(current.conversationId, current.operationId, ["approved"], { status: "failed", error: "Operation validation failed", errorCode: "validation_failed", updatedAt: this.#now() }); if (failed) await this.#deliverOperation(failed); return; }
    const running = await this.#operationStore.transition(current.conversationId, current.operationId, ["approved"], { status: "running", updatedAt: this.#now() }); if (!running) return;
    try {
      const spec = this.#agent(running.agent); const conversation = await this.#store.load(running.conversationId, running.agent);
      const state = await this.#state(running.agent, spec, { type: "operation_execution", operationId: running.operationId }, running.conversationId, conversation);
      const effectiveCall = running.resolvedToolCall ?? running.toolCall;
      const tool = this.#tools(state).find((candidate) => candidate.name === effectiveCall.name); if (!tool) throw new Error(`Unknown tool: ${effectiveCall.name}`);
      await this.#emit("tool.start", state, { tool: effectiveCall.name, callId: effectiveCall.id, args: effectiveCall.args, operationId: running.operationId });
      const raw = await tool.execute(effectiveCall.args, { input: state.input, conversation, agent: running.agent, conversationId: running.conversationId, turnId: running.turnId, toolCall: effectiveCall, execution: running.execution, signal: state.signal, agents: { run: (name, value) => this.#runAgent(name, value, { conversationId: running.conversationId, signal: state.signal }) } });
      const transformed = await this.#pipeline("toolResult", raw, state); if (!isToolResult(transformed)) throw new Error("toolResult hook returned an invalid value");
      await this.#emit("tool.done", state, { tool: running.toolCall.name, callId: running.toolCall.id, args: running.toolCall.args, operationId: running.operationId, result: this.#json(transformed, "toolResult") });
      const completed = await this.#operationStore.transition(running.conversationId, running.operationId, ["running"], { status: "completed", result: transformed, updatedAt: this.#now() }); if (completed) await this.#deliverOperation(completed);
    } catch (error) { const message = error instanceof Error ? error.message : String(error); const failed = await this.#operationStore.transition(running.conversationId, running.operationId, ["running"], { status: "failed", error: message, errorCode: "execution_failed", updatedAt: this.#now() }); if (failed) { const spec = this.#agent(failed.agent); const state = await this.#state(failed.agent, spec, { type: "operation_execution", operationId: failed.operationId }, failed.conversationId, await this.#store.load(failed.conversationId, failed.agent)); await this.#emit("tool.error", state, { tool: failed.toolCall.name, callId: failed.toolCall.id, args: failed.toolCall.args, operationId: failed.operationId, error: message, codes: ["tool_error"] }); await this.#deliverOperation(failed); } }
  }

  async #deliverOperation(operation: PendingOperation): Promise<void> {
    if (operation.deliveryStatus === "delivered" || operation.status === "pending" || operation.status === "approved" || operation.status === "running") return;
    const completion: OperationCompletion = { type: "operation_completion", deliveryId: operation.deliveryId, operationId: operation.operationId, conversationId: operation.conversationId, agent: operation.agent, status: operation.status, toolCall: operation.toolCall, result: operation.result, error: operation.error, errorCode: operation.errorCode };
    const delivering = await this.#operationStore.claimDelivery(operation.conversationId, operation.operationId, this.#now()); if (!delivering) return;
    try {
      if (this.#bindings.host?.deliverOperationCompletion) await this.#bindings.host.deliverOperationCompletion(completion);
      else {
        const active = this.#activeRuns.get(operation.conversationId);
        if (active) { try { await active; } catch { /* Completion delivery remains independent from the preceding turn outcome. */ } }
        await this.runTurn(this.#json(completion, "operationCompletion"), { conversationId: operation.conversationId, agent: operation.agent });
      }
      await this.#operationStore.save({ ...delivering, deliveryStatus: "delivered", deliveredAt: this.#now(), updatedAt: this.#now() });
    } catch (error) { await this.#operationStore.save({ ...operation, deliveryStatus: "pending", error: operation.error ?? (error instanceof Error ? error.message : String(error)), updatedAt: this.#now() }); throw error; }
  }

  async #runApprovedTool(call: ToolCall, execution: Record<string, Json> | undefined, state: TurnState): Promise<Message | undefined> {
    const existing = state.conversation.some((message) => message.content.some((part) => part.type === "tool.result" && part.callId === call.id));
    if (existing) return undefined;
    const tool = this.#tools(state).find((candidate) => candidate.name === call.name); if (!tool) throw new Error(`Unknown tool: ${call.name}`);
    await this.#emit("tool.start", state, { tool: call.name, callId: call.id, args: call.args });
    let result: ToolResult;
    try {
      result = await tool.execute(call.args, { input: state.input, conversation: state.conversation, agent: state.agent, conversationId: state.conversationId, turnId: state.turnId, toolCall: call, execution, signal: state.signal, agents: { run: (name, value) => this.#runAgent(name, value, { conversationId: state.conversationId, signal: state.signal }) } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#emit("tool.error", state, { tool: call.name, callId: call.id, args: call.args, error: message, codes: ["tool_error"] });
      throw new RuntimeFailure({ where: "tool", codes: [state.signal.aborted ? "aborted" : "tool_error"], message, toolCall: call }, { cause: error });
    }
    const finalResult = await this.#appendToolResult(result, state);
    await this.#emit("tool.done", state, { tool: call.name, callId: call.id, args: call.args, result: this.#json(finalResult, "toolResult") });
    if (state.completion) return state.completion;
    return undefined;
  }

  async #appendToolResult(result: ToolResult, state: TurnState): Promise<ToolResult> {
    const transformed = await this.#pipeline("toolResult", result, state); if (!isToolResult(transformed)) throw new Error("toolResult hook returned an invalid value");
    const message: Message = { id: this.#id(), role: "tool", source: "tool", content: [{ type: "tool.result", callId: transformed.callId, content: transformed.content, isError: transformed.isError }], keep: transformed.keep, meta: transformed.meta };
    state.conversation.push(message); await this.#store.append(state.conversationId, state.agent, [message]);
    return transformed;
  }

  async #pipeline(name: ValueName, initial: PipelineValue, state: TurnState): Promise<PipelineValue> {
    let current = initial;
    for (const [index, spec] of (state.agentSpec.hooks?.[name] ?? []).entries()) {
      const hookName = spec.name ?? spec.extension ?? spec.fn ?? (Array.isArray(spec.agent) ? spec.agent.join("+") : spec.agent) ?? spec.template ?? `${name}:${String(index)}`;
      const input = spec.using === "input" ? state.input : spec.using === "conversation" ? state.conversation : isObject(spec.using) ? await this.#callFunction(spec.using.fn, this.#json(current, name), state.agent, state.conversationId, state.turnId, state.conversation) : current;
      if (spec.when && !await this.#callFunction(spec.when.fn, this.#json(input, name), state.agent, state.conversationId, state.turnId, state.conversation)) { await this.#emit("hook.skipped", state, { value: name, hook: hookName }); continue; }
      const run = this.#hook(name, spec, state, hookName);
      if (spec.mode === "async") { if (!state.pending.has(hookName)) state.pending.set(hookName, Promise.resolve(run(input)).then((result) => isAppend(result) ? result.append : undefined)); continue; }
      try {
        const result = await this.#timeout(run(input), spec.timeout, state.signal);
        if (isApproval(result)) state.approvals.push(result.approval.reason);
        else if (result !== undefined) current = this.#apply(name, current, result);
        await this.#emit("hook.applied", state, { value: name, hook: hookName });
        if (isRetry(current) || isFail(current) || hasToolResult(current)) return current;
      } catch (error) {
        await this.#emit("hook.failed", state, { value: name, hook: hookName, error: error instanceof Error ? error.message : String(error) });
        if (!(spec.optional ?? Boolean(spec.agent))) {
          const message = error instanceof Error ? error.message : String(error);
          throw new RuntimeFailure({ where: name, codes: ["hook_error"], message }, { cause: error });
        }
      }
    }
    return current;
  }

  #hook(valueName: ValueName, spec: InlineHookSpec, state: TurnState, source: string): (input: PipelineValue) => Promise<HookResult> {
    if (spec.extension) { const hook = state.extensions.get(spec.extension)?.hooks?.[valueName]; if (!hook) throw new Error(`Extension ${spec.extension} has no ${valueName} hook`); return async (input) => Promise.resolve(hook(input ?? null, this.#hookContext(state, source, valueName, spec.mode === "async"))); }
    return async (input) => {
      let value: Json = this.#json(input, valueName);
      if (spec.fn) value = (await this.#callFunction(spec.fn, value, state.agent, state.conversationId, state.turnId, state.conversation)) ?? null;
      if (spec.agent) {
        const names = Array.isArray(spec.agent) ? spec.agent : [spec.agent];
        const results = await Promise.all(names.map((name) => this.#runAgent(name, value, { conversationId: `${state.conversationId}:${source}`, signal: state.signal })));
        value = results.map((result) => textOf(result.output.content)).join("\n");
      }
      if (spec.template) value = this.#renderer.render(spec.template, { text: value, input: state.input, params: state.agentSpec.params ?? {} });
      if (valueName === "conversation" || valueName === "modelInput") return { append: [this.#message(source, spec.role ?? "user", typeof value === "string" ? value : JSON.stringify(value), state.turnId, ++state.messageNumber)] };
      if (valueName === "output") return this.#message(source, "assistant", typeof value === "string" ? value : JSON.stringify(value), state.turnId, ++state.messageNumber);
      return value;
    };
  }

  #hookContext(state: TurnState, source: string, phase: ValueName, asynchronous: boolean): HookContext {
    const make = (role: "user" | "system", text: string, extra?: { key?: string; keep?: boolean; meta?: Record<string, Json> }): Message => ({ ...this.#message(source, role, text, state.turnId, ++state.messageNumber), ...extra });
    return { execution: { complete: (output) => { if (asynchronous || phase !== "toolResult") throw new Error("execution.complete is available in synchronous toolResult hooks"); if (!isMessage(output) || output.role !== "assistant") throw new Error("execution.complete requires an assistant message"); if (state.completion) throw new Error("Execution completion is already requested"); state.completion = structuredClone(output); } }, agent: state.agent, conversationId: state.conversationId, turnId: state.turnId, step: state.step || undefined, retryCount: state.retryCount, input: state.input, conversation: state.conversation, signal: state.signal,
      agents: { run: (name, value, options) => this.#runAgent(name, value, { conversationId: state.conversationId, conversation: options?.conversation, signal: options?.signal ?? state.signal }) },
      model: { run: async (messages, options) => { const input = await this.#modelInput({ ...state, conversation: [...messages] }); const result = await this.#model(state.agentSpec).generate(input, { agent: state.agent, conversationId: state.conversationId, turnId: state.turnId, step: state.step, signal: options?.signal ?? state.signal, onTextDelta() {} }); return { output: result.message, usage: result.usage, finishReason: result.finishReason, status: "done" }; } },
      render: async (template, variables) => this.#renderer.render(template, variables), message: { user: (text, extra) => make("user", text, extra), system: (text, extra) => make("system", text, extra) }, append: (...items) => ({ append: items }), log: this.#bindings.logger ?? noLog };
  }

  #apply(name: ValueName, current: PipelineValue, result: HookResult): PipelineValue {
    if (isAppend(result)) {
      if (name === "conversation" && isMessageArray(current)) return this.#dedupe([...current, ...result.append]);
      if (name === "modelInput" && isModelInput(current)) return { ...current, messages: this.#dedupe([...current.messages, ...result.append]) };
      throw new Error(`append is invalid for ${name}`);
    }
    return result;
  }
  #dedupe(messages: Message[]): Message[] { const result: Message[] = []; for (const message of messages) { const previous = result[result.length - 1]; if (message.source !== "user" && message.source !== "model" && previous?.source === message.source && previous.key === message.key && previous.role === message.role && textOf(previous.content) === textOf(message.content)) continue; result.push(message); } return result; }
  async #drainPending(state: TurnState): Promise<void> { const pending = [...state.pending.values()]; state.pending.clear(); for (const messages of await Promise.all(pending)) if (messages) { const added = this.#dedupe([...state.conversation, ...messages]).slice(state.conversation.length); state.conversation.push(...added); if (added.length) await this.#store.append(state.conversationId, state.agent, added); } }
  async #drainSteering(state: TurnState): Promise<void> { const values = this.#queuedInput.get(state.conversationId); if (!values?.length) return; this.#queuedInput.delete(state.conversationId); const messages = values.map((value) => this.#message("user", "user", typeof value === "string" ? value : JSON.stringify(value), state.turnId, ++state.messageNumber)); state.conversation.push(...messages); await this.#store.append(state.conversationId, state.agent, messages); }
  async #callFunction(name: string, value: Json, agent: string, conversationId: string, turnId: string, conversation: Message[]): Promise<Json | undefined> { const fn: GoondanFunction | undefined = this.#bindings.functions?.[name]; if (!fn) throw new Error(`Unknown function: ${name}`); return fn(value, { agent, conversationId, turnId, input: value, conversation }); }
  async #emit(name: RuntimeEventName, state: TurnState, data: Record<string, Json>): Promise<void> { const event = { name, agent: state.agent, conversationId: state.conversationId, turnId: state.turnId, at: this.#bindings.host?.now?.() ?? Date.now(), data }; await this.events.emit(event); await this.#bindings.host?.emit?.(event); for (const instance of state.extensions.values()) await instance.on?.[name]?.(event); }
  #message(source: string, role: "user" | "system" | "assistant", text: string, turnId: string, number: number): Message { return { id: `${turnId}:${String(number)}:${this.#id()}`, role, source, content: [{ type: "text", text }] }; }
  #id(): string { return this.#bindings.host?.id?.() ?? globalThis.crypto.randomUUID(); }
  #now(): number { return this.#bindings.host?.now?.() ?? Date.now(); }
  #agent(name: string): AgentSpec { const spec = this.loaded.config.agents[name]; if (!spec) throw new Error(`Unknown agent: ${name}`); return spec; }
  #json(value: unknown, at: string): Json { if (value === undefined) return null; if (value === null || typeof value === "string" || typeof value === "boolean") return value; if (typeof value === "number" && Number.isFinite(value)) return value; if (Array.isArray(value)) return value.map((item) => this.#json(item, at)); if (isObject(value)) { const result: Record<string, Json> = {}; for (const [key, child] of Object.entries(value)) result[key] = this.#json(child, at); return result; } throw new Error(`${at} is not JSON serializable`); }
  #jsonRecord(value: Record<string, unknown>): Record<string, Json> { const result: Record<string, Json> = {}; for (const [key, child] of Object.entries(value)) result[key] = this.#json(child, key); return result; }
  async #timeout<T>(promise: Promise<T>, timeout: number | undefined, signal: AbortSignal): Promise<T> { if (!timeout) return promise; return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Hook timed out after ${String(timeout)}ms`)), timeout); signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }); promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); }); }); }
}

export function createRuntime(config: LoadedConfig, bindings: RuntimeBindings): GoondanRuntime { return new GoondanRuntime(config, bindings); }
