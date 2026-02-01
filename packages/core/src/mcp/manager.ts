import { normalizeObjectRef } from '../config/ref.js';
import type { Resource } from '../config/registry.js';
import type {
  AgentSpec,
  JsonObject,
  MCPServerSpec,
  ObjectRefLike,
  ToolCatalogItem,
  UnknownObject,
} from '../sdk/types.js';

export interface McpToolDefinition {
  name: string;
  description?: string;
  parameters?: JsonObject;
  serverName: string;
}

export interface McpAdapter {
  listTools?: () => Promise<McpToolDefinition[]>;
  callTool?: (name: string, input: JsonObject, ctx: UnknownObject) => Promise<unknown>;
  close?: () => void;
}

export type McpAdapterFactory = (options: { server: Resource; logger?: Console }) => McpAdapter;

export class McpManager {
  private adapters: Map<string, McpAdapterFactory> = new Map();
  private servers: Map<string, { resource: Resource; adapter: McpAdapter; hash: string; stateful: boolean; scope: 'instance' | 'agent' }> = new Map();
  private toolIndex: Map<string, Map<string, McpToolDefinition>> = new Map();
  private instanceRefCounts: Map<string, number> = new Map();
  private agentScopedKeys: Map<string, Set<string>> = new Map();
  private registry: Map<string, Resource> = new Map();
  private logger: Console;

  constructor(logger: Console) {
    this.logger = logger;
  }

  registerAdapter(type: string, factory: McpAdapterFactory): void {
    this.adapters.set(type, factory);
  }

  setRegistry(servers: Resource[]): void {
    this.registry = new Map(servers.map((server) => [server.metadata.name, server]));
  }

  async syncForAgent(instanceId: string, agentName: string, serverResources: Resource[]): Promise<void> {
    const desiredAgentKeys = new Set<string>();
    const desiredInstanceNames = new Set<string>();

    for (const server of serverResources) {
      const { type, stateful, hash, scope } = parseServerConfig(server);
      if (!type) continue;
      if (scope === 'agent') {
        const key = makeServerKey(scope, instanceId, agentName, server.metadata.name);
        desiredAgentKeys.add(key);
        await this.ensureServer(key, server, type, stateful, hash, scope);
      } else {
        desiredInstanceNames.add(server.metadata.name);
        await this.ensureServer(makeServerKey(scope, instanceId, agentName, server.metadata.name), server, type, stateful, hash, scope);
      }
    }

    const agentKey = `${instanceId}:${agentName}`;
    const prevAgentKeys = this.agentScopedKeys.get(agentKey) || new Set<string>();
    for (const key of prevAgentKeys) {
      if (!desiredAgentKeys.has(key)) {
        this.removeServer(key);
      }
    }
    this.agentScopedKeys.set(agentKey, desiredAgentKeys);

    const prevInstanceNames = this.getInstanceNamesForAgent(agentKey);
    for (const name of prevInstanceNames) {
      if (!desiredInstanceNames.has(name)) {
        this.decrementInstanceRef(instanceId, name);
      }
    }
    for (const name of desiredInstanceNames) {
      if (!prevInstanceNames.has(name)) {
        this.incrementInstanceRef(instanceId, name);
      }
    }

    this.agentScopedKeys.set(`${agentKey}:instance`, desiredInstanceNames);
  }

  async shutdown(): Promise<void> {
    for (const entry of this.servers.values()) {
      entry.adapter.close?.();
    }
    this.servers.clear();
    this.toolIndex.clear();
  }

  getToolsForAgent(instanceId: string, agentName: string, agentConfig: Resource): ToolCatalogItem[] {
    const mcpRefs = (agentConfig.spec as AgentSpec | undefined)?.mcpServers || [];
    const result: ToolCatalogItem[] = [];

    for (const ref of mcpRefs) {
      if (typeof ref === 'object' && ref && 'selector' in ref) continue;
      const serverName = normalizeObjectRef(ref as ObjectRefLike, 'MCPServer')?.name;
      if (!serverName) continue;
      const server = this.registry.get(serverName);
      if (!server) continue;
      const { scope } = parseServerConfig(server);
      const key = makeServerKey(scope, instanceId, agentName, serverName);
      const adapterEntry = this.servers.get(key);
      if (!adapterEntry) continue;

      const expose = (server.spec as { expose?: { tools?: boolean } } | undefined)?.expose;
      if (expose && expose.tools === false) continue;

      const toolMap = this.toolIndex.get(key);
      if (!toolMap) continue;
      for (const [toolName, entry] of toolMap.entries()) {
        result.push({
          name: toolName,
          description: `mcp:${serverName}:${entry.name}`,
          parameters: entry.parameters || { type: 'object', additionalProperties: true },
          tool: null,
          export: null,
          source: { type: 'mcp', server: serverName, tool: entry.name },
        });
      }
    }

    return result;
  }

