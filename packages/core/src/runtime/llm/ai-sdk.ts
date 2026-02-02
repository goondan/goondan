import {
  generateText,
  jsonSchema,
  tool as aiTool,
  type ModelMessage,
  type LanguageModel,
  type ToolSet,
  type ToolCallPart,
  type ToolResultPart,
  type TextPart,
} from 'ai';
import type { LlmAdapter, LlmCallInput, LlmCallResult } from '../runtime.js';
import { makeId } from '../../utils/ids.js';
import type { Block, JsonObject, JsonValue, LlmMessage, ModelSpec, ToolCall, ToolCatalogItem, ToolResult } from '../../sdk/types.js';

interface AiSdkAdapterOptions {
  providerTag?: string;
}

interface AiSdkTrace {
  provider: string;
  request: {
    model: string;
    system?: string;
    prompt?: string;
    tools: string[];
    toolNameMap?: Record<string, string>;
  };
  response: {
    text: string;
    toolCalls: Array<{ toolCallId?: string; toolName: string; input?: JsonObject }>;
  };
}

export function createAiSdkAdapter(options: AiSdkAdapterOptions = {}): LlmAdapter {
  const providerTag = options.providerTag || 'ai-sdk@v6';

  return async (input: LlmCallInput): Promise<LlmCallResult> => {
    const modelResource = input.model;
    if (!modelResource) {
      throw new Error('modelRef가 필요합니다.');
    }

    const modelSpec = extractModelSpec(modelResource.spec);
    const provider = modelSpec.provider || 'unknown';
    const modelName = modelSpec.name || modelResource.metadata?.name || '';
    const modelId = `${provider}/${modelName}`;
    const model = await resolveProviderModel({
      provider,
      modelName,
      endpoint: modelSpec.endpoint,
      options: modelSpec.options,
    });

    const { tools, toolNameMap } = buildAiTools(input.tools);
    const { system, messages, prompt } = buildPromptMessages(input.blocks);

    const timeout = resolveTimeout(input.params, modelSpec.options);
    try {
      const result = await generateText({
        model,
        messages,
        ...(system ? { system } : {}),
        tools,
        ...(timeout ? { timeout } : {}),
        ...(input.params || {}),
      });

      const toolCalls = (result.toolCalls || []).map((call) => {
        const rawName = call.toolName;
        return {
          id: call.toolCallId || makeId('tool-call'),
          name: toolNameMap[rawName] || rawName,
          input: isJsonObject(call.input) ? call.input : {},
        };
      });

      const responseToolCalls = (result.toolCalls || []).map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        ...(isJsonObject(call.input) ? { input: call.input } : {}),
      }));

      const trace: AiSdkTrace = {
        provider: providerTag,
        request: {
          model: modelId,
          system,
          prompt,
          tools: Object.keys(tools),
          toolNameMap: Object.keys(toolNameMap).length > 0 ? toolNameMap : undefined,
        },
        response: {
          text: result.text,
          toolCalls: responseToolCalls,
        },
      };

      return {
        content: result.text,
        toolCalls,
        meta: trace,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const timeoutInfo = timeout ? ` (timeout=${timeout}ms)` : '';
      throw new Error(`LLM 호출 실패: ${modelId}${timeoutInfo} - ${message}`);
    }
  };
}

async function resolveProviderModel(input: {
  provider: string;
  modelName: string;
  endpoint?: string;
  options?: JsonObject;
}): Promise<LanguageModel> {
  const provider = input.provider?.trim();
  const modelName = input.modelName?.trim();
  if (!provider) {
    throw new Error('model.spec.provider가 필요합니다.');
  }
  if (!modelName) {
    throw new Error('model.spec.name가 필요합니다.');
  }

  const providerOptions = buildProviderOptions(input.options, input.endpoint);

  switch (provider) {
    case 'openai':
      return buildProviderModel(await import('@ai-sdk/openai'), 'openai', 'createOpenAI', modelName, providerOptions);
    case 'google':
      return buildProviderModel(await import('@ai-sdk/google'), 'google', 'createGoogleGenerativeAI', modelName, providerOptions);
    case 'anthropic':
      return buildProviderModel(await import('@ai-sdk/anthropic'), 'anthropic', 'createAnthropic', modelName, providerOptions);
    default:
      throw new Error(`지원하지 않는 model provider입니다: ${provider}`);
  }
}

function buildProviderOptions(options?: JsonObject, endpoint?: string): JsonObject {
  const providerOptions: JsonObject = { ...(options || {}) };
  if (endpoint && !('baseURL' in providerOptions) && !('baseUrl' in providerOptions)) {
    providerOptions.baseURL = endpoint;
  }
  return providerOptions;
}

