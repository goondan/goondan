/**
 * Basic Compaction Extension
 *
 * A simple LLM conversation compaction extension that compresses messages
 * when the total character/token count exceeds configured limits.
 *
 * Token estimation: characters / 4 (simple approximation)
 *
 * @see /docs/specs/extension.md
 */

import type {
  ExtensionApi,
  ExtStepContext,
  ExtLlmMessage,
  ExtLlmResult,
  ExtToolCall,
} from '@goondan/core';

/**
 * Configuration for basicCompaction Extension
 */
interface CompactionConfig {
  /**
   * Maximum tokens before compaction
   * @default 8000
   */
  maxTokens?: number;

  /**
   * Maximum characters before compaction
   * @default 32000
   */
  maxChars?: number;

  /**
   * Custom compaction prompt
   * If empty, uses default prompt
   */
  compactionPrompt?: string;
}

/**
 * Internal state for the extension
 */
interface CompactionState {
  /**
   * Number of compactions performed
   */
  compactionCount: number;

  /**
   * Total messages compacted
   */
  totalMessagesCompacted: number;

  /**
   * Last compaction timestamp
   */
  lastCompactionAt: number | null;

  /**
   * Current estimated token count
   */
  estimatedTokens: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<CompactionConfig, 'compactionPrompt'>> & { compactionPrompt: string } = {
  maxTokens: 8000,
  maxChars: 32000,
  compactionPrompt: '다음 대화를 핵심 정보만 유지하며 압축해주세요.',
};

/**
 * Estimate tokens from text using simple character / 4 approximation
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get total character count from messages
 */
function getTotalChars(messages: ExtLlmMessage[]): number {
  return messages.reduce((total, msg) => {
    if ('content' in msg && typeof msg.content === 'string') {
      return total + msg.content.length;
    }
    return total;
  }, 0);
}

/**
 * Convert messages to text for compaction
 */
function messagesToText(messages: ExtLlmMessage[]): string {
  return messages.map((msg) => {
    const role = msg.role;
    if ('content' in msg && typeof msg.content === 'string') {
      return `[${role}]: ${msg.content}`;
    }
    if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
      return `[${role}]: (tool calls: ${msg.toolCalls.map((tc: ExtToolCall) => tc.name).join(', ')})`;
    }
    if (msg.role === 'tool' && 'output' in msg) {
      return `[tool:${msg.toolName}]: ${JSON.stringify(msg.output)}`;
    }
    return `[${role}]: (empty)`;
  }).join('\n');
}

/**
 * Check if compaction is needed based on config
 */
function shouldCompact(
  messages: ExtLlmMessage[],
  config: Required<CompactionConfig>
): boolean {
  const totalChars = getTotalChars(messages);
  // totalChars / 4 를 통한 토큰 추정 (문자 기반)
  const tokens = estimateTokens(
    messages.map(m => ('content' in m && typeof m.content === 'string') ? m.content : '').join('')
  );

  return totalChars > config.maxChars || tokens > config.maxTokens;
}

/**
 * Type guard to check if a value is a number
 */
function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

/**
 * Type guard to check if a value is a string
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard to check if a value is a number or null
 */
function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

/**
 * Get compaction state from raw state object with type safety
 */
function getCompactionState(rawState: Record<string, unknown>): CompactionState {
  return {
    compactionCount: isNumber(rawState['compactionCount']) ? rawState['compactionCount'] : 0,
    totalMessagesCompacted: isNumber(rawState['totalMessagesCompacted']) ? rawState['totalMessagesCompacted'] : 0,
    lastCompactionAt: isNumberOrNull(rawState['lastCompactionAt']) ? rawState['lastCompactionAt'] : null,
    estimatedTokens: isNumber(rawState['estimatedTokens']) ? rawState['estimatedTokens'] : 0,
  };
}

/**
 * Type guard to check if a value is a record-like object
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate CompactionConfig from unknown input
 */
function parseCompactionConfig(input: unknown): CompactionConfig {
  if (!isRecordLike(input)) {
    return {};
  }
  const result: CompactionConfig = {};

  if (isNumber(input['maxTokens'])) {
    result.maxTokens = input['maxTokens'];
  }
  if (isNumber(input['maxChars'])) {
    result.maxChars = input['maxChars'];
  }
  if (isString(input['compactionPrompt'])) {
    result.compactionPrompt = input['compactionPrompt'];
  }

  return result;
}

/**
 * Extension register function
 * Entry point for the basicCompaction Extension
 */
