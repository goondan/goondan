import type { Json, Message, ModelInput } from "@goondan/core";
import { describe, expect, it } from "vitest";
import { buildOpenAIChatRequest, createOpenAIChatModel, isModelError, type ModelError, type ModelErrorCode } from "../src/index.ts";
import { context, jsonResponse, openAITextStream, rejectionOf, scriptedFetch, sse, sseResponse, thrownBy, userInput } from "./helpers.ts";

const MODEL = "gpt-test";

function expectModelError(error: unknown, code: ModelErrorCode): ModelError {
  if (!isModelError(error)) throw new Error(`expected a ModelError, got ${String(error)}`);
  expect(error.code).toBe(code);
  return error;
}

function inputOf(messages: Message[]): ModelInput {
  return { system: [], messages, tools: [], options: {} };
}

describe("OpenAI configuration", () => {
  it("posts to {baseUrl}/chat/completions with a bearer API key", async () => {
    const { fetch, requests } = scriptedFetch([sseResponse(openAITextStream("hi"))]);
    await createOpenAIChatModel({ model: MODEL, apiKey: "sk-test", env: {}, fetch }).generate(userInput("hi"), context());
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(requests[0]?.headers).toEqual({ "content-type": "application/json", accept: "text/event-stream", authorization: "Bearer sk-test" });
  });

  it("allows a keyless local server and reads OPENAI_BASE_URL and OPENAI_API_KEY", async () => {
    const local = scriptedFetch([sseResponse(openAITextStream("hi"))]);
    await createOpenAIChatModel({ model: "llama3.2", baseUrl: "http://localhost:11434/v1/", env: {}, fetch: local.fetch }).generate(userInput("hi"), context());
    expect(local.requests[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(local.requests[0]?.headers.authorization).toBeUndefined();

    const fromEnv = scriptedFetch([sseResponse(openAITextStream("hi"))]);
    await createOpenAIChatModel({ model: MODEL, env: { OPENAI_BASE_URL: "https://gateway.example.com/v1", OPENAI_API_KEY: "sk-env" }, fetch: fromEnv.fetch }).generate(userInput("hi"), context());
    expect(fromEnv.requests[0]?.url).toBe("https://gateway.example.com/v1/chat/completions");
    expect(fromEnv.requests[0]?.headers.authorization).toBe("Bearer sk-env");
  });

  it("requires an API key for the official endpoint", () => {
    expectModelError(thrownBy(() => createOpenAIChatModel({ model: MODEL, env: { OPENAI_API_KEY: "" } })), "authentication");
  });

  it("chooses the max tokens field by base URL unless it is configured", async () => {
    const input = userInput("hi", { maxTokens: 50 });
    expect((await buildOpenAIChatRequest(input, { model: MODEL, env: {} })).max_completion_tokens).toBe(50);
    expect((await buildOpenAIChatRequest(input, { model: MODEL, baseUrl: "http://localhost:11434/v1", env: {} })).max_tokens).toBe(50);
    const custom = await buildOpenAIChatRequest(input, { model: MODEL, env: {}, maxTokensField: "max_tokens" });
    expect(custom.max_tokens).toBe(50);
    expect(custom.max_completion_tokens).toBeUndefined();
  });

  it("requests the usage chunk unless streamUsage is false", async () => {
    expect((await buildOpenAIChatRequest(userInput("hi"), { model: MODEL, env: {} })).stream_options).toEqual({ include_usage: true });
    expect((await buildOpenAIChatRequest(userInput("hi"), { model: MODEL, env: {}, streamUsage: false })).stream_options).toBeUndefined();
  });

  it("rejects reserved provider fields", async () => {
    expectModelError(await rejectionOf(buildOpenAIChatRequest(userInput("hi", { openai: { messages: [] } }), { model: MODEL, env: {} })), "invalid_request");
    expectModelError(await rejectionOf(buildOpenAIChatRequest(userInput("hi", { openai: { stream: false } }), { model: MODEL, env: {} })), "invalid_request");
  });
});

describe("OpenAI request mapping", () => {
  it("sends mid-conversation system messages with the configured system role", async () => {
    const body = await buildOpenAIChatRequest(inputOf([
      { id: "u", role: "user", source: "input", content: [{ type: "text", text: "hi" }] },
      { id: "s", role: "system", source: "hook", content: [{ type: "text", text: "be brief" }] },
    ]), { model: MODEL, env: {}, systemRole: "developer" });
    expect(body.messages).toEqual([{ role: "user", content: "hi" }, { role: "developer", content: "be brief" }]);
  });

  it("resolves media into image_url and file items", async () => {
    const body = await buildOpenAIChatRequest(inputOf([{
      id: "u",
      role: "user",
      source: "input",
      content: [{ type: "media", ref: "photo", mediaType: "image/png" }, { type: "media", ref: "report", mediaType: "application/pdf" }],
    }]), { model: MODEL, env: {}, resolveMedia: () => ({ data: "AAAA" }) });
    expect(body.messages).toEqual([{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        { type: "file", file: { file_data: "data:application/pdf;base64,AAAA" } },
      ],
    }]);
  });

  it("moves tool result images into a user message after the tool messages", async () => {
    const body = await buildOpenAIChatRequest(inputOf([
      { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "screenshot", args: null }] },
      { id: "t", role: "tool", source: "tool", content: [{ type: "tool.result", callId: "c1", content: [{ type: "media", ref: "shot", mediaType: "image/png" }] }] },
    ]), { model: MODEL, env: {}, resolveMedia: () => ({ url: "https://files.example.com/shot.png" }) });
    expect(body.messages).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "screenshot", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "(image output attached in the next user message)" },
      { role: "user", content: [{ type: "text", text: "Images returned by tool calls: c1" }, { type: "image_url", image_url: { url: "https://files.example.com/shot.png" } }] },
    ]);
  });

  it("reports parts it cannot send as unsupported_content", async () => {
    const resolveMedia = (part: { ref: string }): { url: string; mediaType: string } | { data: string; mediaType: string } =>
      part.ref === "url-pdf" ? { url: "https://files.example.com/a.pdf", mediaType: "application/pdf" } : { data: "AAAA", mediaType: "application/pdf" };
    const cases: Message[][] = [
      [{ id: "u", role: "user", source: "input", content: [{ type: "media", ref: "url-pdf", mediaType: "application/pdf" }] }],
      [
        { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "read", args: {} }] },
        { id: "t", role: "tool", source: "tool", content: [{ type: "tool.result", callId: "c1", content: [{ type: "media", ref: "pdf", mediaType: "application/pdf" }] }] },
      ],
      [
        { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "read", args: {} }] },
        { id: "u", role: "user", source: "input", content: [{ type: "tool.result", callId: "c1", content: [] }] },
      ],
      [{ id: "a", role: "assistant", source: "model", content: [{ type: "image", url: "https://example.com/a.png", mediaType: "image/png" }] }],
    ];
    for (const messages of cases) {
      expectModelError(await rejectionOf(buildOpenAIChatRequest(inputOf(messages), { model: MODEL, env: {}, resolveMedia })), "unsupported_content");
    }
    const noResolver = inputOf([{ id: "u", role: "user", source: "input", content: [{ type: "media", ref: "photo", mediaType: "image/png" }] }]);
    expectModelError(await rejectionOf(buildOpenAIChatRequest(noResolver, { model: MODEL, env: {} })), "unsupported_content");
  });
});

