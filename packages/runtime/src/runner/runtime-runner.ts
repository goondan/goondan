import path from 'node:path';
import { Console } from 'node:console';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { closeSync, constants as fsConstants, existsSync, openSync, watch as watchFs, type FSWatcher } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
  type AssistantModelMessage,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import {
  BundleLoader,
  ConversationStateImpl,
  ExtensionApiImpl,
  ExtensionStateManagerImpl,
  PipelineRegistryImpl,
  RUNTIME_EVENT_TYPES,
  RuntimeEventBusImpl,
  buildToolName,
  createMinimalToolContext,
  isJsonObject,
  loadExtensions,
  normalizeObjectRef,
  FileWorkspaceStorage,
  ToolExecutor,
  ToolRegistryImpl,
  WorkspacePaths,
  type AgentEvent,
  type AgentToolRuntime,
  type AgentRuntimeListOptions,
  type AgentRuntimeRequestOptions,
  type AgentRuntimeRequestResult,
  type AgentRuntimeSendResult,
  type AgentRuntimeSpawnOptions,
  type AgentRuntimeSpawnResult,
  type MiddlewareAgentsApi,
  type MiddlewareAgentRequestParams,
  type MiddlewareAgentSendParams,
  type JsonObject,
  type JsonSchemaProperty,
  type JsonSchemaObject,
  type MessageEvent,
  type Message,
  type ObjectRefLike,
  type RuntimeResource,
  type RuntimeEvent,
  type StepResult,
  type ToolCallResult,
  type ToolCatalogItem,
  type Turn,
  type TurnResult,
  type JsonValue,
  type ValidationError,
} from '../index.js';
import {
  formatRuntimeInboundUserText,
  parseAgentToolEventPayload,
  parseConnectorEventPayload,
  selectMatchingIngressRule,
  resolveInboundInstanceKey,
  resolveRuntimeWorkdir,
  type IngressRouteRule as ParsedIngressRouteRule,
  type ParsedConnectorEvent,
} from './runtime-routing.js';
import { buildStepLimitResponse } from './turn-policy.js';
import {
  toConversationTurns,
  toPersistentMessages,
  type ConversationTurn,
} from './conversation-state.js';

interface RunnerReadyMessage {
  type: 'ready';
  instanceKey: string;
  pid: number;
}

interface RunnerStartErrorMessage {
  type: 'start_error';
  message: string;
}

type RunnerMessage = RunnerReadyMessage | RunnerStartErrorMessage;

interface ConnectorChildStartMessage {
  type: 'connector_start';
  connectorEntryPath: string;
  connectionName: string;
  connectorName: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

interface ConnectorChildShutdownMessage {
  type: 'connector_shutdown';
}

type ConnectorChildCommandMessage = ConnectorChildStartMessage | ConnectorChildShutdownMessage;

interface ConnectorChildStartedMessage {
  type: 'connector_started';
}

interface ConnectorChildStartErrorMessage {
  type: 'connector_start_error';
  message: string;
}

interface ConnectorChildEventMessage {
  type: 'connector_event';
  event: unknown;
}

const DEFAULT_MIDDLEWARE_AGENT_REQUEST_TIMEOUT_MS = 15_000;
const EXTENSION_AGENT_CALL_SOURCE = 'extension-middleware';
const AGENT_CALL_STACK_METADATA_KEY = '__goondanAgentCallStack';

interface RunnerArguments {
  bundlePath: string;
  instanceKey: string;
  stateRoot: string;
  swarmName?: string;
  watch: boolean;
}

interface EnvRequirement {
  envName: string;
  resourceId: string;
}

interface SwarmAgentRef {
  name: string;
  packageName?: string;
}

interface SelectedSwarm {
  name: string;
  instanceKey: string;
  packageName?: string;
  entryAgent: SwarmAgentRef;
  agents: SwarmAgentRef[];
}

interface IngressRouteRule {
  eventName?: string;
  properties?: Record<string, string>;
  agent?: SwarmAgentRef;
  instanceKey?: string;
  instanceKeyProperty?: string;
  instanceKeyPrefix?: string;
}

interface ConnectorRunPlan {
  swarmName: string;
  connectionName: string;
  connectorName: string;
  connectorEntryPath: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
  routeRules: IngressRouteRule[];
  defaultAgent: SwarmAgentRef;
}

interface ToolHandlerMap {
  [exportName: string]: (ctx: unknown, input: unknown) => unknown;
}

interface RuntimeExtensionSpec {
  entry: string;
  config?: Record<string, unknown>;
}

interface AgentRuntimePlan {
  name: string;
  modelName: string;
  provider: string;
  apiKey: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  maxSteps: number;
  requiredToolNames: string[];
  toolCatalog: ToolCatalogItem[];
  extensionResources: RuntimeResource<RuntimeExtensionSpec>[];
}

interface RunnerPlan {
  selectedSwarm: SelectedSwarm;
  connectors: ConnectorRunPlan[];
  agents: Map<string, AgentRuntimePlan>;
  toolExecutor: ToolExecutor;
  watchTargets: string[];
  localPackageName?: string;
}

interface RuntimeInboundEvent {
  sourceKind: 'connector' | 'agent';
  sourceName: string;
  eventName: string;
  instanceKey: string;
  messageText: string;
  properties: Record<string, string>;
  metadata?: JsonObject;
}

interface SpawnedAgentRecord {
  target: string;
  instanceKey: string;
  ownerAgent: string;
  ownerInstanceKey: string;
  createdAt: string;
  cwd?: string;
}

interface RunningConnector {
  connectionName: string;
  connectorName: string;
  wait: Promise<void>;
  terminate: () => Promise<void>;
}

interface RuntimeEngineState {
  executionQueue: Map<string, Promise<void>>;
  initializedInstances: Set<string>;
  storage: FileWorkspaceStorage;
  workdir: string;
  runnerArgs: RunnerArguments;
  spawnedAgentsByOwner: Map<string, Map<string, SpawnedAgentRecord>>;
  instanceWorkdirs: Map<string, string>;
  extensionEnvironments: Map<string, AgentExtensionEnvironment>;
  runtimeEventBus: RuntimeEventBusImpl;
  runtimeEventTurnQueueKeys: Map<string, string>;
  restartRequestedReason?: string;
}

interface RuntimeEventPersistenceContext {
  storage: {
    appendRuntimeEvent: FileWorkspaceStorage['appendRuntimeEvent'];
  };
  runtimeEventBus: RuntimeEventBusImpl;
  runtimeEventTurnQueueKeys: Map<string, string>;
}

interface AgentExtensionEnvironment {
  readonly pipelineRegistry: PipelineRegistryImpl;
  readonly extensionToolRegistry: ToolRegistryImpl;
  readonly extensionToolExecutor: ToolExecutor;
  readonly extensionStateManager: ExtensionStateManagerImpl;
  initialized: boolean;
}

interface ToolRegistrationResult {
  entryPath: string;
  catalogItems: ToolCatalogItem[];
}

interface ToolUseBlock {
  id: string;
  name: string;
  input: JsonObject;
}

type RunnerToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: JsonValue };

interface ModelStepParseResult {
  assistantContent: unknown[];
  textBlocks: string[];
  toolUseBlocks: ToolUseBlock[];
}

interface TurnExecutionResult {
  responseText: string;
  restartRequested: boolean;
  restartReason?: string;
  nextConversation: ConversationTurn[];
}

const ORCHESTRATOR_PROCESS_NAME = 'orchestrator';
const REPLACEMENT_STARTUP_TIMEOUT_MS = 5000;
const CONNECTOR_CHILD_STARTUP_TIMEOUT_MS = 5000;
const CONNECTOR_CHILD_SHUTDOWN_TIMEOUT_MS = 2000;
const RESTART_FLAG_KEYS = ['restartRequested', 'runtimeRestart', '__goondanRestart'] as const;

function isRunnerReadyMessage(message: unknown): message is RunnerReadyMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return message.type === 'ready' && typeof message.instanceKey === 'string' && typeof message.pid === 'number';
}

function isRunnerStartErrorMessage(message: unknown): message is RunnerStartErrorMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return message.type === 'start_error' && typeof message.message === 'string';
}

function isConnectorChildStartedMessage(message: unknown): message is ConnectorChildStartedMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return message.type === 'connector_started';
}

function isConnectorChildStartErrorMessage(message: unknown): message is ConnectorChildStartErrorMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return message.type === 'connector_start_error' && typeof message.message === 'string';
}

function isConnectorChildEventMessage(message: unknown): message is ConnectorChildEventMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return message.type === 'connector_event' && Object.hasOwn(message, 'event');
}

function readRuntimeRestartSignal(value: unknown): { requested: boolean; reason?: string } | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  for (const key of RESTART_FLAG_KEYS) {
    if (value[key] === true) {
      const reasonValue = value.restartReason;
      return {
        requested: true,
        reason: typeof reasonValue === 'string' && reasonValue.trim().length > 0 ? reasonValue.trim() : undefined,
      };
    }
  }

  return undefined;
}

function resolveProcessLogPaths(stateRoot: string, instanceKey: string, processName: string): { stdoutPath: string; stderrPath: string } {
  const logDir = path.join(stateRoot, 'runtime', 'logs', instanceKey);
  return {
    stdoutPath: path.join(logDir, `${processName}.stdout.log`),
    stderrPath: path.join(logDir, `${processName}.stderr.log`),
  };
}

function closeFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // 이미 닫힌 fd는 무시한다.
  }
}

function killIfRunning(pid: number | undefined): void {
  if (!pid || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // 이미 종료된 프로세스는 무시한다.
  }
}

async function waitForReplacementRunnerReady(
  child: ChildProcess,
  instanceKey: string,
  startupTimeoutMs: number,
  logPaths: { stdoutPath: string; stderrPath: string },
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    const fail = (message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`${message} (logs: ${logPaths.stdoutPath}, ${logPaths.stderrPath})`));
    };

    const succeed = (pid: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(pid);
    };

    const timeout = setTimeout(() => {
      killIfRunning(child.pid);
      fail('replacement Orchestrator 시작 확인이 시간 내에 완료되지 않았습니다.');
    }, startupTimeoutMs);

    const onMessage = (message: unknown): void => {
      if (isRunnerReadyMessage(message)) {
        if (message.instanceKey !== instanceKey) {
          fail(`replacement Orchestrator instanceKey 불일치: expected=${instanceKey}, actual=${message.instanceKey}`);
          return;
        }

        succeed(message.pid);
        return;
      }

      if (isRunnerStartErrorMessage(message)) {
        fail(`replacement Orchestrator 시작 실패: ${message.message}`);
      }
    };

    const onError = (error: Error): void => {
      fail(`replacement Orchestrator 프로세스 오류: ${error.message}`);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const cause = code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : 'unknown reason';
      fail(`replacement Orchestrator가 초기화 중 종료되었습니다 (${cause}).`);
    };

    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

async function writeActiveRuntimeState(input: {
  stateRoot: string;
  instanceKey: string;
  bundlePath: string;
  watch: boolean;
  swarmName?: string;
  pid: number;
  logPaths: { stdoutPath: string; stderrPath: string };
}): Promise<void> {
  const runtimeDir = path.join(input.stateRoot, 'runtime');
  await mkdir(runtimeDir, { recursive: true });

  const state = {
    instanceKey: input.instanceKey,
    bundlePath: input.bundlePath,
    startedAt: new Date().toISOString(),
    watch: input.watch,
    swarm: input.swarmName,
    pid: input.pid,
    logs: [
      {
        process: ORCHESTRATOR_PROCESS_NAME,
        stdout: input.logPaths.stdoutPath,
        stderr: input.logPaths.stderrPath,
      },
    ],
  };

  await writeFile(path.join(runtimeDir, 'active.json'), JSON.stringify(state, null, 2), 'utf8');
}

async function spawnReplacementRunner(input: {
  runnerModulePath: string;
  runnerArgs: string[];
  stateRoot: string;
  instanceKey: string;
  bundlePath: string;
  watch: boolean;
  swarmName?: string;
  env: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
}): Promise<number> {
  const logPaths = resolveProcessLogPaths(input.stateRoot, input.instanceKey, ORCHESTRATOR_PROCESS_NAME);
  await mkdir(path.dirname(logPaths.stdoutPath), { recursive: true });
  const stdoutFd = openSync(logPaths.stdoutPath, 'a');
  const stderrFd = openSync(logPaths.stderrPath, 'a');

  let child: ChildProcess;
  try {
    child = fork(input.runnerModulePath, input.runnerArgs, {
      cwd: path.dirname(input.bundlePath),
      detached: true,
      env: {
        ...input.env,
        GOONDAN_STATE_ROOT: input.stateRoot,
      },
      stdio: ['ignore', stdoutFd, stderrFd, 'ipc'],
    });
  } finally {
    closeFd(stdoutFd);
    closeFd(stderrFd);
  }

  if (!child.pid || child.pid <= 0) {
    throw new Error('replacement Orchestrator 프로세스를 시작하지 못했습니다.');
  }

  const pid = await waitForReplacementRunnerReady(
    child,
    input.instanceKey,
    input.startupTimeoutMs ?? REPLACEMENT_STARTUP_TIMEOUT_MS,
    logPaths,
  ).catch((error: unknown) => {
    killIfRunning(child.pid);
    throw error;
  });

  if (child.connected) {
    child.disconnect();
  }
  child.unref();

  await writeActiveRuntimeState({
    stateRoot: input.stateRoot,
    instanceKey: input.instanceKey,
    bundlePath: input.bundlePath,
    watch: input.watch,
    swarmName: input.swarmName,
    pid,
    logPaths,
  });

  return pid;
}

function upsertRunnerOption(argv: string[], option: string, value: string): string[] {
  const next: string[] = [];
  let replaced = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === option) {
      if (!replaced) {
        next.push(option, value);
        replaced = true;
      }
      index += 1;
      continue;
    }

    const prefixed = `${option}=`;
    if (token.startsWith(prefixed)) {
      if (!replaced) {
        next.push(option, value);
        replaced = true;
      }
      continue;
    }

    next.push(token);
  }

  if (!replaced) {
    next.push(option, value);
  }

  return next;
}

