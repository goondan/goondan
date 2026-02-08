/**
 * gdn run command
 *
 * Runs a Swarm with the specified options.
 * Bundle을 로드하고 실제 런타임(LLM 호출 + Tool 실행)을 연결하여 대화형 실행합니다.
 *
 * @see /docs/specs/cli.md - Section 4 (gdn run)
 * @see /docs/specs/runtime.md - 실행 모델
 */

import { Command, Option } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { parse as parseYaml } from "yaml";
import chalk from "chalk";
import ora from "ora";
import {
  loadBundleFromDirectory,
  type BundleLoadResult,
  createEffectiveConfigLoader,
  createStepRunner,
  createTurnRunner,
  createSwarmInstanceManager,
  createAgentInstance,
  createAgentEvent,
  createEventBus,
  ExtensionLoader,
  isLlmAssistantMessage,
  SwarmBundleManagerImpl,
  createSwarmBundleApi,
  resolveGoondanHome,
  generateWorkspaceId,
  generateInstanceId,
  WorkspaceManager,
} from "@goondan/core";
import type {
  TurnRunner,
  Turn,
  AgentInstance,
  SwarmBundleApi,
  ChangesetPolicy,
  OpenChangesetInput,
  CommitChangesetInput,
  StateStore,
} from "@goondan/core";
import { info, success, warn, error as logError, debug } from "../utils/logger.js";
import { ExitCode } from "../types.js";
import { createBundleLoaderImpl } from "../runtime/bundle-loader-impl.js";
import { createLlmCallerImpl } from "../runtime/llm-caller-impl.js";
import {
  createToolExecutorImpl,
  isRevisionedToolExecutor,
} from "../runtime/tool-executor-impl.js";
import type { RevisionedToolExecutor } from "../runtime/tool-executor-impl.js";
import { detectConnections, createConnectorRunner } from "../runtime/connector-runner.js";
import type { ConnectorRunner } from "../runtime/connector-runner.js";
import type { RuntimeContext, ProcessConnectorTurnResult, RevisionState } from "../runtime/types.js";

/**
 * Run command options
 */
export interface RunOptions {
  /** Swarm name to run */
  swarm: string;
  /** Connector to use */
  connector?: string;
  /** Instance key */
  instanceKey?: string;
  /** Initial input message */
  input?: string;
  /** Input from file */
  inputFile?: string;
  /** Interactive mode */
  interactive: boolean;
  /** Watch mode for file changes */
  watch: boolean;
  /** HTTP server port */
  port?: number;
  /** Skip dependency installation */
  noInstall: boolean;
  /** Bundle configuration path override (from global --config) */
  configPath?: string;
  /** System state root override (from global --state-root) */
  stateRoot?: string;
}

/**
 * Configuration file names to look for
 */
const CONFIG_FILE_NAMES = ["goondan.yaml", "goondan.yml"];

/**
 * Find the bundle configuration file
 */
async function findBundleConfig(startDir: string): Promise<string | null> {
  const currentDir = path.resolve(startDir);

  // Check for config file in current directory
  for (const configName of CONFIG_FILE_NAMES) {
    const configPath = path.join(currentDir, configName);
    try {
      await fs.promises.access(configPath, fs.constants.R_OK);
      return configPath;
    } catch {
      // File not found, continue
    }
  }

  return null;
}

/**
 * Resolve bundle configuration path with optional global override.
 *
 * - If override points to a file, use it directly.
 * - If override points to a directory, look for goondan.yaml/goondan.yml inside it.
 * - If no override is provided, look in current working directory.
 */
async function resolveBundleConfigPath(
  configPathOverride?: string,
): Promise<string | null> {
  if (!configPathOverride) {
    return findBundleConfig(process.cwd());
  }

  const resolvedPath = path.resolve(process.cwd(), configPathOverride);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolvedPath);
  } catch {
    return null;
  }

  if (stat.isDirectory()) {
    return findBundleConfig(resolvedPath);
  }

  try {
    await fs.promises.access(resolvedPath, fs.constants.R_OK);
    return resolvedPath;
  } catch {
    return null;
  }
}

/**
 * Load and validate the bundle
 */
async function loadBundle(configPath: string): Promise<BundleLoadResult> {
  const stat = await fs.promises.stat(configPath);

  if (stat.isDirectory()) {
    return loadBundleFromDirectory(configPath);
  }

  // 파일인 경우 해당 디렉토리에서 로드 (goondan.yaml 내 Package 의존성 포함)
  return loadBundleFromDirectory(path.dirname(configPath));
}

/**
 * Display bundle information
 */
function displayBundleInfo(
  result: BundleLoadResult,
  swarmName: string,
  options: RunOptions
): void {
  console.log();
  console.log(chalk.bold("Configuration:"));
  console.log(chalk.gray(`  Swarm: ${chalk.cyan(swarmName)}`));

  if (options.connector) {
    console.log(chalk.gray(`  Connector: ${chalk.cyan(options.connector)}`));
  }

  if (options.instanceKey) {
    console.log(chalk.gray(`  Instance Key: ${chalk.cyan(options.instanceKey)}`));
  }

  console.log(chalk.gray(`  Interactive: ${options.interactive ? "yes" : "no"}`));

  if (options.watch) {
    console.log(chalk.gray(`  Watch Mode: enabled`));
  }

  if (options.port) {
    console.log(chalk.gray(`  Port: ${options.port}`));
  }

  // Display resource counts
  const resourceCounts: Record<string, number> = {};
  for (const resource of result.resources) {
    const count = resourceCounts[resource.kind] ?? 0;
    resourceCounts[resource.kind] = count + 1;
  }

  console.log();
  console.log(chalk.bold("Resources loaded:"));
  for (const kind of Object.keys(resourceCounts)) {
    console.log(chalk.gray(`  ${kind}: ${resourceCounts[kind]}`));
  }
  console.log();
}

