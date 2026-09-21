/**
 * Strict readers for `case.json` and `expected.json`.
 *
 * Every key this module accepts is listed in fixtures/conformance/README.md.
 * Unknown keys, wrong value shapes, operations in positions that do not allow
 * them and error codes outside the closed set all fail the case.
 */

import {
  type Json,
  type JsonObject,
  isJsonArray,
  isJsonObject,
  isNumber,
  isString,
  isStringArray,
} from "./conformance-json.ts";

export class CaseFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseFormatError";
  }
}

export const OBSERVATION_SECTIONS = [
  "effectiveConfig",
  "events",
  "journalEvents",
  "journalStates",
  "modelInputs",
  "modelContexts",
  "toolCalls",
  "toolContexts",
  "functionCalls",
  "functionContexts",
  "hookCalls",
  "hookContexts",
  "extensionLog",
  "conversations",
  "operations",
  "operationHistory",
] as const;
export type ObservationSection = (typeof OBSERVATION_SECTIONS)[number];

export const VALUE_STAGES = [
  "onInput",
  "onPrompt",
  "onStep",
  "onModelInput",
  "onModelResult",
  "onToolCall",
  "onToolResult",
  "onOutput",
  "onError",
] as const;
export type ValueStage = (typeof VALUE_STAGES)[number];

const SCHEMA_KEYWORDS = [
  "type",
  "const",
  "enum",
  "required",
  "additionalProperties",
  "propertyNames",
  "minProperties",
  "minItems",
  "uniqueItems",
  "minLength",
  "pattern",
  "exclusiveMinimum",
  "oneOf",
  "anyOf",
  "not",
  "false",
] as const;

/** The spec's closed set of configuration error codes. */
export const CONFIG_ERROR_CODES: readonly string[] = [
  "load.not_found",
  "load.not_yaml",
  "load.yaml",
  "load.not_object",
  "load.duplicate_resource",
  "load.resource_cycle",
  ...SCHEMA_KEYWORDS.map((keyword) => `schema.${keyword}`),
  "config.not_json",
  "reference.agent",
  "reference.inherit",
  "reference.inherit_cycle",
  "reference.extension",
  "reference.duplicate_tool",
  "routes.reserved",
  "routes.no_input",
  "routes.unreachable",
  "routes.cycle",
  "routes.wait_cycle",
  "template.not_found",
  "template.syntax",
  "template.unsupported",
  "binding.model",
  "binding.tool",
  "binding.duplicate_tool",
  "binding.function",
  "binding.extension",
  "binding.port",
  "binding.extension_hook",
];

/** The spec's execution error codes; the first value of `codes` must be one. */
export const EXECUTION_ERROR_CODES: readonly string[] = [
  "model_error",
  "tool_error",
  "tool_unavailable",
  "hook_error",
  "value_invalid",
  "route_error",
  "operation_invalid",
  "runtime_error",
  "aborted",
];

export const CASE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const RESERVED_GATE = "never";

const VALUE_OPS = [
  "identity",
  "constant",
  "get",
  "set",
  "merge",
  "wrap",
  "equals",
  "text",
  "textSuffix",
  "result",
  "sequence",
  "chain",
  "throw",
  "await",
  "nonJson",
] as const;
const HOOK_OPS = ["append", "runAgent", "runModel", "render", "complete"] as const;

export type OpPosition = "value" | "hook";

export interface AppendMessageScript {
  role: "user" | "system";
  text: string;
  key?: string;
  keep?: boolean;
  meta?: JsonObject;
}

export type Op =
  | { op: "identity"; site: string }
  | { op: "constant"; site: string; value: Json }
  | { op: "get"; site: string; path: string }
  | { op: "set"; site: string; path: string; value: Json }
  | { op: "merge"; site: string; value: JsonObject }
  | { op: "wrap"; site: string; key: string; with?: JsonObject }
  | { op: "equals"; site: string; path?: string; value: Json }
  | { op: "text"; site: string }
  | { op: "textSuffix"; site: string; suffix: string }
  | { op: "result"; site: string; content: Json[]; isError?: boolean }
  | { op: "sequence"; site: string; items: Op[] }
  | { op: "chain"; site: string; ops: Op[] }
  | { op: "throw"; site: string; message: string }
  | { op: "await"; site: string; gate: string; then?: Op }
  | { op: "nonJson"; site: string }
  | { op: "append"; site: string; messages: AppendMessageScript[] }
  | { op: "runAgent"; site: string; name: string; input?: Json }
  | { op: "runModel"; site: string; messages: Json }
  | { op: "render"; site: string; template: string; variables: JsonObject }
  | { op: "complete"; site: string; message: JsonObject; tool?: string; useResultContent: boolean };

export interface ModelResponseExtras {
  finishReason?: Json;
  usage?: JsonObject;
  meta?: JsonObject;
  id?: Json;
  source?: Json;
  deltas?: Json[];
}

export interface ScriptToolCall {
  callId: string;
  name: string;
  args: Json;
}

export type ModelResponse =
  | { kind: "text"; text: string; extras: ModelResponseExtras }
  | { kind: "toolCalls"; toolCalls: ScriptToolCall[]; extras: ModelResponseExtras }
  | { kind: "content"; content: Json[]; extras: ModelResponseExtras }
  | { kind: "error"; message: string; code?: string }
  | { kind: "raw"; value: Json }
  | { kind: "await"; gate: string; then: ModelResponse };

export interface ModelScript {
  responses: ModelResponse[];
}

export interface ToolResultExtras {
  isError?: boolean;
  keep?: boolean;
  meta?: JsonObject;
}

export type ToolResultScript =
  | { kind: "text"; text: string; extras: ToolResultExtras }
  | { kind: "json"; value: Json; extras: ToolResultExtras }
  | { kind: "content"; content: Json[]; extras: ToolResultExtras }
  | { kind: "error"; message: string }
  | { kind: "value"; value: Json }
  | { kind: "result"; value: JsonObject }
  | { kind: "runAgent"; name: string; input: Json }
  | { kind: "await"; gate: string; then: ToolResultScript };

