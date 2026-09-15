import nunjucks from "nunjucks";
import { compareText, isRecord } from "./json.ts";

/** The filters `필터와 테스트` lists. */
export type FilterName = "default" | "join" | "trim" | "upper" | "lower" | "replace" | "length" | "json";
/** Literal values the common expression grammar allows. */
export type Primitive = string | number | boolean;

export type Expr =
  | { kind: "literal"; value: Primitive }
  | { kind: "var"; name: string }
  | { kind: "member"; target: Expr; key: string }
  | { kind: "index"; target: Expr; index: number }
  | { kind: "filter"; name: FilterName; target: Expr; args: readonly Primitive[] }
  | { kind: "defined"; target: Expr }
  | { kind: "not"; target: Expr }
  | { kind: "and"; left: Expr; right: Expr }
  | { kind: "or"; left: Expr; right: Expr }
  | { kind: "equal"; negated: boolean; left: Expr; right: Expr }
  | { kind: "conditional"; cond: Expr; then: Expr; otherwise: Expr };

export type TemplateNode =
  | { kind: "text"; text: string }
  | { kind: "output"; expr: Expr }
  | { kind: "if"; cond: Expr; body: readonly TemplateNode[]; alternate: readonly TemplateNode[] }
  | { kind: "for"; name: string; arr: Expr; body: readonly TemplateNode[] }
  | { kind: "include"; path: string };

/** A validated template: its nodes and every static `include` target in document order. */
export interface TemplateAst { nodes: readonly TemplateNode[]; includes: readonly string[] }

/** The outcome of checking one template file against `템플릿 지원 범위`. */
export type TemplateCheck =
  | { ok: true; ast: TemplateAst }
  | { ok: false; kind: "syntax" }
  | { ok: false; kind: "unsupported"; items: readonly string[] };

const allowedTags = new Set(["if", "elif", "else", "endif", "for", "endfor", "include"]);
const allowedFilters = new Set<string>(["default", "join", "trim", "upper", "lower", "replace", "length", "json"]);
const loopKeys = new Set(["index", "index0", "first", "last", "length"]);
const escapeCharacters = new Set(["\\", "'", "\"", "n", "t", "r"]);
const reservedNames = new Set(["not", "and", "or", "if", "else", "is", "in"]);
const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function isFilterName(value: string): value is FilterName {
  return allowedFilters.has(value);
}

/** `템플릿 파일을 읽을 때` normalization: drop one leading BOM and fold `\r\n` and `\r` to `\n`. */
export function normalizeTemplateSource(text: string): string {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return body.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/** `<항목>` list: the items of one file, without duplicates, in Unicode code point order. */
function unique(items: readonly string[]): string[] {
  return [...new Set(items)].sort(compareText);
}

interface CodeSpan { close: number; masked: string; syntax: boolean }

/**
 * Consumes one `{{ … }}` or `{% … %}` body. The returned `masked` text has every string literal
 * replaced by spaces so later checks never look inside one; positions stay aligned with the source.
 */
function scanCode(source: string, from: number, end: string): CodeSpan {
  let index = from;
  let masked = "";
  let syntax = false;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "'" || character === "\"") {
      let cursor = index + 1;
      let closed = false;
      masked += " ";
      while (cursor < source.length) {
        const current = source.charAt(cursor);
        if (current === "\\") {
          const next = source[cursor + 1];
          if (next === undefined || !escapeCharacters.has(next)) syntax = true;
          masked += "  ";
          cursor += 2;
          continue;
        }
        masked += " ";
        cursor += 1;
        if (current === character) { closed = true; break; }
      }
      if (!closed) return { close: -1, masked, syntax: true };
      index = cursor;
      continue;
    }
    if (source.startsWith(end, index)) return { close: index, masked, syntax };
    masked += character;
    index += 1;
  }
  return { close: -1, masked, syntax: true };
}

/** `for` bodies may only read `loop` through `.` access of the five documented keys. */
function loopUsageIsValid(masked: string): boolean {
  for (const match of masked.matchAll(/loop/gu)) {
    const at = match.index ?? 0;
    const before = masked.slice(0, at);
    if (/[A-Za-z0-9_]$/u.test(before)) continue;
    if (/^[A-Za-z0-9_]/u.test(masked.slice(at + 4))) continue;
    if (before.replace(/\s+$/u, "").endsWith(".")) continue;
    const access = /^\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(masked.slice(at + 4));
    const key = access?.[1];
    if (key === undefined || !loopKeys.has(key)) return false;
  }
  return true;
}