function buildProviderModel(
  moduleRef: { [key: string]: unknown },
  defaultExportName: string,
  createExportName: string,
  modelName: string,
  options: JsonObject
): LanguageModel {
  const factory = resolveProviderFactory(moduleRef, defaultExportName, createExportName, options);
  const model = factory(modelName);
  if (!isLanguageModel(model)) {
    throw new Error(`AI SDK provider 로딩 실패: ${defaultExportName}`);
  }
  return model;
}

function resolveProviderFactory(
  moduleRef: { [key: string]: unknown },
  defaultExportName: string,
  createExportName: string,
  options: JsonObject
): (modelName: string) => unknown {
  const hasOptions = options && Object.keys(options).length > 0;
  const createFactory = moduleRef[createExportName];
  const defaultFactory = moduleRef[defaultExportName] ?? moduleRef.default;
  if (typeof defaultFactory === 'function') {
    return (modelName: string) => defaultFactory(modelName);
  }
  if (typeof createFactory === 'function') {
    const factory = createFactory(hasOptions ? options : {});
    if (typeof factory === 'function') {
      return (modelName: string) => factory(modelName);
    }
  }
  throw new Error(`AI SDK provider 로딩 실패: ${defaultExportName}`);
}

function extractModelSpec(spec: unknown): Partial<ModelSpec> {
  if (!isRecord(spec)) return {};
  const provider = typeof spec.provider === 'string' ? spec.provider : undefined;
  const name = typeof spec.name === 'string' ? spec.name : undefined;
  const endpoint = typeof spec.endpoint === 'string' ? spec.endpoint : undefined;
  const options = isJsonObject(spec.options) ? spec.options : undefined;
  return { provider, name, endpoint, options };
}

function extractSystemPrompt(blocks: Block[]): string | undefined {
  const block = blocks.find((item) => item.type === 'system');
  if (!block) return undefined;
  return typeof block.content === 'string' ? block.content : undefined;
}

function extractUserPrompt(blocks: Block[]): string | undefined {
  const block = blocks.find((item) => item.type === 'input');
  if (!block) return undefined;
  return typeof block.content === 'string' ? block.content : undefined;
}

function buildPromptMessages(blocks: Block[]): { system?: string; messages: ModelMessage[]; prompt?: string } {
  const system = extractSystemPrompt(blocks);
  const prompt = extractUserPrompt(blocks);
  const llmMessages = extractLlmMessages(blocks);
  if (llmMessages.length > 0) {
    const messages = convertLlmMessagesToModel(llmMessages, { includeSystem: !system });
    return { system, messages, prompt };
  }

  const messages: ModelMessage[] = [];
  if (prompt) {
    messages.push({ role: 'user', content: prompt });
  }
  const toolResults = extractToolResults(blocks);
  if (toolResults.length > 0) {
    messages.push(buildToolResultsMessage(toolResults));
  }
  return { system, messages, prompt };
}

function extractLlmMessages(blocks: Block[]): LlmMessage[] {
  const block = blocks.find((item) => item.type === 'messages');
  if (!block || !Array.isArray(block.items)) return [];
  return block.items.filter(isLlmMessage);
}

function extractToolResults(blocks: Block[]): ToolResult[] {
  const block = blocks.find((item) => item.type === 'tool.results');
  if (!block || !Array.isArray(block.items)) return [];
  return block.items.filter(isToolResult);
}

function convertLlmMessagesToModel(
  messages: LlmMessage[],
  options: { includeSystem: boolean }
): ModelMessage[] {
  const converted: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system' && !options.includeSystem) {
      continue;
    }
    if (message.role === 'system') {
      converted.push({ role: 'system', content: message.content });
      continue;
    }
    if (message.role === 'user') {
      converted.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const content = toAssistantContent(message);
      if (content) {
        converted.push({ role: 'assistant', content });
      }
      continue;
    }
    if (message.role === 'tool') {
      converted.push({ role: 'tool', content: [toToolResultPart(message.toolCallId, message.toolName, message.output)] });
    }
  }
  return converted;
}

function buildToolResultsMessage(results: ToolResult[]): ModelMessage {
  const content = results.map((result) => toToolResultPart(result.id, result.name, result.output));
  return { role: 'tool', content };
}

