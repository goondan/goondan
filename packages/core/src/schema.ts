import schemaDocument from "./goondan.schema.json" with { type: "json" };
import { isJsonObject, isRecord, jsonEqual, jsonType, ownKeys, pointer, sortIssues, toJson, type PointerSegment } from "./json.ts";
import { type ConfigIssue, type ConfigIssueCode, type Json } from "./types.ts";

/**
 * The closed keyword set `spec/goondan.schema.json` may use. A schema edit that adds any other
 * keyword fails `test/schema.test.ts` instead of silently going unenforced.
 */
export const supportedSchemaKeywords: ReadonlySet<string> = new Set([
  "$schema", "$id", "$comment", "title", "description", "default", "$defs", "$ref",
  "type", "const", "enum", "properties", "required", "additionalProperties", "propertyNames",
  "minProperties", "items", "minItems", "uniqueItems", "minLength", "pattern", "exclusiveMinimum",
  "oneOf", "anyOf", "allOf", "not", "dependentSchemas",
]);

const schemaMapKeywords = new Set(["$defs", "properties", "dependentSchemas"]);
const schemaKeywords = new Set(["additionalProperties", "propertyNames", "items", "not"]);
const schemaListKeywords = new Set(["oneOf", "anyOf", "allOf"]);
const shapeCodes = new Set(["schema.type", "schema.const", "schema.enum"]);

type Schema = boolean | Record<string, Json>;

interface RawIssue { code: ConfigIssueCode; segments: PointerSegment[]; message: string }

function isSchema(value: unknown): value is Schema {
  return typeof value === "boolean" || isRecord(value);
}

function asSchema(value: unknown): Schema {
  if (!isSchema(value)) throw new Error("Schema nodes must be objects or booleans");
  return value;
}

function keyword(schema: Schema, name: string): Json | undefined {
  if (typeof schema === "boolean") return undefined;
  return schema[name];
}

function stringList(value: Json | undefined): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) return value;
  return undefined;
}

