/**
 * Turns the scripts of `case.json` into host bindings and records every call
 * the observations need.
 *
 * Script progress (model responses, tool results, operation counters) and the
 * gates are shared by every runtime of a case; the binding objects themselves
 * are built once per runtime so that a closed runtime can be told apart.
 * See fixtures/conformance/README.md ("바인딩", "관측").
 */

import {
  type CaseBindings,
  type ExtensionScript,
  type ModelResponse,
  type ModelScript,
  type Op,
  type ToolResultScript,
  type ToolScript,
  type ValueStage,
} from "./conformance-case.ts";
import { GateRegistry } from "./conformance-gates.ts";
import { callMethod, member, UnsupportedError } from "./conformance-host.ts";
import {
  type Json,
  type JsonObject,
  isFunction,
  isJsonArray,
  isJsonObject,
  isPromiseLike,
  isString,
  snapshot,
} from "./conformance-json.ts";
import { type HookOpBridge, type MessageExtraScript, type OpContext, ScriptError, runOp } from "./conformance-ops.ts";

export interface ObservationState {
  events: Json[];
  rawEvents: Json[];
  modelInputs: Map<string, Json[]>;
  modelContexts: Map<string, Json[]>;
  toolCalls: Json[];
  toolContexts: Json[];
  functionCalls: Json[];
  functionContexts: Json[];
  hookCalls: Json[];
  hookContexts: Json[];
  extensionLog: Json[];
  operationHistory: Map<string, string[]>;
  operationAliases: Map<string, string>;
  operationCallIds: Map<string, string>;
  operationRecords: Map<string, Json>;
}

function newObservationState(): ObservationState {
  return {
    events: [],
    rawEvents: [],
    modelInputs: new Map(),
    modelContexts: new Map(),
    toolCalls: [],
    toolContexts: [],
    functionCalls: [],
    functionContexts: [],
    hookCalls: [],
    hookContexts: [],
    extensionLog: [],
    operationHistory: new Map(),
    operationAliases: new Map(),
    operationCallIds: new Map(),
    operationRecords: new Map(),
  };
}

export function projectOperation(operation: Json): Json {
  if (!isJsonObject(operation)) return operation;
  const projected: JsonObject = {};
  for (const [key, value] of Object.entries(operation)) {
    if (value === undefined) continue;
    if (key === "createdAt" || key === "updatedAt" || key === "deliveredAt") continue;
    projected[key] = value;
  }
  return projected;
}

export function projectEvent(event: Json): Json {
  if (!isJsonObject(event)) return event;
  const projected: JsonObject = {};
  for (const key of [
    "seq", "version", "type", "sessionId", "agent", "instance", "turnId", "executionId", "inputId",
    "parentExecutionId", "operationId", "data", "skippable", "observational",
  ]) {
    if (Object.hasOwn(event, key)) projected[key] = snapshot(event[key] ?? null);
  }
  const data = projected["data"];
  if (isJsonObject(data) && isString(projected["type"]) && projected["type"].startsWith("operation.")) {
    delete data["updatedAt"];
    delete data["deliveredAt"];
    const operation = data["operation"];
    if (isJsonObject(operation)) {
      delete operation["createdAt"];
      delete operation["updatedAt"];
      delete operation["deliveredAt"];
    }
  }
  return projected;
}

function isOperationLike(value: Json): value is JsonObject {
  return (
    isJsonObject(value) &&
    isString(value["operationId"]) &&
    isString(value["status"]) &&
    isString(value["deliveryStatus"])
  );
}

/** Case-wide script state: cursors, counters, gates and observations. */
export class CaseScripts {
  readonly gates = new GateRegistry();
  readonly counters = new Map<string, number>();
  readonly observations: ObservationState = newObservationState();
  readonly failures: string[] = [];
  #modelCursor = new Map<string, number>();
  #toolCursor = new Map<string, number>();
  #instances = 0;

  constructor(readonly bindings: CaseBindings) {}

  nextModelResponse(name: string, script: ModelScript): ModelResponse {
    const index = this.#modelCursor.get(name) ?? 0;
    this.#modelCursor.set(name, index + 1);
    const response = script.responses[index];
    if (response === undefined) {
      const message = `model ${name} was called ${String(index + 1)} times but the script has ${String(script.responses.length)} responses`;
      this.failures.push(message);
      throw new ScriptError(message);
    }
    return response;
  }