/**
 * `식`의 수 리터럴: the integer part is either the single digit `0` or starts with a non-zero digit,
 * so `012`, `00` and `01.5` are not numbers the grammar takes, and a fraction needs at least one
 * digit, so `1.` is not one either. The template engine lexes them as `12`, `0`, `1.5` and `1`,
 * which the parsed tree no longer tells apart from the plain spelling, so the spelling is checked
 * here. `masked` blanks out every string literal, and a digit that follows a name character or a
 * `.` is not the start of a number literal.
 */
function numberLiteralsAreValid(masked: string): boolean {
  for (const match of masked.matchAll(/[0-9]+(?:\.[0-9]+)?/gu)) {
    const at = match.index;
    if (at > 0 && /[A-Za-z0-9_.]/u.test(masked.charAt(at - 1))) continue;
    const [integer = ""] = match[0].split(".");
    if (integer.length > 1 && integer.startsWith("0")) return false;
    const after = at + match[0].length;
    if (masked.charAt(after) === "." && !/[0-9]/u.test(masked.charAt(after + 1))) return false;
  }
  return true;
}

interface ScanResult { source: string; tags: readonly string[]; syntax: boolean }

/** The spellings `식` reserves as literals, which are still ordinary names after a `.`. */
const literalNames = new Set(["true", "false", "none", "null"]);
const literalKeyAccess = /\.[ \t\n]*([A-Za-z_][A-Za-z0-9_]*)/gu;

/**
 * Rewrites `.true`, `.false`, `.none` and `.null` key access into bracket form. The template engine
 * lexes those four spellings as literals even directly after `.`, but `식`의 키 접근 takes any name
 * there and reads that JSON key, so without the rewrite a template the spec allows would be read as
 * a syntax error. `masked` blanks out every string literal, so a name written inside one is never
 * rewritten and positions stay aligned with `body`.
 */
function bracketLiteralKeys(body: string, masked: string): string {
  let out = "";
  let index = 0;
  literalKeyAccess.lastIndex = 0;
  for (let match = literalKeyAccess.exec(masked); match !== null; match = literalKeyAccess.exec(masked)) {
    const name = match[1];
    if (name === undefined || !literalNames.has(name.toLowerCase())) continue;
    out += body.slice(index, match.index) + `["${name}"]`;
    index = match.index + match[0].length;
  }
  return index === 0 ? body : out + body.slice(index);
}

/** The characters `태그와 공백` lets a `-` marker and the tag rules remove. */
const stripped = new Set([" ", "\t", "\n"]);

/**
 * The lexer pass of `템플릿 구성 오류`. It removes comments, applies every rule of `태그와 공백`
 * itself so that the result never depends on the template engine, collects tag names, and reports
 * the spellings the parsed tree hides: `+` whitespace markers, unsupported string escapes and
 * non-`.` reads of `loop`. The text it returns carries no `-` markers, so the engine that parses it
 * cannot apply its own whitespace rules on top.
 */
