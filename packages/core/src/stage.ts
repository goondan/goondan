import { isRecord, jsonEqual, jsonText, ownKeys } from "./json.ts";
import { validateDefinition } from "./schema.ts";
import {
  type Json, type Message, type ModelInput, type ModelResult, type Part, type ToolCall,
  type ToolResult, type ValueName,
} from "./types.ts";

/** 메시지 스키마 전체를 확인하는 타입 가드입니다. */
export function isMessage(value: unknown): value is Message {
  return validateDefinition("message", value, []).length === 0;
}

export function isMessageArray(value: unknown): value is Message[] {
  return Array.isArray(value) && value.every(isMessage);
}

export function isPart(value: unknown): value is Part {
  return validateDefinition("part", value, []).length === 0;
}

export function isPartArray(value: unknown): value is Part[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPart);
}

export function isToolCall(value: unknown): value is ToolCall {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && "args" in value;
}

export function isToolResult(value: unknown): value is ToolResult {
  return isRecord(value) && typeof value.callId === "string" && typeof value.name === "string"
    && "args" in value && Array.isArray(value.content);
}

export function isModelInput(value: unknown): value is ModelInput {
  return isRecord(value) && Array.isArray(value.system) && Array.isArray(value.messages)
    && Array.isArray(value.tools) && isRecord(value.options);
}

export function isModelResult(value: unknown): value is ModelResult {
  return isRecord(value) && isMessage(value.message) && typeof value.finishReason === "string";
}

/** Reports why a value is not the `message` the schema defines, or `undefined` when it is one. */
export function messageIssue(value: unknown, label: string): string | undefined {
  const [first] = validateDefinition("message", value, []);
  if (!first) return undefined;
  return `${label}${first.path === "" ? "" : first.path} ${first.message}`;
}

function messagesIssue(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value)) return `${label} is not an array of messages`;
  for (const [index, item] of value.entries()) {
    const issue = messageIssue(item, `${label}/${String(index)}`);
    if (issue) return issue;
  }
  return undefined;
}

function partsIssue(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value)) return `${label} is not an array of parts`;
  for (const [index, item] of value.entries()) {
    const [first] = validateDefinition("part", item, []);
    if (first) return `${label}/${String(index)}${first.path} ${first.message}`;
  }
  return undefined;
}

function optional(value: Record<string, unknown>, key: string, ok: (candidate: unknown) => boolean, label: string): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return ok(candidate) ? undefined : `${label}/${key} has an unsupported value`;
}

function isJsonObject(value: unknown): boolean {
  return isRecord(value);
}

const finishReasons = new Set(["stop", "tool", "length", "other"]);

/**
 * Checks the usage of a model result. Every key may be left out, and a missing key counts as 0, but
 * a key that is present carries a finite JSON number of 0 or more.
 */
function usageIssue(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return `${label}/usage is not an object`;
  for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
    const number = value[key];
    if (number === undefined) continue;
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return `${label}/usage/${key} is not a number of 0 or more`;
  }
  return undefined;
}

function modelInputIssue(value: unknown, label: string): string | undefined {
  if (!isRecord(value)) return `${label} is not a model input`;
  if (!Array.isArray(value.system)) return `${label}/system is not an array of system blocks`;
  for (const [index, block] of value.system.entries()) {
    if (!isRecord(block) || typeof block.text !== "string" || typeof block.source !== "string") return `${label}/system/${String(index)} is not a system block`;
    if (block.cache !== undefined && typeof block.cache !== "boolean") return `${label}/system/${String(index)}/cache is not a boolean`;
  }
  const messages = messagesIssue(value.messages, `${label}/messages`);
  if (messages) return messages;
  if (!Array.isArray(value.tools)) return `${label}/tools is not an array of tool definitions`;
  for (const [index, tool] of value.tools.entries()) {
    if (!isRecord(tool) || typeof tool.name !== "string" || typeof tool.description !== "string" || !isRecord(tool.input)) {
      return `${label}/tools/${String(index)} is not a tool definition`;
    }
  }
  if (!isRecord(value.options)) return `${label}/options is not an object`;
  return undefined;
}

function modelResultIssue(value: unknown, label: string): string | undefined {
  if (!isRecord(value)) return `${label} is not a model result`;
  const message = messageIssue(value.message, `${label}/message`);
  if (message) return message;
  if (!isRecord(value.message) || value.message.role !== "assistant") return `${label}/message/role is not "assistant"`;
  if (typeof value.finishReason !== "string" || !finishReasons.has(value.finishReason)) return `${label}/finishReason is not a finish reason`;
  return usageIssue(value.usage, label);
}

