import { isAbsolute, relative, sep } from "node:path";
import { isRecord, jsonIssues, ownKeys, pointer, setKey, type PointerSegment } from "./json.ts";
import { validateDefinition, validateRootProperty, validateSchema } from "./schema.ts";
import {
  type AgentSpec, type CarrySpec, type ConfigIssue, type ConfigIssueCode, type ExtensionUse, type GoondanConfig,
  type InlineHookSpec, type InputRule, type Json, type RouteSpec, type SystemBlockSpec,
  type ToolUse, type ValueName,
} from "./types.ts";

export const valueNames: readonly ValueName[] = ["input", "conversation", "modelInput", "modelResult", "toolCall", "toolResult", "output", "error"];
const valueNameSet = new Set<string>(valueNames);

export function isValueName(value: string): value is ValueName {
  return valueNameSet.has(value);
}

function record(value: Json | undefined): Record<string, Json> | undefined {
  return isRecord(value) ? value : undefined;
}

function list(value: Json | undefined): Json[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function issue(code: ConfigIssueCode, segments: readonly PointerSegment[], message: string): ConfigIssue {
  return { code, path: pointer(segments), message };
}

/** The composed document the schema phase checks: only `version` and `name` get their defaults. */
export function composedDocument(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const result: Record<string, unknown> = {};
  if (!Object.hasOwn(raw, "version")) result.version = 1;
  if (!Object.hasOwn(raw, "name")) result.name = "goondan";
  for (const key of ownKeys(raw)) {
    const value = raw[key];
    if (value !== undefined) setKey(result, key, value);
  }
  return result;
}

/** Schema-phase issues: the schema itself plus values that are not JSON. */
export function schemaIssues(document: Record<string, unknown>): ConfigIssue[] {
  return [...jsonIssues(document), ...validateSchema(document)];
}

/** The exposed name of one `tools` entry, or `undefined` when the entry has no name. */
export function exposedToolName(entry: Json): string | undefined {
  if (typeof entry === "string") return entry;
  const value = record(entry);
  if (!value) return undefined;
  if (typeof value.tool === "string") return value.tool;
  if (typeof value.agent === "string") return value.agent;
  return undefined;
}

/** Turns an absolute template path into the identifier the specification compares with. */
export function templateIdentifier(template: string, directory: string | undefined): string {
  if (directory === undefined || !isAbsolute(template)) return template;
  const relativePath = relative(directory, template);
  return relativePath.split(sep).join("/");
}

/** The identifier `remove.hooks`, hook events and hook sub-conversations use. */
export function hookIdentifier(hook: Json, directory: string | undefined): string | undefined {
  const value = record(hook);
  if (!value) return undefined;
  if (typeof value.name === "string") return value.name;
  if (typeof value.extension === "string") return value.extension;
  if (typeof value.fn === "string") return value.fn;
  if (typeof value.agent === "string") return value.agent;
  const agents = list(value.agent);
  if (agents) return agents.map((item) => (typeof item === "string" ? item : "")).join("+");
  if (typeof value.template === "string") return templateIdentifier(value.template, directory);
  return undefined;
}

/** The identifier of a hook of the effective configuration. */
export function inlineHookIdentifier(hook: InlineHookSpec, directory: string | undefined): string | undefined {
  if (typeof hook.name === "string") return hook.name;
  if (typeof hook.extension === "string") return hook.extension;
  if (typeof hook.fn === "string") return hook.fn;
  if (typeof hook.agent === "string") return hook.agent;
  if (Array.isArray(hook.agent)) return hook.agent.join("+");
  if (typeof hook.template === "string") return templateIdentifier(hook.template, directory);
  return undefined;
}

function mergeInherited(base: Json | undefined, patch: Json): Json {
  if (!isRecord(base) || !isRecord(patch)) return structuredClone(patch);
  const result: Record<string, Json> = {};
  for (const key of ownKeys(base)) {
    const next = Object.hasOwn(patch, key) ? patch[key] : undefined;
    setKey(result, key, next === undefined ? structuredClone(base[key] ?? null) : mergeInherited(base[key], next));
  }
  for (const key of ownKeys(patch)) {
    if (Object.hasOwn(result, key)) continue;
    setKey(result, key, structuredClone(patch[key] ?? null));
  }
  return result;
}

function removeHooksBy(result: Record<string, Json>, drop: (hook: Json) => boolean): void {
  const hooks = record(result.hooks);
  if (!hooks) return;
  for (const stage of ownKeys(hooks)) {
    const entries = list(hooks[stage]);
    if (!entries) continue;
    hooks[stage] = entries.filter((hook) => !drop(hook));
  }
}

function applyRemove(result: Record<string, Json>, remove: Record<string, Json>, directory: string | undefined): void {
  const tools = list(remove.tools);
  if (tools) {
    const names = new Set(tools.filter((item): item is string => typeof item === "string"));
    const current = list(result.tools);
    if (current) result.tools = current.filter((entry) => { const name = exposedToolName(entry); return name === undefined || !names.has(name); });
  }
  const extensions = list(remove.extensions);
  if (extensions) {
    const names = new Set(extensions.filter((item): item is string => typeof item === "string"));
    const current = record(result.extensions);
    if (current) for (const name of names) delete current[name];
    removeHooksBy(result, (hook) => { const value = record(hook); return value !== undefined && typeof value.extension === "string" && names.has(value.extension); });
  }
  const hooks = record(remove.hooks);
  if (hooks) {
    const current = record(result.hooks);
    if (current) {
      for (const stage of ownKeys(hooks)) {
        const identifiers = list(hooks[stage]);
        const entries = list(current[stage]);
        if (!identifiers || !entries) continue;
        const names = new Set(identifiers.filter((item): item is string => typeof item === "string"));
        current[stage] = entries.filter((hook) => { const id = hookIdentifier(hook, directory); return id === undefined || !names.has(id); });
      }
    }
  }
}

export interface InheritanceResult {
  /** `상속 결과` per agent, in declaration order. Agents that cannot resolve are absent. */
  resolved: Map<string, Record<string, Json>>;
  issues: ConfigIssue[];
}

/** Applies `inherit` and `remove` and reports the two inheritance reference errors. */
export function resolveInheritance(agents: Record<string, Json>, directory: string | undefined): InheritanceResult {
  const names = ownKeys(agents);
  const order = new Map(names.map((name, index) => [name, index]));
  const resolved = new Map<string, Record<string, Json>>();
  const broken = new Set<string>();
  const issues: ConfigIssue[] = [];
  const reportedCycles = new Set<string>();
  const stack: string[] = [];

  const build = (name: string): Record<string, Json> | undefined => {
    const cached = resolved.get(name);
    if (cached) return cached;
    if (broken.has(name)) return undefined;
    const cycleStart = stack.indexOf(name);
    if (cycleStart >= 0) {
      const members = stack.slice(cycleStart);
      const key = [...members].sort().join("\u0000");
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        const first = [...members].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))[0] ?? name;
        issues.push(issue("reference.inherit_cycle", ["agents", first, "inherit"], `inheritance forms a cycle: ${[...members, members[0] ?? name].join(" -> ")}`));
      }
      for (const member of members) broken.add(member);
      return undefined;
    }
    const declaration = record(agents[name]);
    if (!declaration) { broken.add(name); return undefined; }
    let base: Json = {};
    const parent = declaration.inherit;
    if (parent !== undefined) {
      if (typeof parent !== "string" || !Object.hasOwn(agents, parent)) {
        issues.push(issue("reference.inherit", ["agents", name, "inherit"], `does not name an agent of this configuration`));
        broken.add(name);
        return undefined;
      }
      stack.push(name);
      const inherited = build(parent);
      stack.pop();
      if (!inherited) { broken.add(name); return undefined; }
      base = inherited;
    }
    const own: Record<string, Json> = {};
    for (const key of ownKeys(declaration)) {
      if (key === "inherit" || key === "remove") continue;
      setKey(own, key, declaration[key] ?? null);
    }
    const merged = mergeInherited(base, own);
    const result = isRecord(merged) ? merged : {};
    const remove = record(declaration.remove);
    if (remove) applyRemove(result, remove, directory);
    resolved.set(name, result);
    return result;
  };

  for (const name of names) build(name);
  return { resolved, issues };
}

