#!/usr/bin/env node

import { run } from '@optique/run';
import { message } from '@optique/core/message';
import { gdnParser } from './parser.js';
import { createDefaultDependencies } from './services/defaults.js';
import { CliError, toCliError } from './errors.js';
import { formatCliError } from './formatter.js';
import { handleRun } from './commands/run.js';
import { handleRestart } from './commands/restart.js';
import { handleValidate } from './commands/validate.js';
import { handleInstanceList, handleInstanceDelete } from './commands/instance.js';
import { handlePackageAdd, handlePackageInstall, handlePackagePublish } from './commands/package.js';
import { handleDoctor } from './commands/doctor.js';
import { handleLogs } from './commands/logs.js';

async function main(): Promise<void> {
  const deps = createDefaultDependencies();

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
      case 'package.add':
        exitCode = await handlePackageAdd({ cmd, deps, globals });
        break;
      case 'package.install':
        exitCode = await handlePackageInstall({ cmd, deps, globals });
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
