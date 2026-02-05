/**
 * gdn run command
 *
 * Runs a Swarm with the specified options.
 * @see /docs/specs/cli.md - Section 4 (gdn run)
 */

import { Command, Option } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import ora from "ora";
import {
  loadBundleFromFile,
  loadBundleFromDirectory,
  type BundleLoadResult,
} from "@goondan/core";
import { info, success, warn, error as logError, debug } from "../utils/logger.js";
import { ExitCode } from "../types.js";

/**
 * Run command options
 */
export interface RunOptions {
  /** Swarm name to run */
  swarm: string;
  /** Connector to use */
  connector?: string;
  /** Instance key */
  instanceKey?: string;
  /** Initial input message */
  input?: string;
  /** Input from file */
  inputFile?: string;
  /** Interactive mode */
  interactive: boolean;
  /** Watch mode for file changes */
  watch: boolean;
  /** HTTP server port */
  port?: number;
  /** Skip dependency installation */
  noInstall: boolean;
}

/**
 * Configuration file names to look for
 */
const CONFIG_FILE_NAMES = ["goondan.yaml", "goondan.yml"];

/**
 * Find the bundle configuration file
 */
async function findBundleConfig(startDir: string): Promise<string | null> {
  const currentDir = path.resolve(startDir);

  // Check for config file in current directory
  for (const configName of CONFIG_FILE_NAMES) {
    const configPath = path.join(currentDir, configName);
    try {
      await fs.promises.access(configPath, fs.constants.R_OK);
      return configPath;
    } catch {
      // File not found, continue
    }
  }

  return null;
}

/**
 * Load and validate the bundle
 */
async function loadBundle(configPath: string): Promise<BundleLoadResult> {
  const stat = await fs.promises.stat(configPath);

  if (stat.isDirectory()) {
    return loadBundleFromDirectory(configPath);
  }

  return loadBundleFromFile(configPath);
}

/**
 * Display bundle information
 */
function displayBundleInfo(
  result: BundleLoadResult,
  swarmName: string,
  options: RunOptions
): void {
  console.log();
  console.log(chalk.bold("Configuration:"));
  console.log(chalk.gray(`  Swarm: ${chalk.cyan(swarmName)}`));

  if (options.connector) {
    console.log(chalk.gray(`  Connector: ${chalk.cyan(options.connector)}`));
  }

  if (options.instanceKey) {
    console.log(chalk.gray(`  Instance Key: ${chalk.cyan(options.instanceKey)}`));
  }

  console.log(chalk.gray(`  Interactive: ${options.interactive ? "yes" : "no"}`));

  if (options.watch) {
    console.log(chalk.gray(`  Watch Mode: enabled`));
  }

  if (options.port) {
    console.log(chalk.gray(`  Port: ${options.port}`));
  }

  // Display resource counts
  const resourceCounts: Record<string, number> = {};
  for (const resource of result.resources) {
    const count = resourceCounts[resource.kind] ?? 0;
    resourceCounts[resource.kind] = count + 1;
  }

  console.log();
  console.log(chalk.bold("Resources loaded:"));
  for (const kind of Object.keys(resourceCounts)) {
    console.log(chalk.gray(`  ${kind}: ${resourceCounts[kind]}`));
  }
  console.log();
}

/**
 * Display validation errors/warnings
 */
function displayValidationResults(result: BundleLoadResult): void {
  const errors = result.errors.filter((e) => {
    // Filter out warnings for error count
    if ("level" in e && e.level === "warning") {
      return false;
    }
    return true;
  });

  const warnings = result.errors.filter((e) => {
    if ("level" in e && e.level === "warning") {
      return true;
    }
    return false;
  });

  if (warnings.length > 0) {
    console.log(chalk.yellow.bold("Warnings:"));
    for (const w of warnings) {
      warn(`  ${w.message}`);
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log(chalk.red.bold("Errors:"));
    for (const e of errors) {
      logError(`  ${e.message}`);
    }
    console.log();
  }
}

/**
 * Read input from file
 */
async function readInputFile(filePath: string): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  return fs.promises.readFile(resolvedPath, "utf-8");
}

/**
 * Run interactive mode with readline
 */
async function runInteractiveMode(
  swarmName: string,
  instanceKey: string
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.dim("Type your message and press Enter. Type 'exit' or Ctrl+C to quit."));
  console.log();

  const prompt = (): void => {
    rl.question(chalk.cyan("You: "), async (input) => {
      const trimmedInput = input.trim();

      if (trimmedInput.toLowerCase() === "exit" || trimmedInput.toLowerCase() === "quit") {
        console.log();
        info("Goodbye!");
        rl.close();
        return;
      }

      if (!trimmedInput) {
        prompt();
        return;
      }

      // Placeholder: Show that we received the input
      console.log();
      console.log(chalk.gray(`[${swarmName}/${instanceKey}] Processing...`));
      console.log(chalk.dim("(Runtime execution not yet implemented)"));
      console.log();

      prompt();
    });
  };

  // Handle Ctrl+C gracefully
  rl.on("close", () => {
    console.log();
    process.exit(ExitCode.SUCCESS);
  });

  prompt();

  // Keep the process running
  await new Promise<void>(() => {
    // Never resolves - exits via rl.close() or Ctrl+C
  });
}

