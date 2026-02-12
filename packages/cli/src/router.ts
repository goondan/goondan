import { CliError, toCliError, usageError } from './errors.js';
import { formatCliError } from './formatter.js';
import { parseArgv, formatParseError } from './parser.js';
import type { GdnArgs } from './parser.js';
import type { CliDependencies, ExitCode } from './types.js';
import { handleDoctor } from './commands/doctor.js';
import { handleInstanceList, handleInstanceDelete } from './commands/instance.js';
import { handleLogs } from './commands/logs.js';
import { handlePackageAdd, handlePackageInstall, handlePackagePublish } from './commands/package.js';
import { handleRestart } from './commands/restart.js';
import { handleRun } from './commands/run.js';
import { handleValidate } from './commands/validate.js';

export async function executeCli(argv: string[], deps: CliDependencies): Promise<ExitCode> {
  const result = parseArgv(argv);

  if (!result.success) {
    deps.io.err(formatParseError(result));
    return 2;
  }

  const args = result.value;
  const { command: cmd, ...globals } = args;
  const isJson = globals.json ?? false;

  try {
    return await dispatchCommand(cmd, deps, globals);
  } catch (error) {
    const cliError = normalizeCommandError(error);
    deps.io.err(formatCliError(cliError, isJson));
    return cliError.exitCode;
  }
}

async function dispatchCommand(
  cmd: GdnArgs['command'],
  deps: CliDependencies,
  globals: Omit<GdnArgs, 'command'>,
): Promise<ExitCode> {
  switch (cmd.action) {
    case 'run':
      return handleRun({ cmd, deps, globals });
    case 'restart':
      return handleRestart({ cmd, deps, globals });
    case 'validate':
      return handleValidate({ cmd, deps, globals });
    case 'instance.list':
      return handleInstanceList({ cmd, deps, globals });
    case 'instance.delete':
      return handleInstanceDelete({ cmd, deps, globals });
    case 'package.add':
      return handlePackageAdd({ cmd, deps, globals });
    case 'package.install':
      return handlePackageInstall({ cmd, deps, globals });
    case 'package.publish':
      return handlePackagePublish({ cmd, deps, globals });
    case 'doctor':
      return handleDoctor({ cmd, deps, globals });
    case 'logs':
      return handleLogs({ cmd, deps, globals });
    default:
      throw usageError('지원하지 않는 명령어입니다.', 'gdn --help로 명령 목록을 확인하세요.');
  }
}

function normalizeCommandError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  return toCliError(error);
}
