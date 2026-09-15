import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoondanConfigError, loadConfigSync, parseConfigDocument, type ConfigIssue } from "../src/index.ts";

const roots: string[] = [];

function workspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-load-")));
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

afterEach(() => { roots.length = 0; });

describe("YAML 1.2 core reading", () => {
  it("resolves plain scalars with the core schema table", () => {
    const parsed = parseConfigDocument("a: 012\nb: 0o12\nc: 0x1A\nd: 1_000\ne: 1:30\nf: 2024-01-02\ng: yes\nh: 1e3\ni: ~\n");
    expect(parsed.ok && parsed.document).toEqual({ a: 12, b: 10, c: 26, d: "1_000", e: "1:30", f: "2024-01-02", g: "yes", h: 1000, i: null });
  });

  it("keeps a merge key as an ordinary field", () => {
    const parsed = parseConfigDocument("base: &base {x: 1}\nchild:\n  <<: *base\n  y: 2\n");
    expect(parsed.ok && parsed.document).toEqual({ base: { x: 1 }, child: { "<<": { x: 1 }, y: 2 } });
  });

  it("accepts the core tags and rejects every other tag", () => {
    const good = parseConfigDocument('a: !!str 12\nb: !!int 0x1A\nc: !!float 1\nd: !!bool true\ne: !!null ~\nf: !!seq [1]\n');
    expect(good.ok && good.document).toEqual({ a: "12", b: 26, c: 1, d: true, e: null, f: [1] });
    for (const source of ["a: !!binary aGk=\n", "a: !foo x\n", "a: !!int 1.5\n", "a: !!bool yes\n", "a: !!map [1]\n"]) {
      const parsed = parseConfigDocument(source);
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.failure.code).toBe("load.yaml");
    }
  });

  it("rejects the non-specific tag, which is not one of the seven core tags", () => {
    const sources = [
      "v: ! 5\n", "v: !\n", "v: ! hello\n", "v: ! 'q'\n", "agents: {main: {model: ! m}}\n",
      // A sequence or a map resolves `!` to the tag of its kind, so only the spelling tells it apart.
      "v: ! [1]\n", "v: ! {a: 1}\n", "v: !\n  - 1\n",
    ];
    for (const source of sources) {
      const parsed = parseConfigDocument(source);
      expect(!parsed.ok && parsed.failure, source).toMatchObject({ code: "load.yaml", path: "" });
    }
    // A `!` that is not a tag, in a comment or inside a scalar, is not a tag at all.
    const kept = parseConfigDocument("v: \"a ! b\"\n# ! comment\nw: '!'\n");
    expect(kept.ok && kept.document).toEqual({ v: "a ! b", w: "!" });
  });

  it("reports duplicate and non-string keys at the positions the specification names", () => {
    const duplicate = parseConfigDocument("agents:\n  a: 1\n  a: 2\n");
    expect(!duplicate.ok && duplicate.failure).toMatchObject({ code: "load.yaml", path: "/agents/a" });
    const nested = parseConfigDocument("agents:\n  a: {model: m}\n  10: b\n");
    expect(!nested.ok && nested.failure).toMatchObject({ code: "load.yaml", path: "/agents" });
    const nonString = parseConfigDocument("10: a\n");
    expect(!nonString.ok && nonString.failure).toMatchObject({ code: "load.yaml", path: "" });
  });

  it("reports every other reading failure at the empty path", () => {
    const sources = [
      "agents:\n  main:\n    params: {t: !!timestamp 2024-01-02}\n",
      "agents:\n  main:\n    params: {n: !!int abc}\n",
      "agents:\n  main:\n    params: {b: !!bool yes}\n",
      "agents:\n  main:\n    params: {s: !!map [1]}\n",
      "agents:\n  main:\n    params: {x: *missing}\n",
      "agents:\n  main:\n    params: {f: .inf}\n---\nb: 2\n",
    ];
    for (const source of sources) {
      const parsed = parseConfigDocument(source);
      expect(!parsed.ok && parsed.failure).toMatchObject({ code: "load.yaml", path: "" });
    }
  });

  it("refuses documents that are empty, not objects or more than one", () => {
    for (const source of ["", "# only a comment\n", "---\n", "[]\n", '""\n']) {
      const parsed = parseConfigDocument(source);
      expect(!parsed.ok && parsed.failure.code).toBe("load.not_object");
    }
    const two = parseConfigDocument("a: 1\n---\nb: 2\n");
    expect(!two.ok && two.failure.code).toBe("load.yaml");
  });

  it("ignores one byte order mark and rejects other %YAML versions", () => {
    const parsed = parseConfigDocument("﻿a: 1\n");
    expect(parsed.ok && parsed.document).toEqual({ a: 1 });
    const directive = parseConfigDocument("%YAML 1.1\n---\na: 1\n");
    expect(!directive.ok && directive.failure.code).toBe("load.yaml");
  });

  it("counts alias expansions the way the specification counts them", () => {
    const under = parseConfigDocument("a: &a [1]\nb: &b [*a, *a]\nc: [*b, *b]\n");
    expect(under.ok).toBe(true);
    const bomb = parseConfigDocument([
      "a: &a [1, 1]",
      "b: &b [*a, *a, *a]",
      "c: &c [*b, *b, *b]",
      "d: &d [*c, *c, *c]",
      "e: [*d, *d, *d]",
      "",
    ].join("\n"));
    expect(!bomb.ok && bomb.failure.code).toBe("load.yaml");
  });
});

