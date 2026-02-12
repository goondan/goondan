import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';
import { createMockDeps } from './helpers.js';

describe('runCli', () => {
  it('doctor 명령을 실행하고 종료한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await runCli(['doctor'], deps);

    expect(code).toBe(0);
    expect(state.outs.join('\n')).toContain('Goondan Doctor');
  });

  it('알 수 없는 명령은 파싱 오류를 반환한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await runCli(['nonexistent'], deps);

    expect(code).toBe(2);
    expect(state.errs.length).toBeGreaterThan(0);
  });
});
