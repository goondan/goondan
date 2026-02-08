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
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import ora from "ora";
import chalk from "chalk";
import YAML from "yaml";
import { info, success, error as logError } from "../../utils/logger.js";
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
 * Registry package metadata
 */
interface RegistryVersionMetadata {
  name: string;
  version: string;
  dist: {
    tarball: string;
    shasum: string;
    integrity: string;
  };
  dependencies?: Record<string, string>;
}

interface RegistryPackageMetadata {
  name: string;
  versions: Record<string, RegistryVersionMetadata>;
  "dist-tags": Record<string, string>;
}

/**
 * Type guard for registry package metadata
 */
function isRegistryPackageMetadata(data: unknown): data is RegistryPackageMetadata {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj["name"] === "string" &&
    typeof obj["versions"] === "object" &&
    obj["versions"] !== null &&
    typeof obj["dist-tags"] === "object"
  );
}

/**
 * Type guard for registry version metadata
 */
function isRegistryVersionMetadata(data: unknown): data is RegistryVersionMetadata {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  const dist = obj["dist"];
  if (typeof dist !== "object" || dist === null) return false;
  const distObj = dist as Record<string, unknown>;
  return (
    typeof obj["name"] === "string" &&
    typeof obj["version"] === "string" &&
    typeof distObj["tarball"] === "string" &&
    typeof distObj["integrity"] === "string"
  );
}

/**
 * Parsed package reference
 */
interface ParsedPackageRef {
  scope: string | null;
  name: string;
  version: string | null;
  fullName: string;
  /** file: 프로토콜 로컬 경로 */
  filePath?: string;
}

/**
 * Parse package reference to extract scope, name, and version
 * Supports file: protocol for local dependencies
 */
