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
} from './types.js';
import type { EffectiveConfig, EffectiveConfigLoader } from './effective-config.js';
import type { Turn } from './turn-runner.js';

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

  /** 이 Step에 고정된 SwarmBundleRef */
  readonly activeSwarmBundleRef: SwarmBundleRef;

  /** 이 Step의 Effective Config */
  effectiveConfig: EffectiveConfig;

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
  effectiveConfig: EffectiveConfig;
  toolCatalog: ToolCatalogItem[];
  blocks: ContextBlock[];
}

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
    effectiveConfig: undefined as unknown as EffectiveConfig, // 나중에 설정
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
    messages: readonly import('./types.js').LlmMessage[],
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

  constructor(options: StepRunnerOptions) {
    this.llmCaller = options.llmCaller;
    this.toolExecutor = options.toolExecutor;
    this.effectiveConfigLoader = options.effectiveConfigLoader;
  }

  async run(turn: Turn): Promise<Step> {
    const agentInstance = turn.agentInstance;
    const swarmInstance = agentInstance.swarmInstance;

    // 1. Step 객체 생성
    const step = createStep(
      turn,
      turn.currentStepIndex,
      swarmInstance.activeSwarmBundleRef
    );

    try {
      // ========================================
      // 2. step.config 파이프라인 (Safe Point)
      // ========================================
      step.status = 'config';

      // 2.1 Effective Config 로드
      const effectiveConfig = await this.effectiveConfigLoader.load(
        step.activeSwarmBundleRef,
        agentInstance.agentRef
      );
      step.effectiveConfig = effectiveConfig;

      // ========================================
      // 3. step.tools 파이프라인
      // ========================================
      step.status = 'tools';

      // 3.1 기본 Tool Catalog 생성 (향후 Extension이 수정 가능)
      // 현재는 effectiveConfig.tools를 기반으로 생성
      const toolCatalog = this.buildToolCatalog(effectiveConfig);
      step.toolCatalog.push(...toolCatalog);

      // ========================================
      // 4. step.blocks 파이프라인
      // ========================================
      step.status = 'blocks';

      // 기본 블록 생성 (현재는 생략)

      // ========================================
      // 5. step.llmCall 파이프라인 (Middleware)
      // ========================================
      step.status = 'llmCall';

      // 5.1 LLM 요청 메시지 구성
      const llmMessages = this.buildLlmMessages(turn, effectiveConfig);

      // 5.2 LLM 호출
      const llmResult = await this.llmCaller.call(
        llmMessages,
        step.toolCatalog,
        effectiveConfig.model
      );
      step.llmResult = llmResult;

      // 5.3 LLM 응답을 Turn.messages에 추가
      turn.messages.push(llmResult.message);

      // ========================================
      // 6. Tool Call 처리
      // ========================================
      if (llmResult.message.toolCalls && llmResult.message.toolCalls.length > 0) {
        step.status = 'toolExec';

        // toolCalls 복사 (readonly 배열이므로)
        for (const toolCall of llmResult.message.toolCalls) {
          step.toolCalls.push(toolCall);
        }

        for (const toolCall of step.toolCalls) {
          let toolResult: ToolResult;

          try {
            // 6.1 toolCall.exec middleware (실제 실행)
            toolResult = await this.toolExecutor.execute(toolCall, step);
          } catch (toolError) {
            // Tool 오류를 ToolResult로 변환 (예외 전파 금지)
            const error = toolError instanceof Error ? toolError : new Error(String(toolError));
            toolResult = {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              error: {
                status: 'error',
                error: {
                  message: truncateErrorMessage(error.message),
                  name: error.name,
                  code: (error as Error & { code?: string }).code,
                },
              },
            };
          }

          step.toolResults.push(toolResult);

          // 6.2 Tool 결과를 Turn.messages에 추가
          const toolMessage: LlmToolMessage = {
            role: 'tool',
            toolCallId: toolResult.toolCallId,
            toolName: toolResult.toolName,
            output: toolResult.output ?? toolResult.error ?? null,
          };
          turn.messages.push(toolMessage);
        }
      }

      // ========================================
      // 7. step.post 파이프라인
      // ========================================
      step.status = 'post';

      // 향후 구현

      // 8. Step 완료
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
      result['enum'] = schema.enum.map((v) =>
        v === undefined ? null : (v as import('../types/json.js').JsonValue)
      );
    }

    if (schema.default !== undefined) {
      result['default'] = schema.default === undefined
        ? null
        : (schema.default as import('../types/json.js').JsonValue);
    }

    return result;
  }

  /**
   * LLM 메시지 빌드
   */
  private buildLlmMessages(
    turn: Turn,
    effectiveConfig: EffectiveConfig
  ): import('./types.js').LlmMessage[] {
    const messages: import('./types.js').LlmMessage[] = [];

    // 1. 시스템 프롬프트
    messages.push({
      role: 'system',
      content: effectiveConfig.systemPrompt,
    });

    // 2. Turn.messages 복사
    for (const msg of turn.messages) {
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
