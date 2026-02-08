/**
 * Runtime <-> Workspace persistence wiring helpers
 *
 * Runtime 실행 경로에서 다음을 한 번에 연결한다:
 * - Turn messageState logger (base/events)
 * - Turn 시작 시 messageState(base+events) 복구
 * - Extension state persistent store 주입
 */

import { ExtensionLoader } from '../extension/loader.js';
import type { EventBus, StateStore } from '../extension/types.js';
import type { AgentInstance } from './agent-instance.js';
import type {
  TurnMessageStateLogger,
  TurnMessageStateRecoverySnapshot,
} from './turn-runner.js';

/**
 * Runtime이 필요로 하는 Workspace persistence 최소 인터페이스
 */
export interface RuntimePersistenceWorkspaceAdapter {
  createTurnMessageStateLogger(instanceId: string, agentName: string): TurnMessageStateLogger;
  recoverTurnMessageState(
    instanceId: string,
    agentName: string
  ): Promise<TurnMessageStateRecoverySnapshot | undefined>;
  createPersistentStateStore(instanceId: string): Promise<StateStore>;
}

/**
 * Runtime persistence 바인딩 결과
 */
export interface RuntimePersistenceBindings {
  messageStateLogger: (agentInstance: AgentInstance) => TurnMessageStateLogger;
  messageStateRecovery: (
    agentInstance: AgentInstance
  ) => Promise<TurnMessageStateRecoverySnapshot | undefined>;
  flushExtensionState: (agentInstance: AgentInstance) => Promise<void>;
  rehydrateExtensionState: (agentInstance: AgentInstance) => Promise<void>;
  createExtensionLoader: (
    agentInstance: AgentInstance,
    eventBus: EventBus,
    logger?: Console
  ) => Promise<ExtensionLoader>;
}

function resolveRuntimeIds(agentInstance: AgentInstance): { instanceId: string; agentName: string } {
  return {
    instanceId: agentInstance.swarmInstance.id,
    agentName: agentInstance.agentName,
  };
}

/**
 * WorkspaceManager 기반 Runtime persistence 바인딩 생성
 */
export function createRuntimePersistenceBindings(
  workspace: RuntimePersistenceWorkspaceAdapter
): RuntimePersistenceBindings {
  const stateStoreCache = new Map<string, Promise<StateStore>>();

  async function getStateStore(instanceId: string): Promise<StateStore> {
    const cached = stateStoreCache.get(instanceId);
    if (cached) {
      return cached;
    }

    const created = workspace.createPersistentStateStore(instanceId);
    stateStoreCache.set(instanceId, created);
    return created;
  }

  return {
    messageStateLogger: (agentInstance) => {
      const { instanceId, agentName } = resolveRuntimeIds(agentInstance);
      return workspace.createTurnMessageStateLogger(instanceId, agentName);
    },
    messageStateRecovery: async (agentInstance) => {
      const { instanceId, agentName } = resolveRuntimeIds(agentInstance);
      return workspace.recoverTurnMessageState(instanceId, agentName);
    },
    flushExtensionState: async (agentInstance) => {
      const { instanceId } = resolveRuntimeIds(agentInstance);
      const stateStore = await getStateStore(instanceId);
      await stateStore.flush();
    },
    rehydrateExtensionState: async (agentInstance) => {
      const { instanceId } = resolveRuntimeIds(agentInstance);
      const nextStore = await workspace.createPersistentStateStore(instanceId);
      const currentStore = await getStateStore(instanceId);

      // createPersistentStateStore는 동일 instanceId에 대해 동일 store를 반환하는 구현을 권장한다.
      // 다른 객체가 반환되더라도 런타임 참조는 기존 currentStore를 유지한다.
      if (nextStore !== currentStore) {
        return;
      }
    },
    createExtensionLoader: async (agentInstance, eventBus, logger) => {
      const { instanceId } = resolveRuntimeIds(agentInstance);
      const stateStore = await getStateStore(instanceId);

      return new ExtensionLoader({
        eventBus,
        stateStore,
        ...(logger ? { logger } : {}),
      });
    },
  };
}
