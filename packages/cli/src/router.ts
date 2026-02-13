import { CliError, toCliError, usageError } from './errors.js';
import { formatCliError } from './formatter.js';
import { parseArgv, formatParseError } from './parser.js';
import type { GdnArgs } from './parser.js';
import type { CliDependencies, ExitCode } from './types.js';
import { handleDoctor } from './commands/doctor.js';
import { handleInit } from './commands/init.js';
import { handleInstanceList, handleInstanceDelete, handleInstanceRestart } from './commands/instance.js';
import { handleInstanceInteractive } from './commands/instance-interactive.js';
import type { InstanceInteractiveGlobals } from './commands/instance-interactive.js';
import { handleLogs } from './commands/logs.js';
import { handlePackageAdd, handlePackageInstall, handlePackagePublish } from './commands/package.js';
import { handleRestart } from './commands/restart.js';
import { handleRun } from './commands/run.js';
import { handleValidate } from './commands/validate.js';

function extractGlobals(argv: string[]): InstanceInteractiveGlobals {
  const globals: InstanceInteractiveGlobals = {
    config: 'goondan.yaml',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') globals.json = true;
    else if (arg === '--no-color') globals.noColor = true;
    else if (arg === '-v' || arg === '--verbose') globals.verbose = true;
    else if (arg === '-q' || arg === '--quiet') globals.quiet = true;
    else if ((arg === '-c' || arg === '--config') && i + 1 < argv.length) {
      const next = argv[++i];
      if (next !== undefined) globals.config = next;
    } else if (arg === '--state-root' && i + 1 < argv.length) {
      const val = argv[++i];
      if (val !== undefined) globals.stateRoot = val;
    }
  }
  return globals;
}

function isBareInstanceCommand(argv: string[]): boolean {
  const nonGlobalArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    // Skip global options with values
    if ((arg === '-c' || arg === '--config' || arg === '--state-root') && i + 1 < argv.length) {
      i++;
      continue;
    }
    // Skip global flags
    if (arg === '--json' || arg === '--no-color' || arg === '-v' || arg === '--verbose' || arg === '-q' || arg === '--quiet') {
      continue;
    }
    nonGlobalArgs.push(arg);
  }
  return nonGlobalArgs.length === 1 && nonGlobalArgs[0] === 'instance';
}

export async function executeCli(argv: string[], deps: CliDependencies): Promise<ExitCode> {
  const result = parseArgv(argv);

  if (!result.success) {
    // bare "instance" (with optional global flags) → interactive mode
    if (isBareInstanceCommand(argv)) {
      const globals = extractGlobals(argv);
      const isJson = globals.json ?? false;
      try {
        return await handleInstanceInteractive({
          cmd: { action: 'instance.interactive' as const },
          deps,
          globals,
        });
      } catch (error) {
        const cliError = normalizeCommandError(error);
        deps.io.err(formatCliError(cliError, isJson));
        return cliError.exitCode;
      }
    }

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
    case 'init':
      return handleInit({ cmd, deps, globals });
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
    case 'instance.restart':
      return handleInstanceRestart({ cmd, deps, globals });
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
