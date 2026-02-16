import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BundleLoader } from "../src/config/bundle-loader.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("BundleLoader package dependencies", () => {
  it("설치된 dependency 패키지 리소스를 번들에 병합한다", async () => {
    const root = await createTempDir("goondan-runtime-");
    const bundleDir = path.join(root, "bundle");
    const stateRoot = path.join(root, "state");

    await mkdir(bundleDir, { recursive: true });
    await mkdir(stateRoot, { recursive: true });

    await writeFile(
      path.join(bundleDir, "goondan.yaml"),
      [
        "apiVersion: goondan.ai/v1",
        "kind: Package",
        "metadata:",
        '  name: "consumer"',
        "spec:",
        '  version: "0.0.1"',
        "  dependencies:",
        '    - name: "@goondan/base"',
        '      version: "^0.1.0"',
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Model",
        "metadata:",
        "  name: local-model",
        "spec:",
        "  provider: mock",
        "  model: mock",
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Agent",
        "metadata:",
        "  name: assistant",
        "spec:",
        "  modelConfig:",
        "    modelRef: Model/local-model",
        "  prompts:",
        "    systemPrompt: you are assistant",
        "  tools:",
        "    - ref:",
        "        kind: Tool",
        "        name: bash",
        '        package: "@goondan/base"',
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Swarm",
        "metadata:",
        "  name: default",
        "spec:",
        "  entryAgent: Agent/assistant",
        "  agents:",
        "    - ref: Agent/assistant",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(bundleDir, "goondan.lock.yaml"),
      [
        "lockfileVersion: 1",
        "packages:",
        '  "@goondan/base@0.1.0":',
        '    version: "0.1.0"',
        '    resolved: "https://registry.example.com/@goondan/base/-/base-0.1.0.tgz"',
        '    integrity: "sha512-test"',
        "    dependencies: {}",
        "",
      ].join("\n"),
      "utf8",
    );

    const depManifestDir = path.join(stateRoot, "packages", "goondan", "base", "0.1.0", "dist");
    await mkdir(depManifestDir, { recursive: true });
    await mkdir(path.join(depManifestDir, "tools"), { recursive: true });
    await writeFile(path.join(depManifestDir, "tools", "bash.js"), "export {};\n", "utf8");
    await writeFile(
      path.join(depManifestDir, "goondan.yaml"),
      [
        "apiVersion: goondan.ai/v1",
        "kind: Package",
        "metadata:",
        '  name: "@goondan/base"',
        "spec:",
        '  version: "0.1.0"',
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Tool",
        "metadata:",
        "  name: bash",
        "spec:",
        '  entry: "./dist/tools/bash.js"',
        "  exports:",
        "    - name: exec",
        '      description: "execute shell command"',
        "      parameters:",
        '        type: "object"',
        "        properties:",
        "          command:",
        '            type: "string"',
        "",
      ].join("\n"),
      "utf8",
    );

    const loader = new BundleLoader({
      stateRoot,
    });

    const result = await loader.load(bundleDir);
    expect(result.errors).toEqual([]);

    const depTool = result.resources.find(
      (resource) => resource.kind === "Tool" && resource.metadata.name === "bash" && resource.__package === "@goondan/base",
    );
    expect(depTool).toBeDefined();
    expect(depTool?.spec).toMatchObject({
      entry: "./dist/tools/bash.js",
    });
    expect(depTool?.__rootDir).toBe(path.join(stateRoot, "packages", "goondan", "base", "0.1.0"));
  });

  it("dependency 패키지에 root/dist manifest가 모두 있으면 dist를 우선 로드한다", async () => {
    const root = await createTempDir("goondan-runtime-dist-priority-");
    const bundleDir = path.join(root, "bundle");
    const stateRoot = path.join(root, "state");

    await mkdir(bundleDir, { recursive: true });
    await mkdir(stateRoot, { recursive: true });

    await writeFile(
      path.join(bundleDir, "goondan.yaml"),
      [
        "apiVersion: goondan.ai/v1",
        "kind: Package",
        "metadata:",
        '  name: "consumer"',
        "spec:",
        '  version: "0.0.1"',
        "  dependencies:",
        '    - name: "@goondan/base"',
        '      version: "^0.1.0"',
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Model",
        "metadata:",
        "  name: local-model",
        "spec:",
        "  provider: mock",
        "  model: mock",
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Agent",
        "metadata:",
        "  name: assistant",
        "spec:",
        "  modelConfig:",
        "    modelRef: Model/local-model",
        "  prompts:",
        "    systemPrompt: you are assistant",
        "  tools:",
        "    - ref:",
        "        kind: Tool",
        "        name: bash",
        '        package: "@goondan/base"',
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Swarm",
        "metadata:",
        "  name: default",
        "spec:",
        "  entryAgent: Agent/assistant",
        "  agents:",
        "    - ref: Agent/assistant",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(bundleDir, "goondan.lock.yaml"),
      [
        "lockfileVersion: 1",
        "packages:",
        '  "@goondan/base@0.1.0":',
        '    version: "0.1.0"',
        '    resolved: "https://registry.example.com/@goondan/base/-/base-0.1.0.tgz"',
        '    integrity: "sha512-test"',
        "    dependencies: {}",
        "",
      ].join("\n"),
      "utf8",
    );

    const depPackageRoot = path.join(stateRoot, "packages", "goondan", "base", "0.1.0");
    const depManifestDir = path.join(depPackageRoot, "dist");
    await mkdir(depManifestDir, { recursive: true });
    await mkdir(path.join(depManifestDir, "tools"), { recursive: true });
    await writeFile(path.join(depManifestDir, "tools", "bash.js"), "export {};\n", "utf8");

    await writeFile(
      path.join(depPackageRoot, "goondan.yaml"),
      [
        "apiVersion: goondan.ai/v1",
        "kind: Package",
        "metadata:",
        '  name: "@goondan/base"',
        "spec:",
        '  version: "0.1.0"',
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Tool",
        "metadata:",
        "  name: root-only",
        "spec:",
        '  entry: "./dist/tools/root-only.js"',
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(depManifestDir, "goondan.yaml"),
      [
        "apiVersion: goondan.ai/v1",
        "kind: Package",
        "metadata:",
        '  name: "@goondan/base"',
        "spec:",
        '  version: "0.1.0"',
        "---",
        "apiVersion: goondan.ai/v1",
        "kind: Tool",
        "metadata:",
        "  name: bash",
        "spec:",
        '  entry: "./dist/tools/bash.js"',
        "  exports:",
        "    - name: exec",
        '      description: "execute shell command"',
        "      parameters:",
        '        type: "object"',
        "        properties:",
        "          command:",
        '            type: "string"',
        "",
      ].join("\n"),
      "utf8",
    );

    const loader = new BundleLoader({
      stateRoot,
    });

    const result = await loader.load(bundleDir);
    expect(result.errors).toEqual([]);

    const distTool = result.resources.find(
      (resource) => resource.kind === "Tool" && resource.metadata.name === "bash" && resource.__package === "@goondan/base",
    );
    expect(distTool).toBeDefined();

    const rootOnlyTool = result.resources.find(
      (resource) =>
        resource.kind === "Tool" && resource.metadata.name === "root-only" && resource.__package === "@goondan/base",
    );
    expect(rootOnlyTool).toBeUndefined();
  });

  it("lockfile에 없는 dependency 범위는 오류로 보고한다", async () => {
    const root = await createTempDir("goondan-runtime-missing-lock-");
    const bundleDir = path.join(root, "bundle");
    const stateRoot = path.join(root, "state");

    await mkdir(bundleDir, { recursive: true });
    await mkdir(stateRoot, { recursive: true });

    await writeFile(
      path.join(bundleDir, "goondan.yaml"),
      [
        "apiVersion: goondan.ai/v1",
        "kind: Package",
        "metadata:",
        '  name: "consumer"',
        "spec:",
        '  version: "0.0.1"',
        "  dependencies:",
        '    - name: "@goondan/base"',
        '      version: "^0.1.0"',
        "",
      ].join("\n"),
      "utf8",
    );

    const loader = new BundleLoader({
      stateRoot,
    });

    const result = await loader.load(bundleDir);
    expect(result.errors.some((error) => error.code === "E_CONFIG_PACKAGE_LOCK_MISSING")).toBe(true);
  });
});
