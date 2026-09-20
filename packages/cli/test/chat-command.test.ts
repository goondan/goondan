import { mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '@goondan/core';
import { createDefaultChatBindings, parseChatOptions, runChat } from '../src/chat/command.js';

describe('parseChatOptions', () => {
  it('대화 명령 기본값을 만든다', () => {
    const options = parseChatOptions([], '/tmp/project');
    expect(options.cwd).toBe('/tmp/project');
    expect(options.provider).toBeUndefined();
    expect(options.model).toBeUndefined();
    expect(options.baseUrl).toBeUndefined();
    expect(options.stateDirectory).toBe(resolve(homedir(), '.goondan', 'chat'));
    expect(options.finalOnly).toBe(false);
    expect(options.session.length).toBeGreaterThan(0);
  });

  it('경로와 세션 옵션을 파싱한다', () => {
    const options = parseChatOptions([
      '--cwd', './repo', '--model', 'test-model', '--session', 'saved',
      '--state-dir', './state', '--config', './agent', '--bindings', './bindings.mjs',
      '--final-only',
    ], '/tmp/project');
    expect(options).toEqual({
      cwd: '/tmp/project/repo', provider: undefined, model: 'test-model', baseUrl: undefined,
      session: 'saved', stateDirectory: '/tmp/project/state',
      finalOnly: true, config: '/tmp/project/agent', bindings: '/tmp/project/bindings.mjs',
    });
  });

  it('제공자와 기본 URL을 파싱한다', () => {
    const options = parseChatOptions(['--provider', 'openai', '--base-url', 'http://localhost:11434/v1', '--model', 'llama3.1'], '/tmp/project');
    expect(options.provider).toBe('openai');
    expect(options.baseUrl).toBe('http://localhost:11434/v1');
    expect(options.model).toBe('llama3.1');
  });

  it('값이 없거나 알 수 없는 옵션은 거부한다', () => {
    expect(() => parseChatOptions(['--model'], '/tmp')).toThrow('Missing value');
    expect(() => parseChatOptions(['--wat', 'value'], '/tmp')).toThrow('Unknown chat option');
    expect(() => parseChatOptions(['--provider', 'gemini'], '/tmp')).toThrow('--provider must be anthropic or openai: gemini');
  });
});

describe('createDefaultChatBindings', () => {
  it('구성이 선언한 모든 모델 이름을 선택한 어댑터에 묶는다', () => {
    const config: LoadedConfig = {
      directory: '/tmp/project',
      templates: new Map(),
      config: {
        version: 1,
        name: 'models',
        agents: { main: { model: 'main-model' }, helper: { model: 'helper-model' } },
        routes: [
          { from: '$input', to: 'main' },
          { from: 'main', to: 'helper' },
          { from: 'helper', to: '$output' },
        ],
      },
    };

    const bindings = createDefaultChatBindings(
      config,
      { provider: 'openai', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' },
      '/tmp/project',
      {},
    );

    expect(Object.keys(bindings.models).sort()).toEqual(['helper-model', 'main-model']);
    expect(bindings.models['helper-model']).toBe(bindings.models['main-model']);
    expect(Object.keys(bindings.tools ?? {}).sort()).toEqual(['bash', 'list_dir', 'read_file', 'write_file']);
  });
});

describe('runChat', () => {
  it('구성과 바인딩 모듈로 한 턴을 실행한다', async () => {
    const fixtures = fileURLToPath(new URL('fixtures/chat', import.meta.url));
    const stateDirectory = await mkdtemp(join(tmpdir(), 'gdn-chat-run-'));
    const options = parseChatOptions([
      '--config', fixtures, '--bindings', join(fixtures, 'bindings.mjs'),
      '--session', 'smoke', '--state-dir', stateDirectory,
    ], fixtures);
    let stdout = ''; let stderr = '';
    const output = new Writable({ write(chunk, _encoding, callback) { stdout += String(chunk); callback(); } });
    const error = new Writable({ write(chunk, _encoding, callback) { stderr += String(chunk); callback(); } });

    await runChat(options, { input: Readable.from(['hello\n']), output, error, terminal: false }, {});

    expect(stdout).toContain('echo:hello');
    expect(stderr).toContain('Session: smoke');
  });
});
