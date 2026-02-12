import type { ConversationTurn } from "./state.js";

export interface AnthropicRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  turns: ConversationTurn[];
  userInput: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicResponseContentBlock {
  type?: string;
  text?: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readContentBlocks(value: unknown): AnthropicResponseContentBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const blocks: AnthropicResponseContentBlock[] = [];
  for (const item of value) {
    if (!isObjectRecord(item)) {
      continue;
    }

    blocks.push({
      type: typeof item.type === "string" ? item.type : undefined,
      text: typeof item.text === "string" ? item.text : undefined,
    });
  }

  return blocks;
}

function toAnthropicMessages(turns: ConversationTurn[]): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of turns) {
    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }
  return messages;
}

function parseTextFromResponse(payload: unknown): string {
  if (!isObjectRecord(payload)) {
    throw new Error("Anthropic 응답 형식이 잘못되었습니다.");
  }

  const contentBlocks = readContentBlocks(payload.content);
  const texts: string[] = [];
  for (const block of contentBlocks) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }

  const joined = texts.join("\n").trim();
  if (joined.length > 0) {
    return joined;
  }

  const errorValue = payload.error;
  if (isObjectRecord(errorValue)) {
    const message = errorValue.message;
    if (typeof message === "string" && message.length > 0) {
      throw new Error(`Anthropic API 오류: ${message}`);
    }
  }

  const fallbackMessage = payload.message;
  if (typeof fallbackMessage === "string" && fallbackMessage.length > 0) {
    throw new Error(`Anthropic API 오류: ${fallbackMessage}`);
  }

  throw new Error("Anthropic 응답에서 텍스트를 찾을 수 없습니다.");
}

export async function requestAnthropicText(input: AnthropicRequest): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;

  const messages = toAnthropicMessages(input.turns);
  messages.push({
    role: "user",
    content: input.userInput,
  });

  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.systemPrompt,
      messages,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Anthropic 호출 실패 (${response.status}): ${JSON.stringify(payload)}`);
  }

  return parseTextFromResponse(payload);
}

export function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  const fencedJson = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson && fencedJson[1]) {
    return tryParseJsonObject(fencedJson[1]);
  }

  const fencedAny = trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedAny && fencedAny[1]) {
    const parsed = tryParseJsonObject(fencedAny[1]);
    if (parsed !== null) {
      return parsed;
    }
  }

  const direct = tryParseJsonObject(trimmed);
  if (direct !== null) {
    return direct;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return tryParseJsonObject(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return null;
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