/** Builds the effective spec of one agent from its inheritance result. */
export function effectiveAgent(inherited: Record<string, Json>): Record<string, Json> {
  const isConfigAgent = typeof inherited.config === "string";
  const result: Record<string, Json> = {};
  for (const key of ownKeys(inherited)) {
    if (isConfigAgent && key !== "config" && key !== "description") continue;
    setKey(result, key, structuredClone(inherited[key] ?? null));
  }
  if (isConfigAgent) return result;
  const extensions = record(result.extensions);
  const disabled = new Set(extensions ? ownKeys(extensions).filter((name) => record(extensions[name])?.enabled === false) : []);
  if (disabled.size > 0) {
    removeHooksBy(result, (hook) => { const value = record(hook); return value !== undefined && typeof value.extension === "string" && disabled.has(value.extension); });
  }
  return result;
}

/** The object-form flow of the effective config. */
export function normalizeFlow(flow: Json | undefined, firstAgent: string): Record<string, Json> {
  if (flow === undefined) return { in: firstAgent };
  const sequence = list(flow);
  if (sequence) {
    const steps = sequence.filter((item): item is string => typeof item === "string");
    const routes: Json[] = steps.map((step, index) => ({ from: step, to: steps[index + 1] ?? "out" }));
    return { in: steps[0] ?? firstAgent, routes };
  }
  const value = record(flow);
  if (!value) return { in: firstAgent };
  return structuredClone(value);
}

