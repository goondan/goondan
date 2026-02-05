/**
 * WorkspaceManager
 * @see /docs/specs/workspace.md - 섹션 12: 디렉터리 초기화
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspacePaths } from './paths.js';
import { SecretsStore } from './secrets.js';
import { LlmMessageLogger, SwarmEventLogger, AgentEventLogger } from './logs.js';
import { generateInstanceId } from './config.js';
import type {
  WorkspaceManagerOptions,
  WorkspaceEvent,
  WorkspaceEventName,
  WorkspaceEventListener,
  WorkspaceRepoAvailableEvent,
  WorkspaceWorktreeMountedEvent,
} from './types.js';

/**
 * 이벤트 리스너 맵 타입
 */
type EventListenerMap = {
  'workspace.repoAvailable': Set<WorkspaceEventListener<WorkspaceRepoAvailableEvent>>;
  'workspace.worktreeMounted': Set<WorkspaceEventListener<WorkspaceWorktreeMountedEvent>>;
};

/**
 * WorkspaceManager - 워크스페이스 관리자
 */
export class WorkspaceManager {
  private readonly paths: WorkspacePaths;
  private readonly workspaceRoot: string;
  private readonly eventListeners: EventListenerMap;

  private constructor(options: WorkspaceManagerOptions) {
    this.paths = new WorkspacePaths({
      stateRoot: options.stateRoot,
      swarmBundleRoot: options.swarmBundleRoot,
    });
    this.workspaceRoot = options.workspaceRoot ?? options.swarmBundleRoot;
    this.eventListeners = {
      'workspace.repoAvailable': new Set(),
      'workspace.worktreeMounted': new Set(),
    };
  }

  /**
   * WorkspaceManager 생성
   */
  static create(options: WorkspaceManagerOptions): WorkspaceManager {
    return new WorkspaceManager(options);
  }

  /**
   * WorkspacePaths 인스턴스 반환
   */
  getPaths(): WorkspacePaths {
    return this.paths;
  }

  /**
   * 상태 루트 디렉터리 반환
   */
  getStateDir(): string {
    return this.paths.goondanHome;
  }

  /**
   * 번들 루트 디렉터리 반환
   */
  getBundleDir(): string {
    return this.paths.swarmBundleRoot;
  }

  /**
   * 워크스페이스 루트 디렉터리 반환
   */
  getWorkspaceDir(): string {
    return this.workspaceRoot;
  }

  /**
   * Secrets 디렉터리 반환
   */
  getSecretsDir(): string {
    return this.paths.secretsDir;
  }

  /**
   * Logs 디렉터리 (instances) 반환
   */
  getLogsDir(): string {
    return path.join(this.paths.goondanHome, 'instances');
  }

  /**
   * 상태 경로 해석
   */
  resolveStatePath(relativePath: string): string {
    return path.join(this.paths.goondanHome, relativePath);
  }

  /**
   * 번들 경로 해석
   */
  resolveBundlePath(relativePath: string): string {
    return path.join(this.paths.swarmBundleRoot, relativePath);
  }

  /**
   * 워크스페이스 경로 해석
   */
  resolveWorkspacePath(relativePath: string): string {
    return path.join(this.workspaceRoot, relativePath);
  }

  /**
   * workspaceId 반환
   */
  getWorkspaceId(): string {
    return this.paths.workspaceId;
  }

  /**
   * instanceId 생성
   */
  getInstanceId(swarmName: string, instanceKey: string): string {
    return generateInstanceId(swarmName, instanceKey);
  }

  /**
   * 시스템 상태 초기화
   */
  async initializeSystemState(): Promise<void> {
    const goondanHome = this.paths.goondanHome;

    const dirs = [
      path.join(goondanHome, 'bundles'),
      path.join(goondanHome, 'worktrees'),
      path.join(goondanHome, 'oauth', 'grants'),
      path.join(goondanHome, 'oauth', 'sessions'),
      path.join(goondanHome, 'secrets'),
      path.join(goondanHome, 'instances'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // bundles.json 초기화 (없으면)
    const bundlesRegistry = path.join(goondanHome, 'bundles.json');
    try {
      await fs.access(bundlesRegistry);
    } catch {
      await fs.writeFile(bundlesRegistry, JSON.stringify({ packages: {} }, null, 2));
    }
  }

  /**
   * 인스턴스 상태 초기화
   */
  async initializeInstanceState(instanceId: string, agents: string[]): Promise<void> {
    // Swarm events 디렉터리
    await fs.mkdir(
      path.dirname(this.paths.swarmEventsLogPath(instanceId)),
      { recursive: true }
    );

    // Agent별 디렉터리
    for (const agentName of agents) {
      await fs.mkdir(
        path.dirname(this.paths.agentMessagesLogPath(instanceId, agentName)),
        { recursive: true }
      );
      await fs.mkdir(
        path.dirname(this.paths.agentEventsLogPath(instanceId, agentName)),
        { recursive: true }
      );
    }
  }

  /**
   * SecretsStore 인스턴스 반환
   */
  getSecretsStore(): SecretsStore {
    return new SecretsStore(this.paths.secretsDir);
  }

  /**
   * LlmMessageLogger 생성
   */
  createLlmMessageLogger(instanceId: string, agentName: string): LlmMessageLogger {
    const logPath = this.paths.agentMessagesLogPath(instanceId, agentName);
    return new LlmMessageLogger(logPath);
  }

  /**
   * SwarmEventLogger 생성
   */
  createSwarmEventLogger(instanceId: string): SwarmEventLogger {
    const logPath = this.paths.swarmEventsLogPath(instanceId);
    return new SwarmEventLogger(logPath);
  }

  /**
   * AgentEventLogger 생성
   */
  createAgentEventLogger(instanceId: string, agentName: string): AgentEventLogger {
    const logPath = this.paths.agentEventsLogPath(instanceId, agentName);
    return new AgentEventLogger(logPath);
  }

  // =========================================================================
  // 이벤트 시스템
  // =========================================================================

  /**
   * 이벤트 리스너 등록
   */
  on<E extends WorkspaceEventName>(
    eventName: E,
    listener: WorkspaceEventListener<Extract<WorkspaceEvent, { type: E }>>
  ): void {
    const listeners = this.eventListeners[eventName];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listeners.add(listener as any);
  }

  /**
   * 이벤트 리스너 제거
   */
  off<E extends WorkspaceEventName>(
    eventName: E,
    listener: WorkspaceEventListener<Extract<WorkspaceEvent, { type: E }>>
  ): void {
    const listeners = this.eventListeners[eventName];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listeners.delete(listener as any);
  }

  /**
   * 이벤트 발행
   */
  emit<E extends WorkspaceEvent>(eventName: E['type'], event: E): void {
    const listeners = this.eventListeners[eventName];
    for (const listener of listeners) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (listener as any)(event);
    }
  }
}
