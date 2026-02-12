import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BotStateStore } from "../src/state.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.cwd(), ".tmp-sample10-state-"));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("BotStateStore", () => {
  it("saves only offset", async () => {
    const root = await createTempDir();
    const statePath = path.join(root, "state.json");

    const store = await BotStateStore.create(statePath);
    store.setOffset(42);
    await store.save();

    const raw = await fs.readFile(statePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    expect(parsed).toEqual({ offset: 42 });
  });

  it("reads legacy state with conversations and rewrites to offset-only", async () => {
    const root = await createTempDir();
    const statePath = path.join(root, "state.json");

    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          offset: 7,
          conversations: {
            "1": [
              {
                role: "user",
                content: "hello",
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = await BotStateStore.create(statePath);
    expect(store.getOffset()).toBe(7);

    await store.save();

    const raw = await fs.readFile(statePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    expect(parsed).toEqual({ offset: 7 });
  });
});
