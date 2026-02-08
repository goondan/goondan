/**
 * WorkspaceManager
 * @see /docs/specs/workspace.md - 섹션 12: 디렉터리 초기화
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { JsonObject, JsonValue } from '../types/json.js';
import { createStateStore } from '../extension/state-store.js';
import type { StateStore } from '../extension/types.js';
import type {
  SwarmInstance,
  SwarmInstanceLifecycleHooks,
} from '../runtime/swarm-instance.js';
import type {
  TurnMessageStateLogger,
  TurnMessageStateRecoverySnapshot,
} from '../runtime/turn-runner.js';
import type {
  LlmMessage as RuntimeLlmMessage,
  MessageEvent as RuntimeMessageEvent,
} from '../runtime/types.js';
import { WorkspacePaths } from './paths.js';
import { SecretsStore } from './secrets.js';
import {
  MessageBaseLogger,
  MessageEventLogger,
  SwarmEventLogger,
  AgentEventLogger,
  TurnMetricsLogger,
} from './logs.js';
import type {
  InstanceMetadata,
  MessageBaseLogRecord,
  MessageEventLogRecord,
} from './types.js';
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
 * NodeJS.ErrnoException 타입 가드
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * JsonObject 타입 가드
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JsonValue 타입 가드
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  if (isJsonObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item));
  }
  return false;
}

/**
 * SwarmRef에서 swarm 이름 추출
 */
