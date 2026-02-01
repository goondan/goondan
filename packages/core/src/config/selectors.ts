import { deepMerge } from '../utils/merge.js';
import type { ConfigRegistry, Resource } from './registry.js';
import type { ObjectRefLike, SelectorBlock } from '../sdk/types.js';

export function resolveSelectorList(
  list: Array<Resource | SelectorBlock | ObjectRefLike> = [],
  registry: ConfigRegistry
): Array<Resource | SelectorBlock | ObjectRefLike> {
  const resolved: Array<Resource | SelectorBlock | ObjectRefLike> = [];

  for (const item of list) {
    if (item && typeof item === 'object' && 'selector' in item) {
      const selected = resolveSelector((item as SelectorBlock).selector, registry);
      const overrides = (item as SelectorBlock).overrides || {};
      for (const resource of selected) {
        const merged = overrides ? deepMerge(resource, overrides as unknown as Resource) : resource;
        resolved.push(merged as Resource);
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
