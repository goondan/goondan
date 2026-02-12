import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';
import { createMockDeps } from './helpers.js';

describe('runCli', () => {
  it('도움말을 출력하고 종료한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await runCli(['--help'], deps);

    expect(code).toBe(0);
    expect(state.outs.join('\n')).toContain('Goondan CLI (gdn)');
  });
});
