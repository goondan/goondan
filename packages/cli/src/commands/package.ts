import { usageError } from '../errors.js';
import { getAccessOption, getBooleanOption, getStringOption } from '../options.js';
import type { CommandHandler } from './context.js';

export const handlePackage: CommandHandler = async ({ parsed, deps, globals }) => {
  const sub = parsed.subcommand;
  if (!sub) {
    throw usageError('package 하위 명령이 필요합니다.', 'gdn package add|install|publish 를 사용하세요.');
  }

  const bundlePath = globals.configPath;

  if (sub === 'add') {
    const ref = parsed.rest[0];
    if (!ref) {
      throw usageError('package add에는 ref가 필요합니다.', '예: gdn package add @goondan/base');
    }

    const registry = getStringOption(parsed, 'registry');
    const result = await deps.packages.addDependency({
      ref,
      dev: getBooleanOption(parsed, 'dev'),
      exact: getBooleanOption(parsed, 'exact'),
      registry,
      bundlePath,
      stateRoot: globals.stateRoot,
    });

    const installResult = await deps.packages.installDependencies({
      frozenLockfile: false,
      bundlePath,
      registry,
      stateRoot: globals.stateRoot,
    });

    deps.io.out(
      `Dependency ${result.added ? 'added' : 'already exists'}: ${result.ref}` +
        `${result.resolvedVersion ? ` (${result.resolvedVersion})` : ''}`,
    );
    deps.io.out(`Manifest: ${result.manifestPath}`);
    deps.io.out(`Installed dependencies: ${installResult.installed}`);
    return 0;
  }

  if (sub === 'install') {
    const result = await deps.packages.installDependencies({
      frozenLockfile: getBooleanOption(parsed, 'frozen-lockfile'),
      bundlePath,
      registry: getStringOption(parsed, 'registry'),
      stateRoot: globals.stateRoot,
    });

    deps.io.out(`Installed dependencies: ${result.installed}`);
    if (result.lockfilePath) {
      deps.io.out(`Lockfile: ${result.lockfilePath}`);
    }
    return 0;
  }

  if (sub === 'publish') {
    const publishPath = parsed.rest[0] ?? '.';
    const tag = getStringOption(parsed, 'tag') ?? 'latest';
    const access = getAccessOption(parsed);

    const result = await deps.packages.publishPackage({
      path: publishPath,
      tag,
      access,
      dryRun: getBooleanOption(parsed, 'dry-run'),
      registry: getStringOption(parsed, 'registry'),
      stateRoot: globals.stateRoot,
    });

    deps.io.out(
      `${result.dryRun ? 'Dry-run publish checked' : 'Published'} ${result.packageName}@${result.version}` +
        ` tag=${result.tag} registry=${result.registryUrl}`,
    );
    return 0;
  }

  throw usageError(`지원하지 않는 package 하위 명령입니다: ${sub}`, 'add, install, publish 중 하나를 사용하세요.');
};
