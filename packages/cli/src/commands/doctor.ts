/**
 * gdn doctor command
 *
 * Diagnoses the environment and reports on readiness to run Goondan.
 * Checks Node.js version, package manager, API keys, configuration files,
 * and dependency installation status.
 *
 * @see /docs/specs/cli.md - Section 14 (gdn doctor)
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import {
  loadBundleFromFile,
  loadBundleFromDirectory,
} from "@goondan/core";
import { info, warn, error as logError } from "../utils/logger.js";

/**
 * Doctor check result
 */
export interface DoctorCheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  detail?: string;
}

/**
 * Doctor command options
 */
export interface DoctorOptions {
  fix: boolean;
}

/**
 * Minimum required Node.js major version
 */
const MIN_NODE_VERSION = 18;

/**
 * Configuration file names to look for
 */
const CONFIG_FILE_NAMES = ["goondan.yaml", "goondan.yml"];

/**
 * Well-known API key environment variables
 */
const API_KEY_ENV_VARS: ReadonlyArray<{
  name: string;
  envVar: string;
  required: boolean;
}> = [
  { name: "Anthropic", envVar: "ANTHROPIC_API_KEY", required: false },
  { name: "OpenAI", envVar: "OPENAI_API_KEY", required: false },
  { name: "Google AI", envVar: "GOOGLE_GENERATIVE_AI_API_KEY", required: false },
];

/**
 * Parse a version string like "v20.11.0" into { major, minor, patch }
 */
function parseVersion(
  versionStr: string,
): { major: number; minor: number; patch: number } | null {
  const cleaned = versionStr.replace(/^v/, "").trim();
  const parts = cleaned.split(".");
  if (parts.length < 3) return null;

  const major = parseInt(parts[0] ?? "", 10);
  const minor = parseInt(parts[1] ?? "", 10);
  const patch = parseInt(parts[2] ?? "", 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return null;

  return { major, minor, patch };
}

/**
 * Check Node.js version
 */
function checkNodeVersion(): DoctorCheckResult {
  const version = process.version;
  const parsed = parseVersion(version);

  if (!parsed) {
    return {
      name: "Node.js",
      status: "fail",
      message: `Could not parse Node.js version: ${version}`,
    };
  }

  if (parsed.major < MIN_NODE_VERSION) {
    return {
      name: "Node.js",
      status: "fail",
      message: `Node.js ${version} detected. Version >=${MIN_NODE_VERSION} is required.`,
      detail: "Install a newer version from https://nodejs.org or use a version manager (nvm, fnm, mise).",
    };
  }

  return {
    name: "Node.js",
    status: "pass",
    message: `Node.js ${version}`,
  };
}

/**
 * Check if a command is available on the system
 */
function isCommandAvailable(command: string): string | null {
  try {
    const result = execSync(`${command} --version`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return result.toString().trim();
  } catch {
    return null;
  }
}

/**
 * Check pnpm installation
 */
function checkPnpm(): DoctorCheckResult {
  const version = isCommandAvailable("pnpm");

  if (!version) {
    return {
      name: "pnpm",
      status: "warn",
      message: "pnpm is not installed",
      detail: "Install pnpm: npm install -g pnpm  (recommended for Goondan development)",
    };
  }

  return {
    name: "pnpm",
    status: "pass",
    message: `pnpm ${version}`,
  };
}

/**
 * Check npm installation
 */
function checkNpm(): DoctorCheckResult {
  const version = isCommandAvailable("npm");

  if (!version) {
    return {
      name: "npm",
      status: "fail",
      message: "npm is not installed",
      detail: "npm should be installed with Node.js. Reinstall Node.js.",
    };
  }

  return {
    name: "npm",
    status: "pass",
    message: `npm ${version}`,
  };
}

/**
 * Check API key environment variables
 */
function checkApiKeys(): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];
  let hasAnyKey = false;

  for (const { name, envVar, required } of API_KEY_ENV_VARS) {
    const value = process.env[envVar];

    if (value && value.length > 0) {
      hasAnyKey = true;
      // Mask the key value for security
      const masked = value.length > 8
        ? `${value.slice(0, 4)}...${"*".repeat(4)}`
        : "****";
      results.push({
        name: `${name} API Key`,
        status: "pass",
        message: `${envVar} is set (${masked})`,
      });
    } else if (required) {
      results.push({
        name: `${name} API Key`,
        status: "fail",
        message: `${envVar} is not set`,
        detail: `Set the environment variable: export ${envVar}=your-api-key`,
      });
    } else {
      results.push({
        name: `${name} API Key`,
        status: "warn",
        message: `${envVar} is not set`,
        detail: `Set if using ${name}: export ${envVar}=your-api-key`,
      });
    }
  }

  if (!hasAnyKey) {
    // If no API keys at all, add a warning
    results.push({
      name: "LLM API Keys",
      status: "warn",
      message: "No LLM API keys found. At least one API key is needed to run agents.",
      detail:
        "Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY",
    });
  }

  return results;
}

