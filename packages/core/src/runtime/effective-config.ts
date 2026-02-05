/**
 * EffectiveConfig 구현
 * @see /docs/specs/runtime.md - 2.5 Step 타입 (EffectiveConfig), 9. Effective Config 고정 규칙
 */

import type { Resource } from '../types/resource.js';
import type { ObjectRefLike } from '../types/object-ref.js';
import type { SwarmResource } from '../types/specs/swarm.js';
import type { AgentSpec, AgentResource } from '../types/specs/agent.js';
import type { ModelSpec, ModelResource } from '../types/specs/model.js';
import type { ToolResource } from '../types/specs/tool.js';
import type { ExtensionResource } from '../types/specs/extension.js';
import type { SwarmBundleRef } from './types.js';

/**
 * EffectiveConfig: Step에서 사용할 최종 구성
 *
 * 규칙:
 * - MUST: Step 시작 시 activeSwarmBundleRef 기준으로 로드/조립
 * - MUST: Step 실행 중 변경 불가
 * - SHOULD: tools/extensions 배열은 identity key 기반으로 정규화
 */
export interface EffectiveConfig {
  /** Swarm 구성 */
  readonly swarm: SwarmResource;

  /** Agent 구성 */
  readonly agent: AgentResource;

  /** 사용 가능한 Tool 목록 */
  readonly tools: readonly ToolResource[];

  /** 활성화된 Extension 목록 */
  readonly extensions: readonly ExtensionResource[];

  /** Model 구성 */
  readonly model: ModelResource;

  /** 시스템 프롬프트 */
  readonly systemPrompt: string;

  /** Effective Config 버전 (변경 감지용) */
  readonly revision: number;
}

/**
 * Identity 기반 배열 정규화
 *
 * 규칙:
 * - SHOULD: identity key 중복 시 last-wins
 * - SHOULD: 순서 변경으로 인한 상태 재생성 방지
 */
export function normalizeByIdentity<T extends Resource<unknown>>(
  items: T[]
): readonly T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    const key = `${item.kind}/${item.metadata.name}`;
    map.set(key, item); // last-wins
  }

  return Array.from(map.values());
}

/**
 * Bundle 로더 인터페이스 (의존성 주입용)
 */
export interface BundleLoader {
  getResource<TSpec>(kind: string, name: string): Resource<TSpec> | undefined;
  getSwarmForAgent(agent: AgentResource): SwarmResource;
  resolveToolRefs(toolRefs: unknown[] | undefined): Promise<ToolResource[]>;
  resolveExtensionRefs(extensionRefs: unknown[] | undefined): Promise<ExtensionResource[]>;
  loadSystemPrompt(prompts: { system?: string; systemRef?: string } | undefined): Promise<string>;
}

/**
 * EffectiveConfigLoader: Effective Config 로드
 */
export interface EffectiveConfigLoader {
  /**
   * Step의 Effective Config 로드 (고정)
   */
  load(swarmBundleRef: SwarmBundleRef, agentRef: ObjectRefLike): Promise<EffectiveConfig>;

  /**
   * 현재 활성 Ref 조회
   */
  getActiveRef(): Promise<SwarmBundleRef>;
}

/**
 * ObjectRefLike에서 이름 추출
 */
function resolveRefName(ref: ObjectRefLike): string {
  if (typeof ref === 'string') {
    const parts = ref.split('/');
    if (parts.length === 2 && parts[1] !== undefined) {
      return parts[1];
    }
    return ref;
  }
  return ref.name;
}

/**
 * SwarmBundleRef에서 revision 계산
 */
function computeRevision(ref: SwarmBundleRef): number {
  // 간단한 해시 기반 revision 계산
  let hash = 0;
  for (let i = 0; i < ref.length; i++) {
    const char = ref.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bit integer로 변환
  }
  return Math.abs(hash);
}

/**
 * EffectiveConfigLoader 구현
 */
class EffectiveConfigLoaderImpl implements EffectiveConfigLoader {
  private currentActiveRef: SwarmBundleRef = 'default';

  constructor(private readonly bundleLoader: BundleLoader) {}

  async load(
    swarmBundleRef: SwarmBundleRef,
    agentRef: ObjectRefLike
  ): Promise<EffectiveConfig> {
    const agentName = resolveRefName(agentRef);

    // 1. Agent 정의 조회
    const agent = this.bundleLoader.getResource<AgentSpec>('Agent', agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    // 2. Swarm 정의 조회
    const swarm = this.bundleLoader.getSwarmForAgent(agent as AgentResource);

    // 3. Model 조회
    const modelName = resolveRefName(agent.spec.modelConfig.modelRef);
    const model = this.bundleLoader.getResource<ModelSpec>('Model', modelName);
    if (!model) {
      throw new Error(`Model not found: ${modelName}`);
    }

    // 4. Tools 목록 조회 및 정규화
    const rawTools = await this.bundleLoader.resolveToolRefs(agent.spec.tools);
    const tools = normalizeByIdentity(rawTools);

    // 5. Extensions 목록 조회 및 정규화
    const rawExtensions = await this.bundleLoader.resolveExtensionRefs(agent.spec.extensions);
    const extensions = normalizeByIdentity(rawExtensions);

    // 6. 시스템 프롬프트 로드
    const systemPrompt = await this.bundleLoader.loadSystemPrompt(agent.spec.prompts);

    // 7. Effective Config 조립
    return {
      swarm: swarm as SwarmResource,
      agent: agent as AgentResource,
      model: model as ModelResource,
      tools,
      extensions,
      systemPrompt,
      revision: computeRevision(swarmBundleRef),
    };
  }

  async getActiveRef(): Promise<SwarmBundleRef> {
    return this.currentActiveRef;
  }

  setActiveRef(ref: SwarmBundleRef): void {
    this.currentActiveRef = ref;
  }
}

/**
 * EffectiveConfigLoader 생성
 */
export function createEffectiveConfigLoader(
  bundleLoader: BundleLoader
): EffectiveConfigLoader & { setActiveRef(ref: SwarmBundleRef): void } {
  return new EffectiveConfigLoaderImpl(bundleLoader);
}