  nextToolResult(site: string, script: ToolScript): ToolResultScript {
    const index = this.#toolCursor.get(site) ?? 0;
    this.#toolCursor.set(site, index + 1);
    const result = script.results[index];
    if (result === undefined) {
      const message = `tool ${site} was called ${String(index + 1)} times but the script has ${String(script.results.length)} results`;
      this.failures.push(message);
      throw new ScriptError(message);
    }
    return result;
  }

  nextInstanceNumber(): number {
    this.#instances += 1;
    return this.#instances;
  }

  /** Scripts that still have unused entries, as failure messages. */
  leftovers(): string[] {
    const messages: string[] = [];
    for (const [name, script] of this.bindings.models) {
      const used = this.#modelCursor.get(name) ?? 0;
      if (used < script.responses.length) {
        messages.push(`model ${name} has ${String(script.responses.length - used)} unused responses`);
      }
    }
    for (const [name, script] of this.bindings.tools) {
      const used = this.#toolCursor.get(`tools.${name}`) ?? 0;
      if (used < script.results.length) {
        messages.push(`tool ${name} has ${String(script.results.length - used)} unused results`);
      }
    }
    for (const [extension, script] of this.bindings.extensions) {
      for (const [name, tool] of script.instance?.tools ?? new Map<string, ToolScript>()) {
        const site = `extensions.${extension}.tools.${name}`;
        const used = this.#toolCursor.get(site) ?? 0;
        if (used < tool.results.length) {
          messages.push(`extension tool ${extension}.${name} has ${String(tool.results.length - used)} unused results`);
        }
      }
    }
    return messages;
  }

  recordOperation(operation: Json): void {
    if (!isOperationLike(operation)) return;
    const id = operation["operationId"];
    const status = operation["status"];
    const deliveryStatus = operation["deliveryStatus"];
    if (!isString(id) || !isString(status) || !isString(deliveryStatus)) return;
    const observations = this.observations;
    if (!observations.operationAliases.has(id)) {
      const toolCall = operation["toolCall"];
      const callId = isJsonObject(toolCall) && isString(toolCall["id"]) ? toolCall["id"] : "unknown";
      const shared = [...observations.operationCallIds.values()].filter((value) => value === callId).length;
      observations.operationCallIds.set(id, callId);
      observations.operationAliases.set(id, shared === 0 ? `<op:${callId}>` : `<op:${callId}#${String(shared + 1)}>`);
    }
    observations.operationRecords.set(id, operation);
    const history = observations.operationHistory.get(id) ?? [];
    const entry = `${status}/${deliveryStatus}`;
    if (history[history.length - 1] !== entry) history.push(entry);
    observations.operationHistory.set(id, history);
  }
}

function contextValue(ctx: unknown, name: string): Json {
  return snapshot(member(ctx, name));
}

function projectContext(ctx: unknown, extras: readonly string[] = []): JsonObject {
  const projected: JsonObject = {};
  for (const name of [
    "agent", "sessionId", "turnId", "instance", "executionId", "parentExecutionId", "operationId", ...extras,
  ]) {
    const value = member(ctx, name);
    if (value !== undefined) projected[name] = snapshot(value);
  }
  return projected;
}

function signalOf(ctx: unknown): AbortSignal | undefined {
  const signal = member(ctx, "signal");
  return signal instanceof AbortSignal ? signal : undefined;
}

interface ModelUsageResult {
  message: JsonObject;
  result: JsonObject;
}

function buildModelResult(response: ModelResponse, content: Json[]): ModelUsageResult {
  if (response.kind !== "text" && response.kind !== "toolCalls" && response.kind !== "content") {
    throw new ScriptError("model response has no message");
  }
  const message: JsonObject = { role: "assistant", content };
  if (response.extras.id !== undefined) message["id"] = response.extras.id;
  if (response.extras.source !== undefined) message["source"] = response.extras.source;
  if (response.extras.meta !== undefined) message["meta"] = response.extras.meta;
  const hasToolCall = content.some((part) => isJsonObject(part) && part["type"] === "tool.call");
  const result: JsonObject = {
    message,
    finishReason: response.extras.finishReason === undefined ? (hasToolCall ? "tool" : "stop") : response.extras.finishReason,
  };
  if (response.extras.usage !== undefined) result["usage"] = response.extras.usage;
  return { message, result };
}

