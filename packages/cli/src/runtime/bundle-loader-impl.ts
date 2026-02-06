/**
 * BundleLoaderImpl: BundleLoadResult 기반 BundleLoader 구현
 *
 * EffectiveConfigLoader가 필요로 하는 BundleLoader 인터페이스를
 * BundleLoadResult 데이터를 기반으로 구현합니다.
 *
 * @see /docs/specs/runtime.md - 9. Effective Config 고정 규칙
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BundleLoadResult } from "@goondan/core";
import type { BundleLoader } from "@goondan/core";
import type { Resource } from "@goondan/core";
import type { SwarmResource, SwarmSpec } from "@goondan/core";
import type { AgentResource } from "@goondan/core";
import type { ToolResource, ToolSpec } from "@goondan/core";
import type { ExtensionResource, ExtensionSpec } from "@goondan/core";
import {
  isRefOrSelector,
  isObjectRef,
  isSelectorWithOverrides,
} from "@goondan/core";

// ============================================================================
// 타입 가드
// ============================================================================

/**
 * unknown이 object인지 확인
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * spec이 SwarmSpec 구조를 가지는지 확인
 */
function isSwarmSpec(spec: unknown): spec is SwarmSpec {
  if (!isRecord(spec)) return false;
  // SwarmSpec은 entrypoint와 agents를 가짐
  return "entrypoint" in spec && "agents" in spec && Array.isArray(spec.agents);
}

/**
 * spec이 ToolSpec 구조를 가지는지 확인
 */
function isToolSpec(spec: unknown): spec is ToolSpec {
  if (!isRecord(spec)) return false;
  return (
    "runtime" in spec &&
    "entry" in spec &&
    typeof spec.entry === "string" &&
    "exports" in spec &&
    Array.isArray(spec.exports)
  );
}

/**
 * spec이 ExtensionSpec 구조를 가지는지 확인
 */
function isExtensionSpec(spec: unknown): spec is ExtensionSpec {
  if (!isRecord(spec)) return false;
  return "runtime" in spec && "entry" in spec && typeof spec.entry === "string";
}

// ============================================================================
// Ref 해석
// ============================================================================

/**
 * RefOrSelector에서 kind, name 추출
 */
function resolveRef(ref: unknown): { kind: string; name: string } | null {
  if (!isRefOrSelector(ref)) {
    return null;
  }

  if (typeof ref === "string") {
    const slashIndex = ref.indexOf("/");
    if (slashIndex > 0 && slashIndex < ref.length - 1) {
      return { kind: ref.substring(0, slashIndex), name: ref.substring(slashIndex + 1) };
    }
    return null;
  }

  if (isObjectRef(ref)) {
    return { kind: ref.kind, name: ref.name };
  }

  if (isSelectorWithOverrides(ref) && ref.selector.kind && ref.selector.name) {
    return { kind: ref.selector.kind, name: ref.selector.name };
  }

  return null;
}

/**
 * ObjectRefLike에서 agentName 추출
 */
function extractAgentName(ref: unknown): string | undefined {
  if (typeof ref === "string") {
    const slashIndex = ref.indexOf("/");
    if (slashIndex > 0) {
      return ref.substring(slashIndex + 1);
    }
    return ref;
  }
  if (isRecord(ref) && "name" in ref && typeof ref.name === "string") {
    return ref.name;
  }
  return undefined;
}

// ============================================================================
// Resource 변환 헬퍼
// ============================================================================

/**
 * Resource<unknown>을 SwarmResource로 타입 안전하게 변환
 * kind 검증 + spec 구조 검증
 */
function toSwarmResource(resource: Resource): SwarmResource | null {
  if (resource.kind !== "Swarm") return null;
  if (!isSwarmSpec(resource.spec)) return null;
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: resource.metadata,
    spec: resource.spec,
  };
}

/**
 * Resource<unknown>을 ToolResource로 타입 안전하게 변환
 */
function toToolResource(resource: Resource): ToolResource | null {
  if (resource.kind !== "Tool") return null;
  if (!isToolSpec(resource.spec)) return null;
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: resource.metadata,
    spec: resource.spec,
  };
}

/**
 * Resource<unknown>을 ExtensionResource로 타입 안전하게 변환
 */
