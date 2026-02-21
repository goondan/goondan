/**
 * agent-runner.ts -- AgentProcess entry point.
 *
 * Orchestrator가 Bun.spawn으로 기동하는 독립 child process.
 * IPC로 이벤트를 받아 Turn을 실행하고, shutdown 프로토콜을 지원한다.
 *
 * 기동 인자:
 *   --bundle-dir <path>      프로젝트 디렉터리 경로
 *   --agent-name <name>      Agent 리소스 이름
 *   --instance-key <key>     인스턴스 식별 키
 *   --state-root <path>      (선택) 상태 저장 루트
 *   --swarm-name <name>      (선택) 스웜 이름
 */
import path from 'node:path';
import { Console } from 'node:console';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import {
  ConversationStateImpl,
  ExtensionApiImpl,
  ExtensionStateManagerImpl,
  PipelineRegistryImpl,
  RuntimeEventBusImpl,
  createMinimalToolContext,
  isJsonObject,
  loadExtensions,
  FileWorkspaceStorage,
  ToolExecutor,
  ToolRegistryImpl,
  WorkspacePaths,
  type AgentEvent,
  type AgentToolRuntime,
  type AgentRuntimeRequestResult,
  type JsonObject,
  type JsonValue,
  type IpcMessage,
  type MessageEvent,
  type Message,
  type RuntimeEvent,
  type RuntimeResource,
  type StepResult,
  type ToolCallResult,
  type ToolCatalogItem,
  type TurnResult,
} from '../index.js';
import { buildStepLimitResponse } from './turn-policy.js';
import {
  toConversationTurns,
  toPersistentMessages,
  type ConversationTurn,
} from './conversation-state.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface AgentRunnerArguments {
  bundleDir: string;
  agentName: string;
  instanceKey: string;
  stateRoot: string;
  swarmName?: string;
}

function parseAgentRunnerArguments(argv: string[]): AgentRunnerArguments {
  let bundleDir: string | undefined;
  let agentName: string | undefined;
  let instanceKey: string | undefined;
  let stateRoot: string | undefined;
  let swarmName: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--bundle-dir' && next) {
      bundleDir = next;
      i++;
    } else if (arg === '--agent-name' && next) {
      agentName = next;
      i++;
    } else if (arg === '--instance-key' && next) {
      instanceKey = next;
      i++;
    } else if (arg === '--state-root' && next) {
      stateRoot = next;
      i++;
    } else if (arg === '--swarm-name' && next) {
      swarmName = next;
      i++;
    }
  }

  if (!bundleDir) throw new Error('--bundle-dir is required');
  if (!agentName) throw new Error('--agent-name is required');
  if (!instanceKey) throw new Error('--instance-key is required');

  const resolvedBundleDir = path.resolve(bundleDir);
  const resolvedStateRoot = stateRoot ? path.resolve(stateRoot) : path.join(resolvedBundleDir, '.goondan');

  return {
    bundleDir: resolvedBundleDir,
    agentName,
    instanceKey,
    stateRoot: resolvedStateRoot,
    swarmName,
  };
}

// ---------------------------------------------------------------------------
// IPC communication helpers
// ---------------------------------------------------------------------------

function sendIpc(message: IpcMessage): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function sendShutdownAck(agentName: string, instanceKey: string): void {
  sendIpc({
    type: 'shutdown_ack',
    from: agentName,
    to: 'orchestrator',
    payload: { instanceKey },
  });
}

// ---------------------------------------------------------------------------
// AgentProcess state
// ---------------------------------------------------------------------------

interface AgentProcessState {
  draining: boolean;
  currentTurn: Promise<void> | null;
  eventQueue: AgentEvent[];
  processing: boolean;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseAgentRunnerArguments(process.argv.slice(2));
  const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
  logger.info(
    `[agent-process] starting agent=${args.agentName} instance=${args.instanceKey} pid=${process.pid}`,
  );

