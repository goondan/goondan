/**
 * Bundle 로드
 * @see /docs/specs/bundle.md
 */

import * as fs from 'node:fs';
import fg from 'fast-glob';
import { parseMultiDocument } from './parser.js';
import { validateResources, validateNameUniqueness } from './validator.js';
import { resolveAllReferences } from './resolver.js';
import { BundleError, ParseError, ValidationError, ReferenceError } from './errors.js';
import type { Resource } from '../types/index.js';

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
 * @param dirPath 디렉토리 경로
 * @param options 로드 옵션
 * @returns Bundle 로드 결과 (Promise)
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

  // YAML 파일 검색
  const pattern = options.pattern ?? '**/*.{yaml,yml}';
  const ignore = options.ignore ?? ['**/node_modules/**'];

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

  // 각 파일 로드 (검증은 마지막에 한 번만)
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

  // 전체 리소스에 대해 검증 수행
  const validationErrors = validateResources(allResources);
  errors.push(...validationErrors);

  const uniquenessErrors = validateNameUniqueness(allResources);
  errors.push(...uniquenessErrors);

  const referenceErrors = resolveAllReferences(allResources);
  errors.push(...referenceErrors);

  return createBundleLoadResult(allResources, errors, allSources);
}
