import { formatValidationResult } from '../formatter.js';
import { validateError } from '../errors.js';
import type { CliDependencies, ExitCode } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type ValidateCommand = Extract<GdnCommand, { action: 'validate' }>;

interface ValidateContext {
  cmd: ValidateCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handleValidate({ cmd, deps, globals }: ValidateContext): Promise<ExitCode> {
  const target = cmd.target ?? '.';
  const strict = cmd.strict ?? false;
  const fix = cmd.fix ?? false;
  const format = cmd.format;

  const result = await deps.validator.validate(target, strict, fix);

  deps.io.out(formatValidationResult(result, format, target));

  if (!result.valid) {
    throw validateError('Bundle 검증이 실패했습니다.', '출력된 오류 코드를 기준으로 구성을 수정하세요.');
  }

  if (strict && result.warnings.length > 0) {
    throw validateError('strict 모드에서 경고가 발견되었습니다.', '경고를 모두 해결하거나 --strict 옵션을 제거하세요.');
  }

  const isJson = globals.json ?? false;
  if (isJson && format !== 'json') {
    deps.io.out('Tip: --json 플래그와 함께 --format json을 사용하면 기계 처리에 적합합니다.');
  }

  return 0;
}