/**
 * Display validation errors/warnings
 */
function displayValidationResults(result: BundleLoadResult): void {
  const errors = result.errors.filter((e) => {
    // Filter out warnings for error count
    if ("level" in e && e.level === "warning") {
      return false;
    }
    return true;
  });

  const warnings = result.errors.filter((e) => {
    if ("level" in e && e.level === "warning") {
      return true;
    }
    return false;
  });

  if (warnings.length > 0) {
    console.log(chalk.yellow.bold("Warnings:"));
    for (const w of warnings) {
      warn(`  ${w.message}`);
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log(chalk.red.bold("Errors:"));
    for (const e of errors) {
      logError(`  ${e.message}`);
    }
    console.log();
  }
}

/**
 * Read input from file
 */
async function readInputFile(filePath: string): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  return fs.promises.readFile(resolvedPath, "utf-8");
}

/**
 * ObjectRefLike에서 name 추출
 */
function resolveRefName(ref: unknown): string {
  if (typeof ref === "string") {
    const parts = ref.split("/");
    if (parts.length === 2 && parts[1]) {
      return parts[1];
    }
    return ref;
  }
  if (isObjectWithKey(ref, "name") && typeof ref.name === "string") {
    return ref.name;
  }
  return "default";
}

/**
 * 타입 가드: object이고 특정 key를 갖는지 확인
 */
function isObjectWithKey<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

/**
 * SwarmSpec에서 policy 값을 타입 안전하게 추출
 */
function getSwarmPolicyValue(
  spec: unknown,
  key: string,
  defaultValue: number,
): number {
  if (!isObjectWithKey(spec, "policy")) return defaultValue;
  const policy = spec.policy;
  if (!isObjectWithKey(policy, key)) return defaultValue;
  const value = policy[key];
  return typeof value === "number" ? value : defaultValue;
}

/**
 * SwarmSpec에서 entrypoint를 타입 안전하게 추출
 */
function getSwarmEntrypoint(spec: unknown): unknown {
  if (!isObjectWithKey(spec, "entrypoint")) return undefined;
  return spec.entrypoint;
}


/**
 * normalize swarm bundle ref
 */
function normalizeSwarmBundleRef(ref: string | undefined): string {
  const trimmed = ref?.trim();
  if (!trimmed) {
    return "default";
  }
  return trimmed;
}

/**
 * 새로운 ref를 pending으로 등록
 */
function queuePendingRef(state: RevisionState, ref: string | undefined): void {
  const normalizedRef = normalizeSwarmBundleRef(ref);
  if (normalizedRef === state.activeRef) {
    return;
  }
  if (normalizedRef === state.pendingRef) {
    return;
  }
  state.pendingRef = normalizedRef;
}

/**
 * 전체 in-flight turn 수
 */
function getTotalInFlightTurns(state: RevisionState): number {
  let total = 0;
  for (const count of state.inFlightTurnsByRef.values()) {
    total += count;
  }
  return total;
}

/**
 * pending ref를 active로 승격한다.
 */
function promotePendingRef(state: RevisionState): string | null {
  if (!state.pendingRef) {
    return null;
  }

  if (getTotalInFlightTurns(state) > 0) {
    return null;
  }

  const nextRef = normalizeSwarmBundleRef(state.pendingRef);
  state.pendingRef = undefined;

  if (nextRef === state.activeRef) {
    return null;
  }

  state.activeRef = nextRef;
  return nextRef;
}

/**
 * active ref의 turn 카운트 증가
 */
function acquireTurnRef(state: RevisionState): string {
  const normalizedRef = normalizeSwarmBundleRef(state.activeRef);
  const current = state.inFlightTurnsByRef.get(normalizedRef) ?? 0;
  state.inFlightTurnsByRef.set(normalizedRef, current + 1);
  return normalizedRef;
}

/**
 * turn 종료 시 ref 카운트 감소
 */
function releaseTurnRef(state: RevisionState, ref: string): void {
  const normalizedRef = normalizeSwarmBundleRef(ref);
  const current = state.inFlightTurnsByRef.get(normalizedRef);
  if (current === undefined) {
    return;
  }

  if (current <= 1) {
    state.inFlightTurnsByRef.delete(normalizedRef);
    return;
  }

  state.inFlightTurnsByRef.set(normalizedRef, current - 1);
}

/**
 * 문자열 배열인지 확인
 */
function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => typeof item === "string");
}

/**
 * ChangesetPolicy로 변환
 */
