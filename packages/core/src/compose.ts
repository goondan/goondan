import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { GoondanConfigError } from "./errors.ts";
import { isRecord, ownKeys, pointer, setKey, type PointerSegment } from "./json.ts";
import { declaredPaths } from "./paths.ts";
import { validateDefinition } from "./schema.ts";
import { parseConfigDocument } from "./yaml.ts";
import { type ConfigIssue, type ConfigIssueCode, type Json } from "./types.ts";

export interface ComposeOptions { variants?: readonly string[] }

export interface ComposedConfig {
  /** The composed document, before defaults, inheritance and removals. */
  document: Record<string, Json>;
  /** The real directory of the entry file. */
  directory: string;
  /** The real path of the entry file. */
  entry: string;
  /** Every YAML file the entry and its variants composed, in read order. */
  files: readonly string[];
}

/** One YAML file: its real path for messages and its file system identity for comparisons. */
export interface YamlFile { path: string; id: string }

/** One resource graph: the entry file or one variant reads its own graph. */
interface ResourceGraph { composed: Set<string>; open: YamlFile[] }

/**
 * Two paths name the same file when the file system says so, even when they differ only in case or
 * go through different links.
 */
export function fileIdentity(realPath: string): string {
  try {
    const information = statSync(realPath);
    return `${String(information.dev)}:${String(information.ino)}`;
  } catch {
    return realPath;
  }
}

function raise(code: ConfigIssueCode, segments: readonly PointerSegment[], message: string): never {
  const issue: ConfigIssue = { code, path: pointer(segments), message };
  throw new GoondanConfigError([issue]);
}

function isYamlName(target: string): boolean {
  const lower = target.toLowerCase();
  return lower.endsWith(".yaml") || lower.endsWith(".yml");
}

function describeStat(target: string): { directory: boolean; file: boolean } | undefined {
  try {
    const information = statSync(target);
    return { directory: information.isDirectory(), file: information.isFile() };
  } catch {
    return undefined;
  }
}

/**
 * Resolves one declared reference to the real path of a YAML file. Directories mean their
 * `goondan.yaml`, and the checks run in the order the read phase defines.
 */
export function resolveYamlTarget(reference: string, fromDirectory: string, segments: readonly PointerSegment[]): YamlFile {
  const candidate = isAbsolute(reference) ? resolve(reference) : resolve(fromDirectory, reference);
  const first = describeStat(candidate);
  if (!first) raise("load.not_found", segments, `cannot read the configuration file ${candidate}`);
  const target = first.directory ? join(candidate, "goondan.yaml") : candidate;
  if (first.directory && !describeStat(target)) raise("load.not_found", segments, `cannot read the configuration file ${target}`);
  const information = describeStat(target);
  if (!information) raise("load.not_found", segments, `cannot read the configuration file ${target}`);
  if (!isYamlName(target) || !information.file) raise("load.not_yaml", segments, `${target} is not a YAML file`);
  try {
    const real = realpathSync(target);
    return { path: real, id: fileIdentity(real) };
  } catch {
    return raise("load.not_found", segments, `cannot read the configuration file ${target}`);
  }
}

function readDocument(realPath: string): Record<string, Json> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(realPath);
  } catch {
    raise("load.not_found", [], `cannot read the configuration file ${realPath}`);
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    raise("load.yaml", [], `${realPath} is not valid UTF-8 text`);
  }
  const parsed = parseConfigDocument(source);
  if (!parsed.ok) {
    const issue: ConfigIssue = { code: parsed.failure.code, path: parsed.failure.path, message: `${realPath} ${parsed.failure.message}` };
    throw new GoondanConfigError([issue]);
  }
  return parsed.document;
}

/** Merges `patch` over `base`: objects merge per key, every other value replaces. */
export function mergeValues(base: Json | undefined, patch: Json): Json {
  if (!isRecord(base) || !isRecord(patch)) return structuredClone(patch);
  const result: Record<string, Json> = {};
  for (const key of ownKeys(base)) {
    const next = Object.hasOwn(patch, key) ? patch[key] : undefined;
    setKey(result, key, next === undefined ? structuredClone(base[key] ?? null) : mergeValues(base[key], next));
  }
  for (const key of ownKeys(patch)) {
    if (Object.hasOwn(result, key)) continue;
    setKey(result, key, structuredClone(patch[key] ?? null));
  }
  return result;
}

