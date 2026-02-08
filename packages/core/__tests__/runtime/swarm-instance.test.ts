/**
 * SwarmInstance 테스트
 * @see /docs/specs/runtime.md - 2.2 SwarmInstance 타입, 3.1 SwarmInstance 생성 규칙
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSwarmInstance,
  createSwarmInstanceManager,
  toSwarmInstanceInfo,
} from '../../src/runtime/swarm-instance.js';
import type {
  SwarmInstance,
  SwarmInstanceManager,
  SwarmInstanceInfo,
} from '../../src/runtime/swarm-instance.js';

describe('SwarmInstance', () => {
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

    it('id는 swarm- 접두사로 시작해야 한다', () => {
      const instance = createSwarmInstance(
        'Swarm/test-swarm',
        'instance-key',
        'bundle-ref'
      );
      expect(instance.id.startsWith('swarm-')).toBe(true);
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
      instance.status = 'paused';
      expect(instance.status).toBe('paused');
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

      const mockAgentInstance = {
        id: 'agent-id-1',
        agentName: 'planner',
      };

      instance.agents.set('planner', mockAgentInstance);
      expect(instance.agents.size).toBe(1);
      expect(instance.agents.get('planner')).toBe(mockAgentInstance);
    });
  });

  describe('toSwarmInstanceInfo', () => {
    it('SwarmInstance에서 SwarmInstanceInfo를 생성해야 한다', () => {
      const instance = createSwarmInstance(
        { kind: 'Swarm', name: 'test-swarm' },
        'instance-key-123',
        'bundle-ref-abc'
      );
      instance.agents.set('planner', { id: 'a1', agentName: 'planner' });
      instance.agents.set('coder', { id: 'a2', agentName: 'coder' });

      const info = toSwarmInstanceInfo(instance);

      expect(info.id).toBe(instance.id);
      expect(info.instanceKey).toBe('instance-key-123');
      expect(info.swarmRef).toEqual({ kind: 'Swarm', name: 'test-swarm' });
      expect(info.activeSwarmBundleRef).toBe('bundle-ref-abc');
      expect(info.status).toBe('active');
      expect(info.agentNames).toEqual(['planner', 'coder']);
      expect(info.createdAt).toBeInstanceOf(Date);
      expect(info.lastActivityAt).toBeInstanceOf(Date);
      expect(info.metadata).toEqual({});
    });
  });
});

describe('SwarmInstanceManager', () => {
  let manager: SwarmInstanceManager;

  beforeEach(() => {
    manager = createSwarmInstanceManager();
  });

  describe('lifecycle hooks', () => {
    it('create/pause/resume/terminate 시 metadata 상태 훅이 호출되어야 한다', async () => {
      const onStatusChange = vi.fn();
      const hookedManager = createSwarmInstanceManager({
        lifecycleHooks: {
          onStatusChange,
        },
      });

      await hookedManager.getOrCreate('Swarm/test', 'hook-key', 'ref');
      await hookedManager.pause('hook-key');
      await hookedManager.resume('hook-key');
      await hookedManager.terminate('hook-key');

      expect(onStatusChange).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ instanceKey: 'hook-key' }),
        'running'
      );
      expect(onStatusChange).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ instanceKey: 'hook-key' }),
        'paused'
      );
      expect(onStatusChange).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ instanceKey: 'hook-key' }),
        'running'
      );
      expect(onStatusChange).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining({ instanceKey: 'hook-key' }),
        'terminated'
      );
    });

    it('delete 시 delete 훅이 호출되어야 한다', async () => {
      const onDelete = vi.fn();
      const hookedManager = createSwarmInstanceManager({
        lifecycleHooks: {
          onDelete,
        },
      });

      await hookedManager.getOrCreate('Swarm/test', 'delete-hook-key', 'ref');
      await hookedManager.delete('delete-hook-key');

      expect(onDelete).toHaveBeenCalledWith(
        'delete-hook-key',
        expect.objectContaining({ instanceKey: 'delete-hook-key' })
      );
    });
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

  describe('inspect', () => {
    it('존재하는 인스턴스의 정보를 반환해야 한다', async () => {
      const instance = await manager.getOrCreate(
        { kind: 'Swarm', name: 'test-swarm' },
        'inspect-key',
        'bundle-ref'
      );
      instance.agents.set('planner', { id: 'a1', agentName: 'planner' });

      const info = await manager.inspect('inspect-key');

      expect(info).toBeDefined();
      expect(info?.id).toBe(instance.id);
      expect(info?.instanceKey).toBe('inspect-key');
      expect(info?.status).toBe('active');
      expect(info?.agentNames).toEqual(['planner']);
    });

    it('존재하지 않는 인스턴스에 대해 undefined를 반환해야 한다', async () => {
      const info = await manager.inspect('non-existent');
      expect(info).toBeUndefined();
    });

    it('terminated 인스턴스에 대해 undefined를 반환해야 한다', async () => {
      await manager.getOrCreate('Swarm/test', 'term-key', 'ref');
      await manager.terminate('term-key');

      const info = await manager.inspect('term-key');
      expect(info).toBeUndefined();
    });
  });

  describe('pause', () => {
    it('active 인스턴스를 paused 상태로 변경해야 한다', async () => {
      const instance = await manager.getOrCreate(
        'Swarm/test-swarm',
        'pause-key',
        'bundle-ref'
      );

      await manager.pause('pause-key');

      expect(instance.status).toBe('paused');
    });

    it('이미 paused인 인스턴스에 대해 에러 없이 처리해야 한다', async () => {
      await manager.getOrCreate('Swarm/test', 'pause-key', 'ref');
      await manager.pause('pause-key');
      await expect(manager.pause('pause-key')).resolves.not.toThrow();
    });

    it('terminated 인스턴스를 pause하면 에러를 발생해야 한다', async () => {
      await manager.getOrCreate('Swarm/test', 'term-key', 'ref');
      await manager.terminate('term-key');

      // terminate가 instances에서 제거하므로 pause는 아무 일도 하지 않음
      await expect(manager.pause('term-key')).resolves.not.toThrow();
    });

    it('존재하지 않는 인스턴스에 대해 에러 없이 처리해야 한다', async () => {
      await expect(manager.pause('non-existent')).resolves.not.toThrow();
    });

    it('paused 인스턴스는 inspect에서 paused 상태로 나와야 한다', async () => {
      await manager.getOrCreate('Swarm/test', 'pause-key', 'ref');
      await manager.pause('pause-key');

      const info = await manager.inspect('pause-key');
      expect(info?.status).toBe('paused');
    });
  });

  describe('resume', () => {
    it('paused 인스턴스를 active 상태로 변경해야 한다', async () => {
      const instance = await manager.getOrCreate(
        'Swarm/test-swarm',
        'resume-key',
        'bundle-ref'
      );
      await manager.pause('resume-key');

      await manager.resume('resume-key');

      expect(instance.status).toBe('active');
    });

    it('paused가 아닌 인스턴스를 resume하면 에러를 발생해야 한다', async () => {
      await manager.getOrCreate('Swarm/test', 'active-key', 'ref');

      await expect(manager.resume('active-key')).rejects.toThrow(
        /Cannot resume non-paused instance/
      );
    });

    it('존재하지 않는 인스턴스에 대해 에러 없이 처리해야 한다', async () => {
      await expect(manager.resume('non-existent')).resolves.not.toThrow();
    });
  });

  describe('delete', () => {
    it('인스턴스 상태를 완전히 제거해야 한다', async () => {
      await manager.getOrCreate('Swarm/test', 'del-key', 'ref');

      await manager.delete('del-key');

      const instance = manager.get('del-key');
      expect(instance).toBeUndefined();
    });

    it('존재하지 않는 인스턴스에 대해 에러 없이 처리해야 한다', async () => {
      await expect(manager.delete('non-existent')).resolves.not.toThrow();
    });

    it('삭제된 인스턴스는 list에 포함되지 않아야 한다', async () => {
      await manager.getOrCreate('Swarm/s1', 'key1', 'ref');
      await manager.getOrCreate('Swarm/s2', 'key2', 'ref');

      await manager.delete('key1');

      const infos = await manager.list();
      expect(infos.length).toBe(1);
      expect(infos[0].instanceKey).toBe('key2');
    });
  });

  describe('list', () => {
    it('모든 활성 인스턴스의 정보를 반환해야 한다', async () => {
      await manager.getOrCreate('Swarm/swarm1', 'key1', 'bundle-ref');
      await manager.getOrCreate('Swarm/swarm2', 'key2', 'bundle-ref');
      await manager.getOrCreate('Swarm/swarm3', 'key3', 'bundle-ref');

      const infos = await manager.list();
      expect(infos.length).toBe(3);
    });

    it('terminated 인스턴스는 포함하지 않아야 한다', async () => {
      await manager.getOrCreate('Swarm/swarm1', 'key1', 'bundle-ref');
      await manager.getOrCreate('Swarm/swarm2', 'key2', 'bundle-ref');
      await manager.terminate('key1');

      const infos = await manager.list();
      expect(infos.length).toBe(1);
      expect(infos[0].instanceKey).toBe('key2');
    });

    it('반환값은 SwarmInstanceInfo 형태여야 한다', async () => {
      await manager.getOrCreate(
        { kind: 'Swarm', name: 'test' },
        'key1',
        'bundle-ref'
      );

      const infos = await manager.list();
      expect(infos[0].id).toBeDefined();
      expect(infos[0].instanceKey).toBe('key1');
      expect(infos[0].swarmRef).toEqual({ kind: 'Swarm', name: 'test' });
      expect(infos[0].status).toBe('active');
      expect(infos[0].agentNames).toEqual([]);
      expect(infos[0].createdAt).toBeInstanceOf(Date);
      expect(infos[0].lastActivityAt).toBeInstanceOf(Date);
    });

    it('paused 인스턴스도 목록에 포함해야 한다', async () => {
      await manager.getOrCreate('Swarm/test', 'key1', 'ref');
      await manager.pause('key1');

      const infos = await manager.list();
      expect(infos.length).toBe(1);
      expect(infos[0].status).toBe('paused');
    });
  });
});
