import { generateText, jsonSchema, tool as aiTool, type ModelMessage } from 'ai';
import type { LlmAdapter, LlmCallInput, LlmCallResult } from '../runtime.js';
import type { Block, JsonObject, ModelSpec, ToolCatalogItem, UnknownObject } from '../../sdk/types.js';

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

    const modelSpec = (modelResource.spec || {}) as unknown as Partial<ModelSpec>;
    const provider = modelSpec.provider || 'unknown';
    const modelName = modelSpec.name || modelResource.metadata?.name || '';
    const modelId = `${provider}/${modelName}`;
    const model = await resolveProviderModel({
      provider,
      modelName,
      endpoint: modelSpec.endpoint,
      options: modelSpec.options,
    });

    const system = extractSystemPrompt(input.blocks);
    const prompt = extractUserPrompt(input.blocks);

    const { tools, toolNameMap } = buildAiTools(input.tools);
    const messages = buildMessages(system, prompt);

    const timeout = resolveTimeout(input.params, modelSpec.options);
    try {
      const result = await (generateText as unknown as (args: UnknownObject) => Promise<any>)({
        model,
        messages,
        tools: tools as unknown as UnknownObject,
        ...(timeout ? { timeout } : {}),
        ...(input.params || {}),
      });

      const toolCalls = (result.toolCalls || []).map((call: any) => {
        const rawName = call.toolName as string;
        return {
          id: call.toolCallId,
          name: toolNameMap[rawName] || rawName,
          input: (call as { input?: JsonObject }).input,
        };
      });

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
          toolCalls: (result.toolCalls || []) as Array<{ toolCallId?: string; toolName: string; input?: JsonObject }>,
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
}): Promise<unknown> {
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
): unknown {
  const factory = resolveProviderFactory(moduleRef, defaultExportName, createExportName, options);
  return factory(modelName);
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
    return defaultFactory as (modelName: string) => unknown;
  }
  if (typeof createFactory === 'function') {
    const factory = (createFactory as (opts: JsonObject) => unknown)(hasOptions ? options : {});
    if (typeof factory === 'function') {
      return factory as (modelName: string) => unknown;
    }
  }
  throw new Error(`AI SDK provider 로딩 실패: ${defaultExportName}`);
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

function buildMessages(system?: string, prompt?: string): ModelMessage[] {
  const messages: ModelMessage[] = [];
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  if (prompt) {
    messages.push({ role: 'user', content: prompt });
  }
  return messages;
}

function buildAiTools(toolCatalog: ToolCatalogItem[]) {
  const tools: { [key: string]: ReturnType<typeof aiTool> } = {};
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
    const parameters = (item.parameters || { type: 'object', additionalProperties: true }) as JsonObject;

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
