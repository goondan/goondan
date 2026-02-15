import { describe, expect, it } from 'vitest';
import type { Message } from '@goondan/runtime';
import {
  toAnthropicMessages,
  type ConversationTurn,
  toConversationTurns,
  toConversationTurnsFromAnthropicMessages,
  toPersistentMessages,
  trimConversation,
} from '../src/services/conversation-state.js';

describe('conversation-state', () => {
  it('non-string content를 stringify하지 않고 그대로 유지한다', () => {
    const assistantContent = [
      { type: 'text', text: '작업 시작' },
      { type: 'tool_use', id: 'tool-1', name: 'agents__spawn', input: { target: 'builder' } },
    ];

    const messages: Message[] = [
      {
        id: 'm-1',
        data: {
          role: 'assistant',
          content: assistantContent,
        },
        metadata: {},
        createdAt: new Date('2026-02-16T00:00:00.000Z'),
        source: {
          type: 'assistant',
          stepId: 'step-1',
        },
      },
    ];

    const turns = toConversationTurns(messages);
    expect(turns).toHaveLength(1);
    const first = turns[0];
    if (!first) {
      throw new Error('conversation turn missing');
    }
    expect(Array.isArray(first.content)).toBe(true);

    const persistent = toPersistentMessages(turns);
    const persisted = persistent[0];
    if (!persisted) {
      throw new Error('persistent message missing');
    }
    expect(Array.isArray(persisted.data.content)).toBe(true);
  });

  it('anthropic 메시지의 tool_use/tool_result 블록을 대화 턴으로 복원한다', () => {
    const anthropicMessages: unknown[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-2', name: 'channel-dispatch__send', input: { channel: 'telegram' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-2', content: '{"ok":true}' },
        ],
      },
    ];

    const turns = toConversationTurnsFromAnthropicMessages(anthropicMessages);
    expect(turns).toHaveLength(2);
    expect(Array.isArray(turns[0]?.content)).toBe(true);
    expect(Array.isArray(turns[1]?.content)).toBe(true);

    const roundtrip = toAnthropicMessages(turns);
    expect(roundtrip).toEqual(anthropicMessages);
  });

  it('trimConversation은 최대 턴 수(2x)를 유지한다', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a3' },
    ];

    const trimmed = trimConversation(turns, 2);
    expect(trimmed).toHaveLength(4);
    expect(trimmed.map((turn) => turn.content)).toEqual(['u2', 'a2', 'u3', 'a3']);
  });
});
