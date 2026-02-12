import { describe, expect, it } from 'vitest';
import { registerCompactionExtension } from '../src/extensions/compaction.js';
import type { MessageEvent, TurnMiddlewareContext } from '../src/types.js';
import {
  createConversationState,
  createMessage,
  createMockExtensionApi,
} from './helpers.js';

function createTurnContext(events: MessageEvent[]): TurnMiddlewareContext {
  const messages = [
    createMessage('m1', '1111111111'),
    createMessage('m2', '2222222222'),
    createMessage('m3', '3333333333'),
    createMessage('m4', '4444444444'),
    createMessage('m5', '5555555555'),
  ];

  return {
    agentName: 'agent-a',
    instanceKey: 'instance-1',
    turnId: 'turn-1',
    traceId: 'trace-1',
    inputEvent: {
      id: 'evt-1',
      type: 'connector.message',
      createdAt: new Date(),
      source: { kind: 'connector', name: 'cli' },
      input: 'hello',
    },
    conversationState: createConversationState(messages),
    emitMessageEvent(event) {
      events.push(event);
    },
    metadata: {},
    async next() {
      return {
        turnId: 'turn-1',
        finishReason: 'text_response',
      };
    },
  };
}

describe('compaction extension', () => {
  it('emits remove + append summary events when message limit exceeded', async () => {
    const mock = createMockExtensionApi();
    registerCompactionExtension(mock.api, {
      maxMessages: 3,
      retainLastMessages: 1,
      appendSummary: true,
      mode: 'remove',
      maxCharacters: 1000,
    });

    expect(mock.pipeline.turnMiddlewares.length).toBe(1);

    const emitted: MessageEvent[] = [];
    const ctx = createTurnContext(emitted);

    const middleware = mock.pipeline.turnMiddlewares[0];
    if (!middleware) {
      throw new Error('Missing compaction middleware');
    }
    await middleware(ctx);

    const removeCount = emitted.filter((event) => event.type === 'remove').length;
    const summaryCount = emitted.filter((event) => event.type === 'append').length;

    expect(removeCount).toBeGreaterThan(0);
    expect(summaryCount).toBe(1);
  });

  it('can emit truncate in truncate mode', async () => {
    const mock = createMockExtensionApi();
    registerCompactionExtension(mock.api, {
      maxMessages: 1,
      mode: 'truncate',
      appendSummary: false,
      maxCharacters: 20,
    });

    const emitted: MessageEvent[] = [];
    const ctx = createTurnContext(emitted);

    const middleware = mock.pipeline.turnMiddlewares[0];
    if (!middleware) {
      throw new Error('Missing compaction middleware');
    }
    await middleware(ctx);

    expect(emitted.some((event) => event.type === 'truncate')).toBe(true);
  });
});
