import { EventEmitter } from 'node:events';
import path from 'node:path';
import { loadConfigFiles } from '../config/loader.js';
import { resolveRef } from '../config/ref.js';
import { ToolRegistry } from '../tools/registry.js';
import { ConnectorRegistry, type ConnectorAdapter } from '../connectors/registry.js';
import { McpManager } from '../mcp/manager.js';
import { createStdioAdapter } from '../mcp/adapters/stdio.js';
import { createHttpAdapter } from '../mcp/adapters/http.js';
import { SwarmInstance } from './swarm-instance.js';
import { OAuthManager } from './oauth.js';
import { createAiSdkAdapter } from './llm/ai-sdk.js';
import type { ConfigRegistry, Resource } from '../config/registry.js';
import type {
  AuthResumePayload,
  Block,
  DynamicToolDefinition,
  EffectiveConfig,
  JsonObject,
  LlmResult,
  ObjectRefLike,
  Step,
  ToolCatalogItem,
  Turn,
} from '../sdk/types.js';
import { validateConfig } from '../config/validator.js';

export interface LlmCallInput {
  model: Resource | null;
  params: JsonObject;
  blocks: Block[];
  tools: ToolCatalogItem[];
  turn: Turn;
  step: Step | null;
  effectiveConfig: EffectiveConfig | null;
}

export interface LlmCallResult {
  content?: string;
  toolCalls?: Array<{ id?: string; name: string; input?: JsonObject }>;
  meta?: LlmResult['meta'];
}

export type LlmAdapter = (input: LlmCallInput) => Promise<LlmCallResult>;

interface RuntimeOptions {
  configPaths?: string[];
  registry?: ConfigRegistry | null;
  stateDir?: string;
  stateRootDir?: string;
  llm?: LlmAdapter | null;
  logger?: Console;
  oauth?: OAuthManager;
  validateOnInit?: boolean;
}

export class Runtime {
  configPaths: string[];
  registry: ConfigRegistry | null;
  stateDir: string;
  stateRootDir: string;
  llm: LlmAdapter | null;
  logger: Console;
  events: EventEmitter;
  oauth: OAuthManager;
  toolRegistry: ToolRegistry | null;
  swarmInstances: Map<string, SwarmInstance>;
  validateOnInit: boolean;
  connectorRegistry: ConnectorRegistry;
  connectors: Map<string, ConnectorAdapter>;
  mcpManager: McpManager;
  progressTimers: Map<string, NodeJS.Timeout>;
  progressPayloads: Map<string, { connectorName: string; origin: JsonObject; text: string; debounceMs: number }>;

  constructor(options: RuntimeOptions = {}) {
    this.configPaths = options.configPaths || [];
    this.registry = options.registry || null;
    this.stateRootDir = options.stateRootDir || path.join(process.cwd(), 'state');
    this.stateDir = options.stateDir || path.join(this.stateRootDir, 'instances');
    this.llm = options.llm || createAiSdkAdapter();
    this.logger = options.logger || console;
    this.events = new EventEmitter();
    this.oauth = options.oauth || new OAuthManager({ stateDir: this.stateRootDir, registry: this.registry, events: this.events });
    this.toolRegistry = null;
    this.swarmInstances = new Map();
    this.validateOnInit = options.validateOnInit ?? true;
    this.connectorRegistry = new ConnectorRegistry();
    this.connectors = new Map();
    this.mcpManager = new McpManager(this.logger);
    this.progressTimers = new Map();
    this.progressPayloads = new Map();

    this.events.on('auth.granted', (payload) => {
      const resume = (payload as { resume?: AuthResumePayload }).resume;
      if (!resume) return;
      const swarmRef = resume.swarmRef;
      const instanceKey = resume.instanceKey;
      if (!swarmRef || !instanceKey) return;
      void this.handleEvent({
        swarmRef,
        instanceKey,
        agentName: resume.agentName,
        input: '',
        origin: resume.origin,
        auth: resume.auth,
        metadata: { type: 'auth.granted', resume },
      });
    });

    this.registerMcpAdapter('stdio', createStdioAdapter);
    this.registerMcpAdapter('http', createHttpAdapter);
  }

  async init(): Promise<void> {
    if (!this.registry) {
      if (!this.configPaths || this.configPaths.length === 0) {
        throw new Error('configPaths 또는 registry가 필요합니다.');
      }
      this.registry = await loadConfigFiles(this.configPaths, { baseDir: process.cwd() });
    }
    this.oauth.setRegistry(this.registry);
    if (this.validateOnInit) {
      const validation = validateConfig(this.registry.list(), { registry: this.registry });
      if (!validation.valid) {
        const message = validation.errors.map((err) => `${err.resource}: ${err.path ?? ''} ${err.message}`).join('\n');
        throw new Error(`Config 검증 실패:\n${message}`);
      }
    }

    this.toolRegistry = new ToolRegistry({
      registry: this.registry,
      baseDir: this.registry.baseDir,
      logger: this.logger,
    });

    await this.toolRegistry.loadAllTools();
    await this.loadConnectors();
    await this.loadMcpServers();
  }

  async getOrCreateSwarmInstance(swarmRef: ObjectRefLike, instanceKey: string): Promise<SwarmInstance> {
    if (!this.registry) throw new Error('registry가 필요합니다.');
    const swarmResource = resolveRef(this.registry, swarmRef, 'Swarm');
    if (!swarmResource) {
      throw new Error('Swarm 리소스를 찾을 수 없습니다.');
    }
    const instanceId = makeInstanceId(swarmResource.metadata.name, instanceKey);
    if (this.swarmInstances.has(instanceId)) {
      return this.swarmInstances.get(instanceId) as SwarmInstance;
    }
    const swarmInstance = new SwarmInstance({
      instanceId,
      instanceKey,
      swarmConfig: swarmResource,
      registry: this.registry,
      toolRegistry: this.toolRegistry as ToolRegistry,
      runtime: this,
      logger: this.logger,
      stateDir: this.stateDir,
    });
    await swarmInstance.init();
    this.swarmInstances.set(instanceId, swarmInstance);
    return swarmInstance;
  }

