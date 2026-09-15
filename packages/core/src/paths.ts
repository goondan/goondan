import { isRecord, type PointerSegment } from "./json.ts";
import { type Json } from "./types.ts";

export type DeclaredPathKind = "config" | "template";

/** One YAML location that declares a file path, with the pointer the specification reports it at. */
export interface DeclaredPath {
  kind: DeclaredPathKind;
  segments: PointerSegment[];
  value: string;
  replace(next: string): void;
}

function holder(container: Record<string, Json>, key: string, kind: DeclaredPathKind, segments: PointerSegment[]): DeclaredPath | undefined {
  const value = container[key];
  if (typeof value !== "string" || value.length === 0) return undefined;
  return { kind, segments: [...segments, key], value, replace(next: string) { container[key] = next; } };
}

function templateHolder(container: unknown, segments: PointerSegment[]): DeclaredPath | undefined {
  if (!isJsonRecord(container)) return undefined;
  return holder(container, "template", "template", segments);
}

function isJsonRecord(value: unknown): value is Record<string, Json> {
  return isRecord(value);
}

/**
 * Every path declaration of a configuration document, in document order. Keys named `template` or
 * `config` inside `params` or extension `options` are user data and never appear here.
 */
export function declaredPaths(document: unknown): DeclaredPath[] {
  const found: DeclaredPath[] = [];
  const add = (item: DeclaredPath | undefined): void => { if (item) found.push(item); };
  if (!isJsonRecord(document)) return found;
  const agents = document.agents;
  if (isJsonRecord(agents)) {
    for (const [name, raw] of Object.entries(agents)) {
      if (!isJsonRecord(raw)) continue;
      const at: PointerSegment[] = ["agents", name];
      add(holder(raw, "config", "config", at));
      if (isJsonRecord(raw.input)) add(templateHolder(raw.input, [...at, "input"]));
      const system = raw.systemMessage;
      if (Array.isArray(system)) system.forEach((block, index) => add(templateHolder(block, [...at, "systemMessage", index])));
      else add(templateHolder(system, [...at, "systemMessage"]));
      if (isJsonRecord(raw.hooks)) {
        for (const [stage, hooks] of Object.entries(raw.hooks)) {
          if (!Array.isArray(hooks)) continue;
          hooks.forEach((hook, index) => add(templateHolder(hook, [...at, "hooks", stage, index])));
        }
      }
    }
  }
  const flow = document.flow;
  if (isJsonRecord(flow) && Array.isArray(flow.routes)) {
    flow.routes.forEach((route, index) => {
      if (!isJsonRecord(route) || !isJsonRecord(route.carry)) return;
      add(templateHolder(route.carry.message, ["flow", "routes", index, "carry", "message"]));
    });
  }
  return found;
}
