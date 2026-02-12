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
});
