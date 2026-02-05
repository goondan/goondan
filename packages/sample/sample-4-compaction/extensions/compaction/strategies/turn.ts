/**
 * Turn-based Compaction Strategy
 *
 * Compacts conversation when the number of turn pairs exceeds maxTurns.
 * A turn pair is typically a user message followed by an assistant response.
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
 * Count the number of user messages (representing turns)
 */
function countTurns(messages: ExtLlmMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}

/**
 * Group messages by turn (user -> assistant + tools)
 */
function groupMessagesByTurn(
  messages: ExtLlmMessage[]
): { system: ExtLlmMessage[]; turns: ExtLlmMessage[][] } {
  const system: ExtLlmMessage[] = [];
  const turns: ExtLlmMessage[][] = [];
  let currentTurn: ExtLlmMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system.push(msg);
    } else if (msg.role === 'user') {
      // Start a new turn
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [msg];
    } else {
      // Assistant or tool messages belong to current turn
      currentTurn.push(msg);
    }
  }

  // Don't forget the last turn
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  return { system, turns };
}

/**
 * Turn-based compaction strategy implementation
 */
export const turnStrategy: CompactionStrategyHandler = {
  name: 'turn',

  shouldCompact(messages: ExtLlmMessage[], config: CompactionConfig): boolean {
    const maxTurns = config.maxTurns ?? 20;
    const turnCount = countTurns(messages);
    return turnCount > maxTurns;
  },

  async compact(
    messages: ExtLlmMessage[],
    config: CompactionConfig,
    summarize: (text: string) => Promise<string>
  ): Promise<CompactionResult> {
    const maxTurns = config.maxTurns ?? 20;
    const preserveRecent = config.preserveRecent ?? 5;
    const turnCount = countTurns(messages);

    // Check if compaction is needed
    if (turnCount <= maxTurns) {
      return {
        compacted: false,
        messages,
      };
    }

    // Group messages by turn
    const { system, turns } = groupMessagesByTurn(messages);

    // Calculate how many turns to compact
    const turnsToKeep = Math.min(preserveRecent, turns.length);
    const turnsToCompact = turns.length - turnsToKeep;

    if (turnsToCompact <= 0) {
      return {
        compacted: false,
        messages,
      };
    }

    // Separate turns to compact and turns to keep
    const oldTurns = turns.slice(0, turnsToCompact);
    const recentTurns = turns.slice(turnsToCompact);

    // Flatten old turns for summarization
    const oldMessages = oldTurns.flat();

    // Calculate tokens before compaction
    const oldTokens = oldMessages.reduce((sum, msg) => sum + estimateTokens(msg), 0);

    // Generate summary
    const textToSummarize = extractTextForSummary(oldMessages);
    const summaryText = await summarize(textToSummarize);

    // Create summary message
    const summaryMessage: ExtUserMessage = {
      role: 'user',
      content: `[Conversation history - ${turnsToCompact} turns summarized]: ${summaryText}`,
    };

    // Calculate tokens saved
    const summaryTokens = estimateTokens(summaryMessage);
    const tokensSaved = oldTokens - summaryTokens;

    // Build new messages array
    const newMessages: ExtLlmMessage[] = [
      ...system,
      summaryMessage,
      ...recentTurns.flat(),
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

export { countTurns, groupMessagesByTurn };
