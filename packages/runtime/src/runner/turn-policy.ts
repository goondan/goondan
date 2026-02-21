export interface StepLimitResponseInput {
  maxSteps: number;
  lastText: string;
}

export function buildStepLimitResponse(input: StepLimitResponseInput): string {
  const trimmedLastText = input.lastText.trim();
  return trimmedLastText.length > 0
    ? trimmedLastText
    : `최대 step(${input.maxSteps})에 도달하여 응답을 마무리했습니다.`;
}
