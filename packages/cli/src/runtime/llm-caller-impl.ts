/**
 * LlmCallerImpl: AI SDK(Vercel)를 사용한 LLM 호출 구현
 *
 * ModelResource의 provider/name을 기반으로 적절한 AI SDK provider를 선택하고,
 * ToolCatalogItem을 AI SDK tool 형식으로 변환하여 generateText를 호출합니다.
 *
 * @see /docs/specs/runtime.md - 6. Step 실행 순서
 */

import { generateText, jsonSchema, tool } from "ai";
import type { LanguageModelV1, CoreMessage } from "ai";
import type { LlmCaller } from "@goondan/core/runtime";
import type {
  LlmMessage,
  LlmResult,
  LlmAssistantMessage,
  ToolCall,
  ToolCatalogItem,
} from "@goondan/core/runtime";
import type { ModelResource } from "@goondan/core";
import type { JsonObject } from "@goondan/core";

/**
 * AI SDK provider에서 LanguageModel 가져오기
 */
async function getLanguageModel(
  provider: string,
  modelName: string,
  endpoint?: string,
): Promise<LanguageModelV1> {
  switch (provider) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropicProvider = createAnthropic(
        endpoint ? { baseURL: endpoint } : undefined,
      );
      return anthropicProvider(modelName);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openaiProvider = createOpenAI(
        endpoint ? { baseURL: endpoint } : undefined,
      );
      return openaiProvider(modelName);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const googleProvider = createGoogleGenerativeAI(
        endpoint ? { baseURL: endpoint } : undefined,
      );
      return googleProvider(modelName);
    }
    default: {
      // OpenAI-compatible endpoint를 기본으로 시도
      const { createOpenAI } = await import("@ai-sdk/openai");
      const compatProvider = createOpenAI({
        baseURL: endpoint ?? `https://api.${provider}.com/v1`,
        apiKey: process.env[`${provider.toUpperCase()}_API_KEY`] ?? "",
      });
      return compatProvider(modelName);
    }
  }
}

/**
 * LlmMessage 배열을 AI SDK CoreMessage 형식으로 변환
 */
function convertMessages(messages: readonly LlmMessage[]): CoreMessage[] {
  const result: CoreMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        result.push({ role: "system", content: msg.content });
        break;
      case "user":
        result.push({ role: "user", content: msg.content });
        break;
      case "assistant": {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const parts: Array<
            | { type: "text"; text: string }
            | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
          > = [];
          if (msg.content) {
            parts.push({ type: "text", text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            parts.push({
              type: "tool-call",
              toolCallId: tc.id,
              toolName: tc.name,
              args: tc.input,
            });
          }
          result.push({ role: "assistant", content: parts });
        } else {
          result.push({
            role: "assistant",
            content: msg.content ?? "",
          });
        }
        break;
      }
      case "tool": {
        result.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: msg.toolCallId,
              toolName: msg.toolName,
              result: msg.output,
            },
          ],
        });
        break;
      }
    }
  }

  return result;
}

/**
 * ToolCatalogItem 배열을 AI SDK tools 형식으로 변환
 */
function convertToolCatalog(
  catalog: ToolCatalogItem[],
): Record<string, ReturnType<typeof tool>> {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  for (const item of catalog) {
    // AI SDK tool은 execute 없이 정의하면 tool call만 반환
    tools[item.name] = tool({
      description: item.description ?? "",
      parameters: jsonSchema(item.parameters ?? { type: "object" }),
    });
  }

  return tools;
}

/**
 * AI SDK finishReason을 내부 형식으로 변환
 */
function mapFinishReason(
  reason: string,
): "stop" | "tool_calls" | "length" | "content_filter" {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool-calls":
      return "tool_calls";
    case "length":
      return "length";
    case "content-filter":
      return "content_filter";
    default:
      return "stop";
  }
}

/**
 * unknown을 JsonObject로 변환하는 타입 가드
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Provider별 API 키 환경변수 매핑
 */
const PROVIDER_ENV_VARS: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/**
 * API 키 누락 여부를 사전 확인하고 친절한 에러 메시지를 제공
 */
function validateApiKey(provider: string): void {
  const envVar = PROVIDER_ENV_VARS[provider];
  if (!envVar) return; // Unknown provider, SDK가 처리

  const value = process.env[envVar];
  if (!value || value.length === 0) {
    throw new Error(
      `${provider} API key is not set. ` +
      `Set the ${envVar} environment variable:\n\n` +
      `  export ${envVar}=your-api-key\n\n` +
      `Or add it to your shell profile (~/.bashrc, ~/.zshrc).\n` +
      `Run 'gdn doctor' to check all environment requirements.`
    );
  }
}

/**
 * LlmCaller 구현 생성
 */
export function createLlmCallerImpl(): LlmCaller {
  return {
    async call(
      messages: readonly LlmMessage[],
      toolCatalog: ToolCatalogItem[],
      model: ModelResource,
    ): Promise<LlmResult> {
      // API 키 사전 검증으로 친절한 에러 메시지 제공
      validateApiKey(model.spec.provider);

      const languageModel = await getLanguageModel(
        model.spec.provider,
        model.spec.name,
        model.spec.endpoint,
      );

      const convertedMessages = convertMessages(messages);
      const convertedTools = convertToolCatalog(toolCatalog);

      const result = await generateText({
        model: languageModel,
        messages: convertedMessages,
        tools: Object.keys(convertedTools).length > 0 ? convertedTools : undefined,
        maxSteps: 1, // Step 루프는 우리가 직접 관리
      });

      // Tool calls 추출
      const toolCalls: ToolCall[] = [];
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          const args = isJsonObject(tc.args) ? tc.args : {};
          toolCalls.push({
            id: tc.toolCallId,
            name: tc.toolName,
            input: args,
          });
        }
      }

      // Assistant message 구성
      const assistantMessage: LlmAssistantMessage = {
        role: "assistant",
        content: result.text || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      return {
        message: assistantMessage,
        usage: result.usage
          ? {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens:
                result.usage.promptTokens + result.usage.completionTokens,
            }
          : undefined,
        finishReason: mapFinishReason(result.finishReason),
      };
    },
  };
}