function toChangesetPolicy(value: unknown): ChangesetPolicy | undefined {
  if (!isObjectWithKey(value, "enabled") && !isObjectWithKey(value, "allowed") && !isObjectWithKey(value, "applyAt") && !isObjectWithKey(value, "emitRevisionChangedEvent")) {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const policy: ChangesetPolicy = {};

  if (isObjectWithKey(value, "enabled") && typeof value.enabled === "boolean") {
    policy.enabled = value.enabled;
  }

  if (isObjectWithKey(value, "applyAt") && isStringArray(value.applyAt)) {
    policy.applyAt = value.applyAt;
  }

  if (isObjectWithKey(value, "emitRevisionChangedEvent") && typeof value.emitRevisionChangedEvent === "boolean") {
    policy.emitRevisionChangedEvent = value.emitRevisionChangedEvent;
  }

  if (isObjectWithKey(value, "allowed") && typeof value.allowed === "object" && value.allowed !== null) {
    const allowed = value.allowed;
    if (isObjectWithKey(allowed, "files") && isStringArray(allowed.files)) {
      policy.allowed = { files: allowed.files };
    }
  }

  return policy;
}

/**
 * Swarm spec에서 changeset policy 추출
 */
function extractSwarmChangesetPolicy(swarmSpec: unknown): ChangesetPolicy | undefined {
  if (!isObjectWithKey(swarmSpec, "policy")) {
    return undefined;
  }
  const policy = swarmSpec.policy;
  if (!isObjectWithKey(policy, "changesets")) {
    return undefined;
  }
  return toChangesetPolicy(policy.changesets);
}

/**
 * Agent spec에서 changeset policy 추출
 */
function extractAgentChangesetPolicy(agentSpec: unknown): ChangesetPolicy | undefined {
  if (!isObjectWithKey(agentSpec, "changesets")) {
    return undefined;
  }
  return toChangesetPolicy(agentSpec.changesets);
}

/**
 * 런타임용 SwarmBundleApi 생성
 */
async function createRuntimeSwarmBundleApi(
  result: BundleLoadResult,
  bundleRootDir: string,
  swarmName: string,
  entrypointAgent: string,
  revisionState: RevisionState,
  stateRoot?: string,
): Promise<{ api: SwarmBundleApi; activeRef: string }> {
  const swarmResource = result.getResource("Swarm", swarmName);
  const agentResource = result.getResource("Agent", entrypointAgent);
  const swarmPolicy = extractSwarmChangesetPolicy(swarmResource?.spec);
  const agentPolicy = extractAgentChangesetPolicy(agentResource?.spec);

  const manager = new SwarmBundleManagerImpl({
    swarmBundleRoot: bundleRootDir,
    goondanHome: resolveGoondanHome({ cliStateRoot: stateRoot }),
    workspaceId: generateWorkspaceId(bundleRootDir),
    swarmPolicy,
    agentPolicy,
  });

  let activeRef = "default";
  try {
    activeRef = normalizeSwarmBundleRef(await manager.getActiveRef());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`SwarmBundleManager 초기화 실패: ${message}`);
  }

  const baseApi = createSwarmBundleApi(manager);

  const api: SwarmBundleApi = {
    openChangeset: async (input?: OpenChangesetInput) => {
      return baseApi.openChangeset(input);
    },
    commitChangeset: async (input: CommitChangesetInput) => {
      const result = await baseApi.commitChangeset(input);
      if (result.status === "ok" && result.newRef) {
        queuePendingRef(revisionState, result.newRef);
      }
      return result;
    },
    getActiveRef: () => {
      const ref = baseApi.getActiveRef();
      const normalized = normalizeSwarmBundleRef(ref);
      if (normalized === "default") {
        return normalizeSwarmBundleRef(revisionState.activeRef);
      }
      return normalized;
    },
  };

  return { api, activeRef };
}

/**
 * Turn 결과에서 최종 assistant 메시지 텍스트 추출
 */
function extractAssistantResponse(turn: Turn): string {
  // Turn.messages를 역순으로 순회하여 마지막 assistant 메시지 텍스트 반환
  for (let i = turn.messages.length - 1; i >= 0; i--) {
    const msg = turn.messages[i];
    if (msg && isLlmAssistantMessage(msg) && msg.content) {
      return msg.content;
    }
  }
  return "(No response)";
}

/**
 * 사용량 정보 표시
 */
function displayUsage(turn: Turn): void {
  let totalPrompt = 0;
  let totalCompletion = 0;
  let stepCount = 0;

  for (const step of turn.steps) {
    if (step.llmResult?.meta?.usage) {
      totalPrompt += step.llmResult.meta.usage.promptTokens;
      totalCompletion += step.llmResult.meta.usage.completionTokens;
    }
    stepCount++;
  }

  if (totalPrompt > 0 || totalCompletion > 0) {
    console.log(
      chalk.dim(
        `  [${stepCount} step(s), ${totalPrompt} prompt + ${totalCompletion} completion tokens]`
      )
    );
  }
}

interface RuntimeCore {
  turnRunner: TurnRunner;
  entrypointAgent: string;
}

interface RuntimePersistenceBindings {
  messageStateLogger: (
    agentInstance: AgentInstance,
  ) => ReturnType<WorkspaceManager["createTurnMessageStateLogger"]>;
  messageStateRecovery: (
    agentInstance: AgentInstance,
  ) => ReturnType<WorkspaceManager["recoverTurnMessageState"]>;
  flushExtensionState: (agentInstance: AgentInstance) => Promise<void>;
  extensionLoaderFactory: (agentInstance: AgentInstance) => Promise<ExtensionLoader>;
}

function hasFlushableStateStore(value: object): value is { flush: () => Promise<void> } {
  return 'flush' in value && typeof value.flush === 'function';
}

function createRuntimePersistenceBindings(
  workspaceManager: WorkspaceManager,
  instanceId: string,
): RuntimePersistenceBindings {
  const stateStoreCache = new Map<string, Promise<StateStore>>();
  const extensionLoaderCache = new Map<string, Promise<ExtensionLoader>>();

  async function getStateStore(agentInstance: AgentInstance): Promise<StateStore> {
    const cached = stateStoreCache.get(agentInstance.id);
    if (cached) {
      return cached;
    }

    const created = workspaceManager.createPersistentStateStore(instanceId);
    stateStoreCache.set(agentInstance.id, created);
    return created;
  }

  return {
    messageStateLogger: (agentInstance) =>
      workspaceManager.createTurnMessageStateLogger(instanceId, agentInstance.agentName),
    messageStateRecovery: (agentInstance) =>
      workspaceManager.recoverTurnMessageState(instanceId, agentInstance.agentName),
    flushExtensionState: async (agentInstance) => {
      const stateStore = await getStateStore(agentInstance);
      if (hasFlushableStateStore(stateStore)) {
        await stateStore.flush();
      }
    },
    extensionLoaderFactory: async (agentInstance) => {
      const cached = extensionLoaderCache.get(agentInstance.id);
      if (cached) {
        return cached;
      }
      const loaderPromise = getStateStore(agentInstance).then(
        (stateStore) =>
          new ExtensionLoader({
            eventBus: createEventBus(),
            stateStore,
            logger: console,
          }),
      );
      extensionLoaderCache.set(agentInstance.id, loaderPromise);
      return loaderPromise;
    },
  };
}

