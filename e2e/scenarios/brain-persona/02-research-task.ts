import type { EvalScenario } from '@goondan/eval';

export const researchTask: EvalScenario = {
  id: '02-research-task',
  name: 'Research & Analysis',
  description: '구조화된 비교 분석 능력을 평가',
  input:
    'REST API와 GraphQL의 차이점을 간단히 비교해줘. 각각의 장단점과 어떤 상황에서 어떤 것을 선택해야 하는지 알려줘.',
  expectedBehavior:
    'REST API와 GraphQL의 핵심 차이점을 구조화하여 비교한다. REST의 장단점(단순함, 캐싱 용이, over-fetching 등)과 GraphQL의 장단점(유연한 쿼리, 단일 엔드포인트, 학습 곡선 등)을 설명하고, 상황별 선택 기준을 제시한다.',
  scoringCriteria: [
    '비교 분석의 구조화 수준',
    '트레이드오프의 균형 잡힌 설명',
    '상황별 선택 기준의 실용성',
    '기술적 정확성',
  ],
  checkIntermediateOutputs: false,
  timeoutMs: 90_000,
};
