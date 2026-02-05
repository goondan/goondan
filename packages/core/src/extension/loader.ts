/**
 * Extension 로더 구현
 * @see /docs/specs/extension.md - 10. Extension 로딩과 초기화
 */

import type { ExtensionResource } from '../types/specs/extension.js';
import type {
  EventBus,
  StateStore,
  ExtensionApi,
  RegisterFunction,
  ExtensionLoadResult,
} from './types.js';
import { createExtensionApi } from './api.js';
import { PipelineRegistry } from './pipeline-registry.js';
import { ToolRegistry } from './tool-registry.js';

/**
 * 로드된 Extension 정보
 */
interface LoadedExtension {
  name: string;
  resource: ExtensionResource;
  api: ExtensionApi;
  pipelineRegistry: PipelineRegistry;
  toolRegistry: ToolRegistry;
}

/**
 * ExtensionLoader 옵션
 */
export interface ExtensionLoaderOptions {
  eventBus: EventBus;
  stateStore: StateStore;
  logger?: Console;
}

/**
 * Extension 모듈 resolve 함수 타입
 */
export type ExtensionResolverFn = (
  extension: ExtensionResource
) => RegisterFunction;

/**
 * ExtensionLoader 클래스
 * Extension 모듈을 로드하고 초기화
 */
export class ExtensionLoader {
  private readonly eventBus: EventBus;
  private readonly stateStore: StateStore;
  private readonly logger?: Console;
  private readonly loadedExtensions = new Map<string, LoadedExtension>();

  constructor(options: ExtensionLoaderOptions) {
    this.eventBus = options.eventBus;
    this.stateStore = options.stateStore;
    this.logger = options.logger;
  }

  /**
   * 단일 Extension 로드
   */
  async loadExtension(
    extension: ExtensionResource,
    registerFn: RegisterFunction
  ): Promise<ExtensionLoadResult> {
    const name = extension.metadata.name;

    try {
      // 각 Extension별 PipelineRegistry와 ToolRegistry 생성
      const pipelineRegistry = new PipelineRegistry();
      const toolRegistry = new ToolRegistry();

      // ExtensionApi 생성
      const api = createExtensionApi({
        extension,
        eventBus: this.eventBus,
        stateStore: this.stateStore,
        logger: this.logger,
        pipelineRegistry,
        toolRegistry,
      });

      // register 함수 호출 (동기/비동기 모두 지원)
      await Promise.resolve(registerFn(api));

      // 로드된 Extension 저장
      this.loadedExtensions.set(name, {
        name,
        resource: extension,
        api,
        pipelineRegistry,
        toolRegistry,
      });

      this.logger?.debug?.(`Extension loaded: ${name}`);

      return {
        name,
        status: 'loaded',
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger?.error?.(`Extension load failed: ${name}`, err);

      return {
        name,
        status: 'failed',
        error: err,
      };
    }
  }

  /**
   * 여러 Extension 순차 로드
   * Agent.spec.extensions 배열 순서대로 로드
   */
  async loadExtensions(
    extensions: ExtensionResource[],
    resolver: ExtensionResolverFn
  ): Promise<ExtensionLoadResult[]> {
    const results: ExtensionLoadResult[] = [];

    for (const extension of extensions) {
      const registerFn = resolver(extension);
      const result = await this.loadExtension(extension, registerFn);
      results.push(result);

      // 실패 시 전체 초기화 중단
      if (result.status === 'failed') {
        throw result.error ?? new Error(`Extension failed: ${result.name}`);
      }
    }

    return results;
  }

  /**
   * 로드된 Extension 목록 조회
   */
  getLoadedExtensions(): ExtensionLoadResult[] {
    return Array.from(this.loadedExtensions.values()).map((ext) => ({
      name: ext.name,
      status: 'loaded' as const,
    }));
  }

  /**
   * 특정 Extension의 API 조회
   */
  getExtensionApi(name: string): ExtensionApi | undefined {
    return this.loadedExtensions.get(name)?.api;
  }

  /**
   * 특정 Extension의 PipelineRegistry 조회
   */
  getPipelineRegistry(name: string): PipelineRegistry | undefined {
    return this.loadedExtensions.get(name)?.pipelineRegistry;
  }

  /**
   * 특정 Extension의 ToolRegistry 조회
   */
  getToolRegistry(name: string): ToolRegistry | undefined {
    return this.loadedExtensions.get(name)?.toolRegistry;
  }

  /**
   * Extension 언로드
   */
  unloadExtension(name: string): void {
    const extension = this.loadedExtensions.get(name);
    if (extension) {
      // cleanup 이벤트 발행
      this.eventBus.emit('extension.cleanup', { name });

      // Extension 상태 초기화
      this.stateStore.clearExtensionState(name);

      // 로드된 Extension에서 제거
      this.loadedExtensions.delete(name);

      this.logger?.debug?.(`Extension unloaded: ${name}`);
    }
  }

  /**
   * 모든 Extension 언로드
   */
  unloadAll(): void {
    for (const name of this.loadedExtensions.keys()) {
      this.unloadExtension(name);
    }
  }

  /**
   * 모든 로드된 Extension의 PipelineRegistry 조합
   * 전체 파이프라인 실행 시 사용
   */
  getAllPipelineRegistries(): PipelineRegistry[] {
    return Array.from(this.loadedExtensions.values()).map(
      (ext) => ext.pipelineRegistry
    );
  }

  /**
   * 모든 로드된 Extension의 ToolRegistry 조합
   * 전체 Tool 카탈로그 구성 시 사용
   */
  getAllToolRegistries(): ToolRegistry[] {
    return Array.from(this.loadedExtensions.values()).map(
      (ext) => ext.toolRegistry
    );
  }
}
