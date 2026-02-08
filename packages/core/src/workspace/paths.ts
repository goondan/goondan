/**
 * WorkspacePaths 클래스
 * @see /docs/specs/workspace.md - 섹션 10: 파일 경로 유틸리티 함수
 */
import * as path from 'path';
import {
  resolveGoondanHome,
  generateWorkspaceId,
  DEFAULT_LAYOUT,
} from './config.js';
import type {
  WorkspacePathsOptions,
  InstanceStatePaths,
  AgentStatePaths,
  SystemStatePaths,
  OAuthStorePaths,
} from './types.js';

/**
 * WorkspacePaths - 파일 경로 유틸리티 클래스
 */
export class WorkspacePaths {
  readonly goondanHome: string;
  readonly swarmBundleRoot: string;
  readonly workspaceId: string;

  constructor(options: WorkspacePathsOptions) {
    this.goondanHome = resolveGoondanHome({ cliStateRoot: options.stateRoot });
    this.swarmBundleRoot = path.resolve(options.swarmBundleRoot);
    this.workspaceId = generateWorkspaceId(this.swarmBundleRoot);
  }

  // =========================================================================
  // System State Paths
  // =========================================================================

  get bundlesRegistry(): string {
    return path.join(this.goondanHome, 'bundles.json');
  }

  get bundlesCache(): string {
    return path.join(this.goondanHome, 'bundles');
  }

  bundleCachePath(scope: string, name: string, version: string): string {
    return path.join(this.bundlesCache, scope, name, version);
  }

  get oauthRoot(): string {
    return path.join(this.goondanHome, 'oauth');
  }

  get oauthGrantsDir(): string {
    return path.join(this.oauthRoot, 'grants');
  }

  get oauthSessionsDir(): string {
    return path.join(this.oauthRoot, 'sessions');
  }

  oauthGrantPath(subjectHash: string): string {
    return path.join(this.oauthGrantsDir, `${subjectHash}.json`);
  }

  oauthSessionPath(authSessionId: string): string {
    return path.join(this.oauthSessionsDir, `${authSessionId}.json`);
  }

  get secretsDir(): string {
    return path.join(this.goondanHome, 'secrets');
  }

  secretPath(secretName: string): string {
    return path.join(this.secretsDir, `${secretName}.json`);
  }

  // =========================================================================
  // Worktree Paths
  // =========================================================================

  get worktreesRoot(): string {
    return path.join(this.goondanHome, 'worktrees', this.workspaceId);
  }

  changesetWorktreePath(changesetId: string): string {
    return path.join(this.worktreesRoot, 'changesets', changesetId);
  }

  // =========================================================================
  // Instance State Paths
  // =========================================================================

  get instancesRoot(): string {
    return path.join(this.goondanHome, 'instances', this.workspaceId);
  }

  instancePath(instanceId: string): string {
    return path.join(this.instancesRoot, instanceId);
  }

  instanceMetadataPath(instanceId: string): string {
    return path.join(this.instancePath(instanceId), 'metadata.json');
  }

  swarmEventsLogPath(instanceId: string): string {
    return path.join(this.instancePath(instanceId), 'swarm', 'events', 'events.jsonl');
  }

  instanceMetricsLogPath(instanceId: string): string {
    return path.join(this.instancePath(instanceId), 'metrics', 'turns.jsonl');
  }

  extensionSharedStatePath(instanceId: string): string {
    return path.join(this.instancePath(instanceId), 'extensions', '_shared.json');
  }

  extensionStatePath(instanceId: string, extensionName: string): string {
    return path.join(this.instancePath(instanceId), 'extensions', extensionName, 'state.json');
  }

  agentPath(instanceId: string, agentName: string): string {
    return path.join(this.instancePath(instanceId), 'agents', agentName);
  }

  agentMessageBaseLogPath(instanceId: string, agentName: string): string {
    return path.join(this.agentPath(instanceId, agentName), 'messages', 'base.jsonl');
  }

  agentMessageEventsLogPath(instanceId: string, agentName: string): string {
    return path.join(this.agentPath(instanceId, agentName), 'messages', 'events.jsonl');
  }

