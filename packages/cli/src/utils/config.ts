/**
 * Configuration management for CLI
 *
 * Loads and manages ~/.goondanrc and project .goondanrc files
 * @see /docs/specs/cli.md
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";

/**
 * Registry authentication entry
 */
export interface RegistryAuth {
  /** Authentication token */
  token?: string;
  /** Username for basic auth */
  username?: string;
  /** Password for basic auth */
  password?: string;
}

/**
 * Goondan CLI configuration
 */
export interface GoondanConfig {
  /** Default package registry URL */
  registry?: string;
  /** System state root path */
  stateRoot?: string;
  /** Log level */
  logLevel?: "debug" | "info" | "warn" | "error";
  /** Enable color output */
  color?: boolean;
  /** Default editor command */
  editor?: string;
  /** Registry authentication tokens */
  registries?: Record<string, RegistryAuth>;
  /** Scoped registry mappings */
  scopedRegistries?: Record<string, string>;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Readonly<GoondanConfig> = {
  registry: "https://registry.goondan.io",
  stateRoot: "~/.goondan",
  logLevel: "info",
  color: true,
};

/**
 * Default config file name
 */
export const CONFIG_FILE_NAME = ".goondanrc";

/**
 * Get the global config file path (~/.goondanrc)
 */
export function getGlobalConfigPath(): string {
  return join(homedir(), CONFIG_FILE_NAME);
}

/**
 * Get the project config file path (.goondanrc in project root)
 * Searches from cwd upward to find .goondanrc
 */
export function getProjectConfigPath(startDir?: string): string | undefined {
  let currentDir = startDir ?? process.cwd();
  const root = resolve("/");

  while (currentDir !== root) {
    const configPath = join(currentDir, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      return configPath;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return undefined;
}

/**
 * Parse config file content (supports YAML and JSON)
 */
function parseConfigContent(content: string): GoondanConfig {
  // Try YAML first (which also handles JSON)
  const parsed: unknown = YAML.parse(content);

  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (typeof parsed !== "object") {
    throw new Error("Configuration must be an object");
  }

  return parsed as GoondanConfig;
}

/**
 * Load configuration from a file
 */
export async function loadConfigFile(
  filePath: string
): Promise<GoondanConfig | undefined> {
  try {
    const content = await readFile(filePath, "utf-8");
    return parseConfigContent(content);
  } catch (err) {
    // Check if error has a code property
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Expand tilde (~) in path to home directory
 */
export function expandPath(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return join(homedir(), inputPath.slice(2));
  }
  if (inputPath === "~") {
    return homedir();
  }
  return inputPath;
}

/**
 * Merge multiple configs with priority (later configs override earlier)
 */
export function mergeConfigs(...configs: (GoondanConfig | undefined)[]): GoondanConfig {
  const result: GoondanConfig = {};

  for (const config of configs) {
    if (!config) {
      continue;
    }

    // Merge primitive properties
    if (config.registry !== undefined) result.registry = config.registry;
    if (config.stateRoot !== undefined) result.stateRoot = config.stateRoot;
    if (config.logLevel !== undefined) result.logLevel = config.logLevel;
    if (config.color !== undefined) result.color = config.color;
    if (config.editor !== undefined) result.editor = config.editor;

    // Merge registries (deep merge)
    if (config.registries) {
      result.registries = { ...result.registries, ...config.registries };
    }

    // Merge scoped registries (deep merge)
    if (config.scopedRegistries) {
      result.scopedRegistries = {
        ...result.scopedRegistries,
        ...config.scopedRegistries,
      };
    }
  }

  return result;
}

/**
 * Configuration load options
 */
export interface LoadConfigOptions {
  /** Override config file path */
  configPath?: string;
  /** CLI state root override */
  cliStateRoot?: string;
  /** Environment variable overrides */
  env?: {
    GOONDAN_REGISTRY?: string;
    GOONDAN_STATE_ROOT?: string;
    GOONDAN_LOG_LEVEL?: string;
    NO_COLOR?: string;
  };
}

/**
 * Load and merge all configuration sources
 *
 * Priority (highest to lowest):
 * 1. CLI options (passed to individual commands)
 * 2. Environment variables
 * 3. Project config (.goondanrc in project)
 * 4. Global config (~/.goondanrc)
 * 5. Defaults
 */
export async function loadConfig(
  options: LoadConfigOptions = {}
): Promise<GoondanConfig> {
  // Load global config
  const globalConfig = await loadConfigFile(getGlobalConfigPath());

  // Load project config
  const projectConfigPath = options.configPath ?? getProjectConfigPath();
  const projectConfig = projectConfigPath
    ? await loadConfigFile(projectConfigPath)
    : undefined;

  // Build env config
  const env = options.env ?? process.env;
  const envConfig: GoondanConfig = {};

  if (env.GOONDAN_REGISTRY) {
    envConfig.registry = env.GOONDAN_REGISTRY;
  }
  if (env.GOONDAN_STATE_ROOT) {
    envConfig.stateRoot = env.GOONDAN_STATE_ROOT;
  }
  if (env.GOONDAN_LOG_LEVEL) {
    const level = env.GOONDAN_LOG_LEVEL.toLowerCase();
    if (
      level === "debug" ||
      level === "info" ||
      level === "warn" ||
      level === "error"
    ) {
      envConfig.logLevel = level;
    }
  }
  if (env.NO_COLOR) {
    envConfig.color = false;
  }

  // Build CLI config
  const cliConfig: GoondanConfig = {};
  if (options.cliStateRoot) {
    cliConfig.stateRoot = options.cliStateRoot;
  }

  // Merge all configs (priority: defaults < global < project < env < cli)
  const merged = mergeConfigs(
    DEFAULT_CONFIG,
    globalConfig,
    projectConfig,
    envConfig,
    cliConfig
  );

  // Expand tilde in stateRoot
  if (merged.stateRoot) {
    merged.stateRoot = expandPath(merged.stateRoot);
  }

  return merged;
}

/**
 * Save configuration to the global config file
 */
export async function saveConfig(config: GoondanConfig): Promise<void> {
  const configPath = getGlobalConfigPath();
  const configDir = dirname(configPath);

  // Ensure directory exists
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  const content = YAML.stringify(config);
  await writeFile(configPath, content, "utf-8");
}

/**
 * Get a specific config value
 */
export async function getConfigValue<K extends keyof GoondanConfig>(
  key: K
): Promise<GoondanConfig[K]> {
  const config = await loadConfig();
  return config[key];
}

/**
 * Set a specific config value in the global config
 */
export async function setConfigValue<K extends keyof GoondanConfig>(
  key: K,
  value: GoondanConfig[K]
): Promise<void> {
  const globalConfig = (await loadConfigFile(getGlobalConfigPath())) ?? {};
  globalConfig[key] = value;
  await saveConfig(globalConfig);
}

/**
 * Delete a specific config value from the global config
 */
export async function deleteConfigValue<K extends keyof GoondanConfig>(
  key: K
): Promise<void> {
  const globalConfig = (await loadConfigFile(getGlobalConfigPath())) ?? {};
  delete globalConfig[key];
  await saveConfig(globalConfig);
}

/**
 * Get the config file path (global or project)
 */
export function getConfigPath(
  type: "global" | "project" = "global"
): string | undefined {
  if (type === "global") {
    return getGlobalConfigPath();
  }
  return getProjectConfigPath();
}
