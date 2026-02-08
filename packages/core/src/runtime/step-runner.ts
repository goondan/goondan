/**
 * Step 실행 구현
 * @see /docs/specs/runtime.md - 2.5 Step 타입, 6. Step 실행 순서
 */

import type { JsonObject } from '../types/json.js';
import type {
  StepStatus,
  SwarmBundleRef,
  LlmResult,
  ToolCall,
  ToolResult,
  ToolCatalogItem,
  ContextBlock,
  LlmToolMessage,
  LlmMessage,
  LlmAssistantMessage,
  MessageEvent,
} from './types.js';
import { computeNextMessages } from './types.js';
import type { EffectiveConfig, EffectiveConfigLoader } from './effective-config.js';
import type { Turn } from './turn-runner.js';
import type {
  ContextForPoint as PipelineContextForPoint,
  ResultForPoint as PipelineResultForPoint,
  EventBus as PipelineEventBus,
  StepContext as PipelineStepContext,
  LlmInputContext as PipelineLlmInputContext,
  ToolCallContext as PipelineToolCallContext,
  ToolCall as PipelineToolCall,
  ToolResult as PipelineToolResult,
  ToolCatalogItem as PipelineToolCatalogItem,
  ContextBlock as PipelineContextBlock,
  LlmMessage as PipelineLlmMessage,
  LlmResult as PipelineLlmResult,
  LlmErrorContext as PipelineLlmErrorContext,
  MessageEvent as PipelineMessageEvent,
} from '../pipeline/context.js';
import type { MutatorPoint, MiddlewarePoint } from '../pipeline/types.js';

/**
 * Step: "LLM 호출 1회"를 중심으로 한 단위
 *
 * 규칙:
 * - MUST: Step이 시작되면 종료까지 Effective Config와 SwarmBundleRef가 고정
 * - MUST: LLM 응답의 tool call을 모두 처리한 시점에 종료
 */
export interface Step {
  /** Step 고유 ID */
  readonly id: string;

  /** 소속된 Turn 참조 */
  readonly turn: Turn;

  /** Step 인덱스 (Turn 내에서 0부터 시작) */
  readonly index: number;

  /** 이 Step에 고정된 SwarmBundleRef (step.config Safe Point에서 확정) */
  activeSwarmBundleRef: SwarmBundleRef;

  /** 이 Step의 Effective Config (Step 실행 중 config 단계에서 설정됨) */
  effectiveConfig: EffectiveConfig | undefined;

  /** LLM에 노출된 Tool Catalog */
  readonly toolCatalog: ToolCatalogItem[];

  /** 컨텍스트 블록 */
  readonly blocks: ContextBlock[];

  /** LLM 호출 결과 */
  llmResult?: LlmResult;

  /** Tool 호출 목록 */
  readonly toolCalls: ToolCall[];

  /** Tool 결과 목록 */
  readonly toolResults: ToolResult[];

  /** Step 상태 */
  status: StepStatus;

  /** Step 시작 시각 */
  readonly startedAt: Date;

  /** Step 종료 시각 */
  completedAt?: Date;

  /** Step 메타데이터 */
  metadata: JsonObject;
}

/**
 * StepContext: Step 실행 컨텍스트
 */
export interface StepContext {
  turn: Turn;
  step: Step;
  effectiveConfig: EffectiveConfig | undefined;
  toolCatalog: ToolCatalogItem[];
  blocks: ContextBlock[];
  llmInput?: LlmMessage[];
}

/**
 * Runtime에서 사용하는 파이프라인 실행 인터페이스
 */
export interface RuntimePipelineExecutor {
  runMutators<T extends MutatorPoint>(
    point: T,
    initialCtx: PipelineContextForPoint<T>
  ): Promise<PipelineContextForPoint<T>>;

  runMiddleware<T extends MiddlewarePoint>(
    point: T,
    ctx: PipelineContextForPoint<T>,
    core: (ctx: PipelineContextForPoint<T>) => Promise<PipelineResultForPoint<T>>
  ): Promise<PipelineResultForPoint<T>>;
}

const NOOP_PIPELINE_EVENT_BUS: PipelineEventBus = {
  emit: () => {},
  on: () => () => {},
};

/**
 * 고유 ID 생성
 */
function generateId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Step 생성
 *
 * @param turn - 소속된 Turn
 * @param index - Step 인덱스
 * @param activeSwarmBundleRef - 활성 SwarmBundleRef
 * @returns Step
 */