function toExtensionResource(resource: Resource): ExtensionResource | null {
  if (resource.kind !== "Extension") return null;
  if (!isExtensionSpec(resource.spec)) return null;
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: resource.metadata,
    spec: resource.spec,
  };
}

// ============================================================================
// BundleLoader 구현
// ============================================================================

/**
 * BundleLoaderImpl 생성 옵션
 */
export interface BundleLoaderImplOptions {
  /** BundleLoadResult */
  bundleLoadResult: BundleLoadResult;
  /** Bundle 루트 디렉토리 (systemRef 등의 상대 경로 해석에 사용) */
  bundleRootDir: string;
}

/**
 * BundleLoader 구현 생성
 *
 * BundleLoadResult의 Resource<unknown> 데이터를 타입 가드를 통해
 * 구체적인 리소스 타입으로 안전하게 변환합니다.
 */
export function createBundleLoaderImpl(
  options: BundleLoaderImplOptions
): BundleLoader {
  const { bundleLoadResult, bundleRootDir } = options;

  return {
    getResource<TSpec>(kind: string, name: string): Resource<TSpec> | undefined {
      const resource = bundleLoadResult.getResource(kind, name);
      if (!resource) {
        return undefined;
      }
      // BundleLoadResult에서 파싱/검증된 리소스를 제네릭 타입으로 반환
      // 제네릭 메서드의 TSpec은 호출자가 kind에 맞게 지정하는 계약
      const typed: Resource<TSpec> = {
        apiVersion: resource.apiVersion,
        kind: resource.kind,
        metadata: resource.metadata,
        spec: resource.spec as TSpec,
      };
      return typed;
    },

    getSwarmForAgent(agent: AgentResource): SwarmResource {
      const swarms = bundleLoadResult.getResourcesByKind("Swarm");

      for (const swarm of swarms) {
        const typed = toSwarmResource(swarm);
        if (!typed) continue;

        for (const agentRef of typed.spec.agents) {
          const agentName = extractAgentName(agentRef);
          if (agentName === agent.metadata.name) {
            return typed;
          }
        }
      }

      // Fallback: 첫 번째 Swarm 반환
      const firstSwarm = swarms[0];
      if (!firstSwarm) {
        throw new Error(`No Swarm found for agent: ${agent.metadata.name}`);
      }

      const typed = toSwarmResource(firstSwarm);
      if (!typed) {
        throw new Error(`Invalid Swarm spec for: ${firstSwarm.metadata.name}`);
      }
      return typed;
    },

    async resolveToolRefs(toolRefs: unknown[] | undefined): Promise<ToolResource[]> {
      if (!toolRefs || toolRefs.length === 0) {
        return [];
      }

      const tools: ToolResource[] = [];

      for (const ref of toolRefs) {
        const resolved = resolveRef(ref);
        if (!resolved) {
          continue;
        }

        const resource = bundleLoadResult.getResource(resolved.kind, resolved.name);
        if (resource) {
          const toolResource = toToolResource(resource);
          if (toolResource) {
            tools.push(toolResource);
          }
        }
      }

      return tools;
    },

    async resolveExtensionRefs(
      extensionRefs: unknown[] | undefined
    ): Promise<ExtensionResource[]> {
      if (!extensionRefs || extensionRefs.length === 0) {
        return [];
      }

      const extensions: ExtensionResource[] = [];

      for (const ref of extensionRefs) {
        const resolved = resolveRef(ref);
        if (!resolved) {
          continue;
        }

        const resource = bundleLoadResult.getResource(resolved.kind, resolved.name);
        if (resource) {
          const extensionResource = toExtensionResource(resource);
          if (extensionResource) {
            extensions.push(extensionResource);
          }
        }
      }

      return extensions;
    },

    async loadSystemPrompt(
      prompts: { system?: string; systemRef?: string } | undefined
    ): Promise<string> {
      if (!prompts) {
        return "";
      }

      // 인라인 시스템 프롬프트
      if (prompts.system) {
        return prompts.system;
      }

      // 파일 참조 시스템 프롬프트
      if (prompts.systemRef) {
        const promptPath = path.resolve(bundleRootDir, prompts.systemRef);
        try {
          return await fs.promises.readFile(promptPath, "utf-8");
        } catch {
          return `[Failed to load system prompt from: ${prompts.systemRef}]`;
        }
      }

      return "";
    },
  };
}
