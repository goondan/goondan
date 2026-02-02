import { deepMerge } from '../utils/merge.js';
import type { ConfigRegistry, Resource } from './registry.js';
import type { JsonObject, ObjectRefLike, SelectorBlock } from '../sdk/types.js';

export function resolveSelectorList(
  list: Array<Resource | SelectorBlock | ObjectRefLike> = [],
  registry: ConfigRegistry
): Array<Resource | ObjectRefLike> {
  const resolved: Array<Resource | ObjectRefLike> = [];

  for (const item of list) {
    if (isSelectorBlock(item)) {
      const selected = resolveSelector(item.selector, registry);
      const overrides = item.overrides;
      for (const resource of selected) {
        if (overrides && isJsonObject(overrides)) {
          const merged = deepMerge(resource, overrides);
          if (!isResource(merged)) {
            throw new Error('selector overrides 결과가 Resource 형식이 아닙니다.');
          }
          resolved.push(merged);
        } else {
          resolved.push(resource);
        }
      }
      continue;
    }
    resolved.push(item);
  }

  return resolved;
}

function resolveSelector(selector: SelectorBlock['selector'], registry: ConfigRegistry): Resource[] {
  if (selector.kind && selector.name) {
    const resource = registry.get(selector.kind, selector.name);
    return resource ? [resource] : [];
  }
  if (selector.matchLabels) {
    const kind = selector.kind;
    if (!kind) {
      throw new Error('matchLabels selector는 kind를 포함해야 합니다.');
    }
    return registry.findByLabels(kind, selector.matchLabels);
  }
  throw new Error(`지원하지 않는 selector: ${JSON.stringify(selector)}`);
}

function isSelectorBlock(value: unknown): value is SelectorBlock {
  return isRecord(value) && isRecord(value.selector);
}

function isResource(value: unknown): value is Resource {
  if (!isRecord(value)) return false;
  if (typeof value.kind !== 'string') return false;
  const metadata = value.metadata;
  if (!isRecord(metadata)) return false;
  return typeof metadata.name === 'string';
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