export interface ToolScript {
  description: string;
  input: JsonObject;
  results: ToolResultScript[];
}

export interface ExtensionDefinitionScript {
  requires?: string[];
  hooks?: string[];
  tools?: string[];
  validateOptions?: Op;
  createError?: string;
}

export interface ExtensionInstanceScript {
  hooks: Map<ValueStage, Op>;
  tools: Map<string, ToolScript>;
  events?: string[];
}

export interface ExtensionScript {
  definition?: ExtensionDefinitionScript;
  instance?: ExtensionInstanceScript;
}

export interface CaseBindings {
  models: Map<string, ModelScript>;
  tools: Map<string, ToolScript>;
  functions: Map<string, Op>;
  extensions: Map<string, ExtensionScript>;
  ports: Map<string, Json>;
  maxRetries?: { value: Json };
}

export type CaseConfig =
  | { mode: "file"; path: string }
  | { mode: "document"; document: JsonObject; directory: string };

export type Step =
  | { action: "run"; settle: boolean; sessionId: string; input: Json; agent?: string; startAgent?: string }
  | { action: "decide"; settle: boolean; operation: string; value: Json; sessionId?: string }
  | { action: "list"; settle: boolean; sessionId?: string }
  | { action: "abort"; settle: boolean; sessionId: string }
  | { action: "deleteSession"; settle: boolean; sessionId: string }
  | { action: "restart"; settle: boolean }
  | { action: "close"; settle: boolean }
  | { action: "release"; settle: boolean; gate: string }
  | { action: "reach"; settle: boolean; gate: string }
  | { action: "acquireLease"; settle: boolean; sessionId: string; owner: string; lease: string }
  | { action: "renewLease"; settle: boolean; lease: string }
  | { action: "releaseLease"; settle: boolean; lease: string }
  | { action: "appendJournal"; settle: boolean; events: Json[]; lease?: string; expected?: number; writeId?: string }
  | { action: "appendOperationTransition"; settle: boolean; sessionId: string; operation: string; status: "approved" | "running" | "rejected" | "delivering" }
  | { action: "scanJournal"; settle: boolean; sessionId?: string; fromSeq?: number; limit?: number }
  | { action: "headJournal"; settle: boolean; sessionId: string }
  | { action: "deleteStoreSession"; settle: boolean; sessionId: string; lease: string }
  | { action: "parallel"; settle: boolean; branches: Step[][] };

export interface CaseFile {
  description: string;
  spec: string[];
  config: CaseConfig;
  bindings: CaseBindings;
  steps: Step[];
}

export type ExpectedError =
  | { kind: "config"; phase: "load" | "validate" | "create"; issues: JsonObject[] }
  | { kind: "invalidArgument" };

export type ExpectedStepError =
  | { kind: "execution"; where: Json; codes: Json; attempt: Json; toolCall?: Json; message?: string }
  | { kind: "issues"; issues: JsonObject[] }
  | { kind: "store"; name: "StoreConflictError" | "StoreInputError" }
  | { kind: "script"; message: string };

export type ExpectedStep =
  | { kind: "any" }
  | { kind: "result"; value: Json }
  | { kind: "error"; error: ExpectedStepError }
  | { kind: "parallel"; branches: ExpectedStep[][] };

export interface ExpectedFile {
  error?: ExpectedError;
  steps: ExpectedStep[];
  observations: Map<ObservationSection, Json>;
}

function fail(pointer: string, message: string): never {
  throw new CaseFormatError(`${pointer === "" ? "(root)" : pointer}: ${message}`);
}

function at(pointer: string, key: string | number): string {
  return `${pointer}/${String(key)}`;
}

function readObject(value: Json | undefined, pointer: string): JsonObject {
  if (!isJsonObject(value)) fail(pointer, "must be an object");
  return value;
}

function readArray(value: Json | undefined, pointer: string): Json[] {
  if (!isJsonArray(value)) fail(pointer, "must be an array");
  return value;
}

function readString(value: Json | undefined, pointer: string): string {
  if (!isString(value)) fail(pointer, "must be a string");
  return value;
}

function readNonEmptyString(value: Json | undefined, pointer: string): string {
  const text = readString(value, pointer);
  if (text === "") fail(pointer, "must not be empty");
  return text;
}

function readBoolean(value: Json | undefined, pointer: string): boolean {
  if (typeof value !== "boolean") fail(pointer, "must be a boolean");
  return value;
}

function readNonNegativeInteger(value: Json | undefined, pointer: string): number {
  if (!isNumber(value) || !Number.isSafeInteger(value) || value < 0) fail(pointer, "must be a non-negative safe integer");
  return value;
}

function readStringArray(value: Json | undefined, pointer: string): string[] {
  if (!isStringArray(value)) fail(pointer, "must be an array of strings");
  return value;
}

function requireKeys(object: JsonObject, pointer: string, allowed: readonly string[]): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(at(pointer, key), "is not a known key");
  }
}

function exactlyOne(object: JsonObject, pointer: string, keys: readonly string[]): string {
  const present = keys.filter((key) => Object.hasOwn(object, key));
  const first = present[0];
  if (first === undefined) fail(pointer, `must have one of ${keys.join(", ")}`);
  if (present.length > 1) fail(pointer, `must have only one of ${present.join(", ")}`);
  return first;
}

function readGate(value: Json | undefined, pointer: string): string {
  const gate = readNonEmptyString(value, pointer);
  return gate;
}

