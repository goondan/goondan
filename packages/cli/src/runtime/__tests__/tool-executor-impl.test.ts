/**
 * ToolExecutorImpl 테스트
 */

import { describe, it, expect } from "vitest";
import { createToolExecutorImpl } from "../tool-executor-impl.js";
import type { Step, ToolCall, ToolCatalogItem } from "@goondan/core/runtime";
import type { ToolSpec, ToolExport } from "@goondan/core";

describe("ToolExecutorImpl", () => {
  const executor = createToolExecutorImpl({
    bundleRootDir: "/test/project",
  });

  /**
   * 최소한의 Step mock
   */
  function createMockStep(
    toolCatalogItems: Array<{
      name: string;
      toolEntry?: string;
    }>
  ): Step {
    const toolCatalog: ToolCatalogItem[] = toolCatalogItems.map((item) => {
      const toolExport: ToolExport = {
        name: item.name,
        description: "Test",
        parameters: { type: "object" },
      };

      const catalogItem: ToolCatalogItem = {
        name: item.name,
        description: "Test tool",
        parameters: { type: "object" },
        tool: item.toolEntry
          ? {
              apiVersion: "agents.example.io/v1alpha1",
              kind: "Tool",
              metadata: { name: item.name },
              spec: {
                runtime: "node",
                entry: item.toolEntry,
                exports: [toolExport],
              } satisfies ToolSpec,
            }
          : null,
      };
      return catalogItem;
    });

    // Step mock: turn은 테스트에서 사용하지 않으므로 최소 구조만 제공
    const mockTurn: Step["turn"] = {
      id: "turn-1",
      agentInstance: {
        id: "agent-1",
        swarmInstance: {
          id: "swarm-1",
          swarmRef: "Swarm/test",
          instanceKey: "test-key",
          agents: new Map(),
          status: "running",
          createdAt: new Date(),
          sharedState: {},
        },
        agentName: "Agent/test",
        eventQueue: [],
        turnHistory: [],
        extensionStates: new Map(),
        currentTurn: null,
        sharedState: {},
      },
      event: { type: "user.input", data: "test" },
      steps: [],
      messages: [],
      status: "running",
      startedAt: new Date(),
      metadata: {},
    };

    return {
      id: "step-1",
      turn: mockTurn,
      index: 0,
      activeSwarmBundleRef: "default",
      effectiveConfig: undefined,
      toolCatalog,
      blocks: [],
      toolCalls: [],
      toolResults: [],
      status: "toolExec",
      startedAt: new Date(),
      metadata: {},
    };
  }

  describe("execute", () => {
    it("카탈로그에 없는 Tool이면 에러를 반환해야 한다", async () => {
      const step = createMockStep([]);
      const toolCall: ToolCall = {
        id: "call-1",
        name: "nonexistent.tool",
        input: {},
      };

      const result = await executor.execute(toolCall, step);

      expect(result.error).toBeDefined();
      expect(result.error?.error.name).toBe("ToolNotFoundError");
      expect(result.toolCallId).toBe("call-1");
      expect(result.toolName).toBe("nonexistent.tool");
    });

    it("Tool spec이 없으면 에러를 반환해야 한다", async () => {
      const step = createMockStep([
        { name: "test.tool" }, // toolEntry 없음 -> tool: null
      ]);
      const toolCall: ToolCall = {
        id: "call-2",
        name: "test.tool",
        input: {},
      };

      const result = await executor.execute(toolCall, step);

      expect(result.error).toBeDefined();
      expect(result.error?.error.name).toBe("ToolSpecError");
    });

    it("모듈 로드 실패 시 에러를 반환해야 한다", async () => {
      const step = createMockStep([
        { name: "test.tool", toolEntry: "/nonexistent/path/index.js" },
      ]);
      const toolCall: ToolCall = {
        id: "call-3",
        name: "test.tool",
        input: {},
      };

      const result = await executor.execute(toolCall, step);

      expect(result.error).toBeDefined();
      expect(result.toolCallId).toBe("call-3");
    });
  });
});
