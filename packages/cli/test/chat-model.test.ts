import { describe, expect, it } from 'vitest';
import { isModelError } from '@goondan/models';
import { createChatModel, isChatProvider, selectChatModel, DEFAULT_ANTHROPIC_CHAT_MODEL } from '../src/chat/model.js';

describe('selectChatModel', () => {
  it('아무 것도 없으면 Anthropic 기본 모델을 고른다', () => {
    expect(selectChatModel({}, {})).toEqual({ provider: 'anthropic', model: DEFAULT_ANTHROPIC_CHAT_MODEL });
  });

  it('플래그가 환경 변수보다 우선한다', () => {
    const env = { GOONDAN_CHAT_PROVIDER: 'anthropic', GOONDAN_CHAT_MODEL: 'from-env', OPENAI_API_KEY: 'key' };
    expect(selectChatModel({ provider: 'openai', model: 'from-flag', baseUrl: 'http://localhost:11434/v1' }, env))
      .toEqual({ provider: 'openai', model: 'from-flag', baseUrl: 'http://localhost:11434/v1' });
  });

  it('GOONDAN_CHAT_PROVIDER와 GOONDAN_CHAT_MODEL이 자격 증명보다 우선한다', () => {
    const env = { GOONDAN_CHAT_PROVIDER: 'openai', GOONDAN_CHAT_MODEL: 'gpt-x', ANTHROPIC_API_KEY: 'key' };
    expect(selectChatModel({}, env)).toEqual({ provider: 'openai', model: 'gpt-x' });
  });

  it('제공자를 지정하지 않으면 자격 증명으로 고른다', () => {
    expect(selectChatModel({}, { ANTHROPIC_AUTH_TOKEN: 'token' }).provider).toBe('anthropic');
    expect(selectChatModel({}, { ANTHROPIC_BASE_URL: 'http://gateway' }).provider).toBe('anthropic');
    expect(selectChatModel({ model: 'gpt-x' }, { OPENAI_API_KEY: 'key' }).provider).toBe('openai');
    expect(selectChatModel({ model: 'gpt-x' }, { OPENAI_BASE_URL: 'http://localhost:11434/v1' }).provider).toBe('openai');
    expect(selectChatModel({}, { ANTHROPIC_API_KEY: 'key', OPENAI_API_KEY: 'key' }).provider).toBe('anthropic');
  });

  it('빈 환경 변수는 없는 것으로 본다', () => {
    expect(selectChatModel({}, { OPENAI_API_KEY: '', GOONDAN_CHAT_MODEL: '' }))
      .toEqual({ provider: 'anthropic', model: DEFAULT_ANTHROPIC_CHAT_MODEL });
  });

  it('GOONDAN_CHAT_PROVIDER 값이 잘못되면 실패한다', () => {
    expect(() => selectChatModel({}, { GOONDAN_CHAT_PROVIDER: 'gemini' }))
      .toThrow('GOONDAN_CHAT_PROVIDER must be anthropic or openai: gemini');
  });

  it('OpenAI 호환 API는 모델을 반드시 지정해야 한다', () => {
    expect(() => selectChatModel({ provider: 'openai' }, {}))
      .toThrow('gdn chat --provider openai requires --model or GOONDAN_CHAT_MODEL');
  });
});

describe('isChatProvider', () => {
  it('지원하는 제공자만 통과시킨다', () => {
    expect(isChatProvider('anthropic')).toBe(true);
    expect(isChatProvider('openai')).toBe(true);
    expect(isChatProvider('gemini')).toBe(false);
  });
});

describe('createChatModel', () => {
  it('선택한 제공자의 공식 어댑터를 만든다', () => {
    const anthropic = createChatModel({ provider: 'anthropic', model: DEFAULT_ANTHROPIC_CHAT_MODEL }, { ANTHROPIC_API_KEY: 'key' });
    expect(typeof anthropic.generate).toBe('function');
    const openai = createChatModel({ provider: 'openai', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' }, {});
    expect(typeof openai.generate).toBe('function');
  });

  it('자격 증명이 없으면 안내를 덧붙여 실패한다', () => {
    let thrown: unknown;
    try {
      createChatModel({ provider: 'anthropic', model: DEFAULT_ANTHROPIC_CHAT_MODEL }, {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof Error ? thrown.message : '').toContain('or pass --bindings.');
    expect(thrown instanceof Error && isModelError(thrown.cause) ? thrown.cause.code : undefined).toBe('authentication');
  });
});
