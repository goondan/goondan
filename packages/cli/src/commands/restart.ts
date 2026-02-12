import { usageError } from '../errors.js';
import { getBooleanOption, getStringOption } from '../options.js';
import type { CommandHandler } from './context.js';

export const handleRestart: CommandHandler = async ({ parsed, deps, globals }) => {
  if (parsed.subcommand) {
    throw usageError('restart 명령은 하위 명령을 지원하지 않습니다.', 'gdn restart --agent <name> --fresh 형태를 사용하세요.');
  }

  if (parsed.rest.length > 0) {
    throw usageError('restart 명령은 위치 인자를 지원하지 않습니다.', '불필요한 인자를 제거하세요.');
  }

  const result = await deps.runtime.restart({
    agent: getStringOption(parsed, 'agent'),
    fresh: getBooleanOption(parsed, 'fresh'),
    stateRoot: globals.stateRoot,
  });

  deps.io.out(`Restart requested for: ${result.restarted.join(', ')}`);
  return 0;
};
