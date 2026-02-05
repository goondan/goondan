/**
 * gdn package cache command
 *
 * Manages the package cache
 * @see /docs/specs/cli.md
 * @see /docs/specs/bundle_package.md - Section 13.11
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import { info, warn, error as logError } from "../../utils/logger.js";
import { loadConfig, expandPath } from "../../utils/config.js";

/**
 * Get bundles cache directory
 */
async function getBundlesCacheDir(): Promise<string> {
  const config = await loadConfig();
  const stateRoot = config.stateRoot ?? "~/.goondan";
  return path.join(expandPath(stateRoot), "bundles");
}

/**
 * Calculate directory size recursively
 */
function getDirectorySize(dirPath: string): number {
  let size = 0;

  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      size += getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      const stats = fs.statSync(entryPath);
      size += stats.size;
    }
  }

  return size;
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

/**
 * Count packages in cache
 */
function countPackages(cacheDir: string): number {
  let count = 0;

  if (!fs.existsSync(cacheDir)) {
    return 0;
  }

  // Cache structure: bundles/<scope>/<name>/<version>/
  const scopeOrNames = fs.readdirSync(cacheDir, { withFileTypes: true });

  for (const scopeOrName of scopeOrNames) {
    if (!scopeOrName.isDirectory()) continue;

    const scopePath = path.join(cacheDir, scopeOrName.name);

    if (scopeOrName.name.startsWith("@")) {
      // It's a scope directory
      const names = fs.readdirSync(scopePath, { withFileTypes: true });

      for (const name of names) {
        if (!name.isDirectory()) continue;

        const namePath = path.join(scopePath, name.name);
        const versions = fs.readdirSync(namePath, { withFileTypes: true });

        for (const version of versions) {
          if (version.isDirectory()) {
            count++;
          }
        }
      }
    } else {
      // It's a name directory (unscoped package)
      const versions = fs.readdirSync(scopePath, { withFileTypes: true });

      for (const version of versions) {
        if (version.isDirectory()) {
          count++;
        }
      }
    }
  }

  return count;
}

/**
 * Execute cache info subcommand
 */
async function executeCacheInfo(): Promise<void> {
  const spinner = ora();

  try {
    spinner.start("Reading cache info...");

    const cacheDir = await getBundlesCacheDir();
    const cacheSize = getDirectorySize(cacheDir);
    const packageCount = countPackages(cacheDir);

    spinner.stop();

    console.log();
    console.log(chalk.bold("Package Cache Info"));
    console.log();
    console.log(`Location:    ${chalk.cyan(cacheDir)}`);
    console.log(`Size:        ${chalk.cyan(formatSize(cacheSize))}`);
    console.log(`Packages:    ${chalk.cyan(packageCount.toString())}`);

    if (!fs.existsSync(cacheDir)) {
      console.log();
      info("Cache directory does not exist yet.");
      info("It will be created when you install packages.");
    }
  } catch (err) {
    spinner.fail("Failed to read cache info");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Delete directory recursively
 * Note: Exported but currently unused in stub implementation - will be used when cache clean is fully implemented
 */
export function deleteDirectoryRecursive(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      deleteDirectoryRecursive(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  }

  fs.rmdirSync(dirPath);
}

/**
 * Execute cache clean subcommand
 */
async function executeCacheClean(packageRef: string | undefined): Promise<void> {
  const spinner = ora();

  try {
    const cacheDir = await getBundlesCacheDir();

    if (!fs.existsSync(cacheDir)) {
      info("Cache directory does not exist. Nothing to clean.");
      return;
    }

    if (packageRef) {
      // Clean specific package
      spinner.start(`Finding ${chalk.cyan(packageRef)}...`);

      // Parse package reference
      let targetPath: string;

      if (packageRef.startsWith("@")) {
        const slashIndex = packageRef.indexOf("/");
        if (slashIndex > 0) {
          const scope = packageRef.slice(0, slashIndex);
          const name = packageRef.slice(slashIndex + 1);
          targetPath = path.join(cacheDir, scope, name);
        } else {
          spinner.fail(`Invalid package reference: ${packageRef}`);
          process.exitCode = 2;
          return;
        }
      } else {
        targetPath = path.join(cacheDir, "_", packageRef);
      }

      if (!fs.existsSync(targetPath)) {
        spinner.warn(`Package not found in cache: ${packageRef}`);
        return;
      }

      const sizeToDelete = getDirectorySize(targetPath);

      spinner.text = `Removing ${chalk.cyan(packageRef)}...`;

      // Stub: In real implementation, would actually delete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // For safety, don't actually delete in stub
      // deleteDirectory(targetPath);

      spinner.succeed(`Removed ${chalk.cyan(packageRef)} (${formatSize(sizeToDelete)})`);

      warn(chalk.yellow("Note: This is a stub. Files were not actually deleted."));
    } else {
      // Clean entire cache
      const cacheSize = getDirectorySize(cacheDir);
      const packageCount = countPackages(cacheDir);

      if (packageCount === 0) {
        info("Cache is already empty.");
        return;
      }

      console.log();
      console.log(chalk.bold("This will delete:"));
      console.log(`  ${chalk.cyan(packageCount.toString())} package(s)`);
      console.log(`  ${chalk.cyan(formatSize(cacheSize))}`);
      console.log();

      spinner.start("Cleaning cache...");

      // Stub: In real implementation, would actually delete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // For safety, don't actually delete in stub
      // deleteDirectory(cacheDir);

      spinner.succeed("Cache cleaned");

      warn(chalk.yellow("Note: This is a stub. Files were not actually deleted."));
    }
  } catch (err) {
    spinner.fail("Failed to clean cache");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the cache info subcommand
 */
function createCacheInfoCommand(): Command {
  return new Command("info")
    .description("Show cache information")
    .action(async () => {
      await executeCacheInfo();
    });
}

/**
 * Create the cache clean subcommand
 */
function createCacheCleanCommand(): Command {
  return new Command("clean")
    .description("Clean the package cache")
    .argument("[ref]", "Package reference to clean (cleans all if not specified)")
    .action(async (packageRef: string | undefined) => {
      await executeCacheClean(packageRef);
    });
}

/**
 * Create the cache command
 *
 * @returns Commander command for 'gdn package cache'
 */
export function createCacheCommand(): Command {
  const command = new Command("cache")
    .description("Manage package cache")
    .addCommand(createCacheInfoCommand())
    .addCommand(createCacheCleanCommand());

  return command;
}

export default createCacheCommand;