function scan(source: string): ScanResult {
  let out = "";
  let index = 0;
  let forDepth = 0;
  let syntax = false;
  // Rule 3 needs to know whether the current line still holds spaces and tabs only, and where that
  // prefix begins in `out`. A tag or comment ends the prefix even though it prints nothing.
  let dirty = false;
  let prefix = 0;
  const tags: string[] = [];

  /** Rule 4 before a marked delimiter, and rule 3 before a tag or comment that is not marked. */
  const before = (marked: boolean, tag: boolean): void => {
    if (marked) out = out.replace(/[ \t\n]+$/u, "");
    else if (tag && !dirty) out = out.slice(0, prefix);
  };
  /** Rule 4 after a marked delimiter, and rule 2 after a tag or comment that is not marked. */
  const after = (marked: boolean, tag: boolean): void => {
    dirty = true;
    prefix = out.length;
    if (marked) {
      while (index < source.length && stripped.has(source.charAt(index))) index += 1;
      return;
    }
    if (tag && source.charAt(index) === "\n") { index += 1; dirty = false; prefix = out.length; }
  };

  while (index < source.length) {
    if (source.startsWith("{#", index)) {
      const close = source.indexOf("#}", index + 2);
      if (close < 0) { syntax = true; break; }
      const body = source.slice(index + 2, close);
      if (body.startsWith("+") || body.endsWith("+")) syntax = true;
      before(body.startsWith("-"), true);
      index = close + 2;
      after(body.endsWith("-"), true);
      continue;
    }
    const block = source.startsWith("{%", index);
    if (block || source.startsWith("{{", index)) {
      const end = block ? "%}" : "}}";
      const code = scanCode(source, index + 2, end);
      if (code.syntax) syntax = true;
      if (code.close < 0) { syntax = true; break; }
      if (code.masked.startsWith("+") || code.masked.endsWith("+")) syntax = true;
      const open = code.masked.startsWith("-");
      const shut = code.masked.endsWith("-");
      let name: string | undefined;
      if (block) {
        name = /^[-+]?\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(code.masked)?.[1];
        if (name === undefined) syntax = true;
        else if (!allowedTags.has(name)) tags.push(name);
      }
      if (forDepth > 0 && !loopUsageIsValid(code.masked)) syntax = true;
      if (!numberLiteralsAreValid(code.masked)) syntax = true;
      if (name === "for") forDepth += 1;
      else if (name === "endfor" && forDepth > 0) forDepth -= 1;
      before(open, block);
      const start = index + 2 + (open ? 1 : 0);
      const stop = code.close - (shut ? 1 : 0);
      const body = stop > start ? bracketLiteralKeys(source.slice(start, stop), code.masked.slice(start - index - 2, stop - index - 2)) : " ";
      out += source.slice(index, index + 2) + body + end;
      index = code.close + end.length;
      after(shut, block);
      continue;
    }
    const character = source.charAt(index);
    out += character;
    if (character === "\n") { dirty = false; prefix = out.length; }
    else if (character !== " " && character !== "\t") dirty = true;
    index += 1;
  }
  return { source: out, tags, syntax };
}

class SyntaxViolation extends Error {}

