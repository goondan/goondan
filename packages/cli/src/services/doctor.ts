import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { BundleValidator, DoctorCheck, DoctorReport, DoctorService } from '../types.js';
import { exists, isObjectRecord } from '../utils.js';
import { resolveStateRoot } from './config.js';
import { resolveManifestPath } from './path.js';

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  return result.status === 0;
}

async function readPackageVersion(packageJsonPath: string): Promise<string | undefined> {
  const found = await exists(packageJsonPath);
  if (!found) {
    return undefined;
  }

  const raw = await readFile(packageJsonPath, 'utf8');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return undefined;
    }

    const version = parsed['version'];
    if (typeof version === 'string') {
      return version;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export class DefaultDoctorService implements DoctorService {
  private readonly cwd: string;

  private readonly env: NodeJS.ProcessEnv;

  private readonly validator: BundleValidator;

  constructor(cwd: string, env: NodeJS.ProcessEnv, validator: BundleValidator) {
    this.cwd = cwd;
    this.env = env;
    this.validator = validator;
  }

  async run(bundlePath: string, _fix: boolean, stateRootInput?: string): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];

    if (commandExists('bun')) {
      checks.push({
        category: 'System',
        name: 'Bun',
        level: 'ok',
        detail: 'bun is installed',
      });
    } else {
      checks.push({
        category: 'System',
        name: 'Bun',
        level: 'fail',
        detail: 'bun is not installed',
        suggestion: 'https://bun.sh 에서 설치하세요.',
      });
    }

    checks.push({
      category: 'System',
      name: 'pnpm',
      level: commandExists('pnpm') ? 'ok' : 'warn',
      detail: commandExists('pnpm') ? 'pnpm is installed' : 'pnpm not found',
      suggestion: commandExists('pnpm') ? undefined : 'pnpm 사용 시 설치가 필요합니다.',
    });

    const keyMap = [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GOOGLE_GENERATIVE_AI_API_KEY',
    ];

    for (const key of keyMap) {
      const value = this.env[key];
      if (value && value.length > 0) {
        checks.push({
          category: 'API Keys',
          name: key,
          level: 'ok',
          detail: `${key} is set`,
        });
      } else {
        checks.push({
          category: 'API Keys',
          name: key,
          level: 'warn',
          detail: `${key} is not set`,
          suggestion: `필요 시 export ${key}=... 로 설정하세요.`,
        });
      }
    }

    const cliVersion = await readPackageVersion(path.join(this.cwd, 'package.json'));
    checks.push({
      category: 'Goondan Packages',
      name: '@goondan/cli',
      level: cliVersion ? 'ok' : 'warn',
      detail: cliVersion ? `@goondan/cli@${cliVersion}` : 'version unknown',
    });

    const stateRoot = resolveStateRoot(stateRootInput, this.env);
    checks.push({
      category: 'Project',
      name: 'State Root',
      level: 'ok',
      detail: stateRoot,
    });

    const manifestPath = resolveManifestPath(this.cwd, bundlePath);
    const hasManifest = await exists(manifestPath);
    if (!hasManifest) {
      checks.push({
        category: 'Project',
        name: 'Bundle Config',
        level: 'warn',
        detail: `missing: ${manifestPath}`,
        suggestion: 'goondan.yaml 파일을 생성하거나 --config 경로를 지정하세요.',
      });
    } else {
      checks.push({
        category: 'Project',
        name: 'Bundle Config',
        level: 'ok',
        detail: `found: ${manifestPath}`,
      });

      const validation = await this.validator.validate(manifestPath, false, false);
      checks.push({
        category: 'Project',
        name: 'Bundle Validation',
        level: validation.valid ? 'ok' : 'fail',
        detail: validation.valid
          ? `valid (${validation.warnings.length} warnings)`
          : `invalid (${validation.errors.length} errors, ${validation.warnings.length} warnings)`,
        suggestion: validation.valid ? undefined : 'gdn validate --format json 으로 상세 오류를 확인하세요.',
      });
    }

    let passed = 0;
    let warnings = 0;
    let errors = 0;

    for (const check of checks) {
      if (check.level === 'ok') {
        passed += 1;
      } else if (check.level === 'warn') {
        warnings += 1;
      } else {
        errors += 1;
      }
    }

    return {
      checks,
      passed,
      warnings,
      errors,
    };
  }
}