/**
 * Bundle 결과에서 TurnRunner/Entrypoint를 재구성한다.
 */
function createRuntimeCore(
  result: BundleLoadResult,
  bundleRootDir: string,
  swarmName: string,
  toolExecutor: RevisionedToolExecutor,
  runtimePersistence?: RuntimePersistenceBindings,
): RuntimeCore {
  const bundleLoader = createBundleLoaderImpl({
    bundleLoadResult: result,
    bundleRootDir,
  });

  const effectiveConfigLoader = createEffectiveConfigLoader(bundleLoader);
  const llmCaller = createLlmCallerImpl();
  const stepRunner = createStepRunner({
    llmCaller,
    toolExecutor,
    effectiveConfigLoader,
  });

  const swarmResource = result.getResource("Swarm", swarmName);
  const swarmSpec = swarmResource?.spec;
  const maxStepsPerTurn = getSwarmPolicyValue(swarmSpec, "maxStepsPerTurn", 32);
  const turnRunner = createTurnRunner({
    stepRunner,
    maxStepsPerTurn,
    ...(runtimePersistence
      ? {
          messageStateLogger: runtimePersistence.messageStateLogger,
          messageStateRecovery: runtimePersistence.messageStateRecovery,
          flushExtensionState: runtimePersistence.flushExtensionState,
          extensionLoaderFactory: runtimePersistence.extensionLoaderFactory,
        }
      : {}),
  });

  const entrypointRef = getSwarmEntrypoint(swarmSpec);
  const entrypointAgent = entrypointRef
    ? resolveRefName(entrypointRef)
    : "default";

  return {
    turnRunner,
    entrypointAgent,
  };
}

/**
 * active ref 전환 시 런타임 코어를 재로딩한다.
 */
async function reloadRuntimeForActiveRef(ctx: RuntimeContext): Promise<boolean> {
  const result = await loadBundle(ctx.configPath);
  if (!result.isValid()) {
    warn(`SwarmBundleRef ${ctx.revisionState.activeRef} 로드 실패: validation error`);
    return false;
  }

  const swarms = result.getResourcesByKind("Swarm");
  const targetSwarm = swarms.find((swarm) => swarm.metadata.name === ctx.swarmName);
  if (!targetSwarm) {
    warn(`SwarmBundleRef ${ctx.revisionState.activeRef}에 Swarm '${ctx.swarmName}'이 없습니다.`);
    return false;
  }

  const runtimePersistence = createRuntimePersistenceBindings(
    ctx.workspaceManager,
    ctx.instanceId,
  );
  const core = createRuntimeCore(
    result,
    ctx.bundleRootDir,
    ctx.swarmName,
    ctx.toolExecutor,
    runtimePersistence,
  );

  ctx.currentBundle = result;
  ctx.turnRunner = core.turnRunner;
  ctx.entrypointAgent = core.entrypointAgent;
  ctx.agentInstances.clear();

  const instanceInfos = await ctx.swarmInstanceManager.list();
  for (const instanceInfo of instanceInfos) {
    const swarmInstance = ctx.swarmInstanceManager.get(instanceInfo.instanceKey);
    if (swarmInstance) {
      swarmInstance.agents.clear();
    }
  }

  return true;
}

/**
 * pending ref 승격 가능하면 승격하고 런타임을 재로딩한다.
 */
async function maybeActivatePendingRef(ctx: RuntimeContext): Promise<void> {
  const previousRef = ctx.revisionState.activeRef;
  const promotedRef = promotePendingRef(ctx.revisionState);
  if (!promotedRef) {
    return;
  }

  const reloaded = await reloadRuntimeForActiveRef(ctx);
  if (!reloaded) {
    ctx.revisionState.pendingRef = promotedRef;
    ctx.revisionState.activeRef = previousRef;
    return;
  }

  info(`Activated SwarmBundleRef: ${promotedRef}`);
}

/**
 * 단일 입력 처리 (Turn 실행)
 */
async function processInput(
  ctx: RuntimeContext,
  input: string,
): Promise<void> {
  await maybeActivatePendingRef(ctx);

  const turnRef = acquireTurnRef(ctx.revisionState);
  ctx.toolExecutor.beginTurn(turnRef);

  const agentName = ctx.entrypointAgent;
  const agentEventLogger = ctx.workspaceManager.createAgentEventLogger(
    ctx.instanceId,
    agentName,
  );

  try {
    // SwarmInstance 조회 또는 생성
    const swarmInstance = await ctx.swarmInstanceManager.getOrCreate(
      `Swarm/${ctx.swarmName}`,
      ctx.instanceKey,
      turnRef
    );
    swarmInstance.activeSwarmBundleRef = turnRef;

    // AgentInstance 조회 또는 생성
    let agentInstance = ctx.agentInstances.get(agentName);
    if (!agentInstance) {
      agentInstance = createAgentInstance(
        swarmInstance,
        `Agent/${agentName}`
      );
      ctx.agentInstances.set(agentName, agentInstance);
      // SwarmInstance에도 등록
      swarmInstance.agents.set(agentName, {
        id: agentInstance.id,
        agentName: agentInstance.agentName,
      });
    }

    // AgentEvent 생성
    const event = createAgentEvent("user.input", input);

    // Turn 시작 이벤트 로깅
    const turnId = `turn-${Date.now()}`;
    const traceId = `trace-${Date.now().toString(36)}`;
    await agentEventLogger.log({
      traceId,
      kind: "turn.started",
      instanceId: ctx.instanceId,
      instanceKey: ctx.instanceKey,
      agentName,
      turnId,
    });

    // Turn 실행
    const turn = await ctx.turnRunner.run(agentInstance, event);

    // 결과 출력 및 이벤트 로깅
    if (turn.status === "completed") {
      const response = extractAssistantResponse(turn);
      console.log(chalk.green("Agent:"), response);
      displayUsage(turn);

      await agentEventLogger.log({
        traceId,
        kind: "turn.completed",
        instanceId: ctx.instanceId,
        instanceKey: ctx.instanceKey,
        agentName,
        turnId,
        data: {
          stepCount: turn.steps.length,
        },
      });
    } else if (turn.status === "failed") {
      const errorMeta = turn.metadata["error"];
      if (isObjectWithKey(errorMeta, "message")) {
        logError(`Turn failed: ${String(errorMeta.message)}`);
      } else {
        logError("Turn failed with unknown error");
      }

      await agentEventLogger.log({
        traceId,
        kind: "turn.error",
        instanceId: ctx.instanceId,
        instanceKey: ctx.instanceKey,
        agentName,
        turnId,
        data: {
          error: isObjectWithKey(errorMeta, "message")
            ? String(errorMeta.message)
            : "Unknown error",
        },
      });
    }
  } finally {
    ctx.toolExecutor.endTurn(turnRef);
    releaseTurnRef(ctx.revisionState, turnRef);
    await maybeActivatePendingRef(ctx);
  }

  console.log();
}

