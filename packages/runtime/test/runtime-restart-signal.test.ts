import { describe, expect, it } from 'vitest';
import { readRuntimeRestartSignal } from '../src/runner/runtime-restart-signal.js';

describe('readRuntimeRestartSignal', () => {
  it('명시적 restartRequested 플래그를 읽는다', () => {
    const signal = readRuntimeRestartSignal({
      restartRequested: true,
      restartReason: 'manual',
    });

    expect(signal).toEqual({
      requested: true,
      reason: 'manual',
    });
  });

  it('runtimeRestart 플래그를 restart 신호로 해석한다', () => {
    const signal = readRuntimeRestartSignal({
      runtimeRestart: true,
    });

    expect(signal).toEqual({
      requested: true,
      reason: undefined,
    });
  });

  it('관련 없는 출력은 restart 신호로 해석하지 않는다', () => {
    expect(readRuntimeRestartSignal({ ok: true })).toBeUndefined();
    expect(readRuntimeRestartSignal('not-object')).toBeUndefined();
  });
});
