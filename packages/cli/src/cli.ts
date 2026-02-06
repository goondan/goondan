/**
 * Main CLI setup using Commander.js
 *
 * Creates the main program with global options and registers all command modules
 * @see /docs/specs/cli.md
 */
import { Command, Option } from "commander";
import { configureLogger } from "./utils/logger.js";
import { loadConfig, type GoondanConfig } from "./utils/config.js";
import { createInitCommand } from "./commands/init.js";
import { createRunCommand } from "./commands/run.js";
import { createValidateCommand } from "./commands/validate.js";
import { createPackageCommand } from "./commands/package/index.js";
import { createInstanceCommand } from "./commands/instance/index.js";
import { createLogsCommand } from "./commands/logs.js";
import { createConfigCommand } from "./commands/config.js";
import { createCompletionCommand } from "./commands/completion.js";
import { createDoctorCommand } from "./commands/doctor.js";

/**
 * CLI version - should match package.json
 */
export const CLI_VERSION = "0.0.1";

/**
 * CLI name
 */
export const CLI_NAME = "gdn";

/**
 * Global CLI options
 */
export interface GlobalOptions {
  /** Enable verbose output */
  verbose?: boolean;
  /** Minimize output */
  quiet?: boolean;
  /** Configuration file path */
  config?: string;
  /** System state root path */
  stateRoot?: string;
  /** Disable color output */
  color?: boolean;
  /** Output in JSON format */
  json?: boolean;
}

/**
 * Extended command with typed options
 */
export type ProgramCommand = Command & {
  opts(): GlobalOptions;
};

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  /** Global options */
  globalOptions: GlobalOptions;
  /** Loaded configuration */
  config: GoondanConfig;
  /** Program instance */
  program: ProgramCommand;
}

/**
 * Create the main CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description("Goondan - Agent Swarm Orchestrator CLI")
    .version(CLI_VERSION, "-V, --version", "Output the version number")
    .helpOption("-h, --help", "Display help for command")
    .addHelpText(
      "after",
      `
Examples:
  $ gdn init                    Create a new Swarm project
  $ gdn run                     Run the default Swarm interactively
  $ gdn run -s my-swarm         Run a specific Swarm
  $ gdn validate                Validate Bundle configuration
  $ gdn doctor                  Check environment readiness

Documentation: https://github.com/goondan/goondan`
    );

  // Global options
  program
    .addOption(
      new Option("-v, --verbose", "Enable verbose output").default(false)
    )
    .addOption(
      new Option("-q, --quiet", "Minimize output (only errors)").default(false)
    )
    .addOption(
      new Option("-c, --config <path>", "Configuration file path")
    )
    .addOption(
      new Option("--state-root <path>", "System state root path")
    )
    .addOption(
      new Option("--no-color", "Disable color output")
    )
    .addOption(
      new Option("--json", "Output in JSON format").default(false)
    );

  // Register implemented commands
  program.addCommand(createInitCommand());
  program.addCommand(createRunCommand());
  program.addCommand(createValidateCommand());
  program.addCommand(createPackageCommand());
  program.addCommand(createInstanceCommand());
  program.addCommand(createLogsCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createCompletionCommand());
  program.addCommand(createDoctorCommand());

  return program;
}

/**
 * Setup global options before command execution
 */
async function setupGlobalOptions(
  command: Command
): Promise<CommandContext> {
  const opts = command.optsWithGlobals<GlobalOptions>();

  // Configure logger based on global options
  configureLogger({
    verbose: opts.verbose,
    quiet: opts.quiet,
    noColor: opts.color === false,
    json: opts.json,
  });

  // Load configuration
  const config = await loadConfig({
    configPath: opts.config,
    cliStateRoot: opts.stateRoot,
  });

  return {
    globalOptions: opts,
    config,
    program: command as ProgramCommand,
  };
}

// Export for use by commands that need context
export { setupGlobalOptions };

/**
 * Exit codes
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_ARGUMENT: 2,
  CONFIG_ERROR: 3,
  VALIDATION_ERROR: 4,
  NETWORK_ERROR: 5,
  AUTH_ERROR: 6,
  USER_INTERRUPT: 130,
} as const;

/**
 * Run the CLI program
 */
export async function run(args?: string[]): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(args ?? process.argv);
  } catch (err) {
    // Handle specific error types
    if (err instanceof Error) {
      const { error: logError } = await import("./utils/logger.js");
      logError(err.message);

      // Exit with appropriate code
      if (err.message.includes("Invalid argument")) {
        process.exitCode = EXIT_CODES.INVALID_ARGUMENT;
      } else if (err.message.includes("configuration")) {
        process.exitCode = EXIT_CODES.CONFIG_ERROR;
      } else if (err.message.includes("validation")) {
        process.exitCode = EXIT_CODES.VALIDATION_ERROR;
      } else if (err.message.includes("network") || err.message.includes("fetch")) {
        process.exitCode = EXIT_CODES.NETWORK_ERROR;
      } else if (err.message.includes("auth") || err.message.includes("unauthorized")) {
        process.exitCode = EXIT_CODES.AUTH_ERROR;
      } else {
        process.exitCode = EXIT_CODES.GENERAL_ERROR;
      }
    } else {
      console.error("Unknown error:", err);
      process.exitCode = EXIT_CODES.GENERAL_ERROR;
    }
  }
}