function jsonArray(value: Json | undefined): Json[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

const format = (value: Json | undefined): string => JSON.stringify(value ?? null) ?? "null";

function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported $ref ${ref}`);
  let node: Json | undefined = typeof root === "boolean" ? undefined : root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(node)) throw new Error(`Unresolvable $ref ${ref}`);
    node = node[key];
  }
  if (node === undefined) throw new Error(`Unresolvable $ref ${ref}`);
  return asSchema(node);
}

/** The keys a combinator requires when every branch only asks for one property to be present. */
function requiredOnly(branches: readonly Json[]): string[] | undefined {
  const keys: string[] = [];
  for (const branch of branches) {
    if (!isRecord(branch)) return undefined;
    if (ownKeys(branch).length !== 1) return undefined;
    const required = jsonArray(branch.required);
    if (!required || required.length !== 1) return undefined;
    const name = required[0];
    if (typeof name !== "string") return undefined;
    keys.push(name);
  }
  return keys;
}

function describe(root: Schema, branch: Json): string {
  let node: Json = branch;
  while (isRecord(node) && typeof node.$ref === "string" && ownKeys(node).length === 1) {
    const resolved = resolveRef(root, node.$ref);
    if (typeof resolved === "boolean") return "an allowed form";
    node = resolved;
  }
  if (!isRecord(node)) return "an allowed form";
  if (Object.hasOwn(node, "const")) return format(node.const);
  const enumeration = jsonArray(node.enum);
  if (enumeration) return enumeration.map(format).join(" or ");
  const required = jsonArray(node.required);
  if (node.type === "object" && required && required.length > 0) return `{${required.map(String).join(", ")}}`;
  const types = stringList(node.type);
  if (types) return types.join(" or ");
  return "an allowed form";
}

const unique = (items: readonly string[]): string[] => items.filter((item, index) => items.indexOf(item) === index);

function combine(root: Schema, kind: "oneOf" | "anyOf", branches: readonly Json[], results: readonly RawIssue[][], at: PointerSegment[]): RawIssue[] {
  const keys = requiredOnly(branches);
  if (keys) return [{ code: `schema.${kind}`, segments: at, message: `must declare ${kind === "anyOf" ? "at least" : "exactly"} one of ${keys.join(", ")}` }];
  const here = pointer(at);
  const compatible: number[] = [];
  results.forEach((issues, index) => {
    if (!issues.some((issue) => shapeCodes.has(issue.code) && pointer(issue.segments) === here)) compatible.push(index);
  });
  const only = compatible[0];
  if (compatible.length === 1 && only !== undefined) {
    const chosen = results[only];
    if (chosen) return chosen;
  }
  if (compatible.length > 1) {
    const fewest = Math.min(...compatible.map((index) => results[index]?.length ?? Number.POSITIVE_INFINITY));
    const closest = compatible.filter((index) => results[index]?.length === fewest);
    const closestIndex = closest[0];
    if (closest.length === 1 && closestIndex !== undefined) {
      const chosen = results[closestIndex];
      if (chosen) return chosen;
    }
  }
  return [{ code: `schema.${kind}`, segments: at, message: `must be ${unique(branches.map((branch) => describe(root, branch))).join(" or ")}` }];
}

function check(root: Schema, schema: Schema, value: unknown, at: PointerSegment[]): RawIssue[] {
  if (schema === true) return [];
  if (schema === false) return [{ code: "schema.false", segments: at, message: "is not allowed" }];
  const out: RawIssue[] = [];
  const ref = keyword(schema, "$ref");
  if (typeof ref === "string") out.push(...check(root, resolveRef(root, ref), value, at));
  const type = jsonType(value);
  const expectedTypes = stringList(keyword(schema, "type"));
  if (expectedTypes) {
    const matched = expectedTypes.some((expected) =>
      expected === type || (expected === "integer" && type === "number" && typeof value === "number" && Number.isInteger(value)));
    if (!matched) {
      out.push({ code: "schema.type", segments: at, message: `must be ${expectedTypes.join(" or ")}` });
      return out;
    }
  }
  if (typeof schema !== "boolean" && Object.hasOwn(schema, "const") && !jsonEqual(value, schema.const)) {
    out.push({ code: "schema.const", segments: at, message: `must be ${format(schema.const)}` });
  }
  const enumeration = jsonArray(keyword(schema, "enum"));
  if (enumeration && !enumeration.some((candidate) => jsonEqual(value, candidate))) {
    out.push({ code: "schema.enum", segments: at, message: `must be one of ${enumeration.map(format).join(", ")}` });
  }
  const minLength = keyword(schema, "minLength");
  if (type === "string" && typeof value === "string" && typeof minLength === "number" && [...value].length < minLength) {
    out.push({ code: "schema.minLength", segments: at, message: minLength === 1 ? "must not be empty" : `must contain at least ${String(minLength)} characters` });
  }
  const pattern = keyword(schema, "pattern");
  if (type === "string" && typeof value === "string" && typeof pattern === "string" && !new RegExp(pattern, "u").test(value)) {
    out.push({ code: "schema.pattern", segments: at, message: `must match ${pattern}` });
  }
  const exclusiveMinimum = keyword(schema, "exclusiveMinimum");
  if (type === "number" && typeof value === "number" && typeof exclusiveMinimum === "number" && !(value > exclusiveMinimum)) {
    out.push({ code: "schema.exclusiveMinimum", segments: at, message: `must be greater than ${format(exclusiveMinimum)}` });
  }
  if (type === "array" && Array.isArray(value)) {
    const minItems = keyword(schema, "minItems");
    if (typeof minItems === "number" && value.length < minItems) {
      out.push({ code: "schema.minItems", segments: at, message: minItems === 1 ? "must not be empty" : `must contain at least ${String(minItems)} items` });
    }
    if (keyword(schema, "uniqueItems") === true) {
      value.forEach((item, index) => {
        if (value.slice(0, index).some((earlier) => jsonEqual(earlier, item))) {
          out.push({ code: "schema.uniqueItems", segments: [...at, index], message: "duplicates an earlier item" });
        }
      });
    }
    const items = keyword(schema, "items");
    if (items !== undefined) {
      const itemSchema = asSchema(items);
      value.forEach((item, index) => out.push(...check(root, itemSchema, item, [...at, index])));
    }
  }
  if (type === "object" && isRecord(value)) {
    const keys = ownKeys(value);
    const minProperties = keyword(schema, "minProperties");
    if (typeof minProperties === "number" && keys.length < minProperties) {
      out.push({ code: "schema.minProperties", segments: at, message: minProperties === 1 ? "must not be empty" : `must contain at least ${String(minProperties)} entries` });
    }
    for (const name of stringList(keyword(schema, "required")) ?? []) {
      if (!keys.includes(name)) out.push({ code: "schema.required", segments: [...at, name], message: "is required" });
    }
    const propertyNames = keyword(schema, "propertyNames");
    const properties = keyword(schema, "properties");
    const additional = keyword(schema, "additionalProperties");
    for (const key of keys) {
      if (propertyNames !== undefined) {
        const broken = check(root, asSchema(propertyNames), key, [...at, key]);
        if (broken.length > 0) {
          out.push(...broken.map((broken): RawIssue => ({ code: "schema.propertyNames", segments: [...at, key], message: broken.message })));
          continue;
        }
      }
      if (isRecord(properties) && Object.hasOwn(properties, key)) {
        out.push(...check(root, asSchema(properties[key]), value[key], [...at, key]));
      } else if (additional === false) {
        out.push({ code: "schema.additionalProperties", segments: [...at, key], message: "is not a supported field" });
      } else if (additional !== undefined) {
        out.push(...check(root, asSchema(additional), value[key], [...at, key]));
      }
    }
    const dependent = keyword(schema, "dependentSchemas");
    if (isRecord(dependent)) {
      for (const name of ownKeys(dependent)) {
        if (keys.includes(name)) out.push(...check(root, asSchema(dependent[name]), value, at));
      }
    }
  }
  for (const branch of jsonArray(keyword(schema, "allOf")) ?? []) out.push(...check(root, asSchema(branch), value, at));
  const anyOf = jsonArray(keyword(schema, "anyOf"));
  if (anyOf) {
    const results = anyOf.map((branch) => check(root, asSchema(branch), value, at));
    if (!results.some((issues) => issues.length === 0)) out.push(...combine(root, "anyOf", anyOf, results, at));
  }
  const oneOf = jsonArray(keyword(schema, "oneOf"));
  if (oneOf) {
    const results = oneOf.map((branch) => check(root, asSchema(branch), value, at));
    const passing = results.filter((issues) => issues.length === 0).length;
    if (passing === 0) out.push(...combine(root, "oneOf", oneOf, results, at));
    else if (passing > 1) {
      const keys = requiredOnly(oneOf);
      out.push({ code: "schema.oneOf", segments: at, message: keys ? `must declare exactly one of ${keys.join(", ")}` : "matches more than one allowed form" });
    }
  }
  const not = keyword(schema, "not");
  if (not !== undefined && check(root, asSchema(not), value, at).length === 0) {
    const negated = isRecord(not) && Object.hasOwn(not, "const") ? `must not be ${format(not.const)}` : "uses a form that is not allowed";
    out.push({ code: "schema.not", segments: at, message: negated });
  }
  return out;
}

function toIssues(raw: readonly RawIssue[]): ConfigIssue[] {
  return raw.map((issue) => ({ code: issue.code, path: pointer(issue.segments), message: issue.message }));
}

function loadSchema(value: unknown): Record<string, Json> {
  const json = toJson(value);
  if (!isJsonObject(json)) throw new Error("goondan.schema.json must be a JSON object");
  return json;
}

/** The packaged copy of `spec/goondan.schema.json`. */
export const configSchema: Record<string, Json> = loadSchema(schemaDocument);

/** Validates a value against the whole configuration schema. */
export function validateSchema(value: unknown, at: readonly PointerSegment[] = []): ConfigIssue[] {
  return sortIssues(toIssues(check(configSchema, configSchema, value, [...at])));
}

/** Validates a value against one `$defs` entry, reporting at `at`. */
export function validateDefinition(name: string, value: unknown, at: readonly PointerSegment[]): ConfigIssue[] {
  return toIssues(check(configSchema, resolveRef(configSchema, `#/$defs/${name}`), value, [...at]));
}