/** One route of the declared object flow whose `from` and `to` both name something the flow can run. */
interface FlowEdge { index: number; from: string; to: string; conditional: boolean; carry: Json | undefined }

/**
 * The routes the structure checks apply to: a route whose `from` or `to` names an agent this
 * configuration does not declare is left out of every one of the three checks.
 */
function flowEdges(routes: readonly Json[], agents: ReadonlySet<string>): FlowEdge[] {
  const edges: FlowEdge[] = [];
  routes.forEach((raw, index) => {
    const route = record(raw);
    if (!route) return;
    const from = route.from;
    const to = route.to;
    if (typeof from !== "string" || typeof to !== "string") return;
    if (!agents.has(from)) return;
    if (to !== "out" && !agents.has(to)) return;
    edges.push({ index, from, to, conditional: isRecord(route.when), carry: route.carry });
  });
  return edges;
}

/** The agents each agent reaches by following routes that declare no `when`. */
function unconditionalReach(edges: readonly FlowEdge[]): Map<string, Set<string>> {
  const next = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.conditional || edge.to === "out") continue;
    const targets = next.get(edge.from) ?? new Set<string>();
    targets.add(edge.to);
    next.set(edge.from, targets);
  }
  const reach = new Map<string, Set<string>>();
  for (const start of next.keys()) {
    const seen = new Set<string>();
    const queue = [...next.get(start) ?? []];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined || seen.has(node)) continue;
      seen.add(node);
      queue.push(...next.get(node) ?? []);
    }
    reach.set(start, seen);
  }
  return reach;
}

/** `flow.no_route`, `flow.cycle` and `flow.carry_conversation` of a declared object flow. */
function flowStructureIssues(value: Record<string, Json>, agents: ReadonlySet<string>, configAgents: ReadonlySet<string>): ConfigIssue[] {
  const routes = list(value.routes);
  if (!routes) return [];
  const issues: ConfigIssue[] = [];
  const edges = flowEdges(routes, agents);
  // Every declared route continues its `from`, even one the three checks leave out for a bad endpoint.
  const sources = new Set(routes.map((raw) => record(raw)?.from).filter((from): from is string => typeof from === "string"));
  const entry = value.in;
  if (typeof entry === "string" && agents.has(entry) && !sources.has(entry)) {
    issues.push(issue("flow.no_route", ["flow", "in"], `no route declares ${JSON.stringify(entry)} as its from`));
  }
  for (const edge of edges) {
    if (edge.to === "out" || sources.has(edge.to)) continue;
    issues.push(issue("flow.no_route", ["flow", "routes", edge.index, "to"], `no route declares ${JSON.stringify(edge.to)} as its from`));
  }
  const reach = unconditionalReach(edges);
  for (const edge of edges) {
    if (edge.conditional || edge.to === "out") continue;
    if (edge.to !== edge.from && !reach.get(edge.to)?.has(edge.from)) continue;
    issues.push(issue("flow.cycle", ["flow", "routes", edge.index], "belongs to a cycle of routes that declare no when"));
  }
  for (const edge of edges) {
    if (edge.to === "out") continue;
    if (!configAgents.has(edge.from) && !configAgents.has(edge.to)) continue;
    const conversation = record(edge.carry)?.conversation;
    if (conversation === undefined || conversation === "none") continue;
    issues.push(issue("flow.carry_conversation", ["flow", "routes", edge.index, "carry", "conversation"], "a route connected to a config agent cannot carry a conversation"));
  }
  return issues;
}

