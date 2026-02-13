import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileInstanceManager } from "../src/workspace/instance-manager.js";
import { WorkspacePaths } from "../src/workspace/paths.js";

describe("FileInstanceManager", () => {
  let tempDir: string;
  let paths: WorkspacePaths;
  let manager: FileInstanceManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gdn-im-test-"));
    paths = new WorkspacePaths({
      projectRoot: tempDir,
      stateRoot: path.join(tempDir, ".goondan"),
      packageName: "test-bundle",
    });
    manager = new FileInstanceManager(paths);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("instancesRoot가 없으면 빈 배열을 반환한다", async () => {
    const result = await manager.list();
    expect(result).toEqual([]);
  });

  it("metadata.json이 있는 인스턴스를 목록으로 반환한다", async () => {
    const instanceDir = paths.instancePath("inst-1");
    await fs.mkdir(instanceDir, { recursive: true });

    const metadata = {
      instanceKey: "inst-1",
      agentName: "coder",
      status: "idle",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };

    await fs.writeFile(
      path.join(instanceDir, "metadata.json"),
      JSON.stringify(metadata),
      "utf8",
    );

    const result = await manager.list();
    expect(result).toHaveLength(1);
    expect(result[0].instanceKey).toBe("inst-1");
    expect(result[0].agentName).toBe("coder");
    expect(result[0].status).toBe("idle");
  });

  it("잘못된 metadata.json은 건너뛴다", async () => {
    const goodDir = paths.instancePath("good");
    const badDir = paths.instancePath("bad");
    await fs.mkdir(goodDir, { recursive: true });
    await fs.mkdir(badDir, { recursive: true });

    const goodMetadata = {
      instanceKey: "good",
      agentName: "planner",
      status: "processing",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
    };

    await fs.writeFile(
      path.join(goodDir, "metadata.json"),
      JSON.stringify(goodMetadata),
      "utf8",
    );

    // 잘못된 JSON
    await fs.writeFile(
      path.join(badDir, "metadata.json"),
      "not json",
      "utf8",
    );

    const result = await manager.list();
    expect(result).toHaveLength(1);
    expect(result[0].instanceKey).toBe("good");
  });

  it("metadata.json이 없는 디렉토리는 건너뛴다", async () => {
    const instanceDir = paths.instancePath("no-meta");
    await fs.mkdir(instanceDir, { recursive: true });

    const result = await manager.list();
    expect(result).toHaveLength(0);
  });

  it("delete로 인스턴스 디렉토리를 삭제한다", async () => {
    const instanceDir = paths.instancePath("to-delete");
    await fs.mkdir(instanceDir, { recursive: true });
    await fs.writeFile(path.join(instanceDir, "metadata.json"), "{}", "utf8");

    await manager.delete("to-delete");

    try {
      await fs.access(instanceDir);
      expect.fail("directory should have been deleted");
    } catch {
      // expected
    }
  });

  it("존재하지 않는 인스턴스를 delete해도 에러가 발생하지 않는다", async () => {
    await expect(manager.delete("nonexistent")).resolves.toBeUndefined();
  });
});
