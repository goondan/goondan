import type { Message } from '../index.js';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: unknown;
}

export function toConversationTurns(messages: Message[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  for (const message of messages) {
    if (message.data.role !== 'user' && message.data.role !== 'assistant') {
      continue;
    }

    turns.push({
      role: message.data.role,
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
