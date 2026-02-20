import { generateText, type LanguageModel } from 'ai';

import type { Deduction, EvalScenario } from './types.js';

/** judge LLM 응답에서 파싱된 결과 */
export interface JudgeVerdict {
  readonly score: number;
  readonly deductions: readonly Deduction[];
}

const SYSTEM_PROMPT = `You are an expert AI system evaluator. Your job is to evaluate an AI agent's output against expected behavior and scoring criteria.

You MUST respond with a valid JSON object in this exact format:
{
  "score": <number 0-10>,
  "deductions": [
    {
      "criterion": "<which scoring criterion was not met>",
      "pointsDeducted": <number>,
      "reason": "<explanation>"
    }
  ]
}

Scoring rules:
- Start at 10 points (perfect score)
- Deduct points for each unmet criterion
- Score cannot go below 0
- Be fair but rigorous — only deduct when the output clearly fails a criterion
- Empty deductions array means a perfect score of 10`;

function buildUserPrompt(
  scenario: EvalScenario,
  actualOutput: string,
  intermediateOutputs: readonly string[] | undefined,
): string {
  const parts: string[] = [
    '## Expected Behavior',
    scenario.expectedBehavior,
    '',
    '## Scoring Criteria',
    ...scenario.scoringCriteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '## Actual Output',
    actualOutput,
  ];

  if (intermediateOutputs && intermediateOutputs.length > 0) {
    parts.push('', '## Intermediate Outputs (Runtime Events)');
    for (const output of intermediateOutputs) {
      parts.push(output);
    }
  }

  return parts.join('\n');
}

// --- Type guards for LLM response parsing ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDeductionRecord(value: unknown): value is Deduction {
  if (!isRecord(value)) return false;
  return (
    typeof value['criterion'] === 'string' &&
    typeof value['pointsDeducted'] === 'number' &&
    typeof value['reason'] === 'string'
  );
}

function isJudgeResponse(
  value: unknown,
): value is { score: number; deductions: unknown[] } {
  if (!isRecord(value)) return false;
  if (typeof value['score'] !== 'number') return false;
  if (!Array.isArray(value['deductions'])) return false;
  return true;
}

/**
 * JSON 문자열에서 judge verdict를 파싱한다.
 * LLM이 markdown code fence로 감싸는 경우도 처리한다.
 */
function parseJudgeResponse(text: string): JudgeVerdict {
  // markdown code fence 제거
  const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const captured = jsonMatch?.[1];
  const jsonStr = captured !== undefined ? captured.trim() : text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `Failed to parse judge response as JSON. Raw response:\n${text}`,
    );
  }

  if (!isJudgeResponse(parsed)) {
    throw new Error(
      `Judge response does not match expected format. Parsed:\n${JSON.stringify(parsed, null, 2)}`,
    );
  }

  const score = Math.max(0, Math.min(10, Math.round(parsed.score)));
  const deductions: Deduction[] = [];

  for (const item of parsed.deductions) {
    if (isDeductionRecord(item)) {
      deductions.push({
        criterion: item.criterion,
        pointsDeducted: item.pointsDeducted,
        reason: item.reason,
      });
    }
  }

  return { score, deductions };
}

/**
 * LLM judge로 시나리오 출력을 평가한다.
 */
export async function evaluateWithLlm(
  scenario: EvalScenario,
  actualOutput: string,
  intermediateOutputs: readonly string[] | undefined,
  judgeModel: LanguageModel,
): Promise<JudgeVerdict> {
  const userPrompt = buildUserPrompt(
    scenario,
    actualOutput,
    intermediateOutputs,
  );

  const result = await generateText({
    model: judgeModel,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0,
    maxOutputTokens: 1024,
  });

  return parseJudgeResponse(result.text);
}
