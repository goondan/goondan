import { createGoondan, type Json, type LoadedConfig, type RuntimeEvent, type Tool } from "@goondan/core";
import { describe, expect, it } from "vitest";
import { createAnthropicModel } from "../src/index.ts";
import { isJsonObject } from "../src/json.ts";
import { scriptedFetch, sse, sseResponse } from "./helpers.ts";

const MODEL = "claude-sonnet-5";

function messagesOf(body: Json | undefined): Json[] {
  const messages = isJsonObject(body) ? body.messages : undefined;
  return Array.isArray(messages) ? messages : [];
}

describe("@goondan/models with the core runtime", () => {
  it("runs a tool loop that resends the thinking block and its signature", async () => {
    const thinking = { type: "thinking", thinking: "Need a lookup.", signature: "sig-1" };
    const firstStep = sse(
      { type: "message_start", message: { id: "msg_1", model: MODEL, usage: { input_tokens: 10, cache_read_input_tokens: 2, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Need a lookup." } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Checking." } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"q":1}' } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    );
    const secondStep = sse(
      { type: "message_start", message: { id: "msg_2", model: MODEL, usage: { input_tokens: 20, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    );
    const { fetch, requests } = scriptedFetch([sseResponse(firstStep), sseResponse(secondStep)]);
    const lookup: Tool = {
      name: "lookup",
      description: "Look up a number",
      input: { type: "object", properties: { q: { type: "number" } } },
      execute() {
        return [{ type: "text", text: "forty-two" }];
      },
    };
    const config: LoadedConfig = {
      directory: ".",
      templates: new Map<string, string>(),
      config: { version: 1, name: "models-e2e", agents: { main: { model: "claude", input: "asis", tools: ["lookup"] } } },
    };
    const events: RuntimeEvent[] = [];
    const runtime = createGoondan(config, {
      models: { claude: createAnthropicModel({ model: MODEL, apiKey: "test-key", env: {}, fetch }) },
      tools: { lookup },
      host: { emit(event) { events.push(event); } },
    });

    const run = await runtime.run("What is q?", { sessionId: "e2e" });
    const result = await run.result;

    expect(requests).toHaveLength(2);
    const [, assistant, toolTurn] = messagesOf(requests[1]?.body);
    expect(assistant).toEqual({
      role: "assistant",
      content: [thinking, { type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: 1 } }],
    });
    expect(toolTurn).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "forty-two" }] }] });
    expect(events.filter((event) => event.type === "step.textDelta").map((event) => event.data)).toEqual([
      { modelCall: 1, source: "agent", step: 1, retryCount: 0, attempt: 1, delta: "Checking." },
      { modelCall: 2, source: "agent", step: 2, retryCount: 0, attempt: 1, delta: "Done." },
    ]);
    expect(result.outputs[0]?.content).toEqual([{ type: "text", text: "Done." }]);
    expect(result.usage).toEqual({ input: 30, output: 8, cacheRead: 2, cacheWrite: 0 });
  });
});
