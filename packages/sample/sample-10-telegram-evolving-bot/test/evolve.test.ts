import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyEvolutionPlan,
  isAllowedEvolutionPath,
  parseEvolutionPlanFromUnknown,
  type EvolutionPlan,
} from "../src/evolve.js";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.cwd(), ".tmp-sample10-"));
  tempDirs.push(root);
  await fs.writeFile(path.join(root, "goondan.yaml"), "apiVersion: goondan.ai/v1\n", "utf8");
  return root;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("evolve path guard", () => {
  it("accepts only allowed relative paths", () => {
    expect(isAllowedEvolutionPath("goondan.yaml")).toBe(true);
    expect(isAllowedEvolutionPath("src/connector-entry.ts")).toBe(true);
    expect(isAllowedEvolutionPath("../secret.txt")).toBe(false);
    expect(isAllowedEvolutionPath("/abs/path")).toBe(false);
    expect(isAllowedEvolutionPath("src/main.js")).toBe(false);
  });
});

describe("parseEvolutionPlanFromUnknown", () => {
  it("parses valid evolution payload", () => {
    const parsed = parseEvolutionPlanFromUnknown({
      summary: "update prompt",
      updates: [
        {
          path: "prompts/system.md",
          content: "hello",
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.summary).toBe("update prompt");
    expect(parsed?.updates[0]?.path).toBe("prompts/system.md");
  });

  it("returns null for disallowed path", () => {
    const parsed = parseEvolutionPlanFromUnknown({
      summary: "bad path",
      updates: [
        {
          path: "../../secret",
          content: "x",
        },
      ],
    });

    expect(parsed).toBeNull();
  });
});

describe("applyEvolutionPlan", () => {
  it("applies updates and validates", async () => {
    const root = await createTempProject();
    const plan: EvolutionPlan = {
      summary: "update yaml",
      updates: [
        {
          path: "goondan.yaml",
          content: "apiVersion: goondan.ai/v1\nkind: Package\nmetadata:\n  name: test\n",
        },
      ],
    };

    const result = await applyEvolutionPlan({
      projectRoot: root,
      plan,
      validate: async () => {},
    });

    expect(result.changedFiles).toEqual(["goondan.yaml"]);
    const changed = await fs.readFile(path.join(root, "goondan.yaml"), "utf8");
    expect(changed.includes("kind: Package")).toBe(true);
  });

  it("rolls back when validation fails", async () => {
    const root = await createTempProject();
    const original = await fs.readFile(path.join(root, "goondan.yaml"), "utf8");

    const plan: EvolutionPlan = {
      summary: "break yaml",
      updates: [
        {
          path: "goondan.yaml",
          content: "broken-content",
        },
      ],
    };

    await expect(
      applyEvolutionPlan({
        projectRoot: root,
        plan,
        validate: async () => {
          throw new Error("invalid");
        },
      }),
    ).rejects.toThrow("invalid");

    const after = await fs.readFile(path.join(root, "goondan.yaml"), "utf8");
    expect(after).toBe(original);
  });
});
