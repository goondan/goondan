/**
 * Compaction Extension Types
 * @see /docs/specs/extension.md
 */

import type { ExtTurn, ExtLlmMessage } from '@goondan/core';

/**
 * JSON 타입 (JsonObject 호환용)
 */
type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

/**
 * Compaction strategy type
 */
export type CompactionStrategy = 'token' | 'turn' | 'sliding';

/**
 * Compaction configuration
 */
export interface CompactionConfig {
  /**
   * Compaction strategy to use
   * - token: Compact when estimated tokens exceed maxTokens
   * - turn: Compact when turn count exceeds maxTurns
   * - sliding: Keep only recent N messages, summarize the rest
   */
  strategy: CompactionStrategy;

  /**
   * Maximum tokens before compaction (for 'token' strategy)
   * @default 8000
   */
  maxTokens?: number;

  /**
   * Maximum turns before compaction (for 'turn' strategy)
   * @default 20
   */
  maxTurns?: number;

  /**
   * Sliding window size (for 'sliding' strategy)
   * Number of recent messages to keep
   * @default 10
   */
  windowSize?: number;

  /**
   * Number of recent messages to preserve (not compact)
   * @default 5
   */
  preserveRecent?: number;

  /**
   * Custom prompt for summarization
   */
  summaryPrompt?: string;

  /**
   * Enable logging
   * @default false
   */
  enableLogging?: boolean;

  /**
   * Index signature for Record<string, unknown> compatibility
   */
  [key: string]: unknown;
}

/**
 * Compaction state
 * Note: This is used internally, ExtensionApi's state is untyped JsonObject
 */
export interface CompactionState {
  /**
   * Number of compactions performed
   */
  compactionCount: number;

  /**
   * Total messages compacted
   */
  totalMessagesCompacted: number;

  /**
   * Last compaction timestamp (null if never compacted)
   */
  lastCompactionAt: number | null;

  /**
   * Compaction history (summaries)
   */
  summaries: CompactionSummaryRecord[];

  /**
   * Token estimation cache
   */
  estimatedTokens: number;

  /**
   * Index signature for JsonObject compatibility
   */
  [key: string]: JsonValue;
}

/**
 * Compaction summary record (JsonObject compatible)
 */
export interface CompactionSummaryRecord {
  timestamp: number;
  messageCount: number;
  summaryText: string;
  tokensSaved: number;
  [key: string]: JsonValue;
}

/**
 * Compaction summary entry (internal use)
 */
export interface CompactionSummary {
  /**
   * When the compaction occurred
   */
  timestamp: number;

  /**
   * Number of messages that were compacted
   */
  messageCount: number;

  /**
   * The summary text generated
   */
  summaryText: string;

  /**
   * Estimated tokens saved
   */
  tokensSaved: number;
}

/**
 * Convert CompactionSummary to CompactionSummaryRecord
 */
export function toSummaryRecord(summary: CompactionSummary): CompactionSummaryRecord {
  return {
    timestamp: summary.timestamp,
    messageCount: summary.messageCount,
    summaryText: summary.summaryText,
    tokensSaved: summary.tokensSaved,
  };
}

/**
 * Compaction result
 */
export interface CompactionResult {
  /**
   * Whether compaction was performed
   */
  compacted: boolean;

  /**
   * New messages array (after compaction)
   */
  messages: ExtLlmMessage[];

  /**
   * Summary of what was compacted (if any)
   */
  summary?: CompactionSummary;
}

/**
 * Strategy interface for compaction implementations
 */
export interface CompactionStrategyHandler {
  /**
   * Check if compaction is needed
   */
  shouldCompact(messages: ExtLlmMessage[], config: CompactionConfig): boolean;

  /**
   * Perform compaction on messages
   */
  compact(
    messages: ExtLlmMessage[],
    config: CompactionConfig,
    summarize: (text: string) => Promise<string>
  ): Promise<CompactionResult>;

  /**
   * Get strategy name
   */
  readonly name: CompactionStrategy;
}

/**
 * Turn with messages for compaction processing
 * Note: ExtTurn now uses messageState.nextMessages instead of messages
 */
export type TurnWithMessages = ExtTurn;

/**
 * Token estimation function type
 */
export type TokenEstimator = (text: string) => number;

/**
 * Summarization function type
 */
export type Summarizer = (text: string) => Promise<string>;
