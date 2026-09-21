#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGoondan, loadConfig, type RuntimeBindings } from '@goondan/core';
import { stringify } from 'yaml';
import { parseChatOptions, runChat } from './chat/command.js';
import { renderOutputs } from './chat/host.js';
import { parseRunInput } from './run-input.js';

interface Options { command: string; directory: string; bindings: string; input?: string; inputFile?: string; sessionId: string; agent?: string }

function usage(): string {
  return [
    'Usage:',
    '  gdn run [CONFIG_PATH] --bindings <MODULE> [--input <JSON_OR_TEXT>] [--input-file <PATH>]',
    '          [--session-id <ID>] [--agent <AGENT>]',
    '  gdn chat [--cwd <PATH>] [--provider <anthropic|openai>] [--model <MODEL>] [--base-url <URL>]',
    '           [--session <ID>] [--state-dir <PATH>] [--config <PATH>] [--bindings <MODULE>] [--final-only]',
    '  gdn config [CONFIG_PATH]',
    '',
    'The bindings module exports `bindings` or a default RuntimeBindings object.',
    '`gdn run` reads the input from standard input when neither --input nor --input-file is given.',
    '`gdn chat` uses `/agent <AGENT> <INPUT>` to target an agent.',
    '`gdn chat` manages approvals with `/operations`, `/approve`, `/reject`, and `/cancel`.',
  ].join('\n');
}

function parse(argv: string[]): Options {
  const command = argv.shift() ?? 'help';
  let directory = '.'; let bindings = 'goondan.bindings.js'; let input: string | undefined; let inputFile: string | undefined;
  let sessionId = `cli:${Date.now().toString(36)}`; let agent: string | undefined;
  if (argv[0] && !argv[0].startsWith('-')) directory = argv.shift() ?? '.';
  while (argv.length > 0) {
    const flag = argv.shift(); const value = argv.shift();
    if (!flag || !value) throw new Error(`Missing value for ${flag ?? 'option'}`);
    if (flag === '--bindings') bindings = value;
    else if (flag === '--input') input = value;
    else if (flag === '--input-file') inputFile = value;
    else if (flag === '--session-id') sessionId = value;
    else if (flag === '--agent') agent = value;
    else throw new Error(`Unknown option: ${flag}`);
  }
  return { command, directory, bindings, input, inputFile, sessionId, agent };
}

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
  if (options.command !== 'config' && options.command !== 'run') throw new Error(`Unknown command: ${options.command}\n${usage()}`);
  const absolute = resolve(options.directory);
  const loaded = await loadConfig(absolute);
  if (options.command === 'config') { process.stdout.write(stringify(loaded.config)); return; }
  const module = await import(pathToFileURL(resolve(options.bindings)).href);
  const candidate: unknown = module.bindings ?? module.default;
  if (!isBindings(candidate)) throw new Error(`Bindings module must export RuntimeBindings: ${options.bindings}`);
  const raw = options.inputFile ? await readFile(resolve(options.inputFile), 'utf8') : options.input ?? await new Promise<string>((done) => { let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk: string) => { value += chunk; }); process.stdin.on('end', () => done(value)); });
  const goondan = createGoondan(loaded, candidate);
  try {
    const result = await goondan.run(parseRunInput(raw), { sessionId: options.sessionId, agent: options.agent });
    const output = renderOutputs(result.outputs, true);
    if (output.length > 0) process.stdout.write(`${output}\n`);
  } finally { await goondan.close(); }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