function parseRunnerArguments(argv: string[]): RunnerArguments {
  let bundlePath: string | undefined;
  let instanceKey: string | undefined;
  let stateRoot: string | undefined;
  let swarmName: string | undefined;
  let watch = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === '--bundle-path') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--bundle-path 옵션 값이 필요합니다.');
      }
      bundlePath = value;
      index += 1;
      continue;
    }

    if (arg === '--instance-key') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--instance-key 옵션 값이 필요합니다.');
      }
      instanceKey = value;
      index += 1;
      continue;
    }

    if (arg === '--state-root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--state-root 옵션 값이 필요합니다.');
      }
      stateRoot = value;
      index += 1;
      continue;
    }

    if (arg === '--swarm') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--swarm 옵션 값이 필요합니다.');
      }
      swarmName = value;
      index += 1;
      continue;
    }

    if (arg === '--watch') {
      watch = true;
      continue;
    }

    throw new Error(`지원하지 않는 runtime-runner 옵션입니다: ${arg}`);
  }

  if (!bundlePath) {
    throw new Error('bundlePath가 필요합니다.');
  }
  if (!instanceKey) {
    throw new Error('instanceKey가 필요합니다.');
  }
  if (!stateRoot) {
    throw new Error('stateRoot가 필요합니다.');
  }

  return {
    bundlePath: path.resolve(bundlePath),
    instanceKey,
    stateRoot: path.resolve(stateRoot),
    swarmName,
    watch,
  };
}

function sendMessage(message: RunnerMessage): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

async function existsFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readSpecRecord(resource: RuntimeResource): Record<string, unknown> {
  if (!isJsonObject(resource.spec)) {
    throw new Error(`${resource.kind}/${resource.metadata.name} spec 형식이 잘못되었습니다.`);
  }
  return resource.spec;
}