function typeName(value: unknown): string {
  if (!isRecord(value)) return "";
  const name = value.typename;
  return typeof name === "string" ? name : "";
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function childNodes(value: unknown): unknown[] {
  const children = field(value, "children");
  return Array.isArray(children) ? children : [];
}

function isValidName(name: string): boolean {
  if (!namePattern.test(name)) return false;
  const lower = name.toLowerCase();
  if (lower === "true" || lower === "false" || lower === "none" || lower === "null") return false;
  return !reservedNames.has(name);
}

interface ExprContext { test: boolean; conditional: boolean }

/** Converts the Nunjucks tree into the typed AST, rejecting everything outside the common grammar. */
class Converter {
  readonly unsupported: string[] = [];
  readonly includes: string[] = [];
  #forDepth = 0;

  root(node: unknown): TemplateNode[] {
    if (typeName(node) !== "Root") throw new SyntaxViolation("root");
    return this.#nodes(childNodes(node));
  }

  #nodes(list: readonly unknown[]): TemplateNode[] {
    return list.flatMap((item) => this.#statement(item));
  }

  #block(node: unknown): TemplateNode[] {
    const name = typeName(node);
    if (name === "NodeList" || name === "Root") return this.#nodes(childNodes(node));
    if (node === null || node === undefined) return [];
    return this.#statement(node);
  }

  #statement(node: unknown): TemplateNode[] {
    switch (typeName(node)) {
      case "Output": return childNodes(node).map((child) => this.#outputPart(child));
      case "NodeList":
      case "Root": return this.#nodes(childNodes(node));
      case "If": return [{
        kind: "if",
        cond: this.expression(field(node, "cond"), { test: true, conditional: false }),
        body: this.#block(field(node, "body")),
        alternate: this.#block(field(node, "else_")),
      }];
      case "For": {
        if (field(node, "else_") !== null && field(node, "else_") !== undefined) throw new SyntaxViolation("for else");
        const nameNode = field(node, "name");
        const variable = typeName(nameNode) === "Symbol" ? field(nameNode, "value") : undefined;
        if (typeof variable !== "string" || !isValidName(variable) || variable === "loop") throw new SyntaxViolation("for name");
        const arr = this.expression(field(node, "arr"), { test: true, conditional: false });
        this.#forDepth += 1;
        const body = this.#block(field(node, "body"));
        this.#forDepth -= 1;
        return [{ kind: "for", name: variable, arr, body }];
      }
      case "Include": {
        if (field(node, "ignoreMissing")) throw new SyntaxViolation("ignore missing");
        const target = field(node, "template");
        if (typeName(target) !== "Literal") throw new SyntaxViolation("include target");
        const path = field(target, "value");
        if (typeof path !== "string") throw new SyntaxViolation("include target");
        this.includes.push(path);
        return [{ kind: "include", path }];
      }
      default: throw new SyntaxViolation("statement");
    }
  }

  #outputPart(node: unknown): TemplateNode {
    if (typeName(node) === "TemplateData") {
      const text = field(node, "value");
      if (typeof text !== "string") throw new SyntaxViolation("text");
      return { kind: "text", text };
    }
    return { kind: "output", expr: this.expression(node, { test: true, conditional: false }) };
  }

  expression(node: unknown, ctx: ExprContext): Expr {
    switch (typeName(node)) {
      case "Literal": {
        const value = field(node, "value");
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return { kind: "literal", value };
        throw new SyntaxViolation("literal");
      }
      case "Neg": {
        const target = field(node, "target");
        const value = typeName(target) === "Literal" ? field(target, "value") : undefined;
        if (typeof value !== "number") throw new SyntaxViolation("negation");
        return { kind: "literal", value: -value };
      }
      case "Symbol": {
        const name = field(node, "value");
        if (typeof name !== "string" || !isValidName(name)) throw new SyntaxViolation("name");
        if (name === "loop" && this.#forDepth > 0) throw new SyntaxViolation("loop");
        return { kind: "var", name };
      }
      case "Group": {
        const children = childNodes(node);
        if (children.length !== 1) throw new SyntaxViolation("group");
        return this.expression(children[0], ctx);
      }
      case "LookupVal": return this.#lookup(node, ctx);
      case "Filter": return this.#filter(node, ctx);
      case "Is": return this.#test(node, ctx);
      case "Not": return { kind: "not", target: this.expression(field(node, "target"), { test: true, conditional: ctx.conditional }) };
      case "And": return { kind: "and", left: this.expression(field(node, "left"), { test: true, conditional: ctx.conditional }), right: this.expression(field(node, "right"), { test: true, conditional: ctx.conditional }) };
      case "Or": return { kind: "or", left: this.expression(field(node, "left"), { test: true, conditional: ctx.conditional }), right: this.expression(field(node, "right"), { test: true, conditional: ctx.conditional }) };
      case "Compare": return this.#compare(node, ctx);
      case "InlineIf": return this.#conditional(node, ctx);
      default: throw new SyntaxViolation("expression");
    }
  }

  #lookup(node: unknown, ctx: ExprContext): Expr {
    const valueNode = field(node, "val");
    if (typeName(valueNode) !== "Literal") throw new SyntaxViolation("lookup");
    const key = field(valueNode, "value");
    const targetNode = field(node, "target");
    if (this.#forDepth > 0 && typeName(targetNode) === "Symbol" && field(targetNode, "value") === "loop") {
      if (typeof key !== "string" || !loopKeys.has(key)) throw new SyntaxViolation("loop key");
      return { kind: "member", target: { kind: "var", name: "loop" }, key };
    }
    const target = this.expression(targetNode, { test: false, conditional: ctx.conditional });
    if (typeof key === "string") return { kind: "member", target, key };
    if (typeof key === "number" && Number.isInteger(key) && key >= 0) return { kind: "index", target, index: key };
    throw new SyntaxViolation("lookup");
  }

  #literalArgument(node: unknown): Primitive {
    const value = this.expression(node, { test: false, conditional: true });
    if (value.kind !== "literal") throw new SyntaxViolation("filter argument");
    return value.value;
  }

  #filter(node: unknown, ctx: ExprContext): Expr {
    const nameNode = field(node, "name");
    const name = typeName(nameNode) === "Symbol" ? field(nameNode, "value") : undefined;
    if (typeof name !== "string") throw new SyntaxViolation("filter");
    const children = childNodes(field(node, "args"));
    const first = children[0];
    if (first === undefined) throw new SyntaxViolation("filter");
    const target = this.expression(first, { test: false, conditional: ctx.conditional });
    const args = children.slice(1).map((item) => this.#literalArgument(item));
    if (!isFilterName(name)) {
      this.unsupported.push(`filter ${name}`);
      return target;
    }
    checkFilterArguments(name, args);
    return { kind: "filter", name, target, args };
  }

  #test(node: unknown, ctx: ExprContext): Expr {
    if (!ctx.test) throw new SyntaxViolation("test position");
    const target = this.expression(field(node, "left"), { test: false, conditional: ctx.conditional });
    if (target.kind !== "var" && target.kind !== "member" && target.kind !== "index") throw new SyntaxViolation("test subject");
    const right = field(node, "right");
    if (typeName(right) !== "Symbol") throw new SyntaxViolation("test");
    const name = field(right, "value");
    if (typeof name !== "string") throw new SyntaxViolation("test");
    if (name !== "defined") {
      this.unsupported.push(`test ${name}`);
      return { kind: "literal", value: true };
    }
    return { kind: "defined", target };
  }

  #compare(node: unknown, ctx: ExprContext): Expr {
    const ops = field(node, "ops");
    if (!Array.isArray(ops) || ops.length !== 1) throw new SyntaxViolation("compare");
    const operation: unknown = ops[0];
    const type = field(operation, "type");
    if (type !== "==" && type !== "!=") throw new SyntaxViolation("compare");
    const inner: ExprContext = { test: false, conditional: ctx.conditional };
    return { kind: "equal", negated: type === "!=", left: this.expression(field(node, "expr"), inner), right: this.expression(field(operation, "expr"), inner) };
  }

  #conditional(node: unknown, ctx: ExprContext): Expr {
    if (ctx.conditional) throw new SyntaxViolation("nested conditional");
    const otherwise = field(node, "else_");
    if (otherwise === null || otherwise === undefined) throw new SyntaxViolation("conditional");
    const inner: ExprContext = { test: true, conditional: true };
    return {
      kind: "conditional",
      cond: this.expression(field(node, "cond"), inner),
      then: this.expression(field(node, "body"), inner),
      otherwise: this.expression(otherwise, inner),
    };
  }
}

