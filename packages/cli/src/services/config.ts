import path from 'node:path';
import os from 'node:os';
import { readTextFileIfExists, isObjectRecord, trimQuotes } from '../utils.js';
import { DEFAULT_REGISTRY_URL } from '../constants.js';

interface RegistryAuthEntry {
  token?: string;
}

export interface CliConfigFile {
  registry?: string;
  registries: Record<string, RegistryAuthEntry>;
  scopedRegistries: Record<string, string>;
}

export function resolveStateRoot(explicit: string | undefined, env: NodeJS.ProcessEnv): string {
  if (explicit && explicit.length > 0) {
    return path.resolve(explicit);
  }

  const fromEnv = env['GOONDAN_STATE_ROOT'];
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }

  return path.join(os.homedir(), '.goondan');
}

function parseRegistryAuthEntry(value: unknown): RegistryAuthEntry | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const tokenValue = value['token'];
  if (typeof tokenValue === 'string') {
    return { token: tokenValue };
  }

  return {};
}

function parseConfig(raw: unknown): CliConfigFile {
  if (!isObjectRecord(raw)) {
    return {
      registries: {},
      scopedRegistries: {},
    };
  }

  const registry = typeof raw['registry'] === 'string' ? raw['registry'] : undefined;

  const registries: Record<string, RegistryAuthEntry> = {};
  const registriesRaw = raw['registries'];
  if (isObjectRecord(registriesRaw)) {
    for (const [key, value] of Object.entries(registriesRaw)) {
      const parsed = parseRegistryAuthEntry(value);
      if (parsed) {
        registries[key] = parsed;
      }
    }
  }

  const scopedRegistries: Record<string, string> = {};
  const scopedRaw = raw['scopedRegistries'];
  if (isObjectRecord(scopedRaw)) {
    for (const [key, value] of Object.entries(scopedRaw)) {
      if (typeof value === 'string') {
        scopedRegistries[key] = value;
      }
    }
  }

  return {
    registry,
    registries,
    scopedRegistries,
  };
}

export async function readCliConfig(stateRoot: string): Promise<CliConfigFile> {
  const configPath = path.join(stateRoot, 'config.json');
  const content = await readTextFileIfExists(configPath);
  if (!content) {
    return {
      registries: {},
      scopedRegistries: {},
    };
  }

  try {
    const parsed = JSON.parse(content);
    return parseConfig(parsed);
  } catch {
    return {
      registries: {},
      scopedRegistries: {},
    };
  }
}

function packageScope(packageName: string): string | undefined {
  if (!packageName.startsWith('@')) {
    return undefined;
  }

  const slashIndex = packageName.indexOf('/');
  if (slashIndex <= 1) {
    return undefined;
  }

  return packageName.slice(0, slashIndex);
}

export function resolveRegistryUrl(
  optionValue: string | undefined,
  env: NodeJS.ProcessEnv,
  config: CliConfigFile,
  packageName?: string,
): string {
  if (optionValue && optionValue.length > 0) {
    return optionValue;
  }

  const envRegistry = env['GOONDAN_REGISTRY'];
  if (envRegistry && envRegistry.length > 0) {
    return envRegistry;
  }

  if (packageName) {
    const scope = packageScope(packageName);
    if (scope) {
      const scoped = config.scopedRegistries[scope];
      if (typeof scoped === 'string' && scoped.length > 0) {
        return scoped;
      }
    }
  }

  if (config.registry && config.registry.length > 0) {
    return config.registry;
  }

  return DEFAULT_REGISTRY_URL;
}

function expandEnvToken(rawToken: string, env: NodeJS.ProcessEnv): string {
  const trimmed = trimQuotes(rawToken);
  const match = trimmed.match(/^\$\{([A-Z0-9_]+)\}$/);
  if (!match) {
    return trimmed;
  }

  const envName = match[1];
  if (!envName) {
    return '';
  }
  const resolved = env[envName];
  if (!resolved) {
    return '';
  }

  return resolved;
}

export function resolveRegistryToken(
  registryUrl: string,
  env: NodeJS.ProcessEnv,
  config: CliConfigFile,
): string | undefined {
  const fromEnv = env['GOONDAN_REGISTRY_TOKEN'];
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }

  const auth = config.registries[registryUrl];
  if (!auth || !auth.token) {
    return undefined;
  }

  const expanded = expandEnvToken(auth.token, env);
  if (expanded.length === 0) {
    return undefined;
  }

  return expanded;
}