function flowIssues(flow: Json | undefined, agents: ReadonlySet<string>, configAgents: ReadonlySet<string>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (flow === undefined) return issues;
  const sequence = list(flow);
  if (sequence) {
    sequence.forEach((step, index) => {
      if (typeof step === "string" && !agents.has(step)) issues.push(issue("reference.agent", ["flow", index], "does not name an agent of this configuration"));
    });
    return issues;
  }
  const value = record(flow);
  if (!value) return issues;
  if (typeof value.in === "string" && !agents.has(value.in)) issues.push(issue("reference.agent", ["flow", "in"], "does not name an agent of this configuration"));
  const routes = list(value.routes);
  if (!routes) return issues;
  routes.forEach((raw, index) => {
    const route = record(raw);
    if (!route) return;
    if (typeof route.from === "string" && !agents.has(route.from)) issues.push(issue("reference.agent", ["flow", "routes", index, "from"], "does not name an agent of this configuration"));
    if (typeof route.to === "string" && route.to !== "out" && !agents.has(route.to)) issues.push(issue("reference.agent", ["flow", "routes", index, "to"], "does not name an agent of this configuration"));
  });
  issues.push(...flowStructureIssues(value, agents, configAgents));
  return issues;
}

function agentReferenceIssues(name: string, spec: Record<string, Json>, agents: ReadonlySet<string>, directory: string | undefined): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (typeof spec.config === "string") return issues;
  const tools = list(spec.tools);
  if (tools) {
    const seen = new Set<string>();
    tools.forEach((entry, index) => {
      const exposed = exposedToolName(entry);
      if (exposed !== undefined) {
        if (seen.has(exposed)) issues.push(issue("reference.duplicate_tool", ["agents", name, "tools", index], `repeats the tool name ${JSON.stringify(exposed)}`));
        seen.add(exposed);
      }
      const value = record(entry);
      if (value && typeof value.agent === "string" && !agents.has(value.agent)) {
        issues.push(issue("reference.agent", ["agents", name, "tools", index, "agent"], "does not name an agent of this configuration"));
      }
    });
  }
  const extensions = record(spec.extensions);
  const hooks = record(spec.hooks);
  if (!hooks) return issues;
  for (const stage of ownKeys(hooks)) {
    const entries = list(hooks[stage]);
    if (!entries) continue;
    const asyncIdentifiers = new Set<string>();
    entries.forEach((raw, index) => {
      const hook = record(raw);
      if (!hook) return;
      const at: PointerSegment[] = ["agents", name, "hooks", stage, index];
      if (typeof hook.extension === "string" && (!extensions || !Object.hasOwn(extensions, hook.extension))) {
        issues.push(issue("reference.extension", [...at, "extension"], "does not name an extension this agent uses"));
      }
      if (typeof hook.agent === "string" && !agents.has(hook.agent)) {
        issues.push(issue("reference.agent", [...at, "agent"], "does not name an agent of this configuration"));
      }
      const agentList = list(hook.agent);
      if (agentList) {
        agentList.forEach((item, position) => {
          if (typeof item === "string" && !agents.has(item)) issues.push(issue("reference.agent", [...at, "agent", position], "does not name an agent of this configuration"));
        });
      }
      if (stage === "conversation" && hook.mode === "async") {
        const identifier = hookIdentifier(raw, directory);
        if (identifier !== undefined) {
          if (asyncIdentifiers.has(identifier)) issues.push(issue("reference.duplicate_hook", at, `repeats the async hook ${JSON.stringify(identifier)}`));
          asyncIdentifiers.add(identifier);
        }
      }
    });
  }
  return issues;
}

