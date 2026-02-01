import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpAdapter, McpToolDefinition } from '../manager.js';
import type { Resource } from '../../config/registry.js';
import type { JsonObject, UnknownObject } from '../../sdk/types.js';

interface StdioClient {
  listTools: () => Promise<McpToolDefinition[]>;
  callTool: (name: string, input: JsonObject) => Promise<unknown>;
  close: () => void;
}

export function createStdioAdapter(options: { server: Resource; logger?: Console }): McpAdapter {
  const logger = options.logger || console;
  const transport = (options.server.spec as { transport?: { command?: string[] } } | undefined)?.transport;
  const command = transport?.command || [];
  if (command.length === 0) {
    throw new Error(`MCP stdio command가 없습니다: ${options.server.metadata.name}`);
  }

  const client = createClient(command, logger);

  return {
    listTools: client.listTools,
    callTool: (name, input, _ctx?: UnknownObject) => client.callTool(name, input),
    close: client.close,
  };
}

function createClient(command: string[], logger: Console): StdioClient {
  const [cmd, ...args] = command;
  if (!cmd) {
    throw new Error('MCP stdio command가 비어 있습니다.');
  }
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let buffer = '';
  let counter = 1;

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        handleLine(line);
      }
      idx = buffer.indexOf('\n');
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    logger.warn(`[mcp-stdio] ${chunk.toString()}`);
  });

  function handleLine(line: string) {
    try {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
      if (!message.id) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message || 'MCP error'));
      } else {
        entry.resolve(message.result);
      }
    } catch (err) {
      logger.warn(`MCP stdout parse 실패: ${line}`);
    }
  }

  function request(method: string, params: JsonObject = {}) {
    return new Promise((resolve, reject) => {
      const id = counter++;
      pending.set(id, { resolve, reject: reject as (err: Error) => void });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      child.stdin.write(`${payload}\n`);
    });
  }

  async function listTools(): Promise<McpToolDefinition[]> {
    const result = (await request('tools/list')) as { tools?: Array<{ name: string; description?: string; inputSchema?: JsonObject }> };
    const tools = result?.tools || [];
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', additionalProperties: true },
      serverName: '',
    }));
  }

  async function callTool(name: string, input: JsonObject): Promise<unknown> {
    const result = await request('tools/call', { name, arguments: input });
    return result;
  }

  function close() {
    child.kill();
  }

  return { listTools, callTool, close };
}
