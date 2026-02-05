/**
 * gdn validate command tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createValidateCommand } from "../src/commands/validate.js";
import { Command } from "commander";

// Test fixtures
const validBundleYaml = `apiVersion: agents.example.io/v1alpha1
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
  type: cli
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"
`;

const invalidBundleYaml = `apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: invalid-agent
spec:
  # Missing required modelConfig
  prompts:
    system: "Test prompt"
`;

const bundleWithBadReference = `apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: test-agent
spec:
  modelConfig:
    modelRef: { kind: Model, name: nonexistent-model }
  prompts:
    system: "Test prompt"
`;

const bundleWithNamingWarning = `apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: MyBadlyNamedModel
spec:
  provider: anthropic
  name: claude-sonnet-4-5
`;

describe("gdn validate command", () => {
  let tempDir: string;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-validate-test-"));
    // Save original exit code
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    // Restore exit code
    process.exitCode = originalExitCode;
  });

  describe("command creation", () => {
    it("should create validate command with correct options", () => {
      const command = createValidateCommand();

      expect(command.name()).toBe("validate");
      expect(command.description()).toBe("Validate Bundle configuration");

      // Check options
      const options = command.options;
      const optionNames = options.map((o) => o.long);

      expect(optionNames).toContain("--strict");
      expect(optionNames).toContain("--fix");
      expect(optionNames).toContain("--format");
    });

    it("should register with parent program", () => {
      const program = new Command();
      program.addCommand(createValidateCommand());

      const validateCmd = program.commands.find((c) => c.name() === "validate");
      expect(validateCmd).toBeDefined();
    });
  });

  describe("valid bundle validation", () => {
    it("should pass validation for valid bundle", async () => {
      // Write valid bundle
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, validBundleYaml);

      // Create and run command
      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      // Capture console output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir, "--format", "json"]);
      } catch {
        // Command might throw on exit
      } finally {
        console.log = originalLog;
      }

      // Check output
      const output = logs.join("\n");
      expect(output).toContain('"valid":');

      // Parse JSON output
      const jsonStart = output.indexOf("{");
      const jsonEnd = output.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const jsonOutput = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
          valid: boolean;
          errors: unknown[];
        };
        expect(jsonOutput.valid).toBe(true);
        expect(jsonOutput.errors).toHaveLength(0);
      }
    });
  });

  describe("invalid bundle validation", () => {
    it("should detect missing required fields", async () => {
      // Write invalid bundle
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, invalidBundleYaml);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir, "--format", "json"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      const jsonStart = output.indexOf("{");
      const jsonEnd = output.lastIndexOf("}");

      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const jsonOutput = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
          valid: boolean;
          errors: Array<{ message: string }>;
        };
        expect(jsonOutput.valid).toBe(false);
        expect(jsonOutput.errors.length).toBeGreaterThan(0);
        expect(jsonOutput.errors.some((e) => e.message.includes("modelConfig"))).toBe(true);
      }
    });

    it("should detect reference errors", async () => {
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, bundleWithBadReference);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir, "--format", "json"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      const jsonStart = output.indexOf("{");
      const jsonEnd = output.lastIndexOf("}");

      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const jsonOutput = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
          valid: boolean;
          errors: Array<{ message: string; code: string }>;
        };
        expect(jsonOutput.valid).toBe(false);
        expect(jsonOutput.errors.some((e) => e.code === "REFERENCE_ERROR")).toBe(true);
      }
    });
  });

  describe("warning handling", () => {
    it("should report naming convention warnings", async () => {
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, bundleWithNamingWarning);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir, "--format", "json"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      const jsonStart = output.indexOf("{");
      const jsonEnd = output.lastIndexOf("}");

      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const jsonOutput = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
          valid: boolean;
          warnings: Array<{ message: string }>;
        };
        // Should be valid (warnings don't fail)
        expect(jsonOutput.valid).toBe(true);
        expect(jsonOutput.warnings.length).toBeGreaterThan(0);
        expect(jsonOutput.warnings.some((w) => w.message.includes("naming convention"))).toBe(true);
      }
    });

    it("should treat warnings as errors in strict mode", async () => {
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, bundleWithNamingWarning);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir, "--strict", "--format", "json"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      const jsonStart = output.indexOf("{");
      const jsonEnd = output.lastIndexOf("}");

      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const jsonOutput = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
          valid: boolean;
        };
        // Should fail in strict mode
        expect(jsonOutput.valid).toBe(false);
      }
    });
  });

  describe("output formats", () => {
    it("should output text format by default", async () => {
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, validBundleYaml);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      // Text format should have checkmarks or human-readable text
      expect(output).toMatch(/Validating|passed|failed/i);
    });

    it("should output JSON format when requested", async () => {
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, validBundleYaml);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir, "--format", "json"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      // Should be valid JSON
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("should output GitHub format when requested", async () => {
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, invalidBundleYaml);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir, "--format", "github"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      // GitHub format uses ::error:: or ::warning:: or ::notice::
      expect(output).toMatch(/::(error|warning|notice)::/);
    });
  });

  describe("path handling", () => {
    it("should validate directory path", async () => {
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, validBundleYaml);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", tempDir, "--format", "json"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      expect(output).toContain('"valid"');
    });

    it("should validate single file path", async () => {
      const bundlePath = path.join(tempDir, "goondan.yaml");
      fs.writeFileSync(bundlePath, validBundleYaml);

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", bundlePath, "--format", "json"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      expect(output).toContain('"valid"');
    });

    it("should handle non-existent path", async () => {
      const nonExistentPath = path.join(tempDir, "nonexistent");

      const program = new Command();
      program.exitOverride();
      program.addCommand(createValidateCommand());

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await program.parseAsync(["node", "test", "validate", nonExistentPath, "--format", "json"]);
      } catch {
        // Expected
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      const jsonStart = output.indexOf("{");
      const jsonEnd = output.lastIndexOf("}");

      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const jsonOutput = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
          valid: boolean;
          errors: Array<{ code: string }>;
        };
        expect(jsonOutput.valid).toBe(false);
        expect(jsonOutput.errors.some((e) => e.code === "PATH_NOT_FOUND")).toBe(true);
      }
    });
  });
});
