import { jsonEqual, jsonPrettyText, jsonText } from "./json.ts";
import { type Expr, type FilterName, type Primitive, type TemplateAst, type TemplateNode } from "./template-syntax.ts";
import { type Json } from "./types.ts";

/** A template rendering failure. Every caller turns it into a `runtime_error` of its own stage. */
export class TemplateRenderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateRenderError";
  }
}

const undefinedValue = Symbol("goondan.template.undefined");
type Value = Json | typeof undefinedValue;

/** The template a rendering run can reach, resolved through the preloaded map. */
export interface RenderEnvironment {
  template(key: string): TemplateAst;
  resolveInclude(from: string, path: string): string;
}

interface LoopFrame { index0: number; length: number }

function loopRecord(frame: LoopFrame): Record<string, Json> {
  return {
    index: frame.index0 + 1,
    index0: frame.index0,
    first: frame.index0 === 0,
    last: frame.index0 === frame.length - 1,
    length: frame.length,
  };
}

/** `값 출력`: strings print as they are, every other JSON value prints as its JSON text. */
function asText(value: Json): string {
  return typeof value === "string" ? value : jsonText(value);
}

/** `식의 값`: `false`, `null`, `0`, `""`, `[]` and `{}` are false, every other value is true. */
function truthy(value: Json): boolean {
  if (value === null || value === false) return false;
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function replaceAllUpTo(text: string, search: string, replacement: string, limit: number): string {
  let result = "";
  let index = 0;
  let done = 0;
  while (done < limit) {
    const found = text.indexOf(search, index);
    if (found < 0) break;
    result += text.slice(index, found) + replacement;
    index = found + search.length;
    done += 1;
  }
  return result + text.slice(index);
}

function applyFilter(name: FilterName, input: Value, args: readonly Primitive[]): Value {
  if (name === "default") return input === undefinedValue ? (args[0] ?? null) : input;
  if (input === undefinedValue) throw new TemplateRenderError(`an undefined value cannot be the input of ${name}`);
  if (name === "join") {
    if (!Array.isArray(input)) throw new TemplateRenderError("join requires an array");
    const separator = args[0];
    return input.map((item) => asText(item)).join(typeof separator === "string" ? separator : "");
  }
  if (name === "length") {
    if (typeof input === "string") return [...input].length;
    if (Array.isArray(input)) return input.length;
    if (input !== null && typeof input === "object") return Object.keys(input).length;
    throw new TemplateRenderError("length requires a string, an array or an object");
  }
  if (name === "json") return args[0] === 0 ? jsonText(input) : jsonPrettyText(input);
  const text = asText(input);
  if (name === "trim") return text.replace(/^\p{White_Space}+/u, "").replace(/\p{White_Space}+$/u, "");
  if (name === "upper") return text.toUpperCase();
  if (name === "lower") return text.toLowerCase();
  const [search, replacement, limit] = args;
  if (typeof search !== "string" || typeof replacement !== "string") throw new TemplateRenderError("replace requires string arguments");
  return replaceAllUpTo(text, search, replacement, typeof limit === "number" ? limit : Number.POSITIVE_INFINITY);
}

class Renderer {
  readonly #environment: RenderEnvironment;
  constructor(environment: RenderEnvironment) { this.#environment = environment; }

  render(key: string, scope: ReadonlyMap<string, Json>, loops: readonly LoopFrame[]): string {
    return this.#nodes(this.#environment.template(key).nodes, key, scope, loops);
  }

  #nodes(nodes: readonly TemplateNode[], key: string, scope: ReadonlyMap<string, Json>, loops: readonly LoopFrame[]): string {
    let out = "";
    for (const node of nodes) {
      if (node.kind === "text") { out += node.text; continue; }
      if (node.kind === "output") { out += asText(this.#defined(node.expr, scope, loops)); continue; }
      if (node.kind === "if") {
        const branch = truthy(this.#defined(node.cond, scope, loops)) ? node.body : node.alternate;
        out += this.#nodes(branch, key, scope, loops);
        continue;
      }
      if (node.kind === "include") {
        out += this.render(this.#environment.resolveInclude(key, node.path), scope, []);
        continue;
      }
      const items = this.#defined(node.arr, scope, loops);
      if (!Array.isArray(items)) throw new TemplateRenderError(`for requires an array, ${node.name} received ${jsonText(items)}`);
      for (let index = 0; index < items.length; index += 1) {
        const inner = new Map(scope);
        inner.set(node.name, items[index] ?? null);
        out += this.#nodes(node.body, key, inner, [...loops, { index0: index, length: items.length }]);
      }
    }
    return out;
  }

  #defined(expr: Expr, scope: ReadonlyMap<string, Json>, loops: readonly LoopFrame[]): Json {
    const value = this.#value(expr, scope, loops);
    if (value === undefinedValue) throw new TemplateRenderError("an undefined value cannot be used here");
    return value;
  }

  #value(expr: Expr, scope: ReadonlyMap<string, Json>, loops: readonly LoopFrame[]): Value {
    switch (expr.kind) {
      case "literal": return expr.value;
      case "var": {
        const frame = loops[loops.length - 1];
        if (expr.name === "loop" && frame) return loopRecord(frame);
        const value = scope.get(expr.name);
        return scope.has(expr.name) && value !== undefined ? value : undefinedValue;
      }
      case "member": {
        const target = this.#defined(expr.target, scope, loops);
        if (target === null || typeof target !== "object" || Array.isArray(target)) return undefinedValue;
        return Object.hasOwn(target, expr.key) ? target[expr.key] ?? null : undefinedValue;
      }
      case "index": {
        const target = this.#defined(expr.target, scope, loops);
        if (!Array.isArray(target) || expr.index >= target.length) return undefinedValue;
        return target[expr.index] ?? null;
      }
      case "filter": return applyFilter(expr.name, this.#value(expr.target, scope, loops), expr.args);
      case "defined": return this.#value(expr.target, scope, loops) !== undefinedValue;
      case "not": return !truthy(this.#defined(expr.target, scope, loops));
      case "and": {
        const left = this.#defined(expr.left, scope, loops);
        return truthy(left) ? this.#defined(expr.right, scope, loops) : left;
      }
      case "or": {
        const left = this.#defined(expr.left, scope, loops);
        return truthy(left) ? left : this.#defined(expr.right, scope, loops);
      }
      case "equal": {
        const equal = jsonEqual(this.#defined(expr.left, scope, loops), this.#defined(expr.right, scope, loops));
        return expr.negated ? !equal : equal;
      }
      case "conditional": {
        const branch = truthy(this.#defined(expr.cond, scope, loops)) ? expr.then : expr.otherwise;
        return this.#value(branch, scope, loops);
      }
    }
  }
}

/** Renders one loaded template with the JSON variables its declaration site provides. */
export function renderTemplate(environment: RenderEnvironment, key: string, variables: Record<string, Json>): string {
  const scope = new Map<string, Json>();
  for (const name of Object.keys(variables)) {
    const value = variables[name];
    if (value !== undefined) scope.set(name, value);
  }
  return new Renderer(environment).render(key, scope, []);
}
