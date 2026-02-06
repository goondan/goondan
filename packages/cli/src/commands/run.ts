/**
 * gdn run command
 *
 * Runs a Swarm with the specified options.
 * Bundle을 로드하고 실제 런타임(LLM 호출 + Tool 실행)을 연결하여 대화형 실행합니다.
 *
 * @see /docs/specs/cli.md - Section 4 (gdn run)
 * @see /docs/specs/runtime.md - 실행 모델
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
  createEffectiveConfigLoader,
  createStepRunner,
  createTurnRunner,
  createSwarmInstanceManager,
  createAgentInstance,
  createAgentEvent,
  isLlmAssistantMessage,
} from "@goondan/core";
import type {
  SwarmInstanceManager,
  TurnRunner,
  Turn,
  AgentInstance,
} from "@goondan/core";
import { info, success, warn, error as logError, debug } from "../utils/logger.js";
import { ExitCode } from "../types.js";
import { createBundleLoaderImpl } from "../runtime/bundle-loader-impl.js";
import { createLlmCallerImpl } from "../runtime/llm-caller-impl.js";
import { createToolExecutorImpl } from "../runtime/tool-executor-impl.js";

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
 * ObjectRefLike에서 name 추출
 */
function resolveRefName(ref: unknown): string {
  if (typeof ref === "string") {
    const parts = ref.split("/");
    if (parts.length === 2 && parts[1]) {
      return parts[1];
    }
    return ref;
  }
  if (isObjectWithKey(ref, "name") && typeof ref.name === "string") {
    return ref.name;
  }
  return "default";
}

/**
 * 타입 가드: object이고 특정 key를 갖는지 확인
 */
function isObjectWithKey<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

/**
 * SwarmSpec에서 policy 값을 타입 안전하게 추출
 */
function getSwarmPolicyValue(
  spec: unknown,
  key: string,
  defaultValue: number,
): number {
  if (!isObjectWithKey(spec, "policy")) return defaultValue;
  const policy = spec.policy;
  if (!isObjectWithKey(policy, key)) return defaultValue;
  const value = policy[key];
  return typeof value === "number" ? value : defaultValue;
}

/**
 * SwarmSpec에서 entrypoint를 타입 안전하게 추출
 */
function getSwarmEntrypoint(spec: unknown): unknown {
  if (!isObjectWithKey(spec, "entrypoint")) return undefined;
  return spec.entrypoint;
}

/**
 * Runtime context for running turns
 */
interface RuntimeContext {
  turnRunner: TurnRunner;
  swarmInstanceManager: SwarmInstanceManager;
  swarmName: string;
  entrypointAgent: string;
  instanceKey: string;
  /** AgentInstance 캐시 (instanceKey -> Map<agentName, AgentInstance>) */
  agentInstances: Map<string, AgentInstance>;
}

/**
 * Turn 결과에서 최종 assistant 메시지 텍스트 추출
 */
function extractAssistantResponse(turn: Turn): string {
  // Turn.messages를 역순으로 순회하여 마지막 assistant 메시지 텍스트 반환
  for (let i = turn.messages.length - 1; i >= 0; i--) {
    const msg = turn.messages[i];
    if (msg && isLlmAssistantMessage(msg) && msg.content) {
      return msg.content;
    }
  }
  return "(No response)";
}

/**
 * 사용량 정보 표시
 */
function displayUsage(turn: Turn): void {
  let totalPrompt = 0;
  let totalCompletion = 0;
  let stepCount = 0;

  for (const step of turn.steps) {
    if (step.llmResult?.usage) {
      totalPrompt += step.llmResult.usage.promptTokens;
      totalCompletion += step.llmResult.usage.completionTokens;
    }
    stepCount++;
  }

  if (totalPrompt > 0 || totalCompletion > 0) {
    console.log(
      chalk.dim(
        `  [${stepCount} step(s), ${totalPrompt} prompt + ${totalCompletion} completion tokens]`
      )
    );
  }
}

/**
 * 단일 입력 처리 (Turn 실행)
 */
async function processInput(
  ctx: RuntimeContext,
  input: string,
): Promise<void> {
  // SwarmInstance 조회 또는 생성
  const swarmInstance = await ctx.swarmInstanceManager.getOrCreate(
    `Swarm/${ctx.swarmName}`,
    ctx.instanceKey,
    "default"
  );

  // AgentInstance 조회 또는 생성
  let agentInstance = ctx.agentInstances.get(ctx.entrypointAgent);
  if (!agentInstance) {
    agentInstance = createAgentInstance(
      swarmInstance,
      `Agent/${ctx.entrypointAgent}`
    );
    ctx.agentInstances.set(ctx.entrypointAgent, agentInstance);
    // SwarmInstance에도 등록
    swarmInstance.agents.set(ctx.entrypointAgent, {
      id: agentInstance.id,
      agentName: agentInstance.agentName,
    });
  }

  // AgentEvent 생성
  const event = createAgentEvent("user.input", input);

  // Turn 실행
  const turn = await ctx.turnRunner.run(agentInstance, event);

  // 결과 출력
  if (turn.status === "completed") {
    const response = extractAssistantResponse(turn);
    console.log(chalk.green("Agent:"), response);
    displayUsage(turn);
  } else if (turn.status === "failed") {
    const errorMeta = turn.metadata["error"];
    if (isObjectWithKey(errorMeta, "message")) {
      logError(`Turn failed: ${String(errorMeta.message)}`);
    } else {
      logError("Turn failed with unknown error");
    }
  }

  console.log();
}

