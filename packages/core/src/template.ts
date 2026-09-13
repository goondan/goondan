import nunjucks from "nunjucks";
import { type Json } from "./types.ts";

function json(value: unknown, indent = 2): string { return JSON.stringify(value, undefined, indent === 0 ? undefined : 2); }

const allowedFilters = new Set(["default", "join", "trim", "length", "upper", "lower", "replace", "json"]);
const allowedTags = new Set(["if", "elif", "else", "endif", "for", "endfor", "include"]);

function withoutStrings(value: string): string {
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  return [...value].map((character) => {
    if (escaped) { escaped = false; return " "; }
    if (quote && character === "\\") { escaped = true; return " "; }
    if (quote) { if (character === quote) quote = undefined; return " "; }
    if (character === "\"" || character === "'") { quote = character; return " "; }
    return character;
  }).join("");
}

function validateExpression(name: string, expression: string): void {
  const unquoted = withoutStrings(expression);
  for (const match of unquoted.matchAll(/\|\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const filter = match[1];
    if (filter && !allowedFilters.has(filter)) throw new Error(`Unsupported filter ${filter} in ${name}`);
  }
  for (const match of unquoted.matchAll(/\bis\s+(?:not\s+)?([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const test = match[1];
    if (test && test !== "defined") throw new Error(`Unsupported test ${test} in ${name}`);
  }
}

function validateSyntax(name: string, source: string): void {
  for (const match of source.matchAll(/{%-?\s*([A-Za-z_][A-Za-z0-9_]*)([\s\S]*?)-?%}|{{-?([\s\S]*?)-?}}/g)) {
    const tag = match[1];
    if (tag) {
      if (!allowedTags.has(tag)) throw new Error(`Unsupported Jinja syntax in ${name}: ${tag}`);
      const expression = match[2] ?? "";
      if (tag === "include" && !/^\s*["']/.test(expression)) throw new Error(`Dynamic include is unsupported in ${name}`);
      validateExpression(name, expression);
    } else validateExpression(name, match[3] ?? "");
  }
}

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
    for (const [name, source] of this.#templates) {
      validateSyntax(name, source);
      this.#environment.getTemplate(name, true);
    }
  }
}
