import { DEFAULT_BUNDLE_FILE } from './constants.js';
import { usageError } from './errors.js';
import type { ParsedArguments } from './types.js';
import { ensureBoolean, ensureNumber, ensureString } from './utils.js';

export interface GlobalRuntimeOptions {
  configPath: string;
  stateRoot?: string;
  json: boolean;
}

export function getGlobalOptions(parsed: ParsedArguments): GlobalRuntimeOptions {
  const configPath = ensureString(parsed.globalOptions['config']) ?? DEFAULT_BUNDLE_FILE;
  const stateRoot = ensureString(parsed.globalOptions['state-root']);
  const json = ensureBoolean(parsed.globalOptions['json']);

  return {
    configPath,
    stateRoot,
    json,
  };
}

export function getStringOption(parsed: ParsedArguments, name: string): string | undefined {
  return ensureString(parsed.options[name]);
}

export function getBooleanOption(parsed: ParsedArguments, name: string): boolean {
  return ensureBoolean(parsed.options[name]);
}

export function getNumberOption(parsed: ParsedArguments, name: string, fallback: number): number {
  const parsedNumber = ensureNumber(parsed.options[name]);
  if (typeof parsedNumber === 'number') {
    return parsedNumber;
  }
  return fallback;
}

export function getFormatOption(parsed: ParsedArguments, fallback: 'text' | 'json' | 'github'): 'text' | 'json' | 'github' {
  const candidate = getStringOption(parsed, 'format');
  if (!candidate) {
    return fallback;
  }

  if (candidate === 'text' || candidate === 'json' || candidate === 'github') {
    return candidate;
  }

  throw usageError('지원하지 않는 --format 값입니다.', 'text, json, github 중 하나를 사용하세요.');
}

export function getAccessOption(parsed: ParsedArguments): 'public' | 'restricted' {
  const candidate = getStringOption(parsed, 'access');
  if (!candidate) {
    return 'public';
  }

  if (candidate === 'public' || candidate === 'restricted') {
    return candidate;
  }

  throw usageError('지원하지 않는 --access 값입니다.', '--access public 또는 --access restricted를 사용하세요.');
}
