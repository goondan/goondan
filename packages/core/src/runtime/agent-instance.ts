import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PipelineManager } from './pipelines.js';
import { resolveSelectorList } from '../config/selectors.js';
import { resolveRef } from '../config/ref.js';
import { makeId } from '../utils/ids.js';
import { appendJsonl, ensureDir, readJsonl } from '../utils/fs.js';
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
  ExtensionSpec,
  HookSpec,
  LlmMessage,
  JsonObject,
  JsonValue,
  LlmResult,
  LiveConfigPatchOp,
  LiveConfigPatchProposal,
  LiveConfigPatchSpec,
  OAuthTokenResult,
  ObjectRef,
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

type LlmMessageRecord = {
  type: 'llm.message';
  recordedAt: string;
  instanceId: string;
  agentName: string;
  turnId: string;
  stepId?: string;
  stepIndex?: number;
  message: LlmMessage;
};

type RuntimeLike = {
  llm: Runtime['llm'];
  emitProgress: Runtime['emitProgress'];
  emitFinal: Runtime['emitFinal'];
  stateDir: string;
  oauth: {
    withContext: (input: {
      auth?: JsonObject;
      origin?: JsonObject;
      swarmRef?: { kind: string; name: string };
      instanceKey?: string;
      agentName?: string;
    }) => {
      getAccessToken: (request: {
        oauthAppRef: ObjectRefLike;
        scopes?: string[];
        minTtlSeconds?: number;
      }) => Promise<OAuthTokenResult>;
    };
  };
  mcpManager: {
    hasTool: (name: string) => boolean;
    executeTool: (name: string, input: JsonObject, ctx: UnknownObject) => Promise<unknown>;
    getToolsForAgent: (instanceId: string, agentName: string, agentConfig: Resource) => ToolCatalogItem[];
    syncForAgent: (instanceId: string, agentName: string, resources: Resource[]) => Promise<void>;
  } | null;
  events: {
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
    emit: (event: string, payload: unknown) => void;
  };
  registerDynamicTool: Runtime['registerDynamicTool'];
  unregisterDynamicTools: Runtime['unregisterDynamicTools'];
};

interface AgentInstanceOptions {
  name: string;
  instanceId: string;
  instanceKey: string;
  agentConfig: Resource;
  swarmConfig: Resource;
  registry: ConfigRegistry;
  toolRegistry: ToolRegistry;
  liveConfigManager: LiveConfigManager;
  runtime: RuntimeLike;
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
  runtime: RuntimeLike;
  logger: Console;
  baseDir: string;
  queue: TurnEvent[];
  processing: boolean;
  pipelines: PipelineManager<PipelineContext>;
  extensions: Array<{ resource: Resource<ExtensionSpec>; api: ExtensionApi }>;
  extensionStates: Map<string, UnknownObject>;
  extensionIdentities: string[];
  mcpIdentities: string[];
  systemPrompt: string | null;
  messageLogReady: boolean;
  messageLogPath: string | null;

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
    this.messageLogReady = false;
    this.messageLogPath = null;
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
    const previousMessages = await this.loadPreviousMessages();

    const turn: Turn = {
      id: makeId('turn'),
      input: event.input,
      origin: event.origin || {},
      auth: event.auth || {},
      summary: null,
      messages: previousMessages,
      toolResults: [],
      metadata: event.metadata || {},
    };

    const inputText = event.input;
    if (typeof inputText === 'string' && inputText.trim().length > 0) {
      await this.appendTurnMessage(turn, { role: 'user', content: inputText });
    }

    let turnCtx: PipelineContext = {
      instance: this,
      swarm: this.swarmConfig,
      agent: this.agentConfig,
      turn,
      step: null,
    };

    turnCtx = await this.pipelines.runMutators('turn.pre', turnCtx);
    await this.applyHooks('turn.pre', turnCtx);

