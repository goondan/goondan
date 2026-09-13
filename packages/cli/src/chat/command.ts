import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, type LoadedConfig, type Model, type RuntimeBindings } from '@goondan/core';
import { createDefaultChatConfig, defaultChatStateDirectory } from './default.js';
import { ChatHost } from './host.js';
import { createRouterModel, DEFAULT_CHAT_MODEL } from './provider.js';
import { runChatRepl, type ChatReplIO } from './repl.js';
import { createLocalTools } from './tools.js';

export interface ChatOptions { cwd: string; model: string; session: string; stateDirectory: string; finalOnly: boolean; config?: string; bindings?: string }

function optionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

export function parseChatOptions(argv: string[], cwd = process.cwd()): ChatOptions {
  let workingDirectory = cwd; let model = DEFAULT_CHAT_MODEL; let session: string = randomUUID();
  let stateDirectory = defaultChatStateDirectory(); let finalOnly = false; let config: string | undefined; let bindings: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]; if (!flag) continue;
    if (flag === '--final-only') { finalOnly = true; continue; }
    const value = optionValue(argv, index, flag); index += 1;
    if (flag === '--cwd') workingDirectory = resolve(cwd, value);
    else if (flag === '--model') model = value;
    else if (flag === '--session') session = value;
    else if (flag === '--state-dir') stateDirectory = resolve(cwd, value);
    else if (flag === '--config') config = resolve(cwd, value);
    else if (flag === '--bindings') bindings = resolve(cwd, value);
    else throw new Error(`Unknown chat option: ${flag}`);
  }
  return { cwd: workingDirectory, model, session, stateDirectory, finalOnly, config, bindings };
}

function isRuntimeBindings(value: unknown): value is RuntimeBindings {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'models' in value && typeof value.models === 'object' && value.models !== null;
}

async function loadBindings(path: string): Promise<RuntimeBindings> {
  const module: unknown = await import(pathToFileURL(path).href);
  if (typeof module !== 'object' || module === null || Array.isArray(module)) throw new Error(`Bindings module must export RuntimeBindings: ${path}`);
  const candidate = 'bindings' in module ? module.bindings : 'default' in module ? module.default : undefined;
  if (!isRuntimeBindings(candidate)) throw new Error(`Bindings module must export RuntimeBindings: ${path}`);
  return candidate;
}

function defaultBindings(config: LoadedConfig, options: ChatOptions): RuntimeBindings {
  const provider: Model = createRouterModel({ model: options.model });
  const models: Record<string, Model> = {};
  for (const agent of Object.values(config.config.agents)) if (agent.model) models[agent.model] = provider;
  return { models, tools: createLocalTools({ cwd: options.cwd }) };
}

export async function runChat(options: ChatOptions, io: ChatReplIO): Promise<void> {
  const config = options.config ? await loadConfig(options.config) : createDefaultChatConfig(options.cwd, options.model);
  const bindings = options.bindings ? await loadBindings(options.bindings) : defaultBindings(config, options);
  io.error.write(`Session: ${options.session}\n`);
  const host = new ChatHost({
    config, bindings, sessionId: options.session, stateDirectory: options.stateDirectory,
    finalOnly: options.finalOnly,
    onTextDelta(delta) { io.output.write(delta); },
    onStatus(message) { io.error.write(`${message}\n`); },
  });
  await runChatRepl(host, io);
}