export function parseOp(raw: Json | undefined, pointer: string, position: OpPosition, site: string): Op {
  const object = readObject(raw, pointer);
  const name = readNonEmptyString(object["op"], at(pointer, "op"));
  const isValueOp = VALUE_OPS.some((candidate) => candidate === name);
  const isHookOp = HOOK_OPS.some((candidate) => candidate === name);
  if (!isValueOp && !isHookOp) fail(at(pointer, "op"), `is not a known operation: ${name}`);
  if (isHookOp && position !== "hook") fail(at(pointer, "op"), `operation ${name} is only allowed in extension instance hooks`);
  switch (name) {
    case "identity":
      requireKeys(object, pointer, ["op"]);
      return { op: "identity", site };
    case "constant":
      requireKeys(object, pointer, ["op", "value"]);
      if (!Object.hasOwn(object, "value")) fail(pointer, "constant requires value");
      return { op: "constant", site, value: object["value"] ?? null };
    case "get":
      requireKeys(object, pointer, ["op", "path"]);
      return { op: "get", site, path: readString(object["path"], at(pointer, "path")) };
    case "set": {
      requireKeys(object, pointer, ["op", "path", "value"]);
      const path = readNonEmptyString(object["path"], at(pointer, "path"));
      if (!Object.hasOwn(object, "value")) fail(pointer, "set requires value");
      return { op: "set", site, path, value: object["value"] ?? null };
    }
    case "merge":
      requireKeys(object, pointer, ["op", "value"]);
      return { op: "merge", site, value: readObject(object["value"], at(pointer, "value")) };
    case "wrap": {
      requireKeys(object, pointer, ["op", "key", "with"]);
      const key = readNonEmptyString(object["key"], at(pointer, "key"));
      const extra = Object.hasOwn(object, "with") ? readObject(object["with"], at(pointer, "with")) : undefined;
      if (extra && Object.hasOwn(extra, key)) fail(at(pointer, "with"), `must not repeat key ${key}`);
      return extra ? { op: "wrap", site, key, with: extra } : { op: "wrap", site, key };
    }
    case "equals": {
      requireKeys(object, pointer, ["op", "path", "value"]);
      if (!Object.hasOwn(object, "value")) fail(pointer, "equals requires value");
      const value = object["value"] ?? null;
      if (!Object.hasOwn(object, "path")) return { op: "equals", site, value };
      return { op: "equals", site, path: readString(object["path"], at(pointer, "path")), value };
    }
    case "text":
      requireKeys(object, pointer, ["op"]);
      return { op: "text", site };
    case "textSuffix":
      requireKeys(object, pointer, ["op", "suffix"]);
      return { op: "textSuffix", site, suffix: readString(object["suffix"], at(pointer, "suffix")) };
    case "result": {
      requireKeys(object, pointer, ["op", "content", "isError"]);
      const content = readArray(object["content"], at(pointer, "content"));
      if (!Object.hasOwn(object, "isError")) return { op: "result", site, content };
      return { op: "result", site, content, isError: readBoolean(object["isError"], at(pointer, "isError")) };
    }
    case "sequence": {
      requireKeys(object, pointer, ["op", "items"]);
      const items = readArray(object["items"], at(pointer, "items"));
      if (items.length === 0) fail(at(pointer, "items"), "must not be empty");
      return {
        op: "sequence",
        site,
        items: items.map((item, index) => parseOp(item, at(at(pointer, "items"), index), position, `${site}/items/${String(index)}`)),
      };
    }
    case "chain": {
      requireKeys(object, pointer, ["op", "ops"]);
      const ops = readArray(object["ops"], at(pointer, "ops"));
      if (ops.length === 0) fail(at(pointer, "ops"), "must not be empty");
      return {
        op: "chain",
        site,
        ops: ops.map((item, index) => parseOp(item, at(at(pointer, "ops"), index), position, `${site}/ops/${String(index)}`)),
      };
    }
    case "throw":
      requireKeys(object, pointer, ["op", "message"]);
      return { op: "throw", site, message: readString(object["message"], at(pointer, "message")) };
    case "await": {
      requireKeys(object, pointer, ["op", "gate", "then"]);
      const gate = readGate(object["gate"], at(pointer, "gate"));
      if (!Object.hasOwn(object, "then")) return { op: "await", site, gate };
      return { op: "await", site, gate, then: parseOp(object["then"], at(pointer, "then"), position, `${site}/then`) };
    }
    case "nonJson":
      requireKeys(object, pointer, ["op"]);
      return { op: "nonJson", site };
    case "append": {
      requireKeys(object, pointer, ["op", "messages"]);
      const messages = readArray(object["messages"], at(pointer, "messages"));
      return {
        op: "append",
        site,
        messages: messages.map((item, index) => parseAppendMessage(item, at(at(pointer, "messages"), index))),
      };
    }
    case "runAgent": {
      requireKeys(object, pointer, ["op", "name", "input"]);
      const agentName = readNonEmptyString(object["name"], at(pointer, "name"));
      if (!Object.hasOwn(object, "input")) return { op: "runAgent", site, name: agentName };
      return { op: "runAgent", site, name: agentName, input: object["input"] ?? null };
    }
    case "runModel":
      // `messages` is an arbitrary JSON value handed to `model.run` unchanged: the spec requires a
      // hook that passes a non-array to fail, so the runner must be able to express one.
      requireKeys(object, pointer, ["op", "messages"]);
      return { op: "runModel", site, messages: object["messages"] ?? null };
    case "render": {
      requireKeys(object, pointer, ["op", "template", "variables"]);
      const template = readNonEmptyString(object["template"], at(pointer, "template"));
      const variables = Object.hasOwn(object, "variables")
        ? readObject(object["variables"], at(pointer, "variables"))
        : {};
      return { op: "render", site, template, variables };
    }
    case "complete": {
      requireKeys(object, pointer, ["op", "message", "tool", "useResultContent"]);
      const message = readObject(object["message"], at(pointer, "message"));
      const useResultContent = Object.hasOwn(object, "useResultContent")
        ? readBoolean(object["useResultContent"], at(pointer, "useResultContent"))
        : false;
      if (!Object.hasOwn(object, "tool")) return { op: "complete", site, message, useResultContent };
      return {
        op: "complete",
        site,
        message,
        tool: readNonEmptyString(object["tool"], at(pointer, "tool")),
        useResultContent,
      };
    }
    default:
      return fail(at(pointer, "op"), `is not a known operation: ${name}`);
  }
}

