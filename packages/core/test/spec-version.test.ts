import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SPEC_VERSION } from "../src/index.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const specification = readFileSync(resolve(repository, "spec/goondan.md"), "utf8");

describe("SPEC_VERSION", () => {
  it("matches the normative version declared by the specification", () => {
    const versions = [...specification.matchAll(/^규범 버전: (\d+\.\d+)$/gm)]
      .map((match) => match[1]);

    expect(versions).toEqual([SPEC_VERSION]);
  });
});
