import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentInstance } from './agent-instance.js';
import { LiveConfigManager } from '../live-config/manager.js';
import { resolveRef } from '../config/ref.js';
import { appendJsonl, ensureDir } from '../utils/fs.js';
import type { ConfigRegistry, Resource } from '../config/registry.js';
import type { JsonObject, ObjectRefLike, SwarmSpec } from '../sdk/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Runtime } from './runtime.js';

interface SwarmInstanceOptions {
  instanceId: string;
  instanceKey: string;
  swarmConfig: Resource;
  registry: ConfigRegistry;
  toolRegistry: ToolRegistry;
  runtime: Runtime;
  logger?: Console;
  stateDir: string;
}

interface SwarmEvent {
  agentName?: string;
  input: string;
  origin?: JsonObject;
  auth?: JsonObject;
  metadata?: JsonObject;
}

type SwarmEventRecord = {
  type: 'swarm.event';
  recordedAt: string;
  kind: string;
  instanceId: string;
  instanceKey: string;
  swarmName: string;
  agentName?: string;
  data?: JsonObject;
};

export class SwarmInstance {
  instanceId: string;
  instanceKey: string;
  swarmConfig: Resource;
  registry: ConfigRegistry;
  toolRegistry: ToolRegistry;
  runtime: Runtime;
  logger: Console;
  stateDir: string;
  agents: Map<string, AgentInstance>;
  liveConfigManager: LiveConfigManager;
  eventLogReady: boolean;
  eventLogPath: string | null;

  constructor(options: SwarmInstanceOptions) {
    this.instanceId = options.instanceId;
    this.instanceKey = options.instanceKey;
    this.swarmConfig = options.swarmConfig;
    this.registry = options.registry;
    this.toolRegistry = options.toolRegistry;
    this.runtime = options.runtime;
    this.logger = options.logger || console;
    this.stateDir = options.stateDir;

    this.agents = new Map();
    this.liveConfigManager = new LiveConfigManager({
      instanceId: this.instanceId,
      swarmConfig: this.swarmConfig,
      registry: this.registry,
      stateDir: this.stateDir,
      logger: this.logger,
      events: this.runtime.events,
    });
    this.eventLogReady = false;
    this.eventLogPath = null;
  }

  async init(): Promise<void> {
    const agentRefs = (this.swarmConfig?.spec as SwarmSpec | undefined)?.agents || [];
    for (const ref of agentRefs) {
      const agentResource = resolveRef(this.registry, ref as ObjectRefLike, 'Agent');
      if (agentResource) {
        await this.addAgent(agentResource);
      }
    }
  }

  async addAgent(agentResource: Resource): Promise<void> {
    const agentName = agentResource.metadata.name;
    await this.liveConfigManager.initAgent(agentName, agentResource);
    const agentInstance = new AgentInstance({
      name: agentName,
      instanceId: this.instanceId,
      instanceKey: this.instanceKey,
      agentConfig: agentResource,
      swarmConfig: this.swarmConfig,
      registry: this.registry,
      toolRegistry: this.toolRegistry,
      liveConfigManager: this.liveConfigManager,
      runtime: this.runtime,
      swarmInstance: this,
      logger: this.logger,
    });
    await agentInstance.init();
    this.agents.set(agentName, agentInstance);
  }

  getAgent(name: string): AgentInstance | null {
    return this.agents.get(name) || null;
  }

  /**
   * 다른 에이전트의 이벤트 큐에 작업을 enqueue합니다.
   * 비동기로 작동하며 결과를 기다리지 않습니다.
   *
   * @returns 큐잉 성공 여부 (에이전트 존재 여부만 검사)
   */
  enqueueToAgent(
    targetAgentName: string,
    event: {
      input: string;
      origin?: JsonObject;
      auth?: JsonObject;
      metadata?: JsonObject;
    }
  ): { queued: boolean; error?: string } {
    const targetAgent = this.getAgent(targetAgentName);
    if (!targetAgent) {
      return { queued: false, error: `에이전트를 찾을 수 없습니다: ${targetAgentName}` };
    }

    // 대상 에이전트의 이벤트 큐에 작업 추가
    targetAgent.enqueueEvent(event);

    void this.appendSwarmEvent({
      kind: 'agent.enqueue',
      agentName: targetAgentName,
      data: {
        inputBytes: Buffer.byteLength(String(event.input || ''), 'utf8'),
        originConnector: typeof event.origin?.connector === 'string' ? event.origin.connector : undefined,
      },
    });

    return { queued: true };
  }

  enqueueEvent(event: SwarmEvent): void {
    const entrypoint = (this.swarmConfig?.spec as SwarmSpec | undefined)?.entrypoint;
    const entryAgent = entrypoint ? resolveRef(this.registry, entrypoint as ObjectRefLike, 'Agent') : null;
    const agentName = event.agentName || entryAgent?.metadata?.name;
    if (!agentName) {
      throw new Error('Swarm entrypoint 또는 agentName이 필요합니다.');
    }

    void this.appendSwarmEvent({
      kind: 'swarm.enqueue',
      agentName,
      data: {
        inputBytes: Buffer.byteLength(String(event.input || ''), 'utf8'),
        originConnector: typeof event.origin?.connector === 'string' ? event.origin.connector : undefined,
        metadataType: typeof event.metadata?.type === 'string' ? event.metadata.type : undefined,
      },
    });

    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`AgentInstance를 찾을 수 없습니다: ${agentName}`);
    }
    agent.enqueueEvent(event);
  }

  private async appendSwarmEvent(input: { kind: string; agentName?: string; data?: JsonObject }): Promise<void> {
    const record: SwarmEventRecord = {
      type: 'swarm.event',
      recordedAt: new Date().toISOString(),
      kind: input.kind,
      instanceId: this.instanceId,
      instanceKey: this.instanceKey,
      swarmName: this.swarmConfig?.metadata?.name || 'swarm',
      agentName: input.agentName,
      data: input.data,
    };
    try {
      await this.appendSwarmEventRecord(record);
    } catch (err) {
      this.logger.error?.('Swarm event log write failed.', err);
    }
  }

  private async appendSwarmEventRecord(record: SwarmEventRecord): Promise<void> {
    const logPath = await this.ensureEventLogPath();
    await appendJsonl(logPath, record);
    await fs.chmod(logPath, 0o600);
  }

  private async ensureEventLogPath(): Promise<string> {
    if (this.eventLogReady && this.eventLogPath) {
      return this.eventLogPath;
    }
    const instanceStateDir = this.liveConfigManager.resolveInstanceStateDir();
    const logPath = path.join(instanceStateDir, 'swarm', 'events', 'events.jsonl');
    await ensureDir(path.dirname(logPath));
    await fs.chmod(path.dirname(logPath), 0o700);
    this.eventLogReady = true;
    this.eventLogPath = logPath;
    return logPath;
  }
}
