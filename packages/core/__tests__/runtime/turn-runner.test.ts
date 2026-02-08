/**
 * Turn 실행 테스트
 * @see /docs/specs/runtime.md - 2.4 Turn 타입, 5. Turn 실행 흐름
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createTurn,
  createTurnRunner,
} from '../../src/runtime/turn-runner.js';
import type {
  Turn,
  TurnRunner,
  TurnContext,
} from '../../src/runtime/turn-runner.js';
import { createSwarmInstance } from '../../src/runtime/swarm-instance.js';
import { createAgentInstance } from '../../src/runtime/agent-instance.js';
import { createAgentEvent } from '../../src/runtime/types.js';
import { PipelineRegistry } from '../../src/pipeline/registry.js';
import { PipelineExecutor } from '../../src/pipeline/executor.js';
import type { AgentInstance } from '../../src/runtime/agent-instance.js';
import type { StepRunner } from '../../src/runtime/step-runner.js';
import type { LlmResult } from '../../src/runtime/types.js';

describe('Turn', () => {
  const mockSwarmInstance = createSwarmInstance(
    'Swarm/test-swarm',
    'instance-key',
    'bundle-ref'
  );

  const mockAgentInstance = createAgentInstance(
    mockSwarmInstance,
    'Agent/planner'
  );

  describe('createTurn', () => {
    it('Turn 객체를 생성해야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!', {
        connector: 'cli',
      });
      const turn = createTurn(mockAgentInstance, event);

      expect(turn.id).toBeDefined();
      expect(turn.id.startsWith('turn-')).toBe(true);
      expect(turn.traceId).toBeDefined();
      expect(turn.traceId.startsWith('trace-')).toBe(true);
      expect(turn.agentInstance).toBe(mockAgentInstance);
      expect(turn.inputEvent).toBe(event);
      expect(turn.status).toBe('pending');
      expect(turn.messageState).toBeDefined();
      expect(turn.messageState.baseMessages).toEqual([]);
      expect(turn.messageState.events).toEqual([]);
      expect(turn.messageState.nextMessages).toEqual([]);
      expect(turn.steps).toEqual([]);
      expect(turn.currentStepIndex).toBe(0);
      expect(turn.startedAt).toBeInstanceOf(Date);
      expect(turn.metadata).toEqual({});
    });

    it('origin을 이벤트에서 가져와야 한다', () => {
      const event = createAgentEvent(
        'user.input',
        'Hello!',
        { connector: 'slack', channel: 'C123' },
        undefined
      );
      const turn = createTurn(mockAgentInstance, event);

      expect(turn.origin).toEqual({ connector: 'slack', channel: 'C123' });
    });

    it('auth를 이벤트에서 가져와야 한다', () => {
      const event = createAgentEvent(
        'user.input',
        'Hello!',
        undefined,
        { actor: { type: 'user', id: 'U123' } }
      );
      const turn = createTurn(mockAgentInstance, event);

      expect(turn.auth).toEqual({ actor: { type: 'user', id: 'U123' } });
    });

    it('origin이 없으면 빈 객체여야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      const turn = createTurn(mockAgentInstance, event);

      expect(turn.origin).toEqual({});
    });

    it('auth가 없으면 빈 객체여야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      const turn = createTurn(mockAgentInstance, event);

      expect(turn.auth).toEqual({});
    });

    it('baseMessages로 초기화 할 수 있어야 한다', () => {
      const baseMessages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello' },
        { id: 'msg-2', role: 'assistant' as const, content: 'Hi' },
      ];
      const event = createAgentEvent('user.input', 'New message');
      const turn = createTurn(mockAgentInstance, event, baseMessages);

      expect(turn.messageState.baseMessages.length).toBe(2);
      expect(turn.messageState.nextMessages.length).toBe(2);
    });

    it('messages는 messageState.nextMessages에 대한 편의 참조여야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      const turn = createTurn(mockAgentInstance, event);

      expect(turn.messages).toBe(turn.messageState.nextMessages);
    });
  });

  describe('Turn 상태 전이', () => {
    it('pending -> running -> completed 전이가 가능해야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      const turn = createTurn(mockAgentInstance, event);

      expect(turn.status).toBe('pending');

      turn.status = 'running';
      expect(turn.status).toBe('running');

      turn.status = 'completed';
      turn.completedAt = new Date();
      expect(turn.status).toBe('completed');
      expect(turn.completedAt).toBeInstanceOf(Date);
    });

    it('pending -> running -> failed 전이가 가능해야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      const turn = createTurn(mockAgentInstance, event);

      turn.status = 'running';
      turn.status = 'failed';
      turn.completedAt = new Date();
      turn.metadata['error'] = { message: 'Something went wrong' };

      expect(turn.status).toBe('failed');
      expect(turn.metadata['error']).toBeDefined();
    });
  });

  describe('Turn 메시지 상태 모델', () => {
    it('messageState에 이벤트를 추가하면 nextMessages가 반영되어야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      const turn = createTurn(mockAgentInstance, event);

      // 직접 이벤트 추가 시뮬레이션
      turn.messageState.events.push({
        type: 'llm_message',
        seq: 0,
        message: { id: 'msg-1', role: 'user', content: 'Hello!' },
      });

      // nextMessages는 수동으로 재계산해야 함 (TurnRunner/StepRunner가 담당)
      expect(turn.messageState.events.length).toBe(1);
    });

    it('baseMessages가 있으면 nextMessages에 포함되어야 한다', () => {
      const base = [
        { id: 'msg-1', role: 'user' as const, content: 'Previous' },
      ];
      const event = createAgentEvent('user.input', 'New');
      const turn = createTurn(mockAgentInstance, event, base);

      expect(turn.messageState.nextMessages.length).toBe(1);
      expect(turn.messageState.nextMessages[0].id).toBe('msg-1');
    });
  });
});

describe('TurnRunner', () => {
  let agentInstance: AgentInstance;
  let mockStepRunner: StepRunner;

  beforeEach(() => {
    const swarmInstance = createSwarmInstance(
      'Swarm/test-swarm',
      'instance-key',
      'bundle-ref'
    );
    agentInstance = createAgentInstance(swarmInstance, 'Agent/planner');

    // Mock StepRunner
    mockStepRunner = {
      run: vi.fn().mockImplementation(async (turn: Turn) => {
        return {
          id: `step-${turn.steps.length}`,
          turn,
          index: turn.currentStepIndex,
          activeSwarmBundleRef: 'bundle-ref',
          effectiveConfig: {} as never,
          toolCatalog: [],
          blocks: [],
          toolCalls: [],
          toolResults: [],
          status: 'completed' as const,
          startedAt: new Date(),
          completedAt: new Date(),
          metadata: {},
          llmResult: {
            message: { id: 'msg-ast-1', role: 'assistant' as const, content: 'Done!' },
            meta: { finishReason: 'stop' },
          },
        };
      }),
    };
  });

  describe('createTurnRunner', () => {
    it('TurnRunner 인스턴스를 생성해야 한다', () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      expect(runner).toBeDefined();
      expect(typeof runner.run).toBe('function');
    });
  });

  describe('run', () => {
    it('Turn을 실행하고 완료해야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.status).toBe('completed');
      expect(turn.completedAt).toBeInstanceOf(Date);
      expect(turn.steps.length).toBeGreaterThanOrEqual(1);
    });

    it('traceId가 생성되어야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.traceId).toBeDefined();
      expect(turn.traceId.startsWith('trace-')).toBe(true);
    });

    it('초기 사용자 메시지가 messageState에 추가되어야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'What is 2+2?');
      const turn = await runner.run(agentInstance, event);

      // messageState.events에 user message 이벤트가 있어야 함
      const userEvents = turn.messageState.events.filter(
        (e) => e.type === 'llm_message' && 'message' in e && e.message.role === 'user'
      );
      expect(userEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('AgentInstance 상태를 갱신해야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');

      expect(agentInstance.status).toBe('idle');
      expect(agentInstance.currentTurn).toBeNull();

      const turn = await runner.run(agentInstance, event);

      expect(agentInstance.status).toBe('idle');
      expect(agentInstance.currentTurn).toBeNull();
      expect(agentInstance.completedTurnCount).toBe(1);
    });

    it('maxStepsPerTurn 제한을 적용해야 한다', async () => {
      let stepCount = 0;
      mockStepRunner.run = vi.fn().mockImplementation(async (turn: Turn) => {
        stepCount++;
        return {
          id: `step-${stepCount}`,
          turn,
          index: turn.currentStepIndex,
          activeSwarmBundleRef: 'bundle-ref',
          effectiveConfig: {} as never,
          toolCatalog: [],
          blocks: [],
          toolCalls: [{ id: `call_${stepCount}`, name: 'test', args: {} }],
          toolResults: [{ toolCallId: `call_${stepCount}`, toolName: 'test', status: 'ok', output: 'ok' }],
          status: 'completed' as const,
          startedAt: new Date(),
          completedAt: new Date(),
          metadata: {},
          llmResult: {
            message: {
              id: `msg-ast-${stepCount}`,
              role: 'assistant' as const,
              toolCalls: [{ id: `call_${stepCount}`, name: 'test', args: {} }],
            },
            meta: { finishReason: 'tool_calls' },
          },
        };
      });

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 3,
      });

      const event = createAgentEvent('user.input', 'Loop!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.steps.length).toBe(3);
      expect(turn.metadata['stepLimitReached']).toBe(true);
    });

    it('Step 실패 시 Turn을 실패 처리해야 한다', async () => {
      mockStepRunner.run = vi.fn().mockRejectedValue(new Error('Step failed'));

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Fail!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.status).toBe('failed');
      expect(turn.metadata['error']).toBeDefined();
    });

    it('LLM이 tool call 없이 stop하면 Turn을 종료해야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.status).toBe('completed');
      expect(turn.steps.length).toBe(1);
    });

    it('input이 없는 이벤트도 처리해야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('system.wakeup', undefined);
      const turn = await runner.run(agentInstance, event);

      expect(turn.status).toBe('completed');
      // 사용자 메시지 이벤트가 없어야 함
      const userEvents = turn.messageState.events.filter(
        (e) => e.type === 'llm_message' && 'message' in e && e.message.role === 'user'
      );
      expect(userEvents.length).toBe(0);
    });

    it('Turn 메트릭이 기록되어야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.metrics).toBeDefined();
      expect(turn.metrics?.stepCount).toBe(1);
      expect(turn.metrics?.latencyMs).toBeGreaterThanOrEqual(0);
      expect(turn.metrics?.toolCallCount).toBe(0);
      expect(turn.metrics?.errorCount).toBe(0);
      expect(turn.metrics?.tokenUsage).toBeDefined();
    });

    it('paused 상태의 SwarmInstance에서는 Turn을 interrupted 처리해야 한다', async () => {
      const swarmInstance = createSwarmInstance(
        'Swarm/test-swarm',
        'paused-key',
        'bundle-ref'
      );
      swarmInstance.status = 'paused';
      const pausedAgent = createAgentInstance(swarmInstance, 'Agent/planner');

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(pausedAgent, event);

      expect(turn.status).toBe('interrupted');
      expect(turn.metadata['interruptReason']).toBe('instance_paused');
    });

    it('turn.pre/post 파이프라인 포인트가 실행되어야 한다', async () => {
      const registry = new PipelineRegistry();
      const pipelineExecutor = new PipelineExecutor(registry);
      const executionOrder: string[] = [];

      registry.mutate('turn.pre', async (ctx) => {
        executionOrder.push('turn.pre');
        return {
          ...ctx,
          turn: {
            ...ctx.turn,
            metadata: {
              ...(ctx.turn.metadata ?? {}),
              fromTurnPre: true,
            },
          },
        };
      });

      registry.mutate('turn.post', async (ctx) => {
        executionOrder.push('turn.post');
        if (ctx.emitMessageEvent) {
          await ctx.emitMessageEvent({
            type: 'llm_message',
            seq: ctx.turn.messageState.events.length,
            message: {
              id: 'msg-turn-post',
              role: 'assistant',
              content: 'post-processed',
            },
          });
        }
        return ctx;
      });

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
        pipelineExecutor,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(executionOrder).toEqual(['turn.pre', 'turn.post']);
      expect(turn.metadata['fromTurnPre']).toBe(true);
      const postMessage = turn.messageState.nextMessages.find(
        (message) => message.id === 'msg-turn-post'
      );
      expect(postMessage).toBeDefined();
    });

    it('onTurnSettled 콜백이 호출되어야 한다', async () => {
      const settled = vi.fn();
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        onTurnSettled: settled,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      await runner.run(agentInstance, event);

      expect(settled).toHaveBeenCalledTimes(1);
    });

    it('turn.post 이후 flushExtensionState 콜백이 호출되어야 한다', async () => {
      const flushExtensionState = vi.fn().mockResolvedValue(undefined);
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        flushExtensionState,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      await runner.run(agentInstance, event);

      expect(flushExtensionState).toHaveBeenCalledTimes(1);
      expect(flushExtensionState).toHaveBeenCalledWith(agentInstance);
    });

    it('messageStateLogger가 설정되면 events/base를 기록하고 events를 clear해야 한다', async () => {
      const logEvent = vi.fn().mockResolvedValue(undefined);
      const clearEvents = vi.fn().mockResolvedValue(undefined);
      const logBase = vi.fn().mockResolvedValue(undefined);

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        messageStateLogger: () => ({
          events: {
            log: logEvent,
            clear: clearEvents,
          },
          base: {
            log: logBase,
          },
        }),
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(logEvent).toHaveBeenCalledTimes(1);
      expect(logBase).toHaveBeenCalledWith(
        expect.objectContaining({
          turnId: turn.id,
          sourceEventCount: 1,
        })
      );
      expect(clearEvents).toHaveBeenCalledTimes(1);
      expect(turn.messageState.events).toEqual([]);
      expect(turn.messageState.baseMessages).toEqual(turn.messageState.nextMessages);
    });

    it('messageStateLogger 기록 실패는 Turn을 깨뜨리지 않고 metadata에 남겨야 한다', async () => {
      const logEvent = vi.fn().mockResolvedValue(undefined);
      const clearEvents = vi.fn().mockResolvedValue(undefined);
      const logBase = vi.fn().mockRejectedValue(new Error('persist failed'));

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        messageStateLogger: () => ({
          events: {
            log: logEvent,
            clear: clearEvents,
          },
          base: {
            log: logBase,
          },
        }),
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.status).toBe('completed');
      expect(turn.metadata['messageStatePersistenceError']).toBeDefined();
      expect(clearEvents).not.toHaveBeenCalled();
      expect(turn.messageState.events.length).toBeGreaterThan(0);
    });

    it('Turn 시작 시 base+events를 복원해 초기 messageState를 구성해야 한다', async () => {
      const clearRecoveredEvents = vi.fn().mockResolvedValue(undefined);

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        messageStateRecovery: async () => ({
          baseMessages: [
            { id: 'msg-prev-user', role: 'user', content: 'previous user' },
          ],
          events: [
            {
              type: 'llm_message',
              seq: 0,
              message: {
                id: 'msg-prev-asst',
                role: 'assistant',
                content: 'previous assistant',
              },
            },
          ],
          clearRecoveredEvents,
        }),
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.status).toBe('completed');
      expect(turn.metadata['recoveredMessageEventCount']).toBe(1);
      expect(clearRecoveredEvents).toHaveBeenCalledTimes(1);
      expect(turn.messageState.baseMessages.map((message) => message.id)).toEqual([
        'msg-prev-user',
        'msg-prev-asst',
      ]);
      expect(turn.messageState.nextMessages.map((message) => message.id)).toEqual([
        'msg-prev-user',
        'msg-prev-asst',
        expect.stringMatching(/^msg-/),
      ]);
    });

    it('복원 중 오류가 나도 기존 conversationHistory로 Turn을 계속 실행해야 한다', async () => {
      agentInstance.conversationHistory.push({
        id: 'msg-history',
        role: 'user',
        content: 'history',
      });

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        messageStateRecovery: async () => {
          throw new Error('recover failed');
        },
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.status).toBe('completed');
      expect(turn.metadata['recoveredMessageEventCount']).toBeUndefined();
      expect(turn.messageState.baseMessages[0]?.id).toBe('msg-history');
    });
  });

  describe('shouldContinueStepLoop', () => {
    it('Step 실패 시 false를 반환해야 한다', async () => {
      mockStepRunner.run = vi.fn().mockResolvedValue({
        id: 'step-1',
        status: 'failed',
        llmResult: undefined,
        toolCalls: [],
      });

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.steps.length).toBe(1);
    });

    it('tool call이 있으면 계속해야 한다', async () => {
      let stepCount = 0;
      mockStepRunner.run = vi.fn().mockImplementation(async () => {
        stepCount++;
        if (stepCount === 1) {
          return {
            id: 'step-1',
            status: 'completed',
            toolCalls: [{ id: 'call_1', name: 'test', args: {} }],
            toolResults: [{ toolCallId: 'call_1', toolName: 'test', status: 'ok', output: 'ok' }],
            llmResult: {
              message: {
                id: 'msg-ast-1',
                role: 'assistant',
                toolCalls: [{ id: 'call_1', name: 'test', args: {} }],
              },
              meta: { finishReason: 'tool_calls' },
            },
          };
        }
        return {
          id: 'step-2',
          status: 'completed',
          toolCalls: [],
          toolResults: [],
          llmResult: {
            message: { id: 'msg-ast-2', role: 'assistant', content: 'Done!' },
            meta: { finishReason: 'stop' },
          },
        };
      });

      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');
      const turn = await runner.run(agentInstance, event);

      expect(turn.steps.length).toBe(2);
    });
  });
});

describe('TurnContext', () => {
  it('Turn 실행에 필요한 컨텍스트 정보를 포함해야 한다', () => {
    const swarmInstance = createSwarmInstance(
      'Swarm/test-swarm',
      'instance-key',
      'bundle-ref'
    );
    const agentInstance = createAgentInstance(swarmInstance, 'Agent/planner');
    const event = createAgentEvent('user.input', 'Hello!');
    const turn = createTurn(agentInstance, event);

    const context: TurnContext = {
      turn,
      agentInstance,
      swarmInstance,
    };

    expect(context.turn).toBe(turn);
    expect(context.agentInstance).toBe(agentInstance);
    expect(context.swarmInstance).toBe(swarmInstance);
  });
});
