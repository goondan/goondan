import type { Json, Message, ModelInput } from "@goondan/core";
import { describe, expect, it } from "vitest";
import { buildAnthropicRequest, createAnthropicModel, isModelError, type ModelError, type ModelErrorCode } from "../src/index.ts";
import { isJsonObject } from "../src/json.ts";
import {
  anthropicTextStream,
  context,
  jsonResponse,
  rejectionOf,
  scriptedFetch,
  sse,
  sseResponse,
  stalledStream,
  thrownBy,
  userInput,
} from "./helpers.ts";

const MODEL = "claude-sonnet-5";

function toolLoopInput(): ModelInput {
  return {
    system: [{ text: "You are a coding agent.", source: "config" }],
    messages: [
      { id: "u1", role: "user", source: "input", content: [{ type: "text", text: "Read package.json" }] },
      { id: "a1", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "old-call", name: "read_file", args: { path: "README.md" } }] },
      { id: "t1", role: "tool", source: "tool", content: [{ type: "tool.result", callId: "old-call", content: [{ type: "text", text: "old result" }] }] },
    ],
    tools: [{ name: "read_file", description: "Read a file", input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
    options: {},
  };
}

function splitResponse(text: string, splitAt: number): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, splitAt)));
      controller.enqueue(encoder.encode(text.slice(splitAt)));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

function expectModelError(error: unknown, code: ModelErrorCode): ModelError {
  if (!isModelError(error)) throw new Error(`expected a ModelError, got ${String(error)}`);
  expect(error.code).toBe(code);
  return error;
}

function field(value: Json | undefined, key: string): Json | undefined {
  return isJsonObject(value) ? value[key] : undefined;
}

function messagesOf(body: Json | undefined): Json[] {
  const messages = field(body, "messages");
  return Array.isArray(messages) ? messages : [];
}

describe("createAnthropicModel (cases from the former CLI provider)", () => {
  it("exposes the provider identifier used by execution events", () => {
    expect(createAnthropicModel({ model: MODEL, apiKey: "test-key", env: {} }).provider).toBe("anthropic");
  });

  it("renders prior tool use and results and assembles split text and tool deltas", async () => {
    const stream = sse(
      { type: "message_start", message: { usage: { input_tokens: 12, cache_read_input_tokens: 3 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I will " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "read it." } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call-1", name: "read_file", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"package.json"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
      { type: "message_stop" },
    );
    const { fetch, requests } = scriptedFetch([splitResponse(stream, 37)]);
    const deltas: string[] = [];
    const result = await createAnthropicModel({ model: MODEL, apiKey: "test-key", env: {}, fetch })
      .generate(toolLoopInput(), context({ onTextDelta: (delta) => deltas.push(delta) }));

    expect(deltas).toEqual(["I will ", "read it."]);
    expect(result.finishReason).toBe("tool");
    expect(result.usage).toEqual({ input: 12, output: 9, cacheRead: 3, cacheWrite: 0 });
    expect(result.message).toMatchObject({ role: "assistant" });
    expect(result.message.id).toBeUndefined();
    expect(result.message.source).toBeUndefined();
    expect(result.message.content).toEqual([
      { type: "text", text: "I will read it." },
      { type: "tool.call", callId: "call-1", name: "read_file", args: { path: "package.json" } },
    ]);
    const body = requests[0]?.body;
    expect(body).toMatchObject({ model: MODEL, stream: true, max_tokens: 64000 });
    expect(field(messagesOf(body)[1], "content")).toEqual([{ type: "tool_use", id: "old-call", name: "read_file", input: { path: "README.md" } }]);
    expect(messagesOf(body)[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "old-call", content: [{ type: "text", text: "old result" }] }] });
  });

  it("calls the Messages API with only the standard headers", async () => {
    const { fetch, requests } = scriptedFetch([splitResponse(sse({ type: "message_stop" }), 5)]);
    await createAnthropicModel({ model: MODEL, apiKey: "test-key", env: {}, fetch }).generate(toolLoopInput(), context());

    expect(requests.map(({ url, headers }) => ({ url, headers }))).toEqual([{
      url: "https://api.anthropic.com/v1/messages",
      headers: { "content-type": "application/json", accept: "text/event-stream", "anthropic-version": "2023-06-01", "x-api-key": "test-key" },
    }]);
  });

  it("uses ANTHROPIC_BASE_URL and allows keyless compatible endpoints", async () => {
    const { fetch, requests } = scriptedFetch([splitResponse(sse({ type: "message_stop" }), 5)]);
    const env = { ANTHROPIC_BASE_URL: "https://proxy.example.test/", ANTHROPIC_API_KEY: "" };
    await createAnthropicModel({ model: MODEL, env, fetch, headers: { "x-team": "demo" } }).generate(toolLoopInput(), context());

    expect(requests[0]?.url).toBe("https://proxy.example.test/v1/messages");
    expect(requests[0]?.headers).toEqual({ "x-team": "demo", "content-type": "application/json", accept: "text/event-stream", "anthropic-version": "2023-06-01" });
  });

  it("requires a credential for the official endpoint", () => {
    const error = expectModelError(thrownBy(() => createAnthropicModel({ model: MODEL, env: { ANTHROPIC_BASE_URL: "", ANTHROPIC_API_KEY: "" } })), "authentication");
    expect(error.message).toContain("ANTHROPIC_API_KEY");
  });

  it("reports HTTP and malformed stream errors with their codes", async () => {
    const http = scriptedFetch([new Response("forbidden", { status: 403 })]);
    const forbidden = expectModelError(await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "test-key", env: {}, fetch: http.fetch }).generate(toolLoopInput(), context())), "permission");
    expect(forbidden.status).toBe(403);
    expect(forbidden.message).toBe("Anthropic HTTP 403: forbidden");

    const malformed = scriptedFetch([new Response("data: {oops}\n\n")]);
    expectModelError(await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "test-key", env: {}, fetch: malformed.fetch }).generate(toolLoopInput(), context())), "invalid_response");
  });

  it("forwards caller cancellation to fetch and throws the abort reason", async () => {
    const { fetch } = scriptedFetch([(init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })]);
    const controller = new AbortController();
    const reason = new Error("user cancelled");
    const pending = createAnthropicModel({ model: MODEL, apiKey: "test-key", env: {}, fetch }).generate(toolLoopInput(), context({ signal: controller.signal }));
    controller.abort(reason);
    expect(await rejectionOf(pending)).toBe(reason);
  });
});

