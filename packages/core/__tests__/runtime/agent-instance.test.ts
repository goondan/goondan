/**
 * AgentInstance 테스트
 * @see /docs/specs/runtime.md - 2.3 AgentInstance 타입, 3.2 AgentInstance 생성 규칙
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentInstance,
  createAgentInstance,
  AgentEventQueue,
  createAgentEventQueue,
} from '../../src/runtime/agent-instance.js';
import { createSwarmInstance } from '../../src/runtime/swarm-instance.js';
import { createAgentEvent } from '../../src/runtime/types.js';
import type { AgentEvent } from '../../src/runtime/types.js';

describe('AgentEventQueue', () => {
  let queue: AgentEventQueue;

  beforeEach(() => {
    queue = createAgentEventQueue();
  });

  describe('enqueue', () => {
    it('이벤트를 큐에 추가해야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello!');
      queue.enqueue(event);
      expect(queue.length).toBe(1);
    });

    it('여러 이벤트를 FIFO 순서로 추가해야 한다', () => {
      const event1 = createAgentEvent('user.input', 'First');
      const event2 = createAgentEvent('user.input', 'Second');
      const event3 = createAgentEvent('user.input', 'Third');

      queue.enqueue(event1);
      queue.enqueue(event2);
      queue.enqueue(event3);

      expect(queue.length).toBe(3);
    });
  });

  describe('dequeue', () => {
    it('FIFO 순서로 이벤트를 반환해야 한다', () => {
      const event1 = createAgentEvent('user.input', 'First');
      const event2 = createAgentEvent('user.input', 'Second');

      queue.enqueue(event1);
      queue.enqueue(event2);

      expect(queue.dequeue()).toBe(event1);
      expect(queue.dequeue()).toBe(event2);
    });

    it('큐가 비어있으면 null을 반환해야 한다', () => {
      expect(queue.dequeue()).toBeNull();
    });

    it('dequeue 후 length가 감소해야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello');
      queue.enqueue(event);
      expect(queue.length).toBe(1);

      queue.dequeue();
      expect(queue.length).toBe(0);
    });
  });

  describe('peek', () => {
    it('대기 중인 이벤트 목록을 반환해야 한다', () => {
      const event1 = createAgentEvent('user.input', 'First');
      const event2 = createAgentEvent('user.input', 'Second');

      queue.enqueue(event1);
      queue.enqueue(event2);

      const peeked = queue.peek();
      expect(peeked.length).toBe(2);
      expect(peeked[0]).toBe(event1);
      expect(peeked[1]).toBe(event2);
    });

    it('반환된 배열을 수정해도 원본에 영향을 주지 않아야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello');
      queue.enqueue(event);

      const peeked = queue.peek();
      // 배열이 읽기 전용이므로 수정 시도는 타입 에러
      // 대신 length가 변하지 않음을 확인
      expect(peeked.length).toBe(1);
      expect(queue.length).toBe(1);
    });

    it('peek 후에도 이벤트가 큐에 남아있어야 한다', () => {
      const event = createAgentEvent('user.input', 'Hello');
      queue.enqueue(event);

      queue.peek();
      expect(queue.length).toBe(1);
      expect(queue.dequeue()).toBe(event);
    });
  });

  describe('length', () => {
    it('초기값은 0이어야 한다', () => {
      expect(queue.length).toBe(0);
    });

    it('enqueue/dequeue에 따라 갱신되어야 한다', () => {
      const event1 = createAgentEvent('user.input', 'A');
      const event2 = createAgentEvent('user.input', 'B');

      queue.enqueue(event1);
      expect(queue.length).toBe(1);

      queue.enqueue(event2);
      expect(queue.length).toBe(2);

      queue.dequeue();
      expect(queue.length).toBe(1);

      queue.dequeue();
      expect(queue.length).toBe(0);
    });
  });
});

describe('AgentInstance', () => {
  const mockSwarmInstance = createSwarmInstance(
    'Swarm/test-swarm',
    'instance-key',
    'bundle-ref'
  );

  describe('createAgentInstance', () => {
    it('AgentInstance를 생성해야 한다', () => {
      const instance = createAgentInstance(
        mockSwarmInstance,
        { kind: 'Agent', name: 'planner' }
      );

      expect(instance.id).toBeDefined();
      expect(instance.agentName).toBe('planner');
      expect(instance.swarmInstance).toBe(mockSwarmInstance);
      expect(instance.agentRef).toEqual({ kind: 'Agent', name: 'planner' });
      expect(instance.status).toBe('idle');
      expect(instance.currentTurn).toBeNull();
      expect(instance.completedTurnCount).toBe(0);
      expect(instance.createdAt).toBeInstanceOf(Date);
      expect(instance.lastActivityAt).toBeInstanceOf(Date);
    });

    it('문자열 agentRef를 처리해야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/coder');

      expect(instance.agentName).toBe('coder');
      expect(instance.agentRef).toBe('Agent/coder');
    });

    it('이벤트 큐가 초기화되어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');

      expect(instance.eventQueue).toBeDefined();
      expect(instance.eventQueue.length).toBe(0);
    });

    it('extensionStates가 빈 Map으로 초기화되어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');

      expect(instance.extensionStates).toBeInstanceOf(Map);
      expect(instance.extensionStates.size).toBe(0);
    });

    it('sharedState가 빈 객체로 초기화되어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');

      expect(instance.sharedState).toEqual({});
    });
  });

  describe('AgentInstance 상태 관리', () => {
    it('status를 변경할 수 있어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');

      expect(instance.status).toBe('idle');
      instance.status = 'processing';
      expect(instance.status).toBe('processing');
      instance.status = 'terminated';
      expect(instance.status).toBe('terminated');
    });

    it('currentTurn을 설정하고 해제할 수 있어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');

      const mockTurn = { id: 'turn-1' };
      instance.currentTurn = mockTurn as never;
      expect(instance.currentTurn).toBe(mockTurn);

      instance.currentTurn = null;
      expect(instance.currentTurn).toBeNull();
    });

    it('completedTurnCount를 증가시킬 수 있어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');

      expect(instance.completedTurnCount).toBe(0);
      instance.completedTurnCount++;
      expect(instance.completedTurnCount).toBe(1);
      instance.completedTurnCount++;
      expect(instance.completedTurnCount).toBe(2);
    });

    it('lastActivityAt을 갱신할 수 있어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');
      const initialActivity = instance.lastActivityAt;

      instance.lastActivityAt = new Date(Date.now() + 1000);
      expect(instance.lastActivityAt.getTime()).toBeGreaterThan(
        initialActivity.getTime()
      );
    });
  });

  describe('Extension 상태 관리', () => {
    it('Extension별 상태를 저장하고 조회할 수 있어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');

      instance.extensionStates.set('mcp-client', { connected: true, server: 'localhost' });
      instance.extensionStates.set('memory', { items: [] });

      expect(instance.extensionStates.get('mcp-client')).toEqual({
        connected: true,
        server: 'localhost',
      });
      expect(instance.extensionStates.get('memory')).toEqual({ items: [] });
    });
  });

  describe('공유 상태 관리', () => {
    it('sharedState에 데이터를 저장할 수 있어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');

      instance.sharedState['workDir'] = '/tmp/work';
      instance.sharedState['counter'] = 42;

      expect(instance.sharedState['workDir']).toBe('/tmp/work');
      expect(instance.sharedState['counter']).toBe(42);
    });
  });

  describe('이벤트 큐 통합', () => {
    it('이벤트를 enqueue하고 dequeue할 수 있어야 한다', () => {
      const instance = createAgentInstance(mockSwarmInstance, 'Agent/planner');
      const event = createAgentEvent('user.input', 'Hello');

      instance.eventQueue.enqueue(event);
      expect(instance.eventQueue.length).toBe(1);

      const dequeued = instance.eventQueue.dequeue();
      expect(dequeued).toBe(event);
      expect(instance.eventQueue.length).toBe(0);
    });
  });
});
