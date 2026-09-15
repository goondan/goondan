import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, type LoadedConfig, type Model, type RuntimeBindings } from '@goondan/core';
import type { ModelEnv } from '@goondan/models';
import { createDefaultChatConfig, defaultChatStateDirectory } from './default.js';
import { ChatHost } from './host.js';
import {
  createChatModel, isChatProvider, selectChatModel, DEFAULT_ANTHROPIC_CHAT_MODEL,
  type ChatModelSelection, type ChatProvider,
} from './model.js';
import { runChatRepl, type ChatReplIO } from './repl.js';
import { createLocalTools } from './tools.js';

export interface ChatOptions {
  cwd: string; session: string; stateDirectory: string; finalOnly: boolean;
  provider?: ChatProvider; model?: string; baseUrl?: string; config?: string; bindings?: string;
}

function optionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function chatProvider(value: string): ChatProvider {
  if (!isChatProvider(value)) throw new Error(`--provider must be anthropic or openai: ${value}`);
  return value;
}

export function parseChatOptions(argv: string[], cwd = process.cwd()): ChatOptions {
  let workingDirectory = cwd; let session: string = randomUUID();
  let stateDirectory = defaultChatStateDirectory(); let finalOnly = false;
  let provider: ChatProvider | undefined; let model: string | undefined; let baseUrl: string | undefined;
  let config: string | undefined; let bindings: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]; if (!flag) continue;
    if (flag === '--final-only') { finalOnly = true; continue; }
    const value = optionValue(argv, index, flag); index += 1;
    if (flag === '--cwd') workingDirectory = resolve(cwd, value);
    else if (flag === '--provider') provider = chatProvider(value);
    else if (flag === '--model') model = value;
    else if (flag === '--base-url') baseUrl = value;
    else if (flag === '--session') session = value;
    else if (flag === '--state-dir') stateDirectory = resolve(cwd, value);
    else if (flag === '--config') config = resolve(cwd, value);
    else if (flag === '--bindings') bindings = resolve(cwd, value);
    else throw new Error(`Unknown chat option: ${flag}`);
  }
  return { cwd: workingDirectory, session, stateDirectory, finalOnly, provider, model, baseUrl, config, bindings };
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

function collectModelNames(config: LoadedConfig, into: Set<string>): void {
  for (const agent of Object.values(config.config.agents)) if (agent.model) into.add(agent.model);
  for (const nested of config.nested?.values() ?? []) collectModelNames(nested, into);
}

/**
 * The bindings `gdn chat` uses when no bindings module is given: every model name the configuration
 * and its nested configurations declare is bound to the selected adapter, plus the local tools.
 */
export function createDefaultChatBindings(
  config: LoadedConfig,
  selection: ChatModelSelection,
  cwd: string,
  env: ModelEnv,
): RuntimeBindings {
  const provider: Model = createChatModel(selection, env);
  const names = new Set<string>();
  collectModelNames(config, names);
  const models: Record<string, Model> = {};
  for (const name of names) models[name] = provider;
  return { models, tools: createLocalTools({ cwd }) };
}

async function chatConfig(options: ChatOptions, model: string): Promise<LoadedConfig> {
  return options.config === undefined ? createDefaultChatConfig(options.cwd, model) : await loadConfig(options.config);
}

interface ChatSetup { config: LoadedConfig; bindings: RuntimeBindings }

async function prepareChat(options: ChatOptions, env: ModelEnv): Promise<ChatSetup> {
  const bindingsPath = options.bindings;
  if (bindingsPath !== undefined) {
    return { config: await chatConfig(options, options.model ?? DEFAULT_ANTHROPIC_CHAT_MODEL), bindings: await loadBindings(bindingsPath) };
  }
  const selection = selectChatModel(options, env);
  const config = await chatConfig(options, selection.model);
  return { config, bindings: createDefaultChatBindings(config, selection, options.cwd, env) };
}

export async function runChat(options: ChatOptions, io: ChatReplIO, env: ModelEnv = process.env): Promise<void> {
  const { config, bindings } = await prepareChat(options, env);
  io.error.write(`Session: ${options.session}\n`);
  const host = new ChatHost({
    config, bindings, sessionId: options.session, stateDirectory: options.stateDirectory,
    finalOnly: options.finalOnly,
    onTextDelta(delta) { io.output.write(delta); },
    onStatus(message) { io.error.write(`${message}\n`); },
  });
  await runChatRepl(host, io);
}