function parseAppendMessage(raw: Json | undefined, pointer: string): AppendMessageScript {
  const object = readObject(raw, pointer);
  requireKeys(object, pointer, ["role", "text", "key", "keep", "meta"]);
  const role = readNonEmptyString(object["role"], at(pointer, "role"));
  if (role !== "user" && role !== "system") fail(at(pointer, "role"), "must be user or system");
  const message: AppendMessageScript = { role, text: readString(object["text"], at(pointer, "text")) };
  if (Object.hasOwn(object, "key")) message.key = readString(object["key"], at(pointer, "key"));
  if (Object.hasOwn(object, "keep")) message.keep = readBoolean(object["keep"], at(pointer, "keep"));
  if (Object.hasOwn(object, "meta")) message.meta = readObject(object["meta"], at(pointer, "meta"));
  return message;
}

function parseModelExtras(object: JsonObject, pointer: string): ModelResponseExtras {
  const extras: ModelResponseExtras = {};
  if (Object.hasOwn(object, "finishReason")) extras.finishReason = object["finishReason"] ?? null;
  if (Object.hasOwn(object, "usage")) extras.usage = readObject(object["usage"], at(pointer, "usage"));
  if (Object.hasOwn(object, "meta")) extras.meta = readObject(object["meta"], at(pointer, "meta"));
  if (Object.hasOwn(object, "id")) extras.id = object["id"] ?? null;
  if (Object.hasOwn(object, "source")) extras.source = object["source"] ?? null;
  if (Object.hasOwn(object, "deltas")) extras.deltas = readArray(object["deltas"], at(pointer, "deltas"));
  return extras;
}

const MODEL_EXTRA_KEYS = ["finishReason", "usage", "meta", "id", "source", "deltas"] as const;

export function parseModelResponse(raw: Json | undefined, pointer: string): ModelResponse {
  const object = readObject(raw, pointer);
  const key = exactlyOne(object, pointer, ["text", "toolCalls", "content", "error", "raw", "await"]);
  switch (key) {
    case "text":
      requireKeys(object, pointer, ["text", ...MODEL_EXTRA_KEYS]);
      return { kind: "text", text: readString(object["text"], at(pointer, "text")), extras: parseModelExtras(object, pointer) };
    case "toolCalls": {
      requireKeys(object, pointer, ["toolCalls", ...MODEL_EXTRA_KEYS]);
      const calls = readArray(object["toolCalls"], at(pointer, "toolCalls")).map((item, index) => {
        const callPointer = at(at(pointer, "toolCalls"), index);
        const call = readObject(item, callPointer);
        requireKeys(call, callPointer, ["callId", "name", "args"]);
        return {
          callId: readNonEmptyString(call["callId"], at(callPointer, "callId")),
          name: readNonEmptyString(call["name"], at(callPointer, "name")),
          args: Object.hasOwn(call, "args") ? call["args"] ?? null : null,
        };
      });
      return { kind: "toolCalls", toolCalls: calls, extras: parseModelExtras(object, pointer) };
    }
    case "content":
      requireKeys(object, pointer, ["content", ...MODEL_EXTRA_KEYS]);
      return {
        kind: "content",
        content: readArray(object["content"], at(pointer, "content")),
        extras: parseModelExtras(object, pointer),
      };
    case "error": {
      requireKeys(object, pointer, ["error", "code"]);
      const message = readString(object["error"], at(pointer, "error"));
      if (!Object.hasOwn(object, "code")) return { kind: "error", message };
      return { kind: "error", message, code: readNonEmptyString(object["code"], at(pointer, "code")) };
    }
    case "raw":
      requireKeys(object, pointer, ["raw"]);
      return { kind: "raw", value: object["raw"] ?? null };
    default: {
      requireKeys(object, pointer, ["await", "then"]);
      const gate = readGate(object["await"], at(pointer, "await"));
      if (!Object.hasOwn(object, "then")) fail(pointer, "await requires then");
      return { kind: "await", gate, then: parseModelResponse(object["then"], at(pointer, "then")) };
    }
  }
}

export function parseModelScript(raw: Json | undefined, pointer: string): ModelScript {
  const object = readObject(raw, pointer);
  requireKeys(object, pointer, ["responses"]);
  const responses = readArray(object["responses"], at(pointer, "responses"));
  return {
    responses: responses.map((item, index) => parseModelResponse(item, at(at(pointer, "responses"), index))),
  };
}

function parseToolExtras(object: JsonObject, pointer: string): ToolResultExtras {
  const extras: ToolResultExtras = {};
  if (Object.hasOwn(object, "isError")) extras.isError = readBoolean(object["isError"], at(pointer, "isError"));
  if (Object.hasOwn(object, "keep")) extras.keep = readBoolean(object["keep"], at(pointer, "keep"));
  if (Object.hasOwn(object, "meta")) extras.meta = readObject(object["meta"], at(pointer, "meta"));
  return extras;
}

const TOOL_EXTRA_KEYS = ["isError", "keep", "meta"] as const;

