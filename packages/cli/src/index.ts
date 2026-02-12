import { createDefaultDependencies } from './services/defaults.js';
import { executeCli } from './router.js';
import type { CliDependencies, ExitCode } from './types.js';

export { parseArgv, gdnParser } from './parser.js';
export type { GdnArgs, GdnCommand } from './parser.js';
export { executeCli } from './router.js';
export type * from './types.js';

export async function runCli(argv: string[], deps?: CliDependencies): Promise<ExitCode> {
  const runtimeDeps = deps ?? createDefaultDependencies();
  return executeCli(argv, runtimeDeps);
}
