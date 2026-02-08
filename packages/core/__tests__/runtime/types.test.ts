/**
 * Runtime 타입 테스트
 * @see /docs/specs/runtime.md
 */
import { describe, it, expect } from 'vitest';
import type {
  SwarmBundleRef,
  SwarmInstanceStatus,
  AgentInstanceStatus,
  TurnStatus,
  StepStatus,
  AgentEventType,
  TurnOrigin,
  TurnAuth,
  LlmMessage,
  LlmSystemMessage,
  LlmUserMessage,
  LlmAssistantMessage,
  LlmToolMessage,
  LlmResult,
  ToolCall,
  ToolResult,
  ContextBlock,
  ToolCatalogItem,
  AgentEvent,
  MessageEvent,
  TurnMessageState,
  TokenUsage,
  StepMetrics,
  TurnMetrics,
  RuntimeLogEntry,
  HealthCheckResult,
  InstanceGcPolicy,
} from '../../src/runtime/types.js';
import {
  isLlmSystemMessage,
  isLlmUserMessage,
  isLlmAssistantMessage,
  isLlmToolMessage,
  isSystemMessageEvent,
  isLlmMessageEvent,
  isReplaceMessageEvent,
  isRemoveMessageEvent,
  isTruncateMessageEvent,
  computeNextMessages,
  createTurnMessageState,
  maskSensitiveValue,
  isSensitiveKey,
  maskSensitiveFields,
  createToolCall,
  createToolResult,
  createAgentEvent,
} from '../../src/runtime/types.js';