/**
 * Execute the run command
 */
async function executeRun(options: RunOptions): Promise<void> {
  const spinner = ora();

  try {
    // Find bundle configuration
    spinner.start("Looking for bundle configuration...");
    const configPath = await findBundleConfig(process.cwd());

    if (!configPath) {
      spinner.fail("Bundle configuration not found");
      logError(
        `No ${CONFIG_FILE_NAMES.join(" or ")} found in current directory`
      );
      info("Run 'gdn init' to create a new project or navigate to a project directory.");
      process.exitCode = ExitCode.CONFIG_ERROR;
      return;
    }

    spinner.succeed(`Found configuration: ${path.relative(process.cwd(), configPath)}`);

    // Load and validate bundle
    spinner.start("Loading and validating bundle...");
    const result = await loadBundle(configPath);

    if (!result.isValid()) {
      spinner.fail("Bundle validation failed");
      displayValidationResults(result);
      process.exitCode = ExitCode.VALIDATION_ERROR;
      return;
    }

    spinner.succeed("Bundle loaded and validated");

    // Check if the specified swarm exists
    const swarms = result.getResourcesByKind("Swarm");
    const targetSwarm = swarms.find(
      (s) => s.metadata.name === options.swarm
    );

    if (!targetSwarm) {
      logError(`Swarm '${options.swarm}' not found in bundle`);
      if (swarms.length > 0) {
        info(`Available swarms: ${swarms.map((s) => s.metadata.name).join(", ")}`);
      } else {
        info("No Swarm resources defined in the bundle");
      }
      process.exitCode = ExitCode.CONFIG_ERROR;
      return;
    }

    // Generate instance key if not provided
    const instanceKey = options.instanceKey ?? `cli-${Date.now()}`;

    // Display configuration info
    displayBundleInfo(result, options.swarm, options);

    // Display warnings if any
    displayValidationResults(result);

    // Show starting message
    console.log(chalk.bold.green(`Starting Swarm: ${options.swarm}`));
    console.log();

    // Handle initial input
    let initialInput = options.input;

    if (options.inputFile) {
      try {
        initialInput = await readInputFile(options.inputFile);
        debug(`Loaded input from file: ${options.inputFile}`);
      } catch (err) {
        logError(`Failed to read input file: ${options.inputFile}`);
        if (err instanceof Error) {
          logError(err.message);
        }
        process.exitCode = ExitCode.ERROR;
        return;
      }
    }

    // Process initial input if provided
    if (initialInput) {
      console.log(chalk.cyan("You:"), initialInput);
      console.log();
      console.log(chalk.gray(`[${options.swarm}/${instanceKey}] Processing...`));
      console.log(chalk.dim("(Runtime execution not yet implemented)"));
      console.log();

      // If not interactive, exit after processing
      if (!options.interactive) {
        success("Processing complete");
        return;
      }
    }

    // Run interactive mode if enabled
    if (options.interactive) {
      await runInteractiveMode(options.swarm, instanceKey);
    } else {
      // Non-interactive mode without input
      info("No input provided and interactive mode is disabled.");
      info("Use --input or --input-file to provide input, or --interactive for interactive mode.");
    }
  } catch (err) {
    spinner.fail("Failed to run Swarm");

    if (err instanceof Error) {
      logError(err.message);
      debug(err.stack ?? "");
    }

    process.exitCode = ExitCode.ERROR;
  }
}

/**
 * Create the run command
 *
 * @returns Commander command for 'gdn run'
 */
export function createRunCommand(): Command {
  const command = new Command("run")
    .description("Run a Swarm")
    .addOption(
      new Option("-s, --swarm <name>", "Swarm name to run").default("default")
    )
    .addOption(
      new Option("--connector <name>", "Connector to use")
    )
    .addOption(
      new Option("-i, --instance-key <key>", "Instance key")
    )
    .addOption(
      new Option("--input <text>", "Initial input message")
    )
    .addOption(
      new Option("--input-file <path>", "Input from file")
    )
    .addOption(
      new Option("--interactive", "Interactive mode").default(true)
    )
    .addOption(
      new Option("--no-interactive", "Disable interactive mode")
    )
    .addOption(
      new Option("-w, --watch", "Watch mode for file changes").default(false)
    )
    .addOption(
      new Option("-p, --port <number>", "HTTP server port").argParser(parseInt)
    )
    .addOption(
      new Option("--no-install", "Skip dependency installation")
    )
    .action(async (opts: Record<string, unknown>) => {
      const runOptions: RunOptions = {
        swarm: (opts.swarm as string) ?? "default",
        connector: opts.connector as string | undefined,
        instanceKey: opts.instanceKey as string | undefined,
        input: opts.input as string | undefined,
        inputFile: opts.inputFile as string | undefined,
        interactive: opts.interactive !== false,
        watch: (opts.watch as boolean) ?? false,
        port: opts.port as number | undefined,
        noInstall: opts.install === false,
      };

      await executeRun(runOptions);
    });

  return command;
}

export default createRunCommand;