  // Build plan (load bundle, resolve agent config, tools, extensions)
  // For now, we reuse buildRunnerPlan from runtime-runner and extract the agent-specific plan.
  // In a future iteration this will be streamlined.
  const { buildAgentProcessPlan } = await import('./agent-process-plan.js');
  const plan = await buildAgentProcessPlan(args);

  // Set up workspace storage
  const workspacePaths = new WorkspacePaths({
    stateRoot: args.stateRoot,
    projectRoot: args.bundleDir,
    workspaceName: plan.swarmInstanceKey,
  });
  const storage = new FileWorkspaceStorage(workspacePaths);
  const runtimeEventBus = new RuntimeEventBusImpl();

  // Set up extension environment per agent
  const extensionNames = plan.extensionResources.map((r) => r.metadata.name);
  const extensionStateManager = new ExtensionStateManagerImpl(
    storage,
    createConversationKey(args.agentName, args.instanceKey),
    extensionNames,
  );
  await extensionStateManager.loadAll();

  const extensionToolRegistry = new ToolRegistryImpl();
  const pipelineRegistry = new PipelineRegistryImpl(runtimeEventBus);

  if (plan.extensionResources.length > 0) {
    const extensionEventBus = new EventEmitter();
    await loadExtensions(
      plan.extensionResources,
      (extensionName) =>
        new ExtensionApiImpl(
          extensionName,
          pipelineRegistry,
          extensionToolRegistry,
          extensionStateManager,
          extensionEventBus,
          logger,
        ),
      args.bundleDir,
      logger,
    );
  }

  const extensionToolExecutor = new ToolExecutor(extensionToolRegistry);

  // Runtime event persistence -- register for all event types
  const persistListener = async (event: RuntimeEvent): Promise<void> => {
    const qk = createConversationKey(args.agentName, args.instanceKey);
    try {
      await storage.appendRuntimeEvent(qk, event);
    } catch (error) {
      logger.warn(`[agent-process] runtime event persist failed: ${unknownToErrorMessage(error)}`);
    }
  };
  const { RUNTIME_EVENT_TYPES } = await import('../events/runtime-events.js');
  for (const eventType of RUNTIME_EVENT_TYPES) {
    runtimeEventBus.on(eventType, persistListener);
  }

  // Agent process state
  const state: AgentProcessState = {
    draining: false,
    currentTurn: null,
    eventQueue: [],
    processing: false,
  };

  // Process incoming IPC messages
  process.on('message', (raw: unknown) => {
    if (!isIpcMessage(raw)) return;
    const message = raw;

    if (message.type === 'shutdown') {
      state.draining = true;
      logger.info(`[agent-process] shutdown received agent=${args.agentName}`);

      // If no turn in progress, ack immediately
      if (state.currentTurn === null) {
        sendShutdownAck(args.agentName, args.instanceKey);
        void extensionStateManager.saveAll().then(() => process.exit(0));
        return;
      }

      // Wait for current turn to complete, then ack
      void state.currentTurn.then(async () => {
        await extensionStateManager.saveAll();
        sendShutdownAck(args.agentName, args.instanceKey);
        process.exit(0);
      });
      return;
    }

    if (message.type === 'event') {
      if (state.draining) return; // Don't accept new events during drain

      const agentEvent = parseAgentEventFromIpc(message);
      if (!agentEvent) {
        logger.warn(`[agent-process] invalid event payload`);
        return;
      }

      state.eventQueue.push(agentEvent);
      void processQueue(state, args, plan, storage, pipelineRegistry, extensionToolRegistry, extensionToolExecutor, extensionStateManager, runtimeEventBus, logger);
    }
  });

  // Signal ready to orchestrator
  sendIpc({
    type: 'event',
    from: args.agentName,
    to: 'orchestrator',
    payload: { type: 'agent_ready', agentName: args.agentName, instanceKey: args.instanceKey, pid: process.pid },
  });

  logger.info(`[agent-process] ready agent=${args.agentName} instance=${args.instanceKey} pid=${process.pid}`);

  // Keep process alive
  await new Promise<void>(() => {
    // This promise never resolves -- process stays alive until shutdown or kill
  });
}

// ---------------------------------------------------------------------------
// Event queue processor (FIFO, serial)
// ---------------------------------------------------------------------------

