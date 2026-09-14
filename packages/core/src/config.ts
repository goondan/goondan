import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { parse } from "yaml";
import { type AgentSpec, type GoondanConfig, type Json, type LoadedConfig } from "./types.ts";

const valueNames = new Set(["input", "conversation", "modelInput", "modelResult", "toolCall", "toolResult", "output", "error"]);
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isJson(value: unknown): value is Json { if (value === null || typeof value === "string" || typeof value === "boolean") return true; if (typeof value === "number") return Number.isFinite(value); if (Array.isArray(value)) return value.every(isJson); return isObject(value) && Object.values(value).every(isJson); }
function assertObject(value: unknown, at: string): Record<string, unknown> { if (!isObject(value)) throw new Error(`${at} must be an object`); return value; }
function assertString(value: unknown, at: string): string { if (typeof value !== "string" || value.length === 0) throw new Error(`${at} must be a non-empty string`); return value; }

function validateAgent(name: string, raw: unknown): AgentSpec {
  const value = assertObject(raw, `agents.${name}`);
  if (value.config !== undefined) return { config: assertString(value.config, `agents.${name}.config`) };
  if (value.inherit !== undefined || value.remove !== undefined) throw new Error(`agents.${name} inheritance was not resolved`);
  const model = assertString(value.model, `agents.${name}.model`);
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools)) throw new Error(`agents.${name}.tools must be an array`);
    for (const tool of value.tools) {
      if (typeof tool === "string") { assertString(tool, "tool name"); continue; }
      const use = assertObject(tool, "tool entry");
      for (const field of Object.keys(use)) if (!["tool", "agent", "hint", "approval"].includes(field)) throw new Error(`tool entry.${field} is not supported`);
      if (("tool" in use) === ("agent" in use)) throw new Error("Tool entries must specify exactly one of tool or agent");
      assertString("tool" in use ? use.tool : use.agent, "tool reference");
      if (use.hint !== undefined && typeof use.hint !== "string") throw new Error("tool entry.hint must be a string");
      if (use.approval !== undefined && use.approval !== "required") throw new Error("tool entry.approval must be required");
    }
  }
  if (value.params !== undefined && !isJson(value.params)) throw new Error(`agents.${name}.params must be JSON`);
  if (value.hooks !== undefined) {
    const hooks = assertObject(value.hooks, `agents.${name}.hooks`);
    for (const [hookName, list] of Object.entries(hooks)) {
      if (!valueNames.has(hookName) || !Array.isArray(list)) throw new Error(`agents.${name}.hooks.${hookName} is invalid`);
      for (const [index, rawHook] of list.entries()) {
        const hook = assertObject(rawHook, `agents.${name}.hooks.${hookName}[${String(index)}]`);
        if (hook.mode === "async" && hookName !== "conversation") throw new Error(`agents.${name}.hooks.${hookName}[${String(index)}] mode async is only valid for conversation hooks`);
      }
    }
  }
  if (value.extensions !== undefined) {
    const extensions = assertObject(value.extensions, `agents.${name}.extensions`);
    for (const [extensionName, rawUse] of Object.entries(extensions)) {
      const use = assertObject(rawUse, `agents.${name}.extensions.${extensionName}`);
      for (const field of Object.keys(use)) if (!["enabled", "options"].includes(field)) throw new Error(`agents.${name}.extensions.${extensionName}.${field} is not supported`);
      if (use.options !== undefined && (!isObject(use.options) || !isJson(use.options))) throw new Error(`agents.${name}.extensions.${extensionName}.options must be a JSON object`);
      if (use.enabled !== undefined && typeof use.enabled !== "boolean") throw new Error(`agents.${name}.extensions.${extensionName}.enabled must be a boolean`);
    }
  }
  return { ...value, model };
}

