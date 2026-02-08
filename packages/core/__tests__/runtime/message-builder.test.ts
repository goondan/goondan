/**
 * MessageBuilder 테스트
 * @see /docs/specs/runtime.md - 7. Turn 메시지 상태 모델 (Base + Events)
 */
import { describe, it, expect, beforeEach } from 'vitest';
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
    it('메시지를 messageState에 이벤트로 추가하고 nextMessages를 갱신해야 한다', () => {
      const builder = createMessageBuilder();
      const message: LlmMessage = { id: 'msg-1', role: 'user', content: 'Hello!' };

      builder.append(turn, message);

      // messageState.events에 이벤트가 추가됨
      expect(turn.messageState.events.length).toBe(1);
      expect(turn.messageState.events[0].type).toBe('llm_message');

      // nextMessages에 반영됨
      expect(turn.messageState.nextMessages.length).toBe(1);
      expect(turn.messageState.nextMessages[0]).toEqual(message);

      // messages 별칭으로도 접근 가능
      expect(turn.messages.length).toBe(1);
      expect(turn.messages[0]).toEqual(message);
    });

    it('여러 메시지를 순서대로 추가해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { id: 'msg-1', role: 'user', content: 'Hello!' });
      builder.append(turn, { id: 'msg-2', role: 'assistant', content: 'Hi there!' });
      builder.append(turn, { id: 'msg-3', role: 'user', content: 'How are you?' });

      expect(turn.messageState.nextMessages.length).toBe(3);
      expect(turn.messageState.nextMessages[0].role).toBe('user');
      expect(turn.messageState.nextMessages[1].role).toBe('assistant');
      expect(turn.messageState.nextMessages[2].role).toBe('user');

      // events도 3개
      expect(turn.messageState.events.length).toBe(3);
    });

    it('system 메시지는 system_message 이벤트로 추가해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { id: 'msg-sys', role: 'system', content: 'System prompt' });

      expect(turn.messageState.events[0].type).toBe('system_message');
      expect(turn.messageState.nextMessages[0].role).toBe('system');
    });
  });

  describe('getMessages', () => {
    it('Turn의 nextMessages를 반환해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { id: 'msg-1', role: 'user', content: 'Test' });

      const messages = builder.getMessages(turn);
      expect(messages.length).toBe(1);
    });

    it('읽기 전용 배열을 반환해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { id: 'msg-1', role: 'user', content: 'Test' });

      const messages = builder.getMessages(turn);
      expect(Array.isArray(messages)).toBe(true);
    });
  });

  describe('buildLlmMessages', () => {
    it('시스템 프롬프트를 첫 번째 메시지로 추가해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { id: 'msg-1', role: 'user', content: 'Hello!' });

      const llmMessages = builder.buildLlmMessages(turn, 'You are helpful.');

      expect(llmMessages[0]).toEqual({
        id: 'msg-sys-0',
        role: 'system',
        content: 'You are helpful.',
      });
    });

    it('Turn.messages를 순서대로 포함해야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { id: 'msg-1', role: 'user', content: 'Hello!' });
      builder.append(turn, { id: 'msg-2', role: 'assistant', content: 'Hi!' });

      const llmMessages = builder.buildLlmMessages(turn, 'System prompt');

      expect(llmMessages.length).toBe(3);
      expect(llmMessages[0].role).toBe('system');
      expect(llmMessages[1].role).toBe('user');
      expect(llmMessages[2].role).toBe('assistant');
    });

    it('원본 nextMessages 배열을 수정하지 않아야 한다', () => {
      const builder = createMessageBuilder();

      builder.append(turn, { id: 'msg-1', role: 'user', content: 'Hello!' });

      const originalLength = turn.messageState.nextMessages.length;
      builder.buildLlmMessages(turn, 'System prompt');

      expect(turn.messageState.nextMessages.length).toBe(originalLength);
    });
  });
});

