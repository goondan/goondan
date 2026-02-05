/**
 * gdn package update command
 *
 * Updates dependencies to newer versions
 * @see /docs/specs/cli.md - Section 6.5 (gdn package update)
 * @see /docs/specs/bundle_package.md - Section 13.5
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import YAML from "yaml";
import { info, success, warn, error as logError } from "../../utils/logger.js";

/**
 * Update command options
 */
export interface UpdateOptions {
  latest: boolean;
}

/**
 * Package manifest structure
 */
interface PackageManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    version: string;
  };
  spec: {
    dependencies?: string[];
    devDependencies?: string[];
    resources?: string[];
    dist?: string[];
  };
}

/**
 * Parse package reference
 */
function parsePackageRef(ref: string): { scope: string | null; name: string; version: string | null } {
  let version: string | null = null;
  let nameWithScope = ref;

  const lastAtIndex = ref.lastIndexOf("@");
  if (lastAtIndex > 0) {
    version = ref.slice(lastAtIndex + 1);
    nameWithScope = ref.slice(0, lastAtIndex);
  }

  if (nameWithScope.startsWith("@")) {
    const slashIndex = nameWithScope.indexOf("/");
    if (slashIndex > 0) {
      return {
        scope: nameWithScope.slice(0, slashIndex),
        name: nameWithScope.slice(slashIndex + 1),
        version,
      };
    }
  }

  return {
    scope: null,
    name: nameWithScope,
    version,
  };
}

/**
 * Load package.yaml manifest
 */
function loadPackageManifest(projectPath: string): PackageManifest | null {
  const manifestPath = path.join(projectPath, "package.yaml");

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const content = fs.readFileSync(manifestPath, "utf-8");
  const manifest = YAML.parse(content) as unknown;

  if (
    manifest !== null &&
    typeof manifest === "object" &&
    "kind" in manifest &&
    manifest.kind === "Package"
  ) {
    return manifest as PackageManifest;
  }

  return null;
}

/**
 * Get display name from package ref
 */
function getDisplayName(ref: string): string {
  const parsed = parsePackageRef(ref);
  return parsed.scope ? `${parsed.scope}/${parsed.name}` : parsed.name;
}

/**
 * Execute the update command
 */
async function executeUpdate(packageRef: string | undefined, options: UpdateOptions): Promise<void> {
  const spinner = ora();
  const projectPath = process.cwd();

  try {
    // Load package.yaml
    spinner.start("Reading package.yaml...");
    const manifest = loadPackageManifest(projectPath);

    if (!manifest) {
      spinner.fail("package.yaml not found");
      info("Run 'gdn init --package' to create a new package project.");
      process.exitCode = 1;
      return;
    }

    spinner.succeed("Found package.yaml");

    // Get all dependencies
    const dependencies = manifest.spec.dependencies ?? [];
    const devDependencies = manifest.spec.devDependencies ?? [];
    const allDependencies = [...dependencies, ...devDependencies];

    if (allDependencies.length === 0) {
      info("No dependencies to update.");
      return;
    }

    // Filter to specific package if provided
    let packagesToUpdate = allDependencies;

    if (packageRef) {
      const targetName = getDisplayName(packageRef);
      packagesToUpdate = allDependencies.filter((dep) => {
        return getDisplayName(dep) === targetName;
      });

      if (packagesToUpdate.length === 0) {
        warn(`Package ${chalk.cyan(targetName)} is not in dependencies`);
        process.exitCode = 1;
        return;
      }
    }

    console.log();
    console.log(chalk.bold("Checking for updates:"));
    console.log();

    // Update mode
    const updateMode = options.latest ? "latest" : "semver range";
    info(`Update mode: ${chalk.cyan(updateMode)}`);
    console.log();

    // Check each package for updates (stub)
    let updatedCount = 0;

    for (const dep of packagesToUpdate) {
      const displayName = getDisplayName(dep);
      const parsed = parsePackageRef(dep);
      const currentVersion = parsed.version ?? "unknown";

      spinner.start(`Checking ${displayName}...`);

      // Stub: In real implementation, this would:
      // 1. Fetch latest version from registry
      // 2. Compare with current version
      // 3. Respect semver range unless --latest

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simulate finding an update
      const hasUpdate = Math.random() > 0.5;

      if (hasUpdate) {
        const newVersion = options.latest ? "2.0.0" : "1.1.0";
        spinner.succeed(
          `${chalk.cyan(displayName)}: ${chalk.gray(currentVersion)} -> ${chalk.green(newVersion)}`
        );
        updatedCount++;
      } else {
        spinner.succeed(`${chalk.cyan(displayName)}: ${chalk.gray(currentVersion)} (up to date)`);
      }
    }

    console.log();

    if (updatedCount > 0) {
      // Stub: Would run install here
      warn(chalk.yellow("Note: This is a stub. Run 'gdn package install' manually after updates."));
      console.log();
      success(`Updated ${updatedCount} package(s)`);
    } else {
      success("All packages are up to date");
    }
  } catch (err) {
    spinner.fail("Update failed");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the update command
 *
 * @returns Commander command for 'gdn package update'
 */
export function createUpdateCommand(): Command {
  const command = new Command("update")
    .description("Update dependencies to newer versions")
    .argument("[ref]", "Package reference to update (updates all if not specified)")
    .option("--latest", "Update to latest version (ignore semver range)", false)
    .action(async (packageRef: string | undefined, options: Record<string, unknown>) => {
      const updateOptions: UpdateOptions = {
        latest: (options.latest as boolean) ?? false,
      };

      await executeUpdate(packageRef, updateOptions);
    });

  return command;
}

export default createUpdateCommand;
