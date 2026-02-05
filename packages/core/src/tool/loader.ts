/**
 * ToolLoader 구현
 * @see /docs/specs/tool.md - 4.2 핸들러 모듈 형식
 *
 * ToolLoader는 Tool 리소스의 entry 파일에서 handlers 객체를 로드합니다.
 */

import type { Resource } from '../types/resource.js';
import type { ToolSpec, ToolExport } from '../types/specs/tool.js';
import type { ToolHandler, HandlerValidationResult } from './types.js';

/**
 * 동적 import 함수 타입
 */
type ImportFunction = (path: string) => Promise<unknown>;

/**
 * Tool 모듈 로더
 */
export class ToolLoader {
  private importFn: ImportFunction;

  constructor() {
    // 기본 import 함수 설정 (테스트에서 mock 가능)
    this.importFn = (path: string) => import(path);
  }

  /**
   * import 함수를 설정 (테스트용)
   *
   * @param fn - import 함수
   */
  setImportFunction(fn: ImportFunction): void {
    this.importFn = fn;
  }

  /**
   * entry 파일에서 handlers 객체를 로드
   *
   * @param entry - 엔트리 파일 경로 (상대/절대)
   * @param bundleRoot - Bundle 루트 경로
   * @returns handlers 객체
   * @throws 모듈 로드 실패 또는 handlers export 없음
   */
  async loadHandlers(
    entry: string,
    bundleRoot: string
  ): Promise<Record<string, ToolHandler>> {
    // 경로 정규화
    const absolutePath = this.resolvePath(entry, bundleRoot);

    // 모듈 로드
    const module = await this.importFn(absolutePath);

    // handlers export 확인
    if (!this.isModuleWithHandlers(module)) {
      throw new Error(
        `Tool module at ${absolutePath} must export a 'handlers' object`
      );
    }

    const handlers = module.handlers;

    // handlers가 객체인지 확인
    if (typeof handlers !== 'object' || handlers === null) {
      throw new Error(
        `Tool module at ${absolutePath} 'handlers' must be an object`
      );
    }

    return handlers;
  }

  /**
   * Tool 리소스에서 핸들러를 로드
   *
   * @param toolResource - Tool 리소스
   * @param bundleRoot - Bundle 루트 경로
   * @returns handlers 객체
   */
  async loadFromToolResource(
    toolResource: Resource<ToolSpec>,
    bundleRoot: string
  ): Promise<Record<string, ToolHandler>> {
    const { entry, exports: toolExports } = toolResource.spec;

    // 핸들러 로드
    const handlers = await this.loadHandlers(entry, bundleRoot);

    // export와 handler 매핑 검증
    const validation = this.validateHandlers(handlers, toolExports);

    if (!validation.valid) {
      for (const missing of validation.missingHandlers) {
        console.warn(
          `[ToolLoader] Warning: No handler found for export '${missing}' in tool '${toolResource.metadata.name}'`
        );
      }
    }

    return handlers;
  }

  /**
   * handlers와 exports의 매핑을 검증
   *
   * @param handlers - handlers 객체
   * @param exports - Tool exports
   * @returns 검증 결과
   */
  validateHandlers(
    handlers: Record<string, ToolHandler>,
    exports: ToolExport[]
  ): HandlerValidationResult {
    const missingHandlers: string[] = [];

    for (const toolExport of exports) {
      if (!(toolExport.name in handlers)) {
        missingHandlers.push(toolExport.name);
      }
    }

    return {
      valid: missingHandlers.length === 0,
      missingHandlers,
    };
  }

  /**
   * 경로를 절대 경로로 정규화
   */
  private resolvePath(entry: string, bundleRoot: string): string {
    // 절대 경로면 그대로 반환
    if (entry.startsWith('/')) {
      return entry;
    }

    // 상대 경로 처리 (./ 제거)
    const normalizedEntry = entry.startsWith('./')
      ? entry.slice(2)
      : entry;

    // bundleRoot와 결합
    return `${bundleRoot}/${normalizedEntry}`;
  }

  /**
   * 모듈에 handlers export가 있는지 확인
   */
  private isModuleWithHandlers(
    module: unknown
  ): module is { handlers: Record<string, ToolHandler> } {
    return (
      typeof module === 'object' &&
      module !== null &&
      'handlers' in module
    );
  }
}