describe("Anthropic configuration", () => {
  it("sends an auth token as a bearer token only when there is no API key", async () => {
    const tokenOnly = scriptedFetch([sseResponse(anthropicTextStream("hi"))]);
    await createAnthropicModel({ model: MODEL, env: { ANTHROPIC_AUTH_TOKEN: "token-1" }, fetch: tokenOnly.fetch }).generate(userInput("hi"), context());
    expect(tokenOnly.requests[0]?.headers.authorization).toBe("Bearer token-1");
    expect(tokenOnly.requests[0]?.headers["x-api-key"]).toBeUndefined();

    const both = scriptedFetch([sseResponse(anthropicTextStream("hi"))]);
    await createAnthropicModel({ model: MODEL, apiKey: "key-1", authToken: "token-1", env: {}, fetch: both.fetch }).generate(userInput("hi"), context());
    expect(both.requests[0]?.headers["x-api-key"]).toBe("key-1");
    expect(both.requests[0]?.headers.authorization).toBeUndefined();
  });

  it("replaces default headers by case-insensitive name and adds beta headers", async () => {
    const { fetch, requests } = scriptedFetch([sseResponse(anthropicTextStream("hi"))]);
    await createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch, headers: { "Anthropic-Version": "2099-01-01", "anthropic-beta": "feature-2026-01-01" } })
      .generate(userInput("hi"), context());
    expect(requests[0]?.headers).toEqual({
      "content-type": "application/json",
      accept: "text/event-stream",
      "Anthropic-Version": "2099-01-01",
      "x-api-key": "k",
      "anthropic-beta": "feature-2026-01-01",
    });
  });

  it("rejects malformed settings with invalid_request", () => {
    expectModelError(thrownBy(() => createAnthropicModel({ model: "", apiKey: "k", env: {} })), "invalid_request");
    expectModelError(thrownBy(() => createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, maxRetries: -1 })), "invalid_request");
    expectModelError(thrownBy(() => createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, maxRetries: 1.5 })), "invalid_request");
    expectModelError(thrownBy(() => createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, idleTimeoutMs: 0 })), "invalid_request");
    expectModelError(thrownBy(() => createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, baseUrl: "" })), "invalid_request");
  });

  it("turns automatic caching on by default only for the official URL", async () => {
    const official = await buildAnthropicRequest(userInput("hi"), { model: MODEL, baseUrl: "https://api.anthropic.com//", env: {} });
    expect(official.cache_control).toEqual({ type: "ephemeral" });
    const gateway = await buildAnthropicRequest(userInput("hi"), { model: MODEL, env: { ANTHROPIC_BASE_URL: "http://localhost:8080" } });
    expect(gateway.cache_control).toBeUndefined();
    const forced = await buildAnthropicRequest(userInput("hi"), { model: MODEL, env: { ANTHROPIC_BASE_URL: "http://localhost:8080" }, autoCache: true, cacheTtl: "1h" });
    expect(forced.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});

describe("Anthropic request mapping", () => {
  it("merges input options over configured options and drops null values", async () => {
    const body = await buildAnthropicRequest(
      userInput("hi", { temperature: null, anthropic: { metadata: null, output_config: { effort: "low" } } }),
      { model: MODEL, env: {}, options: { maxTokens: 10, temperature: 0.5, anthropic: { thinking: { type: "adaptive" }, metadata: { user_id: "u" } } } },
    );
    expect(body).toMatchObject({ max_tokens: 10, thinking: { type: "adaptive" }, output_config: { effort: "low" } });
    expect(body.temperature).toBeUndefined();
    expect(body.metadata).toBeUndefined();
  });

  it("merges options.anthropic last and ignores the other provider and unknown keys", async () => {
    const body = await buildAnthropicRequest(userInput("hi", { maxTokens: 10, anthropic: { max_tokens: 20 }, openai: { seed: 1 }, custom: true }), { model: MODEL, env: {} });
    expect(body.max_tokens).toBe(20);
    expect(body.seed).toBeUndefined();
    expect(body.custom).toBeUndefined();
  });

  it("maps every toolChoice value", async () => {
    const choices: Array<[Json, Json]> = [["auto", { type: "auto" }], ["none", { type: "none" }], ["required", { type: "any" }], [{ name: "lookup" }, { type: "tool", name: "lookup" }]];
    for (const [choice, expected] of choices) {
      const body = await buildAnthropicRequest(userInput("hi", { toolChoice: choice }), { model: MODEL, env: {} });
      expect(body.tool_choice).toEqual(expected);
    }
  });

  it("rejects malformed common options and reserved provider fields", async () => {
    const invalid: Array<Record<string, Json>> = [
      { maxTokens: 1.5 },
      { temperature: "0" },
      { stop: ["END", 1] },
      { toolChoice: "any" },
      { anthropic: "raw" },
      { anthropic: { system: "x" } },
      { anthropic: { messages: [] } },
    ];
    for (const options of invalid) {
      expectModelError(await rejectionOf(buildAnthropicRequest(userInput("hi", options), { model: MODEL, env: {} })), "invalid_request");
    }
  });

  it("replaces characters outside [A-Za-z0-9_-] in tool ids, one per code point", async () => {
    const input: ModelInput = {
      system: [],
      messages: [
        { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "call.1/😀", name: "lookup", args: null }] },
        { id: "t", role: "tool", source: "tool", content: [{ type: "tool.result", callId: "call.1/😀", content: [] }] },
      ],
      tools: [],
      options: {},
    };
    const body = await buildAnthropicRequest(input, { model: MODEL, env: {} });
    expect(messagesOf(body)).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "call_1__", name: "lookup", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1__" }] },
    ]);
  });

  it("requires tool call args to be an object or null", async () => {
    const input: ModelInput = {
      system: [],
      messages: [
        { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c", name: "lookup", args: [1] }] },
        { id: "t", role: "tool", source: "tool", content: [{ type: "tool.result", callId: "c", content: [] }] },
      ],
      tools: [],
      options: {},
    };
    expectModelError(await rejectionOf(buildAnthropicRequest(input, { model: MODEL, env: {} })), "invalid_request");
  });

  it("resends recorded blocks without whitespace-only text blocks", async () => {
    const recorded: Json[] = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "\n" },
      { type: "tool_use", id: "c1", name: "lookup", input: { q: 1 } },
    ];
    const assistant: Message = {
      id: "a",
      role: "assistant",
      source: "model",
      content: [{ type: "text", text: "\n" }, { type: "tool.call", callId: "c1", name: "lookup", args: { q: 1 } }],
      meta: { anthropic: { content: recorded } },
    };
    const input: ModelInput = {
      system: [],
      messages: [assistant, { id: "t", role: "tool", source: "tool", content: [{ type: "tool.result", callId: "c1", content: [{ type: "text", text: "1" }] }] }],
      tools: [],
      options: {},
    };
    const body = await buildAnthropicRequest(input, { model: MODEL, env: {} });
    expect(field(messagesOf(body)[0], "content")).toEqual([recorded[0], recorded[2]]);
  });

  it("resolves media parts into image and document blocks and passes the signal", async () => {
    const seen: Array<{ ref: string; mediaType: string; aborted: boolean }> = [];
    const signal = new AbortController().signal;
    const input: ModelInput = {
      system: [],
      messages: [{
        id: "u",
        role: "user",
        source: "input",
        content: [{ type: "media", ref: "photo", mediaType: "image/*" }, { type: "media", ref: "report", mediaType: "application/pdf" }, { type: "text", text: "Compare them" }],
      }],
      tools: [],
      options: {},
    };
    const body = await buildAnthropicRequest(input, {
      model: MODEL,
      env: {},
      resolveMedia(part, ctx) {
        seen.push({ ...part, aborted: ctx.signal.aborted });
        expect(ctx.signal).toBe(signal);
        return part.ref === "photo" ? { data: "iVBORw0KGgo=", mediaType: "image/png" } : { url: "https://files.example.com/report.pdf" };
      },
    }, signal);
    expect(seen).toEqual([{ ref: "photo", mediaType: "image/*", aborted: false }, { ref: "report", mediaType: "application/pdf", aborted: false }]);
    expect(field(messagesOf(body)[0], "content")).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      { type: "document", source: { type: "url", url: "https://files.example.com/report.pdf" } },
      { type: "text", text: "Compare them" },
    ]);
  });

  it("reports parts it cannot send as unsupported_content", async () => {
    const cases: Message[] = [
      { id: "u", role: "user", source: "input", content: [{ type: "media", ref: "photo", mediaType: "image/png" }] },
      { id: "u", role: "user", source: "input", content: [{ type: "image", url: "ftp://example.com/a.png", mediaType: "image/png" }] },
      { id: "a", role: "assistant", source: "model", content: [{ type: "image", url: "https://example.com/a.png", mediaType: "image/png" }] },
    ];
    for (const message of cases) {
      const input: ModelInput = { system: [], messages: [message], tools: [], options: {} };
      expectModelError(await rejectionOf(buildAnthropicRequest(input, { model: MODEL, env: {} })), "unsupported_content");
    }
    const audio: ModelInput = { system: [], messages: [{ id: "u", role: "user", source: "input", content: [{ type: "media", ref: "clip", mediaType: "audio/wav" }] }], tools: [], options: {} };
    expectModelError(await rejectionOf(buildAnthropicRequest(audio, { model: MODEL, env: {}, resolveMedia: () => ({ data: "AAAA" }) })), "unsupported_content");
  });
});