export function parseToolResultScript(raw: Json | undefined, pointer: string): ToolResultScript {
  const object = readObject(raw, pointer);
  const key = exactlyOne(object, pointer, ["text", "json", "content", "value", "result", "error", "runAgent", "await"]);
  switch (key) {
    case "text":
      requireKeys(object, pointer, ["text", ...TOOL_EXTRA_KEYS]);
      return { kind: "text", text: readString(object["text"], at(pointer, "text")), extras: parseToolExtras(object, pointer) };
    case "json":
      requireKeys(object, pointer, ["json", ...TOOL_EXTRA_KEYS]);
      return { kind: "json", value: object["json"] ?? null, extras: parseToolExtras(object, pointer) };
    case "content":
      requireKeys(object, pointer, ["content", ...TOOL_EXTRA_KEYS]);
      return {
        kind: "content",
        content: readArray(object["content"], at(pointer, "content")),
        extras: parseToolExtras(object, pointer),
      };
    case "error":
      requireKeys(object, pointer, ["error"]);
      return { kind: "error", message: readString(object["error"], at(pointer, "error")) };
    case "value":
      requireKeys(object, pointer, ["value"]);
      return { kind: "value", value: object["value"] ?? null };
    case "result":
      requireKeys(object, pointer, ["result"]);
      return { kind: "result", value: readObject(object["result"], at(pointer, "result")) };
    case "runAgent": {
      requireKeys(object, pointer, ["runAgent"]);
      const call = readObject(object["runAgent"], at(pointer, "runAgent"));
      requireKeys(call, at(pointer, "runAgent"), ["name", "input"]);
      return {
        kind: "runAgent",
        name: readNonEmptyString(call["name"], at(at(pointer, "runAgent"), "name")),
        input: Object.hasOwn(call, "input") ? call["input"] ?? null : null,
      };
    }
    default: {
      requireKeys(object, pointer, ["await", "then"]);
      const gate = readGate(object["await"], at(pointer, "await"));
      if (!Object.hasOwn(object, "then")) fail(pointer, "await requires then");
      return { kind: "await", gate, then: parseToolResultScript(object["then"], at(pointer, "then")) };
    }
  }
}

export function parseToolScript(raw: Json | undefined, pointer: string): ToolScript {
  const object = readObject(raw, pointer);
  requireKeys(object, pointer, ["description", "input", "results"]);
  const results = readArray(object["results"], at(pointer, "results"));
  return {
    description: Object.hasOwn(object, "description") ? readString(object["description"], at(pointer, "description")) : "",
    input: Object.hasOwn(object, "input") ? readObject(object["input"], at(pointer, "input")) : { type: "object" },
    results: results.map((item, index) => parseToolResultScript(item, at(at(pointer, "results"), index))),
  };
}

function parseExtensionScript(raw: Json | undefined, pointer: string, name: string): ExtensionScript {
  const object = readObject(raw, pointer);
  requireKeys(object, pointer, ["definition", "instance"]);
  const script: ExtensionScript = {};
  if (Object.hasOwn(object, "definition")) {
    const definitionPointer = at(pointer, "definition");
    const definition = readObject(object["definition"], definitionPointer);
    requireKeys(definition, definitionPointer, ["requires", "hooks", "tools", "validateOptions", "createError"]);
    const parsed: ExtensionDefinitionScript = {};
    if (Object.hasOwn(definition, "requires")) {
      parsed.requires = readStringArray(definition["requires"], at(definitionPointer, "requires"));
    }
    if (Object.hasOwn(definition, "hooks")) {
      parsed.hooks = readStringArray(definition["hooks"], at(definitionPointer, "hooks"));
    }
    if (Object.hasOwn(definition, "tools")) {
      parsed.tools = readStringArray(definition["tools"], at(definitionPointer, "tools"));
    }
    if (Object.hasOwn(definition, "validateOptions")) {
      parsed.validateOptions = parseOp(
        definition["validateOptions"],
        at(definitionPointer, "validateOptions"),
        "value",
        `extensions.${name}.definition.validateOptions`,
      );
    }
    if (Object.hasOwn(definition, "createError")) {
      parsed.createError = readNonEmptyString(definition["createError"], at(definitionPointer, "createError"));
    }
    script.definition = parsed;
  }
  if (Object.hasOwn(object, "instance")) {
    const instancePointer = at(pointer, "instance");
    const instance = readObject(object["instance"], instancePointer);
    requireKeys(instance, instancePointer, ["hooks", "tools", "events"]);
    const hooks = new Map<ValueStage, Op>();
    if (Object.hasOwn(instance, "hooks")) {
      const hooksPointer = at(instancePointer, "hooks");
      const declared = readObject(instance["hooks"], hooksPointer);
      for (const [stage, value] of Object.entries(declared)) {
        const known = VALUE_STAGES.find((candidate) => candidate === stage);
        if (known === undefined) fail(at(hooksPointer, stage), "is not a value stage");
        hooks.set(known, parseOp(value, at(hooksPointer, stage), "hook", `extensions.${name}.instance.hooks.${stage}`));
      }
    }
    const tools = new Map<string, ToolScript>();
    if (Object.hasOwn(instance, "tools")) {
      const toolsPointer = at(instancePointer, "tools");
      const declared = readObject(instance["tools"], toolsPointer);
      for (const [toolName, value] of Object.entries(declared)) {
        tools.set(toolName, parseToolScript(value, at(toolsPointer, toolName)));
      }
    }
    const parsed: ExtensionInstanceScript = { hooks, tools };
    if (Object.hasOwn(instance, "events")) {
      parsed.events = readStringArray(instance["events"], at(instancePointer, "events"));
    }
    script.instance = parsed;
  }
  return script;
}

