import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PipelineManager } from './pipelines.js';
import { resolveSelectorList } from '../config/selectors.js';
import { resolveRef } from '../config/ref.js';
import { makeId } from '../utils/ids.js';
import { resolveTemplate } from './hooks.js';
import type { ConfigRegistry, Resource } from '../config/registry.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { LiveConfigManager } from '../live-config/manager.js';
import type { Runtime } from './runtime.js';
import type {
  AgentSpec,
  Block,
  DynamicToolDefinition,
  ErrorInfo,
  EventBus,
  ExtensionApi,
  JsonObject,
  JsonValue,
  LlmResult,
  LiveConfigPatchProposal,
  ObjectRefLike,
  PipelinePoint,
  Step,
  StepContext,
  SwarmSpec,
  ToolCall,
  ToolCatalogItem,
  ToolContext,
  ToolResult,
  ToolSpec,
  Turn,
  UnknownObject,
} from '../sdk/types.js';

const PIPELINE_POINTS: PipelinePoint[] = [
  'turn.pre',
  'step.pre',
  'step.config',
  'step.tools',
  'step.blocks',
  'step.llmCall',
  'step.llmError',
  'toolCall.pre',
  'toolCall.exec',
  'toolCall.post',
  'step.post',
  'turn.post',
  'workspace.repoAvailable',
  'workspace.worktreeMounted',
];

type TurnEvent = {
  input: string;
  origin?: JsonObject;
  auth?: JsonObject;
  metadata?: JsonObject;
  agentName?: string;
};

type PipelineContext = StepContext;

interface AgentInstanceOptions {
  name: string;
  instanceId: string;
  instanceKey: string;
  agentConfig: Resource;
  swarmConfig: Resource;
  registry: ConfigRegistry;
  toolRegistry: ToolRegistry;
  liveConfigManager: LiveConfigManager;
  runtime: Runtime;
  logger?: Console;
  baseDir?: string;
}

export class AgentInstance {
  name: string;
  instanceId: string;
  instanceKey: string;
  agentConfig: Resource;
  swarmConfig: Resource;
  registry: ConfigRegistry;
  toolRegistry: ToolRegistry;
  liveConfigManager: LiveConfigManager;
  runtime: Runtime;
  logger: Console;
  baseDir: string;
  queue: TurnEvent[];
  processing: boolean;
  pipelines: PipelineManager<PipelineContext>;
  extensions: Array<{ resource: Resource; api: ExtensionApi }>;
  extensionStates: Map<string, UnknownObject>;
  extensionIdentities: string[];
  mcpIdentities: string[];
  systemPrompt: string | null;

  constructor(options: AgentInstanceOptions) {
    this.name = options.name;
    this.instanceId = options.instanceId;
    this.instanceKey = options.instanceKey;
    this.agentConfig = options.agentConfig;
    this.swarmConfig = options.swarmConfig;
    this.registry = options.registry;
    this.toolRegistry = options.toolRegistry;
    this.liveConfigManager = options.liveConfigManager;
    this.runtime = options.runtime;
    this.logger = options.logger || console;
    this.baseDir = options.baseDir || this.registry?.baseDir || process.cwd();

    this.queue = [];
    this.processing = false;
    this.pipelines = new PipelineManager<PipelineContext>(PIPELINE_POINTS);
    this.extensions = [];
    this.extensionStates = new Map();
    this.extensionIdentities = [];
    this.mcpIdentities = [];
    this.systemPrompt = null;
  }

  async init(): Promise<void> {
    await this.loadSystemPrompt();
    await this.reconcileExtensions(this.agentConfig);
    this.registerLiveConfigProposalListener();
  }

  enqueueEvent(event: TurnEvent): void {
    this.queue.push(event);
    if (!this.processing) {
      this.processing = true;
      this.processQueue().catch((err) => {
        this.logger.error(err);
      });
    }
  }

