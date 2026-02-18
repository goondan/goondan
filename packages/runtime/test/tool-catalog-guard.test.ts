import { describe, expect, it } from "vitest";
import { ToolExecutor, createMinimalToolContext } from "../src/tools/executor.js";
import { ToolRegistryImpl } from "../src/tools/registry.js";
import { createMessage } from "./helpers.js";

describe("ToolExecutor", () => {
  it("catalog에 없는 tool 호출을 차단한다", async () => {
    const registry = new ToolRegistryImpl();
    registry.register(
      {
        name: "bash__exec",
        description: "run command",
      },
      async () => "ok",
    );

    const executor = new ToolExecutor(registry);

    const message = createMessage({ role: "assistant", content: "call tool", source: { type: "assistant", stepId: "s1" } });

    const context = createMinimalToolContext({
      agentName: "coder",
      instanceKey: "default",
      turnId: "turn-1",
      traceId: "trace-1",
      toolCallId: "call-1",
      message,
      workdir: process.cwd(),
    });

    const denied = await executor.execute({
      toolCallId: "call-1",
      toolName: "bash__exec",
      args: { command: "pwd" },
      catalog: [],
      context,
    });

    expect(denied.status).toBe("error");
    expect(denied.error?.code).toBe("E_TOOL_NOT_IN_CATALOG");

    const allowed = await executor.execute({
      toolCallId: "call-2",
      toolName: "bash__exec",
      args: { command: "pwd" },
      catalog: [{ name: "bash__exec" }],
      context: {
        ...context,
        toolCallId: "call-2",
      },
    });

    expect(allowed.status).toBe("ok");
    expect(allowed.output).toBe("ok");
  });

  it("catalog schema와 맞지 않는 인자를 핸들러 실행 전에 차단한다", async () => {
    const registry = new ToolRegistryImpl();
    let handlerCallCount = 0;

    registry.register(
      {
        name: "bash__exec",
        description: "run command",
      },
      async () => {
        handlerCallCount += 1;
        return "ok";
      },
    );

    const executor = new ToolExecutor(registry);
    const message = createMessage({ role: "assistant", content: "call tool", source: { type: "assistant", stepId: "s1" } });
    const context = createMinimalToolContext({
      agentName: "coder",
      instanceKey: "default",
      turnId: "turn-1",
      traceId: "trace-1",
      toolCallId: "call-1",
      message,
      workdir: process.cwd(),
    });

    const catalog = [
      {
        name: "bash__exec",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
    ];

    const missingRequired = await executor.execute({
      toolCallId: "call-required",
      toolName: "bash__exec",
      args: {},
      catalog,
      context: {
        ...context,
        toolCallId: "call-required",
      },
    });

    expect(missingRequired.status).toBe("error");
    expect(missingRequired.error?.code).toBe("E_TOOL_INVALID_ARGS");
    expect(missingRequired.error?.message).toContain("required property is missing");

    const wrongType = await executor.execute({
      toolCallId: "call-type",
      toolName: "bash__exec",
      args: { command: 123 },
      catalog,
      context: {
        ...context,
        toolCallId: "call-type",
      },
    });

    expect(wrongType.status).toBe("error");
    expect(wrongType.error?.code).toBe("E_TOOL_INVALID_ARGS");
    expect(wrongType.error?.message).toContain("expected string but got integer");

    const unexpectedProperty = await executor.execute({
      toolCallId: "call-extra",
      toolName: "bash__exec",
      args: { command: "pwd", extra: "x" },
      catalog,
      context: {
        ...context,
        toolCallId: "call-extra",
      },
    });

    expect(unexpectedProperty.status).toBe("error");
    expect(unexpectedProperty.error?.code).toBe("E_TOOL_INVALID_ARGS");
    expect(unexpectedProperty.error?.message).toContain("unexpected property");

    const valid = await executor.execute({
      toolCallId: "call-ok",
      toolName: "bash__exec",
      args: { command: "pwd" },
      catalog,
      context: {
        ...context,
        toolCallId: "call-ok",
      },
    });

    expect(valid.status).toBe("ok");
    expect(valid.output).toBe("ok");
    expect(handlerCallCount).toBe(1);
  });
});