function parseBindings(raw: Json | undefined, pointer: string): CaseBindings {
  const object = readObject(raw, pointer);
  requireKeys(object, pointer, ["models", "tools", "functions", "extensions", "ports", "maxRetries"]);
  const bindings: CaseBindings = {
    models: new Map(),
    tools: new Map(),
    functions: new Map(),
    extensions: new Map(),
    ports: new Map(),
  };
  if (Object.hasOwn(object, "models")) {
    const models = readObject(object["models"], at(pointer, "models"));
    for (const [name, value] of Object.entries(models)) {
      bindings.models.set(name, parseModelScript(value, at(at(pointer, "models"), name)));
    }
  }
  if (Object.hasOwn(object, "tools")) {
    const tools = readObject(object["tools"], at(pointer, "tools"));
    for (const [name, value] of Object.entries(tools)) {
      bindings.tools.set(name, parseToolScript(value, at(at(pointer, "tools"), name)));
    }
  }
  if (Object.hasOwn(object, "functions")) {
    const functions = readObject(object["functions"], at(pointer, "functions"));
    for (const [name, value] of Object.entries(functions)) {
      bindings.functions.set(name, parseOp(value, at(at(pointer, "functions"), name), "value", `functions.${name}`));
    }
  }
  if (Object.hasOwn(object, "extensions")) {
    const extensions = readObject(object["extensions"], at(pointer, "extensions"));
    for (const [name, value] of Object.entries(extensions)) {
      bindings.extensions.set(name, parseExtensionScript(value, at(at(pointer, "extensions"), name), name));
    }
  }
  if (Object.hasOwn(object, "ports")) {
    const ports = readObject(object["ports"], at(pointer, "ports"));
    for (const [name, value] of Object.entries(ports)) bindings.ports.set(name, value ?? null);
  }
  if (Object.hasOwn(object, "maxRetries")) bindings.maxRetries = { value: object["maxRetries"] ?? null };
  return bindings;
}

function parseConfig(raw: Json | undefined, pointer: string): CaseConfig {
  if (raw === undefined) return { mode: "file", path: "config" };
  const object = readObject(raw, pointer);
  requireKeys(object, pointer, ["path", "document", "directory"]);
  const hasPath = Object.hasOwn(object, "path");
  const hasDocument = Object.hasOwn(object, "document");
  if (hasPath && hasDocument) fail(pointer, "must not have both path and document");
  if (hasDocument) {
    return {
      mode: "document",
      document: readObject(object["document"], at(pointer, "document")),
      directory: Object.hasOwn(object, "directory")
        ? readNonEmptyString(object["directory"], at(pointer, "directory"))
        : "config",
    };
  }
  if (Object.hasOwn(object, "directory")) fail(at(pointer, "directory"), "is only allowed with document");
  return {
    mode: "file",
    path: hasPath ? readNonEmptyString(object["path"], at(pointer, "path")) : "config",
  };
}

const STEP_ACTIONS = [
  "run",
  "decide",
  "list",
  "abort",
  "deleteSession",
  "restart",
  "close",
  "release",
  "reach",
  "acquireLease",
  "renewLease",
  "releaseLease",
  "appendJournal",
  "appendOperationTransition",
  "scanJournal",
  "headJournal",
  "deleteStoreSession",
  "parallel",
] as const;

function parseStep(raw: Json | undefined, pointer: string, inBranch: boolean): Step {
  const object = readObject(raw, pointer);
  const actions = STEP_ACTIONS.filter((action) => Object.hasOwn(object, action));
  const action = actions[0];
  if (action === undefined) fail(pointer, "must have one action key");
  if (actions.length > 1) fail(pointer, `must have only one action key, found ${actions.join(", ")}`);
  requireKeys(object, pointer, [action, "settle"]);
  let settle = true;
  if (Object.hasOwn(object, "settle")) {
    if (inBranch) fail(at(pointer, "settle"), "is not allowed inside a parallel branch");
    settle = readBoolean(object["settle"], at(pointer, "settle"));
  }
  const valuePointer = at(pointer, action);
  const value = object[action];
  switch (action) {
    case "run": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId", "input", "agent", "startAgent"]);
      if (!Object.hasOwn(payload, "input")) fail(valuePointer, "run requires input");
      const step: Step = {
        action: "run",
        settle,
        sessionId: readNonEmptyString(payload["sessionId"], at(valuePointer, "sessionId")),
        input: payload["input"] ?? null,
      };
      if (Object.hasOwn(payload, "agent")) step.agent = readNonEmptyString(payload["agent"], at(valuePointer, "agent"));
      if (Object.hasOwn(payload, "startAgent")) {
        step.startAgent = readNonEmptyString(payload["startAgent"], at(valuePointer, "startAgent"));
      }
      return step;
    }
    case "decide": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["operation", "value", "sessionId"]);
      if (!Object.hasOwn(payload, "value")) fail(valuePointer, "decide requires value");
      const step: Step = {
        action: "decide",
        settle,
        operation: readNonEmptyString(payload["operation"], at(valuePointer, "operation")),
        value: payload["value"] ?? null,
      };
      if (Object.hasOwn(payload, "sessionId")) {
        step.sessionId = readNonEmptyString(payload["sessionId"], at(valuePointer, "sessionId"));
      }
      return step;
    }
    case "list": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId"]);
      const sessionId = Object.hasOwn(payload, "sessionId")
        ? readNonEmptyString(payload["sessionId"], at(valuePointer, "sessionId"))
        : undefined;
      return sessionId === undefined ? { action: "list", settle } : { action: "list", settle, sessionId };
    }
    case "abort": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId"]);
      return {
        action: "abort",
        settle,
        sessionId: readNonEmptyString(payload["sessionId"], at(valuePointer, "sessionId")),
      };
    }
    case "deleteSession": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId"]);
      return {
        action: "deleteSession",
        settle,
        sessionId: readNonEmptyString(payload["sessionId"], at(valuePointer, "sessionId")),
      };
    }
    case "restart": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, []);
      if (inBranch) fail(pointer, "restart is not allowed inside a parallel branch");
      return { action, settle };
    }
    case "close": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, []);
      return { action, settle };
    }
    case "release": {
      const gate = readGate(value, valuePointer);
      if (gate === RESERVED_GATE) fail(valuePointer, `gate ${RESERVED_GATE} must not be released`);
      return { action: "release", settle, gate };
    }
    case "reach":
      return { action: "reach", settle: false, gate: readGate(value, valuePointer) };
    case "acquireLease": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId", "owner", "lease"]);
      return {
        action,
        settle,
        sessionId: readString(payload["sessionId"], at(valuePointer, "sessionId")),
        owner: readNonEmptyString(payload["owner"], at(valuePointer, "owner")),
        lease: readNonEmptyString(payload["lease"], at(valuePointer, "lease")),
      };
    }
    case "renewLease":
    case "releaseLease": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["lease"]);
      return { action, settle, lease: readNonEmptyString(payload["lease"], at(valuePointer, "lease")) };
    }
    case "appendJournal": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["events", "lease", "expected", "writeId"]);
      const step: Step = { action, settle, events: readArray(payload["events"], at(valuePointer, "events")) };
      if (Object.hasOwn(payload, "lease")) step.lease = readNonEmptyString(payload["lease"], at(valuePointer, "lease"));
      if (Object.hasOwn(payload, "expected")) {
        step.expected = readNonNegativeInteger(payload["expected"], at(valuePointer, "expected"));
      }
      if (Object.hasOwn(payload, "writeId")) step.writeId = readNonEmptyString(payload["writeId"], at(valuePointer, "writeId"));
      return step;
    }
    case "appendOperationTransition": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId", "operation", "status"]);
      const status = readNonEmptyString(payload["status"], at(valuePointer, "status"));
      if (status !== "approved" && status !== "running" && status !== "rejected" && status !== "delivering") {
        fail(at(valuePointer, "status"), "must be approved, running, rejected or delivering");
      }
      return {
        action,
        settle,
        sessionId: readNonEmptyString(payload["sessionId"], at(valuePointer, "sessionId")),
        operation: readNonEmptyString(payload["operation"], at(valuePointer, "operation")),
        status,
      };
    }
    case "scanJournal": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId", "fromSeq", "limit"]);
      const step: Step = { action, settle };
      if (Object.hasOwn(payload, "sessionId")) step.sessionId = readString(payload["sessionId"], at(valuePointer, "sessionId"));
      if (Object.hasOwn(payload, "fromSeq")) step.fromSeq = readNonNegativeInteger(payload["fromSeq"], at(valuePointer, "fromSeq"));
      if (Object.hasOwn(payload, "limit")) step.limit = readNonNegativeInteger(payload["limit"], at(valuePointer, "limit"));
      return step;
    }
    case "headJournal": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId"]);
      return { action, settle, sessionId: readString(payload["sessionId"], at(valuePointer, "sessionId")) };
    }
    case "deleteStoreSession": {
      const payload = readObject(value, valuePointer);
      requireKeys(payload, valuePointer, ["sessionId", "lease"]);
      return {
        action,
        settle,
        sessionId: readString(payload["sessionId"], at(valuePointer, "sessionId")),
        lease: readNonEmptyString(payload["lease"], at(valuePointer, "lease")),
      };
    }
    default: {
      if (inBranch) fail(pointer, "parallel is not allowed inside a parallel branch");
      const branches = readArray(value, valuePointer);
      if (branches.length === 0) fail(valuePointer, "must not be empty");
      return {
        action: "parallel",
        settle,
        branches: branches.map((branch, branchIndex) => {
          const branchPointer = at(valuePointer, branchIndex);
          return readArray(branch, branchPointer).map((item, index) => parseStep(item, at(branchPointer, index), true));
        }),
      };
    }
  }
}

