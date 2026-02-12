import { formatInstanceList } from '../formatter.js';
import { usageError } from '../errors.js';
import { getBooleanOption, getNumberOption, getStringOption } from '../options.js';
import type { CommandHandler } from './context.js';

export const handleInstance: CommandHandler = async ({ parsed, deps, globals }) => {
  const sub = parsed.subcommand;
  if (!sub) {
    throw usageError('instance 하위 명령이 필요합니다.', 'gdn instance list 또는 gdn instance delete <key>를 사용하세요.');
  }

  if (sub === 'list') {
    const items = await deps.instances.list({
      agent: getStringOption(parsed, 'agent'),
      limit: getNumberOption(parsed, 'limit', 20),
      all: getBooleanOption(parsed, 'all'),
      stateRoot: globals.stateRoot,
    });

    deps.io.out(formatInstanceList(items));
    return 0;
  }

  if (sub === 'delete') {
    const key = parsed.rest[0];
    if (!key) {
      throw usageError('instance delete에는 key가 필요합니다.', 'gdn instance delete <key>를 사용하세요.');
    }

    const deleted = await deps.instances.delete({
      key,
      force: getBooleanOption(parsed, 'force'),
      stateRoot: globals.stateRoot,
    });

    if (deleted) {
      deps.io.out(`Instance deleted: ${key}`);
    } else {
      deps.io.out(`Instance not found: ${key}`);
    }

    return 0;
  }

  throw usageError(`지원하지 않는 instance 하위 명령입니다: ${sub}`, 'list 또는 delete를 사용하세요.');
};
