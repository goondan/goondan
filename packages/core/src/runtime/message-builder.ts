/**
 * MessageBuilder 구현
 * @see /docs/specs/runtime.md - 7. Turn 메시지 상태 모델 (Base + Events)
 */

import type { LlmMessage, TurnMessageState, MessageEvent, SystemMessageEvent, LlmMessageEvent } from './types.js';
import { computeNextMessages } from './types.js';

/**
 * Turn 인터페이스 (순환 참조 방지용)
 */
interface TurnLike {
  readonly messageState: TurnMessageState;
  /** @deprecated messageState.nextMessages를 사용 */
  readonly messages: LlmMessage[];
}

/**
 * MessageBuilder: Turn messageState 관리
 *
 * 규칙:
 * - MUST: NextMessages = BaseMessages + SUM(Events)
 * - MUST: events는 append order를 보존
 */
export interface MessageBuilder {
  /**
   * 메시지를 이벤트로 추가하고 nextMessages 재계산
   */
  append(turn: TurnLike, message: LlmMessage): void;

  /**
   * 현재 메시지 목록 조회 (nextMessages)
   */
  getMessages(turn: TurnLike): readonly LlmMessage[];

  /**
   * LLM 요청용 메시지 배열 생성
   */
  buildLlmMessages(turn: TurnLike, systemPrompt: string): LlmMessage[];
}

/**
 * MessageBuilder 구현
 */
class MessageBuilderImpl implements MessageBuilder {
  append(turn: TurnLike, message: LlmMessage): void {
    let event: MessageEvent;
    if (message.role === 'system') {
      const sysEvent: SystemMessageEvent = {
        type: 'system_message',
        seq: turn.messageState.events.length,
        message,
      };
      event = sysEvent;
    } else {
      const llmEvent: LlmMessageEvent = {
        type: 'llm_message',
        seq: turn.messageState.events.length,
        message,
      };
      event = llmEvent;
    }
    turn.messageState.events.push(event);
    // nextMessages 재계산
    const recomputed = computeNextMessages(
      turn.messageState.baseMessages,
      turn.messageState.events
    );
    turn.messageState.nextMessages.splice(
      0,
      turn.messageState.nextMessages.length,
      ...recomputed
    );
  }

  getMessages(turn: TurnLike): readonly LlmMessage[] {
    return turn.messageState.nextMessages;
  }

  buildLlmMessages(turn: TurnLike, systemPrompt: string): LlmMessage[] {
    return buildLlmMessages(turn.messageState.nextMessages, systemPrompt);
  }
}

/**
 * MessageBuilder 생성
 */
export function createMessageBuilder(): MessageBuilder {
  return new MessageBuilderImpl();
}

/**
 * LLM 요청 메시지 빌드 (standalone function)
 *
 * @param messages - Turn의 메시지 배열
 * @param systemPrompt - 시스템 프롬프트
 * @returns LLM 요청용 메시지 배열
 */
export function buildLlmMessages(
  messages: readonly LlmMessage[],
  systemPrompt: string
): LlmMessage[] {
  const result: LlmMessage[] = [];

  // 1. 시스템 프롬프트
  result.push({
    id: 'msg-sys-0',
    role: 'system',
    content: systemPrompt,
  });

  // 2. Turn.messages 복사 (불변성 유지)
  for (const msg of messages) {
    result.push({ ...msg });
  }

  return result;
}
