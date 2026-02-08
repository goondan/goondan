/**
 * gdn run command tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRunCommand } from "../src/commands/run.js";
import { createProgram } from "../src/cli.js";
import { ExitCode } from "../src/types.js";

const MINIMAL_BUNDLE = `apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

---

apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: default
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    system: |
      You are a helpful assistant.

---

apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: default }
  agents:
    - { kind: Agent, name: default }

---

apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  runtime: node
  type: cli
  entry: ./connectors/cli/index.js
  triggers:
    - type: cli

---

apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - match:
          event: cli.message
        route:
          agentRef: { kind: Agent, name: default }
`;

function collectWrites(writes: Array<[unknown, ...unknown[]]>): string {
  return writes.map(([chunk]) => String(chunk)).join("");
}

describe("gdn run command", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-run-test-"));
    process.chdir(tempDir);
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    process.exitCode = undefined;
  });

  it("respects --no-interactive even when CLI connector exists", async () => {
    fs.writeFileSync(path.join(tempDir, "goondan.yaml"), MINIMAL_BUNDLE, "utf8");

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let output = "";

    try {
      const command = createRunCommand();
      await command.parseAsync(["--no-interactive", "--no-install"], {
        from: "user",
      });
      output = collectWrites(stdoutSpy.mock.calls) + collectWrites(stderrSpy.mock.calls);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(output).toContain("Skipping CLI connector");
    expect(output).toContain("interactive mode is disabled");
    expect(process.exitCode ?? ExitCode.SUCCESS).toBe(ExitCode.SUCCESS);
  });

  it("shows explicit not-implemented message for --connector http", async () => {
    fs.writeFileSync(path.join(tempDir, "goondan.yaml"), MINIMAL_BUNDLE, "utf8");

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let output = "";

    try {
      const command = createRunCommand();
      await command.parseAsync(["--connector", "http", "--no-install"], {
        from: "user",
      });
      output = collectWrites(stdoutSpy.mock.calls) + collectWrites(stderrSpy.mock.calls);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(output).toContain("Connector 'http' is not implemented yet in this CLI runtime.");
    expect(process.exitCode).toBe(ExitCode.INVALID_ARGS);
  });

  it("uses global --config path when running from a different cwd", async () => {
    const bundleDir = path.join(tempDir, "bundle");
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.writeFileSync(path.join(bundleDir, "goondan.yaml"), MINIMAL_BUNDLE, "utf8");

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let output = "";

    try {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "gdn",
        "--config",
        path.join("bundle", "goondan.yaml"),
        "run",
        "--no-install",
        "--no-interactive",
      ]);
      output = collectWrites(stdoutSpy.mock.calls) + collectWrites(stderrSpy.mock.calls);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(output).toContain("Found configuration:");
    expect(output).toContain(path.join("bundle", "goondan.yaml"));
    expect(process.exitCode ?? ExitCode.SUCCESS).toBe(ExitCode.SUCCESS);
  });

  it("writes instance state under --state-root", async () => {
    fs.writeFileSync(path.join(tempDir, "goondan.yaml"), MINIMAL_BUNDLE, "utf8");
    const stateRoot = path.join(tempDir, "custom-state-root");

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "gdn",
        "--state-root",
        stateRoot,
        "run",
        "--no-install",
        "--no-interactive",
      ]);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    const instancesRoot = path.join(stateRoot, "instances");
    expect(fs.existsSync(instancesRoot)).toBe(true);

    const workspaceDirs = fs
      .readdirSync(instancesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    expect(workspaceDirs.length).toBeGreaterThan(0);

    const firstWorkspace = workspaceDirs[0];
    if (!firstWorkspace) {
      throw new Error("Expected at least one workspace directory");
    }

    const workspacePath = path.join(instancesRoot, firstWorkspace.name);
    const instanceDirs = fs
      .readdirSync(workspacePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    expect(instanceDirs.length).toBeGreaterThan(0);

    const firstInstance = instanceDirs[0];
    if (!firstInstance) {
      throw new Error("Expected at least one instance directory");
    }

    const metadataPath = path.join(workspacePath, firstInstance.name, "metadata.json");
    expect(fs.existsSync(metadataPath)).toBe(true);
  });
});
