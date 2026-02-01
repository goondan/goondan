import type { UnknownObject } from '../sdk/types.js';

export function resolveTemplate(value: unknown, ctx: UnknownObject): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplate(item, ctx));
  }
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, 'expr')) {
      return evalExpr((value as { expr: string }).expr, ctx);
    }
    const out: { [key: string]: unknown } = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = resolveTemplate(val, ctx);
    }
    return out;
  }
  return value;
}

export function evalExpr(expr: unknown, ctx: UnknownObject): unknown {
  if (typeof expr !== 'string') return expr;
  if (!expr.startsWith('$.')) return expr;
  const path = expr.slice(2).split('.');
  let current: unknown = ctx as { [key: string]: unknown };
  for (const key of path) {
    if (current == null) return undefined;
    current = (current as { [key: string]: unknown })[key];
  }
  return current;
}
