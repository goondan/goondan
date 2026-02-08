/**
 * Delegate Tool - 다른 에이전트에게 작업 위임
 */

import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

export const handlers: Record<string, ToolHandler> = {
  'delegate.to-agent': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const agentName = input['agentName'];
    const task = input['task'];

    if (typeof agentName !== 'string') {
      throw new Error('agentName은 문자열이어야 합니다.');
    }
    if (typeof task !== 'string') {
      throw new Error('task는 문자열이어야 합니다.');
    }

    ctx.logger?.info?.(`[delegate.to-agent] Delegating to ${agentName}: ${task}`);

    // 실제 위임은 런타임에서 처리
    return {
      delegated: true,
      agentName,
      task,
    };
  },
};
