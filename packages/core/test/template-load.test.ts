import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoondanConfigError, loadConfigSync, validateConfig, type ConfigIssue } from "../src/index.ts";

const roots: string[] = [];

function workspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-template-")));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

function issuesOf(action: () => unknown): readonly ConfigIssue[] {
  try {
    action();
  } catch (error) {
    if (error instanceof GoondanConfigError) return error.issues;
    throw error;
  }
  throw new Error("Expected a configuration error");
}

/** A configuration whose single agent declares `templates/main.md` as its system message. */
function withMain(files: Record<string, string>): string {
  return workspace({ "goondan.yaml": "agents:\n  main: {model: m, systemMessage: {template: ./templates/main.md}}\n", ...files });
}

afterEach(() => { roots.length = 0; });

describe("template configuration errors", () => {
  it("reports a declared template it cannot read", () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m, input: {template: ./templates/missing.md}}\n" });
    expect(issuesOf(() => loadConfigSync(root)))
      .toEqual([{ code: "template.not_found", path: "/agents/main/input/template", message: "cannot read templates/missing.md" }]);
  });

  it("reports a directory and a file that is not UTF-8 as unreadable", () => {
    const directory = withMain({ "templates/main.md/keep.md": "x" });
    expect(issuesOf(() => loadConfigSync(directory))[0]?.code).toBe("template.not_found");
    const root = withMain({ "templates/main.md": "" });
    writeFileSync(join(root, "templates", "main.md"), Buffer.from([0x61, 0xff, 0x62]));
    expect(issuesOf(() => loadConfigSync(root)))
      .toEqual([{ code: "template.not_found", path: "/agents/main/systemMessage/template", message: "cannot read templates/main.md" }]);
  });

  it("reports unsupported tag names before anything else", () => {
    const root = withMain({ "templates/main.md": "{% set value = 1 %}{{ x | safe }}" });
    expect(issuesOf(() => loadConfigSync(root)))
      .toEqual([{ code: "template.unsupported", path: "/agents/main/systemMessage/template", message: "templates/main.md uses unsupported syntax: tag set" }]);
    for (const tag of ["with", "raw", "verbatim", "autoescape", "macro", "call", "block", "extends", "import", "from", "filter", "elseif"]) {
      const one = withMain({ "templates/main.md": `{% ${tag} %}` });
      expect(issuesOf(() => loadConfigSync(one))[0]?.message).toBe(`templates/main.md uses unsupported syntax: tag ${tag}`);
    }
  });

  it("reports unsupported filters and tests together, sorted and deduplicated", () => {
    const root = withMain({ "templates/main.md": "{{ a | safe }}{{ b | safe }}{% if c is odd %}x{% endif %}" });
    expect(issuesOf(() => loadConfigSync(root)))
      .toEqual([{ code: "template.unsupported", path: "/agents/main/systemMessage/template", message: "templates/main.md uses unsupported syntax: filter safe, test odd" }]);
  });

  it("reports everything outside the common expression grammar as invalid syntax", () => {
    const invalid = [
      "{% if a %}", "{% endif %}", "{% for a, b in c %}{% endfor %}", "{% for x in y %}a{% else %}b{% endfor %}",
      "{{ a.b() }}", "{{ a + b }}", "{{ 'a' ~ b }}", "{{ a in b }}", "{{ a > b }}", "{{ a[1:2] }}",
      "{{ [1, 2] }}", "{{ {\"a\": 1} }}", "{{ a == b == c }}", "{{ none }}", "{{ null }}", "{{ 1e3 | length is defined }}",
      "{{ a is defined == b }}", "{{ (a is defined) | length }}", "{{ x is defined('y') }}", "{{ a | default(1, 2) }}",
      "{{ a | replace(b, 'c') }}", "{{ a | json(4) }}", "{{ a | trim('x') }}", "{{ a | join(1) }}",
      "{% include a %}", "{% include 'a' ignore missing %}", "{% include ['a', 'b'] %}",
      "{%+ if a %}{% endif %}", "{% if a +%}{% endif %}", "{#+ c #}", "{# c",
      "{{ 'a\\d' }}", "{{ a[-1] }}", "{{ a[b] }}", "{{ True }}", "{{ 1_000 }}",
      "{% for x in y %}{{ loop }}{% endfor %}", "{% for x in y %}{{ loop.cycle }}{% endfor %}",
      "{% for x in y %}{{ loop[\"index\"] }}{% endfor %}", "{% for loop in y %}{% endfor %}",
      "{{ a if b else c if d else e }}", "{{ (a if b else c) if d else e }}", "{{ a", "{{ 'a }}",
      "{{ a | length is defined }}", "{{ 'a' is defined }}", "{% include 'a' with context %}",
      "{% include 'a' without context %}", "{% for x in y if z %}{% endfor %}", "{% for x in y recursive %}{% endfor %}",
      "{{ 1e3 }}", "{{ 0x1A }}", "{{ 0o12 }}", "{{ 1.5.2 }}", "{{ --1 }}", "{{ 'a' 'b' }}", "{{ \"a\" \"b\" }}",
      "{{ 012 }}", "{{ 00 }}", "{{ 01.5 }}", "{{ -012 }}", "{{ a[012] }}", "{{ a.0 }}", "{{ 1_000 }}",
      "{{ 1. }}", "{{ -1. }}", "{{ a[1.] }}", "{% if 1. %}x{% endif %}",
      "{% if 012 %}x{% endif %}", "{{ a | replace('x', 'y', 01) }}",
      "{{ a b }}", "{{ 1 2 }}", "{{ 'a\\u00e9' }}", "{{ 'a\\0' }}", "{{ a ** 2 }}", "{{ a % 2 }}", "{{ a // 2 }}",
      "{{ a.b.c() }}", "{{ range(3) }}", "{{ a[0:1] }}", "{{ a <= b }}", "{{ none == none }}",
      "{{ a is divisibleby(3) }}", "{% include %}", "{{ a | default }}", "{{ a | json(1) }}",
      "{{ a | replace('x') }}", "{{ a | replace('x', 'y', -1) }}", "{{ a | replace('x', 'y', 1, 2) }}",
      "{{ a | join('x', 'y') }}", "{{ a | length(1) }}", "{{ a | upper(1) }}",
      "{% for x in y %}{{ loop.revindex }}{% endfor %}", "{% for x in y %}{{ loop | length }}{% endfor %}",
      "{% for x in y %}{% for z in w %}{{ loop.cycle }}{% endfor %}{% endfor %}",
    ];
    for (const source of invalid) {
      const root = withMain({ "templates/main.md": source });
      expect(issuesOf(() => loadConfigSync(root)), source)
        .toEqual([{ code: "template.syntax", path: "/agents/main/systemMessage/template", message: "templates/main.md has invalid syntax" }]);
    }
  });

  it("accepts the whole common grammar", () => {
    const valid = [
      "{% if a %}x{% elif b %}y{% else %}z{% endif %}", "{% for x in a %}{{ x }}{% endfor %}",
      "{{ a.b[\"c\"][0] | default('x') | upper }}", "{{ 'a' if b is not defined else 'b' }}",
      "{{ (a or b) and not c }}", "{{ a != b }}", "{{ -1 }}{{ 0.5 }}{{ true }}{{ false }}",
      "{{ a | replace('x', 'y', 2) }}{{ a | json(0) }}{{ a | json }}{{ a | join }}{{ a | join(', ') }}",
      "{{ loop }}", "{% for x in a %}{{ loop.index }}{{ loop.length }}{% endfor %}",
      "{# {% macro m() %}{{ x | safe }} #}ok", "{{ 'a\\nb\\t\\\\c\\'d' }}",
      "{{ a | upper() }}", "{{ not a is defined }}", "{{ a[\"x\"][0].y }}",
      "{{ 12 }}{{ 0 }}{{ -0 }}{{ 10.05 }}{{ a12 }}{{ a[0] }}{{ '012' }}{{ a.b0 }}",
      "{% for x in a %}{% for y in b %}{{ loop.index }}{{ x }}{% endfor %}{% endfor %}",
      "{% for x in a %}{% endfor %}{{ loop }}", "{% for x in a %}{{ x.loop }}{{ loops }}{% endfor %}",
    ];
    for (const source of valid) {
      const root = withMain({ "templates/main.md": source });
      expect(() => loadConfigSync(root), source).not.toThrow();
    }
  });

  it("reads the reserved spellings as ordinary keys after a dot", () => {
    const valid = [
      "{{ params.none }}", "{{ params.null }}", "{{ params.true }}", "{{ params.false }}",
      "{{ params.None }}", "{{ params.NULL }}", "{{ params.a.none.b }}", "{{ params . none }}",
      "{% if params.none %}x{% endif %}", "{% for x in params.null %}{{ x.true }}{% endfor %}",
      "{{ params.none | default('x') }}", "{{ params['.none'] }}{{ 'a.none' }}",
    ];
    for (const source of valid) {
      const root = withMain({ "templates/main.md": source });
      expect(() => loadConfigSync(root), source).not.toThrow();
    }
    for (const source of ["{{ none }}", "{{ null }}", "{{ params[none] }}", "{{ none.a }}"]) {
      const root = withMain({ "templates/main.md": source });
      expect(issuesOf(() => loadConfigSync(root)), source)
        .toEqual([{ code: "template.syntax", path: "/agents/main/systemMessage/template", message: "templates/main.md has invalid syntax" }]);
    }
  });

  it("resolves an include against the directory of the including file", () => {
    const root = withMain({
      "templates/main.md": "{% include 'partials/header.md' %}",
      "templates/partials/header.md": "head:{% include 'footer.md' %}",
      "templates/partials/footer.md": "deep",
      "templates/footer.md": "{% set never %}",
    });
    const loaded = loadConfigSync(root);
    expect(loaded.templates.get(join(root, "templates", "partials", "footer.md"))).toBe("deep");
    expect(loaded.templates.has(join(root, "templates", "footer.md"))).toBe(false);
  });

  it("reads includes of branches that never run and of templates declared beside a function", () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, input: {fn: f, template: ./templates/main.md}}\n",
      "templates/main.md": "{% if false %}{% include 'gone.md' %}{% endif %}",
    });
    expect(issuesOf(() => loadConfigSync(root)))
      .toEqual([{ code: "template.not_found", path: "/agents/main/input/template", message: "templates/main.md includes \"gone.md\": cannot read templates/gone.md" }]);
  });

  it("rejects include paths that leave the including directory", () => {
    const cases: [string, string][] = [
      ["", "path is empty"],
      ["a\\b.md", "backslashes are not allowed"],
      ["/etc/hosts", "absolute paths are not allowed"],
      ["C:/x.md", "absolute paths are not allowed"],
      ["../secret.md", "\"..\" segments are not allowed"],
    ];
    for (const [path, reason] of cases) {
      const literal = path.replaceAll("\\", "\\\\");
      const root = withMain({ "templates/main.md": `{% include '${literal}' %}`, "secret.md": "s" });
      expect(issuesOf(() => loadConfigSync(root)), path).toEqual([{
        code: "template.unsupported",
        path: "/agents/main/systemMessage/template",
        message: `templates/main.md includes "${path}": ${reason}`,
      }]);
    }
  });

  it("rejects an include whose real path leaves the including directory", () => {
    const root = withMain({ "templates/main.md": "{% include 'link.md' %}", "secret.md": "s" });
    symlinkSync(join(root, "secret.md"), join(root, "templates", "link.md"));
    expect(issuesOf(() => loadConfigSync(root))).toEqual([{
      code: "template.unsupported",
      path: "/agents/main/systemMessage/template",
      message: "templates/main.md includes \"link.md\": resolves outside templates",
    }]);
  });

  it("names the configuration directory as a dot", () => {
    const outside = workspace({ "secret.md": "s" });
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, systemMessage: {template: ./main.md}}\n",
      "main.md": "{% include 'link.md' %}",
    });
    symlinkSync(join(outside, "secret.md"), join(root, "link.md"));
    const issues = issuesOf(() => loadConfigSync(root));
    expect(issues[0]?.message).toBe("main.md includes \"link.md\": resolves outside .");
  });

  it("follows symlinks that stay inside the including directory", () => {
    const root = withMain({ "templates/main.md": "{% include 'link.md' %}", "templates/real.md": "ok" });
    symlinkSync(join(root, "templates", "real.md"), join(root, "templates", "link.md"));
    expect(() => loadConfigSync(root)).not.toThrow();
  });

  it("reports an include cycle from the file that reappears", () => {
    const root = withMain({
      "templates/main.md": "{% include 'loop-a.md' %}",
      "templates/loop-a.md": "{% include 'loop-b.md' %}",
      "templates/loop-b.md": "{% include 'loop-a.md' %}",
    });
    expect(issuesOf(() => loadConfigSync(root))).toEqual([{
      code: "template.unsupported",
      path: "/agents/main/systemMessage/template",
      message: "include cycle: templates/loop-a.md -> templates/loop-b.md -> templates/loop-a.md",
    }]);
    const self = withMain({ "templates/main.md": "{% include 'main.md' %}" });
    expect(issuesOf(() => loadConfigSync(self))[0]?.message).toBe("include cycle: templates/main.md -> templates/main.md");
  });

  it("checks a file in declaration order: tags, syntax, filters, then each include", () => {
    const root = withMain({ "templates/main.md": "{% include 'one.md' %}{% include 'two.md' %}", "templates/two.md": "x" });
    expect(issuesOf(() => loadConfigSync(root))[0]?.message).toBe("templates/main.md includes \"one.md\": cannot read templates/one.md");
    const ordered = withMain({ "templates/main.md": "{% set x %}{% include 'one.md' %}" });
    expect(issuesOf(() => loadConfigSync(ordered))[0]?.message).toBe("templates/main.md uses unsupported syntax: tag set");
  });

  it("reports an error found inside an included file at the declaring location", () => {
    const root = withMain({ "templates/main.md": "{% include 'part.md' %}", "templates/part.md": "{{ x | safe }}" });
    expect(issuesOf(() => loadConfigSync(root))).toEqual([{
      code: "template.unsupported",
      path: "/agents/main/systemMessage/template",
      message: "templates/part.md uses unsupported syntax: filter safe",
    }]);
  });

  it("reports one issue per declaration site that reaches the same file", () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, input: {template: ./bad.md}, systemMessage: [{template: ./bad.md}]}\n",
      "bad.md": "{{ a | safe }}",
    });
    expect(issuesOf(() => loadConfigSync(root)).map((issue) => issue.path))
      .toEqual(["/agents/main/input/template", "/agents/main/systemMessage/0/template"]);
  });

  it("never reads a file no template declares or includes", () => {
    const root = withMain({ "templates/main.md": "ok", "templates/draft.md": "{% macro m() %}{% endmacro %}" });
    const loaded = loadConfigSync(root);
    expect([...loaded.templates.keys()]).toEqual([join(root, "templates", "main.md")]);
    chmodSync(join(root, "templates", "draft.md"), 0o000);
    expect(() => loadConfigSync(root)).not.toThrow();
    chmodSync(join(root, "templates", "draft.md"), 0o644);
  });

  it("names a template outside the configuration directory relative to it", () => {
    const outside = workspace({ "shared.md": "{{ a | safe }}" });
    const root = workspace({ "goondan.yaml": `agents:\n  main: {model: m, systemMessage: {template: ${join(outside, "shared.md")}}}\n` });
    expect(issuesOf(() => loadConfigSync(root))[0]?.message)
      .toBe(`${relative(root, join(outside, "shared.md")).split(sep).join("/")} uses unsupported syntax: filter safe`);
  });

  it("reads no template file for validateConfig", () => {
    expect(() => validateConfig({ agents: { main: { model: "m", systemMessage: { template: "nowhere.md" } } } })).not.toThrow();
  });
});
