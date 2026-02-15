import { isJsonObject, type Message } from '@goondan/runtime';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: unknown;
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
