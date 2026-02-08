/**
 * Global options wiring tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createProgram } from "../src/cli.js";
import { configureLogger, getLoggerOptions } from "../src/utils/logger.js";

function collectConsoleLogs(calls: Array<unknown[]>): string {
  return calls
    .map((args) => args.map((arg) => String(arg)).join(" "))
    .join("\n");
}

function createInstanceFixture(
  stateRoot: string,
  instanceId: string,
  swarmName: string,
): void {
  const eventsDir = path.join(
    stateRoot,
    "instances",
    "ws-test",
    instanceId,
    "swarm",
    "events",
  );
  fs.mkdirSync(eventsDir, { recursive: true });
  const event = {
    type: "swarm.event",
    recordedAt: "2026-02-08T00:00:00.000Z",
    kind: "swarm.started",
    instanceId,
    instanceKey: `${instanceId}-key`,
    swarmName,
  };
  fs.writeFileSync(path.join(eventsDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

describe("gdn global options hook", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-global-options-"));
    process.chdir(tempDir);
    configureLogger({
      verbose: false,
      quiet: false,
      noColor: false,
      json: false,
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    process.exitCode = undefined;
  });

  it("applies global options to top-level commands", async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await program.parseAsync(["node", "gdn", "--quiet", "completion", "bash"]);
    } finally {
      logSpy.mockRestore();
    }

    const loggerOptions = getLoggerOptions();
    expect(loggerOptions.quiet).toBe(true);
  });

  it("applies global options to nested subcommands", async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await program.parseAsync(["node", "gdn", "--verbose", "config", "path"]);
    } finally {
      logSpy.mockRestore();
    }

    const loggerOptions = getLoggerOptions();
    expect(loggerOptions.verbose).toBe(true);
  });

  it("applies global --state-root to config get", async () => {
    const stateRoot = path.join(tempDir, "state-root-config");
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let output = "";

    try {
      await program.parseAsync([
        "node",
        "gdn",
        "--state-root",
        stateRoot,
        "config",
        "get",
        "stateRoot",
      ]);
      output = collectConsoleLogs(logSpy.mock.calls);
    } finally {
      logSpy.mockRestore();
    }

    expect(output).toContain(stateRoot);
  });

  it("applies global --state-root to instance list", async () => {
    const stateRoot = path.join(tempDir, "state-root-instance");
    const instanceId = "instance-state-root-test";
    createInstanceFixture(stateRoot, instanceId, "state-root-swarm");

    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let output = "";

    try {
      await program.parseAsync([
        "node",
        "gdn",
        "--state-root",
        stateRoot,
        "instance",
        "list",
        "--all",
        "--json",
      ]);
      output = collectConsoleLogs(logSpy.mock.calls);
    } finally {
      logSpy.mockRestore();
    }

    expect(output).toContain(instanceId);
    expect(output).toContain("state-root-swarm");
  });

  it("applies global --state-root to logs", async () => {
    const stateRoot = path.join(tempDir, "state-root-logs");
    const instanceId = "logs-state-root-test";
    createInstanceFixture(stateRoot, instanceId, "logs-state-root-swarm");

    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let output = "";

    try {
      await program.parseAsync([
        "node",
        "gdn",
        "--state-root",
        stateRoot,
        "logs",
        instanceId,
        "--type",
        "events",
      ]);
      output = collectConsoleLogs(logSpy.mock.calls);
    } finally {
      logSpy.mockRestore();
    }

    expect(output).toContain("logs-state-root-swarm");
    expect(output).toContain("swarm.started");
    expect(output).not.toContain("not found");
  });
});
