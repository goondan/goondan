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

  getConnectorAdapter(connectorName: string): ConnectorAdapter | null {
    return this.connectors.get(connectorName) || null;
  }

  async emitProgress(origin: JsonObject, text: string, auth?: JsonObject): Promise<void> {
    const connectorName = origin.connector as string | undefined;
    if (!connectorName) return;
    const connectorConfig = this.registry?.get('Connector', connectorName);
    const adapter = this.connectors.get(connectorName);
    if (!connectorConfig || !adapter?.send) return;

    const updatePolicy = (connectorConfig.spec as { egress?: { updatePolicy?: { mode?: string; debounceMs?: number } } })?.egress?.updatePolicy;
    const debounceMs = updatePolicy?.debounceMs ?? 1500;
    const channel = origin.channel as string | undefined;
    const threadTs = origin.threadTs as string | undefined;
    if (updatePolicy?.mode !== 'updateInThread' || !channel) {
      await adapter.send({ text, origin, auth, kind: 'progress' });
      return;
    }
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
      await adapter.send?.({ text: payload.text, origin: payload.origin, auth, kind: 'progress' });
    }, debounceMs);
    this.progressTimers.set(key, timer);
  }

  async emitFinal(origin: JsonObject, text: string, auth?: JsonObject): Promise<void> {
    const connectorName = origin.connector as string | undefined;
    if (!connectorName) return;
    const connectorConfig = this.registry?.get('Connector', connectorName);
    const adapter = this.connectors.get(connectorName);
    if (!connectorConfig || !adapter?.send) return;
    await adapter.send({ text, origin, auth, kind: 'final' });
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

    // 1단계: 모든 connector를 순회하며 entry가 있는 것들로 어댑터 팩토리 등록
    // type 기준으로 먼저 entry가 있는 connector를 찾아서 등록
    const typeToEntry = new Map<string, string>();
    for (const connector of connectors) {
      const spec = connector.spec as { type?: string; entry?: string; runtime?: string; ingress?: Array<unknown>; egress?: unknown } | undefined;
      const type = spec?.type;
      if (!type || !spec?.entry) continue;
      // 같은 type에 대해 첫 번째로 발견된 entry를 사용 (번들 → config 순서이므로 번들 우선)
      if (!typeToEntry.has(type)) {
        typeToEntry.set(type, spec.entry);
      }
    }

    // entry를 가진 type에 대해 어댑터 팩토리 등록
    for (const [type, entryPath] of typeToEntry) {
      if (this.connectorRegistry.hasAdapter(type)) continue;

      try {
        const mod = await import(entryPath);
        // 여러 export 이름 시도: createXxxConnectorAdapter, createConnectorAdapter, default
        const factory =
          mod[`create${type.charAt(0).toUpperCase() + type.slice(1)}ConnectorAdapter`] ||
          mod.createConnectorAdapter ||
          mod.default;
        if (typeof factory === 'function') {
          this.connectorRegistry.registerAdapter(type, factory);
        } else {
          this.logger.warn(`Connector type(${type}) entry에서 팩토리 함수를 찾을 수 없습니다: ${entryPath}`);
        }
      } catch (err) {
        this.logger.warn(`Connector type(${type}) entry 로드 실패:`, (err as Error).message);
      }
    }

    // 2단계: 모든 connector에 대해 어댑터 인스턴스 생성
    for (const connector of connectors) {
      const spec = connector.spec as { type?: string; entry?: string; runtime?: string; ingress?: Array<unknown>; egress?: unknown } | undefined;
      const type = spec?.type;
      if (!type) continue;

      const adapter = this.connectorRegistry.createConnector(type, { runtime: this, connectorConfig: connector, logger: this.logger });
      if (!adapter) {
        const ingress = Array.isArray(spec?.ingress) ? spec?.ingress : [];
        const hasIngress = ingress.length > 0;
        const hasEgress = Boolean(spec?.egress);
        if (hasIngress || hasEgress) {
          this.logger.warn(`Connector ${connector.metadata.name} 타입(${type}) 어댑터가 없습니다.`);
        }
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
