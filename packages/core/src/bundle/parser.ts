/**
 * Bundle YAML 파싱
 * @see /docs/specs/bundle.md - 1. 공통 규칙
 */

import { parseAllDocuments, parseDocument, YAMLError } from 'yaml';
import { ParseError } from './errors.js';
import type { Resource } from '../types/index.js';

/**
 * 기본 apiVersion
 * apiVersion이 생략된 경우 사용됨
 */
export const DEFAULT_API_VERSION = 'agents.example.io/v1alpha1';

/**
 * 단일 YAML 문서 파싱
 *
 * @param content YAML 문자열
 * @param source 소스 파일 경로 (오류 메시지용)
 * @returns 파싱된 객체 또는 null (빈 문서)
 * @throws ParseError YAML 문법 오류 시
 */
export function parseYaml(
  content: string,
  source?: string
): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const doc = parseDocument(content);

    if (doc.errors.length > 0) {
      const firstError = doc.errors[0];
      if (firstError) {
        throw new ParseError(firstError.message, {
          source,
          line: getLineFromError(firstError),
          column: getColumnFromError(firstError),
        });
      }
    }

    const result = doc.toJS();
    if (result === null || result === undefined) {
      return null;
    }

    return result;
  } catch (error) {
    if (error instanceof ParseError) {
      throw error;
    }
    if (error instanceof YAMLError) {
      throw new ParseError(error.message, {
        source,
        cause: error,
      });
    }
    throw new ParseError(
      error instanceof Error ? error.message : 'Unknown parse error',
      { source, cause: error instanceof Error ? error : undefined }
    );
  }
}

/**
 * 다중 YAML 문서 파싱 (--- 구분자)
 *
 * @param content YAML 문자열 (다중 문서 가능)
 * @param source 소스 파일 경로 (오류 메시지용)
 * @returns 파싱된 Resource 배열
 * @throws ParseError YAML 문법 오류 시
 */
export function parseMultiDocument(
  content: string,
  source?: string
): Resource[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const documents = parseAllDocuments(content);
    const resources: Resource[] = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      if (!doc) continue;

      // 파싱 오류 확인
      if (doc.errors.length > 0) {
        const firstError = doc.errors[0];
        if (firstError) {
          throw new ParseError(firstError.message, {
            source,
            documentIndex: i,
            line: getLineFromError(firstError),
            column: getColumnFromError(firstError),
          });
        }
      }

      const parsed = doc.toJS();

      // 빈 문서는 건너뜀
      if (parsed === null || parsed === undefined) {
        continue;
      }

      // 객체가 아닌 경우 건너뜀
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }

      // apiVersion 기본값 적용
      const resource = applyDefaults(parsed);
      resources.push(resource);
    }

    return resources;
  } catch (error) {
    if (error instanceof ParseError) {
      throw error;
    }
    if (error instanceof YAMLError) {
      throw new ParseError(error.message, {
        source,
        cause: error,
      });
    }
    throw new ParseError(
      error instanceof Error ? error.message : 'Unknown parse error',
      { source, cause: error instanceof Error ? error : undefined }
    );
  }
}

/**
 * 리소스에 기본값 적용
 *
 * @param parsed 파싱된 객체
 * @returns 기본값이 적용된 Resource
 */
function applyDefaults(parsed: Record<string, unknown>): Resource {
  // apiVersion 기본값 적용
  const apiVersion =
    typeof parsed.apiVersion === 'string'
      ? parsed.apiVersion
      : DEFAULT_API_VERSION;

  // kind 추출
  const kind =
    typeof parsed.kind === 'string' ? parsed.kind : '';

  // metadata 추출 및 정규화
  const rawMetadata = parsed.metadata;
  const metadata =
    rawMetadata !== null &&
    typeof rawMetadata === 'object' &&
    !Array.isArray(rawMetadata)
      ? normalizeMetadata(rawMetadata as Record<string, unknown>)
      : { name: '' };

  // spec 추출
  const spec =
    parsed.spec !== null &&
    typeof parsed.spec === 'object' &&
    !Array.isArray(parsed.spec)
      ? (parsed.spec as Record<string, unknown>)
      : {};

  return {
    apiVersion,
    kind,
    metadata,
    spec,
  };
}

/**
 * metadata 정규화
 */
function normalizeMetadata(
  raw: Record<string, unknown>
): Resource['metadata'] {
  const name = typeof raw.name === 'string' ? raw.name : '';

  const metadata: Resource['metadata'] = { name };

  // labels
  if (
    raw.labels !== null &&
    typeof raw.labels === 'object' &&
    !Array.isArray(raw.labels)
  ) {
    metadata.labels = raw.labels as Record<string, string>;
  }

  // annotations
  if (
    raw.annotations !== null &&
    typeof raw.annotations === 'object' &&
    !Array.isArray(raw.annotations)
  ) {
    metadata.annotations = raw.annotations as Record<string, string>;
  }

  // namespace
  if (typeof raw.namespace === 'string') {
    metadata.namespace = raw.namespace;
  }

  return metadata;
}

/**
 * YAMLError에서 라인 번호 추출
 */
function getLineFromError(error: YAMLError): number | undefined {
  if (error.linePos && error.linePos.length > 0 && error.linePos[0]) {
    return error.linePos[0].line;
  }
  return undefined;
}

/**
 * YAMLError에서 컬럼 번호 추출
 */
function getColumnFromError(error: YAMLError): number | undefined {
  if (error.linePos && error.linePos.length > 0 && error.linePos[0]) {
    return error.linePos[0].col;
  }
  return undefined;
}
