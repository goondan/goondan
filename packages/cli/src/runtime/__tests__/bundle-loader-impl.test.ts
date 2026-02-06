/**
 * BundleLoaderImpl 테스트
 */

import { describe, it, expect } from "vitest";
import { createBundleLoaderImpl } from "../bundle-loader-impl.js";
import type { BundleLoadResult } from "@goondan/core";
import type { Resource } from "@goondan/core";
import type { AgentResource } from "@goondan/core";

/**
 * 테스트용 BundleLoadResult mock 생성
 */
function createMockBundleLoadResult(
  resources: Resource[]
): BundleLoadResult {
  const resourceIndex = new Map<string, Resource>();
  for (const r of resources) {
    resourceIndex.set(`${r.kind}/${r.metadata.name}`, r);
  }

  return {
    resources,
    errors: [],
    sources: ["test.yaml"],
    isValid: () => true,
    getResourcesByKind: (kind: string) =>
      resources.filter((r) => r.kind === kind),
    getResource: (kind: string, name: string) =>
      resourceIndex.get(`${kind}/${name}`),
  };
}

const mockModel: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Model",
  metadata: { name: "test-model" },
  spec: {
    provider: "anthropic",
    name: "claude-sonnet-4-5",
  },
};

const mockTool: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Tool",
  metadata: { name: "test-tool" },
  spec: {
    runtime: "node",
    entry: "./tools/test/index.ts",
    exports: [
      {
        name: "test.run",
        description: "Test tool",
        parameters: { type: "object", properties: {} },
      },
    ],
  },
};

const mockAgent: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Agent",
  metadata: { name: "test-agent" },
  spec: {
    modelConfig: {
      modelRef: { kind: "Model", name: "test-model" },
    },
    prompts: {
      system: "You are a test agent.",
    },
    tools: [{ kind: "Tool", name: "test-tool" }],
  },
};

const mockSwarm: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Swarm",
  metadata: { name: "test-swarm" },
  spec: {
    entrypoint: { kind: "Agent", name: "test-agent" },
    agents: [{ kind: "Agent", name: "test-agent" }],
    policy: { maxStepsPerTurn: 16 },
  },
};

describe("BundleLoaderImpl", () => {
  const allResources = [mockModel, mockTool, mockAgent, mockSwarm];
  const mockResult = createMockBundleLoadResult(allResources);

  const bundleLoader = createBundleLoaderImpl({
    bundleLoadResult: mockResult,
    bundleRootDir: "/test/project",
  });

  describe("getResource", () => {
    it("기존 리소스를 찾으면 반환해야 한다", () => {
      const model = bundleLoader.getResource("Model", "test-model");
      expect(model).toBeDefined();
      expect(model?.metadata.name).toBe("test-model");
      expect(model?.kind).toBe("Model");
    });

    it("존재하지 않는 리소스에 대해 undefined를 반환해야 한다", () => {
      const notFound = bundleLoader.getResource("Model", "nonexistent");
      expect(notFound).toBeUndefined();
    });
  });

  describe("getSwarmForAgent", () => {
    it("Agent를 포함하는 Swarm을 찾아 반환해야 한다", () => {
      const agent = bundleLoader.getResource<AgentResource["spec"]>(
        "Agent",
        "test-agent"
      );
      expect(agent).toBeDefined();

      if (agent) {
        // Resource<unknown>을 AgentResource 구조로 변환
        // spec는 createMockBundleLoadResult에서 이미 올바른 구조로 세팅됨
        const agentSpec = agent.spec;
        const hasModelConfig = typeof agentSpec === "object" && agentSpec !== null && "modelConfig" in agentSpec;
        expect(hasModelConfig).toBe(true);

        const agentResource: AgentResource = {
          apiVersion: agent.apiVersion,
          kind: agent.kind,
          metadata: agent.metadata,
          spec: agent.spec as AgentResource["spec"],
        };
        const swarm = bundleLoader.getSwarmForAgent(agentResource);
        expect(swarm).toBeDefined();
        expect(swarm.metadata.name).toBe("test-swarm");
      }
    });

    it("Agent를 포함하는 Swarm이 없으면 첫 번째 Swarm을 반환해야 한다", () => {
      const unknownAgent: AgentResource = {
        apiVersion: "agents.example.io/v1alpha1",
        kind: "Agent",
        metadata: { name: "unknown-agent" },
        spec: {
          modelConfig: { modelRef: { kind: "Model", name: "test-model" } },
          prompts: { system: "test" },
        },
      };
      const swarm = bundleLoader.getSwarmForAgent(unknownAgent);
      expect(swarm).toBeDefined();
      expect(swarm.metadata.name).toBe("test-swarm");
    });
  });

  describe("resolveToolRefs", () => {
    it("ObjectRef 배열에서 Tool 리소스를 해석해야 한다", async () => {
      const tools = await bundleLoader.resolveToolRefs([
        { kind: "Tool", name: "test-tool" },
      ]);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.metadata.name).toBe("test-tool");
    });

    it("존재하지 않는 Tool ref는 무시해야 한다", async () => {
      const tools = await bundleLoader.resolveToolRefs([
        { kind: "Tool", name: "nonexistent" },
      ]);
      expect(tools).toHaveLength(0);
    });

    it("빈 배열이나 undefined를 처리해야 한다", async () => {
      expect(await bundleLoader.resolveToolRefs([])).toHaveLength(0);
      expect(await bundleLoader.resolveToolRefs(undefined)).toHaveLength(0);
    });
  });

  describe("resolveExtensionRefs", () => {
    it("빈 배열이나 undefined를 처리해야 한다", async () => {
      expect(await bundleLoader.resolveExtensionRefs([])).toHaveLength(0);
      expect(await bundleLoader.resolveExtensionRefs(undefined)).toHaveLength(0);
    });
  });

  describe("loadSystemPrompt", () => {
    it("인라인 시스템 프롬프트를 반환해야 한다", async () => {
      const prompt = await bundleLoader.loadSystemPrompt({
        system: "Hello, I am a test agent.",
      });
      expect(prompt).toBe("Hello, I am a test agent.");
    });

    it("undefined일 때 빈 문자열을 반환해야 한다", async () => {
      const prompt = await bundleLoader.loadSystemPrompt(undefined);
      expect(prompt).toBe("");
    });

    it("system과 systemRef 모두 없을 때 빈 문자열을 반환해야 한다", async () => {
      const prompt = await bundleLoader.loadSystemPrompt({});
      expect(prompt).toBe("");
    });

    it("파일이 없으면 에러 메시지를 반환해야 한다", async () => {
      const prompt = await bundleLoader.loadSystemPrompt({
        systemRef: "./nonexistent.md",
      });
      expect(prompt).toContain("Failed to load system prompt");
    });
  });
});
