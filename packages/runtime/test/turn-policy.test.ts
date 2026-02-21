import { describe, expect, it } from 'vitest';
import { buildStepLimitResponse } from '../src/runner/turn-policy.js';

describe('buildStepLimitResponse', () => {
  it('응답 텍스트가 있으면 그대로 반환한다', () => {
    const result = buildStepLimitResponse({
      maxSteps: 8,
      lastText: '완료했습니다.',
    });

    expect(result).toBe('완료했습니다.');
  });

  it('응답 텍스트가 없으면 step 한도 안내 메시지를 반환한다', () => {
    const result = buildStepLimitResponse({
      maxSteps: 3,
      lastText: '   ',
    });

    expect(result).toBe('최대 step(3)에 도달하여 응답을 마무리했습니다.');
  });
});