describe("Anthropic retries", () => {
  it("retries an overloaded response and honours retry-after", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, { "retry-after": "0" }),
      sseResponse(anthropicTextStream("hello")),
    ]);
    const result = await createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context());
    expect(requests).toHaveLength(2);
    expect(result.message.content).toEqual([{ type: "text", text: "hello" }]);
    expect(requests[1]?.body).toEqual(requests[0]?.body);
  });

  it("does not retry a rejected request and records its request id", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(400, { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 1 > 0" } }, { "request-id": "req_123" }),
    ]);
    const error = expectModelError(await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context())), "context_length");
    expect(requests).toHaveLength(1);
    expect(error).toMatchObject({ status: 400, requestId: "req_123", retryable: false });
  });

  it("retries an in-stream error that arrives before any text", async () => {
    const failing = sse({ type: "message_start", message: { id: "m", model: MODEL, usage: {} } }, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    const { fetch, requests } = scriptedFetch([sseResponse(failing), sseResponse(anthropicTextStream("ok"))]);
    const deltas: string[] = [];
    const result = await createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context({ onTextDelta: (delta) => deltas.push(delta) }));
    expect(requests).toHaveLength(2);
    expect(deltas).toEqual(["ok"]);
    expect(result.usage).toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
  });

  it("does not retry after a text chunk has reached the caller", async () => {
    const failing = sse(
      { type: "message_start", message: { id: "m", model: MODEL, usage: {} } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    );
    const { fetch, requests } = scriptedFetch([sseResponse(failing), sseResponse(anthropicTextStream("unused"))]);
    const deltas: string[] = [];
    const error = await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context({ onTextDelta: (delta) => deltas.push(delta) })));
    expectModelError(error, "overloaded");
    expect(requests).toHaveLength(1);
    expect(deltas).toEqual(["Hi"]);
  });

  it("reports a stream that ends without message_stop as network after maxRetries + 1 attempts", async () => {
    const truncated = sse({ type: "message_start", message: { id: "m", model: MODEL, usage: {} } });
    const { fetch, requests } = scriptedFetch([sseResponse(truncated), sseResponse(truncated)]);
    expectModelError(await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch, maxRetries: 1 }).generate(userInput("hi"), context())), "network");
    expect(requests).toHaveLength(2);
  });

  it("wraps connection failures as network errors with the original cause", async () => {
    const cause = new TypeError("fetch failed");
    const { fetch, requests } = scriptedFetch([() => Promise.reject(cause)]);
    const error = expectModelError(await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch, maxRetries: 0 }).generate(userInput("hi"), context())), "network");
    expect(error.cause).toBe(cause);
    expect(requests).toHaveLength(1);
  });
});

