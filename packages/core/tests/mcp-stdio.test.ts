import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpManager } from '../src/mcp/manager.js';
import { createStdioAdapter } from '../src/mcp/adapters/stdio.js';

const fixturePath = fileURLToPath(new URL('./fixtures/mcp-stdio-server.cjs', import.meta.url));

const serverResource = {
  apiVersion: 'agents.example.io/v1alpha1',
  kind: 'MCPServer',
  metadata: { name: 'mock-stdio' },
  spec: {
    transport: {
      type: 'stdio',
      command: ['node', path.resolve(fixturePath)],
    },
    attach: { mode: 'stateful', scope: 'instance' },
    expose: { tools: true },
  },
};

describe('MCP stdio adapter', () => {
  const manager = new McpManager(console);
  manager.registerAdapter('stdio', createStdioAdapter);

  afterAll(async () => {
    await manager.shutdown();
  });

  it('lists tools and calls tool', async () => {
    manager.setRegistry([serverResource]);
    await manager.syncForAgent('instance-1', 'planner', [serverResource]);
    const tools = manager.getToolsForAgent('instance-1', 'planner', {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'planner' },
      spec: { mcpServers: [{ kind: 'MCPServer', name: 'mock-stdio' }] },
    });

    expect(tools.some((tool) => tool.name === 'mock-stdio.echo')).toBe(true);

    const result = await manager.executeTool('mock-stdio.echo', { hello: 'world' }, {});
    expect(result).toEqual({ echo: { hello: 'world' } });
  });
});