function toAssistantContent(
  message: Extract<LlmMessage, { role: 'assistant' }>
): string | Array<TextPart | ToolCallPart> | null {
  const parts: Array<TextPart | ToolCallPart> = [];
  if (message.content) {
    parts.push({ type: 'text', text: message.content });
  }
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  for (const call of toolCalls) {
    const toolCallId = call.id || makeId('tool-call');
    const input = isJsonObject(call.input) ? call.input : {};
    parts.push({
      type: 'tool-call',
      toolCallId,
      toolName: call.name,
      input,
    });
  }
  if (parts.length === 0) return null;
  if (parts.length === 1 && toolCalls.length === 0) {
    const first = parts[0];
    if (first && first.type === 'text') {
      return first.text;
    }
  }
  return parts;
}

type AiJsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: AiJsonValue }
  | AiJsonValue[];

function toToolResultPart(toolCallId: string, toolName: string, output: JsonValue): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId,
    toolName,
    output: toToolResultOutput(output),
  };
}

function toToolResultOutput(value: JsonValue): ToolResultPart['output'] {
  if (typeof value === 'string') {
    return { type: 'text', value };
  }
  return { type: 'json', value: toAiJsonValue(value) };
}

function toAiJsonValue(value: JsonValue): AiJsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toAiJsonValue(entry));
  }
  if (isJsonObject(value)) {
    const out: { [key: string]: AiJsonValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = toAiJsonValue(entry);
    }
    return out;
  }
  return String(value);
}

function buildAiTools(toolCatalog: ToolCatalogItem[]): { tools: ToolSet; toolNameMap: Record<string, string> } {
  const tools: ToolSet = {};
  const toolNameMap: Record<string, string> = {};
  const usedNames = new Set<string>();
  let index = 0;

  for (const item of toolCatalog) {
    const originalName = String(item.name || '').trim();
    if (!originalName) continue;
    const name = sanitizeToolName(originalName, usedNames, index);
    index += 1;
    toolNameMap[name] = originalName;
    const description = describeTool(originalName, name, item.description);
    const parameters = isJsonObject(item.parameters)
      ? item.parameters
      : { type: 'object', additionalProperties: true };

    tools[name] = aiTool({
      description,
      inputSchema: jsonSchema(parameters),
    });
  }

  return { tools, toolNameMap };
}

function sanitizeToolName(original: string, used: Set<string>, index: number): string {
  let name = original.replace(/[^a-zA-Z0-9_-]/g, '_');
  name = name.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!name) {
    name = `tool_${index + 1}`;
  }
  name = name.slice(0, 128);
  let candidate = name;
  let counter = 1;
  while (used.has(candidate)) {
    const suffix = `_${counter}`;
    const maxBaseLen = 128 - suffix.length;
    candidate = `${name.slice(0, Math.max(1, maxBaseLen))}${suffix}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function describeTool(originalName: string, sanitizedName: string, description?: string): string {
  const base = typeof description === 'string' ? description : '';
  if (sanitizedName === originalName) {
    return base;
  }
  const hint = `original: ${originalName}`;
  if (!base) return hint;
  return `${base} (${hint})`;
}

function resolveTimeout(params?: JsonObject, options?: JsonObject): number | undefined {
  const paramTimeout = params?.timeout ?? params?.timeoutMs;
  if (typeof paramTimeout === 'number' && Number.isFinite(paramTimeout)) return paramTimeout;
  const optionTimeout = options?.timeout ?? options?.timeoutMs;
  if (typeof optionTimeout === 'number' && Number.isFinite(optionTimeout)) return optionTimeout;
  const envTimeout = process.env.GOONDAN_LLM_TIMEOUT_MS;
  if (envTimeout) {
    const parsed = Number.parseInt(envTimeout, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 60000;
}

function isLanguageModel(value: unknown): value is LanguageModel {
  return typeof value === 'string' || (typeof value === 'object' && value !== null);
}

function isLlmMessage(value: unknown): value is LlmMessage {
  if (!isRecord(value)) return false;
  const role = value.role;
  if (role === 'system' || role === 'user') {
    return typeof value.content === 'string';
  }
  if (role === 'assistant') {
    const contentOk = value.content === undefined || typeof value.content === 'string';
    const toolCallsOk =
      value.toolCalls === undefined || (Array.isArray(value.toolCalls) && value.toolCalls.every(isToolCall));
    return contentOk && toolCallsOk;
  }
  if (role === 'tool') {
    return typeof value.toolCallId === 'string' && typeof value.toolName === 'string';
  }
  return false;
}

function isToolResult(value: unknown): value is ToolResult {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isToolCall(value: unknown): value is ToolCall {
  return isRecord(value) && typeof value.name === 'string';
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