  async handleEvent({
    swarmRef,
    instanceKey,
    agentName,
    input,
    origin,
    auth,
    metadata,
  }: {
    swarmRef: ObjectRefLike;
    instanceKey: string;
    agentName?: string;
    input: string;
    origin?: JsonObject;
    auth?: JsonObject;
    metadata?: JsonObject;
  }): Promise<void> {
    const swarmInstance = await this.getOrCreateSwarmInstance(swarmRef, instanceKey);
    swarmInstance.enqueueEvent({
      agentName,
      input,
      origin,
      auth,
      metadata,
    });
  }

  registerDynamicTool(toolDef: DynamicToolDefinition, owner?: string): void {
    if (!toolDef?.name || typeof toolDef.handler !== 'function') {
      throw new Error('동적 Tool 등록에는 name과 handler가 필요합니다.');
    }
    if (!this.toolRegistry) {
      throw new Error('ToolRegistry가 초기화되지 않았습니다.');
    }
    this.toolRegistry.exports.set(toolDef.name, {
      tool: toolDef.tool || null,
      definition: toolDef.definition || { name: toolDef.name },
      handler: toolDef.handler,
      owner,
    });
  }

  unregisterDynamicTools(owner: string): void {
    this.toolRegistry?.removeByOwner(owner);
  }

  registerConnectorAdapter(type: string, factory: Parameters<ConnectorRegistry['registerAdapter']>[1]): void {
    this.connectorRegistry.registerAdapter(type, factory);
  }

  registerMcpAdapter(type: string, factory: Parameters<McpManager['registerAdapter']>[1]): void {
    this.mcpManager.registerAdapter(type, factory);
  }

  async handleConnectorEvent(connectorName: string, payload: JsonObject): Promise<void> {
    const connector = this.connectors.get(connectorName);
    if (!connector) {
      throw new Error(`Connector를 찾을 수 없습니다: ${connectorName}`);
    }
    await connector.handleEvent(payload);
  }

  async emitProgress(origin: JsonObject, text: string, auth?: JsonObject): Promise<void> {
    const connectorName = origin.connector as string | undefined;
    if (!connectorName) return;
    const connectorConfig = this.registry?.get('Connector', connectorName);
    const adapter = this.connectors.get(connectorName);
    if (!connectorConfig || !adapter?.postMessage) return;

    const updatePolicy = (connectorConfig.spec as { egress?: { updatePolicy?: { mode?: string; debounceMs?: number } } })?.egress?.updatePolicy;
    if (updatePolicy?.mode !== 'updateInThread') return;

    const debounceMs = updatePolicy.debounceMs ?? 1500;
    const channel = origin.channel as string | undefined;
    if (!channel) return;
    const threadTs = origin.threadTs as string | undefined;
    const key = `${connectorName}:${channel}:${threadTs || ''}`;

    this.progressPayloads.set(key, { connectorName, origin, text, debounceMs });
    const existing = this.progressTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      const payload = this.progressPayloads.get(key);
      if (!payload) return;
      this.progressPayloads.delete(key);
      this.progressTimers.delete(key);
      await adapter.postMessage?.({ channel, threadTs, text: payload.text, origin: payload.origin, auth });
    }, debounceMs);
    this.progressTimers.set(key, timer);
  }

  async emitFinal(origin: JsonObject, text: string, auth?: JsonObject): Promise<void> {
    const connectorName = origin.connector as string | undefined;
    if (!connectorName) return;
    const connectorConfig = this.registry?.get('Connector', connectorName);
    const adapter = this.connectors.get(connectorName);
    if (!connectorConfig || !adapter?.postMessage) return;
    const channel = origin.channel as string | undefined;
    if (!channel) return;
    const threadTs = origin.threadTs as string | undefined;
    await adapter.postMessage({ channel, threadTs, text, origin, auth });
  }

  async emitWorkspaceEvent(point: 'workspace.repoAvailable' | 'workspace.worktreeMounted', payload: JsonObject): Promise<void> {
    this.events.emit(point, payload);
    for (const instance of this.swarmInstances.values()) {
      for (const agent of instance.agents.values()) {
        await agent.handleWorkspaceEvent(point, payload);
      }
    }
  }

  private async loadConnectors(): Promise<void> {
    if (!this.registry) return;
    const connectors = this.registry.list('Connector');
    for (const connector of connectors) {
      const type = (connector.spec as { type?: string } | undefined)?.type;
      if (!type) continue;
      const adapter = this.connectorRegistry.createConnector(type, { runtime: this, connectorConfig: connector, logger: this.logger });
      if (!adapter) {
        this.logger.warn(`Connector ${connector.metadata.name} 타입(${type}) 어댑터가 없습니다.`);
        continue;
      }
      this.connectors.set(connector.metadata.name, adapter);
    }
  }

  private async loadMcpServers(): Promise<void> {
    if (!this.registry) return;
    const servers = this.registry.list('MCPServer');
    this.mcpManager.setRegistry(servers);
  }
}

function makeInstanceId(swarmName: string, instanceKey: string): string {
  const safeKey = String(instanceKey || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${swarmName}-${safeKey}`;
}
