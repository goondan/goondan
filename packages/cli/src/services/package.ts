import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { configError, networkError, validateError } from '../errors.js';
import type {
  BundleValidator,
  PackageAddRequest,
  PackageAddResult,
  PackageInstallRequest,
  PackageInstallResult,
  PackagePublishRequest,
  PackagePublishResult,
  PackageService,
  RegistryClient,
} from '../types.js';
import { exists, splitYamlDocuments, trimQuotes } from '../utils.js';
import { readCliConfig, resolveRegistryToken, resolveRegistryUrl, resolveStateRoot } from './config.js';
import { packagePathParts, resolveManifestPath } from './path.js';
import { parsePackageRef } from './registry.js';

interface DependencyEntry {
  name: string;
  version: string;
}

interface PackageManifestMeta {
  packageName?: string;
  packageVersion?: string;
  dependencies: DependencyEntry[];
}

interface PackedAttachment {
  fileName: string;
  data: string;
  length: number;
}

interface InstalledLockRecord {
  version: string;
  resolved: string;
  integrity: string;
  dependencies: Record<string, string>;
}

function quoteYaml(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function buildDefaultPackageDocument(packageName: string): string {
  return [
    'apiVersion: goondan.ai/v1',
    'kind: Package',
    'metadata:',
    `  name: ${quoteYaml(packageName)}`,
    'spec:',
    '  version: "0.1.0"',
  ].join('\n');
}

function normalizeNewline(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function lineIsTopLevel(line: string): boolean {
  return line.length > 0 && !line.startsWith(' ');
}

function isPackageDoc(doc: string): boolean {
  return /^kind:\s*Package\s*$/m.test(doc);
}

function updateDependenciesInPackageDoc(doc: string, entry: DependencyEntry): { doc: string; added: boolean } {
  const lines = doc.split('\n');

  const specIndex = lines.findIndex((line) => line.trim() === 'spec:');
  if (specIndex < 0) {
    lines.push('spec:');
  }

  const realSpecIndex = lines.findIndex((line) => line.trim() === 'spec:');
  if (realSpecIndex < 0) {
    return { doc: lines.join('\n'), added: false };
  }

  let specEnd = lines.length;
  for (let i = realSpecIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (typeof line === 'string' && lineIsTopLevel(line)) {
      specEnd = i;
      break;
    }
  }

  let dependenciesIndex = -1;
  for (let i = realSpecIndex + 1; i < specEnd; i += 1) {
    const line = lines[i];
    if (typeof line === 'string' && line.trim() === 'dependencies:') {
      dependenciesIndex = i;
      break;
    }
  }

  const nameLine = `    - name: ${quoteYaml(entry.name)}`;
  const versionLine = `      version: ${quoteYaml(entry.version)}`;

  if (dependenciesIndex < 0) {
    lines.splice(specEnd, 0, '  dependencies:', nameLine, versionLine);
    return {
      doc: lines.join('\n'),
      added: true,
    };
  }

  let depBlockEnd = dependenciesIndex + 1;
  while (depBlockEnd < specEnd) {
    const line = lines[depBlockEnd];
    if (typeof line === 'string' && (line.startsWith('    ') || line.trim() === '')) {
      depBlockEnd += 1;
      continue;
    }
    break;
  }

  for (let i = dependenciesIndex + 1; i < depBlockEnd; i += 1) {
    const line = lines[i];
    if (typeof line !== 'string') {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('- name:')) {
      const candidate = trimQuotes(trimmed.slice('- name:'.length).trim());
      if (candidate === entry.name) {
        return {
          doc: lines.join('\n'),
          added: false,
        };
      }
    }
  }

  lines.splice(depBlockEnd, 0, nameLine, versionLine);
  return {
    doc: lines.join('\n'),
    added: true,
  };
}

function parsePackageManifest(packageDoc: string): PackageManifestMeta {
  const lines = packageDoc.split('\n');

  let packageName: string | undefined;
  let packageVersion: string | undefined;
  const dependencies: DependencyEntry[] = [];

  let inMetadata = false;
  let inSpec = false;
  let inDependencies = false;

  let currentName: string | undefined;
  let currentVersion: string | undefined;

  for (const line of lines) {
    if (line.trim() === 'metadata:') {
      inMetadata = true;
      inSpec = false;
      inDependencies = false;
      continue;
    }

    if (line.trim() === 'spec:') {
      inMetadata = false;
      inSpec = true;
      inDependencies = false;
      continue;
    }

    if (lineIsTopLevel(line)) {
      inMetadata = false;
      inSpec = false;
      inDependencies = false;
    }

    const trimmed = line.trim();

    if (inMetadata && trimmed.startsWith('name:')) {
      packageName = trimQuotes(trimmed.slice('name:'.length).trim());
      continue;
    }

    if (inSpec && !inDependencies && trimmed.startsWith('version:')) {
      packageVersion = trimQuotes(trimmed.slice('version:'.length).trim());
      continue;
    }

    if (inSpec && trimmed === 'dependencies:') {
      inDependencies = true;
      continue;
    }

    if (inDependencies) {
      if (!line.startsWith('    ') && trimmed.length > 0) {
        inDependencies = false;
        continue;
      }

      if (trimmed.startsWith('- name:')) {
        if (currentName && currentVersion) {
          dependencies.push({ name: currentName, version: currentVersion });
        }
        currentName = trimQuotes(trimmed.slice('- name:'.length).trim());
        currentVersion = undefined;
        continue;
      }

      if (trimmed.startsWith('version:')) {
        currentVersion = trimQuotes(trimmed.slice('version:'.length).trim());
        continue;
      }
    }
  }

  if (currentName && currentVersion) {
    dependencies.push({ name: currentName, version: currentVersion });
  }

  return {
    packageName,
    packageVersion,
    dependencies,
  };
}

function chooseDependencyVersion(requested: string | undefined, resolved: string, exact: boolean): string {
  if (requested && requested.length > 0) {
    return requested;
  }

  if (exact) {
    return resolved;
  }

  return `^${resolved}`;
}

function serializeYamlDocuments(documents: string[]): string {
  if (documents.length === 0) {
    return '';
  }

  return `${documents.join('\n---\n').replace(/\n+$/g, '')}\n`;
}

function defaultPackageNameFromManifestPath(manifestPath: string): string {
  const dirName = path.basename(path.dirname(manifestPath));
  const normalized = dirName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (normalized.length === 0) {
    return 'goondan-package';
  }

  return normalized;
}

function dependencyEntriesToRecord(entries: DependencyEntry[]): Record<string, string> {
  const dependencies: Record<string, string> = {};
  for (const entry of entries) {
    dependencies[entry.name] = entry.version;
  }
  return dependencies;
}

function toTarballFileName(packageName: string, version: string): string {
  const parts = packagePathParts(packageName);
  return `${parts.name}-${version}.tgz`;
}

function readCommandError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[], cwd?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const stderrMessage = typeof stderr === 'string' ? stderr.trim() : '';
          const detail = stderrMessage.length > 0 ? stderrMessage : readCommandError(error);
          reject(new Error(detail));
          return;
        }
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
        });
      },
    );
  });
}