/**
 * Check if goondan.yaml exists in the current directory
 */
function checkBundleConfig(): DoctorCheckResult {
  const cwd = process.cwd();

  for (const configName of CONFIG_FILE_NAMES) {
    const configPath = path.join(cwd, configName);
    if (fs.existsSync(configPath)) {
      return {
        name: "Bundle Config",
        status: "pass",
        message: `Found ${configName}`,
      };
    }
  }

  return {
    name: "Bundle Config",
    status: "warn",
    message: "No goondan.yaml found in current directory",
    detail: "Run 'gdn init' to create a new project, or navigate to a project directory.",
  };
}

/**
 * Check if node_modules exists (dependency installation status)
 */
function checkDependencies(): DoctorCheckResult {
  const cwd = process.cwd();
  const nodeModulesPath = path.join(cwd, "node_modules");

  // Check for package.json first
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return {
      name: "Dependencies",
      status: "pass",
      message: "No package.json (standalone bundle)",
    };
  }

  if (!fs.existsSync(nodeModulesPath)) {
    return {
      name: "Dependencies",
      status: "warn",
      message: "node_modules not found",
      detail: "Run 'pnpm install' or 'npm install' to install dependencies.",
    };
  }

  return {
    name: "Dependencies",
    status: "pass",
    message: "node_modules found",
  };
}

/**
 * Check TypeScript installation
 */
function checkTypeScript(): DoctorCheckResult {
  const version = isCommandAvailable("tsc");

  if (!version) {
    // Check local installation
    const cwd = process.cwd();
    const localTscPath = path.join(cwd, "node_modules", ".bin", "tsc");
    if (fs.existsSync(localTscPath)) {
      return {
        name: "TypeScript",
        status: "pass",
        message: "TypeScript installed (local)",
      };
    }

    return {
      name: "TypeScript",
      status: "warn",
      message: "TypeScript not found",
      detail: "Install TypeScript if you need to build tools: pnpm add -D typescript",
    };
  }

  return {
    name: "TypeScript",
    status: "pass",
    message: `TypeScript ${version}`,
  };
}

/**
 * Goondan packages to check for version info
 */
const GOONDAN_PACKAGES: ReadonlyArray<{
  name: string;
  packageName: string;
}> = [
  { name: "@goondan/core", packageName: "@goondan/core" },
  { name: "@goondan/cli", packageName: "@goondan/cli" },
  { name: "@goondan/base", packageName: "@goondan/base" },
];

/**
 * Read version from a package's package.json
 */