describe('Runtime 타입', () => {
  describe('SwarmBundleRef', () => {
    it('string 타입이어야 한다', () => {
      const ref: SwarmBundleRef = 'git:abc123def456';
      expect(typeof ref).toBe('string');
    });
  });

  describe('SwarmInstanceStatus', () => {
    it('active, idle, paused, terminated 값을 가질 수 있다', () => {
      const statuses: SwarmInstanceStatus[] = ['active', 'idle', 'paused', 'terminated'];
      expect(statuses).toContain('active');
      expect(statuses).toContain('idle');
      expect(statuses).toContain('paused');
      expect(statuses).toContain('terminated');
    });
  });

  describe('AgentInstanceStatus', () => {
    it('idle, processing, terminated 값을 가질 수 있다', () => {
      const statuses: AgentInstanceStatus[] = ['idle', 'processing', 'terminated'];
      expect(statuses).toContain('idle');
      expect(statuses).toContain('processing');
      expect(statuses).toContain('terminated');
    });
  });

  describe('TurnStatus', () => {
    it('pending, running, completed, failed, interrupted 값을 가질 수 있다', () => {
      const statuses: TurnStatus[] = [
        'pending',
        'running',
        'completed',
        'failed',
        'interrupted',
      ];
      expect(statuses.length).toBe(5);
    });
  });

  describe('StepStatus', () => {
    it('각 단계별 상태 값을 가질 수 있다', () => {
      const statuses: StepStatus[] = [
        'pending',
        'config',
        'tools',
        'blocks',
        'llmCall',
        'toolExec',
        'post',
        'completed',
        'failed',
      ];
      expect(statuses.length).toBe(9);
    });
  });

  describe('AgentEventType', () => {
    it('표준 이벤트 타입들을 포함해야 한다', () => {
      const eventTypes: AgentEventType[] = [
        'user.input',
        'agent.delegate',
        'agent.delegationResult',
        'auth.granted',
        'system.wakeup',
        'custom.event',
      ];
      expect(eventTypes).toContain('user.input');
      expect(eventTypes).toContain('agent.delegate');
    });
  });

  describe('TurnOrigin', () => {
    it('connector, channel, threadTs 필드를 가질 수 있다', () => {
      const origin: TurnOrigin = {
        connector: 'slack-main',
        channel: 'C12345',
        threadTs: '1234567890.123456',
      };
      expect(origin.connector).toBe('slack-main');
      expect(origin.channel).toBe('C12345');
      expect(origin.threadTs).toBe('1234567890.123456');
    });

    it('추가 맥락 정보를 포함할 수 있다', () => {
      const origin: TurnOrigin = {
        connector: 'cli',
        sessionId: 'session-123',
        cwd: '/home/user',
      };
      expect(origin['sessionId']).toBe('session-123');
      expect(origin['cwd']).toBe('/home/user');
    });
  });

  describe('TurnAuth', () => {
    it('actor 정보를 포함할 수 있다', () => {
      const auth: TurnAuth = {
        actor: {
          type: 'user',
          id: 'slack:U123456',
          display: 'John Doe',
        },
      };
      expect(auth.actor?.type).toBe('user');
      expect(auth.actor?.id).toBe('slack:U123456');
    });

    it('subjects 정보를 포함할 수 있다', () => {
      const auth: TurnAuth = {
        subjects: {
          global: 'slack:team:T111',
          user: 'slack:user:T111:U234567',
        },
      };
      expect(auth.subjects?.global).toBe('slack:team:T111');
      expect(auth.subjects?.user).toBe('slack:user:T111:U234567');
    });
  });

  describe('LlmMessage', () => {
    describe('LlmSystemMessage', () => {
      it('id와 role이 system이어야 한다', () => {
        const msg: LlmSystemMessage = {
          id: 'msg-1',
          role: 'system',
          content: 'You are a helpful assistant.',
        };
        expect(msg.id).toBe('msg-1');
        expect(msg.role).toBe('system');
        expect(msg.content).toBe('You are a helpful assistant.');
      });
    });

    describe('LlmUserMessage', () => {
      it('id와 role이 user이어야 한다', () => {
        const msg: LlmUserMessage = {
          id: 'msg-2',
          role: 'user',
          content: 'Hello, world!',
        };
        expect(msg.id).toBe('msg-2');
        expect(msg.role).toBe('user');
        expect(msg.content).toBe('Hello, world!');
      });
    });

    describe('LlmAssistantMessage', () => {
      it('id와 role이 assistant이어야 한다', () => {
        const msg: LlmAssistantMessage = {
          id: 'msg-3',
          role: 'assistant',
          content: 'Hello! How can I help you?',
        };
        expect(msg.id).toBe('msg-3');
        expect(msg.role).toBe('assistant');
      });

      it('toolCalls를 포함할 수 있다', () => {
        const msg: LlmAssistantMessage = {
          id: 'msg-4',
          role: 'assistant',
          toolCalls: [
            {
              id: 'call_001',
              name: 'file.list',
              args: { path: '.' },
            },
          ],
        };
        expect(msg.toolCalls?.length).toBe(1);
        expect(msg.toolCalls?.[0].name).toBe('file.list');
      });
    });

    describe('LlmToolMessage', () => {
      it('id와 role이 tool이어야 한다', () => {
        const msg: LlmToolMessage = {
          id: 'msg-5',
          role: 'tool',
          toolCallId: 'call_001',
          toolName: 'file.list',
          output: { files: ['README.md'] },
        };
        expect(msg.id).toBe('msg-5');
        expect(msg.role).toBe('tool');
        expect(msg.toolCallId).toBe('call_001');
        expect(msg.toolName).toBe('file.list');
      });
    });
  });

  describe('LlmMessage 타입 가드', () => {
    it('isLlmSystemMessage는 system role을 구분해야 한다', () => {
      const systemMsg: LlmMessage = { id: 'msg-1', role: 'system', content: 'test' };
      const userMsg: LlmMessage = { id: 'msg-2', role: 'user', content: 'test' };

      expect(isLlmSystemMessage(systemMsg)).toBe(true);
      expect(isLlmSystemMessage(userMsg)).toBe(false);
    });

    it('isLlmUserMessage는 user role을 구분해야 한다', () => {
      const userMsg: LlmMessage = { id: 'msg-1', role: 'user', content: 'test' };
      const assistantMsg: LlmMessage = { id: 'msg-2', role: 'assistant', content: 'test' };

      expect(isLlmUserMessage(userMsg)).toBe(true);
      expect(isLlmUserMessage(assistantMsg)).toBe(false);
    });

    it('isLlmAssistantMessage는 assistant role을 구분해야 한다', () => {
      const assistantMsg: LlmMessage = { id: 'msg-1', role: 'assistant', content: 'test' };
      const toolMsg: LlmMessage = {
        id: 'msg-2',
        role: 'tool',
        toolCallId: 'call_001',
        toolName: 'test',
        output: null,
      };

      expect(isLlmAssistantMessage(assistantMsg)).toBe(true);
      expect(isLlmAssistantMessage(toolMsg)).toBe(false);
    });

    it('isLlmToolMessage는 tool role을 구분해야 한다', () => {
      const toolMsg: LlmMessage = {
        id: 'msg-1',
        role: 'tool',
        toolCallId: 'call_001',
        toolName: 'test',
        output: null,
      };
      const systemMsg: LlmMessage = { id: 'msg-2', role: 'system', content: 'test' };

      expect(isLlmToolMessage(toolMsg)).toBe(true);
      expect(isLlmToolMessage(systemMsg)).toBe(false);
    });
  });

  describe('LlmResult', () => {
    it('message와 meta 정보를 포함해야 한다', () => {
      const result: LlmResult = {
        message: {
          id: 'msg-1',
          role: 'assistant',
          content: 'Hello!',
        },
        meta: {
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
          finishReason: 'stop',
        },
      };
      expect(result.message.role).toBe('assistant');
      expect(result.meta.usage?.totalTokens).toBe(150);
      expect(result.meta.finishReason).toBe('stop');
    });
  });

  describe('ToolCall', () => {
    it('id, name, args를 가져야 한다', () => {
      const toolCall: ToolCall = {
        id: 'call_001',
        name: 'file.read',
        args: { path: '/tmp/test.txt' },
      };
      expect(toolCall.id).toBe('call_001');
      expect(toolCall.name).toBe('file.read');
      expect(toolCall.args).toEqual({ path: '/tmp/test.txt' });
    });
  });

  describe('createToolCall', () => {
    it('ToolCall 객체를 생성해야 한다', () => {
      const toolCall = createToolCall('file.read', { path: '/test' });
      expect(toolCall.id).toBeDefined();
      expect(toolCall.name).toBe('file.read');
      expect(toolCall.args).toEqual({ path: '/test' });
    });

    it('커스텀 id를 지정할 수 있다', () => {
      const toolCall = createToolCall('file.read', { path: '/test' }, 'my-custom-id');
      expect(toolCall.id).toBe('my-custom-id');
    });
  });

  describe('ToolResult', () => {
    it('동기 완료 시 output과 status를 포함해야 한다', () => {
      const result: ToolResult = {
        toolCallId: 'call_001',
        toolName: 'file.read',
        status: 'ok',
        output: { content: 'file contents' },
      };
      expect(result.status).toBe('ok');
      expect(result.output).toEqual({ content: 'file contents' });
    });

    it('비동기 제출 시 handle을 포함할 수 있다', () => {
      const result: ToolResult = {
        toolCallId: 'call_001',
        toolName: 'async.task',
        status: 'pending',
        handle: 'task_handle_123',
      };
      expect(result.status).toBe('pending');
      expect(result.handle).toBe('task_handle_123');
    });

    it('오류 시 error 정보를 포함할 수 있다', () => {
      const result: ToolResult = {
        toolCallId: 'call_001',
        toolName: 'file.read',
        status: 'error',
        error: {
          message: 'File not found',
          name: 'NotFoundError',
          code: 'E_NOT_FOUND',
        },
      };
      expect(result.status).toBe('error');
      expect(result.error?.message).toBe('File not found');
    });
  });

  describe('createToolResult', () => {
    it('성공 결과를 생성해야 한다', () => {
      const result = createToolResult('call_001', 'file.read', { content: 'data' });
      expect(result.toolCallId).toBe('call_001');
      expect(result.toolName).toBe('file.read');
      expect(result.status).toBe('ok');
      expect(result.output).toEqual({ content: 'data' });
    });

    it('에러 결과를 생성해야 한다', () => {
      const error = new Error('Something went wrong');
      const result = createToolResult('call_001', 'file.read', undefined, error);
      expect(result.status).toBe('error');
      expect(result.error?.message).toBe('Something went wrong');
    });
  });

  describe('ContextBlock', () => {
    it('type과 data를 가질 수 있다', () => {
      const block: ContextBlock = {
        type: 'messages',
        data: { count: 10 },
      };
      expect(block.type).toBe('messages');
      expect(block.data).toEqual({ count: 10 });
    });

    it('items 배열을 가질 수 있다', () => {
      const block: ContextBlock = {
        type: 'skills',
        items: [{ name: 'skill1' }, { name: 'skill2' }],
      };
      expect(block.items?.length).toBe(2);
    });
  });

  describe('ToolCatalogItem', () => {
    it('name, description, parameters를 가져야 한다', () => {
      const item: ToolCatalogItem = {
        name: 'file.read',
        description: 'Read file contents',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      };
      expect(item.name).toBe('file.read');
      expect(item.description).toBe('Read file contents');
    });
  });

  describe('AgentEvent', () => {
    it('필수 필드를 가져야 한다', () => {
      const event: AgentEvent = {
        id: 'evt_001',
        type: 'user.input',
        input: 'Hello!',
        createdAt: new Date(),
      };
      expect(event.id).toBe('evt_001');
      expect(event.type).toBe('user.input');
      expect(event.input).toBe('Hello!');
    });

    it('origin과 auth를 포함할 수 있다', () => {
      const event: AgentEvent = {
        id: 'evt_001',
        type: 'user.input',
        input: 'Hello!',
        origin: { connector: 'slack' },
        auth: { actor: { type: 'user', id: 'U123' } },
        createdAt: new Date(),
      };
      expect(event.origin?.connector).toBe('slack');
      expect(event.auth?.actor?.id).toBe('U123');
    });
  });

  describe('createAgentEvent', () => {
    it('AgentEvent 객체를 생성해야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      expect(event.id).toBeDefined();
      expect(event.type).toBe('user.input');
      expect(event.input).toBe('Hello!');
      expect(event.createdAt).toBeInstanceOf(Date);
    });

    it('origin과 auth를 설정할 수 있다', () => {
      const event = createAgentEvent(
        'user.input',
        'Hello!',
        { connector: 'cli' },
        { actor: { type: 'user', id: 'user1' } }
      );
      expect(event.origin?.connector).toBe('cli');
      expect(event.auth?.actor?.id).toBe('user1');
    });
  });
});

