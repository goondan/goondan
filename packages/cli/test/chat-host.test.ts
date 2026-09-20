import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Json, LoadedConfig, Message, Model, ModelInput, ModelResult, Tool } from '@goondan/core';
import { createDefaultChatConfig } from '../src/chat/default.js';
import { ChatHost } from '../src/chat/host.js';
import { runChatRepl } from '../src/chat/repl.js';

function textMessages(input: ModelInput): string[] {
  return input.messages.flatMap((message) => message.content.flatMap((part) => part.type === 'text' ? [part.text] : []));
}

function assistant(content: Message['content'], finishReason: ModelResult['finishReason'] = 'stop'): ModelResult {
  return { message: { id: crypto.randomUUID(), role: 'assistant', source: 'fake', content }, finishReason };
}

function host(root: string, session: string, model: Model, tools: Record<string, Tool> = {}, onStatus?: (message: string) => void): ChatHost {
  const config = createDefaultChatConfig(root, 'fake');
  const entry = config.config.agents['assistant'];
  if (!entry) throw new Error('Missing default assistant');
  entry.tools = Object.keys(tools);
  return new ChatHost({
    config,
    bindings: { models: { fake: model }, tools }, sessionId: session, stateDirectory: root, onStatus,
  });
}

describe('ChatHost', () => {
  it('여러 턴의 대화를 같은 세션에 전달한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gdn-chat-'));
    const seen: string[][] = [];
    const model: Model = {
      async generate(input): Promise<ModelResult> {
        seen.push(textMessages(input));
        return assistant([{ type: 'text', text: `answer-${seen.length.toString()}` }]);
      },
    };
    const chat = host(root, 'multi', model);
    await started(chat.submit('first'));
    await started(chat.submit('second'));
    await chat.close();
    expect(seen[1]).toEqual(['first', 'answer-1', 'second']);
  });

  it('도구를 실행하고 결과를 모델에 돌려준다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gdn-chat-'));
    const output = join(root, 'result.txt');
    let calls = 0;
    const statuses: string[] = [];
    const write: Tool = {
      name: 'write_file', description: 'write', input: {},
      async execute(value, context) {
        await writeFile(output, String(value), 'utf8');
        return { callId: context.toolCall.id, name: 'write_file', args: value, content: [{ type: 'text', text: 'written' }] };
      },
    };
    const model: Model = {
      async generate(input): Promise<ModelResult> {
        calls += 1;
        if (calls === 1) return assistant([{ type: 'tool.call', callId: 'call-1', name: 'write_file', args: 'hello' }], 'tool');
        expect(input.messages.some((message) => message.role === 'tool')).toBe(true);
        return assistant([{ type: 'text', text: 'done' }]);
      },
    };
    const chat = host(root, 'tool', model, { write_file: write }, (message) => statuses.push(message));
    expect((await started(chat.submit('write it'))).text).toBe('done');
    expect(await readFile(output, 'utf8')).toBe('hello');
    expect(statuses).toContain('Running tool: write_file');
    await chat.close();
  });

  it('실행 중 입력은 steer로 다음 단계에 반영한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gdn-chat-'));
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const modelEntered = new Promise<void>((resolve) => { entered = resolve; });
    let calls = 0;
    const model: Model = {
      async generate(input): Promise<ModelResult> {
        calls += 1;
        if (calls === 1) {
          entered?.();
          await new Promise<void>((resolve) => { release = resolve; });
          return assistant([{ type: 'tool.call', callId: 'call', name: 'noop', args: null }], 'tool');
        }
        expect(textMessages(input)).toContain('more detail');
        return assistant([{ type: 'text', text: 'steered' }]);
      },
    };
    const noop: Tool = { name: 'noop', description: 'noop', input: {}, execute(_value, context) { return { callId: context.toolCall.id, name: 'noop', args: null, content: [] }; } };
    const chat = host(root, 'steer', model, { noop });
    const first = chat.submit('start');
    await modelEntered;
    expect(chat.submit('more detail').kind).toBe('steered');
    release?.();
    expect((await started(first)).text).toBe('steered');
    await chat.close();
  });

  it('병렬 실행 중에는 steer 대상 에이전트 지정 방법을 안내한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gdn-chat-'));
    const config: LoadedConfig = {
      directory: root,
      templates: new Map(),
      config: {
        version: 1,
        name: 'parallel-steer',
        agents: { left: { model: 'left' }, right: { model: 'right' } },
        routes: [
          { from: '$input', to: 'left' },
          { from: '$input', to: 'right' },
          { from: 'left', to: '$output' },
          { from: 'right', to: '$output' },
        ],
      },
    };
    let enteredCount = 0;
    let entered: (() => void) | undefined;
    const bothEntered = new Promise<void>((resolve) => { entered = resolve; });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const model = (text: string): Model => ({
      async generate(): Promise<ModelResult> {
        enteredCount += 1;
        if (enteredCount === 2) entered?.();
        await gate;
        return assistant([{ type: 'text', text }]);
      },
    });
    const chat = new ChatHost({
      config,
      bindings: { models: { left: model('left'), right: model('right') } },
      sessionId: 'parallel',
      stateDirectory: root,
    });
    const input = new PassThrough();
    let stderr = '';
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const error = new Writable({ write(chunk, _encoding, callback) { stderr += String(chunk); callback(); } });
    const repl = runChatRepl(chat, { input, output, error, terminal: false });

    input.write('start\n');
    await bothEntered;
    input.write('more context\n');
    input.write('/steer left left-only context\n');
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    release?.();
    input.end();
    await repl;

    expect(stderr).toContain('Use /steer <AGENT> <INPUT> while multiple agents are running.');
  });

  it('현재 모델 호출을 취소한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gdn-chat-'));
    let entered: (() => void) | undefined;
    const modelEntered = new Promise<void>((resolve) => { entered = resolve; });
    const model: Model = {
      async generate(_input, context): Promise<ModelResult> {
        entered?.();
        await new Promise<void>((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
        return assistant([]);
      },
    };
    const chat = host(root, 'cancel', model);
    const turn = started(chat.submit('wait'));
    await modelEntered;
    expect(chat.interrupt()).toBe(true);
    await expect(turn).rejects.toMatchObject({ name: 'AbortError' });
    await chat.close();
  });

  it('새 호스트가 저장된 세션을 복원한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gdn-chat-'));
    const firstModel: Model = { async generate() { return assistant([{ type: 'text', text: 'saved' }]); } };
    const first = host(root, 'reload', firstModel);
    await started(first.submit('remember'));
    await first.close();
    let restored: Json = null;
    const second = host(root, 'reload', { async generate(input) { restored = textMessages(input); return assistant([{ type: 'text', text: 'ok' }]); } });
    await started(second.submit('again'));
    expect(restored).toEqual(['remember', 'saved', 'again']);
    await second.close();
  });

  it('final-only에서는 직렬 에이전트의 중간 출력을 숨기고 최종 출력만 한 번 쓴다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gdn-chat-'));
    const config: LoadedConfig = {
      directory: root,
      templates: new Map(),
      config: {
        version: 1,
        name: 'serial-final-only',
        agents: {
          analysis: { model: 'analysis', input: 'asis' },
          polish: { model: 'polish', input: 'asis' },
        },
        routes: [
          { from: '$input', to: 'analysis' },
          { from: 'analysis', to: 'polish' },
          { from: 'polish', to: '$output' },
        ],
      },
    };
    const model = (text: string): Model => ({
      async generate(_input, context): Promise<ModelResult> {
        context.onTextDelta(text);
        return assistant([{ type: 'text', text }]);
      },
    });
    const chat = new ChatHost({
      config,
      bindings: { models: { analysis: model('analysis draft'), polish: model('polished final') } },
      sessionId: 'final-only',
      stateDirectory: root,
      finalOnly: true,
    });
    let stdout = '';
    const output = new Writable({ write(chunk, _encoding, callback) { stdout += String(chunk); callback(); } });
    const error = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

    await runChatRepl(chat, { input: Readable.from(['request\n']), output, error, terminal: false });

    expect(stdout).toBe('polished final\n');
    expect(stdout).not.toContain('analysis draft');
  });

  it('파이프로 실행한 턴의 실패를 프로세스 진입점까지 전파한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gdn-chat-'));
    const chat = host(root, 'pipe-error', {
      async generate(): Promise<ModelResult> {
        throw new Error('Maximum steps exceeded: 32');
      },
    });
    let stderr = '';
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const error = new Writable({ write(chunk, _encoding, callback) { stderr += String(chunk); callback(); } });

    await expect(runChatRepl(chat, {
      input: Readable.from(['request\n']), output, error, terminal: false,
    })).rejects.toThrow('Maximum steps exceeded: 32');
    expect(stderr).toBe('Maximum steps exceeded: 32\n');
  });
});

function started(result: ReturnType<ChatHost['submit']>): Promise<import('../src/chat/host.js').ChatTurnResult> {
  if (result.kind !== 'started') throw new Error('Expected a started turn');
  return result.completion;
}
