import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { register as registerContextMessageExtension } from '../src/extensions/context-message.js';
import type {
  AgentEvent,
  JsonObject,
  JsonValue,
  Message,
  MessageEvent,
  MiddlewareAgentsApi,
  RuntimeContext,
  TurnMiddlewareContext,
  TurnResult,
} from '../src/types.js';
import { isJsonObject } from '../src/utils.js';
import { createConversationState, createMessage, createMockExtensionApi } from './helpers.js';

const EXTENSION_EVENTS_METADATA_KEY = 'extension.events';
const CONTEXT_MESSAGE_MARKER_KEY = '__goondanContextMessage';

const noopAgents: MiddlewareAgentsApi = {
  async request() {
    return {
      target: 'noop',
      response: '',
      accepted: true,
      async: false,
    };
  },
  async send() {
    return {
      accepted: true,
    };
  },
};

function createInputEvent(turnId: string): AgentEvent {
  return {
    id: `evt-${turnId}`,
    type: 'connector.message',
    createdAt: new Date(),
    source: { kind: 'connector', name: 'cli' },
    input: 'hello',
  };
}

function createTurnContext(input: {
  turnId?: string;
  messages?: Message[];
  metadata?: Record<string, JsonValue>;
  runtime?: RuntimeContext;
  emitted: MessageEvent[];
  next?: () => Promise<TurnResult>;
  emitMessageEvent?: (event: MessageEvent) => void;
}): TurnMiddlewareContext {
  const turnId = input.turnId ?? 'turn-1';
  const messages = input.messages ?? [createMessage('m1', 'hello')];

  return {
    agentName: 'agent-a',
    instanceKey: 'instance-1',
    turnId,
    traceId: `trace-${turnId}`,
    inputEvent: createInputEvent(turnId),
    conversationState: createConversationState(messages),
    agents: noopAgents,
    runtime: input.runtime ?? {
      agent: {
        name: 'agent-a',
        bundleRoot: '/tmp',
      },
      swarm: {
        swarmName: 'default',
        entryAgent: 'agent-a',
        selfAgent: 'agent-a',
        availableAgents: ['agent-a'],
        callableAgents: [],
      },
      inbound: {
        eventId: `evt-${turnId}`,
        eventType: 'connector.message',
        sourceKind: 'connector',
        sourceName: 'cli',
        createdAt: new Date().toISOString(),
      },
    },
    emitMessageEvent(event) {
      if (input.emitMessageEvent) {
        input.emitMessageEvent(event);
        return;
      }
      input.emitted.push(event);
    },
    metadata: input.metadata ?? {},
    async next() {
      if (input.next) {
        return input.next();
      }
      return {
        turnId,
        finishReason: 'text_response',
      };
    },
  };
}

function readRuntimeEvents(metadata: Record<string, JsonValue>): JsonObject[] {
  const raw = metadata[EXTENSION_EVENTS_METADATA_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is JsonObject => isJsonObject(item));
}

function readRuntimeEventNames(metadata: Record<string, JsonValue>): string[] {
  return readRuntimeEvents(metadata)
    .map((item) => item.name)
    .filter((name): name is string => typeof name === 'string');
}

function findRuntimeEvent(
  metadata: Record<string, JsonValue>,
  eventName: string,
): JsonObject | undefined {
  return readRuntimeEvents(metadata).find((item) => item.name === eventName);
}

