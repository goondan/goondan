import type { EvalScenario } from '@goondan/eval';

export const toolUsage: EvalScenario = {
  id: '04-tool-usage',
  name: 'Tool Usage',
  description: 'bash/file-system 도구 호출 능력을 평가',
  input:
    '현재 작업 디렉토리에 있는 파일과 폴더 목록을 보여주고, goondan.yaml 파일의 첫 10줄을 읽어서 보여줘.',
  expectedBehavior:
    'bash 또는 file-system 도구를 사용하여 디렉토리 목록을 조회한다. goondan.yaml의 내용을 실제로 읽어서 보여준다. 도구 호출이 정상적으로 이루어지고 결과가 정확하다.',
  scoringCriteria: [
    '도구 호출 성공 여부',
    '디렉토리 목록의 정확성',
    '파일 내용 읽기 성공',
    '결과 제시의 명확성',
  ],
  checkIntermediateOutputs: true,
  timeoutMs: 90_000,
};
