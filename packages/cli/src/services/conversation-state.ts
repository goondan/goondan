import { isJsonObject, type Message } from '@goondan/runtime';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: unknown;
}

interface LlmMessage {
  role: string;
  content: unknown;
}

export interface AnthropicPreparedConversation {
  messages: Record<string, unknown>[];
  systemAddendum: string;
}

export function trimConversation(turns: ConversationTurn[], maxTurns: number): ConversationTurn[] {
  const limit = Math.max(1, maxTurns) * 2;
  if (turns.length <= limit) {
    return turns;
  }

  return turns.slice(turns.length - limit);
}

export function toConversationTurns(messages: Message[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const message of messages) {
    const role = message.data.role;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    turns.push({
      role,
      content: message.data.content,
    });
  }
  return turns;
}

export function toPersistentMessages(turns: ConversationTurn[]): Message[] {
  const messages: Message[] = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (!turn) {
      continue;
    }

    if (turn.role === 'assistant') {
      messages.push({
        id: `persist-${index}`,
        data: {
          role: 'assistant',
          content: turn.content,
        },
        metadata: {},
        createdAt: new Date(),
        source: {
          type: 'assistant',
          stepId: `persist-step-${index}`,
        },
      });
      continue;
    }

    messages.push({
      id: `persist-${index}`,
      data: {
        role: 'user',
        content: turn.content,
      },
      metadata: {},
      createdAt: new Date(),
      source: {
        type: 'user',
      },
    });
  }
  return messages;
}

export function toAnthropicMessages(turns: ConversationTurn[]): Record<string, unknown>[] {
  return turns.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
}

export function toConversationTurnsFromAnthropicMessages(messages: unknown[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const message of messages) {
    if (!isJsonObject(message)) {
      continue;
    }

    const role = message.role;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    if (!Object.hasOwn(message, 'content')) {
      continue;
    }

    turns.push({
      role,
      content: message.content,
    });
  }

  return turns;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toSystemText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const lines: string[] = [];
    for (const item of content) {
      if (isJsonObject(item) && item.type === 'text' && typeof item.text === 'string') {
        lines.push(item.text);
        continue;
      }
      lines.push(safeStringify(item));
    }
    return lines.join('\n');
  }

  if (isJsonObject(content) && content.type === 'text' && typeof content.text === 'string') {
    return content.text;
  }

  return safeStringify(content);
}

function extractToolUseIds(content: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(content)) {
    return ids;
  }

  for (const block of content) {
    if (!isJsonObject(block) || block.type !== 'tool_use') {
      continue;
    }

    const id = block.id;
    if (typeof id === 'string' && id.trim().length > 0) {
      ids.add(id);
    }
  }

  return ids;
}

function sanitizeUserContent(
  content: unknown,
  allowedToolUseIds: Set<string>,
): { content: unknown; hasContent: boolean; hadToolResult: boolean } {
  if (!Array.isArray(content)) {
    return {
      content,
      hasContent: true,
      hadToolResult: false,
    };
  }

  const sanitized: unknown[] = [];
  let hadToolResult = false;

  for (const block of content) {
    if (!isJsonObject(block) || block.type !== 'tool_result') {
      sanitized.push(block);
      continue;
    }

    hadToolResult = true;
    const toolUseId = block.tool_use_id;
    if (typeof toolUseId !== 'string') {
      continue;
    }

    if (allowedToolUseIds.has(toolUseId)) {
      sanitized.push(block);
    }
  }

  return {
    content: sanitized,
    hasContent: sanitized.length > 0,
    hadToolResult,
  };
}

export function prepareAnthropicConversation(messages: LlmMessage[]): AnthropicPreparedConversation {
  const anthropicMessages: Record<string, unknown>[] = [];
  const systemParts: string[] = [];
  let previousAssistantToolUseIds: Set<string> | undefined;

  for (const message of messages) {
    if (message.role === 'assistant') {
      anthropicMessages.push({
        role: 'assistant',
        content: message.content,
      });
      previousAssistantToolUseIds = extractToolUseIds(message.content);
      continue;
    }

    if (message.role === 'user') {
      const sanitized = sanitizeUserContent(message.content, previousAssistantToolUseIds ?? new Set<string>());
      previousAssistantToolUseIds = undefined;
      if (sanitized.hadToolResult && !sanitized.hasContent) {
        continue;
      }

      anthropicMessages.push({
        role: 'user',
        content: sanitized.content,
      });
      continue;
    }

    if (message.role === 'system') {
      const text = toSystemText(message.content).trim();
      if (text.length > 0) {
        systemParts.push(text);
      }
    }
  }

  return {
    messages: anthropicMessages,
    systemAddendum: systemParts.join('\n\n'),
  };
}
