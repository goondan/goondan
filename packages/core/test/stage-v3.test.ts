import { describe, expect, it } from "vitest";
import { normalizeModelResponse, normalizeToolReturn, stageValueIssue } from "../src/stage.ts";
import type { ToolCall } from "../src/index.ts";

const call: ToolCall = { id: "c1", name: "lookup", args: { q: "x" } };

describe("v3 value normalization", () => {
  it("fills only the runtime-owned fields of a valid model response", () => {
    const normalized = normalizeModelResponse({
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      finishReason: "stop",
      usage: { input: 1 },
    }, "runtime-id");

    expect(normalized.value).toEqual({
      message: { id: "runtime-id", role: "assistant", source: "model", content: [{ type: "text", text: "ok" }] },
      finishReason: "stop",
      usage: { input: 1 },
    });
  });

  it("rejects malformed model fields instead of replacing them with defaults", () => {
    expect(normalizeModelResponse({ message: { role: "user", content: [] }, finishReason: "stop" }, "id").issue).toMatch(/role/);
    expect(normalizeModelResponse({ message: { role: "assistant", content: "bad" }, finishReason: "stop" }, "id").issue).toMatch(/content/);
    expect(normalizeModelResponse({ message: { role: "assistant", content: [] }, finishReason: "unknown" }, "id").issue).toMatch(/finishReason/);
    expect(normalizeModelResponse({ message: { role: "assistant", content: [] }, finishReason: "stop", usage: { input: -1 } }, "id").issue).toMatch(/usage/);
    expect(normalizeModelResponse({ message: { id: "", role: "assistant", content: [] }, finishReason: "stop" }, "id").issue).toMatch(/id/);
    expect(normalizeModelResponse({ message: { role: "assistant", content: [], source: "" }, finishReason: "stop" }, "id").issue).toMatch(/source/);
    expect(normalizeModelResponse({ message: { role: "assistant", content: [], extra: true }, finishReason: "stop" }, "id").issue).toMatch(/unsupported/);
    expect(normalizeModelResponse({ message: { role: "assistant", content: [] }, finishReason: "stop", extra: true }, "id").issue).toMatch(/unsupported/);
  });

  it("normalizes all three tool return forms with runtime-owned call fields", () => {
    expect(normalizeToolReturn([{ type: "text", text: "parts" }], call).value).toEqual({
      callId: "c1", name: "lookup", args: { q: "x" }, content: [{ type: "text", text: "parts" }],
    });
    expect(normalizeToolReturn({ content: [], isError: true, keep: true, meta: { cached: true } }, call).value).toEqual({
      callId: "c1", name: "lookup", args: { q: "x" }, content: [], isError: true, keep: true, meta: { cached: true },
    });
    expect(normalizeToolReturn({ answer: 42 }, call).value).toEqual({
      callId: "c1", name: "lookup", args: { q: "x" }, content: [{ type: "json", value: { answer: 42 } }],
    });
  });

  it("treats every object with content as a result object", () => {
    expect(normalizeToolReturn({ content: "data" }, call).issue).toMatch(/invalid/);
    expect(normalizeToolReturn({ content: [], extra: true }, call).issue).toMatch(/invalid/);
    expect(normalizeToolReturn({ content: [], meta: { invalid: () => true } }, call).issue).toMatch(/unsupported/);
    expect(normalizeToolReturn({ invalid: () => true }, call).issue).toMatch(/non-JSON/);
    expect(normalizeToolReturn([{ type: "json", value: { content: "data" } }], call).value?.content)
      .toEqual([{ type: "json", value: { content: "data" } }]);
  });

  it("validates transformed error values before the next onError hook", () => {
    expect(stageValueIssue("onError", {
      where: "tool", codes: ["tool_error"], message: "failed", attempt: 1,
    })).toBeUndefined();
    expect(stageValueIssue("onError", { recovered: true })).toMatch(/required|unsupported/);
  });
});
