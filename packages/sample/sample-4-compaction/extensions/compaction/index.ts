/**
 * Compaction Extension
 *
 * Implements LLM conversation compaction to manage context window limits.
 * Supports multiple compaction strategies: token-based, turn-based, and sliding window.
 *
 * @see /docs/specs/extension.md
 */

import type {
  ExtensionApi,
  ExtStepContext,
  ExtTurnContext,
  ExtContextBlock,
} from '@goondan/core';
import type { CompactionConfig, CompactionState } from './types.js';
import { toSummaryRecord } from './types.js';
import { getStrategy, isValidStrategy, getAvailableStrategies } from './strategies/index.js';
import { estimateTotalTokens } from './strategies/token.js';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<CompactionConfig> = {
  strategy: 'token',
  maxTokens: 8000,
  maxTurns: 20,
  windowSize: 10,
  preserveRecent: 5,
  summaryPrompt: 'Summarize the following conversation concisely, preserving key information and context:',
  enableLogging: false,
};

/**
 * Default summarization function (placeholder)
 * In production, this would call an LLM for actual summarization
 */
function createDefaultSummarizer(
  _prompt: string,
  logger?: Console
): (text: string) => Promise<string> {
  return async (text: string): Promise<string> => {
    // Simple extraction-based summarization (fallback when no LLM available)
    // In a real implementation, this would call the LLM
    logger?.debug?.('Generating summary for text of length:', text.length);

    // Extract key sentences (simple heuristic)
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);

    // Take first few and last few sentences as summary
    const important = [
      ...sentences.slice(0, 2),
      '...',
      ...sentences.slice(-2),
    ].join('. ');

    // Truncate if too long
    const summary = important.length > 500
      ? important.substring(0, 497) + '...'
      : important;

    logger?.debug?.('Generated summary of length:', summary.length);

    return summary || 'Previous conversation context.';
  };
}

/**
 * Type guard for CompactionState
 */
function isCompactionState(value: unknown): value is CompactionState {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'compactionCount' in value &&
    typeof value.compactionCount === 'number' &&
    'totalMessagesCompacted' in value &&
    typeof value.totalMessagesCompacted === 'number' &&
    'summaries' in value &&
    Array.isArray(value.summaries) &&
    'estimatedTokens' in value &&
    typeof value.estimatedTokens === 'number'
  );
}

/**
 * Extension register function
 * Entry point for the Compaction Extension
 */