async function processQueue(
  state: AgentProcessState,
  args: AgentRunnerArguments,
  plan: AgentProcessPlan,
  storage: FileWorkspaceStorage,
  pipelineRegistry: PipelineRegistryImpl,
  extensionToolRegistry: ToolRegistryImpl,
  extensionToolExecutor: ToolExecutor,
  extensionStateManager: ExtensionStateManagerImpl,
  runtimeEventBus: RuntimeEventBusImpl,
  logger: Console,
): Promise<void> {
  if (state.processing || state.draining) return;
  state.processing = true;

  try {
    while (state.eventQueue.length > 0 && !state.draining) {
      const event = state.eventQueue.shift();
      if (!event) break;

      const turnPromise = executeTurn(
        args, plan, event, storage, pipelineRegistry,
        extensionToolRegistry, extensionToolExecutor, extensionStateManager,
        runtimeEventBus, logger,
      );
      state.currentTurn = turnPromise;

      try {
        await turnPromise;
      } catch (error) {
        logger.warn(`[agent-process] turn failed: ${unknownToErrorMessage(error)}`);
      }

      state.currentTurn = null;
    }
  } finally {
    state.processing = false;
  }
}

// ---------------------------------------------------------------------------
// Turn execution (reuses runtime-runner's runAgentTurn logic)
// ---------------------------------------------------------------------------

interface AgentProcessPlan {
  name: string;
  swarmInstanceKey: string;
  modelName: string;
  provider: string;
  apiKey: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  maxSteps: number;
  toolCatalog: ToolCatalogItem[];
  extensionResources: RuntimeResource<{ entry: string; config?: Record<string, unknown> }>[];
  toolExecutor: ToolExecutor;
  swarmName: string;
  entryAgent: string;
  availableAgents: string[];
}

