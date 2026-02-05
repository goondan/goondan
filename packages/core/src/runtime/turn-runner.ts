/**
 * Turn 실행 구현
 * @see /docs/specs/runtime.md - 2.4 Turn 타입, 5. Turn 실행 흐름
 */

import type { JsonObject } from '../types/json.js';
import type {
  TurnStatus,
  TurnOrigin,
  TurnAuth,
  LlmMessage,
  AgentEvent,
} from './types.js';
import type { AgentInstance } from './agent-instance.js';
import type { SwarmInstance } from './swarm-instance.js';
import type { Step, StepRunner } from './step-runner.js';

/**
 * Turn: AgentInstance가 "하나의 입력 이벤트"를 처리하는 단위
 *
 * 규칙:
 * - MUST: 작업이 소진될 때까지 Step 반복 후 제어 반납
 * - MUST: Turn.messages에 LLM 응답 및 Tool 결과를 누적
 * - MUST: origin과 auth는 Turn 생애주기 동안 불변
 */
export interface Turn {
  /** Turn 고유 ID */
  readonly id: string;

  /** 소속된 AgentInstance 참조 */
  readonly agentInstance: AgentInstance;

  /** 입력 이벤트 */
  readonly inputEvent: AgentEvent;

  /** 호출 맥락 (불변) */
  readonly origin: TurnOrigin;

  /** 인증 컨텍스트 (불변) */
  readonly auth: TurnAuth;

  /** 누적된 LLM 메시지 */
  readonly messages: LlmMessage[];

  /** 실행된 Step 목록 */
  readonly steps: Step[];

  /** 현재 Step 인덱스 */
  currentStepIndex: number;

  /** Turn 상태 */
  status: TurnStatus;

  /** Turn 시작 시각 */
  readonly startedAt: Date;

  /** Turn 종료 시각 (완료 시 설정) */
  completedAt?: Date;

  /** Turn 메타데이터 (확장용) */
  metadata: JsonObject;
}

/**
 * TurnContext: Turn 실행 컨텍스트
 */
export interface TurnContext {
  turn: Turn;
  agentInstance: AgentInstance;
  swarmInstance: SwarmInstance;
}

/**
 * 고유 ID 생성
 */
function generateId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Turn 생성
 *
 * @param agentInstance - 소속된 AgentInstance
 * @param event - 입력 이벤트
 * @returns Turn
 */
export function createTurn(agentInstance: AgentInstance, event: AgentEvent): Turn {
  return {
    id: generateId(),
    agentInstance,
    inputEvent: event,
    origin: event.origin ?? {},
    auth: event.auth ?? {},
    messages: [],
    steps: [],
    currentStepIndex: 0,
    status: 'pending',
    startedAt: new Date(),
    metadata: {},
  };
}

/**
 * TurnRunner 옵션
 */
export interface TurnRunnerOptions {
  stepRunner: StepRunner;
  maxStepsPerTurn?: number;
}

/**
 * TurnRunner: Turn 실행 로직
 */
export interface TurnRunner {
  /**
   * Turn 실행
   *
   * @param agentInstance - AgentInstance
   * @param event - 입력 이벤트
   * @returns 완료된 Turn
   */
  run(agentInstance: AgentInstance, event: AgentEvent): Promise<Turn>;
}

/**
 * Step 계속 여부 판단
 */
function shouldContinueStepLoop(step: Step): boolean {
  // 1. Step 실패 시 중단
  if (step.status === 'failed') {
    return false;
  }

  // 2. LLM이 tool call 없이 응답 완료
  if (
    step.llmResult?.finishReason === 'stop' &&
    (!step.toolCalls || step.toolCalls.length === 0)
  ) {
    return false;
  }

  // 3. Tool call이 있으면 계속
  if (step.toolCalls && step.toolCalls.length > 0) {
    return true;
  }

  // 4. 기본: 중단
  return false;
}

/**
 * 에러 직렬화
 */
function serializeError(error: unknown): JsonObject {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }
  return { message: String(error) };
}

/**
 * TurnRunner 구현
 */
class TurnRunnerImpl implements TurnRunner {
  private readonly stepRunner: StepRunner;
  private readonly maxStepsPerTurn: number;

  constructor(options: TurnRunnerOptions) {
    this.stepRunner = options.stepRunner;
    this.maxStepsPerTurn = options.maxStepsPerTurn ?? 32;
  }

  async run(agentInstance: AgentInstance, event: AgentEvent): Promise<Turn> {
    // 1. Turn 생성
    const turn = createTurn(agentInstance, event);

    agentInstance.currentTurn = turn;
    agentInstance.status = 'processing';

    try {
      // 2. turn.pre 파이프라인 실행 (향후 구현)
      // await runPipeline('turn.pre', { turn });

      // 3. 초기 사용자 메시지 추가
      if (event.input) {
        turn.messages.push({
          role: 'user',
          content: event.input,
        });
      }

      // 4. Step 루프
      turn.status = 'running';

      while (turn.currentStepIndex < this.maxStepsPerTurn) {
        // 4.1 Step 실행
        const step = await this.stepRunner.run(turn);
        turn.steps.push(step);

        // 4.2 Step 결과 평가
        if (shouldContinueStepLoop(step)) {
          turn.currentStepIndex++;
          continue;
        }

        // 4.3 루프 종료 조건 충족
        break;
      }

      // 5. Step 제한 도달 확인
      if (turn.currentStepIndex >= this.maxStepsPerTurn) {
        turn.metadata['stepLimitReached'] = true;
      }

      // 6. turn.post 파이프라인 실행 (향후 구현)
      // await runPipeline('turn.post', { turn });

      // 7. Turn 완료
      turn.status = 'completed';
      turn.completedAt = new Date();
    } catch (error) {
      // 8. 에러 처리
      turn.status = 'failed';
      turn.completedAt = new Date();
      turn.metadata['error'] = serializeError(error);
    } finally {
      // 9. 정리
      agentInstance.currentTurn = null;
      agentInstance.completedTurnCount++;
      agentInstance.lastActivityAt = new Date();
      agentInstance.status = 'idle';
    }

    return turn;
  }
}

/**
 * TurnRunner 생성
 */
export function createTurnRunner(options: TurnRunnerOptions): TurnRunner {
  return new TurnRunnerImpl(options);
}