export async function register(
  api: ExtensionApi
): Promise<void> {
  // Initialize state using getState/setState pattern
  const initialState: CompactionState = {
    compactionCount: 0,
    totalMessagesCompacted: 0,
    lastCompactionAt: null,
    summaries: [],
    estimatedTokens: 0,
  };
  api.setState(initialState);

  // Helper to get current state (always returns valid state since we initialized)
  function currentState(): CompactionState {
    const raw = api.getState();
    if (isCompactionState(raw)) return raw;
    return initialState;
  }

  // Get config with defaults
  const rawConfig = api.extension.spec?.config ?? {};
  const config: Required<CompactionConfig> = {
    ...DEFAULT_CONFIG,
    ...rawConfig,
  };

  // Validate strategy
  if (!isValidStrategy(config.strategy)) {
    const available = getAvailableStrategies().join(', ');
    throw new Error(
      `Invalid compaction strategy: ${config.strategy}. Available: ${available}`
    );
  }

  const strategy = getStrategy(config.strategy);
  const logger = config.enableLogging ? api.logger : undefined;

  logger?.info?.(`Compaction Extension initialized with strategy: ${config.strategy}`);

  // Create summarizer function
  const summarize = createDefaultSummarizer(config.summaryPrompt, logger);

  // Register turn.pre mutator to perform compaction before processing
  api.pipelines.mutate('turn.pre', async (ctx: ExtTurnContext) => {
    const messages = ctx.turn.messageState.nextMessages;
    const state = currentState();

    // Update token estimate
    state.estimatedTokens = estimateTotalTokens(messages);
    api.setState(state);

    // Check if compaction is needed
    if (!strategy.shouldCompact(messages, config)) {
      logger?.debug?.('No compaction needed');
      return ctx;
    }

    logger?.info?.(`Compaction triggered (${config.strategy} strategy)`);

    // Perform compaction
    const result = await strategy.compact(messages, config, summarize);

    if (result.compacted && result.summary) {
      // Update state
      state.compactionCount++;
      state.totalMessagesCompacted += result.summary.messageCount;
      state.lastCompactionAt = result.summary.timestamp;
      state.summaries.push(toSummaryRecord(result.summary));
      state.estimatedTokens = estimateTotalTokens(result.messages);
      api.setState(state);

      logger?.info?.(
        `Compacted ${result.summary.messageCount} messages, ` +
        `saved ~${result.summary.tokensSaved} tokens`
      );

      // Update turn messageState with compacted messages as new base
      ctx.turn.messageState = {
        baseMessages: result.messages,
        events: [],
        nextMessages: result.messages,
      };

      // Add compaction metadata to turn
      ctx.turn.metadata = {
        ...ctx.turn.metadata,
        compaction: {
          performed: true,
          strategy: config.strategy,
          messageCount: result.summary.messageCount,
          tokensSaved: result.summary.tokensSaved,
        },
      };
    }

    return ctx;
  });

  // Register step.blocks mutator to add compaction status block
  api.pipelines.mutate('step.blocks', async (ctx: ExtStepContext) => {
    const blocks: ExtContextBlock[] = [...ctx.blocks];

    // Add compaction status block if compaction has occurred
    const cState = currentState();
    if (cState.compactionCount > 0) {
      blocks.push({
        type: 'compaction.status',
        data: {
          strategy: config.strategy,
          compactionCount: cState.compactionCount,
          totalMessagesCompacted: cState.totalMessagesCompacted,
          lastCompactionAt: cState.lastCompactionAt ?? null,
          estimatedTokens: cState.estimatedTokens,
          maxTokens: config.maxTokens,
        },
        priority: 100, // Low priority, informational
      });
    }

    return { ...ctx, blocks };
  });

  // Register compaction tools
  api.tools.register({
    name: 'compaction.get-status',
    description: 'Get the current compaction status and statistics',
    handler: async () => {
      const s = currentState();
      return {
        strategy: config.strategy,
        compactionCount: s.compactionCount,
        totalMessagesCompacted: s.totalMessagesCompacted,
        lastCompactionAt: s.lastCompactionAt ?? null,
        estimatedTokens: s.estimatedTokens,
        maxTokens: config.maxTokens,
        summaryCount: s.summaries.length,
      };
    },
    metadata: {
      source: 'compaction-extension',
      version: '1.0.0',
    },
  });

  api.tools.register({
    name: 'compaction.get-summaries',
    description: 'Get the list of generated summaries from previous compactions',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of summaries to return (default: 10)',
        },
      },
    },
    handler: async (_ctx, input) => {
      const limit = Number(input.limit) || 10;
      const s = currentState();
      const summaries = s.summaries.slice(-limit);
      return {
        total: s.summaries.length,
        returned: summaries.length,
        summaries: summaries.map((s) => ({
          timestamp: s.timestamp,
          messageCount: s.messageCount,
          tokensSaved: s.tokensSaved,
          summaryPreview: s.summaryText.substring(0, 100) + '...',
        })),
      };
    },
    metadata: {
      source: 'compaction-extension',
      version: '1.0.0',
    },
  });

  api.tools.register({
    name: 'compaction.force-compact',
    description: 'Force a compaction operation on the current conversation',
    handler: async (ctx) => {
      const messages = ctx.turn.messageState.nextMessages;

      const result = await strategy.compact(messages, config, summarize);

      if (result.compacted && result.summary) {
        const s = currentState();
        s.compactionCount++;
        s.totalMessagesCompacted += result.summary.messageCount;
        s.lastCompactionAt = result.summary.timestamp;
        s.summaries.push(toSummaryRecord(result.summary));
        api.setState(s);

        // Note: This doesn't actually modify the turn messages in real-time
        // It just performs the compaction and reports results
        return {
          success: true,
          compacted: true,
          messageCount: result.summary.messageCount,
          tokensSaved: result.summary.tokensSaved,
          note: 'Compaction will be applied on next turn processing',
          reason: null,
        };
      }

      return {
        success: true,
        compacted: false,
        reason: 'No messages needed compaction',
        messageCount: null,
        tokensSaved: null,
        note: null,
      };
    },
    metadata: {
      source: 'compaction-extension',
      version: '1.0.0',
    },
  });

  // Emit initialization event
  api.events.emit('extension.initialized', {
    name: api.extension.metadata?.name ?? 'compaction',
    strategy: config.strategy,
    config: {
      maxTokens: config.maxTokens,
      maxTurns: config.maxTurns,
      windowSize: config.windowSize,
      preserveRecent: config.preserveRecent,
    },
  });

  logger?.info?.('Compaction Extension registration complete');
}

// Re-export types and strategies for external use
export type { CompactionConfig, CompactionState, CompactionStrategy } from './types.js';
export { getStrategy, isValidStrategy, getAvailableStrategies } from './strategies/index.js';
