import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import { EvalRunner, saveReport, printReport } from '@goondan/eval';
import type { EvalScenario, EvalReport } from '@goondan/eval';

import { greeting } from './scenarios/brain-persona/01-greeting.js';
import { researchTask } from './scenarios/brain-persona/02-research-task.js';
import { creativeWriting } from './scenarios/brain-persona/03-creative-writing.js';
import { toolUsage } from './scenarios/brain-persona/04-tool-usage.js';
import { delegation } from './scenarios/brain-persona/05-delegation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROVIDER = process.env['EVAL_PROVIDER'] ?? 'anthropic';
const SAMPLE_DIR = path.resolve(__dirname, '../samples/brain-persona');
const RESULTS_DIR = path.resolve(__dirname, 'results');

const MIN_SCORE = 3;

const scenarios: readonly EvalScenario[] = [
  greeting,
  researchTask,
  creativeWriting,
  toolUsage,
  delegation,
];

describe(`brain-persona E2E (${PROVIDER})`, () => {
  let report: EvalReport | undefined;

  afterAll(async () => {
    if (report) {
      printReport(report);
      await saveReport(report, RESULTS_DIR);
    }
  });

  it('should run all scenarios and produce a report', async () => {
    const runner = new EvalRunner({
      provider: PROVIDER,
      sampleDir: SAMPLE_DIR,
    });

    report = await runner.runScenarios(scenarios);

    expect(report.scenarios).toHaveLength(scenarios.length);
    expect(report.provider).toBe(PROVIDER);
  });

  it('each scenario should score at least the minimum threshold', () => {
    expect(report).toBeDefined();
    if (!report) return;

    for (const result of report.scenarios) {
      expect(
        result.score,
        `Scenario "${result.scenarioName}" scored ${result.score}, minimum is ${MIN_SCORE}`,
      ).toBeGreaterThanOrEqual(MIN_SCORE);
    }
  });
});
