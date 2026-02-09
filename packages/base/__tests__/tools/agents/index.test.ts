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

// AgentSpawnResult 타입 가드
interface AgentSpawnResultLike {
  instanceId: string;
  agentName: string;
}

function isAgentSpawnResult(value: JsonValue): value is AgentSpawnResultLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value['instanceId'] === 'string' &&
    typeof value['agentName'] === 'string'
  );
}

// AgentDestroyResult 타입 가드
interface AgentDestroyResultLike {
  success: boolean;
  instanceId: string;
  error: string | null;
}

function isAgentDestroyResult(value: JsonValue): value is AgentDestroyResultLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value['success'] === 'boolean' &&
    typeof value['instanceId'] === 'string'
  );
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
      spawnInstance: vi.fn().mockResolvedValue({
        instanceId: 'inst-new-1',
        agentName: 'worker',
      }),
      delegateToInstance: vi.fn().mockResolvedValue({
        success: true,
        agentName: 'worker',
        instanceId: 'inst-new-1',
        response: 'Instance task completed',
      }),
      destroyInstance: vi.fn().mockResolvedValue({
        success: true,
        instanceId: 'inst-new-1',
      }),
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

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'Write a hello world function', {});
  });

  it('should pass context when provided', async () => {
    const ctx = createMockContext();
    await handler(ctx, {
      agentName: 'coder',
      task: 'Refactor code',
      context: 'Use TypeScript strict mode',
    });

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'Refactor code', { context: 'Use TypeScript strict mode' });
  });

  it('should pass async option when true', async () => {
    const ctx = createMockContext();
    await handler(ctx, {
      agentName: 'coder',
      task: 'Background task',
      async: true,
    });

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'Background task', { async: true });
  });

  it('should pass both context and async options', async () => {
    const ctx = createMockContext();
    await handler(ctx, {
      agentName: 'coder',
      task: 'Background task',
      context: 'Extra info',
      async: true,
    });

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'Background task', { context: 'Extra info', async: true });
  });

  it('should not pass async when false', async () => {
    const ctx = createMockContext();
    await handler(ctx, {
      agentName: 'coder',
      task: 'Sync task',
      async: false,
    });

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'Sync task', {});
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
        spawnInstance: vi.fn().mockResolvedValue({ instanceId: '', agentName: '' }),
        delegateToInstance: vi.fn().mockResolvedValue({ success: false, agentName: '', instanceId: '', error: '' }),
        destroyInstance: vi.fn().mockResolvedValue({ success: false, instanceId: '' }),
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

    expect(ctx.agents.delegate).toHaveBeenCalledWith('coder', 'test', {});
  });
});

describe('agents.spawnInstance handler', () => {
  const handler = handlers['agents.spawnInstance'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should spawn an instance successfully', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, { agentName: 'worker' });

    expect(isAgentSpawnResult(result)).toBe(true);
    if (isAgentSpawnResult(result)) {
      expect(result.instanceId).toBe('inst-new-1');
      expect(result.agentName).toBe('worker');
    }

    expect(ctx.agents.spawnInstance).toHaveBeenCalledWith('worker');
  });

  it('should throw on empty agentName', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { agentName: '' })).rejects.toThrow(
      'agentName은 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on missing agentName', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, {})).rejects.toThrow(
      'agentName은 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on non-string agentName', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { agentName: 123 })).rejects.toThrow(
      'agentName은 비어있지 않은 문자열이어야 합니다.',
    );
  });
});

describe('agents.delegateToInstance handler', () => {
  const handler = handlers['agents.delegateToInstance'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should delegate to instance successfully', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      instanceId: 'inst-new-1',
      task: 'Run analysis',
    });

    expect(isAgentDelegateResult(result)).toBe(true);
    if (isAgentDelegateResult(result)) {
      expect(result.success).toBe(true);
      expect(result.agentName).toBe('worker');
      expect(result.instanceId).toBe('inst-new-1');
      expect(result.response).toBe('Instance task completed');
    }

    expect(ctx.agents.delegateToInstance).toHaveBeenCalledWith('inst-new-1', 'Run analysis', {});
  });

  it('should pass context and async options', async () => {
    const ctx = createMockContext();
    await handler(ctx, {
      instanceId: 'inst-new-1',
      task: 'Background work',
      context: 'Some context',
      async: true,
    });

    expect(ctx.agents.delegateToInstance).toHaveBeenCalledWith('inst-new-1', 'Background work', {
      context: 'Some context',
      async: true,
    });
  });

  it('should throw on empty instanceId', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { instanceId: '', task: 'test' })).rejects.toThrow(
      'instanceId는 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on missing instanceId', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { task: 'test' })).rejects.toThrow(
      'instanceId는 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on empty task', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { instanceId: 'inst-1', task: '' })).rejects.toThrow(
      'task는 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on missing task', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { instanceId: 'inst-1' })).rejects.toThrow(
      'task는 비어있지 않은 문자열이어야 합니다.',
    );
  });
});

describe('agents.destroyInstance handler', () => {
  const handler = handlers['agents.destroyInstance'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should destroy an instance successfully', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, { instanceId: 'inst-new-1' });

    expect(isAgentDestroyResult(result)).toBe(true);
    if (isAgentDestroyResult(result)) {
      expect(result.success).toBe(true);
      expect(result.instanceId).toBe('inst-new-1');
      expect(result.error).toBeNull();
    }

    expect(ctx.agents.destroyInstance).toHaveBeenCalledWith('inst-new-1');
  });

  it('should throw on empty instanceId', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, { instanceId: '' })).rejects.toThrow(
      'instanceId는 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should throw on missing instanceId', async () => {
    const ctx = createMockContext();

    await expect(handler(ctx, {})).rejects.toThrow(
      'instanceId는 비어있지 않은 문자열이어야 합니다.',
    );
  });

  it('should handle destroy failure', async () => {
    const ctx = createMockContext({
      agents: {
        delegate: vi.fn().mockResolvedValue({ success: true, agentName: '', instanceId: '' }),
        listInstances: vi.fn().mockResolvedValue([]),
        spawnInstance: vi.fn().mockResolvedValue({ instanceId: '', agentName: '' }),
        delegateToInstance: vi.fn().mockResolvedValue({ success: false, agentName: '', instanceId: '', error: '' }),
        destroyInstance: vi.fn().mockResolvedValue({
          success: false,
          instanceId: 'nonexistent',
          error: 'Instance not found',
        }),
      },
    });

    const result = await handler(ctx, { instanceId: 'nonexistent' });

    expect(isAgentDestroyResult(result)).toBe(true);
    if (isAgentDestroyResult(result)) {
      expect(result.success).toBe(false);
      expect(result.error).toBe('Instance not found');
    }
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
        spawnInstance: vi.fn().mockResolvedValue({ instanceId: '', agentName: '' }),
        delegateToInstance: vi.fn().mockResolvedValue({ success: false, agentName: '', instanceId: '', error: '' }),
        destroyInstance: vi.fn().mockResolvedValue({ success: false, instanceId: '' }),
      },
    });
    const result = await handler(ctx, {});

    expect(isAgentListInstancesResult(result)).toBe(true);
    if (isAgentListInstancesResult(result)) {
      expect(result.instances).toHaveLength(0);
    }
  });
});
