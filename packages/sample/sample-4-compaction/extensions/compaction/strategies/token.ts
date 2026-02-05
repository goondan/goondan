/**
 * Token-based Compaction Strategy
 *
 * Compacts conversation when estimated tokens exceed maxTokens threshold.
 * Preserves recent messages and summarizes older ones.
 */

import type { ExtLlmMessage, ExtSystemMessage, ExtUserMessage } from '@goondan/core';
import type {
  CompactionConfig,
  CompactionResult,
  CompactionStrategyHandler,
  CompactionSummary,
} from '../types.js';

/**
 * Estimate token count for a message
 * Simple heuristic: ~4 characters per token (varies by model)
 */
function estimateTokens(message: ExtLlmMessage): number {
  let content = '';

  if (message.role === 'system' || message.role === 'user') {
    content = message.content;
  } else if (message.role === 'assistant') {
    content = message.content ?? '';
    // Add tokens for tool calls
    if (message.toolCalls && message.toolCalls.length > 0) {
      content += JSON.stringify(message.toolCalls);
    }
  } else if (message.role === 'tool') {
    content = String(message.output);
  }

  // Rough estimate: 4 characters per token
  return Math.ceil(content.length / 4);
}

/**
 * Estimate total tokens for all messages
 */
function estimateTotalTokens(messages: ExtLlmMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);
}

/**
 * Extract text content from messages for summarization
 */
function extractTextForSummary(messages: ExtLlmMessage[]): string {
  return messages
    .map((msg) => {
      if (msg.role === 'system') {
        return `[System]: ${msg.content}`;
      } else if (msg.role === 'user') {
        return `[User]: ${msg.content}`;
      } else if (msg.role === 'assistant') {
        let text = `[Assistant]: ${msg.content ?? ''}`;
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          text += ` [Called tools: ${msg.toolCalls.map((tc) => tc.name).join(', ')}]`;
        }
        return text;
      } else if (msg.role === 'tool') {
        return `[Tool ${msg.toolName}]: ${JSON.stringify(msg.output).substring(0, 200)}...`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Token-based compaction strategy implementation
 */
export const tokenStrategy: CompactionStrategyHandler = {
  name: 'token',

  shouldCompact(messages: ExtLlmMessage[], config: CompactionConfig): boolean {
    const maxTokens = config.maxTokens ?? 8000;
    const totalTokens = estimateTotalTokens(messages);
    return totalTokens > maxTokens;
  },

  async compact(
    messages: ExtLlmMessage[],
    config: CompactionConfig,
    summarize: (text: string) => Promise<string>
  ): Promise<CompactionResult> {
    const maxTokens = config.maxTokens ?? 8000;
    const preserveRecent = config.preserveRecent ?? 5;
    const totalTokens = estimateTotalTokens(messages);

    // Check if compaction is needed
    if (totalTokens <= maxTokens) {
      return {
        compacted: false,
        messages,
      };
    }

    // Separate system messages (always preserve)
    const systemMessages = messages.filter((m): m is ExtSystemMessage => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // Preserve recent messages
    const recentMessages = nonSystemMessages.slice(-preserveRecent);
    const oldMessages = nonSystemMessages.slice(0, -preserveRecent);

    // If no old messages to compact, return as is
    if (oldMessages.length === 0) {
      return {
        compacted: false,
        messages,
      };
    }

    // Calculate tokens before compaction
    const oldTokens = estimateTotalTokens(oldMessages);

    // Generate summary of old messages
    const textToSummarize = extractTextForSummary(oldMessages);
    const summaryText = await summarize(textToSummarize);

    // Create summary message
    const summaryMessage: ExtUserMessage = {
      role: 'user',
      content: `[Previous conversation summary]: ${summaryText}`,
    };

    // Calculate tokens after compaction
    const summaryTokens = estimateTokens(summaryMessage);
    const tokensSaved = oldTokens - summaryTokens;

    // Build new messages array
    const newMessages: ExtLlmMessage[] = [
      ...systemMessages,
      summaryMessage,
      ...recentMessages,
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

export { estimateTokens, estimateTotalTokens, extractTextForSummary };