describe("file composition", () => {
  it("merges extends, resources and the current file in that order", () => {
    const root = workspace({
      "base.yaml": "name: base\nagents:\n  a: {model: m, params: {x: 1, y: 2}}\n",
      "extra.yaml": "agents:\n  b: {model: m}\n",
      "goondan.yaml": "extends: ./base.yaml\nresources: [./extra.yaml]\nname: app\nagents:\n  a: {params: {y: 3}}\n",
    });
    const loaded = loadConfigSync(root);
    expect(loaded.config.name).toBe("app");
    expect(Object.keys(loaded.config.agents)).toEqual(["a", "b"]);
    expect(loaded.config.agents.a?.params).toEqual({ x: 1, y: 3 });
    expect(loaded.config.flow).toEqual({ in: "a" });
  });

  it("keeps the earlier key order and appends new keys", () => {
    const root = workspace({
      "base.yaml": "agents:\n  a: {model: m}\n",
      "goondan.yaml": "extends: ./base.yaml\nagents:\n  b: {model: m}\n  a: {description: later}\n",
    });
    const loaded = loadConfigSync(root);
    expect(Object.keys(loaded.config.agents)).toEqual(["a", "b"]);
    expect(loaded.config.flow.in).toBe("a");
  });

  it("makes declared paths absolute against the declaring file", () => {
    const root = workspace({
      "shared/base.yaml": "agents:\n  a: {model: m, systemMessage: {template: ./note.md}}\n",
      "shared/note.md": "hello",
      "goondan.yaml": "resources: [./shared/base.yaml]\n",
    });
    const loaded = loadConfigSync(root);
    const block = loaded.config.agents.a?.systemMessage;
    expect(!Array.isArray(block) && block?.template).toBe(join(root, "shared", "note.md"));
    expect(loaded.templates.get(join(root, "shared", "note.md"))).toBe("hello");
  });

  it("reports a missing, duplicate or cyclic resource at the declaring position", () => {
    const missing = workspace({ "goondan.yaml": "resources: [./nope.yaml]\nagents:\n  a: {model: m}\n" });
    expect(issuesOf(() => loadConfigSync(missing))).toMatchObject([{ code: "load.not_found", path: "/resources/0" }]);

    const duplicate = workspace({
      "one.yaml": "agents:\n  a: {model: m}\n",
      "goondan.yaml": "resources: [./one.yaml, ./one.yaml]\n",
    });
    expect(issuesOf(() => loadConfigSync(duplicate))).toMatchObject([{ code: "load.duplicate_resource", path: "/resources/1" }]);

    const cycle = workspace({
      "goondan.yaml": "extends: ./other.yaml\n",
      "other.yaml": "extends: ./goondan.yaml\n",
    });
    expect(issuesOf(() => loadConfigSync(cycle))).toMatchObject([{ code: "load.resource_cycle", path: "/extends" }]);
  });

  it("treats a link and its target as the same file", () => {
    const root = workspace({
      "one.yaml": "agents:\n  a: {model: m}\n",
      "goondan.yaml": "resources: [./one.yaml, ./link.yaml]\n",
    });
    symlinkSync(join(root, "one.yaml"), join(root, "link.yaml"));
    expect(issuesOf(() => loadConfigSync(root))).toMatchObject([{ code: "load.duplicate_resource", path: "/resources/1" }]);
  });

  it("rejects a reference that is not a YAML file", () => {
    const root = workspace({ "notes.txt": "x", "goondan.yaml": "extends: ./notes.txt\nagents:\n  a: {model: m}\n" });
    expect(issuesOf(() => loadConfigSync(root))).toMatchObject([{ code: "load.not_yaml", path: "/extends" }]);
  });

  it("checks each file's extends and resources against the schema", () => {
    const root = workspace({ "goondan.yaml": "resources: [3]\nagents:\n  a: {model: m}\n" });
    expect(issuesOf(() => loadConfigSync(root))).toMatchObject([{ code: "schema.type", path: "/resources/0" }]);
  });
});

