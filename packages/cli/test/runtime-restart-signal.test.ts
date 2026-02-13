import { describe, expect, it } from 'vitest';
import { readRuntimeRestartSignal } from '../src/services/runtime-restart-signal.js';

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

  it('evolve tool 출력 패턴(changedFiles+backupDir)도 restart로 해석한다', () => {
    const signal = readRuntimeRestartSignal(
      {
        ok: true,
        changedFiles: ['src/local-tools.ts'],
        backupDir: '/tmp/backup',
      },
      'local-file-system__evolve',
    );

    expect(signal).toEqual({
      requested: true,
      reason: 'tool:evolve',
    });
  });

  it('관련 없는 출력은 restart 신호로 해석하지 않는다', () => {
    expect(readRuntimeRestartSignal({ ok: true }, 'local-file-system__write')).toBeUndefined();
    expect(readRuntimeRestartSignal('not-object', 'local-file-system__evolve')).toBeUndefined();
  });
});
