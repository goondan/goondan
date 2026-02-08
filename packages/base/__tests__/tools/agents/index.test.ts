/**
 * Agents Tool 테스트
 */

import { describe, it, expect, vi } from 'vitest';
import { handlers } from '../../../src/tools/agents/index.js';
import type { ToolContext, JsonValue } from '@goondan/core';

// AgentDelegateResult 타입 가드
interface AgentDelegateResultLike {
  success: boolean;
  agentName: string;
  instanceId: string;
  response: string | null;
  error: string | null;
}

function isAgentDelegateResult(value: JsonValue): value is AgentDelegateResultLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value['success'] === 'boolean' &&
    typeof value['agentName'] === 'string' &&
    typeof value['instanceId'] === 'string'
  );
}

// AgentListInstancesResult 타입 가드
interface AgentListInstancesResultLike {
  instances: Array<{
    instanceId: string;
    agentName: string;
    status: string;
  }>;
}

function isAgentListInstancesResult(value: JsonValue): value is AgentListInstancesResultLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Array.isArray(value['instances']);
}

// Mock ToolContext 생성 헬퍼
function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const baseContext: ToolContext = {
    instance: { id: 'test-instance', swarmName: 'test-swarm', status: 'running' },
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: { agents: [], entrypoint: '' },
    },
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: { model: { ref: '' } },
    },
    turn: {
      id: 'test-turn',
      messages: [],
      toolResults: [],
    },
    step: {
      id: 'test-step',
      index: 0,
    },
    toolCatalog: [],
    swarmBundle: {
      openChangeset: vi.fn().mockResolvedValue({ changesetId: 'test' }),
      commitChangeset: vi.fn().mockResolvedValue({ success: true }),
    },
    oauth: {
      getAccessToken: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'not_configured', message: 'Not configured' },
      }),
    },
    events: {},
    logger: console,
    workdir: '/tmp/test',
    agents: {
      delegate: vi.fn().mockResolvedValue({
        success: true,
        agentName: 'coder',
        instanceId: 'inst-123',
        response: 'Task completed',
      }),
      listInstances: vi.fn().mockResolvedValue([
        { instanceId: 'inst-1', agentName: 'planner', status: 'running' },
        { instanceId: 'inst-2', agentName: 'coder', status: 'idle' },
      ]),
    },
  };

  return { ...baseContext, ...overrides };
}

describe('agents.delegate handler', () => {
  const handler = handlers['agents.delegate'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should delegate to agent successfully', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      agentName: 'coder',
      task: 'Write a hello world function',
    });

    expect(isAgentDelegateResult(result)).toBe(true);
    if (isAgentDelegateResult(result)) {
      expect(result.success).toBe(true);
      expect(result.agentName).toBe('coder');
      expect(result.instanceId).toBe('inst-123');
      expect(result.response).toBe('Task completed');
      expect(result.error).toBeNull();
    }

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'Write a hello world function', undefined);
  });

  it('should pass context when provided', async () => {
    const ctx = createMockContext();
    await handler(ctx, {
      agentName: 'coder',
      task: 'Refactor code',
      context: 'Use TypeScript strict mode',
    });

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'Refactor code', 'Use TypeScript strict mode');
  });

  it('should throw on empty agentName', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { agentName: '', task: 'test' })).rejects.toThrow(
      'agentName은 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on missing agentName', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { task: 'test' })).rejects.toThrow(
      'agentName은 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on empty task', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { agentName: 'coder', task: '' })).rejects.toThrow(
      'task는 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on missing task', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { agentName: 'coder' })).rejects.toThrow(
      'task는 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should handle delegate failure', async () => {
    const ctx = createMockContext({
      agents: {
        delegate: vi.fn().mockResolvedValue({
          success: false,
          agentName: 'unknown-agent',
          instanceId: '',
          error: 'Agent not found',
        }),
        listInstances: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await handler(ctx, {
      agentName: 'unknown-agent',
      task: 'do something',
    });

    expect(isAgentDelegateResult(result)).toBe(true);
    if (isAgentDelegateResult(result)) {
      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent not found');
    }
  });

  it('should ignore non-string context', async () => {
    const ctx = createMockContext();
    await handler(ctx, {
      agentName: 'coder',
      task: 'test',
      context: 42,
    });

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'test', undefined);
  });
});

describe('agents.listInstances handler', () => {
  const handler = handlers['agents.listInstances'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should list agent instances', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {});

    expect(isAgentListInstancesResult(result)).toBe(true);
    if (isAgentListInstancesResult(result)) {
      expect(result.instances).toHaveLength(2);
      expect(result.instances[0]).toEqual({
        instanceId: 'inst-1',
        agentName: 'planner',
        status: 'running',
      });
      expect(result.instances[1]).toEqual({
        instanceId: 'inst-2',
        agentName: 'coder',
        status: 'idle',
      });
    }
  });

  it('should return empty list when no instances', async () => {
    const ctx = createMockContext({
      agents: {
        delegate: vi.fn().mockResolvedValue({
          success: true,
          agentName: '',
          instanceId: '',
        }),
        listInstances: vi.fn().mockResolvedValue([]),
      },
    });
    const result = await handler(ctx, {});

    expect(isAgentListInstancesResult(result)).toBe(true);
    if (isAgentListInstancesResult(result)) {
      expect(result.instances).toHaveLength(0);
    }
  });
});
