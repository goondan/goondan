import { promises as fs } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import type { RuntimeResource, ValidationError } from "../types.js";
import { isJsonObject } from "../types.js";
import { parseYamlDocument, parseYamlDocuments } from "./simple-yaml.js";
import { toRuntimeResource, validateResources } from "./resources.js";

export interface BundleLoaderOptions {
  maxFileBytes?: number;
  maxDocumentsPerFile?: number;
  allowedBaseNames?: string[];
  stateRoot?: string;
  loadPackageDependencies?: boolean;
}

export interface BundleLoadResult {
  resources: RuntimeResource[];
  errors: ValidationError[];
  scannedFiles: string[];
}

interface PackageDependency {
  name: string;
  version: string;
}

interface PackageMeta {
  packageName?: string;
  dependencies: PackageDependency[];
}

interface DependencyLoadResult {
  resources: RuntimeResource[];
  scannedFiles: string[];
}

const DEFAULT_ALLOWED_BASE_NAMES = [
  "goondan",
  "model",
  "models",
  "agent",
  "agents",
  "tool",
  "tools",
  "extension",
  "extensions",
  "connector",
  "connectors",
  "connection",
  "connections",
  "swarm",
  "swarms",
  "resources",
];

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-.]+)?$/;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export class BundleLoader {
  private readonly maxFileBytes: number;
  private readonly maxDocumentsPerFile: number;
  private readonly allowedBaseNames: Set<string>;
  private readonly stateRoot: string;
  private readonly loadPackageDependencies: boolean;

  constructor(options: BundleLoaderOptions = {}) {
    this.maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
    this.maxDocumentsPerFile = options.maxDocumentsPerFile ?? 100;
    this.allowedBaseNames = new Set(options.allowedBaseNames ?? DEFAULT_ALLOWED_BASE_NAMES);
    this.stateRoot = options.stateRoot ?? path.join(os.homedir(), ".goondan");
    this.loadPackageDependencies = options.loadPackageDependencies ?? true;
  }

  async load(bundleDir: string): Promise<BundleLoadResult> {
    const files = await this.collectBundleFiles(bundleDir);
    const errors: ValidationError[] = [];
    const packageMeta = await this.readLocalPackageMeta(bundleDir, errors);
    const dependencyResult = await this.loadDependencyResources(bundleDir, packageMeta.dependencies, errors);
    const localResources = await this.loadResourcesFromLocalFiles(files, bundleDir, packageMeta.packageName, errors);

    const resources = [...dependencyResult.resources, ...localResources];
    const validationErrors = validateResources(resources);
    errors.push(...validationErrors);

    const scanned = new Set<string>();
    files.forEach((file) => scanned.add(file));
    dependencyResult.scannedFiles.forEach((file) => scanned.add(file));

    return {
      resources,
      errors,
      scannedFiles: [...scanned].sort((left, right) => left.localeCompare(right)),
    };
  }

  async loadOrThrow(bundleDir: string): Promise<RuntimeResource[]> {
    const result = await this.load(bundleDir);
    if (result.errors.length > 0) {
      const summary = result.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join("\n");
      throw new Error(summary);
    }

    return result.resources;
  }

  private async collectBundleFiles(bundleDir: string): Promise<string[]> {
    const collected: string[] = [];
    await this.walk(bundleDir, collected);
    return collected.sort((left, right) => left.localeCompare(right));
  }

  private async walk(currentDir: string, collected: string[]): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(fullPath, collected);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".yaml" && ext !== ".yml") {
        continue;
      }

      const baseName = path.basename(entry.name, ext).toLowerCase();
      if (!this.allowedBaseNames.has(baseName)) {
        continue;
      }

      collected.push(fullPath);
    }
  }

  private async readLocalPackageMeta(bundleDir: string, errors: ValidationError[]): Promise<PackageMeta> {
    const manifestPath = path.join(bundleDir, "goondan.yaml");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const docs = parseYamlDocuments(raw);
      return parsePackageMeta(docs);
    } catch {
      if (await existsFile(manifestPath)) {
        errors.push({
          code: "E_CONFIG_PARSE_ERROR",
          message: "goondan.yaml 패키지 문서를 파싱할 수 없습니다.",
          path: "goondan.yaml",
          suggestion: "YAML 문법과 첫 번째 Package 문서를 확인하세요.",
        });
      }
      return {
        dependencies: [],
      };
    }
  }

  private async loadDependencyResources(
    bundleDir: string,
    directDependencies: PackageDependency[],
    errors: ValidationError[],
  ): Promise<DependencyLoadResult> {
    if (!this.loadPackageDependencies || directDependencies.length === 0) {
      return {
        resources: [],
        scannedFiles: [],
      };
    }

    const lockfilePath = path.join(bundleDir, "goondan.lock.yaml");
    const lockMap = await readLockfileVersions(lockfilePath);
    const resources: RuntimeResource[] = [];
    const scannedFiles: string[] = [];
    const queue: PackageDependency[] = [...directDependencies];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const dep = queue.shift();
      if (!dep) {
        continue;
      }

      const resolvedVersion = resolveDependencyVersion(dep, lockMap);
      if (!resolvedVersion) {
        errors.push({
          code: "E_CONFIG_PACKAGE_LOCK_MISSING",
          message: `의존성 버전을 lockfile에서 확인할 수 없습니다: ${dep.name}@${dep.version}`,
          path: "goondan.lock.yaml",
          suggestion: "`gdn package install`을 다시 실행해 lockfile을 갱신하세요.",
        });
        continue;
      }

      const visitKey = `${dep.name}@${resolvedVersion}`;
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);

      const packageRoot = resolveInstalledPackageRoot(this.stateRoot, dep.name, resolvedVersion);
      if (!(await existsFile(packageRoot))) {
        errors.push({
          code: "E_CONFIG_PACKAGE_NOT_INSTALLED",
          message: `설치된 패키지를 찾을 수 없습니다: ${dep.name}@${resolvedVersion}`,
          path: packageRoot,
          suggestion: "`gdn package install`을 실행해 의존 패키지를 설치하세요.",
        });
        continue;
      }

      const manifestPath = await findInstalledManifestPath(packageRoot);
      if (!manifestPath) {
        errors.push({
          code: "E_CONFIG_PACKAGE_MANIFEST_MISSING",
          message: `패키지 manifest(goondan.yaml)가 없습니다: ${dep.name}@${resolvedVersion}`,
          path: packageRoot,
          suggestion: "패키지 tarball에 goondan.yaml 또는 dist/goondan.yaml을 포함하세요.",
        });
        continue;
      }

      scannedFiles.push(manifestPath);
      const displayPath = `${dep.name}/${toPosix(path.relative(packageRoot, manifestPath))}`;
      const loaded = await this.loadResourcesFromFile(
        manifestPath,
        displayPath,
        dep.name,
        packageRoot,
        errors,
      );
      resources.push(...loaded);

      try {
        const raw = await fs.readFile(manifestPath, "utf8");
        const docs = parseYamlDocuments(raw);
        const packageMeta = parsePackageMeta(docs);
        for (const child of packageMeta.dependencies) {
          queue.push(child);
        }
      } catch {
        errors.push({
          code: "E_CONFIG_PARSE_ERROR",
          message: `패키지 문서를 파싱할 수 없습니다: ${dep.name}@${resolvedVersion}`,
          path: displayPath,
          suggestion: "의존 패키지 goondan.yaml의 문법을 확인하세요.",
        });
      }
    }

    return {
      resources,
      scannedFiles,
    };
  }

  private async loadResourcesFromLocalFiles(
    files: string[],
    bundleDir: string,
    packageName: string | undefined,
    errors: ValidationError[],
  ): Promise<RuntimeResource[]> {
    const resources: RuntimeResource[] = [];

    for (const file of files) {
      const relativePath = toPosix(path.relative(bundleDir, file) || path.basename(file));
      const loaded = await this.loadResourcesFromFile(file, relativePath, packageName, bundleDir, errors);
      resources.push(...loaded);
    }

    return resources;
  }

  private async loadResourcesFromFile(
    filePath: string,
    displayPath: string,
    packageName: string | undefined,
    rootDir: string,
    errors: ValidationError[],
  ): Promise<RuntimeResource[]> {
    const resources: RuntimeResource[] = [];

    try {
      const stat = await fs.stat(filePath);
      if (stat.size > this.maxFileBytes) {
        errors.push({
          code: "E_CONFIG_FILE_TOO_LARGE",
          message: `YAML file exceeds size limit (${this.maxFileBytes} bytes).`,
          path: displayPath,
          suggestion: "YAML 파일을 분할하거나 용량을 줄이세요.",
        });
        return resources;
      }

      const content = await fs.readFile(filePath, "utf8");
      const docs = parseYamlDocuments(content);
      if (docs.length > this.maxDocumentsPerFile) {
        errors.push({
          code: "E_CONFIG_TOO_MANY_DOCUMENTS",
          message: `YAML documents exceed limit (${this.maxDocumentsPerFile}).`,
          path: displayPath,
          suggestion: "문서 수를 줄이거나 파일을 분할하세요.",
        });
        return resources;
      }

      docs.forEach((value, docIndex) => {
        const resource = toRuntimeResource({
          value,
          file: displayPath,
          docIndex,
          packageName,
          rootDir,
        });

        if (!resource) {
          return;
        }

        if (resource.kind.trim().length === 0) {
          return;
        }

        resources.push(resource);
      });

      return resources;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse YAML";
      errors.push({
        code: "E_CONFIG_PARSE_ERROR",
        message,
        path: displayPath,
        suggestion: "YAML 문법과 들여쓰기를 확인하세요.",
      });
      return resources;
    }
  }
}

