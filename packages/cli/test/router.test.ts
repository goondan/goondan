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
    expect(state.outs.join('\n')).toContain('logs: gdn logs --instance-key');
  });

  it('restart 명령을 runtime.restart로 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['restart', '--agent', 'coder', '--fresh'], deps);

    expect(code).toBe(0);
    expect(state.restartRequests.length).toBe(1);
    expect(state.restartRequests[0].agent).toBe('coder');
    expect(state.restartRequests[0].fresh).toBe(true);
  });

  it('logs 명령을 logs.read로 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['logs', '--instance-key', 'instance-abc', '--process', 'orchestrator', '--lines', '50'], deps);

    expect(code).toBe(0);
    expect(state.logRequests.length).toBe(1);
    expect(state.logRequests[0].instanceKey).toBe('instance-abc');
    expect(state.logRequests[0].process).toBe('orchestrator');
    expect(state.logRequests[0].lines).toBe(50);
    expect(state.outs.join('\n')).toContain('Logs instance=instance-abc');
  });

  it('unknown 명령은 파싱 오류를 반환한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['unknown'], deps);

    expect(code).toBe(2);
    expect(state.errs.length).toBeGreaterThan(0);
  });

  it('validate 명령을 validator.validate로 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['validate', '.', '--format', 'json'], deps);

    expect(code).toBe(0);
    expect(state.outs.join('\n')).toContain('"valid": true');
  });

  it('instance list 명령을 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['instance', 'list', '--limit', '5'], deps);

    expect(code).toBe(0);
    expect(state.listRequests.length).toBe(1);
    expect(state.listRequests[0].limit).toBe(5);
  });

  it('instance delete 명령을 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['instance', 'delete', 'my-key', '--force'], deps);

    expect(code).toBe(0);
    expect(state.deleteRequests.length).toBe(1);
    expect(state.deleteRequests[0].key).toBe('my-key');
    expect(state.deleteRequests[0].force).toBe(true);
  });

  it('doctor 명령을 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['doctor'], deps);

    expect(code).toBe(0);
    expect(state.outs.join('\n')).toContain('Goondan Doctor');
  });
});
