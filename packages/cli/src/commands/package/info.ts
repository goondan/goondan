/**
 * gdn package info command
 *
 * Shows information about a package from the registry
 * @see /docs/specs/cli.md - Section 6.11 (gdn package info)
 * @see /docs/specs/bundle_package.md - Section 13.9
 */

import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import { info, warn, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";

/**
 * Info command options
 */
export interface InfoOptions {
  registry?: string;
}

/**
 * Package metadata from registry
 */
interface PackageMetadata {
  name: string;
  description?: string;
  versions: Record<string, VersionInfo>;
  distTags: Record<string, string>;
}

/**
 * Version info from registry
 */
interface VersionInfo {
  version: string;
  dependencies?: Record<string, string>;
  published?: string;
  dist: {
    tarball: string;
    integrity: string;
  };
  bundle?: {
    resources?: string[];
    runtime?: string;
  };
}

/**
 * Parse package reference
 */
function parsePackageRef(ref: string): { name: string; version: string | null } {
  const lastAtIndex = ref.lastIndexOf("@");

  // If @ is at position 0, it's part of the scope
  if (lastAtIndex > 0) {
    return {
      name: ref.slice(0, lastAtIndex),
      version: ref.slice(lastAtIndex + 1),
    };
  }

  return {
    name: ref,
    version: null,
  };
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    const isoDate = date.toISOString().split("T")[0];
    return isoDate ?? dateString;
  } catch {
    return dateString;
  }
}

/**
 * Execute the info command
 */
async function executeInfo(packageRef: string, options: InfoOptions): Promise<void> {
  const spinner = ora();

  try {
    // Parse package reference
    const parsed = parsePackageRef(packageRef);

    // Get registry URL
    const config = await loadConfig();
    const registryUrl = options.registry ?? config.registry ?? "https://registry.goondan.io";

    // Fetch package metadata
    spinner.start(`Fetching ${chalk.cyan(parsed.name)}...`);

    // Stub: In real implementation, this would:
    // 1. Make HTTP request to registry
    // 2. Parse response
    // 3. Handle errors (404, auth, etc.)

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Stub: Create mock metadata
    const metadata: PackageMetadata = {
      name: parsed.name,
      description: `Description for ${parsed.name}`,
      versions: {
        "1.0.0": {
          version: "1.0.0",
          dependencies: {
            "@goondan/core-utils": "^0.5.0",
          },
          published: "2026-01-15T10:30:00Z",
          dist: {
            tarball: `${registryUrl}/${parsed.name}/-/${parsed.name.split("/").pop()}-1.0.0.tgz`,
            integrity: "sha512-AAAA...",
          },
          bundle: {
            resources: [
              "tools/example/tool.yaml",
              "extensions/example/extension.yaml",
            ],
            runtime: "node",
          },
        },
        "0.9.0": {
          version: "0.9.0",
          published: "2026-01-01T00:00:00Z",
          dist: {
            tarball: `${registryUrl}/${parsed.name}/-/${parsed.name.split("/").pop()}-0.9.0.tgz`,
            integrity: "sha512-BBBB...",
          },
        },
        "2.0.0-beta.1": {
          version: "2.0.0-beta.1",
          published: "2026-02-01T00:00:00Z",
          dist: {
            tarball: `${registryUrl}/${parsed.name}/-/${parsed.name.split("/").pop()}-2.0.0-beta.1.tgz`,
            integrity: "sha512-CCCC...",
          },
        },
      },
      distTags: {
        latest: "1.0.0",
        beta: "2.0.0-beta.1",
      },
    };

    spinner.stop();

    // Determine which version to show
    let targetVersion: string | null = parsed.version ?? null;

    if (!targetVersion || targetVersion === "latest") {
      targetVersion = metadata.distTags.latest ?? null;
    } else if (targetVersion && metadata.distTags[targetVersion]) {
      // It's a tag, resolve to version
      targetVersion = metadata.distTags[targetVersion] ?? null;
    }

    const versionInfo = targetVersion ? metadata.versions[targetVersion] : undefined;

    if (!versionInfo) {
      logError(`Version ${targetVersion} not found`);
      console.log();
      info("Available versions:");

      for (const v of Object.keys(metadata.versions).sort().reverse()) {
        console.log(`  ${v}`);
      }

      process.exitCode = 1;
      return;
    }

    // Display package info
    console.log();
    console.log(chalk.bold(`${chalk.cyan(metadata.name)}@${chalk.gray(versionInfo.version)}`));
    console.log();

    if (metadata.description) {
      console.log(`Description: ${metadata.description}`);
    }

    if (versionInfo.published) {
      console.log(`Published:   ${formatDate(versionInfo.published)}`);
    }

    // dist-tags
    console.log();
    console.log(chalk.bold("dist-tags:"));
    for (const [tag, version] of Object.entries(metadata.distTags)) {
      const highlight = version === versionInfo.version ? chalk.green : chalk.gray;
      console.log(`  ${tag}: ${highlight(version)}`);
    }

    // versions
    console.log();
    console.log(chalk.bold("versions:"));
    const versions = Object.keys(metadata.versions).sort().reverse();
    console.log(`  ${versions.join(", ")}`);

    // dependencies
    if (versionInfo.dependencies && Object.keys(versionInfo.dependencies).length > 0) {
      console.log();
      console.log(chalk.bold("dependencies:"));
      for (const [dep, ver] of Object.entries(versionInfo.dependencies)) {
        console.log(`  ${chalk.cyan(dep)}: ${ver}`);
      }
    }

    // resources
    if (versionInfo.bundle?.resources && versionInfo.bundle.resources.length > 0) {
      console.log();
      console.log(chalk.bold("resources:"));
      for (const resource of versionInfo.bundle.resources) {
        console.log(`  - ${resource}`);
      }
    }

    // distribution info
    console.log();
    console.log(chalk.bold("distribution:"));
    console.log(`  tarball:   ${versionInfo.dist.tarball}`);
    console.log(`  integrity: ${versionInfo.dist.integrity}`);

    if (versionInfo.bundle?.runtime) {
      console.log(`  runtime:   ${versionInfo.bundle.runtime}`);
    }

    // Show stub warning
    console.log();
    warn(chalk.yellow("Note: This is stub data. Not fetched from actual registry."));
  } catch (err) {
    spinner.fail("Failed to fetch package info");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the info command
 *
 * @returns Commander command for 'gdn package info'
 */
export function createInfoCommand(): Command {
  const command = new Command("info")
    .description("Show package information from registry")
    .argument("<ref>", "Package reference (e.g., @goondan/base, @goondan/base@1.0.0)")
    .option("--registry <url>", "Custom registry URL")
    .action(async (packageRef: string, options: Record<string, unknown>) => {
      const infoOptions: InfoOptions = {
        registry: options.registry as string | undefined,
      };

      await executeInfo(packageRef, infoOptions);
    });

  return command;
}

export default createInfoCommand;
