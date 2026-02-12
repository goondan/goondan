import { formatValidationResult } from '../formatter.js';
import { validateError } from '../errors.js';
import { getBooleanOption, getFormatOption } from '../options.js';
import type { CommandHandler } from './context.js';

export const handleValidate: CommandHandler = async ({ parsed, deps, globals }) => {
  const target = parsed.subcommand ?? '.';
  if (parsed.rest.length > 0) {
    throw validateError('validate 명령의 위치 인자가 너무 많습니다.', 'gdn validate [path] 형태를 사용하세요.');
  }

  const strict = getBooleanOption(parsed, 'strict');
  const fix = getBooleanOption(parsed, 'fix');
  const format = getFormatOption(parsed, 'text');

  const result = await deps.validator.validate(target, strict, fix);

  deps.io.out(formatValidationResult(result, format, target));

  if (!result.valid) {
    throw validateError('Bundle 검증이 실패했습니다.', '출력된 오류 코드를 기준으로 구성을 수정하세요.');
  }

  if (strict && result.warnings.length > 0) {
    throw validateError('strict 모드에서 경고가 발견되었습니다.', '경고를 모두 해결하거나 --strict 옵션을 제거하세요.');
  }

  if (globals.json && format !== 'json') {
    deps.io.out('Tip: --json 플래그와 함께 --format json을 사용하면 기계 처리에 적합합니다.');
  }

  return 0;
};