export function createStep(
  turn: Turn,
  index: number,
  activeSwarmBundleRef: SwarmBundleRef
): Step {
  return {
    id: generateId(),
    turn,
    index,
    activeSwarmBundleRef,
    effectiveConfig: undefined,
    toolCatalog: [],
    blocks: [],
    toolCalls: [],
    toolResults: [],
    status: 'pending',
    startedAt: new Date(),
    metadata: {},
  };
}

/**
 * LLM 호출 인터페이스
 */
export interface LlmCaller {
  call(
    messages: readonly LlmMessage[],
    toolCatalog: ToolCatalogItem[],
    model: import('../types/specs/model.js').ModelResource
  ): Promise<LlmResult>;
}

/**
 * Tool 실행 인터페이스
 */
export interface ToolExecutor {
  execute(toolCall: ToolCall, step: Step): Promise<ToolResult>;
}

/**
 * StepRunner 옵션
 */
export interface StepRunnerOptions {
  llmCaller: LlmCaller;
  toolExecutor: ToolExecutor;
  effectiveConfigLoader: EffectiveConfigLoader;
  pipelineExecutor?: RuntimePipelineExecutor;
  pipelineEventBus?: PipelineEventBus;
  logger?: Console;
}

/**
 * StepRunner: Step 실행 로직
 */
export interface StepRunner {
  /**
   * Step 실행
   *
   * @param turn - Turn
   * @returns 완료된 Step
   */
  run(turn: Turn): Promise<Step>;
}

/**
 * JsonObject 타입 가드
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Error에서 code 프로퍼티를 안전하게 추출 (타입 가드 방식)
 */
