import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRef } from '../config/ref.js';
import type { ConfigRegistry, Resource } from '../config/registry.js';
import type { ExtensionSpec, JsonObject, ObjectRefLike } from '../sdk/types.js';

interface ExtensionResource extends Resource<ExtensionSpec<JsonObject>> {}

interface LoadOptions<TApi> {
  baseDir?: string;
  apiFactory: (resource: ExtensionResource) => TApi;
}

export async function loadExtensions<TApi>(
  agentConfig: Resource,
  registry: ConfigRegistry,
  options: LoadOptions<TApi>
): Promise<Array<{ resource: ExtensionResource; api: TApi }>> {
  const baseDir = options.baseDir || registry?.baseDir || process.cwd();
  const apiFactory = options.apiFactory;
  const extensionRefs = extractExtensions(agentConfig?.spec);
  const loaded: Array<{ resource: ExtensionResource; api: TApi }> = [];

  for (const ref of extensionRefs) {
    const refLike = toObjectRefLike(ref);
    if (!refLike) continue;
    const extensionResource = resolveRef(registry, refLike, 'Extension');
    if (!extensionResource || !isExtensionResource(extensionResource)) {
      throw new Error(`Extension ${String(refLike)}에 spec.entry가 필요합니다.`);
    }
    const spec = extensionResource.spec;
    const entry = spec.entry;
    if (!entry) {
      throw new Error(`Extension ${extensionResource?.metadata?.name}에 spec.entry가 필요합니다.`);
    }
    if (spec?.runtime && spec.runtime !== 'node') {
      throw new Error(`Extension runtime은 node만 지원합니다: ${extensionResource.metadata?.name}`);
    }
    const entryPath = path.isAbsolute(entry) ? entry : path.join(baseDir, entry);
    const moduleUrl = pathToFileURL(entryPath).href;
    const mod = await import(moduleUrl);
    const register = extractRegister<TApi>(mod);
    if (!register) {
      throw new Error(`Extension ${extensionResource.metadata?.name}에 register(api) 함수가 필요합니다.`);
    }
    const api = apiFactory(extensionResource);
    await register(api);
    loaded.push({ resource: extensionResource, api });
  }

  return loaded;
}

function extractExtensions(spec: unknown): unknown[] {
  if (!isRecord(spec)) return [];
  const extensions = spec.extensions;
  return Array.isArray(extensions) ? extensions : [];
}

function isExtensionResource(resource: Resource): resource is ExtensionResource & { spec: ExtensionSpec<JsonObject> } {
  const spec = resource.spec;
  return isRecord(spec) && typeof spec.entry === 'string';
}

function extractRegister<TApi>(mod: unknown): ((api: TApi) => Promise<void> | void) | null {
  if (!isRecord(mod)) return null;
  const register = mod.register;
  if (typeof register !== 'function') return null;
  return (api: TApi) => register(api);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
