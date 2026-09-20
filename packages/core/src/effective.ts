import { isAbsolute, relative, sep } from "node:path";
import { isRecord, jsonIssues, ownKeys, pointer, setKey, type PointerSegment } from "./json.ts";
import { validateDefinition, validateRootProperty, validateSchema } from "./schema.ts";
import {
  type AgentSpec, type ConfigIssue, type ConfigIssueCode, type ExtensionUse, type GoondanConfig,
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

/** `remove.hooks`, 훅 이벤트와 훅 파생 세션이 사용하는 식별자입니다. */
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
  const result: Record<string, Json> = {};
  for (const key of ownKeys(inherited)) {
    setKey(result, key, structuredClone(inherited[key] ?? null));
  }
  const extensions = record(result.extensions);
  const disabled = new Set(extensions ? ownKeys(extensions).filter((name) => record(extensions[name])?.enabled === false) : []);
  if (disabled.size > 0) {
    removeHooksBy(result, (hook) => { const value = record(hook); return value !== undefined && typeof value.extension === "string" && disabled.has(value.extension); });
  }
  return result;
}

/** 이름 배열 축약형을 유효 구성에 저장할 route 객체로 펼칩니다. */
export function normalizeRoutes(routes: Json | undefined): Json[] | undefined {
  if (routes === undefined) return undefined;
  const entries = list(routes);
  if (!entries) return [];
  if (entries.every((entry) => typeof entry === "string")) {
    const names = entries.filter((entry): entry is string => typeof entry === "string");
    return names.map((name, index) => ({ from: index === 0 ? "$input" : names[index - 1] ?? "$input", to: name }))
      .concat(names.length === 0 ? [] : [{ from: names[names.length - 1] ?? "$input", to: "$output" }]);
  }
  return structuredClone(entries);
}

interface RouteEdge { index: number; from: string; to: string; conditional: boolean }

function routeEdges(routes: readonly Json[], agents: ReadonlySet<string>): RouteEdge[] {
  const edges: RouteEdge[] = [];
  routes.forEach((raw, index) => {
    const route = record(raw);
    if (!route || typeof route.from !== "string" || typeof route.to !== "string") return;
    const { from, to } = route;
    if (from === "$output" || to === "$input" || (from === "$input" && to === "$output")) return;
    if (from !== "$input" && !agents.has(from)) return;
    if (to !== "$output" && !agents.has(to)) return;
    edges.push({ index, from, to, conditional: isRecord(route.when) });
  });
  return edges;
}

/** The agents each agent reaches by following routes that declare no `when`. */
function unconditionalReach(edges: readonly RouteEdge[]): Map<string, Set<string>> {
  const next = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.conditional || edge.to === "$output") continue;
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

function allReach(edges: readonly RouteEdge[], start: string): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  const seen = new Set<string>();
  const queue = [...(next.get(start) ?? [])];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined || node === "$output" || seen.has(node)) continue;
    seen.add(node);
    queue.push(...(next.get(node) ?? []));
  }
  return seen;
}

/** 대상 에이전트를 지나지 않고 `$input`에서 도달하며 다시 대상에 도달할 수 있는 출발 집합입니다. */
function departureAgents(edges: readonly RouteEdge[], target: string): Set<string> {
  const reachable = new Set<string>();
  const queue = ["$input"];
  while (queue.length > 0) {
    const from = queue.shift();
    if (from === undefined) continue;
    for (const edge of edges) {
      if (edge.from !== from || edge.to === "$output" || edge.to === target || reachable.has(edge.to)) continue;
      reachable.add(edge.to);
      queue.push(edge.to);
    }
  }
  return new Set([...reachable].filter((agent) => allReach(edges, agent).has(target)));
}

