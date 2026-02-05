/**
 * ToolRegistry 구현
 * @see /docs/specs/tool.md - 1.1 Tool Registry
 *
 * Tool Registry는 Runtime이 보유한 실행 가능한 전체 도구 엔드포인트(핸들러 포함) 집합입니다.
 * Tool 리소스 로딩 및 동적 등록(api.tools.register)으로 구성됩니다.
 */

import type { DynamicToolDefinition, ToolRegistryApi } from './types.js';

/**
 * Tool Registry
 *
 * 동적 Tool을 등록하고 관리합니다.
 */
export class ToolRegistry implements ToolRegistryApi {
  private readonly tools: Map<string, DynamicToolDefinition>;

  constructor() {
    this.tools = new Map();
  }

  /**
   * 동적 Tool을 등록
   * 같은 이름으로 재등록하면 덮어씁니다 (last-wins)
   *
   * @param toolDef - Tool 정의
   */
  register(toolDef: DynamicToolDefinition): void {
    this.tools.set(toolDef.name, toolDef);
  }

  /**
   * 등록된 Tool을 제거
   * 존재하지 않는 Tool을 제거해도 오류가 발생하지 않습니다.
   *
   * @param name - Tool 이름
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * 등록된 Tool을 조회
   *
   * @param name - Tool 이름
   * @returns Tool 정의 또는 undefined
   */
  get(name: string): DynamicToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 등록된 모든 Tool 목록을 반환
   * 반환된 배열은 복사본입니다.
   *
   * @returns Tool 정의 배열
   */
  list(): DynamicToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Tool이 등록되어 있는지 확인
   *
   * @param name - Tool 이름
   * @returns 등록 여부
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 모든 Tool을 제거
   */
  clear(): void {
    this.tools.clear();
  }
}