  async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (event) {
        await this.runTurn(event);
      }
    }
    this.processing = false;
  }

  async runTurn(event: TurnEvent): Promise<Turn> {
    const turn: Turn = {
      id: makeId('turn'),
      input: event.input,
      origin: event.origin || {},
      auth: event.auth || {},
      summary: null,
      toolResults: [],
      metadata: event.metadata || {},
    };

    let turnCtx: PipelineContext = {
      instance: this,
      swarm: this.swarmConfig,
      agent: this.agentConfig,
      turn,
      step: null,
    };

    turnCtx = await this.pipelines.runMutators('turn.pre', turnCtx);
    await this.applyHooks('turn.pre', turnCtx);

    const maxSteps = (this.swarmConfig?.spec as SwarmSpec | undefined)?.policy?.maxStepsPerTurn || 16;
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      const step: Step = {
        id: makeId('step'),
        index: stepIndex,
        toolCalls: [],
        toolResults: [],
        llmResult: null,
      };

      let stepCtx: PipelineContext = {
        ...turnCtx,
        step,
        effectiveConfig: null,
        toolCatalog: [],
        blocks: [],
      };

      stepCtx = await this.pipelines.runMutators('step.pre', stepCtx);
      await this.applyHooks('step.pre', stepCtx);

      stepCtx.effectiveConfig = await this.liveConfigManager.applyAtSafePoint({
        agentName: this.name,
        stepId: step.id,
      });
      if (stepCtx.effectiveConfig?.agent) {
        stepCtx.agent = stepCtx.effectiveConfig.agent as Resource;
      }
      if (stepCtx.effectiveConfig?.swarm) {
        stepCtx.swarm = stepCtx.effectiveConfig.swarm as Resource;
      }
      await this.reconcileExtensions(stepCtx.agent as Resource);
      await this.reconcileMcpServers(stepCtx.agent as Resource);

      stepCtx = await this.pipelines.runMutators('step.config', stepCtx);
      await this.applyHooks('step.config', stepCtx);

      stepCtx.toolCatalog = this.buildToolCatalog(stepCtx);
      stepCtx = await this.pipelines.runMutators('step.tools', stepCtx);
      await this.applyHooks('step.tools', stepCtx);

      stepCtx.blocks = this.buildContextBlocks(stepCtx);
      stepCtx = await this.pipelines.runMutators('step.blocks', stepCtx);
      await this.applyHooks('step.blocks', stepCtx);

      stepCtx = await this.runLlmCall(stepCtx);

      step.llmResult = stepCtx.llmResult ?? null;
      const toolCalls = stepCtx.llmResult?.toolCalls || [];
      step.toolCalls = toolCalls;

      if (toolCalls.length > 0) {
        for (const call of toolCalls) {
          const toolResult = await this.executeToolCall(call, stepCtx);
          step.toolResults.push(toolResult);
          turn.toolResults.push(toolResult);
        }
        stepCtx = await this.pipelines.runMutators('step.post', stepCtx);
        await this.applyHooks('step.post', stepCtx);
        continue;
      }

      if (stepCtx.llmResult?.content) {
        turn.summary = stepCtx.llmResult.content;
      }

      stepCtx = await this.pipelines.runMutators('step.post', stepCtx);
      await this.applyHooks('step.post', stepCtx);
      break;
    }

    if (turn.summary) {
      await this.runtime.emitFinal(turn.origin, turn.summary, turn.auth);
    }

    turnCtx = { ...turnCtx, step: null };
    turnCtx = await this.pipelines.runMutators('turn.post', turnCtx);
    await this.applyHooks('turn.post', turnCtx);

    return turn;
  }

  async loadSystemPrompt(): Promise<void> {
    const prompts = (this.agentConfig?.spec as AgentSpec | undefined)?.prompts;
    if (prompts?.systemRef) {
      const promptPath = path.isAbsolute(prompts.systemRef)
        ? prompts.systemRef
        : path.join(this.baseDir, prompts.systemRef);
      this.systemPrompt = await fs.readFile(promptPath, 'utf8');
      return;
    }
    if (typeof prompts?.system === 'string') {
      this.systemPrompt = prompts.system;
    }
  }

  async reconcileExtensions(agentConfig: Resource): Promise<void> {
    const extensionResources = this.resolveExtensionResources(agentConfig);
    const identities = extensionResources.map((resource) => `${resource.kind}/${resource.metadata.name}`);
    if (arrayEqual(identities, this.extensionIdentities)) return;

    const removed = this.extensionIdentities.filter((id) => !identities.includes(id));
    for (const id of removed) {
      const name = id.split('/')[1];
      if (name) {
        this.runtime.unregisterDynamicTools(name);
      }
    }

    const pipelines = new PipelineManager<PipelineContext>(PIPELINE_POINTS);
    const nextExtensions: Array<{ resource: Resource; api: ExtensionApi }> = [];

    for (const resource of extensionResources) {
      const module = await this.loadExtensionModule(resource);
      const extState = this.extensionStates.get(resource.metadata.name) || {};
      const api = this.createExtensionApi(resource, pipelines, extState);
      await module.register(api);
      this.extensionStates.set(resource.metadata.name, extState);
      nextExtensions.push({ resource, api });
    }

    this.pipelines = pipelines;
    this.extensions = nextExtensions;
    this.extensionIdentities = identities;
  }

  resolveExtensionResources(agentConfig: Resource): Resource[] {
    const refs = resolveSelectorList((agentConfig?.spec as AgentSpec | undefined)?.extensions || [], this.registry);
    const resources: Resource[] = [];
    for (const ref of refs) {
      if (ref && typeof ref === 'object' && 'kind' in ref && 'metadata' in ref) {
        resources.push(ref as Resource);
        continue;
      }
      const resolved = resolveRef(this.registry, ref as ObjectRefLike, 'Extension');
      if (resolved) resources.push(resolved);
    }
    return resources;
  }

  async loadExtensionModule(resource: Resource): Promise<{ register: (api: ExtensionApi) => Promise<void> }> {
    const entry = (resource.spec as { entry?: string } | undefined)?.entry;
    if (!entry) {
      throw new Error(`Extension ${resource.metadata.name}에 spec.entry가 필요합니다.`);
    }
    const entryPath = path.isAbsolute(entry) ? entry : path.join(this.baseDir, entry);
    const mod = (await import(pathToFileURL(entryPath).href)) as { register?: (api: ExtensionApi) => Promise<void> };
    if (!mod.register) {
      throw new Error(`Extension ${resource.metadata.name}에 register(api) 함수가 필요합니다.`);
    }
    return mod as { register: (api: ExtensionApi) => Promise<void> };
  }

  createExtensionApi(
    extensionResource: Resource,
    pipelines: PipelineManager<PipelineContext>,
    extState: UnknownObject
  ): ExtensionApi {
    const pipelineApi = {
      mutate: (point: PipelinePoint, fn: (ctx: StepContext) => Promise<StepContext | void> | StepContext | void) =>
        pipelines.mutate(point, fn),
      wrap: <R = StepContext>(
        point: PipelinePoint,
        fn: (next: (ctx: StepContext) => Promise<R>) => (ctx: StepContext) => Promise<R>
      ) => pipelines.wrap(point, fn as any),
    };
    return {
      extension: extensionResource as unknown as ExtensionApi['extension'],
      pipelines: pipelineApi,
      tools: {
        register: (toolDef: DynamicToolDefinition) =>
          this.runtime.registerDynamicTool(toolDef, extensionResource.metadata.name),
      },
      events: this.getEventBus(),
      liveConfig: {
        proposePatch: (proposal: LiveConfigPatchProposal) =>
          this.liveConfigManager.proposePatch(proposal, { agentName: this.name }),
      },
      extState: () => extState,
    };
  }

  async reconcileMcpServers(agentConfig: Resource): Promise<void> {
    const refs = resolveSelectorList((agentConfig?.spec as AgentSpec | undefined)?.mcpServers || [], this.registry);
    const resources: Resource[] = [];
    for (const ref of refs) {
      if (ref && typeof ref === 'object' && 'kind' in ref && 'metadata' in ref) {
        resources.push(ref as Resource);
        continue;
      }
      const resolved = resolveRef(this.registry, ref as ObjectRefLike, 'MCPServer');
      if (resolved) resources.push(resolved);
    }
    const identities = resources.map((resource) => `${resource.kind}/${resource.metadata.name}`);
    if (arrayEqual(identities, this.mcpIdentities)) return;
    await this.runtime.mcpManager.syncForAgent(this.instanceId, this.name, resources);
    this.mcpIdentities = identities;
  }

  buildToolCatalog(stepCtx: PipelineContext): ToolCatalogItem[] {
    const toolRefs = resolveSelectorList((this.agentConfig?.spec as AgentSpec | undefined)?.tools || [], this.registry)
      .map((item) => {
        if (item && typeof item === 'object' && 'kind' in item && 'metadata' in item) {
          const res = item as Resource;
          return { kind: res.kind, name: res.metadata.name };
        }
        return item;
      })
      .filter(Boolean) as Array<ObjectRefLike>;

    const baseCatalog = this.toolRegistry.buildCatalog(toolRefs);
    const agentConfig = (stepCtx.agent as Resource) || this.agentConfig;
    const mcpCatalog = this.runtime.mcpManager?.getToolsForAgent(this.instanceId, this.name, agentConfig) || [];
    return [...baseCatalog, ...mcpCatalog];
  }

  buildContextBlocks(stepCtx: PipelineContext): Block[] {
    const blocks: Block[] = [];
    if (this.systemPrompt) {
      blocks.push({ type: 'system', content: this.systemPrompt });
    }
    if (stepCtx.turn?.input) {
      blocks.push({ type: 'input', content: stepCtx.turn.input });
    }
    if (stepCtx.turn?.toolResults?.length) {
      blocks.push({ type: 'tool.results', items: stepCtx.turn.toolResults });
    }
    const authPending = (stepCtx.turn?.metadata as { authPending?: JsonObject[] } | undefined)?.authPending;
    if (authPending && authPending.length > 0) {
      blocks.push({ type: 'auth.pending', items: authPending });
    }
    return blocks;
  }

  async coreLlmCall(stepCtx: PipelineContext): Promise<LlmResult> {
    const modelConfig = (this.agentConfig?.spec as AgentSpec | undefined)?.modelConfig;
    const modelRef = modelConfig?.modelRef
      ? resolveRef(this.registry, modelConfig.modelRef as ObjectRefLike, 'Model')
      : null;
    const llm = this.runtime.llm || (async () => ({ content: '', toolCalls: [] }));
    const metadata = (stepCtx.turn.metadata ||= {});
    if ((stepCtx.turn.origin as JsonObject | undefined)?.connector === 'cli' && !metadata._llmProgressEmitted) {
      metadata._llmProgressEmitted = true;
      await this.runtime.emitProgress(stepCtx.turn.origin, '모델 호출 중...', stepCtx.turn.auth);
    }

    return llm({
      model: modelRef,
      params: modelConfig?.params || {},
      blocks: stepCtx.blocks || [],
      tools: stepCtx.toolCatalog || [],
      turn: stepCtx.turn,
      step: stepCtx.step,
      effectiveConfig: stepCtx.effectiveConfig || null,
    });
  }

  async runLlmCall(stepCtx: PipelineContext): Promise<PipelineContext> {
    const callOnce = async (ctx: PipelineContext) =>
      this.pipelines.runWrapped('step.llmCall', ctx, (inner) => this.coreLlmCall(inner));

    try {
      stepCtx.llmResult = await callOnce(stepCtx);
      stepCtx.llmError = null;
      return stepCtx;
    } catch (err) {
      stepCtx.llmResult = null;
      stepCtx.llmError = buildErrorInfo(err);
      stepCtx = await this.pipelines.runMutators('step.llmError', stepCtx);
      await this.applyHooks('step.llmError', stepCtx);

      if (stepCtx.llmResult) {
        return stepCtx;
      }

      try {
        stepCtx.llmResult = await callOnce(stepCtx);
        stepCtx.llmError = null;
        return stepCtx;
      } catch (retryErr) {
        stepCtx.llmResult = null;
        stepCtx.llmError = buildErrorInfo(retryErr);
        throw retryErr;
      }
    }
  }

  async executeToolCall(call: ToolCall, stepCtx: PipelineContext): Promise<ToolResult> {
    if (!stepCtx.step) {
      throw new Error('Tool 실행에는 step 정보가 필요합니다.');
    }
    const ctx: ToolContext = {
      instance: this,
      swarm: this.swarmConfig,
      agent: this.agentConfig,
      turn: stepCtx.turn,
      step: stepCtx.step,
      toolCatalog: stepCtx.toolCatalog || [],
      events: this.getEventBus(),
      liveConfig: {
        proposePatch: (proposal: LiveConfigPatchProposal) =>
          this.liveConfigManager.proposePatch(proposal, { agentName: this.name }),
      },
      oauth: this.runtime.oauth.withContext({
        auth: stepCtx.turn?.auth,
        origin: stepCtx.turn?.origin,
        swarmRef: { kind: 'Swarm', name: this.swarmConfig.metadata.name },
        instanceKey: this.instanceKey,
        agentName: this.name,
      }),
      logger: this.logger,
    };

    let toolCtx: PipelineContext = { ...stepCtx, toolCall: call, toolResult: null };
    toolCtx = await this.pipelines.runMutators('toolCall.pre', toolCtx);
    await this.runtime.emitProgress(stepCtx.turn.origin, `도구 실행: ${call.name}`, stepCtx.turn.auth);

    const toolExport = this.toolRegistry.getExport(call.name);
    const input = (call.input || {}) as JsonObject;
    const errorMessageLimit = resolveToolErrorMessageLimit(toolExport?.tool ?? null);
    let result: JsonValue;
    try {
      result = (await this.pipelines.runWrapped('toolCall.exec', toolCtx, async () => {
        if (toolExport) {
          return toolExport.handler(ctx, input);
        }
        if (this.runtime.mcpManager?.hasTool(call.name)) {
          return this.runtime.mcpManager.executeTool(call.name, input, ctx);
        }
        throw new Error(`Tool export를 찾을 수 없습니다: ${call.name}`);
      })) as JsonValue;
    } catch (err) {
      const errorInfo = buildErrorInfo(err, errorMessageLimit);
      result = { status: 'error', error: errorInfo } as JsonValue;
    }

    toolCtx.toolResult = result as JsonValue;
    this.captureAuthPending(toolCtx);
    toolCtx = await this.pipelines.runMutators('toolCall.post', toolCtx);

    return {
      id: call.id || makeId('tool'),
      name: call.name,
      input: call.input,
      output: toolCtx.toolResult as JsonValue,
    };
  }

  registerLiveConfigProposalListener(): void {
    this.runtime.events.on('liveConfig.patchProposed', (payload) => {
      const proposal = payload as LiveConfigPatchProposal & { agentName?: string };
      if (proposal.agentName && proposal.agentName !== this.name) return;
      const { agentName: _agentName, ...pure } = proposal;
      void this.liveConfigManager.proposePatch(pure, { agentName: this.name });
    });
  }

  private getEventBus(): EventBus {
    return {
      emit: (event, payload) => {
        this.runtime.events.emit(event, payload);
      },
      on: (event, handler) => {
        this.runtime.events.on(event, handler as (payload: UnknownObject) => void);
      },
      off: (event, handler) => {
        this.runtime.events.off(event, handler as (payload: UnknownObject) => void);
      },
    };
  }

  captureAuthPending(ctx: PipelineContext): void {
    const result = ctx.toolResult as { status?: string } | undefined;
    if (!result || result.status !== 'authorization_required') return;
    const metadata = (ctx.turn.metadata ||= {});
    const pending = (metadata as { authPending?: JsonObject[] }).authPending || [];
    pending.push(result as JsonObject);
    (metadata as { authPending?: JsonObject[] }).authPending = pending;
  }

  async applyHooks(point: string, ctx: PipelineContext): Promise<void> {
    const agentConfig = (ctx.agent as Resource) || this.agentConfig;
    const hooks = (agentConfig?.spec as AgentSpec | undefined)?.hooks || [];
    const matched = hooks
      .filter((hook) => (hook as { point?: string }).point === point)
      .sort((a, b) => {
        const aPriority = (a as { priority?: number }).priority ?? 0;
        const bPriority = (b as { priority?: number }).priority ?? 0;
        return aPriority - bPriority;
      });
    if (matched.length === 0) return;

    for (const hook of matched) {
      const action = (hook as { action?: { toolCall?: { tool?: string; input?: JsonObject } } }).action;
      if (action?.toolCall) {
        const toolName = action.toolCall.tool || '';
        const inputTemplate = action.toolCall.input || {};
        const input = resolveTemplate(inputTemplate, ctx);
        await this.executeToolCall({ name: toolName, input: input as JsonObject }, ctx);
      }
    }
  }

  async handleWorkspaceEvent(point: 'workspace.repoAvailable' | 'workspace.worktreeMounted', payload: JsonObject): Promise<void> {
    let ctx: PipelineContext = {
      instance: this,
      swarm: this.swarmConfig,
      agent: this.agentConfig,
      turn: {
        id: makeId('turn'),
        input: '',
        origin: {},
        auth: {},
        summary: null,
        toolResults: [],
        metadata: { workspace: payload },
      },
      step: null,
    };
    ctx = await this.pipelines.runMutators(point, ctx);
  }
}

