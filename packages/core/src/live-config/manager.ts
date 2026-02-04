import fs from 'node:fs/promises';
import path from 'node:path';
import jsonPatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import { LiveConfigStore } from './store.js';
import { deepClone } from '../utils/json.js';
import { deriveWorkspaceId, resolveDir, resolveStateRootDir } from '../utils/state-paths.js';
import type { ConfigRegistry, Resource } from '../config/registry.js';
import type {
  EffectiveConfig,
  EventBus,
  LiveConfigCursor,
  LiveConfigPatchProposal,
  LiveConfigPatchSpec,
  LivePatch,
  LivePatchStatus,
  SwarmSpec,
} from '../sdk/types.js';

const { applyPatch } = jsonPatch;
const DEFAULT_APPLY_AT = ['step.config'];

type LiveConfigPolicy = NonNullable<NonNullable<SwarmSpec['policy']>['liveConfig']>;

interface LiveConfigManagerOptions {
  instanceId: string;
  swarmConfig: Resource;
  registry: ConfigRegistry;
  logger?: Console;
  events?: EventBus | null;
  stateDir?: string;
  writeSnapshots?: boolean;
}

interface AgentState {
  agentConfig: Resource;
  overlay: Resource;
  revision: number;
  cursor: LiveConfigCursor;
  agentStore: LiveConfigStore;
  swarmStore: LiveConfigStore;
}

export class LiveConfigManager {
  instanceId: string;
  swarmConfig: Resource;
  registry: ConfigRegistry;
  logger: Console;
  events: LiveConfigManagerOptions['events'];
  stateDir: string;
  writeSnapshots: boolean;
  agentStates: Map<string, AgentState>;
  swarmState: { overlay: Resource; appliedPatches: Set<string> };
  patchCounters: Map<string, number>;

  constructor(options: LiveConfigManagerOptions) {
    this.instanceId = options.instanceId;
    this.swarmConfig = options.swarmConfig;
    this.registry = options.registry;
    this.logger = options.logger || console;
    this.events = options.events || null;
    const workspaceDir = this.registry?.baseDir || process.cwd();
    this.stateDir = options.stateDir
      ? resolveDir(options.stateDir, workspaceDir)
      : path.join(resolveStateRootDir({ baseDir: workspaceDir }), 'instances', deriveWorkspaceId(workspaceDir));
    this.writeSnapshots = options.writeSnapshots || false;

    this.agentStates = new Map();
    this.swarmState = {
      overlay: deepClone(this.swarmConfig),
      appliedPatches: new Set(),
    };
    this.patchCounters = new Map();
  }

  async initAgent(agentName: string, agentConfig: Resource): Promise<void> {
    if (this.agentStates.has(agentName)) return;

    const instanceStateDir = this.resolveInstanceStateDir();
    const agentRoot = path.join(instanceStateDir, 'agents', agentName, 'live-config');
    const agentStore = new LiveConfigStore({ rootDir: agentRoot, hasStatusLog: true, logger: this.logger });
    await agentStore.ensure();
    await this.ensureLockFile(path.join(agentRoot, '.lock'));

    const swarmRoot = path.join(instanceStateDir, 'swarm', 'live-config');
    const swarmStore = new LiveConfigStore({ rootDir: swarmRoot, hasStatusLog: false, logger: this.logger });
    await swarmStore.ensure();
    await this.ensureLockFile(path.join(swarmRoot, '.lock'));

    const cursor = (await agentStore.readCursor<LiveConfigCursor>()) || {
      version: 1,
      patchLog: { format: 'jsonl' },
      swarmPatchLog: { format: 'jsonl' },
      effective: { revision: 0 },
    };

    const state: AgentState = {
      agentConfig,
      overlay: deepClone(agentConfig),
      revision: cursor.effective?.revision || 0,
      cursor,
      agentStore,
      swarmStore,
    };

    this.agentStates.set(agentName, state);
  }

