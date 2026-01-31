import { generateText, jsonSchema, tool as aiTool, type ModelMessage } from 'ai';
import type { LlmAdapter, LlmCallInput, LlmCallResult } from '../runtime.js';

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
  };
  response: {
    text: string;
    toolCalls: Array<{ toolCallId?: string; toolName: string; input?: Record<string, unknown> }>;
  };
}

export function createAiSdkAdapter(options: AiSdkAdapterOptions = {}): LlmAdapter {
  const providerTag = options.providerTag || 'ai-sdk@v6';

  return async (input: LlmCallInput): Promise<LlmCallResult> => {
    const modelResource = input.model;
    if (!modelResource) {
      throw new Error('modelRef가 필요합니다.');
    }

    const provider = (modelResource.spec as { provider?: string })?.provider || 'unknown';
    const modelName = (modelResource.spec as { name?: string })?.name || modelResource.metadata?.name || '';
    const modelId = `${provider}/${modelName}`;

    const system = extractSystemPrompt(input.blocks);
    const prompt = extractUserPrompt(input.blocks);

    const tools = buildAiTools(input.tools);
    const messages = buildMessages(system, prompt);

    const result = await (generateText as unknown as (args: Record<string, unknown>) => Promise<any>)({
      model: modelId,
      messages,
      tools: tools as unknown as Record<string, unknown>,
      ...(input.params || {}),
    });

    const toolCalls = (result.toolCalls || []).map((call: any) => ({
      id: call.toolCallId,
      name: call.toolName,
      input: (call as { input?: Record<string, unknown> }).input,
    }));

    const trace: AiSdkTrace = {
      provider: providerTag,
      request: {
        model: modelId,
        system,
        prompt,
        tools: Object.keys(tools),
      },
      response: {
        text: result.text,
        toolCalls: (result.toolCalls || []) as Array<{ toolCallId?: string; toolName: string; input?: Record<string, unknown> }>,
      },
    };

    return {
      content: result.text,
      toolCalls,
      meta: trace,
    };
  };
}

function extractSystemPrompt(blocks: Array<Record<string, unknown>>): string | undefined {
  const block = blocks.find((item) => item.type === 'system');
  if (!block) return undefined;
  return typeof block.content === 'string' ? block.content : undefined;
}

function extractUserPrompt(blocks: Array<Record<string, unknown>>): string | undefined {
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

function buildAiTools(toolCatalog: Array<Record<string, unknown>>) {
  const tools: Record<string, ReturnType<typeof aiTool>> = {};

  for (const item of toolCatalog) {
    const name = String(item.name || '');
    if (!name) continue;
    const description = typeof item.description === 'string' ? item.description : '';
    const parameters = (item.parameters || { type: 'object', additionalProperties: true }) as Record<string, unknown>;

    tools[name] = aiTool({
      description,
      inputSchema: jsonSchema(parameters),
    });
  }

  return tools;
}
