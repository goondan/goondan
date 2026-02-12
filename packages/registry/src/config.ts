import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { CONFIG_FILE_RELATIVE_PATH, DEFAULT_REGISTRY_URL } from "./constants.js";
import { parseScopedPackageName } from "./package-name.js";
import type {
  RegistryConfigFile,
  ResolveRegistryConfigOptions,
  ResolvedRegistryConfig,
} from "./types.js";
import { parseRegistryConfigFile } from "./validators.js";

const ENV_PLACEHOLDER_PATTERN = /^\$\{([A-Z0-9_]+)\}$/;

export async function resolveRegistryConfig(
  options: ResolveRegistryConfigOptions = {},
): Promise<ResolvedRegistryConfig> {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? path.join(homedir(), CONFIG_FILE_RELATIVE_PATH);
  const configFile = await loadRegistryConfigFile(configPath);

  const registryFromConfig = resolveRegistryFromConfig(configFile, options.packageName);

  const registryUrl = normalizeRegistryUrl(
    firstNonEmptyString([
      options.registry,
      env.GOONDAN_REGISTRY,
      registryFromConfig,
      DEFAULT_REGISTRY_URL,
    ]) ?? DEFAULT_REGISTRY_URL,
  );

  const tokenFromConfig = resolveTokenFromConfig(configFile, registryUrl, env);

  const token = firstNonEmptyString([options.token, env.GOONDAN_REGISTRY_TOKEN, tokenFromConfig]);

  return {
    registryUrl,
    token,
  };
}

async function loadRegistryConfigFile(configPath: string): Promise<RegistryConfigFile> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const config = parseRegistryConfigFile(parsed);
    if (config === null) {
      return {};
    }

    return config;
  } catch {
    return {};
  }
}

function resolveRegistryFromConfig(configFile: RegistryConfigFile, packageName?: string): string | undefined {
  if (typeof packageName === "string") {
    const parsedPackageName = parseScopedPackageName(packageName);
    if (parsedPackageName !== null) {
      const scopedRegistries = configFile.scopedRegistries;
      if (scopedRegistries !== undefined) {
        const scopedRegistry = scopedRegistries[parsedPackageName.scope];
        if (typeof scopedRegistry === "string" && scopedRegistry.length > 0) {
          return scopedRegistry;
        }
      }
    }
  }

  if (typeof configFile.registry === "string" && configFile.registry.length > 0) {
    return configFile.registry;
  }

  return undefined;
}

function resolveTokenFromConfig(
  configFile: RegistryConfigFile,
  registryUrl: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const registries = configFile.registries;
  if (registries === undefined) {
    return undefined;
  }

  const normalizedTarget = normalizeRegistryUrl(registryUrl);

  for (const [configuredRegistry, auth] of Object.entries(registries)) {
    if (normalizeRegistryUrl(configuredRegistry) !== normalizedTarget) {
      continue;
    }

    if (typeof auth.token !== "string" || auth.token.length === 0) {
      return undefined;
    }

    const resolved = resolveEnvPlaceholder(auth.token, env);
    return resolved;
  }

  return undefined;
}

function resolveEnvPlaceholder(value: string, env: NodeJS.ProcessEnv): string | undefined {
  const matched = value.match(ENV_PLACEHOLDER_PATTERN);
  if (matched === null) {
    return value;
  }

  const envName = matched[1];
  if (envName === undefined) {
    return undefined;
  }

  const resolved = env[envName];
  if (typeof resolved === "string" && resolved.length > 0) {
    return resolved;
  }

  return undefined;
}

function firstNonEmptyString(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function normalizeRegistryUrl(value: string): string {
  if (value.endsWith("/")) {
    return value.slice(0, -1);
  }

  return value;
}
