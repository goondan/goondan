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
      if (!isToolResource(tool)) {
        throw new Error(`Tool ${tool?.metadata?.name}에 spec.entry가 필요합니다.`);
      }
      await this.registerToolResource(tool);
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
    const mod = await import(moduleUrl);
    const handlers = extractHandlers(mod);

    const exportsList = toolResource.spec.exports || [];
    if (exportsList.length === 0) {
      throw new Error(`Tool ${toolResource.metadata?.name}에 exports가 정의되어야 합니다.`);
    }

    for (const exportDef of exportsList) {
      const name = exportDef.name;
      const handler = resolveHandler(handlers, exportDef);
      if (!handler) {
        throw new Error(`Tool export ${name}에 대한 핸들러를 찾을 수 없습니다.`);
      }
      this.exports.set(name, {
        tool: toolResource,
        definition: exportDef,
        handler,
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
      const refLike = toObjectRefLike(ref);
      if (!refLike) continue;
      const toolResource = resolveRef(this.registry, refLike, 'Tool');
      if (!toolResource || !isToolResource(toolResource)) continue;
      const exportsList = toolResource.spec?.exports || [];
      for (const exportDef of exportsList) {
        catalog.push({
          name: exportDef.name,
          description: exportDef.description || '',
          parameters: isJsonObject(exportDef.parameters)
            ? exportDef.parameters
            : { type: 'object', additionalProperties: true },
          tool: toolResource,
          export: exportDef,
          source: { type: 'tool', name: toolResource.metadata?.name },
        });
      }
    }
    return catalog;
  }
}

function resolveHandler(handlers: unknown, exportDef: ToolExportDef): ToolHandler | null {
  if (isToolHandler(handlers)) return handlers;
  if (!isRecord(handlers)) return null;
  const direct = handlers[exportDef.name];
  if (isToolHandler(direct)) return direct;
  if (exportDef.handler) {
    const byHandler = handlers[exportDef.handler];
    if (isToolHandler(byHandler)) return byHandler;
  }
  return null;
}

function extractHandlers(mod: unknown): unknown {
  if (!isRecord(mod)) return mod;
  return mod.handlers || mod.default || mod;
}

function isToolResource(resource: Resource): resource is ToolResource {
  if (!isRecord(resource)) return false;
  if (typeof resource.kind !== 'string') return false;
  const metadata = resource.metadata;
  if (!isRecord(metadata) || typeof metadata.name !== 'string') return false;
  const spec = resource.spec;
  return isRecord(spec) && typeof spec.entry === 'string';
}

function toObjectRefLike(value: unknown): ObjectRefLike | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  const kind = typeof value.kind === 'string' ? value.kind : undefined;
  const name = typeof value.name === 'string' ? value.name : undefined;
  if (!kind && !name) return null;
  const apiVersion = typeof value.apiVersion === 'string' ? value.apiVersion : undefined;
  return {
    ...(apiVersion ? { apiVersion } : {}),
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && !Array.isArray(value);
}

function isToolHandler(value: unknown): value is ToolHandler {
  return typeof value === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
