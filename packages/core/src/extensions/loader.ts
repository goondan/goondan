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
  const extensionRefs = (agentConfig?.spec as { extensions?: unknown[] })?.extensions || [];
  const loaded: Array<{ resource: ExtensionResource; api: TApi }> = [];

  for (const ref of extensionRefs) {
    const extensionResource = resolveRef(registry, ref as ObjectRefLike, 'Extension') as unknown as ExtensionResource;
    const spec = extensionResource?.spec as ExtensionSpec<JsonObject> | undefined;
    const entry = spec?.entry;
    if (!entry) {
      throw new Error(`Extension ${extensionResource?.metadata?.name}에 spec.entry가 필요합니다.`);
    }
    if (spec?.runtime && spec.runtime !== 'node') {
      throw new Error(`Extension runtime은 node만 지원합니다: ${extensionResource.metadata?.name}`);
    }
    const entryPath = path.isAbsolute(entry) ? entry : path.join(baseDir, entry);
    const moduleUrl = pathToFileURL(entryPath).href;
    const mod = (await import(moduleUrl)) as { register?: (api: TApi) => Promise<void> | void };
    if (typeof mod.register !== 'function') {
      throw new Error(`Extension ${extensionResource.metadata?.name}에 register(api) 함수가 필요합니다.`);
    }
    const api = apiFactory(extensionResource);
    await mod.register(api);
    loaded.push({ resource: extensionResource, api });
  }

  return loaded;
}
