import { TelegramClient } from "./telegram.js";
import type { ConnectorContext } from "./types.js";

function pickBotToken(secrets: Record<string, string>): string {
  const token = secrets.TELEGRAM_BOT_TOKEN ?? secrets.BOT_TOKEN ?? secrets.TELEGRAM_TOKEN;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("TELEGRAM_BOT_TOKEN secret is required");
  }
  return token;
}

export default async function run(ctx: ConnectorContext): Promise<void> {
  const token = pickBotToken(ctx.secrets);
  const client = new TelegramClient(token);
  let offset = 0;

  while (true) {
    const updates = await client.getUpdates(offset, 30);
    for (const update of updates) {
      offset = Math.max(offset, update.updateId + 1);
      await ctx.emit({
        name: "telegram_message",
        instanceKey: `telegram:${String(update.chatId)}`,
        message: {
          type: "text",
          text: update.text,
        },
        properties: {
          update_id: String(update.updateId),
          chat_id: String(update.chatId),
          from_display_name: update.fromDisplayName,
          message_id: String(update.messageId),
        },
      });
    }
  }
}
