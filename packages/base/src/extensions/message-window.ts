import type { ExtensionApi, MessageEvent } from '../types.js';
import { normalizeRemovalTargets } from './message-integrity.js';

export interface MessageWindowExtensionConfig {
  maxMessages?: number;
}

const DEFAULT_CONFIG: Required<MessageWindowExtensionConfig> = {
  maxMessages: 40,
};

function resolveMaxMessages(config?: MessageWindowExtensionConfig): number {
  const value = config?.maxMessages;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_CONFIG.maxMessages;
  }

  return Math.floor(value);
}

export function registerMessageWindowExtension(
  api: ExtensionApi,
  config?: MessageWindowExtensionConfig,
): void {
  const maxMessages = resolveMaxMessages(config);

  api.pipeline.register('turn', async (ctx) => {
    const messages = ctx.conversationState.nextMessages;
    const removedIds = new Set<string>();
    if (messages.length > maxMessages) {
      const removeCount = messages.length - maxMessages;
      for (let index = 0; index < removeCount; index += 1) {
        const message = messages[index];
        if (!message) {
          continue;
        }
        removedIds.add(message.id);
      }
    }

    const normalizedRemovedIds = normalizeRemovalTargets(messages, removedIds);
    if (normalizedRemovedIds.size === 0) {
      return ctx.next();
    }

    const events: MessageEvent[] = [];
    for (const message of messages) {
      if (!normalizedRemovedIds.has(message.id)) {
        continue;
      }

      events.push({
        type: 'remove',
        targetId: message.id,
      });
    }

    for (const event of events) {
      ctx.emitMessageEvent(event);
    }

    return ctx.next();
  });
}

export function register(api: ExtensionApi): void {
  registerMessageWindowExtension(api);
}