describe('buildLlmMessages (standalone function)', () => {
  it('시스템 프롬프트와 메시지를 결합해야 한다', () => {
    const messages: LlmMessage[] = [
      { id: 'msg-1', role: 'user', content: 'What is 2+2?' },
    ];

    const result = buildLlmMessages(messages, 'You are a math tutor.');

    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ id: 'msg-sys-0', role: 'system', content: 'You are a math tutor.' });
    expect(result[1]).toEqual({ id: 'msg-1', role: 'user', content: 'What is 2+2?' });
  });

  it('빈 메시지 배열도 처리해야 한다', () => {
    const result = buildLlmMessages([], 'System prompt');

    expect(result.length).toBe(1);
    expect(result[0].role).toBe('system');
  });

  it('tool call과 tool result 메시지를 포함해야 한다', () => {
    const messages: LlmMessage[] = [
      { id: 'msg-1', role: 'user', content: 'List files' },
      {
        id: 'msg-2',
        role: 'assistant',
        toolCalls: [{ id: 'call_1', name: 'file.list', args: {} }],
      },
      {
        id: 'msg-3',
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
    builder.append(turn, { id: 'msg-1', role: 'user', content: '파일 목록을 보여줘' });

    // --- Step 0 ---
    // 2. LLM 응답 (tool call 요청)
    builder.append(turn, {
      id: 'msg-2',
      role: 'assistant',
      toolCalls: [{ id: 'call_001', name: 'file.list', args: { path: '.' } }],
    });

    // 3. Tool 결과
    builder.append(turn, {
      id: 'msg-3',
      role: 'tool',
      toolCallId: 'call_001',
      toolName: 'file.list',
      output: { files: ['README.md', 'package.json'] },
    });

    // --- Step 1 ---
    // 4. LLM 응답 (최종)
    builder.append(turn, {
      id: 'msg-4',
      role: 'assistant',
      content: '현재 디렉토리에 README.md와 package.json 파일이 있습니다.',
    });

    expect(turn.messageState.nextMessages.length).toBe(4);
    expect(turn.messageState.events.length).toBe(4);

    // LLM 요청 메시지 생성
    const llmMessages = builder.buildLlmMessages(turn, 'You are a file assistant.');

    expect(llmMessages.length).toBe(5); // system + 4 messages
    expect(llmMessages[0].role).toBe('system');
  });

  it('다중 tool call 시나리오를 처리해야 한다', () => {
    // 1. 사용자 입력
    builder.append(turn, { id: 'msg-1', role: 'user', content: 'a.txt와 b.txt 내용을 읽어줘' });

    // 2. LLM 응답 (다중 tool call)
    builder.append(turn, {
      id: 'msg-2',
      role: 'assistant',
      toolCalls: [
        { id: 'call_001', name: 'file.read', args: { path: 'a.txt' } },
        { id: 'call_002', name: 'file.read', args: { path: 'b.txt' } },
      ],
    });

    // 3. Tool 결과들
    builder.append(turn, {
      id: 'msg-3',
      role: 'tool',
      toolCallId: 'call_001',
      toolName: 'file.read',
      output: { content: 'Content of a.txt' },
    });
    builder.append(turn, {
      id: 'msg-4',
      role: 'tool',
      toolCallId: 'call_002',
      toolName: 'file.read',
      output: { content: 'Content of b.txt' },
    });

    expect(turn.messageState.nextMessages.length).toBe(4);

    // tool 메시지들이 순서대로 있는지 확인
    const toolMessages = turn.messageState.nextMessages.filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBe(2);
  });

  it('baseMessages와 events 기반으로 nextMessages가 올바르게 계산되어야 한다', () => {
    // baseMessages가 있는 Turn
    const baseMessages: LlmMessage[] = [
      { id: 'base-1', role: 'user', content: '이전 대화' },
      { id: 'base-2', role: 'assistant', content: '이전 응답' },
    ];
    const swarmInstance = createSwarmInstance('Swarm/test', 'key', 'ref');
    const agentInstance = createAgentInstance(swarmInstance, 'Agent/test');
    const event = createAgentEvent('user.input', '새로운 질문');
    const turnWithBase = createTurn(agentInstance, event, baseMessages);
    const b = createMessageBuilder();

    // baseMessages가 nextMessages에 이미 포함
    expect(turnWithBase.messageState.baseMessages.length).toBe(2);
    expect(turnWithBase.messageState.nextMessages.length).toBe(2);

    // 새 메시지 추가
    b.append(turnWithBase, { id: 'msg-new', role: 'user', content: '새로운 질문' });

    // nextMessages = base(2) + event(1) = 3
    expect(turnWithBase.messageState.nextMessages.length).toBe(3);
    expect(turnWithBase.messageState.events.length).toBe(1);
  });
});
