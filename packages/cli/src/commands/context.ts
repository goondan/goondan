import type { CliDependencies, ExitCode, ParsedArguments } from '../types.js';
import type { GlobalRuntimeOptions } from '../options.js';

export interface CommandContext {
  parsed: ParsedArguments;
  deps: CliDependencies;
  globals: GlobalRuntimeOptions;
}

export type CommandHandler = (context: CommandContext) => Promise<ExitCode>;
