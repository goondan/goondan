#!/usr/bin/env node

import { run } from '@optique/run';
import { message } from '@optique/core/message';
import { gdnParser } from './parser.js';
import { createDefaultDependencies } from './services/defaults.js';
import { CliError, toCliError } from './errors.js';
import { formatCliError } from './formatter.js';
import { handleInit } from './commands/init.js';
import { handleRun } from './commands/run.js';
import { handleRestart } from './commands/restart.js';
import { handleValidate } from './commands/validate.js';
import { handleInstanceList, handleInstanceDelete, handleInstanceRestart } from './commands/instance.js';
import { handleInstanceInteractive } from './commands/instance-interactive.js';
import type { InstanceInteractiveGlobals } from './commands/instance-interactive.js';
import { handlePackageAdd, handlePackageInstall, handlePackagePublish, handlePackageUpdate } from './commands/package.js';
import { handleDoctor } from './commands/doctor.js';
import { handleLogs } from './commands/logs.js';
import { handleStudio } from './commands/studio.js';

function isBareInstanceArgv(argv: readonly string[]): boolean {
  const nonGlobalArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if ((arg === '-c' || arg === '--config' || arg === '--state-root') && i + 1 < argv.length) {
      i++;
      continue;
    }
    if (arg === '--json' || arg === '--no-color' || arg === '-v' || arg === '--verbose' || arg === '-q' || arg === '--quiet') {
      continue;
    }
    nonGlobalArgs.push(arg);
  }
  return nonGlobalArgs.length === 1 && nonGlobalArgs[0] === 'instance';
}

function extractGlobalsFromArgv(argv: readonly string[]): InstanceInteractiveGlobals {
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
      const val = argv[++i];
      if (val !== undefined) globals.config = val;
    } else if (arg === '--state-root' && i + 1 < argv.length) {
      const val = argv[++i];
      if (val !== undefined) globals.stateRoot = val;
    }
  }
  return globals;
}

async function main(): Promise<void> {
  const deps = createDefaultDependencies();
  const argv = process.argv.slice(2);

  // bare "gdn instance" → interactive mode (run() would exit on parse error)
  if (isBareInstanceArgv(argv)) {
    const globals = extractGlobalsFromArgv(argv);
    const isJson = globals.json ?? false;
    try {
      const exitCode = await handleInstanceInteractive({
        cmd: { action: 'instance.interactive' as const },
        deps,
        globals,
      });
      process.exitCode = exitCode;
    } catch (error) {
      const cliError = error instanceof CliError ? error : toCliError(error);
      deps.io.err(formatCliError(cliError, isJson));
      process.exitCode = cliError.exitCode;
    }
    return;
  }

  // run()이 --help, --version, parse error를 자동 처리하고 process.exit
  const args = run(gdnParser, {
    programName: 'gdn',
    help: 'both',
    version: deps.version,
    brief: message`Goondan CLI — Kubernetes for Agent Swarm`,
    aboveError: 'usage',
    showDefault: true,
    completion: 'both',
  });

  const { command: cmd, ...globals } = args;
  const isJson = globals.json ?? false;

  try {
    let exitCode: number;
    switch (cmd.action) {
      case 'init':
        exitCode = await handleInit({ cmd, deps, globals });
        break;
      case 'run':
        exitCode = await handleRun({ cmd, deps, globals });
        break;
      case 'restart':
        exitCode = await handleRestart({ cmd, deps, globals });
        break;
      case 'validate':
        exitCode = await handleValidate({ cmd, deps, globals });
        break;
      case 'instance.list':
        exitCode = await handleInstanceList({ cmd, deps, globals });
        break;
      case 'instance.delete':
        exitCode = await handleInstanceDelete({ cmd, deps, globals });
        break;
      case 'instance.restart':
        exitCode = await handleInstanceRestart({ cmd, deps, globals });
        break;
      case 'package.add':
        exitCode = await handlePackageAdd({ cmd, deps, globals });
        break;
      case 'package.install':
        exitCode = await handlePackageInstall({ cmd, deps, globals });
        break;
      case 'package.update':
        exitCode = await handlePackageUpdate({ cmd, deps, globals });
        break;
      case 'package.publish':
        exitCode = await handlePackagePublish({ cmd, deps, globals });
        break;
      case 'doctor':
        exitCode = await handleDoctor({ cmd, deps, globals });
        break;
      case 'logs':
        exitCode = await handleLogs({ cmd, deps, globals });
        break;
      case 'studio':
        exitCode = await handleStudio({ cmd, deps, globals });
        break;
      default:
        exitCode = 2;
    }
    process.exitCode = exitCode;
  } catch (error) {
    const cliError = error instanceof CliError ? error : toCliError(error);
    deps.io.err(formatCliError(cliError, isJson));
    process.exitCode = cliError.exitCode;
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
