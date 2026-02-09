/**
 * Agents Tool - 에이전트 위임, 인스턴스 생성/삭제/관리
 *
 * ctx.agents API를 통해 다른 에이전트에 작업을 위임하고,
 * 인스턴스를 생성/삭제하며, 현재 Swarm 내 에이전트 인스턴스 목록을 조회합니다.
 *
 * @see /docs/specs/tool.md
 */

import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

export const handlers: Record<string, ToolHandler> = {
  'agents.delegate': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const agentName = input['agentName'];
    const task = input['task'];
    const context = input['context'];
    const asyncFlag = input['async'];

    if (typeof agentName !== 'string' || agentName.trim() === '') {
      throw new Error('agentName은 비어있지 않은 문자열이어야 합니다.');
    }
    if (typeof task !== 'string' || task.trim() === '') {
      throw new Error('task는 비어있지 않은 문자열이어야 합니다.');
    }

    const contextStr = typeof context === 'string' ? context : undefined;
    const isAsync = asyncFlag === true;

    const result = await ctx.agents.delegate(agentName, task, {
      context: contextStr,
      async: isAsync || undefined,
    });

    return {
      success: result.success,
      agentName: result.agentName,
      instanceId: result.instanceId,
      response: result.response ?? null,
      error: result.error ?? null,
    };
  },

  'agents.spawnInstance': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const agentName = input['agentName'];

    if (typeof agentName !== 'string' || agentName.trim() === '') {
      throw new Error('agentName은 비어있지 않은 문자열이어야 합니다.');
    }

    const result = await ctx.agents.spawnInstance(agentName);

    return {
      instanceId: result.instanceId,
      agentName: result.agentName,
    };
  },

  'agents.delegateToInstance': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const instanceId = input['instanceId'];
    const task = input['task'];
    const context = input['context'];
    const asyncFlag = input['async'];

    if (typeof instanceId !== 'string' || instanceId.trim() === '') {
      throw new Error('instanceId는 비어있지 않은 문자열이어야 합니다.');
    }
    if (typeof task !== 'string' || task.trim() === '') {
      throw new Error('task는 비어있지 않은 문자열이어야 합니다.');
    }

    const contextStr = typeof context === 'string' ? context : undefined;
    const isAsync = asyncFlag === true;

    const result = await ctx.agents.delegateToInstance(instanceId, task, {
      context: contextStr,
      async: isAsync || undefined,
    });

    return {
      success: result.success,
      agentName: result.agentName,
      instanceId: result.instanceId,
      response: result.response ?? null,
      error: result.error ?? null,
    };
  },

  'agents.destroyInstance': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const instanceId = input['instanceId'];

    if (typeof instanceId !== 'string' || instanceId.trim() === '') {
      throw new Error('instanceId는 비어있지 않은 문자열이어야 합니다.');
    }

    const result = await ctx.agents.destroyInstance(instanceId);

    return {
      success: result.success,
      instanceId: result.instanceId,
      error: result.error ?? null,
    };
  },

  'agents.listInstances': async (ctx: ToolContext): Promise<JsonValue> => {
    const instances = await ctx.agents.listInstances();
    return {
      instances: instances.map((inst) => ({
        instanceId: inst.instanceId,
        agentName: inst.agentName,
        status: inst.status,
      })),
    };
  },
};
