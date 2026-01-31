import { AgentInstance } from './agent-instance.js';
import { LiveConfigManager } from '../live-config/manager.js';
import { resolveRef } from '../config/ref.js';
import type { ConfigRegistry, Resource } from '../config/registry.js';
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
  origin?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

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
  }

  async init(): Promise<void> {
    const agentRefs = (this.swarmConfig?.spec as { agents?: Array<Record<string, unknown>> })?.agents || [];
    for (const ref of agentRefs) {
      const agentResource = resolveRef(this.registry, ref, 'Agent');
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
      logger: this.logger,
    });
    await agentInstance.init();
    this.agents.set(agentName, agentInstance);
  }

  getAgent(name: string): AgentInstance | null {
    return this.agents.get(name) || null;
  }

  enqueueEvent(event: SwarmEvent): void {
    const entrypoint = (this.swarmConfig?.spec as { entrypoint?: Record<string, unknown> })?.entrypoint;
    const entryAgent = entrypoint ? resolveRef(this.registry, entrypoint, 'Agent') : null;
    const agentName = event.agentName || entryAgent?.metadata?.name;
    if (!agentName) {
      throw new Error('Swarm entrypoint 또는 agentName이 필요합니다.');
    }
    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`AgentInstance를 찾을 수 없습니다: ${agentName}`);
    }
    agent.enqueueEvent(event);
  }
}
