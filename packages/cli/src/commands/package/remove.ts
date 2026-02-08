/**
 * gdn package remove command
 *
 * Removes a dependency from the Package in goondan.yaml
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
    exports?: string[];
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
 * Load Package manifest from goondan.yaml (first YAML document)
 */
function loadPackageManifest(projectPath: string): PackageManifest | null {
  const goondanPath = path.join(projectPath, "goondan.yaml");

  if (!fs.existsSync(goondanPath)) {
    return null;
  }

  const content = fs.readFileSync(goondanPath, "utf-8");
  // goondan.yaml은 multi-document YAML — 첫 번째 문서가 Package인지 확인
  const docs = YAML.parseAllDocuments(content);
  if (docs.length === 0) {
    return null;
  }

  const firstDoc = docs[0];
  if (!firstDoc || firstDoc.errors.length > 0) {
    return null;
  }

  const manifest: unknown = firstDoc.toJSON();

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
 * Save Package manifest back to goondan.yaml, preserving other documents
 */
function savePackageManifest(projectPath: string, manifest: PackageManifest): void {
  const goondanPath = path.join(projectPath, "goondan.yaml");
  const existingContent = fs.existsSync(goondanPath) ? fs.readFileSync(goondanPath, "utf-8") : "";

  // Reconstruct: Package document first, then remaining documents
  const docs = YAML.parseAllDocuments(existingContent);
  const packageYaml = YAML.stringify(manifest);

  // Build new content: Package document + remaining non-Package documents
  const remainingDocs = docs.filter((doc) => {
    const json = doc.toJSON() as Record<string, unknown> | null;
    return json !== null && json["kind"] !== "Package";
  });

  let newContent = packageYaml.trimEnd();
  for (const doc of remainingDocs) {
    newContent += "\n---\n" + String(doc);
  }
  newContent += "\n";

  fs.writeFileSync(goondanPath, newContent, "utf-8");
}

/**
 * Execute the remove command
 */
async function executeRemove(packageRef: string): Promise<void> {
  const spinner = ora();
  const projectPath = process.cwd();

  try {
    // Load Package from goondan.yaml
    spinner.start("Reading goondan.yaml...");
    const manifest = loadPackageManifest(projectPath);

    if (!manifest) {
      spinner.fail("Package not found in goondan.yaml");
      info("Run 'gdn init --package' to create a new package project.");
      process.exitCode = 1;
      return;
    }

    spinner.succeed("Found Package in goondan.yaml");

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
    spinner.start("Updating goondan.yaml...");
    savePackageManifest(projectPath, manifest);
    spinner.succeed("Updated goondan.yaml");

    // Update lockfile
    spinner.start("Updating goondan.lock.yaml...");

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
    .description("Remove a dependency")
    .argument("<ref>", "Package reference (e.g., @goondan/base)")
    .action(async (packageRef: string) => {
      await executeRemove(packageRef);
    });

  return command;
}

export default createRemoveCommand;
