/**
 * State Store 구현
 * @see /docs/specs/extension.md - 9. 상태 관리
 */

import type { JsonObject } from '../types/json.js';
import type {
  CreateStateStoreOptions,
  StateStore,
  StateStorePersistence,
  StateStoreSnapshot,
} from './types.js';

/**
 * JsonObject 얕은 복사
 */
function cloneJsonObject(source: JsonObject): JsonObject {
  const next: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    next[key] = value;
  }
  return next;
}

/**
 * StateStore 팩토리 함수
 */
export function createStateStore(options: CreateStateStoreOptions = {}): StateStore {
  const extensionStates = new Map<string, JsonObject>();
  const extensionProxies = new Map<string, JsonObject>();
  const dirtyExtensions = new Set<string>();
  const persistence: StateStorePersistence | undefined = options.persistence;

  if (options.initialExtensionStates) {
    for (const [name, state] of Object.entries(options.initialExtensionStates)) {
      extensionStates.set(name, cloneJsonObject(state));
    }
  }

  let sharedStateSource: JsonObject = options.initialSharedState
    ? cloneJsonObject(options.initialSharedState)
    : {};
  let sharedStateProxy = createSharedStateProxy(sharedStateSource, () => {
    sharedStateDirty = true;
  });
  let sharedStateDirty = false;

  function markExtensionDirty(extensionName: string): void {
    dirtyExtensions.add(extensionName);
  }

  function createExtensionStateProxy(extensionName: string, target: JsonObject): JsonObject {
    return new Proxy(target, {
      set(obj, prop, value): boolean {
        if (typeof prop === 'string') {
          obj[prop] = value;
          markExtensionDirty(extensionName);
          return true;
        }
        return Reflect.set(obj, prop, value);
      },
      deleteProperty(obj, prop): boolean {
        if (typeof prop === 'string') {
          delete obj[prop];
          markExtensionDirty(extensionName);
          return true;
        }
        return Reflect.deleteProperty(obj, prop);
      },
    });
  }

  function getExtensionState(extensionName: string): JsonObject {
    let state = extensionProxies.get(extensionName);
    if (state) {
      return state;
    }

    const raw = extensionStates.get(extensionName);
    if (raw) {
      state = createExtensionStateProxy(extensionName, raw);
      extensionProxies.set(extensionName, state);
      return state;
    }

    const nextRaw: JsonObject = {};
    extensionStates.set(extensionName, nextRaw);
    state = createExtensionStateProxy(extensionName, nextRaw);
    extensionProxies.set(extensionName, state);
    return state;
  }

  function setExtensionState(extensionName: string, state: JsonObject): void {
    const cloned = cloneJsonObject(state);
    extensionStates.set(extensionName, cloned);
    extensionProxies.set(extensionName, createExtensionStateProxy(extensionName, cloned));
    markExtensionDirty(extensionName);
  }

  function getSharedState(): JsonObject {
    return sharedStateProxy;
  }

  function setSharedState(state: JsonObject): void {
    sharedStateSource = cloneJsonObject(state);
    sharedStateProxy = createSharedStateProxy(sharedStateSource, () => {
      sharedStateDirty = true;
    });
    sharedStateDirty = true;
  }

  function clearExtensionState(extensionName: string): void {
    const nextState: JsonObject = {};
    extensionStates.set(extensionName, nextState);
    extensionProxies.set(extensionName, createExtensionStateProxy(extensionName, nextState));
    markExtensionDirty(extensionName);
  }

  function clearAll(): void {
    extensionStates.clear();
    extensionProxies.clear();
    dirtyExtensions.clear();
    sharedStateSource = {};
    sharedStateProxy = createSharedStateProxy(sharedStateSource, () => {
      sharedStateDirty = true;
    });
    sharedStateDirty = true;
  }

  function rehydrate(snapshot: StateStoreSnapshot): void {
    extensionStates.clear();
    extensionProxies.clear();
    dirtyExtensions.clear();

    for (const [extensionName, state] of Object.entries(snapshot.extensionStates)) {
      const cloned = cloneJsonObject(state);
      extensionStates.set(extensionName, cloned);
      extensionProxies.set(extensionName, createExtensionStateProxy(extensionName, cloned));
    }

    sharedStateSource = cloneJsonObject(snapshot.sharedState);
    sharedStateProxy = createSharedStateProxy(sharedStateSource, () => {
      sharedStateDirty = true;
    });
    sharedStateDirty = false;
  }

  async function flush(): Promise<void> {
    const errors: unknown[] = [];

    if (persistence?.onExtensionStateChange) {
      for (const extensionName of dirtyExtensions) {
        const raw = extensionStates.get(extensionName);
        if (!raw) {
          continue;
        }

        try {
          await persistence.onExtensionStateChange(extensionName, cloneJsonObject(raw));
        } catch (error) {
          errors.push(error);
        }
      }
    }

    if (sharedStateDirty && persistence?.onSharedStateChange) {
      try {
        await persistence.onSharedStateChange(cloneJsonObject(sharedStateSource));
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 0) {
      dirtyExtensions.clear();
      sharedStateDirty = false;
      return;
    }

    if (errors[0] instanceof Error) {
      throw errors[0];
    }
    throw new Error(String(errors[0]));
  }

  return {
    getExtensionState,
    setExtensionState,
    getSharedState,
    setSharedState,
    clearExtensionState,
    clearAll,
    flush,
    rehydrate,
  };
}

/**
 * sharedState top-level 변경 감지 Proxy 생성
 */
function createSharedStateProxy(
  target: JsonObject,
  onChange?: () => void
): JsonObject {
  if (!onChange) {
    return target;
  }

  return new Proxy(target, {
    set(obj, prop, value): boolean {
      if (typeof prop === 'string') {
        obj[prop] = value;
        onChange();
        return true;
      }
      return Reflect.set(obj, prop, value);
    },
    deleteProperty(obj, prop): boolean {
      if (typeof prop === 'string') {
        delete obj[prop];
        onChange();
        return true;
      }
      return Reflect.deleteProperty(obj, prop);
    },
  });
}
