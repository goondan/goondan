import type { McpAdapter, McpToolDefinition } from '../manager.js';
import type { Resource } from '../../config/registry.js';

export function createHttpAdapter(options: { server: Resource; logger?: Console }): McpAdapter {
  const logger = options.logger || console;
  const transport = (options.server.spec as { transport?: { url?: string } } | undefined)?.transport;
  const url = transport?.url || '';
  if (!url) {
    throw new Error(`MCP http url이 없습니다: ${options.server.metadata.name}`);
  }

  let counter = 1;

  async function request(method: string, params: Record<string, unknown> = {}) {
    const id = counter++;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (!response.ok || payload.error) {
      logger.warn(`MCP http error: ${payload.error?.message || response.statusText}`);
      throw new Error(payload.error?.message || 'MCP http error');
    }
    return payload.result;
  }

  async function listTools(): Promise<McpToolDefinition[]> {
    const result = (await request('tools/list')) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
    const tools = result?.tools || [];
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', additionalProperties: true },
      serverName: '',
    }));
  }

  async function callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    return request('tools/call', { name, arguments: input });
  }

  return { listTools, callTool };
}
