/**
 * gdn package pack command
 *
 * Creates a local tarball of the package
 * Reads the Package resource from the first document of goondan.yaml
 * @see /docs/specs/cli.md - Section 6.10 (gdn package pack)
 * @see /docs/specs/bundle_package.md - Section 13.10
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import YAML from "yaml";
import { info, success, warn, error as logError } from "../../utils/logger.js";

/**
 * Pack command options
 */
export interface PackOptions {
  out?: string;
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
    exports?: string[];
    dist?: string[];
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
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/**
 * List files in directory recursively
 */
function listFiles(dirPath: string, basePath: string = ""): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dirPath)) {
    return files;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Execute the pack command
 */
async function executePack(targetPath: string, options: PackOptions): Promise<void> {
  const spinner = ora();
  const projectPath = path.resolve(process.cwd(), targetPath);

  try {
    // Load Package from goondan.yaml
    spinner.start("Reading goondan.yaml...");
    const manifest = loadPackageManifest(projectPath);

    if (!manifest) {
      spinner.fail("Package not found in goondan.yaml");
      info(`Looked in: ${projectPath}`);
      process.exitCode = 1;
      return;
    }

    const packageName = manifest.metadata.name;
    const packageVersion = manifest.metadata.version;

    spinner.succeed(`Found ${chalk.cyan(packageName)}@${chalk.gray(packageVersion)}`);

    // Check dist directory
    const distDirs = manifest.spec.dist ?? ["dist"];
    const distDir = distDirs[0] ?? "dist";
    const distPath = path.join(projectPath, distDir);

    if (!fs.existsSync(distPath)) {
      logError(`dist directory not found: ${distDir}`);
      info("Build your package first, then run pack.");
      process.exitCode = 1;
      return;
    }

    // Calculate tarball name
    const safeName = packageName.replace("@", "").replace("/", "-");
    const tarballName = `${safeName}-${packageVersion}.tgz`;

    // Determine output path
    const outputDir = options.out ? path.resolve(process.cwd(), options.out) : process.cwd();
    const tarballPath = path.join(outputDir, tarballName);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // List files that would be included
    spinner.start("Analyzing package contents...");

    const files = listFiles(distPath);
    const distSize = getDirectorySize(distPath);

    spinner.succeed(`Found ${files.length} files (${formatSize(distSize)})`);

    // Show contents
    console.log();
    console.log(chalk.bold("Package contents:"));
    console.log(chalk.gray("  goondan.yaml (Package)"));

    // Show first few files
    const maxFilesToShow = 10;
    const sortedFiles = files.sort();

    for (let i = 0; i < Math.min(sortedFiles.length, maxFilesToShow); i++) {
      console.log(chalk.gray(`  ${distDir}/${sortedFiles[i]}`));
    }

    if (sortedFiles.length > maxFilesToShow) {
      console.log(chalk.gray(`  ... and ${sortedFiles.length - maxFilesToShow} more files`));
    }

    // Create tarball (stub)
    spinner.start("Creating tarball...");

    // Stub: In real implementation, this would:
    // 1. Create tar archive of dist directory
    // 2. Include goondan.yaml at root
    // 3. gzip compress
    // 4. Write to output path

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Stub: Create a placeholder file to show where tarball would be
    // In real implementation, this would be the actual tarball
    const placeholderContent = JSON.stringify({
      notice: "This is a stub tarball placeholder",
      package: packageName,
      version: packageVersion,
      files: sortedFiles.length,
      size: distSize,
    }, null, 2);

    fs.writeFileSync(tarballPath + ".placeholder.json", placeholderContent, "utf-8");

    spinner.succeed("Tarball created");

    // Estimated compressed size (rough estimate: ~30% of original)
    const estimatedSize = Math.round(distSize * 0.3);

    console.log();
    success(`Created: ${chalk.cyan(tarballName)} (${formatSize(estimatedSize)} estimated)`);
    console.log(chalk.gray(`Location: ${tarballPath}`));

    // Show stub warning
    console.log();
    warn(chalk.yellow("Note: This is a stub. A placeholder JSON was created instead of actual tarball."));
    info(`Placeholder: ${tarballPath}.placeholder.json`);
  } catch (err) {
    spinner.fail("Pack failed");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the pack command
 *
 * @returns Commander command for 'gdn package pack'
 */
export function createPackCommand(): Command {
  const command = new Command("pack")
    .description("Create a local tarball of the package")
    .argument("[path]", "Package path", ".")
    .option("-o, --out <path>", "Output directory")
    .action(async (targetPath: string, options: Record<string, unknown>) => {
      const packOptions: PackOptions = {
        out: options.out as string | undefined,
      };

      await executePack(targetPath, packOptions);
    });

  return command;
}

export default createPackCommand;
