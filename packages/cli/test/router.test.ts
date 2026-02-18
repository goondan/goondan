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

  it('run --foreground는 완료 코드를 반환할 때까지 대기한다', async () => {
    const { deps, state } = createMockDeps({
      startResult: {
        instanceKey: 'instance-foreground',
        pid: 5678,
        completion: Promise.resolve(130),
      },
    });

    const code = await executeCli(['run', '--foreground'], deps);

    expect(code).toBe(130);
    expect(state.runRequests.length).toBe(1);
    expect(state.runRequests[0].foreground).toBe(true);
    expect(state.outs.join('\n')).toContain('foreground mode');
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

  it('studio 명령을 studio.startServer로 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['studio', '--host', '0.0.0.0', '--port', '4412', '--no-open'], deps);

    expect(code).toBe(0);
    expect(state.studioServerRequests.length).toBe(1);
    expect(state.studioServerRequests[0]?.host).toBe('0.0.0.0');
    expect(state.studioServerRequests[0]?.port).toBe(4412);
    expect(state.outs.join('\n')).toContain('Studio started');
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


  it('instance restart 명령을 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['instance', 'restart', 'my-key', '--fresh'], deps);

    expect(code).toBe(0);
    expect(state.restartRequests.length).toBe(1);
    expect(state.restartRequests[0].instanceKey).toBe('my-key');
    expect(state.restartRequests[0].fresh).toBe(true);
  });

  it('doctor 명령을 라우팅한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['doctor'], deps);

    expect(code).toBe(0);
    expect(state.outs.join('\n')).toContain('Goondan Doctor');
  });

  it('init 명령을 init.init으로 라우팅한다', async () => {
    const { deps, state } = createMockDeps({ cwd: '/tmp/workspace' });

    const code = await executeCli(['init', 'my-project', '--name', 'my-swarm', '--template', 'multi-agent', '--force'], deps);

    expect(code).toBe(0);
    expect(state.initRequests.length).toBe(1);
    expect(state.initRequests[0].targetDir).toBe(path.resolve('/tmp/workspace', 'my-project'));
    expect(state.initRequests[0].name).toBe('my-swarm');
    expect(state.initRequests[0].template).toBe('multi-agent');
    expect(state.initRequests[0].force).toBe(true);
    expect(state.outs.join('\n')).toContain('Initialized Goondan project');
  });

  it('init 명령에서 이름 미지정 시 디렉토리명을 사용한다', async () => {
    const { deps, state } = createMockDeps({ cwd: '/tmp/workspace' });

    const code = await executeCli(['init', 'cool-agent'], deps);

    expect(code).toBe(0);
    expect(state.initRequests[0].name).toBe('cool-agent');
    expect(state.initRequests[0].template).toBe('default');
    expect(state.initRequests[0].git).toBe(true);
  });

  it('init --no-git 옵션으로 git 초기화를 비활성화한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['init', '--no-git'], deps);

    expect(code).toBe(0);
    expect(state.initRequests[0].git).toBe(false);
  });

  it('bare instance 명령을 instance.interactive로 라우팅한다 (non-TTY 폴백)', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['instance'], deps);

    expect(code).toBe(0);
    // non-TTY 환경이므로 instance list로 폴백
    expect(state.listRequests.length).toBe(1);
  });
});
