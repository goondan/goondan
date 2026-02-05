/**
 * State Store 구현
 * @see /docs/specs/extension.md - 9. 상태 관리
 */

import type { JsonObject } from '../types/json.js';
import type { StateStore } from './types.js';

/**
 * StateStore 팩토리 함수
 */
export function createStateStore(): StateStore {
  const extensionStates = new Map<string, JsonObject>();
  let sharedState: JsonObject = {};

  function getExtensionState(extensionName: string): JsonObject {
    let state = extensionStates.get(extensionName);
    if (!state) {
      state = {};
      extensionStates.set(extensionName, state);
    }
    return state;
  }

  function getSharedState(): JsonObject {
    return sharedState;
  }

  function clearExtensionState(extensionName: string): void {
    extensionStates.set(extensionName, {});
  }

  function clearAll(): void {
    extensionStates.clear();
    sharedState = {};
  }

  return {
    getExtensionState,
    getSharedState,
    clearExtensionState,
    clearAll,
  };
}
