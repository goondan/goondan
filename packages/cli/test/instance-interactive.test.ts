import { describe, expect, it, vi } from 'vitest';
import { handleInstanceInteractive } from '../src/commands/instance-interactive.js';
import type { GdnArgs, GdnCommand } from '../src/parser.js';
import type { InstanceRecord } from '../src/types.js';
import { createMockDeps, createMockTerminal, simulateKey } from './helpers.js';

type InstanceInteractiveCommand = Extract<GdnCommand, { action: 'instance.interactive' }>;

function makeCmd(): InstanceInteractiveCommand {
  return { action: 'instance.interactive' as const };
}

function makeGlobals(overrides?: Partial<Omit<GdnArgs, 'command'>>): Omit<GdnArgs, 'command'> {
  return {
    config: 'goondan.yaml',
    ...overrides,
  };
}

function makeInstances(...keys: string[]): InstanceRecord[] {
  return keys.map((key) => ({
    key,
    agent: `agent-${key}`,
    status: 'running',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }));
}

describe('handleInstanceInteractive', () => {
  it('non-TTY 환경에서는 instance list로 폴백한다', async () => {
    const { deps, state } = createMockDeps({
      listResult: makeInstances('inst-1'),
    });

    const code = await handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    expect(code).toBe(0);
    expect(state.listRequests.length).toBe(1);
  });

  it('--json 옵션이면 instance list로 폴백한다', async () => {
    const { terminal } = createMockTerminal(true);
    const { deps, state } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1'),
    });

    const code = await handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals({ json: true }),
    });

    expect(code).toBe(0);
    expect(state.listRequests.length).toBe(1);
  });

  it('인스턴스 0개이면 메시지 출력 후 종료한다', async () => {
    const { terminal } = createMockTerminal(true);
    const { deps, state } = createMockDeps({
      terminal,
      listResult: [],
    });

    const code = await handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    expect(code).toBe(0);
    expect(state.outs.join('\n')).toContain('인스턴스가 없습니다');
  });

  it('목록을 렌더링하고 q로 종료한다', async () => {
    const { terminal, state: termState } = createMockTerminal(true);
    const { deps } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1', 'inst-2'),
    });

    const promise = handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    // Wait for render to happen
    await new Promise((r) => setTimeout(r, 10));

    const output = termState.writes.join('');
    expect(output).toContain('Instances');
    expect(output).toContain('inst-1');
    expect(output).toContain('inst-2');
    expect(output).toContain('나가기');
    expect(output).toContain('r 재시작');
    expect(output).toContain('started=2025-01-01T00:00:00Z');
    expect(output).toContain('2 instance(s)');

    simulateKey(termState, 'q');
    const code = await promise;
    expect(code).toBe(0);
  });

  it('↑↓ 키로 커서를 이동한다', async () => {
    const { terminal, state: termState } = createMockTerminal(true);
    const { deps } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1', 'inst-2'),
    });

    const promise = handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    await new Promise((r) => setTimeout(r, 10));

    // Move down
    simulateKey(termState, '\x1b[B');
    await new Promise((r) => setTimeout(r, 10));

    // Check that cursor moved — the second item should now have ">"
    const afterDown = termState.writes.join('');
    expect(afterDown).toContain('> ● inst-2');

    // Move up
    simulateKey(termState, '\x1b[A');
    await new Promise((r) => setTimeout(r, 10));

    simulateKey(termState, 'q');
    const code = await promise;
    expect(code).toBe(0);
  });

  it('Esc로 종료한다', async () => {
    const { terminal, state: termState } = createMockTerminal(true);
    const { deps } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1'),
    });

    const promise = handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    await new Promise((r) => setTimeout(r, 10));

    simulateKey(termState, '\x1b');
    const code = await promise;
    expect(code).toBe(0);
  });

  it('Ctrl+C로 종료한다 (exit code 130)', async () => {
    const { terminal, state: termState } = createMockTerminal(true);
    const { deps } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1'),
    });

    const promise = handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    await new Promise((r) => setTimeout(r, 10));

    simulateKey(termState, '\x03');
    const code = await promise;
    expect(code).toBe(130);
  });

  it('나가기에서 Enter로 종료한다', async () => {
    const { terminal, state: termState } = createMockTerminal(true);
    const { deps } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1'),
    });

    const promise = handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    await new Promise((r) => setTimeout(r, 10));

    // Move cursor down to "나가기" (1 item → cursor 0=inst-1, cursor 1=나가기)
    simulateKey(termState, '\x1b[B');
    await new Promise((r) => setTimeout(r, 10));

    simulateKey(termState, '\r');
    const code = await promise;
    expect(code).toBe(0);
  });

  it('r 키로 선택 인스턴스를 재시작하고 시작 시각 변화를 다시 렌더링한다', async () => {
    const { terminal, state: termState } = createMockTerminal(true);
    let listCallCount = 0;
    const { deps, state } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1', 'inst-2'),
    });

    deps.instances.list = vi.fn(async () => {
      listCallCount += 1;
      if (listCallCount <= 1) {
        return [
          {
            key: 'inst-1',
            agent: 'agent-inst-1',
            status: 'running',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
          {
            key: 'inst-2',
            agent: 'agent-inst-2',
            status: 'running',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ];
      }

      return [
        {
          key: 'inst-1',
          agent: 'agent-inst-1',
          status: 'running',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:01Z',
        },
        {
          key: 'inst-2',
          agent: 'agent-inst-2',
          status: 'running',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ];
    });

    const promise = handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    await new Promise((r) => setTimeout(r, 10));

    simulateKey(termState, 'r');
    await new Promise((r) => setTimeout(r, 50));

    expect(state.restartRequests.length).toBe(1);
    expect(state.restartRequests[0].instanceKey).toBe('inst-1');
    expect(state.restartRequests[0].fresh).toBe(false);

    const output = termState.writes.join('');
    expect(output).toContain('started=2025-01-01T00:00:01Z');

    simulateKey(termState, 'q');
    const code = await promise;
    expect(code).toBe(0);
  });

  it('Del로 인스턴스를 삭제하고 목록을 갱신한다', async () => {
    const { terminal, state: termState } = createMockTerminal(true);
    let callCount = 0;
    const { deps, state } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1', 'inst-2'),
    });

    // Override list to return different results on second call
    const originalList = deps.instances.list;
    deps.instances.list = vi.fn(async (req) => {
      callCount++;
      if (callCount <= 1) {
        return makeInstances('inst-1', 'inst-2');
      }
      return makeInstances('inst-2');
    });

    const promise = handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    await new Promise((r) => setTimeout(r, 10));

    // Delete first instance
    simulateKey(termState, '\x1b[3~');
    await new Promise((r) => setTimeout(r, 50));

    // Should have called delete
    expect(state.deleteRequests.length).toBe(1);
    expect(state.deleteRequests[0].key).toBe('inst-1');

    // Verify re-render with remaining item
    const output = termState.writes.join('');
    expect(output).toContain('inst-2');
    expect(output).toContain('1 instance(s)');

    simulateKey(termState, 'q');
    const code = await promise;
    expect(code).toBe(0);
  });

  it('전체 삭제 시 자동 종료한다', async () => {
    const { terminal, state: termState } = createMockTerminal(true);
    let callCount = 0;
    const { deps, state } = createMockDeps({
      terminal,
      listResult: makeInstances('inst-1'),
    });

    deps.instances.list = vi.fn(async () => {
      callCount++;
      if (callCount <= 1) {
        return makeInstances('inst-1');
      }
      return [];
    });

    const promise = handleInstanceInteractive({
      cmd: makeCmd(),
      deps,
      globals: makeGlobals(),
    });

    await new Promise((r) => setTimeout(r, 10));

    // Delete the only instance
    simulateKey(termState, '\x1b[3~');
    await new Promise((r) => setTimeout(r, 50));

    const code = await promise;
    expect(code).toBe(0);
    expect(state.deleteRequests.length).toBe(1);
    expect(state.outs.join('\n')).toContain('모든 인스턴스가 삭제되었습니다');
  });
});