async function executeTurn(
  args: AgentRunnerArguments,
  plan: AgentProcessPlan,
  event: AgentEvent,
  storage: FileWorkspaceStorage,
  pipelineRegistry: PipelineRegistryImpl,
  extensionToolRegistry: ToolRegistryImpl,
  extensionToolExecutor: ToolExecutor,
  extensionStateManager: ExtensionStateManagerImpl,
  _runtimeEventBus: RuntimeEventBusImpl,
  logger: Console,
): Promise<void> {
  const queueKey = createConversationKey(args.agentName, args.instanceKey);
  await ensureInstanceStorage(storage, queueKey, args.agentName);
  await storage.updateMetadataStatus(queueKey, 'processing');

  try {
    const turnId = createId('turn');
    const traceId = event.traceId ?? createId('trace');
    const history = await loadConversationFromStorage(storage, queueKey);

    const userInputText = event.input ?? '';
    const conversationState = createConversationStateFromTurns(history);

    const inboundMessageMetadata = createInboundMessageMetadata(event);
    conversationState.emitMessageEvent({
      type: 'append',
      message: createConversationUserMessage(userInputText, inboundMessageMetadata),
    });

    // Create agent runtime that sends IPC messages for inter-agent communication
    // Propagate auth from inbound event for inter-agent calls
    const inboundAuth = event.auth && isJsonObject(event.auth) ? event.auth : undefined;
    const agentRuntime = createIpcAgentToolRuntime(args, plan, inboundAuth, logger);

    let finalResponseText = '';
    let step = 0;
    let lastText = '';

    await pipelineRegistry.runTurn(
      {
        agentName: args.agentName,
        instanceKey: args.instanceKey,
        turnId,
        traceId,
        inputEvent: event,
        conversationState,
        agents: createIpcMiddlewareAgentsApi(args, traceId, inboundAuth),
        emitMessageEvent(ev: MessageEvent): void {
          conversationState.emitMessageEvent(ev);
        },
        metadata: {},
      },
      async (): Promise<TurnResult> => {
        // Import model step utilities
        const { requestModelMessage } =
          await import('./runtime-runner.js');

        while (true) {
          if (step >= plan.maxSteps) {
            const responseText = buildStepLimitResponse({
              maxSteps: plan.maxSteps,
              lastText,
            });
            finalResponseText = responseText;
            return {
              turnId,
              finishReason: 'max_steps',
              responseMessage: createConversationAssistantMessage(responseText, `${turnId}-step-limit`),
            };
          }

          step += 1;
          const baseToolCatalog = mergeToolCatalog(
            plan.toolCatalog,
            extensionToolRegistry.getCatalog(),
          );

          const stepMetadata: Record<string, JsonValue> = {};

          const stepResult = await pipelineRegistry.runStep(
            {
              agentName: args.agentName,
              instanceKey: args.instanceKey,
              turnId,
              traceId,
              turn: {
                id: turnId,
                agentName: args.agentName,
                inputEvent: event,
                messages: conversationState.nextMessages,
                steps: [],
                status: 'running',
                metadata: {},
              },
              stepIndex: step,
              conversationState,
              agents: createIpcMiddlewareAgentsApi(args, traceId, inboundAuth),
              emitMessageEvent(ev: MessageEvent): void {
                conversationState.emitMessageEvent(ev);
              },
              toolCatalog: baseToolCatalog,
              metadata: stepMetadata,
            },
            async (stepCtx): Promise<StepResult> => {
              const response = await requestModelMessage({
                provider: plan.provider,
                apiKey: plan.apiKey,
                model: plan.modelName,
                systemPrompt: plan.systemPrompt,
                temperature: plan.temperature,
                maxTokens: plan.maxTokens,
                toolCatalog: stepCtx.toolCatalog,
                turns: toConversationTurns(conversationState.nextMessages),
              });

              if (response.assistantContent.length > 0) {
                conversationState.emitMessageEvent({
                  type: 'append',
                  message: createConversationAssistantMessage(
                    response.assistantContent,
                    `${turnId}-step-${step}`,
                  ),
                });
              }

              if (response.textBlocks.length > 0) {
                lastText = response.textBlocks.join('\n').trim();
              }

              if (response.toolUseBlocks.length === 0) {
                return {
                  status: 'completed',
                  shouldContinue: false,
                  toolCalls: [],
                  toolResults: [],
                  metadata: {},
                };
              }

              const toolCalls: Array<{ id: string; name: string; args: JsonObject }> = [];
              const toolResults: ToolCallResult[] = [];

              for (const toolUse of response.toolUseBlocks) {
                const toolArgs = ensureJsonObject(toolUse.input);
                toolCalls.push({ id: toolUse.id, name: toolUse.name, args: toolArgs });

                const toolResult = await pipelineRegistry.runToolCall(
                  {
                    agentName: args.agentName,
                    instanceKey: args.instanceKey,
                    turnId,
                    traceId,
                    stepIndex: step,
                    toolName: toolUse.name,
                    toolCallId: toolUse.id,
                    args: toolArgs,
                    metadata: {},
                  },
                  async (toolCallCtx): Promise<ToolCallResult> => {
                    const toolContext = createMinimalToolContext({
                      agentName: args.agentName,
                      instanceKey: args.instanceKey,
                      turnId,
                      traceId,
                      toolCallId: toolCallCtx.toolCallId,
                      message: createToolContextMessage(userInputText),
                      workdir: args.bundleDir,
                      logger,
                      runtime: agentRuntime,
                    });

                    const executor = extensionToolRegistry.has(toolCallCtx.toolName)
                      ? extensionToolExecutor
                      : plan.toolExecutor;

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
              }

              // Append tool results as user messages
              const toolResultBlocks: unknown[] = toolResults.map((tr, idx) => ({
                type: 'tool-result',
                toolCallId: toolCalls[idx]?.id,
                toolName: toolCalls[idx]?.name,
                output: tr.status === 'ok'
                  ? { type: 'text', value: typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output) }
                  : { type: 'text', value: tr.error?.message ?? 'error' },
              }));

              conversationState.emitMessageEvent({
                type: 'append',
                message: createConversationUserMessage(toolResultBlocks),
              });

              return {
                status: 'completed',
                shouldContinue: true,
                toolCalls,
                toolResults,
                metadata: {},
              };
            },
          );

          if (stepResult.shouldContinue) continue;

          const responseText = lastText.length > 0 ? lastText : '';
          finalResponseText = responseText;
          return {
            turnId,
            finishReason: 'text_response',
            responseMessage: createConversationAssistantMessage(responseText, `${turnId}-final`),
          };
        }
      },
    );

    // Persist conversation
    const nextConversation = toConversationTurns(conversationState.nextMessages);
    await persistConversationToStorage(storage, queueKey, nextConversation);
    await extensionStateManager.saveAll();

    // Send response back via IPC (for request-reply pattern)
    if (event.replyTo) {
      sendIpc({
        type: 'event',
        from: args.agentName,
        to: 'orchestrator',
        payload: {
          type: 'response',
          id: createId('evt'),
          input: finalResponseText,
          source: { kind: 'agent', name: args.agentName },
          metadata: { inReplyTo: event.replyTo.correlationId },
          instanceKey: args.instanceKey,
        },
      });
    }
  } finally {
    await storage.updateMetadataStatus(queueKey, 'idle');
  }
}

// ---------------------------------------------------------------------------
// Error types for inter-agent communication (pipeline.md 4.4)
// ---------------------------------------------------------------------------

class AgentRequestTimeoutError extends Error {
  readonly code = 'AGENT_REQUEST_TIMEOUT';
  readonly target: string;
  readonly timeoutMs: number;

  constructor(target: string, timeoutMs: number) {
    super(`Agent request to '${target}' timed out after ${timeoutMs}ms`);
    this.name = 'AgentRequestTimeoutError';
    this.target = target;
    this.timeoutMs = timeoutMs;
  }
}

class AgentRequestError extends Error {
  readonly code: 'AGENT_NOT_FOUND' | 'CIRCULAR_CALL_DETECTED' | 'IPC_DELIVERY_FAILED';
  readonly target: string;

  constructor(code: 'AGENT_NOT_FOUND' | 'CIRCULAR_CALL_DETECTED' | 'IPC_DELIVERY_FAILED', target: string, message: string) {
    super(message);
    this.name = 'AgentRequestError';
    this.code = code;
    this.target = target;
  }
}

// ---------------------------------------------------------------------------
// IPC-based AgentToolRuntime (inter-agent calls go through Orchestrator)
// ---------------------------------------------------------------------------

function createIpcAgentToolRuntime(
  args: AgentRunnerArguments,
  plan: AgentProcessPlan,
  inboundAuth: JsonObject | undefined,
  _logger: Console,
): AgentToolRuntime {
  return {
    request: async (target, event, options) => {
      const correlationId = createId('corr');
      const payload: JsonObject = {
        id: event.id,
        type: 'request',
        input: event.input ?? '',
        source: { kind: 'agent', name: args.agentName },
        replyTo: { target: args.agentName, correlationId },
        instanceKey: event.instanceKey ?? 'default',
      };
      if (event.traceId) payload.traceId = event.traceId;
      if (event.metadata) payload.metadata = event.metadata;
      // Propagate auth from inbound event (connector auth carries through)
      if (event.auth) {
        payload.auth = cloneAsJsonObject(event.auth);
      } else if (inboundAuth) {
        payload.auth = inboundAuth;
      }

      sendIpc({
        type: 'event',
        from: args.agentName,
        to: target,
        payload,
      });

      const timeoutMs = options?.timeoutMs ?? 15000;
      return waitForIpcResponse(correlationId, target, timeoutMs);
    },
    send: async (target, event) => {
      const payload: JsonObject = {
        id: event.id,
        type: 'notification',
        input: event.input ?? '',
        source: { kind: 'agent', name: args.agentName },
        instanceKey: event.instanceKey ?? 'default',
      };
      if (event.traceId) payload.traceId = event.traceId;
      if (event.metadata) payload.metadata = event.metadata;
      // Propagate auth
      if (event.auth) {
        payload.auth = cloneAsJsonObject(event.auth);
      } else if (inboundAuth) {
        payload.auth = inboundAuth;
      }

      sendIpc({
        type: 'event',
        from: args.agentName,
        to: target,
        payload,
      });
      return { eventId: event.id, target, accepted: true };
    },
    spawn: async (target, options) => {
      const instanceKey = options?.instanceKey ?? createId(`${target}-instance`);
      const spawnPayload: JsonObject = { type: 'spawn_request', target, instanceKey };
      if (options?.cwd) spawnPayload.cwd = options.cwd;

      sendIpc({
        type: 'event',
        from: args.agentName,
        to: 'orchestrator',
        payload: spawnPayload,
      });
      return { target, instanceKey, spawned: true, cwd: options?.cwd };
    },
    list: async () => {
      return { agents: [] };
    },
    catalog: async () => {
      return {
        swarmName: plan.swarmName,
        entryAgent: plan.entryAgent,
        selfAgent: args.agentName,
        availableAgents: plan.availableAgents,
        callableAgents: plan.availableAgents.filter((a) => a !== args.agentName),
      };
    },
  };
}

function createIpcMiddlewareAgentsApi(
  args: AgentRunnerArguments,
  traceId: string,
  inboundAuth: JsonObject | undefined,
): { request: (params: { target: string; input?: string; instanceKey?: string; timeoutMs?: number; metadata?: JsonObject }) => Promise<{ target: string; response: string }>; send: (params: { target: string; input?: string; instanceKey?: string; metadata?: JsonObject }) => Promise<{ accepted: boolean }> } {
  return {
    request: async (params) => {
      const correlationId = createId('corr');
      const instanceKey = params.instanceKey ?? 'default';
      const payload: JsonObject = {
        id: createId('evt'),
        type: 'request',
        input: params.input ?? '',
        source: { kind: 'agent', name: args.agentName },
        replyTo: { target: args.agentName, correlationId },
        instanceKey,
        traceId,
        metadata: params.metadata ?? {},
        createdAt: new Date().toISOString(),
      };
      // Propagate auth from inbound event
      if (inboundAuth) {
        payload.auth = inboundAuth;
      }

      sendIpc({
        type: 'event',
        from: args.agentName,
        to: params.target,
        payload,
      });

      const timeoutMs = params.timeoutMs ?? 15000;
      const result = await waitForIpcResponse(correlationId, params.target, timeoutMs);
      const response = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
      return { target: params.target, response };
    },
    send: async (params) => {
      const instanceKey = params.instanceKey ?? 'default';
      const payload: JsonObject = {
        id: createId('evt'),
        type: 'notification',
        input: params.input ?? '',
        source: { kind: 'agent', name: args.agentName },
        instanceKey,
        traceId,
        metadata: params.metadata ?? {},
        createdAt: new Date().toISOString(),
      };
      // Propagate auth from inbound event
      if (inboundAuth) {
        payload.auth = inboundAuth;
      }

      sendIpc({
        type: 'event',
        from: args.agentName,
        to: params.target,
        payload,
      });
      return { accepted: true };
    },
  };
}

// ---------------------------------------------------------------------------
// IPC response wait (correlation-based)
// ---------------------------------------------------------------------------

const MAX_PENDING_RESPONSES = 100;
const STALE_THRESHOLD_MS = 60_000;

interface PendingEntry {
  resolve: (result: AgentRuntimeRequestResult) => void;
  reject: (error: Error) => void;
  createdAt: number;
  target: string;
  timer: ReturnType<typeof setTimeout>;
}

const pendingResponses = new Map<string, PendingEntry>();

function evictStalePendingResponses(): void {
  if (pendingResponses.size <= MAX_PENDING_RESPONSES) return;

  const now = Date.now();
  for (const [key, entry] of pendingResponses) {
    if (now - entry.createdAt > STALE_THRESHOLD_MS) {
      clearTimeout(entry.timer);
      pendingResponses.delete(key);
      entry.reject(new AgentRequestTimeoutError(entry.target, STALE_THRESHOLD_MS));
    }
  }
}

function waitForIpcResponse(
  correlationId: string,
  target: string,
  timeoutMs: number,
): Promise<AgentRuntimeRequestResult> {
  evictStalePendingResponses();

  return new Promise<AgentRuntimeRequestResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResponses.delete(correlationId);
      reject(new AgentRequestTimeoutError(target, timeoutMs));
    }, timeoutMs);

    pendingResponses.set(correlationId, {
      resolve: (result) => {
        clearTimeout(timer);
        pendingResponses.delete(correlationId);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        pendingResponses.delete(correlationId);
        reject(error);
      },
      createdAt: Date.now(),
      target,
      timer,
    });
  });
}

