import { pointer, type PointerSegment } from "./json.ts";
import { isValueName } from "./effective.ts";
import {
  type AgentSpec, type ConfigIssue, type ConfigIssueCode, type ExtensionDefinition, type GoondanConfig,
  type RuntimeBindings, type ToolUse,
} from "./types.ts";

function issue(code: ConfigIssueCode, segments: readonly PointerSegment[], message: string): ConfigIssue {
  return { code, path: pointer(segments), message };
}

function hasBinding(map: Record<string, unknown> | undefined, name: string): boolean {
  return map !== undefined && Object.hasOwn(map, name) && map[name] !== undefined;
}

function definitionOf(bindings: RuntimeBindings, name: string): ExtensionDefinition | undefined {
  const extensions = bindings.extensions;
  if (!extensions || !Object.hasOwn(extensions, name)) return undefined;
  return extensions[name];
}

/** The exposed name of one `tools` entry, and whether it is an agent tool. */
export function toolEntry(entry: string | ToolUse): { name: string; agent: boolean; segment: "tool" | undefined } | undefined {
  if (typeof entry === "string") return { name: entry, agent: false, segment: undefined };
  if (typeof entry.tool === "string") return { name: entry.tool, agent: false, segment: "tool" };
  if (typeof entry.agent === "string") return { name: entry.agent, agent: true, segment: undefined };
  return undefined;
}

/** The extensions an agent enables, in declaration order. */
export function enabledExtensions(spec: AgentSpec): string[] {
  const extensions = spec.extensions;
  if (!extensions) return [];
  return Object.keys(extensions).filter((name) => extensions[name]?.enabled !== false);
}

function functionIssues(name: string | undefined, bindings: RuntimeBindings, segments: readonly PointerSegment[]): ConfigIssue[] {
  if (typeof name !== "string") return [];
  if (hasBinding(bindings.functions, name)) return [];
  return [issue("binding.function", segments, "does not name a function the host registered")];
}

function agentBindingIssues(name: string, spec: AgentSpec, bindings: RuntimeBindings, base: readonly PointerSegment[]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const at: PointerSegment[] = [...base, "agents", name];
  if (typeof spec.model === "string" && !hasBinding(bindings.models, spec.model)) {
    issues.push(issue("binding.model", [...at, "model"], "does not name a model the host registered"));
  }
  const enabled = enabledExtensions(spec);
  for (const extension of enabled) {
    const definition = definitionOf(bindings, extension);
    const location: PointerSegment[] = [...at, "extensions", extension];
    if (!definition) {
      issues.push(issue("binding.extension", location, "does not name an extension the host registered"));
      continue;
    }
    for (const port of definition.requires ?? []) {
      if (!hasBinding(bindings.ports, port)) {
        issues.push(issue("binding.port", location, `requires the port ${JSON.stringify(port)}, which the host did not register`));
      }
    }
  }
  for (const [index, entry] of (spec.tools ?? []).entries()) {
    const resolved = toolEntry(entry);
    if (!resolved || resolved.agent) continue;
    const location: PointerSegment[] = resolved.segment === undefined ? [...at, "tools", index] : [...at, "tools", index, resolved.segment];
    let total = hasBinding(bindings.tools, resolved.name) ? 1 : 0;
    let undeclared = false;
    for (const extension of enabled) {
      const definition = definitionOf(bindings, extension);
      if (!definition) continue;
      const declared = definition.tools;
      if (!declared || declared.length === 0) { undeclared = true; continue; }
      if (declared.includes(resolved.name)) total += 1;
    }
    if (total === 0 && !undeclared) issues.push(issue("binding.tool", location, "does not name a tool the host or an enabled extension provides"));
    else if (total > 1) issues.push(issue("binding.duplicate_tool", location, "names a tool that more than one implementation provides"));
  }
  const input = spec.input;
  if (input !== undefined && input !== "asis") issues.push(...functionIssues(input.fn, bindings, [...at, "input", "fn"]));
  for (const [stage, entries] of Object.entries(spec.hooks ?? {})) {
    if (!entries) continue;
    for (const [index, hook] of entries.entries()) {
      const location: PointerSegment[] = [...at, "hooks", stage, index];
      issues.push(...functionIssues(hook.fn, bindings, [...location, "fn"]));
      const using = hook.using;
      if (using !== undefined && typeof using !== "string") issues.push(...functionIssues(using.fn, bindings, [...location, "using", "fn"]));
      if (hook.when) issues.push(...functionIssues(hook.when.fn, bindings, [...location, "when", "fn"]));
      if (typeof hook.extension !== "string") continue;
      const declared = definitionOf(bindings, hook.extension)?.hooks;
      if (!declared || declared.length === 0) continue;
      if (!isValueName(stage) || !declared.includes(stage)) {
        issues.push(issue("binding.extension_hook", [...location, "extension"], `does not provide the ${stage} stage`));
      }
    }
  }
  return issues;
}

/** Binding-phase issues of one effective configuration. */
export function bindingIssues(config: GoondanConfig, bindings: RuntimeBindings, base: readonly PointerSegment[] = []): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const [name, spec] of Object.entries(config.agents)) {
    if (spec) issues.push(...agentBindingIssues(name, spec, bindings, base));
  }
  for (const [index, route] of (config.routes ?? []).entries()) {
    const at: PointerSegment[] = [...base, "routes", index];
    if (route.when && "fn" in route.when) issues.push(...functionIssues(route.when.fn, bindings, [...at, "when", "fn"]));
  }
  return issues;
}

export interface ProvidedExtension { stages: readonly string[]; tools: readonly string[] }

/**
 * The checks the runtime repeats once extension instances exist, using the hook functions and tools
 * the instances actually provide.
 */
export function instanceIssues(
  agent: string,
  spec: AgentSpec,
  bindings: RuntimeBindings,
  provided: ReadonlyMap<string, ProvidedExtension>,
  base: readonly PointerSegment[] = [],
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const at: PointerSegment[] = [...base, "agents", agent];
  for (const [stage, entries] of Object.entries(spec.hooks ?? {})) {
    if (!entries) continue;
    for (const [index, hook] of entries.entries()) {
      if (typeof hook.extension !== "string") continue;
      const instance = provided.get(hook.extension);
      if (!instance || instance.stages.includes(stage)) continue;
      issues.push(issue("binding.extension_hook", [...at, "hooks", stage, index, "extension"], `does not provide the ${stage} stage`));
    }
  }
  for (const [index, entry] of (spec.tools ?? []).entries()) {
    const resolved = toolEntry(entry);
    if (!resolved || resolved.agent) continue;
    const location: PointerSegment[] = resolved.segment === undefined ? [...at, "tools", index] : [...at, "tools", index, resolved.segment];
    let total = hasBinding(bindings.tools, resolved.name) ? 1 : 0;
    for (const instance of provided.values()) if (instance.tools.includes(resolved.name)) total += 1;
    if (total === 0) issues.push(issue("binding.tool", location, "does not name a tool the host or an enabled extension provides"));
    else if (total > 1) issues.push(issue("binding.duplicate_tool", location, "names a tool that more than one implementation provides"));
  }
  return issues;
}