/** Validates a value against one root property subschema, reporting at `at`. */
export function validateRootProperty(name: string, value: unknown, at: readonly PointerSegment[]): ConfigIssue[] {
  const properties = configSchema.properties;
  if (!isRecord(properties)) throw new Error("The configuration schema has no properties");
  return toIssues(check(configSchema, asSchema(properties[name]), value, [...at]));
}

/** 호스트 도구가 선언한 JSON Schema로 호출 인수를 검사합니다. */
export function validateJsonValue(schema: Record<string, Json>, value: unknown): ConfigIssue[] {
  return toIssues(check(schema, schema, value, []));
}

/** Lists every schema location that uses a keyword outside the supported set. */
export function unsupportedSchemaKeywords(schema: unknown, at = "#"): string[] {
  if (typeof schema === "boolean") return [];
  if (!isRecord(schema)) return [`${at} is not a schema`];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (!supportedSchemaKeywords.has(key)) problems.push(`${at}/${key}`);
    else if (schemaMapKeywords.has(key) && isRecord(value)) {
      for (const [name, child] of Object.entries(value)) problems.push(...unsupportedSchemaKeywords(child, `${at}/${key}/${name}`));
    } else if (schemaKeywords.has(key)) problems.push(...unsupportedSchemaKeywords(value, `${at}/${key}`));
    else if (schemaListKeywords.has(key) && Array.isArray(value)) {
      value.forEach((child, index) => problems.push(...unsupportedSchemaKeywords(child, `${at}/${key}/${String(index)}`)));
    } else if (key === "$ref" && (typeof value !== "string" || !value.startsWith("#/"))) problems.push(`${at}/$ref is not local`);
  }
  return problems;
}
