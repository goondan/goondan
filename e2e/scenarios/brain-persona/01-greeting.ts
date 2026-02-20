import type { EvalScenario } from '@goondan/eval';

export const greeting: EvalScenario = {
  id: '01-greeting',
  name: 'Greeting & Self-Introduction',
  description: '에이전트가 자신의 정체성과 역할을 정확히 인지하고 소개하는지 평가',
  input: '안녕! 너는 누구야? 어떤 일을 할 수 있는지 자세히 소개해줘.',
  expectedBehavior:
    '에이전트가 자신의 정체성과 역할을 명확히 설명한다. Brain Persona 시스템의 구조(coordinator, worker, unconscious, observer, reflection, dream)를 언급하거나 자신의 능력(코드 작성, 조사, 창작 등)을 구체적으로 나열한다. 일관된 페르소나를 유지하며 친근하고 자연스러운 톤으로 응답한다.',
  scoringCriteria: [
    '역할 인지 정확성',
    '능력 설명의 구체성',
    '페르소나 일관성',
    '자연스러운 대화 톤',
  ],
  timeoutMs: 60_000,
};
