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
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
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
    const registryUrl = options.registry ?? config.registry ?? "https://goondan-registry.yechanny.workers.dev";

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
    // tarball 파일명: @scope/name -> name-version.tgz
    const baseName = packageName.includes("/")
      ? packageName.split("/")[1] ?? packageName
      : packageName;
    const tarballName = `${baseName}-${packageVersion}.tgz`;

    // 실제 tarball 생성
    const tarballBuffer = await createTarball(projectPath, distDirs);
    const integrity = computeIntegrity(tarballBuffer);
    const shasum = computeShasum(tarballBuffer);

    spinner.succeed(`Created ${chalk.cyan(tarballName)} (${formatBytes(tarballBuffer.length)})`);

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

    try {
      const publishResult = await publishToRegistry({
        registryUrl,
        packageName,
        packageVersion,
        tarballBuffer,
        integrity,
        shasum,
        tag: options.tag,
        token: registryAuth.token,
        manifest,
      });

      if (!publishResult.ok) {
        spinner.fail("Publish failed");
        logError(publishResult.error ?? "Unknown error");
        process.exitCode = 1;
        return;
      }

      spinner.succeed("Published to registry");

      console.log();
      success(`Published ${chalk.cyan(packageName)}@${chalk.gray(packageVersion)}`);

      console.log();
      console.log(chalk.dim(`View at: ${registryUrl}/${packageName}`));
      console.log(chalk.dim(`Integrity: ${integrity}`));
    } catch (err) {
      spinner.fail("Publish failed");
      if (err instanceof Error) {
        logError(err.message);
      }
      process.exitCode = 5; // NETWORK_ERROR
      return;
    }
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

/**
 * Tarball 생성
 */
async function createTarball(
  projectPath: string,
  distDirs: string[]
): Promise<Buffer> {
  const tarBlocks: Buffer[] = [];

  // package.yaml 추가
  const packageYamlPath = path.join(projectPath, "package.yaml");
  const packageYamlContent = fs.readFileSync(packageYamlPath);
  addFileToTar(tarBlocks, "package/package.yaml", packageYamlContent);

  // dist 디렉토리들 추가
  for (const distDir of distDirs) {
    const distPath = path.join(projectPath, distDir);
    if (fs.existsSync(distPath)) {
      await addDirectoryToTar(tarBlocks, distPath, `package/${distDir}`);
    }
  }

  // tar 종료 블록 (2개의 512바이트 빈 블록)
  tarBlocks.push(Buffer.alloc(1024, 0));

  // tar 버퍼 결합
  const tarBuffer = Buffer.concat(tarBlocks);

  // gzip 압축
  return new Promise((resolve, reject) => {
    zlib.gzip(tarBuffer, { level: 9 }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * 파일을 tar에 추가
 */
function addFileToTar(blocks: Buffer[], filePath: string, content: Buffer): void {
  const header = createTarHeader(filePath, content.length, false);
  blocks.push(header);

  // 콘텐츠 + 패딩
  const paddedSize = Math.ceil(content.length / 512) * 512;
  const paddedContent = Buffer.alloc(paddedSize, 0);
  content.copy(paddedContent);
  blocks.push(paddedContent);
}

/**
 * 디렉토리를 재귀적으로 tar에 추가
 */
async function addDirectoryToTar(
  blocks: Buffer[],
  dirPath: string,
  tarPath: string
): Promise<void> {
  // 디렉토리 헤더 추가
  const dirHeader = createTarHeader(tarPath + "/", 0, true);
  blocks.push(dirHeader);

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const entryTarPath = `${tarPath}/${entry.name}`;

    if (entry.isDirectory()) {
      await addDirectoryToTar(blocks, fullPath, entryTarPath);
    } else if (entry.isFile()) {
      const content = fs.readFileSync(fullPath);
      addFileToTar(blocks, entryTarPath, content);
    }
  }
}

/**
 * tar 헤더 생성 (USTAR 형식)
 */
function createTarHeader(name: string, size: number, isDir: boolean): Buffer {
  const header = Buffer.alloc(512, 0);

  // 파일 이름 (0-99)
  const nameBuf = Buffer.from(name.slice(-100), "utf8");
  nameBuf.copy(header, 0);

  // 파일 모드 (100-107)
  const mode = isDir ? "0000755" : "0000644";
  Buffer.from(mode + " \0", "utf8").copy(header, 100);

  // uid (108-115)
  Buffer.from("0000000 \0", "utf8").copy(header, 108);

  // gid (116-123)
  Buffer.from("0000000 \0", "utf8").copy(header, 116);

  // 파일 크기 (124-135)
  const sizeStr = size.toString(8).padStart(11, "0");
  Buffer.from(sizeStr + " ", "utf8").copy(header, 124);

  // mtime (136-147)
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, "0");
  Buffer.from(mtime + " ", "utf8").copy(header, 136);

  // 체크섬 placeholder (148-155)
  Buffer.from("        ", "utf8").copy(header, 148);

  // 타입 플래그 (156)
  header[156] = isDir ? 53 : 48; // '5' for dir, '0' for file

  // USTAR 매직 (257-264)
  Buffer.from("ustar\x0000", "utf8").copy(header, 257);

  // 체크섬 계산
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i] ?? 0;
  }
  const checksumStr = checksum.toString(8).padStart(6, "0");
  Buffer.from(checksumStr + "\0 ", "utf8").copy(header, 148);

  return header;
}