    const swarmSpec = extractSwarmSpec(this.swarmConfig);
    const maxSteps = swarmSpec?.policy?.maxStepsPerTurn ?? 16;
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
        stepCtx.agent = stepCtx.effectiveConfig.agent;
      }
      if (stepCtx.effectiveConfig?.swarm) {
        stepCtx.swarm = stepCtx.effectiveConfig.swarm;
      }
      await this.reconcileExtensions(stepCtx.agent);
      await this.reconcileMcpServers(stepCtx.agent);

      stepCtx = await this.pipelines.runMutators('step.config', stepCtx);
      await this.applyHooks('step.config', stepCtx);

      stepCtx.toolCatalog = this.buildToolCatalog(stepCtx);
      stepCtx = await this.pipelines.runMutators('step.tools', stepCtx);
      await this.applyHooks('step.tools', stepCtx);

      stepCtx.blocks = this.buildContextBlocks(stepCtx);
      stepCtx = await this.pipelines.runMutators('step.blocks', stepCtx);
      await this.applyHooks('step.blocks', stepCtx);

      stepCtx = await this.runLlmCall(stepCtx);

      if (stepCtx.llmResult) {
        const normalizedToolCalls = normalizeToolCalls(stepCtx.llmResult.toolCalls || []);
        if (stepCtx.llmResult.toolCalls !== normalizedToolCalls) {
          stepCtx.llmResult = { ...stepCtx.llmResult, toolCalls: normalizedToolCalls };
        }
        step.llmResult = stepCtx.llmResult;
        step.toolCalls = normalizedToolCalls;
        const assistantMessage = buildAssistantMessage(stepCtx.llmResult);
        if (assistantMessage) {
          await this.appendTurnMessage(turn, assistantMessage, step);
        }
      } else {
        step.llmResult = null;
        step.toolCalls = [];
      }

      const toolCalls = step.toolCalls;

      if (toolCalls.length > 0) {
        for (const call of toolCalls) {
          const toolResult = await this.executeToolCall(call, stepCtx);
          step.toolResults.push(toolResult);
          turn.toolResults.push(toolResult);
          await this.appendTurnMessage(turn, buildToolMessage(call, toolResult), step);
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
    const agentSpec = extractAgentSpec(this.agentConfig);
    const prompts = agentSpec?.prompts;
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
    const nextExtensions: Array<{ resource: Resource<ExtensionSpec>; api: ExtensionApi }> = [];

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

  resolveExtensionResources(agentConfig: Resource): Resource<ExtensionSpec>[] {
    const agentSpec = extractAgentSpec(agentConfig);
    const refs = resolveSelectorList(agentSpec?.extensions || [], this.registry);
    const resources: Resource<ExtensionSpec>[] = [];
    for (const ref of refs) {
      if (isResource(ref)) {
        if (!isExtensionResource(ref)) {
          throw new Error(`Extension ${ref.metadata.name}의 spec.entry가 필요합니다.`);
        }
        resources.push(ref);
        continue;
      }
      const refLike = toObjectRefLike(ref);
      if (!refLike) continue;
      const resolved = resolveRef(this.registry, refLike, 'Extension');
      if (resolved) {
        if (!isExtensionResource(resolved)) {
          throw new Error(`Extension ${resolved.metadata.name}의 spec.entry가 필요합니다.`);
        }
        resources.push(resolved);
      }
    }
    return resources;
  }

  async loadExtensionModule(resource: Resource<ExtensionSpec>): Promise<{ register: (api: ExtensionApi) => Promise<void> }> {
    const entry = extractEntry(resource.spec);
    if (!entry) {
      throw new Error(`Extension ${resource.metadata.name}에 spec.entry가 필요합니다.`);
    }
    const entryPath = path.isAbsolute(entry) ? entry : path.join(this.baseDir, entry);
    const mod = await import(pathToFileURL(entryPath).href);
    const register = extractRegister(mod);
    if (!register) {
      throw new Error(`Extension ${resource.metadata.name}에 register(api) 함수가 필요합니다.`);
    }
    return { register };
  }

  createExtensionApi<TConfig extends JsonValue = JsonObject>(
    extensionResource: Resource<ExtensionSpec<TConfig>>,
    pipelines: PipelineManager<PipelineContext>,
    extState: UnknownObject
  ): ExtensionApi<UnknownObject, TConfig> {
    const pipelineApi: ExtensionApi['pipelines'] = {
      mutate: pipelines.mutate.bind(pipelines),
      wrap: pipelines.wrap.bind(pipelines),
    };
    return {
      extension: extensionResource,
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
    const agentSpec = extractAgentSpec(agentConfig);
    const refs = resolveSelectorList(agentSpec?.mcpServers || [], this.registry);
    const resources: Resource[] = [];
    for (const ref of refs) {
      if (isResource(ref)) {
        resources.push(ref);
        continue;
      }
      const refLike = toObjectRefLike(ref);
      if (!refLike) continue;
      const resolved = resolveRef(this.registry, refLike, 'MCPServer');
      if (resolved) resources.push(resolved);
    }
    const identities = resources.map((resource) => `${resource.kind}/${resource.metadata.name}`);
    if (arrayEqual(identities, this.mcpIdentities)) return;
    if (!this.runtime.mcpManager) return;
    await this.runtime.mcpManager.syncForAgent(this.instanceId, this.name, resources);
    this.mcpIdentities = identities;
  }

  buildToolCatalog(stepCtx: PipelineContext): ToolCatalogItem[] {
    const agentSpec = extractAgentSpec(this.agentConfig);
    const toolRefs = resolveSelectorList(agentSpec?.tools || [], this.registry)
      .map((item) => {
        if (isResource(item)) {
          return { kind: item.kind, name: item.metadata.name };
        }
        return toObjectRefLike(item);
      })
      .filter((item): item is ObjectRefLike => Boolean(item));

    const baseCatalog = this.toolRegistry.buildCatalog(toolRefs);
    const agentConfig = stepCtx.agent || this.agentConfig;
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
    if (stepCtx.turn?.messages?.length) {
      blocks.push({ type: 'messages', items: stepCtx.turn.messages });
    }
    if (stepCtx.turn?.toolResults?.length) {
      blocks.push({ type: 'tool.results', items: stepCtx.turn.toolResults });
    }
    const authPending = extractAuthPending(stepCtx.turn?.metadata);
    if (authPending && authPending.length > 0) {
      blocks.push({ type: 'auth.pending', items: authPending });
    }
    return blocks;
  }

  async coreLlmCall(stepCtx: PipelineContext): Promise<LlmResult> {
    const agentSpec = extractAgentSpec(this.agentConfig);
    const modelConfig = agentSpec?.modelConfig;
    const modelRef = modelConfig?.modelRef
      ? resolveRef(this.registry, modelConfig.modelRef, 'Model')
      : null;
    const llm = this.runtime.llm || (async () => ({ content: '', toolCalls: [] }));
    const metadata = (stepCtx.turn.metadata ||= {});
    if (stepCtx.turn.origin?.connector === 'cli' && !metadata._llmProgressEmitted) {
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
    const input = isJsonObject(call.input) ? call.input : {};
    const errorMessageLimit = resolveToolErrorMessageLimit(toolExport?.tool ?? null);
    let result: JsonValue;
    try {
      const rawResult = await this.pipelines.runWrapped('toolCall.exec', toolCtx, async () => {
        if (toolExport) {
          return toolExport.handler(ctx, input);
        }
        if (this.runtime.mcpManager?.hasTool(call.name)) {
          return this.runtime.mcpManager.executeTool(call.name, input, ctx);
        }
        throw new Error(`Tool export를 찾을 수 없습니다: ${call.name}`);
      });
      result = normalizeJsonValue(rawResult);
    } catch (err) {
      const errorInfo = buildErrorInfo(err, errorMessageLimit);
      result = normalizeJsonValue({ status: 'error', error: errorInfo });
    }

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

  private async appendTurnMessage(turn: Turn, message: LlmMessage, step?: Step | null): Promise<void> {
    turn.messages.push(message);
    const record: LlmMessageRecord = {
      type: 'llm.message',
      recordedAt: new Date().toISOString(),
      instanceId: this.instanceId,
      agentName: this.name,
      turnId: turn.id,
      stepId: step?.id,
      stepIndex: step?.index,
      message,
    };
    try {
      await this.appendMessageRecord(record);
    } catch (err) {
      this.logger.error('LLM message log write failed.', err);
    }
  }

  private async appendMessageRecord(record: LlmMessageRecord): Promise<void> {
    const logPath = await this.ensureMessageLogPath();
    await appendJsonl(logPath, record);
    await fs.chmod(logPath, 0o600);
  }

  private async ensureMessageLogPath(): Promise<string> {
    if (this.messageLogReady && this.messageLogPath) {
      return this.messageLogPath;
    }
    const logPath = path.join(this.resolveAgentStateDir(), 'messages', 'llm.jsonl');
    await ensureDir(path.dirname(logPath));
    await fs.chmod(path.dirname(logPath), 0o700);
    this.messageLogReady = true;
    this.messageLogPath = logPath;
    return logPath;
  }

  private async loadPreviousMessages(): Promise<LlmMessage[]> {
    const logPath = path.join(this.resolveAgentStateDir(), 'messages', 'llm.jsonl');
    const records = await readJsonl<LlmMessageRecord>(logPath);
    return records.map((record) => record.message);
  }

  private resolveAgentStateDir(): string {
    return path.join(this.runtime.stateDir, this.instanceId, 'agents', this.name);
  }

  registerLiveConfigProposalListener(): void {
    this.runtime.events.on('liveConfig.patchProposed', (payload) => {
      const proposal = parseLiveConfigPatchProposal(payload);
      if (!proposal) return;
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
        this.runtime.events.on(event, handler);
      },
      off: (event, handler) => {
        this.runtime.events.off(event, handler);
      },
    };
  }

  captureAuthPending(ctx: PipelineContext): void {
    const result = ctx.toolResult;
    if (!isJsonObject(result) || result.status !== 'authorization_required') return;
    const metadata = (ctx.turn.metadata ||= {});
    const pending = extractAuthPending(metadata) || [];
    pending.push(result);
    metadata.authPending = pending;
  }

  async applyHooks(point: string, ctx: PipelineContext): Promise<void> {
    const agentConfig = ctx.agent || this.agentConfig;
    const agentSpec = extractAgentSpec(agentConfig);
    const hooks = Array.isArray(agentSpec?.hooks) ? agentSpec?.hooks : [];
    const matched = hooks
      .filter(isHookSpec)
      .filter((hook) => hook.point === point)
      .sort((a, b) => {
        const aPriority = a.priority ?? 0;
        const bPriority = b.priority ?? 0;
        return aPriority - bPriority;
      });
    if (matched.length === 0) return;

    for (const hook of matched) {
      const toolCall = hook.action.toolCall;
      const toolName = toolCall.tool || '';
      if (!toolName) continue;
      const inputTemplate = isJsonObject(toolCall.input) ? toolCall.input : {};
      const input = resolveTemplate(inputTemplate, ctx);
      const toolInput = isJsonObject(input) ? input : {};
      await this.executeToolCall({ name: toolName, input: toolInput }, ctx);
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
        messages: [],
        toolResults: [],
        metadata: { workspace: payload },
      },
      step: null,
    };
    ctx = await this.pipelines.runMutators(point, ctx);
  }
}

function normalizeToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  return toolCalls.map((call) => (call.id ? call : { ...call, id: makeId('tool-call') }));
}

function buildAssistantMessage(result: LlmResult): LlmMessage | null {
  const content = typeof result.content === 'string' && result.content.length > 0 ? result.content : undefined;
  const toolCalls = Array.isArray(result.toolCalls) && result.toolCalls.length > 0 ? result.toolCalls : undefined;
  if (!content && !toolCalls) return null;
  return {
    role: 'assistant',
    ...(content ? { content } : {}),
    ...(toolCalls ? { toolCalls } : {}),
  };
}

function buildToolMessage(call: ToolCall, result: ToolResult): LlmMessage {
  const toolCallId = call.id || result.id || makeId('tool-call');
  return {
    role: 'tool',
    toolCallId,
    toolName: call.name,
    output: result.output,
  };
}

function extractAgentSpec(resource: Resource): AgentSpec | null {
  const spec = resource.spec;
  return isAgentSpec(spec) ? spec : null;
}

function extractSwarmSpec(resource: Resource): SwarmSpec | null {
  const spec = resource.spec;
  return isSwarmSpec(spec) ? spec : null;
}

function extractAuthPending(metadata?: JsonObject): JsonObject[] | null {
  if (!metadata) return null;
  const pending = metadata.authPending;
  if (!Array.isArray(pending)) return null;
  return pending.filter(isJsonObject);
}

function extractEntry(spec: unknown): string | null {
  if (!isRecord(spec)) return null;
  const entry = spec.entry;
  return typeof entry === 'string' ? entry : null;
}

function extractRegister(mod: unknown): ((api: ExtensionApi) => Promise<void>) | null {
  if (!isRecord(mod)) return null;
  const register = mod.register;
  if (typeof register !== 'function') return null;
  return async (api: ExtensionApi) => {
    await register(api);
  };
}

function parseLiveConfigPatchProposal(
  payload: unknown
): (LiveConfigPatchProposal & { agentName?: string }) | null {
  if (!isRecord(payload)) return null;
  const scope = payload.scope;
  const applyAt = payload.applyAt;
  if (scope !== 'agent' && scope !== 'swarm') return null;
  if (typeof applyAt !== 'string') return null;
  const patch = parseLiveConfigPatchSpec(payload.patch);
  if (!patch) return null;

  const proposal: LiveConfigPatchProposal & { agentName?: string } = {
    scope,
    applyAt,
    patch,
  };

  const target = parseObjectRef(payload.target);
  if (target) proposal.target = target;
  const source = parsePatchSource(payload.source);
  if (source) proposal.source = source;
  const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
  if (reason) proposal.reason = reason;
  const agentName = typeof payload.agentName === 'string' ? payload.agentName : undefined;
  if (agentName) proposal.agentName = agentName;

  return proposal;
}

function parseLiveConfigPatchSpec(value: unknown): LiveConfigPatchSpec | null {
  if (!isRecord(value)) return null;
  if (value.type !== 'json6902') return null;
  const ops = value.ops;
  if (!Array.isArray(ops)) return null;
  const normalized: LiveConfigPatchOp[] = [];
  for (const entry of ops) {
    const op = parseLiveConfigPatchOp(entry);
    if (!op) return null;
    normalized.push(op);
  }
  return { type: 'json6902', ops: normalized };
}

function parseLiveConfigPatchOp(value: unknown): LiveConfigPatchOp | null {
  if (!isRecord(value)) return null;
  const op = typeof value.op === 'string' ? value.op : null;
  const path = typeof value.path === 'string' ? value.path : null;
  if (!op || !path) return null;
  const result: LiveConfigPatchOp = { op, path };
  if (typeof value.from === 'string') {
    result.from = value.from;
  }
  if ('value' in value) {
    result.value = normalizeJsonValue(value.value);
  }
  return result;
}

function parsePatchSource(value: unknown): LiveConfigPatchProposal['source'] | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (type !== 'tool' && type !== 'extension' && type !== 'sidecar' && type !== 'system') return null;
  const name = typeof value.name === 'string' ? value.name : undefined;
  return name ? { type, name } : { type };
}

function parseObjectRef(value: unknown): ObjectRef | null {
  if (!isRecord(value)) return null;
  const kind = typeof value.kind === 'string' ? value.kind : undefined;
  const name = typeof value.name === 'string' ? value.name : undefined;
  if (!kind && !name) return null;
  const apiVersion = typeof value.apiVersion === 'string' ? value.apiVersion : undefined;
  return {
    ...(apiVersion ? { apiVersion } : {}),
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
  };
}

function toObjectRefLike(value: unknown): ObjectRefLike | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  const kind = typeof value.kind === 'string' ? value.kind : undefined;
  const name = typeof value.name === 'string' ? value.name : undefined;
  if (!kind && !name) return null;
  const apiVersion = typeof value.apiVersion === 'string' ? value.apiVersion : undefined;
  return {
    ...(apiVersion ? { apiVersion } : {}),
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
  };
}

