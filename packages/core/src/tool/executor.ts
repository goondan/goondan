/**
 * ToolExecutor 구현
 * @see /docs/specs/tool.md - 5. Tool 실행 흐름, 6. Tool 결과 처리, 7. Tool 오류 처리
 *
 * ToolExecutor는 Tool 호출을 실행하고 결과를 반환합니다.
 * 예외를 외부로 전파하지 않고 ToolResult로 변환합니다.
 */

import type { ToolRegistry } from './registry.js';
import type { ToolCatalog } from './catalog.js';
import type { ToolCall, ToolResult, ToolContext } from './types.js';
import {
  createToolErrorResult,
  createToolNotInCatalogResult,
  createToolSuccessResult,
  createToolPendingResult,
  isAsyncToolResult,
} from './utils.js';

/**
 * ToolNotFoundError
 */
class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = 'ToolNotFoundError';
  }
}

/**
 * Tool 실행기
 */
export class ToolExecutor {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * 단일 Tool 호출을 실행
   *
   * @param toolCall - Tool 호출 정보
   * @param context - Tool 실행 컨텍스트
   * @param catalog - Tool Catalog (errorMessageLimit 참조용)
   * @returns Tool 실행 결과
   */
  async execute(
    toolCall: ToolCall,
    context: ToolContext,
    catalog?: ToolCatalog
  ): Promise<ToolResult> {
    const { id: toolCallId, name: toolName, args } = toolCall;

    // 기본 정책: 현재 Step의 Tool Catalog에 없는 도구는 거부
    if (catalog && !catalog.has(toolName)) {
      return createToolNotInCatalogResult(toolCallId, toolName);
    }

    try {
      // Registry에서 Tool 조회
      const toolDef = this.registry.get(toolName);

      if (!toolDef) {
        throw new ToolNotFoundError(toolName);
      }

      // 핸들러 실행
      const output = await Promise.resolve(toolDef.handler(context, args));

      // 비동기 결과 처리
      if (isAsyncToolResult(output)) {
        const asyncOutput = output;
        return createToolPendingResult(
          toolCallId,
          toolName,
          asyncOutput.handle,
          output
        );
      }

      // 성공 결과 반환
      return createToolSuccessResult(toolCallId, toolName, output);
    } catch (error) {
      // Catalog에서 Tool 리소스 조회 (errorMessageLimit용)
      const catalogItem = catalog?.get(toolName);
      const toolResource = catalogItem?.tool ?? undefined;

      return createToolErrorResult(
        toolCallId,
        toolName,
        error,
        toolResource ?? undefined
      );
    }
  }

  /**
   * 여러 Tool 호출을 병렬로 실행
   *
   * @param toolCalls - Tool 호출 배열
   * @param context - Tool 실행 컨텍스트
   * @param catalog - Tool Catalog
   * @returns Tool 실행 결과 배열
   */
  async executeAll(
    toolCalls: ToolCall[],
    context: ToolContext,
    catalog?: ToolCatalog
  ): Promise<ToolResult[]> {
    const promises = toolCalls.map((toolCall) =>
      this.execute(toolCall, context, catalog)
    );

    return Promise.all(promises);
  }
}
