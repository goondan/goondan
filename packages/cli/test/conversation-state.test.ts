import { describe, expect, it } from 'vitest';
import type { Message } from '@goondan/runtime';
import {
  prepareAnthropicConversation,
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

  it('system role 메시지는 Anthropc messages 배열에서 제외하고 system addendum으로 병합한다', () => {
    const prepared = prepareAnthropicConversation([
      {
        role: 'system',
        content: 'runtime policy 1',
      },
      {
        role: 'user',
        content: '안녕',
      },
      {
        role: 'assistant',
        content: '반가워',
      },
      {
        role: 'system',
        content: [{ type: 'text', text: '[runtime_catalog]\\ncallableAgents=a,b\\n[/runtime_catalog]' }],
      },
      {
        role: 'tool',
        content: 'ignored tool message',
      },
    ]);

    expect(prepared.messages).toEqual([
      { role: 'user', content: '안녕' },
      { role: 'assistant', content: '반가워' },
    ]);
    expect(prepared.systemAddendum).toContain('runtime policy 1');
    expect(prepared.systemAddendum).toContain('[runtime_catalog]');
  });

  it('대화 시작 경계에서 고아가 된 tool_result만 있는 user 메시지는 제거한다', () => {
    const prepared = prepareAnthropicConversation([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-ghost', content: '{"ok":true}' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '다음 질문 주세요.' }],
      },
    ]);

    expect(prepared.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: '다음 질문 주세요.' }],
      },
    ]);
  });

  it('user 메시지의 tool_result는 직전 assistant tool_use와 매칭되는 블록만 유지한다', () => {
    const prepared = prepareAnthropicConversation([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'agents__request', input: { target: 'builder' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: '{"ok":true}' },
          { type: 'tool_result', tool_use_id: 'tool-ghost', content: '{"ok":false}' },
          { type: 'text', text: '도구 실행 결과 참고 부탁해요.' },
        ],
      },
    ]);

    expect(prepared.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'agents__request', input: { target: 'builder' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: '{"ok":true}' },
          { type: 'text', text: '도구 실행 결과 참고 부탁해요.' },
        ],
      },
    ]);
  });
});