function toolCallIssue(value: unknown, label: string, callId: string | undefined): string | undefined {
  if (!isRecord(value)) return `${label} is not a tool call`;
  if (typeof value.id !== "string") return `${label}/id is not a string`;
  if (typeof value.name !== "string") return `${label}/name is not a string`;
  if (!("args" in value)) return `${label}/args is missing`;
  if (callId !== undefined && value.id !== callId) return `${label}/id does not name the tool call being processed`;
  return undefined;
}

function toolResultIssue(value: unknown, label: string, callId: string | undefined): string | undefined {
  if (!isRecord(value)) return `${label} is not a tool result`;
  if (typeof value.callId !== "string") return `${label}/callId is not a string`;
  if (typeof value.name !== "string") return `${label}/name is not a string`;
  if (!("args" in value)) return `${label}/args is missing`;
  const parts = partsIssue(value.content, `${label}/content`);
  if (parts) return parts;
  if (callId !== undefined && value.callId !== callId) return `${label}/callId does not name the tool call being processed`;
  return optional(value, "isError", (candidate) => typeof candidate === "boolean", label)
    ?? optional(value, "keep", (candidate) => typeof candidate === "boolean", label)
    ?? optional(value, "meta", isJsonObject, label);
}

/**
 * Reports why a value does not satisfy the form of a value processing stage, or `undefined` when it
 * does. `callId` is the identifier of the tool call the `toolCall` and `toolResult` stages process.
 */
export function stageValueIssue(stage: ValueName, value: unknown, callId?: string): string | undefined {
  const label = `the ${stage} value`;
  switch (stage) {
    case "input": return messagesIssue(value, label);
    case "error": return undefined;
    case "conversation": return messagesIssue(value, label);
    case "modelInput": return modelInputIssue(value, label);
    case "modelResult": return modelResultIssue(value, label);
    case "toolCall": return toolCallIssue(value, label, callId);
    case "toolResult": return toolResultIssue(value, label, callId);
    case "output": {
      const issue = messageIssue(value, label);
      if (issue) return issue;
      return isRecord(value) && value.role === "assistant" ? undefined : `${label}/role is not "assistant"`;
    }
  }
}

/** The control result a synchronous hook returned, once its form has been checked. */
export type ControlResult =
  | { kind: "append"; messages: Message[] }
  | { kind: "call"; call: ToolCall; execution?: Record<string, Json> }
  | { kind: "approval"; reason: string }
  | { kind: "result"; result: ToolResult }
  | { kind: "retry"; target: "model" | "tool"; afterMs?: number };

/** A control-shaped result whose form the specification does not allow. */
export interface ControlIssue { issue: string }

export function isControlIssue(value: ControlResult | ControlIssue): value is ControlIssue {
  return "issue" in value;
}

/** The control keys each stage recognises; the same shape elsewhere is an ordinary value. */
const controlKeys: Readonly<Record<ValueName, readonly string[]>> = {
  input: [],
  conversation: ["append"],
  modelInput: ["append"],
  modelResult: ["retry"],
  toolCall: ["call", "approval", "result"],
  toolResult: [],
  output: [],
  error: ["retry"],
};

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return ownKeys(value).filter((key) => !allowed.includes(key));
}

function unexpected(keys: readonly string[]): ControlIssue {
  return { issue: `a control result cannot declare ${keys.map((key) => JSON.stringify(key)).join(", ")}` };
}

/**
 * Classifies a hook result at one stage: `undefined` when it is an ordinary value, a
 * {@link ControlResult} when it is a well formed control result, and a {@link ControlIssue} when it
 * is control shaped but malformed.
 */
