import { includeSegments, renderKey, resolveIncludeKey } from "./template-load.ts";
import { renderTemplate, TemplateRenderError, type RenderEnvironment } from "./template-render.ts";
import { checkTemplate, type TemplateAst } from "./template-syntax.ts";
import { type Json } from "./types.ts";

export { TemplateRenderError } from "./template-render.ts";

/**
 * Renders the templates the reference phase read. It never touches the file system: every template
 * and every statically included file is already in the map, keyed by its absolute path.
 */
export class TemplateRenderer {
  readonly #templates: ReadonlyMap<string, string>;
  readonly #directory: string;
  readonly #parsed = new Map<string, TemplateAst>();
  readonly #environment: RenderEnvironment;

  constructor(templates: ReadonlyMap<string, string>, directory = ".") {
    this.#templates = templates;
    this.#directory = directory;
    this.#environment = {
      template: (key) => this.#ast(key),
      resolveInclude: (from, path) => resolveIncludeKey(from, includeSegments(path)),
    };
  }

  #ast(key: string): TemplateAst {
    const cached = this.#parsed.get(key);
    if (cached) return cached;
    const source = this.#templates.get(key);
    if (source === undefined) throw new TemplateRenderError(`Template not loaded: ${key}`);
    const check = checkTemplate(source);
    if (!check.ok) throw new TemplateRenderError(`Template ${key} is not valid`);
    this.#parsed.set(key, check.ast);
    return check.ast;
  }

  /** Renders a loaded template. `name` is its absolute path or a configuration-relative path. */
  render(name: string, variables: Record<string, Json>): string {
    const key = renderKey(this.#templates, this.#directory, name);
    if (key === undefined) throw new TemplateRenderError(`Template not loaded: ${name}`);
    return renderTemplate(this.#environment, key, variables);
  }
}
