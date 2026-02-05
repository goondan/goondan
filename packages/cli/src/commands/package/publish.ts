/**
 * gdn package publish command
 *
 * Publishes a package to the registry
 * @see /docs/specs/cli.md - Section 6.7 (gdn package publish)
 * @see /docs/specs/bundle_package.md - Section 13.7
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import YAML from "yaml";
import { info, success, warn, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";

/**
 * Publish command options
 */
export interface PublishOptions {
  tag: string;
  access: "public" | "restricted";
  dryRun: boolean;
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
    annotations?: Record<string, string>;
  };
  spec: {
    dependencies?: string[];
    devDependencies?: string[];
    resources?: string[];
    dist?: string[];
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
 * Validate package before publishing
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validatePackage(manifest: PackageManifest, projectPath: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!manifest.metadata.name) {
    errors.push("metadata.name is required");
  }

  if (!manifest.metadata.version) {
    errors.push("metadata.version is required");
  } else {
    // Validate semver format
    const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
    if (!semverRegex.test(manifest.metadata.version)) {
      errors.push(`Invalid version format: ${manifest.metadata.version} (must be semver)`);
    }
  }

  // Check dist directory
  const distDirs = manifest.spec.dist ?? ["dist"];
  for (const distDir of distDirs) {
    const distPath = path.join(projectPath, distDir);
    if (!fs.existsSync(distPath)) {
      errors.push(`dist directory not found: ${distDir}`);
    }
  }

  // Check resources exist
  const resources = manifest.spec.resources ?? [];
  const distDir = manifest.spec.dist?.[0] ?? "dist";

  for (const resource of resources) {
    const resourcePath = path.join(projectPath, distDir, resource);
    if (!fs.existsSync(resourcePath)) {
      errors.push(`Resource file not found: ${resource}`);
    }
  }

  // Warnings
  if (!manifest.metadata.annotations?.description) {
    warnings.push("No description provided (set metadata.annotations.description)");
  }

  if (resources.length === 0) {
    warnings.push("No resources defined in spec.resources");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Execute the publish command
 */
async function executePublish(targetPath: string, options: PublishOptions): Promise<void> {
  const spinner = ora();
  const projectPath = path.resolve(process.cwd(), targetPath);

  try {
    // Load config for registry URL
    const config = await loadConfig();
    const registryUrl = options.registry ?? config.registry ?? "https://registry.goondan.io";

    // Load package.yaml
    spinner.start("Reading package.yaml...");
    const manifest = loadPackageManifest(projectPath);

    if (!manifest) {
      spinner.fail("package.yaml not found");
      info(`Looked in: ${projectPath}`);
      process.exitCode = 1;
      return;
    }

    const packageName = manifest.metadata.name;
    const packageVersion = manifest.metadata.version;

    spinner.succeed(`Found ${chalk.cyan(packageName)}@${chalk.gray(packageVersion)}`);

    // Validate package
    spinner.start("Validating package...");
    const validation = validatePackage(manifest, projectPath);

    if (!validation.valid) {
      spinner.fail("Validation failed");
      console.log();

      for (const error of validation.errors) {
        logError(error);
      }

      process.exitCode = 1;
      return;
    }

    spinner.succeed("Package validated");

    // Show warnings
    if (validation.warnings.length > 0) {
      console.log();
      for (const warning of validation.warnings) {
        warn(warning);
      }
    }

    // Check authentication
    spinner.start("Checking authentication...");

    const registryAuth = config.registries?.[registryUrl];

    if (!registryAuth?.token) {
      spinner.fail("Not authenticated");
      info(`Run 'gdn package login --registry ${registryUrl}' first`);
      process.exitCode = 6; // AUTH_ERROR
      return;
    }

    spinner.succeed("Authenticated");

    // Create tarball
    spinner.start("Creating package tarball...");

    const distDirs = manifest.spec.dist ?? ["dist"];
    const tarballName = `${packageName.replace("@", "").replace("/", "-")}-${packageVersion}.tgz`;

    // Stub: In real implementation, this would:
    // 1. Create tar.gz of dist directory
    // 2. Include package.yaml
    // 3. Calculate integrity hash

    await new Promise((resolve) => setTimeout(resolve, 200));

    spinner.succeed(`Created ${chalk.cyan(tarballName)}`);

    // Show what would be published
    console.log();
    console.log(chalk.bold("Package contents:"));
    console.log(chalk.gray("  package.yaml"));

    for (const distDir of distDirs) {
      console.log(chalk.gray(`  ${distDir}/`));
    }

    const resources = manifest.spec.resources ?? [];
    for (const resource of resources) {
      console.log(chalk.gray(`    ${resource}`));
    }

    console.log();
    console.log(chalk.bold("Publish details:"));
    console.log(`  Registry: ${chalk.cyan(registryUrl)}`);
    console.log(`  Tag: ${chalk.cyan(options.tag)}`);
    console.log(`  Access: ${chalk.cyan(options.access)}`);
    console.log();

    if (options.dryRun) {
      warn("Dry run - not actually publishing");
      console.log();
      success(`Would publish ${chalk.cyan(packageName)}@${chalk.gray(packageVersion)}`);
      return;
    }

    // Publish to registry
    spinner.start("Publishing to registry...");

    // Stub: In real implementation, this would:
    // 1. Upload tarball to registry
    // 2. Set dist-tag
    // 3. Handle access control

    await new Promise((resolve) => setTimeout(resolve, 500));

    spinner.succeed("Published to registry");

    console.log();
    success(`Published ${chalk.cyan(packageName)}@${chalk.gray(packageVersion)}`);

    console.log();
    console.log(chalk.dim(`View at: ${registryUrl}/${packageName}`));

    // Show stub warning
    console.log();
    warn(chalk.yellow("Note: This is a stub. Package was not actually uploaded to registry."));
  } catch (err) {
    spinner.fail("Publish failed");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the publish command
 *
 * @returns Commander command for 'gdn package publish'
 */
export function createPublishCommand(): Command {
  const command = new Command("publish")
    .description("Publish package to registry")
    .argument("[path]", "Package path", ".")
    .option("--tag <tag>", "Distribution tag", "latest")
    .option("--access <level>", "Access level (public, restricted)", "public")
    .option("--dry-run", "Simulate publish without uploading", false)
    .option("--registry <url>", "Custom registry URL")
    .action(async (targetPath: string, options: Record<string, unknown>) => {
      // Validate access option
      const access = options.access as string;
      if (access !== "public" && access !== "restricted") {
        logError(`Invalid access level: ${access}. Must be 'public' or 'restricted'.`);
        process.exitCode = 2;
        return;
      }

      const publishOptions: PublishOptions = {
        tag: (options.tag as string) ?? "latest",
        access: access as "public" | "restricted",
        dryRun: (options.dryRun as boolean) ?? false,
        registry: options.registry as string | undefined,
      };

      await executePublish(targetPath, publishOptions);
    });

  return command;
}

export default createPublishCommand;
