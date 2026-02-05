/**
 * EventBus 구현
 * @see /docs/specs/extension.md - 7. 이벤트 API
 */

import type { JsonObject } from '../types/json.js';
import type { EventBus, EventHandler } from './types.js';

/**
 * glob 패턴 매칭 함수
 * 간단한 와일드카드(*) 지원
 */
function matchPattern(pattern: string, type: string): boolean {
  // 정확한 일치
  if (pattern === type) {
    return true;
  }

  // * 와일드카드 지원 (예: workspace.*)
  if (pattern.includes('*')) {
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 특수문자 이스케이프
      .replace(/\*/g, '.*'); // *를 .*로 변환
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(type);
  }

  return false;
}

/**
 * EventBus 팩토리 함수
 */
export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();
  const onceHandlers = new WeakSet<EventHandler>();

  function getOrCreateHandlerSet(pattern: string): Set<EventHandler> {
    let handlerSet = handlers.get(pattern);
    if (!handlerSet) {
      handlerSet = new Set();
      handlers.set(pattern, handlerSet);
    }
    return handlerSet;
  }

  function emit(type: string, payload: JsonObject = {}): void {
    // 모든 패턴에 대해 매칭 검사
    for (const [pattern, handlerSet] of handlers) {
      if (matchPattern(pattern, type)) {
        for (const handler of handlerSet) {
          // 비동기로 핸들러 실행 (에러 격리)
          Promise.resolve()
            .then(() => handler(payload))
            .catch((error) => {
              // 핸들러 오류는 로깅만 하고 다른 핸들러 실행을 막지 않음
              console.error(`EventBus handler error for ${type}:`, error);
            });

          // once 핸들러는 실행 후 제거
          if (onceHandlers.has(handler)) {
            handlerSet.delete(handler);
            onceHandlers.delete(handler);
          }
        }
      }
    }
  }

  function on(type: string, handler: EventHandler): () => void {
    const handlerSet = getOrCreateHandlerSet(type);
    handlerSet.add(handler);

    // 구독 해제 함수 반환
    return () => {
      handlerSet.delete(handler);
    };
  }

  function once(type: string, handler: EventHandler): () => void {
    const handlerSet = getOrCreateHandlerSet(type);
    handlerSet.add(handler);
    onceHandlers.add(handler);

    // 구독 해제 함수 반환
    return () => {
      handlerSet.delete(handler);
      onceHandlers.delete(handler);
    };
  }

  function off(type: string, handler: EventHandler): void {
    const handlerSet = handlers.get(type);
    if (handlerSet) {
      handlerSet.delete(handler);
    }
    onceHandlers.delete(handler);
  }

  return {
    emit,
    on,
    once,
    off,
  };
}
