import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeEventBusImpl, type RuntimeEvent } from '../src/events/runtime-events.js';
import { attachRuntimeEventPersistence } from '../src/runner/runtime-runner.js';

interface PersistedRuntimeEvent {
  instanceKey: string;
  event: RuntimeEvent;
}

interface PersistenceHarness {
  events: PersistedRuntimeEvent[];
  runtimeEventBus: RuntimeEventBusImpl;
  runtimeEventTurnQueueKeys: Map<string, string>;
  detach: () => void;
}

function createPersistenceHarness(): PersistenceHarness {
  const events: PersistedRuntimeEvent[] = [];
  const runtimeEventBus = new RuntimeEventBusImpl();
  const runtimeEventTurnQueueKeys = new Map<string, string>();
  const detach = attachRuntimeEventPersistence({
    storage: {
      appendRuntimeEvent: async (instanceKey, event) => {
        events.push({
          instanceKey,
          event,
        });
      },
    },
    runtimeEventBus,
    runtimeEventTurnQueueKeys,
  });

  return {
    events,
    runtimeEventBus,
    runtimeEventTurnQueueKeys,
    detach,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('attachRuntimeEventPersistence', () => {
  it('queueKey 대신 실제 instanceKey로 runtime event를 저장한다', async () => {
    const harness = createPersistenceHarness();
    const turnId = 'turn-queue-key-mismatch';

    await harness.runtimeEventBus.emit({
      type: 'turn.started',
      timestamp: '2026-02-01T00:00:00.000Z',
      agentName: 'planner',
      turnId,
      instanceKey: 'thread:42',
    });
    await harness.runtimeEventBus.emit({
      type: 'step.started',
      timestamp: '2026-02-01T00:00:01.000Z',
      agentName: 'planner',
      stepId: `${turnId}-step-1`,
      stepIndex: 1,
      turnId,
    });
    await harness.runtimeEventBus.emit({
      type: 'tool.called',
      timestamp: '2026-02-01T00:00:02.000Z',
      agentName: 'planner',
      toolCallId: 'tool-1',
      toolName: 'search__run',
      stepId: `${turnId}-step-1`,
      turnId,
    });
    await harness.runtimeEventBus.emit({
      type: 'turn.completed',
      timestamp: '2026-02-01T00:00:03.000Z',
      agentName: 'planner',
      turnId,
      instanceKey: 'thread:42',
      stepCount: 1,
      duration: 3,
    });

    harness.detach();

    expect(harness.events).toHaveLength(4);
    expect(harness.events.map((item) => item.instanceKey)).toEqual([
      'thread:42',
      'thread:42',
      'thread:42',
      'thread:42',
    ]);
    expect(harness.events.some((item) => item.instanceKey === 'planner:thread:42')).toBe(false);
    expect(harness.runtimeEventTurnQueueKeys.has(turnId)).toBe(false);
  });

  it('turn 이벤트의 instanceKey 누락 시 turnId 매핑으로 fallback하고 turn.failed에서 정리한다', async () => {
    const harness = createPersistenceHarness();
    const turnId = 'turn-missing-instance';
    harness.runtimeEventTurnQueueKeys.set(turnId, 'thread:fallback');

    await harness.runtimeEventBus.emit({
      type: 'turn.started',
      timestamp: '2026-02-01T01:00:00.000Z',
      agentName: 'reviewer',
      turnId,
      instanceKey: '',
    });
    await harness.runtimeEventBus.emit({
      type: 'step.started',
      timestamp: '2026-02-01T01:00:01.000Z',
      agentName: 'reviewer',
      stepId: `${turnId}-step-1`,
      stepIndex: 1,
      turnId,
    });
    await harness.runtimeEventBus.emit({
      type: 'turn.failed',
      timestamp: '2026-02-01T01:00:02.000Z',
      agentName: 'reviewer',
      turnId,
      instanceKey: '',
      duration: 2,
      errorMessage: 'boom',
    });

    harness.detach();

    expect(harness.events).toHaveLength(3);
    expect(harness.events.map((item) => item.instanceKey)).toEqual([
      'thread:fallback',
      'thread:fallback',
      'thread:fallback',
    ]);
    expect(harness.runtimeEventTurnQueueKeys.has(turnId)).toBe(false);
  });

  it('turnId 매핑이 없으면 step/tool 이벤트를 안전하게 drop한다', async () => {
    const harness = createPersistenceHarness();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await harness.runtimeEventBus.emit({
      type: 'step.started',
      timestamp: '2026-02-01T02:00:00.000Z',
      agentName: 'planner',
      stepId: 'missing-turn-step',
      stepIndex: 1,
      turnId: 'missing-turn',
    });

    harness.detach();

    expect(harness.events).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
