import { isRecord, jsonEqual, jsonIssues, jsonText, ownKeys, toJson } from "./json.ts";
import { validateDefinition } from "./schema.ts";
import {
  type Complete, type Json, type Message, type ModelInput, type ModelResponse,
  type ModelResult, type Part, type Retry, type ToolCall, type ToolExecution, type ToolResult,
  type ToolReturn, type Usage, type ValueName,
} from "./types.ts";

export function isMessage(value: unknown): value is Message { return validateDefinition("message", value, []).length === 0; }
export function isMessageArray(value: unknown): value is Message[] { return Array.isArray(value) && value.every(isMessage); }
export function isPart(value: unknown): value is Part { return validateDefinition("part", value, []).length === 0; }
export function isPartArray(value: unknown): value is Part[] { return Array.isArray(value) && value.every(isPart); }
function isJson(value: unknown): value is Json { return jsonIssues(value).length === 0; }
export function isToolCall(value: unknown): value is ToolCall {
  return validateDefinition("toolCall", value, []).length === 0;
}
export function isToolResult(value: unknown): value is ToolResult {
  return isRecord(value) && typeof value.callId === "string" && typeof value.name === "string"
    && value.callId.length > 0 && value.name.length > 0
    && ownKeys(value).every((key) => ["callId", "name", "args", "content", "isError", "keep", "meta"].includes(key))
    && isJson(value.args) && isPartArray(value.content)
    && (value.isError === undefined || typeof value.isError === "boolean")
    && (value.keep === undefined || typeof value.keep === "boolean")
    && (value.meta === undefined || (isRecord(value.meta) && isJson(value.meta)));
}
export function isModelInput(value: unknown): value is ModelInput {
  return modelInputIssue(value, "model input") === undefined;
}
export function isModelResult(value: unknown): value is ModelResult {
  return modelResultIssue(value, "model result") === undefined;
}

function optional(value: Record<string, unknown>, key: string, ok: (candidate: unknown) => boolean, label: string): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return ok(candidate) ? undefined : `${label}/${key} has an unsupported value`;
}

export function messageIssue(value: unknown, label: string): string | undefined {
  const first = validateDefinition("message", value, [])[0];
  if (!first) return undefined;
  return `${label}${first.path === "" ? "" : first.path} ${first.message}`;
}

function messagesIssue(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value)) return `${label} is not an array of messages`;
  for (const [index, item] of value.entries()) {
    const issue = messageIssue(item, `${label}/${String(index)}`);
    if (issue) return issue;
  }
  const ids = value.filter(isMessage).map((message) => message.id);
  if (new Set(ids).size !== ids.length) return `${label} repeats a message id`;
  return undefined;
}

function usageIssue(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return `${label}/usage is not an object`;
  for (const key of ownKeys(value)) if (!["input", "output", "cacheRead", "cacheWrite"].includes(key)) return `${label}/usage/${key} is not supported`;
  for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
    const count = value[key];
    if (count !== undefined && (typeof count !== "number" || !Number.isFinite(count) || count < 0)) return `${label}/usage/${key} is not a number of 0 or more`;
  }
  return undefined;
}

function modelInputIssue(value: unknown, label: string): string | undefined {
  if (!isRecord(value)) return `${label} is not a model input`;
  if (ownKeys(value).some((key) => !["system", "messages", "tools", "options"].includes(key))) return `${label} has an unsupported field`;
  if (!Array.isArray(value.system)) return `${label}/system is not an array`;
  for (const block of value.system) {
    if (!isRecord(block) || typeof block.text !== "string" || typeof block.source !== "string"
      || ownKeys(block).some((key) => !["text", "source", "cache"].includes(key))
      || (block.cache !== undefined && typeof block.cache !== "boolean")) return `${label}/system contains an invalid block`;
  }
  const messageProblem = messagesIssue(value.messages, `${label}/messages`);
  if (messageProblem) return messageProblem;
  if (!Array.isArray(value.tools) || value.tools.some((tool) => !isRecord(tool) || typeof tool.name !== "string"
    || typeof tool.description !== "string" || !isRecord(tool.input) || !isJson(tool.input)
    || ownKeys(tool).some((key) => !["name", "description", "input"].includes(key)))) return `${label}/tools is invalid`;
  if (!isRecord(value.options) || !isJson(value.options)) return `${label}/options is not a JSON object`;
  return undefined;
}

