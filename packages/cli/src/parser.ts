import type { ParsedArguments } from './types.js';

const aliasMap: Record<string, string> = {
  h: 'help',
  V: 'version',
  v: 'verbose',
  q: 'quiet',
  c: 'config',
  s: 'swarm',
  i: 'instance-key',
  w: 'watch',
  a: 'agent',
  n: 'limit',
  f: 'force',
  D: 'dev',
  E: 'exact',
};

const globalOptionSet = new Set([
  'help',
  'version',
  'verbose',
  'quiet',
  'config',
  'state-root',
  'no-color',
  'json',
]);

const valueOptionSet = new Set([
  'config',
  'state-root',
  'swarm',
  'instance-key',
  'input',
  'input-file',
  'env-file',
  'agent',
  'limit',
  'format',
  'registry',
  'tag',
  'access',
]);

function optionExpectsValue(name: string): boolean {
  return valueOptionSet.has(name);
}

function resolveShortOptionName(short: string): string {
  const resolved = aliasMap[short];
  if (resolved) {
    return resolved;
  }
  return short;
}

function assignOption(target: Record<string, string | boolean>, name: string, value: string | boolean): void {
  target[name] = value;
}

export function parseArguments(argv: string[]): ParsedArguments {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (typeof token !== 'string') {
      index += 1;
      continue;
    }

    if (token === '--') {
      const trailing = argv.slice(index + 1);
      positionals.push(...trailing);
      break;
    }

    if (token.startsWith('--')) {
      const raw = token.slice(2);
      const equalIndex = raw.indexOf('=');
      if (equalIndex >= 0) {
        const name = raw.slice(0, equalIndex);
        const value = raw.slice(equalIndex + 1);
        assignOption(options, name, value);
        index += 1;
        continue;
      }

      const name = raw;
      if (optionExpectsValue(name)) {
        const next = argv[index + 1];
        if (next && !next.startsWith('-')) {
          assignOption(options, name, next);
          index += 2;
          continue;
        }
      }

      assignOption(options, name, true);
      index += 1;
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const shortBody = token.slice(1);
      if (shortBody.length === 1) {
        const shortName = resolveShortOptionName(shortBody);
        if (optionExpectsValue(shortName)) {
          const next = argv[index + 1];
          if (next && !next.startsWith('-')) {
            assignOption(options, shortName, next);
            index += 2;
            continue;
          }
        }

        assignOption(options, shortName, true);
        index += 1;
        continue;
      }

      const chars = shortBody.split('');
      let consumed = false;
      for (let charIndex = 0; charIndex < chars.length; charIndex += 1) {
        const currentChar = chars[charIndex];
        if (typeof currentChar !== 'string') {
          continue;
        }
        const mapped = resolveShortOptionName(currentChar);
        const isLast = charIndex === chars.length - 1;

        if (isLast && optionExpectsValue(mapped)) {
          const next = argv[index + 1];
          if (next && !next.startsWith('-')) {
            assignOption(options, mapped, next);
            index += 2;
            consumed = true;
            break;
          }
        }

        assignOption(options, mapped, true);
      }

      if (!consumed) {
        index += 1;
      }
      continue;
    }

    positionals.push(token);
    index += 1;
  }

  const globalOptions: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(options)) {
    if (globalOptionSet.has(name)) {
      globalOptions[name] = value;
    }
  }

  const command = positionals[0];
  const subcommand = positionals[1];

  return {
    command,
    subcommand,
    rest: positionals.slice(2),
    options,
    globalOptions,
  };
}