function collectEnvRequirements(resources: RuntimeResource[]): EnvRequirement[] {
  const requirements: EnvRequirement[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, resourceId: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, resourceId);
      }
      return;
    }

    if (!isJsonObject(value)) {
      return;
    }

    const valueFrom = value.valueFrom;
    if (isJsonObject(valueFrom) && typeof valueFrom.env === 'string' && valueFrom.env.trim().length > 0) {
      const envName = valueFrom.env.trim();
      const identity = `${resourceId}:${envName}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        requirements.push({
          envName,
          resourceId,
        });
      }
    }

    for (const nested of Object.values(value)) {
      visit(nested, resourceId);
    }
  };

  for (const resource of resources) {
    const resourceId = `${resource.kind}/${resource.metadata.name}`;
    visit(resource.spec, resourceId);
  }

  return requirements;
}

function summarizeMissingEnv(requirements: EnvRequirement[], env: NodeJS.ProcessEnv): string | undefined {
  const missingByEnv = new Map<string, EnvRequirement>();

  for (const requirement of requirements) {
    const value = env[requirement.envName];
    if (typeof value === 'string' && value.trim().length > 0) {
      continue;
    }

    if (!missingByEnv.has(requirement.envName)) {
      missingByEnv.set(requirement.envName, requirement);
    }
  }

  if (missingByEnv.size === 0) {
    return undefined;
  }

  const detail = [...missingByEnv.values()]
    .map((item) => `${item.envName} (${item.resourceId})`)
    .join(', ');
  return `필수 환경 변수가 없습니다: ${detail}`;
}

function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((error) => {
      const parts = [error.code, error.path, error.message].filter((part) => part.trim().length > 0);
      return parts.join(' | ');
    })
    .join('\n');
}

function isObjectRefLike(value: unknown): value is ObjectRefLike {
  if (typeof value === 'string') {
    return true;
  }

  if (!isJsonObject(value)) {
    return false;
  }

  if (typeof value.kind !== 'string' || typeof value.name !== 'string') {
    return false;
  }

  if ('package' in value && value.package !== undefined && typeof value.package !== 'string') {
    return false;
  }

  if ('apiVersion' in value && value.apiVersion !== undefined && typeof value.apiVersion !== 'string') {
    return false;
  }

  return true;
}

function extractRefLike(value: unknown): ObjectRefLike | undefined {
  if (isObjectRefLike(value)) {
    return value;
  }

  if (!isJsonObject(value)) {
    return undefined;
  }

  const ref = value.ref;
  if (isObjectRefLike(ref)) {
    return ref;
  }

  return undefined;
}

function resolveConnectorCandidates(baseDir: string, entry: string): string[] {
  const normalizedEntry = entry.startsWith('./') ? entry.slice(2) : entry;
  const directPath = path.resolve(baseDir, normalizedEntry);
  const candidates: string[] = [];

  if (directPath.endsWith('.ts')) {
    if (normalizedEntry.startsWith('src/')) {
      const distRelative = normalizedEntry.replace(/^src\//, 'dist/src/').replace(/\.ts$/, '.js');
      candidates.push(path.resolve(baseDir, distRelative));
    }

    const directJs = directPath.slice(0, -3) + '.js';
    candidates.push(directJs);
    candidates.push(directPath);
  } else {
    candidates.push(directPath);
  }

  const deduped = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    if (deduped.has(candidate)) {
      continue;
    }
    deduped.add(candidate);
    result.push(candidate);
  }
  return result;
}

async function resolveEntryPath(resource: RuntimeResource, fieldName: string): Promise<string> {
  const spec = readSpecRecord(resource);
  const entryValue = spec.entry;
  if (typeof entryValue !== 'string' || entryValue.trim().length === 0) {
    throw new Error(`${resource.kind}/${resource.metadata.name} spec.${fieldName}가 비어 있습니다.`);
  }

  const rootDir = resource.__rootDir ? path.resolve(resource.__rootDir) : process.cwd();
  const candidates = resolveConnectorCandidates(rootDir, entryValue.trim());
  for (const candidate of candidates) {
    if (await existsFile(candidate)) {
      return candidate;
    }
  }

  const listed = candidates.join(', ');
  throw new Error(`${resource.kind}/${resource.metadata.name} entry 파일을 찾을 수 없습니다: ${listed}`);
}

function selectReferencedResource(
  resources: RuntimeResource[],
  ref: ObjectRefLike,
  expectedKind: RuntimeResource['kind'],
  ownerPackageName: string | undefined,
  selectedSwarmPackage: string | undefined,
): RuntimeResource {
  const normalized = normalizeObjectRef(ref);
  if (normalized.kind !== expectedKind) {
    throw new Error(`참조 kind 불일치: expected=${expectedKind}, actual=${normalized.kind}`);
  }

  const candidates = resources.filter(
    (resource) => resource.kind === expectedKind && resource.metadata.name === normalized.name,
  );
  if (candidates.length === 0) {
    throw new Error(`${expectedKind}/${normalized.name} 리소스를 찾지 못했습니다.`);
  }

  if (normalized.package) {
    const byPackage = candidates.find((resource) => resource.__package === normalized.package);
    if (!byPackage) {
      throw new Error(`${expectedKind}/${normalized.name} (${normalized.package}) 리소스를 찾지 못했습니다.`);
    }
    return byPackage;
  }

  if (ownerPackageName) {
    const byOwnerPackage = candidates.find((resource) => resource.__package === ownerPackageName);
    if (byOwnerPackage) {
      return byOwnerPackage;
    }
  }

  if (selectedSwarmPackage) {
    const bySwarmPackage = candidates.find((resource) => resource.__package === selectedSwarmPackage);
    if (bySwarmPackage) {
      return bySwarmPackage;
    }
  }

  if (candidates.length === 1) {
    const single = candidates[0];
    if (!single) {
      throw new Error(`${expectedKind}/${normalized.name} 단일 후보를 선택할 수 없습니다.`);
    }
    return single;
  }

  const packageNames = candidates.map((candidate) => candidate.__package ?? '<local>').join(', ');
  throw new Error(
    `${expectedKind}/${normalized.name} 후보가 여러 개여서 선택할 수 없습니다. package를 명시하세요. candidates: ${packageNames}`,
  );
}

function parseSwarmAgentRef(value: unknown): SwarmAgentRef {
  const ref = extractRefLike(value);
  if (!ref) {
    throw new Error('Swarm Agent ref 형식이 올바르지 않습니다.');
  }

  const normalized = normalizeObjectRef(ref);
  if (normalized.kind !== 'Agent') {
    throw new Error(`Swarm agents는 Agent를 가리켜야 합니다: ${normalized.kind}/${normalized.name}`);
  }

  return {
    name: normalized.name,
    packageName: normalized.package,
  };
}

function parseSwarmSelection(
  resources: RuntimeResource[],
  requestedName: string | undefined,
): { swarmResource: RuntimeResource; selectedSwarm: SelectedSwarm } {
  const swarms = resources.filter((resource) => resource.kind === 'Swarm');
  if (swarms.length === 0) {
    throw new Error('Swarm 리소스를 찾지 못했습니다.');
  }

  let swarmResource: RuntimeResource | undefined;
  if (requestedName) {
    swarmResource = swarms.find((swarm) => swarm.metadata.name === requestedName);
    if (!swarmResource) {
      throw new Error(`Swarm '${requestedName}'을(를) 찾지 못했습니다.`);
    }
  } else {
    const defaultSwarm = swarms.find((swarm) => swarm.metadata.name === 'default');
    if (defaultSwarm) {
      swarmResource = defaultSwarm;
    } else if (swarms.length === 1) {
      swarmResource = swarms[0];
    } else {
      const names = swarms.map((swarm) => swarm.metadata.name).join(', ');
      throw new Error(`실행할 Swarm을 선택할 수 없습니다. --swarm 옵션을 지정하세요. candidates: ${names}`);
    }
  }

  if (!swarmResource) {
    throw new Error('Swarm을 선택할 수 없습니다.');
  }

  const spec = readSpecRecord(swarmResource);
  const entryAgent = parseSwarmAgentRef(spec.entryAgent);
  const instanceKey = parseSwarmInstanceKey(swarmResource, spec);

  const rawAgents = spec.agents;
  if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
    throw new Error(`Swarm/${swarmResource.metadata.name} spec.agents가 비어 있습니다.`);
  }

  const agents: SwarmAgentRef[] = rawAgents.map((item) => parseSwarmAgentRef(item));
  if (!agents.some((agent) => agent.name === entryAgent.name && agent.packageName === entryAgent.packageName)) {
    agents.push(entryAgent);
  }

  return {
    swarmResource,
    selectedSwarm: {
      name: swarmResource.metadata.name,
      instanceKey,
      packageName: swarmResource.__package,
      entryAgent,
      agents,
    },
  };
}

function parseSwarmInstanceKey(swarmResource: RuntimeResource, spec: Record<string, unknown>): string {
  const configured = spec.instanceKey;
  if (configured === undefined) {
    return swarmResource.metadata.name;
  }

  if (typeof configured !== 'string' || configured.trim().length === 0) {
    throw new Error(`Swarm/${swarmResource.metadata.name} spec.instanceKey는 비어 있지 않은 문자열이어야 합니다.`);
  }

  return configured.trim();
}

function hasMatchingSwarm(resource: RuntimeResource, selectedSwarm: SelectedSwarm): boolean {
  const spec = readSpecRecord(resource);
  const swarmRef = spec.swarmRef;
  if (swarmRef === undefined) {
    return true;
  }

  if (!isObjectRefLike(swarmRef)) {
    throw new Error(`Connection/${resource.metadata.name} spec.swarmRef 형식이 올바르지 않습니다.`);
  }

  const normalized = normalizeObjectRef(swarmRef);
  if (normalized.kind !== 'Swarm') {
    throw new Error(`Connection/${resource.metadata.name} spec.swarmRef는 Swarm을 가리켜야 합니다.`);
  }

  if (normalized.package && selectedSwarm.packageName && normalized.package !== selectedSwarm.packageName) {
    return false;
  }

  return normalized.name === selectedSwarm.name;
}

function normalizeEnvToken(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
    .toUpperCase();
}

function parseSecretRefName(refValue: string): string | undefined {
  const trimmedRef = refValue.trim();
  const match = /^Secret\/([^/]+)$/.exec(trimmedRef);
  if (!match) {
    return undefined;
  }

  const secretName = match[1];
  if (!secretName) {
    return undefined;
  }

  const trimmedName = secretName.trim();
  if (trimmedName.length === 0) {
    return undefined;
  }

  return trimmedName;
}

function buildSecretRefEnvCandidates(secretName: string, fieldName: string, keyName: string): string[] {
  const secretToken = normalizeEnvToken(secretName);
  const fieldToken = normalizeEnvToken(fieldName);
  const keyToken = normalizeEnvToken(keyName);

  const candidates = [
    `GOONDAN_SECRET_${secretToken}_${keyToken}`,
    `GOONDAN_SECRET_${secretToken}_${fieldToken}`,
    `GOONDAN_SECRET_${secretToken}`,
    `SECRET_${secretToken}_${keyToken}`,
    `SECRET_${secretToken}_${fieldToken}`,
    `SECRET_${secretToken}`,
  ];

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    deduped.push(candidate);
  }
  return deduped;
}

function resolveSecretRefValue(
  connectionName: string,
  sectionName: 'config' | 'secret',
  fieldName: string,
  secretRef: unknown,
  env: NodeJS.ProcessEnv,
): string {
  if (!isJsonObject(secretRef)) {
    throw new Error(
      `Connection/${connectionName} ${sectionName} '${fieldName}' valueFrom.secretRef 형식이 올바르지 않습니다.`,
    );
  }

  const refValue = secretRef.ref;
  if (typeof refValue !== 'string' || refValue.trim().length === 0) {
    throw new Error(
      `Connection/${connectionName} ${sectionName} '${fieldName}' valueFrom.secretRef.ref 형식이 올바르지 않습니다.`,
    );
  }

  const secretName = parseSecretRefName(refValue);
  if (!secretName) {
    throw new Error(
      `Connection/${connectionName} ${sectionName} '${fieldName}' valueFrom.secretRef.ref(${refValue})는 Secret/<name> 형식이어야 합니다.`,
    );
  }

  const keyValue = secretRef.key;
  let keyName = fieldName;
  if (keyValue !== undefined) {
    if (typeof keyValue !== 'string' || keyValue.trim().length === 0) {
      throw new Error(
        `Connection/${connectionName} ${sectionName} '${fieldName}' valueFrom.secretRef.key 형식이 올바르지 않습니다.`,
      );
    }
    keyName = keyValue.trim();
  }

  const envCandidates = buildSecretRefEnvCandidates(secretName, fieldName, keyName);
  if (envCandidates.length === 0) {
    throw new Error(
      `Connection/${connectionName} ${sectionName} '${fieldName}' secretRef(ref=${refValue}, key=${keyName}) env 후보를 생성할 수 없습니다.`,
    );
  }

  for (const envName of envCandidates) {
    const envValue = env[envName];
    if (typeof envValue === 'string' && envValue.trim().length > 0) {
      return envValue;
    }
  }

  throw new Error(
    `Connection/${connectionName} ${sectionName} '${fieldName}' secretRef(ref=${refValue}, key=${keyName}) 값을 해석할 수 없습니다. env candidates: ${envCandidates.join(', ')}`,
  );
}

function resolveConnectionValue(
  connectionName: string,
  sectionName: 'config' | 'secret',
  fieldName: string,
  source: unknown,
  env: NodeJS.ProcessEnv,
): string {
  if (!isJsonObject(source)) {
    throw new Error(`Connection/${connectionName} ${sectionName} '${fieldName}' 형식이 올바르지 않습니다.`);
  }

  const inlineValue = source.value;
  const valueFrom = source.valueFrom;
  const hasInlineValue = typeof inlineValue === 'string';
  const hasValueFrom = isJsonObject(valueFrom);

  if (hasInlineValue && hasValueFrom) {
    throw new Error(
      `Connection/${connectionName} ${sectionName} '${fieldName}'는 value와 valueFrom을 동시에 가질 수 없습니다.`,
    );
  }

  if (hasInlineValue) {
    return inlineValue;
  }

  if (!hasValueFrom) {
    throw new Error(
      `Connection/${connectionName} ${sectionName} '${fieldName}'는 value 또는 valueFrom이 필요합니다.`,
    );
  }

  const envNameValue = valueFrom.env;
  const secretRefValue = valueFrom.secretRef;
  const hasEnv = typeof envNameValue === 'string';
  const hasSecretRef = secretRefValue !== undefined;

  if (hasEnv && hasSecretRef) {
    throw new Error(
      `Connection/${connectionName} ${sectionName} '${fieldName}'는 valueFrom.env와 valueFrom.secretRef를 동시에 가질 수 없습니다.`,
    );
  }

  if (hasEnv) {
    const envName = envNameValue.trim();
    if (envName.length === 0) {
      throw new Error(
        `Connection/${connectionName} ${sectionName} '${fieldName}' valueFrom.env 형식이 올바르지 않습니다.`,
      );
    }

    const envValue = env[envName];
    if (typeof envValue !== 'string' || envValue.trim().length === 0) {
      throw new Error(
        `Connection/${connectionName} ${sectionName} '${fieldName}' env(${envName}) 값을 찾을 수 없습니다.`,
      );
    }

    return envValue;
  }

  if (hasSecretRef) {
    return resolveSecretRefValue(connectionName, sectionName, fieldName, secretRefValue, env);
  }

  throw new Error(
    `Connection/${connectionName} ${sectionName} '${fieldName}'는 valueFrom.env 또는 valueFrom.secretRef가 필요합니다.`,
  );
}

function resolveConnectionSecrets(resource: RuntimeResource, env: NodeJS.ProcessEnv): Record<string, string> {
  const spec = readSpecRecord(resource);
  const value = spec.secrets;
  if (value === undefined) {
    return {};
  }

  if (!isJsonObject(value)) {
    throw new Error(`Connection/${resource.metadata.name} spec.secrets 형식이 올바르지 않습니다.`);
  }

  const secrets: Record<string, string> = {};
  for (const [secretName, source] of Object.entries(value)) {
    secrets[secretName] = resolveConnectionValue(resource.metadata.name, 'secret', secretName, source, env);
  }

  return secrets;
}

function resolveConnectionConfig(resource: RuntimeResource, env: NodeJS.ProcessEnv): Record<string, string> {
  const spec = readSpecRecord(resource);
  const value = spec.config;
  if (value === undefined) {
    return {};
  }

  if (!isJsonObject(value)) {
    throw new Error(`Connection/${resource.metadata.name} spec.config 형식이 올바르지 않습니다.`);
  }

  const config: Record<string, string> = {};
  for (const [secretName, source] of Object.entries(value)) {
    config[secretName] = resolveConnectionValue(resource.metadata.name, 'config', secretName, source, env);
  }

  return config;
}

function parseIngressRouteRules(
  connection: RuntimeResource,
  selectedSwarm: SelectedSwarm,
): IngressRouteRule[] {
  const spec = readSpecRecord(connection);
  const ingress = spec.ingress;
  if (ingress === undefined) {
    return [];
  }

  if (!isJsonObject(ingress)) {
    throw new Error(`Connection/${connection.metadata.name} spec.ingress 형식이 올바르지 않습니다.`);
  }

  const rulesValue = ingress.rules;
  if (rulesValue === undefined) {
    return [];
  }

  if (!Array.isArray(rulesValue)) {
    throw new Error(`Connection/${connection.metadata.name} spec.ingress.rules 형식이 올바르지 않습니다.`);
  }

  const rules: IngressRouteRule[] = [];
  for (const ruleValue of rulesValue) {
    if (!isJsonObject(ruleValue)) {
      throw new Error(`Connection/${connection.metadata.name} ingress rule 형식이 올바르지 않습니다.`);
    }

    const matchValue = ruleValue.match;
    let eventName: string | undefined;
    let properties: Record<string, string> | undefined;

    if (matchValue !== undefined) {
      if (!isJsonObject(matchValue)) {
        throw new Error(`Connection/${connection.metadata.name} ingress.match 형식이 올바르지 않습니다.`);
      }

      if (typeof matchValue.event === 'string' && matchValue.event.trim().length > 0) {
        eventName = matchValue.event;
      }

      if (isJsonObject(matchValue.properties)) {
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(matchValue.properties)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            normalized[key] = String(value);
          }
        }
        properties = Object.keys(normalized).length > 0 ? normalized : undefined;
      }
    }

    const routeValue = ruleValue.route;
    if (!isJsonObject(routeValue)) {
      throw new Error(`Connection/${connection.metadata.name} ingress.route 형식이 올바르지 않습니다.`);
    }

    let agent: SwarmAgentRef | undefined;
    if (routeValue.agentRef !== undefined) {
      const agentRef = extractRefLike(routeValue.agentRef);
      if (!agentRef) {
        throw new Error(`Connection/${connection.metadata.name} ingress.route.agentRef 형식이 올바르지 않습니다.`);
      }
      const normalized = normalizeObjectRef(agentRef);
      if (normalized.kind !== 'Agent') {
        throw new Error(`Connection/${connection.metadata.name} ingress.route.agentRef는 Agent를 가리켜야 합니다.`);
      }

      const found = selectedSwarm.agents.find(
        (item) => item.name === normalized.name && (normalized.package ? item.packageName === normalized.package : true),
      );
      if (!found) {
        throw new Error(
          `Connection/${connection.metadata.name} ingress.route.agentRef(${normalized.name})가 Swarm agents에 없습니다.`,
        );
      }

      agent = {
        name: normalized.name,
        packageName: normalized.package,
      };
    }

    let instanceKey: string | undefined;
    if (routeValue.instanceKey !== undefined) {
      const value = readStringValue(routeValue, 'instanceKey');
      if (!value || value.trim().length === 0) {
        throw new Error(`Connection/${connection.metadata.name} ingress.route.instanceKey 형식이 올바르지 않습니다.`);
      }
      instanceKey = value.trim();
    }

    let instanceKeyProperty: string | undefined;
    if (routeValue.instanceKeyProperty !== undefined) {
      const value = readStringValue(routeValue, 'instanceKeyProperty');
      if (!value || value.trim().length === 0) {
        throw new Error(
          `Connection/${connection.metadata.name} ingress.route.instanceKeyProperty 형식이 올바르지 않습니다.`,
        );
      }
      instanceKeyProperty = value.trim();
    }

    let instanceKeyPrefix: string | undefined;
    if (routeValue.instanceKeyPrefix !== undefined) {
      const value = readStringValue(routeValue, 'instanceKeyPrefix');
      if (value === undefined) {
        throw new Error(
          `Connection/${connection.metadata.name} ingress.route.instanceKeyPrefix 형식이 올바르지 않습니다.`,
        );
      }
      instanceKeyPrefix = value;
    }

    if (instanceKey && instanceKeyProperty) {
      throw new Error(
        `Connection/${connection.metadata.name} ingress.route.instanceKey와 instanceKeyProperty는 동시에 지정할 수 없습니다.`,
      );
    }

    rules.push({
      eventName,
      properties,
      agent,
      instanceKey,
      instanceKeyProperty,
      instanceKeyPrefix,
    });
  }

  return rules;
}

function readStringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function readNumberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function resolveModelApiKey(modelSpec: Record<string, unknown>, env: NodeJS.ProcessEnv, modelName: string): string {
  const apiKey = modelSpec.apiKey;
  if (!isJsonObject(apiKey)) {
    throw new Error(`Model/${modelName} spec.apiKey 형식이 올바르지 않습니다.`);
  }

  if (typeof apiKey.value === 'string' && apiKey.value.trim().length > 0) {
    return apiKey.value;
  }

  const valueFrom = apiKey.valueFrom;
  if (!isJsonObject(valueFrom) || typeof valueFrom.env !== 'string' || valueFrom.env.trim().length === 0) {
    throw new Error(`Model/${modelName} spec.apiKey.valueFrom.env가 필요합니다.`);
  }

  const envValue = env[valueFrom.env];
  if (typeof envValue !== 'string' || envValue.trim().length === 0) {
    throw new Error(`Model/${modelName} API key env(${valueFrom.env}) 값을 찾을 수 없습니다.`);
  }

  return envValue;
}

function isJsonLiteral(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function parseJsonSchemaProperty(value: unknown): JsonSchemaProperty | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const result: JsonSchemaProperty = {};

  if (typeof value.type === 'string') {
    result.type = value.type;
  } else if (Array.isArray(value.type) && value.type.every((item) => typeof item === 'string')) {
    result.type = [...value.type];
  }

  if (typeof value.description === 'string') {
    result.description = value.description;
  }

  if (Array.isArray(value.enum)) {
    const enumValues: JsonValue[] = [];
    for (const item of value.enum) {
      if (isJsonLiteral(item)) {
        enumValues.push(item);
      }
    }

    if (enumValues.length > 0) {
      result.enum = enumValues;
    }
  }

  if (isJsonObject(value.properties)) {
    const properties: Record<string, JsonSchemaProperty> = {};
    for (const [key, child] of Object.entries(value.properties)) {
      const parsedChild = parseJsonSchemaProperty(child);
      if (parsedChild) {
        properties[key] = parsedChild;
      }
    }
    if (Object.keys(properties).length > 0) {
      result.properties = properties;
    }
  }

  if (value.items !== undefined) {
    const parsedItems = parseJsonSchemaProperty(value.items);
    if (parsedItems) {
      result.items = parsedItems;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseJsonSchemaObject(value: unknown): JsonSchemaObject | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const type = value.type;
  if (type !== 'object') {
    return undefined;
  }

  const result: JsonSchemaObject = {
    type: 'object',
  };

  if (isJsonObject(value.properties)) {
    const parsedProps: Record<string, JsonSchemaProperty> = {};
    for (const [key, rawProp] of Object.entries(value.properties)) {
      const parsedProp = parseJsonSchemaProperty(rawProp);
      if (parsedProp) {
        parsedProps[key] = parsedProp;
      }
    }

    if (Object.keys(parsedProps).length > 0) {
      result.properties = parsedProps;
    }
  }

  if (Array.isArray(value.required)) {
    const required = value.required.filter((item) => typeof item === 'string');
    if (required.length > 0) {
      result.required = required;
    }
  }

  if (typeof value.additionalProperties === 'boolean') {
    result.additionalProperties = value.additionalProperties;
  }

  return result;
}

function createDefaultObjectSchema(): JsonSchemaObject {
  return {
    type: 'object',
    properties: {},
  };
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function readToolHandlers(module: unknown): ToolHandlerMap | undefined {
  if (!isJsonObject(module)) {
    return undefined;
  }

  const handlersValue = module.handlers;
  if (!isJsonObject(handlersValue)) {
    return undefined;
  }

  const handlers: ToolHandlerMap = {};
  for (const [name, maybeHandler] of Object.entries(handlersValue)) {
    if (!isFunction(maybeHandler)) {
      continue;
    }

    handlers[name] = (ctx: unknown, input: unknown): unknown => maybeHandler(ctx, input);
  }

  return Object.keys(handlers).length > 0 ? handlers : undefined;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (isJsonObject(value)) {
    const converted: JsonObject = {};
    for (const [key, nested] of Object.entries(value)) {
      converted[key] = toJsonValue(nested);
    }
    return converted;
  }

  if (value === undefined) {
    return null;
  }

  return String(value);
}

function ensureJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) {
    return {};
  }

  const converted: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    converted[key] = toJsonValue(nested);
  }
  return converted;
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

async function readAgentSystemPrompt(agent: RuntimeResource): Promise<string> {
  const spec = readSpecRecord(agent);
  const prompts = spec.prompts;
  if (!isJsonObject(prompts)) {
    return '';
  }

  const inlineSystem = prompts.system;
  if (typeof inlineSystem === 'string') {
    return inlineSystem;
  }

  const legacySystemPrompt = prompts.systemPrompt;
  if (typeof legacySystemPrompt === 'string') {
    return legacySystemPrompt;
  }

  const systemRef = prompts.systemRef;
  if (typeof systemRef !== 'string' || systemRef.trim().length === 0) {
    return '';
  }

  const rootDir = agent.__rootDir ? path.resolve(agent.__rootDir) : process.cwd();
  const promptPath = path.resolve(rootDir, systemRef);
  const promptExists = await existsFile(promptPath);
  if (!promptExists) {
    throw new Error(`Agent/${agent.metadata.name} system prompt 파일을 찾을 수 없습니다: ${promptPath}`);
  }

  return await readFile(promptPath, 'utf8');
}

function parseAgentToolRefs(agent: RuntimeResource): ObjectRefLike[] {
  const spec = readSpecRecord(agent);
  const toolsValue = spec.tools;
  if (toolsValue === undefined) {
    return [];
  }

  if (!Array.isArray(toolsValue)) {
    throw new Error(`Agent/${agent.metadata.name} spec.tools 형식이 올바르지 않습니다.`);
  }

  const refs: ObjectRefLike[] = [];
  for (const item of toolsValue) {
    const ref = extractRefLike(item);
    if (!ref) {
      throw new Error(`Agent/${agent.metadata.name} tool ref 형식이 올바르지 않습니다.`);
    }

    refs.push(ref);
  }

  return refs;
}

function parseAgentExtensionRefs(agent: RuntimeResource): ObjectRefLike[] {
  const spec = readSpecRecord(agent);
  const extensionsValue = spec.extensions;
  if (extensionsValue === undefined) {
    return [];
  }

  if (!Array.isArray(extensionsValue)) {
    throw new Error(`Agent/${agent.metadata.name} spec.extensions 형식이 올바르지 않습니다.`);
  }

  const refs: ObjectRefLike[] = [];
  for (const item of extensionsValue) {
    const ref = extractRefLike(item);
    if (!ref) {
      throw new Error(`Agent/${agent.metadata.name} extension ref 형식이 올바르지 않습니다.`);
    }
    refs.push(ref);
  }

  return refs;
}

function toExtensionResource(resource: RuntimeResource): RuntimeResource<RuntimeExtensionSpec> {
  const spec = readSpecRecord(resource);
  const entry = readStringValue(spec, 'entry');
  if (!entry || entry.trim().length === 0) {
    throw new Error(`Extension/${resource.metadata.name} spec.entry 형식이 올바르지 않습니다.`);
  }

  let config: Record<string, unknown> | undefined;
  const configValue = spec.config;
  if (configValue !== undefined) {
    if (!isJsonObject(configValue)) {
      throw new Error(`Extension/${resource.metadata.name} spec.config 형식이 올바르지 않습니다.`);
    }
    config = { ...configValue };
  }

  return {
    ...resource,
    spec: {
      entry,
      config,
    },
  };
}

function parseAgentRequiredTools(agent: RuntimeResource): string[] {
  const spec = readSpecRecord(agent);
  const requiredToolsValue = spec.requiredTools;
  if (requiredToolsValue === undefined) {
    return [];
  }

  if (!Array.isArray(requiredToolsValue)) {
    throw new Error(`Agent/${agent.metadata.name} spec.requiredTools 형식이 올바르지 않습니다.`);
  }

  const names: string[] = [];
  for (const value of requiredToolsValue) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Agent/${agent.metadata.name} spec.requiredTools에는 비어있지 않은 문자열만 허용됩니다.`);
    }
    names.push(value.trim());
  }

  return [...new Set(names)];
}