describe('MessageEvent', () => {
  describe('타입 가드', () => {
    it('isSystemMessageEvent는 system_message 타입을 구분해야 한다', () => {
      const event: MessageEvent = {
        type: 'system_message',
        seq: 0,
        message: { id: 'msg-1', role: 'system', content: 'test' },
      };
      expect(isSystemMessageEvent(event)).toBe(true);
    });

    it('isLlmMessageEvent는 llm_message 타입을 구분해야 한다', () => {
      const event: MessageEvent = {
        type: 'llm_message',
        seq: 0,
        message: { id: 'msg-1', role: 'user', content: 'test' },
      };
      expect(isLlmMessageEvent(event)).toBe(true);
    });

    it('isReplaceMessageEvent는 replace 타입을 구분해야 한다', () => {
      const event: MessageEvent = {
        type: 'replace',
        seq: 0,
        targetId: 'msg-1',
        message: { id: 'msg-2', role: 'user', content: 'replaced' },
      };
      expect(isReplaceMessageEvent(event)).toBe(true);
    });

    it('isRemoveMessageEvent는 remove 타입을 구분해야 한다', () => {
      const event: MessageEvent = {
        type: 'remove',
        seq: 0,
        targetId: 'msg-1',
      };
      expect(isRemoveMessageEvent(event)).toBe(true);
    });

    it('isTruncateMessageEvent는 truncate 타입을 구분해야 한다', () => {
      const event: MessageEvent = {
        type: 'truncate',
        seq: 0,
      };
      expect(isTruncateMessageEvent(event)).toBe(true);
    });
  });
});

