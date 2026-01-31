import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PipelineManager } from './pipelines.js';
import { resolveSelectorList } from '../config/selectors.js';
import { resolveRef } from '../config/ref.js';
import { makeId } from '../utils/ids.js';
import { resolveTemplate } from './hooks.js';
import type { ConfigRegistry, Resource } from '../config/registry.js';
import type { ToolCatalogItem, ToolRegistry } from '../tools/registry.js';
import type { LiveConfigManager } from '../live-config/manager.js';
import type { Runtime } from './runtime.js';

const PIPELINE_POINTS = [
  'turn.pre',
  'step.pre',
  'step.config',
  'step.tools',
  'step.blocks',
  'step.llmCall',
  'toolCall.pre',
  'toolCall.exec',
  'toolCall.post',
  'step.post',
  'turn.post',
  'workspace.repoAvailable',
  'workspace.worktreeMounted',
];

interface TurnEvent {
  input: string;
  origin?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  agentName?: string;
}

interface Turn {
  id: string;
  input: string;
  origin: Record<string, unknown>;
  auth: Record<string, unknown>;
  summary: string | null;
  toolResults: ToolResult[];
  metadata: Record<string, unknown>;
}

interface Step {
  id: string;
  index: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  llmResult: LlmResult | null;
}

interface ToolCall {
  id?: string;
  name: string;
  input?: Record<string, unknown>;
}

interface ToolResult {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  output: unknown;
}

interface LlmResult {
  content?: string;
  toolCalls?: ToolCall[];
  meta?: unknown;
}

