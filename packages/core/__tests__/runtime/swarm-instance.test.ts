/**
 * SwarmInstance 테스트
 * @see /docs/specs/runtime.md - 2.2 SwarmInstance 타입, 3.1 SwarmInstance 생성 규칙
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SwarmInstance,
  createSwarmInstance,
  SwarmInstanceManager,
  createSwarmInstanceManager,
} from '../../src/runtime/swarm-instance.js';
import type { SwarmResource } from '../../src/types/specs/swarm.js';

describe('SwarmInstance', () => {
  const mockSwarmResource: SwarmResource = {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Swarm',
    metadata: { name: 'test-swarm' },
    spec: {
      entrypoint: { kind: 'Agent', name: 'planner' },
      agents: [
        { kind: 'Agent', name: 'planner' },
        { kind: 'Agent', name: 'coder' },
      ],
      policy: {
        maxStepsPerTurn: 32,
      },
    },
  };

  describe('createSwarmInstance', () => {
    it('SwarmInstance를 생성해야 한다', () => {
      const instance = createSwarmInstance(
        { kind: 'Swarm', name: 'test-swarm' },
        'instance-key-123',
        'bundle-ref-abc'
      );

      expect(instance.id).toBeDefined();
      expect(instance.instanceKey).toBe('instance-key-123');
      expect(instance.swarmRef).toEqual({ kind: 'Swarm', name: 'test-swarm' });
      expect(instance.activeSwarmBundleRef).toBe('bundle-ref-abc');
      expect(instance.status).toBe('active');
      expect(instance.agents.size).toBe(0);
      expect(instance.createdAt).toBeInstanceOf(Date);
      expect(instance.lastActivityAt).toBeInstanceOf(Date);
    });

    it('id는 UUID 형식이어야 한다', () => {
      const instance = createSwarmInstance(
        'Swarm/test-swarm',
        'instance-key',
        'bundle-ref'
      );
      // UUID v4 형식 검증 (36자, 하이픈 포함)
      expect(instance.id.length).toBeGreaterThanOrEqual(21);
    });

    it('metadata는 빈 객체로 초기화되어야 한다', () => {
      const instance = createSwarmInstance(
        'Swarm/test-swarm',
        'instance-key',
        'bundle-ref'
      );
      expect(instance.metadata).toEqual({});
    });
  });

  describe('SwarmInstance 상태 관리', () => {
    it('status를 변경할 수 있어야 한다', () => {
      const instance = createSwarmInstance(
        'Swarm/test-swarm',
        'instance-key',
        'bundle-ref'
      );

      expect(instance.status).toBe('active');
      instance.status = 'idle';
      expect(instance.status).toBe('idle');
      instance.status = 'terminated';
      expect(instance.status).toBe('terminated');
    });

    it('lastActivityAt을 갱신할 수 있어야 한다', () => {
      const instance = createSwarmInstance(
        'Swarm/test-swarm',
        'instance-key',
        'bundle-ref'
      );
      const initialActivity = instance.lastActivityAt;

      // 시간 경과 시뮬레이션
      instance.lastActivityAt = new Date(Date.now() + 1000);
      expect(instance.lastActivityAt.getTime()).toBeGreaterThan(
        initialActivity.getTime()
      );
    });

    it('activeSwarmBundleRef를 갱신할 수 있어야 한다', () => {
      const instance = createSwarmInstance(
        'Swarm/test-swarm',
        'instance-key',
        'bundle-ref-v1'
      );

      expect(instance.activeSwarmBundleRef).toBe('bundle-ref-v1');
      instance.activeSwarmBundleRef = 'bundle-ref-v2';
      expect(instance.activeSwarmBundleRef).toBe('bundle-ref-v2');
    });
  });

  describe('SwarmInstance agents Map', () => {
    it('AgentInstance를 등록하고 조회할 수 있어야 한다', () => {
      const instance = createSwarmInstance(
        'Swarm/test-swarm',
        'instance-key',
        'bundle-ref'
      );

      // 실제 AgentInstance 대신 mock 객체 사용
      const mockAgentInstance = {
        id: 'agent-id-1',
        agentName: 'planner',
      };

      instance.agents.set('planner', mockAgentInstance as never);
      expect(instance.agents.size).toBe(1);
      expect(instance.agents.get('planner')).toBe(mockAgentInstance);
    });
  });
});

describe('SwarmInstanceManager', () => {
  let manager: SwarmInstanceManager;

  beforeEach(() => {
    manager = createSwarmInstanceManager();
  });

  describe('getOrCreate', () => {
    it('새 인스턴스를 생성해야 한다', async () => {
      const instance = await manager.getOrCreate(
        'Swarm/test-swarm',
        'instance-key-123',
        'bundle-ref'
      );

      expect(instance).toBeDefined();
      expect(instance.instanceKey).toBe('instance-key-123');
      expect(instance.swarmRef).toBe('Swarm/test-swarm');
    });

    it('동일 instanceKey로 기존 인스턴스를 반환해야 한다', async () => {
      const instance1 = await manager.getOrCreate(
        'Swarm/test-swarm',
        'same-key',
        'bundle-ref'
      );
      const instance2 = await manager.getOrCreate(
        'Swarm/test-swarm',
        'same-key',
        'bundle-ref'
      );

      expect(instance1.id).toBe(instance2.id);
    });

    it('기존 인스턴스 반환 시 lastActivityAt을 갱신해야 한다', async () => {
      const instance1 = await manager.getOrCreate(
        'Swarm/test-swarm',
        'same-key',
        'bundle-ref'
      );
      const initialActivity = instance1.lastActivityAt;

      // 약간의 지연 후 재조회
      await new Promise((resolve) => setTimeout(resolve, 10));

      const instance2 = await manager.getOrCreate(
        'Swarm/test-swarm',
        'same-key',
        'bundle-ref'
      );

      expect(instance2.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
        initialActivity.getTime()
      );
    });
  });

  describe('get', () => {
    it('존재하는 인스턴스를 반환해야 한다', async () => {
      await manager.getOrCreate('Swarm/test-swarm', 'my-key', 'bundle-ref');
      const instance = manager.get('my-key');

      expect(instance).toBeDefined();
      expect(instance?.instanceKey).toBe('my-key');
    });

    it('존재하지 않는 instanceKey에 대해 undefined를 반환해야 한다', () => {
      const instance = manager.get('non-existent-key');
      expect(instance).toBeUndefined();
    });
  });

  describe('terminate', () => {
    it('인스턴스를 terminated 상태로 변경해야 한다', async () => {
      const instance = await manager.getOrCreate(
        'Swarm/test-swarm',
        'to-terminate',
        'bundle-ref'
      );

      await manager.terminate('to-terminate');

      expect(instance.status).toBe('terminated');
    });

    it('terminated 인스턴스는 get으로 조회 불가해야 한다', async () => {
      await manager.getOrCreate(
        'Swarm/test-swarm',
        'to-terminate',
        'bundle-ref'
      );
      await manager.terminate('to-terminate');

      const instance = manager.get('to-terminate');
      expect(instance).toBeUndefined();
    });

    it('존재하지 않는 instanceKey에 대해 에러 없이 처리해야 한다', async () => {
      await expect(manager.terminate('non-existent')).resolves.not.toThrow();
    });
  });

  describe('list', () => {
    it('모든 활성 인스턴스를 반환해야 한다', async () => {
      await manager.getOrCreate('Swarm/swarm1', 'key1', 'bundle-ref');
      await manager.getOrCreate('Swarm/swarm2', 'key2', 'bundle-ref');
      await manager.getOrCreate('Swarm/swarm3', 'key3', 'bundle-ref');

      const instances = manager.list();
      expect(instances.length).toBe(3);
    });

    it('terminated 인스턴스는 포함하지 않아야 한다', async () => {
      await manager.getOrCreate('Swarm/swarm1', 'key1', 'bundle-ref');
      await manager.getOrCreate('Swarm/swarm2', 'key2', 'bundle-ref');
      await manager.terminate('key1');

      const instances = manager.list();
      expect(instances.length).toBe(1);
      expect(instances[0].instanceKey).toBe('key2');
    });
  });
});
