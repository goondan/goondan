import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { composeConfig } from "./compose.ts";
import { buildEffective, composedDocument, schemaIssues } from "./effective.ts";
import { raiseIssues } from "./errors.ts";
import { isRecord, toJsonRecord } from "./json.ts";
import { declaredPaths } from "./paths.ts";
import { loadTemplates, mapTemplateSource, templateIssues } from "./template-load.ts";
import { type GoondanConfig, type LoadedConfig } from "./types.ts";

function absolutize(document: Record<string, unknown>, directory: string): void {
  for (const declared of declaredPaths(document)) {
    if (isAbsolute(declared.value)) continue;
    declared.replace(resolve(directory, declared.value));
  }
}

interface PrepareOptions {
  /** The configuration directory, when one is known. */
  directory?: string;
  /** Templates that were already read; the reference phase checks these instead of the disk. */
  templates?: ReadonlyMap<string, string>;
  /** 참조 단계에서 템플릿 파일을 읽을 수 있는지 나타냅니다. */
  readFiles: boolean;
}

/** 스키마 단계와 참조 단계를 실행하고, 파일 읽기가 허용되면 템플릿을 읽습니다. */
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
  return { directory: options.directory ?? process.cwd(), config: effective.config, templates };
}

function loadEntry(input: string): LoadedConfig {
  const composed = composeConfig(input);
  return prepare(composed.document, {
    directory: composed.directory,
    readFiles: true,
  });
}

/** Reads a configuration from disk and applies the read, schema and reference phases. */
export function loadConfigSync(input: string): LoadedConfig {
  return loadEntry(resolve(input));
}

export async function loadConfig(input: string): Promise<LoadedConfig> {
  return loadConfigSync(input);
}

/** Applies the schema and reference phases to a configuration document, reading no files. */
export function validateConfig(raw: unknown): GoondanConfig {
  return prepare(raw, { readFiles: false }).config;
}

function isLoadedConfig(value: unknown): value is LoadedConfig {
  return isRecord(value) && typeof value.directory === "string" && isRecord(value.config) && value.templates instanceof Map;
}

/**
 * 군단 객체가 시작할 구성입니다. `loadConfig` 결과는 읽은 템플릿을 보존하고, 일반 문서는 구성
 * 디렉터리를 기준으로 템플릿을 읽습니다.
 */
export function prepareRuntimeConfig(input: unknown, directory?: string): LoadedConfig {
  if (isLoadedConfig(input)) {
    const checked = prepare(input.config, { directory: input.directory, templates: input.templates, readFiles: false });
    return { directory: input.directory, config: checked.config, templates: input.templates };
  }
  let root: string;
  try {
    root = realpathSync(directory ?? process.cwd());
  } catch {
    root = resolve(directory ?? process.cwd());
  }
  return prepare(input, { directory: root, readFiles: true });
}