async function runPnpmPack(packageDir: string, outputDir: string): Promise<void> {
  await runCommand('pnpm', ['pack', '--pack-destination', outputDir], packageDir);
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function hasPathTraversal(value: string): boolean {
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized === '..') {
    return true;
  }
  return normalized.startsWith('../');
}

function isUnsafeTarEntry(entryPath: string): boolean {
  if (entryPath.startsWith('/')) {
    return true;
  }
  if (entryPath.startsWith('\\')) {
    return true;
  }

  return hasPathTraversal(entryPath);
}

async function listTarEntries(tarballPath: string): Promise<string[]> {
  const result = await runCommand('tar', ['-tzf', tarballPath]);
  return splitLines(result.stdout);
}

function hasPackageManifestEntry(entries: string[]): boolean {
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized === 'package/goondan.yaml') {
      return true;
    }
    if (normalized === 'package/dist/goondan.yaml') {
      return true;
    }
  }
  return false;
}

function validateTarEntries(entries: string[]): void {
  for (const entry of entries) {
    if (isUnsafeTarEntry(entry)) {
      throw validateError(`tarball에 허용되지 않은 경로가 포함되어 있습니다: ${entry}`);
    }
  }
}

async function ensurePackManifestInTarball(tarballPath: string): Promise<void> {
  const entries = await listTarEntries(tarballPath);
  validateTarEntries(entries);

  if (!hasPackageManifestEntry(entries)) {
    throw configError(
      'publish 대상 tarball에 goondan manifest가 없습니다.',
      "패키지 빌드 산출물(dist)에 goondan.yaml 또는 dist/goondan.yaml을 포함하세요.",
    );
  }
}