/**
 * SHA-512 integrity 계산
 */
function computeIntegrity(buffer: Buffer): string {
  const hash = crypto.createHash("sha512");
  hash.update(buffer);
  return `sha512-${hash.digest("base64")}`;
}

/**
 * SHA-1 shasum 계산
 */
function computeShasum(buffer: Buffer): string {
  const hash = crypto.createHash("sha1");
  hash.update(buffer);
  return hash.digest("hex");
}

/**
 * 바이트 크기 포맷
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 레지스트리에 퍼블리시
 */
interface PublishToRegistryOptions {
  registryUrl: string;
  packageName: string;
  packageVersion: string;
  tarballBuffer: Buffer;
  integrity: string;
  shasum: string;
  tag: string;
  token: string;
  manifest: PackageManifest;
}

interface PublishResult {
  ok: boolean;
  error?: string;
}

async function publishToRegistry(options: PublishToRegistryOptions): Promise<PublishResult> {
  const {
    registryUrl,
    packageName,
    packageVersion,
    tarballBuffer,
    integrity,
    shasum,
    tag,
    token,
    manifest,
  } = options;

  // 퍼블리시 요청 본문 구성 (npm-compatible format)
  const tarballBase64 = tarballBuffer.toString("base64");
  // tarball 파일명: @scope/name -> name-version.tgz
  const baseName = packageName.includes("/")
    ? packageName.split("/")[1] ?? packageName
    : packageName;
  const tarballFilename = `${baseName}-${packageVersion}.tgz`;

  const publishBody = {
    name: packageName,
    description: manifest.metadata.annotations?.description ?? "",
    "dist-tags": {
      [tag]: packageVersion,
    },
    versions: {
      [packageVersion]: {
        name: packageName,
        version: packageVersion,
        description: manifest.metadata.annotations?.description ?? "",
        dependencies: Object.fromEntries(
          (manifest.spec.dependencies ?? []).map((dep: string) => [dep, "*"])
        ),
        dist: {
          tarball: `${registryUrl}/${packageName}/-/${tarballFilename}`,
          shasum,
          integrity,
        },
        bundle: {
          include: manifest.spec.resources ?? [],
          runtime: "node",
        },
      },
    },
    _attachments: {
      [tarballFilename]: {
        content_type: "application/octet-stream",
        data: tarballBase64,
        length: tarballBuffer.length,
      },
    },
  };

  // PUT 요청으로 퍼블리시
  const response = await fetch(`${registryUrl}/${packageName}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(publishBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

    try {
      const errorJson = JSON.parse(errorText) as { error?: string; message?: string };
      errorMessage = errorJson.error ?? errorJson.message ?? errorMessage;
    } catch {
      if (errorText) {
        errorMessage = errorText;
      }
    }

    return { ok: false, error: errorMessage };
  }

  return { ok: true };
}
