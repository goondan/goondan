import type { Json, Message, Part } from "@goondan/core";
import { invalidRequest, unsupportedContent, type ModelProvider } from "./errors.ts";
import { isRecord } from "./json.ts";
import type { MediaResolver } from "./options.ts";

export type TextLikePart = Extract<Part, { type: "text" | "json" }>;
export type MediaPart = Extract<Part, { type: "media" }>;

/** Text of a `text` part, or the compact `JSON.stringify` text of a `json` part. */
export function partText(part: TextLikePart): string {
  return part.type === "text" ? part.text : JSON.stringify(part.value);
}

/** The `text` and `json` part texts of a message, joined without a separator. */
export function messageText(message: Message): string {
  let text = "";
  for (const part of message.content) {
    if (part.type === "text" || part.type === "json") text += partText(part);
  }
  return text;
}

/** True when `String.prototype.trim()` leaves nothing. */
export function isBlank(text: string): boolean {
  return text.trim() === "";
}

export function systemReminder(text: string): string {
  return `<system-reminder>\n${text}\n</system-reminder>`;
}

/**
 * Keeps a `tool.call` or `tool.result` part only when both the call and the result
 * with its `callId` exist in the list, then drops messages left without parts.
 */
export function repairToolPairs(messages: readonly Message[]): Message[] {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "tool.call") calls.add(part.callId);
      else if (part.type === "tool.result") results.add(part.callId);
    }
  }
  const repaired: Message[] = [];
  for (const message of messages) {
    const content = message.content.filter((part) =>
      (part.type !== "tool.call" && part.type !== "tool.result") || (calls.has(part.callId) && results.has(part.callId)));
    if (content.length === 0) continue;
    repaired.push(content.length === message.content.length ? message : { ...message, content });
  }
  return repaired;
}

/** Splits off the consecutive `system` messages at the start; their non-blank texts follow the system blocks. */
export function splitLeadingSystem(messages: readonly Message[]): { instructions: string[]; rest: Message[] } {
  const instructions: string[] = [];
  let start = 0;
  for (; start < messages.length; start += 1) {
    const message = messages[start];
    if (message === undefined || message.role !== "system") break;
    const text = messageText(message);
    if (!isBlank(text)) instructions.push(text);
  }
  return { instructions, rest: messages.slice(start) };
}

/** Adds `type: object` to a tool input schema that has no `type` key. */
export function objectSchema(schema: Record<string, Json>): Record<string, Json> {
  return Object.hasOwn(schema, "type") ? schema : { type: "object", ...schema };
}

export type MediaSource =
  | { kind: "data"; data: string; mediaType: string }
  | { kind: "url"; url: string; mediaType: string };

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Resolves a `media` part with the host resolver. */
export async function resolveMediaPart(
  provider: ModelProvider,
  part: MediaPart,
  resolver: MediaResolver | undefined,
  signal: AbortSignal,
): Promise<MediaSource> {
  if (resolver === undefined) throw unsupportedContent(provider, `media part ${part.ref} without a resolveMedia function`);
  const resolved: unknown = await resolver({ ref: part.ref, mediaType: part.mediaType }, { signal });
  if (!isRecord(resolved)) throw invalidRequest(provider, `resolveMedia returned no data or url for ${part.ref}`);
  const mediaType = nonEmptyString(resolved.mediaType) ?? part.mediaType;
  if (typeof resolved.data === "string") return { kind: "data", data: resolved.data, mediaType };
  if (typeof resolved.url === "string") return { kind: "url", url: resolved.url, mediaType };
  throw invalidRequest(provider, `resolveMedia returned no data or url for ${part.ref}`);
}

export function isImageType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}

export const PDF_TYPE = "application/pdf";