function absolutizeDeclaredPaths(document: Record<string, Json>, directory: string): void {
  for (const declared of declaredPaths(document)) {
    declared.replace(isAbsolute(declared.value) ? resolve(declared.value) : resolve(directory, declared.value));
  }
}

function composeFile(file: YamlFile, graph: ResourceGraph, files: string[]): Record<string, Json> {
  const realPath = file.path;
  graph.composed.add(file.id);
  graph.open.push(file);
  files.push(realPath);
  try {
    const document = readDocument(realPath);
    const directory = dirname(realPath);
    const resourceList = Object.hasOwn(document, "resources") ? document.resources : undefined;
    const declarationIssues = resourceList === undefined ? [] : validateDefinition("resources", resourceList, ["resources"]);
    const firstIssue = declarationIssues[0];
    if (firstIssue) throw new GoondanConfigError([{ ...firstIssue, message: `${realPath}: ${firstIssue.message}` }]);
    let result: Json = {};
    if (Array.isArray(resourceList)) {
      resourceList.forEach((reference, index) => {
        if (typeof reference !== "string") raise("load.not_found", ["resources", index], `${realPath} declares an unreadable resource`);
        const target = resolveTargetOrCycle(reference, directory, ["resources", index], graph);
        result = mergeValues(result, composeFile(target, graph, files));
      });
    }
    const own: Record<string, Json> = {};
    for (const key of ownKeys(document)) {
      if (key === "resources") continue;
      setKey(own, key, document[key] ?? null);
    }
    absolutizeDeclaredPaths(own, directory);
    return toRecord(mergeValues(result, own));
  } finally {
    graph.open.pop();
  }
}

function resolveTargetOrCycle(reference: string, directory: string, segments: readonly PointerSegment[], graph: ResourceGraph): YamlFile {
  const target = resolveYamlTarget(reference, directory, segments);
  if (graph.open.some((open) => open.id === target.id)) {
    raise("load.resource_cycle", segments, `configuration resources form a cycle: ${[...graph.open.map((open) => open.path), target.path].join(" -> ")}`);
  }
  if (graph.composed.has(target.id)) raise("load.duplicate_resource", segments, `${target.path} is already part of this resource graph`);
  return target;
}

function toRecord(value: Json): Record<string, Json> {
  if (!isRecord(value)) return {};
  return value;
}

/** Resolves the entry path a host passed to `loadConfig`. */
export function resolveEntryFile(input: string): YamlFile {
  const candidate = resolve(input);
  const information = describeStat(candidate);
  if (!information) raise("load.not_found", [], `cannot read the configuration file ${candidate}`);
  const target = information.directory ? join(candidate, "goondan.yaml") : candidate;
  if (information.directory && !describeStat(target)) raise("load.not_found", [], `cannot read the configuration file ${target}`);
  const targetInformation = describeStat(target);
  if (!targetInformation) raise("load.not_found", [], `cannot read the configuration file ${target}`);
  if (!isYamlName(target) || !targetInformation.file) raise("load.not_yaml", [], `${target} is not a YAML file`);
  try {
    const real = realpathSync(target);
    return { path: real, id: fileIdentity(real) };
  } catch {
    return raise("load.not_found", [], `cannot read the configuration file ${target}`);
  }
}

/**
 * Reads the entry file and the requested variants and merges them into the composed document.
 * The read phase stops at the first error.
 */
export function composeConfig(input: string, options: ComposeOptions = {}): ComposedConfig {
  const variants = options.variants ?? [];
  for (const variant of variants) {
    if (variant.length === 0 || variant.includes("/") || variant.includes("\\")) {
      raise("load.not_found", [], `${JSON.stringify(variant)} is not a variant name`);
    }
  }
  const entry = resolveEntryFile(input);
  const directory = dirname(entry.path);
  const files: string[] = [];
  let document = composeFile(entry, { composed: new Set(), open: [] }, files);
  for (const variant of variants) {
    const target = resolveEntryFile(join(directory, "variants", `${variant}.yaml`));
    document = toRecord(mergeValues(document, composeFile(target, { composed: new Set(), open: [] }, files)));
  }
  return { document, directory, entry: entry.path, files };
}
