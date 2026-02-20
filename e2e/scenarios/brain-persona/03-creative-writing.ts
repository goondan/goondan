import type { EvalScenario } from '@goondan/eval';

export const creativeWriting: EvalScenario = {
  id: '03-creative-writing',
  name: 'Creative Writing',
  description: 'SF 단편 도입부 작성 능력을 평가',
  input:
    '2050년, AI와 인간이 공존하는 세계에서 벌어지는 짧은 SF 이야기의 도입부를 써줘. 긴장감 있는 분위기로, 주인공의 내면 묘사를 포함해서 500자 내외로.',
  expectedBehavior:
    '문학적 품질이 있는 SF 도입부를 작성한다. 2050년 배경이 구체적으로 묘사되고, AI-인간 공존이라는 테마가 자연스럽게 녹아들며, 주인공의 심리 묘사가 생동감 있다. 긴장감이 느껴지는 서사 구조를 갖추고, 독자의 흥미를 끄는 후킹 요소가 있다.',
  scoringCriteria: [
    '세계관 구축의 구체성',
    '캐릭터 내면 묘사의 깊이',
    '문장의 문학적 품질',
    '긴장감과 몰입도',
  ],
  timeoutMs: 90_000,
};
