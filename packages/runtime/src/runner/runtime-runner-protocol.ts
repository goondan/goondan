import { isJsonObject } from '../index.js';

export interface RunnerReadyMessage {
  type: 'ready';
  instanceKey: string;
  pid: number;
}

export interface RunnerStartErrorMessage {
  type: 'start_error';
  message: string;
}

export type RunnerMessage = RunnerReadyMessage | RunnerStartErrorMessage;

export function isRunnerReadyMessage(message: unknown): message is RunnerReadyMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return message.type === 'ready' && typeof message.instanceKey === 'string' && typeof message.pid === 'number';
}

export function isRunnerStartErrorMessage(message: unknown): message is RunnerStartErrorMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return message.type === 'start_error' && typeof message.message === 'string';
}
