/**
 * 에이전트 위임 도구
 *
 * agent.delegate - 다른 에이전트에게 작업 위임 (비동기 이벤트 큐 방식)
 * agent.list - 사용 가능한 에이전트 목록 조회
 *
 * 스펙 기반 동작 (docs/requirements/05_core-concepts.md §5.1, docs/requirements/09_runtime-model.md §9.2):
 * - AgentInstance는 이벤트 큐를 가진다 (MUST)
 * - 큐의 이벤트 하나가 Turn의 입력이 된다 (MUST)
 * - Turn은 "하나의 입력 이벤트"를 처리하는 단위 (MUST)
 * - 위임 흐름:
 *   1. agent.delegate 호출 → 대상 에이전트 큐에 작업 enqueue
 *   2. 대상 에이전트 Turn 완료 → 결과가 원래 에이전트 큐에 enqueue
 *   3. 원래 에이전트의 새 Turn에서 결과 처리
 *
 * §9.1.1: "Runtime이 에이전트 간 handoff를 위해 내부 이벤트를 생성하거나
 * 라우팅할 때, turn.auth는 변경 없이 전달되어야 한다(MUST)"
 */
import type { JsonObject, JsonValue, ToolHandler, ToolContext } from '@goondan/core';

interface DelegateInput {
  agent: string;
  task: string;
  context?: string;
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
   * 에이전트에게 작업 위임 (비동기)
   *
   * 대상 에이전트의 이벤트 큐에 작업을 enqueue하고 바로 반환합니다.
   * 위임된 에이전트는 자신의 Turn에서 작업을 처리하고,
   * Turn 완료 시 결과가 원래 에이전트에게 전달됩니다.
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
    const fromAgent = ctx.agent.metadata?.name || 'unknown';

    // 에이전트 존재 여부 확인
    const agentInfo = AVAILABLE_AGENTS.find((a) => a.name === agentName);
    if (!agentInfo) {
      const availableNames = AVAILABLE_AGENTS.map((a) => a.name).join(', ');
      throw new Error(`'${agentName}' 에이전트를 찾을 수 없습니다. 사용 가능: ${availableNames}`);
    }

    // 위임 ID 생성
    const delegationId = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullTask = context ? `${task}\n\n컨텍스트:\n${context}` : task;

    // 이벤트 버스를 통해 위임 이벤트 발행
    // Runtime이 이 이벤트를 수신하여 대상 에이전트의 이벤트 큐에 enqueue
    ctx.events.emit('agent.delegate', {
      delegationId,
      fromAgent,
      toAgent: agentName,
      task: fullTask,
      // 스펙 §9.1.1: handoff 시 turn.auth는 변경 없이 전달 (MUST)
      origin: ctx.turn.origin,
      auth: ctx.turn.auth,
      metadata: {
        isDelegation: true,
        delegationId,
        delegatedFrom: fromAgent,
        // 결과를 반환받을 에이전트 정보
        returnTo: fromAgent,
      },
      timestamp: new Date().toISOString(),
    });

    // 비동기 위임이므로 바로 반환
    // 위임받은 에이전트의 Turn이 끝나면 결과가 이 에이전트의 큐에 enqueue됨
    return {
      delegationId,
      status: 'queued',
      toAgent: agentName,
      agentDescription: agentInfo.description,
      task,
      message: `작업이 ${agentName} 에이전트에게 위임되었습니다. 작업이 완료되면 결과가 전달될 것입니다.`,
    };
  },
};
