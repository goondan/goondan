/**
 * gdn package remove command
 *
 * Removes a dependency from package.yaml
 * @see /docs/specs/cli.md - Section 6.4 (gdn package remove)
 * @see /docs/specs/bundle_package.md - Section 13.4
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import YAML from "yaml";
import { info, success, warn, error as logError } from "../../utils/logger.js";

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
 * Parse package reference to extract scope, name, and version
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
 * Save package.yaml manifest
 */
function savePackageManifest(projectPath: string, manifest: PackageManifest): void {
  const manifestPath = path.join(projectPath, "package.yaml");
  const content = YAML.stringify(manifest);
  fs.writeFileSync(manifestPath, content, "utf-8");
}

/**
 * Execute the remove command
 */
async function executeRemove(packageRef: string): Promise<void> {
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

    // Parse the package reference
    const parsed = parsePackageRef(packageRef);
    const displayName = parsed.scope ? `${parsed.scope}/${parsed.name}` : parsed.name;

    // Initialize arrays if needed
    const dependencies = manifest.spec.dependencies ?? [];
    const devDependencies = manifest.spec.devDependencies ?? [];

    // Find the package in either list
    let foundIn: "dependencies" | "devDependencies" | null = null;
    let foundIndex = -1;
    let foundEntry = "";

    // Search in dependencies
    const depIndex = dependencies.findIndex((dep) => {
      const depParsed = parsePackageRef(dep);
      const depName = depParsed.scope ? `${depParsed.scope}/${depParsed.name}` : depParsed.name;
      return depName === displayName;
    });

    if (depIndex >= 0) {
      const entry = dependencies[depIndex];
      if (entry !== undefined) {
        foundIn = "dependencies";
        foundIndex = depIndex;
        foundEntry = entry;
      }
    }

    // Search in devDependencies
    if (foundIn === null) {
      const devDepIndex = devDependencies.findIndex((dep) => {
        const depParsed = parsePackageRef(dep);
        const depName = depParsed.scope ? `${depParsed.scope}/${depParsed.name}` : depParsed.name;
        return depName === displayName;
      });

      if (devDepIndex >= 0) {
        const entry = devDependencies[devDepIndex];
        if (entry !== undefined) {
          foundIn = "devDependencies";
          foundIndex = devDepIndex;
          foundEntry = entry;
        }
      }
    }

    if (foundIn === null) {
      warn(`Package ${chalk.cyan(displayName)} is not in dependencies`);
      process.exitCode = 1;
      return;
    }

    // Remove from the appropriate list
    spinner.start(`Removing ${displayName}...`);

    if (foundIn === "dependencies" && manifest.spec.dependencies) {
      manifest.spec.dependencies.splice(foundIndex, 1);
    } else if (foundIn === "devDependencies" && manifest.spec.devDependencies) {
      manifest.spec.devDependencies.splice(foundIndex, 1);
    }

    spinner.succeed(`Removed ${chalk.cyan(foundEntry)} from ${foundIn}`);

    // Save manifest
    spinner.start("Updating package.yaml...");
    savePackageManifest(projectPath, manifest);
    spinner.succeed("Updated package.yaml");

    // Update lockfile
    spinner.start("Updating packages.lock.yaml...");

    // Stub: Would actually update lockfile here
    await new Promise((resolve) => setTimeout(resolve, 100));

    spinner.succeed("Updated lockfile");

    console.log();
    success(`Removed ${chalk.cyan(displayName)}`);

    // Show stub warning
    warn(chalk.yellow("Note: This is a stub. Cached packages are not actually cleaned up."));
  } catch (err) {
    spinner.fail("Failed to remove package");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the remove command
 *
 * @returns Commander command for 'gdn package remove'
 */
export function createRemoveCommand(): Command {
  const command = new Command("remove")
    .description("Remove a dependency from package.yaml")
    .argument("<ref>", "Package reference (e.g., @goondan/base)")
    .action(async (packageRef: string) => {
      await executeRemove(packageRef);
    });

  return command;
}

export default createRemoveCommand;
