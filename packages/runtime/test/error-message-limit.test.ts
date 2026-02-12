import { describe, expect, it } from "vitest";
import { ToolExecutor, truncateErrorMessage, createMinimalToolContext } from "../src/tools/executor.js";
import { ToolRegistryImpl } from "../src/tools/registry.js";
import { createMessage } from "./helpers.js";

describe("truncateErrorMessage", () => {
  it("limit 이하의 메시지는 그대로 반환한다", () => {
    expect(truncateErrorMessage("short", 100)).toBe("short");
  });

  it("limit 초과 메시지를 잘라내고 suffix를 붙인다", () => {
    const message = "a".repeat(200);
    const result = truncateErrorMessage(message, 50);

    expect(result.length).toBe(50);
    expect(result.endsWith("... (truncated)")).toBe(true);
  });

  it("limit이 suffix 길이보다 작으면 단순 slice한다", () => {
    const result = truncateErrorMessage("abcdefghij", 5);
    expect(result).toBe("abcde");
    expect(result.length).toBe(5);
  });

  it("정확히 limit과 같은 길이의 메시지는 그대로 반환한다", () => {
    const message = "a".repeat(50);
    expect(truncateErrorMessage(message, 50)).toBe(message);
  });
});

describe("ToolExecutor errorMessageLimit", () => {
  function buildExecutor(handler: () => Promise<unknown>): ToolExecutor {
    const registry = new ToolRegistryImpl();
    registry.register({ name: "test__tool", description: "test" }, handler);
    return new ToolExecutor(registry);
  }

  function buildContext() {
    const message = createMessage({
      role: "assistant",
      content: "call tool",
      source: { type: "assistant", stepId: "s1" },
    });

    return createMinimalToolContext({
      agentName: "tester",
      instanceKey: "default",
      turnId: "turn-1",
      traceId: "trace-1",
      toolCallId: "call-1",
      message,
      workdir: process.cwd(),
    });
  }

  it("tool 에러 메시지를 기본 1000자로 잘라낸다", async () => {
    const longMessage = "x".repeat(2000);
    const executor = buildExecutor(async () => {
      throw new Error(longMessage);
    });

    const result = await executor.execute({
      toolCallId: "call-1",
      toolName: "test__tool",
      args: {},
      catalog: [{ name: "test__tool" }],
      context: buildContext(),
    });

    expect(result.status).toBe("error");
    if (result.status === "error" && result.error) {
      expect(result.error.message.length).toBeLessThanOrEqual(1000);
      expect(result.error.message.endsWith("... (truncated)")).toBe(true);
    }
  });

  it("errorMessageLimit 옵션으로 잘라내기 길이를 지정한다", async () => {
    const longMessage = "y".repeat(500);
    const executor = buildExecutor(async () => {
      throw new Error(longMessage);
    });

    const result = await executor.execute({
      toolCallId: "call-1",
      toolName: "test__tool",
      args: {},
      catalog: [{ name: "test__tool" }],
      context: buildContext(),
      errorMessageLimit: 100,
    });

    expect(result.status).toBe("error");
    if (result.status === "error" && result.error) {
      expect(result.error.message.length).toBeLessThanOrEqual(100);
    }
  });

  it("suggestion과 helpUrl 필드를 에러에서 추출한다", async () => {
    const executor = buildExecutor(async () => {
      const error = new Error("test error");
      Object.assign(error, {
        code: "E_TEST",
        suggestion: "Try again",
        helpUrl: "https://example.com/help",
      });
      throw error;
    });

    const result = await executor.execute({
      toolCallId: "call-1",
      toolName: "test__tool",
      args: {},
      catalog: [{ name: "test__tool" }],
      context: buildContext(),
    });

    expect(result.status).toBe("error");
    if (result.status === "error" && result.error) {
      expect(result.error.code).toBe("E_TEST");
      expect(result.error.suggestion).toBe("Try again");
      expect(result.error.helpUrl).toBe("https://example.com/help");
    }
  });

  it("non-Error throw 시 Unknown tool execution error를 반환한다", async () => {
    const executor = buildExecutor(async () => {
      throw "string error";
    });

    const result = await executor.execute({
      toolCallId: "call-1",
      toolName: "test__tool",
      args: {},
      catalog: [{ name: "test__tool" }],
      context: buildContext(),
    });

    expect(result.status).toBe("error");
    if (result.status === "error" && result.error) {
      expect(result.error.message).toBe("Unknown tool execution error");
    }
  });
});