function parsePackageRef(ref: string): ParsedPackageRef {
  // file: 프로토콜 감지
  if (ref.startsWith("file:")) {
    const filePath = ref.slice("file:".length);
    const segments = filePath.replace(/\/+$/, "").split("/");
    const lastName = segments[segments.length - 1] ?? filePath;
    return {
      scope: null,
      name: lastName,
      version: null,
      fullName: lastName,
      filePath,
    };
  }

  // Format: @scope/name@version or name@version
  let version: string | null = null;
  let nameWithScope = ref;

  // Find version part (last @ that's not at position 0)
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
        fullName: nameWithScope,
      };
    }
  }

  return {
    scope: null,
    name: nameWithScope,
    version,
    fullName: nameWithScope,
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
 * Fetch package metadata from registry
 */
async function fetchPackageMetadata(
  registryUrl: string,
  packageName: string
): Promise<RegistryPackageMetadata> {
  const url = `${registryUrl}/${packageName}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch package metadata: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();

  if (!isRegistryPackageMetadata(data)) {
    throw new Error(`Invalid package metadata from registry`);
  }

  return data;
}

/**
 * Resolve version from semver range
 */
function resolveVersion(
  metadata: RegistryPackageMetadata,
  versionRange: string | null
): string {
  // If no version specified or "latest", use dist-tags.latest
  if (!versionRange || versionRange === "latest") {
    const latest = metadata["dist-tags"]["latest"];
    if (!latest) {
      throw new Error(`No latest version found for ${metadata.name}`);
    }
    return latest;
  }

  // Strip semver range prefix for exact version
  const exactVersion = versionRange.replace(/^[\^~>=<]+/, "");

  // Check if exact version exists
  if (metadata.versions[exactVersion]) {
    return exactVersion;
  }

  // For now, simple version matching (full semver resolution would be more complex)
  const availableVersions = Object.keys(metadata.versions).sort();

  // Try to find matching version
  for (const ver of availableVersions.reverse()) {
    if (ver.startsWith(exactVersion.split(".")[0] ?? "")) {
      return ver;
    }
  }

  throw new Error(`No matching version found for ${metadata.name}@${versionRange}`);
}

/**
 * Download tarball from URL
 */
async function downloadTarball(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download tarball: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Verify integrity hash
 */
function verifyIntegrity(buffer: Buffer, expectedIntegrity: string): boolean {
  const hash = crypto.createHash("sha512");
  hash.update(buffer);
  const actualIntegrity = `sha512-${hash.digest("base64")}`;
  return actualIntegrity === expectedIntegrity;
}

/**
 * Extract tarball to directory
 */
async function extractTarball(tarballBuffer: Buffer, destDir: string): Promise<void> {
  // Decompress gzip
  const tarBuffer = await new Promise<Buffer>((resolve, reject) => {
    zlib.gunzip(tarballBuffer, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  // Parse and extract tar
  let offset = 0;
  while (offset < tarBuffer.length) {
    // Read header (512 bytes)
    const header = tarBuffer.subarray(offset, offset + 512);
    offset += 512;

    // Check for end of archive (two empty blocks)
    if (header.every((b) => b === 0)) {
      break;
    }

    // Parse header
    const nameBytes = header.subarray(0, 100);
    const nullIndex = nameBytes.indexOf(0);
    const name = nameBytes.subarray(0, nullIndex > 0 ? nullIndex : 100).toString("utf8");

    const sizeStr = header.subarray(124, 136).toString("utf8").trim();
    const size = parseInt(sizeStr, 8) || 0;

    const typeFlag = header[156];

    // Skip if empty name
    if (!name) {
      continue;
    }

    // Remove "package/" prefix from tar paths
    const relativePath = name.replace(/^package\//, "");
    if (!relativePath) {
      // Skip the "package/" directory entry itself
      offset += Math.ceil(size / 512) * 512;
      continue;
    }

    const fullPath = path.join(destDir, relativePath);

    // Create directory or file
    if (typeFlag === 53 || name.endsWith("/")) {
      // Directory
      fs.mkdirSync(fullPath, { recursive: true });
    } else if (typeFlag === 48 || typeFlag === 0) {
      // Regular file
      const dirPath = path.dirname(fullPath);
      fs.mkdirSync(dirPath, { recursive: true });

      const content = tarBuffer.subarray(offset, offset + size);
      fs.writeFileSync(fullPath, content);
    }

    // Move to next block (512-byte aligned)
    offset += Math.ceil(size / 512) * 512;
  }
}

/**
 * Execute the install command
 */
async function executeInstall(options: InstallOptions): Promise<void> {
  const spinner = ora();
  const projectPath = process.cwd();

  try {
    // Load config for registry URL
    const config = await loadConfig();
    const registryUrl = config.registry ?? "https://registry.goondan.io";

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
    const existingLockfile = loadLockfile(projectPath);
    if (options.frozenLockfile) {
      if (!existingLockfile) {
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

    // Process each dependency
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      packages: {},
    };

    for (const dep of allDependencies) {
      const parsed = parsePackageRef(dep);
      const displayName = parsed.fullName;

      try {
        // file: 프로토콜 로컬 의존성 처리
        if (parsed.filePath) {
          spinner.start(`Linking local package ${displayName}...`);

          const localPath = path.resolve(projectPath, parsed.filePath);

          // 로컬 경로 존재 확인
          if (!fs.existsSync(localPath)) {
            throw new Error(`Local package not found: ${localPath}`);
          }

          // package.yaml 확인
          const localManifestPath = path.join(localPath, "package.yaml");
          if (!fs.existsSync(localManifestPath)) {
            throw new Error(`No package.yaml found in ${localPath}`);
          }

          // 로컬 패키지의 manifest에서 name 읽기
          const localManifest = loadPackageManifest(localPath);
          const localName = localManifest?.metadata.name ?? displayName;
          const localVersion = localManifest?.metadata.version ?? "0.0.0";

          // lockfile 엔트리 (file: 참조 기록)
          lockfile.packages[`${localName}@${localVersion}`] = {
            version: localVersion,
            resolved: `file:${parsed.filePath}`,
            integrity: "",
          };

          // .goondan/packages/에 심링크 생성
          // file: dep은 manifest name 기반으로 심링크 경로 결정
          const projectPackagesDir = path.join(projectPath, ".goondan", "packages");
          const localParsedName = parsePackageRef(localName);
          const linkPath = path.join(
            projectPackagesDir,
            localParsedName.scope ?? "_unscoped",
            localParsedName.name
          );

          fs.mkdirSync(path.dirname(linkPath), { recursive: true });

          if (fs.existsSync(linkPath)) {
            fs.rmSync(linkPath, { recursive: true });
          }

          fs.symlinkSync(localPath, linkPath, "dir");

          spinner.succeed(`${chalk.cyan(localName)} -> ${chalk.gray(parsed.filePath)} (local)`);
          continue;
        }

        // 레지스트리 의존성 처리
        const requestedVersion = parsed.version ?? "latest";
        spinner.start(`Resolving ${displayName}@${requestedVersion}...`);

        // Check lockfile first in frozen mode
        let resolvedVersion: string;
        let versionMetadata: RegistryVersionMetadata;
        let tarballUrl: string;
        let integrity: string;

        const lockfileKey = `${displayName}@${requestedVersion}`;
        const lockedEntry = existingLockfile?.packages[lockfileKey];

        if (options.frozenLockfile && lockedEntry) {
          // Use locked version
          resolvedVersion = lockedEntry.version;
          tarballUrl = lockedEntry.resolved;
          integrity = lockedEntry.integrity;

          // Still need to fetch metadata for dependencies
          const metadata = await fetchPackageMetadata(registryUrl, displayName);
          const vData = metadata.versions[resolvedVersion];
          if (!vData || !isRegistryVersionMetadata(vData)) {
            throw new Error(`Version ${resolvedVersion} not found in registry`);
          }
          versionMetadata = vData;
        } else {
          // Fetch metadata and resolve version
          const metadata = await fetchPackageMetadata(registryUrl, displayName);
          resolvedVersion = resolveVersion(metadata, requestedVersion);

          const vData = metadata.versions[resolvedVersion];
          if (!vData || !isRegistryVersionMetadata(vData)) {
            throw new Error(`Version ${resolvedVersion} not found`);
          }
          versionMetadata = vData;
          tarballUrl = versionMetadata.dist.tarball;
          integrity = versionMetadata.dist.integrity;
        }

        spinner.succeed(`${chalk.cyan(displayName)}@${chalk.gray(resolvedVersion)}`);

        // Create lockfile entry
        lockfile.packages[`${displayName}@${resolvedVersion}`] = {
          version: resolvedVersion,
          resolved: tarballUrl,
          integrity,
          dependencies: versionMetadata.dependencies,
        };

        // Check if already cached
        const cachedPath = path.join(
          bundlesDir,
          parsed.scope ?? "_unscoped",
          parsed.name,
          resolvedVersion
        );

        if (fs.existsSync(cachedPath)) {
          info(`  ${chalk.gray("(cached)")}`);
        } else {
          // Download tarball
          spinner.start(`  Downloading...`);
          const tarballBuffer = await downloadTarball(tarballUrl);

          // Verify integrity
          if (!verifyIntegrity(tarballBuffer, integrity)) {
            throw new Error(`Integrity check failed for ${displayName}@${resolvedVersion}`);
          }

          // Extract to cache directory
          spinner.text = `  Extracting...`;
          await extractTarball(tarballBuffer, cachedPath);

          spinner.succeed(`  ${chalk.green("Downloaded and extracted")}`);
        }

        // Create symlink in project's .goondan/packages directory
        const projectPackagesDir = path.join(projectPath, ".goondan", "packages");
        const linkPath = path.join(
          projectPackagesDir,
          parsed.scope ?? "_unscoped",
          parsed.name
        );

        // Ensure directory exists
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });

        // Remove existing symlink/directory
        if (fs.existsSync(linkPath)) {
          fs.rmSync(linkPath, { recursive: true });
        }

        // Create symlink to cached package
        fs.symlinkSync(cachedPath, linkPath, "dir");

      } catch (err) {
        spinner.fail(`${chalk.red(displayName)} - ${err instanceof Error ? err.message : "Unknown error"}`);
        process.exitCode = 1;
        return;
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
