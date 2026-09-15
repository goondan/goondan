/**
 * The TypeScript conformance suite.
 *
 * One test per case directory under fixtures/conformance, plus the spec
 * heading coverage test. Cases are never skipped and failures are never
 * expected: see fixtures/conformance/README.md ("러너 계약").
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCoverage, parseSpecHeadings } from "./conformance/conformance-coverage.ts";
import { discoverCases, readCase, runCase } from "./conformance/conformance-runner.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const fixturesRoot = resolve(repositoryRoot, "fixtures/conformance");
const specPath = resolve(repositoryRoot, "spec/goondan.md");
const CASE_TIMEOUT_MS = 60_000;

const discovered = await discoverCases(fixturesRoot);

describe("conformance", () => {
  it("finds only case directories under fixtures/conformance", () => {
    expect(discovered.problems).toEqual([]);
    expect(discovered.cases.length).toBeGreaterThan(0);
  });

  for (const caseId of discovered.cases) {
    it(
      caseId,
      async () => {
        const result = await runCase(fixturesRoot, caseId);
        if (result.failures.length > 0) expect.fail(`${caseId}:\n${result.failures.join("\n")}`);
      },
      CASE_TIMEOUT_MS,
    );
  }

  it(
    "cites every spec heading exactly once",
    async () => {
      const headings = parseSpecHeadings(await readFile(specPath, "utf8"));
      const citations = new Map<string, readonly string[]>();
      const unreadable: string[] = [];
      for (const caseId of discovered.cases) {
        try {
          citations.set(caseId, (await readCase(fixturesRoot, caseId)).spec);
        } catch (error) {
          unreadable.push(`${caseId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const problems = [...unreadable, ...checkCoverage({ headings, citations })];
      if (problems.length > 0) expect.fail(problems.join("\n"));
    },
    CASE_TIMEOUT_MS,
  );
});
