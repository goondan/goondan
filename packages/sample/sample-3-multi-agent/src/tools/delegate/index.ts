/**
 * 에이전트 위임 도구
 *
 * agent.delegate - 다른 에이전트에게 작업 위임
 * agent.list - 사용 가능한 에이전트 목록 조회
 */
import type { JsonObject, JsonValue, ToolHandler, ToolContext } from '@goondan/core';

interface DelegateInput {
  agent: string;
  task: string;
  context?: string;
  waitForResult?: boolean;
}

interface AgentInfo {
  name: string;
  description: string;
  capabilities: string[];
  [key: string]: string | string[];
}

// 사용 가능한 전문 에이전트 정의
const AVAILABLE_AGENTS: AgentInfo[] = [
  {
    name: 'coder',
    description: '코드 작성, 수정, 분석을 담당하는 개발자 에이전트',
    capabilities: ['코드 작성', '코드 수정', '버그 수정', '리팩토링', '코드 실행'],
  },
  {
    name: 'reviewer',
    description: '코드 리뷰와 품질 검사를 담당하는 리뷰어 에이전트',
    capabilities: ['코드 리뷰', '보안 검사', '성능 분석', '베스트 프랙티스 제안'],
  },
  {
    name: 'docs',
    description: '문서화와 주석 작성을 담당하는 문서화 에이전트',
    capabilities: ['README 작성', 'API 문서화', '주석 추가', '사용 가이드 작성'],
  },
];

export const handlers: Record<string, ToolHandler> = {
  /**
   * 에이전트 목록 조회
   */
  'agent.list': async (_ctx: ToolContext, _input: JsonObject): Promise<JsonValue> => {
    return {
      agents: AVAILABLE_AGENTS,
      usage: '각 에이전트는 특정 작업에 특화되어 있습니다. agent.delegate를 사용하여 적절한 에이전트에게 작업을 위임하세요.',
    };
  },

  /**
   * 에이전트에게 작업 위임
   *
   * 이 도구는 런타임의 이벤트 시스템을 사용하여
   * 다른 AgentInstance에 작업을 전달합니다.
   */
  'agent.delegate': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const payload = input as Partial<DelegateInput>;

    if (!payload.agent) {
      throw new Error('agent 이름이 필요합니다. agent.list로 사용 가능한 에이전트를 확인하세요.');
    }
    if (!payload.task) {
      throw new Error('task 설명이 필요합니다.');
    }

    const agentName = payload.agent;
    const task = payload.task;
    const context = payload.context || '';

    // 에이전트 존재 여부 확인
    const agentInfo = AVAILABLE_AGENTS.find((a) => a.name === agentName);
    if (!agentInfo) {
      const availableNames = AVAILABLE_AGENTS.map((a) => a.name).join(', ');
      throw new Error(`'${agentName}' 에이전트를 찾을 수 없습니다. 사용 가능: ${availableNames}`);
    }

    // 위임 이벤트 발행
    // 런타임이 이 이벤트를 받아 해당 AgentInstance의 이벤트 큐에 추가합니다
    const delegationId = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    ctx.events.emit('agent.delegated', {
      delegationId,
      fromAgent: ctx.agent.metadata?.name || 'router',
      toAgent: agentName,
      task,
      context,
      turnId: ctx.turn?.id,
      timestamp: new Date().toISOString(),
    });

    // 위임 결과 구조체
    // 실제 런타임에서는 이 이벤트를 처리하여 에이전트 간 통신을 수행합니다
    return {
      delegationId,
      status: 'delegated',
      toAgent: agentName,
      agentDescription: agentInfo.description,
      task,
      message: `작업이 ${agentName} 에이전트에게 위임되었습니다. 결과는 해당 에이전트가 완료 후 반환합니다.`,
      note: '현재 샘플에서는 동기적 위임만 지원합니다. 실제 프로덕션에서는 비동기 완료 이벤트를 처리합니다.',
    };
  },

  /**
   * 작업 완료 보고
   *
   * 위임받은 에이전트가 작업을 완료했을 때 호출합니다.
   */
  'agent.complete': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const delegationId = input.delegationId as string | undefined;
    const result = input.result as JsonValue | undefined;
    const summary = input.summary as string | undefined;

    if (!delegationId) {
      throw new Error('delegationId가 필요합니다.');
    }

    // 완료 이벤트 발행
    ctx.events.emit('agent.completed', {
      delegationId,
      agent: ctx.agent.metadata?.name || 'unknown',
      result,
      summary,
      timestamp: new Date().toISOString(),
    });

    return {
      status: 'completed',
      delegationId,
      message: '작업 완료가 보고되었습니다.',
    };
  },
};