describe('TurnMessageState', () => {
  describe('createTurnMessageState', () => {
    it('빈 TurnMessageState를 생성해야 한다', () => {
      const state = createTurnMessageState();

      expect(state.baseMessages).toEqual([]);
      expect(state.events).toEqual([]);
      expect(state.nextMessages).toEqual([]);
    });

    it('baseMessages로 초기화할 수 있어야 한다', () => {
      const base = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello' },
      ];
      const state = createTurnMessageState(base);

      expect(state.baseMessages.length).toBe(1);
      expect(state.nextMessages.length).toBe(1);
      expect(state.nextMessages[0].id).toBe('msg-1');
    });

    it('baseMessages의 복사본을 사용해야 한다 (불변성)', () => {
      const base = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello' },
      ];
      const state = createTurnMessageState(base);

      base.push({ id: 'msg-2', role: 'user' as const, content: 'Added' });
      expect(state.baseMessages.length).toBe(1);
    });
  });

  describe('computeNextMessages', () => {
    it('빈 이벤트에서는 baseMessages를 반환해야 한다', () => {
      const base = [{ id: 'msg-1', role: 'user' as const, content: 'Hello' }];
      const result = computeNextMessages(base, []);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('msg-1');
    });

    it('system_message 이벤트를 추가해야 한다', () => {
      const base: LlmMessage[] = [];
      const events: MessageEvent[] = [
        {
          type: 'system_message',
          seq: 0,
          message: { id: 'msg-sys-1', role: 'system', content: 'System prompt' },
        },
      ];
      const result = computeNextMessages(base, events);

      expect(result.length).toBe(1);
      expect(result[0].role).toBe('system');
    });

    it('llm_message 이벤트를 추가해야 한다', () => {
      const base: LlmMessage[] = [];
      const events: MessageEvent[] = [
        {
          type: 'llm_message',
          seq: 0,
          message: { id: 'msg-1', role: 'user', content: 'Hello' },
        },
        {
          type: 'llm_message',
          seq: 1,
          message: { id: 'msg-2', role: 'assistant', content: 'Hi!' },
        },
      ];
      const result = computeNextMessages(base, events);

      expect(result.length).toBe(2);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });

    it('replace 이벤트로 메시지를 교체해야 한다', () => {
      const base: LlmMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Original' },
      ];
      const events: MessageEvent[] = [
        {
          type: 'replace',
          seq: 0,
          targetId: 'msg-1',
          message: { id: 'msg-1', role: 'user', content: 'Replaced' },
        },
      ];
      const result = computeNextMessages(base, events);

      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      if (result[0].role === 'user') {
        expect(result[0].content).toBe('Replaced');
      }
    });

    it('remove 이벤트로 메시지를 제거해야 한다', () => {
      const base: LlmMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi' },
      ];
      const events: MessageEvent[] = [
        { type: 'remove', seq: 0, targetId: 'msg-1' },
      ];
      const result = computeNextMessages(base, events);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('msg-2');
    });

    it('truncate 이벤트로 모든 메시지를 제거해야 한다', () => {
      const base: LlmMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi' },
      ];
      const events: MessageEvent[] = [
        { type: 'truncate', seq: 0 },
      ];
      const result = computeNextMessages(base, events);

      expect(result.length).toBe(0);
    });

    it('복합 이벤트를 순서대로 적용해야 한다', () => {
      const base: LlmMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
      ];
      const events: MessageEvent[] = [
        {
          type: 'llm_message',
          seq: 0,
          message: { id: 'msg-2', role: 'assistant', content: 'Hi' },
        },
        {
          type: 'llm_message',
          seq: 1,
          message: { id: 'msg-3', role: 'user', content: 'More' },
        },
        { type: 'remove', seq: 2, targetId: 'msg-2' },
      ];
      const result = computeNextMessages(base, events);

      expect(result.length).toBe(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-3');
    });
  });
});

