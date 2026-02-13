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
  const queue: RuntimeEnvFile[] = [];

  if (envFile && envFile.trim().length > 0) {
    queue.push({
      filePath: resolveEnvFilePath(projectRoot, envFile.trim()),
      required: true,
    });
  }

  queue.push(
    {
      filePath: path.join(projectRoot, '.env.local'),
      required: false,
    },
    {
      filePath: path.join(projectRoot, '.env'),
      required: false,
    },
  );

  const deduped = new Set<string>();
  const uniqueQueue: RuntimeEnvFile[] = [];
  for (const item of queue) {
    if (deduped.has(item.filePath)) {
      continue;
    }
    deduped.add(item.filePath);
    uniqueQueue.push(item);
  }

  return uniqueQueue;
}

function mergeDotEnvValues(target: NodeJS.ProcessEnv, parsed: NodeJS.Dict<string>): void {
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] !== undefined || value === undefined) {
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
