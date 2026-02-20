/** 프로바이더별 모델 계층 */
export type ModelTier = 'fast' | 'default';

/** 프로바이더 설정 */
export interface ProviderConfig {
  readonly name: string;
  readonly apiKeyEnv: string;
  readonly models: Readonly<Record<ModelTier, string>>;
}

/** Eval 시나리오 정의 */
export interface EvalScenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** 시스템에 보낼 입력 메시지 */
  readonly input: string;
  /** 기대하는 시스템 행동 (비정형, judge에게 전달) */
  readonly expectedBehavior: string;
  /** 채점 기준 (rubric) */
  readonly scoringCriteria: readonly string[];
  /** 중간 출력(runtime events) 검증 여부 */
  readonly checkIntermediateOutputs?: boolean;
  /** 타임아웃 (ms) */
  readonly timeoutMs?: number;
}

/** 감점 항목 */
export interface Deduction {
  readonly criterion: string;
  readonly pointsDeducted: number;
  readonly reason: string;
}

/** 단일 시나리오 결과 */
export interface EvalResult {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly provider: string;
  readonly modelTier: string;
  readonly score: number; // 0-10
  readonly deductions: readonly Deduction[];
  readonly actualOutput: string;
  readonly intermediateOutputs?: readonly string[];
  readonly durationMs: number;
  readonly timestamp: string;
}

/** 전체 eval 보고서 */
export interface EvalReport {
  readonly provider: string;
  readonly sampleName: string;
  readonly scenarios: readonly EvalResult[];
  readonly averageScore: number;
  readonly totalDurationMs: number;
  readonly timestamp: string;
}

/** gdn harness로부터의 실행 결과 */
export interface GdnExecutionResult {
  readonly response: string;
  readonly runtimeEvents: readonly RuntimeEventRecord[];
  readonly exitCode: number;
  readonly durationMs: number;
}

/** runtime-events.jsonl의 레코드 */
export interface RuntimeEventRecord {
  readonly type: string;
  readonly agentName?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  readonly duration?: number;
  readonly stepCount?: number;
  readonly toolCallCount?: number;
  readonly [key: string]: unknown;
}