describe("Anthropic cancellation and idle timeout", () => {
  it("stops reading mid-stream and throws the abort reason without retrying", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const partial = sse(
      { type: "message_start", message: { id: "m", model: MODEL, usage: {} } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
    );
    const { fetch, requests } = scriptedFetch([new Response(stalledStream(partial))]);
    const pending = createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch })
      .generate(userInput("hi"), context({ signal: controller.signal, onTextDelta: () => controller.abort(reason) }));
    expect(await rejectionOf(pending)).toBe(reason);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal?.aborted).toBe(true);
  });

  it("cancels the wait before a retry", async () => {
    const controller = new AbortController();
    const reason = new Error("stop waiting");
    const { fetch, requests } = scriptedFetch([() => {
      setTimeout(() => controller.abort(reason), 10);
      return jsonResponse(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, { "retry-after": "30" });
    }]);
    const started = Date.now();
    const error = await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context({ signal: controller.signal })));
    expect(error).toBe(reason);
    expect(requests).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("throws an AbortError DOMException when the abort reason is not an Error", async () => {
    const controller = new AbortController();
    const { fetch } = scriptedFetch([() => new Promise<Response>(() => undefined)]);
    const pending = createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context({ signal: controller.signal }));
    controller.abort("stop");
    const error = await rejectionOf(pending);
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: "AbortError" });
    expect(isModelError(error)).toBe(false);
  });

  it("times out while waiting for response headers", async () => {
    const { fetch, requests } = scriptedFetch([() => new Promise<Response>(() => undefined)]);
    const error = expectModelError(await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch, idleTimeoutMs: 30, maxRetries: 0 }).generate(userInput("hi"), context())), "timeout");
    expect(error.retryable).toBe(true);
    expect(requests[0]?.signal?.aborted).toBe(true);
  });

  it("times out while waiting for the next body chunk", async () => {
    const { fetch } = scriptedFetch([new Response(stalledStream(sse({ type: "message_start", message: { id: "m", model: MODEL, usage: {} } })))]);
    expectModelError(await rejectionOf(createAnthropicModel({ model: MODEL, apiKey: "k", env: {}, fetch, idleTimeoutMs: 30, maxRetries: 0 }).generate(userInput("hi"), context())), "timeout");
  });
});

 it("returns at message_stop while the transport remains open", async () => {
  const { fetch } = scriptedFetch([new Response(stalledStream(anthropicTextStream("done")))]);
  const model = createAnthropicModel({ model: MODEL, apiKey: "test-key", env: {}, maxRetries: 0, idleTimeoutMs: 100, fetch });
  const result = await model.generate(userInput("hi"), context());
  expect(result.message.content).toEqual([{ type: "text", text: "done" }]);
});
