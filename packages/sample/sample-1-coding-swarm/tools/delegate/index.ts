/**
 * Delegate Tool - 다른 에이전트에게 작업 위임 도구
 *
 * @description
 * 이 도구는 멀티 에이전트 시스템에서 다른 에이전트에게 작업을 위임합니다.
 * Goondan Runtime이 이 도구 호출을 가로채서 실제 에이전트 전환을 수행합니다.
 */

import type { ToolContext, ToolResult } from '@goondan/core/tool';

/**
 * 에이전트 위임 파라미터
 */
export interface DelegateParams {
  /** 위임할 에이전트 이름 */
  agentName: 'planner' | 'coder' | 'reviewer';
  /** 위임할 작업 내용 */
  task: string;
  /** 추가 컨텍스트 (선택) */
  context?: string;
}

/**
 * agent.delegate - 다른 에이전트에게 작업 위임
 *
 * @description
 * 이 도구는 Goondan Runtime의 Agent Routing 기능과 연동됩니다.
 * 실제 에이전트 전환은 Runtime이 처리하며, 이 핸들러는
 * 위임 요청을 검증하고 구조화하는 역할을 합니다.
 *
 * @param params - 위임 파라미터
 * @param ctx - 도구 컨텍스트
 * @returns 위임 요청 결과
 */
export async function delegate(
  params: DelegateParams,
  ctx: ToolContext
): Promise<ToolResult> {
  const { agentName, task, context } = params;

  // 유효한 에이전트 이름인지 검증
  const validAgents = ['planner', 'coder', 'reviewer'];
  if (!validAgents.includes(agentName)) {
    return {
      success: false,
      error: `Invalid agent name: ${agentName}. Valid agents are: ${validAgents.join(', ')}`,
    };
  }

  // 작업 내용 검증
  if (!task || task.trim().length === 0) {
    return {
      success: false,
      error: 'Task description is required',
    };
  }

  // 위임 요청 구성
  // Note: 실제 에이전트 전환은 Goondan Runtime이 이 결과를 보고 처리합니다.
  // Runtime은 __delegation 필드를 인식하여 에이전트 라우팅을 수행합니다.
  return {
    success: true,
    data: {
      __delegation: true,
      targetAgent: agentName,
      task: task.trim(),
      context: context?.trim(),
      message: `작업이 ${agentName} 에이전트에게 위임되었습니다.`,
    },
  };
}

// ============================================================================
// Tool Exports (for Goondan Tool System)
// ============================================================================

/**
 * Tool handler map - Goondan이 이 export를 사용하여 도구를 등록합니다.
 */
export const tools = {
  'agent.delegate': delegate,
};

export default tools;
