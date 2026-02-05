/**
 * gdn package install command
 *
 * Installs dependencies defined in package.yaml
 * @see /docs/specs/cli.md - Section 6.2 (gdn package install)
 * @see /docs/specs/bundle_package.md - Section 13.2
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import YAML from "yaml";
import { info, success, warn, error as logError } from "../../utils/logger.js";
import { loadConfig, expandPath } from "../../utils/config.js";

/**
 * Install command options
 */
export interface InstallOptions {
  frozenLockfile: boolean;
  ignoreScripts: boolean;
  production: boolean;
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
 * Lockfile entry
 */
interface LockfileEntry {
  version: string;
  resolved: string;
  integrity: string;
  dependencies?: Record<string, string>;
}

/**
 * Lockfile structure
 */
interface Lockfile {
  lockfileVersion: number;
  packages: Record<string, LockfileEntry>;
}

/**
 * Parse package reference to extract scope, name, and version
 */
function parsePackageRef(ref: string): { scope: string | null; name: string; version: string | null } {
  // Format: @scope/name@version or name@version
  const versionMatch = ref.match(/@([^@]+)$/);
  let version: string | null = null;
  let nameWithScope = ref;

  if (versionMatch && !ref.startsWith("@") || (versionMatch && ref.lastIndexOf("@") !== 0)) {
    const lastAtIndex = ref.lastIndexOf("@");
    if (lastAtIndex > 0) {
      version = ref.slice(lastAtIndex + 1);
      nameWithScope = ref.slice(0, lastAtIndex);
    }
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
 * Load package.yaml manifest
 */
function loadPackageManifest(projectPath: string): PackageManifest | null {
  const manifestPath = path.join(projectPath, "package.yaml");

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const content = fs.readFileSync(manifestPath, "utf-8");
  const manifest = YAML.parse(content) as unknown;

  // Basic validation
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
 * Load lockfile
 */
function loadLockfile(projectPath: string): Lockfile | null {
  const lockfilePath = path.join(projectPath, "packages.lock.yaml");

  if (!fs.existsSync(lockfilePath)) {
    return null;
  }

  const content = fs.readFileSync(lockfilePath, "utf-8");
  const lockfile = YAML.parse(content) as unknown;

  if (
    lockfile !== null &&
    typeof lockfile === "object" &&
    "lockfileVersion" in lockfile
  ) {
    return lockfile as Lockfile;
  }

  return null;
}

/**
 * Save lockfile
 */
function saveLockfile(projectPath: string, lockfile: Lockfile): void {
  const lockfilePath = path.join(projectPath, "packages.lock.yaml");
  const content = YAML.stringify(lockfile);
  fs.writeFileSync(lockfilePath, content, "utf-8");
}

/**
 * Get bundles cache directory
 */
async function getBundlesCacheDir(): Promise<string> {
  const config = await loadConfig();
  const stateRoot = config.stateRoot ?? "~/.goondan";
  return path.join(expandPath(stateRoot), "bundles");
}

/**
 * Execute the install command
 */
async function executeInstall(options: InstallOptions): Promise<void> {
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

    // Get dependencies
    const dependencies = manifest.spec.dependencies ?? [];
    const devDependencies = options.production ? [] : (manifest.spec.devDependencies ?? []);
    const allDependencies = [...dependencies, ...devDependencies];

    if (allDependencies.length === 0) {
      info("No dependencies to install.");
      return;
    }

    // Check for lockfile in frozen mode
    if (options.frozenLockfile) {
      const lockfile = loadLockfile(projectPath);
      if (!lockfile) {
        spinner.fail("No lockfile found. Cannot use --frozen-lockfile without packages.lock.yaml");
        process.exitCode = 1;
        return;
      }
      info("Using frozen lockfile for installation");
    }

    // Get cache directory
    const bundlesDir = await getBundlesCacheDir();

    // Ensure bundles directory exists
    if (!fs.existsSync(bundlesDir)) {
      fs.mkdirSync(bundlesDir, { recursive: true });
    }

    console.log();
    console.log(chalk.bold("Installing dependencies:"));
    console.log();

    // Process each dependency (stub implementation)
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      packages: {},
    };

    for (const dep of allDependencies) {
      const parsed = parsePackageRef(dep);
      const displayName = parsed.scope ? `${parsed.scope}/${parsed.name}` : parsed.name;
      const version = parsed.version ?? "latest";

      spinner.start(`Resolving ${displayName}@${version}...`);

      // Stub: In real implementation, this would:
      // 1. Fetch metadata from registry
      // 2. Resolve version (semver)
      // 3. Download tarball
      // 4. Verify integrity
      // 5. Extract to bundles directory

      // Simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create stub lockfile entry
      const resolvedVersion = version === "latest" ? "1.0.0" : version.replace(/^[\^~]/, "");
      const pkgKey = `${displayName}@${resolvedVersion}`;
      const registryUrl = "https://registry.goondan.io";

      lockfile.packages[pkgKey] = {
        version: resolvedVersion,
        resolved: `${registryUrl}/${displayName}/-/${parsed.name}-${resolvedVersion}.tgz`,
        integrity: "sha512-PLACEHOLDER...",
      };

      spinner.succeed(`${chalk.cyan(displayName)}@${chalk.gray(resolvedVersion)}`);

      // Check if already cached
      const cachedPath = path.join(
        bundlesDir,
        parsed.scope ?? "_",
        parsed.name,
        resolvedVersion
      );

      if (fs.existsSync(cachedPath)) {
        info(`  ${chalk.gray("(cached)")}`);
      } else {
        // Stub: Would download and extract here
        warn(`  ${chalk.yellow("(stub: not actually downloaded)")}`);
      }
    }

    // Save lockfile (unless frozen)
    if (!options.frozenLockfile) {
      spinner.start("Writing packages.lock.yaml...");
      saveLockfile(projectPath, lockfile);
      spinner.succeed("Lockfile updated");
    }

    console.log();

    if (options.ignoreScripts) {
      info("Install scripts were ignored (--ignore-scripts)");
    }

    success(`Installed ${allDependencies.length} package(s)`);

    // Show stub warning
    console.log();
    warn(chalk.yellow("Note: This is a stub implementation. Packages are not actually downloaded."));
    info("Full implementation will connect to the Goondan package registry.");
  } catch (err) {
    spinner.fail("Installation failed");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the install command
 *
 * @returns Commander command for 'gdn package install'
 */
export function createInstallCommand(): Command {
  const command = new Command("install")
    .description("Install dependencies from package.yaml")
    .option(
      "--frozen-lockfile",
      "Do not update lockfile (for CI environments)",
      false
    )
    .option(
      "--ignore-scripts",
      "Skip running install scripts",
      false
    )
    .option(
      "--production",
      "Skip devDependencies",
      false
    )
    .action(async (options: Record<string, unknown>) => {
      const installOptions: InstallOptions = {
        frozenLockfile: (options.frozenLockfile as boolean) ?? false,
        ignoreScripts: (options.ignoreScripts as boolean) ?? false,
        production: (options.production as boolean) ?? false,
      };

      await executeInstall(installOptions);
    });

  return command;
}

export default createInstallCommand;
