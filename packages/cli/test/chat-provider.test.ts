import type { ModelInput } from '@goondan/core';
import { describe, expect, it, vi } from 'vitest';
import { createRouterModel, DEFAULT_CHAT_MODEL } from '../src/chat/provider.ts';

function modelInput(): ModelInput {
  return {
    system: [{ text: 'You are a coding agent.', source: 'config' }],
    messages: [
      { id: 'u1', role: 'user', source: 'input', content: [{ type: 'text', text: 'Read package.json' }] },
      {
        id: 'a1',
        role: 'assistant',
        source: 'model',
        content: [{ type: 'tool.call', callId: 'old-call', name: 'read_file', args: { path: 'README.md' } }],
      },
      {
        id: 't1',
        role: 'tool',
        source: 'tool',
        content: [{ type: 'tool.result', callId: 'old-call', content: [{ type: 'text', text: 'old result' }] }],
      },
    ],
    tools: [{
      name: 'read_file',
      description: 'Read a file',
      input: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    }],
    options: {},
  };
}

function event(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function splitSseResponse(text: string, splitAt: number): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, splitAt)));
      controller.enqueue(encoder.encode(text.slice(splitAt)));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('createRouterModel', () => {
  it('renders prior tool use/results and assembles split text/tool SSE deltas', async () => {
    const sse = [
      event({ type: 'message_start', message: { usage: { input_tokens: 12, cache_read_input_tokens: 3 } } }),
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will ' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'read it.' } }),
      event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-1', name: 'read_file', input: {} } }),
      event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
      event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"package.json"}' } }),
      event({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }),
      event({ type: 'message_stop' }),
    ].join('');
    const requestBodies: string[] = [];
    const fetchMock: typeof fetch = vi.fn(async (_input, init) => {
      if (typeof init?.body === 'string') requestBodies.push(init.body);
      return splitSseResponse(sse, 37);
    });
    const deltas: string[] = [];
    const result = await createRouterModel({ fetch: fetchMock }).generate(modelInput(), {
      agent: 'main',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      step: 1,
      signal: new AbortController().signal,
      onTextDelta(delta) { deltas.push(delta); },
    });

    expect(deltas).toEqual(['I will ', 'read it.']);
    expect(result.finishReason).toBe('tool');
    expect(result.usage).toEqual({ input: 12, output: 9, cacheRead: 3, cacheWrite: 0 });
    expect(result.message.content).toEqual([
      { type: 'text', text: 'I will read it.' },
      { type: 'tool.call', callId: 'call-1', name: 'read_file', args: { path: 'package.json' } },
    ]);
    const body = JSON.parse(requestBodies[0] ?? 'null');
    expect(body).toMatchObject({ model: DEFAULT_CHAT_MODEL, stream: true });
    expect(body.messages[1].content[0]).toEqual({ type: 'tool_use', id: 'old-call', name: 'read_file', input: { path: 'README.md' } });
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'old-call', content: [{ type: 'text', text: 'old result' }] }],
    });
  });

  it('reports HTTP and malformed SSE errors with router context', async () => {
    const httpFetch: typeof fetch = vi.fn(async () => new Response('department denied', { status: 403 }));
    await expect(createRouterModel({ fetch: httpFetch }).generate(modelInput(), {
      agent: 'main', conversationId: 'c', turnId: 't', step: 1,
      signal: new AbortController().signal, onTextDelta() {},
    })).rejects.toThrow('LLM Router HTTP 403: department denied');

    const malformedFetch: typeof fetch = vi.fn(async () => new Response('data: {oops}\n\n'));
    await expect(createRouterModel({ fetch: malformedFetch }).generate(modelInput(), {
      agent: 'main', conversationId: 'c', turnId: 't', step: 1,
      signal: new AbortController().signal, onTextDelta() {},
    })).rejects.toThrow('LLM Router returned malformed SSE JSON');
  });

  it('forwards caller cancellation to fetch', async () => {
    const fetchMock: typeof fetch = vi.fn(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const controller = new AbortController();
    const pending = createRouterModel({ fetch: fetchMock }).generate(modelInput(), {
      agent: 'main', conversationId: 'c', turnId: 't', step: 1,
      signal: controller.signal, onTextDelta() {},
    });
    controller.abort(new Error('user cancelled'));
    await expect(pending).rejects.toThrow('user cancelled');
  });
});
