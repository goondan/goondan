/**
 * Sliding Window Compaction Strategy
 *
 * Maintains a fixed-size window of recent messages.
 * All messages outside the window are summarized into a single context message.
 */

import type { ExtLlmMessage, ExtSystemMessage, ExtUserMessage } from '@goondan/core';
import type {
  CompactionConfig,
  CompactionResult,
  CompactionStrategyHandler,
  CompactionSummary,
} from '../types.js';
import { estimateTokens, extractTextForSummary } from './token.js';

/**
 * Sliding window compaction strategy implementation
 */
export const slidingStrategy: CompactionStrategyHandler = {
  name: 'sliding',

  shouldCompact(messages: ExtLlmMessage[], config: CompactionConfig): boolean {
    const windowSize = config.windowSize ?? 10;
    // Count non-system messages
    const nonSystemCount = messages.filter((m) => m.role !== 'system').length;
    return nonSystemCount > windowSize;
  },

  async compact(
    messages: ExtLlmMessage[],
    config: CompactionConfig,
    summarize: (text: string) => Promise<string>
  ): Promise<CompactionResult> {
    const windowSize = config.windowSize ?? 10;

    // Separate system messages
    const systemMessages = messages.filter((m): m is ExtSystemMessage => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // Check if compaction is needed
    if (nonSystemMessages.length <= windowSize) {
      return {
        compacted: false,
        messages,
      };
    }

    // Split into messages to keep (window) and messages to compact
    const windowMessages = nonSystemMessages.slice(-windowSize);
    const oldMessages = nonSystemMessages.slice(0, -windowSize);

    // Calculate tokens before compaction
    const oldTokens = oldMessages.reduce((sum, msg) => sum + estimateTokens(msg), 0);

    // Generate summary of old messages
    const textToSummarize = extractTextForSummary(oldMessages);
    const summaryText = await summarize(textToSummarize);

    // Create sliding window context message
    const summaryMessage: ExtUserMessage = {
      role: 'user',
      content: `[Context from previous ${oldMessages.length} messages]: ${summaryText}`,
    };

    // Calculate tokens saved
    const summaryTokens = estimateTokens(summaryMessage);
    const tokensSaved = oldTokens - summaryTokens;

    // Build new messages array
    const newMessages: ExtLlmMessage[] = [
      ...systemMessages,
      summaryMessage,
      ...windowMessages,
    ];

    const summary: CompactionSummary = {
      timestamp: Date.now(),
      messageCount: oldMessages.length,
      summaryText,
      tokensSaved,
    };

    return {
      compacted: true,
      messages: newMessages,
      summary,
    };
  },
};