export function parseCase(raw: Json): CaseFile {
  const object = readObject(raw, "");
  requireKeys(object, "", ["description", "spec", "config", "bindings", "steps"]);
  const description = readNonEmptyString(object["description"], "/description");
  const spec = readStringArray(object["spec"], "/spec");
  if (spec.length === 0) fail("/spec", "must cite at least one spec heading");
  const seen = new Set<string>();
  for (const [index, heading] of spec.entries()) {
    if (heading === "") fail(`/spec/${String(index)}`, "must not be empty");
    if (seen.has(heading)) fail(`/spec/${String(index)}`, `repeats ${heading}`);
    seen.add(heading);
  }
  const steps = readArray(object["steps"], "/steps").map((item, index) => parseStep(item, `/steps/${String(index)}`, false));
  return {
    description,
    spec,
    config: parseConfig(Object.hasOwn(object, "config") ? object["config"] : undefined, "/config"),
    bindings: parseBindings(Object.hasOwn(object, "bindings") ? object["bindings"] : {}, "/bindings"),
    steps,
  };
}

function parseIssues(raw: Json | undefined, pointer: string): JsonObject[] {
  const issues = readArray(raw, pointer);
  if (issues.length === 0) fail(pointer, "must not be empty");
  return issues.map((item, index) => {
    const issuePointer = at(pointer, index);
    const issue = readObject(item, issuePointer);
    requireKeys(issue, issuePointer, ["code", "path", "message"]);
    const code = readNonEmptyString(issue["code"], at(issuePointer, "code"));
    if (!CONFIG_ERROR_CODES.includes(code)) fail(at(issuePointer, "code"), `is not a configuration error code: ${code}`);
    const path = readString(issue["path"], at(issuePointer, "path"));
    if (path !== "" && !path.startsWith("/")) fail(at(issuePointer, "path"), "must be a JSON Pointer");
    const result: JsonObject = { code, path };
    if (Object.hasOwn(issue, "message")) result["message"] = readNonEmptyString(issue["message"], at(issuePointer, "message"));
    return result;
  });
}

function parseExpectedError(raw: Json | undefined, pointer: string): ExpectedError {
  const object = readObject(raw, pointer);
  requireKeys(object, pointer, ["phase", "issues", "invalidArgument"]);
  const phase = readNonEmptyString(object["phase"], at(pointer, "phase"));
  if (phase !== "load" && phase !== "validate" && phase !== "create") {
    fail(at(pointer, "phase"), "must be load, validate or create");
  }
  if (Object.hasOwn(object, "invalidArgument")) {
    if (Object.hasOwn(object, "issues")) fail(pointer, "must not have both issues and invalidArgument");
    if (phase !== "create") fail(at(pointer, "phase"), "must be create for an invalid argument");
    if (readBoolean(object["invalidArgument"], at(pointer, "invalidArgument")) !== true) {
      fail(at(pointer, "invalidArgument"), "must be true");
    }
    return { kind: "invalidArgument" };
  }
  return { kind: "config", phase, issues: parseIssues(object["issues"], at(pointer, "issues")) };
}