function resolveSwarmNameFromRef(swarmRef: string | { kind: string; name: string }): string {
  if (typeof swarmRef !== 'string') {
    return swarmRef.name;
  }

  const [kind, name] = swarmRef.split('/');
  if (kind && name) {
    return name;
  }

  return swarmRef;
}

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
  private readonly persistentStateStores = new Map<string, StateStore>();

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
      path.join(goondanHome, 'metrics'),
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

    // Metrics 디렉터리
    await fs.mkdir(
      path.dirname(this.paths.instanceMetricsLogPath(instanceId)),
      { recursive: true }
    );

    // Extensions 디렉터리
    await fs.mkdir(
      path.dirname(this.paths.extensionSharedStatePath(instanceId)),
      { recursive: true }
    );
    await this.writeJsonObjectIfMissing(
      this.paths.extensionSharedStatePath(instanceId),
      {}
    );

    // metadata.json 초기화
    const metadataPath = this.paths.instanceMetadataPath(instanceId);
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    const metadata: InstanceMetadata = {
      status: 'running',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    // Workspace 디렉터리 (Tool CWD 바인딩용)
    await fs.mkdir(
      this.paths.instanceWorkspacePath(instanceId),
      { recursive: true }
    );

    // Agent별 디렉터리
    for (const agentName of agents) {
      await fs.mkdir(
        path.dirname(this.paths.agentMessageBaseLogPath(instanceId, agentName)),
        { recursive: true }
      );
      await fs.mkdir(
        path.dirname(this.paths.agentEventsLogPath(instanceId, agentName)),
        { recursive: true }
      );
    }
  }

  /**
   * 인스턴스별 workspace 디렉터리 경로 반환
   */
  instanceWorkspacePath(instanceId: string): string {
    return this.paths.instanceWorkspacePath(instanceId);
  }

  /**
   * 인스턴스 metadata 조회
   */
  async readInstanceMetadata(instanceId: string): Promise<InstanceMetadata | undefined> {
    const metadataPath = this.paths.instanceMetadataPath(instanceId);
    const parsed = await this.readJsonObjectFile(metadataPath);
    if (!parsed) {
      return undefined;
    }

    const statusValue = parsed['status'];
    const updatedAtValue = parsed['updatedAt'];
    const createdAtValue = parsed['createdAt'];
    const expiresAtValue = parsed['expiresAt'];

    if (
      (statusValue !== 'running' && statusValue !== 'paused' && statusValue !== 'terminated') ||
      typeof updatedAtValue !== 'string' ||
      typeof createdAtValue !== 'string'
    ) {
      return undefined;
    }

    const metadata: InstanceMetadata = {
      status: statusValue,
      updatedAt: updatedAtValue,
      createdAt: createdAtValue,
    };

    if (typeof expiresAtValue === 'string') {
      metadata.expiresAt = expiresAtValue;
    }

    return metadata;
  }

  /**
   * 인스턴스 metadata 상태 갱신
   */
  async updateInstanceMetadata(
    instanceId: string,
    status: InstanceMetadata['status']
  ): Promise<InstanceMetadata> {
    const now = new Date().toISOString();
    const current = await this.readInstanceMetadata(instanceId);

    const next: InstanceMetadata = {
      status,
      updatedAt: now,
      createdAt: current?.createdAt ?? now,
    };

    if (current?.expiresAt) {
      next.expiresAt = current.expiresAt;
    }

    const metadataRecord: JsonObject = {
      status: next.status,
      updatedAt: next.updatedAt,
      createdAt: next.createdAt,
    };

    if (next.expiresAt !== undefined) {
      metadataRecord['expiresAt'] = next.expiresAt;
    }

    await this.writeJsonObjectFile(this.paths.instanceMetadataPath(instanceId), metadataRecord);
    return next;
  }

  /**
   * 인스턴스 metadata 상태를 paused로 설정
   */
  async markInstancePaused(instanceId: string): Promise<InstanceMetadata> {
    return this.updateInstanceMetadata(instanceId, 'paused');
  }

  /**
   * 인스턴스 metadata 상태를 running으로 설정
   */
  async markInstanceRunning(instanceId: string): Promise<InstanceMetadata> {
    return this.updateInstanceMetadata(instanceId, 'running');
  }

  /**
   * 인스턴스 metadata 상태를 terminated로 설정
   */
  async markInstanceTerminated(instanceId: string): Promise<InstanceMetadata> {
    return this.updateInstanceMetadata(instanceId, 'terminated');
  }

  /**
   * SwarmInstanceManager와 연결할 lifecycle hooks 생성
   */
  createSwarmInstanceLifecycleHooks(): SwarmInstanceLifecycleHooks {
    const pausedInstances = new Set<string>();

    return {
      onStatusChange: async (instance, status) => {
        const instanceId = this.resolveInstanceIdFromSwarmInstance(instance);

        if (status === 'paused') {
          await this.flushPersistentStateStore(instanceId);
          pausedInstances.add(instanceId);
          await this.markInstancePaused(instanceId);
          return;
        }

        if (status === 'running') {
          if (pausedInstances.has(instanceId)) {
            await this.rehydratePersistentStateStore(instanceId);
            pausedInstances.delete(instanceId);
          }
          await this.markInstanceRunning(instanceId);
          return;
        }

        await this.flushPersistentStateStore(instanceId);
        pausedInstances.delete(instanceId);
        await this.markInstanceTerminated(instanceId);
      },
      onDelete: async (_instanceKey, instance) => {
        if (!instance) {
          return;
        }

        const instanceId = this.resolveInstanceIdFromSwarmInstance(instance);
        pausedInstances.delete(instanceId);
        if (!(await this.instanceStateExists(instanceId))) {
          return;
        }

        await this.markInstanceTerminated(instanceId);
        await this.deleteInstanceState(instanceId);
      },
    };
  }

  /**
   * 인스턴스 상태 디렉터리 삭제 (metadata 포함)
   */
  async deleteInstanceState(instanceId: string): Promise<void> {
    this.persistentStateStores.delete(instanceId);
    await fs.rm(this.paths.instancePath(instanceId), {
      recursive: true,
      force: true,
    });
  }

  /**
   * Extension shared state 복원
   */
  async readExtensionSharedState(instanceId: string): Promise<JsonObject> {
    const sharedPath = this.paths.extensionSharedStatePath(instanceId);
    return (await this.readJsonObjectFile(sharedPath)) ?? {};
  }

  /**
   * Extension shared state 영속화
   */
  async writeExtensionSharedState(instanceId: string, state: JsonObject): Promise<void> {
    const sharedPath = this.paths.extensionSharedStatePath(instanceId);
    await this.writeJsonObjectFile(sharedPath, state);
  }

  /**
   * Extension 개별 state 복원
   */
  async readExtensionState(instanceId: string, extensionName: string): Promise<JsonObject> {
    const statePath = this.paths.extensionStatePath(instanceId, extensionName);
    return (await this.readJsonObjectFile(statePath)) ?? {};
  }

  /**
   * Extension 개별 state 영속화
   */
  async writeExtensionState(
    instanceId: string,
    extensionName: string,
    state: JsonObject
  ): Promise<void> {
    const statePath = this.paths.extensionStatePath(instanceId, extensionName);
    await this.writeJsonObjectFile(statePath, state);
  }

  /**
   * 파일 기반 Extension StateStore 생성
   *
   * - instanceId에 저장된 extension/shared 상태를 복원
   * - setState/shared 변경을 파일로 자동 영속화
   */
  async createPersistentStateStore(instanceId: string): Promise<StateStore> {
    const existing = this.persistentStateStores.get(instanceId);
    if (existing) {
      return existing;
    }

    const extensionNames = await this.listPersistedExtensionNames(instanceId);
    const initialExtensionStates: Record<string, JsonObject> = {};

    for (const extensionName of extensionNames) {
      initialExtensionStates[extensionName] = await this.readExtensionState(
        instanceId,
        extensionName
      );
    }

    const initialSharedState = await this.readExtensionSharedState(instanceId);

    const store = createStateStore({
      initialExtensionStates,
      initialSharedState,
      persistence: {
        onExtensionStateChange: async (extensionName, state) => {
          await this.writeExtensionState(instanceId, extensionName, state);
        },
        onSharedStateChange: async (state) => {
          await this.writeExtensionSharedState(instanceId, state);
        },
      },
    });

    this.persistentStateStores.set(instanceId, store);
    return store;
  }

  /**
   * 등록된 persistent state store flush
   */
  async flushPersistentStateStore(instanceId: string): Promise<void> {
    const store = this.persistentStateStores.get(instanceId);
    if (!store) {
      return;
    }
    await store.flush();
  }

  /**
   * 등록된 persistent state store를 파일 상태로 재동기화
   */
  async rehydratePersistentStateStore(instanceId: string): Promise<void> {
    const store = this.persistentStateStores.get(instanceId);
    if (!store) {
      return;
    }

    const extensionNames = await this.listPersistedExtensionNames(instanceId);
    const extensionStates: Record<string, JsonObject> = {};
    for (const extensionName of extensionNames) {
      extensionStates[extensionName] = await this.readExtensionState(instanceId, extensionName);
    }

    const sharedState = await this.readExtensionSharedState(instanceId);
    store.rehydrate({
      extensionStates,
      sharedState,
    });
  }

  /**
   * SecretsStore 인스턴스 반환
   */
  getSecretsStore(): SecretsStore {
    return new SecretsStore(this.paths.secretsDir);
  }

  /**
   * MessageBaseLogger 생성
   */
  createMessageBaseLogger(instanceId: string, agentName: string): MessageBaseLogger {
    const logPath = this.paths.agentMessageBaseLogPath(instanceId, agentName);
    return new MessageBaseLogger(logPath);
  }

  /**
   * MessageEventLogger 생성
   */
  createMessageEventLogger(instanceId: string, agentName: string): MessageEventLogger {
    const logPath = this.paths.agentMessageEventsLogPath(instanceId, agentName);
    return new MessageEventLogger(logPath);
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

  /**
   * TurnMetricsLogger 생성
   */
  createTurnMetricsLogger(instanceId: string): TurnMetricsLogger {
    const logPath = this.paths.instanceMetricsLogPath(instanceId);
    return new TurnMetricsLogger(logPath);
  }

  /**
   * Turn 종료 시 messageState(base/events) 반영용 로거 세트 생성
   */
  createTurnMessageStateLogger(instanceId: string, agentName: string): TurnMessageStateLogger {
    const baseLogger = this.createMessageBaseLogger(instanceId, agentName);
    const eventLogger = this.createMessageEventLogger(instanceId, agentName);

    return {
      base: {
        appendDelta: async (input) => {
          await baseLogger.appendDelta({
            traceId: input.traceId,
            instanceId: input.instanceId,
            instanceKey: input.instanceKey,
            agentName: input.agentName,
            turnId: input.turnId,
            startSeq: input.startSeq,
            messages: input.messages,
          });
        },
        rewrite: async (input) => {
          await baseLogger.rewrite({
            traceId: input.traceId,
            instanceId: input.instanceId,
            instanceKey: input.instanceKey,
            agentName: input.agentName,
            turnId: input.turnId,
            messages: input.messages,
          });
        },
      },
      events: {
        log: async (input) => {
          await eventLogger.log({
            traceId: input.traceId,
            instanceId: input.instanceId,
            instanceKey: input.instanceKey,
            agentName: input.agentName,
            turnId: input.turnId,
            seq: input.seq,
            eventType: input.eventType,
            payload: input.payload,
            stepId: input.stepId,
          });
        },
        clear: async () => {
          await eventLogger.clear();
        },
      },
    };
  }

  /**
   * Turn 시작 시 사용할 messageState 복구 스냅샷 로드
   *
   * - base.jsonl 마지막 레코드를 기준 메시지로 사용
   * - events.jsonl이 남아 있으면 마지막 turnId 그룹만 복구 대상으로 사용
   */
  async recoverTurnMessageState(
    instanceId: string,
    agentName: string
  ): Promise<TurnMessageStateRecoverySnapshot | undefined> {
    const baseLogger = this.createMessageBaseLogger(instanceId, agentName);
    const eventLogger = this.createMessageEventLogger(instanceId, agentName);

    const [baseRecords, eventRecords] = await Promise.all([
      baseLogger.readAll(),
      eventLogger.readAll(),
    ]);

    const baseMessages = this.extractLatestBaseMessages(baseRecords);
    const events = this.extractPendingMessageEvents(eventRecords);

    if (baseMessages.length === 0 && events.length === 0) {
      return undefined;
    }

    return {
      baseMessages,
      events,
      clearRecoveredEvents: async () => {
        if (events.length === 0) {
          return;
        }
        await eventLogger.clear();
      },
    };
  }

  private extractLatestBaseMessages(records: MessageBaseLogRecord[]): RuntimeLlmMessage[] {
    if (records.length === 0) {
      return [];
    }

    return records
      .sort((a, b) => a.seq - b.seq)
      .map((r) => this.parseRuntimeLlmMessage(r.message))
      .filter((msg): msg is RuntimeLlmMessage => msg !== undefined);
  }

  private extractPendingMessageEvents(records: MessageEventLogRecord[]): RuntimeMessageEvent[] {
    const latestRecord = records.at(-1);
    if (!latestRecord) {
      return [];
    }

    const latestTurnId = latestRecord.turnId;
    const eventsForLastTurn = records
      .filter((record) => record.turnId === latestTurnId)
      .sort((a, b) => a.seq - b.seq);

    const events: RuntimeMessageEvent[] = [];
    for (const record of eventsForLastTurn) {
      const event = this.toRuntimeMessageEvent(record);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  private toRuntimeMessageEvent(record: MessageEventLogRecord): RuntimeMessageEvent | undefined {
    if (record.eventType === 'truncate') {
      return {
        type: 'truncate',
        seq: record.seq,
      };
    }

    if (record.eventType === 'remove') {
      const targetId = record.payload['targetId'];
      if (typeof targetId !== 'string') {
        return undefined;
      }

      return {
        type: 'remove',
        seq: record.seq,
        targetId,
      };
    }

    if (record.eventType === 'replace') {
      const targetId = record.payload['targetId'];
      const message = this.parseRuntimeLlmMessage(record.payload['message']);
      if (typeof targetId !== 'string' || !message) {
        return undefined;
      }

      return {
        type: 'replace',
        seq: record.seq,
        targetId,
        message,
      };
    }

    if (record.eventType === 'system_message') {
      const message = this.parseRuntimeLlmMessage(record.payload['message']);
      if (!message || message.role !== 'system') {
        return undefined;
      }

      return {
        type: 'system_message',
        seq: record.seq,
        message,
      };
    }

    if (record.eventType === 'llm_message') {
      const message = this.parseRuntimeLlmMessage(record.payload['message']);
      if (!message || message.role === 'system') {
        return undefined;
      }

      return {
        type: 'llm_message',
        seq: record.seq,
        message,
      };
    }

    return undefined;
  }

  private parseRuntimeLlmMessage(value: unknown): RuntimeLlmMessage | undefined {
    if (!isJsonObject(value)) {
      return undefined;
    }

    const id = value['id'];
    const role = value['role'];
    if (typeof id !== 'string' || typeof role !== 'string') {
      return undefined;
    }

    if (role === 'system') {
      const content = value['content'];
      if (typeof content !== 'string') {
        return undefined;
      }

      return {
        id,
        role: 'system',
        content,
      };
    }

    if (role === 'user') {
      const content = value['content'];
      if (typeof content !== 'string') {
        return undefined;
      }

      const attachments = this.parseRuntimeUserAttachments(value['attachments']);
      return {
        id,
        role: 'user',
        content,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      };
    }

    if (role === 'assistant') {
      const content = value['content'];
      const toolCalls = this.parseRuntimeToolCalls(value['toolCalls']);

      return {
        id,
        role: 'assistant',
        ...(typeof content === 'string' ? { content } : {}),
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      };
    }

    if (role === 'tool') {
      const toolCallId = value['toolCallId'];
      const toolName = value['toolName'];
      const output = value['output'];

      if (typeof toolCallId !== 'string' || typeof toolName !== 'string') {
        return undefined;
      }

      return {
        id,
        role: 'tool',
        toolCallId,
        toolName,
        output: isJsonValue(output) ? output : null,
      };
    }

    return undefined;
  }

  private parseRuntimeUserAttachments(
    value: unknown
  ): Array<{ type: 'image' | 'file'; url?: string; base64?: string; mimeType?: string }> | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const attachments: Array<{ type: 'image' | 'file'; url?: string; base64?: string; mimeType?: string }> = [];

    for (const item of value) {
      if (!isJsonObject(item)) {
        continue;
      }

      const type = item['type'];
      if (type !== 'image' && type !== 'file') {
        continue;
      }

      const attachment: { type: 'image' | 'file'; url?: string; base64?: string; mimeType?: string } = {
        type,
      };

      if (typeof item['url'] === 'string') {
        attachment.url = item['url'];
      }
      if (typeof item['base64'] === 'string') {
        attachment.base64 = item['base64'];
      }
      if (typeof item['mimeType'] === 'string') {
        attachment.mimeType = item['mimeType'];
      }

      attachments.push(attachment);
    }

    return attachments;
  }

  private parseRuntimeToolCalls(
    value: unknown
  ): Array<{ id: string; name: string; args: JsonObject }> | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const toolCalls: Array<{ id: string; name: string; args: JsonObject }> = [];
    for (const item of value) {
      if (!isJsonObject(item)) {
        continue;
      }

      const id = item['id'];
      const name = item['name'];
      if (typeof id !== 'string' || typeof name !== 'string') {
        continue;
      }

      const argsValue = item['args'];
      const argumentsValue = item['arguments'];
      const args = isJsonObject(argsValue)
        ? argsValue
        : isJsonObject(argumentsValue)
          ? argumentsValue
          : {};

      toolCalls.push({
        id,
        name,
        args: { ...args },
      });
    }

    return toolCalls;
  }

  private resolveInstanceIdFromSwarmInstance(instance: SwarmInstance): string {
    const swarmName = resolveSwarmNameFromRef(instance.swarmRef);
    return this.getInstanceId(swarmName, instance.instanceKey);
  }

  private async instanceStateExists(instanceId: string): Promise<boolean> {
    try {
      await fs.access(this.paths.instancePath(instanceId));
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private async listPersistedExtensionNames(instanceId: string): Promise<string[]> {
    const extensionsRoot = path.join(this.paths.instancePath(instanceId), 'extensions');

    try {
      const entries = await fs.readdir(extensionsRoot, { withFileTypes: true });
      const names: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        if (entry.name.startsWith('_')) {
          continue;
        }

        names.push(entry.name);
      }

      return names;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async readJsonObjectFile(filePath: string): Promise<JsonObject | undefined> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(content);

      if (!isJsonObject(parsed)) {
        return undefined;
      }

      return parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  private async writeJsonObjectFile(filePath: string, value: JsonObject): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  private async writeJsonObjectIfMissing(filePath: string, value: JsonObject): Promise<void> {
    const existing = await this.readJsonObjectFile(filePath);
    if (existing) {
      return;
    }
    await this.writeJsonObjectFile(filePath, value);
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
