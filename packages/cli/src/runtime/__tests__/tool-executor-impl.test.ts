/**
 * ToolExecutorImpl 테스트
 */

import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { createToolExecutorImpl } from "../tool-executor-impl.js";
import type { Step, ToolCall, ToolCatalogItem } from "@goondan/core/runtime";
import {
  createAgentEventQueue,
  createAgentEvent,
} from "@goondan/core";
import { createTurnMessageState } from "@goondan/core/runtime";
import type { ToolSpec, ToolExport } from "@goondan/core";

describe("ToolExecutorImpl", () => {
  const executor = createToolExecutorImpl({
    bundleRootDir: "/test/project",
    isolateByRevision: false,
  });

  afterAll(async () => {
    await executor.dispose();
  });

  /**
   * 최소한의 Step mock
   */
  function createMockStep(
    toolCatalogItems: Array<{
      name: string;
      toolEntry?: string;
    }>,
    activeSwarmBundleRef: string = "default",
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
    const mockInputEvent = createAgentEvent("user.input", "test");
    const mockMessageState = createTurnMessageState();
    const mockTurn: Step["turn"] = {
      id: "turn-1",
      traceId: "trace-test",
      agentInstance: {
        id: "agent-1",
        swarmInstance: {
          id: "swarm-1",
          swarmRef: "Swarm/test",
          instanceKey: "test-key",
          agents: new Map(),
          activeSwarmBundleRef: activeSwarmBundleRef,
          status: "active",
          createdAt: new Date(),
          lastActivityAt: new Date(),
          metadata: {},
        },
        agentName: "test",
        agentRef: "Agent/test",
        eventQueue: createAgentEventQueue(),
        extensionStates: new Map(),
        currentTurn: null,
        completedTurnCount: 0,
        sharedState: {},
        createdAt: new Date(),
      },
      inputEvent: mockInputEvent,
      origin: {},
      auth: {},
      messageState: mockMessageState,
      messages: mockMessageState.nextMessages,
      steps: [],
      currentStepIndex: 0,
      status: "running",
      startedAt: new Date(),
      metadata: {},
    };

    return {
      id: "step-1",
      turn: mockTurn,
      index: 0,
      activeSwarmBundleRef,
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
        args: {},
      };

      const result = await executor.execute(toolCall, step);

      expect(result.error).toBeDefined();
      expect(result.error?.name).toBe("ToolNotFoundError");
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
        args: {},
      };

      const result = await executor.execute(toolCall, step);

      expect(result.error).toBeDefined();
      expect(result.error?.name).toBe("ToolSpecError");
    });

    it("모듈 로드 실패 시 에러를 반환해야 한다", async () => {
      const step = createMockStep([
        { name: "test.tool", toolEntry: "/nonexistent/path/index.js" },
      ]);
      const toolCall: ToolCall = {
        id: "call-3",
        name: "test.tool",
        args: {},
      };

      const result = await executor.execute(toolCall, step);

      expect(result.error).toBeDefined();
      expect(result.toolCallId).toBe("call-3");
    });

    it("handlers 객체 내부에서 핸들러를 찾아야 한다", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gdn-tool-handlers-"));
      const entryPath = path.join(tempRoot, "tool.js");

      await fs.writeFile(
        entryPath,
        [
          "export const handlers = {",
          "  'delegate.toAgent': async (ctx, input) => {",
          "    return { delegated: true, agentName: input.agentName };",
          "  },",
          "};",
          "",
        ].join("\n"),
        "utf-8",
      );

      const step = createMockStep([{ name: "delegate.toAgent", toolEntry: entryPath }], "default");
      const toolCall: ToolCall = {
        id: "call-handlers",
        name: "delegate.toAgent",
        args: { agentName: "coder", task: "test" },
      };

      const result = await executor.execute(toolCall, step);

      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({
        delegated: true,
        agentName: "coder",
      });

      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it("핸들러를 (ctx, input) 순서로 호출해야 한다", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gdn-tool-order-"));
      const entryPath = path.join(tempRoot, "tool.js");

      await fs.writeFile(
        entryPath,
        [
          "export async function testTool(ctx, input) {",
          "  return {",
          "    hasSwarmBundle: typeof ctx.swarmBundle?.getActiveRef === 'function',",
          "    value: input.value ?? null,",
          "  };",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const step = createMockStep([{ name: "test.tool", toolEntry: entryPath }], "git:ctx-order");
      const toolCall: ToolCall = {
        id: "call-ctx-order",
        name: "test.tool",
        args: { value: "ok" },
      };

      const result = await executor.execute(toolCall, step);

      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({
        hasSwarmBundle: true,
        value: "ok",
      });

      await fs.rm(tempRoot, { recursive: true, force: true });
    });
  });

  describe("revision isolation", () => {
    it("세대 제한을 초과하면 idle ref 워커를 정리해야 한다", async () => {
      const isolated = createToolExecutorImpl({
        bundleRootDir: "/test/project",
        isolateByRevision: true,
        maxActiveGenerations: 1,
      });

      isolated.beginTurn("git:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      isolated.endTurn("git:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      isolated.beginTurn("git:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      isolated.endTurn("git:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      // 내부 정리는 비동기로 일어나므로 한 tick 양보
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });

      expect(isolated.getGenerationRefs().length).toBeLessThanOrEqual(1);
      await isolated.dispose();
    });

    it("step.activeSwarmBundleRef 기준으로 워커에서 핸들러를 실행해야 한다", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gdn-tool-"));
      const entryPath = path.join(tempRoot, "tool.js");

      await fs.writeFile(
        entryPath,
        [
          "export async function testTool(ctx, input) {",
          "  return {",
          "    ok: true,",
          "    ref: ctx.step.activeSwarmBundleRef,",
          "    echo: input.value ?? null",
          "  };",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const isolated = createToolExecutorImpl({
        bundleRootDir: tempRoot,
        isolateByRevision: true,
        maxActiveGenerations: 2,
      });

      isolated.beginTurn("git:cccccccccccccccccccccccccccccccccccccccc");

      const step = createMockStep(
        [{ name: "test.tool", toolEntry: entryPath }],
        "git:cccccccccccccccccccccccccccccccccccccccc",
      );
      const toolCall: ToolCall = {
        id: "call-4",
        name: "test.tool",
        args: { value: "hello" },
      };

      const result = await isolated.execute(toolCall, step);
      isolated.endTurn("git:cccccccccccccccccccccccccccccccccccccccc");

      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({
        ok: true,
        ref: "git:cccccccccccccccccccccccccccccccccccccccc",
        echo: "hello",
      });

      await isolated.dispose();
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it("워커에서 handlers 객체 내부 핸들러를 찾아야 한다", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gdn-tool-handlers-worker-"));
      const entryPath = path.join(tempRoot, "tool.js");

      await fs.writeFile(
        entryPath,
        [
          "export const handlers = {",
          "  'delegate.toAgent': async (ctx, input) => {",
          "    return { delegated: true, agentName: input.agentName };",
          "  },",
          "};",
          "",
        ].join("\n"),
        "utf-8",
      );

      const isolated = createToolExecutorImpl({
        bundleRootDir: tempRoot,
        isolateByRevision: true,
        maxActiveGenerations: 2,
      });

      isolated.beginTurn("git:handlers-test");

      const step = createMockStep(
        [{ name: "delegate.toAgent", toolEntry: entryPath }],
        "git:handlers-test",
      );
      const toolCall: ToolCall = {
        id: "call-handlers-worker",
        name: "delegate.toAgent",
        args: { agentName: "coder", task: "test" },
      };

      const result = await isolated.execute(toolCall, step);
      isolated.endTurn("git:handlers-test");

      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({
        delegated: true,
        agentName: "coder",
      });

      await isolated.dispose();
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it("워커에서 swarmBundle open/commit API를 호출할 수 있어야 한다", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gdn-tool-api-"));
      const entryPath = path.join(tempRoot, "tool.js");

      await fs.writeFile(
        entryPath,
        [
          "export async function testTool(ctx, input) {",
          "  const opened = await ctx.swarmBundle.openChangeset({ reason: input.reason });",
          "  const committed = await ctx.swarmBundle.commitChangeset({",
          "    changesetId: opened.changesetId,",
          "    message: 'test commit',",
          "  });",
          "  return {",
          "    openedId: opened.changesetId,",
          "    committedStatus: committed.status,",
          "    activeRef: ctx.swarmBundle.getActiveRef(),",
          "  };",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      let committedRef = "";

      const isolated = createToolExecutorImpl({
        bundleRootDir: tempRoot,
        isolateByRevision: true,
        swarmBundleApi: {
          async openChangeset() {
            return {
              changesetId: "cs-test",
              baseRef: "git:base",
              workdir: tempRoot,
            };
          },
          async commitChangeset() {
            return {
              status: "ok",
              changesetId: "cs-test",
              baseRef: "git:base",
              newRef: "git:new",
              summary: {
                filesChanged: ["prompts/a.md"],
                filesAdded: [],
                filesDeleted: [],
              },
            };
          },
          getActiveRef() {
            return "git:active";
          },
        },
        onCommittedRef: (ref: string) => {
          committedRef = ref;
        },
      });

      isolated.beginTurn("git:active");
      const step = createMockStep(
        [{ name: "test.tool", toolEntry: entryPath }],
        "git:active",
      );
      const toolCall: ToolCall = {
        id: "call-5",
        name: "test.tool",
        args: { reason: "unit-test" },
      };

      const result = await isolated.execute(toolCall, step);
      isolated.endTurn("git:active");

      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({
        openedId: "cs-test",
        committedStatus: "ok",
        activeRef: "git:active",
      });
      expect(committedRef).toBe("git:new");

      await isolated.dispose();
      await fs.rm(tempRoot, { recursive: true, force: true });
    });
  });
});