/**
 * 커넥터용 Turn 실행 (커스텀 instanceKey, agentName, 응답 반환)
 */
export async function processConnectorTurn(
  ctx: RuntimeContext,
  options: { instanceKey: string; agentName?: string; input: string },
): Promise<ProcessConnectorTurnResult> {
  await maybeActivatePendingRef(ctx);

  const turnRef = acquireTurnRef(ctx.revisionState);
  ctx.toolExecutor.beginTurn(turnRef);

  const agentName = options.agentName ?? ctx.entrypointAgent;
  const agentEventLogger = ctx.workspaceManager.createAgentEventLogger(
    ctx.instanceId,
    agentName,
  );
  const turnId = `turn-${Date.now()}`;
  const traceId = `trace-${Date.now().toString(36)}`;

  try {
    const swarmInstance = await ctx.swarmInstanceManager.getOrCreate(
      `Swarm/${ctx.swarmName}`,
      options.instanceKey,
      turnRef,
    );
    swarmInstance.activeSwarmBundleRef = turnRef;

    const cacheKey = `${options.instanceKey}::${agentName}`;

    let agentInstance = ctx.agentInstances.get(cacheKey);
    if (!agentInstance) {
      agentInstance = createAgentInstance(
        swarmInstance,
        `Agent/${agentName}`,
      );
      ctx.agentInstances.set(cacheKey, agentInstance);
      swarmInstance.agents.set(agentName, {
        id: agentInstance.id,
        agentName: agentInstance.agentName,
      });

      // 새 agent 생성 시 인스턴스 디렉터리 초기화
      await ctx.workspaceManager.initializeInstanceState(ctx.instanceId, [agentName]);
    }

    // Turn 시작 이벤트 로깅
    await agentEventLogger.log({
      traceId,
      kind: "turn.started",
      instanceId: ctx.instanceId,
      instanceKey: options.instanceKey,
      agentName,
      turnId,
    });

    const event = createAgentEvent("user.input", options.input);
    const turn = await ctx.turnRunner.run(agentInstance, event);

    if (turn.status === "completed") {
      await agentEventLogger.log({
        traceId,
        kind: "turn.completed",
        instanceId: ctx.instanceId,
        instanceKey: options.instanceKey,
        agentName,
        turnId,
        data: { stepCount: turn.steps.length },
      });
      return { response: extractAssistantResponse(turn), status: "completed" };
    }

    const errorMeta = turn.metadata["error"];
    const msg = isObjectWithKey(errorMeta, "message")
      ? String(errorMeta.message)
      : "Unknown error";

    await agentEventLogger.log({
      traceId,
      kind: "turn.error",
      instanceId: ctx.instanceId,
      instanceKey: options.instanceKey,
      agentName,
      turnId,
      data: { error: msg },
    });

    return { response: `Error: ${msg}`, status: "failed" };
  } finally {
    ctx.toolExecutor.endTurn(turnRef);
    releaseTurnRef(ctx.revisionState, turnRef);
    await maybeActivatePendingRef(ctx);
  }
}

/**
 * 실제 런타임을 초기화하고 RuntimeContext를 생성
 */