async function registerToolResource(
  resource: RuntimeResource,
  toolRegistry: ToolRegistryImpl,
): Promise<ToolRegistrationResult> {
  const entryPath = await resolveEntryPath(resource, 'entry');
  const moduleValue: unknown = await import(pathToFileURL(entryPath).href);
  const handlers = readToolHandlers(moduleValue);
  if (!handlers) {
    throw new Error(`Tool/${resource.metadata.name} 모듈에 handlers export가 없습니다: ${entryPath}`);
  }

  const spec = readSpecRecord(resource);
  const exportsValue = spec.exports;
  if (!Array.isArray(exportsValue) || exportsValue.length === 0) {
    throw new Error(`Tool/${resource.metadata.name} spec.exports가 비어 있습니다.`);
  }

  const catalogItems: ToolCatalogItem[] = [];

  for (const exportItem of exportsValue) {
    if (!isJsonObject(exportItem)) {
      continue;
    }

    const exportName = readStringValue(exportItem, 'name');
    if (!exportName) {
      continue;
    }

    const handler = handlers[exportName];
    if (!handler) {
      throw new Error(`Tool/${resource.metadata.name} handlers.${exportName}를 찾을 수 없습니다.`);
    }

    const toolName = buildToolName(resource.metadata.name, exportName);
    const description = readStringValue(exportItem, 'description');
    const parameters = parseJsonSchemaObject(exportItem.parameters) ?? createDefaultObjectSchema();

    const catalogItem: ToolCatalogItem = {
      name: toolName,
      description,
      parameters,
      source: {
        type: 'config',
        name: resource.metadata.name,
      },
    };

    toolRegistry.register(catalogItem, async (ctx, input) => {
      const output = await Promise.resolve(handler(ctx, input));
      return toJsonValue(output);
    });

    catalogItems.push(catalogItem);
  }

  return {
    entryPath,
    catalogItems,
  };
}

function parseConnectionConnectorRef(connection: RuntimeResource): ObjectRefLike {
  const spec = readSpecRecord(connection);
  const connectorRef = spec.connectorRef;
  if (!isObjectRefLike(connectorRef)) {
    throw new Error(`Connection/${connection.metadata.name} spec.connectorRef 형식이 올바르지 않습니다.`);
  }

  return connectorRef;
}

function parseAgentModelRef(agent: RuntimeResource): ObjectRefLike {
  const spec = readSpecRecord(agent);
  const modelConfig = spec.modelConfig;
  if (!isJsonObject(modelConfig) || !isObjectRefLike(modelConfig.modelRef)) {
    throw new Error(`Agent/${agent.metadata.name} spec.modelConfig.modelRef 형식이 올바르지 않습니다.`);
  }

  return modelConfig.modelRef;
}

function parseAgentModelParams(agent: RuntimeResource): { maxTokens: number; temperature: number } {
  const spec = readSpecRecord(agent);
  const modelConfig = spec.modelConfig;
  if (!isJsonObject(modelConfig)) {
    return {
      maxTokens: 1000,
      temperature: 0.2,
    };
  }

  const params = modelConfig.params;
  if (!isJsonObject(params)) {
    return {
      maxTokens: 1000,
      temperature: 0.2,
    };
  }

  const maxTokens = parsePositiveInteger(readNumberValue(params, 'maxTokens'), 1000);
  const temperatureRaw = readNumberValue(params, 'temperature');
  const temperature =
    typeof temperatureRaw === 'number' && Number.isFinite(temperatureRaw) ? temperatureRaw : 0.2;

  return {
    maxTokens,
    temperature,
  };
}

function parseSwarmMaxStepsPerTurn(swarm: RuntimeResource): number {
  const spec = readSpecRecord(swarm);
  const policy = spec.policy;
  if (!isJsonObject(policy)) {
    return 24;
  }

  const maxStepsPerTurn = readNumberValue(policy, 'maxStepsPerTurn');
  if (typeof maxStepsPerTurn === 'number' && Number.isFinite(maxStepsPerTurn) && maxStepsPerTurn > 0) {
    return Math.floor(maxStepsPerTurn);
  }

  return 24;
}

function buildRuntimeAgentCatalog(
  runnerPlan: RunnerPlan,
  selfAgent: string,
): {
  swarmName: string;
  entryAgent: string;
  selfAgent: string;
  availableAgents: string[];
  callableAgents: string[];
} {
  const availableAgents = [...runnerPlan.agents.keys()].sort((left, right) => left.localeCompare(right));
  const callableAgents = availableAgents.filter((agentName) => agentName !== selfAgent);
  return {
    swarmName: runnerPlan.selectedSwarm.name,
    entryAgent: runnerPlan.selectedSwarm.entryAgent.name,
    selfAgent,
    availableAgents,
    callableAgents,
  };
}

function createAgentCallNode(agentName: string, instanceKey: string): string {
  return `${agentName}@${instanceKey}`;
}

function readAgentCallStack(metadata: JsonObject | undefined): string[] {
  if (!metadata) {
    return [];
  }

  const value = metadata[AGENT_CALL_STACK_METADATA_KEY];
  if (!Array.isArray(value)) {
    return [];
  }

  const stack: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      continue;
    }
    stack.push(item);
  }

  return stack;
}

function appendAgentCallStack(stack: string[], node: string): string[] {
  if (stack.includes(node)) {
    return [...stack];
  }
  return [...stack, node];
}

function withAgentCallStack(metadata: JsonObject | undefined, stack: string[]): JsonObject {
  const next: JsonObject = {};
  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      next[key] = value;
    }
  }
  next[AGENT_CALL_STACK_METADATA_KEY] = stack;
  return next;
}

function toMiddlewareAgentResponseText(response: JsonValue | undefined): string {
  if (typeof response === 'string') {
    return response;
  }
  if (response === undefined || response === null) {
    return '';
  }
  return safeJsonStringify(response);
}

function createMiddlewareAgentMetadata(input: {
  callerAgentName: string;
  callerInstanceKey: string;
  callerTurnId: string;
  inheritedMetadata: JsonObject | undefined;
  metadata: JsonObject | undefined;
}): JsonObject {
  const next: JsonObject = {};
  if (input.metadata) {
    for (const [key, value] of Object.entries(input.metadata)) {
      next[key] = value;
    }
  }

  const callerNode = createAgentCallNode(input.callerAgentName, input.callerInstanceKey);
  const inheritedStack = readAgentCallStack(input.inheritedMetadata);
  const callStack = appendAgentCallStack(inheritedStack, callerNode);

  next.callerAgent = input.callerAgentName;
  next.callerInstanceKey = input.callerInstanceKey;
  next.callerTurnId = input.callerTurnId;
  next.callSource = EXTENSION_AGENT_CALL_SOURCE;
  next[AGENT_CALL_STACK_METADATA_KEY] = callStack;

  return next;
}

function createMiddlewareAgentEvent(input: {
  callerAgentName: string;
  traceId: string;
  eventType: string;
  eventInput: string | undefined;
  targetInstanceKey: string;
  metadata: JsonObject;
  correlationId?: string;
}): AgentEvent {
  const event: AgentEvent = {
    id: createId('agent_event'),
    type: input.eventType,
    createdAt: new Date(),
    traceId: input.traceId,
    source: {
      kind: 'agent',
      name: input.callerAgentName,
    },
    input: input.eventInput,
    instanceKey: input.targetInstanceKey,
    metadata: input.metadata,
  };

  if (input.correlationId) {
    return {
      ...event,
      replyTo: {
        target: input.callerAgentName,
        correlationId: input.correlationId,
      },
    };
  }

  return event;
}

function normalizeMiddlewareTarget(target: string): string {
  const resolved = target.trim();
  if (resolved.length === 0) {
    throw new Error('ctx.agents 호출에는 target이 필요합니다.');
  }
  return resolved;
}

function normalizeMiddlewareInstanceKey(instanceKey: string | undefined, fallback: string): string {
  if (!instanceKey) {
    return fallback;
  }

  const resolved = instanceKey.trim();
  return resolved.length > 0 ? resolved : fallback;
}

function normalizeMiddlewareTimeoutMs(timeoutMs: number | undefined): number {
  if (
    typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    Number.isInteger(timeoutMs) &&
    timeoutMs > 0
  ) {
    return timeoutMs;
  }
  return DEFAULT_MIDDLEWARE_AGENT_REQUEST_TIMEOUT_MS;
}

function createMiddlewareAgentsApi(input: {
  runtime: AgentToolRuntime;
  callerAgentName: string;
  callerInstanceKey: string;
  callerTurnId: string;
  traceId: string;
  inboundMetadata: JsonObject | undefined;
}): MiddlewareAgentsApi {
  const resolveMetadata = (metadata: JsonObject | undefined): JsonObject =>
    createMiddlewareAgentMetadata({
      callerAgentName: input.callerAgentName,
      callerInstanceKey: input.callerInstanceKey,
      callerTurnId: input.callerTurnId,
      inheritedMetadata: input.inboundMetadata,
      metadata,
    });

  return {
    request: async (params: MiddlewareAgentRequestParams) => {
      const target = normalizeMiddlewareTarget(params.target);
      const targetInstanceKey = normalizeMiddlewareInstanceKey(params.instanceKey, input.callerInstanceKey);
      const timeoutMs = normalizeMiddlewareTimeoutMs(params.timeoutMs);
      const correlationId = createId('corr');
      const event = createMiddlewareAgentEvent({
        callerAgentName: input.callerAgentName,
        traceId: input.traceId,
        eventType: 'agent.request',
        eventInput: params.input,
        targetInstanceKey,
        metadata: resolveMetadata(params.metadata),
        correlationId,
      });

      const result = await input.runtime.request(target, event, { timeoutMs });
      return {
        target: result.target,
        response: toMiddlewareAgentResponseText(result.response),
      };
    },
    send: async (params: MiddlewareAgentSendParams) => {
      const target = normalizeMiddlewareTarget(params.target);
      const targetInstanceKey = normalizeMiddlewareInstanceKey(params.instanceKey, input.callerInstanceKey);
      const event = createMiddlewareAgentEvent({
        callerAgentName: input.callerAgentName,
        traceId: input.traceId,
        eventType: 'agent.send',
        eventInput: params.input,
        targetInstanceKey,
        metadata: resolveMetadata(params.metadata),
      });

      const result = await input.runtime.send(target, event);
      return {
        accepted: result.accepted,
      };
    },
  };
}

function mergeToolCatalog(
  baseCatalog: ToolCatalogItem[],
  extensionCatalog: ToolCatalogItem[],
): ToolCatalogItem[] {
  const merged: ToolCatalogItem[] = [];
  for (const item of baseCatalog) {
    if (!merged.some((candidate) => candidate.name === item.name)) {
      merged.push(item);
    }
  }
  for (const item of extensionCatalog) {
    if (!merged.some((candidate) => candidate.name === item.name)) {
      merged.push(item);
    }
  }
  return merged;
}

