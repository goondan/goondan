import { isObjectRecord } from '../utils.js';

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
  if (!isObjectRecord(message)) {
    return false;
  }

  return message.type === 'ready' && typeof message.instanceKey === 'string' && typeof message.pid === 'number';
}

export function isRunnerStartErrorMessage(message: unknown): message is RunnerStartErrorMessage {
  if (!isObjectRecord(message)) {
    return false;
  }

  return message.type === 'start_error' && typeof message.message === 'string';
}
