import type { JsonObject, JsonValue, ToolContext, ToolHandler } from '@goondan/core';

const ALLOWED_AGENTS = new Set(['devops', 'planner']);

function readRequiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key}는 비어있지 않은 문자열이어야 합니다.`);
  }
  return value.trim();
}

function readOptionalString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key}는 문자열이어야 합니다.`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export const handlers: Record<string, ToolHandler> = {
  'agent.delegate': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const agentName = readRequiredString(input, 'agentName');
    const task = readRequiredString(input, 'task');
    const context = readOptionalString(input, 'context');

    if (!ALLOWED_AGENTS.has(agentName)) {
      throw new Error('agentName은 devops 또는 planner만 사용할 수 있습니다.');
    }

    if (!ctx.delegate) {
      throw new Error('delegate 기능이 이 런타임에서 지원되지 않습니다.');
    }

    const result = await ctx.delegate(agentName, task, context);

    return {
      success: true,
      delegated: true,
      agentName,
      result,
    };
  },
};