  async proposePatch(proposal: Partial<LiveConfigPatchProposal>, options: { agentName?: string } = {}): Promise<LivePatch> {
    const agentName = options.agentName;
    if (!agentName) {
      throw new Error('agentName이 필요합니다.');
    }
    const agentState = this.agentStates.get(agentName);
    if (!agentState) {
      throw new Error(`AgentInstance 상태를 찾을 수 없습니다: ${agentName}`);
    }

    const normalized = this.normalizeProposal(proposal, agentName);
    this.validateProposal(normalized);

    const store = normalized.scope === 'swarm' ? agentState.swarmStore : agentState.agentStore;
    const counterKey = `${store.rootDir}:patch`;
    const patchName = await this.nextPatchName(counterKey, store);

    const livePatch: LivePatch = {
      apiVersion: this.swarmConfig.apiVersion || 'agents.example.io/v1alpha1',
      kind: 'LivePatch',
      metadata: { name: patchName },
      spec: {
        ...normalized,
        recordedAt: new Date().toISOString(),
      },
    };

    await store.appendPatch(livePatch);

    await agentState.agentStore.appendStatus({
      patchName,
      agentName,
      result: 'pending',
      evaluatedAt: new Date().toISOString(),
      reason: 'proposed',
    } satisfies LivePatchStatus);

    return livePatch;
  }

  async applyAtSafePoint({
    agentName,
    stepId,
  }: {
    agentName: string;
    stepId: string;
  }): Promise<EffectiveConfig | null> {
    const agentState = this.agentStates.get(agentName);
    if (!agentState) {
      throw new Error(`AgentInstance 상태를 찾을 수 없습니다: ${agentName}`);
    }

    const now = new Date().toISOString();
    const swarmPolicies = this.getLiveConfigPolicy();
    const applyAtAllowed = swarmPolicies.applyAt || DEFAULT_APPLY_AT;

    if (!swarmPolicies.enabled) {
      return this.getEffectiveConfig(agentName);
    }

    await this.applyPatchesFromStore({
      agentName,
      stepId,
      store: agentState.swarmStore,
      scope: 'swarm',
      now,
      applyAtAllowed,
    });

    await this.applyPatchesFromStore({
      agentName,
      stepId,
      store: agentState.agentStore,
      scope: 'agent',
      now,
      applyAtAllowed,
    });

    if (this.writeSnapshots) {
      await agentState.agentStore.writeOverlay(agentState.overlay);
      const effective = this.getEffectiveConfig(agentName);
      if (effective) {
        await agentState.agentStore.writeEffectiveSnapshot(agentState.revision, effective);
      }
    }

    await agentState.agentStore.writeCursor(agentState.cursor);

    return this.getEffectiveConfig(agentName);
  }

  getEffectiveConfig(agentName: string): EffectiveConfig | null {
    const agentState = this.agentStates.get(agentName);
    if (!agentState) return null;
    return {
      swarm: this.swarmState.overlay,
      agent: agentState.overlay,
      revision: agentState.revision,
    };
  }

  async applyPatchesFromStore({
    agentName,
    stepId,
    store,
    scope,
    now,
    applyAtAllowed,
  }: {
    agentName: string;
    stepId: string;
    store: LiveConfigStore;
    scope: 'agent' | 'swarm';
    now: string;
    applyAtAllowed: string[];
  }): Promise<void> {
    const agentState = this.agentStates.get(agentName);
    if (!agentState) return;
    const cursorKey: 'swarmPatchLog' | 'patchLog' = scope === 'swarm' ? 'swarmPatchLog' : 'patchLog';
    const cursor = (agentState.cursor[cursorKey] || { format: 'jsonl' }) as NonNullable<LiveConfigCursor['patchLog']>;
    const patches = await store.readPatches<LivePatch>();
    const newPatches = filterNewPatches(patches, cursor.lastEvaluatedPatchName);

    for (const patch of newPatches) {
      const result = await this.evaluatePatch({
        patch,
        agentName,
        stepId,
        scope,
        applyAtAllowed,
        now,
      });

      cursor.lastEvaluatedPatchName = patch.metadata?.name;
      if (result.applied) {
        cursor.lastAppliedPatchName = patch.metadata?.name;
        agentState.cursor.effective = {
          revision: agentState.revision,
          lastAppliedAt: result.appliedAt,
        };
      }

      agentState.cursor[cursorKey] = cursor;
      await agentState.agentStore.appendStatus(result.status);
    }
  }