  agentEventsLogPath(instanceId: string, agentName: string): string {
    return path.join(this.agentPath(instanceId, agentName), 'events', 'events.jsonl');
  }

  // =========================================================================
  // SwarmBundle Paths
  // =========================================================================

  swarmBundlePath(...segments: string[]): string {
    return path.join(this.swarmBundleRoot, ...segments);
  }

  get configFile(): string {
    return this.swarmBundlePath(DEFAULT_LAYOUT.configFile);
  }

  get promptsDir(): string {
    return this.swarmBundlePath(DEFAULT_LAYOUT.promptsDir ?? 'prompts');
  }

  get toolsDir(): string {
    return this.swarmBundlePath(DEFAULT_LAYOUT.toolsDir ?? 'tools');
  }

  get extensionsDir(): string {
    return this.swarmBundlePath(DEFAULT_LAYOUT.extensionsDir ?? 'extensions');
  }

  get connectorsDir(): string {
    return this.swarmBundlePath(DEFAULT_LAYOUT.connectorsDir ?? 'connectors');
  }

  // =========================================================================
  // Path Object Creators
  // =========================================================================

  /**
   * 특정 인스턴스의 경로 객체 생성
   */
  createInstanceStatePaths(instanceId: string): InstanceStatePaths {
    const root = this.instancePath(instanceId);
    const metadataFile = this.instanceMetadataPath(instanceId);
    const swarmEventsLog = this.swarmEventsLogPath(instanceId);
    const metricsLog = this.instanceMetricsLogPath(instanceId);
    const extensionSharedState = this.extensionSharedStatePath(instanceId);
    const self = this;

    return {
      root,
      metadataFile,
      swarmEventsLog,
      metricsLog,
      extensionSharedState,
      extensionState(extensionName: string): string {
        return self.extensionStatePath(instanceId, extensionName);
      },
      agent(agentName: string): AgentStatePaths {
        return {
          root: self.agentPath(instanceId, agentName),
          messageBaseLog: self.agentMessageBaseLogPath(instanceId, agentName),
          messageEventsLog: self.agentMessageEventsLogPath(instanceId, agentName),
          eventsLog: self.agentEventsLogPath(instanceId, agentName),
        };
      },
    };
  }

  /**
   * 시스템 상태 경로 객체 생성
   */
  createSystemStatePaths(): SystemStatePaths {
    const goondanHome = this.goondanHome;

    const oauthPaths: OAuthStorePaths = {
      root: path.join(goondanHome, 'oauth'),
      grants: path.join(goondanHome, 'oauth', 'grants'),
      sessions: path.join(goondanHome, 'oauth', 'sessions'),
      grantPath(subjectHash: string): string {
        return path.join(goondanHome, 'oauth', 'grants', `${subjectHash}.json`);
      },
      sessionPath(authSessionId: string): string {
        return path.join(goondanHome, 'oauth', 'sessions', `${authSessionId}.json`);
      },
    };

    return {
      root: goondanHome,
      bundlesRegistry: path.join(goondanHome, 'bundles.json'),
      bundlesCache: path.join(goondanHome, 'bundles'),
      worktrees: path.join(goondanHome, 'worktrees'),
      oauth: oauthPaths,
      secrets: path.join(goondanHome, 'secrets'),
      metricsDir: path.join(goondanHome, 'metrics'),
      runtimeMetricsLog: path.join(goondanHome, 'metrics', 'runtime.jsonl'),
      instances: path.join(goondanHome, 'instances'),
      bundleCachePath(scope: string, name: string, version: string): string {
        return path.join(goondanHome, 'bundles', scope, name, version);
      },
      changesetWorktreePath(workspaceId: string, changesetId: string): string {
        return path.join(goondanHome, 'worktrees', workspaceId, 'changesets', changesetId);
      },
      instanceStatePath(workspaceId: string, instanceId: string): string {
        return path.join(goondanHome, 'instances', workspaceId, instanceId);
      },
    };
  }
}
