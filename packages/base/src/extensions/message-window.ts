import type { ExtensionApi, MessageEvent } from '../types.js';

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
    if (messages.length <= maxMessages) {
      return ctx.next();
    }

    const removeCount = messages.length - maxMessages;
    const events: MessageEvent[] = [];
    for (let index = 0; index < removeCount; index += 1) {
      const message = messages[index];
      if (!message) {
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
