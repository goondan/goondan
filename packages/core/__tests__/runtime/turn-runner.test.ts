/**
 * Turn 실행 테스트
 * @see /docs/specs/runtime.md - 2.4 Turn 타입, 5. Turn 실행 흐름
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Turn,
  createTurn,
  TurnRunner,
  createTurnRunner,
  TurnContext,
} from '../../src/runtime/turn-runner.js';
import { createSwarmInstance } from '../../src/runtime/swarm-instance.js';
import { createAgentInstance } from '../../src/runtime/agent-instance.js';
import { createAgentEvent } from '../../src/runtime/types.js';
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
      expect(turn.agentInstance).toBe(mockAgentInstance);
      expect(turn.inputEvent).toBe(event);
      expect(turn.status).toBe('pending');
      expect(turn.messages).toEqual([]);
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

  describe('Turn 메시지 누적', () => {
    it('메시지를 순서대로 추가할 수 있어야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      const turn = createTurn(mockAgentInstance, event);

      turn.messages.push({ role: 'user', content: 'Hello!' });
      turn.messages.push({
        role: 'assistant',
        content: 'Hi! How can I help?',
      });

      expect(turn.messages.length).toBe(2);
      expect(turn.messages[0].role).toBe('user');
      expect(turn.messages[1].role).toBe('assistant');
    });

    it('tool call과 결과를 누적할 수 있어야 한다', () => {
      const event = createAgentEvent('user.input', 'List files');
      const turn = createTurn(mockAgentInstance, event);

      turn.messages.push({ role: 'user', content: 'List files' });
      turn.messages.push({
        role: 'assistant',
        toolCalls: [{ id: 'call_1', name: 'file.list', input: { path: '.' } }],
      });
      turn.messages.push({
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'file.list',
        output: { files: ['a.txt', 'b.txt'] },
      });

      expect(turn.messages.length).toBe(3);
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
            message: { role: 'assistant' as const, content: 'Done!' },
            finishReason: 'stop' as const,
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

    it('초기 사용자 메시지를 추가해야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'What is 2+2?');
      const turn = await runner.run(agentInstance, event);

      expect(turn.messages[0]).toEqual({
        role: 'user',
        content: 'What is 2+2?',
      });
    });

    it('AgentInstance 상태를 갱신해야 한다', async () => {
      const runner = createTurnRunner({
        stepRunner: mockStepRunner,
        maxStepsPerTurn: 32,
      });

      const event = createAgentEvent('user.input', 'Hello!');

      expect(agentInstance.status).toBe('idle');
      expect(agentInstance.currentTurn).toBeNull();

      const turnPromise = runner.run(agentInstance, event);

      // 실행 완료 후
      const turn = await turnPromise;

      expect(agentInstance.status).toBe('idle');
      expect(agentInstance.currentTurn).toBeNull();
      expect(agentInstance.completedTurnCount).toBe(1);
    });

    it('maxStepsPerTurn 제한을 적용해야 한다', async () => {
      // tool call이 계속되는 Step 시뮬레이션
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
          toolCalls: [{ id: `call_${stepCount}`, name: 'test', input: {} }],
          toolResults: [{ toolCallId: `call_${stepCount}`, toolName: 'test', output: 'ok' }],
          status: 'completed' as const,
          startedAt: new Date(),
          completedAt: new Date(),
          metadata: {},
          llmResult: {
            message: {
              role: 'assistant' as const,
              toolCalls: [{ id: `call_${stepCount}`, name: 'test', input: {} }],
            },
            finishReason: 'tool_calls' as const,
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
      // 사용자 메시지가 추가되지 않아야 함
      const userMessages = turn.messages.filter((m) => m.role === 'user');
      expect(userMessages.length).toBe(0);
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

      // Step이 1개만 실행되어야 함
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
            toolCalls: [{ id: 'call_1', name: 'test', input: {} }],
            toolResults: [{ toolCallId: 'call_1', toolName: 'test', output: 'ok' }],
            llmResult: {
              message: {
                role: 'assistant',
                toolCalls: [{ id: 'call_1', name: 'test', input: {} }],
              },
              finishReason: 'tool_calls',
            },
          };
        }
        return {
          id: 'step-2',
          status: 'completed',
          toolCalls: [],
          toolResults: [],
          llmResult: {
            message: { role: 'assistant', content: 'Done!' },
            finishReason: 'stop',
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