export interface RuntimeBindingOptions {
  scripts: CaseScripts;
  owner: object;
  store: object;
  /** The configuration directory of a case that hands the runtime a document instead of a file. */
  directory?: string;
}

/** Host bindings for one runtime of the case. */
export function buildBindings(options: RuntimeBindingOptions): JsonObjectLike {
  const { scripts, owner } = options;
  const observations = scripts.observations;
  const bindings: Record<string, unknown> = {
    store: options.store,
  };
  if (options.directory !== undefined) bindings["directory"] = options.directory;

  const models: Record<string, unknown> = {};
  for (const [name, script] of scripts.bindings.models) {
    models[name] = {
      ...(script.provider === undefined ? {} : { provider: script.provider }),
      async generate(input: unknown, ctx: unknown): Promise<unknown> {
        const inputs = observations.modelInputs.get(name) ?? [];
        inputs.push(snapshot(input));
        observations.modelInputs.set(name, inputs);
        const contexts = observations.modelContexts.get(name) ?? [];
        contexts.push(projectContext(ctx, ["step"]));
        observations.modelContexts.set(name, contexts);
        return applyModelResponse(scripts.nextModelResponse(name, script), ctx, scripts, owner);
      },
    };
  }
  bindings["models"] = models;

  const tools: Record<string, unknown> = {};
  for (const [name, script] of scripts.bindings.tools) {
    tools[name] = buildTool(name, `tools.${name}`, script, scripts, owner);
  }
  if (scripts.bindings.tools.size > 0) bindings["tools"] = tools;

  const functions: Record<string, unknown> = {};
  for (const [name, op] of scripts.bindings.functions) {
    functions[name] = async (value: unknown, ctx: unknown): Promise<unknown> => {
      observations.functionCalls.push({ fn: name, value: snapshot(value) });
      observations.functionContexts.push({
        fn: name,
        context: projectContext(ctx, ["location", "route", "inputKind", "step", "retryCount", "input", "conversation"]),
      });
      const signal = member(ctx, "signal");
      return runOp(op, value, { gates: scripts.gates, counters: scripts.counters, owner, ...(signal instanceof AbortSignal ? { signal } : {}) });
    };
  }
  if (scripts.bindings.functions.size > 0) bindings["functions"] = functions;

  const extensions: Record<string, unknown> = {};
  for (const [name, script] of scripts.bindings.extensions) {
    extensions[name] = buildExtension(name, script, scripts, owner);
  }
  if (scripts.bindings.extensions.size > 0) bindings["extensions"] = extensions;

  if (scripts.bindings.ports.size > 0) {
    const ports: Record<string, Json> = {};
    for (const [name, value] of scripts.bindings.ports) ports[name] = value;
    bindings["ports"] = ports;
  }

  bindings["host"] = buildHost(scripts, owner);
  if (scripts.bindings.maxRetries) bindings["maxRetries"] = scripts.bindings.maxRetries.value;
  return bindings;
}

export type JsonObjectLike = Record<string, unknown>;

async function applyModelResponse(
  response: ModelResponse,
  ctx: unknown,
  scripts: CaseScripts,
  owner: object,
): Promise<unknown> {
  if (response.kind === "await") {
    await scripts.gates.wait(response.gate, { owner, signal: signalOf(ctx) });
    return applyModelResponse(response.then, ctx, scripts, owner);
  }
  if (response.kind === "error") {
    const error = new ScriptError(response.message);
    if (response.code !== undefined) Object.defineProperty(error, "code", { value: response.code, enumerable: true });
    throw error;
  }
  if (response.kind === "raw") return response.value;
  const content: Json[] =
    response.kind === "text"
      ? [{ type: "text", text: response.text }]
      : response.kind === "toolCalls"
        ? response.toolCalls.map((call) => ({ type: "tool.call", callId: call.callId, name: call.name, args: call.args }))
        : response.content;
  for (const delta of response.extras.deltas ?? []) {
    const onTextDelta = member(ctx, "onTextDelta");
    if (!isFunction(onTextDelta)) throw new UnsupportedError("model context onTextDelta");
    const emitted = Reflect.apply(onTextDelta, ctx, [delta]);
    if (isPromiseLike(emitted)) await emitted;
  }
  return buildModelResult(response, content).result;
}

