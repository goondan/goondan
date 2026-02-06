/**
 * Bundle 로드
 * @see /docs/specs/bundle.md
 * @see /docs/specs/bundle_package.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import { parseMultiDocument } from './parser.js';
import { validateResources, validateNameUniqueness } from './validator.js';
import { resolveAllReferences } from './resolver.js';
import { BundleError, ParseError, ValidationError, ReferenceError } from './errors.js';
import type { Resource } from '../types/index.js';

/**
 * Bundle Package 매니페스트 (package.yaml)
 */
interface PackageManifest {
  apiVersion: string;
  kind: 'Package';
  metadata: {
    name: string;
    version: string;
    annotations?: Record<string, string>;
  };
  spec: {
    dependencies?: string[];
    resources?: string[];
    dist?: string[];
  };
}

/**
 * Dependency 참조 파싱 결과
 */
interface DependencyRef {
  scope: string | null;
  name: string;
  version: string | null;
  fullName: string;
}

/**
 * Bundle 로드 결과
 */
export interface BundleLoadResult {
  /** 파싱된 리소스 배열 */
  resources: Resource[];
  /** 발생한 오류 배열 */
  errors: (BundleError | ParseError | ValidationError | ReferenceError)[];
  /** 로드된 소스 파일 경로 */
  sources: string[];
  /** 오류 없이 로드되었는지 확인 */
  isValid: () => boolean;
  /** 특정 Kind의 리소스들 조회 */
  getResourcesByKind: (kind: string) => Resource[];
  /** 특정 리소스 조회 */
  getResource: (kind: string, name: string) => Resource | undefined;
}

/**
 * 디렉토리 로드 옵션
 */
export interface LoadDirectoryOptions {
  /** glob 패턴 (기본: "**\/*.{yaml,yml}") */
  pattern?: string;
  /** 무시할 패턴 */
  ignore?: string[];
}

/**
 * Bundle Package Ref 파싱
 * @example "@goondan/base@1.0.0" -> { scope: "@goondan", name: "base", version: "1.0.0" }
 * @example "@goondan/base" -> { scope: "@goondan", name: "base", version: null }
 */
function parseDependencyRef(ref: string): DependencyRef {
  // @scope/name@version 또는 @scope/name 또는 name@version 또는 name
  const versionMatch = ref.match(/^(.+?)@(\d+\.\d+\.\d+.*)$/);
  let nameWithScope: string;
  let version: string | null = null;

  if (versionMatch && versionMatch[1] && versionMatch[2]) {
    nameWithScope = versionMatch[1];
    version = versionMatch[2];
  } else {
    nameWithScope = ref;
  }

  // @scope/name 또는 name
  const scopeMatch = nameWithScope.match(/^(@[^/]+)\/(.+)$/);
  let scope: string | null = null;
  let name: string;

  if (scopeMatch && scopeMatch[1] && scopeMatch[2]) {
    scope = scopeMatch[1];
    name = scopeMatch[2];
  } else {
    name = nameWithScope;
  }

  const fullName = scope ? `${scope}/${name}` : name;
  return { scope, name, version, fullName };
}

/**
 * PackageManifest 타입 가드
 */
function isPackageManifest(value: unknown): value is PackageManifest {
  if (value === null || typeof value !== 'object') return false;
  if (!('kind' in value) || !('apiVersion' in value) || !('metadata' in value) || !('spec' in value)) return false;
  return value.kind === 'Package' &&
    typeof value.apiVersion === 'string' &&
    typeof value.metadata === 'object' && value.metadata !== null &&
    typeof value.spec === 'object' && value.spec !== null;
}

/**
 * package.yaml 파싱
 */