function isPathInside(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  if (relative.length === 0) {
    return true;
  }

  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function buildRunnerPlan(args: RunnerArguments): Promise<RunnerPlan> {
  const bundleDir = path.resolve(path.dirname(args.bundlePath));
  const loader = new BundleLoader({
    stateRoot: args.stateRoot,
  });
  const loaded = await loader.load(bundleDir);
  if (loaded.errors.length > 0) {
    throw new Error(formatValidationErrors(loaded.errors));
  }
  const localPackageNameCandidate = loaded.resources.find(
    (resource) => resource.kind === 'Package' && resource.__file === 'goondan.yaml',
  )?.metadata.name;
  if (typeof localPackageNameCandidate !== 'string' || localPackageNameCandidate.trim().length === 0) {
    throw new Error('goondan.yaml에 kind: Package 문서와 metadata.name이 필요합니다.');
  }
  const localPackageName = localPackageNameCandidate.trim();

  const { swarmResource, selectedSwarm } = parseSwarmSelection(loaded.resources, args.swarmName);

  const requirements = collectEnvRequirements(loaded.resources);
  const missingSummary = summarizeMissingEnv(requirements, process.env);
  if (missingSummary) {
    throw new Error(missingSummary);
  }
  const maxStepsPerTurn = parseSwarmMaxStepsPerTurn(swarmResource);
  const watchTargets = new Set<string>();
  watchTargets.add(path.resolve(args.bundlePath));
  for (const scannedFile of loaded.scannedFiles) {
    const absolutePath = path.resolve(scannedFile);
    if (isPathInside(bundleDir, absolutePath)) {
      watchTargets.add(absolutePath);
    }
  }

  const toolRegistry = new ToolRegistryImpl();
  const toolExecutor = new ToolExecutor(toolRegistry);
  const registeredToolResources = new Map<string, ToolCatalogItem[]>();
  const registeredToolEntryPaths = new Map<string, string>();
  const agentPlans = new Map<string, AgentRuntimePlan>();

  for (const agentRef of selectedSwarm.agents) {
    const agentResource = selectReferencedResource(
      loaded.resources,
      {
        kind: 'Agent',
        name: agentRef.name,
        package: agentRef.packageName,
      },
      'Agent',
      swarmResource.__package,
      selectedSwarm.packageName,
    );

    const modelRef = parseAgentModelRef(agentResource);
    const modelResource = selectReferencedResource(
      loaded.resources,
      modelRef,
      'Model',
      agentResource.__package,
      selectedSwarm.packageName,
    );

    const modelSpec = readSpecRecord(modelResource);
    const provider = readStringValue(modelSpec, 'provider');
    const modelName = readStringValue(modelSpec, 'model');
    if (!provider || !modelName) {
      throw new Error(`Model/${modelResource.metadata.name} spec.provider/spec.model이 필요합니다.`);
    }

    const apiKey = resolveModelApiKey(modelSpec, process.env, modelResource.metadata.name);
    const prompt = await readAgentSystemPrompt(agentResource);
    const modelParams = parseAgentModelParams(agentResource);
    const toolRefs = parseAgentToolRefs(agentResource);
    const extensionRefs = parseAgentExtensionRefs(agentResource);
    const requiredToolNames = parseAgentRequiredTools(agentResource);

    const agentToolCatalog: ToolCatalogItem[] = [];
    for (const toolRef of toolRefs) {
      const toolResource = selectReferencedResource(
        loaded.resources,
        toolRef,
        'Tool',
        agentResource.__package,
        selectedSwarm.packageName,
      );

      const identity = `${toolResource.__package ?? '__local__'}|${toolResource.metadata.name}`;
      let catalogForResource = registeredToolResources.get(identity);
      if (!catalogForResource) {
        const registration = await registerToolResource(toolResource, toolRegistry);
        catalogForResource = registration.catalogItems;
        registeredToolResources.set(identity, catalogForResource);
        registeredToolEntryPaths.set(identity, registration.entryPath);
      }

      const registeredToolEntryPath = registeredToolEntryPaths.get(identity);
      if (registeredToolEntryPath) {
        watchTargets.add(registeredToolEntryPath);
      }

      for (const item of catalogForResource) {
        if (!agentToolCatalog.some((candidate) => candidate.name === item.name)) {
          agentToolCatalog.push(item);
        }
      }
    }

    const extensionResources: RuntimeResource<RuntimeExtensionSpec>[] = [];
    for (const extensionRef of extensionRefs) {
      const rawExtensionResource = selectReferencedResource(
        loaded.resources,
        extensionRef,
        'Extension',
        agentResource.__package,
        selectedSwarm.packageName,
      );
      const extensionResource = toExtensionResource(rawExtensionResource);
      const extensionEntryPath = await resolveEntryPath(extensionResource, 'entry');
      watchTargets.add(extensionEntryPath);
      extensionResources.push(extensionResource);
    }

    const plan: AgentRuntimePlan = {
      name: agentResource.metadata.name,
      modelName,
      provider,
      apiKey,
      systemPrompt: prompt,
      maxTokens: modelParams.maxTokens,
      temperature: modelParams.temperature,
      maxSteps: maxStepsPerTurn,
      requiredToolNames,
      toolCatalog: agentToolCatalog,
      extensionResources,
    };

    for (const requiredToolName of requiredToolNames) {
      const existsInCatalog = agentToolCatalog.some((item) => item.name === requiredToolName);
      if (!existsInCatalog) {
        throw new Error(
          `Agent/${agentResource.metadata.name} spec.requiredTools(${requiredToolName})가 toolCatalog에 없습니다.`,
        );
      }
    }

    agentPlans.set(agentResource.metadata.name, plan);
  }

  const connections = loaded.resources.filter(
    (resource) => resource.kind === 'Connection' && hasMatchingSwarm(resource, selectedSwarm),
  );

  const connectors: ConnectorRunPlan[] = [];
  for (const connection of connections) {
    const connectorRef = parseConnectionConnectorRef(connection);
    const connectorResource = selectReferencedResource(
      loaded.resources,
      connectorRef,
      'Connector',
      connection.__package,
      selectedSwarm.packageName,
    );

    const connectorEntryPath = await resolveEntryPath(connectorResource, 'entry');
    const config = resolveConnectionConfig(connection, process.env);
    const secrets = resolveConnectionSecrets(connection, process.env);
    const routeRules = parseIngressRouteRules(connection, selectedSwarm);
    watchTargets.add(connectorEntryPath);

    connectors.push({
      swarmName: selectedSwarm.name,
      connectionName: connection.metadata.name,
      connectorName: connectorResource.metadata.name,
      connectorEntryPath,
      config,
      secrets,
      routeRules,
      defaultAgent: selectedSwarm.entryAgent,
    });
  }

  return {
    selectedSwarm,
    connectors,
    agents: agentPlans,
    toolExecutor,
    watchTargets: [...watchTargets].sort((left, right) => left.localeCompare(right)),
    localPackageName,
  };
}

function createConnectorLogger(plan: ConnectorRunPlan): Console {
  const prefix = `[goondan-runtime][${plan.connectionName}/${plan.connectorName}]`;
  const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
  logger.debug = (...args: unknown[]): void => {
    console.debug(prefix, ...args);
  };
  logger.info = (...args: unknown[]): void => {
    console.info(prefix, ...args);
  };
  logger.warn = (...args: unknown[]): void => {
    console.warn(prefix, ...args);
  };
  logger.error = (...args: unknown[]): void => {
    console.error(prefix, ...args);
  };
  return logger;
}

function queueAgentEvent(
  state: RuntimeEngineState,
  key: string,
  run: () => Promise<void>,
): Promise<void> {
  const previous = state.executionQueue.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => {
      // 이전 턴 실패는 다음 턴 큐 진행을 막지 않는다.
    })
    .then(run)
    .finally(() => {
      const current = state.executionQueue.get(key);
      if (current === next) {
        state.executionQueue.delete(key);
      }
    });

  state.executionQueue.set(key, next);
  return next;
}

function createConversationKey(agentName: string, instanceKey: string): string {
  return `${agentName}:${instanceKey}`;
}

function createSpawnOwnerKey(agentName: string, instanceKey: string): string {
  return `${agentName}:${instanceKey}`;
}

function trackSpawnedAgent(
  runtime: RuntimeEngineState,
  ownerAgent: string,
  ownerInstanceKey: string,
  record: SpawnedAgentRecord,
): void {
  const ownerKey = createSpawnOwnerKey(ownerAgent, ownerInstanceKey);
  let registry = runtime.spawnedAgentsByOwner.get(ownerKey);
  if (!registry) {
    registry = new Map<string, SpawnedAgentRecord>();
    runtime.spawnedAgentsByOwner.set(ownerKey, registry);
  }

  const spawnKey = createConversationKey(record.target, record.instanceKey);
  registry.set(spawnKey, record);
}

function listSpawnedAgents(
  runtime: RuntimeEngineState,
  ownerAgent: string,
  ownerInstanceKey: string,
  includeAll: boolean,
): SpawnedAgentRecord[] {
  if (includeAll) {
    const records: SpawnedAgentRecord[] = [];
    for (const registry of runtime.spawnedAgentsByOwner.values()) {
      for (const record of registry.values()) {
        records.push(record);
      }
    }
    return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  const ownerKey = createSpawnOwnerKey(ownerAgent, ownerInstanceKey);
  const registry = runtime.spawnedAgentsByOwner.get(ownerKey);
  if (!registry) {
    return [];
  }
  return [...registry.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function resolveAgentWorkdir(runtime: RuntimeEngineState, queueKey: string): string {
  const workdir = runtime.instanceWorkdirs.get(queueKey);
  if (workdir) {
    return workdir;
  }
  return runtime.workdir;
}

async function ensureInstanceStorage(
  runtime: RuntimeEngineState,
  queueKey: string,
  agentName: string,
): Promise<void> {
  if (runtime.initializedInstances.has(queueKey)) {
    return;
  }

  await runtime.storage.initializeSystemRoot();
  const metadata = await runtime.storage.readMetadata(queueKey);
  if (!metadata) {
    await runtime.storage.initializeInstanceState(queueKey, agentName);
  }
  runtime.initializedInstances.add(queueKey);
}

async function loadConversationFromStorage(
  runtime: RuntimeEngineState,
  queueKey: string,
  agentName: string,
): Promise<ConversationTurn[]> {
  await ensureInstanceStorage(runtime, queueKey, agentName);
  const loaded = await runtime.storage.loadConversation(queueKey);
  return toConversationTurns(loaded.nextMessages);
}

async function persistConversationToStorage(
  runtime: RuntimeEngineState,
  queueKey: string,
  agentName: string,
  turns: ConversationTurn[],
): Promise<void> {
  await ensureInstanceStorage(runtime, queueKey, agentName);
  const messages = toPersistentMessages(turns);
  await runtime.storage.writeBaseMessages(queueKey, messages);
  await runtime.storage.clearEvents(queueKey);
}

function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function createToolContextMessage(content: string): Message {
  return {
    id: createId('message'),
    data: {
      role: 'user',
      content,
    },
    metadata: {},
    createdAt: new Date(),
    source: {
      type: 'user',
    },
  };
}

function createConversationUserMessage(content: unknown): Message {
  return {
    id: createId('message'),
    data: {
      role: 'user',
      content,
    },
    metadata: {},
    createdAt: new Date(),
    source: {
      type: 'user',
    },
  };
}

function createConversationAssistantMessage(content: unknown, stepId: string): Message {
  return {
    id: createId('message'),
    data: {
      role: 'assistant',
      content,
    },
    metadata: {},
    createdAt: new Date(),
    source: {
      type: 'assistant',
      stepId,
    },
  };
}

function createConversationStateFromTurns(turns: ConversationTurn[]): ConversationStateImpl {
  const messages: Message[] = [];
  for (const turn of turns) {
    if (turn.role === 'assistant') {
      messages.push(createConversationAssistantMessage(turn.content, createId('seed-step')));
      continue;
    }
    messages.push(createConversationUserMessage(turn.content));
  }
  return new ConversationStateImpl(messages);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createLanguageModel(provider: string, model: string, apiKey: string): LanguageModel {
  const normalizedProvider = provider.trim().toLowerCase();

  if (normalizedProvider === 'anthropic') {
    return createAnthropic({ apiKey }).languageModel(model);
  }

  if (normalizedProvider === 'openai') {
    return createOpenAI({ apiKey }).languageModel(model);
  }

  if (normalizedProvider === 'google') {
    return createGoogleGenerativeAI({ apiKey }).languageModel(model);
  }

  throw new Error(`지원하지 않는 model provider입니다: ${provider}`);
}

function toToolResultOutput(value: unknown): RunnerToolResultOutput {
  if (isJsonObject(value) && value.type === 'text' && typeof value.value === 'string') {
    return {
      type: 'text',
      value: value.value,
    };
  }

  if (isJsonObject(value) && value.type === 'json' && Object.hasOwn(value, 'value')) {
    return {
      type: 'json',
      value: toJsonValue(value.value),
    };
  }

  if (typeof value === 'string') {
    return {
      type: 'text',
      value,
    };
  }

  return {
    type: 'json',
    value: toJsonValue(value),
  };
}

function parseToolCallPart(block: JsonObject): { toolCallId: string; toolName: string; input: JsonObject } | undefined {
  const type = typeof block.type === 'string' ? block.type : '';
  if (type !== 'tool-call' && type !== 'tool_call' && type !== 'tool_use') {
    return undefined;
  }

  const toolCallId = readStringValue(block, 'toolCallId') ?? readStringValue(block, 'id');
  const toolName = readStringValue(block, 'toolName') ?? readStringValue(block, 'name');
  if (!toolCallId || !toolName) {
    return undefined;
  }

  return {
    toolCallId,
    toolName,
    input: ensureJsonObject(block.input),
  };
}

function parseToolResultPart(block: JsonObject): { toolCallId: string; toolName: string; output: RunnerToolResultOutput } | undefined {
  const type = typeof block.type === 'string' ? block.type : '';
  if (type !== 'tool-result' && type !== 'tool_result') {
    return undefined;
  }

  const toolCallId = readStringValue(block, 'toolCallId') ?? readStringValue(block, 'tool_use_id');
  if (!toolCallId) {
    return undefined;
  }

  const toolName = readStringValue(block, 'toolName') ?? readStringValue(block, 'tool_name') ?? 'unknown-tool';
  const hasOutput = Object.hasOwn(block, 'output');
  const rawOutput = hasOutput ? block.output : block.content;
  const isError = block.is_error === true;
  if (isError) {
    return {
      toolCallId,
      toolName,
      output: {
        type: 'text',
        value: `ERROR: ${typeof rawOutput === 'string' ? rawOutput : safeJsonStringify(rawOutput)}`,
      },
    };
  }

  return {
    toolCallId,
    toolName,
    output: toToolResultOutput(rawOutput),
  };
}

function normalizeAssistantContent(content: unknown): AssistantModelMessage['content'] {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return safeJsonStringify(content);
  }

  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: JsonObject }
    | { type: 'tool-result'; toolCallId: string; toolName: string; output: RunnerToolResultOutput }
  > = [];

  for (const item of content) {
    if (isJsonObject(item)) {
      const toolCallPart = parseToolCallPart(item);
      if (toolCallPart) {
        parts.push({
          type: 'tool-call',
          toolCallId: toolCallPart.toolCallId,
          toolName: toolCallPart.toolName,
          input: toolCallPart.input,
        });
        continue;
      }

      const toolResultPart = parseToolResultPart(item);
      if (toolResultPart) {
        parts.push({
          type: 'tool-result',
          toolCallId: toolResultPart.toolCallId,
          toolName: toolResultPart.toolName,
          output: toolResultPart.output,
        });
        continue;
      }

      if (item.type === 'text' && typeof item.text === 'string') {
        parts.push({ type: 'text', text: item.text });
        continue;
      }
    }

    parts.push({
      type: 'text',
      text: safeJsonStringify(item),
    });
  }

  return parts;
}

function normalizeUserMessages(content: unknown): ModelMessage[] {
  if (typeof content === 'string') {
    return [{ role: 'user', content }];
  }

  if (!Array.isArray(content)) {
    return [{ role: 'user', content: safeJsonStringify(content) }];
  }

  const textParts: Array<{ type: 'text'; text: string }> = [];
  const toolParts: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: RunnerToolResultOutput }> = [];

  for (const item of content) {
    if (isJsonObject(item)) {
      const toolPart = parseToolResultPart(item);
      if (toolPart) {
        toolParts.push({
          type: 'tool-result',
          toolCallId: toolPart.toolCallId,
          toolName: toolPart.toolName,
          output: toolPart.output,
        });
        continue;
      }

      if (item.type === 'text' && typeof item.text === 'string') {
        textParts.push({ type: 'text', text: item.text });
        continue;
      }
    }

    textParts.push({
      type: 'text',
      text: safeJsonStringify(item),
    });
  }

  const messages: ModelMessage[] = [];
  if (toolParts.length > 0) {
    messages.push({
      role: 'tool',
      content: toolParts,
    });
  }

  if (textParts.length === 1) {
    const onlyText = textParts[0];
    if (onlyText) {
      messages.push({
        role: 'user',
        content: onlyText.text,
      });
    }
  } else if (textParts.length > 1) {
    messages.push({
      role: 'user',
      content: textParts,
    });
  }

  return messages;
}

function toModelMessages(turns: ConversationTurn[]): ModelMessage[] {
  const messages: ModelMessage[] = [];

  for (const turn of turns) {
    if (turn.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: normalizeAssistantContent(turn.content),
      });
      continue;
    }

    messages.push(...normalizeUserMessages(turn.content));
  }

  return messages;
}