function modelResultIssue(value: unknown, label: string): string | undefined {
  if (!isRecord(value)) return `${label} is not a model result`;
  if (ownKeys(value).some((key) => !["message", "usage", "finishReason"].includes(key))) return `${label} has an unsupported field`;
  const problem = messageIssue(value.message, `${label}/message`);
  if (problem) return problem;
  if (!isRecord(value.message) || value.message.role !== "assistant") return `${label}/message/role is not assistant`;
  if (value.finishReason !== "stop" && value.finishReason !== "tool" && value.finishReason !== "length" && value.finishReason !== "other") {
    return `${label}/finishReason is invalid`;
  }
  return usageIssue(value.usage, label);
}

function toolCallIssue(value: unknown, label: string, callId?: string): string | undefined {
  if (!isToolCall(value)) return `${label} is not a tool call`;
  if (callId !== undefined && value.id !== callId) return `${label}/id does not name the tool call being processed`;
  return undefined;
}

function toolResultIssue(value: unknown, label: string, callId?: string): string | undefined {
  if (!isToolResult(value)) return `${label} is not a tool result`;
  if (callId !== undefined && value.callId !== callId) return `${label}/callId does not name the tool call being processed`;
  return undefined;
}

export function stageValueIssue(stage: ValueName, value: unknown, callId?: string): string | undefined {
  const label = `the ${stage} value`;
  switch (stage) {
    case "onInput":
    case "onPrompt":
    case "onStep": return messagesIssue(value, label);
    case "onModelInput": return modelInputIssue(value, label);
    case "onModelResult": return modelResultIssue(value, label);
    case "onToolCall": return toolCallIssue(value, label, callId);
    case "onToolResult": return toolResultIssue(value, label, callId);
    case "onOutput": {
      const problem = messageIssue(value, label);
      if (problem) return problem;
      return isRecord(value) && value.role === "assistant" ? undefined : `${label}/role is not assistant`;
    }
    case "onError": {
      const first = validateDefinition("executionError", value, [])[0];
      return first ? `${label}${first.path === "" ? "" : first.path} ${first.message}` : undefined;
    }
  }
}

export interface Normalized<T> { value?: T; issue?: string }

export function normalizeModelResponse(value: unknown, id: string): Normalized<ModelResult> {
  if (!isRecord(value) || !isRecord(value.message)) return { issue: "the model response is not an object with a message" };
  if (ownKeys(value).some((key) => !["message", "finishReason", "usage"].includes(key))) return { issue: "the model response has an unsupported field" };
  if (ownKeys(value.message).some((key) => !["id", "role", "content", "source", "key", "keep", "meta"].includes(key))) {
    return { issue: "the model response/message has an unsupported field" };
  }
  if (value.message.role !== "assistant") return { issue: "the model response/message/role is not assistant" };
  if (!isPartArray(value.message.content)) return { issue: "the model response/message/content is not an array of parts" };
  if (value.message.id !== undefined && (typeof value.message.id !== "string" || value.message.id.length === 0)) return { issue: "the model response/message/id is invalid" };
  if (value.message.source !== undefined && (typeof value.message.source !== "string" || value.message.source.length === 0)) return { issue: "the model response/message/source is invalid" };
  if (value.message.key !== undefined && typeof value.message.key !== "string") return { issue: "the model response/message/key is invalid" };
  if (value.message.keep !== undefined && typeof value.message.keep !== "boolean") return { issue: "the model response/message/keep is invalid" };
  if (value.message.meta !== undefined && (!isRecord(value.message.meta) || !isJson(value.message.meta))) return { issue: "the model response/message/meta is invalid" };
  if (value.finishReason !== "stop" && value.finishReason !== "tool" && value.finishReason !== "length" && value.finishReason !== "other") {
    return { issue: "the model response/finishReason is invalid" };
  }
  const usageProblem = usageIssue(value.usage, "the model response");
  if (usageProblem) return { issue: usageProblem };
  const complete: Message = {
    id: typeof value.message.id === "string" ? value.message.id : id,
    role: "assistant",
    content: structuredClone(value.message.content),
    source: typeof value.message.source === "string" ? value.message.source : "model",
  };
  if (typeof value.message.key === "string") complete.key = value.message.key;
  if (typeof value.message.keep === "boolean") complete.keep = value.message.keep;
  if (isRecord(value.message.meta)) {
    const meta = toJson(value.message.meta);
    if (meta === undefined || !isRecord(meta)) return { issue: "the model response/message/meta is invalid" };
    complete.meta = meta;
  }
  const result: ModelResult = { message: complete, finishReason: value.finishReason };
  if (isRecord(value.usage)) {
    const candidate: Partial<Usage> = {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
      const count = value.usage[key];
      if (typeof count === "number") Object.defineProperty(candidate, key, { value: count, enumerable: true, writable: true });
    }
    result.usage = candidate;
  }
  return { value: result };
}