// Handle response events from orchestrator (including error responses)
process.on('message', (raw: unknown) => {
  if (!isIpcMessage(raw)) return;
  const msg = raw;
  if (msg.type !== 'event') return;

  const payload = isJsonObject(msg.payload) ? msg.payload : null;
  if (!payload) return;

  const metadata = isJsonObject(payload.metadata) ? payload.metadata : null;
  if (!metadata) return;

  const inReplyTo = typeof metadata.inReplyTo === 'string' ? metadata.inReplyTo : null;
  if (!inReplyTo) return;

  const pending = pendingResponses.get(inReplyTo);
  if (!pending) return;

  // Handle error responses from Orchestrator (e.g., CIRCULAR_CALL_DETECTED)
  if (payload.type === 'error_response') {
    const errorCode = typeof metadata.errorCode === 'string' ? metadata.errorCode : 'IPC_DELIVERY_FAILED';
    const errorMessage = typeof metadata.errorMessage === 'string' ? metadata.errorMessage : 'IPC delivery failed';
    const source = isJsonObject(payload.source) ? payload.source : null;
    const targetName = source && typeof source.name === 'string' ? source.name : 'unknown';

    const validCodes = ['AGENT_NOT_FOUND', 'CIRCULAR_CALL_DETECTED', 'IPC_DELIVERY_FAILED'] as const;
    type ErrorCode = typeof validCodes[number];
    const isValidCode = (code: string): code is ErrorCode => {
      return validCodes.some((c) => c === code);
    };
    const code = isValidCode(errorCode) ? errorCode : 'IPC_DELIVERY_FAILED';

    pending.reject(new AgentRequestError(code, targetName, errorMessage));
    return;
  }

  // Normal response
  const source = isJsonObject(payload.source) ? payload.source : null;
  const sourceName = source && typeof source.name === 'string' ? source.name : '';
  pending.resolve({
    eventId: typeof payload.id === 'string' ? payload.id : '',
    target: sourceName,
    response: payload.input ?? null,
    correlationId: inReplyTo,
  });
});

