/**
 * State Store 테스트
 * @see /docs/specs/extension.md - 9. 상태 관리
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createStateStore } from '../../src/extension/state-store.js';
import type { StateStore } from '../../src/extension/types.js';

describe('StateStore', () => {
  let stateStore: StateStore;

  beforeEach(() => {
    stateStore = createStateStore();
  });

  describe('getExtensionState', () => {
    it('Extension별 상태를 반환한다', () => {
      const state = stateStore.getExtensionState('my-extension');

      expect(state).toBeDefined();
      expect(typeof state).toBe('object');
    });

    it('동일 Extension 이름으로 동일한 상태 객체를 반환한다', () => {
      const state1 = stateStore.getExtensionState('my-extension');
      const state2 = stateStore.getExtensionState('my-extension');

      expect(state1).toBe(state2);
    });

    it('다른 Extension 이름은 다른 상태 객체를 반환한다', () => {
      const state1 = stateStore.getExtensionState('extension-1');
      const state2 = stateStore.getExtensionState('extension-2');

      expect(state1).not.toBe(state2);
    });

    it('상태를 직접 수정할 수 있다', () => {
      const state = stateStore.getExtensionState('my-extension');
      state['count'] = 42;
      state['name'] = 'test';

      const retrieved = stateStore.getExtensionState('my-extension');
      expect(retrieved['count']).toBe(42);
      expect(retrieved['name']).toBe('test');
    });

    it('빈 객체로 초기화된다', () => {
      const state = stateStore.getExtensionState('my-extension');

      expect(Object.keys(state)).toHaveLength(0);
    });
  });

  describe('getSharedState', () => {
    it('인스턴스 공유 상태를 반환한다', () => {
      const shared = stateStore.getSharedState();

      expect(shared).toBeDefined();
      expect(typeof shared).toBe('object');
    });

    it('동일한 공유 상태 객체를 반환한다', () => {
      const shared1 = stateStore.getSharedState();
      const shared2 = stateStore.getSharedState();

      expect(shared1).toBe(shared2);
    });

    it('공유 상태를 직접 수정할 수 있다', () => {
      const shared = stateStore.getSharedState();
      shared['myExt:data'] = { initialized: true };

      const retrieved = stateStore.getSharedState();
      const data = retrieved['myExt:data'];
      expect(data).toEqual({ initialized: true });
    });

    it('여러 Extension이 네임스페이스로 공유 상태를 사용할 수 있다', () => {
      const shared = stateStore.getSharedState();

      // Extension A
      shared['extA:config'] = { enabled: true };

      // Extension B
      shared['extB:config'] = { mode: 'advanced' };

      expect(shared['extA:config']).toEqual({ enabled: true });
      expect(shared['extB:config']).toEqual({ mode: 'advanced' });
    });
  });

  describe('clearExtensionState', () => {
    it('특정 Extension의 상태를 초기화한다', () => {
      const state = stateStore.getExtensionState('my-extension');
      state['count'] = 100;

      stateStore.clearExtensionState('my-extension');

      const newState = stateStore.getExtensionState('my-extension');
      expect(newState['count']).toBeUndefined();
    });

    it('다른 Extension의 상태에 영향을 주지 않는다', () => {
      const state1 = stateStore.getExtensionState('extension-1');
      const state2 = stateStore.getExtensionState('extension-2');
      state1['value'] = 1;
      state2['value'] = 2;

      stateStore.clearExtensionState('extension-1');

      const retrievedState2 = stateStore.getExtensionState('extension-2');
      expect(retrievedState2['value']).toBe(2);
    });
  });

  describe('clearAll', () => {
    it('모든 상태를 초기화한다', () => {
      const state1 = stateStore.getExtensionState('ext-1');
      const state2 = stateStore.getExtensionState('ext-2');
      const shared = stateStore.getSharedState();

      state1['value'] = 1;
      state2['value'] = 2;
      shared['test'] = 'data';

      stateStore.clearAll();

      const newState1 = stateStore.getExtensionState('ext-1');
      const newState2 = stateStore.getExtensionState('ext-2');
      const newShared = stateStore.getSharedState();

      expect(newState1['value']).toBeUndefined();
      expect(newState2['value']).toBeUndefined();
      expect(Object.keys(newShared)).toHaveLength(0);
    });
  });
});
