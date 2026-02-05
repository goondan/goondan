/**
 * Compaction Strategies Index
 *
 * Exports all compaction strategy implementations
 */

import type { CompactionStrategy, CompactionStrategyHandler } from '../types.js';
import { tokenStrategy } from './token.js';
import { turnStrategy } from './turn.js';
import { slidingStrategy } from './sliding.js';

/**
 * Strategy registry
 */
const strategies: Record<CompactionStrategy, CompactionStrategyHandler> = {
  token: tokenStrategy,
  turn: turnStrategy,
  sliding: slidingStrategy,
};

/**
 * Get a compaction strategy by name
 */
export function getStrategy(name: CompactionStrategy): CompactionStrategyHandler {
  const strategy = strategies[name];
  if (!strategy) {
    throw new Error(`Unknown compaction strategy: ${name}`);
  }
  return strategy;
}

/**
 * Check if a strategy name is valid
 */
export function isValidStrategy(name: string): name is CompactionStrategy {
  return name in strategies;
}

/**
 * Get all available strategy names
 */
export function getAvailableStrategies(): CompactionStrategy[] {
  return Object.keys(strategies) as CompactionStrategy[];
}

// Re-export individual strategies
export { tokenStrategy } from './token.js';
export { turnStrategy } from './turn.js';
export { slidingStrategy } from './sliding.js';

// Re-export utility functions
export { estimateTokens, estimateTotalTokens, extractTextForSummary } from './token.js';
export { countTurns, groupMessagesByTurn } from './turn.js';
