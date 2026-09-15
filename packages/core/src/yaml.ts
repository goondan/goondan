import { isAlias, isMap, isScalar, isSeq, parseAllDocuments, Parser, Scalar, type Document, type Node } from "yaml";
import { isRecord, pointer, setKey, type PointerSegment } from "./json.ts";
import { type Json } from "./types.ts";

export interface YamlFailure { code: "load.yaml" | "load.not_object"; path: string; message: string }
export type YamlResult = { ok: true; document: Record<string, Json> } | { ok: false; failure: YamlFailure };

const maxAliasExpansions = 100;

const coreTags = new Set([
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:map",
]);

const nullPattern = /^(?:|~|null|Null|NULL)$/u;
const boolPattern = /^(?:true|True|TRUE|false|False|FALSE)$/u;
const decimalPattern = /^[-+]?[0-9]+$/u;
const octalPattern = /^0o[0-7]+$/u;
const hexPattern = /^0x[0-9a-fA-F]+$/u;
const floatPattern = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/u;
const infinityPattern = /^([-+])?\.(?:inf|Inf|INF)$/u;
const nanPattern = /^\.(?:nan|NaN|NAN)$/u;

class YamlError extends Error {
  constructor(readonly failure: YamlFailure) { super(failure.message); this.name = "YamlError"; }
}

function fail(code: YamlFailure["code"], segments: readonly PointerSegment[], message: string): never {
  throw new YamlError({ code, path: pointer(segments), message });
}

const quotedTypes = new Set<string>([Scalar.QUOTE_SINGLE, Scalar.QUOTE_DOUBLE, Scalar.BLOCK_LITERAL, Scalar.BLOCK_FOLDED]);

function scalarText(node: Scalar<unknown>): string {
  if (typeof node.source === "string") return node.source;
  return typeof node.value === "string" ? node.value : String(node.value);
}

function taggedScalar(node: Scalar<unknown>, tag: string): Json {
  const text = scalarText(node);
  if (tag === "tag:yaml.org,2002:str") return typeof node.value === "string" ? node.value : text;
  if (tag === "tag:yaml.org,2002:null") {
    if (!nullPattern.test(text)) fail("load.yaml", [], "has a value that does not match its !!null tag");
    return null;
  }
  if (tag === "tag:yaml.org,2002:bool") {
    if (!boolPattern.test(text)) fail("load.yaml", [], "has a value that does not match its !!bool tag");
    return text.toLowerCase() === "true";
  }
  if (tag === "tag:yaml.org,2002:int") {
    if (decimalPattern.test(text)) return Number.parseInt(text, 10);
    if (octalPattern.test(text)) return Number.parseInt(text.slice(2), 8);
    if (hexPattern.test(text)) return Number.parseInt(text.slice(2), 16);
    fail("load.yaml", [], "has a value that does not match its !!int tag");
  }
  if (tag === "tag:yaml.org,2002:float") {
    if (floatPattern.test(text)) return Number.parseFloat(text);
    const infinite = infinityPattern.exec(text);
    if (infinite) return infinite[1] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    if (nanPattern.test(text)) return Number.NaN;
    fail("load.yaml", [], "has a value that does not match its !!float tag");
  }
  fail("load.yaml", [], `uses the unsupported tag ${tag}`);
}

function plainScalar(node: Scalar<unknown>): Json {
  const value: unknown = node.value;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  fail("load.yaml", [], "is not a JSON value");
}

function resolveAlias(node: Node, document: Document.Parsed): Node {
  if (!isAlias(node)) return node;
  const target: unknown = node.resolve(document);
  if (target === undefined || target === null) fail("load.yaml", [], `refers to the unknown anchor ${node.source}`);
  if (isAlias(target) || isScalar(target) || isMap(target) || isSeq(target)) return target;
  fail("load.yaml", [], `refers to the unknown anchor ${node.source}`);
}

/**
 * Counts the aliases a document expands: every alias written in the document costs 1 plus the
 * expansions of the value it points at. The count stops as soon as it passes the limit, so a
 * document that doubles its aliases cannot make the host expand them.
 */
function countAliases(node: unknown, document: Document.Parsed, stack: readonly unknown[], budget: { spent: number }): number {
  if (budget.spent > maxAliasExpansions) return budget.spent;
  if (isAlias(node)) {
    if (stack.includes(node)) fail("load.yaml", [], "expands more than 100 aliases");
    const target: unknown = node.resolve(document);
    if (target === undefined || target === null) fail("load.yaml", [], `refers to the unknown anchor ${node.source}`);
    budget.spent += 1;
    return countAliases(target, document, [...stack, node], budget);
  }
  if (isSeq(node)) {
    for (const item of node.items) countAliases(item, document, stack, budget);
    return budget.spent;
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      countAliases(pair.key, document, stack, budget);
      countAliases(pair.value, document, stack, budget);
    }
    return budget.spent;
  }
  return budget.spent;
}

/**
 * `segments` is the position of the node inside its document. A `load.yaml` failure reports it only
 * for the two cases the spec's 읽기 오류 table names — a duplicate key and a key that is not a
 * string — and reports the empty pointer for everything else.
 */
