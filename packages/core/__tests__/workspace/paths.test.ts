/**
 * WorkspacePaths 클래스 테스트
 * @see /docs/specs/workspace.md - 섹션 10: 파일 경로 유틸리티 함수
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { WorkspacePaths } from '../../src/workspace/paths.js';

describe('WorkspacePaths', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.GOONDAN_STATE_ROOT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('swarmBundleRoot를 절대 경로로 저장해야 한다', () => {
      const paths = new WorkspacePaths({
        swarmBundleRoot: '/Users/alice/projects/my-agent',
      });
      expect(path.isAbsolute(paths.swarmBundleRoot)).toBe(true);
    });

    it('기본 goondanHome을 설정해야 한다', () => {
      const paths = new WorkspacePaths({
        swarmBundleRoot: '/Users/alice/projects/my-agent',
      });
      expect(paths.goondanHome).toBe(path.join(os.homedir(), '.goondan'));
    });

    it('stateRoot 옵션으로 goondanHome을 오버라이드할 수 있다', () => {
      const paths = new WorkspacePaths({
        stateRoot: '/custom/state',
        swarmBundleRoot: '/Users/alice/projects/my-agent',
      });
      expect(paths.goondanHome).toBe(path.resolve('/custom/state'));
    });

    it('workspaceId를 자동으로 생성해야 한다', () => {
      const paths = new WorkspacePaths({
        swarmBundleRoot: '/Users/alice/projects/my-agent',
      });
      expect(paths.workspaceId).toHaveLength(12);
      expect(/^[a-f0-9]+$/.test(paths.workspaceId)).toBe(true);
    });
  });

  describe('System State Paths', () => {
    let paths: WorkspacePaths;

    beforeEach(() => {
      paths = new WorkspacePaths({
        stateRoot: '/home/test/.goondan',
        swarmBundleRoot: '/home/test/project',
      });
    });

    it('bundlesRegistry 경로를 반환해야 한다', () => {
      expect(paths.bundlesRegistry).toBe('/home/test/.goondan/bundles.json');
    });

    it('bundlesCache 경로를 반환해야 한다', () => {
      expect(paths.bundlesCache).toBe('/home/test/.goondan/bundles');
    });

    it('bundleCachePath로 특정 번들 경로를 생성해야 한다', () => {
      const bundlePath = paths.bundleCachePath('@goondan', 'base', '1.0.0');
      expect(bundlePath).toBe('/home/test/.goondan/bundles/@goondan/base/1.0.0');
    });

    it('oauthRoot 경로를 반환해야 한다', () => {
      expect(paths.oauthRoot).toBe('/home/test/.goondan/oauth');
    });

    it('oauthGrantsDir 경로를 반환해야 한다', () => {
      expect(paths.oauthGrantsDir).toBe('/home/test/.goondan/oauth/grants');
    });

    it('oauthSessionsDir 경로를 반환해야 한다', () => {
      expect(paths.oauthSessionsDir).toBe('/home/test/.goondan/oauth/sessions');
    });

    it('oauthGrantPath로 특정 grant 파일 경로를 생성해야 한다', () => {
      const grantPath = paths.oauthGrantPath('abc123');
      expect(grantPath).toBe('/home/test/.goondan/oauth/grants/abc123.json');
    });

    it('oauthSessionPath로 특정 session 파일 경로를 생성해야 한다', () => {
      const sessionPath = paths.oauthSessionPath('session-001');
      expect(sessionPath).toBe('/home/test/.goondan/oauth/sessions/session-001.json');
    });

    it('secretsDir 경로를 반환해야 한다', () => {
      expect(paths.secretsDir).toBe('/home/test/.goondan/secrets');
    });

    it('secretPath로 특정 secret 파일 경로를 생성해야 한다', () => {
      const secretPath = paths.secretPath('api-key');
      expect(secretPath).toBe('/home/test/.goondan/secrets/api-key.json');
    });
  });

  describe('Worktree Paths', () => {
    let paths: WorkspacePaths;

    beforeEach(() => {
      paths = new WorkspacePaths({
        stateRoot: '/home/test/.goondan',
        swarmBundleRoot: '/home/test/project',
      });
    });

    it('worktreesRoot 경로를 반환해야 한다', () => {
      const expected = `/home/test/.goondan/worktrees/${paths.workspaceId}`;
      expect(paths.worktreesRoot).toBe(expected);
    });

    it('changesetWorktreePath로 특정 changeset 경로를 생성해야 한다', () => {
      const changesetPath = paths.changesetWorktreePath('cs-001');
      const expected = `/home/test/.goondan/worktrees/${paths.workspaceId}/changesets/cs-001`;
      expect(changesetPath).toBe(expected);
    });
  });

  describe('Instance State Paths', () => {
    let paths: WorkspacePaths;

    beforeEach(() => {
      paths = new WorkspacePaths({
        stateRoot: '/home/test/.goondan',
        swarmBundleRoot: '/home/test/project',
      });
    });

    it('instancesRoot 경로를 반환해야 한다', () => {
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}`;
      expect(paths.instancesRoot).toBe(expected);
    });

    it('instancePath로 특정 인스턴스 경로를 생성해야 한다', () => {
      const instancePath = paths.instancePath('default-cli');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli`;
      expect(instancePath).toBe(expected);
    });

    it('instanceMetadataPath로 메타데이터 경로를 생성해야 한다', () => {
      const metadataPath = paths.instanceMetadataPath('default-cli');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/metadata.json`;
      expect(metadataPath).toBe(expected);
    });

    it('swarmEventsLogPath로 swarm 이벤트 로그 경로를 생성해야 한다', () => {
      const logPath = paths.swarmEventsLogPath('default-cli');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/swarm/events/events.jsonl`;
      expect(logPath).toBe(expected);
    });

    it('instanceMetricsLogPath로 메트릭 로그 경로를 생성해야 한다', () => {
      const logPath = paths.instanceMetricsLogPath('default-cli');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/metrics/turns.jsonl`;
      expect(logPath).toBe(expected);
    });

    it('extensionSharedStatePath로 공유 상태 경로를 생성해야 한다', () => {
      const statePath = paths.extensionSharedStatePath('default-cli');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/extensions/_shared.json`;
      expect(statePath).toBe(expected);
    });

    it('extensionStatePath로 Extension별 상태 경로를 생성해야 한다', () => {
      const statePath = paths.extensionStatePath('default-cli', 'basicCompaction');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/extensions/basicCompaction/state.json`;
      expect(statePath).toBe(expected);
    });

    it('agentPath로 특정 에이전트 경로를 생성해야 한다', () => {
      const agentPath = paths.agentPath('default-cli', 'planner');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/agents/planner`;
      expect(agentPath).toBe(expected);
    });

    it('agentMessageBaseLogPath로 메시지 base 로그 경로를 생성해야 한다', () => {
      const logPath = paths.agentMessageBaseLogPath('default-cli', 'planner');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/agents/planner/messages/base.jsonl`;
      expect(logPath).toBe(expected);
    });

    it('agentMessageEventsLogPath로 메시지 이벤트 로그 경로를 생성해야 한다', () => {
      const logPath = paths.agentMessageEventsLogPath('default-cli', 'planner');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/agents/planner/messages/events.jsonl`;
      expect(logPath).toBe(expected);
    });

    it('agentEventsLogPath로 에이전트 이벤트 로그 경로를 생성해야 한다', () => {
      const logPath = paths.agentEventsLogPath('default-cli', 'planner');
      const expected = `/home/test/.goondan/instances/${paths.workspaceId}/default-cli/agents/planner/events/events.jsonl`;
      expect(logPath).toBe(expected);
    });
  });

  describe('SwarmBundle Paths', () => {
    let paths: WorkspacePaths;

    beforeEach(() => {
      paths = new WorkspacePaths({
        stateRoot: '/home/test/.goondan',
        swarmBundleRoot: '/home/test/project',
      });
    });

    it('swarmBundlePath로 SwarmBundle 하위 경로를 생성해야 한다', () => {
      const subPath = paths.swarmBundlePath('resources', 'agents', 'planner.yaml');
      expect(subPath).toBe('/home/test/project/resources/agents/planner.yaml');
    });

    it('configFile 경로를 반환해야 한다', () => {
      expect(paths.configFile).toBe('/home/test/project/goondan.yaml');
    });

    it('promptsDir 경로를 반환해야 한다', () => {
      expect(paths.promptsDir).toBe('/home/test/project/prompts');
    });

    it('toolsDir 경로를 반환해야 한다', () => {
      expect(paths.toolsDir).toBe('/home/test/project/tools');
    });

    it('extensionsDir 경로를 반환해야 한다', () => {
      expect(paths.extensionsDir).toBe('/home/test/project/extensions');
    });

    it('connectorsDir 경로를 반환해야 한다', () => {
      expect(paths.connectorsDir).toBe('/home/test/project/connectors');
    });
  });

  describe('createInstanceStatePaths', () => {
    let paths: WorkspacePaths;

    beforeEach(() => {
      paths = new WorkspacePaths({
        stateRoot: '/home/test/.goondan',
        swarmBundleRoot: '/home/test/project',
      });
    });

    it('InstanceStatePaths 객체를 생성해야 한다', () => {
      const instancePaths = paths.createInstanceStatePaths('default-cli');

      expect(instancePaths.root).toBe(
        `/home/test/.goondan/instances/${paths.workspaceId}/default-cli`
      );
      expect(instancePaths.metadataFile).toContain('metadata.json');
      expect(instancePaths.swarmEventsLog).toContain('events.jsonl');
      expect(instancePaths.metricsLog).toContain('turns.jsonl');
      expect(instancePaths.extensionSharedState).toContain('_shared.json');
    });

    it('extensionState 함수로 Extension별 상태 경로를 생성해야 한다', () => {
      const instancePaths = paths.createInstanceStatePaths('default-cli');
      const extStatePath = instancePaths.extensionState('basicCompaction');

      expect(extStatePath).toContain('extensions/basicCompaction/state.json');
    });

    it('agent 함수로 AgentStatePaths를 생성해야 한다', () => {
      const instancePaths = paths.createInstanceStatePaths('default-cli');
      const agentPaths = instancePaths.agent('planner');

      expect(agentPaths.root).toContain('agents/planner');
      expect(agentPaths.messageBaseLog).toContain('base.jsonl');
      expect(agentPaths.messageEventsLog).toContain('messages/events.jsonl');
      expect(agentPaths.eventsLog).toContain('events/events.jsonl');
    });
  });

  describe('createSystemStatePaths', () => {
    let paths: WorkspacePaths;

    beforeEach(() => {
      paths = new WorkspacePaths({
        stateRoot: '/home/test/.goondan',
        swarmBundleRoot: '/home/test/project',
      });
    });

    it('SystemStatePaths 객체를 생성해야 한다', () => {
      const systemPaths = paths.createSystemStatePaths();

      expect(systemPaths.root).toBe('/home/test/.goondan');
      expect(systemPaths.bundlesRegistry).toBe('/home/test/.goondan/bundles.json');
      expect(systemPaths.bundlesCache).toBe('/home/test/.goondan/bundles');
      expect(systemPaths.worktrees).toBe('/home/test/.goondan/worktrees');
      expect(systemPaths.secrets).toBe('/home/test/.goondan/secrets');
      expect(systemPaths.metricsDir).toBe('/home/test/.goondan/metrics');
      expect(systemPaths.runtimeMetricsLog).toBe('/home/test/.goondan/metrics/runtime.jsonl');
      expect(systemPaths.instances).toBe('/home/test/.goondan/instances');
    });

    it('oauth 경로 객체를 포함해야 한다', () => {
      const systemPaths = paths.createSystemStatePaths();

      expect(systemPaths.oauth.root).toBe('/home/test/.goondan/oauth');
      expect(systemPaths.oauth.grants).toBe('/home/test/.goondan/oauth/grants');
      expect(systemPaths.oauth.sessions).toBe('/home/test/.goondan/oauth/sessions');
    });

    it('bundleCachePath 함수를 제공해야 한다', () => {
      const systemPaths = paths.createSystemStatePaths();
      const cachePath = systemPaths.bundleCachePath('@goondan', 'base', '1.0.0');
      expect(cachePath).toBe('/home/test/.goondan/bundles/@goondan/base/1.0.0');
    });

    it('changesetWorktreePath 함수를 제공해야 한다', () => {
      const systemPaths = paths.createSystemStatePaths();
      const worktreePath = systemPaths.changesetWorktreePath(paths.workspaceId, 'cs-001');
      expect(worktreePath).toBe(
        `/home/test/.goondan/worktrees/${paths.workspaceId}/changesets/cs-001`
      );
    });

    it('instanceStatePath 함수를 제공해야 한다', () => {
      const systemPaths = paths.createSystemStatePaths();
      const instancePath = systemPaths.instanceStatePath(paths.workspaceId, 'default-cli');
      expect(instancePath).toBe(
        `/home/test/.goondan/instances/${paths.workspaceId}/default-cli`
      );
    });

    it('oauth.grantPath 함수를 제공해야 한다', () => {
      const systemPaths = paths.createSystemStatePaths();
      const grantPath = systemPaths.oauth.grantPath('abc123');
      expect(grantPath).toBe('/home/test/.goondan/oauth/grants/abc123.json');
    });

    it('oauth.sessionPath 함수를 제공해야 한다', () => {
      const systemPaths = paths.createSystemStatePaths();
      const sessionPath = systemPaths.oauth.sessionPath('session-001');
      expect(sessionPath).toBe('/home/test/.goondan/oauth/sessions/session-001.json');
    });
  });
});
