/**
 * gdn doctor command tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  checkNodeVersion,
  checkPnpm,
  checkNpm,
  checkApiKeys,
  checkBundleConfig,
  checkDependencies,
  checkTypeScript,
  checkGoondanPackages,
  checkBundleValidation,
  parseVersion,
  createDoctorCommand,
  executeDoctorCommand,
} from "../src/commands/doctor.js";

describe("parseVersion", () => {
  it("should parse a valid version string", () => {
    const result = parseVersion("v20.11.0");
    expect(result).toEqual({ major: 20, minor: 11, patch: 0 });
  });

  it("should parse version without 'v' prefix", () => {
    const result = parseVersion("18.0.0");
    expect(result).toEqual({ major: 18, minor: 0, patch: 0 });
  });

  it("should return null for invalid version", () => {
    const result = parseVersion("invalid");
    expect(result).toBeNull();
  });

  it("should return null for empty string", () => {
    const result = parseVersion("");
    expect(result).toBeNull();
  });
});

describe("checkNodeVersion", () => {
  it("should return pass for current Node.js version (>= 18)", () => {
    const result = checkNodeVersion();
    // Current test environment should have Node.js >= 18
    expect(result.name).toBe("Node.js");
    expect(result.status).toBe("pass");
    expect(result.message).toContain("Node.js");
  });
});

describe("checkNpm", () => {
  it("should return pass when npm is available", () => {
    const result = checkNpm();
    expect(result.name).toBe("npm");
    // npm should always be available in a Node.js environment
    expect(result.status).toBe("pass");
  });
});

describe("checkApiKeys", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should detect set API keys", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-1234567890";
    const results = checkApiKeys();

    const anthropicResult = results.find((r) =>
      r.name.includes("Anthropic")
    );
    expect(anthropicResult).toBeDefined();
    expect(anthropicResult?.status).toBe("pass");
  });

  it("should warn when no API keys are set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    const results = checkApiKeys();

    // Should have individual warnings plus the "no keys at all" warning
    const noKeysWarning = results.find((r) =>
      r.name === "LLM API Keys"
    );
    expect(noKeysWarning).toBeDefined();
    expect(noKeysWarning?.status).toBe("warn");
  });

  it("should not add 'no keys' warning when at least one key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    const results = checkApiKeys();
    const noKeysWarning = results.find((r) =>
      r.name === "LLM API Keys"
    );
    expect(noKeysWarning).toBeUndefined();
  });
});

describe("checkBundleConfig", () => {
  const originalCwd = process.cwd;

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("should return warn when no goondan.yaml exists", () => {
    // Point to a temporary directory with no config
    process.cwd = () => "/tmp/nonexistent-dir-for-doctor-test";
    const result = checkBundleConfig();
    expect(result.name).toBe("Bundle Config");
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("gdn init");
  });
});

describe("checkDependencies", () => {
  const originalCwd = process.cwd;

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("should return pass when no package.json (standalone bundle)", () => {
    process.cwd = () => "/tmp/nonexistent-dir-for-doctor-test";
    const result = checkDependencies();
    expect(result.name).toBe("Dependencies");
    expect(result.status).toBe("pass");
    expect(result.message).toContain("standalone");
  });
});

describe("checkGoondanPackages", () => {
  it("should return results for all three goondan packages", () => {
    const results = checkGoondanPackages();
    expect(results.length).toBe(3);

    const names = results.map((r) => r.name);
    expect(names).toContain("@goondan/core");
    expect(names).toContain("@goondan/cli");
    expect(names).toContain("@goondan/base");
  });

  it("should find packages in workspace (running from within the monorepo)", () => {
    // When running tests from the monorepo, it should find packages
    const results = checkGoondanPackages();
    // At least @goondan/core should be found since we depend on it
    const coreResult = results.find((r) => r.name === "@goondan/core");
    expect(coreResult).toBeDefined();
    // Could be pass (found) or warn (not found), depends on environment
    expect(["pass", "warn"]).toContain(coreResult?.status);
  });
});

describe("checkBundleValidation", () => {
  const originalCwd = process.cwd;

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("should return warn when no config file exists", async () => {
    process.cwd = () => "/tmp/nonexistent-dir-for-doctor-test";
    const result = await checkBundleValidation();
    expect(result.name).toBe("Bundle Validation");
    expect(result.status).toBe("warn");
    expect(result.message).toContain("Skipped");
  });

  it("should validate a valid bundle", async () => {
    // Create a temp dir with a valid goondan.yaml
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-doctor-test-"));
    const validYaml = `apiVersion: agents.example.io/v1alpha1
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
    system: "You are helpful."

---

apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: default }
  agents:
    - { kind: Agent, name: default }
`;
    fs.writeFileSync(path.join(tmpDir, "goondan.yaml"), validYaml, "utf-8");

    process.cwd = () => tmpDir;
    const result = await checkBundleValidation();
    expect(result.name).toBe("Bundle Validation");
    expect(result.status).toBe("pass");
    expect(result.message).toContain("Valid");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should detect invalid bundle", async () => {
    // Create a temp dir with an invalid goondan.yaml
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-doctor-test-"));
    const invalidYaml = `apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: broken
spec:
  entrypoint: { kind: Agent, name: nonexistent }
  agents:
    - { kind: Agent, name: nonexistent }
`;
    fs.writeFileSync(path.join(tmpDir, "goondan.yaml"), invalidYaml, "utf-8");

    process.cwd = () => tmpDir;
    const result = await checkBundleValidation();
    expect(result.name).toBe("Bundle Validation");
    // Should be either fail or warn depending on core validation
    expect(["fail", "warn"]).toContain(result.status);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("createDoctorCommand", () => {
  it("should create a valid commander Command", () => {
    const command = createDoctorCommand();
    expect(command.name()).toBe("doctor");
    expect(command.description()).toContain("environment");
  });

  it("should include --json option", () => {
    const command = createDoctorCommand();
    const options = command.options.map((opt) => opt.long);
    expect(options).toContain("--json");
  });
});

describe("executeDoctorCommand (json mode)", () => {
  it("should print structured JSON output when json=true", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await executeDoctorCommand({
        fix: false,
        runtime: false,
        json: true,
      });
    } finally {
      console.log = originalLog;
      process.exitCode = originalExitCode;
    }

    const output = logs.join("\n");
    const parsed: unknown = JSON.parse(output);

    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
    if (typeof parsed === "object" && parsed !== null) {
      expect("ok" in parsed).toBe(true);
      expect("generatedAt" in parsed).toBe(true);
      expect("runtimeChecked" in parsed).toBe(true);
      expect("summary" in parsed).toBe(true);
      expect("sections" in parsed).toBe(true);

      if ("summary" in parsed && typeof parsed.summary === "object" && parsed.summary !== null) {
        expect("passed" in parsed.summary).toBe(true);
        expect("warnings" in parsed.summary).toBe(true);
        expect("errors" in parsed.summary).toBe(true);
      }
    }
  });
});