function toPosix(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function parsePackageMeta(docs: unknown[]): PackageMeta {
  const first = docs[0];
  if (!isJsonObject(first)) {
    return { dependencies: [] };
  }

  if (first.kind !== "Package") {
    return { dependencies: [] };
  }

  const metadata = first.metadata;
  const packageName =
    isJsonObject(metadata) && typeof metadata.name === "string" && metadata.name.length > 0
      ? metadata.name
      : undefined;

  const spec = first.spec;
  const dependencies = readDependencies(spec);

  return {
    packageName,
    dependencies,
  };
}

function readDependencies(spec: unknown): PackageDependency[] {
  if (!isJsonObject(spec)) {
    return [];
  }

  const depValue = spec.dependencies;
  if (!Array.isArray(depValue)) {
    return [];
  }

  const dependencies: PackageDependency[] = [];
  for (const item of depValue) {
    if (!isJsonObject(item)) {
      continue;
    }
    const name = item.name;
    const version = item.version;
    if (typeof name !== "string" || typeof version !== "string") {
      continue;
    }
    if (name.length === 0 || version.length === 0) {
      continue;
    }
    dependencies.push({
      name,
      version,
    });
  }

  return dependencies;
}

async function readLockfileVersions(lockfilePath: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!(await existsFile(lockfilePath))) {
    return result;
  }

  const raw = await fs.readFile(lockfilePath, "utf8");
  const parsed = parseYamlDocument(raw);
  if (!isJsonObject(parsed)) {
    return result;
  }

  const packages = parsed.packages;
  if (!isJsonObject(packages)) {
    return result;
  }

  for (const key of Object.keys(packages)) {
    const parsedKey = parseLockfileKey(key);
    if (!parsedKey) {
      continue;
    }

    const versions = result.get(parsedKey.name) ?? [];
    versions.push(parsedKey.version);
    result.set(parsedKey.name, versions);
  }

  return result;
}