function parseExpectedStepError(raw: Json | undefined, pointer: string): ExpectedStepError {
  const object = readObject(raw, pointer);
  if (Object.hasOwn(object, "storeError")) {
    requireKeys(object, pointer, ["storeError"]);
    const name = readString(object["storeError"], at(pointer, "storeError"));
    if (name !== "StoreConflictError" && name !== "StoreInputError") fail(at(pointer, "storeError"), "must name a store error");
    return { kind: "store", name };
  }
  if (Object.hasOwn(object, "scriptError")) {
    requireKeys(object, pointer, ["scriptError"]);
    return { kind: "script", message: readNonEmptyString(object["scriptError"], at(pointer, "scriptError")) };
  }
  if (Object.hasOwn(object, "issues")) {
    requireKeys(object, pointer, ["issues"]);
    return { kind: "issues", issues: parseIssues(object["issues"], at(pointer, "issues")) };
  }
  requireKeys(object, pointer, ["where", "codes", "attempt", "toolCall", "message"]);
  for (const key of ["where", "codes", "attempt"]) {
    if (!Object.hasOwn(object, key)) fail(pointer, `execution error requires ${key}`);
  }
  const codes = readArray(object["codes"], at(pointer, "codes"));
  const first = codes[0];
  if (first === undefined) fail(at(pointer, "codes"), "must not be empty");
  if (!isString(first) || !EXECUTION_ERROR_CODES.includes(first)) {
    fail(at(pointer, "codes") + "/0", "must be an execution error code");
  }
  const error: ExpectedStepError = {
    kind: "execution",
    where: object["where"] ?? null,
    codes,
    attempt: object["attempt"] ?? null,
  };
  if (Object.hasOwn(object, "toolCall")) error.toolCall = object["toolCall"] ?? null;
  if (Object.hasOwn(object, "message")) error.message = readString(object["message"], at(pointer, "message"));
  return error;
}

function parseExpectedStep(raw: Json | undefined, pointer: string, inBranch: boolean): ExpectedStep {
  const object = readObject(raw, pointer);
  const keys = Object.keys(object);
  if (keys.length === 0) return { kind: "any" };
  requireKeys(object, pointer, ["result", "error", "parallel"]);
  if (keys.length > 1) fail(pointer, `must have at most one of result, error, parallel`);
  if (Object.hasOwn(object, "result")) return { kind: "result", value: object["result"] ?? null };
  if (Object.hasOwn(object, "error")) return { kind: "error", error: parseExpectedStepError(object["error"], at(pointer, "error")) };
  if (inBranch) fail(pointer, "parallel is not allowed inside a parallel branch");
  const branches = readArray(object["parallel"], at(pointer, "parallel"));
  return {
    kind: "parallel",
    branches: branches.map((branch, branchIndex) => {
      const branchPointer = at(at(pointer, "parallel"), branchIndex);
      return readArray(branch, branchPointer).map((item, index) => parseExpectedStep(item, at(branchPointer, index), true));
    }),
  };
}

export function parseExpected(raw: Json, caseFile: CaseFile): ExpectedFile {
  const object = readObject(raw, "");
  requireKeys(object, "", ["error", "steps", "observations"]);
  const observations = new Map<ObservationSection, Json>();
  if (Object.hasOwn(object, "observations")) {
    const declared = readObject(object["observations"], "/observations");
    for (const [name, value] of Object.entries(declared)) {
      const known = OBSERVATION_SECTIONS.find((candidate) => candidate === name);
      if (known === undefined) fail(`/observations/${name}`, "is not an observation section");
      observations.set(known, value ?? null);
    }
  }
  if (Object.hasOwn(object, "error")) {
    if (Object.hasOwn(object, "steps")) fail("/steps", "must not be used with error");
    if (observations.size > 0) fail("/observations", "must not be used with error");
    if (caseFile.steps.length > 0) fail("/error", "requires an empty steps array in case.json");
    return { error: parseExpectedError(object["error"], "/error"), steps: [], observations };
  }
  if (!Object.hasOwn(object, "steps")) fail("/steps", "is required without error");
  const steps = readArray(object["steps"], "/steps").map((item, index) =>
    parseExpectedStep(item, `/steps/${String(index)}`, false),
  );
  if (steps.length !== caseFile.steps.length) {
    fail("/steps", `must have ${String(caseFile.steps.length)} entries to match case.json`);
  }
  for (const [index, step] of steps.entries()) {
    const actual = caseFile.steps[index];
    if (actual === undefined) continue;
    if (step.kind === "parallel") {
      if (actual.action !== "parallel") fail(`/steps/${String(index)}`, "parallel expectation needs a parallel step");
      if (step.branches.length !== actual.branches.length) {
        fail(`/steps/${String(index)}/parallel`, "must have one entry per branch");
      }
      for (const [branchIndex, branch] of step.branches.entries()) {
        const actualBranch = actual.branches[branchIndex];
        if (actualBranch !== undefined && branch.length !== actualBranch.length) {
          fail(`/steps/${String(index)}/parallel/${String(branchIndex)}`, "must have one entry per step");
        }
      }
    }
    if (
      step.kind === "result" &&
      !["run", "decide", "list", "abort", "acquireLease", "renewLease", "appendJournal", "scanJournal", "headJournal"].includes(actual.action)
    ) {
      fail(`/steps/${String(index)}/result`, `step ${actual.action} has no return value`);
    }
  }
  return { steps, observations };
}