async function initializeRuntime(
  result: BundleLoadResult,
  configPath: string,
  bundleRootDir: string,
  swarmName: string,
  instanceKey: string,
  stateRoot?: string,
): Promise<RuntimeContext> {
  const revisionState: RevisionState = {
    activeRef: "default",
    inFlightTurnsByRef: new Map(),
  };

  const entrypointRef = getSwarmEntrypoint(result.getResource("Swarm", swarmName)?.spec);
  const entrypointAgentForPolicy = entrypointRef
    ? resolveRefName(entrypointRef)
    : "default";

  const { api: swarmBundleApi, activeRef } = await createRuntimeSwarmBundleApi(
    result,
    bundleRootDir,
    swarmName,
    entrypointAgentForPolicy,
    revisionState,
    stateRoot,
  );

  revisionState.activeRef = activeRef;

  // WorkspaceManager 생성 및 인스턴스 상태 초기화
  const workspaceManager = WorkspaceManager.create({
    swarmBundleRoot: bundleRootDir,
    stateRoot,
  });
  const instanceId = generateInstanceId(swarmName, instanceKey);

  // 인스턴스별 workspace 디렉터리 경로 (initializeInstanceState에서 디렉터리 생성됨)
  const instanceWorkspacePath = workspaceManager.instanceWorkspacePath(instanceId);

  // runtimeCtx는 toolExecutor 생성 이후에 완성되므로 late-binding 패턴 사용
  let runtimeCtxRef: RuntimeContext | null = null;

  const toolExecutor = createToolExecutorImpl({
    bundleRootDir,
    maxActiveGenerations: 3,
    isolateByRevision: true,
    swarmBundleApi,
    swarmBundleRoot: bundleRootDir,
    logger: console,
    onCommittedRef: (newRef: string) => {
      queuePendingRef(revisionState, newRef);
    },
    workdir: instanceWorkspacePath,
    onAgentsDelegate: async (agentName: string, task: string, context?: string) => {
      if (!runtimeCtxRef) {
        return { success: false, agentName, instanceId: "", error: "Runtime not initialized" };
      }
      const turnResult = await processConnectorTurn(runtimeCtxRef, {
        instanceKey,
        agentName,
        input: context ? `${task}\n\nContext: ${context}` : task,
      });
      return {
        success: turnResult.status === "completed",
        agentName,
        instanceId: runtimeCtxRef.instanceId,
        response: turnResult.response,
        error: turnResult.status === "failed" ? turnResult.response : undefined,
      };
    },
    onAgentsListInstances: async () => {
      if (!runtimeCtxRef) {
        return [];
      }
      const instances: Array<{ instanceId: string; agentName: string; status: string }> = [];
      for (const [agentName] of runtimeCtxRef.agentInstances) {
        instances.push({
          instanceId: runtimeCtxRef.instanceId,
          agentName,
          status: "running",
        });
      }
      return instances;
    },
  });
  const runtimePersistence = createRuntimePersistenceBindings(workspaceManager, instanceId);
  const core = createRuntimeCore(
    result,
    bundleRootDir,
    swarmName,
    toolExecutor,
    runtimePersistence,
  );

  // 인스턴스 디렉터리 초기화 (entrypoint agent 포함)
  await workspaceManager.initializeInstanceState(instanceId, [core.entrypointAgent]);

  // SwarmEventLogger 생성
  const swarmEventLogger = workspaceManager.createSwarmEventLogger(instanceId);

  const ctx: RuntimeContext = {
    turnRunner: core.turnRunner,
    toolExecutor,
    swarmInstanceManager: createSwarmInstanceManager(),
    swarmName,
    entrypointAgent: core.entrypointAgent,
    instanceKey,
    instanceId,
    bundleRootDir,
    configPath,
    currentBundle: result,
    revisionState,
    agentInstances: new Map(),
    workspaceManager,
    swarmEventLogger,
  };

  // late-binding: toolExecutor의 agents 콜백이 runtimeCtx를 참조할 수 있도록 설정
  runtimeCtxRef = ctx;

  return ctx;
}

/**
 * Run interactive mode with readline (실제 런타임 연결)
 */
async function runInteractiveMode(
  ctx: RuntimeContext,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.dim("Type your message and press Enter. Type 'exit' or Ctrl+C to quit."));
  console.log();

  const prompt = (): void => {
    rl.question(chalk.cyan("You: "), (input) => {
      const trimmedInput = input.trim();

      if (trimmedInput.toLowerCase() === "exit" || trimmedInput.toLowerCase() === "quit") {
        console.log();
        info("Goodbye!");
        rl.close();
        return;
      }

      if (!trimmedInput) {
        prompt();
        return;
      }

      console.log();

      // 실제 런타임으로 Turn 실행
      processInput(ctx, trimmedInput)
        .then(() => {
          prompt();
        })
        .catch((err: unknown) => {
          if (err instanceof Error) {
            logError(`Runtime error: ${err.message}`);
            debug(err.stack ?? "");
          }
          prompt();
        });
    });
  };

  // Handle Ctrl+C gracefully
  await new Promise<void>((resolve) => {
    rl.on("close", () => {
      console.log();
      resolve();
    });

    prompt();
  });
}

/**
 * goondan.yaml 내 Package 리소스의 의존성이 설치되어 있는지 확인하고 필요 시 자동 설치
 */
async function autoInstallDependencies(
  projectDir: string,
  spinner: ReturnType<typeof ora>,
): Promise<boolean> {
  // goondan.yaml에서 Package 문서를 찾는다
  let goondanPath: string | null = null;
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(projectDir, name);
    try {
      await fs.promises.access(candidate, fs.constants.R_OK);
      goondanPath = candidate;
      break;
    } catch {
      // continue
    }
  }

  if (!goondanPath) {
    return true;
  }

  let content: string;
  try {
    content = await fs.promises.readFile(goondanPath, "utf-8");
  } catch {
    return true;
  }

  // multi-document YAML에서 Package kind를 찾는다
  const documents = content.split(/^---$/m);
  let packageSpec: unknown = null;

  for (const doc of documents) {
    const trimmed = doc.trim();
    if (!trimmed) continue;

    const parsed: unknown = parseYaml(trimmed);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "kind" in parsed &&
      parsed.kind === "Package" &&
      "spec" in parsed &&
      typeof parsed.spec === "object" &&
      parsed.spec !== null
    ) {
      packageSpec = parsed.spec;
      break;
    }
  }

  if (packageSpec === null || typeof packageSpec !== "object") {
    return true;
  }

  const spec = packageSpec;
  if (!("dependencies" in spec) || !Array.isArray(spec.dependencies) || spec.dependencies.length === 0) {
    return true;
  }

  // file: 의존성은 로컬 경로이므로 설치 불필요 (core loader가 직접 해석)
  // 레지스트리 의존성만 체크
  const registryDeps: string[] = [];
  for (const dep of spec.dependencies) {
    if (typeof dep === "string" && !dep.startsWith("file:")) {
      registryDeps.push(dep);
    }
  }

  if (registryDeps.length === 0) {
    return true;
  }

  // .goondan/packages/ 디렉토리 존재 확인
  const packagesDir = path.join(projectDir, ".goondan", "packages");
  try {
    await fs.promises.access(packagesDir, fs.constants.R_OK);
    // 디렉토리가 있으면 이미 설치된 것으로 간주
    return true;
  } catch {
    // 설치 필요
  }

  spinner.start("Auto-installing dependencies...");

  try {
    const { execSync } = await import("node:child_process");
    execSync("gdn package install", {
      cwd: projectDir,
      stdio: "pipe",
    });
    spinner.succeed("Dependencies installed");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    spinner.fail(`Failed to auto-install dependencies: ${message}`);
    info("Run 'gdn package install' manually to install dependencies.");
    return false;
  }
}