function parseLockfileKey(value: string): { name: string; version: string } | null {
  const normalized = trimQuotes(value.trim());

  if (normalized.startsWith("@")) {
    const slash = normalized.indexOf("/");
    if (slash <= 1) {
      return null;
    }

    const secondAt = normalized.indexOf("@", slash + 1);
    if (secondAt <= slash + 1 || secondAt >= normalized.length - 1) {
      return null;
    }

    return {
      name: normalized.slice(0, secondAt),
      version: normalized.slice(secondAt + 1),
    };
  }

  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at >= normalized.length - 1) {
    return null;
  }

  return {
    name: normalized.slice(0, at),
    version: normalized.slice(at + 1),
  };
}

function trimQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }

  return value;
}

function resolveDependencyVersion(dep: PackageDependency, lockMap: Map<string, string[]>): string | undefined {
  const lockedVersions = lockMap.get(dep.name);
  if (!lockedVersions || lockedVersions.length === 0) {
    if (isExactSemver(dep.version)) {
      return dep.version;
    }
    return undefined;
  }

  if (isExactSemver(dep.version)) {
    if (lockedVersions.includes(dep.version)) {
      return dep.version;
    }
    return undefined;
  }

  if (lockedVersions.length === 1) {
    return lockedVersions[0];
  }

  const sorted = [...lockedVersions].sort(compareSemver);
  return sorted[sorted.length - 1];
}

function isExactSemver(value: string): boolean {
  return parseSemver(value) !== null;
}

function compareSemver(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);

  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right);
  }

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major;
  }

  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor;
  }

  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch;
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function parseSemver(value: string): ParsedSemver | null {
  const match = value.match(SEMVER_PATTERN);
  if (!match) {
    return null;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prereleaseValue = match[4];

  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null;
  }

  const prerelease =
    typeof prereleaseValue === "string" && prereleaseValue.length > 0 ? prereleaseValue.split(".") : [];

  return {
    major,
    minor,
    patch,
    prerelease,
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }

  if (right.length === 0) {
    return -1;
  }

  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);

    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftPart);
      const rightNumber = Number(rightPart);
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      continue;
    }

    if (leftNumeric) {
      return -1;
    }
    if (rightNumeric) {
      return 1;
    }

    const compared = leftPart.localeCompare(rightPart);
    if (compared !== 0) {
      return compared;
    }
  }

  return 0;
}

function resolveInstalledPackageRoot(stateRoot: string, packageName: string, version: string): string {
  if (packageName.startsWith("@")) {
    const slash = packageName.indexOf("/");
    if (slash > 1 && slash < packageName.length - 1) {
      const scope = packageName.slice(1, slash);
      const name = packageName.slice(slash + 1);
      return path.join(stateRoot, "packages", scope, name, version);
    }
  }

  return path.join(stateRoot, "packages", packageName, version);
}

async function findInstalledManifestPath(packageRoot: string): Promise<string | undefined> {
  const distManifest = path.join(packageRoot, "dist", "goondan.yaml");
  if (await existsFile(distManifest)) {
    return distManifest;
  }

  const rootManifest = path.join(packageRoot, "goondan.yaml");
  if (await existsFile(rootManifest)) {
    return rootManifest;
  }

  return undefined;
}

async function existsFile(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