export function normalizeToolReturn(value: unknown, call: ToolCall): Normalized<ToolResult> {
  let content: Part[];
  let isError: boolean | undefined;
  let keep: boolean | undefined;
  let meta: Record<string, Json> | undefined;
  if (Array.isArray(value) && value.every(isPart)) content = structuredClone(value);
  else if (isRecord(value) && Object.hasOwn(value, "content")) {
    const extra = ownKeys(value).filter((key) => !["content", "isError", "keep", "meta"].includes(key));
    if (extra.length > 0 || !isPartArray(value.content)) return { issue: "the tool result object is invalid" };
    const optionalIssue = optional(value, "isError", (item) => typeof item === "boolean", "the tool result")
      ?? optional(value, "keep", (item) => typeof item === "boolean", "the tool result")
      ?? optional(value, "meta", (item) => isRecord(item) && isJson(item), "the tool result");
    if (optionalIssue) return { issue: optionalIssue };
    content = structuredClone(value.content);
    if (typeof value.isError === "boolean") isError = value.isError;
    if (typeof value.keep === "boolean") keep = value.keep;
    if (isRecord(value.meta)) {
      const candidate = toJson(value.meta);
      if (candidate !== undefined && isRecord(candidate)) meta = candidate;
    }
  } else {
    if (!isJson(value)) return { issue: "the tool returned a non-JSON value" };
    const json = toJson(value);
    if (json === undefined) return { issue: "the tool returned a non-JSON value" };
    content = [{ type: "json", value: json }];
  }
  const result: ToolResult = { callId: call.id, name: call.name, args: structuredClone(call.args), content };
  if (isError !== undefined) result.isError = isError;
  if (keep !== undefined) result.keep = keep;
  if (meta !== undefined) result.meta = meta;
  return { value: result };
}

export type ControlResult =
  | { kind: "append"; messages: Message[] }
  | { kind: "call"; call: ToolCall; execution?: Record<string, Json> }
  | { kind: "approval"; reason: string }
  | { kind: "result"; result: ToolReturn }
  | { kind: "retry"; target: "model" | "tool"; afterMs?: number }
  | { kind: "complete"; output: Message };
export interface ControlIssue { issue: string }
export function isControlIssue(value: ControlResult | ControlIssue): value is ControlIssue { return "issue" in value; }

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] { return ownKeys(value).filter((key) => !allowed.includes(key)); }
function unexpected(keys: readonly string[]): ControlIssue { return { issue: `a control result cannot declare ${keys.join(", ")}` }; }

