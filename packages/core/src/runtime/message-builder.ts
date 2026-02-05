/**
 * MessageBuilder 구현
 * @see /docs/specs/runtime.md - 7. Turn.messages 누적 규칙
 */

import type { LlmMessage } from './types.js';

/**
 * Turn 인터페이스 (순환 참조 방지용)
 */
interface TurnLike {
  readonly messages: LlmMessage[];
}

/**
 * MessageBuilder: Turn.messages 누적 관리
 *
 * 규칙:
 * - MUST: 각 Step의 LLM 응답을 순서대로 append
 * - MUST: 각 Tool 결과를 순서대로 append
 * - MUST: 다음 Step의 입력 컨텍스트로 사용
 */
export interface MessageBuilder {
  /**
   * 메시지 추가
   */
  append(turn: TurnLike, message: LlmMessage): void;

  /**
   * 현재 메시지 목록 조회
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
    turn.messages.push(message);
  }

  getMessages(turn: TurnLike): readonly LlmMessage[] {
    return turn.messages;
  }

  buildLlmMessages(turn: TurnLike, systemPrompt: string): LlmMessage[] {
    return buildLlmMessages(turn.messages, systemPrompt);
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
    role: 'system',
    content: systemPrompt,
  });

  // 2. Turn.messages 복사 (불변성 유지)
  for (const msg of messages) {
    result.push({ ...msg });
  }

  return result;
}
