import { isObjectRecord } from '../utils.js';

export interface RuntimeRestartSignal {
  requested: boolean;
  reason?: string;
}

const RESTART_FLAG_KEYS = ['restartRequested', 'runtimeRestart', '__goondanRestart'] as const;

export function readRuntimeRestartSignal(value: unknown): RuntimeRestartSignal | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  for (const key of RESTART_FLAG_KEYS) {
    if (value[key] === true) {
      const reasonValue = value['restartReason'];
      return {
        requested: true,
        reason: typeof reasonValue === 'string' && reasonValue.trim().length > 0 ? reasonValue.trim() : undefined,
      };
    }
  }

  return undefined;
}