// ---------------------------------------------------------------------------
// Utility functions (minimal versions of runtime-runner helpers)
// ---------------------------------------------------------------------------

function createConversationKey(agentName: string, instanceKey: string): string {
  return `${agentName}:${instanceKey}`;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function unknownToErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isIpcMessage(value: unknown): value is IpcMessage {
  if (!isJsonObject(value)) return false;
  const v = value;
  return (
    (v.type === 'event' || v.type === 'shutdown' || v.type === 'shutdown_ack') &&
    typeof v.from === 'string' &&
    typeof v.to === 'string' &&
    'payload' in v
  );
}

function parseAgentEventFromIpc(message: IpcMessage): AgentEvent | undefined {
  const payload = message.payload;
  if (!isJsonObject(payload)) return undefined;

  return {
    id: typeof payload.id === 'string' ? payload.id : createId('evt'),
    type: typeof payload.type === 'string' ? payload.type : 'unknown',
    createdAt: new Date(),
    traceId: typeof payload.traceId === 'string' ? payload.traceId : undefined,
    source: isJsonObject(payload.source)
      ? { kind: String(payload.source.kind) === 'agent' ? 'agent' : 'connector', name: String(payload.source.name ?? 'unknown') }
      : { kind: 'connector', name: 'unknown' },
    input: typeof payload.input === 'string' ? payload.input : undefined,
    instanceKey: typeof payload.instanceKey === 'string' ? payload.instanceKey : undefined,
    metadata: isJsonObject(payload.metadata) ? payload.metadata : undefined,
    auth: isJsonObject(payload.auth) ? payload.auth : undefined,
    replyTo: isJsonObject(payload.replyTo) && typeof payload.replyTo.target === 'string' && typeof payload.replyTo.correlationId === 'string'
      ? { target: payload.replyTo.target, correlationId: payload.replyTo.correlationId }
      : undefined,
  };
}

function createConversationUserMessage(content: unknown, metadata?: Record<string, JsonValue>): Message {
  return {
    id: createId('msg'),
    data: { role: 'user', content },
    metadata: metadata ?? {},
    createdAt: new Date(),
    source: { type: 'user' },
  };
}

function createConversationAssistantMessage(content: unknown, stepId: string): Message {
  return {
    id: createId('msg'),
    data: { role: 'assistant', content },
    metadata: {},
    createdAt: new Date(),
    source: { type: 'assistant', stepId },
  };
}

function createToolContextMessage(content: string): Message {
  return {
    id: createId('msg'),
    data: { role: 'user', content },
    metadata: {},
    createdAt: new Date(),
    source: { type: 'user' },
  };
}

function createInboundMessageMetadata(event: AgentEvent): Record<string, JsonValue> {
  const metadata: Record<string, JsonValue> = {
    __goondanInbound: true,
  };
  if (event.source) {
    metadata.sourceKind = event.source.kind;
    metadata.sourceName = event.source.name;
  }
  if (event.traceId) {
    metadata.traceId = event.traceId;
  }
  return metadata;
}

function createConversationStateFromTurns(turns: ConversationTurn[]): ConversationStateImpl {
  const messages: Message[] = [];
  for (const turn of turns) {
    messages.push({
      id: createId('msg'),
      data: { role: turn.role, content: turn.content },
      metadata: {},
      createdAt: new Date(),
      source: turn.role === 'user' ? { type: 'user' } : { type: 'assistant', stepId: 'loaded' },
    });
  }
  return new ConversationStateImpl(messages, []);
}

async function ensureInstanceStorage(storage: FileWorkspaceStorage, queueKey: string, agentName: string): Promise<void> {
  await storage.initializeInstanceState(queueKey, agentName);
}

async function loadConversationFromStorage(
  storage: FileWorkspaceStorage,
  queueKey: string,
): Promise<ConversationTurn[]> {
  const loaded = await storage.loadConversation(queueKey);
  return toConversationTurns(loaded.nextMessages);
}

async function persistConversationToStorage(
  storage: FileWorkspaceStorage,
  queueKey: string,
  turns: ConversationTurn[],
): Promise<void> {
  const messages = toPersistentMessages(turns);
  await storage.writeBaseMessages(queueKey, messages);
}

function mergeToolCatalog(
  primary: ToolCatalogItem[],
  secondary: ToolCatalogItem[],
): ToolCatalogItem[] {
  const merged = [...primary];
  for (const item of secondary) {
    if (!merged.some((existing) => existing.name === item.name)) {
      merged.push(item);
    }
  }
  return merged;
}

function ensureJsonObject(value: unknown): JsonObject {
  if (isJsonObject(value)) return value;
  return {};
}

function cloneAsJsonObject(value: unknown): JsonObject {
  return ensureJsonObject(structuredClone(value));
}

// ---------------------------------------------------------------------------
// Entry point guard
// ---------------------------------------------------------------------------

function isAgentRunnerEntryPoint(): boolean {
  const entryArg = process.argv[1];
  if (typeof entryArg !== 'string' || entryArg.trim().length === 0) return false;
  try {
    const entryUrl = pathToFileURL(path.resolve(entryArg)).href;
    return entryUrl === import.meta.url;
  } catch {
    return false;
  }
}

if (isAgentRunnerEntryPoint()) {
  void main().catch((error) => {
    console.error(`[agent-process] fatal: ${unknownToErrorMessage(error)}`);
    process.exit(1);
  });
}

export type { AgentProcessPlan, AgentRunnerArguments };
