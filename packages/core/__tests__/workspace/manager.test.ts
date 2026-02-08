/**
 * WorkspaceManager 테스트
 * @see /docs/specs/workspace.md - 섹션 12: 디렉터리 초기화
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceManager } from '../../src/workspace/manager.js';
import { createSwarmInstanceManager } from '../../src/runtime/swarm-instance.js';
import type { WorkspaceEvent, InstanceMetadata } from '../../src/workspace/types.js';

describe('WorkspaceManager', () => {
  let tempDir: string;
  let stateRoot: string;
  let bundleRoot: string;
  let manager: WorkspaceManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    stateRoot = path.join(tempDir, '.goondan');
    bundleRoot = path.join(tempDir, 'project');
    await fs.mkdir(bundleRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('WorkspaceManager를 생성해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      expect(manager).toBeInstanceOf(WorkspaceManager);
      expect(manager.getStateDir()).toBe(stateRoot);
      expect(manager.getBundleDir()).toBe(bundleRoot);
    });
  });

  describe('getStateDir', () => {
    it('상태 루트 디렉터리를 반환해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      expect(manager.getStateDir()).toBe(stateRoot);
    });
  });

  describe('getBundleDir', () => {
    it('번들 루트 디렉터리를 반환해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      expect(manager.getBundleDir()).toBe(bundleRoot);
    });
  });

  describe('getWorkspaceDir', () => {
    it('기본적으로 bundleDir을 반환해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      expect(manager.getWorkspaceDir()).toBe(bundleRoot);
    });

    it('명시적으로 설정한 workspaceRoot를 반환해야 한다', () => {
      const customWorkspace = path.join(tempDir, 'custom-workspace');
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
        workspaceRoot: customWorkspace,
      });

      expect(manager.getWorkspaceDir()).toBe(customWorkspace);
    });
  });

  describe('getSecretsDir', () => {
    it('secrets 디렉터리 경로를 반환해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      expect(manager.getSecretsDir()).toBe(path.join(stateRoot, 'secrets'));
    });
  });

  describe('getLogsDir', () => {
    it('logs 디렉터리 경로를 반환해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      // logs는 instances 하위에 있음
      expect(manager.getLogsDir()).toBe(path.join(stateRoot, 'instances'));
    });
  });

  describe('resolveStatePath', () => {
    it('상태 루트 기준 상대 경로를 해석해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const resolved = manager.resolveStatePath('oauth/grants/abc.json');
      expect(resolved).toBe(path.join(stateRoot, 'oauth/grants/abc.json'));
    });
  });

  describe('resolveBundlePath', () => {
    it('번들 루트 기준 상대 경로를 해석해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const resolved = manager.resolveBundlePath('resources/agents/planner.yaml');
      expect(resolved).toBe(path.join(bundleRoot, 'resources/agents/planner.yaml'));
    });
  });

  describe('resolveWorkspacePath', () => {
    it('워크스페이스 루트 기준 상대 경로를 해석해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const resolved = manager.resolveWorkspacePath('src/index.ts');
      expect(resolved).toBe(path.join(bundleRoot, 'src/index.ts'));
    });
  });

  describe('initializeSystemState', () => {
    it('시스템 상태 디렉터리를 초기화해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeSystemState();

      // 디렉터리 존재 확인
      const dirs = [
        path.join(stateRoot, 'bundles'),
        path.join(stateRoot, 'worktrees'),
        path.join(stateRoot, 'oauth', 'grants'),
        path.join(stateRoot, 'oauth', 'sessions'),
        path.join(stateRoot, 'secrets'),
        path.join(stateRoot, 'metrics'),
        path.join(stateRoot, 'instances'),
      ];

      for (const dir of dirs) {
        const exists = await fs
          .stat(dir)
          .then(s => s.isDirectory())
          .catch(() => false);
        expect(exists).toBe(true);
      }
    });

    it('bundles.json을 초기화해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeSystemState();

      const registryPath = path.join(stateRoot, 'bundles.json');
      const content = await fs.readFile(registryPath, 'utf8');
      const data = JSON.parse(content) as { packages: Record<string, unknown> };

      expect(data).toEqual({ packages: {} });
    });

    it('기존 bundles.json을 덮어쓰지 않아야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await fs.mkdir(stateRoot, { recursive: true });
      const registryPath = path.join(stateRoot, 'bundles.json');
      await fs.writeFile(registryPath, JSON.stringify({ packages: { existing: {} } }));

      await manager.initializeSystemState();

      const content = await fs.readFile(registryPath, 'utf8');
      const data = JSON.parse(content) as { packages: Record<string, unknown> };

      expect(data.packages).toHaveProperty('existing');
    });
  });

  describe('initializeInstanceState', () => {
    it('인스턴스 상태 디렉터리를 초기화해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner', 'executor']);

      const workspaceId = manager.getWorkspaceId();

      // Swarm events 디렉터리
      const swarmEventsDir = path.join(
        stateRoot,
        'instances',
        workspaceId,
        'default-cli',
        'swarm',
        'events'
      );
      const swarmEventsExists = await fs
        .stat(swarmEventsDir)
        .then(s => s.isDirectory())
        .catch(() => false);
      expect(swarmEventsExists).toBe(true);

      // Metrics 디렉터리
      const metricsDir = path.join(
        stateRoot,
        'instances',
        workspaceId,
        'default-cli',
        'metrics'
      );
      const metricsExists = await fs
        .stat(metricsDir)
        .then(s => s.isDirectory())
        .catch(() => false);
      expect(metricsExists).toBe(true);

      // Extensions 디렉터리
      const extensionsDir = path.join(
        stateRoot,
        'instances',
        workspaceId,
        'default-cli',
        'extensions'
      );
      const extensionsExists = await fs
        .stat(extensionsDir)
        .then(s => s.isDirectory())
        .catch(() => false);
      expect(extensionsExists).toBe(true);

      const sharedStatePath = path.join(
        stateRoot,
        'instances',
        workspaceId,
        'default-cli',
        'extensions',
        '_shared.json'
      );
      const sharedStateContent = await fs.readFile(sharedStatePath, 'utf8');
      expect(JSON.parse(sharedStateContent)).toEqual({});

      // Agent별 디렉터리
      for (const agentName of ['planner', 'executor']) {
        const messagesDir = path.join(
          stateRoot,
          'instances',
          workspaceId,
          'default-cli',
          'agents',
          agentName,
          'messages'
        );
        const eventsDir = path.join(
          stateRoot,
          'instances',
          workspaceId,
          'default-cli',
          'agents',
          agentName,
          'events'
        );

        const messagesExists = await fs
          .stat(messagesDir)
          .then(s => s.isDirectory())
          .catch(() => false);
        const eventsExists = await fs
          .stat(eventsDir)
          .then(s => s.isDirectory())
          .catch(() => false);

        expect(messagesExists).toBe(true);
        expect(eventsExists).toBe(true);
      }
    });

    it('metadata.json을 초기화해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);

      const workspaceId = manager.getWorkspaceId();
      const metadataPath = path.join(
        stateRoot,
        'instances',
        workspaceId,
        'default-cli',
        'metadata.json'
      );

      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content) as InstanceMetadata;

      expect(metadata.status).toBe('running');
      expect(metadata.updatedAt).toBeDefined();
      expect(metadata.createdAt).toBeDefined();
    });
  });

  describe('getWorkspaceId', () => {
    it('workspaceId를 반환해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const id = manager.getWorkspaceId();
      expect(id).toHaveLength(12);
      expect(/^[a-f0-9]+$/.test(id)).toBe(true);
    });
  });

  describe('getInstanceId', () => {
    it('instanceId를 생성해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const id = manager.getInstanceId('default', 'cli');
      expect(id).toBe('default-cli');
    });
  });

  describe('getSecretsStore', () => {
    it('SecretsStore 인스턴스를 반환해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const store = manager.getSecretsStore();
      expect(store).toBeDefined();
      expect(store.getPath('test')).toBe(path.join(stateRoot, 'secrets', 'test.json'));
    });
  });

  describe('createMessageBaseLogger', () => {
    it('MessageBaseLogger 인스턴스를 반환해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const logger = manager.createMessageBaseLogger('default-cli', 'planner');
      expect(logger).toBeDefined();

      await logger.log({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        messages: [{ id: 'msg-001', role: 'user', content: 'test' }],
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
    });
  });

  describe('createMessageEventLogger', () => {
    it('MessageEventLogger 인스턴스를 반환해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const logger = manager.createMessageEventLogger('default-cli', 'planner');
      expect(logger).toBeDefined();

      await logger.log({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        seq: 1,
        eventType: 'llm_message',
        payload: { message: { id: 'msg-001', role: 'user', content: 'test' } },
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
    });
  });

  describe('createTurnMessageStateLogger', () => {
    it('turn message state 로거 세트를 생성하고 base/events를 기록/정리해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const logger = manager.createTurnMessageStateLogger('default-cli', 'planner');

      await logger.events.log({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        seq: 0,
        eventType: 'llm_message',
        payload: {
          message: {
            id: 'msg-001',
            role: 'user',
            content: 'hello',
          },
        },
      });
      await logger.base.log({
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        messages: [
          {
            id: 'msg-001',
            role: 'user',
            content: 'hello',
          },
        ],
        sourceEventCount: 1,
      });
      await logger.events.clear();

      const baseRecords = await manager
        .createMessageBaseLogger('default-cli', 'planner')
        .readAll();
      const eventRecords = await manager
        .createMessageEventLogger('default-cli', 'planner')
        .readAll();

      expect(baseRecords).toHaveLength(1);
      expect(baseRecords[0]?.sourceEventCount).toBe(1);
      expect(eventRecords).toHaveLength(0);
    });
  });

  describe('createSwarmEventLogger', () => {
    it('SwarmEventLogger 인스턴스를 반환해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const logger = manager.createSwarmEventLogger('default-cli');
      expect(logger).toBeDefined();

      await logger.log({
        traceId: 'trace-a1b2c3',
        kind: 'swarm.created',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        swarmName: 'default',
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
    });
  });

  describe('createAgentEventLogger', () => {
    it('AgentEventLogger 인스턴스를 반환해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const logger = manager.createAgentEventLogger('default-cli', 'planner');
      expect(logger).toBeDefined();

      await logger.log({
        traceId: 'trace-a1b2c3',
        kind: 'turn.started',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
    });
  });

  describe('createTurnMetricsLogger', () => {
    it('TurnMetricsLogger 인스턴스를 반환해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const logger = manager.createTurnMetricsLogger('default-cli');
      expect(logger).toBeDefined();

      await logger.log({
        traceId: 'trace-a1b2c3',
        turnId: 'turn-001',
        instanceId: 'default-cli',
        agentName: 'planner',
        latencyMs: 1500,
        tokenUsage: { prompt: 100, completion: 20, total: 120 },
        toolCallCount: 1,
        errorCount: 0,
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
    });
  });

  describe('이벤트 시스템', () => {
    it('이벤트를 발행하고 구독할 수 있어야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const events: WorkspaceEvent[] = [];
      manager.on('workspace.repoAvailable', event => {
        events.push(event);
      });

      manager.emit('workspace.repoAvailable', {
        type: 'workspace.repoAvailable',
        path: bundleRoot,
        workspaceId: manager.getWorkspaceId(),
      });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('workspace.repoAvailable');
    });

    it('여러 리스너를 등록할 수 있어야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      let count = 0;
      manager.on('workspace.worktreeMounted', () => {
        count++;
      });
      manager.on('workspace.worktreeMounted', () => {
        count++;
      });

      manager.emit('workspace.worktreeMounted', {
        type: 'workspace.worktreeMounted',
        path: '/some/path',
        workspaceId: manager.getWorkspaceId(),
        changesetId: 'cs-001',
      });

      expect(count).toBe(2);
    });

    it('off로 리스너를 제거할 수 있어야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      let count = 0;
      const listener = () => {
        count++;
      };

      manager.on('workspace.repoAvailable', listener);
      manager.emit('workspace.repoAvailable', {
        type: 'workspace.repoAvailable',
        path: bundleRoot,
        workspaceId: manager.getWorkspaceId(),
      });
      expect(count).toBe(1);

      manager.off('workspace.repoAvailable', listener);
      manager.emit('workspace.repoAvailable', {
        type: 'workspace.repoAvailable',
        path: bundleRoot,
        workspaceId: manager.getWorkspaceId(),
      });
      expect(count).toBe(1); // 여전히 1
    });
  });

  describe('instance metadata 관리', () => {
    it('metadata 상태를 pause/running/terminated로 갱신해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);

      await manager.markInstancePaused('default-cli');
      let metadata = await manager.readInstanceMetadata('default-cli');
      expect(metadata?.status).toBe('paused');

      await manager.markInstanceRunning('default-cli');
      metadata = await manager.readInstanceMetadata('default-cli');
      expect(metadata?.status).toBe('running');

      await manager.markInstanceTerminated('default-cli');
      metadata = await manager.readInstanceMetadata('default-cli');
      expect(metadata?.status).toBe('terminated');
    });

    it('deleteInstanceState는 인스턴스 상태 디렉터리를 삭제해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);
      const instancePath = manager.getPaths().instancePath('default-cli');

      await manager.deleteInstanceState('default-cli');

      const exists = await fs
        .stat(instancePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('lifecycle hooks로 pause/resume/terminate/delete metadata 갱신이 연결되어야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);
      await manager.initializeInstanceState('default-cli-delete', ['planner']);

      const swarmManager = createSwarmInstanceManager({
        lifecycleHooks: manager.createSwarmInstanceLifecycleHooks(),
      });

      await swarmManager.getOrCreate('Swarm/default', 'cli', 'bundle-ref');
      await swarmManager.pause('cli');
      let metadata = await manager.readInstanceMetadata('default-cli');
      expect(metadata?.status).toBe('paused');

      await swarmManager.resume('cli');
      metadata = await manager.readInstanceMetadata('default-cli');
      expect(metadata?.status).toBe('running');

      await swarmManager.terminate('cli');
      metadata = await manager.readInstanceMetadata('default-cli');
      expect(metadata?.status).toBe('terminated');

      await swarmManager.getOrCreate('Swarm/default', 'cli-delete', 'bundle-ref');
      await swarmManager.delete('cli-delete');

      const deletedPath = manager.getPaths().instancePath('default-cli-delete');
      const deletedExists = await fs
        .stat(deletedPath)
        .then(() => true)
        .catch(() => false);
      expect(deletedExists).toBe(false);
    });
  });

  describe('extension state 영속화/복원', () => {
    it('createPersistentStateStore는 파일 상태를 복원해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);
      await manager.writeExtensionSharedState('default-cli', { sharedKey: 'sharedValue' });
      await manager.writeExtensionState('default-cli', 'extA', { count: 3 });

      const store = await manager.createPersistentStateStore('default-cli');

      expect(store.getSharedState()).toEqual({ sharedKey: 'sharedValue' });
      expect(store.getExtensionState('extA')).toEqual({ count: 3 });
    });

    it('persistent store의 상태 변경을 flush 후 파일로 저장해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);
      const store = await manager.createPersistentStateStore('default-cli');

      store.setExtensionState('extA', { count: 10 });
      store.getSharedState()['mode'] = 'active';
      await manager.flushPersistentStateStore('default-cli');

      const extState = await manager.readExtensionState('default-cli', 'extA');
      const sharedState = await manager.readExtensionSharedState('default-cli');

      expect(extState).toEqual({ count: 10 });
      expect(sharedState).toEqual({ mode: 'active' });
    });

    it('rehydratePersistentStateStore는 파일 상태로 메모리 상태를 복원해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);
      const store = await manager.createPersistentStateStore('default-cli');
      store.setExtensionState('extA', { count: 1 });
      await manager.flushPersistentStateStore('default-cli');

      await manager.writeExtensionState('default-cli', 'extA', { count: 7 });
      await manager.rehydratePersistentStateStore('default-cli');

      expect(store.getExtensionState('extA')).toEqual({ count: 7 });
    });

    it('pause/resume lifecycle hooks가 flush/rehydrate를 호출해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);
      const store = await manager.createPersistentStateStore('default-cli');
      store.setExtensionState('extA', { count: 2 });

      const swarmManager = createSwarmInstanceManager({
        lifecycleHooks: manager.createSwarmInstanceLifecycleHooks(),
      });

      await swarmManager.getOrCreate('Swarm/default', 'cli', 'bundle-ref');
      await swarmManager.pause('cli');

      const pausedState = await manager.readExtensionState('default-cli', 'extA');
      expect(pausedState).toEqual({ count: 2 });

      await manager.writeExtensionState('default-cli', 'extA', { count: 11 });
      await swarmManager.resume('cli');

      expect(store.getExtensionState('extA')).toEqual({ count: 11 });
    });
  });

  describe('messageState 복구', () => {
    it('recoverTurnMessageState는 마지막 base와 잔존 events를 복구해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);
      const logger = manager.createTurnMessageStateLogger('default-cli', 'planner');

      await logger.base.log({
        traceId: 'trace-base',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-base',
        messages: [{ id: 'msg-base', role: 'user', content: 'base' }],
      });

      await logger.events.log({
        traceId: 'trace-old',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-old',
        seq: 0,
        eventType: 'llm_message',
        payload: {
          message: { id: 'msg-old', role: 'assistant', content: 'old' },
        },
      });

      await logger.events.log({
        traceId: 'trace-pending',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-pending',
        seq: 1,
        eventType: 'llm_message',
        payload: {
          message: { id: 'msg-pending', role: 'assistant', content: 'pending' },
        },
      });

      await logger.events.log({
        traceId: 'trace-pending',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-pending',
        seq: 2,
        eventType: 'replace',
        payload: {
          targetId: 'msg-base',
          message: { id: 'msg-base', role: 'user', content: 'base-updated' },
        },
      });

      const recovered = await manager.recoverTurnMessageState('default-cli', 'planner');

      expect(recovered).toBeDefined();
      expect(recovered?.baseMessages).toEqual([{ id: 'msg-base', role: 'user', content: 'base' }]);
      expect(recovered?.events).toHaveLength(2);
      expect(recovered?.events[0]).toMatchObject({
        type: 'llm_message',
        seq: 1,
      });
      expect(recovered?.events[1]).toMatchObject({
        type: 'replace',
        seq: 2,
      });

      await recovered?.clearRecoveredEvents?.();
      const remainingEvents = await manager.createMessageEventLogger('default-cli', 'planner').readAll();
      expect(remainingEvents).toEqual([]);
    });

    it('복구할 로그가 없으면 undefined를 반환해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      await manager.initializeInstanceState('default-cli', ['planner']);
      const recovered = await manager.recoverTurnMessageState('default-cli', 'planner');

      expect(recovered).toBeUndefined();
    });
  });

  describe('getPaths', () => {
    it('WorkspacePaths 인스턴스를 반환해야 한다', () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const paths = manager.getPaths();
      expect(paths).toBeDefined();
      expect(paths.goondanHome).toBe(stateRoot);
      expect(paths.swarmBundleRoot).toBe(bundleRoot);
    });
  });
});
