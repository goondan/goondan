import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { templateIdentifier } from "./effective.ts";
import { pointer } from "./json.ts";
import { declaredPaths } from "./paths.ts";
import { checkTemplate, normalizeTemplateSource, type TemplateAst } from "./template-syntax.ts";
import { type ConfigIssue, type ConfigIssueCode, type Json } from "./types.ts";

/** One template file the reference phase read, with the real path cycles are detected on. */
export interface TemplateFile { source: string; real: string }

export type IncludeResult =
  | { ok: true; key: string; file: TemplateFile }
  | { ok: false; reason: "not_found"; target: string }
  | { ok: false; reason: "outside"; directory: string };

/**
 * Where the reference phase reads templates from. `loadConfig` and a plain configuration document
 * read the disk; a `loadConfig` result is re-checked against the map it already carries.
 */
export interface TemplateSource {
  readDeclared(key: string): TemplateFile | undefined;
  readInclude(fromKey: string, segments: readonly string[]): IncludeResult;
}

/** `include` is a `/`-separated relative path; `.` and empty segments are ignored. */
export function includeSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "" && segment !== ".");
}

/** The first `<사유>` an `include` path violates, or `undefined` when its form is allowed. */
export function includeFormatReason(path: string): string | undefined {
  if (path === "") return "path is empty";
  if (path.includes("\\")) return "backslashes are not allowed";
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path)) return "absolute paths are not allowed";
  if (path.split("/").includes("..")) return "\"..\" segments are not allowed";
  return undefined;
}

/** Resolves an `include` target against the directory of the file that contains it. */
export function resolveIncludeKey(fromKey: string, segments: readonly string[]): string {
  const directory = dirname(fromKey);
  return segments.length === 0 ? directory : join(directory, ...segments);
}