describe('Observability 타입', () => {
  describe('TokenUsage', () => {
    it('토큰 사용량을 표현할 수 있다', () => {
      const usage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };
      expect(usage.totalTokens).toBe(150);
    });
  });

  describe('StepMetrics', () => {
    it('Step 메트릭을 표현할 수 있다', () => {
      const metrics: StepMetrics = {
        latencyMs: 1200,
        toolCallCount: 3,
        errorCount: 0,
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
      expect(metrics.latencyMs).toBe(1200);
      expect(metrics.toolCallCount).toBe(3);
    });
  });

  describe('TurnMetrics', () => {
    it('Turn 메트릭을 표현할 수 있다', () => {
      const metrics: TurnMetrics = {
        latencyMs: 5000,
        stepCount: 3,
        toolCallCount: 5,
        errorCount: 1,
        tokenUsage: { promptTokens: 300, completionTokens: 150, totalTokens: 450 },
      };
      expect(metrics.stepCount).toBe(3);
      expect(metrics.toolCallCount).toBe(5);
    });
  });

  describe('RuntimeLogEntry', () => {
    it('로그 엔트리를 표현할 수 있다', () => {
      const entry: RuntimeLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'turn.started',
        traceId: 'trace-123',
        context: {
          instanceKey: 'key-1',
          agentName: 'planner',
          turnId: 'turn-1',
        },
      };
      expect(entry.level).toBe('info');
      expect(entry.traceId).toBe('trace-123');
    });
  });

  describe('HealthCheckResult', () => {
    it('Health Check 결과를 표현할 수 있다', () => {
      const result: HealthCheckResult = {
        status: 'healthy',
        activeInstances: 3,
        activeTurns: 1,
        lastActivityAt: new Date().toISOString(),
        components: {
          llm: { status: 'healthy' },
          storage: { status: 'degraded', message: 'High latency' },
        },
      };
      expect(result.status).toBe('healthy');
      expect(result.activeInstances).toBe(3);
      expect(result.components?.['storage']?.status).toBe('degraded');
    });
  });

  describe('InstanceGcPolicy', () => {
    it('GC 정책을 표현할 수 있다', () => {
      const policy: InstanceGcPolicy = {
        ttlMs: 3600000,
        idleTimeoutMs: 1800000,
        checkIntervalMs: 60000,
      };
      expect(policy.ttlMs).toBe(3600000);
      expect(policy.idleTimeoutMs).toBe(1800000);
    });
  });
});

