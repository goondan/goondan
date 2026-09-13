import { randomUUID } from 'node:crypto';
import type { Json, Message, Model, ModelInput, ModelResult, Part, Usage } from '@goondan/core';

export const DEFAULT_CHAT_MODEL = 'claude-sonnet-5';

const ROUTER_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MAX_TOKENS = 16_384;

export interface RouterModelOptions {
  model?: string;
  fetch?: typeof fetch;
}

interface AnthropicUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

type AccumulatedBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; inputJson: string };

interface StreamState {
  blocks: Map<number, AccumulatedBlock>;
  stopReason?: string;
  usage: AnthropicUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== 'string') {
    throw new Error(`LLM Router SSE event has an invalid ${field} field`);
  }
  return value[field];
}

function numberField(value: unknown, field: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const fieldValue = value[field];
  return typeof fieldValue === 'number' ? fieldValue : undefined;
}

function jsonValue(value: unknown, label: string): Json {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, label));
  if (isRecord(value)) {
    const result: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) result[key] = jsonValue(item, label);
    return result;
  }
  throw new Error(`${label} contains a non-JSON value`);
}

function renderPart(part: Part): Record<string, Json> {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'json':
      return { type: 'text', text: JSON.stringify(part.value) };
    case 'tool.call':
      return { type: 'tool_use', id: part.callId, name: part.name, input: part.args };
    case 'tool.result':
      return {
        type: 'tool_result',
        tool_use_id: part.callId,
        content: part.content.map(renderPart),
        ...(part.isError === undefined ? {} : { is_error: part.isError }),
      };
    case 'image':
    case 'media':
      throw new Error(`The local chat provider does not support ${part.type} message parts`);
  }
}

function renderMessage(message: Message): Record<string, Json> {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  return { role, content: message.content.map(renderPart) };
}

function requestBody(input: ModelInput, model: string): string {
  const maxTokens = typeof input.options.maxTokens === 'number' ? input.options.maxTokens : DEFAULT_MAX_TOKENS;
  return JSON.stringify({
    model,
    max_tokens: maxTokens,
    stream: true,
    system: input.system.map((block) => ({ type: 'text', text: block.text })),
    tools: input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input,
    })),
    messages: input.messages.filter((message) => message.role !== 'system').map(renderMessage),
  });
}

function createState(): StreamState {
  return {
    blocks: new Map(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function updateUsage(target: AnthropicUsage, value: unknown): void {
  target.input = numberField(value, 'input_tokens') ?? target.input;
  target.output = numberField(value, 'output_tokens') ?? target.output;
  target.cacheRead = numberField(value, 'cache_read_input_tokens') ?? target.cacheRead;
  target.cacheWrite = numberField(value, 'cache_creation_input_tokens') ?? target.cacheWrite;
}

function eventIndex(event: Record<string, unknown>): number {
  if (typeof event.index !== 'number') throw new Error('LLM Router SSE event has an invalid index field');
  return event.index;
}

function applyEvent(event: unknown, state: StreamState, onTextDelta: (delta: string) => void): void {
  if (!isRecord(event) || typeof event.type !== 'string') throw new Error('LLM Router returned an invalid SSE event');
  if (event.type === 'error') {
    const detail = isRecord(event.error) && typeof event.error.message === 'string' ? event.error.message : JSON.stringify(event);
    throw new Error(`LLM Router SSE error: ${detail}`);
  }
  if (event.type === 'message_start') {
    if (isRecord(event.message)) updateUsage(state.usage, event.message.usage);
    return;
  }
  if (event.type === 'content_block_start') {
    const index = eventIndex(event);
    if (!isRecord(event.content_block)) throw new Error('LLM Router SSE event has an invalid content_block field');
    if (event.content_block.type === 'text') {
      state.blocks.set(index, { type: 'text', text: typeof event.content_block.text === 'string' ? event.content_block.text : '' });
    } else if (event.content_block.type === 'tool_use') {
      state.blocks.set(index, {
        type: 'tool_use',
        id: stringField(event.content_block, 'id'),
        name: stringField(event.content_block, 'name'),
        inputJson: '',
      });
    }
    return;
  }
  if (event.type === 'content_block_delta') {
    const block = state.blocks.get(eventIndex(event));
    if (!block || !isRecord(event.delta)) return;
    if (block.type === 'text' && event.delta.type === 'text_delta') {
      const delta = stringField(event.delta, 'text');
      block.text += delta;
      onTextDelta(delta);
    } else if (block.type === 'tool_use' && event.delta.type === 'input_json_delta') {
      block.inputJson += stringField(event.delta, 'partial_json');
    }
    return;
  }
  if (event.type === 'message_delta') {
    if (isRecord(event.delta) && typeof event.delta.stop_reason === 'string') state.stopReason = event.delta.stop_reason;
    updateUsage(state.usage, event.usage);
  }
}

async function consumeSse(body: ReadableStream<Uint8Array>, onEvent: (event: unknown) => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer = (buffer + chunk.value).replaceAll('\r\n', '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      parseSseEvent(rawEvent, onEvent);
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim() !== '') parseSseEvent(buffer, onEvent);
}

function parseSseEvent(rawEvent: string, onEvent: (event: unknown) => void): void {
  const payload = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (payload === '' || payload === '[DONE]') return;
  try {
    onEvent(JSON.parse(payload));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`LLM Router returned malformed SSE JSON: ${error.message}`, { cause: error });
    throw error;
  }
}

function finishReason(stopReason: string | undefined): ModelResult['finishReason'] {
  if (stopReason === 'tool_use') return 'tool';
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'stop';
  return 'other';
}

function resultFromState(state: StreamState): ModelResult {
  const content: Part[] = [...state.blocks.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, block]): Part => {
      if (block.type === 'text') return { type: 'text', text: block.text };
      let parsed: unknown;
      try {
        parsed = JSON.parse(block.inputJson === '' ? '{}' : block.inputJson);
      } catch (error) {
        throw new Error(`LLM Router returned malformed tool input for ${block.name}`, { cause: error });
      }
      return { type: 'tool.call', callId: block.id, name: block.name, args: jsonValue(parsed, `Tool input for ${block.name}`) };
    });
  const usage: Usage = state.usage;
  return {
    message: { id: randomUUID(), role: 'assistant', source: 'model', content },
    usage,
    finishReason: finishReason(state.stopReason),
  };
}

export function createRouterModel(options: RouterModelOptions = {}): Model {
  const model = options.model ?? DEFAULT_CHAT_MODEL;
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  return {
    async generate(input, ctx) {
      try {
        const response = await fetchImpl(ROUTER_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'anthropic-version': '2023-06-01',
          },
          body: requestBody(input, model),
          signal: ctx.signal,
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 1_000);
          throw new Error(`LLM Router HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`);
        }
        if (!response.body) throw new Error('LLM Router returned an empty SSE response body');
        const state = createState();
        await consumeSse(response.body, (event) => applyEvent(event, state, ctx.onTextDelta));
        return resultFromState(state);
      } catch (error) {
        if (ctx.signal.aborted) {
          throw ctx.signal.reason instanceof Error ? ctx.signal.reason : new Error('LLM Router request was cancelled');
        }
        throw error;
      }
    },
  };
}