const DEFAULT_TOOL_ERROR_MESSAGE_LIMIT = 1000;

function arrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function resolveToolErrorMessageLimit(tool: Resource<ToolSpec> | null): number {
  const raw = tool?.spec?.errorMessageLimit;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_TOOL_ERROR_MESSAGE_LIMIT;
  }
  const limit = Math.floor(raw);
  if (limit < 0) return DEFAULT_TOOL_ERROR_MESSAGE_LIMIT;
  return limit;
}

function buildErrorInfo(error: unknown, limit?: number): ErrorInfo {
  const message = truncateMessage(resolveErrorMessage(error), limit);
  const info: ErrorInfo = { message };
  const name = resolveErrorName(error);
  if (name) info.name = name;
  const code = resolveErrorCode(error);
  if (code) info.code = code;
  return info;
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (typeof error.message === 'string' && error.message.length > 0) return error.message;
    if (typeof error.name === 'string' && error.name.length > 0) return error.name;
  }
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function resolveErrorName(error: unknown): string | undefined {
  if (error instanceof Error && error.name) return error.name;
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return undefined;
}

function resolveErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
  }
  return undefined;
}

function truncateMessage(message: string, limit?: number): string {
  if (limit == null || !Number.isFinite(limit)) return message;
  const max = Math.floor(limit);
  if (max < 0) return message;
  if (message.length <= max) return message;
  if (max <= 3) return message.slice(0, Math.max(0, max));
  return `${message.slice(0, max - 3)}...`;
}
