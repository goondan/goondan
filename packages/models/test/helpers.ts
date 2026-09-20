import type { Json, ModelInput } from "@goondan/core";
import { isRecord, toJson } from "../src/json.ts";
import type { FetchFunction } from "../src/options.ts";

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Json;
  signal: AbortSignal | undefined;
}

export type Reply = Response | ((init: RequestInit) => Response | Promise<Response>);

function recordHeaders(headers: RequestInit["headers"]): Record<string, string> {
  if (isRecord(headers)) {
    const copy: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value === "string") copy[name] = value;
    }
    return copy;
  }
  return Object.fromEntries(new Headers(headers).entries());
}

/** A fetch stub that answers each call with the next reply and records the request. */
export function scriptedFetch(replies: Reply[]): { fetch: FetchFunction; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const queue = [...replies];
  const fetch: FetchFunction = async (url, init) => {
    requests.push({
      url,
      headers: recordHeaders(init.headers),
      body: typeof init.body === "string" ? toJson(JSON.parse(init.body)) : null,
      signal: init.signal ?? undefined,
    });
    const reply = queue.shift();
    if (reply === undefined) throw new Error(`unexpected request ${requests.length}`);
    return typeof reply === "function" ? reply(init) : reply;
  };
  return { fetch, requests };
}

export function bytesStream(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
      controller.close();
    },
  });
}

/** A stream that sends the given text and then stays open until it is cancelled. */
export function stalledStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
    },
  });
}

export function sseResponse(text: string, options: { chunkSize?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(bytesStream(text, options.chunkSize), { status: 200, headers: { "content-type": "text/event-stream", ...options.headers } });
}

export function jsonResponse(status: number, body: Json, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function sse(...events: Json[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

export function anthropicTextStream(text: string, usage: Json = { input_tokens: 1, output_tokens: 1 }): string {
  return sse(
    { type: "message_start", message: { id: "msg_test", model: "claude-test", usage } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  );
}

export function openAITextStream(text: string): string {
  return `${sse(
    { id: "chatcmpl-test", model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { id: "chatcmpl-test", model: "gpt-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  )}data: [DONE]\n\n`;
}

export function context(options: { signal?: AbortSignal; onTextDelta?: (delta: string) => void } = {}) {
  return {
    agent: "main",
    sessionId: "c",
    turnId: "t",
    step: 1,
    signal: options.signal ?? new AbortController().signal,
    onTextDelta: options.onTextDelta ?? ((): void => undefined),
  };
}

export function userInput(text: string, options: Record<string, Json> = {}): ModelInput {
  return { system: [], messages: [{ id: "u1", role: "user", source: "input", content: [{ type: "text", text }] }], tools: [], options };
}

/** Resolves with the error a promise rejects with; fails when it resolves. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

/** Returns the error a function throws; fails when it returns. */
export function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected the function to throw");
}
