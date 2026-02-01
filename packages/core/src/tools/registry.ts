import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRef } from '../config/ref.js';
import type { ConfigRegistry } from '../config/registry.js';
import type {
  JsonObject,
  ObjectRefLike,
  Resource,
  ToolCatalogItem,
  ToolHandler,
  ToolSpec,
  ToolExportSpec as SdkToolExportSpec,
} from '../sdk/types.js';

export interface ToolExportDef extends SdkToolExportSpec {}

export interface ToolResource extends Resource<ToolSpec> {}

interface ToolRegistryOptions {
  registry: ConfigRegistry;
  baseDir?: string;
  logger?: Console;
}

export class ToolRegistry {
  registry: ConfigRegistry;
  baseDir: string;
  logger: Console;
  exports: Map<string, { tool: ToolResource | null; definition: ToolExportDef; handler: ToolHandler; owner?: string }>;

  constructor({ registry, baseDir, logger }: ToolRegistryOptions) {
    this.registry = registry;
    this.baseDir = baseDir || registry?.baseDir || process.cwd();
    this.logger = logger || console;
    this.exports = new Map();
  }

  async loadAllTools(): Promise<void> {
    const tools = this.registry.list('Tool');
    for (const tool of tools) {
      await this.registerToolResource(tool as unknown as ToolResource);
    }
  }

  async registerToolResource(toolResource: ToolResource): Promise<void> {
    if (!toolResource?.spec?.entry) {
      throw new Error(`Tool ${toolResource?.metadata?.name}에 spec.entry가 필요합니다.`);
    }
    if (toolResource.spec.runtime && toolResource.spec.runtime !== 'node') {
      throw new Error(`Tool runtime은 node만 지원합니다: ${toolResource.metadata?.name}`);
    }

    const entryPath = path.isAbsolute(toolResource.spec.entry)
      ? toolResource.spec.entry
      : path.join(this.baseDir, toolResource.spec.entry);

    const moduleUrl = pathToFileURL(entryPath).href;
    const mod = (await import(moduleUrl)) as { [key: string]: unknown };
    const handlers = mod.handlers || mod.default || mod;

    const exportsList = toolResource.spec.exports || [];
    if (exportsList.length === 0) {
      throw new Error(`Tool ${toolResource.metadata?.name}에 exports가 정의되어야 합니다.`);
    }

    for (const exportDef of exportsList) {
      const name = exportDef.name;
      const handler =
        (handlers as { [key: string]: unknown })[name] ||
        (handlers as { [key: string]: unknown })[exportDef.handler || ''] ||
        handlers;
      if (typeof handler !== 'function') {
        throw new Error(`Tool export ${name}에 대한 핸들러를 찾을 수 없습니다.`);
      }
      this.exports.set(name, {
        tool: toolResource,
        definition: exportDef,
        handler: handler as ToolHandler,
      });
    }
  }

  getExport(exportName: string) {
    return this.exports.get(exportName) || null;
  }

  removeByOwner(owner: string): void {
    for (const [name, entry] of this.exports.entries()) {
      if (entry.owner === owner) {
        this.exports.delete(name);
      }
    }
  }

  buildCatalog(toolRefs: Array<ObjectRefLike>): ToolCatalogItem[] {
    const catalog: ToolCatalogItem[] = [];
    for (const ref of toolRefs) {
      const toolResource = resolveRef(this.registry, ref as ObjectRefLike, 'Tool') as ToolResource | null;
      if (!toolResource) continue;
      const exportsList = toolResource.spec?.exports || [];
      for (const exportDef of exportsList) {
        catalog.push({
          name: exportDef.name,
          description: exportDef.description || '',
          parameters: (exportDef.parameters || { type: 'object', additionalProperties: true }) as JsonObject,
          tool: toolResource as ToolResource,
          export: exportDef,
          source: { type: 'tool', name: toolResource.metadata?.name } as JsonObject,
        });
      }
    }
    return catalog;
  }
}