function resolveAgents(rawAgents: Record<string, unknown>): Record<string, AgentSpec> {
  const agents: Record<string, AgentSpec> = {};
  const active = new Set<string>();
  const resolveAgent = (name: string): AgentSpec => {
    const cached = agents[name]; if (cached) return cached;
    if (active.has(name)) throw new Error(`Circular agent inheritance: ${name}`);
    if (!(name in rawAgents)) throw new Error(`Unknown inherited agent: ${name}`);
    active.add(name);
    const raw = assertObject(rawAgents[name], `agents.${name}`);
    const { inherit, remove, ...own } = raw;
    const base = inherit === undefined ? {} : resolveAgent(assertString(inherit, `agents.${name}.inherit`));
    const result = assertObject(merge(base, own), `agents.${name}`);
    if (remove !== undefined) {
      const removals = assertObject(remove, `agents.${name}.remove`);
      const names = (value: unknown, at: string): string[] => {
        if (!Array.isArray(value)) throw new Error(`${at} must be an array`);
        return value.map((item) => assertString(item, at));
      };
      for (const key of Object.keys(removals)) if (!["extensions", "tools", "hooks"].includes(key)) throw new Error(`Unknown removal field: ${key}`);
      if (removals.extensions !== undefined) {
        const extensions = assertObject(result.extensions ?? {}, `agents.${name}.extensions`);
        for (const item of names(removals.extensions, "remove.extensions")) delete extensions[item];
        result.extensions = extensions;
      }
      if (removals.tools !== undefined) {
        const removed = new Set(names(removals.tools, "remove.tools"));
        if (result.tools !== undefined && !Array.isArray(result.tools)) throw new Error("tools must be an array");
        result.tools = (Array.isArray(result.tools) ? result.tools : []).filter((tool: unknown) => !removed.has(typeof tool === "string" ? tool : assertString(assertObject(tool, "tool").tool ?? assertObject(tool, "tool").agent, "tool reference")));
      }
      if (removals.hooks !== undefined) {
        const hooks = assertObject(result.hooks ?? {}, `agents.${name}.hooks`);
        for (const [phase, entries] of Object.entries(assertObject(removals.hooks, "remove.hooks"))) {
          if (!valueNames.has(phase)) throw new Error(`Unknown hook phase: ${phase}`);
          const removed = new Set(names(entries, `remove.hooks.${phase}`));
          const list = hooks[phase] ?? [];
          if (!Array.isArray(list)) throw new Error(`hooks.${phase} must be an array`);
          hooks[phase] = list.filter((entry: unknown) => { const hook = assertObject(entry, "hook"); return !removed.has(String(hook.name ?? hook.extension ?? hook.fn ?? hook.template ?? "")); });
        }
        result.hooks = hooks;
      }
    }
    // An inactive extension never leaves a runnable hook reference behind.
    if (isObject(result.hooks)) for (const [phase, entries] of Object.entries(result.hooks)) {
      if (Array.isArray(entries)) result.hooks[phase] = entries.filter((entry: unknown) => {
        if (!isObject(entry) || typeof entry.extension !== "string") return true;
        const use = isObject(result.extensions) ? result.extensions[entry.extension] : undefined;
        if (use === undefined) {
          const explicitlyRemoved = isObject(remove) && Array.isArray(remove.extensions) && remove.extensions.includes(entry.extension);
          if (!explicitlyRemoved) throw new Error(`Unknown configured extension: ${entry.extension}`);
          return false;
        }
        return isObject(use) && use.enabled !== false;
      });
    }
    active.delete(name);
    const agent = validateAgent(name, result); agents[name] = agent; return agent;
  };
  for (const name of Object.keys(rawAgents)) resolveAgent(name);
  const ordered: Record<string, AgentSpec> = {};
  for (const name of Object.keys(rawAgents)) { const agent = agents[name]; if (agent) ordered[name] = agent; }
  return ordered;
}

export function validateConfig(raw: unknown): GoondanConfig {
  const value = assertObject(raw, "config");
  if (value.version !== undefined && value.version !== 1) throw new Error(`Unsupported config version: ${String(value.version)}`);
  const name = value.name === undefined ? "goondan" : assertString(value.name, "name");
  const rawAgents = assertObject(value.agents, "agents");
  const first = Object.keys(rawAgents)[0];
  if (!first) throw new Error("agents must contain at least one agent");
  const agents = resolveAgents(rawAgents);
  let rawFlow: Record<string, unknown>;
  if (Array.isArray(value.flow)) {
    const sequence = value.flow.map((entry) => assertString(entry, "flow agent"));
    if (sequence.length === 0) throw new Error("flow must contain at least one agent");
    if (new Set(sequence).size !== sequence.length) throw new Error("Serial flow agent names must be unique");
    rawFlow = { in: sequence[0], routes: sequence.map((agent, index) => ({ from: agent, to: sequence[index + 1] ?? "out" })) };
  } else rawFlow = value.flow === undefined ? { in: first } : assertObject(value.flow, "flow");
  const entry = assertString(rawFlow.in, "flow.in");
  if (!(entry in agents)) throw new Error(`flow.in references unknown agent: ${entry}`);
  if (rawFlow.routes !== undefined && !Array.isArray(rawFlow.routes)) throw new Error("flow.routes must be an array");
  if (Array.isArray(rawFlow.routes)) for (const route of rawFlow.routes) {
    const item = assertObject(route, "flow route");
    const from = assertString(item.from, "route.from"), to = assertString(item.to, "route.to");
    if (!(from in agents) || (to !== "out" && !(to in agents))) throw new Error(`Unknown flow agent: ${from} -> ${to}`);
  }
  return { version: 1, name, agents, flow: { ...rawFlow, in: entry } };
}

