/**
 * gdn package add command
 *
 * Adds a new dependency to the Package in goondan.yaml
 * @see /docs/specs/cli.md - Section 6.3 (gdn package add)
 * @see /docs/specs/bundle_package.md - Section 13.3
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import YAML from "yaml";
import { info, success, warn, error as logError } from "../../utils/logger.js";

/**
 * Add command options
 */
export interface AddOptions {
  dev: boolean;
  exact: boolean;
  registry?: string;
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

  // Find the last @ that isn't at the start (scope)
  const lastAtIndex = ref.lastIndexOf("@");
  if (lastAtIndex > 0) {
    version = ref.slice(lastAtIndex + 1);
    nameWithScope = ref.slice(0, lastAtIndex);
  }

  // Parse scope
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
 * Format dependency string with version
 */
function formatDependency(
  scope: string | null,
  name: string,
  version: string,
  exact: boolean
): string {
  const pkgName = scope ? `${scope}/${name}` : name;

  if (exact) {
    return `${pkgName}@${version}`;
  }

  // Add ^ prefix for semver range (unless already has range specifier)
  if (version.match(/^[\d]/)) {
    return `${pkgName}@^${version}`;
  }

  return `${pkgName}@${version}`;
}

/**
 * Execute the add command
 */
async function executeAdd(packageRef: string, options: AddOptions): Promise<void> {
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

    // Determine which dependency list to modify
    const targetList = options.dev ? "devDependencies" : "dependencies";

    // Initialize arrays if needed
    if (!manifest.spec.dependencies) {
      manifest.spec.dependencies = [];
    }
    if (!manifest.spec.devDependencies) {
      manifest.spec.devDependencies = [];
    }

    // Check if already exists
    const allDeps = [...manifest.spec.dependencies, ...manifest.spec.devDependencies];
    const existingDep = allDeps.find((dep) => {
      const depParsed = parsePackageRef(dep);
      const depName = depParsed.scope ? `${depParsed.scope}/${depParsed.name}` : depParsed.name;
      return depName === displayName;
    });

    if (existingDep) {
      warn(`Package ${displayName} is already in ${targetList}`);
      info(`Current: ${existingDep}`);
      info("Use 'gdn package update' to change the version.");
      return;
    }

    // Resolve version from registry (stub)
    spinner.start(`Resolving ${displayName}...`);

    // Stub: In real implementation, this would fetch from registry
    await new Promise((resolve) => setTimeout(resolve, 200));

    const resolvedVersion = parsed.version ?? "1.0.0";
    const formattedDep = formatDependency(
      parsed.scope,
      parsed.name,
      resolvedVersion,
      options.exact
    );

    spinner.succeed(`Resolved ${chalk.cyan(displayName)}@${chalk.gray(resolvedVersion)}`);

    // Add to appropriate list
    if (options.dev) {
      manifest.spec.devDependencies.push(formattedDep);
    } else {
      manifest.spec.dependencies.push(formattedDep);
    }

    // Save manifest
    spinner.start("Updating goondan.yaml...");
    savePackageManifest(projectPath, manifest);
    spinner.succeed("Updated goondan.yaml");

    // Run install
    console.log();
    info("Running install...");

    // Stub: Would actually run install here
    warn(chalk.yellow("Note: This is a stub. Run 'gdn package install' manually."));

    console.log();
    success(
      `Added ${chalk.cyan(formattedDep)} to ${targetList}`
    );

    if (options.registry) {
      info(`Using registry: ${options.registry}`);
    }
  } catch (err) {
    spinner.fail("Failed to add package");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the add command
 *
 * @returns Commander command for 'gdn package add'
 */
export function createAddCommand(): Command {
  const command = new Command("add")
    .description("Add a dependency")
    .argument("<ref>", "Package reference (e.g., @goondan/base, @goondan/base@1.0.0)")
    .option("-D, --dev", "Add as devDependency", false)
    .option("-E, --exact", "Use exact version (no semver range)", false)
    .option("--registry <url>", "Use custom registry")
    .action(async (packageRef: string, options: Record<string, unknown>) => {
      const addOptions: AddOptions = {
        dev: (options.dev as boolean) ?? false,
        exact: (options.exact as boolean) ?? false,
        registry: options.registry as string | undefined,
      };

      await executeAdd(packageRef, addOptions);
    });

  return command;
}

export default createAddCommand;
