import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: vi.fn(async () => ({
      toolCalls: [],
      response: {
        messages: [],
      },
      text: '',
      finishReason: 'stop',
      rawFinishReason: undefined,
    })),
  };
});

import { requestModelMessage } from '../src/runner/runtime-runner.js';

function createRequestInput() {
  return {
    provider: 'openai',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 128,
    toolCatalog: [],
    turns: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
  };
}

describe('requestModelMessage system prompt handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never passes direct system field to generateText', async () => {
    await requestModelMessage({
      ...createRequestInput(),
    });

    const generateTextMock = vi.mocked(generateText);
    const firstCallInput = generateTextMock.mock.calls[0]?.[0];
    expect(firstCallInput).toBeDefined();
    if (!firstCallInput || typeof firstCallInput !== 'object') {
      throw new Error('generateText input must be an object');
    }

    expect(Object.prototype.hasOwnProperty.call(firstCallInput, 'system')).toBe(false);
  });
});
