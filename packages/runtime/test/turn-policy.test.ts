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

  it('requiredTools가 있어도 maxSteps 도달 시 종료하며 미충족 목록을 안내한다', () => {
    const result = buildStepLimitResponse({
      maxSteps: 4,
      requiredToolNames: ['channel-dispatch__send', 'agents__request'],
      calledToolNames: new Set<string>(['agents__request']),
      lastText: '중간 결과입니다.',
    });

    expect(result).toContain('중간 결과입니다.');
    expect(result).toContain('maxStepsPerTurn(4)');
    expect(result).toContain('channel-dispatch__send');
  });

  it('응답 텍스트가 없으면 step 제한 요약만 반환한다', () => {
    const result = buildStepLimitResponse({
      maxSteps: 3,
      requiredToolNames: ['channel-dispatch__send'],
      calledToolNames: new Set<string>(),
      lastText: '   ',
    });

    expect(result).toBe('maxStepsPerTurn(3)에 도달하여 종료했습니다. requiredTools 미충족: channel-dispatch__send');
  });
});
