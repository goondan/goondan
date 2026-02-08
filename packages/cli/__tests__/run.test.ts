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

/** Bundle with a single swarm named "my-swarm" (no "default" swarm) */
const SINGLE_NON_DEFAULT_SWARM_BUNDLE = `apiVersion: agents.example.io/v1alpha1
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
  name: my-agent
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
  name: my-swarm
spec:
  entrypoint: { kind: Agent, name: my-agent }
  agents:
    - { kind: Agent, name: my-agent }
`;

/** Bundle with two swarms, neither named "default" */
const MULTI_NON_DEFAULT_SWARM_BUNDLE = `apiVersion: agents.example.io/v1alpha1
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
  name: agent-a
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    system: |
      You are agent A.

---

apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: agent-b
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    system: |
      You are agent B.

---

apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: swarm-alpha
spec:
  entrypoint: { kind: Agent, name: agent-a }
  agents:
    - { kind: Agent, name: agent-a }

---

apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: swarm-beta
spec:
  entrypoint: { kind: Agent, name: agent-b }
  agents:
    - { kind: Agent, name: agent-b }
`;

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
  swarmRef: { kind: Swarm, name: default }
  ingress:
    rules:
      - match:
          event: cli.message
        route:
          agentRef: { kind: Agent, name: default }
`;

/** Bundle with Connection whose swarmRef points to a different Swarm */
const BUNDLE_WITH_OTHER_SWARM_CONNECTION = `apiVersion: agents.example.io/v1alpha1
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
kind: Swarm
metadata:
  name: other-swarm
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
  entry: ./connectors/cli/index.js
  triggers:
    - type: cli

---

apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli-to-other
spec:
  connectorRef: { kind: Connector, name: cli }
  swarmRef: { kind: Swarm, name: other-swarm }
  ingress:
    rules:
      - match:
          event: cli.message
        route:
          agentRef: { kind: Agent, name: default }
`;

/** Bundle with Connection referencing a nonexistent Connector (validation should catch it) */
const BUNDLE_WITH_MISSING_CONNECTOR = `apiVersion: agents.example.io/v1alpha1
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
kind: Connection
metadata:
  name: conn-to-missing
spec:
  connectorRef: { kind: Connector, name: nonexistent }
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

    // Create mock connector entry file (referenced by Connector spec.entry)
    const connectorDir = path.join(tempDir, "connectors", "cli");
    fs.mkdirSync(connectorDir, { recursive: true });
    fs.writeFileSync(path.join(connectorDir, "index.js"), "// mock connector entry");
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

  it("shows not-found message for --connector http when no http connector in bundle", async () => {
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

    expect(output).toContain("Connector 'http' not found in bundle");
    expect(process.exitCode).toBe(ExitCode.CONFIG_ERROR);
  });

  it("uses global --config path when running from a different cwd", async () => {
    const bundleDir = path.join(tempDir, "bundle");
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.writeFileSync(path.join(bundleDir, "goondan.yaml"), MINIMAL_BUNDLE, "utf8");

    // Create mock entry file relative to bundleDir
    const connectorDir = path.join(bundleDir, "connectors", "cli");
    fs.mkdirSync(connectorDir, { recursive: true });
    fs.writeFileSync(path.join(connectorDir, "index.js"), "// mock connector entry");

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

  it("auto-selects the only swarm when no 'default' swarm exists", async () => {
    fs.writeFileSync(
      path.join(tempDir, "goondan.yaml"),
      SINGLE_NON_DEFAULT_SWARM_BUNDLE,
      "utf8",
    );

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
      output =
        collectWrites(stdoutSpy.mock.calls) +
        collectWrites(stderrSpy.mock.calls);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(output).toContain("Auto-selected the only available swarm: 'my-swarm'");
    // Swarm should start successfully (not error out)
    expect(process.exitCode ?? ExitCode.SUCCESS).toBe(ExitCode.SUCCESS);
  });

  it("errors with available swarms list when multiple non-default swarms exist", async () => {
    fs.writeFileSync(
      path.join(tempDir, "goondan.yaml"),
      MULTI_NON_DEFAULT_SWARM_BUNDLE,
      "utf8",
    );

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
      output =
        collectWrites(stdoutSpy.mock.calls) +
        collectWrites(stderrSpy.mock.calls);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(output).toContain("Swarm 'default' not found in bundle");
    expect(output).toContain("Available swarms:");
    expect(output).toContain("swarm-alpha");
    expect(output).toContain("swarm-beta");
    expect(process.exitCode).toBe(ExitCode.CONFIG_ERROR);
  });

  it("does not auto-select when --swarm is explicitly provided and not found", async () => {
    fs.writeFileSync(
      path.join(tempDir, "goondan.yaml"),
      SINGLE_NON_DEFAULT_SWARM_BUNDLE,
      "utf8",
    );

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let output = "";

    try {
      const command = createRunCommand();
      await command.parseAsync(
        ["--swarm", "nonexistent", "--no-interactive", "--no-install"],
        { from: "user" },
      );
      output =
        collectWrites(stdoutSpy.mock.calls) +
        collectWrites(stderrSpy.mock.calls);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(output).toContain("Swarm 'nonexistent' not found in bundle");
    expect(output).toContain("Available swarms:");
    expect(output).toContain("my-swarm");
    expect(output).not.toContain("Auto-selected");
    expect(process.exitCode).toBe(ExitCode.CONFIG_ERROR);
  });

  it("filters out connections whose swarmRef points to a different swarm", async () => {
    fs.writeFileSync(
      path.join(tempDir, "goondan.yaml"),
      BUNDLE_WITH_OTHER_SWARM_CONNECTION,
      "utf8",
    );

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
      output =
        collectWrites(stdoutSpy.mock.calls) +
        collectWrites(stderrSpy.mock.calls);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    // Connection의 swarmRef가 other-swarm인데 실행 Swarm이 default이므로 필터링됨
    // CLI connector가 없으므로 interactive fallback 경로로 가야 함 (--no-interactive이므로 안내 메시지)
    expect(output).not.toContain("Starting CLI connector");
    expect(output).toContain("No input provided and interactive mode is disabled");
    expect(process.exitCode ?? ExitCode.SUCCESS).toBe(ExitCode.SUCCESS);
  });

  it("fails validation when Connection references a nonexistent Connector", async () => {
    fs.writeFileSync(
      path.join(tempDir, "goondan.yaml"),
      BUNDLE_WITH_MISSING_CONNECTOR,
      "utf8",
    );

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
      output =
        collectWrites(stdoutSpy.mock.calls) +
        collectWrites(stderrSpy.mock.calls);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    // Bundle validation catches the missing Connector reference
    expect(output).toContain("Connector/nonexistent");
    expect(process.exitCode).toBe(ExitCode.VALIDATION_ERROR);
  });
});
