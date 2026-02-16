import { describe, expect, it } from 'vitest';
import { buildStepLimitResponse } from '../src/runner/turn-policy.js';

describe('buildStepLimitResponse', () => {
  it('requiredTools가 없으면 기존 응답 텍스트를 우선 사용한다', () => {
    const result = buildStepLimitResponse({
      maxSteps: 8,
      requiredToolNames: [],
      calledToolNames: new Set<string>(),
      lastText: '완료했습니다.',
    });

    expect(result).toBe('완료했습니다.');
  });

  it('requiredTools 중 하나라도 호출되면 기존 응답 텍스트를 유지한다', () => {
    const result = buildStepLimitResponse({
      maxSteps: 4,
      requiredToolNames: ['telegram__send', 'slack__send'],
      calledToolNames: new Set<string>(['telegram__send']),
      lastText: '중간 결과입니다.',
    });

    expect(result).toBe('중간 결과입니다.');
  });

  it('requiredTools를 하나도 호출하지 못하면 step 제한 요약을 반환한다', () => {
    const result = buildStepLimitResponse({
      maxSteps: 3,
      requiredToolNames: ['telegram__send', 'slack__send'],
      calledToolNames: new Set<string>(),
      lastText: '   ',
    });

    expect(result).toBe(
      'maxStepsPerTurn(3)에 도달하여 종료했습니다. requiredTools(최소 1개 필요) 미충족: telegram__send, slack__send',
    );
  });
});