describe("variants", () => {
  it("merges each variant over the entry result in request order", () => {
    const root = workspace({
      "goondan.yaml": "name: app\nagents:\n  a: {model: m, params: {tone: plain}}\n",
      "variants/loud.yaml": "agents:\n  a: {params: {tone: loud}}\n",
      "variants/second.yaml": "name: second\n",
    });
    const loaded = loadConfigSync(root, { variants: ["loud", "second"] });
    expect(loaded.config.agents.a?.params).toEqual({ tone: "loud" });
    expect(loaded.config.name).toBe("second");
  });

  it("gives every variant its own resource graph", () => {
    const root = workspace({
      "shared.yaml": "agents:\n  a: {model: m, description: shared}\n",
      "goondan.yaml": "resources: [./shared.yaml]\n",
      "variants/again.yaml": "resources: [../shared.yaml]\nagents:\n  a: {description: variant}\n",
    });
    const loaded = loadConfigSync(root, { variants: ["again"] });
    expect(loaded.config.agents.a?.description).toBe("variant");
  });

  it("rejects variant names that leave the variants directory", () => {
    const root = workspace({ "goondan.yaml": "agents:\n  a: {model: m}\n" });
    expect(issuesOf(() => loadConfigSync(root, { variants: ["../escape"] }))).toMatchObject([{ code: "load.not_found", path: "" }]);
    expect(issuesOf(() => loadConfigSync(root, { variants: [""] }))).toMatchObject([{ code: "load.not_found", path: "" }]);
  });

  it("takes the variant directory from the real directory of a symlinked entry", () => {
    const target = workspace({
      "real/goondan.yaml": "agents:\n  a: {model: m, params: {tone: plain}}\n",
      "real/variants/loud.yaml": "agents:\n  a: {params: {tone: loud}}\n",
    });
    const link = join(target, "linked.yaml");
    symlinkSync(join(target, "real", "goondan.yaml"), link);
    const loaded = loadConfigSync(link, { variants: ["loud"] });
    expect(loaded.directory).toBe(join(target, "real"));
    expect(loaded.config.agents.a?.params).toEqual({ tone: "loud" });
  });
});

describe("nested configurations", () => {
  it("reads and validates them while loading the outer configuration", () => {
    const root = workspace({
      "inner/goondan.yaml": "agents:\n  main: {model: m}\n",
      "goondan.yaml": "agents:\n  wrap: {config: ./inner, description: nested}\n",
    });
    const loaded = loadConfigSync(root);
    expect(loaded.config.agents.wrap).toEqual({ config: join(root, "inner"), description: "nested" });
    expect(loaded.nested?.get("wrap")?.config.agents.main?.model).toBe("m");
  });

  it("keeps only config and description on a config agent", () => {
    const root = workspace({
      "inner/goondan.yaml": "agents:\n  main: {model: m}\n",
      "goondan.yaml": "agents:\n  wrap: {config: ./inner, model: m, tools: [search], description: nested}\n",
    });
    const loaded = loadConfigSync(root);
    expect(loaded.config.agents.wrap).toEqual({ config: join(root, "inner"), description: "nested" });
  });

  it("prefixes nested errors with the config field", () => {
    const root = workspace({
      "inner/goondan.yaml": "agents:\n  main: {model: m, tools: [{tool: a, agent: b}]}\n",
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\n",
    });
    expect(issuesOf(() => loadConfigSync(root)))
      .toMatchObject([{ code: "schema.oneOf", path: "/agents/wrap/config/agents/main/tools/0" }]);
  });

  it("reports a missing nested configuration at the config field", () => {
    const root = workspace({ "goondan.yaml": "agents:\n  wrap: {config: ./gone}\n" });
    expect(issuesOf(() => loadConfigSync(root))).toMatchObject([{ code: "load.not_found", path: "/agents/wrap/config" }]);
  });

  it("reports a nested configuration that points back at an enclosing entry", () => {
    const root = workspace({
      "inner/goondan.yaml": "agents:\n  back: {config: ../goondan.yaml}\n",
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\n",
    });
    expect(issuesOf(() => loadConfigSync(root)))
      .toMatchObject([{ code: "load.resource_cycle", path: "/agents/wrap/config/agents/back/config" }]);
  });

  it("does not apply the requested variants to a nested configuration", () => {
    const root = workspace({
      "inner/goondan.yaml": "agents:\n  main: {model: m, params: {tone: plain}}\n",
      "inner/variants/loud.yaml": "agents:\n  main: {params: {tone: loud}}\n",
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\n",
      "variants/loud.yaml": "name: loud\n",
    });
    const loaded = loadConfigSync(root, { variants: ["loud"] });
    expect(loaded.nested?.get("wrap")?.config.agents.main?.params).toEqual({ tone: "plain" });
  });
});
