import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { configError } from '../errors.js';
import type {
  RuntimeController,
  RuntimeRestartRequest,
  RuntimeRestartResult,
  RuntimeStartRequest,
  RuntimeStartResult,
} from '../types.js';
import { exists, isObjectRecord } from '../utils.js';
import { resolveStateRoot } from './config.js';
import { resolveManifestPath } from './path.js';

interface RuntimeStateFile {
  instanceKey: string;
  bundlePath: string;
  startedAt: string;
  watch: boolean;
}

function parseRuntimeState(raw: string): RuntimeStateFile | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return undefined;
    }

    const instanceKey = parsed['instanceKey'];
    const bundlePath = parsed['bundlePath'];
    const startedAt = parsed['startedAt'];
    const watch = parsed['watch'];

    if (
      typeof instanceKey === 'string' &&
      typeof bundlePath === 'string' &&
      typeof startedAt === 'string' &&
      typeof watch === 'boolean'
    ) {
      return {
        instanceKey,
        bundlePath,
        startedAt,
        watch,
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export class LocalRuntimeController implements RuntimeController {
  private readonly cwd: string;

  private readonly env: NodeJS.ProcessEnv;

  constructor(cwd: string, env: NodeJS.ProcessEnv) {
    this.cwd = cwd;
    this.env = env;
  }

  async startOrchestrator(request: RuntimeStartRequest): Promise<RuntimeStartResult> {
    const manifestPath = resolveManifestPath(this.cwd, request.bundlePath);
    const hasManifest = await exists(manifestPath);
    if (!hasManifest) {
      throw configError(`Bundle 파일을 찾을 수 없습니다: ${manifestPath}`, '올바른 bundle 경로를 지정하세요.');
    }

    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const runtimeDir = path.join(stateRoot, 'runtime');
    await mkdir(runtimeDir, { recursive: true });

    const instanceKey = request.instanceKey ?? `instance-${Date.now()}`;
    const state: RuntimeStateFile = {
      instanceKey,
      bundlePath: manifestPath,
      startedAt: new Date().toISOString(),
      watch: request.watch,
    };

    await writeFile(path.join(runtimeDir, 'active.json'), JSON.stringify(state, null, 2), 'utf8');

    return {
      instanceKey,
      pid: process.pid,
    };
  }

  async restart(request: RuntimeRestartRequest): Promise<RuntimeRestartResult> {
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const activePath = path.join(stateRoot, 'runtime', 'active.json');
    const hasActive = await exists(activePath);
    if (!hasActive) {
      throw configError('실행 중인 Orchestrator를 찾지 못했습니다.', '먼저 gdn run으로 Orchestrator를 시작하세요.');
    }

    const raw = await readFile(activePath, 'utf8');
    const state = parseRuntimeState(raw);

    if (!state) {
      throw configError('런타임 상태 파일이 손상되었습니다.', 'state-root/runtime/active.json을 정리한 뒤 다시 실행하세요.');
    }

    const restarted = request.agent ? [request.agent] : ['all'];
    const refreshedState: RuntimeStateFile = {
      ...state,
      startedAt: new Date().toISOString(),
    };

    await writeFile(activePath, JSON.stringify(refreshedState, null, 2), 'utf8');

    return { restarted };
  }
}