function convert(rawNode: unknown, document: Document.Parsed, segments: readonly PointerSegment[]): Json {
  if (rawNode === null || rawNode === undefined) return null;
  if (!isScalar(rawNode) && !isMap(rawNode) && !isSeq(rawNode) && !isAlias(rawNode)) {
    fail("load.yaml", [], "is not a supported YAML node");
  }
  const node = resolveAlias(rawNode, document);
  const tag = typeof node.tag === "string" ? node.tag : undefined;
  if (tag !== undefined && !coreTags.has(tag)) fail("load.yaml", [], `uses the unsupported tag ${tag}`);
  if (isScalar(node)) {
    if (tag === "tag:yaml.org,2002:seq" || tag === "tag:yaml.org,2002:map") fail("load.yaml", [], `has a value that does not match its ${tag} tag`);
    if (tag !== undefined) return taggedScalar(node, tag);
    if (typeof node.type === "string" && quotedTypes.has(node.type)) return typeof node.value === "string" ? node.value : String(node.value);
    return plainScalar(node);
  }
  if (isSeq(node)) {
    if (tag !== undefined && tag !== "tag:yaml.org,2002:seq") fail("load.yaml", [], `has a value that does not match its ${tag} tag`);
    return node.items.map((item, index) => convert(item, document, [...segments, index]));
  }
  if (!isMap(node)) fail("load.yaml", [], "is not a supported YAML node");
  if (tag !== undefined && tag !== "tag:yaml.org,2002:map") fail("load.yaml", [], `has a value that does not match its ${tag} tag`);
  const result: Record<string, Json> = {};
  for (const pair of node.items) {
    const rawKey: unknown = pair.key;
    if (rawKey === null || rawKey === undefined) fail("load.yaml", segments, "declares a key that is not a string");
    const key = isAlias(rawKey) || isScalar(rawKey) || isMap(rawKey) || isSeq(rawKey) ? resolveAlias(rawKey, document) : undefined;
    if (key === undefined || !isScalar(key) || typeof key.value !== "string") fail("load.yaml", segments, "declares a key that is not a string");
    const name = key.value;
    if (Object.hasOwn(result, name)) fail("load.yaml", [...segments, name], "is declared more than once");
    setKey(result, name, convert(pair.value, document, [...segments, name]));
  }
  return result;
}

/** Whether one token of the token tree is the non-specific tag `!`. */
function isNonSpecificTagToken(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => isNonSpecificTagToken(item));
  if (!isRecord(value)) return false;
  if (value.type === "tag" && value.source === "!") return true;
  return Object.values(value).some((item) => isNonSpecificTagToken(item));
}

/**
 * Whether the source writes the non-specific tag `!` on any node. The reader resolves `!` on a
 * sequence or a map to the tag of that kind, so the parsed node no longer tells the spelling apart
 * from an untagged node and the token tree is what answers for every kind.
 */
function usesNonSpecificTag(text: string): boolean {
  // Every tag token's source starts with `!`, so a source without one carries no tag at all.
  if (!text.includes("!")) return false;
  try {
    for (const token of new Parser().parse(text)) {
      if (isNonSpecificTagToken(token)) return true;
    }
  } catch { return false; }
  return false;
}

/**
 * Reads one configuration document with the YAML 1.2 core schema. Syntax errors are reported first;
 * otherwise the first rule the document breaks in document order is reported.
 */
export function parseConfigDocument(source: string): YamlResult {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  let documents: Document.Parsed[];
  try {
    documents = parseAllDocuments(text, {
      version: "1.2", schema: "core", merge: false, uniqueKeys: false,
      resolveKnownTags: false, keepSourceTokens: false, prettyErrors: false,
    });
  } catch {
    return { ok: false, failure: { code: "load.yaml", path: "", message: "is not valid YAML" } };
  }
  for (const document of documents) {
    if (document.errors.length > 0) return { ok: false, failure: { code: "load.yaml", path: "", message: "is not valid YAML" } };
  }
  const first = documents[0];
  if (documents.length === 0 || first === undefined) {
    return { ok: false, failure: { code: "load.not_object", path: "", message: "must contain one YAML object document" } };
  }
  const directives = first.directives;
  if (directives.yaml.explicit && directives.yaml.version !== "1.2") {
    return { ok: false, failure: { code: "load.yaml", path: "", message: "declares a %YAML directive other than 1.2" } };
  }
  for (const warning of first.warnings) {
    if (warning.code === "TAG_RESOLVE_FAILED") continue;
    return { ok: false, failure: { code: "load.yaml", path: "", message: "is not valid YAML" } };
  }
  try {
    if (countAliases(first.contents, first, [], { spent: 0 }) > maxAliasExpansions) {
      return { ok: false, failure: { code: "load.yaml", path: "", message: "expands more than 100 aliases" } };
    }
    if (documents.length > 1) {
      return { ok: false, failure: { code: "load.yaml", path: "", message: "must contain exactly one YAML document" } };
    }
    const value = convert(first.contents, first, []);
    // `!` is not one of the seven core tags, so it is as unsupported as any other tag.
    if (usesNonSpecificTag(text)) return { ok: false, failure: { code: "load.yaml", path: "", message: "uses the unsupported tag !" } };
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, failure: { code: "load.not_object", path: "", message: "must contain one YAML object document" } };
    }
    return { ok: true, document: value };
  } catch (error) {
    if (error instanceof YamlError) return { ok: false, failure: error.failure };
    throw error;
  }
}
