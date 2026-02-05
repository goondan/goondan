/**
 * WorkspaceManager 테스트
 * @see /docs/specs/workspace.md - 섹션 12: 디렉터리 초기화
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceManager } from '../../src/workspace/manager.js';
import type { WorkspaceEvent } from '../../src/workspace/types.js';

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

      // Agent 디렉터리
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

  describe('createLlmMessageLogger', () => {
    it('LlmMessageLogger 인스턴스를 반환해야 한다', async () => {
      manager = WorkspaceManager.create({
        stateRoot,
        swarmBundleRoot: bundleRoot,
      });

      const logger = manager.createLlmMessageLogger('default-cli', 'planner');
      expect(logger).toBeDefined();

      // 로거가 올바른 경로에 기록하는지 확인
      await logger.log({
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-001',
        message: { role: 'user', content: 'test' },
      });

      const records = await logger.readAll();
      expect(records.length).toBe(1);
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
        kind: 'turn.started',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
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