function merge(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) return structuredClone(patch);
  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    result[key] = merge(result[key], value);
  }
  return result;
}
function templateReferences(document: unknown): Record<string, unknown>[] {
  if (!isObject(document)) return [];
  const refs: Record<string, unknown>[] = [];
  const add = (value: unknown): void => { if (isObject(value)) refs.push(value); };
  if (isObject(document.agents)) for (const raw of Object.values(document.agents)) {
    if (!isObject(raw)) continue;
    add(raw.input);
    if (Array.isArray(raw.systemMessage)) raw.systemMessage.forEach(add); else add(raw.systemMessage);
    if (isObject(raw.hooks)) for (const hooks of Object.values(raw.hooks)) if (Array.isArray(hooks)) hooks.forEach(add);
  }
  if (isObject(document.flow) && Array.isArray(document.flow.routes)) for (const route of document.flow.routes) if (isObject(route) && isObject(route.carry)) add(route.carry.message);
  return refs;
}
function normalizeDeclaredPaths(value: unknown, baseDirectory: string): unknown {
  const normalized: unknown = structuredClone(value);
  for (const ref of templateReferences(normalized)) if (typeof ref.template === "string") ref.template = resolve(baseDirectory, ref.template);
  if (isObject(normalized) && isObject(normalized.agents)) for (const agent of Object.values(normalized.agents)) if (isObject(agent) && typeof agent.config === "string") agent.config = resolve(baseDirectory, agent.config);
  return normalized;
}

interface LoadState { loaded: Set<string>; active: string[]; directories: Set<string> }
async function entryPath(reference: string, declarationDirectory: string): Promise<string> {
  const candidate = resolve(declarationDirectory, reference);
  let information;
  try { information = await stat(candidate); } catch { throw new Error(`Config resource does not exist: ${candidate}`); }
  if (information.isDirectory()) return join(candidate, "goondan.yaml");
  if (!information.isFile() || ![".yaml", ".yml"].includes(extname(candidate))) throw new Error(`Config resource must be a YAML file or directory: ${candidate}`);
  return candidate;
}
async function loadYaml(path: string, state: LoadState): Promise<unknown> {
  const canonical = await realpath(path).catch(() => { throw new Error(`Config resource does not exist: ${path}`); });
  if (state.active.includes(canonical)) throw new Error(`Circular config resource: ${[...state.active, canonical].join(" -> ")}`);
  if (state.loaded.has(canonical)) throw new Error(`Duplicate config resource: ${canonical}`);
  state.loaded.add(canonical); state.active.push(canonical);
  state.directories.add(dirname(canonical));
  try {
    let raw: unknown;
    try { raw = parse(await readFile(canonical, "utf8")); } catch (error) { throw new Error(`Invalid YAML config ${canonical}: ${error instanceof Error ? error.message : String(error)}`); }
    const object = assertObject(raw, canonical);
    let result: unknown = {};
    if (object.extends !== undefined) result = merge(result, await loadYaml(await entryPath(assertString(object.extends, `${canonical}.extends`), dirname(canonical)), state));
    if (object.resources !== undefined) {
      if (!Array.isArray(object.resources)) throw new Error(`${canonical}.resources must be an array`);
      for (const [index, resource] of object.resources.entries()) result = merge(result, await loadYaml(await entryPath(assertString(resource, `${canonical}.resources[${String(index)}]`), dirname(canonical)), state));
    }
    const own = { ...object }; delete own.resources; delete own.extends;
    return merge(result, normalizeDeclaredPaths(own, dirname(canonical)));
  } finally { state.active.pop(); }
}
function collectTemplates(value: unknown): Set<string> {
  const names = new Set<string>();
  for (const ref of templateReferences(value)) if (typeof ref.template === "string") names.add(ref.template);
  return names;
}

async function loadTemplates(directories: ReadonlySet<string>, config: unknown): Promise<Map<string, string>> {
  const templates = new Map<string, string>();
  for (const root of [...directories].sort()) {
    const directory = join(root, "templates");
  try {
    const visit = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) { const source = await readFile(path, "utf8"); templates.set(path, source); templates.set(normalize(join("templates", relative(directory, path))), source); }
      }
    };
    await visit(directory);
  } catch (error) { if (!isObject(error) || error.code !== "ENOENT") throw error; }
  }
  for (const path of collectTemplates(config)) templates.set(path, await readFile(path, "utf8"));
  return templates;
}
export async function loadConfig(input: string, options: { variants?: string[] } = {}): Promise<LoadedConfig> {
  const inputPath = resolve(input);
  const information = await stat(inputPath).catch(() => { throw new Error(`Config path does not exist: ${inputPath}`); });
  const root = information.isDirectory() ? inputPath : dirname(inputPath);
  const entry = information.isDirectory() ? join(inputPath, "goondan.yaml") : inputPath;
  const state: LoadState = { loaded: new Set(), active: [], directories: new Set() };
  let raw = await loadYaml(entry, state);
  for (const variant of options.variants ?? []) {
    const variantState: LoadState = { loaded: new Set(), active: [], directories: state.directories };
    raw = merge(raw, await loadYaml(join(root, "variants", `${variant}.yaml`), variantState));
  }
  const config = validateConfig(raw);
  return { directory: root, config, templates: await loadTemplates(state.directories, config) };
}