function toRunnerToolSet(catalog: ToolCatalogItem[]): ToolSet {
  const tools: ToolSet = {};
  for (const item of catalog) {
    tools[item.name] = tool({
      description: item.description,
      inputSchema: jsonSchema(item.parameters ?? createDefaultObjectSchema()),
    });
  }

  return tools;
}

function toAssistantContent(messages: readonly ModelMessage[], fallbackText: string): unknown[] {
  const assistantMessage = messages.find((message): message is AssistantModelMessage => message.role === 'assistant');
  if (!assistantMessage) {
    return fallbackText.trim().length > 0 ? [{ type: 'text', text: fallbackText }] : [];
  }

  if (typeof assistantMessage.content === 'string') {
    return [{ type: 'text', text: assistantMessage.content }];
  }

  return assistantMessage.content;
}

async function requestModelMessage(input: {
  provider: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  toolCatalog: ToolCatalogItem[];
  turns: ConversationTurn[];
}): Promise<ModelStepParseResult> {
  const model = createLanguageModel(input.provider, input.model, input.apiKey);
  const result = await generateText({
    model,
    system: input.systemPrompt,
    messages: toModelMessages(input.turns),
    tools: toRunnerToolSet(input.toolCatalog),
    stopWhen: stepCountIs(1),
    temperature: input.temperature,
    maxOutputTokens: input.maxTokens,
  });

  const toolUseBlocks: ToolUseBlock[] = [];
  for (const toolCall of result.toolCalls) {
    toolUseBlocks.push({
      id: toolCall.toolCallId,
      name: toolCall.toolName,
      input: ensureJsonObject(toolCall.input),
    });
  }

  const textBlocks = result.text.trim().length > 0 ? [result.text.trim()] : [];

  return {
    assistantContent: toAssistantContent(result.response.messages, result.text),
    textBlocks,
    toolUseBlocks,
  };
}

async function withOptionalTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return promise;
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function executeInboundTurn(input: {
  runtime: RuntimeEngineState;
  runnerPlan: RunnerPlan;
  targetAgentName: string;
  event: RuntimeInboundEvent;
  logger: Console;
}): Promise<TurnExecutionResult> {
  const agentPlan = input.runnerPlan.agents.get(input.targetAgentName);
  if (!agentPlan) {
    throw new Error(`target agent not found: ${input.targetAgentName}`);
  }

  const queueKey = createConversationKey(input.targetAgentName, input.event.instanceKey);
  const userInputText = formatRuntimeInboundUserText({
    sourceKind: input.event.sourceKind,
    sourceName: input.event.sourceName,
    eventName: input.event.eventName,
    instanceKey: input.event.instanceKey,
    messageText: input.event.messageText,
    properties: input.event.properties,
    metadata: input.event.metadata,
  });

  let turnResult: TurnExecutionResult | undefined;
  await queueAgentEvent(input.runtime, queueKey, async () => {
    await ensureInstanceStorage(input.runtime, queueKey, input.targetAgentName);
    await input.runtime.storage.updateMetadataStatus(queueKey, 'processing');
    try {
      const turnId = createId('turn');
      const traceId = createId('trace');
      const history = await loadConversationFromStorage(
        input.runtime,
        queueKey,
        input.targetAgentName,
      );

      try {
        const inputAgentEvent: AgentEvent = {
          id: createId('inbound_event'),
          type: input.event.eventName,
          createdAt: new Date(),
          traceId,
          source: {
            kind: input.event.sourceKind,
            name: input.event.sourceName,
          },
          input: input.event.messageText,
          instanceKey: input.event.instanceKey,
          metadata: input.event.metadata,
        };

        turnResult = await runAgentTurn({
          plan: agentPlan,
          inputEvent: inputAgentEvent,
          userInputText,
          instanceKey: input.event.instanceKey,
          turnId,
          traceId,
          conversation: history,
          toolExecutor: input.runnerPlan.toolExecutor,
          runtime: input.runtime,
          runnerPlan: input.runnerPlan,
          workdir: resolveAgentWorkdir(input.runtime, queueKey),
          logger: input.logger,
        });
      } catch (error) {
        const message = unknownToErrorMessage(error);
        const responseText = `오류: ${message}`;
        turnResult = {
          responseText,
          restartRequested: false,
          nextConversation: history.concat([
            {
              role: 'user',
              content: userInputText,
            },
            {
              role: 'assistant',
              content: responseText,
            },
          ]),
        };
      }

      await persistConversationToStorage(
        input.runtime,
        queueKey,
        input.targetAgentName,
        turnResult.nextConversation,
      );

      if (turnResult.restartRequested) {
        const reason = turnResult.restartReason ?? 'tool:restart-signal';
        await requestRuntimeRestart(input.runtime, reason);
      }
    } finally {
      await input.runtime.storage.updateMetadataStatus(queueKey, 'idle');
    }
  });

  if (!turnResult) {
    throw new Error('turn result was not produced');
  }

  return turnResult;
}

function createAgentToolRuntime(input: {
  runtime: RuntimeEngineState;
  runnerPlan: RunnerPlan;
  callerAgentName: string;
  callerInstanceKey: string;
  logger: Console;
}): AgentToolRuntime {
  const resolveTargetPlan = (target: string): AgentRuntimePlan => {
    const targetPlan = input.runnerPlan.agents.get(target);
    if (!targetPlan) {
      throw new Error(`target agent not found in selected swarm: ${target}`);
    }
    return targetPlan;
  };

  return {
    request: async (
      target: string,
      event: AgentEvent,
      options?: AgentRuntimeRequestOptions,
    ): Promise<AgentRuntimeRequestResult> => {
      resolveTargetPlan(target);
      const parsed = parseAgentToolEventPayload(event, input.callerInstanceKey, input.callerAgentName);
      if (!parsed) {
        throw new Error('agents__request 입력 이벤트 형식이 올바르지 않습니다.');
      }

      if (target === input.callerAgentName && parsed.instanceKey === input.callerInstanceKey) {
        throw new Error('agents__request는 동일 agent+instance를 대상으로 호출할 수 없습니다.');
      }

      const callerNode = createAgentCallNode(input.callerAgentName, input.callerInstanceKey);
      const targetNode = createAgentCallNode(target, parsed.instanceKey);
      const currentCallStack = appendAgentCallStack(readAgentCallStack(parsed.metadata), callerNode);
      if (currentCallStack.includes(targetNode)) {
        throw new Error(
          `agents__request 순환 호출이 감지되었습니다: ${[...currentCallStack, targetNode].join(' -> ')}`,
        );
      }

      const inboundEvent: RuntimeInboundEvent = {
        sourceKind: 'agent',
        sourceName: parsed.sourceName,
        eventName: parsed.type,
        instanceKey: parsed.instanceKey,
        messageText: parsed.messageText,
        properties: {
          from_agent: input.callerAgentName,
          from_instance: input.callerInstanceKey,
        },
        metadata: withAgentCallStack(parsed.metadata, currentCallStack),
      };

      const timeoutMs = options?.timeoutMs;
      const turnResult = await withOptionalTimeout(
        executeInboundTurn({
          runtime: input.runtime,
          runnerPlan: input.runnerPlan,
          targetAgentName: target,
          event: inboundEvent,
          logger: input.logger,
        }),
        timeoutMs,
        `agent request timeout (${timeoutMs}ms): target=${target}`,
      );

      return {
        eventId: parsed.id,
        target,
        response: turnResult.responseText,
        correlationId: parsed.correlationId ?? createId('corr'),
      };
    },
    send: async (target: string, event: AgentEvent): Promise<AgentRuntimeSendResult> => {
      resolveTargetPlan(target);
      const parsed = parseAgentToolEventPayload(event, input.callerInstanceKey, input.callerAgentName);
      if (!parsed) {
        throw new Error('agents__send 입력 이벤트 형식이 올바르지 않습니다.');
      }

      const callerNode = createAgentCallNode(input.callerAgentName, input.callerInstanceKey);
      const currentCallStack = appendAgentCallStack(readAgentCallStack(parsed.metadata), callerNode);

      const inboundEvent: RuntimeInboundEvent = {
        sourceKind: 'agent',
        sourceName: parsed.sourceName,
        eventName: parsed.type,
        instanceKey: parsed.instanceKey,
        messageText: parsed.messageText,
        properties: {
          from_agent: input.callerAgentName,
          from_instance: input.callerInstanceKey,
        },
        metadata: withAgentCallStack(parsed.metadata, currentCallStack),
      };

      void executeInboundTurn({
        runtime: input.runtime,
        runnerPlan: input.runnerPlan,
        targetAgentName: target,
        event: inboundEvent,
        logger: input.logger,
      }).catch((error) => {
        input.logger.warn(`agents__send target=${target} failed: ${unknownToErrorMessage(error)}`);
      });

      return {
        eventId: parsed.id,
        target,
        accepted: true,
      };
    },
    spawn: async (
      target: string,
      options?: AgentRuntimeSpawnOptions,
    ): Promise<AgentRuntimeSpawnResult> => {
      resolveTargetPlan(target);
      const instanceKey = options?.instanceKey && options.instanceKey.trim().length > 0
        ? options.instanceKey.trim()
        : createId(`${target}-instance`);
      const queueKey = createConversationKey(target, instanceKey);
      await ensureInstanceStorage(input.runtime, queueKey, target);
      await input.runtime.storage.updateMetadataStatus(queueKey, 'idle');

      const ownerKey = createSpawnOwnerKey(input.callerAgentName, input.callerInstanceKey);
      const registry = input.runtime.spawnedAgentsByOwner.get(ownerKey);
      const existing = registry?.get(queueKey);
      const resolvedCwd = options?.cwd ? resolveRuntimeWorkdir(input.runtime.workdir, options.cwd) : existing?.cwd;
      if (resolvedCwd) {
        input.runtime.instanceWorkdirs.set(queueKey, resolvedCwd);
      }

      const createdAt = existing?.createdAt ?? new Date().toISOString();
      const record: SpawnedAgentRecord = {
        target,
        instanceKey,
        ownerAgent: input.callerAgentName,
        ownerInstanceKey: input.callerInstanceKey,
        createdAt,
        cwd: resolvedCwd,
      };
      trackSpawnedAgent(input.runtime, input.callerAgentName, input.callerInstanceKey, record);

      return {
        target,
        instanceKey,
        spawned: existing === undefined,
        cwd: resolvedCwd,
      };
    },
    list: async (options?: AgentRuntimeListOptions) => {
      const includeAll = options?.includeAll === true;
      const records = listSpawnedAgents(
        input.runtime,
        input.callerAgentName,
        input.callerInstanceKey,
        includeAll,
      );

      return {
        agents: records.map((record) => ({
          target: record.target,
          instanceKey: record.instanceKey,
          ownerAgent: record.ownerAgent,
          ownerInstanceKey: record.ownerInstanceKey,
          createdAt: record.createdAt,
          cwd: record.cwd,
        })),
      };
    },
    catalog: async () => {
      const selfAgent = input.callerAgentName;
      return {
        ...buildRuntimeAgentCatalog(input.runnerPlan, selfAgent),
      };
    },
  };
}

async function getOrCreateAgentExtensionEnvironment(input: {
  runtime: RuntimeEngineState;
  plan: AgentRuntimePlan;
  agentName: string;
  instanceKey: string;
  logger: Console;
}): Promise<AgentExtensionEnvironment> {
  const queueKey = createConversationKey(input.agentName, input.instanceKey);
  const existing = input.runtime.extensionEnvironments.get(queueKey);
  if (existing) {
    return existing;
  }

  const extensionNames = input.plan.extensionResources.map((resource) => resource.metadata.name);
  const extensionStateManager = new ExtensionStateManagerImpl(
    input.runtime.storage,
    queueKey,
    extensionNames,
  );
  await extensionStateManager.loadAll();

  const extensionToolRegistry = new ToolRegistryImpl();
  const environment: AgentExtensionEnvironment = {
    pipelineRegistry: new PipelineRegistryImpl(input.runtime.runtimeEventBus),
    extensionToolRegistry,
    extensionToolExecutor: new ToolExecutor(extensionToolRegistry),
    extensionStateManager,
    initialized: false,
  };

  if (input.plan.extensionResources.length > 0) {
    const extensionEventBus = new EventEmitter();
    await loadExtensions(
      input.plan.extensionResources,
      (extensionName) =>
        new ExtensionApiImpl(
          extensionName,
          environment.pipelineRegistry,
          environment.extensionToolRegistry,
          environment.extensionStateManager,
          extensionEventBus,
          input.logger,
        ),
      input.runtime.workdir,
      input.logger,
    );
  }

  environment.initialized = true;
  input.runtime.extensionEnvironments.set(queueKey, environment);
  return environment;
}

