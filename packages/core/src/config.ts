import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { composeConfig, fileIdentity, resolveYamlTarget, type ComposeOptions, type YamlFile } from "./compose.ts";
import { buildEffective, composedDocument, schemaIssues } from "./effective.ts";
import { GoondanConfigError, raiseIssues } from "./errors.ts";
import { isRecord, pointer, toJsonRecord, type PointerSegment } from "./json.ts";
import { declaredPaths } from "./paths.ts";
import { loadTemplates, mapTemplateSource, templateIssues } from "./template-load.ts";
import { type ConfigIssue, type GoondanConfig, type LoadedConfig } from "./types.ts";

function prefixIssues(issues: readonly ConfigIssue[], prefix: string): ConfigIssue[] {
  if (prefix === "") return [...issues];
  return issues.map((issue) => ({ ...issue, path: `${prefix}${issue.path}` }));
}

function withPrefix<T>(prefix: string, action: () => T): T {
  if (prefix === "") return action();
  try {
    return action();
  } catch (error) {
    if (error instanceof GoondanConfigError) throw new GoondanConfigError(prefixIssues(error.issues, prefix), { cause: error });
    throw error;
  }
}

function absolutize(document: Record<string, unknown>, directory: string): void {
  for (const declared of declaredPaths(document)) {
    if (isAbsolute(declared.value)) continue;
    declared.replace(resolve(directory, declared.value));
  }
}

interface PrepareOptions {
  /** The configuration directory, when one is known. */
  directory?: string;
  /** The entry files of this configuration and of every configuration containing it. */
  ancestors?: readonly YamlFile[];
  /** Templates that were already read; the reference phase checks these instead of the disk. */
  templates?: ReadonlyMap<string, string>;
  /** Whether the reference phase may read template and nested configuration files. */
  readFiles: boolean;
}

/** Runs the schema and reference phases, and reads nested configurations when files may be read. */
function prepare(raw: unknown, options: PrepareOptions): LoadedConfig {
  const unchecked = composedDocument(raw);
  if (options.readFiles && options.directory !== undefined) absolutize(unchecked, options.directory);
  raiseIssues(schemaIssues(unchecked));
  const effective = buildEffective(toJsonRecord(unchecked), options.directory);
  const issues = [...effective.issues];
  let templates: ReadonlyMap<string, string> = options.templates ?? new Map<string, string>();
  if (options.readFiles) {
    const result = loadTemplates(effective.document, options.directory);
    templates = result.templates;
    issues.push(...result.issues);
  } else if (options.templates) {
    issues.push(...templateIssues(effective.document, options.directory, mapTemplateSource(options.templates)));
  }
  raiseIssues(issues);
  const loaded: LoadedConfig = { directory: options.directory ?? process.cwd(), config: effective.config, templates };
  if (!options.readFiles) return loaded;
  const nested = readNested(effective.config, loaded.directory, options.ancestors ?? []);
  if (nested.size > 0) loaded.nested = nested;
  return loaded;
}

function readNested(config: GoondanConfig, directory: string, ancestors: readonly YamlFile[]): Map<string, LoadedConfig> {
  const nested = new Map<string, LoadedConfig>();
  for (const [name, spec] of Object.entries(config.agents)) {
    const reference = spec?.config;
    if (typeof reference !== "string") continue;
    const at: PointerSegment[] = ["agents", name, "config"];
    const prefix = pointer(at);
    const target = resolveYamlTarget(reference, directory, at);
    if (ancestors.some((ancestor) => ancestor.id === target.id)) {
      const cycle = [...ancestors.map((ancestor) => ancestor.path), target.path].join(" -> ");
      throw new GoondanConfigError([{ code: "load.resource_cycle", path: prefix, message: `configuration resources form a cycle: ${cycle}` }]);
    }
    nested.set(name, withPrefix(prefix, () => loadEntry(target.path, {}, [...ancestors, target])));
  }
  return nested;
}

function loadEntry(input: string, composeOptions: ComposeOptions, ancestors: readonly YamlFile[]): LoadedConfig {
  const composed = composeConfig(input, composeOptions);
  const entry: YamlFile = { path: composed.entry, id: fileIdentity(composed.entry) };
  return prepare(composed.document, {
    directory: composed.directory,
    ancestors: ancestors.length > 0 ? ancestors : [entry],
    readFiles: true,
  });
}

/** Reads a configuration from disk and applies the read, schema and reference phases. */
export function loadConfigSync(input: string, composeOptions: ComposeOptions = {}): LoadedConfig {
  return loadEntry(resolve(input), composeOptions, []);
}

export async function loadConfig(input: string, composeOptions: ComposeOptions = {}): Promise<LoadedConfig> {
  return loadConfigSync(input, composeOptions);
}

/** Applies the schema and reference phases to a configuration document, reading no files. */
export function validateConfig(raw: unknown): GoondanConfig {
  return prepare(raw, { readFiles: false }).config;
}

function isLoadedConfig(value: unknown): value is LoadedConfig {
  return isRecord(value) && typeof value.directory === "string" && isRecord(value.config) && value.templates instanceof Map;
}

/**
 * The configuration a runtime starts from. A `loadConfig` result keeps its templates and nested
 * configurations; a plain document has them read relative to the configuration directory.
 */
export function prepareRuntimeConfig(input: unknown, directory?: string): LoadedConfig {
  if (isLoadedConfig(input)) {
    const checked = prepare(input.config, { directory: input.directory, templates: input.templates, readFiles: false });
    const loaded: LoadedConfig = { directory: input.directory, config: checked.config, templates: input.templates };
    if (input.nested) loaded.nested = input.nested;
    return loaded;
  }
  let root: string;
  try {
    root = realpathSync(directory ?? process.cwd());
  } catch {
    root = resolve(directory ?? process.cwd());
  }
  return prepare(input, { directory: root, readFiles: true });
}