function isResource(value: unknown): value is Resource {
  if (!isRecord(value)) return false;
  if (typeof value.kind !== 'string') return false;
  const metadata = value.metadata;
  if (!isRecord(metadata)) return false;
  return typeof metadata.name === 'string';
}

function isExtensionResource(value: Resource): value is Resource<ExtensionSpec> {
  return isResource(value) && Boolean(extractEntry(value.spec));
}

function isAgentSpec(value: unknown): value is AgentSpec {
  return isRecord(value);
}

function isSwarmSpec(value: unknown): value is SwarmSpec {
  return isRecord(value);
}

function isHookSpec(value: unknown): value is HookSpec {
  if (!isRecord(value)) return false;
  if (typeof value.point !== 'string') return false;
  if (value.priority !== undefined && typeof value.priority !== 'number') return false;
  const action = value.action;
  if (!isRecord(action)) return false;
  const toolCall = action.toolCall;
  if (!isRecord(toolCall)) return false;
  if (typeof toolCall.tool !== 'string') return false;
  if (toolCall.input !== undefined && !isJsonObject(toolCall.input)) return false;
  return true;
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeJsonValue(value: unknown): JsonValue {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry) => normalizeJsonValue(entry));
  if (isRecord(value)) {
    const out: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = normalizeJsonValue(entry);
    }
    return out;
  }
  return String(value);
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
  if (isRecord(error)) {
    const message = error.message;
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
  if (isRecord(error)) {
    const name = error.name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return undefined;
}

function resolveErrorCode(error: unknown): string | undefined {
  if (isRecord(error)) {
    const code = error.code;
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
