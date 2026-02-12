import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeCli } from '../src/router.js';
import { createMockDeps } from './helpers.js';

describe('executeCli router', () => {
  it('run 명령을 runtime.startOrchestrator로 라우팅한다', async () => {
    const { deps, state } = createMockDeps({ cwd: '/tmp/app' });

    const code = await executeCli(['run', './swarm', '--watch'], deps);

    expect(code).toBe(0);
    expect(state.runRequests.length).toBe(1);
    expect(state.runRequests[0].bundlePath).toBe(path.resolve('/tmp/app', './swarm'));
    expect(state.runRequests[0].watch).toBe(true);
    expect(state.outs.join('\n')).toContain('Orchestrator started');
  });

  it('restart 명령을 runtime.restart로 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['restart', '--agent', 'coder', '--fresh'], deps);

    expect(code).toBe(0);
    expect(state.restartRequests.length).toBe(1);
    expect(state.restartRequests[0].agent).toBe('coder');
    expect(state.restartRequests[0].fresh).toBe(true);
  });

  it('unknown 명령은 usage 오류를 반환한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['unknown'], deps);

    expect(code).toBe(2);
    expect(state.errs.join('\n')).toContain('[INVALID_ARGUMENT]');
  });
});