async function runAgentTurn(input: {
  plan: AgentRuntimePlan;
  inputEvent: AgentEvent;
  userInputText: string;
  instanceKey: string;
  turnId: string;
  traceId: string;
  conversation: ConversationTurn[];
  toolExecutor: ToolExecutor;
  runtime: RuntimeEngineState;
  runnerPlan: RunnerPlan;
  workdir: string;
  logger: Console;
}): Promise<TurnExecutionResult> {
  const conversationState = createConversationStateFromTurns(input.conversation);
  conversationState.emitMessageEvent({
    type: 'append',
    message: createConversationUserMessage(input.userInputText),
  });
  let lastText = '';
  let finalResponseText = '응답 텍스트를 생성하지 못했습니다.';
  let restartRequested = false;
  let restartReason: string | undefined;
  const calledToolNames = new Set<string>();
  const requiredToolNames = input.plan.requiredToolNames;
  const enforceRequiredTools = requiredToolNames.length > 0;
  const hasSatisfiedRequiredTools = (): boolean =>
    requiredToolNames.length === 0 || requiredToolNames.some((name) => calledToolNames.has(name));
  const agentRuntime = createAgentToolRuntime({
    runtime: input.runtime,
    runnerPlan: input.runnerPlan,
    callerAgentName: input.plan.name,
    callerInstanceKey: input.instanceKey,
    logger: input.logger,
  });
  const middlewareAgentsApi = createMiddlewareAgentsApi({
    runtime: agentRuntime,
    callerAgentName: input.plan.name,
    callerInstanceKey: input.instanceKey,
    callerTurnId: input.turnId,
    traceId: input.traceId,
    inboundMetadata: input.inputEvent.metadata,
  });
  const extensionEnvironment = await getOrCreateAgentExtensionEnvironment({
    runtime: input.runtime,
    plan: input.plan,
    agentName: input.plan.name,
    instanceKey: input.instanceKey,
    logger: input.logger,
  });

  const turnMetadata: Record<string, JsonValue> = {
    runtimeCatalog: buildRuntimeAgentCatalog(input.runnerPlan, input.plan.name),
  };
  let step = 0;
  let turnResult: TurnResult;
  try {
    turnResult = await extensionEnvironment.pipelineRegistry.runTurn(
      {
        agentName: input.plan.name,
        instanceKey: input.instanceKey,
        turnId: input.turnId,
        traceId: input.traceId,
        inputEvent: input.inputEvent,
        conversationState,
        agents: middlewareAgentsApi,
        emitMessageEvent(event: MessageEvent): void {
          conversationState.emitMessageEvent(event);
        },
        metadata: turnMetadata,
      },
      async (): Promise<TurnResult> => {
        while (true) {
        if (step >= input.plan.maxSteps) {
          const responseText = buildStepLimitResponse({
            maxSteps: input.plan.maxSteps,
            requiredToolNames,
            calledToolNames,
            lastText,
          });
          if (responseText !== lastText) {
            conversationState.emitMessageEvent({
              type: 'append',
              message: createConversationAssistantMessage(
                responseText,
                `${input.turnId}-step-limit`,
              ),
            });
          }
          finalResponseText = responseText;
          return {
            turnId: input.turnId,
            finishReason: 'max_steps',
            responseMessage: createConversationAssistantMessage(
              responseText,
              `${input.turnId}-step-limit`,
            ),
          };
        }

        step += 1;
        const baseToolCatalog = mergeToolCatalog(
          input.plan.toolCatalog,
          extensionEnvironment.extensionToolRegistry.getCatalog(),
        );
        const stepMetadata: Record<string, JsonValue> = {};
        const turnSnapshot: Turn = {
          id: input.turnId,
          agentName: input.plan.name,
          inputEvent: input.inputEvent,
          messages: conversationState.nextMessages,
          steps: [],
          status: 'running',
          metadata: {},
        };

        const stepResult = await extensionEnvironment.pipelineRegistry.runStep(
          {
            agentName: input.plan.name,
            instanceKey: input.instanceKey,
            turnId: input.turnId,
            traceId: input.traceId,
            turn: turnSnapshot,
            stepIndex: step,
            conversationState,
            agents: middlewareAgentsApi,
            emitMessageEvent(event: MessageEvent): void {
              conversationState.emitMessageEvent(event);
            },
            toolCatalog: baseToolCatalog,
            metadata: stepMetadata,
          },
          async (stepCtx): Promise<StepResult> => {
            const response = await requestModelMessage({
              provider: input.plan.provider,
              apiKey: input.plan.apiKey,
              model: input.plan.modelName,
              systemPrompt: input.plan.systemPrompt,
              temperature: input.plan.temperature,
              maxTokens: input.plan.maxTokens,
              toolCatalog: stepCtx.toolCatalog,
              turns: toConversationTurns(conversationState.nextMessages),
            });

            conversationState.emitMessageEvent({
              type: 'append',
              message: createConversationAssistantMessage(
                response.assistantContent,
                `${input.turnId}-step-${step}`,
              ),
            });

            if (response.textBlocks.length > 0) {
              lastText = response.textBlocks.join('\n').trim();
            }

            if (response.toolUseBlocks.length === 0) {
              return {
                status: 'completed',
                hasToolCalls: false,
                toolCalls: [],
                toolResults: [],
                metadata: {},
              };
            }

            const toolCalls: Array<{ id: string; name: string; args: JsonObject }> = [];
            const toolResults: ToolCallResult[] = [];
            const toolResultBlocks: unknown[] = [];

            for (const toolUse of response.toolUseBlocks) {
              const toolArgs = ensureJsonObject(toolUse.input);
              toolCalls.push({
                id: toolUse.id,
                name: toolUse.name,
                args: toolArgs,
              });

              const toolResult = await extensionEnvironment.pipelineRegistry.runToolCall(
                {
                  agentName: input.plan.name,
                  instanceKey: input.instanceKey,
                  turnId: input.turnId,
                  traceId: input.traceId,
                  stepIndex: step,
                  toolName: toolUse.name,
                  toolCallId: toolUse.id,
                  args: toolArgs,
                  metadata: {},
                },
                async (toolCallCtx): Promise<ToolCallResult> => {
                  const toolContext = createMinimalToolContext({
                    agentName: input.plan.name,
                    instanceKey: input.instanceKey,
                    turnId: input.turnId,
                    traceId: input.traceId,
                    toolCallId: toolCallCtx.toolCallId,
                    message: createToolContextMessage(input.userInputText),
                    workdir: input.workdir,
                    logger: input.logger,
                    runtime: agentRuntime,
                  });

                  const executor = extensionEnvironment.extensionToolRegistry.has(toolCallCtx.toolName)
                    ? extensionEnvironment.extensionToolExecutor
                    : input.toolExecutor;

                  return executor.execute({
                    toolCallId: toolCallCtx.toolCallId,
                    toolName: toolCallCtx.toolName,
                    args: toolCallCtx.args,
                    catalog: stepCtx.toolCatalog,
                    context: toolContext,
                  });
                },
              );

              toolResults.push(toolResult);
              if (toolResult.status === 'ok') {
                calledToolNames.add(toolUse.name);
                const restartSignal = readRuntimeRestartSignal(toolResult.output);
                if (restartSignal?.requested) {
                  restartRequested = true;
                  if (!restartReason && restartSignal.reason) {
                    restartReason = restartSignal.reason;
                  }
                }

                toolResultBlocks.push({
                  type: 'tool-result',
                  toolCallId: toolUse.id,
                  toolName: toolUse.name,
                  output: toToolResultOutput(toolResult.output),
                });
                continue;
              }

              const errorMessage = toolResult.error?.message ?? 'unknown tool error';
              toolResultBlocks.push({
                type: 'tool-result',
                toolCallId: toolUse.id,
                toolName: toolUse.name,
                output: {
                  type: 'text',
                  value: `ERROR: ${errorMessage}`,
                },
              });
            }

            conversationState.emitMessageEvent({
              type: 'append',
              message: createConversationUserMessage(toolResultBlocks),
            });

            return {
              status: 'completed',
              hasToolCalls: true,
              toolCalls,
              toolResults,
              metadata: {},
            };
          },
        );

        if (stepResult.hasToolCalls) {
          continue;
        }

        if (enforceRequiredTools) {
          if (!hasSatisfiedRequiredTools()) {
            const enforcementMessage = [
              '필수 도구 호출 규칙 위반: 최종 답변 전에 아래 도구 중 최소 하나를 반드시 호출해야 합니다.',
              ...requiredToolNames.map((name) => `- ${name}`),
              '텍스트 답변을 종료하지 말고, 지금 즉시 위 도구 중 하나를 tool call로 호출하세요.',
            ].join('\n');
            conversationState.emitMessageEvent({
              type: 'append',
              message: createConversationUserMessage(enforcementMessage),
            });
            continue;
          }
        }

        const responseText = lastText.length > 0 ? lastText : '응답 텍스트를 생성하지 못했습니다.';
        if (lastText.length === 0) {
          conversationState.emitMessageEvent({
            type: 'append',
            message: createConversationAssistantMessage(
              responseText,
              `${input.turnId}-final`,
            ),
          });
        }
        finalResponseText = responseText;
        return {
          turnId: input.turnId,
          finishReason: 'text_response',
          responseMessage: createConversationAssistantMessage(
            responseText,
            `${input.turnId}-final`,
          ),
        };
        }
      },
    );
  } finally {
    await extensionEnvironment.extensionStateManager.saveAll();
  }

  if (turnResult.responseMessage) {
    const responseContent = turnResult.responseMessage.data.content;
    if (typeof responseContent === 'string' && responseContent.trim().length > 0) {
      finalResponseText = responseContent.trim();
    }
  } else if (turnResult.finishReason === 'error' && turnResult.error?.message) {
    finalResponseText = `오류: ${turnResult.error.message}`;
  }

  return {
    responseText: finalResponseText,
    restartRequested,
    restartReason,
    nextConversation: toConversationTurns(conversationState.nextMessages),
  };
}

function logConnectorEvent(plan: ConnectorRunPlan, event: ParsedConnectorEvent): void {
  console.info(
    `[goondan-runtime][${plan.connectionName}/${plan.connectorName}] emitted event name=${event.name} instanceKey=${event.instanceKey}`,
  );
}

function readRuntimeEventInstanceKey(event: RuntimeEvent): string | undefined {
  if (!('instanceKey' in event)) {
    return undefined;
  }

  if (typeof event.instanceKey !== 'string') {
    return undefined;
  }

  const trimmedInstanceKey = event.instanceKey.trim();
  if (trimmedInstanceKey.length === 0) {
    return undefined;
  }

  return trimmedInstanceKey;
}

function buildRuntimeEngine(args: RunnerArguments, plan: RunnerPlan): RuntimeEngineState {
  const workspacePaths = new WorkspacePaths({
    stateRoot: args.stateRoot,
    projectRoot: path.dirname(args.bundlePath),
    workspaceName: plan.selectedSwarm.instanceKey,
  });
  return {
    executionQueue: new Map<string, Promise<void>>(),
    initializedInstances: new Set<string>(),
    storage: new FileWorkspaceStorage(workspacePaths),
    workdir: path.dirname(args.bundlePath),
    runnerArgs: args,
    spawnedAgentsByOwner: new Map<string, Map<string, SpawnedAgentRecord>>(),
    instanceWorkdirs: new Map<string, string>(),
    extensionEnvironments: new Map<string, AgentExtensionEnvironment>(),
    runtimeEventBus: new RuntimeEventBusImpl(),
    runtimeEventTurnQueueKeys: new Map<string, string>(),
  };
}

function resolveRuntimeEventQueueKey(
  runtime: RuntimeEventPersistenceContext,
  event: RuntimeEvent,
): string | undefined {
  if (event.type === 'turn.started') {
    const explicitInstanceKey = readRuntimeEventInstanceKey(event);
    if (explicitInstanceKey !== undefined) {
      runtime.runtimeEventTurnQueueKeys.set(event.turnId, explicitInstanceKey);
      return explicitInstanceKey;
    }

    return runtime.runtimeEventTurnQueueKeys.get(event.turnId);
  }

  const trackedInstanceKey = runtime.runtimeEventTurnQueueKeys.get(event.turnId);
  if (trackedInstanceKey !== undefined) {
    return trackedInstanceKey;
  }

  const explicitInstanceKey = readRuntimeEventInstanceKey(event);
  if (explicitInstanceKey !== undefined) {
    return explicitInstanceKey;
  }

  if (event.type === 'turn.completed' || event.type === 'turn.failed') {
    return undefined;
  }

  return undefined;
}

function shouldReleaseRuntimeEventTurnKey(event: RuntimeEvent): boolean {
  return event.type === 'turn.completed' || event.type === 'turn.failed';
}

export function attachRuntimeEventPersistence(runtime: RuntimeEventPersistenceContext): () => void {
  const listener = async (event: RuntimeEvent): Promise<void> => {
    const instanceKey = resolveRuntimeEventQueueKey(runtime, event);
    if (instanceKey === undefined) {
      console.warn(
        `[goondan-runtime] runtime event dropped type=${event.type} turnId=${event.turnId}: unresolved instance`,
      );
      if (shouldReleaseRuntimeEventTurnKey(event)) {
        runtime.runtimeEventTurnQueueKeys.delete(event.turnId);
      }
      return;
    }

    try {
      await runtime.storage.appendRuntimeEvent(instanceKey, event);
    } catch (error) {
      console.warn(
        `[goondan-runtime] runtime event persistence failed type=${event.type} instanceKey=${instanceKey}: ${unknownToErrorMessage(error)}`,
      );
    } finally {
      if (shouldReleaseRuntimeEventTurnKey(event)) {
        runtime.runtimeEventTurnQueueKeys.delete(event.turnId);
      }
    }
  };

  const unsubscribers: Array<() => void> = [];
  for (const eventType of RUNTIME_EVENT_TYPES) {
    const unsubscribe = runtime.runtimeEventBus.on(eventType, listener);
    unsubscribers.push(unsubscribe);
  }

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    runtime.runtimeEventBus.clear();
    runtime.runtimeEventTurnQueueKeys.clear();
  };
}

async function requestRuntimeRestart(runtime: RuntimeEngineState, reason: string): Promise<void> {
  if (runtime.restartRequestedReason !== undefined) {
    return;
  }

  runtime.restartRequestedReason = reason;
  console.info(`[goondan-runtime] restart requested reason=${reason}`);
  try {
    process.kill(process.pid, 'SIGTERM');
  } catch (error) {
    runtime.restartRequestedReason = undefined;
    throw new Error(`restart 신호 전송 실패: ${unknownToErrorMessage(error)}`);
  }
}
async function handleConnectorEvent(
  runtime: RuntimeEngineState,
  runnerPlan: RunnerPlan,
  connectorPlan: ConnectorRunPlan,
  rawEvent: unknown,
): Promise<void> {
  const event = parseConnectorEventPayload(rawEvent);
  if (!event) {
    console.warn(
      `[goondan-runtime][${connectorPlan.connectionName}/${connectorPlan.connectorName}] invalid event payload received from connector.`,
    );
    return;
  }

  logConnectorEvent(connectorPlan, event);

  const routingRules: ParsedIngressRouteRule[] = connectorPlan.routeRules.map((rule) => ({
    eventName: rule.eventName,
    properties: rule.properties,
    agentName: rule.agent?.name,
    instanceKey: rule.instanceKey,
    instanceKeyProperty: rule.instanceKeyProperty,
    instanceKeyPrefix: rule.instanceKeyPrefix,
  }));
  const matchedRule = selectMatchingIngressRule(routingRules, event);
  const targetAgentName = matchedRule?.agentName ?? connectorPlan.defaultAgent.name;
  const logger = createConnectorLogger(connectorPlan);
  const routedInstanceKey = resolveInboundInstanceKey(matchedRule, event);
  const inboundEvent: RuntimeInboundEvent = {
    sourceKind: 'connector',
    sourceName: connectorPlan.connectorName,
    eventName: event.name,
    instanceKey: routedInstanceKey,
    messageText: event.messageText,
    properties: {
      ...event.properties,
      connection_name: connectorPlan.connectionName,
      connector_name: connectorPlan.connectorName,
    },
  };

  try {
    await executeInboundTurn({
      runtime,
      runnerPlan,
      targetAgentName,
      event: inboundEvent,
      logger,
    });
  } catch (error) {
    console.warn(
      `[goondan-runtime][${connectorPlan.connectionName}/${connectorPlan.connectorName}] event turn failed: ${unknownToErrorMessage(error)}`,
    );
    return;
  }

}