  async evaluatePatch({
    patch,
    agentName,
    stepId,
    scope,
    applyAtAllowed,
    now,
  }: {
    patch: LivePatch;
    agentName: string;
    stepId: string;
    scope: 'agent' | 'swarm';
    applyAtAllowed: string[];
    now: string;
  }): Promise<{ applied: boolean; status: LivePatchStatus; appliedAt?: string }> {
    const agentState = this.agentStates.get(agentName);
    const status: LivePatchStatus = {
      patchName: patch.metadata?.name,
      agentName,
      result: 'pending',
      evaluatedAt: now,
      reason: 'pending',
    };

    if (!patch?.spec) {
      status.result = 'failed';
      status.reason = 'invalidPatch';
      return { applied: false, status };
    }

    if (patch.spec.scope !== scope) {
      status.result = 'pending';
      status.reason = 'scopeMismatch';
      return { applied: false, status };
    }

    if (!applyAtAllowed.includes(patch.spec.applyAt)) {
      status.result = 'rejected';
      status.reason = 'applyAtNotAllowed';
      return { applied: false, status };
    }

    if (scope === 'agent') {
      const target = patch.spec.target;
      if (target && target.name && target.name !== agentName) {
        status.result = 'pending';
        status.reason = 'targetNotFound';
        return { applied: false, status };
      }
    }

    if (scope === 'swarm') {
      const target = patch.spec.target;
      const swarmName = this.swarmConfig.metadata?.name;
      if (target && target.name && target.name !== swarmName) {
        status.result = 'pending';
        status.reason = 'targetNotFound';
        return { applied: false, status };
      }
      if (this.swarmState.appliedPatches.has(patch.metadata?.name)) {
        status.result = 'applied';
        status.reason = 'alreadyApplied';
        status.appliedAt = now;
        status.appliedInStepId = stepId;
        status.effectiveRevision = agentState?.revision;
        return { applied: true, status, appliedAt: now };
      }
    }

    if (!agentState) {
      status.result = 'failed';
      status.reason = 'agentStateMissing';
      return { applied: false, status };
    }

    const allowed = this.isPatchAllowed(scope, patch, agentState.agentConfig);
    if (!allowed) {
      status.result = 'rejected';
      status.reason = 'pathNotAllowed';
      return { applied: false, status };
    }

    try {
      if (scope === 'agent') {
        applyPatch(agentState.overlay, patch.spec.patch.ops as Operation[], true, true);
      } else {
        applyPatch(this.swarmState.overlay, patch.spec.patch.ops as Operation[], true, true);
        this.swarmState.appliedPatches.add(patch.metadata?.name);
      }
      agentState.revision += 1;
    } catch (err) {
      status.result = 'failed';
      status.reason = `applyError:${(err as Error).message}`;
      return { applied: false, status };
    }

    status.result = 'applied';
    status.appliedAt = now;
    status.appliedInStepId = stepId;
    status.effectiveRevision = agentState.revision;
    status.reason = 'ok';

    if (this.getLiveConfigPolicy().emitConfigChangedEvent) {
      this.events?.emit?.('liveConfig.changed', {
        patch,
        agentName,
        scope,
      });
    }

    return { applied: true, status, appliedAt: now };
  }

  normalizeProposal(proposal: Partial<LiveConfigPatchProposal>, agentName: string): LiveConfigPatchProposal {
    const scope = proposal.scope || 'agent';
    const target =
      proposal.target ||
      (scope === 'agent'
        ? { kind: 'AgentInstance', name: agentName }
        : { kind: 'SwarmInstance', name: this.swarmConfig.metadata?.name });

    return {
      scope,
      target,
      applyAt: proposal.applyAt || 'step.config',
      patch: proposal.patch as LiveConfigPatchSpec,
      source: proposal.source || { type: 'system', name: 'runtime' },
      reason: proposal.reason || '',
    };
  }