function routeStructureIssues(routes: readonly Json[], agents: ReadonlySet<string>, specs: ReadonlyMap<string, Record<string, Json>>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const edges = routeEdges(routes, agents);
  const sources = new Set(edges.map((edge) => edge.from));
  if (!edges.some((edge) => edge.from === "$input")) issues.push(issue("routes.no_input", ["routes"], "no route starts from $input"));
  if (!edges.some((edge) => edge.to === "$output")) issues.push(issue("routes.no_output", ["routes"], "no route reaches $output"));
  for (const edge of edges) {
    if (edge.to === "$output" || sources.has(edge.to)) continue;
    issues.push(issue("routes.no_route", ["routes", edge.index, "to"], `no route declares ${JSON.stringify(edge.to)} as its from`));
  }
  const reachable = allReach(edges, "$input");
  for (const edge of edges) {
    if (edge.from === "$input" || reachable.has(edge.from)) continue;
    issues.push(issue("routes.unreachable", ["routes", edge.index, "from"], `${JSON.stringify(edge.from)} is unreachable from $input`));
  }
  const reach = unconditionalReach(edges);
  for (const edge of edges) {
    if (edge.conditional || edge.to === "$output" || edge.from === "$input") continue;
    if (edge.to !== edge.from && !reach.get(edge.to)?.has(edge.from)) continue;
    issues.push(issue("routes.cycle", ["routes", edge.index], "belongs to a cycle of routes that declare no when"));
  }
  const wait = new Map<string, Set<string>>();
  for (const target of agents) {
    if (specs.get(target)?.stateful === false) continue;
    const dependencies = new Set([...departureAgents(edges, target)].filter((agent) => specs.get(agent)?.stateful !== false));
    wait.set(target, dependencies);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let waitCycle = false;
  const visit = (agent: string): void => {
    if (visiting.has(agent)) { waitCycle = true; return; }
    if (visited.has(agent)) return;
    visiting.add(agent);
    for (const dependency of wait.get(agent) ?? []) if (wait.has(dependency)) visit(dependency);
    visiting.delete(agent); visited.add(agent);
  };
  for (const agent of wait.keys()) visit(agent);
  if (waitCycle) issues.push(issue("routes.wait_cycle", ["routes"], "stateful route waiting forms a cycle"));
  return issues;
}

function routeIssues(raw: Json | undefined, agents: ReadonlySet<string>, specs: ReadonlyMap<string, Record<string, Json>>): ConfigIssue[] {
  if (raw === undefined) return [];
  const declared = list(raw);
  if (!declared) return [];
  const serial = declared.every((entry) => typeof entry === "string");
  const issues: ConfigIssue[] = [];
  if (serial) {
    declared.forEach((entry, index) => {
      if (entry === "$input" || entry === "$output") issues.push(issue("routes.reserved", ["routes", index], "a reserved route endpoint cannot be an agent"));
      else if (typeof entry === "string" && !agents.has(entry)) issues.push(issue("reference.agent", ["routes", index], "does not name an agent of this configuration"));
    });
  } else {
    declared.forEach((rawRoute, index) => {
      const route = record(rawRoute);
      if (!route || typeof route.from !== "string" || typeof route.to !== "string") return;
      if (route.from === "$input" && route.to === "$output") issues.push(issue("routes.reserved", ["routes", index], "$input cannot route directly to $output"));
      else {
        if (route.from === "$output") issues.push(issue("routes.reserved", ["routes", index, "from"], "$output cannot be a route source"));
        else if (route.from !== "$input" && !agents.has(route.from)) issues.push(issue("reference.agent", ["routes", index, "from"], "does not name an agent of this configuration"));
        if (route.to === "$input") issues.push(issue("routes.reserved", ["routes", index, "to"], "$input cannot be a route target"));
        else if (route.to !== "$output" && !agents.has(route.to)) issues.push(issue("reference.agent", ["routes", index, "to"], "does not name an agent of this configuration"));
      }
    });
  }
  issues.push(...routeStructureIssues(normalizeRoutes(raw) ?? [], agents, specs));
  return issues;
}

function agentReferenceIssues(name: string, spec: Record<string, Json>, agents: ReadonlySet<string>, directory: string | undefined): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
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
    else if (key === "stateful" && typeof value === "boolean") spec.stateful = value;
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
    else if (when && typeof when.output === "string") route.when = { output: when.output };
    else if (when && isRecord(when.output)) route.when = { output: when.output };
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

  const document: Record<string, Json> = {
    version: 1,
    name: typeof composed.name === "string" ? composed.name : "goondan",
    agents: effectiveAgents,
  };
  const routes = normalizeRoutes(composed.routes);
  if (routes !== undefined) document.routes = routes;

  issues.push(...validateRootProperty("version", document.version, ["version"]));
  issues.push(...validateRootProperty("name", document.name, ["name"]));
  if (routes !== undefined) issues.push(...validateDefinition("routes", routes, ["routes"]));
  for (const name of ownKeys(effectiveAgents)) {
    issues.push(...validateDefinition("agent", effectiveAgents[name], ["agents", name]));
  }
  issues.push(...routeIssues(composed.routes, declared, inheritance.resolved));
  for (const name of ownKeys(effectiveAgents)) {
    const spec = record(effectiveAgents[name]);
    if (spec) issues.push(...agentReferenceIssues(name, spec, declared, directory));
  }

  const typedAgents: Record<string, AgentSpec> = {};
  for (const name of ownKeys(effectiveAgents)) {
    const spec = record(effectiveAgents[name]);
    if (spec) setKey(typedAgents, name, toAgentSpec(spec));
  }
  const config: GoondanConfig = {
    version: 1,
    name: typeof document.name === "string" ? document.name : "goondan",
    agents: typedAgents,
  };
  const typedRoutes = toRoutes(routes);
  if (typedRoutes !== undefined) config.routes = typedRoutes;
  return { config, document, issues };
}
