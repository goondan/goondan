/**
 * MessageBuilder 테스트
 * @see /docs/specs/runtime.md - 7. Turn.messages 누적 규칙
 */
import { describe, it, expect } from 'vitest';
import {
  MessageBuilder,
  createMessageBuilder,
  buildLlmMessages,
} from '../../src/runtime/message-builder.js';
import { createSwarmInstance } from '../../src/runtime/swarm-instance.js';
import { createAgentInstance } from '../../src/runtime/agent-instance.js';
import { createTurn } from '../../src/runtime/turn-runner.js';
import { createAgentEvent } from '../../src/runtime/types.js';
import type { Turn } from '../../src/runtime/turn-runner.js';
import type { LlmMessage } from '../../src/runtime/types.js';

describe('MessageBuilder', () => {
  let turn: Turn;

  beforeEach(() => {
    const swarmInstance = createSwarmInstance(
      'Swarm/test-swarm',
      'instance-key',
      'bundle-ref'
    );
    const agentInstance = createAgentInstance(swarmInstance, 'Agent/planner');
    const event = createAgentEvent('user.input', 'Hello!');
    turn = createTurn(agentInstance, event);
  });

  describe('createMessageBuilder', () => {
    it('MessageBuilder 인스턴스를 생성해야 한다', () => {
      const builder = createMessageBuilder();
      expect(builder).toBeDefined();
      expect(typeof builder.append).toBe('function');
      expect(typeof builder.getMessages).toBe('function');
      expect(typeof builder.buildLlmMessages).toBe('function');
    });
  });

  describe('append', () => {
    it('메시지를 Turn.messages에 추가해야 한다', () => {
      const builder = createMessageBuilder();
      const message: LlmMessage = { role: 'user', content: 'Hello!' };

      builder.append(turn, message);

      expect(turn.messages.length).toBe(1);
      expect(turn.messages[0]).toEqual(message);
    });

    it('여러 메시지를 순서대로 추가해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { role: 'user', content: 'Hello!' });
      builder.append(turn, { role: 'assistant', content: 'Hi there!' });
      builder.append(turn, { role: 'user', content: 'How are you?' });

      expect(turn.messages.length).toBe(3);
      expect(turn.messages[0].role).toBe('user');
      expect(turn.messages[1].role).toBe('assistant');
      expect(turn.messages[2].role).toBe('user');
    });
  });

  describe('getMessages', () => {
    it('Turn의 메시지 목록을 반환해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { role: 'user', content: 'Test' });

      const messages = builder.getMessages(turn);
      expect(messages.length).toBe(1);
    });

    it('읽기 전용 배열을 반환해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { role: 'user', content: 'Test' });

      const messages = builder.getMessages(turn);
      expect(Array.isArray(messages)).toBe(true);
    });
  });

  describe('buildLlmMessages', () => {
    it('시스템 프롬프트를 첫 번째 메시지로 추가해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { role: 'user', content: 'Hello!' });

      const llmMessages = builder.buildLlmMessages(turn, 'You are helpful.');

      expect(llmMessages[0]).toEqual({
        role: 'system',
        content: 'You are helpful.',
      });
    });

    it('Turn.messages를 순서대로 포함해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { role: 'user', content: 'Hello!' });
      builder.append(turn, { role: 'assistant', content: 'Hi!' });

      const llmMessages = builder.buildLlmMessages(turn, 'System prompt');

      expect(llmMessages.length).toBe(3);
      expect(llmMessages[0].role).toBe('system');
      expect(llmMessages[1].role).toBe('user');
      expect(llmMessages[2].role).toBe('assistant');
    });

    it('원본 messages 배열을 수정하지 않아야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { role: 'user', content: 'Hello!' });

      const originalLength = turn.messages.length;
      builder.buildLlmMessages(turn, 'System prompt');

      expect(turn.messages.length).toBe(originalLength);
    });
  });
});

describe('buildLlmMessages (standalone function)', () => {
  it('시스템 프롬프트와 메시지를 결합해야 한다', () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: 'What is 2+2?' },
    ];

    const result = buildLlmMessages(messages, 'You are a math tutor.');

    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ role: 'system', content: 'You are a math tutor.' });
    expect(result[1]).toEqual({ role: 'user', content: 'What is 2+2?' });
  });

  it('빈 메시지 배열도 처리해야 한다', () => {
    const result = buildLlmMessages([], 'System prompt');

    expect(result.length).toBe(1);
    expect(result[0].role).toBe('system');
  });

  it('tool call과 tool result 메시지를 포함해야 한다', () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: 'List files' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'call_1', name: 'file.list', input: {} }],
      },
      {
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'file.list',
        output: { files: ['a.txt'] },
      },
    ];

    const result = buildLlmMessages(messages, 'System');

    expect(result.length).toBe(4);
    expect(result[2].role).toBe('assistant');
    expect(result[3].role).toBe('tool');
  });
});

describe('메시지 누적 시나리오', () => {
  let turn: Turn;
  let builder: MessageBuilder;

  beforeEach(() => {
    const swarmInstance = createSwarmInstance(
      'Swarm/test-swarm',
      'instance-key',
      'bundle-ref'
    );
    const agentInstance = createAgentInstance(swarmInstance, 'Agent/planner');
    const event = createAgentEvent('user.input', '파일 목록을 보여줘');
    turn = createTurn(agentInstance, event);
    builder = createMessageBuilder();
  });

  it('일반적인 tool call 시나리오를 처리해야 한다', () => {
    // 1. 사용자 입력
    builder.append(turn, { role: 'user', content: '파일 목록을 보여줘' });

    // --- Step 0 ---
    // 2. LLM 응답 (tool call 요청)
    builder.append(turn, {
      role: 'assistant',
      toolCalls: [{ id: 'call_001', name: 'file.list', input: { path: '.' } }],
    });

    // 3. Tool 결과
    builder.append(turn, {
      role: 'tool',
      toolCallId: 'call_001',
      toolName: 'file.list',
      output: { files: ['README.md', 'package.json'] },
    });

    // --- Step 1 ---
    // 4. LLM 응답 (최종)
    builder.append(turn, {
      role: 'assistant',
      content: '현재 디렉토리에 README.md와 package.json 파일이 있습니다.',
    });

    expect(turn.messages.length).toBe(4);

    // LLM 요청 메시지 생성
    const llmMessages = builder.buildLlmMessages(turn, 'You are a file assistant.');

    expect(llmMessages.length).toBe(5); // system + 4 messages
    expect(llmMessages[0].role).toBe('system');
  });

  it('다중 tool call 시나리오를 처리해야 한다', () => {
    // 1. 사용자 입력
    builder.append(turn, { role: 'user', content: 'a.txt와 b.txt 내용을 읽어줘' });

    // 2. LLM 응답 (다중 tool call)
    builder.append(turn, {
      role: 'assistant',
      toolCalls: [
        { id: 'call_001', name: 'file.read', input: { path: 'a.txt' } },
        { id: 'call_002', name: 'file.read', input: { path: 'b.txt' } },
      ],
    });

    // 3. Tool 결과들
    builder.append(turn, {
      role: 'tool',
      toolCallId: 'call_001',
      toolName: 'file.read',
      output: { content: 'Content of a.txt' },
    });
    builder.append(turn, {
      role: 'tool',
      toolCallId: 'call_002',
      toolName: 'file.read',
      output: { content: 'Content of b.txt' },
    });

    expect(turn.messages.length).toBe(4);

    // tool 메시지들이 순서대로 있는지 확인
    const toolMessages = turn.messages.filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBe(2);
  });
});

// Import beforeEach from vitest
import { beforeEach } from 'vitest';
