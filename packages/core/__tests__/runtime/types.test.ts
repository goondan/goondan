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
} from '../../src/runtime/types.js';
import {
  isLlmSystemMessage,
  isLlmUserMessage,
  isLlmAssistantMessage,
  isLlmToolMessage,
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
    it('active, idle, terminated 값을 가질 수 있다', () => {
      const statuses: SwarmInstanceStatus[] = ['active', 'idle', 'terminated'];
      expect(statuses).toContain('active');
      expect(statuses).toContain('idle');
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
        'custom.event', // 확장 이벤트 타입
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
      it('role이 system이어야 한다', () => {
        const msg: LlmSystemMessage = {
          role: 'system',
          content: 'You are a helpful assistant.',
        };
        expect(msg.role).toBe('system');
        expect(msg.content).toBe('You are a helpful assistant.');
      });
    });

    describe('LlmUserMessage', () => {
      it('role이 user이어야 한다', () => {
        const msg: LlmUserMessage = {
          role: 'user',
          content: 'Hello, world!',
        };
        expect(msg.role).toBe('user');
        expect(msg.content).toBe('Hello, world!');
      });
    });

    describe('LlmAssistantMessage', () => {
      it('role이 assistant이어야 한다', () => {
        const msg: LlmAssistantMessage = {
          role: 'assistant',
          content: 'Hello! How can I help you?',
        };
        expect(msg.role).toBe('assistant');
      });

      it('toolCalls를 포함할 수 있다', () => {
        const msg: LlmAssistantMessage = {
          role: 'assistant',
          toolCalls: [
            {
              id: 'call_001',
              name: 'file.list',
              input: { path: '.' },
            },
          ],
        };
        expect(msg.toolCalls?.length).toBe(1);
        expect(msg.toolCalls?.[0].name).toBe('file.list');
      });
    });

    describe('LlmToolMessage', () => {
      it('role이 tool이어야 한다', () => {
        const msg: LlmToolMessage = {
          role: 'tool',
          toolCallId: 'call_001',
          toolName: 'file.list',
          output: { files: ['README.md'] },
        };
        expect(msg.role).toBe('tool');
        expect(msg.toolCallId).toBe('call_001');
        expect(msg.toolName).toBe('file.list');
      });
    });
  });

  describe('LlmMessage 타입 가드', () => {
    it('isLlmSystemMessage는 system role을 구분해야 한다', () => {
      const systemMsg: LlmMessage = { role: 'system', content: 'test' };
      const userMsg: LlmMessage = { role: 'user', content: 'test' };

      expect(isLlmSystemMessage(systemMsg)).toBe(true);
      expect(isLlmSystemMessage(userMsg)).toBe(false);
    });

    it('isLlmUserMessage는 user role을 구분해야 한다', () => {
      const userMsg: LlmMessage = { role: 'user', content: 'test' };
      const assistantMsg: LlmMessage = { role: 'assistant', content: 'test' };

      expect(isLlmUserMessage(userMsg)).toBe(true);
      expect(isLlmUserMessage(assistantMsg)).toBe(false);
    });

    it('isLlmAssistantMessage는 assistant role을 구분해야 한다', () => {
      const assistantMsg: LlmMessage = { role: 'assistant', content: 'test' };
      const toolMsg: LlmMessage = {
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
        role: 'tool',
        toolCallId: 'call_001',
        toolName: 'test',
        output: null,
      };
      const systemMsg: LlmMessage = { role: 'system', content: 'test' };

      expect(isLlmToolMessage(toolMsg)).toBe(true);
      expect(isLlmToolMessage(systemMsg)).toBe(false);
    });
  });

  describe('LlmResult', () => {
    it('message와 usage 정보를 포함해야 한다', () => {
      const result: LlmResult = {
        message: {
          role: 'assistant',
          content: 'Hello!',
        },
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
        finishReason: 'stop',
      };
      expect(result.message.role).toBe('assistant');
      expect(result.usage?.totalTokens).toBe(150);
      expect(result.finishReason).toBe('stop');
    });
  });

  describe('ToolCall', () => {
    it('id, name, input을 가져야 한다', () => {
      const toolCall: ToolCall = {
        id: 'call_001',
        name: 'file.read',
        input: { path: '/tmp/test.txt' },
      };
      expect(toolCall.id).toBe('call_001');
      expect(toolCall.name).toBe('file.read');
      expect(toolCall.input).toEqual({ path: '/tmp/test.txt' });
    });
  });

  describe('createToolCall', () => {
    it('ToolCall 객체를 생성해야 한다', () => {
      const toolCall = createToolCall('file.read', { path: '/test' });
      expect(toolCall.id).toBeDefined();
      expect(toolCall.name).toBe('file.read');
      expect(toolCall.input).toEqual({ path: '/test' });
    });

    it('커스텀 id를 지정할 수 있다', () => {
      const toolCall = createToolCall('file.read', { path: '/test' }, 'my-custom-id');
      expect(toolCall.id).toBe('my-custom-id');
    });
  });

  describe('ToolResult', () => {
    it('동기 완료 시 output을 포함해야 한다', () => {
      const result: ToolResult = {
        toolCallId: 'call_001',
        toolName: 'file.read',
        output: { content: 'file contents' },
      };
      expect(result.output).toEqual({ content: 'file contents' });
    });

    it('비동기 제출 시 handle을 포함할 수 있다', () => {
      const result: ToolResult = {
        toolCallId: 'call_001',
        toolName: 'async.task',
        handle: 'task_handle_123',
      };
      expect(result.handle).toBe('task_handle_123');
    });

    it('오류 시 error 정보를 포함할 수 있다', () => {
      const result: ToolResult = {
        toolCallId: 'call_001',
        toolName: 'file.read',
        error: {
          status: 'error',
          error: {
            message: 'File not found',
            name: 'NotFoundError',
            code: 'E_NOT_FOUND',
          },
        },
      };
      expect(result.error?.status).toBe('error');
      expect(result.error?.error.message).toBe('File not found');
    });
  });

  describe('createToolResult', () => {
    it('성공 결과를 생성해야 한다', () => {
      const result = createToolResult('call_001', 'file.read', { content: 'data' });
      expect(result.toolCallId).toBe('call_001');
      expect(result.toolName).toBe('file.read');
      expect(result.output).toEqual({ content: 'data' });
    });

    it('에러 결과를 생성해야 한다', () => {
      const error = new Error('Something went wrong');
      const result = createToolResult('call_001', 'file.read', undefined, error);
      expect(result.error?.status).toBe('error');
      expect(result.error?.error.message).toBe('Something went wrong');
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
