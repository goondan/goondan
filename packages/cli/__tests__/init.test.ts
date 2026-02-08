/**
 * Tests for the gdn init command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createInitCommand,
  executeInit,
  type InitOptions,
} from "../src/commands/init.js";

describe("gdn init command", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-init-test-"));
  });

  afterEach(() => {
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("createInitCommand", () => {
    it("should create a Commander command", () => {
      const command = createInitCommand();

      expect(command.name()).toBe("init");
      expect(command.description()).toContain("Goondan Swarm project");
    });

    it("should have expected options", () => {
      const command = createInitCommand();
      const options = command.options.map((opt) => opt.long ?? opt.short);

      expect(options).toContain("--name");
      expect(options).toContain("--template");
      expect(options).toContain("--package");
      expect(options).toContain("--git");
      expect(options).toContain("--force");
    });
  });

  describe("template generation", () => {
    it("should include apiVersion agents.example.io/v1alpha1 in goondan.yaml", async () => {
      const projectDir = path.join(testDir, "test-project");
      const options: InitOptions = {
        template: "default",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      const goonandYaml = fs.readFileSync(
        path.join(projectDir, "goondan.yaml"),
        "utf8"
      );

      expect(goonandYaml).toContain("apiVersion: agents.example.io/v1alpha1");
    });

    it("should create expected files for default template", async () => {
      const projectDir = path.join(testDir, "default-project");
      const options: InitOptions = {
        template: "default",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      expect(fs.existsSync(path.join(projectDir, "goondan.yaml"))).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, "prompts/default.system.md"))
      ).toBe(true);
      expect(fs.existsSync(path.join(projectDir, ".gitignore"))).toBe(true);
    });

    it("should create expected files for minimal template", async () => {
      const projectDir = path.join(testDir, "minimal-project");
      const options: InitOptions = {
        template: "minimal",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      expect(fs.existsSync(path.join(projectDir, "goondan.yaml"))).toBe(true);
      // Minimal template should not have prompts directory
      expect(fs.existsSync(path.join(projectDir, "prompts"))).toBe(false);
      // Minimal template should not have .gitignore
      expect(fs.existsSync(path.join(projectDir, ".gitignore"))).toBe(false);
    });

    it("should create expected files for multi-agent template", async () => {
      const projectDir = path.join(testDir, "multi-agent-project");
      const options: InitOptions = {
        template: "multi-agent",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      expect(fs.existsSync(path.join(projectDir, "goondan.yaml"))).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, "prompts/planner.system.md"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, "prompts/executor.system.md"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, "prompts/reviewer.system.md"))
      ).toBe(true);
      expect(fs.existsSync(path.join(projectDir, ".gitignore"))).toBe(true);
    });

    it("should create expected files for package template", async () => {
      const projectDir = path.join(testDir, "package-project");
      const options: InitOptions = {
        template: "package",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      expect(fs.existsSync(path.join(projectDir, "goondan.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, "package.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, "tsconfig.json"))).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, "src/tools/example/tool.yaml"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, "src/tools/example/index.ts"))
      ).toBe(true);
    });

    it("should generate spec-compliant package.yaml for package template", async () => {
      const projectDir = path.join(testDir, "package-spec-project");
      const options: InitOptions = {
        template: "package",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      const packageYaml = fs.readFileSync(
        path.join(projectDir, "package.yaml"),
        "utf8",
      );

      expect(packageYaml).toContain("kind: Package");
      expect(packageYaml).toContain("metadata:");
      expect(packageYaml).toContain('version: "0.1.0"');
      expect(packageYaml).toContain("access: public");
      expect(packageYaml).toContain("dependencies: []");
      expect(packageYaml).toContain("resources:");
      expect(packageYaml).toContain('    - "goondan.yaml"');
      expect(packageYaml).toContain('    - "src/tools/example/tool.yaml"');
      expect(packageYaml).toContain("dist:");
      expect(packageYaml).toContain('    - "."');
      expect(packageYaml).not.toContain("kind: Bundle");
    });
  });

  describe("goondan.yaml content", () => {
    it("should have Model, Agent, Swarm, and Connector resources", async () => {
      const projectDir = path.join(testDir, "content-test");
      const options: InitOptions = {
        template: "default",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      const goonandYaml = fs.readFileSync(
        path.join(projectDir, "goondan.yaml"),
        "utf8"
      );

      expect(goonandYaml).toContain("kind: Model");
      expect(goonandYaml).toContain("kind: Agent");
      expect(goonandYaml).toContain("kind: Swarm");
      expect(goonandYaml).toContain("kind: Connector");
    });

    it("should include CLI connector configuration", async () => {
      const projectDir = path.join(testDir, "connector-test");
      const options: InitOptions = {
        template: "default",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      const goonandYaml = fs.readFileSync(
        path.join(projectDir, "goondan.yaml"),
        "utf8"
      );

      expect(goonandYaml).toContain("type: cli");
      expect(goonandYaml).toContain("ingress:");
      expect(goonandYaml).toContain("route: {}");
      expect(goonandYaml).not.toContain("instanceKeyFrom:");
      expect(goonandYaml).not.toContain("inputFrom:");
      expect(goonandYaml).not.toContain("swarmRef:");
    });

    it("should use project name from --name option", async () => {
      const projectDir = path.join(testDir, "name-test");
      const options: InitOptions = {
        name: "my-custom-swarm",
        template: "default",
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      const goonandYaml = fs.readFileSync(
        path.join(projectDir, "goondan.yaml"),
        "utf8"
      );

      expect(goonandYaml).toContain("name: my-custom-swarm");
    });
  });

  describe("--package flag", () => {
    it("should use package template when --package flag is set", async () => {
      const projectDir = path.join(testDir, "package-flag-test");
      const options: InitOptions = {
        package: true,
        template: "default", // Will be overridden by --package
        git: false,
        force: false,
      };

      await executeInit(projectDir, options);

      expect(fs.existsSync(path.join(projectDir, "package.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    });
  });
});