  async executeTool(name: string, input: JsonObject, ctx: UnknownObject): Promise<unknown> {
    const entry = findToolEntry(this.toolIndex, name);
    if (!entry) return null;
    const server = this.servers.get(entry.serverKey);
    if (!server?.adapter.callTool) {
      throw new Error(`MCP tool 실행을 지원하지 않습니다: ${name}`);
    }
    return server.adapter.callTool(entry.toolName, input, ctx);
  }

  hasTool(name: string): boolean {
    return Boolean(findToolEntry(this.toolIndex, name));
  }

  private async indexTools(serverKey: string, adapter: McpAdapter): Promise<void> {
    if (!adapter.listTools) return;
    const tools = await adapter.listTools();
    const map = new Map<string, McpToolDefinition>();
    for (const tool of tools) {
      const fullName = `${serverKey.split(':').slice(-1)[0]}.${tool.name}`;
      map.set(fullName, { ...tool });
    }
    this.toolIndex.set(serverKey, map);
  }

  private async ensureServer(
    key: string,
    server: Resource,
    type: string,
    stateful: boolean,
    hash: string,
    scope: 'instance' | 'agent'
  ): Promise<void> {
    const prev = this.servers.get(key);
    if (prev && prev.hash === hash && prev.stateful === stateful && stateful) {
      return;
    }
    if (prev) {
      prev.adapter.close?.();
    }
    const factory = this.adapters.get(type);
    if (!factory) {
      this.logger.warn(`MCPServer ${server.metadata.name} 타입(${type}) 어댑터가 없습니다.`);
      return;
    }
    const adapter = factory({ server, logger: this.logger });
    this.servers.set(key, { resource: server, adapter, hash, stateful, scope });
    await this.indexTools(key, adapter);
  }

  private removeServer(key: string): void {
    const entry = this.servers.get(key);
    if (!entry) return;
    entry.adapter.close?.();
    this.servers.delete(key);
    this.toolIndex.delete(key);
  }

  private incrementInstanceRef(instanceId: string, name: string): void {
    const key = `${instanceId}:${name}`;
    const count = this.instanceRefCounts.get(key) || 0;
    this.instanceRefCounts.set(key, count + 1);
  }

  private decrementInstanceRef(instanceId: string, name: string): void {
    const key = `${instanceId}:${name}`;
    const count = this.instanceRefCounts.get(key) || 0;
    if (count <= 1) {
      this.instanceRefCounts.delete(key);
      const serverKey = makeServerKey('instance', instanceId, 'shared', name);
      this.removeServer(serverKey);
    } else {
      this.instanceRefCounts.set(key, count - 1);
    }
  }

  private getInstanceNamesForAgent(agentKey: string): Set<string> {
    return this.agentScopedKeys.get(`${agentKey}:instance`) || new Set<string>();
  }
}

function parseServerConfig(server: Resource): { type?: string; stateful: boolean; hash: string; scope: 'instance' | 'agent' } {
  const spec = server.spec as MCPServerSpec | undefined;
  const transport = spec?.transport;
  const type = transport?.type;
  const attach = spec?.attach;
  const stateful = attach?.mode === 'stateful';
  const scope = attach?.scope === 'agent' ? 'agent' : 'instance';
  const expose = spec?.expose;
  const hash = JSON.stringify({ transport: transport || {}, attach: attach || {}, expose });
  return { type, stateful, hash, scope };
}

function makeServerKey(scope: 'instance' | 'agent', instanceId: string, agentName: string, serverName: string): string {
  if (scope === 'agent') {
    return `agent:${instanceId}:${agentName}:${serverName}`;
  }
  return `instance:${instanceId}:${serverName}`;
}

function findToolEntry(
  index: Map<string, Map<string, McpToolDefinition>>,
  name: string
): { serverKey: string; toolName: string } | null {
  for (const [serverKey, tools] of index.entries()) {
    if (tools.has(name)) {
      const entry = tools.get(name);
      return entry ? { serverKey, toolName: entry.name } : null;
    }
  }
  return null;
}
