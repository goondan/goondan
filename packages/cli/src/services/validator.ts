import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  BundleLoader,
  isJsonObject,
  parseYamlDocument,
  splitYamlDocuments,
  type ValidationError,
} from '@goondan/runtime';
import type { BundleValidator, DiagnosticIssue, ValidationResult } from '../types.js';
import { exists } from '../utils.js';
import { resolveManifestPath } from './path.js';

const ERROR_HELP_BASE_URL = 'https://docs.goondan.io/errors';

interface ApiVersionFixResult {
  applied: boolean;
  fixedCount: number;
}

export class DefaultBundleValidator implements BundleValidator {
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async validate(pathOrFile: string, strict: boolean, fix: boolean): Promise<ValidationResult> {
    const manifestPath = resolveManifestPath(this.cwd, pathOrFile);
    const errors: DiagnosticIssue[] = [];
    const warnings: DiagnosticIssue[] = [];

    const hasManifest = await exists(manifestPath);
    if (!hasManifest) {
      errors.push({
        code: 'FILE_NOT_FOUND',
        message: 'Bundle 파일을 찾을 수 없습니다.',
        path: manifestPath,
        suggestion: 'goondan.yaml 경로를 확인하거나 파일을 생성하세요.',
        helpUrl: `${ERROR_HELP_BASE_URL}/FILE_NOT_FOUND`,
      });
      return { valid: false, errors, warnings };
    }

    if (fix) {
      const fixResult = await tryFixMissingApiVersion(manifestPath);
      if (fixResult.applied) {
        warnings.push({
          code: 'API_VERSION_FIXED',
          message: `apiVersion 누락 문서 ${fixResult.fixedCount}개를 자동 수정했습니다.`,
          path: manifestPath,
          suggestion: '변경된 내용을 검토하고 필요 시 세부 필드를 정리하세요.',
          helpUrl: `${ERROR_HELP_BASE_URL}/API_VERSION_FIXED`,
        });
      }
    }

    const bundleDir = path.dirname(manifestPath);
    const loader = new BundleLoader();
    const loaded = await loader.load(bundleDir);
    errors.push(...loaded.errors.map((error) => toDiagnosticIssue(error)));

    if (loaded.resources.length === 0) {
      errors.push({
        code: 'KIND_MISSING',
        message: 'kind 필드를 가진 리소스 문서를 찾을 수 없습니다.',
        path: manifestPath,
        suggestion: '최소 하나 이상의 리소스 문서를 정의하세요.',
        helpUrl: `${ERROR_HELP_BASE_URL}/KIND_MISSING`,
      });
    }

    if (!loaded.resources.some((resource) => resource.kind === 'Swarm')) {
      warnings.push({
        code: 'SWARM_MISSING',
        message: 'Swarm 리소스를 찾지 못했습니다.',
        path: manifestPath,
        suggestion: '실행 대상 Swarm 리소스를 추가하세요.',
        helpUrl: `${ERROR_HELP_BASE_URL}/SWARM_MISSING`,
      });
    }

    if (strict && warnings.length > 0) {
      warnings.forEach((warning) => {
        errors.push({
          ...warning,
          code: `STRICT_${warning.code}`,
          message: `[strict] ${warning.message}`,
        });
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

function toDiagnosticIssue(error: ValidationError): DiagnosticIssue {
  return {
    code: error.code,
    message: error.message,
    path: error.path,
    suggestion: error.suggestion,
    helpUrl: error.helpUrl ?? `${ERROR_HELP_BASE_URL}/${error.code}`,
  };
}

async function tryFixMissingApiVersion(manifestPath: string): Promise<ApiVersionFixResult> {
  const source = await readFile(manifestPath, 'utf8');
  const docs = splitYamlDocuments(source);
  if (docs.length === 0) {
    return { applied: false, fixedCount: 0 };
  }

  let fixedCount = 0;
  const fixedDocs = docs.map((doc) => {
    const trimmed = doc.trim();
    if (trimmed.length === 0) {
      return doc;
    }

    try {
      const parsed = parseYamlDocument(doc);
      if (!isJsonObject(parsed)) {
        return doc;
      }

      const hasKind = typeof parsed.kind === 'string' && parsed.kind.trim().length > 0;
      const hasApiVersion = typeof parsed.apiVersion === 'string' && parsed.apiVersion.trim().length > 0;
      if (!hasKind || hasApiVersion) {
        return doc;
      }

      fixedCount += 1;
      return `apiVersion: goondan.ai/v1\n${doc}`;
    } catch {
      return doc;
    }
  });

  if (fixedCount === 0) {
    return { applied: false, fixedCount: 0 };
  }

  const serialized = fixedDocs.join('\n---\n');
  const output = serialized.endsWith('\n') ? serialized : `${serialized}\n`;
  await writeFile(manifestPath, output, 'utf8');

  return {
    applied: true,
    fixedCount,
  };
}
