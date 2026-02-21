import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { configError } from '../errors.js';
import { exists } from '../utils.js';

interface RuntimeEnvFile {
  filePath: string;
  required: boolean;
}

interface LoadRuntimeEnvInput {
  projectRoot: string;
  envFile?: string;
}

function resolveEnvFilePath(projectRoot: string, inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  return path.resolve(projectRoot, inputPath);
}

function buildEnvFileQueue(projectRoot: string, envFile: string | undefined): RuntimeEnvFile[] {
  // Precedence (higher wins):
  //   --env-file > .env.local > .env > system env
  // Implementation strategy:
  //   - Start from system env
  //   - Apply low-precedence dotenv files first, then override upward
  const queue: RuntimeEnvFile[] = [
    {
      filePath: path.join(projectRoot, '.env'),
      required: false,
    },
    {
      filePath: path.join(projectRoot, '.env.local'),
      required: false,
    },
  ];

  if (envFile && envFile.trim().length > 0) {
    queue.push({
      filePath: resolveEnvFilePath(projectRoot, envFile.trim()),
      required: true,
    });
  }

  // Dedupe while keeping the last occurrence (so a user-provided --env-file
  // can replace the default path and still be treated as required).
  const byPath = new Map<string, RuntimeEnvFile>();
  for (const item of queue) {
    byPath.set(item.filePath, item);
  }

  return [...byPath.values()];
}

function mergeDotEnvValues(target: NodeJS.ProcessEnv, parsed: NodeJS.Dict<string>): void {
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) {
      continue;
    }

    target[key] = value;
  }
}

export async function loadRuntimeEnv(baseEnv: NodeJS.ProcessEnv, input: LoadRuntimeEnvInput): Promise<NodeJS.ProcessEnv> {
  const mergedEnv: NodeJS.ProcessEnv = { ...baseEnv };
  const envFiles = buildEnvFileQueue(input.projectRoot, input.envFile);

  for (const envFile of envFiles) {
    const fileExists = await exists(envFile.filePath);
    if (!fileExists) {
      if (envFile.required) {
        throw configError(`--env-file로 지정한 파일을 찾을 수 없습니다: ${envFile.filePath}`, '파일 경로를 확인하세요.');
      }
      continue;
    }

    let rawContent: string;
    try {
      rawContent = await readFile(envFile.filePath, 'utf8');
    } catch {
      throw configError(`환경 변수 파일을 읽지 못했습니다: ${envFile.filePath}`, '파일 접근 권한과 경로를 확인하세요.');
    }

    let parsed: NodeJS.Dict<string>;
    try {
      parsed = parseEnv(rawContent);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '알 수 없는 오류';
      throw configError(
        `환경 변수 파일 파싱 실패: ${envFile.filePath} (${reason})`,
        'KEY=VALUE 형식인지 확인하세요.',
      );
    }

    mergeDotEnvValues(mergedEnv, parsed);
  }

  return mergedEnv;
}
