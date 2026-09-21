import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Json, Part, Tool, ToolContext, ToolResultValue } from '@goondan/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalTools } from '../src/chat/tools.ts';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'goondan-chat-tools-'));
  temporaryDirectories.push(directory);
  return directory;
}

function context(name: string, input: Json, signal = new AbortController().signal): ToolContext {
  return {
    input: [],
    conversation: [],
    agent: 'main',
    sessionId: 'session-1',
    turnId: 'turn-1',
    instance: 'instance-1',
    executionId: 'execution-1',
    toolCall: { id: `call-${name}`, name, args: input },
    execution: {},
    signal,
    log: { info() {}, warn() {}, error() {} },
    agents: { run: async () => { throw new Error('unused'); } },
  };
}

async function execute(tool: Tool | undefined, input: Json, signal?: AbortSignal): Promise<ToolResultValue> {
  if (!tool) throw new Error('Expected tool to be registered');
  const returned: unknown = await Promise.resolve(tool.execute(input, context(tool.name, input, signal)));
  if (typeof returned !== 'object' || returned === null || Array.isArray(returned)
    || !('content' in returned) || !Array.isArray(returned.content) || !returned.content.every(isPart)) {
    throw new Error('Expected a tool result value');
  }
  return {
    content: returned.content,
    ...('isError' in returned && returned.isError === true ? { isError: true } : {}),
  };
}

function isPart(value: unknown): value is Part {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'type' in value && value.type === 'text'
    && 'text' in value && typeof value.text === 'string';
}

function text(result: ToolResultValue): string {
  const part = result.content[0];
  if (!part || part.type !== 'text') throw new Error('Expected text tool result');
  return part.text;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('createLocalTools', () => {
  it('writes, reads, and lists paths relative to cwd', async () => {
    const cwd = await temporaryDirectory();
    const tools = createLocalTools({ cwd });
    const writeResult = await execute(tools.write_file, { path: 'nested/note.txt', content: 'hello' });
    expect(writeResult.isError).toBeUndefined();
    expect(await readFile(join(cwd, 'nested/note.txt'), 'utf8')).toBe('hello');

    const readResult = await execute(tools.read_file, { path: 'nested/note.txt' });
    expect(text(readResult)).toBe('hello');
    const listResult = await execute(tools.list_dir, { path: 'nested' });
    expect(text(listResult)).toBe('f note.txt');
  });

  it('enforces read, write, and command output limits', async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, 'large.txt'), 'abcdefghij', 'utf8');
    const tools = createLocalTools({ cwd, maxReadChars: 4, maxWriteChars: 4, maxOutputChars: 4 });

    expect(text(await execute(tools.read_file, { path: 'large.txt' }))).toContain('abcd\n…(truncated');
    const rejectedWrite = await execute(tools.write_file, { path: 'other.txt', content: '12345' });
    expect(rejectedWrite.isError).toBe(true);
    expect(text(rejectedWrite)).toContain('4 character write limit');
    const bashResult = await execute(tools.bash, { command: "printf 'abcdefghij'" });
    expect(text(bashResult)).toContain('abcd\n…(truncated');
  });

  it('returns command failures and timeouts as error tool results', async () => {
    const cwd = await temporaryDirectory();
    const tools = createLocalTools({ cwd });
    const failed = await execute(tools.bash, { command: "printf 'failure' >&2; exit 7" });
    expect(failed.isError).toBe(true);
    expect(text(failed)).toContain('failure');

    const timeoutTools = createLocalTools({ cwd, bashTimeoutMs: 50 });
    const timedOut = await execute(timeoutTools.bash, { command: 'sleep 1' });
    expect(timedOut.isError).toBe(true);
    expect(text(timedOut)).toMatch(/timed out|killed|SIGTERM/i);
  });
});