function toInputRule(raw: Record<string, Json>): InputRule {
  const rule: InputRule = {};
  for (const key of ownKeys(raw)) {
    const value = raw[key];
    if (key === "fn" && typeof value === "string") rule.fn = value;
    else if (key === "template" && typeof value === "string") rule.template = value;
    else if (key === "fields" && isRecord(value)) {
      const fields: Record<string, string> = {};
      for (const field of ownKeys(value)) { const text = value[field]; if (typeof text === "string") setKey(fields, field, text); }
      rule.fields = fields;
    }
  }
  return rule;
}

function toSystemBlock(raw: Json): SystemBlockSpec {
  const value = record(raw);
  const block: SystemBlockSpec = {};
  if (!value) return block;
  for (const key of ownKeys(value)) {
    const item = value[key];
    if (key === "text" && typeof item === "string") block.text = item;
    else if (key === "template" && typeof item === "string") block.template = item;
    else if (key === "cache" && typeof item === "boolean") block.cache = item;
  }
  return block;
}

function toToolUse(raw: Json): string | ToolUse {
  if (typeof raw === "string") return raw;
  const value = record(raw);
  const use: ToolUse = {};
  if (!value) return use;
  for (const key of ownKeys(value)) {
    const item = value[key];
    if (key === "tool" && typeof item === "string") use.tool = item;
    else if (key === "agent" && typeof item === "string") use.agent = item;
    else if (key === "hint" && typeof item === "string") use.hint = item;
    else if (key === "approval" && item === "required") use.approval = item;
  }
  return use;
}

function toHook(raw: Json): InlineHookSpec {
  const value = record(raw);
  const hook: InlineHookSpec = {};
  if (!value) return hook;
  for (const key of ownKeys(value)) {
    const item = value[key];
    if (key === "name" && typeof item === "string") hook.name = item;
    else if (key === "extension" && typeof item === "string") hook.extension = item;
    else if (key === "fn" && typeof item === "string") hook.fn = item;
    else if (key === "template" && typeof item === "string") hook.template = item;
    else if (key === "agent" && typeof item === "string") hook.agent = item;
    else if (key === "agent" && Array.isArray(item)) hook.agent = item.filter((name): name is string => typeof name === "string");
    else if (key === "using" && (item === "input" || item === "conversation")) hook.using = item;
    else if (key === "using" && isRecord(item) && typeof item.fn === "string") hook.using = { fn: item.fn };
    else if (key === "when" && isRecord(item) && typeof item.fn === "string") hook.when = { fn: item.fn };
    else if (key === "mode" && (item === "sync" || item === "async")) hook.mode = item;
    else if (key === "optional" && typeof item === "boolean") hook.optional = item;
    else if (key === "role" && (item === "user" || item === "system")) hook.role = item;
    else if (key === "timeout" && typeof item === "number") hook.timeout = item;
  }
  return hook;
}

function toExtensionUse(raw: Json): ExtensionUse {
  const value = record(raw);
  const use: ExtensionUse = {};
  if (!value) return use;
  for (const key of ownKeys(value)) {
    const item = value[key];
    if (key === "enabled" && typeof item === "boolean") use.enabled = item;
    else if (key === "options" && isRecord(item)) use.options = item;
  }
  return use;
}

function toAgentSpec(raw: Record<string, Json>): AgentSpec {
  const spec: AgentSpec = {};
  for (const key of ownKeys(raw)) {
    const value = raw[key];
    if (key === "description" && typeof value === "string") spec.description = value;
    else if (key === "model" && typeof value === "string") spec.model = value;
    else if (key === "config" && typeof value === "string") spec.config = value;
    else if (key === "params" && isRecord(value)) spec.params = value;
    else if (key === "input" && value === "asis") spec.input = value;
    else if (key === "input" && isRecord(value)) spec.input = toInputRule(value);
    else if (key === "systemMessage" && Array.isArray(value)) spec.systemMessage = value.map(toSystemBlock);
    else if (key === "systemMessage" && isRecord(value)) spec.systemMessage = toSystemBlock(value);
    else if (key === "tools" && Array.isArray(value)) spec.tools = value.map(toToolUse);
    else if (key === "extensions" && isRecord(value)) {
      const extensions: Record<string, ExtensionUse> = {};
      for (const name of ownKeys(value)) setKey(extensions, name, toExtensionUse(value[name] ?? {}));
      spec.extensions = extensions;
    } else if (key === "hooks" && isRecord(value)) {
      const hooks: Partial<Record<ValueName, InlineHookSpec[]>> = {};
      for (const stage of ownKeys(value)) {
        const entries = list(value[stage]);
        if (entries && isValueName(stage)) hooks[stage] = entries.map(toHook);
      }
      spec.hooks = hooks;
    }
  }
  return spec;
}

