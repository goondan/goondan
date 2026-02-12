import path from 'node:path';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  BundleLoader,
  isJsonObject,
  normalizeObjectRef,
  type ConnectorContext,
  type ObjectRefLike,
  type RuntimeResource,
  type ValidationError,
} from '@goondan/runtime';

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

interface SelectedSwarm {
  name: string;
  packageName?: string;
}

interface ConnectorRunPlan {
  swarmName: string;
  connectionName: string;
  connectorName: string;
  connectorEntryPath: string;
  secrets: Record<string, string>;
}

interface RunnerPlan {
  selectedSwarm: SelectedSwarm;
  connectors: ConnectorRunPlan[];
}

interface RunningConnector {
  connectionName: string;
  connectorName: string;
  promise: Promise<void>;
}

type StartupProbe = { state: 'pending' } | { state: 'resolved' } | { state: 'rejected'; error: unknown };

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

function ensureSwarmSelected(resources: RuntimeResource[], requestedName?: string): SelectedSwarm {
  const swarms = resources.filter((resource) => resource.kind === 'Swarm');
  if (swarms.length === 0) {
    throw new Error('Swarm 리소스를 찾지 못했습니다.');
  }

  if (requestedName) {
    const matched = swarms.find((swarm) => swarm.metadata.name === requestedName);
    if (!matched) {
      throw new Error(`Swarm '${requestedName}'을(를) 찾지 못했습니다.`);
    }
    return {
      name: matched.metadata.name,
      packageName: matched.__package,
    };
  }

  const defaultSwarm = swarms.find((swarm) => swarm.metadata.name === 'default');
  if (defaultSwarm) {
    return {
      name: defaultSwarm.metadata.name,
      packageName: defaultSwarm.__package,
    };
  }

  if (swarms.length === 1) {
    const single = swarms[0];
    if (!single) {
      throw new Error('단일 Swarm을 선택할 수 없습니다.');
    }
    return {
      name: single.metadata.name,
      packageName: single.__package,
    };
  }

  const names = swarms.map((swarm) => swarm.metadata.name).join(', ');
  throw new Error(`실행할 Swarm을 선택할 수 없습니다. --swarm 옵션을 지정하세요. candidates: ${names}`);
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

function resolveSecretValue(source: unknown, env: NodeJS.ProcessEnv): string | undefined {
  if (!isJsonObject(source)) {
    return undefined;
  }

  if (typeof source.value === 'string') {
    return source.value;
  }

  const valueFrom = source.valueFrom;
  if (!isJsonObject(valueFrom) || typeof valueFrom.env !== 'string') {
    return undefined;
  }

  const envValue = env[valueFrom.env];
  if (typeof envValue !== 'string' || envValue.trim().length === 0) {
    return undefined;
  }

  return envValue;
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
    const resolved = resolveSecretValue(source, env);
    if (!resolved) {
      throw new Error(`Connection/${resource.metadata.name} secret '${secretName}' 값을 해석할 수 없습니다.`);
    }
    secrets[secretName] = resolved;
  }

  return secrets;
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

async function resolveConnectorEntryPath(resource: RuntimeResource): Promise<string> {
  const spec = readSpecRecord(resource);
  const entryValue = spec.entry;
  if (typeof entryValue !== 'string' || entryValue.trim().length === 0) {
    throw new Error(`Connector/${resource.metadata.name} spec.entry가 비어 있습니다.`);
  }

  const rootDir = resource.__rootDir ? path.resolve(resource.__rootDir) : process.cwd();
  const candidates = resolveConnectorCandidates(rootDir, entryValue.trim());
  for (const candidate of candidates) {
    if (await existsFile(candidate)) {
      return candidate;
    }
  }

  const listed = candidates.join(', ');
  throw new Error(`Connector/${resource.metadata.name} entry 파일을 찾을 수 없습니다: ${listed}`);
}

function selectConnectorResource(
  resources: RuntimeResource[],
  connectorRef: ObjectRefLike,
  selectedSwarm: SelectedSwarm,
  connectionResource: RuntimeResource,
): RuntimeResource {
  const normalized = normalizeObjectRef(connectorRef);
  if (normalized.kind !== 'Connector') {
    throw new Error(`Connection/${connectionResource.metadata.name} connectorRef가 Connector를 가리키지 않습니다.`);
  }

  const candidates = resources.filter(
    (resource) => resource.kind === 'Connector' && resource.metadata.name === normalized.name,
  );
  if (candidates.length === 0) {
    throw new Error(`Connector/${normalized.name} 리소스를 찾지 못했습니다.`);
  }

  if (normalized.package) {
    const matchedByPackage = candidates.find((resource) => resource.__package === normalized.package);
    if (!matchedByPackage) {
      throw new Error(`Connector/${normalized.name} (${normalized.package}) 리소스를 찾지 못했습니다.`);
    }
    return matchedByPackage;
  }

  if (connectionResource.__package) {
    const sameConnectionPackage = candidates.find((resource) => resource.__package === connectionResource.__package);
    if (sameConnectionPackage) {
      return sameConnectionPackage;
    }
  }

  if (selectedSwarm.packageName) {
    const sameSwarmPackage = candidates.find((resource) => resource.__package === selectedSwarm.packageName);
    if (sameSwarmPackage) {
      return sameSwarmPackage;
    }
  }

  if (candidates.length === 1) {
    const single = candidates[0];
    if (!single) {
      throw new Error(`Connector/${normalized.name} 단일 후보를 선택할 수 없습니다.`);
    }
    return single;
  }

  const candidatePackages = candidates.map((item) => item.__package ?? '<local>').join(', ');
  throw new Error(
    `Connector/${normalized.name} 후보가 여러 개여서 선택할 수 없습니다. package를 명시하세요. candidates: ${candidatePackages}`,
  );
}

async function buildRunnerPlan(args: RunnerArguments): Promise<RunnerPlan> {
  const bundleDir = path.dirname(args.bundlePath);
  const loader = new BundleLoader({
    stateRoot: args.stateRoot,
  });
  const loaded = await loader.load(bundleDir);
  if (loaded.errors.length > 0) {
    throw new Error(formatValidationErrors(loaded.errors));
  }

  const selectedSwarm = ensureSwarmSelected(loaded.resources, args.swarmName);
  const requirements = collectEnvRequirements(loaded.resources);
  const missingSummary = summarizeMissingEnv(requirements, process.env);
  if (missingSummary) {
    throw new Error(missingSummary);
  }

  const connections = loaded.resources.filter(
    (resource) => resource.kind === 'Connection' && hasMatchingSwarm(resource, selectedSwarm),
  );
  const connectorPlans: ConnectorRunPlan[] = [];

  for (const connection of connections) {
    const spec = readSpecRecord(connection);
    const connectorRefValue = spec.connectorRef;
    if (!isObjectRefLike(connectorRefValue)) {
      throw new Error(`Connection/${connection.metadata.name} spec.connectorRef 형식이 올바르지 않습니다.`);
    }

    const connectorResource = selectConnectorResource(loaded.resources, connectorRefValue, selectedSwarm, connection);
    const connectorEntryPath = await resolveConnectorEntryPath(connectorResource);
    const secrets = resolveConnectionSecrets(connection, process.env);

    connectorPlans.push({
      swarmName: selectedSwarm.name,
      connectionName: connection.metadata.name,
      connectorName: connectorResource.metadata.name,
      connectorEntryPath,
      secrets,
    });
  }

  return {
    selectedSwarm,
    connectors: connectorPlans,
  };
}

function createConnectorLogger(plan: ConnectorRunPlan): Pick<Console, 'debug' | 'info' | 'warn' | 'error'> {
  const prefix = `[goondan-runtime][${plan.connectionName}/${plan.connectorName}]`;
  return {
    debug: (...args: unknown[]): void => {
      console.debug(prefix, ...args);
    },
    info: (...args: unknown[]): void => {
      console.info(prefix, ...args);
    },
    warn: (...args: unknown[]): void => {
      console.warn(prefix, ...args);
    },
    error: (...args: unknown[]): void => {
      console.error(prefix, ...args);
    },
  };
}

function logConnectorEvent(plan: ConnectorRunPlan, event: unknown): void {
  if (!isJsonObject(event)) {
    console.warn(
      `[goondan-runtime][${plan.connectionName}/${plan.connectorName}] invalid event payload received from connector.`,
    );
    return;
  }

  const eventName = typeof event.name === 'string' ? event.name : 'unknown';
  const instanceKey = typeof event.instanceKey === 'string' ? event.instanceKey : 'unknown';
  console.info(
    `[goondan-runtime][${plan.connectionName}/${plan.connectorName}] emitted event name=${eventName} instanceKey=${instanceKey}`,
  );
}

type ConnectorRunner = (ctx: ConnectorContext) => Promise<void>;

function isConnectorRunner(value: unknown): value is ConnectorRunner {
  return typeof value === 'function';
}

async function importConnectorRunner(entryPath: string): Promise<ConnectorRunner> {
  const loaded: unknown = await import(pathToFileURL(entryPath).href);
  if (!isJsonObject(loaded)) {
    throw new Error(`Connector 모듈 로드 결과가 객체가 아닙니다: ${entryPath}`);
  }

  const defaultExport = loaded.default;
  if (!isConnectorRunner(defaultExport)) {
    throw new Error(`Connector 모듈 default export가 함수가 아닙니다: ${entryPath}`);
  }

  return defaultExport;
}

function pendingProbe(): StartupProbe {
  return { state: 'pending' };
}

function resolvedProbe(): StartupProbe {
  return { state: 'resolved' };
}

function rejectedProbe(error: unknown): StartupProbe {
  return { state: 'rejected', error };
}

async function probeConnectorStartup(plan: ConnectorRunPlan, promise: Promise<void>): Promise<void> {
  const outcome = await Promise.race([
    promise.then(() => resolvedProbe()).catch((error: unknown) => rejectedProbe(error)),
    new Promise<StartupProbe>((resolve) => {
      setTimeout(() => resolve(pendingProbe()), 0);
    }),
  ]);

  if (outcome.state === 'pending') {
    return;
  }

  if (outcome.state === 'resolved') {
    throw new Error(`Connector/${plan.connectorName}가 시작 직후 종료되었습니다.`);
  }

  throw new Error(`Connector/${plan.connectorName} 시작 실패: ${unknownToErrorMessage(outcome.error)}`);
}

async function startConnector(plan: ConnectorRunPlan): Promise<RunningConnector> {
  const runConnector = await importConnectorRunner(plan.connectorEntryPath);
  const logger = createConnectorLogger(plan);
  const context: ConnectorContext = {
    emit: async (event): Promise<void> => {
      logConnectorEvent(plan, event);
    },
    secrets: plan.secrets,
    logger,
  };

  const execution = runConnector(context);
  await probeConnectorStartup(plan, execution);

  return {
    connectionName: plan.connectionName,
    connectorName: plan.connectorName,
    promise: execution,
  };
}

async function startConnectors(plan: RunnerPlan): Promise<RunningConnector[]> {
  const running: RunningConnector[] = [];
  for (const connectorPlan of plan.connectors) {
    const started = await startConnector(connectorPlan);
    running.push(started);
  }
  return running;
}

function monitorConnectors(connectors: RunningConnector[]): Promise<void> {
  if (connectors.length === 0) {
    return new Promise<void>(() => {
      // no-op: 연결된 connector가 없으면 shutdown signal을 기다린다.
    });
  }

  const watchers = connectors.map(async (connector) => {
    try {
      await connector.promise;
      throw new Error(
        `Connector/${connector.connectorName} (connection=${connector.connectionName})가 예기치 않게 종료되었습니다.`,
      );
    } catch (error) {
      throw new Error(
        `Connector/${connector.connectorName} (connection=${connector.connectionName}) 실패: ${unknownToErrorMessage(error)}`,
      );
    }
  });

  return Promise.race(watchers);
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const shutdown = (): void => {
      resolve();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

function summarizeConnectorPlans(connectors: ConnectorRunPlan[]): string {
  if (connectors.length === 0) {
    return 'none';
  }
  return connectors.map((plan) => `${plan.connectionName}:${plan.connectorName}`).join(', ');
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
  if (args.watch) {
    console.warn('[goondan-runtime] watch mode requested; file watcher is not enabled in this runtime yet.');
  }
  return plan;
}

async function main(): Promise<void> {
  const args = parseRunnerArguments(process.argv.slice(2));
  const plan = await preflight(args);
  const runningConnectors = await startConnectors(plan);

  console.info(
    `[goondan-runtime] started instanceKey=${args.instanceKey} pid=${process.pid} swarm=${plan.selectedSwarm.name} connectors=${runningConnectors.length}`,
  );
  console.info(`[goondan-runtime] active connectors: ${summarizeConnectorPlans(plan.connectors)}`);

  const readyMessage: RunnerReadyMessage = {
    type: 'ready',
    instanceKey: args.instanceKey,
    pid: process.pid,
  };
  sendMessage(readyMessage);

  await runLifecycle(runningConnectors);
  process.exit(0);
}

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
