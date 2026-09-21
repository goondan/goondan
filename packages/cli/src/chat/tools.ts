import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Json, Tool, ToolContext, ToolResultValue } from '@goondan/core';

const DEFAULT_MAX_OUTPUT_CHARS = 10_000;
const DEFAULT_MAX_READ_CHARS = 30_000;
const DEFAULT_MAX_WRITE_CHARS = 1_000_000;

export interface LocalToolsOptions {
  cwd: string;
  bashTimeoutMs?: number;
  maxOutputChars?: number;
  maxReadChars?: number;
  maxWriteChars?: number;
}

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(input: Json, field: string): string {
  if (!isRecord(input) || typeof input[field] !== 'string') throw new Error(`Tool input requires string field: ${field}`);
  return input[field];
}

function optionalString(input: Json, field: string, fallback: string): string {
  if (!isRecord(input)) throw new Error('Tool input must be an object');
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`Tool input field must be a string: ${field}`);
  return value;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…(truncated, ${text.length} characters total)`;
}

function result(text: string, isError = false): ToolResultValue {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

function runBash(command: string, options: Required<Pick<LocalToolsOptions, 'cwd' | 'maxOutputChars'>> & Pick<LocalToolsOptions, 'bashTimeoutMs'>, ctx: ToolContext): Promise<ToolResultValue> {
  return new Promise((resolvePromise) => {
    let cancelled = false;
    let timedOut = false;
    let settled = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (current: string, chunk: Buffer): string => {
      if (current.length > options.maxOutputChars) return current;
      return current + chunk.toString('utf8').slice(0, options.maxOutputChars + 1 - current.length);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const finish = (error: Error | undefined, code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', cancel);
      const output = [stdout, stderr].filter((text) => text.length > 0).join('\n');
      if (error || code !== 0) {
        const reason = cancelled
          ? 'Command was cancelled'
          : timedOut
            ? `Command timed out after ${options.bashTimeoutMs}ms`
            : error?.message ?? `Command exited with code ${String(code)}`;
        const message = output === '' ? reason : `${output}\n${reason}`;
        resolvePromise(result(truncate(message, options.maxOutputChars), true));
        return;
      }
      resolvePromise(result(truncate(output, options.maxOutputChars)));
    };
    child.once('error', (error) => finish(error, null));
    child.once('close', (code) => finish(undefined, code));
    const terminate = (): void => {
      if (child.pid !== undefined && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGTERM');
          return;
        } catch {
          // The process may have exited between the callback and cancellation.
        }
      }
      child.kill();
    };
    const cancel = (): void => {
      cancelled = true;
      terminate();
    };
    const timer = options.bashTimeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.bashTimeoutMs);
    if (ctx.signal.aborted) cancel();
    else ctx.signal.addEventListener('abort', cancel, { once: true });
  });
}

function createTool(name: string, description: string, input: Record<string, Json>, execute: Tool['execute']): Tool {
  return { name, description, input, execute };
}

export function createLocalTools(options: LocalToolsOptions): Record<string, Tool> {
  const cwd = resolve(options.cwd);
  const bashTimeoutMs = options.bashTimeoutMs;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const maxReadChars = options.maxReadChars ?? DEFAULT_MAX_READ_CHARS;
  const maxWriteChars = options.maxWriteChars ?? DEFAULT_MAX_WRITE_CHARS;
  const at = (path: string): string => resolve(cwd, path);

  const bash = createTool(
    'bash',
    `Run a shell command in ${cwd}.`,
    { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    (input, ctx) => runBash(requiredString(input, 'command'), { cwd, bashTimeoutMs, maxOutputChars }, ctx),
  );
  const readFileTool = createTool(
    'read_file',
    `Read a UTF-8 file. Relative paths are resolved from ${cwd}.`,
    { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async (input, _ctx) => {
      try {
        const content = await readFile(at(requiredString(input, 'path')), 'utf8');
        return result(truncate(content, maxReadChars));
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  );
  const writeFileTool = createTool(
    'write_file',
    `Write a UTF-8 file. Relative paths are resolved from ${cwd}; parent directories are created.`,
    {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    async (input, _ctx) => {
      try {
        const path = requiredString(input, 'path');
        const content = requiredString(input, 'content');
        if (content.length > maxWriteChars) return result(`Content exceeds the ${maxWriteChars} character write limit`, true);
        const absolutePath = at(path);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, 'utf8');
        return result(`Wrote ${path} (${content.length} characters)`);
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  );
  const listDir = createTool(
    'list_dir',
    `List a directory. Relative paths are resolved from ${cwd}.`,
    { type: 'object', properties: { path: { type: 'string' } } },
    async (input, _ctx) => {
      try {
        const entries = await readdir(at(optionalString(input, 'path', '.')), { withFileTypes: true });
        const output = entries
          .map((entry) => `${entry.isDirectory() ? 'd' : 'f'} ${entry.name}`)
          .sort()
          .join('\n');
        return result(truncate(output, maxOutputChars));
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  return { bash, read_file: readFileTool, write_file: writeFileTool, list_dir: listDir };
}
