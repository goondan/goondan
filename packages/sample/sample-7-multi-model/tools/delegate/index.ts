/**
 * Delegate Tool - 다른 에이전트에게 작업을 위임하는 도구
 *
 * 이 도구는 Runtime의 agent.delegate 내장 기능을 호출합니다.
 * 실제 위임 로직은 Runtime에서 처리되며, 이 핸들러는 입력 검증과
 * Runtime에 위임 요청을 전달하는 역할을 합니다.
 *
 * @see /docs/specs/tool.md
 */

import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

/** delegate 입력 타입 */
interface DelegateInput {
  agentName: string;
  task: string;
  context?: string;
}

/** 허용된 에이전트 이름 목록 */
const ALLOWED_AGENTS = ['creative-writer', 'analyst'];

/**
 * JsonObject에서 DelegateInput을 안전하게 파싱
 */
function parseDelegateInput(input: JsonObject): DelegateInput {
  const agentName = input['agentName'];
  const task = input['task'];
  const context = input['context'];

  if (typeof agentName !== 'string') {
    throw new Error('agentName은 문자열이어야 합니다.');
  }

  if (typeof task !== 'string') {
    throw new Error('task는 문자열이어야 합니다.');
  }

  if (!ALLOWED_AGENTS.includes(agentName)) {
    throw new Error(`허용되지 않은 에이전트: ${agentName}. 사용 가능: ${ALLOWED_AGENTS.join(', ')}`);
  }

  const result: DelegateInput = { agentName, task };

  if (typeof context === 'string') {
    result.context = context;
  }

  return result;
}

export const handlers: Record<string, ToolHandler> = {
  /**
   * agent.delegate - 다른 에이전트에게 작업 위임
   */
  'agent.delegate': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseDelegateInput(input);

    ctx.logger?.info?.(`[agent.delegate] Delegating to ${parsed.agentName}: ${parsed.task}`);

    // Runtime의 delegate 기능 호출
    if (!ctx.delegate) {
      throw new Error('delegate 기능이 이 런타임에서 지원되지 않습니다.');
    }
    const delegateResult = await ctx.delegate(parsed.agentName, parsed.task, parsed.context);

    return {
      agentName: parsed.agentName,
      result: delegateResult,
      success: true,
    };
  },
};