function extractErrorCode(error: Error): string | undefined {
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/**
 * 에러 메시지 자르기
 */
function truncateErrorMessage(message: string, limit: number = 1000): string {
  if (message.length <= limit) {
    return message;
  }
  return message.substring(0, limit) + '... (truncated)';
}

/**
 * StepRunner 구현
 */
class StepRunnerImpl implements StepRunner {
  private readonly llmCaller: LlmCaller;
  private readonly toolExecutor: ToolExecutor;
  private readonly effectiveConfigLoader: EffectiveConfigLoader;
  private readonly pipelineExecutor?: RuntimePipelineExecutor;
  private readonly pipelineEventBus: PipelineEventBus;
  private readonly logger: Console;

  constructor(options: StepRunnerOptions) {
    this.llmCaller = options.llmCaller;
    this.toolExecutor = options.toolExecutor;
    this.effectiveConfigLoader = options.effectiveConfigLoader;
    this.pipelineExecutor = options.pipelineExecutor;
    this.pipelineEventBus = options.pipelineEventBus ?? NOOP_PIPELINE_EVENT_BUS;
    this.logger = options.logger ?? console;
  }

  async run(turn: Turn): Promise<Step> {
    const agentInstance = turn.agentInstance;
    const swarmInstance = agentInstance.swarmInstance;
    const provisionalSwarmBundleRef = swarmInstance.activeSwarmBundleRef;

    // 1. Step 객체 생성 (초기값은 이전 active ref, step.config에서 최종 확정)
    const step = createStep(
      turn,
      turn.currentStepIndex,
      provisionalSwarmBundleRef
    );

    try {
      let effectiveConfig: EffectiveConfig | undefined;
      step.effectiveConfig = undefined;

      // ========================================
      // 2. step.pre 파이프라인 (Safe Point 이전)
      // ========================================
      const preContext = await this.runMutators(
        'step.pre',
        this.createPipelineStepContext(
          turn,
          step,
          effectiveConfig,
          step.toolCatalog,
          step.blocks
        )
      );
      this.applyPipelineCatalog(step, preContext.toolCatalog);
      this.applyPipelineBlocks(step, preContext.blocks);

      // ========================================
      // 3. step.config 파이프라인 (Safe Point)
      // ========================================
      step.status = 'config';
      const activeSwarmBundleRef = await this.effectiveConfigLoader.getActiveRef();
      step.activeSwarmBundleRef = activeSwarmBundleRef;
      effectiveConfig = await this.effectiveConfigLoader.load(
        activeSwarmBundleRef,
        agentInstance.agentRef
      );
      step.effectiveConfig = effectiveConfig;
      swarmInstance.activeSwarmBundleRef = activeSwarmBundleRef;

      const configContext = await this.runMutators(
        'step.config',
        this.createPipelineStepContext(
          turn,
          step,
          effectiveConfig,
          step.toolCatalog,
          step.blocks
        )
      );
      this.applyPipelineCatalog(step, configContext.toolCatalog);
      this.applyPipelineBlocks(step, configContext.blocks);
      if (!effectiveConfig) {
        throw new Error('EffectiveConfig is required after step.config');
      }

      // ========================================
      // 4. step.tools 파이프라인
      // ========================================
      step.status = 'tools';

      // 3.1 기본 Tool Catalog 생성
      const toolCatalog = this.buildToolCatalog(effectiveConfig);
      step.toolCatalog.splice(0, step.toolCatalog.length, ...toolCatalog);

      const toolsContext = await this.runMutators(
        'step.tools',
        this.createPipelineStepContext(
          turn,
          step,
          effectiveConfig,
          step.toolCatalog,
          step.blocks
        )
      );
      this.applyPipelineCatalog(step, toolsContext.toolCatalog);
      this.applyPipelineBlocks(step, toolsContext.blocks);

      // ========================================
      // 5. step.blocks 파이프라인
      // ========================================
      step.status = 'blocks';

      const blocksContext = await this.runMutators(
        'step.blocks',
        this.createPipelineStepContext(
          turn,
          step,
          effectiveConfig,
          step.toolCatalog,
          step.blocks
        )
      );
      this.applyPipelineCatalog(step, blocksContext.toolCatalog);
      this.applyPipelineBlocks(step, blocksContext.blocks);

      // ========================================
      // 6. step.llmInput 파이프라인
      // ========================================
      step.status = 'llmInput';
      const baseLlmInput = this.buildLlmMessages(turn, effectiveConfig);

      const llmInputContext = await this.runMutators(
        'step.llmInput',
        this.createPipelineLlmInputContext(
          turn,
          step,
          effectiveConfig,
          step.toolCatalog,
          step.blocks,
          baseLlmInput
        )
      );
      this.applyPipelineCatalog(step, llmInputContext.toolCatalog);
      this.applyPipelineBlocks(step, llmInputContext.blocks);

      const llmInput = this.normalizeLlmInput(llmInputContext.llmInput);

      // ========================================
      // 7. step.llmCall 파이프라인 (Middleware)
      // ========================================
      step.status = 'llmCall';

      let llmResult: LlmResult;
      try {
        const pipelineLlmResult = await this.runMiddleware(
          'step.llmCall',
          this.createPipelineStepContext(
            turn,
            step,
            effectiveConfig,
            step.toolCatalog,
            step.blocks,
            llmInput
          ),
          async (ctx) => {
            const normalizedInput = ctx.llmInput
              ? this.normalizeLlmInput(ctx.llmInput)
              : llmInput;
            const runtimeResult = await this.llmCaller.call(
              normalizedInput,
              step.toolCatalog,
              effectiveConfig.model
            );
            return this.toPipelineLlmResult(runtimeResult);
          }
        );

        llmResult = this.toRuntimeLlmResult(pipelineLlmResult);
      } catch (llmError) {
        const error = llmError instanceof Error ? llmError : new Error(String(llmError));

        const llmErrorContext = await this.runMutators(
          'step.llmError',
          this.createPipelineLlmErrorContext(
            turn,
            step,
            effectiveConfig,
            step.toolCatalog,
            step.blocks,
            llmInput,
            error
          )
        );

        if (!llmErrorContext.shouldRetry) {
          throw error;
        }

        if (llmErrorContext.retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, llmErrorContext.retryDelayMs));
        }

        const retryInput = llmErrorContext.llmInput
          ? this.normalizeLlmInput(llmErrorContext.llmInput)
          : llmInput;
        llmResult = await this.llmCaller.call(
          retryInput,
          step.toolCatalog,
          effectiveConfig.model
        );
      }

      step.llmResult = llmResult;

      // 6.1 LLM 응답을 messageState에 이벤트로 기록
      this.appendMessageEvent(turn, {
        type: 'llm_message',
        seq: turn.messageState.events.length,
        message: llmResult.message,
      });

      // ========================================
      // 8. Tool Call 처리
      // ========================================
      const llmToolCalls = llmResult.message.toolCalls ?? [];

      if (llmToolCalls.length > 0) {
        step.status = 'toolExec';

        for (const rawToolCall of llmToolCalls) {
          const preContext = await this.runMutators(
            'toolCall.pre',
            this.createPipelineToolCallContext(
              turn,
              step,
              effectiveConfig,
              step.toolCatalog,
              step.blocks,
              llmInput,
              rawToolCall
            )
          );

          this.applyPipelineCatalog(step, preContext.toolCatalog);
          this.applyPipelineBlocks(step, preContext.blocks);

          const toolCall = this.normalizePipelineToolCall(preContext.toolCall);
          step.toolCalls.push(toolCall);

          let toolResult: ToolResult;

          if (!this.isToolInCatalog(step.toolCatalog, toolCall.name)) {
            toolResult = this.createToolNotInCatalogResult(toolCall);
          } else {
            try {
              const executedResult = await this.runMiddleware(
                'toolCall.exec',
                preContext,
                async (ctx) => {
                  const runtimeToolCall = this.normalizePipelineToolCall(ctx.toolCall);
                  const runtimeResult = await this.toolExecutor.execute(runtimeToolCall, step);
                  return this.toPipelineToolResult(runtimeResult);
                }
              );
              toolResult = this.toRuntimeToolResult(executedResult);
            } catch (toolError) {
              // Tool 오류를 ToolResult로 변환 (예외 전파 금지)
              const error = toolError instanceof Error ? toolError : new Error(String(toolError));
              toolResult = {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                status: 'error',
                error: {
                  name: error.name,
                  message: truncateErrorMessage(error.message),
                  code: extractErrorCode(error),
                },
              };
            }
          }

          const postContext = await this.runMutators(
            'toolCall.post',
            this.createPipelineToolCallContext(
              turn,
              step,
              effectiveConfig,
              step.toolCatalog,
              step.blocks,
              llmInput,
              toolCall,
              toolResult
            )
          );

          this.applyPipelineCatalog(step, postContext.toolCatalog);
          this.applyPipelineBlocks(step, postContext.blocks);

          const finalToolResult = postContext.toolResult
            ? this.toRuntimeToolResult(postContext.toolResult)
            : toolResult;

          step.toolResults.push(finalToolResult);

          // 7.1 Tool 결과를 messageState에 이벤트로 기록
          const toolMessage: LlmToolMessage = {
            id: `msg-tool-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`,
            role: 'tool',
            toolCallId: finalToolResult.toolCallId,
            toolName: finalToolResult.toolName,
            output: finalToolResult.output ?? finalToolResult.error ?? null,
          };
          this.appendMessageEvent(turn, {
            type: 'llm_message',
            seq: turn.messageState.events.length,
            message: toolMessage,
          });
        }
      }

      // ========================================
      // 9. step.post 파이프라인
      // ========================================
      step.status = 'post';
      const postContext = await this.runMutators(
        'step.post',
        this.createPipelineStepContext(
          turn,
          step,
          effectiveConfig,
          step.toolCatalog,
          step.blocks,
          llmInput
        )
      );
      this.applyPipelineCatalog(step, postContext.toolCatalog);
      this.applyPipelineBlocks(step, postContext.blocks);

      // 10. Step 완료
      step.status = 'completed';
      step.completedAt = new Date();
    } catch (error) {
      step.status = 'failed';
      step.completedAt = new Date();

      const err = error instanceof Error ? error : new Error(String(error));
      step.metadata['error'] = {
        message: err.message,
        name: err.name,
        stack: err.stack ?? null,
      };

      throw error;
    }

    return step;
  }

  private async runMutators<T extends MutatorPoint>(
    point: T,
    context: PipelineContextForPoint<T>
  ): Promise<PipelineContextForPoint<T>> {
    if (!this.pipelineExecutor) {
      return context;
    }

    return this.pipelineExecutor.runMutators(point, context);
  }

  private async runMiddleware<T extends MiddlewarePoint>(
    point: T,
    context: PipelineContextForPoint<T>,
    core: (ctx: PipelineContextForPoint<T>) => Promise<PipelineResultForPoint<T>>
  ): Promise<PipelineResultForPoint<T>> {
    if (!this.pipelineExecutor) {
      return core(context);
    }

    return this.pipelineExecutor.runMiddleware(point, context, core);
  }

  private createPipelineStepContext(
    turn: Turn,
    step: Step,
    effectiveConfig: EffectiveConfig | undefined,
    toolCatalog: readonly ToolCatalogItem[],
    blocks: readonly ContextBlock[],
    llmInput?: readonly LlmMessage[]
  ): PipelineStepContext {
    const swarmResource = effectiveConfig?.swarm ?? this.createPlaceholderResource(
      turn.agentInstance.swarmInstance.swarmRef,
      'Swarm'
    );
    const agentResource = effectiveConfig?.agent ?? this.createPlaceholderResource(
      turn.agentInstance.agentRef,
      'Agent'
    );

    const context: PipelineStepContext = {
      instance: {
        id: turn.agentInstance.swarmInstance.id,
        key: turn.agentInstance.swarmInstance.instanceKey,
      },
      swarm: swarmResource,
      agent: agentResource,
      effectiveConfig,
      events: this.pipelineEventBus,
      logger: this.logger,
      turn: {
        id: turn.id,
        input: turn.inputEvent.input,
        messageState: {
          baseMessages: turn.messageState.baseMessages.map((message) => this.toPipelineLlmMessage(message)),
          events: turn.messageState.events.map((event) => this.toPipelineMessageEvent(event)),
          nextMessages: turn.messageState.nextMessages.map((message) => this.toPipelineLlmMessage(message)),
        },
        toolResults: this.collectTurnToolResults(turn).map((result) => this.toPipelineToolResult(result)),
        metadata: { ...turn.metadata },
      },
      step: {
        id: step.id,
        index: step.index,
        llmResult: step.llmResult ? this.toPipelineLlmResult(step.llmResult) : undefined,
        startedAt: step.startedAt,
        endedAt: step.completedAt,
      },
      toolCatalog: toolCatalog.map((item) => this.toPipelineToolCatalogItem(item)),
      blocks: blocks.map((block) => this.toPipelineContextBlock(block)),
      activeSwarmRef: step.activeSwarmBundleRef,
    };

    if (llmInput !== undefined) {
      context.llmInput = llmInput.map((message) => this.toPipelineLlmMessage(message));
    }

    return context;
  }

  private createPlaceholderResource(
    ref: string | { kind?: string; name?: string },
    fallbackKind: string
  ): {
    apiVersion: string;
    kind: string;
    metadata: { name: string };
    spec: JsonObject;
  } {
    const resolved = this.resolveRefName(ref, fallbackKind);
    return {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: resolved.kind,
      metadata: { name: resolved.name },
      spec: {},
    };
  }

  private resolveRefName(
    ref: string | { kind?: string; name?: string },
    fallbackKind: string
  ): { kind: string; name: string } {
    if (typeof ref === 'string') {
      const parts = ref.split('/');
      if (parts.length === 2 && parts[0] && parts[1]) {
        return { kind: parts[0], name: parts[1] };
      }
      return { kind: fallbackKind, name: ref };
    }

    const kind = typeof ref.kind === 'string' && ref.kind.length > 0 ? ref.kind : fallbackKind;
    const name = typeof ref.name === 'string' && ref.name.length > 0 ? ref.name : 'unknown';
    return { kind, name };
  }

  private createPipelineLlmInputContext(
    turn: Turn,
    step: Step,
    effectiveConfig: EffectiveConfig,
    toolCatalog: readonly ToolCatalogItem[],
    blocks: readonly ContextBlock[],
    llmInput: readonly LlmMessage[]
  ): PipelineLlmInputContext {
    return {
      ...this.createPipelineStepContext(
        turn,
        step,
        effectiveConfig,
        toolCatalog,
        blocks,
        llmInput
      ),
      llmInput: llmInput.map((message) => this.toPipelineLlmMessage(message)),
    };
  }

  private createPipelineLlmErrorContext(
    turn: Turn,
    step: Step,
    effectiveConfig: EffectiveConfig,
    toolCatalog: readonly ToolCatalogItem[],
    blocks: readonly ContextBlock[],
    llmInput: readonly LlmMessage[],
    error: Error
  ): PipelineLlmErrorContext {
    return {
      ...this.createPipelineStepContext(
        turn,
        step,
        effectiveConfig,
        toolCatalog,
        blocks,
        llmInput
      ),
      error,
      retryCount: 0,
      shouldRetry: false,
      retryDelayMs: 0,
    };
  }

  private createPipelineToolCallContext(
    turn: Turn,
    step: Step,
    effectiveConfig: EffectiveConfig,
    toolCatalog: readonly ToolCatalogItem[],
    blocks: readonly ContextBlock[],
    llmInput: readonly LlmMessage[],
    toolCall: ToolCall,
    toolResult?: ToolResult
  ): PipelineToolCallContext {
    const context: PipelineToolCallContext = {
      ...this.createPipelineStepContext(
        turn,
        step,
        effectiveConfig,
        toolCatalog,
        blocks,
        llmInput
      ),
      toolCall: this.toPipelineToolCall(toolCall),
    };

    if (toolResult !== undefined) {
      context.toolResult = this.toPipelineToolResult(toolResult);
    }

    return context;
  }

  private collectTurnToolResults(turn: Turn): ToolResult[] {
    const results: ToolResult[] = [];

    for (const previousStep of turn.steps) {
      for (const result of previousStep.toolResults) {
        results.push(result);
      }
    }

    return results;
  }

  private applyPipelineCatalog(step: Step, pipelineCatalog: readonly PipelineToolCatalogItem[]): void {
    const existingByName = new Map<string, ToolCatalogItem>();
    for (const item of step.toolCatalog) {
      existingByName.set(item.name, item);
    }

    const nextCatalog: ToolCatalogItem[] = [];
    for (const item of pipelineCatalog) {
      const existing = existingByName.get(item.name);
      const runtimeSource = this.toRuntimeToolSource(item.source);
      const runtimeItem: ToolCatalogItem = {
        name: item.name,
        ...(item.description !== undefined ? { description: item.description } : {}),
        ...(item.parameters !== undefined ? { parameters: item.parameters } : {}),
        ...(existing?.tool !== undefined ? { tool: existing.tool } : {}),
        ...(existing?.export !== undefined ? { export: existing.export } : {}),
        ...(runtimeSource !== undefined ? { source: runtimeSource } : {}),
      };

      nextCatalog.push(runtimeItem);
    }

    step.toolCatalog.splice(0, step.toolCatalog.length, ...nextCatalog);
  }

  private applyPipelineBlocks(step: Step, pipelineBlocks: readonly PipelineContextBlock[]): void {
    const nextBlocks = pipelineBlocks.map((block) => this.toRuntimeContextBlock(block));
    step.blocks.splice(0, step.blocks.length, ...nextBlocks);
  }

  private normalizeLlmInput(messages: readonly PipelineLlmMessage[]): LlmMessage[] {
    const normalized: LlmMessage[] = [];

    for (const message of messages) {
      normalized.push(this.normalizePipelineLlmMessage(message));
    }

    return normalized;
  }

  private normalizePipelineLlmMessage(message: PipelineLlmMessage): LlmMessage {
    if (message.role === 'system') {
      return {
        id: message.id,
        role: 'system',
        content: typeof message.content === 'string' ? message.content : '',
      };
    }

    if (message.role === 'user') {
      return {
        id: message.id,
        role: 'user',
        content: typeof message.content === 'string' ? message.content : '',
      };
    }

    if (message.role === 'tool') {
      const toolCallId = typeof message['toolCallId'] === 'string'
        ? message['toolCallId']
        : `toolcall-${message.id}`;
      const toolName = typeof message['toolName'] === 'string'
        ? message['toolName']
        : 'unknown.tool';
      const output = message['output'] ?? null;

      return {
        id: message.id,
        role: 'tool',
        toolCallId,
        toolName,
        output,
      };
    }

    const toolCalls = this.extractToolCalls(message['toolCalls']);
    return {
      id: message.id,
      role: 'assistant',
      ...(typeof message.content === 'string' ? { content: message.content } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  private extractToolCalls(value: unknown): ToolCall[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const toolCalls: ToolCall[] = [];
    for (const item of value) {
      if (!isJsonObject(item)) {
        continue;
      }

      const id = item['id'];
      const name = item['name'];
      const args = item['args'];

      if (typeof id !== 'string' || typeof name !== 'string' || !isJsonObject(args)) {
        continue;
      }

      toolCalls.push({ id, name, args });
    }

    return toolCalls;
  }

  private toPipelineLlmResult(result: LlmResult): PipelineLlmResult {
    const pipelineResult: PipelineLlmResult = {
      message: this.toPipelineLlmMessage(result.message),
    };

    if (result.message.toolCalls && result.message.toolCalls.length > 0) {
      pipelineResult.toolCalls = result.message.toolCalls.map((call) => this.toPipelineToolCall(call));
    }

    const usage = result.meta.usage;
    if (usage || result.meta.model !== undefined || result.meta.finishReason !== undefined) {
      pipelineResult.meta = {
        model: result.meta.model,
        finishReason: result.meta.finishReason,
      };

      if (usage) {
        pipelineResult.meta.usage = {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        };
      }
    }

    return pipelineResult;
  }

  private toRuntimeLlmResult(result: PipelineLlmResult): LlmResult {
    const normalizedMessage = this.normalizePipelineLlmMessage(result.message);
    const assistantMessage = this.toAssistantMessage(normalizedMessage, result.toolCalls);

    const runtimeResult: LlmResult = {
      message: assistantMessage,
      meta: {},
    };

    if (result.meta?.model !== undefined) {
      runtimeResult.meta.model = result.meta.model;
    }

    if (result.meta?.finishReason !== undefined) {
      runtimeResult.meta.finishReason = result.meta.finishReason;
    }

    if (result.meta?.usage) {
      const usage = result.meta.usage;
      runtimeResult.meta.usage = {
        promptTokens: usage.promptTokens ?? usage.inputTokens ?? 0,
        completionTokens: usage.completionTokens ?? usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens,
      };
    }

    return runtimeResult;
  }

  private toAssistantMessage(
    message: LlmMessage,
    fallbackToolCalls?: readonly PipelineToolCall[]
  ): LlmAssistantMessage {
    if (message.role === 'assistant') {
      const fallbackCalls = fallbackToolCalls && fallbackToolCalls.length > 0
        ? fallbackToolCalls.map((call) => this.normalizePipelineToolCall(call))
        : undefined;

      return {
        id: message.id,
        role: 'assistant',
        ...(message.content !== undefined ? { content: message.content } : {}),
        ...(message.toolCalls && message.toolCalls.length > 0
          ? { toolCalls: message.toolCalls }
          : fallbackCalls
            ? { toolCalls: fallbackCalls }
            : {}),
      };
    }

    const fallbackCalls = fallbackToolCalls && fallbackToolCalls.length > 0
      ? fallbackToolCalls.map((call) => this.normalizePipelineToolCall(call))
      : undefined;

    return {
      id: message.id,
      role: 'assistant',
      ...('content' in message && typeof message.content === 'string'
        ? { content: message.content }
        : {}),
      ...(fallbackCalls ? { toolCalls: fallbackCalls } : {}),
    };
  }

  private toPipelineToolResult(result: ToolResult): PipelineToolResult {
    return {
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      status: result.status,
      ...(result.output !== undefined ? { output: result.output } : {}),
      ...(result.handle !== undefined ? { handle: result.handle } : {}),
      ...(result.error !== undefined ? { error: { ...result.error } } : {}),
    };
  }

  private toRuntimeToolResult(result: PipelineToolResult): ToolResult {
    return {
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      status: result.status,
      ...(result.output !== undefined ? { output: result.output } : {}),
      ...(result.handle !== undefined ? { handle: result.handle } : {}),
      ...(result.error !== undefined ? { error: { ...result.error } } : {}),
    };
  }

  private toPipelineToolCall(toolCall: ToolCall): PipelineToolCall {
    return {
      id: toolCall.id,
      name: toolCall.name,
      args: { ...toolCall.args },
    };
  }

  private normalizePipelineToolCall(toolCall: PipelineToolCall): ToolCall {
    return {
      id: toolCall.id,
      name: toolCall.name,
      args: { ...toolCall.args },
    };
  }

  private toPipelineToolCatalogItem(item: ToolCatalogItem): PipelineToolCatalogItem {
    const source = this.toPipelineToolSource(item.source);

    return {
      name: item.name,
      ...(item.description !== undefined ? { description: item.description } : {}),
      ...(item.parameters !== undefined ? { parameters: item.parameters } : {}),
      ...(item.tool !== undefined ? { tool: item.tool } : {}),
      ...(item.export !== undefined ? { export: item.export } : {}),
      ...(source !== undefined ? { source } : {}),
    };
  }

  private toPipelineToolSource(source: JsonObject | undefined): PipelineToolCatalogItem['source'] | undefined {
    if (!source) {
      return undefined;
    }

    const typeValue = source['type'];
    if (typeValue !== 'static' && typeValue !== 'dynamic' && typeValue !== 'mcp') {
      return undefined;
    }

    return {
      type: typeValue,
      ...(typeof source['extension'] === 'string' ? { extension: source['extension'] } : {}),
      ...(typeof source['mcpServer'] === 'string' ? { mcpServer: source['mcpServer'] } : {}),
    };
  }

  private toRuntimeToolSource(source: PipelineToolCatalogItem['source']): JsonObject | undefined {
    if (!source) {
      return undefined;
    }

    const runtimeSource: JsonObject = {
      type: source.type,
    };

    if (source.extension !== undefined) {
      runtimeSource['extension'] = source.extension;
    }

    if (source.mcpServer !== undefined) {
      runtimeSource['mcpServer'] = source.mcpServer;
    }

    return runtimeSource;
  }

  private toPipelineContextBlock(block: ContextBlock): PipelineContextBlock {
    return {
      type: block.type,
      ...(block.data !== undefined ? { data: block.data } : {}),
      ...(block.items !== undefined ? { items: [...block.items] } : {}),
    };
  }

  private toRuntimeContextBlock(block: PipelineContextBlock): ContextBlock {
    return {
      type: block.type,
      ...(block.data !== undefined ? { data: block.data } : {}),
      ...(block.items !== undefined ? { items: [...block.items] } : {}),
    };
  }

  private toPipelineLlmMessage(message: LlmMessage): PipelineLlmMessage {
    if (message.role === 'system') {
      return {
        id: message.id,
        role: 'system',
        content: message.content,
      };
    }

    if (message.role === 'user') {
      return {
        id: message.id,
        role: 'user',
        content: message.content,
      };
    }

    if (message.role === 'assistant') {
      return {
        id: message.id,
        role: 'assistant',
        ...(message.content !== undefined ? { content: message.content } : {}),
        ...(message.toolCalls !== undefined
          ? {
              toolCalls: message.toolCalls.map((call) => this.toPipelineToolCall(call)),
            }
          : {}),
      };
    }

    return {
      id: message.id,
      role: 'tool',
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      output: message.output,
    };
  }

  private toPipelineMessageEvent(event: MessageEvent): PipelineMessageEvent {
    if (event.type === 'llm_message') {
      return {
        type: 'llm_message',
        seq: event.seq,
        message: this.toPipelineLlmMessage(event.message),
      };
    }

    if (event.type === 'system_message') {
      return {
        type: 'system_message',
        seq: event.seq,
        message: {
          id: event.message.id,
          role: 'system',
          content: event.message.content,
        },
      };
    }

    if (event.type === 'replace') {
      return {
        type: 'replace',
        seq: event.seq,
        targetId: event.targetId,
        message: this.toPipelineLlmMessage(event.message),
      };
    }

    if (event.type === 'remove') {
      return {
        type: 'remove',
        seq: event.seq,
        targetId: event.targetId,
      };
    }

    return {
      type: 'truncate',
      seq: event.seq,
    };
  }

  private isToolInCatalog(catalog: readonly ToolCatalogItem[], toolName: string): boolean {
    return catalog.some((item) => item.name === toolName);
  }

  private createToolNotInCatalogResult(toolCall: ToolCall): ToolResult {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      status: 'error',
      error: {
        name: 'ToolNotInCatalogError',
        code: 'E_TOOL_NOT_IN_CATALOG',
        message: `Tool '${toolCall.name}' is not available in the current Tool Catalog.`,
        suggestion: 'Agent 구성의 spec.tools에 해당 도구를 추가하거나, step.tools 파이프라인에서 동적으로 등록하세요.',
      },
    };
  }

  /**
   * MessageEvent를 Turn의 messageState에 추가하고 nextMessages를 재계산
   */
  private appendMessageEvent(turn: Turn, event: MessageEvent): void {
    turn.messageState.events.push(event);
    const recomputed = computeNextMessages(
      turn.messageState.baseMessages,
      turn.messageState.events
    );
    turn.messageState.nextMessages.splice(
      0,
      turn.messageState.nextMessages.length,
      ...recomputed
    );
  }

  /**
   * Tool Catalog 빌드
   */
  private buildToolCatalog(effectiveConfig: EffectiveConfig): ToolCatalogItem[] {
    const catalog: ToolCatalogItem[] = [];

    for (const tool of effectiveConfig.tools) {
      for (const exp of tool.spec.exports) {
        catalog.push({
          name: exp.name,
          description: exp.description,
          parameters: this.schemaToJsonObject(exp.parameters),
          tool,
          export: exp,
        });
      }
    }

    return catalog;
  }

  /**
   * JsonSchema를 JsonObject로 변환
   */
  private schemaToJsonObject(
    schema: import('../types/json-schema.js').JsonSchema
  ): import('../types/json.js').JsonObject {
    const result: import('../types/json.js').JsonObject = {
      type: schema.type,
    };

    if (schema.properties !== undefined) {
      const props: import('../types/json.js').JsonObject = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        props[key] = this.schemaToJsonObject(value);
      }
      result['properties'] = props;
    }

    if (schema.items !== undefined) {
      result['items'] = this.schemaToJsonObject(schema.items);
    }

    if (schema.required !== undefined) {
      result['required'] = schema.required;
    }

    if (schema.description !== undefined) {
      result['description'] = schema.description;
    }

    if (schema.additionalProperties !== undefined) {
      if (typeof schema.additionalProperties === 'boolean') {
        result['additionalProperties'] = schema.additionalProperties;
      } else {
        result['additionalProperties'] = this.schemaToJsonObject(schema.additionalProperties);
      }
    }

    if (schema.enum !== undefined) {
      result['enum'] = schema.enum.map((v) => v ?? null);
    }

    if (schema.default !== undefined) {
      result['default'] = schema.default ?? null;
    }

    return result;
  }

  /**
   * LLM 메시지 빌드
   */
  private buildLlmMessages(
    turn: Turn,
    effectiveConfig: EffectiveConfig
  ): LlmMessage[] {
    const messages: LlmMessage[] = [];

    // 1. 시스템 프롬프트
    messages.push({
      id: 'msg-sys-0',
      role: 'system',
      content: effectiveConfig.systemPrompt,
    });

    // 2. Turn.messageState.nextMessages 복사
    for (const msg of turn.messageState.nextMessages) {
      messages.push({ ...msg });
    }

    return messages;
  }
}

/**
 * StepRunner 생성
 */
export function createStepRunner(options: StepRunnerOptions): StepRunner {
  return new StepRunnerImpl(options);
}