function toCarry(raw: Json | undefined): CarrySpec | undefined {
  const value = record(raw);
  if (!value) return undefined;
  const carry: CarrySpec = {};
  const message = value.message;
  if (message === "output") carry.message = message;
  else if (isRecord(message) && typeof message.fn === "string") carry.message = { fn: message.fn };
  else if (isRecord(message) && typeof message.template === "string") carry.message = { template: message.template };
  const conversation = value.conversation;
  if (conversation === "none" || conversation === "asis") carry.conversation = conversation;
  else if (isRecord(conversation) && typeof conversation.fn === "string") carry.conversation = { fn: conversation.fn };
  return carry;
}

function toRoutes(raw: Json | undefined): RouteSpec[] | undefined {
  const entries = list(raw);
  if (!entries) return undefined;
  const routes: RouteSpec[] = [];
  for (const item of entries) {
    const value = record(item);
    if (!value || typeof value.from !== "string" || typeof value.to !== "string") continue;
    const route: RouteSpec = { from: value.from, to: value.to };
    const when = record(value.when);
    if (when && typeof when.fn === "string") route.when = { fn: when.fn };
    const carry = toCarry(value.carry);
    if (carry) route.carry = carry;
    routes.push(route);
  }
  return routes;
}

export interface EffectiveResult {
  config: GoondanConfig;
  /** The effective configuration as plain JSON, used for reference and binding paths. */
  document: Record<string, Json>;
  issues: ConfigIssue[];
}

/**
 * Runs the reference phase on a schema-valid composed document and returns the effective config.
 * `directory` is the configuration directory, used for template hook identifiers.
 */
export function buildEffective(composed: Record<string, Json>, directory: string | undefined): EffectiveResult {
  const agents = record(composed.agents) ?? {};
  const declared = new Set(ownKeys(agents));
  const inheritance = resolveInheritance(agents, directory);
  const issues: ConfigIssue[] = [...inheritance.issues];

  const effectiveAgents: Record<string, Json> = {};
  for (const [name, inherited] of inheritance.resolved) setKey(effectiveAgents, name, effectiveAgent(inherited));

  const firstAgent = ownKeys(agents)[0] ?? "";
  const flow = normalizeFlow(composed.flow, firstAgent);
  const document: Record<string, Json> = {
    version: 1,
    name: typeof composed.name === "string" ? composed.name : "goondan",
    agents: effectiveAgents,
    flow,
  };

  issues.push(...validateRootProperty("version", document.version, ["version"]));
  issues.push(...validateRootProperty("name", document.name, ["name"]));
  issues.push(...validateDefinition("flow", flow, ["flow"]));
  for (const name of ownKeys(effectiveAgents)) {
    issues.push(...validateDefinition("agent", effectiveAgents[name], ["agents", name]));
  }
  const configAgents = new Set(ownKeys(effectiveAgents).filter((name) => typeof record(effectiveAgents[name])?.config === "string"));
  issues.push(...flowIssues(composed.flow, declared, configAgents));
  for (const name of ownKeys(effectiveAgents)) {
    const spec = record(effectiveAgents[name]);
    if (spec) issues.push(...agentReferenceIssues(name, spec, declared, directory));
  }

  const typedAgents: Record<string, AgentSpec> = {};
  for (const name of ownKeys(effectiveAgents)) {
    const spec = record(effectiveAgents[name]);
    if (spec) setKey(typedAgents, name, toAgentSpec(spec));
  }
  const routes = toRoutes(flow.routes);
  const typedFlow: GoondanConfig["flow"] = { in: typeof flow.in === "string" ? flow.in : firstAgent };
  if (routes) typedFlow.routes = routes;
  const config: GoondanConfig = {
    version: 1,
    name: typeof document.name === "string" ? document.name : "goondan",
    agents: typedAgents,
    flow: typedFlow,
  };
  return { config, document, issues };
}
