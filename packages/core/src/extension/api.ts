/**
 * ExtensionApi 구현
 * @see /docs/specs/extension.md - 4. ExtensionApi 인터페이스
 */

import type { JsonObject } from '../types/json.js';
import type { ExtensionResource } from '../types/specs/extension.js';
import type {
  ExtensionApi,
  EventBus,
  StateStore,
  PipelineApi,
  ToolRegistryApi,
  SwarmBundleApi,
  LiveConfigApi,
  OAuthApi,
  EffectiveConfig,
} from './types.js';
import { PipelineRegistry } from './pipeline-registry.js';
import { ToolRegistry } from './tool-registry.js';

/**
 * ExtensionApi 생성 옵션
 */
export interface CreateExtensionApiOptions<_TConfig = JsonObject> {
  extension: ExtensionResource;
  eventBus: EventBus;
  stateStore: StateStore;
  logger?: Console;
  pipelineRegistry?: PipelineRegistry;
  toolRegistry?: ToolRegistry;
  swarmBundleApi?: SwarmBundleApi;
  liveConfigApi?: LiveConfigApi;
  oauthApi?: OAuthApi;
}

/**
 * 기본 SwarmBundleApi 구현 (stub)
 */
function createDefaultSwarmBundleApi(): SwarmBundleApi {
  return {
    async openChangeset(_input) {
      return {
        changesetId: `cs-${Date.now()}`,
        baseRef: 'git:HEAD',
        workdir: '/tmp/changeset',
      };
    },
    async commitChangeset(input) {
      return {
        status: 'ok',
        changesetId: input.changesetId,
        baseRef: 'git:HEAD',
        newRef: 'git:HEAD',
        summary: {
          filesChanged: [],
          filesAdded: [],
          filesDeleted: [],
        },
      };
    },
    getActiveRef() {
      return 'git:HEAD';
    },
  };
}

/**
 * 기본 LiveConfigApi 구현 (stub)
 */
function createDefaultLiveConfigApi(): LiveConfigApi {
  const effectiveConfig: EffectiveConfig = {
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'default' },
      spec: { entrypoint: { kind: 'Agent', name: 'default' }, agents: [] },
    },
    agents: new Map(),
    models: new Map(),
    tools: new Map(),
    extensions: new Map(),
    connectors: new Map(),
    oauthApps: new Map(),
    revision: 1,
    swarmBundleRef: 'git:HEAD',
  };

  return {
    async proposePatch(patch) {
      // Stub: 패치 제안 로깅만
      console.debug('[LiveConfig] Patch proposed:', patch);
    },
    getEffectiveConfig() {
      return effectiveConfig;
    },
    getRevision() {
      return effectiveConfig.revision;
    },
  };
}

/**
 * 기본 OAuthApi 구현 (stub)
 */
function createDefaultOAuthApi(): OAuthApi {
  return {
    async getAccessToken(_request) {
      return {
        status: 'error',
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'OAuth is not configured',
        },
      };
    },
  };
}

/**
 * ExtensionApi 팩토리 함수
 */
export function createExtensionApi<
  TState extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject
>(options: CreateExtensionApiOptions<TConfig>): ExtensionApi<TState, TConfig> {
  const {
    extension,
    eventBus,
    stateStore,
    logger,
    pipelineRegistry = new PipelineRegistry(),
    toolRegistry = new ToolRegistry(),
    swarmBundleApi = createDefaultSwarmBundleApi(),
    liveConfigApi = createDefaultLiveConfigApi(),
    oauthApi = createDefaultOAuthApi(),
  } = options;

  const extensionName = extension.metadata.name;

  // extState 함수: Extension별 상태 반환
  function extState(): TState {
    return stateStore.getExtensionState(extensionName) as TState;
  }

  // instance 객체: 공유 상태 접근
  const instance = {
    get shared(): JsonObject {
      return stateStore.getSharedState();
    },
  };

  // PipelineApi 래퍼
  const pipelines: PipelineApi = {
    mutate: pipelineRegistry.mutate.bind(pipelineRegistry),
    wrap: pipelineRegistry.wrap.bind(pipelineRegistry),
  };

  // ToolRegistryApi 래퍼
  const tools: ToolRegistryApi = {
    register: toolRegistry.register.bind(toolRegistry),
    unregister: toolRegistry.unregister.bind(toolRegistry),
    get: toolRegistry.get.bind(toolRegistry),
    list: toolRegistry.list.bind(toolRegistry),
  };

  return {
    extension,
    pipelines,
    tools,
    events: eventBus,
    swarmBundle: swarmBundleApi,
    liveConfig: liveConfigApi,
    oauth: oauthApi,
    extState,
    instance,
    logger,
  };
}