async function parsePackageManifest(
  packageYamlPath: string
): Promise<PackageManifest | null> {
  try {
    const content = await fs.promises.readFile(packageYamlPath, 'utf-8');
    const parsed: unknown = parseYaml(content);
    if (isPackageManifest(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 패키지 경로 resolve
 * .goondan/packages/{scope}/{name}/ 또는 .goondan/packages/{name}/
 */
function resolvePackagePath(projectDir: string, depRef: DependencyRef): string {
  if (depRef.scope) {
    return path.join(projectDir, '.goondan', 'packages', depRef.scope, depRef.name);
  }
  return path.join(projectDir, '.goondan', 'packages', depRef.name);
}

/**
 * Dependency에서 리소스 로드
 * @see /docs/specs/bundle_package.md 섹션 9
 */
async function loadDependencyResources(
  projectDir: string,
  dependencies: string[],
  loadedPackages: Set<string>,
  errors: (BundleError | ParseError | ValidationError | ReferenceError)[],
  sources: string[]
): Promise<Resource[]> {
  const resources: Resource[] = [];

  for (const dep of dependencies) {
    const depRef = parseDependencyRef(dep);

    // 이미 로드된 패키지인 경우 스킵 (순환 의존성 방지)
    if (loadedPackages.has(depRef.fullName)) {
      continue;
    }
    loadedPackages.add(depRef.fullName);

    // 패키지 경로 확인
    const packagePath = resolvePackagePath(projectDir, depRef);
    const packageYamlPath = path.join(packagePath, 'package.yaml');

    const manifest = await parsePackageManifest(packageYamlPath);
    if (!manifest) {
      errors.push(
        new BundleError(
          `Dependency package not found: ${dep} (expected at ${packagePath}). Run 'gdn package install' first.`
        )
      );
      continue;
    }

    // 재귀적으로 하위 의존성 로드
    if (manifest.spec.dependencies && manifest.spec.dependencies.length > 0) {
      const subResources = await loadDependencyResources(
        projectDir,
        manifest.spec.dependencies,
        loadedPackages,
        errors,
        sources
      );
      resources.push(...subResources);
    }

    // 패키지의 리소스 로드
    if (manifest.spec.resources && manifest.spec.resources.length > 0) {
      // dist 폴더 경로 결정 (기본: dist/)
      const distPath = manifest.spec.dist?.[0]?.replace(/\/$/, '') ?? 'dist';
      const distDir = path.join(packagePath, distPath);

      for (const resourcePath of manifest.spec.resources) {
        const fullResourcePath = path.join(distDir, resourcePath);

        try {
          const content = await fs.promises.readFile(fullResourcePath, 'utf-8');
          const parsed = parseMultiDocument(content, fullResourcePath);

          // entry 경로를 패키지 dist 기준으로 조정
          for (const resource of parsed) {
            if (resource.spec && typeof resource.spec === 'object' && !Array.isArray(resource.spec)) {
              const spec = resource.spec;
              if ('entry' in spec && typeof spec.entry === 'string') {
                // entry가 상대 경로이면 dist 기준 절대 경로로 변환
                const entry = spec.entry;
                if (entry.startsWith('./') || entry.startsWith('../')) {
                  spec.entry = path.join(distDir, entry);
                }
              }
            }
            // 패키지 출처 메타데이터 추가
            if (!resource.metadata.annotations) {
              resource.metadata.annotations = {};
            }
            resource.metadata.annotations['goondan.io/package'] = manifest.metadata.name;
            resource.metadata.annotations['goondan.io/package-version'] = manifest.metadata.version;
          }

          resources.push(...parsed);
          sources.push(fullResourcePath);
        } catch (err) {
          if (err instanceof ParseError) {
            errors.push(err);
          } else if (err instanceof Error) {
            errors.push(
              new BundleError(
                `Failed to load resource from package ${dep}: ${resourcePath} (${fullResourcePath})`,
                { cause: err }
              )
            );
          }
        }
      }
    }
  }

  return resources;
}

/**
 * BundleLoadResult 생성 헬퍼
 */
function createBundleLoadResult(
  resources: Resource[],
  errors: (BundleError | ParseError | ValidationError | ReferenceError)[],
  sources: string[]
): BundleLoadResult {
  // 리소스 인덱스 생성
  const resourceIndex = new Map<string, Resource>();
  for (const r of resources) {
    resourceIndex.set(`${r.kind}/${r.metadata.name}`, r);
  }

  return {
    resources,
    errors,
    sources,
    isValid: () => errors.filter((e) => {
      if (e instanceof ValidationError) {
        return e.level !== 'warning';
      }
      return true;
    }).length === 0,
    getResourcesByKind: (kind: string) =>
      resources.filter((r) => r.kind === kind),
    getResource: (kind: string, name: string) =>
      resourceIndex.get(`${kind}/${name}`),
  };
}

/**
 * YAML 문자열에서 Bundle 로드
 *
 * @param content YAML 문자열
 * @param source 소스 식별자 (오류 메시지용)
 * @returns Bundle 로드 결과
 */
export function loadBundleFromString(
  content: string,
  source = '<string>'
): BundleLoadResult {
  const errors: (BundleError | ParseError | ValidationError | ReferenceError)[] = [];
  let resources: Resource[] = [];

  // 1. YAML 파싱
  try {
    resources = parseMultiDocument(content, source);
  } catch (error) {
    if (error instanceof ParseError) {
      errors.push(error);
    } else if (error instanceof Error) {
      errors.push(new ParseError(error.message, { source, cause: error }));
    } else {
      errors.push(new ParseError('Unknown parse error', { source }));
    }
    return createBundleLoadResult(resources, errors, [source]);
  }

  // 2. 리소스 검증 (Kind별 필수 필드)
  const validationErrors = validateResources(resources);
  errors.push(...validationErrors);

  // 3. 이름 유일성 검증
  const uniquenessErrors = validateNameUniqueness(resources);
  errors.push(...uniquenessErrors);

  // 4. 참조 무결성 검증
  const referenceErrors = resolveAllReferences(resources);
  errors.push(...referenceErrors);

  return createBundleLoadResult(resources, errors, [source]);
}

/**
 * 파일에서 Bundle 로드
 *
 * @param filePath 파일 경로
 * @returns Bundle 로드 결과 (Promise)
 */
export async function loadBundleFromFile(
  filePath: string
): Promise<BundleLoadResult> {
  const errors: (BundleError | ParseError | ValidationError | ReferenceError)[] = [];

  // 파일 존재 확인
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    errors.push(
      new BundleError(`File not found or not readable: ${filePath}`)
    );
    return createBundleLoadResult([], errors, [filePath]);
  }

  // 파일 읽기
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, 'utf-8');
  } catch (error) {
    errors.push(
      new BundleError(
        `Failed to read file: ${filePath}`,
        { cause: error instanceof Error ? error : undefined }
      )
    );
    return createBundleLoadResult([], errors, [filePath]);
  }

  // 문자열 로드
  const result = loadBundleFromString(content, filePath);
  return createBundleLoadResult(
    result.resources,
    result.errors,
    [filePath]
  );
}

/**
 * 디렉토리에서 Bundle 로드
 *
 * Bundle Package 시스템을 지원:
 * 1. package.yaml이 있으면 spec.dependencies를 재귀적으로 해석
 * 2. 로드 순서: 의존성 → 현재 Bundle Package
 * 3. 동일 Kind/name이 중복되면 후순위 로드가 덮어씀
 *
 * @param dirPath 디렉토리 경로
 * @param options 로드 옵션
 * @returns Bundle 로드 결과 (Promise)
 * @see /docs/specs/bundle_package.md 섹션 9
 */
export async function loadBundleFromDirectory(
  dirPath: string,
  options: LoadDirectoryOptions = {}
): Promise<BundleLoadResult> {
  const errors: (BundleError | ParseError | ValidationError | ReferenceError)[] = [];
  const allResources: Resource[] = [];
  const allSources: string[] = [];

  // 디렉토리 존재 확인
  try {
    const stat = await fs.promises.stat(dirPath);
    if (!stat.isDirectory()) {
      errors.push(new BundleError(`Not a directory: ${dirPath}`));
      return createBundleLoadResult([], errors, []);
    }
  } catch {
    errors.push(
      new BundleError(`Directory not found or not accessible: ${dirPath}`)
    );
    return createBundleLoadResult([], errors, []);
  }

  // 1. package.yaml 확인 및 dependency 리소스 로드
  const packageYamlPath = path.join(dirPath, 'package.yaml');
  const manifest = await parsePackageManifest(packageYamlPath);

  if (manifest && manifest.spec.dependencies && manifest.spec.dependencies.length > 0) {
    const loadedPackages = new Set<string>();
    const depResources = await loadDependencyResources(
      dirPath,
      manifest.spec.dependencies,
      loadedPackages,
      errors,
      allSources
    );
    // 의존성 리소스를 먼저 추가 (후순위 로드가 덮어쓰기 위해)
    allResources.push(...depResources);
  }

  // 2. 현재 프로젝트의 YAML 파일 검색
  const pattern = options.pattern ?? '**/*.{yaml,yml}';
  const ignore = options.ignore ?? ['**/node_modules/**', '**/packages.lock.yaml', '**/.goondan/**', '**/package.yaml'];

  let files: string[];
  try {
    files = await fg(pattern, {
      cwd: dirPath,
      ignore,
      absolute: true,
      onlyFiles: true,
    });
  } catch (error) {
    errors.push(
      new BundleError(
        `Failed to search files in directory: ${dirPath}`,
        { cause: error instanceof Error ? error : undefined }
      )
    );
    return createBundleLoadResult([], errors, []);
  }

  // 3. 현재 프로젝트 파일 로드 (검증은 마지막에 한 번만)
  for (const file of files) {
    allSources.push(file);

    let content: string;
    try {
      content = await fs.promises.readFile(file, 'utf-8');
    } catch (error) {
      errors.push(
        new BundleError(
          `Failed to read file: ${file}`,
          { cause: error instanceof Error ? error : undefined }
        )
      );
      continue;
    }

    // YAML 파싱만 수행
    try {
      const resources = parseMultiDocument(content, file);
      allResources.push(...resources);
    } catch (error) {
      if (error instanceof ParseError) {
        errors.push(error);
      } else if (error instanceof Error) {
        errors.push(new ParseError(error.message, { source: file, cause: error }));
      }
    }
  }

  // 4. 리소스 병합 (동일 Kind/name은 후순위가 덮어씀)
  const mergedResources = mergeResources(allResources);

  // 5. 전체 리소스에 대해 검증 수행
  const validationErrors = validateResources(mergedResources);
  errors.push(...validationErrors);

  const uniquenessErrors = validateNameUniqueness(mergedResources);
  errors.push(...uniquenessErrors);

  const referenceErrors = resolveAllReferences(mergedResources);
  errors.push(...referenceErrors);

  return createBundleLoadResult(mergedResources, errors, allSources);
}

/**
 * 리소스 병합: 동일 Kind/name은 후순위가 덮어씀
 * @see /docs/specs/bundle_package.md 섹션 9
 */
function mergeResources(resources: Resource[]): Resource[] {
  const resourceMap = new Map<string, Resource>();

  for (const resource of resources) {
    const key = `${resource.kind}/${resource.metadata.name}`;
    resourceMap.set(key, resource);
  }

  return Array.from(resourceMap.values());
}
