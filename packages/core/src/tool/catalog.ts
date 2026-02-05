/**
 * ToolCatalog 구현
 * @see /docs/specs/tool.md - 1.1 Tool Catalog
 *
 * Tool Catalog는 특정 Step에서 LLM에 노출되는 도구 목록입니다.
 * Runtime은 매 Step마다 step.tools 파이프라인을 통해 Tool Catalog를 구성합니다.
 */

import type { Resource } from '../types/resource.js';
import type { ToolSpec } from '../types/specs/tool.js';
import type { ToolCatalogItem, LlmTool } from './types.js';

/**
 * Tool Catalog
 *
 * LLM에 노출되는 Tool 목록을 관리합니다.
 */
export class ToolCatalog {
  private readonly items: Map<string, ToolCatalogItem>;

  constructor() {
    this.items = new Map();
  }

  /**
   * Catalog에 항목을 추가
   * 같은 이름으로 재추가하면 덮어씁니다.
   *
   * @param item - Catalog 항목
   */
  add(item: ToolCatalogItem): void {
    this.items.set(item.name, item);
  }

  /**
   * Tool 리소스에서 모든 export를 Catalog에 추가
   *
   * @param toolResource - Tool 리소스
   */
  addFromToolResource(toolResource: Resource<ToolSpec>): void {
    const toolName = toolResource.metadata.name;

    for (const toolExport of toolResource.spec.exports) {
      const item: ToolCatalogItem = {
        name: toolExport.name,
        description: toolExport.description,
        parameters: toolExport.parameters,
        tool: toolResource,
        export: toolExport,
        source: {
          type: 'config',
          name: toolName,
        },
      };

      this.add(item);
    }
  }

  /**
   * Catalog에서 항목을 제거
   *
   * @param name - Tool 이름
   */
  remove(name: string): void {
    this.items.delete(name);
  }

  /**
   * Catalog에서 항목을 조회
   *
   * @param name - Tool 이름
   * @returns Catalog 항목 또는 undefined
   */
  get(name: string): ToolCatalogItem | undefined {
    return this.items.get(name);
  }

  /**
   * 모든 항목 목록을 반환
   *
   * @returns Catalog 항목 배열
   */
  list(): ToolCatalogItem[] {
    return Array.from(this.items.values());
  }

  /**
   * 항목이 존재하는지 확인
   *
   * @param name - Tool 이름
   * @returns 존재 여부
   */
  has(name: string): boolean {
    return this.items.has(name);
  }

  /**
   * 모든 항목을 제거
   */
  clear(): void {
    this.items.clear();
  }

  /**
   * LLM에 전달할 형식으로 변환
   *
   * @returns LLM Tool 배열
   */
  toLlmTools(): LlmTool[] {
    return this.list().map((item) => ({
      name: item.name,
      description: item.description ?? '',
      parameters: item.parameters ?? { type: 'object', properties: {} },
    }));
  }

  /**
   * Catalog의 복사본을 생성
   *
   * @returns 새 ToolCatalog 인스턴스
   */
  clone(): ToolCatalog {
    const cloned = new ToolCatalog();

    for (const item of this.items.values()) {
      // 얕은 복사 (item 객체 자체는 새로 생성)
      cloned.add({ ...item });
    }

    return cloned;
  }
}