/**
 * 실제 런타임을 초기화하고 RuntimeContext를 생성
 */
function initializeRuntime(
  result: BundleLoadResult,
  bundleRootDir: string,
  swarmName: string,
  instanceKey: string,
): RuntimeContext {
  // 1. BundleLoaderImpl 생성
  const bundleLoader = createBundleLoaderImpl({
    bundleLoadResult: result,
    bundleRootDir,
  });

  // 2. EffectiveConfigLoader 생성
  const effectiveConfigLoader = createEffectiveConfigLoader(bundleLoader);

  // 3. LlmCaller 생성
  const llmCaller = createLlmCallerImpl();

  // 4. ToolExecutor 생성
  const toolExecutor = createToolExecutorImpl({ bundleRootDir });

  // 5. StepRunner 생성
  const stepRunner = createStepRunner({
    llmCaller,
    toolExecutor,
    effectiveConfigLoader,
  });

  // 6. TurnRunner 생성
  const swarmResource = result.getResource("Swarm", swarmName);
  const swarmSpec = swarmResource?.spec;
  const maxStepsPerTurn = getSwarmPolicyValue(swarmSpec, "maxStepsPerTurn", 32);

  const turnRunner = createTurnRunner({
    stepRunner,
    maxStepsPerTurn,
  });

  // 7. SwarmInstanceManager 생성
  const swarmInstanceManager = createSwarmInstanceManager();

  // 8. Entrypoint agent 확인
  const entrypointRef = getSwarmEntrypoint(swarmSpec);
  const entrypointAgent = entrypointRef
    ? resolveRefName(entrypointRef)
    : "default";

  return {
    turnRunner,
    swarmInstanceManager,
    swarmName,
    entrypointAgent,
    instanceKey,
    agentInstances: new Map(),
  };
}

/**
 * Run interactive mode with readline (실제 런타임 연결)
 */
async function runInteractiveMode(
  ctx: RuntimeContext,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.dim("Type your message and press Enter. Type 'exit' or Ctrl+C to quit."));
  console.log();

  const prompt = (): void => {
    rl.question(chalk.cyan("You: "), (input) => {
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

      console.log();

      // 실제 런타임으로 Turn 실행
      processInput(ctx, trimmedInput)
        .then(() => {
          prompt();
        })
        .catch((err: unknown) => {
          if (err instanceof Error) {
            logError(`Runtime error: ${err.message}`);
            debug(err.stack ?? "");
          }
          prompt();
        });
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
        `Bundle not found at './${CONFIG_FILE_NAMES[0]}'. No ${CONFIG_FILE_NAMES.join(" or ")} found in current directory.`
      );
      info("Run 'gdn init' to create a new project, or navigate to a project directory.");
      info("Run 'gdn doctor' to diagnose your environment.");
      process.exitCode = ExitCode.CONFIG_ERROR;
      return;
    }

    spinner.succeed(`Found configuration: ${path.relative(process.cwd(), configPath)}`);

    // Load and validate bundle
    spinner.start("Loading and validating bundle...");
    const bundleRootDir = path.dirname(configPath);
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

    // Initialize runtime
    spinner.start("Initializing runtime...");
    const ctx = initializeRuntime(result, bundleRootDir, options.swarm, instanceKey);
    spinner.succeed("Runtime initialized");

    // Show starting message
    console.log(chalk.bold.green(`Starting Swarm: ${options.swarm}`));
    console.log(chalk.dim(`  Entrypoint: ${ctx.entrypointAgent}`));
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

      await processInput(ctx, initialInput);

      // If not interactive, exit after processing
      if (!options.interactive) {
        success("Processing complete");
        return;
      }
    }

    // Run interactive mode if enabled
    if (options.interactive) {
      await runInteractiveMode(ctx);
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
    .addHelpText(
      "after",
      `
Examples:
  $ gdn run                             Run default Swarm interactively
  $ gdn run -s my-swarm                 Run a specific Swarm
  $ gdn run --input "Hello, agent!"     Send a single message
  $ gdn run --input-file request.txt    Send input from file
  $ gdn run --no-interactive            Non-interactive mode`
    )
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
      const optStr = (key: string): string | undefined =>
        typeof opts[key] === "string" ? opts[key] : undefined;
      const optNum = (key: string): number | undefined =>
        typeof opts[key] === "number" ? opts[key] : undefined;

      const runOptions: RunOptions = {
        swarm: optStr("swarm") ?? "default",
        connector: optStr("connector"),
        instanceKey: optStr("instanceKey"),
        input: optStr("input"),
        inputFile: optStr("inputFile"),
        interactive: opts.interactive !== false,
        watch: opts.watch === true,
        port: optNum("port"),
        noInstall: opts.install === false,
      };

      await executeRun(runOptions);
    });

  return command;
}

export default createRunCommand;
