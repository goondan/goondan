import { isRecord, readNumber, readString } from "./types.js";

export interface TelegramTextUpdate {
  updateId: number;
  messageId: number;
  chatId: number;
  text: string;
  fromDisplayName: string;
}

interface TelegramApiSuccess {
  ok: true;
  result: unknown;
}

function isTelegramApiSuccess(value: unknown): value is TelegramApiSuccess {
  if (!isRecord(value)) {
    return false;
  }
  const ok = value.ok;
  if (ok !== true) {
    return false;
  }
  return "result" in value;
}

function parseDisplayName(messageRecord: Record<string, unknown>): string {
  const from = messageRecord.from;
  if (!isRecord(from)) {
    return "unknown";
  }

  const firstName = readString(from, "first_name") ?? "";
  const lastName = readString(from, "last_name") ?? "";
  const username = readString(from, "username");

  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName !== "") {
    return fullName;
  }
  if (typeof username === "string" && username.trim() !== "") {
    return `@${username}`;
  }
  return "unknown";
}

function parseUpdate(item: unknown): TelegramTextUpdate | undefined {
  if (!isRecord(item)) {
    return undefined;
  }

  const updateId = readNumber(item, "update_id");
  if (typeof updateId !== "number") {
    return undefined;
  }

  const message = item.message;
  if (!isRecord(message)) {
    return undefined;
  }

  const text = readString(message, "text");
  const messageId = readNumber(message, "message_id");
  if (typeof text !== "string" || typeof messageId !== "number") {
    return undefined;
  }

  const chat = message.chat;
  if (!isRecord(chat)) {
    return undefined;
  }

  const chatId = readNumber(chat, "id");
  if (typeof chatId !== "number") {
    return undefined;
  }

  return {
    updateId,
    messageId,
    chatId,
    text,
    fromDisplayName: parseDisplayName(message),
  };
}

function splitTelegramMessage(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > chunkSize) {
    const cut = remaining.slice(0, chunkSize);
    chunks.push(cut);
    remaining = remaining.slice(chunkSize);
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

export class TelegramClient {
  private readonly botToken: string;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramTextUpdate[]> {
    const body = await this.callApi("getUpdates", {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message"],
    });

    if (!isTelegramApiSuccess(body)) {
      throw new Error("Telegram API 응답 형식이 올바르지 않습니다.");
    }
    if (!Array.isArray(body.result)) {
      throw new Error("Telegram API result가 배열이 아닙니다.");
    }

    const updates: TelegramTextUpdate[] = [];
    for (const item of body.result) {
      const parsed = parseUpdate(item);
      if (parsed) {
        updates.push(parsed);
      }
    }

    return updates;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const chunks = splitTelegramMessage(text, 3900);
    for (const chunk of chunks) {
      await this.callApi("sendMessage", {
        chat_id: chatId,
        text: chunk,
      });
    }
  }

  private async callApi(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const endpoint = `https://api.telegram.org/bot${this.botToken}/${method}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API 오류(${response.status}): ${body}`);
    }

    return response.json();
  }
}