export function controlResult(stage: ValueName, value: unknown, callId?: string): ControlResult | ControlIssue | undefined {
  if (!isRecord(value)) return undefined;
  if ((stage === "onPrompt" || stage === "onStep" || stage === "onModelInput") && Object.hasOwn(value, "append")) {
    const extra = extraKeys(value, ["append"]);
    if (extra.length > 0) return unexpected(extra);
    if (!isMessageArray(value.append)) return { issue: "append is not an array of messages" };
    return { kind: "append", messages: structuredClone(value.append) };
  }
  if (stage === "onToolCall" && Object.hasOwn(value, "call")) {
    const extra = extraKeys(value, ["call", "execution"]);
    if (extra.length > 0) return unexpected(extra);
    const issue = toolCallIssue(value.call, "call", callId);
    if (issue || !isToolCall(value.call)) return { issue: issue ?? "call is invalid" };
    if (value.execution !== undefined && !isRecord(value.execution)) return { issue: "execution is not an object" };
    if (isRecord(value.execution)) {
      if (!isJson(value.execution)) return { issue: "execution is not JSON" };
      const execution = toJson(value.execution);
      if (execution !== undefined && isRecord(execution)) return { kind: "call", call: value.call, execution };
    }
    return { kind: "call", call: value.call };
  }
  if (stage === "onToolCall" && Object.hasOwn(value, "approval")) {
    const extra = extraKeys(value, ["approval"]);
    if (extra.length > 0) return unexpected(extra);
    if (!isRecord(value.approval) || typeof value.approval.reason !== "string" || extraKeys(value.approval, ["reason"]).length > 0) return { issue: "approval is invalid" };
    return { kind: "approval", reason: value.approval.reason };
  }
  if (stage === "onToolCall" && Object.hasOwn(value, "result")) {
    const extra = extraKeys(value, ["result"]);
    if (extra.length > 0) return unexpected(extra);
    if (!isJson(value.result)) return { issue: "result is not JSON" };
    return { kind: "result", result: value.result };
  }
  if ((stage === "onModelResult" || stage === "onError") && Object.hasOwn(value, "retry")) {
    const extra = extraKeys(value, ["retry", "target", "afterMs"]);
    if (extra.length > 0) return unexpected(extra);
    if (value.retry !== true || (value.target !== "model" && value.target !== "tool") || (stage === "onModelResult" && value.target !== "model")) return { issue: "retry is invalid" };
    if (value.afterMs !== undefined && (typeof value.afterMs !== "number" || !Number.isFinite(value.afterMs) || value.afterMs < 0)) return { issue: "afterMs is invalid" };
    const retry: Retry = { retry: true, target: value.target };
    if (typeof value.afterMs === "number") retry.afterMs = value.afterMs;
    return { kind: "retry", target: retry.target, ...(retry.afterMs === undefined ? {} : { afterMs: retry.afterMs }) };
  }
  if (stage === "onToolResult" && Object.hasOwn(value, "complete")) {
    const extra = extraKeys(value, ["complete"]);
    if (extra.length > 0) return unexpected(extra);
    const complete: Complete | undefined = isMessage(value.complete) ? { complete: value.complete } : undefined;
    if (!complete || complete.complete.role !== "assistant") return { issue: "complete is not an assistant message" };
    return { kind: "complete", output: complete.complete };
  }
  return undefined;
}

export function appendMessages(existing: readonly Message[], added: readonly Message[]): Message[] {
  const kept: Message[] = [];
  for (const message of added) {
    let last: Message | undefined;
    for (const candidate of [...existing, ...kept]) if (candidate.source === message.source && candidate.key === message.key) last = candidate;
    if (last && last.role === message.role && jsonEqual(last.content, message.content)) continue;
    kept.push(message);
  }
  return kept;
}

export function textOf(parts: readonly Part[]): string { return parts.map((part) => part.type === "text" ? part.text : "").join(""); }
export function inputTextOf(messages: readonly Message[]): string {
  return messages.map((message) => message.content.map((part) => part.type === "text" ? part.text : part.type === "json" ? jsonText(part.value) : "").join("")).join("\n");
}

export function repairToolPairs(conversation: readonly Message[]): Message[] | undefined {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const message of conversation) for (const part of message.content) {
    if (part.type === "tool.call") calls.add(part.callId);
    else if (part.type === "tool.result") results.add(part.callId);
  }
  const unpaired = (part: Part): boolean => (part.type === "tool.call" || part.type === "tool.result") && !(calls.has(part.callId) && results.has(part.callId));
  if (!conversation.some((message) => message.content.some(unpaired))) return undefined;
  const repaired: Message[] = [];
  for (const message of conversation) {
    const content = message.content.filter((part) => !unpaired(part));
    if (content.length === message.content.length) repaired.push(message);
    else if (content.length > 0) repaired.push({ ...message, content });
  }
  return repaired;
}

export function draftModelResponse(value: ModelResponse): ModelResponse { return value; }
export function toolExecution(value: ToolExecution): ToolExecution { return value; }
