import { describe, expect, it } from "vitest";
import { TemplateRenderer } from "../src/index.ts";
import { type Json } from "../src/types.ts";

function renderer(files: Record<string, string>, directory = "/cfg"): TemplateRenderer {
  return new TemplateRenderer(new Map(Object.entries(files)), directory);
}

function render(source: string, variables: Record<string, Json> = {}): string {
  return renderer({ "/cfg/t.md": source }).render("/cfg/t.md", variables);
}

const params = { mode: "brief", n: 1, list: ["a", "b"], tags: { items: ["x"] } };

describe("template rendering", () => {
  it("renders the worked example of the expression section", () => {
    const source = "{% if params.mode == 'brief' %}B{% endif %}{{ 'eq' if params.n == '1' else 'ne' }}"
      + "{% for x in params.list %}{{ loop.index }}{{ x }}{% endfor %}{{ params.tags.items | join(',') }}";
    expect(render(source, { params })).toBe("Bne1a2bx");
  });

  it("reads the reserved spellings as ordinary keys after a dot", () => {
    const value = { none: "N", null: "U", true: "T", false: "F", nested: { none: "D" } };
    expect(render("{{ params.none }}{{ params.null }}{{ params.true }}{{ params.false }}{{ params.nested.none }}", { params: value })).toBe("NUTFD");
    expect(render("{% if params.none %}yes{% else %}no{% endif %}", { params: value })).toBe("yes");
    expect(render("{{ params.none }}", { params: { none: "" } })).toBe("");
    // A name written inside a string literal stays part of the literal.
    expect(render("{{ 'a.none' }}{{ params['.none'] }}", { params: { ".none": "B" } })).toBe("a.noneB");
  });

  it("prints non-string values as JSON text", () => {
    const value = { t: true, whole: 2.0, arr: ["a", "b"], obj: { a: 1 }, n: null };
    expect(render("[{{ params.t }}|{{ params.whole }}|{{ params.arr }}|{{ params.obj }}|{{ params.n }}|{{ params.arr | join('-') }}]", { params: value }))
      .toBe("[true|2|[\"a\",\"b\"]|{\"a\":1}|null|a-b]");
  });

  it("drops the newline after a tag and the indentation before it", () => {
    expect(render("{% for name in params.names %}\n- {{ name }}\n{% endfor %}", { params: { names: ["a", "b"] } })).toBe("- a\n- b\n");
    expect(render("a\n  {% if true %}\n  b\n  {% endif %}\nc")).toBe("a\n  b\nc");
    expect(render("x\r\ny\r")).toBe("x\ny\n");
    expect(render("﻿head")).toBe("head");
  });

  it("keeps the whitespace around output tags and honours the dash markers", () => {
    expect(render("  {{ 'a' }}  \n")).toBe("  a  \n");
    expect(render("a \n {%- if true -%} \n b{% endif %}")).toBe("ab");
    expect(render("a  {#- note -#}  b")).toBe("ab");
    expect(render("a \n {{- 'x' -}} \n b")).toBe("axb");
  });

  it("keeps a line that a comment already filled and strips markers itself", () => {
    // The `{% if %}` starts on a line that the comment already filled, so rule 3 does not apply.
    expect(render("  {# c #}   {% if true %}b{% endif %}")).toBe("   b");
    expect(render("x {# c #}   {% if true %}b{% endif %}")).toBe("x    b");
    expect(render("  {{ 'a' }}  {% if true %}b{% endif %}")).toBe("  a  b");
    expect(render("{% if true %}\n  {% endif %}tail")).toBe("tail");
    expect(render("\t\t{% if true %}z{% endif %}")).toBe("z");
    // A `-` right after a delimiter is a whitespace marker in both hosts, never part of the expression.
    expect(render("{{-1}}")).toBe("1");
    expect(render("{{ -1 }}")).toBe("-1");
    expect(render("{{ 'a' -}}\n   b")).toBe("ab");
  });

  it("prints delimiters through string literals", () => {
    expect(render("{{ '{{' }}{{ '{%' }}{{ '{#' }}")).toBe("{{{%{#");
  });

  it("removes comments with the tag whitespace rules and never checks their contents", () => {
    expect(render("a\n  {# {% set %} {{ x | safe }} #}\nb")).toBe("a\nb");
    expect(render("x {# c #} y")).toBe("x  y");
  });

  it("treats empty arrays and objects as false", () => {
    expect(render("{% if params.a %}T{% else %}F{% endif %}", { params: { a: [] } })).toBe("F");
    expect(render("{% if params.a %}T{% else %}F{% endif %}", { params: { a: {} } })).toBe("F");
    expect(render("{% if params.a %}T{% else %}F{% endif %}", { params: { a: [0] } })).toBe("T");
    expect(render("{{ params.a or 'x' }}", { params: { a: [] } })).toBe("x");
    expect(render("{{ params.a and 'x' }}", { params: { a: [] } })).toBe("[]");
    expect(render("{{ params.a or 'x' }}", { params: { a: "y" } })).toBe("y");
    expect(render("{{ not params.a }}", { params: { a: "" } })).toBe("true");
  });

  it("compares values as JSON", () => {
    expect(render("{{ params.one == 1.0 }}{{ params.one == '1' }}{{ params.yes == 1 }}{{ params.nothing == params.nothing }}{{ params.list != params.list }}",
      { params: { one: 1, yes: true, nothing: null, list: ["a"] } })).toBe("truefalsefalsetruefalse");
  });

  it("reads only JSON keys and non-negative indexes", () => {
    expect(render("{{ params.tags.items }}", { params })).toBe("[\"x\"]");
    expect(render("{{ params.list[1] }}", { params })).toBe("b");
    expect(render("{{ params[\"mode\"] }}", { params })).toBe("brief");
    expect(render("{{ params.list.length is defined }}", { params })).toBe("false");
    expect(render("{{ params.list[9] is defined }}", { params })).toBe("false");
    expect(render("{{ params.mode[0] is defined }}", { params })).toBe("false");
  });

  it("allows undefined values only for defined and default", () => {
    expect(render("{{ 'd' if params.missing is defined else 'u' }}{{ params.missing | default('z') }}", { params })).toBe("uz");
    expect(render("{{ params.nothing | default('z') }}{{ params.blank | default('z') }}{{ params.off | default('z') }}",
      { params: { nothing: null, blank: "", off: false } })).toBe("nullfalse");
    expect(() => render("{% if params.missing %}x{% endif %}", { params })).toThrow();
    expect(() => render("{{ params.missing.name is defined }}", { params })).toThrow();
    expect(() => render("{{ params.missing }}", { params })).toThrow();
    expect(() => render("{{ params.missing | length }}", { params })).toThrow();
    expect(() => render("{{ params.missing == 1 }}", { params })).toThrow();
    expect(() => render("{% for x in params.missing %}{% endfor %}", { params })).toThrow();
    expect(render("{{ 'a' if params.mode else params.missing }}", { params })).toBe("a");
  });

  it("iterates arrays only and exposes the five loop keys", () => {
    expect(render("{% for x in params.list %}{{ loop.index0 }}{{ loop.first }}{{ loop.last }}{{ loop.length }};{% endfor %}", { params }))
      .toBe("0truefalse2;1falsetrue2;");
    expect(render("{% for x in params.empty %}a{% endfor %}b", { params: { empty: [] } })).toBe("b");
    expect(() => render("{% for x in params.tags %}a{% endfor %}", { params })).toThrow();
    expect(() => render("{% for x in params.mode %}a{% endfor %}", { params })).toThrow();
  });

  it("applies every listed filter with the specified semantics", () => {
    expect(render("{{ 2 | upper }}{{ params.list | length }}{{ params.tags | length }}{{ 'ß' | upper }}", { params })).toBe("221SS");
    expect(render("{{ '😀한' | length }}")).toBe("2");
    expect(render("{{ '  a\tb  ' | trim }}|")).toBe("a\tb|");
    expect(render("{{ 'aaaa' | replace('a', 'b', 2) }}{{ 'aaaa' | replace('aa', 'b') }}")).toBe("bbaabb");
    expect(render("{{ params.obj | json(0) }}", { params: { obj: { a: [1, 2], b: "한" } } })).toBe("{\"a\":[1,2],\"b\":\"한\"}");
    expect(render("{{ params.obj | json }}", { params: { obj: { a: [1, 2], b: "한" } } }))
      .toBe("{\n  \"a\": [\n    1,\n    2\n  ],\n  \"b\": \"한\"\n}");
    expect(render("{{ params.empty | json }}", { params: { empty: [] } })).toBe("[]");
    expect(render("{{ params.list | join }}", { params })).toBe("ab");
    expect(() => render("{{ params.mode | join }}", { params })).toThrow();
    expect(() => render("{{ params.n | length }}", { params })).toThrow();
  });

  it("keeps the innermost loop and lets a loop variable hide a template variable", () => {
    expect(render("{% for x in params.list %}{% for y in params.list %}{{ loop.index }}{{ y }}{% endfor %}{{ loop.index }}{{ x }};{% endfor %}", { params }))
      .toBe("1a2b1a;1a2b2b;");
    expect(render("{% for params in params.list %}{{ params }}{% endfor %}{{ params.mode }}", { params })).toBe("abbrief");
  });

  it("writes the same numbers, strings and key order in both json forms", () => {
    expect(render("{{ params.s | json }}|{{ params.s | json(0) }}", { params: { s: "한\"\n" } })).toBe("\"한\\\"\\n\"|\"한\\\"\\n\"");
    expect(render("{{ params.v | json }}", { params: { v: { a: [], b: {}, c: [{ d: 2.0 }] } } }))
      .toBe("{\n  \"a\": [],\n  \"b\": {},\n  \"c\": [\n    {\n      \"d\": 2\n    }\n  ]\n}");
    expect(render("{{ params.v | json(0) }}", { params: { v: null } })).toBe("null");
  });

  it("renders includes relative to the including file without passing loop", () => {
    const files = {
      "/cfg/templates/system.md": "[{% for x in params.list %}{% include 'partials/header.md' %}{% endfor %}]",
      "/cfg/templates/partials/header.md": "<{{ x }}{% include 'footer.md' %}>",
      "/cfg/templates/partials/footer.md": "{{ loop | default('none') }}",
      "/cfg/templates/footer.md": "never",
    };
    expect(renderer(files).render("/cfg/templates/system.md", { params })).toBe("[<anone><bnone>]");
  });

  it("accepts an absolute or configuration-relative name and refuses anything else", () => {
    const files = { "/cfg/templates/x.md": "ok" };
    expect(renderer(files).render("/cfg/templates/x.md", {})).toBe("ok");
    expect(renderer(files).render("templates/x.md", {})).toBe("ok");
    expect(() => renderer(files).render("/etc/hosts", {})).toThrow("Template not loaded");
    expect(() => renderer(files).render("x.md", {})).toThrow("Template not loaded");
  });
});
