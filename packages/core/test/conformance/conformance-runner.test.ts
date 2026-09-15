import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverCases, runCase } from "./conformance-runner.ts";

async function fixtureRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "goondan-conformance-"));
}

describe("discoverCases", () => {
  it("lists case directories in code point order and ignores dot entries", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "tool-loop"));
    await mkdir(join(root, "basic"));
    await mkdir(join(root, ".cache"));
    await writeFile(join(root, "README.md"), "# readme\n");
    await expect(discoverCases(root)).resolves.toEqual({ cases: ["basic", "tool-loop"], problems: [] });
  });

  it("reports stray files and case names that break the pattern", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "Bad_Name"));
    await writeFile(join(root, "notes.txt"), "");
    const discovered = await discoverCases(root);
    expect(discovered.cases).toEqual([]);
    expect(discovered.problems).toEqual([
      "Bad_Name is not a valid case identifier",
      "notes.txt is not a case directory or the README",
    ]);
  });
});

describe("runCase file checks", () => {
  async function makeCase(files: Record<string, string>): Promise<{ root: string; id: string }> {
    const root = await fixtureRoot();
    const id = "sample";
    await mkdir(join(root, id));
    for (const [name, content] of Object.entries(files)) await writeFile(join(root, id, name), content);
    return { root, id };
  }

  it("rejects an entry the case layout does not allow", async () => {
    const { root, id } = await makeCase({
      "case.json": "{}",
      "expected.json": "{}",
      "goondan.yaml": "agents: {}\n",
    });
    const result = await runCase(root, id);
    expect(result.failures).toEqual(["case directory must not contain goondan.yaml"]);
  });

  it("reports a missing expected.json", async () => {
    const { root, id } = await makeCase({
      "case.json": JSON.stringify({ description: "d", spec: ["에이전트"], steps: [] }),
    });
    const result = await runCase(root, id);
    expect(result.failures[0]).toContain("expected.json is missing");
  });

  it("reports invalid JSON", async () => {
    const { root, id } = await makeCase({ "case.json": "{", "expected.json": "{}" });
    const result = await runCase(root, id);
    expect(result.failures[0]).toContain("case.json is not valid JSON");
  });

  it("reports a case file that breaks the format", async () => {
    const { root, id } = await makeCase({
      "case.json": JSON.stringify({ description: "d", spec: ["에이전트"], steps: [], unknown: 1 }),
      "expected.json": JSON.stringify({ steps: [] }),
    });
    const result = await runCase(root, id);
    expect(result.failures).toEqual(["/unknown: is not a known key"]);
  });
});
