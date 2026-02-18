import { describe, expect, it } from 'vitest';
import type { Message } from '../src/index.js';
import {
  type ConversationTurn,
  toConversationTurns,
  toPersistentMessages,
} from '../src/runner/conversation-state.js';

describe('runner conversation-state', () => {
  it('assistant/user만 대화 턴으로 변환한다', () => {
    const messages: Message[] = [
      {
        id: 'm-1',
        data: {
          role: 'system',
          content: 'sys',
        },
        metadata: {},
        createdAt: new Date('2026-02-16T00:00:00.000Z'),
        source: {
          type: 'system',
        },
      },
      {
        id: 'm-2',
        data: {
          role: 'user',
          content: 'u1',
        },
        metadata: {},
        createdAt: new Date('2026-02-16T00:00:00.000Z'),
        source: {
          type: 'user',
        },
      },
      {
        id: 'm-3',
        data: {
          role: 'assistant',
          content: [{ type: 'text', text: 'a1' }],
        },
        metadata: {},
        createdAt: new Date('2026-02-16T00:00:00.000Z'),
        source: {
          type: 'assistant',
          stepId: 'step-1',
        },
      },
      {
        id: 'm-4',
        data: {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 't1', output: { type: 'text', value: 'ok' } }],
        },
        metadata: {},
        createdAt: new Date('2026-02-16T00:00:00.000Z'),
        source: {
          type: 'tool',
          toolCallId: 'c1',
          toolName: 't1',
        },
      },
    ];

    const turns = toConversationTurns(messages);
    expect(turns).toEqual([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
    ]);
  });

  it('대화 턴을 persistent message로 변환한다', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: '질문' },
      { role: 'assistant', content: [{ type: 'text', text: '답변' }] },
    ];

    const persistent = toPersistentMessages(turns);
    expect(persistent).toHaveLength(2);
    expect(persistent[0]?.data.role).toBe('user');
    expect(persistent[1]?.data.role).toBe('assistant');
  });

  it('user 메타데이터를 턴/영속 메시지 변환에서 유지한다', () => {
    const messages: Message[] = [
      {
        id: 'm-meta-1',
        data: {
          role: 'user',
          content: 'inbound',
        },
        metadata: {
          __goondanInbound: {
            sourceKind: 'agent',
            sourceName: 'coordinator',
            eventName: 'agent.request',
            instanceKey: 'worker:brain-shared',
          },
        },
        createdAt: new Date('2026-02-16T00:00:00.000Z'),
        source: {
          type: 'user',
        },
      },
    ];

    const turns = toConversationTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.metadata).toEqual({
      __goondanInbound: {
        sourceKind: 'agent',
        sourceName: 'coordinator',
        eventName: 'agent.request',
        instanceKey: 'worker:brain-shared',
      },
    });

    const persistent = toPersistentMessages(turns);
    expect(persistent).toHaveLength(1);
    expect(persistent[0]?.metadata).toEqual({
      __goondanInbound: {
        sourceKind: 'agent',
        sourceName: 'coordinator',
        eventName: 'agent.request',
        instanceKey: 'worker:brain-shared',
      },
    });
  });
});
