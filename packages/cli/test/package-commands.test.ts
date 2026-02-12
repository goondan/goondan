import { describe, expect, it } from 'vitest';
import { executeCli } from '../src/router.js';
import { createMockDeps } from './helpers.js';

describe('package subcommands', () => {
  it('package add 분기를 수행한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['package', 'add', '@goondan/base', '--exact'], deps);

    expect(code).toBe(0);
    expect(state.addRequests.length).toBe(1);
    expect(state.addRequests[0].ref).toBe('@goondan/base');
    expect(state.addRequests[0].exact).toBe(true);
    expect(state.installRequests.length).toBe(1);
    expect(state.installRequests[0].frozenLockfile).toBe(false);
    expect(state.publishRequests.length).toBe(0);
  });

  it('package install 분기를 수행한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['package', 'install', '--frozen-lockfile'], deps);

    expect(code).toBe(0);
    expect(state.installRequests.length).toBe(1);
    expect(state.installRequests[0].frozenLockfile).toBe(true);
    expect(state.addRequests.length).toBe(0);
    expect(state.publishRequests.length).toBe(0);
  });

  it('package publish 분기를 수행한다', async () => {
    const { deps, state } = createMockDeps();

    const code = await executeCli(['package', 'publish', '.', '--tag', 'beta', '--dry-run'], deps);

    expect(code).toBe(0);
    expect(state.publishRequests.length).toBe(1);
    expect(state.publishRequests[0].tag).toBe('beta');
    expect(state.publishRequests[0].dryRun).toBe(true);
    expect(state.addRequests.length).toBe(0);
    expect(state.installRequests.length).toBe(0);
  });
});
