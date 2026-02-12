import { readFile, writeFile } from 'node:fs/promises';
import type { BundleValidator, DiagnosticIssue, ValidationResult } from '../types.js';
import { exists } from '../utils.js';
import { resolveManifestPath } from './path.js';

const supportedKinds = new Set([
  'Model',
  'Agent',
  'Swarm',
  'Tool',
  'Extension',
  'Connector',
  'Connection',
  'Package',
]);

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
        helpUrl: 'https://docs.goondan.io/errors/FILE_NOT_FOUND',
      });
      return { valid: false, errors, warnings };
    }

    let source = await readFile(manifestPath, 'utf8');

    const apiVersionMatches = [...source.matchAll(/^apiVersion:\s*(.+)$/gm)];
    if (apiVersionMatches.length === 0) {
      warnings.push({
        code: 'API_VERSION_MISSING',
        message: 'apiVersion 필드가 없습니다.',
        path: manifestPath,
        suggestion: '각 리소스 문서에 apiVersion: goondan.ai/v1 를 명시하세요.',
        helpUrl: 'https://docs.goondan.io/errors/API_VERSION_MISSING',
      });

      if (fix) {
        source = `apiVersion: goondan.ai/v1\n${source}`;
        await writeFile(manifestPath, source, 'utf8');
      }
    }

    for (const match of apiVersionMatches) {
      const value = match[1]?.trim();
      if (value !== 'goondan.ai/v1') {
        errors.push({
          code: 'API_VERSION_INVALID',
          message: `지원하지 않는 apiVersion 입니다: ${value}`,
          path: manifestPath,
          suggestion: 'apiVersion 값을 goondan.ai/v1 로 변경하세요.',
          helpUrl: 'https://docs.goondan.io/errors/API_VERSION_INVALID',
        });
      }
    }

    const kindMatches = [...source.matchAll(/^kind:\s*([A-Za-z]+)$/gm)];
    if (kindMatches.length === 0) {
      errors.push({
        code: 'KIND_MISSING',
        message: 'kind 필드를 찾을 수 없습니다.',
        path: manifestPath,
        suggestion: '최소 하나 이상의 리소스 kind를 정의하세요.',
        helpUrl: 'https://docs.goondan.io/errors/KIND_MISSING',
      });
    }

    for (const match of kindMatches) {
      const kind = match[1];
      if (!kind) {
        continue;
      }
      if (!supportedKinds.has(kind)) {
        errors.push({
          code: 'KIND_UNSUPPORTED',
          message: `지원하지 않는 kind 입니다: ${kind}`,
          path: manifestPath,
          suggestion: 'Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package 중 하나를 사용하세요.',
          helpUrl: 'https://docs.goondan.io/errors/KIND_UNSUPPORTED',
        });
      }
    }

    const packageDocMatches = [...source.matchAll(/^kind:\s*Package$/gm)];
    if (packageDocMatches.length > 1) {
      errors.push({
        code: 'PKG_DOC_DUPLICATED',
        message: 'Package 문서는 최대 1개여야 합니다.',
        path: manifestPath,
        suggestion: 'kind: Package 문서를 하나만 유지하세요.',
        helpUrl: 'https://docs.goondan.io/errors/PKG_DOC_DUPLICATED',
      });
    }

    const hasSwarm = source.includes('kind: Swarm');
    if (!hasSwarm) {
      warnings.push({
        code: 'SWARM_MISSING',
        message: 'Swarm 리소스를 찾지 못했습니다.',
        path: manifestPath,
        suggestion: '실행 대상 Swarm 리소스를 추가하세요.',
        helpUrl: 'https://docs.goondan.io/errors/SWARM_MISSING',
      });
    }

    if (strict && warnings.length > 0) {
      for (const warning of warnings) {
        errors.push({
          ...warning,
          code: `STRICT_${warning.code}`,
          message: `[strict] ${warning.message}`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