export function controlResult(stage: ValueName, value: unknown, callId?: string): ControlResult | ControlIssue | undefined {
  if (!isRecord(value)) return undefined;
  const present = controlKeys[stage].filter((key) => ownKeys(value).includes(key));
  const [key] = present;
  if (key === undefined) return undefined;
  if (present.length > 1) return { issue: `a control result cannot combine ${present.join(" and ")}` };
  if (key === "append") {
    const extra = extraKeys(value, ["append"]);
    if (extra.length > 0) return unexpected(extra);
    const issue = messagesIssue(value.append, "append");
    return issue ? { issue } : { kind: "append", messages: isMessageArray(value.append) ? value.append : [] };
  }
  if (key === "call") {
    const extra = extraKeys(value, ["call", "execution"]);
    if (extra.length > 0) return unexpected(extra);
    const issue = toolCallIssue(value.call, "call", callId);
    if (issue) return { issue };
    if (value.execution !== undefined && !isRecord(value.execution)) return { issue: "execution is not an object" };
    if (!isToolCall(value.call)) return { issue: "call is not a tool call" };
    const execution = value.execution;
    return isRecord(execution) ? { kind: "call", call: value.call, execution: jsonRecord(execution) } : { kind: "call", call: value.call };
  }
  if (key === "approval") {
    const extra = extraKeys(value, ["approval"]);
    if (extra.length > 0) return unexpected(extra);
    const approval = value.approval;
    if (!isRecord(approval) || typeof approval.reason !== "string") return { issue: "approval does not declare a reason" };
    const inner = extraKeys(approval, ["reason"]);
    if (inner.length > 0) return unexpected(inner);
    return { kind: "approval", reason: approval.reason };
  }
  if (key === "result") {
    const extra = extraKeys(value, ["result"]);
    if (extra.length > 0) return unexpected(extra);
    const issue = toolResultIssue(value.result, "result", callId);
    if (issue) return { issue };
    if (!isToolResult(value.result)) return { issue: "result is not a tool result" };
    return { kind: "result", result: value.result };
  }
  const extra = extraKeys(value, ["retry", "target", "afterMs"]);
  if (extra.length > 0) return unexpected(extra);
  if (value.retry !== true) return { issue: "retry is not true" };
  const target = value.target;
  if (target !== "model" && (target !== "tool" || stage === "modelResult")) {
    return { issue: stage === "modelResult" ? 'a modelResult retry can only target "model"' : 'retry does not target "model" or "tool"' };
  }
  const afterMs = value.afterMs;
  if (afterMs !== undefined && (typeof afterMs !== "number" || !Number.isFinite(afterMs) || afterMs < 0)) {
    return { issue: "afterMs is not a number of 0 or more" };
  }
  return typeof afterMs === "number" ? { kind: "retry", target, afterMs } : { kind: "retry", target };
}

/** Narrows an already checked record of JSON values. */
function jsonRecord(value: Record<string, unknown>): Record<string, Json> {
  const result: Record<string, Json> = {};
  for (const key of ownKeys(value)) {
    const child: unknown = value[key];
    if (child === null || typeof child === "string" || typeof child === "boolean" || typeof child === "number") result[key] = child;
    else if (Array.isArray(child) || isRecord(child)) result[key] = jsonClone(child);
  }
  return result;
}

function jsonClone(value: unknown): Json {
  if (Array.isArray(value)) return value.map((item) => jsonClone(item));
  if (isRecord(value)) return jsonRecord(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/**
 * Applies the duplicate check of `append` results and asynchronous hook results: a message is left
 * out when the last message of the target list with the same `source` and `key` has the same `role`
 * and a JSON-equal `content`. The target list grows with every message this call keeps.
 */
export function appendMessages(existing: readonly Message[], added: readonly Message[]): Message[] {
  const kept: Message[] = [];
  for (const message of added) {
    let last: Message | undefined;
    for (const candidate of [...existing, ...kept]) {
      if (candidate.source === message.source && candidate.key === message.key) last = candidate;
    }
    if (last && last.role === message.role && jsonEqual(last.content, message.content)) continue;
    kept.push(message);
  }
  return kept;
}

/** 메시지에서 선언 순서대로 `text` 부분만 이어 붙인 출력 텍스트입니다. */
export function textOf(parts: readonly Part[]): string {
  return parts.map((part) => part.type === "text" ? part.text : "").join("");
}

/** `json` 부분을 포함하고 메시지 사이를 줄바꿈으로 연결한 입력 텍스트입니다. */
export function inputTextOf(messages: readonly Message[]): string {
  return messages.map((message) => message.content.map((part) => part.type === "text" ? part.text : part.type === "json" ? jsonText(part.value) : "").join("")).join("\n");
}

/**
 * Removes the `tool.call` and `tool.result` parts of a stored conversation whose `callId` has no
 * counterpart, and then the messages the removal emptied. A message whose `content` was already an
 * empty array stays. Returns `undefined` when the conversation needs no repair.
 */
export function repairToolPairs(conversation: readonly Message[]): Message[] | undefined {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const message of conversation) {
    for (const part of message.content) {
      if (part.type === "tool.call") calls.add(part.callId);
      else if (part.type === "tool.result") results.add(part.callId);
    }
  }
  const unpaired = (part: Part): boolean =>
    (part.type === "tool.call" || part.type === "tool.result") && !(calls.has(part.callId) && results.has(part.callId));
  if (!conversation.some((message) => message.content.some(unpaired))) return undefined;
  const repaired: Message[] = [];
  for (const message of conversation) {
    const content = message.content.filter((part) => !unpaired(part));
    if (content.length === message.content.length) { repaired.push(message); continue; }
    // Only a message the repair emptied is dropped; one that was already empty stays.
    if (content.length === 0) continue;
    repaired.push({ ...message, content });
  }
  return repaired;
}