function connectorChildRunnerPath(): string {
  const jsPath = fileURLToPath(new URL('./runtime-runner-connector-child.js', import.meta.url));
  if (existsSync(jsPath)) {
    return jsPath;
  }

  return fileURLToPath(new URL('./runtime-runner-connector-child.ts', import.meta.url));
}

function sendConnectorChildCommand(child: ChildProcess, message: ConnectorChildCommandMessage): void {
  if (!child.connected || typeof child.send !== 'function') {
    throw new Error('Connector child IPC 채널이 연결되어 있지 않습니다.');
  }
  child.send(message);
}

async function startConnector(
  plan: ConnectorRunPlan,
  runnerPlan: RunnerPlan,
  runtime: RuntimeEngineState,
): Promise<RunningConnector> {
  const logger = createConnectorLogger(plan);
  const child = fork(connectorChildRunnerPath(), [], {
    cwd: path.dirname(plan.connectorEntryPath),
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  if (!child.pid || child.pid <= 0) {
    throw new Error(`Connector/${plan.connectorName} child process를 시작하지 못했습니다.`);
  }

  let startupSettled = false;
  let exitSettled = false;
  let expectedTermination = false;
  let terminatePromise: Promise<void> | undefined;

  let resolveStartup: (() => void) | undefined;
  let rejectStartup: ((error: unknown) => void) | undefined;
  const startupPromise = new Promise<void>((resolve, reject) => {
    resolveStartup = resolve;
    rejectStartup = reject;
  });

  let resolveExit: (() => void) | undefined;
  let rejectExit: ((error: unknown) => void) | undefined;
  const exitPromise = new Promise<void>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });

  const startupTimeout = setTimeout(() => {
    if (startupSettled) {
      return;
    }
    startupSettled = true;
    rejectStartup?.(new Error(`Connector/${plan.connectorName} 시작 확인이 시간 내에 완료되지 않았습니다.`));
  }, CONNECTOR_CHILD_STARTUP_TIMEOUT_MS);

  const cleanup = (): void => {
    clearTimeout(startupTimeout);
    child.off('message', onMessage);
    child.off('error', onError);
    child.off('exit', onExit);
  };

  const settleStartupSuccess = (): void => {
    if (startupSettled) {
      return;
    }
    startupSettled = true;
    clearTimeout(startupTimeout);
    resolveStartup?.();
  };

  const settleStartupFailure = (error: Error): void => {
    if (startupSettled) {
      return;
    }
    startupSettled = true;
    clearTimeout(startupTimeout);
    rejectStartup?.(error);
  };

  const settleExitSuccess = (): void => {
    if (exitSettled) {
      return;
    }
    exitSettled = true;
    cleanup();
    resolveExit?.();
  };

  const settleExitFailure = (error: Error): void => {
    if (exitSettled) {
      return;
    }
    exitSettled = true;
    cleanup();
    rejectExit?.(error);
  };

  const onMessage = (message: unknown): void => {
    if (isConnectorChildEventMessage(message)) {
      void handleConnectorEvent(runtime, runnerPlan, plan, message.event).catch((error) => {
        logger.warn(`event handling failed: ${unknownToErrorMessage(error)}`);
      });
      return;
    }

    if (isConnectorChildStartedMessage(message)) {
      settleStartupSuccess();
      return;
    }

    if (isConnectorChildStartErrorMessage(message)) {
      settleStartupFailure(new Error(`Connector/${plan.connectorName} 시작 실패: ${message.message}`));
    }
  };

  const onError = (error: Error): void => {
    const wrapped = new Error(`Connector/${plan.connectorName} child process 오류: ${error.message}`);
    settleStartupFailure(wrapped);
    if (expectedTermination) {
      settleExitSuccess();
      return;
    }
    settleExitFailure(wrapped);
  };

  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    const cause = code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : 'unknown reason';
    if (!startupSettled) {
      settleStartupFailure(new Error(`Connector/${plan.connectorName} 초기화 중 종료되었습니다 (${cause}).`));
    }

    if (expectedTermination) {
      settleExitSuccess();
      return;
    }

    if (code === 0) {
      settleExitFailure(new Error(`Connector/${plan.connectorName} (connection=${plan.connectionName})가 예기치 않게 종료되었습니다.`));
      return;
    }

    settleExitFailure(new Error(`Connector/${plan.connectorName} (connection=${plan.connectionName}) 실패: ${cause}`));
  };

  child.on('message', onMessage);
  child.on('error', onError);
  child.on('exit', onExit);

  const terminate = async (): Promise<void> => {
    if (terminatePromise) {
      return terminatePromise;
    }

    terminatePromise = (async () => {
      expectedTermination = true;
      const shutdownMessage: ConnectorChildShutdownMessage = {
        type: 'connector_shutdown',
      };

      try {
        sendConnectorChildCommand(child, shutdownMessage);
      } catch {
        // IPC 채널이 이미 닫힌 경우는 무시한다.
      }

      if (child.pid && child.pid > 0) {
        try {
          child.kill('SIGTERM');
        } catch {
          // 이미 종료된 경우 무시한다.
        }
      }

      await Promise.race([
        exitPromise.catch(() => {
          // 종료 과정의 에러는 종료 루틴에서 무시한다.
        }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, CONNECTOR_CHILD_SHUTDOWN_TIMEOUT_MS);
        }),
      ]);

      if (!exitSettled && child.pid && child.pid > 0) {
        try {
          child.kill('SIGKILL');
        } catch {
          // 이미 종료된 경우 무시한다.
        }
        await exitPromise.catch(() => {
          // 종료 과정의 에러는 종료 루틴에서 무시한다.
        });
      }
    })();

    return terminatePromise;
  };

  const startMessage: ConnectorChildStartMessage = {
    type: 'connector_start',
    connectorEntryPath: plan.connectorEntryPath,
    connectionName: plan.connectionName,
    connectorName: plan.connectorName,
    config: plan.config,
    secrets: plan.secrets,
  };
  try {
    sendConnectorChildCommand(child, startMessage);
  } catch (error) {
    await terminate();
    throw new Error(`Connector/${plan.connectorName} 시작 요청을 전달하지 못했습니다: ${unknownToErrorMessage(error)}`);
  }

  await startupPromise.catch(async (error) => {
    await terminate();
    throw error;
  });

  return {
    connectionName: plan.connectionName,
    connectorName: plan.connectorName,
    wait: exitPromise,
    terminate,
  };
}

async function startConnectors(
  plan: RunnerPlan,
  runtime: RuntimeEngineState,
): Promise<RunningConnector[]> {
  const running: RunningConnector[] = [];
  try {
    for (const connectorPlan of plan.connectors) {
      const started = await startConnector(connectorPlan, plan, runtime);
      running.push(started);
    }
  } catch (error) {
    await stopConnectors(running);
    throw error;
  }

  return running;
}

function monitorConnectors(connectors: RunningConnector[]): Promise<void> {
  if (connectors.length === 0) {
    return new Promise<void>(() => {
      // no-op: 연결된 connector가 없으면 shutdown signal을 기다린다.
    });
  }

  return Promise.race(connectors.map((connector) => connector.wait));
}

async function stopConnectors(connectors: RunningConnector[]): Promise<void> {
  await Promise.all(
    connectors.map(async (connector) => {
      try {
        await connector.terminate();
      } catch (error) {
        console.warn(
          `[goondan-runtime] Connector/${connector.connectorName} (connection=${connector.connectionName}) 종료 실패: ${unknownToErrorMessage(error)}`,
        );
      }
    }),
  );
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const keepAlive = setInterval(() => {
      // keep orchestrator event loop alive while waiting for shutdown signal
    }, 60_000);
    const shutdown = (): void => {
      clearInterval(keepAlive);
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      resolve();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

function startWatchMode(runtime: RuntimeEngineState, plan: RunnerPlan): () => void {
  const watchers: FSWatcher[] = [];
  let restartInProgress = false;

  const triggerRestart = (reason: string): void => {
    if (restartInProgress) {
      return;
    }
    restartInProgress = true;
    void requestRuntimeRestart(runtime, reason).finally(() => {
      restartInProgress = false;
    });
  };

  const uniqueTargets = [...new Set(plan.watchTargets)].sort((left, right) => left.localeCompare(right));
  for (const target of uniqueTargets) {
    try {
      const watcher = watchFs(target, (eventType, fileName) => {
        const changedPath = typeof fileName === 'string' && fileName.length > 0
          ? path.resolve(path.dirname(target), fileName)
          : target;
        console.info(`[goondan-runtime] watch change detected type=${eventType} path=${changedPath}`);
        triggerRestart(`watch:${changedPath}`);
      });
      watcher.on('error', (error: unknown) => {
        console.warn(
          `[goondan-runtime] watch error path=${target}: ${unknownToErrorMessage(error)}`,
        );
      });
      watchers.push(watcher);
    } catch (error) {
      console.warn(`[goondan-runtime] watch registration skipped path=${target}: ${unknownToErrorMessage(error)}`);
    }
  }

  if (watchers.length > 0) {
    console.info(`[goondan-runtime] watch mode enabled targets=${watchers.length}`);
  } else {
    console.warn('[goondan-runtime] watch mode enabled but no files are currently watchable.');
  }

  return () => {
    watchers.forEach((watcher) => {
      watcher.close();
    });
  };
}

function summarizeConnectorPlans(connectors: ConnectorRunPlan[]): string {
  if (connectors.length === 0) {
    return 'none';
  }
  return connectors.map((plan) => `${plan.connectionName}:${plan.connectorName}`).join(', ');
}

function summarizeAgentPlans(agents: Map<string, AgentRuntimePlan>): string {
  const names = [...agents.keys()];
  if (names.length === 0) {
    return 'none';
  }
  return names.join(', ');
}

async function preloadAgentExtensions(
  runtime: RuntimeEngineState,
  plan: RunnerPlan,
  instanceKey: string,
): Promise<void> {
  for (const [agentName, agentPlan] of plan.agents.entries()) {
    if (agentPlan.extensionResources.length === 0) {
      continue;
    }

    await getOrCreateAgentExtensionEnvironment({
      runtime,
      plan: agentPlan,
      agentName,
      instanceKey,
      logger: console,
    });
  }
}

async function runLifecycle(runningConnectors: RunningConnector[]): Promise<void> {
  const shutdownWait = waitForShutdownSignal();
  const connectorWait = monitorConnectors(runningConnectors);
  await Promise.race([shutdownWait, connectorWait]);
}

function unknownToErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function preflight(args: RunnerArguments): Promise<RunnerPlan> {
  const exists = await existsFile(args.bundlePath);
  if (!exists) {
    throw new Error(`Bundle 파일을 찾을 수 없습니다: ${args.bundlePath}`);
  }

  const plan = await buildRunnerPlan(args);
  if (plan.selectedSwarm.instanceKey !== args.instanceKey) {
    throw new Error(
      `instanceKey 불일치: expected=${plan.selectedSwarm.instanceKey}, actual=${args.instanceKey} (source=Swarm/${plan.selectedSwarm.name})`,
    );
  }
  return plan;
}

async function main(): Promise<void> {
  const args = parseRunnerArguments(process.argv.slice(2));
  const plan = await preflight(args);
  const runtime = buildRuntimeEngine(args, plan);
  const detachRuntimeEventPersistence = attachRuntimeEventPersistence(runtime);
  try {
    await preloadAgentExtensions(runtime, plan, args.instanceKey);
    const stopWatching = args.watch ? startWatchMode(runtime, plan) : () => {
      // no-op
    };
    let runningConnectors: RunningConnector[] = [];
    try {
      runningConnectors = await startConnectors(plan, runtime);

      console.info(
        `[goondan-runtime] started instanceKey=${args.instanceKey} pid=${process.pid} swarm=${plan.selectedSwarm.name} connectors=${runningConnectors.length}`,
      );
      console.info(`[goondan-runtime] active connectors: ${summarizeConnectorPlans(plan.connectors)}`);
      console.info(`[goondan-runtime] active agents: ${summarizeAgentPlans(plan.agents)}`);

      const readyMessage: RunnerReadyMessage = {
        type: 'ready',
        instanceKey: args.instanceKey,
        pid: process.pid,
      };
      sendMessage(readyMessage);

      await runLifecycle(runningConnectors);
    } finally {
      stopWatching();
      await stopConnectors(runningConnectors);
    }

    if (runtime.restartRequestedReason !== undefined) {
      const runnerModulePath = process.argv[1];
      if (typeof runnerModulePath !== 'string' || runnerModulePath.trim().length === 0) {
        throw new Error('runtime-runner 모듈 경로를 확인할 수 없습니다.');
      }

      const reason = runtime.restartRequestedReason;
      const replacementPlan = await buildRunnerPlan(runtime.runnerArgs);
      const replacementInstanceKey = replacementPlan.selectedSwarm.instanceKey;
      const replacementSwarmName = replacementPlan.selectedSwarm.name;
      const replacementRunnerArgsWithInstanceKey = upsertRunnerOption(
        process.argv.slice(2),
        '--instance-key',
        replacementInstanceKey,
      );
      const replacementRunnerArgs = upsertRunnerOption(
        replacementRunnerArgsWithInstanceKey,
        '--swarm',
        replacementSwarmName,
      );
      const replacementPid = await spawnReplacementRunner({
        runnerModulePath,
        runnerArgs: replacementRunnerArgs,
        stateRoot: runtime.runnerArgs.stateRoot,
        instanceKey: replacementInstanceKey,
        bundlePath: runtime.runnerArgs.bundlePath,
        watch: runtime.runnerArgs.watch,
        swarmName: replacementSwarmName,
        env: process.env,
      });

      console.info(
        `[goondan-runtime] replacement orchestrator started pid=${replacementPid} reason=${reason}`,
      );
    }
  } finally {
    detachRuntimeEventPersistence();
  }

  process.exit(0);
}

function isRuntimeRunnerEntryPoint(): boolean {
  const entryArg = process.argv[1];
  if (typeof entryArg !== 'string' || entryArg.trim().length === 0) {
    return false;
  }

  try {
    const entryUrl = pathToFileURL(path.resolve(entryArg)).href;
    return entryUrl === import.meta.url;
  } catch {
    return false;
  }
}

if (isRuntimeRunnerEntryPoint()) {
  void main().catch((error) => {
    const message = unknownToErrorMessage(error);
    const startErrorMessage: RunnerStartErrorMessage = {
      type: 'start_error',
      message,
    };
    sendMessage(startErrorMessage);
    console.error(`[goondan-runtime] startup failure: ${message}`);
    process.exit(1);
  });
}
