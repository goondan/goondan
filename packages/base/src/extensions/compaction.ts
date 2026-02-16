import type {
  ExtensionApi,
  Message,
  MessageEvent,
  TurnMiddlewareContext,
} from '../types.js';
import { createId, estimateMessageLength } from '../utils.js';

export interface CompactionExtensionConfig {
  maxMessages?: number;
  maxCharacters?: number;
  retainLastMessages?: number;
  mode?: 'remove' | 'truncate';
  appendSummary?: boolean;
  summaryPrefix?: string;
}

interface CompactionResult {
  mode: 'remove' | 'truncate';
  removedCount: number;
  removedCharacters: number;
}

const DEFAULT_CONFIG: Required<CompactionExtensionConfig> = {
  maxMessages: 40,
  maxCharacters: 12_000,
  retainLastMessages: 8,
  mode: 'remove',
  appendSummary: true,
  summaryPrefix: '[message-compaction]',
};

function isPinned(message: Message): boolean {
  return message.metadata.pinned === true;
}

function createSummaryMessage(config: Required<CompactionExtensionConfig>, result: CompactionResult): Message {
  const summaryText = `${config.summaryPrefix} mode=${result.mode} removed=${result.removedCount} chars=${result.removedCharacters}`;
  return {
    id: createId('msg'),
    data: {
      role: 'system',
      content: summaryText,
    },
    metadata: {
      'compaction.summary': true,
      'compaction.mode': result.mode,
      'compaction.removedCount': result.removedCount,
      'compaction.removedCharacters': result.removedCharacters,
    },
    createdAt: new Date(),
    source: {
      type: 'extension',
      extensionName: 'message-compaction',
    },
  };
}

function emitEvents(ctx: TurnMiddlewareContext, events: MessageEvent[]): void {
  for (const event of events) {
    ctx.emitMessageEvent(event);
  }
}

function compactByRemoval(
  messages: Message[],
  config: Required<CompactionExtensionConfig>
): { events: MessageEvent[]; result: CompactionResult; overflow: boolean } {
  const events: MessageEvent[] = [];
  const protectedIds = new Set<string>();
  const keepFrom = Math.max(0, messages.length - config.retainLastMessages);

  for (let index = keepFrom; index < messages.length; index += 1) {
    const protectedMessage = messages[index];
    if (!protectedMessage) {
      continue;
    }
    protectedIds.add(protectedMessage.id);
  }

  let remainingCount = messages.length;
  let remainingCharacters = messages.reduce((sum, message) => sum + estimateMessageLength(message), 0);
  let removedCount = 0;
  let removedCharacters = 0;

  for (const message of messages) {
    const overMessageLimit = remainingCount > config.maxMessages;
    const overCharacterLimit = remainingCharacters > config.maxCharacters;

    if (!overMessageLimit && !overCharacterLimit) {
      break;
    }

    if (protectedIds.has(message.id) || isPinned(message)) {
      continue;
    }

    const messageSize = estimateMessageLength(message);
    remainingCount -= 1;
    remainingCharacters -= messageSize;
    removedCount += 1;
    removedCharacters += messageSize;

    events.push({
      type: 'remove',
      targetId: message.id,
    });
  }

  const overflow = remainingCount > config.maxMessages || remainingCharacters > config.maxCharacters;
  return {
    events,
    result: {
      mode: 'remove',
      removedCount,
      removedCharacters,
    },
    overflow,
  };
}

function compactByTruncate(): { events: MessageEvent[]; result: CompactionResult } {
  return {
    events: [{ type: 'truncate' }],
    result: {
      mode: 'truncate',
      removedCount: 0,
      removedCharacters: 0,
    },
  };
}

function shouldCompact(messages: Message[], config: Required<CompactionExtensionConfig>): boolean {
  if (messages.length > config.maxMessages) {
    return true;
  }

  const totalCharacters = messages.reduce((sum, message) => sum + estimateMessageLength(message), 0);
  return totalCharacters > config.maxCharacters;
}

function mergeConfig(config?: CompactionExtensionConfig): Required<CompactionExtensionConfig> {
  return {
    maxMessages: config?.maxMessages ?? DEFAULT_CONFIG.maxMessages,
    maxCharacters: config?.maxCharacters ?? DEFAULT_CONFIG.maxCharacters,
    retainLastMessages: config?.retainLastMessages ?? DEFAULT_CONFIG.retainLastMessages,
    mode: config?.mode ?? DEFAULT_CONFIG.mode,
    appendSummary: config?.appendSummary ?? DEFAULT_CONFIG.appendSummary,
    summaryPrefix: config?.summaryPrefix ?? DEFAULT_CONFIG.summaryPrefix,
  };
}

function maybeAppendSummary(
  events: MessageEvent[],
  config: Required<CompactionExtensionConfig>,
  result: CompactionResult
): void {
  if (!config.appendSummary) {
    return;
  }

  events.push({
    type: 'append',
    message: createSummaryMessage(config, result),
  });
}

export function registerCompactionExtension(
  api: ExtensionApi,
  config?: CompactionExtensionConfig
): void {
  const settings = mergeConfig(config);

  api.pipeline.register('turn', async (ctx) => {
    const messages = ctx.conversationState.nextMessages;

    if (!shouldCompact(messages, settings)) {
      return ctx.next();
    }

    if (settings.mode === 'truncate') {
      const { events, result } = compactByTruncate();
      maybeAppendSummary(events, settings, result);
      emitEvents(ctx, events);
      return ctx.next();
    }

    const removal = compactByRemoval(messages, settings);
    if (removal.overflow) {
      const truncate = compactByTruncate();
      maybeAppendSummary(truncate.events, settings, truncate.result);
      emitEvents(ctx, truncate.events);
      return ctx.next();
    }

    maybeAppendSummary(removal.events, settings, removal.result);
    emitEvents(ctx, removal.events);
    return ctx.next();
  });
}

export function register(api: ExtensionApi): void {
  registerCompactionExtension(api);
}
