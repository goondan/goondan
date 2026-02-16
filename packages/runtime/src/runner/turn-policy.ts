export interface StepLimitResponseInput {
  maxSteps: number;
  requiredToolNames: string[];
  calledToolNames: ReadonlySet<string>;
  lastText: string;
}

export function buildStepLimitResponse(input: StepLimitResponseInput): string {
  const trimmedLastText = input.lastText.trim();
  const missingRequiredTools = input.requiredToolNames.filter((name) => !input.calledToolNames.has(name));
  if (missingRequiredTools.length === 0) {
    return trimmedLastText.length > 0 ? trimmedLastText : '최대 step에 도달하여 응답을 마무리했습니다.';
  }

  const summary = `maxStepsPerTurn(${input.maxSteps})에 도달하여 종료했습니다. requiredTools 미충족: ${missingRequiredTools.join(', ')}`;
  if (trimmedLastText.length === 0) {
    return summary;
  }

  return `${trimmedLastText}\n\n${summary}`;
}