export async function register(api: ExtensionApi): Promise<void> {
  // Initialize state
  const rawState = api.extState();
  rawState['compactionCount'] = 0;
  rawState['totalMessagesCompacted'] = 0;
  rawState['lastCompactionAt'] = null;
  rawState['estimatedTokens'] = 0;

  // State accessor function that reads current state with type safety
  const getState = (): CompactionState => getCompactionState(rawState);
  // State updater functions
  const updateState = (updates: Partial<CompactionState>): void => {
    if (updates.compactionCount !== undefined) rawState['compactionCount'] = updates.compactionCount;
    if (updates.totalMessagesCompacted !== undefined) rawState['totalMessagesCompacted'] = updates.totalMessagesCompacted;
    if (updates.lastCompactionAt !== undefined) rawState['lastCompactionAt'] = updates.lastCompactionAt;
    if (updates.estimatedTokens !== undefined) rawState['estimatedTokens'] = updates.estimatedTokens;
  };

  // Get config with defaults (using type-safe parser)
  const rawConfig = parseCompactionConfig(api.extension.spec?.config);
  const config: Required<CompactionConfig> = {
    maxTokens: rawConfig.maxTokens ?? DEFAULT_CONFIG.maxTokens,
    maxChars: rawConfig.maxChars ?? DEFAULT_CONFIG.maxChars,
    compactionPrompt: rawConfig.compactionPrompt || DEFAULT_CONFIG.compactionPrompt,
  };

  const logger = api.logger;
  logger?.debug?.(`basicCompaction Extension initialized with maxTokens: ${config.maxTokens}, maxChars: ${config.maxChars}`);

  // Register step.llmCall middleware to wrap LLM calls
  // Check tokens before LLM call and perform compaction if needed
  api.pipelines.wrap('step.llmCall', async (ctx: ExtStepContext, next: (ctx: ExtStepContext) => Promise<ExtLlmResult>) => {
    const messages = ctx.turn.messages;

    // Update token estimate
    const totalChars = getTotalChars(messages);
    const currentEstimatedTokens = estimateTokens(
      messages.map(m => ('content' in m && typeof m.content === 'string') ? m.content : '').join('')
    );
    updateState({ estimatedTokens: currentEstimatedTokens });

    // Check if compaction is needed
    if (!shouldCompact(messages, config)) {
      logger?.debug?.('basicCompaction: No compaction needed');
      return next(ctx);
    }

    logger?.info?.(`basicCompaction: Compaction triggered (chars: ${totalChars}, tokens: ~${currentEstimatedTokens})`);

    // Find system message (to preserve)
    const systemMessage = messages.find((m: ExtLlmMessage) => m.role === 'system');
    const nonSystemMessages = messages.filter((m: ExtLlmMessage) => m.role !== 'system');

    // Preserve recent messages (last 2 user/assistant pairs = ~4 messages)
    const preserveCount = Math.min(4, nonSystemMessages.length);
    const messagesToCompact = nonSystemMessages.slice(0, -preserveCount);
    const preservedMessages = nonSystemMessages.slice(-preserveCount);

    if (messagesToCompact.length === 0) {
      logger?.debug?.('basicCompaction: No messages to compact');
      return next(ctx);
    }

    // Convert messages to compact into text
    const textToCompact = messagesToText(messagesToCompact);
    const compactionPromptText = `${config.compactionPrompt}\n\n${textToCompact}`;

    // Create a temporary compaction request
    // We'll use the LLM to summarize the conversation
    const compactionMessages: ExtLlmMessage[] = [
      {
        role: 'system',
        content: 'You are a helpful assistant that summarizes conversations concisely.',
      },
      {
        role: 'user',
        content: compactionPromptText,
      },
    ];

    // Create a temporary context for compaction
    const compactionCtx: ExtStepContext = {
      ...ctx,
      turn: {
        ...ctx.turn,
        messages: compactionMessages,
      },
      blocks: [],
      toolCatalog: [], // No tools during compaction
    };

    // Call LLM to get summary
    let summary: string;
    try {
      const compactionResult = await next(compactionCtx);
      summary = compactionResult.message.content ?? 'Previous conversation context.';
    } catch (error) {
      logger?.warn?.('basicCompaction: Failed to generate summary, using fallback');
      // Fallback: simple truncation
      summary = textToCompact.length > 500
        ? textToCompact.substring(0, 497) + '...'
        : textToCompact;
    }

    // Update state
    const currentState = getState();
    const lastCompactionTimestamp = Date.now();
    updateState({
      compactionCount: currentState.compactionCount + 1,
      totalMessagesCompacted: currentState.totalMessagesCompacted + messagesToCompact.length,
      lastCompactionAt: lastCompactionTimestamp,
    });

    // Create new messages array with summary
    const summaryMessage: ExtLlmMessage = {
      role: 'user',
      content: `[Previous conversation summary]:\n${summary}`,
    };

    const newMessages: ExtLlmMessage[] = [];
    if (systemMessage) {
      newMessages.push(systemMessage);
    }
    newMessages.push(summaryMessage);
    newMessages.push(...preservedMessages);

    // Update token estimate
    const newTotalChars = getTotalChars(newMessages);
    const newEstimatedTokens = estimateTokens(
      newMessages.map(m => ('content' in m && typeof m.content === 'string') ? m.content : '').join('')
    );
    updateState({ estimatedTokens: newEstimatedTokens });

    logger?.info?.(
      `basicCompaction: Compacted ${messagesToCompact.length} messages, ` +
      `${totalChars - newTotalChars} chars saved`
    );

    // Update context with compacted messages
    ctx.turn.messages = newMessages;
    ctx.turn.metadata = {
      ...ctx.turn.metadata,
      compaction: {
        performed: true,
        messageCount: messagesToCompact.length,
        charsSaved: totalChars - newTotalChars,
        timestamp: lastCompactionTimestamp,
      },
    };

    // Now call the actual LLM with compacted messages
    return next(ctx);
  });

  // Register step.blocks mutator to add compaction status block
  api.pipelines.mutate('step.blocks', async (ctx: ExtStepContext) => {
    const currentState = getState();
    if (currentState.compactionCount > 0) {
      ctx.blocks.push({
        type: 'compaction.status',
        data: {
          compactionCount: currentState.compactionCount,
          totalMessagesCompacted: currentState.totalMessagesCompacted,
          lastCompactionAt: currentState.lastCompactionAt,
          estimatedTokens: currentState.estimatedTokens,
          maxTokens: config.maxTokens,
          maxChars: config.maxChars,
        },
        priority: 100, // Low priority, informational
      });
    }

    return ctx;
  });

  // Emit initialization event
  api.events.emit('extension.initialized', {
    name: api.extension.metadata?.name ?? 'basicCompaction',
    config: {
      maxTokens: config.maxTokens,
      maxChars: config.maxChars,
    },
  });

  logger?.info?.('basicCompaction Extension registration complete');
}

// Export config type for external use
export type { CompactionConfig };
