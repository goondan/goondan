/**
 * LlmCallerImpl 테스트
 *
 * AI SDK의 generateText를 mock하여 LlmCaller 구현을 테스트합니다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// generateText를 mock
vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => schema),
  tool: vi.fn((opts: unknown) => opts),
}));

// provider 모듈도 mock
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => "anthropic-model")),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn(() => "openai-model")),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => "google-model")),
}));

import { generateText } from "ai";
import { createLlmCallerImpl } from "../llm-caller-impl.js";
import type { LlmMessage, ToolCatalogItem } from "@goondan/core/runtime";
import type { ModelResource } from "@goondan/core";

const mockGenerateText = vi.mocked(generateText);

describe("LlmCallerImpl", () => {
  const caller = createLlmCallerImpl();

  const testModel: ModelResource = {
    apiVersion: "agents.example.io/v1alpha1",
    kind: "Model",
    metadata: { name: "test-model" },
    spec: {
      provider: "anthropic",
      name: "claude-sonnet-4-5",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("call", () => {
    it("시스템 + 유저 메시지로 LLM을 호출하고 결과를 반환해야 한다", async () => {
      mockGenerateText.mockResolvedValue({
        text: "Hello, I am Claude!",
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        response: { id: "test", modelId: "test", timestamp: new Date(), headers: {}, messages: [] },
        responseMessages: [],
        warnings: [],
        steps: [],
        experimental_providerMetadata: {},
        logprobs: undefined,
        rawResponse: undefined,
        request: { body: "" },
        providerMetadata: {},
        sources: [],
        reasoning: undefined,
        reasoningDetails: [],
        files: [],
        rawCall: { rawPrompt: undefined, rawSettings: {} },
      });

      const messages: LlmMessage[] = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello!" },
      ];

      const result = await caller.call(messages, [], testModel);

      expect(result.message.role).toBe("assistant");
      expect(result.message.content).toBe("Hello, I am Claude!");
      expect(result.finishReason).toBe("stop");
      expect(result.usage?.promptTokens).toBe(10);
      expect(result.usage?.completionTokens).toBe(5);
      expect(result.usage?.totalTokens).toBe(15);

      expect(mockGenerateText).toHaveBeenCalledOnce();
    });

    it("tool calls가 있는 LLM 응답을 처리해야 한다", async () => {
      mockGenerateText.mockResolvedValue({
        text: "",
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "test.run",
            args: { param: "value" },
            type: "tool-call",
          },
        ],
        toolResults: [],
        finishReason: "tool-calls",
        usage: {
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
        },
        response: { id: "test", modelId: "test", timestamp: new Date(), headers: {}, messages: [] },
        responseMessages: [],
        warnings: [],
        steps: [],
        experimental_providerMetadata: {},
        logprobs: undefined,
        rawResponse: undefined,
        request: { body: "" },
        providerMetadata: {},
        sources: [],
        reasoning: undefined,
        reasoningDetails: [],
        files: [],
        rawCall: { rawPrompt: undefined, rawSettings: {} },
      });

      const messages: LlmMessage[] = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Run the test" },
      ];

      const toolCatalog: ToolCatalogItem[] = [
        {
          name: "test.run",
          description: "Run a test",
          parameters: {
            type: "object",
            properties: { param: { type: "string" } },
          },
        },
      ];

      const result = await caller.call(messages, toolCatalog, testModel);

      expect(result.message.toolCalls).toBeDefined();
      expect(result.message.toolCalls).toHaveLength(1);
      expect(result.message.toolCalls?.[0]?.id).toBe("call-1");
      expect(result.message.toolCalls?.[0]?.name).toBe("test.run");
      expect(result.message.toolCalls?.[0]?.input).toEqual({ param: "value" });
      expect(result.finishReason).toBe("tool_calls");
    });

    it("tool call이 없는 assistant 메시지에서 toolCalls는 undefined여야 한다", async () => {
      mockGenerateText.mockResolvedValue({
        text: "Done!",
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        response: { id: "test", modelId: "test", timestamp: new Date(), headers: {}, messages: [] },
        responseMessages: [],
        warnings: [],
        steps: [],
        experimental_providerMetadata: {},
        logprobs: undefined,
        rawResponse: undefined,
        request: { body: "" },
        providerMetadata: {},
        sources: [],
        reasoning: undefined,
        reasoningDetails: [],
        files: [],
        rawCall: { rawPrompt: undefined, rawSettings: {} },
      });

      const messages: LlmMessage[] = [
        { role: "user", content: "Hi" },
      ];

      const result = await caller.call(messages, [], testModel);
      expect(result.message.toolCalls).toBeUndefined();
    });
  });
});