function buildTool(name: string, site: string, script: ToolScript, scripts: CaseScripts, owner: object): unknown {
  return {
    name,
    description: script.description,
    input: script.input,
    async execute(input: unknown, ctx: unknown): Promise<unknown> {
      const observations = scripts.observations;
      observations.toolCalls.push({ tool: name, args: snapshot(input) });
      const toolCall = snapshot(member(ctx, "toolCall"));
      const execution = member(ctx, "execution");
      observations.toolContexts.push({
        tool: name,
        ...projectContext(ctx),
        toolCall: isJsonObject(toolCall)
          ? { id: toolCall["id"] ?? null, name: toolCall["name"] ?? null, args: toolCall["args"] ?? null }
          : toolCall,
        input: contextValue(ctx, "input"),
        conversation: contextValue(ctx, "conversation"),
        execution: execution === undefined ? {} : snapshot(execution),
      });
      return applyToolResult(scripts.nextToolResult(site, script), ctx, scripts, owner);
    },
  };
}

async function applyToolResult(
  result: ToolResultScript,
  ctx: unknown,
  scripts: CaseScripts,
  owner: object,
): Promise<unknown> {
  if (result.kind === "await") {
    await scripts.gates.wait(result.gate, { owner, signal: signalOf(ctx) });
    return applyToolResult(result.then, ctx, scripts, owner);
  }
  if (result.kind === "error") throw new ScriptError(result.message);
  if (result.kind === "value" || result.kind === "result") return result.value;
  if (result.kind === "runAgent") {
    const agents = member(ctx, "agents");
    const run = member(agents, "run");
    if (!isFunction(run)) throw new UnsupportedError("tool context agents.run");
    const output = snapshot(await Reflect.apply(run, agents, [result.name, result.input]));
    return isJsonObject(output) && isJsonArray(output["content"]) ? output["content"] : [];
  }
  const content: Json[] =
    result.kind === "text"
      ? [{ type: "text", text: result.text }]
      : result.kind === "json"
        ? [{ type: "json", value: result.value }]
        : result.content;
  if (result.extras.isError === undefined && result.extras.keep === undefined && result.extras.meta === undefined) return content;
  const value: JsonObject = { content };
  if (result.extras.isError !== undefined) value["isError"] = result.extras.isError;
  if (result.extras.keep !== undefined) value["keep"] = result.extras.keep;
  if (result.extras.meta !== undefined) value["meta"] = result.extras.meta;
  return value;
}

function hookBridge(ctx: unknown): HookOpBridge {
  const messages = member(ctx, "message");
  const agents = member(ctx, "agents");
  const model = member(ctx, "model");
  const execution = member(ctx, "execution");
  return {
    messageUser(text: string, extra: MessageExtraScript | undefined): unknown {
      const user = member(messages, "user");
      if (!isFunction(user)) throw new UnsupportedError("hook context message.user");
      return Reflect.apply(user, messages, extra === undefined ? [text] : [text, extra]);
    },
    messageSystem(text: string, extra: MessageExtraScript | undefined): unknown {
      const system = member(messages, "system");
      if (!isFunction(system)) throw new UnsupportedError("hook context message.system");
      return Reflect.apply(system, messages, extra === undefined ? [text] : [text, extra]);
    },
    append(items: unknown[]): unknown {
      return callMethod(ctx, "append", items, "hook context append");
    },
    async runAgent(name: string, input: unknown): Promise<unknown> {
      const run = member(agents, "run");
      if (!isFunction(run)) throw new UnsupportedError("hook context agents.run");
      return Reflect.apply(run, agents, [name, input]);
    },
    async runModel(items: unknown): Promise<unknown> {
      const run = member(model, "run");
      if (!isFunction(run)) throw new UnsupportedError("hook context model.run");
      return Reflect.apply(run, model, [items]);
    },
    async render(template: string, variables: JsonObject): Promise<string> {
      const rendered: unknown = await callMethod(ctx, "render", [template, variables], "hook context render");
      if (typeof rendered !== "string") throw new ScriptError("render did not return a string");
      return rendered;
    },
    complete(message: unknown): void {
      const complete = member(execution, "complete");
      if (!isFunction(complete)) throw new UnsupportedError("hook context execution.complete");
      Reflect.apply(complete, execution, [message]);
    },
  };
}