  validateProposal(proposal: LiveConfigPatchProposal): void {
    if (!proposal.patch || proposal.patch.type !== 'json6902') {
      throw new Error('proposal.patch.type은 json6902이어야 합니다.');
    }
    if (!Array.isArray(proposal.patch.ops)) {
      throw new Error('proposal.patch.ops는 배열이어야 합니다.');
    }
    const sourceType = proposal.source?.type ?? 'system';
    if (!['tool', 'extension', 'sidecar', 'system'].includes(sourceType)) {
      throw new Error('proposal.source.type이 허용되지 않습니다.');
    }
  }

  getLiveConfigPolicy(): LiveConfigPolicy {
    return ((this.swarmConfig?.spec as { policy?: { liveConfig?: LiveConfigPolicy } })?.policy?.liveConfig || {}) as LiveConfigPolicy;
  }

  isPatchAllowed(scope: 'agent' | 'swarm', patch: LivePatch, agentConfig: Resource): boolean {
    const policy = this.getLiveConfigPolicy();
    if (!policy.enabled) return false;

    const allowed = scope === 'swarm'
      ? policy.allowedPaths?.swarmAbsolute
      : policy.allowedPaths?.agentRelative;

    const agentAllowed =
      scope === 'agent'
        ? (agentConfig?.spec as { liveConfig?: { allowedPaths?: { agentRelative?: string[] } } })?.liveConfig
            ?.allowedPaths?.agentRelative
        : null;

    for (const op of patch.spec.patch.ops) {
      const paths = [op.path, op.from].filter((value): value is string => typeof value === 'string');
      for (const opPath of paths) {
        if (!isPathAllowed(opPath, allowed)) return false;
        if (agentAllowed && !isPathAllowed(opPath, agentAllowed)) return false;
      }
    }
    return true;
  }

  resolveInstanceStateDir(): string {
    return path.join(this.stateDir, this.instanceId);
  }

  async nextPatchName(counterKey: string, store: LiveConfigStore): Promise<string> {
    if (!this.patchCounters.has(counterKey)) {
      const last = await store.readLastPatch<LivePatch>();
      const lastNum = last?.metadata?.name ? parsePatchNumber(last.metadata.name) : 0;
      this.patchCounters.set(counterKey, lastNum);
    }
    const next = (this.patchCounters.get(counterKey) || 0) + 1;
    this.patchCounters.set(counterKey, next);
    return `p-${String(next).padStart(6, '0')}`;
  }

  private async ensureLockFile(lockPath: string): Promise<void> {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
        const stale = await isStaleLock(lockPath);
        if (stale) {
          await fs.unlink(lockPath).catch(() => undefined);
          return this.ensureLockFile(lockPath);
        }
        this.logger.warn(`LiveConfig lock 이미 존재: ${lockPath}`);
        return;
      }
      throw err;
    }
  }
}

function parsePatchNumber(name: string): number {
  const match = /p-(\d+)/.exec(name);
  if (!match) return 0;
  const value = match[1];
  if (!value) return 0;
  return Number.parseInt(value, 10) || 0;
}

function filterNewPatches(patches: LivePatch[], lastEvaluatedPatchName?: string): LivePatch[] {
  if (!lastEvaluatedPatchName) return patches;
  const idx = patches.findIndex((patch) => patch.metadata?.name === lastEvaluatedPatchName);
  if (idx === -1) return patches;
  return patches.slice(idx + 1);
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  const content = await fs.readFile(lockPath, 'utf8').catch(() => null);
  if (!content) return true;
  const pid = Number.parseInt(content.trim(), 10);
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ESRCH') {
      return true;
    }
    return false;
  }
}

function isPathAllowed(pathValue: string, allowedPaths?: string[] | string): boolean {
  if (!allowedPaths) return true;
  const list = Array.isArray(allowedPaths) ? allowedPaths : [allowedPaths];
  if (list.length === 0) return true;
  return list.some((allowed) => pathValue === allowed || pathValue.startsWith(`${allowed}/`));
}
