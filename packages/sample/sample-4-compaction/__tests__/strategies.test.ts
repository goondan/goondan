/**
 * Compaction Strategies Tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExtLlmMessage } from '@goondan/core';
import { tokenStrategy } from '../extensions/compaction/strategies/token.js';
import { turnStrategy } from '../extensions/compaction/strategies/turn.js';
import { slidingStrategy } from '../extensions/compaction/strategies/sliding.js';
import {
  getStrategy,
  isValidStrategy,
  getAvailableStrategies,
  estimateTokens,
  estimateTotalTokens,
  countTurns,
  groupMessagesByTurn,
} from '../extensions/compaction/strategies/index.js';
import type { CompactionConfig } from '../extensions/compaction/types.js';

// Mock summarizer
const mockSummarize = vi.fn().mockResolvedValue('This is a summary of the conversation.');

// Helper to create test messages
function createMessages(count: number): ExtLlmMessage[] {
  const messages: ExtLlmMessage[] = [];

  messages.push({
    role: 'system',
    content: 'You are a helpful assistant.',
  });

  for (let i = 0; i < count; i++) {
    messages.push({
      role: 'user',
      content: `User message ${i + 1}: ${'x'.repeat(100)}`,
    });
    messages.push({
      role: 'assistant',
      content: `Assistant response ${i + 1}: ${'y'.repeat(100)}`,
    });
  }

  return messages;
}

describe('Strategy Registry', () => {
  it('should return correct strategy by name', () => {
    expect(getStrategy('token')).toBe(tokenStrategy);
    expect(getStrategy('turn')).toBe(turnStrategy);
    expect(getStrategy('sliding')).toBe(slidingStrategy);
  });

  it('should throw for unknown strategy', () => {
    expect(() => getStrategy('unknown' as never)).toThrow('Unknown compaction strategy');
  });

  it('should validate strategy names', () => {
    expect(isValidStrategy('token')).toBe(true);
    expect(isValidStrategy('turn')).toBe(true);
    expect(isValidStrategy('sliding')).toBe(true);
    expect(isValidStrategy('unknown')).toBe(false);
  });

  it('should list available strategies', () => {
    const strategies = getAvailableStrategies();
    expect(strategies).toContain('token');
    expect(strategies).toContain('turn');
    expect(strategies).toContain('sliding');
    expect(strategies.length).toBe(3);
  });
});

describe('Token Estimation', () => {
  it('should estimate tokens for user message', () => {
    const message: ExtLlmMessage = {
      role: 'user',
      content: 'Hello, how are you?', // 20 characters ~= 5 tokens
    };
    const tokens = estimateTokens(message);
    expect(tokens).toBe(5);
  });

  it('should estimate tokens for assistant message with tool calls', () => {
    const message: ExtLlmMessage = {
      role: 'assistant',
      content: 'Let me help you.',
      toolCalls: [
        { id: '1', name: 'search', input: { query: 'test' } },
      ],
    };
    const tokens = estimateTokens(message);
    expect(tokens).toBeGreaterThan(4); // Base content + tool calls
  });

  it('should estimate total tokens for message array', () => {
    const messages = createMessages(5);
    const total = estimateTotalTokens(messages);
    expect(total).toBeGreaterThan(0);
  });
});

describe('Token Strategy', () => {
  it('should not compact when under token limit', () => {
    const messages = createMessages(2);
    const config: CompactionConfig = { strategy: 'token', maxTokens: 10000 };
    expect(tokenStrategy.shouldCompact(messages, config)).toBe(false);
  });

  it('should compact when over token limit', () => {
    const messages = createMessages(20);
    const config: CompactionConfig = { strategy: 'token', maxTokens: 500 };
    expect(tokenStrategy.shouldCompact(messages, config)).toBe(true);
  });

  it('should perform compaction correctly', async () => {
    const messages = createMessages(10);
    const config: CompactionConfig = {
      strategy: 'token',
      maxTokens: 500,
      preserveRecent: 3,
    };

    const result = await tokenStrategy.compact(messages, config, mockSummarize);

    expect(result.compacted).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary!.messageCount).toBeGreaterThan(0);
    // Should have: system + summary + 3 recent turns (6 messages)
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it('should preserve system messages', async () => {
    const messages = createMessages(10);
    const config: CompactionConfig = {
      strategy: 'token',
      maxTokens: 500,
      preserveRecent: 2,
    };

    const result = await tokenStrategy.compact(messages, config, mockSummarize);

    const systemMessages = result.messages.filter((m) => m.role === 'system');
    expect(systemMessages.length).toBe(1);
  });
});

describe('Turn Strategy', () => {
  it('should count turns correctly', () => {
    const messages = createMessages(5);
    const turnCount = countTurns(messages);
    expect(turnCount).toBe(5);
  });

  it('should group messages by turn', () => {
    const messages = createMessages(3);
    const { system, turns } = groupMessagesByTurn(messages);

    expect(system.length).toBe(1);
    expect(turns.length).toBe(3);
    expect(turns[0].length).toBe(2); // user + assistant
  });

  it('should not compact when under turn limit', () => {
    const messages = createMessages(5);
    const config: CompactionConfig = { strategy: 'turn', maxTurns: 20 };
    expect(turnStrategy.shouldCompact(messages, config)).toBe(false);
  });

  it('should compact when over turn limit', () => {
    const messages = createMessages(25);
    const config: CompactionConfig = { strategy: 'turn', maxTurns: 20 };
    expect(turnStrategy.shouldCompact(messages, config)).toBe(true);
  });

  it('should perform turn-based compaction', async () => {
    const messages = createMessages(15);
    const config: CompactionConfig = {
      strategy: 'turn',
      maxTurns: 10,
      preserveRecent: 5,
    };

    const result = await turnStrategy.compact(messages, config, mockSummarize);

    expect(result.compacted).toBe(true);
    expect(result.summary).toBeDefined();

    // Count remaining turns
    const remainingTurns = countTurns(result.messages);
    expect(remainingTurns).toBeLessThanOrEqual(6); // 5 preserved + 1 summary
  });
});

describe('Sliding Window Strategy', () => {
  it('should not compact when within window size', () => {
    const messages = createMessages(3);
    const config: CompactionConfig = { strategy: 'sliding', windowSize: 10 };
    expect(slidingStrategy.shouldCompact(messages, config)).toBe(false);
  });

  it('should compact when exceeding window size', () => {
    const messages = createMessages(10);
    const config: CompactionConfig = { strategy: 'sliding', windowSize: 5 };
    expect(slidingStrategy.shouldCompact(messages, config)).toBe(true);
  });

  it('should maintain window size after compaction', async () => {
    const messages = createMessages(10);
    const config: CompactionConfig = {
      strategy: 'sliding',
      windowSize: 6,
    };

    const result = await slidingStrategy.compact(messages, config, mockSummarize);

    expect(result.compacted).toBe(true);
    // Should have: system + summary + window (6 non-system messages)
    const nonSystemMessages = result.messages.filter((m) => m.role !== 'system');
    // Summary message + 6 window messages = 7
    expect(nonSystemMessages.length).toBe(7);
  });
});

describe('Compaction Results', () => {
  it('should track tokens saved', async () => {
    const messages = createMessages(15);
    const config: CompactionConfig = {
      strategy: 'token',
      maxTokens: 500,
      preserveRecent: 3,
    };

    const result = await tokenStrategy.compact(messages, config, mockSummarize);

    expect(result.summary).toBeDefined();
    expect(result.summary!.tokensSaved).toBeGreaterThan(0);
  });

  it('should include timestamp in summary', async () => {
    const messages = createMessages(10);
    const config: CompactionConfig = {
      strategy: 'token',
      maxTokens: 500,
      preserveRecent: 2,
    };

    const beforeTime = Date.now();
    const result = await tokenStrategy.compact(messages, config, mockSummarize);
    const afterTime = Date.now();

    expect(result.summary).toBeDefined();
    expect(result.summary!.timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(result.summary!.timestamp).toBeLessThanOrEqual(afterTime);
  });
});