describe('민감값 마스킹', () => {
  describe('maskSensitiveValue', () => {
    it('4자 이하는 전부 마스킹해야 한다', () => {
      expect(maskSensitiveValue('abc')).toBe('****');
      expect(maskSensitiveValue('abcd')).toBe('****');
    });

    it('5자 이상은 앞 4자만 노출해야 한다', () => {
      expect(maskSensitiveValue('abcde')).toBe('abcd****');
      expect(maskSensitiveValue('sk-1234567890')).toBe('sk-1****');
    });
  });

  describe('isSensitiveKey', () => {
    it('민감한 키 이름을 인식해야 한다', () => {
      expect(isSensitiveKey('access_token')).toBe(true);
      expect(isSensitiveKey('refreshToken')).toBe(true);
      expect(isSensitiveKey('SECRET_KEY')).toBe(true);
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('credential')).toBe(true);
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('apiKey')).toBe(true);
    });

    it('일반 키 이름은 인식하지 않아야 한다', () => {
      expect(isSensitiveKey('name')).toBe(false);
      expect(isSensitiveKey('value')).toBe(false);
      expect(isSensitiveKey('description')).toBe(false);
    });
  });

  describe('maskSensitiveFields', () => {
    it('민감한 필드를 마스킹해야 한다', () => {
      const obj = {
        name: 'test',
        access_token: 'sk-1234567890',
        data: { value: 'normal' },
      };
      const masked = maskSensitiveFields(obj);

      expect(masked['name']).toBe('test');
      expect(masked['access_token']).toBe('sk-1****');
    });

    it('중첩된 민감한 필드도 마스킹해야 한다', () => {
      const obj = {
        auth: {
          access_token: 'sk-1234567890',
          refresh_token: 'rt-abcdef',
        },
      };
      const masked = maskSensitiveFields(obj);
      const maskedAuth = masked['auth'];

      expect(typeof maskedAuth).toBe('object');
      if (typeof maskedAuth === 'object' && maskedAuth !== null && !Array.isArray(maskedAuth)) {
        expect(maskedAuth['access_token']).toBe('sk-1****');
        expect(maskedAuth['refresh_token']).toBe('rt-a****');
      }
    });

    it('비문자열 민감 필드는 마스킹하지 않아야 한다', () => {
      const obj = {
        token_count: 42,
        name: 'test',
      };
      const masked = maskSensitiveFields(obj);

      expect(masked['token_count']).toBe(42);
    });
  });
});
