export interface StepLimitResponseInput {
  maxSteps: number;
  requiredToolNames: string[];
  calledToolNames: ReadonlySet<string>;
  lastText: string;
}

function hasSatisfiedRequiredTools(requiredToolNames: string[], calledToolNames: ReadonlySet<string>): boolean {
  if (requiredToolNames.length === 0) {
    return true;
  }
  return requiredToolNames.some((name) => calledToolNames.has(name));
}

export function buildStepLimitResponse(input: StepLimitResponseInput): string {
  const trimmedLastText = input.lastText.trim();
  const requiredToolsSatisfied = hasSatisfiedRequiredTools(input.requiredToolNames, input.calledToolNames);
  if (requiredToolsSatisfied) {
    return trimmedLastText.length > 0 ? trimmedLastText : '최대 step에 도달하여 응답을 마무리했습니다.';
  }

  const summary = `maxStepsPerTurn(${input.maxSteps})에 도달하여 종료했습니다. requiredTools(최소 1개 필요) 미충족: ${input.requiredToolNames.join(', ')}`;
  if (trimmedLastText.length === 0) {
    return summary;
  }

  return `${trimmedLastText}\n\n${summary}`;
}
