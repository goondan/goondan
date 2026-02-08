/**
 * Delegate Tool - 다른 에이전트에게 작업 위임 도구
 */

import type { JsonObject, JsonValue, ToolContext, ToolHandler } from '@goondan/core';

const VALID_AGENTS = new Set([
  'planner',
  'coder',
  'reviewer',
]);

function readAgentName(input: JsonObject): string {
  const agentName = input['agentName'];
  if (typeof agentName !== 'string' || agentName.trim() === '') {
    throw new Error('agentName은 비어있지 않은 문자열이어야 합니다.');
  }
  return agentName;
}

function readTask(input: JsonObject): string {
  const task = input['task'];
  if (typeof task !== 'string' || task.trim() === '') {
    throw new Error('task는 비어있지 않은 문자열이어야 합니다.');
  }
  return task;
}

function readContext(input: JsonObject): string | undefined {
  const context = input['context'];
  if (context === undefined) {
    return undefined;
  }
  if (typeof context !== 'string') {
    throw new Error('context는 문자열이어야 합니다.');
  }
  return context.trim() === '' ? undefined : context.trim();
}

export const handlers: Record<string, ToolHandler> = {
  'agent.delegate': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const agentName = readAgentName(input);
    const task = readTask(input);
    const context = readContext(input);

    if (!VALID_AGENTS.has(agentName)) {
      throw new Error('agentName은 planner, coder, reviewer 중 하나여야 합니다.');
    }

    ctx.logger?.info?.(`[agent.delegate] Delegating task to ${agentName}`);

    return {
      success: true,
      delegated: true,
      targetAgent: agentName,
      task: task.trim(),
      context,
      message: `작업이 ${agentName} 에이전트에게 위임되었습니다.`,
    };
  },
};