describe('context-message extension', () => {
  it('기본 설정에서는 agent.prompt.system만 system 메시지로 append한다', async () => {
    const mock = createMockExtensionApi();
    registerContextMessageExtension(mock.api);

    const emitted: MessageEvent[] = [];
    const ctx = createTurnContext({
      emitted,
      runtime: {
        agent: {
          name: 'coordinator',
          bundleRoot: '/tmp',
          prompt: { system: 'You must follow policy A.' },
        },
        swarm: {
          swarmName: 'default',
          entryAgent: 'coordinator',
          selfAgent: 'coordinator',
          availableAgents: ['coordinator', 'worker'],
          callableAgents: ['worker'],
        },
        inbound: {
          eventId: 'evt-test',
          eventType: 'connector.message',
          sourceKind: 'connector',
          sourceName: 'cli',
          createdAt: new Date().toISOString(),
        },
      },
    });

    const middleware = mock.pipeline.turnMiddlewares[0];
    if (!middleware) {
      throw new Error('Missing context-message middleware');
    }

    await middleware(ctx);

    expect(emitted.length).toBe(1);
    const firstEvent = emitted[0];
    if (!firstEvent || firstEvent.type !== 'append') {
      throw new Error('Expected append event');
    }

    expect(firstEvent.message.data.role).toBe('system');
    expect(firstEvent.message.data.content).toBe('You must follow policy A.');
    expect(firstEvent.message.source).toEqual({
      type: 'extension',
      extensionName: 'context-message',
    });

    const marker = firstEvent.message.metadata[CONTEXT_MESSAGE_MARKER_KEY];
    expect(isJsonObject(marker)).toBe(true);
    if (isJsonObject(marker)) {
      expect(typeof marker.promptHash).toBe('string');
      expect(marker.segmentIds).toEqual(['agent.prompt.system']);
    }

    const eventNames = readRuntimeEventNames(ctx.metadata);
    expect(eventNames).toContain('context.segment.resolved');
    expect(eventNames).toContain('context.message.appended');
  });

  it('includeSwarmCatalog=true면 runtime_catalog 세그먼트를 함께 합성한다', async () => {
    const mock = createMockExtensionApi();
    registerContextMessageExtension(mock.api, {
      includeSwarmCatalog: true,
    });

    const emitted: MessageEvent[] = [];
    const ctx = createTurnContext({
      emitted,
      runtime: {
        agent: {
          name: 'coordinator',
          bundleRoot: '/tmp',
          prompt: { system: 'System prompt.' },
        },
        swarm: {
          swarmName: 'brain',
          entryAgent: 'coordinator',
          selfAgent: 'coordinator',
          availableAgents: ['coordinator', 'worker', 'observer'],
          callableAgents: ['worker', 'observer'],
        },
        inbound: {
          eventId: 'evt-test',
          eventType: 'connector.message',
          sourceKind: 'connector',
          sourceName: 'cli',
          createdAt: new Date().toISOString(),
        },
      },
    });

    const middleware = mock.pipeline.turnMiddlewares[0];
    if (!middleware) {
      throw new Error('Missing context-message middleware');
    }

    await middleware(ctx);

    expect(emitted.length).toBe(1);
    const firstEvent = emitted[0];
    if (!firstEvent || firstEvent.type !== 'append') {
      throw new Error('Expected append event');
    }

    expect(firstEvent.message.data.content).toContain('System prompt.');
    expect(firstEvent.message.data.content).toContain('[runtime_catalog]');
    expect(firstEvent.message.data.content).toContain('swarm=brain');
    expect(firstEvent.message.data.content).toContain('callableAgents=worker, observer');

    const marker = firstEvent.message.metadata[CONTEXT_MESSAGE_MARKER_KEY];
    expect(isJsonObject(marker)).toBe(true);
    if (isJsonObject(marker)) {
      expect(marker.segmentIds).toEqual([
        'agent.prompt.system',
        'runtime.swarm.catalog',
      ]);
    }
  });

  it('includeRouteSummary=true면 call > inbound 우선순위로 runtime_route를 합성한다', async () => {
    const mock = createMockExtensionApi();
    registerContextMessageExtension(mock.api, {
      includeAgentPrompt: false,
      includeInboundContext: true,
      includeCallContext: true,
      includeRouteSummary: true,
    });

    const emitted: MessageEvent[] = [];
    const ctx = createTurnContext({
      emitted,
      runtime: {
        agent: {
          name: 'worker',
          bundleRoot: '/tmp',
        },
        swarm: {
          swarmName: 'brain',
          entryAgent: 'coordinator',
          selfAgent: 'worker',
          availableAgents: ['coordinator', 'worker'],
          callableAgents: ['coordinator'],
        },
        inbound: {
          eventId: 'evt-inbound',
          eventType: 'agent.message',
          sourceKind: 'connector',
          sourceName: 'telegram',
          createdAt: new Date().toISOString(),
          instanceKey: 'chat-1',
        },
        call: {
          callerAgent: 'coordinator',
          callerInstanceKey: 'swarm-shared',
          callerTurnId: 'turn-55',
          callSource: 'extension-middleware',
        },
      },
    });

    const middleware = mock.pipeline.turnMiddlewares[0];
    if (!middleware) {
      throw new Error('Missing context-message middleware');
    }

    await middleware(ctx);

    expect(emitted.length).toBe(1);
    const firstEvent = emitted[0];
    if (!firstEvent || firstEvent.type !== 'append') {
      throw new Error('Expected append event');
    }

    expect(firstEvent.message.data.content).toContain('[runtime_route]');
    expect(firstEvent.message.data.content).toContain('precedence=call>inbound');
    expect(firstEvent.message.data.content).toContain('senderKind=agent');
    expect(firstEvent.message.data.content).toContain('senderName=coordinator');
    expect(firstEvent.message.data.content).toContain('senderInstanceKey=swarm-shared');
    expect(firstEvent.message.data.content).toContain('eventType=agent.message');

    const marker = firstEvent.message.metadata[CONTEXT_MESSAGE_MARKER_KEY];
    expect(isJsonObject(marker)).toBe(true);
    if (isJsonObject(marker)) {
      expect(marker.segmentIds).toEqual([
        'runtime.inbound',
        'runtime.call',
        'runtime.route.summary',
      ]);
    }
  });

  it('이미 동일 해시 메시지가 있으면 중복 append하지 않는다', async () => {
    const content = 'Deduplicate this prompt.';
    const promptHash = createHash('sha256').update(content).digest('hex');

    const mock = createMockExtensionApi();
    registerContextMessageExtension(mock.api);

    const emitted: MessageEvent[] = [];
    const existingMessages: Message[] = [
      {
        id: 'existing-system',
        data: {
          role: 'system',
          content,
        },
        metadata: {
          [CONTEXT_MESSAGE_MARKER_KEY]: {
            promptHash,
            segmentIds: ['agent.prompt.system'],
          },
        },
        createdAt: new Date(),
        source: {
          type: 'extension',
          extensionName: 'context-message',
        },
      },
      createMessage('m1', 'hello'),
    ];

    const ctx = createTurnContext({
      emitted,
      messages: existingMessages,
      runtime: {
        agent: {
          name: 'coordinator',
          bundleRoot: '/tmp',
          prompt: { system: content },
        },
        swarm: {
          swarmName: 'default',
          entryAgent: 'coordinator',
          selfAgent: 'coordinator',
          availableAgents: ['coordinator'],
          callableAgents: [],
        },
        inbound: {
          eventId: 'evt-test',
          eventType: 'connector.message',
          sourceKind: 'connector',
          sourceName: 'cli',
          createdAt: new Date().toISOString(),
        },
      },
    });

    const middleware = mock.pipeline.turnMiddlewares[0];
    if (!middleware) {
      throw new Error('Missing context-message middleware');
    }

    await middleware(ctx);

    expect(emitted.length).toBe(0);
    const eventNames = readRuntimeEventNames(ctx.metadata);
    expect(eventNames).toContain('context.message.duplicate');
  });

  it('활성 세그먼트가 없으면 no-op으로 종료하고 empty 이벤트를 남긴다', async () => {
    const mock = createMockExtensionApi();
    registerContextMessageExtension(mock.api, {
      includeAgentPrompt: false,
      includeSwarmCatalog: false,
      includeInboundContext: false,
      includeCallContext: false,
    });

    const emitted: MessageEvent[] = [];
    const ctx = createTurnContext({
      emitted,
      runtime: {
        agent: {
          name: 'coordinator',
          bundleRoot: '/tmp',
        },
        swarm: {
          swarmName: 'default',
          entryAgent: 'coordinator',
          selfAgent: 'coordinator',
          availableAgents: ['coordinator'],
          callableAgents: [],
        },
        inbound: {
          eventId: 'evt-test',
          eventType: 'connector.message',
          sourceKind: 'connector',
          sourceName: 'cli',
          createdAt: new Date().toISOString(),
        },
      },
    });

    const middleware = mock.pipeline.turnMiddlewares[0];
    if (!middleware) {
      throw new Error('Missing context-message middleware');
    }

    await middleware(ctx);

    expect(emitted.length).toBe(0);
    const emptyEvent = findRuntimeEvent(ctx.metadata, 'context.message.empty');
    expect(emptyEvent).toBeDefined();
  });
});
