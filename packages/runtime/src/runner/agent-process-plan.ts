/**
 * agent-process-plan.ts -- AgentProcess를 위한 plan 빌드 로직.
 *
 * AgentProcess는 독립 child process이므로 자체적으로 번들을 로드하고,
 * 자신에게 할당된 에이전트의 plan만 추출한다.
 *
 * buildRunnerPlan의 에이전트-전용 서브셋을 추출하는 래퍼.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  BundleLoader,
  buildToolName,
  isJsonObject,
  normalizeObjectRef,
  ToolRegistryImpl,
  ToolExecutor,
  type JsonSchemaObject,
  type JsonSchemaProperty,
  type JsonValue,
  type ObjectRefLike,
  type RuntimeResource,
  type ToolCatalogItem,
  type ValidationError,
} from '../index.js';
import type { AgentProcessPlan, AgentRunnerArguments } from './agent-runner.js';

// ---------------------------------------------------------------------------
// Helpers (extracted from runtime-runner.ts patterns)
// ---------------------------------------------------------------------------

function readSpecRecord(resource: RuntimeResource): Record<string, unknown> {
  const spec = resource.spec;
  if (isJsonObject(spec)) {
    return spec;
  }
  return {};
}

function readStringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return undefined;
}

function readNumberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function extractRefLike(value: unknown): ObjectRefLike | undefined {
  if (typeof value === 'string') return value;
  if (isJsonObject(value)) {
    if (typeof value.ref === 'string') return value.ref;
    if (typeof value.kind === 'string' && typeof value.name === 'string') {
      return { kind: String(value.kind), name: String(value.name), package: typeof value.package === 'string' ? value.package : undefined };
    }
  }
  return undefined;
}

function selectReferencedResource(
  resources: RuntimeResource[],
  ref: ObjectRefLike,
  expectedKind: string,
  contextPackage?: string,
  swarmPackage?: string,
): RuntimeResource {
  const normalized = normalizeObjectRef(ref);
  const candidates = resources.filter((r) => {
    if (r.kind !== expectedKind) return false;
    if (r.metadata.name !== normalized.name) return false;
    if (normalized.package) return r.__package === normalized.package;
    return true;
  });

  if (candidates.length === 0) {
    throw new Error(`${expectedKind}/${normalized.name} 리소스를 찾을 수 없습니다.`);
  }

  // Prefer resource from same package as context
  if (contextPackage) {
    const samePackage = candidates.find((c) => c.__package === contextPackage);
    if (samePackage) return samePackage;
  }
  if (swarmPackage) {
    const swarmPkg = candidates.find((c) => c.__package === swarmPackage);
    if (swarmPkg) return swarmPkg;
  }

  // candidates.length > 0 is guaranteed by the check above
  const first = candidates[0];
  if (!first) {
    throw new Error(`${expectedKind}/${normalized.name} 리소스를 찾을 수 없습니다.`);
  }
  return first;
}

function resolveConnectorCandidates(baseDir: string, entry: string): string[] {
  const candidates: string[] = [];
  const absPath = path.resolve(baseDir, entry);
  candidates.push(absPath);

  if (absPath.endsWith('.js')) {
    candidates.push(absPath.replace(/\.js$/, '.ts'));
  } else if (absPath.endsWith('.ts')) {
    candidates.push(absPath.replace(/\.ts$/, '.js'));
  }

  return candidates;
}

async function resolveEntryPath(resource: RuntimeResource, fieldName: string): Promise<string> {
  const spec = readSpecRecord(resource);
  const entry = readStringValue(spec, fieldName);
  if (!entry) {
    throw new Error(`${resource.kind}/${resource.metadata.name} spec.${fieldName}이 필요합니다.`);
  }

  const rootDir = resource.__rootDir ?? path.dirname(resource.__file);
  const candidates = resolveConnectorCandidates(rootDir, entry);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(`${resource.kind}/${resource.metadata.name} entry 파일을 찾을 수 없습니다: ${entry}`);
}

interface ToolHandlerMap {
  [exportName: string]: (ctx: unknown, input: unknown) => unknown;
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function readToolHandlers(module: unknown): ToolHandlerMap | undefined {
  if (!isJsonObject(module)) return undefined;
  if ('handlers' in module && isJsonObject(module.handlers)) {
    const handlers = module.handlers;
    const result: ToolHandlerMap = {};
    for (const [key, value] of Object.entries(handlers)) {
      if (isFunction(value)) {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  if ('default' in module && isJsonObject(module.default)) {
    return readToolHandlers(module.default);
  }
  return undefined;
}

function parseJsonSchemaProperty(value: unknown): JsonSchemaProperty | undefined {
  if (!isJsonObject(value)) return undefined;
  const result: JsonSchemaProperty = {};
  if (typeof value.type === 'string') result.type = value.type;
  if (typeof value.description === 'string') result.description = value.description;
  if (Array.isArray(value.enum)) result.enum = value.enum;
  return result;
}

function parseJsonSchemaObject(value: unknown): JsonSchemaObject | undefined {
  if (!isJsonObject(value)) return undefined;
  if (value.type !== 'object') return undefined;

  const result: JsonSchemaObject = { type: 'object' };
  if (isJsonObject(value.properties)) {
    const properties: Record<string, JsonSchemaProperty> = {};
    for (const [key, val] of Object.entries(value.properties)) {
      const parsed = parseJsonSchemaProperty(val);
      if (parsed) properties[key] = parsed;
    }
    result.properties = properties;
  }
  if (Array.isArray(value.required)) {
    result.required = value.required.filter((r): r is string => typeof r === 'string');
  }
  return result;
}

function createDefaultObjectSchema(): JsonSchemaObject {
  return {
    type: 'object',
    properties: {},
  };
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeEnvToken(value: string): string {
  return value.replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
}

function resolveModelApiKey(modelSpec: Record<string, unknown>, env: NodeJS.ProcessEnv, modelName: string): string {
  const apiKeySpec = modelSpec.apiKey;
  if (isJsonObject(apiKeySpec)) {
    if (isJsonObject(apiKeySpec.valueFrom)) {
      if (typeof apiKeySpec.valueFrom.env === 'string') {
        const envValue = env[apiKeySpec.valueFrom.env];
        if (typeof envValue === 'string') return envValue;
      }
    }
  }

  const provider = readStringValue(modelSpec, 'provider');
  if (provider) {
    const providerEnvKey = `${normalizeEnvToken(provider)}_API_KEY`;
    const envValue = env[providerEnvKey];
    if (typeof envValue === 'string') return envValue;
  }

  const modelEnvKey = `${normalizeEnvToken(modelName)}_API_KEY`;
  const modelEnvValue = env[modelEnvKey];
  if (typeof modelEnvValue === 'string') return modelEnvValue;

  return '';
}

// ---------------------------------------------------------------------------
// Swarm selection helpers
// ---------------------------------------------------------------------------

interface SwarmAgentRef {
  name: string;
  packageName?: string;
}

function parseSwarmAgentRef(value: unknown): SwarmAgentRef {
  if (typeof value === 'string') return { name: value };
  if (isJsonObject(value)) {
    const name = typeof value.name === 'string' ? value.name : '';
    const packageName = typeof value.package === 'string' ? value.package : undefined;
    return { name, packageName };
  }
  return { name: '' };
}

interface RuntimeExtensionSpec {
  entry: string;
  config?: Record<string, unknown>;
}

function toExtensionResource(resource: RuntimeResource): RuntimeResource<RuntimeExtensionSpec> {
  const spec = readSpecRecord(resource);
  const entry = readStringValue(spec, 'entry');
  if (!entry) {
    throw new Error(`Extension/${resource.metadata.name} spec.entry가 필요합니다.`);
  }
  return {
    ...resource,
    spec: {
      entry,
      config: isJsonObject(spec.config) ? spec.config : undefined,
    },
  };
}

function parseAgentToolRefs(agent: RuntimeResource): ObjectRefLike[] {
  const spec = readSpecRecord(agent);
  const tools = spec.tools;
  if (!Array.isArray(tools)) return [];
  const refs: ObjectRefLike[] = [];
  for (const item of tools) {
    const ref = extractRefLike(item);
    if (ref) refs.push(ref);
  }
  return refs;
}

function parseAgentExtensionRefs(agent: RuntimeResource): ObjectRefLike[] {
  const spec = readSpecRecord(agent);
  const extensions = spec.extensions;
  if (!Array.isArray(extensions)) return [];
  const refs: ObjectRefLike[] = [];
  for (const item of extensions) {
    const ref = extractRefLike(item);
    if (ref) refs.push(ref);
  }
  return refs;
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

function mergeRequiredToolsGuardConfig(
  config: Record<string, unknown> | undefined,
  requiredToolNames: string[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = isJsonObject(config) ? { ...config } : {};

  const configuredRequiredTools: string[] = [];
  if (Array.isArray(merged.requiredTools)) {
    for (const value of merged.requiredTools) {
      if (typeof value !== 'string') continue;
      const normalized = value.trim();
      if (normalized.length === 0) continue;
      configuredRequiredTools.push(normalized);
    }
  }

  merged.requiredTools = [...new Set([...configuredRequiredTools, ...requiredToolNames])];
  return merged;
}


function isObjectRefLike(value: unknown): value is ObjectRefLike {
  if (typeof value === 'string') return true;
  if (isJsonObject(value)) {
    if (typeof value.ref === 'string') return true;
    if (typeof value.kind === 'string' && typeof value.name === 'string') return true;
  }
  return false;
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

  return {
    maxTokens: readNumberValue(params, 'maxTokens') ?? 1000,
    temperature: readNumberValue(params, 'temperature') ?? 0.2,
  };
}

async function readAgentPromptMetadata(
  agent: RuntimeResource,
): Promise<AgentProcessPlan['agentMetadata']['prompt'] | undefined> {
  const spec = readSpecRecord(agent);
  const prompt = spec.prompt;
  if (!isJsonObject(prompt)) {
    return undefined;
  }

  const inlinePrompt = typeof prompt.system === 'string' && prompt.system.trim().length > 0
    ? prompt.system
    : undefined;
  if (inlinePrompt) {
    return {
      system: inlinePrompt,
    };
  }

  const systemRef = typeof prompt.systemRef === 'string' && prompt.systemRef.trim().length > 0
    ? prompt.systemRef.trim()
    : undefined;
  if (!systemRef) {
    return undefined;
  }

  const bundleRoot = agent.__rootDir ? path.resolve(agent.__rootDir) : process.cwd();
  const promptPath = path.resolve(bundleRoot, systemRef);
  let resolvedSystem: string;
  try {
    resolvedSystem = await readFile(promptPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Agent/${agent.metadata.name} prompt.systemRef를 읽을 수 없습니다: ${promptPath} (${message})`,
    );
  }

  if (resolvedSystem.trim().length === 0) {
    return undefined;
  }
  return {
    system: resolvedSystem,
  };
}

function parseSwarmMaxStepsPerTurn(swarmResource: RuntimeResource): number {
  const spec = readSpecRecord(swarmResource);
  const policy = spec.policy;
  if (isJsonObject(policy)) {
    const maxSteps = readNumberValue(policy, 'maxStepsPerTurn');
    if (maxSteps && maxSteps > 0) return maxSteps;
  }
  return 25;
}

function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join('\n');
}

async function registerToolResource(
  resource: RuntimeResource,
  toolRegistry: ToolRegistryImpl,
): Promise<{ entryPath: string; catalogItems: ToolCatalogItem[] }> {
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
    if (!isJsonObject(exportItem)) continue;

    const exportName = readStringValue(exportItem, 'name');
    if (!exportName) continue;

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
      source: { type: 'config', name: resource.metadata.name },
    };

    toolRegistry.register(catalogItem, async (ctx, input) => {
      const output = await Promise.resolve(handler(ctx, input));
      return toJsonValue(output);
    });

    catalogItems.push(catalogItem);
  }

  return { entryPath, catalogItems };
}

// ---------------------------------------------------------------------------
// buildAgentProcessPlan
// ---------------------------------------------------------------------------

export async function buildAgentProcessPlan(args: AgentRunnerArguments): Promise<AgentProcessPlan> {
  const loader = new BundleLoader({ stateRoot: args.stateRoot });
  const loaded = await loader.load(args.bundleDir);

  if (loaded.errors.length > 0) {
    throw new Error(formatValidationErrors(loaded.errors));
  }

  // Find swarm
  const swarmResources = loaded.resources.filter((r) => r.kind === 'Swarm');
  let swarmResource: RuntimeResource;
  if (args.swarmName) {
    const found = swarmResources.find((r) => r.metadata.name === args.swarmName);
    if (!found) throw new Error(`Swarm/${args.swarmName}를 찾을 수 없습니다.`);
    swarmResource = found;
  } else if (swarmResources.length === 1 && swarmResources[0]) {
    swarmResource = swarmResources[0];
  } else {
    throw new Error('Swarm 리소스가 없거나 여러 개입니다. --swarm-name을 지정하세요.');
  }

  const swarmSpec = readSpecRecord(swarmResource);
  const maxStepsPerTurn = parseSwarmMaxStepsPerTurn(swarmResource);

  // Parse swarm agents
  const agentsValue = swarmSpec.agents;
  if (!Array.isArray(agentsValue) || agentsValue.length === 0) {
    throw new Error(`Swarm/${swarmResource.metadata.name} spec.agents가 비어 있습니다.`);
  }

  const entryAgentRef = parseSwarmAgentRef(swarmSpec.entryAgent ?? agentsValue[0]);
  const allAgentRefs = agentsValue.map(parseSwarmAgentRef);
  const swarmInstanceKey = args.instanceKey;

  // Find agent resource for this specific agent
  const agentResource = selectReferencedResource(
    loaded.resources,
    { kind: 'Agent', name: args.agentName },
    'Agent',
    swarmResource.__package,
  );

  // Resolve model
  const modelRef = parseAgentModelRef(agentResource);
  const modelResource = selectReferencedResource(
    loaded.resources, modelRef, 'Model', agentResource.__package,
  );
  const modelSpec = readSpecRecord(modelResource);
  const provider = readStringValue(modelSpec, 'provider');
  const modelName = readStringValue(modelSpec, 'model');
  if (!provider || !modelName) {
    throw new Error(`Model/${modelResource.metadata.name} spec.provider/spec.model이 필요합니다.`);
  }
  const apiKey = resolveModelApiKey(modelSpec, process.env, modelResource.metadata.name);
  const agentPrompt = await readAgentPromptMetadata(agentResource);
  const agentMetadata: AgentProcessPlan['agentMetadata'] = {
    name: args.agentName,
    bundleRoot: agentResource.__rootDir ? path.resolve(agentResource.__rootDir) : process.cwd(),
  };
  if (agentPrompt !== undefined) {
    agentMetadata.prompt = agentPrompt;
  }
  const modelParams = parseAgentModelParams(agentResource);

  // Register tools
  const toolRegistry = new ToolRegistryImpl();
  const toolExecutor = new ToolExecutor(toolRegistry);
  const toolRefs = parseAgentToolRefs(agentResource);
  const agentToolCatalog: ToolCatalogItem[] = [];

  for (const toolRef of toolRefs) {
    const toolResource = selectReferencedResource(
      loaded.resources, toolRef, 'Tool', agentResource.__package,
    );
    const registration = await registerToolResource(toolResource, toolRegistry);
    for (const item of registration.catalogItems) {
      if (!agentToolCatalog.some((c) => c.name === item.name)) {
        agentToolCatalog.push(item);
      }
    }
  }

  // Extensions
  const extensionRefs = parseAgentExtensionRefs(agentResource);
  const extensionResources: RuntimeResource<RuntimeExtensionSpec>[] = [];
  for (const extRef of extensionRefs) {
    const rawExtResource = selectReferencedResource(
      loaded.resources, extRef, 'Extension', agentResource.__package,
    );
    extensionResources.push(toExtensionResource(rawExtResource));
  }

  const requiredToolNames = parseAgentRequiredTools(agentResource);
  for (const requiredToolName of requiredToolNames) {
    const existsInCatalog = agentToolCatalog.some((item) => item.name === requiredToolName);
    if (!existsInCatalog) {
      throw new Error(
        `Agent/${agentResource.metadata.name} spec.requiredTools(${requiredToolName})가 toolCatalog에 없습니다.`,
      );
    }
  }

  if (requiredToolNames.length > 0) {
    const guardIndex = extensionResources.findIndex(
      (resource) => resource.metadata.name === 'required-tools-guard',
    );

    if (guardIndex >= 0) {
      const current = extensionResources[guardIndex];
      if (current) {
        extensionResources[guardIndex] = {
          ...current,
          spec: {
            ...current.spec,
            config: mergeRequiredToolsGuardConfig(current.spec.config, requiredToolNames),
          },
        };
      }
    } else {
      const rawGuardExtension = selectReferencedResource(
        loaded.resources,
        { kind: 'Extension', name: 'required-tools-guard' },
        'Extension',
        agentResource.__package,
        swarmResource.__package,
      );
      const guardExtension = toExtensionResource(rawGuardExtension);
      extensionResources.push({
        ...guardExtension,
        spec: {
          ...guardExtension.spec,
          config: mergeRequiredToolsGuardConfig(guardExtension.spec.config, requiredToolNames),
        },
      });
    }
  }

  const plan: AgentProcessPlan = {
    name: args.agentName,
    swarmInstanceKey,
    modelName,
    provider,
    apiKey,
    agentMetadata,
    maxTokens: modelParams.maxTokens,
    temperature: modelParams.temperature,
    maxSteps: maxStepsPerTurn,
    toolCatalog: agentToolCatalog,
    extensionResources,
    toolExecutor,
    swarmName: swarmResource.metadata.name,
    entryAgent: entryAgentRef.name,
    availableAgents: allAgentRefs.map((a) => a.name),
  };
  return plan;
}
