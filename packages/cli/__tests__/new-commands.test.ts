/**
 * Tests for new CLI commands added in v0.11 spec alignment
 *
 * - gdn package unpublish
 * - gdn package deprecate
 * - gdn instance pause
 * - gdn instance resume (existing)
 * - gdn instance terminate
 * - gdn instance list --status
 * - gdn logs --trace
 * - gdn doctor --runtime
 */

import { describe, it, expect } from "vitest";
import { createUnpublishCommand } from "../src/commands/package/unpublish.js";
import { createDeprecateCommand } from "../src/commands/package/deprecate.js";
import { createPauseCommand } from "../src/commands/instance/pause.js";
import { createTerminateCommand } from "../src/commands/instance/terminate.js";
import { createListCommand } from "../src/commands/instance/list.js";
import { createLogsCommand } from "../src/commands/logs.js";
import { createDoctorCommand, checkRuntimeHealth } from "../src/commands/doctor.js";
import { validateModelCapabilities } from "../src/commands/validate.js";
import {
  createInstanceCommand,
} from "../src/commands/instance/index.js";
import {
  createPackageCommand,
} from "../src/commands/package/index.js";
import type { Resource } from "@goondan/core";

// ============================================================================
// Package Unpublish
// ============================================================================
describe("gdn package unpublish", () => {
  it("should create a valid commander Command", () => {
    const command = createUnpublishCommand();
    expect(command.name()).toBe("unpublish");
    expect(command.description()).toContain("Unpublish");
  });

  it("should have --force and --registry options", () => {
    const command = createUnpublishCommand();
    const options = command.options.map((o) => o.long);
    expect(options).toContain("--force");
    expect(options).toContain("--registry");
  });

  it("should require a ref argument", () => {
    const command = createUnpublishCommand();
    const args = command.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0]?.required).toBe(true);
  });
});

// ============================================================================
// Package Deprecate
// ============================================================================
describe("gdn package deprecate", () => {
  it("should create a valid commander Command", () => {
    const command = createDeprecateCommand();
    expect(command.name()).toBe("deprecate");
    expect(command.description()).toContain("deprecation");
  });

  it("should have --message and --registry options", () => {
    const command = createDeprecateCommand();
    const options = command.options.map((o) => o.long);
    expect(options).toContain("--message");
    expect(options).toContain("--registry");
  });

  it("should require a ref argument", () => {
    const command = createDeprecateCommand();
    const args = command.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0]?.required).toBe(true);
  });
});

// ============================================================================
// Package Command Group
// ============================================================================
describe("gdn package (group)", () => {
  it("should include unpublish and deprecate subcommands", () => {
    const command = createPackageCommand();
    const subcommandNames = command.commands.map((c) => c.name());
    expect(subcommandNames).toContain("unpublish");
    expect(subcommandNames).toContain("deprecate");
  });
});

// ============================================================================
// Instance Pause
// ============================================================================
describe("gdn instance pause", () => {
  it("should create a valid commander Command", () => {
    const command = createPauseCommand();
    expect(command.name()).toBe("pause");
    expect(command.description()).toContain("Pause");
  });

  it("should have --force option", () => {
    const command = createPauseCommand();
    const options = command.options.map((o) => o.long);
    expect(options).toContain("--force");
  });

  it("should require an id argument", () => {
    const command = createPauseCommand();
    const args = command.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0]?.required).toBe(true);
  });
});

// ============================================================================
// Instance Terminate
// ============================================================================
describe("gdn instance terminate", () => {
  it("should create a valid commander Command", () => {
    const command = createTerminateCommand();
    expect(command.name()).toBe("terminate");
    expect(command.description()).toContain("Terminate");
  });

  it("should have --force and --reason options", () => {
    const command = createTerminateCommand();
    const options = command.options.map((o) => o.long);
    expect(options).toContain("--force");
    expect(options).toContain("--reason");
  });

  it("should require an id argument", () => {
    const command = createTerminateCommand();
    const args = command.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0]?.required).toBe(true);
  });
});

