/**
 * ToolRegistry 구현
 * @see /docs/specs/extension.md - 6. Tool 등록 API
 */

import type { JsonObject, JsonValue } from '../types/json.js';
import type { DynamicToolDefinition, ToolRegistryApi, ToolContext } from './types.js';

/**
 * ToolRegistry 클래스
 * 동적 Tool 등록 및 관리
 */
export class ToolRegistry implements ToolRegistryApi {
  private readonly tools = new Map<string, DynamicToolDefinition>();

  /**
   * Tool 등록
   */
  register(toolDef: DynamicToolDefinition): void {
    this.tools.set(toolDef.name, toolDef);
  }

  /**
   * Tool 등록 해제
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Tool 조회
   */
  get(name: string): DynamicToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 모든 Tool 목록
   */
  list(): DynamicToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Tool 존재 여부 확인
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 모든 Tool 제거
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Tool 핸들러 실행
   */
  async invoke(
    name: string,
    ctx: ToolContext,
    input: JsonObject
  ): Promise<JsonValue> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    return tool.handler(ctx, input);
  }
}
