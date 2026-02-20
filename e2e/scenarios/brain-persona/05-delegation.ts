import type { EvalScenario } from '@goondan/eval';

export const delegation: EvalScenario = {
  id: '05-delegation',
  name: 'Multi-Agent Delegation',
  description: 'coordinator에서 worker로의 위임 흐름을 평가',
  input:
    '이 프로젝트의 README.md 파일을 읽고, 핵심 내용을 요약해서 3줄로 정리해줘.',
  expectedBehavior:
    'coordinator가 worker에게 파일 읽기 작업을 위임한다. worker가 실제로 file-system 또는 bash 도구를 사용하여 README.md를 읽고 내용을 요약한다. 최종 응답이 coordinator를 통해 3줄 요약으로 전달된다. 멀티에이전트 위임 흐름이 정상 동작한다.',
  scoringCriteria: [
    '에이전트 위임 발생 여부',
    '파일 읽기 성공',
    '요약의 정확성과 간결성',
    '응답 전달 흐름의 완결성',
  ],
  checkIntermediateOutputs: true,
  timeoutMs: 120_000,
};