function buildHookFunction(extension: string, stage: ValueStage, op: Op, scripts: CaseScripts, owner: object) {
  return async (value: unknown, ctx: unknown): Promise<unknown> => {
    const observations = scripts.observations;
    observations.hookCalls.push({ extension, stage, value: snapshot(value) });
    observations.hookContexts.push({
      extension,
      stage,
      ...projectContext(ctx, ["inputKind", "step"]),
      input: contextValue(ctx, "input"),
      conversation: contextValue(ctx, "conversation"),
      retryCount: contextValue(ctx, "retryCount"),
    });
    const opContext: OpContext = {
      gates: scripts.gates,
      counters: scripts.counters,
      owner,
      hook: hookBridge(ctx),
    };
    const signal = signalOf(ctx);
    if (signal) opContext.signal = signal;
    return runOp(op, value, opContext);
  };
}

function buildExtension(name: string, script: ExtensionScript, scripts: CaseScripts, owner: object): unknown {
  const definition = script.definition;
  const instanceScript = script.instance;
  const observations = scripts.observations;
  const extension: Record<string, unknown> = { name };
  if (definition?.requires !== undefined) extension["requires"] = definition.requires;
  if (definition?.hooks !== undefined) extension["hooks"] = definition.hooks;
  if (definition?.tools !== undefined) extension["tools"] = definition.tools;
  if (definition?.validateOptions !== undefined) {
    const validator = definition.validateOptions;
    const validate = async (value: unknown): Promise<unknown> => {
      observations.extensionLog.push({ action: "validateOptions", extension: name, options: snapshot(value) });
      return runOp(validator, value, { gates: scripts.gates, counters: scripts.counters, owner });
    };
    extension["options"] = { validate };
  }
  extension["create"] = async (input: unknown): Promise<unknown> => {
    const instanceNumber = scripts.nextInstanceNumber();
    const agent = member(input, "agent");
    observations.extensionLog.push({
      action: "create",
      instance: instanceNumber,
      extension: name,
      options: snapshot(member(input, "options")),
      ports: snapshot(member(input, "ports")),
      agent: {
        name: snapshot(member(agent, "name")),
        spec: snapshot(member(agent, "spec")),
      },
    });
    if (definition?.createError !== undefined) throw new ScriptError(definition.createError);
    const hooks: Record<string, unknown> = {};
    for (const [stage, op] of instanceScript?.hooks ?? new Map<ValueStage, Op>()) {
      hooks[stage] = buildHookFunction(name, stage, op, scripts, owner);
    }
    const instanceTools: unknown[] = [];
    for (const [toolName, toolScript] of instanceScript?.tools ?? new Map<string, ToolScript>()) {
      instanceTools.push(buildTool(toolName, `extensions.${name}.tools.${toolName}`, toolScript, scripts, owner));
    }
    const on: Record<string, unknown> = {};
    for (const eventName of instanceScript?.events ?? []) {
      on[eventName] = (event: unknown): void => {
        const projected = snapshot(member(event, "type"));
        observations.extensionLog.push({ action: "event", instance: instanceNumber, name: projected });
      };
    }
    const instance: Record<string, unknown> = {
      dispose: (): void => {
        observations.extensionLog.push({ action: "dispose", instance: instanceNumber });
      },
    };
    if (Object.keys(hooks).length > 0) instance["hooks"] = hooks;
    if (instanceTools.length > 0) instance["tools"] = instanceTools;
    if (Object.keys(on).length > 0) instance["on"] = on;
    return instance;
  };
  return extension;
}

function buildHost(scripts: CaseScripts, owner: object): Record<string, unknown> {
  const observations = scripts.observations;
  return {
    emit: async (event: unknown): Promise<void> => {
      const value = snapshot(event);
      observations.rawEvents.push(value);
      observations.events.push(projectEvent(value));
      const type = member(event, "type");
      const op = typeof type === "string" ? scripts.bindings.emit?.get(type) : undefined;
      if (op) await runOp(op, event, { gates: scripts.gates, counters: scripts.counters, owner });
    },
  };
}