function readPackageVersion(packageName: string): string | null {
  const cwd = process.cwd();

  // Try to find in node_modules
  const nodeModulesPath = path.join(cwd, "node_modules", packageName, "package.json");
  if (fs.existsSync(nodeModulesPath)) {
    try {
      const content = fs.readFileSync(nodeModulesPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (isObjectWithKey(parsed, "version") && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Try workspace: look upward for a monorepo packages/ dir
  // Walk up from cwd to find workspace root with pnpm-workspace.yaml or package.json with workspaces
  let searchDir = cwd;
  for (let i = 0; i < 10; i++) {
    const workspaceFile = path.join(searchDir, "pnpm-workspace.yaml");
    if (fs.existsSync(workspaceFile)) {
      // Found workspace root, search for the package
      const packageDir = findPackageInWorkspace(searchDir, packageName);
      if (packageDir) {
        const pkgJsonPath = path.join(packageDir, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const content = fs.readFileSync(pkgJsonPath, "utf-8");
            const parsed: unknown = JSON.parse(content);
            if (isObjectWithKey(parsed, "version") && typeof parsed.version === "string") {
              return parsed.version;
            }
          } catch {
            // Ignore
          }
        }
      }
      break;
    }
    const parent = path.dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }

  return null;
}

/**
 * Type guard for objects with a specific key
 */
function isObjectWithKey<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

/**
 * Find a package directory within a workspace by package name
 */
function findPackageInWorkspace(workspaceRoot: string, packageName: string): string | null {
  const packagesDir = path.join(workspaceRoot, "packages");
  if (!fs.existsSync(packagesDir)) return null;

  try {
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const content = fs.readFileSync(pkgJsonPath, "utf-8");
          const parsed: unknown = JSON.parse(content);
          if (isObjectWithKey(parsed, "name") && parsed.name === packageName) {
            return path.join(packagesDir, entry.name);
          }
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Check Goondan package versions
 */
function checkGoondanPackages(): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  for (const { name, packageName } of GOONDAN_PACKAGES) {
    const version = readPackageVersion(packageName);

    if (version) {
      results.push({
        name,
        status: "pass",
        message: `${name}@${version}`,
      });
    } else {
      results.push({
        name,
        status: "warn",
        message: `${name} not found`,
        detail: `Install with: pnpm add ${packageName}`,
      });
    }
  }

  return results;
}

/**
 * Find goondan.yaml config file path in current directory
 */
function findConfigPath(): string | null {
  const cwd = process.cwd();
  for (const configName of CONFIG_FILE_NAMES) {
    const configPath = path.join(cwd, configName);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

/**
 * Run a quick bundle validation check
 */
async function checkBundleValidation(): Promise<DoctorCheckResult> {
  const configPath = findConfigPath();

  if (!configPath) {
    return {
      name: "Bundle Validation",
      status: "warn",
      message: "Skipped (no goondan.yaml found)",
    };
  }

  try {
    const stat = await fs.promises.stat(configPath);
    const result = stat.isDirectory()
      ? await loadBundleFromDirectory(configPath)
      : await loadBundleFromFile(configPath);

    if (result.isValid()) {
      const resourceCount = result.resources.length;
      return {
        name: "Bundle Validation",
        status: "pass",
        message: `Valid (${resourceCount} resources)`,
      };
    }

    // Separate errors and warnings
    const errors = result.errors.filter((e) => {
      if ("level" in e && e.level === "warning") return false;
      return true;
    });
    const warnings = result.errors.filter((e) => {
      if ("level" in e && e.level === "warning") return true;
      return false;
    });

    if (errors.length > 0) {
      return {
        name: "Bundle Validation",
        status: "fail",
        message: `${errors.length} error(s), ${warnings.length} warning(s)`,
        detail: `Run 'gdn validate' for details.`,
      };
    }

    return {
      name: "Bundle Validation",
      status: "warn",
      message: `Valid with ${warnings.length} warning(s)`,
      detail: `Run 'gdn validate' for details.`,
    };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : "Unknown error";
    return {
      name: "Bundle Validation",
      status: "fail",
      message: `Validation failed: ${errMessage}`,
      detail: `Run 'gdn validate' for details.`,
    };
  }
}

/**
 * Format a check result for display
 */
function formatCheckResult(result: DoctorCheckResult): void {
  const statusIcon =
    result.status === "pass"
      ? chalk.green("\u2713")
      : result.status === "warn"
        ? chalk.yellow("\u26A0")
        : chalk.red("\u2717");

  const statusColor =
    result.status === "pass"
      ? chalk.green
      : result.status === "warn"
        ? chalk.yellow
        : chalk.red;

  console.log(`  ${statusIcon} ${chalk.bold(result.name)}: ${statusColor(result.message)}`);

  if (result.detail && result.status !== "pass") {
    console.log(chalk.gray(`    ${result.detail}`));
  }
}

/**
 * Execute the doctor command
 */
async function executeDoctorCommand(_options: DoctorOptions): Promise<void> {
  console.log();
  console.log(chalk.bold("Goondan Doctor"));
  console.log(chalk.dim("Checking your environment..."));
  console.log();

  const allResults: DoctorCheckResult[] = [];

  // 1. System checks
  console.log(chalk.bold.underline("System"));
  const nodeResult = checkNodeVersion();
  formatCheckResult(nodeResult);
  allResults.push(nodeResult);

  const npmResult = checkNpm();
  formatCheckResult(npmResult);
  allResults.push(npmResult);

  const pnpmResult = checkPnpm();
  formatCheckResult(pnpmResult);
  allResults.push(pnpmResult);

  const tsResult = checkTypeScript();
  formatCheckResult(tsResult);
  allResults.push(tsResult);

  console.log();

  // 2. API keys
  console.log(chalk.bold.underline("API Keys"));
  const apiKeyResults = checkApiKeys();
  for (const result of apiKeyResults) {
    formatCheckResult(result);
    allResults.push(result);
  }

  console.log();

  // 3. Goondan packages
  console.log(chalk.bold.underline("Goondan Packages"));
  const packageResults = checkGoondanPackages();
  for (const result of packageResults) {
    formatCheckResult(result);
    allResults.push(result);
  }

  console.log();

  // 4. Project checks
  console.log(chalk.bold.underline("Project"));
  const bundleResult = checkBundleConfig();
  formatCheckResult(bundleResult);
  allResults.push(bundleResult);

  const depsResult = checkDependencies();
  formatCheckResult(depsResult);
  allResults.push(depsResult);

  const validationResult = await checkBundleValidation();
  formatCheckResult(validationResult);
  allResults.push(validationResult);

  console.log();

  // Summary
  const failCount = allResults.filter((r) => r.status === "fail").length;
  const warnCount = allResults.filter((r) => r.status === "warn").length;
  const passCount = allResults.filter((r) => r.status === "pass").length;

  console.log(chalk.bold("Summary"));
  console.log(
    `  ${chalk.green(`${passCount} passed`)}, ${chalk.yellow(`${warnCount} warnings`)}, ${chalk.red(`${failCount} errors`)}`
  );
  console.log();

  if (failCount > 0) {
    logError("Some checks failed. Fix the issues above to proceed.");
    process.exitCode = 1;
  } else if (warnCount > 0) {
    warn("Some checks have warnings. Your environment may work, but consider resolving them.");
  } else {
    info(chalk.green("All checks passed. Your environment is ready!"));
  }

  console.log();
}

/**
 * Create the doctor command
 *
 * @returns Commander command for 'gdn doctor'
 */
export function createDoctorCommand(): Command {
  const command = new Command("doctor")
    .description(
      "Check environment and diagnose common issues"
    )
    .addHelpText(
      "after",
      `
Examples:
  $ gdn doctor          Check environment readiness
  $ gdn doctor --json   Output results as JSON`
    )
    .option("--fix", "Attempt to fix issues automatically (placeholder)", false)
    .action(async (options: Record<string, unknown>) => {
      const doctorOptions: DoctorOptions = {
        fix: options.fix === true,
      };
      await executeDoctorCommand(doctorOptions);
    });

  return command;
}

// Export for testing
export {
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
  executeDoctorCommand,
};

export default createDoctorCommand;