/**
 * Execute the run command
 */
async function executeRun(options: RunOptions): Promise<void> {
  const spinner = ora();
  let runtimeCtx: RuntimeContext | null = null;

  try {
    // Find bundle configuration
    spinner.start("Looking for bundle configuration...");
    const configPath = await resolveBundleConfigPath(options.configPath);

    if (!configPath) {
      spinner.fail("Bundle configuration not found");
      if (options.configPath) {
        logError(
          `Bundle not found at configured path '${options.configPath}'. Provide a readable bundle file or directory containing ${CONFIG_FILE_NAMES.join(" or ")}.`
        );
      } else {
        logError(
          `Bundle not found at './${CONFIG_FILE_NAMES[0]}'. No ${CONFIG_FILE_NAMES.join(" or ")} found in current directory.`
        );
      }
      info("Run 'gdn init' to create a new project, or navigate to a project directory.");
      info("Run 'gdn doctor' to diagnose your environment.");
      process.exitCode = ExitCode.CONFIG_ERROR;
      return;
    }

    spinner.succeed(`Found configuration: ${path.relative(process.cwd(), configPath)}`);

    // Auto-install dependencies if needed
    const bundleRootDir = path.dirname(configPath);
    if (!options.noInstall) {
      const installed = await autoInstallDependencies(bundleRootDir, spinner);
      if (!installed) {
        process.exitCode = ExitCode.CONFIG_ERROR;
        return;
      }
    }

    // Load and validate bundle
    spinner.start("Loading and validating bundle...");
    const result = await loadBundle(configPath);

    if (!result.isValid()) {
      spinner.fail("Bundle validation failed");
      displayValidationResults(result);
      process.exitCode = ExitCode.VALIDATION_ERROR;
      return;
    }

    spinner.succeed("Bundle loaded and validated");

    // Check if the specified swarm exists
    const swarms = result.getResourcesByKind("Swarm");
    let targetSwarm = swarms.find(
      (s) => s.metadata.name === options.swarm
    );

    // Auto-select the only swarm when default name is not found
    if (!targetSwarm && options.swarm === "default" && swarms.length === 1 && swarms[0]) {
      targetSwarm = swarms[0];
      options.swarm = targetSwarm.metadata.name;
      info(`Swarm 'default' not found. Auto-selected the only available swarm: '${options.swarm}'`);
    }

    if (!targetSwarm) {
      logError(`Swarm '${options.swarm}' not found in bundle`);
      if (swarms.length > 0) {
        info(`Available swarms: ${swarms.map((s) => s.metadata.name).join(", ")}`);
      } else {
        info("No Swarm resources defined in the bundle");
      }
      process.exitCode = ExitCode.CONFIG_ERROR;
      return;
    }

    // Generate instance key if not provided
    const instanceKey = options.instanceKey ?? `cli-${Date.now()}`;

    // Display configuration info
    displayBundleInfo(result, options.swarm, options);

    // Display warnings if any
    displayValidationResults(result);

    // Initialize runtime
    spinner.start("Initializing runtime...");
    const ctx = await initializeRuntime(
      result,
      configPath,
      bundleRootDir,
      options.swarm,
      instanceKey,
      options.stateRoot,
    );
    runtimeCtx = ctx;
    spinner.succeed("Runtime initialized");

    // Swarm lifecycle 이벤트 로깅
    const swarmTraceId = `trace-${Date.now().toString(36)}`;
    await ctx.swarmEventLogger.log({
      traceId: swarmTraceId,
      kind: "swarm.created",
      instanceId: ctx.instanceId,
      instanceKey: ctx.instanceKey,
      swarmName: ctx.swarmName,
    });

    await ctx.swarmEventLogger.log({
      traceId: swarmTraceId,
      kind: "agent.created",
      instanceId: ctx.instanceId,
      instanceKey: ctx.instanceKey,
      swarmName: ctx.swarmName,
      agentName: ctx.entrypointAgent,
    });

    await ctx.swarmEventLogger.log({
      traceId: swarmTraceId,
      kind: "swarm.started",
      instanceId: ctx.instanceId,
      instanceKey: ctx.instanceKey,
      swarmName: ctx.swarmName,
    });

    // Show starting message
    console.log(chalk.bold.green(`Starting Swarm: ${options.swarm}`));
    console.log(chalk.dim(`  Entrypoint: ${ctx.entrypointAgent}`));
    console.log(chalk.dim(`  Instance: ${ctx.instanceId}`));
    console.log();

    // Handle initial input
    let initialInput = options.input;

    if (options.inputFile) {
      try {
        initialInput = await readInputFile(options.inputFile);
        debug(`Loaded input from file: ${options.inputFile}`);
      } catch (err) {
        logError(`Failed to read input file: ${options.inputFile}`);
        if (err instanceof Error) {
          logError(err.message);
        }
        process.exitCode = ExitCode.ERROR;
        return;
      }
    }

    // Process initial input if provided
    if (initialInput) {
      console.log(chalk.cyan("You:"), initialInput);
      console.log();

      await processInput(ctx, initialInput);

      // If not interactive, exit after processing
      if (!options.interactive) {
        success("Processing complete");
        return;
      }
    }

    // Detect connections and dispatch to appropriate connector
    const { connections: allConnections, warnings: connWarnings } = detectConnections(result);
    for (const w of connWarnings) {
      warn(w);
    }

    // swarmRef 기반 필터링: swarmRef가 있으면 현재 Swarm만 매칭, 없으면 모두 매칭 (하위 호환)
    const swarmFiltered = allConnections.filter(
      (c) => !c.swarmName || c.swarmName === options.swarm,
    );

    if (swarmFiltered.length > 0) {
      const filtered = options.connector
        ? swarmFiltered.filter(
            (c) =>
              c.connectorName === options.connector ||
              c.connectorType === options.connector,
          )
        : swarmFiltered;

      if (filtered.length === 0 && options.connector) {
        warn(`Connector '${options.connector}' not found in bundle`);
        info(
          `Available connectors: ${swarmFiltered.map((c) => `${c.connectorName} (${c.connectorType})`).join(", ")}`,
        );
        process.exitCode = ExitCode.CONFIG_ERROR;
        return;
      }

      const runners: ConnectorRunner[] = [];

      for (const detected of filtered) {
        if (detected.connectorType === "cli") {
          if (!options.interactive) {
            info(
              `Skipping CLI connector '${detected.connectorName}' because interactive mode is disabled (--no-interactive).`,
            );
            continue;
          }
          info(`Starting CLI connector: ${detected.connectorName}`);
          await runInteractiveMode(ctx);
          return;
        }

        // trigger type 기반으로 runner 생성
        const runner = await createConnectorRunner({
          runtimeCtx: ctx,
          detected,
          processConnectorTurn,
        });

        if (runner) {
          info(`Starting connector: ${detected.connectorName} (trigger: ${detected.connectorType})`);
          runners.push(runner);
        } else {
          warn(`Trigger type '${detected.connectorType}' is not yet supported in this CLI runtime (connector: ${detected.connectorName})`);
        }
      }

      if (runners.length > 0) {
        const shutdown = async (): Promise<void> => {
          for (const runner of runners) {
            await runner.shutdown();
          }
        };
        process.on("SIGINT", () => {
          shutdown().catch(() => {});
        });
        process.on("SIGTERM", () => {
          shutdown().catch(() => {});
        });

        await Promise.all(runners.map((r) => r.start()));
        return;
      }
    }

    // Fallback: no connections → interactive mode
    if (options.interactive) {
      await runInteractiveMode(ctx);
    } else {
      info("No input provided and interactive mode is disabled.");
      info("Use --input or --input-file to provide input, or --interactive for interactive mode.");
    }
  } catch (err) {
    spinner.fail("Failed to run Swarm");

    if (err instanceof Error) {
      logError(err.message);
      debug(err.stack ?? "");
    }

    process.exitCode = ExitCode.ERROR;
  } finally {
    // Swarm 종료 이벤트 로깅
    if (runtimeCtx) {
      try {
        await runtimeCtx.swarmEventLogger.log({
          traceId: `trace-${Date.now().toString(36)}`,
          kind: "swarm.stopped",
          instanceId: runtimeCtx.instanceId,
          instanceKey: runtimeCtx.instanceKey,
          swarmName: runtimeCtx.swarmName,
        });
      } catch {
        // 로깅 실패는 무시
      }
    }

    if (runtimeCtx && isRevisionedToolExecutor(runtimeCtx.toolExecutor)) {
      await runtimeCtx.toolExecutor.dispose();
    }
  }
}

