import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export {
  isRunnerReadyMessage,
  isRunnerStartErrorMessage,
  type RunnerReadyMessage,
  type RunnerStartErrorMessage,
} from './runtime-runner-protocol.js';

export function resolveRuntimeRunnerPath(): string {
  const jsPath = fileURLToPath(new URL('./runtime-runner.js', import.meta.url));
  if (existsSync(jsPath)) {
    return jsPath;
  }

  return fileURLToPath(new URL('./runtime-runner.ts', import.meta.url));
}

export function resolveRuntimeRunnerConnectorChildPath(): string {
  const jsPath = fileURLToPath(new URL('./runtime-runner-connector-child.js', import.meta.url));
  if (existsSync(jsPath)) {
    return jsPath;
  }

  return fileURLToPath(new URL('./runtime-runner-connector-child.ts', import.meta.url));
}
