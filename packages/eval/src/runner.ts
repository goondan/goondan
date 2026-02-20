import type { LanguageModel } from 'ai';

import { runScenario } from './gdn-harness.js';
import { evaluateWithLlm } from './judge.js';
import { createJudgeModel, getProviderConfig } from './provider.js';
import type {
  EvalReport,
  EvalResult,
  EvalScenario,
  ProviderConfig,
} from './types.js';

export interface EvalRunnerOptions {
  /** 프로바이더 이름 (anthropic, openai, google) */
  provider: string;
  /** 샘플 디렉토리 경로 */
  sampleDir: string;
  /** judge에 사용할 프로바이더 (기본: provider와 동일) */
  judgeProvider?: string;
}

export class EvalRunner {
  private readonly providerConfig: ProviderConfig;
  private readonly judgeModel: LanguageModel;
  private readonly sampleDir: string;

  constructor(options: EvalRunnerOptions) {
    this.providerConfig = getProviderConfig(options.provider);
    this.sampleDir = options.sampleDir;
    this.judgeModel = createJudgeModel(options.judgeProvider ?? options.provider);
  }

  /**
   * 시나리오들을 순차 실행하고 결과를 집계한다.
   * 순차 실행 이유: gdn 프로세스 충돌 방지
   */
  async runScenarios(scenarios: readonly EvalScenario[]): Promise<EvalReport> {
    const startTime = Date.now();
    const results: EvalResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runSingleScenario(scenario);
      results.push(result);
    }

    const totalDurationMs = Date.now() - startTime;
    const averageScore =
      results.length > 0
        ? results.reduce((sum, r) => sum + r.score, 0) / results.length
        : 0;

    const sampleName = this.sampleDir.split('/').pop() ?? 'unknown';

    return {
      provider: this.providerConfig.name,
      sampleName,
      scenarios: results,
      averageScore: Math.round(averageScore * 100) / 100,
      totalDurationMs,
      timestamp: new Date().toISOString(),
    };
  }

  private async runSingleScenario(
    scenario: EvalScenario,
  ): Promise<EvalResult> {
    const timeoutMs = scenario.timeoutMs ?? 60_000;

    try {
      const execution = await runScenario(scenario.input, {
        sampleDir: this.sampleDir,
        providerConfig: this.providerConfig,
        timeoutMs,
      });

      const intermediateOutputs = scenario.checkIntermediateOutputs
        ? execution.runtimeEvents.map((e) => JSON.stringify(e))
        : undefined;

      const verdict = await evaluateWithLlm(
        scenario,
        execution.response,
        intermediateOutputs,
        this.judgeModel,
      );

      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        provider: this.providerConfig.name,
        modelTier: 'default',
        score: verdict.score,
        deductions: verdict.deductions,
        actualOutput: execution.response,
        intermediateOutputs,
        durationMs: execution.durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        provider: this.providerConfig.name,
        modelTier: 'default',
        score: 0,
        deductions: [
          {
            criterion: 'execution',
            pointsDeducted: 10,
            reason: `Execution failed: ${message}`,
          },
        ],
        actualOutput: `ERROR: ${message}`,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