describe("OpenAI streaming and errors", () => {
  it("stops reading at [DONE]", async () => {
    const { fetch } = scriptedFetch([sseResponse(`${openAITextStream("hi")}data: {not json\n\n`)]);
    const result = await createOpenAIChatModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context());
    expect(result).toMatchObject({ finishReason: "stop", message: { content: [{ type: "text", text: "hi" }], meta: { openai: { id: "chatcmpl-test", model: "gpt-test", finishReason: "stop" } } } });
    expect(result.message.id).toBeUndefined();
    expect(result.message.source).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("gives a generated call id to a tool call the stream did not name", async () => {
    const stream = `${sse({ id: "x", model: MODEL, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "lookup", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}data: [DONE]\n\n`;
    const { fetch } = scriptedFetch([sseResponse(stream)]);
    const result = await createOpenAIChatModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context());
    const [call] = result.message.content;
    expect(call).toMatchObject({ type: "tool.call", name: "lookup", args: {} });
    expect(call?.type === "tool.call" ? call.callId : "").toMatch(/^call_0_[0-9a-f]{8}$/);
  });

  it("turns an error chunk after a heartbeat comment into a ModelError", async () => {
    const stream = `: OPENROUTER PROCESSING\n\n${sse({ id: "gen-1", object: "chat.completion.chunk", error: { code: 502, message: "Provider disconnected" }, choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }] })}`;
    const { fetch, requests } = scriptedFetch([sseResponse(stream)]);
    expectModelError(await rejectionOf(createOpenAIChatModel({ model: MODEL, apiKey: "k", env: {}, fetch, maxRetries: 0 }).generate(userInput("hi"), context())), "server_error");
    expect(requests).toHaveLength(1);
  });

  it("does not retry an exhausted quota", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }),
      sseResponse(openAITextStream("unused")),
    ]);
    const error = expectModelError(await rejectionOf(createOpenAIChatModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context())), "quota");
    expect(error.status).toBe(429);
    expect(requests).toHaveLength(1);
  });

  it("retries a rate limit after the retry-after-ms wait", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(429, { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } }, { "retry-after-ms": "5", "x-request-id": "req_9" }),
      sseResponse(openAITextStream("ok")),
    ]);
    const result = await createOpenAIChatModel({ model: MODEL, apiKey: "k", env: {}, fetch }).generate(userInput("hi"), context());
    expect(requests).toHaveLength(2);
    expect(result.message.content).toEqual([{ type: "text", text: "ok" }]);
  });

  it("reports malformed tool arguments as invalid_response unless the output was cut off", async () => {
    const chunk = (finishReason: string): string => `${sse({ id: "x", model: MODEL, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c", function: { name: "lookup", arguments: "{\"q\":" } }] }, finish_reason: finishReason }] })}data: [DONE]\n\n`;
    const broken = scriptedFetch([sseResponse(chunk("tool_calls"))]);
    expectModelError(await rejectionOf(createOpenAIChatModel({ model: MODEL, apiKey: "k", env: {}, fetch: broken.fetch }).generate(userInput("hi"), context())), "invalid_response");
    const cut = scriptedFetch([sseResponse(chunk("length"))]);
    const result = await createOpenAIChatModel({ model: MODEL, apiKey: "k", env: {}, fetch: cut.fetch }).generate(userInput("hi"), context());
    expect(result.finishReason).toBe("length");
    const content: Json = result.message.content.length;
    expect(content).toBe(0);
  });
});
