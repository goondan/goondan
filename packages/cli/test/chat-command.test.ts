import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_MODEL } from '../src/chat/provider.js';
import { parseChatOptions } from '../src/chat/command.js';

describe('parseChatOptions', () => {
  it('대화 명령 기본값을 만든다', () => {
    const options = parseChatOptions([], '/tmp/project');
    expect(options.cwd).toBe('/tmp/project');
    expect(options.model).toBe(DEFAULT_CHAT_MODEL);
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
      cwd: '/tmp/project/repo', model: 'test-model', session: 'saved', stateDirectory: '/tmp/project/state',
      finalOnly: true, config: '/tmp/project/agent', bindings: '/tmp/project/bindings.mjs',
    });
  });

  it('값이 없거나 알 수 없는 옵션은 거부한다', () => {
    expect(() => parseChatOptions(['--model'], '/tmp')).toThrow('Missing value');
    expect(() => parseChatOptions(['--wat', 'value'], '/tmp')).toThrow('Unknown chat option');
  });
});
