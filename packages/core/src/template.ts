import nunjucks from "nunjucks";
import { type Json } from "./types.ts";

function json(value: unknown, indent = 2): string { return JSON.stringify(value, undefined, indent === 0 ? undefined : 2); }

export class TemplateRenderer {
  readonly #environment: nunjucks.Environment;
  readonly #templates: ReadonlyMap<string, string>;
  constructor(templates: ReadonlyMap<string, string>) {
    this.#templates = templates;
    const loader: nunjucks.ILoader = { async: false, getSource(name) { const source = templates.get(name); if (source === undefined) throw new Error(`Template not found: ${name}`); return { src: source, path: name, noCache: true }; } };
    this.#environment = new nunjucks.Environment(loader, { autoescape: false, throwOnUndefined: true, trimBlocks: true, lstripBlocks: true });
    this.#environment.addFilter("json", json);
  }
  render(name: string, variables: Record<string, Json>): string {
    const template = this.#environment.getTemplate(name, true);
    return template.render(variables);
  }
  validate(): void {
    const unsupported = /{[%{]\s*(macro|extends|import|from|call|filter)\b/;
    for (const [name, source] of this.#templates) {
      if (unsupported.test(source)) throw new Error(`Unsupported Jinja syntax in ${name}`);
      this.#environment.getTemplate(name, true);
    }
  }
}
