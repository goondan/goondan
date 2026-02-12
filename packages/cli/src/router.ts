import { getMainHelp } from './help.js';
import { CliError, toCliError, usageError } from './errors.js';
import { formatCliError } from './formatter.js';
import { getGlobalOptions } from './options.js';
import { parseArguments } from './parser.js';
import type { CliDependencies, ExitCode } from './types.js';
import { handleDoctor } from './commands/doctor.js';
import { handleInstance } from './commands/instance.js';
import { handlePackage } from './commands/package.js';
import { handleRestart } from './commands/restart.js';
import { handleRun } from './commands/run.js';
import { handleValidate } from './commands/validate.js';

export async function executeCli(argv: string[], deps: CliDependencies): Promise<ExitCode> {
  const parsed = parseArguments(argv);
  const globals = getGlobalOptions(parsed);

  if (parsed.globalOptions['version'] === true) {
    deps.io.out(deps.version);
    return 0;
  }

  if (parsed.globalOptions['help'] === true) {
    deps.io.out(getMainHelp());
    return 0;
  }

  const command = parsed.command;
  if (!command) {
    deps.io.out(getMainHelp());
    return 0;
  }

  try {
    if (command === 'run') {
      return await handleRun({ parsed, deps, globals });
    }

    if (command === 'restart') {
      return await handleRestart({ parsed, deps, globals });
    }

    if (command === 'validate') {
      return await handleValidate({ parsed, deps, globals });
    }

    if (command === 'instance') {
      return await handleInstance({ parsed, deps, globals });
    }

    if (command === 'package') {
      return await handlePackage({ parsed, deps, globals });
    }

    if (command === 'doctor') {
      return await handleDoctor({ parsed, deps, globals });
    }

    throw usageError(`지원하지 않는 명령어입니다: ${command}`, 'gdn --help로 명령 목록을 확인하세요.');
  } catch (error) {
    const cliError = normalizeCommandError(error);
    deps.io.err(formatCliError(cliError, globals.json));
    return cliError.exitCode;
  }
}

function normalizeCommandError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  return toCliError(error);
}
