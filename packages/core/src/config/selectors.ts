import { deepMerge } from '../utils/merge.js';
import type { ConfigRegistry, Resource } from './registry.js';

interface Selector {
  kind?: string;
  name?: string;
  matchLabels?: Record<string, string>;
}

interface SelectorBlock {
  selector: Selector;
  overrides?: Record<string, unknown>;
}

export function resolveSelectorList(
  list: Array<Resource | SelectorBlock | Record<string, unknown>> = [],
  registry: ConfigRegistry
): Array<Resource | SelectorBlock | Record<string, unknown>> {
  const resolved: Array<Resource | SelectorBlock | Record<string, unknown>> = [];

  for (const item of list) {
    if (item && typeof item === 'object' && 'selector' in item) {
      const selected = resolveSelector(item.selector as Selector, registry);
      const overrides = (item as SelectorBlock).overrides || {};
      for (const resource of selected) {
        const merged = overrides ? deepMerge(resource, overrides as Resource) : resource;
        resolved.push(merged as Resource);
      }
      continue;
    }
    resolved.push(item);
  }

  return resolved;
}

function resolveSelector(selector: Selector, registry: ConfigRegistry): Resource[] {
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