interface PipelineContext extends Record<string, unknown> {
  instance: AgentInstance;
  swarm: Resource;
  agent: Resource;
  turn: Turn;
  step: Step | null;
  effectiveConfig?: Record<string, unknown> | null;
  toolCatalog?: ToolCatalogItem[];
  blocks?: Array<Record<string, unknown>>;
  llmResult?: LlmResult | null;
  toolCall?: ToolCall;
  toolResult?: unknown;
}

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
  extensions: Array<{ resource: Resource; api: unknown }>;
  extensionStates: Map<string, Record<string, unknown>>;
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

  async runTurn(event: TurnEvent): Promise<void> {
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

    const maxSteps = (this.swarmConfig?.spec as { policy?: { maxStepsPerTurn?: number } })?.policy?.maxStepsPerTurn || 16;
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

      stepCtx.llmResult = await this.pipelines.runWrapped('step.llmCall', stepCtx, (ctx) =>
        this.coreLlmCall(ctx)
      );

      step.llmResult = stepCtx.llmResult;
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
  }

  async loadSystemPrompt(): Promise<void> {
    const systemRef = (this.agentConfig?.spec as { prompts?: { systemRef?: string } })?.prompts?.systemRef;
    if (!systemRef) return;
    const promptPath = path.isAbsolute(systemRef)
      ? systemRef
      : path.join(this.baseDir, systemRef);
    this.systemPrompt = await fs.readFile(promptPath, 'utf8');
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
    const nextExtensions: Array<{ resource: Resource; api: unknown }> = [];

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
    const refs = resolveSelectorList(
      (agentConfig?.spec as { extensions?: Array<Record<string, unknown>> })?.extensions || [],
      this.registry
    );
    const resources: Resource[] = [];
    for (const ref of refs) {
      if (ref && typeof ref === 'object' && 'kind' in ref && 'metadata' in ref) {
        resources.push(ref as Resource);
        continue;
      }
      const resolved = resolveRef(this.registry, ref as Record<string, unknown>, 'Extension');
      if (resolved) resources.push(resolved);
    }
    return resources;
  }

  async loadExtensionModule(resource: Resource): Promise<{ register: (api: Record<string, unknown>) => Promise<void> }> {
    const entry = (resource.spec as { entry?: string } | undefined)?.entry;
    if (!entry) {
      throw new Error(`Extension ${resource.metadata.name}에 spec.entry가 필요합니다.`);
    }
    const entryPath = path.isAbsolute(entry) ? entry : path.join(this.baseDir, entry);
    const mod = (await import(pathToFileURL(entryPath).href)) as { register?: (api: Record<string, unknown>) => Promise<void> };
    if (!mod.register) {
      throw new Error(`Extension ${resource.metadata.name}에 register(api) 함수가 필요합니다.`);
    }
    return mod as { register: (api: Record<string, unknown>) => Promise<void> };
  }

  createExtensionApi(extensionResource: Resource, pipelines: PipelineManager<PipelineContext>, extState: Record<string, unknown>): Record<string, unknown> {
    return {
      extension: extensionResource,
      pipelines,
      tools: {
        register: (toolDef: { name: string; handler: (ctx: unknown, input: Record<string, unknown>) => unknown }) =>
          this.runtime.registerDynamicTool(toolDef, extensionResource.metadata.name),
      },
      events: this.runtime.events,
      liveConfig: {
        proposePatch: (proposal: Record<string, unknown>) =>
          this.liveConfigManager.proposePatch(proposal, { agentName: this.name }),
      },
      extState: () => extState,
    };
  }

  async reconcileMcpServers(agentConfig: Resource): Promise<void> {
    const refs = resolveSelectorList(
      (agentConfig?.spec as { mcpServers?: Array<Record<string, unknown>> })?.mcpServers || [],
      this.registry
    );
    const resources: Resource[] = [];
    for (const ref of refs) {
      if (ref && typeof ref === 'object' && 'kind' in ref && 'metadata' in ref) {
        resources.push(ref as Resource);
        continue;
      }
      const resolved = resolveRef(this.registry, ref as Record<string, unknown>, 'MCPServer');
      if (resolved) resources.push(resolved);
    }
    const identities = resources.map((resource) => `${resource.kind}/${resource.metadata.name}`);
    if (arrayEqual(identities, this.mcpIdentities)) return;
    await this.runtime.mcpManager.syncForAgent(this.instanceId, this.name, resources);
    this.mcpIdentities = identities;
  }

  buildToolCatalog(stepCtx: PipelineContext): ToolCatalogItem[] {
    const toolRefs = resolveSelectorList(
      (this.agentConfig?.spec as { tools?: Array<Record<string, unknown>> })?.tools || [],
      this.registry
    )
      .map((item) => {
        if (item && typeof item === 'object' && 'kind' in item && 'metadata' in item) {
          const res = item as Resource;
          return { kind: res.kind, name: res.metadata.name };
        }
        return item;
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    const baseCatalog = this.toolRegistry.buildCatalog(toolRefs);
    const agentConfig = (stepCtx.agent as Resource) || this.agentConfig;
    const mcpCatalog = this.runtime.mcpManager?.getToolsForAgent(this.instanceId, this.name, agentConfig) || [];
    return [...baseCatalog, ...(mcpCatalog as unknown as ToolCatalogItem[])];
  }

  buildContextBlocks(stepCtx: PipelineContext): Array<Record<string, unknown>> {
    const blocks: Array<Record<string, unknown>> = [];
    if (this.systemPrompt) {
      blocks.push({ type: 'system', content: this.systemPrompt });
    }
    if (stepCtx.turn?.input) {
      blocks.push({ type: 'input', content: stepCtx.turn.input });
    }
    if (stepCtx.turn?.toolResults?.length) {
      blocks.push({ type: 'tool.results', items: stepCtx.turn.toolResults });
    }
    const authPending = (stepCtx.turn?.metadata as { authPending?: Array<Record<string, unknown>> } | undefined)?.authPending;
    if (authPending && authPending.length > 0) {
      blocks.push({ type: 'auth.pending', items: authPending });
    }
    return blocks;
  }

  async coreLlmCall(stepCtx: PipelineContext): Promise<LlmResult> {
    const modelConfig = (this.agentConfig?.spec as { modelConfig?: Record<string, unknown> })?.modelConfig || {};
    const modelRef = (modelConfig as { modelRef?: Record<string, unknown> }).modelRef
      ? resolveRef(this.registry, (modelConfig as { modelRef: Record<string, unknown> }).modelRef, 'Model')
      : null;
    const llm = this.runtime.llm || (async () => ({ content: '', toolCalls: [] }));

    return llm({
      model: modelRef,
      params: (modelConfig as { params?: Record<string, unknown> }).params || {},
      blocks: (stepCtx.blocks || []) as Array<Record<string, unknown>>,
      tools: (stepCtx.toolCatalog || []) as unknown as Array<Record<string, unknown>>,
      turn: stepCtx.turn,
      step: stepCtx.step,
      effectiveConfig: stepCtx.effectiveConfig || null,
    });
  }

  async executeToolCall(call: ToolCall, stepCtx: PipelineContext): Promise<ToolResult> {
    const ctx = {
      instance: this,
      swarm: this.swarmConfig,
      agent: this.agentConfig,
      turn: stepCtx.turn,
      step: stepCtx.step,
      toolCatalog: stepCtx.toolCatalog,
      events: this.runtime.events,
      liveConfig: {
        proposePatch: (proposal: Record<string, unknown>) =>
          this.liveConfigManager.proposePatch(proposal, { agentName: this.name }),
      },
      oauth: this.runtime.oauth.withContext({
        auth: stepCtx.turn?.auth as Record<string, unknown>,
        origin: stepCtx.turn?.origin as Record<string, unknown>,
        swarmRef: { kind: 'Swarm', name: this.swarmConfig.metadata.name },
        instanceKey: this.instanceKey,
        agentName: this.name,
      }),
      logger: this.logger,
    };

    let toolCtx: PipelineContext = { ...stepCtx, toolCall: call, toolResult: null };
    toolCtx = await this.pipelines.runMutators('toolCall.pre', toolCtx);
    await this.runtime.emitProgress(stepCtx.turn.origin, `도구 실행: ${call.name}`, stepCtx.turn.auth);

    const result = await this.pipelines.runWrapped('toolCall.exec', toolCtx, async () => {
      const tool = this.toolRegistry.getExport(call.name);
      const input = call.input || {};
      if (tool) {
        return tool.handler(ctx, input);
      }
      if (this.runtime.mcpManager?.hasTool(call.name)) {
        return this.runtime.mcpManager.executeTool(call.name, input, ctx as Record<string, unknown>);
      }
      throw new Error(`Tool export를 찾을 수 없습니다: ${call.name}`);
    });

    toolCtx.toolResult = result;
    this.captureAuthPending(toolCtx);
    toolCtx = await this.pipelines.runMutators('toolCall.post', toolCtx);

    return {
      id: call.id || makeId('tool'),
      name: call.name,
      input: call.input,
      output: toolCtx.toolResult,
    };
  }

  registerLiveConfigProposalListener(): void {
    this.runtime.events.on('liveConfig.patchProposed', (payload) => {
      const proposal = payload as Record<string, unknown> & { agentName?: string };
      if (proposal.agentName && proposal.agentName !== this.name) return;
      void this.liveConfigManager.proposePatch(proposal as any, { agentName: this.name });
    });
  }

  captureAuthPending(ctx: PipelineContext): void {
    const result = ctx.toolResult as { status?: string } | undefined;
    if (!result || result.status !== 'authorization_required') return;
    const metadata = (ctx.turn.metadata ||= {});
    const pending = (metadata as { authPending?: Array<Record<string, unknown>> }).authPending || [];
    pending.push(result as Record<string, unknown>);
    (metadata as { authPending?: Array<Record<string, unknown>> }).authPending = pending;
  }

  async applyHooks(point: string, ctx: PipelineContext): Promise<void> {
    const agentConfig = (ctx.agent as Resource) || this.agentConfig;
    const hooks = (agentConfig?.spec as { hooks?: Array<Record<string, unknown>> })?.hooks || [];
    const matched = hooks
      .filter((hook) => (hook as { point?: string }).point === point)
      .sort((a, b) => {
        const aPriority = (a as { priority?: number }).priority ?? 0;
        const bPriority = (b as { priority?: number }).priority ?? 0;
        return aPriority - bPriority;
      });
    if (matched.length === 0) return;

    for (const hook of matched) {
      const action = (hook as { action?: { toolCall?: { tool?: string; input?: Record<string, unknown> } } }).action;
      if (action?.toolCall) {
        const toolName = action.toolCall.tool || '';
        const inputTemplate = action.toolCall.input || {};
        const input = resolveTemplate(inputTemplate, ctx);
        await this.executeToolCall({ name: toolName, input: input as Record<string, unknown> }, ctx);
      }
    }
  }

  async handleWorkspaceEvent(point: 'workspace.repoAvailable' | 'workspace.worktreeMounted', payload: Record<string, unknown>): Promise<void> {
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

function arrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