function checkFilterArguments(name: FilterName, args: readonly Primitive[]): void {
  const count = args.length;
  if (name === "default") {
    if (count !== 1) throw new SyntaxViolation("default");
    return;
  }
  if (name === "join") {
    if (count > 1 || (count === 1 && typeof args[0] !== "string")) throw new SyntaxViolation("join");
    return;
  }
  if (name === "json") {
    if (count > 1 || (count === 1 && args[0] !== 0)) throw new SyntaxViolation("json");
    return;
  }
  if (name === "replace") {
    const [search, replacement, limit] = args;
    if (count !== 2 && count !== 3) throw new SyntaxViolation("replace");
    if (typeof search !== "string" || search === "") throw new SyntaxViolation("replace");
    if (typeof replacement !== "string") throw new SyntaxViolation("replace");
    if (count === 3 && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0)) throw new SyntaxViolation("replace");
    return;
  }
  if (count !== 0) throw new SyntaxViolation(name);
}

/** Checks one template file and returns its typed AST, or the configuration error it causes. */
export function checkTemplate(raw: string): TemplateCheck {
  const scanned = scan(normalizeTemplateSource(raw));
  if (scanned.tags.length > 0) return { ok: false, kind: "unsupported", items: unique(scanned.tags.map((tag) => `tag ${tag}`)) };
  if (scanned.syntax) return { ok: false, kind: "syntax" };
  let tree: unknown;
  try {
    // `scan` already applied `태그와 공백`, so the parser must not add whitespace rules of its own.
    tree = nunjucks.parser.parse(scanned.source, [], {});
  } catch {
    return { ok: false, kind: "syntax" };
  }
  const converter = new Converter();
  let nodes: TemplateNode[];
  try {
    nodes = converter.root(tree);
  } catch (error) {
    if (error instanceof SyntaxViolation) return { ok: false, kind: "syntax" };
    throw error;
  }
  if (converter.unsupported.length > 0) return { ok: false, kind: "unsupported", items: unique(converter.unsupported) };
  return { ok: true, ast: { nodes, includes: converter.includes } };
}