function verifyIntegrity(tarball: Uint8Array, expectedIntegrity: string): void {
  if (!expectedIntegrity.includes('-')) {
    return;
  }

  const delimiter = expectedIntegrity.indexOf('-');
  if (delimiter <= 0 || delimiter >= expectedIntegrity.length - 1) {
    return;
  }

  const algorithm = expectedIntegrity.slice(0, delimiter);
  const expectedDigest = expectedIntegrity.slice(delimiter + 1);

  if (algorithm !== 'sha512' && algorithm !== 'sha1') {
    return;
  }

  const actualDigest = createHash(algorithm).update(tarball).digest('base64');
  if (actualDigest !== expectedDigest) {
    throw validateError('패키지 무결성 검증에 실패했습니다.', `expected=${expectedIntegrity}`);
  }
}

async function fetchTarball(tarballUrl: string, token?: string): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (token && token.length > 0) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(tarballUrl, {
      method: 'GET',
      headers,
    });
  } catch (error) {
    throw networkError(
      `패키지 tarball 다운로드 네트워크 요청에 실패했습니다: ${tarballUrl}`,
      `--registry 또는 GOONDAN_REGISTRY를 확인하세요. 원인: ${readCommandError(error)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw configError('패키지 tarball 다운로드 인증에 실패했습니다.', '레지스트리 토큰을 확인하세요.');
  }

  if (!response.ok) {
    throw configError(`패키지 tarball 다운로드 실패: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes;
}

async function extractTarballToDirectory(tarballPath: string, installBase: string): Promise<void> {
  await runCommand('tar', ['-xzf', tarballPath, '-C', installBase, '--strip-components=1']);
}

function toInstallPath(stateRoot: string, packageName: string, version: string): string {
  const parts = packagePathParts(packageName);
  if (parts.scope) {
    return path.join(stateRoot, 'packages', parts.scope, parts.name, version);
  }
  return path.join(stateRoot, 'packages', parts.name, version);
}

async function ensureInstalledPackageManifest(installBase: string, packageName: string, version: string): Promise<void> {
  const rootManifest = path.join(installBase, 'goondan.yaml');
  const distManifest = path.join(installBase, 'dist', 'goondan.yaml');

  const hasRoot = await exists(rootManifest);
  const hasDist = await exists(distManifest);

  if (!hasRoot && !hasDist) {
    throw validateError(
      `${packageName}@${version} 패키지에 goondan manifest가 없습니다.`,
      "패키지 tarball에 goondan.yaml 또는 dist/goondan.yaml을 포함해야 합니다.",
    );
  }
}

function formatLockKey(packageName: string, version: string): string {
  return `${packageName}@${version}`;
}

function buildLockfileText(records: Map<string, InstalledLockRecord>): string {
  const keys = [...records.keys()].sort((left, right) => left.localeCompare(right));
  const lines: string[] = ['lockfileVersion: 1', 'packages:'];

  for (const key of keys) {
    const entry = records.get(key);
    if (!entry) {
      continue;
    }

    lines.push(`  ${quoteYaml(key)}:`);
    lines.push(`    version: ${quoteYaml(entry.version)}`);
    lines.push(`    resolved: ${quoteYaml(entry.resolved)}`);
    lines.push(`    integrity: ${quoteYaml(entry.integrity)}`);

    const dependencies = Object.entries(entry.dependencies).sort(([left], [right]) => left.localeCompare(right));
    if (dependencies.length === 0) {
      lines.push('    dependencies: {}');
      continue;
    }

    lines.push('    dependencies:');
    for (const [depName, depVersion] of dependencies) {
      lines.push(`      ${quoteYaml(depName)}: ${quoteYaml(depVersion)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function createPackedAttachment(packageDir: string, packageName: string, version: string): Promise<PackedAttachment> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-pack-'));
  try {
    await runPnpmPack(packageDir, tempDir);

    const entries = await readdir(tempDir);
    const tarballs = entries.filter((entry) => entry.endsWith('.tgz')).sort();
    const packedFile = tarballs[0];

    if (!packedFile) {
      throw configError('패키지 tarball 생성 결과를 찾을 수 없습니다.', 'pnpm pack 출력 경로를 확인하세요.');
    }

    const packedPath = path.join(tempDir, packedFile);
    await ensurePackManifestInTarball(packedPath);
    const bytes = await readFile(packedPath);
    const fileName = toTarballFileName(packageName, version);

    return {
      fileName,
      data: bytes.toString('base64'),
      length: bytes.byteLength,
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'CONFIG_ERROR') {
      throw error;
    }

    throw configError(
      'publish용 tarball 생성에 실패했습니다.',
      `pnpm pack 실행 실패: ${readCommandError(error)}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export class DefaultPackageService implements PackageService {
  private readonly cwd: string;

  private readonly env: NodeJS.ProcessEnv;

  private readonly registryClient: RegistryClient;

  private readonly validator: BundleValidator;

  constructor(cwd: string, env: NodeJS.ProcessEnv, registryClient: RegistryClient, validator: BundleValidator) {
    this.cwd = cwd;
    this.env = env;
    this.registryClient = registryClient;
    this.validator = validator;
  }

  async addDependency(request: PackageAddRequest): Promise<PackageAddResult> {
    const manifestPath = resolveManifestPath(this.cwd, request.bundlePath);
    const manifestExists = await exists(manifestPath);

    let originalText = '';
    if (manifestExists) {
      originalText = normalizeNewline(await readFile(manifestPath, 'utf8'));
    }

    const parsedRef = parsePackageRef(request.ref);
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const config = await readCliConfig(stateRoot);
    const registryUrl = resolveRegistryUrl(request.registry, this.env, config, parsedRef.name);
    const token = resolveRegistryToken(registryUrl, this.env, config);

    const metadata = await this.registryClient.resolvePackage(request.ref, registryUrl, token);
    const dependencyVersion = chooseDependencyVersion(parsedRef.version, metadata.latestVersion, request.exact);

    const docs = originalText.length > 0 ? splitYamlDocuments(originalText) : [];
    let nextDocs = docs.slice();

    if (nextDocs.length === 0) {
      const packageDoc = buildDefaultPackageDocument(defaultPackageNameFromManifestPath(manifestPath));
      const updated = updateDependenciesInPackageDoc(packageDoc, {
        name: parsedRef.name,
        version: dependencyVersion,
      });
      nextDocs = [updated.doc];
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, serializeYamlDocuments(nextDocs), 'utf8');
      return {
        ref: request.ref,
        added: updated.added,
        manifestPath,
        resolvedVersion: dependencyVersion,
      };
    }

    const firstDoc = nextDocs[0];
    if (typeof firstDoc !== 'string') {
      throw configError('Bundle 문서를 읽는 중 오류가 발생했습니다.', 'goondan.yaml 내용을 확인하세요.');
    }
    if (!isPackageDoc(firstDoc)) {
      const packageDoc = buildDefaultPackageDocument(defaultPackageNameFromManifestPath(manifestPath));
      const updatedPackageDoc = updateDependenciesInPackageDoc(packageDoc, {
        name: parsedRef.name,
        version: dependencyVersion,
      });
      nextDocs = [updatedPackageDoc.doc, ...nextDocs];
      await writeFile(manifestPath, serializeYamlDocuments(nextDocs), 'utf8');
      return {
        ref: request.ref,
        added: updatedPackageDoc.added,
        manifestPath,
        resolvedVersion: dependencyVersion,
      };
    }

    const updated = updateDependenciesInPackageDoc(firstDoc, {
      name: parsedRef.name,
      version: dependencyVersion,
    });

    nextDocs[0] = updated.doc;
    await writeFile(manifestPath, serializeYamlDocuments(nextDocs), 'utf8');

    return {
      ref: request.ref,
      added: updated.added,
      manifestPath,
      resolvedVersion: dependencyVersion,
    };
  }

  async installDependencies(request: PackageInstallRequest): Promise<PackageInstallResult> {
    const manifestPath = resolveManifestPath(this.cwd, request.bundlePath);
    const manifestExists = await exists(manifestPath);
    if (!manifestExists) {
      throw configError(`Bundle 파일을 찾을 수 없습니다: ${manifestPath}`, 'goondan.yaml 경로를 확인하세요.');
    }

    const source = normalizeNewline(await readFile(manifestPath, 'utf8'));
    const docs = splitYamlDocuments(source);
    const firstDoc = docs[0];
    if (docs.length === 0 || typeof firstDoc !== 'string' || !isPackageDoc(firstDoc)) {
      throw configError('Package 문서를 찾을 수 없습니다.', 'goondan.yaml 첫 번째 문서에 kind: Package를 선언하세요.');
    }

    const manifest = parsePackageManifest(firstDoc);
    if (manifest.dependencies.length === 0) {
      return {
        installed: 0,
      };
    }

    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const config = await readCliConfig(stateRoot);
    const resolvedVersions = new Map<string, string>();
    const installedRecords = new Map<string, InstalledLockRecord>();
    const queue: DependencyEntry[] = [...manifest.dependencies];

    while (queue.length > 0) {
      const dep = queue.shift();
      if (!dep) {
        continue;
      }

      const registryUrl = resolveRegistryUrl(request.registry, this.env, config, dep.name);
      const token = resolveRegistryToken(registryUrl, this.env, config);

      const resolved = await this.registryClient.resolvePackage(`${dep.name}@${dep.version}`, registryUrl, token);
      const resolvedVersion = resolved.latestVersion;

      const previousVersion = resolvedVersions.get(dep.name);
      if (previousVersion !== undefined && previousVersion !== resolvedVersion) {
        throw validateError(
          `의존성 버전 충돌: ${dep.name} (${previousVersion} vs ${resolvedVersion})`,
          'goondan.yaml dependency 버전 범위를 조정하세요.',
        );
      }
      resolvedVersions.set(dep.name, resolvedVersion);

      const lockKey = formatLockKey(dep.name, resolvedVersion);
      if (installedRecords.has(lockKey)) {
        continue;
      }

      const versionMetadata = await this.registryClient.getPackageVersion(
        dep.name,
        resolvedVersion,
        registryUrl,
        token,
      );

      const tarball = await fetchTarball(versionMetadata.dist.tarball, token);
      verifyIntegrity(tarball, versionMetadata.dist.integrity);

      const installBase = toInstallPath(stateRoot, dep.name, resolvedVersion);
      await rm(installBase, { recursive: true, force: true });
      await mkdir(installBase, { recursive: true });

      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-install-'));
      try {
        const tarballPath = path.join(tempDir, 'package.tgz');
        await writeFile(tarballPath, tarball);

        const entries = await listTarEntries(tarballPath);
        validateTarEntries(entries);
        await extractTarballToDirectory(tarballPath, installBase);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }

      await ensureInstalledPackageManifest(installBase, dep.name, resolvedVersion);

      installedRecords.set(lockKey, {
        version: resolvedVersion,
        resolved: versionMetadata.dist.tarball,
        integrity: versionMetadata.dist.integrity,
        dependencies: versionMetadata.dependencies,
      });

      for (const [childName, childVersion] of Object.entries(versionMetadata.dependencies)) {
        queue.push({
          name: childName,
          version: childVersion,
        });
      }
    }

    const lockfilePath = path.join(path.dirname(manifestPath), 'goondan.lock.yaml');
    const lockfileText = buildLockfileText(installedRecords);

    if (request.frozenLockfile && (await exists(lockfilePath))) {
      const existing = await readFile(lockfilePath, 'utf8');
      if (existing !== lockfileText) {
        throw validateError('frozen-lockfile 모드에서 lockfile이 현재 의존성과 일치하지 않습니다.');
      }
    } else {
      await writeFile(lockfilePath, lockfileText, 'utf8');
    }

    return {
      installed: installedRecords.size,
      lockfilePath,
    };
  }

  async publishPackage(request: PackagePublishRequest): Promise<PackagePublishResult> {
    const manifestPath = resolveManifestPath(this.cwd, request.path);
    const hasManifest = await exists(manifestPath);
    if (!hasManifest) {
      throw configError(`Bundle 파일을 찾을 수 없습니다: ${manifestPath}`, 'publish할 패키지 경로를 확인하세요.');
    }

    const validation = await this.validator.validate(manifestPath, false, false);
    if (!validation.valid) {
      throw validateError('publish 전 validate에 실패했습니다.', 'gdn validate 결과를 해결한 뒤 다시 시도하세요.');
    }

    const source = normalizeNewline(await readFile(manifestPath, 'utf8'));
    const docs = splitYamlDocuments(source);
    const firstDoc = docs[0];
    if (docs.length === 0 || typeof firstDoc !== 'string' || !isPackageDoc(firstDoc)) {
      throw configError('publish 대상에 Package 문서가 없습니다.', 'goondan.yaml 첫 번째 문서에 kind: Package를 선언하세요.');
    }

    const manifest = parsePackageManifest(firstDoc);
    if (!manifest.packageName) {
      throw configError('Package metadata.name이 없습니다.', 'Package metadata.name을 설정하세요.');
    }
    if (!manifest.packageVersion) {
      throw configError('Package spec.version이 없습니다.', 'publish 전에 spec.version을 설정하세요.');
    }

    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const config = await readCliConfig(stateRoot);
    const registryUrl = resolveRegistryUrl(request.registry, this.env, config, manifest.packageName);
    const token = resolveRegistryToken(registryUrl, this.env, config);
    const packageDir = path.dirname(manifestPath);
    const packedAttachment = await createPackedAttachment(packageDir, manifest.packageName, manifest.packageVersion);
    const dependencies = dependencyEntriesToRecord(manifest.dependencies);

    if (!request.dryRun) {
      const response = await this.registryClient.publishPackage(
        {
          name: manifest.packageName,
          version: manifest.packageVersion,
          access: request.access,
          dependencies,
          'dist-tags': {
            [request.tag]: manifest.packageVersion,
          },
          _attachments: {
            [packedAttachment.fileName]: {
              data: packedAttachment.data,
              contentType: 'application/gzip',
              length: packedAttachment.length,
            },
          },
        },
        registryUrl,
        token,
      );

      if (!response.ok) {
        throw configError('레지스트리 publish 요청이 실패했습니다.');
      }
    }

    return {
      published: !request.dryRun,
      registryUrl,
      packageName: manifest.packageName,
      version: manifest.packageVersion,
      tag: request.tag,
      dryRun: request.dryRun,
    };
  }
}
