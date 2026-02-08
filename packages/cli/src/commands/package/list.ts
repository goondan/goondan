/**
 * gdn package list command
 *
 * Lists installed packages
 * @see /docs/specs/cli.md - Section 6.6 (gdn package list)
 * @see /docs/specs/bundle_package.md - Section 13.6
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import YAML from "yaml";
import { info, warn, error as logError } from "../../utils/logger.js";

/**
 * List command options
 */
export interface ListOptions {
  depth: number;
  all: boolean;
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
 * Parse package reference
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
 * Load lockfile
 */
function loadLockfile(projectPath: string): Lockfile | null {
  const lockfilePath = path.join(projectPath, "goondan.lock.yaml");

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
 * Tree characters for display
 */
const TREE_CHARS = {
  pipe: "\u2502   ",
  branch: "\u251C\u2500\u2500 ",
  corner: "\u2514\u2500\u2500 ",
  space: "    ",
};

/**
 * Package tree node
 */
interface PackageNode {
  name: string;
  version: string;
  isDev: boolean;
  deduped: boolean;
  children: PackageNode[];
}

/**
 * Print package tree recursively
 */
function printTree(
  node: PackageNode,
  depth: number,
  maxDepth: number,
  prefix: string = "",
  isLast: boolean = true
): void {
  const displayVersion = node.deduped
    ? chalk.gray(`(deduped)`)
    : chalk.gray(node.version);

  const devTag = node.isDev ? chalk.yellow(" [dev]") : "";
  const connector = isLast ? TREE_CHARS.corner : TREE_CHARS.branch;

  if (depth === 0) {
    console.log(`${chalk.cyan(node.name)}@${displayVersion}${devTag}`);
  } else {
    console.log(`${prefix}${connector}${chalk.cyan(node.name)}@${displayVersion}${devTag}`);
  }

  if (depth >= maxDepth || node.children.length === 0) {
    return;
  }

  const childPrefix = depth === 0 ? "" : prefix + (isLast ? TREE_CHARS.space : TREE_CHARS.pipe);

  node.children.forEach((child, index) => {
    const isChildLast = index === node.children.length - 1;
    printTree(child, depth + 1, maxDepth, childPrefix, isChildLast);
  });
}

/**
 * Build package tree from manifest and lockfile
 */
function buildPackageTree(
  manifest: PackageManifest,
  lockfile: Lockfile | null,
  options: ListOptions
): PackageNode[] {
  const dependencies = manifest.spec.dependencies ?? [];
  const devDependencies = manifest.spec.devDependencies ?? [];
  const nodes: PackageNode[] = [];
  const seen = new Set<string>();

  // Helper to create node
  const createNode = (dep: string, isDev: boolean): PackageNode => {
    const parsed = parsePackageRef(dep);
    const displayName = parsed.scope ? `${parsed.scope}/${parsed.name}` : parsed.name;

    // Look up in lockfile for resolved version
    let resolvedVersion = parsed.version ?? "unknown";

    if (lockfile) {
      // Try to find in lockfile
      const lockEntries = Object.entries(lockfile.packages);
      for (const [key, entry] of lockEntries) {
        if (key.startsWith(`${displayName}@`)) {
          resolvedVersion = entry.version;
          break;
        }
      }
    }

    const deduped = seen.has(displayName);
    seen.add(displayName);

    const node: PackageNode = {
      name: displayName,
      version: resolvedVersion,
      isDev,
      deduped,
      children: [],
    };

    // Add children from lockfile if depth > 0
    if (options.depth > 0 && lockfile && !deduped) {
      const lockKey = `${displayName}@${resolvedVersion}`;
      const lockEntry = lockfile.packages[lockKey];

      if (lockEntry?.dependencies) {
        for (const [childName, childVersion] of Object.entries(lockEntry.dependencies)) {
          node.children.push({
            name: childName,
            version: childVersion,
            isDev: false,
            deduped: seen.has(childName),
            children: [],
          });
          seen.add(childName);
        }
      }
    }

    return node;
  };

  // Process direct dependencies
  for (const dep of dependencies) {
    nodes.push(createNode(dep, false));
  }

  // Process dev dependencies (if not production mode)
  if (options.all || options.depth > 0) {
    for (const dep of devDependencies) {
      nodes.push(createNode(dep, true));
    }
  }

  return nodes;
}

/**
 * Execute the list command
 */
async function executeList(options: ListOptions): Promise<void> {
  const projectPath = process.cwd();

  try {
    // Load Package from goondan.yaml
    const manifest = loadPackageManifest(projectPath);

    if (!manifest) {
      logError("Package not found in goondan.yaml");
      info("Run 'gdn init --package' to create a new package project.");
      process.exitCode = 1;
      return;
    }

    // Get dependencies
    const dependencies = manifest.spec.dependencies ?? [];
    const devDependencies = manifest.spec.devDependencies ?? [];

    if (dependencies.length === 0 && devDependencies.length === 0) {
      info("No dependencies installed.");
      return;
    }

    // Load lockfile for resolved versions
    const lockfile = loadLockfile(projectPath);

    if (!lockfile && options.depth > 0) {
      warn("No lockfile found. Run 'gdn package install' first.");
    }

    // Build and print tree
    const tree = buildPackageTree(manifest, lockfile, options);

    console.log();

    if (options.depth === 0) {
      // Simple list output
      for (const node of tree) {
        const devTag = node.isDev ? chalk.yellow(" [dev]") : "";
        console.log(`${chalk.cyan(node.name)}@${chalk.gray(node.version)}${devTag}`);
      }
    } else {
      // Tree output
      for (const node of tree) {
        printTree(node, 0, options.depth);
      }
    }

    console.log();
    info(`${dependencies.length} dependencies, ${devDependencies.length} devDependencies`);
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the list command
 *
 * @returns Commander command for 'gdn package list'
 */
export function createListCommand(): Command {
  const command = new Command("list")
    .description("List installed packages")
    .option("--depth <n>", "Dependency tree depth", (v) => parseInt(v, 10), 0)
    .option("-a, --all", "Show all dependencies including dev", false)
    .action(async (options: Record<string, unknown>) => {
      const listOptions: ListOptions = {
        depth: (options.depth as number) ?? 0,
        all: (options.all as boolean) ?? false,
      };

      await executeList(listOptions);
    });

  return command;
}

export default createListCommand;
