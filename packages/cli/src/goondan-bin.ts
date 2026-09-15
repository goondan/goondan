#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntime, loadConfig, textOf, type Json, type RuntimeBindings } from '@goondan/core';
import { stringify } from 'yaml';
import { parseChatOptions, runChat } from './chat/command.js';

interface Options { command: string; directory: string; bindings: string; input?: string; inputFile?: string; conversationId: string; agent?: string; variants: string[] }

function usage(): string {
  return [
    'Usage:',
    '  gdn run [CONFIG_PATH] --bindings <MODULE> [--input <JSON_OR_TEXT>] [--input-file <PATH>]',
    '          [--conversation-id <ID>] [--agent <AGENT_PATH>] [--variant <NAME>]',
    '  gdn chat [--cwd <PATH>] [--provider <anthropic|openai>] [--model <MODEL>] [--base-url <URL>]',
    '           [--session <ID>] [--state-dir <PATH>] [--config <PATH>] [--bindings <MODULE>] [--final-only]',
    '  gdn validate [CONFIG_PATH] [--variant <NAME>]',
    '  gdn config [CONFIG_PATH] [--variant <NAME>]',
    '',
    'The bindings module exports `bindings` or a default RuntimeBindings object.',
    '`--variant` may be repeated and applies in the given order.',
    '`gdn run` reads the input from standard input when neither --input nor --input-file is given.',
  ].join('\n');
}

function parse(argv: string[]): Options {
  const command = argv.shift() ?? 'help';
  let directory = '.'; let bindings = 'goondan.bindings.js'; let input: string | undefined; let inputFile: string | undefined;
  let conversationId = `cli:${Date.now().toString(36)}`; let agent: string | undefined; const variants: string[] = [];
  if (argv[0] && !argv[0].startsWith('-')) directory = argv.shift() ?? '.';
  while (argv.length > 0) {
    const flag = argv.shift(); const value = argv.shift();
    if (!flag || !value) throw new Error(`Missing value for ${flag ?? 'option'}`);
    if (flag === '--bindings') bindings = value;
    else if (flag === '--input') input = value;
    else if (flag === '--input-file') inputFile = value;
    else if (flag === '--conversation-id') conversationId = value;
    else if (flag === '--agent') agent = value;
    else if (flag === '--variant') variants.push(value);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return { command, directory, bindings, input, inputFile, conversationId, agent, variants };
}

function parseInput(raw: string): Json { try { return JSON.parse(raw); } catch { return raw; } }
function isBindings(value: unknown): value is RuntimeBindings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'models' in value && typeof value.models === 'object' && value.models !== null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'chat') {
    if (argv.includes('--help') || argv.includes('-h')) { console.log(usage()); return; }
    await runChat(parseChatOptions(argv.slice(1)), { input: process.stdin, output: process.stdout, error: process.stderr, terminal: !!process.stdin.isTTY && !!process.stdout.isTTY });
    return;
  }
  const options = parse(argv);
  if (options.command === 'help' || options.command === '--help' || options.command === '-h') { console.log(usage()); return; }
  const absolute = resolve(options.directory);
  const loaded = await loadConfig(absolute, { variants: options.variants });
  if (options.command === 'validate') { console.log(`Valid config: ${loaded.config.name}`); return; }
  if (options.command === 'config') { process.stdout.write(stringify(loaded.config)); return; }
  if (options.command !== 'run') throw new Error(`Unknown command: ${options.command}\n${usage()}`);
  const module = await import(pathToFileURL(resolve(options.bindings)).href);
  const candidate: unknown = module.bindings ?? module.default;
  if (!isBindings(candidate)) throw new Error(`Bindings module must export RuntimeBindings: ${options.bindings}`);
  const raw = options.inputFile ? await readFile(resolve(options.inputFile), 'utf8') : options.input ?? await new Promise<string>((done) => { let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk: string) => { value += chunk; }); process.stdin.on('end', () => done(value)); });
  const runtime = createRuntime(loaded, candidate);
  try {
    const result = await runtime.runTurn(parseInput(raw), { conversationId: options.conversationId, agent: options.agent });
    process.stdout.write(`${textOf(result.output.content)}\n`);
  } finally { await runtime.close(); }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