// ============================================================================
// Instance Command Group
// ============================================================================
describe("gdn instance (group)", () => {
  it("should include pause and terminate subcommands", () => {
    const command = createInstanceCommand();
    const subcommandNames = command.commands.map((c) => c.name());
    expect(subcommandNames).toContain("pause");
    expect(subcommandNames).toContain("terminate");
    expect(subcommandNames).toContain("resume");
    expect(subcommandNames).toContain("list");
    expect(subcommandNames).toContain("inspect");
    expect(subcommandNames).toContain("delete");
  });
});

// ============================================================================
// Instance List --status
// ============================================================================
describe("gdn instance list --status", () => {
  it("should have --status option", () => {
    const command = createListCommand();
    const options = command.options.map((o) => o.long);
    expect(options).toContain("--status");
  });
});

// ============================================================================
// Logs --trace
// ============================================================================
describe("gdn logs --trace", () => {
  it("should have --trace option", () => {
    const command = createLogsCommand();
    const options = command.options.map((o) => o.long);
    expect(options).toContain("--trace");
  });
});

// ============================================================================
// Doctor --runtime
// ============================================================================
describe("gdn doctor --runtime", () => {
  it("should have --runtime and --port options", () => {
    const command = createDoctorCommand();
    const options = command.options.map((o) => o.long);
    expect(options).toContain("--runtime");
    expect(options).toContain("--port");
  });

  it("checkRuntimeHealth should return fail when no server is running", async () => {
    // Use a port that is very unlikely to have a server
    const result = await checkRuntimeHealth(59999);
    expect(result.name).toBe("Runtime Health");
    expect(result.status).toBe("fail");
    expect(result.message).toContain("Cannot reach");
  });
});

// ============================================================================
// Validate: Model Capability Check
// ============================================================================
describe("gdn validate - model capability", () => {
  function makeResource(
    kind: string,
    name: string,
    spec: Record<string, unknown>,
  ): Resource {
    return {
      apiVersion: "agents.example.io/v1alpha1",
      kind,
      metadata: { name },
      spec,
    };
  }

  it("should return no issues when model has no capabilities declared", () => {
    const resources: Resource[] = [
      makeResource("Model", "my-model", {
        provider: "anthropic",
        name: "claude-sonnet-4-5",
      }),
      makeResource("Agent", "my-agent", {
        modelConfig: { modelRef: { kind: "Model", name: "my-model" } },
        prompts: { system: "test" },
        tools: [{ kind: "Tool", name: "my-tool" }],
      }),
    ];

    const issues = validateModelCapabilities(resources);
    expect(issues).toHaveLength(0);
  });

  it("should return no issues when model supports toolCalling", () => {
    const resources: Resource[] = [
      makeResource("Model", "my-model", {
        provider: "anthropic",
        name: "claude-sonnet-4-5",
        capabilities: { toolCalling: true, streaming: true },
      }),
      makeResource("Agent", "my-agent", {
        modelConfig: { modelRef: { kind: "Model", name: "my-model" } },
        prompts: { system: "test" },
        tools: [{ kind: "Tool", name: "my-tool" }],
      }),
    ];

    const issues = validateModelCapabilities(resources);
    expect(issues).toHaveLength(0);
  });

  it("should warn when agent uses tools but model declares toolCalling: false", () => {
    const resources: Resource[] = [
      makeResource("Model", "no-tool-model", {
        provider: "anthropic",
        name: "claude-haiku",
        capabilities: { toolCalling: false },
      }),
      makeResource("Agent", "my-agent", {
        modelConfig: { modelRef: { kind: "Model", name: "no-tool-model" } },
        prompts: { system: "test" },
        tools: [{ kind: "Tool", name: "my-tool" }],
      }),
    ];

    const issues = validateModelCapabilities(resources);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("MODEL_CAPABILITY_MISMATCH");
    expect(issues[0]?.level).toBe("warning");
    expect(issues[0]?.message).toContain("my-agent");
    expect(issues[0]?.message).toContain("no-tool-model");
  });

  it("should not warn when agent has no tools", () => {
    const resources: Resource[] = [
      makeResource("Model", "no-tool-model", {
        provider: "anthropic",
        name: "claude-haiku",
        capabilities: { toolCalling: false },
      }),
      makeResource("Agent", "my-agent", {
        modelConfig: { modelRef: { kind: "Model", name: "no-tool-model" } },
        prompts: { system: "test" },
      }),
    ];

    const issues = validateModelCapabilities(resources);
    expect(issues).toHaveLength(0);
  });
});