function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function readUtf8(path: string): string | undefined {
  try {
    if (!statSync(path).isFile()) return undefined;
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch {
    return undefined;
  }
}

function contains(directory: string, target: string): boolean {
  const inside = relative(directory, target);
  return inside !== "" && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/** Reads declared templates and their include closure from disk, recording every file it reads. */
export function diskTemplateSource(record: Map<string, string>): TemplateSource {
  const load = (key: string): TemplateFile | undefined => {
    const text = readUtf8(key);
    if (text === undefined) return undefined;
    const source = normalizeTemplateSource(text);
    record.set(key, source);
    return { source, real: realPathOf(key) };
  };
  return {
    readDeclared: load,
    readInclude(fromKey, segments) {
      const directory = dirname(fromKey);
      const target = resolveIncludeKey(fromKey, segments);
      let exists = false;
      try {
        exists = statSync(target).isFile();
      } catch {
        exists = false;
      }
      if (!exists) return { ok: false, reason: "not_found", target };
      if (!contains(realPathOf(directory), realPathOf(target))) return { ok: false, reason: "outside", directory };
      const file = load(target);
      if (!file) return { ok: false, reason: "not_found", target };
      return { ok: true, key: target, file };
    },
  };
}

/** Re-checks a configuration against templates that were already read, without touching the disk. */
export function mapTemplateSource(templates: ReadonlyMap<string, string>): TemplateSource {
  const load = (key: string): TemplateFile | undefined => {
    const source = templates.get(key);
    return source === undefined ? undefined : { source: normalizeTemplateSource(source), real: key };
  };
  return {
    readDeclared: load,
    readInclude(fromKey, segments) {
      const target = resolveIncludeKey(fromKey, segments);
      const file = load(target);
      return file ? { ok: true, key: target, file } : { ok: false, reason: "not_found", target };
    },
  };
}

interface Failure { code: ConfigIssueCode; message: string }
interface Frame { key: string; real: string }

function isFailure(value: TemplateAst | Failure): value is Failure {
  return "code" in value;
}

class Checker {
  readonly #source: TemplateSource;
  readonly #directory: string | undefined;
  readonly #parsed = new Map<string, TemplateAst | Failure>();

  constructor(source: TemplateSource, directory: string | undefined) {
    this.#source = source;
    this.#directory = directory;
  }

  /** `<파일>`: the path relative to the configuration directory, with `/` separators. */
  #name(path: string): string {
    return templateIdentifier(path, this.#directory);
  }

  /** `<디렉터리>`: the same form, written `.` when it is the configuration directory itself. */
  #directoryName(path: string): string {
    const name = this.#name(path);
    return name === "" ? "." : name;
  }

  declared(key: string): Failure | undefined {
    const file = this.#source.readDeclared(key);
    if (!file) return { code: "template.not_found", message: `cannot read ${this.#name(key)}` };
    return this.#file(key, file, [{ key, real: file.real }], new Set([key]));
  }

  #ast(key: string, file: TemplateFile): TemplateAst | Failure {
    const cached = this.#parsed.get(key);
    if (cached) return cached;
    const check = checkTemplate(file.source);
    const result: TemplateAst | Failure = check.ok
      ? check.ast
      : check.kind === "syntax"
        ? { code: "template.syntax", message: `${this.#name(key)} has invalid syntax` }
        : { code: "template.unsupported", message: `${this.#name(key)} uses unsupported syntax: ${check.items.join(", ")}` };
    this.#parsed.set(key, result);
    return result;
  }

  #file(key: string, file: TemplateFile, stack: readonly Frame[], clean: Set<string>): Failure | undefined {
    const parsed = this.#ast(key, file);
    if (isFailure(parsed)) return parsed;
    for (const path of parsed.includes) {
      const failure = this.#include(key, path, stack, clean);
      if (failure) return failure;
    }
    return undefined;
  }

  #include(key: string, path: string, stack: readonly Frame[], clean: Set<string>): Failure | undefined {
    const prefix = `${this.#name(key)} includes "${path}": `;
    const reason = includeFormatReason(path);
    if (reason !== undefined) return { code: "template.unsupported", message: prefix + reason };
    const target = this.#source.readInclude(key, includeSegments(path));
    if (!target.ok) {
      return target.reason === "not_found"
        ? { code: "template.not_found", message: `${prefix}cannot read ${this.#name(target.target)}` }
        : { code: "template.unsupported", message: `${prefix}resolves outside ${this.#directoryName(target.directory)}` };
    }
    const cycle = stack.findIndex((frame) => frame.real === target.file.real);
    if (cycle >= 0) {
      const names = stack.slice(cycle).map((frame) => this.#name(frame.key));
      return { code: "template.unsupported", message: `include cycle: ${[...names, names[0] ?? ""].join(" -> ")}` };
    }
    if (clean.has(target.key)) return undefined;
    const failure = this.#file(target.key, target.file, [...stack, { key: target.key, real: target.file.real }], clean);
    if (failure) return failure;
    clean.add(target.key);
    return undefined;
  }
}

/**
 * Checks every template the effective configuration declares and the files those templates include,
 * reporting the first error of each declaration site.
 */
export function templateIssues(document: Record<string, Json>, directory: string | undefined, source: TemplateSource): ConfigIssue[] {
  const checker = new Checker(source, directory);
  const issues: ConfigIssue[] = [];
  for (const declared of declaredPaths(document)) {
    if (declared.kind !== "template") continue;
    const failure = checker.declared(declared.value);
    if (failure) issues.push({ code: failure.code, path: pointer(declared.segments), message: failure.message });
  }
  return issues;
}

/** Reads the templates a configuration declares, together with the files they include. */
export function loadTemplates(document: Record<string, Json>, directory: string | undefined): { templates: Map<string, string>; issues: ConfigIssue[] } {
  const templates = new Map<string, string>();
  const issues = templateIssues(document, directory, diskTemplateSource(templates));
  return { templates, issues };
}

/** The key `ctx.render` means: a loaded template path, or one relative to the configuration directory. */
export function renderKey(templates: ReadonlyMap<string, string>, directory: string, name: string): string | undefined {
  if (templates.has(name)) return name;
  const candidate = resolve(directory, name);
  return templates.has(candidate) ? candidate : undefined;
}