/**
 * Create the run command
 *
 * @returns Commander command for 'gdn run'
 */
export function createRunCommand(): Command {
  const command = new Command("run")
    .description("Run a Swarm")
    .addHelpText(
      "after",
      `
Examples:
  $ gdn run                             Run default Swarm interactively
  $ gdn run -s my-swarm                 Run a specific Swarm
  $ gdn run --input "Hello, agent!"     Send a single message
  $ gdn run --input-file request.txt    Send input from file
  $ gdn run --no-interactive            Non-interactive mode`
    )
    .addOption(
      new Option("-s, --swarm <name>", "Swarm name to run").default("default")
    )
    .addOption(
      new Option("--connector <name>", "Connector to use")
    )
    .addOption(
      new Option("-i, --instance-key <key>", "Instance key")
    )
    .addOption(
      new Option("--input <text>", "Initial input message")
    )
    .addOption(
      new Option("--input-file <path>", "Input from file")
    )
    .addOption(
      new Option("--interactive", "Interactive mode").default(true)
    )
    .addOption(
      new Option("--no-interactive", "Disable interactive mode")
    )
    .addOption(
      new Option("-w, --watch", "Watch mode for file changes").default(false)
    )
    .addOption(
      new Option("-p, --port <number>", "HTTP server port").argParser(parseInt)
    )
    .addOption(
      new Option("--no-install", "Skip dependency installation")
    )
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const optStr = (key: string): string | undefined =>
        typeof opts[key] === "string" ? opts[key] : undefined;
      const optNum = (key: string): number | undefined =>
        typeof opts[key] === "number" ? opts[key] : undefined;
      const globalOpts = command.optsWithGlobals<{
        config?: string;
        stateRoot?: string;
      }>();
      const globalConfigPath =
        typeof globalOpts.config === "string" ? globalOpts.config : undefined;
      const globalStateRoot =
        typeof globalOpts.stateRoot === "string" ? globalOpts.stateRoot : undefined;

      const runOptions: RunOptions = {
        swarm: optStr("swarm") ?? "default",
        connector: optStr("connector"),
        instanceKey: optStr("instanceKey"),
        input: optStr("input"),
        inputFile: optStr("inputFile"),
        interactive: opts.interactive !== false,
        watch: opts.watch === true,
        port: optNum("port"),
        noInstall: opts.install === false,
        configPath: globalConfigPath,
        stateRoot: globalStateRoot,
      };

      await executeRun(runOptions);
    });

  return command;
}

export default createRunCommand;
