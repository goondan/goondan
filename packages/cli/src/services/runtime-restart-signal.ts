import { isObjectRecord } from '../utils.js';

export interface RuntimeRestartSignal {
  requested: boolean;
  reason?: string;
}

const RESTART_FLAG_KEYS = ['restartRequested', 'runtimeRestart', '__goondanRestart'] as const;

function hasChangedFiles(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  if (value.length === 0) {
    return false;
  }

  return value.every((item) => typeof item === 'string' && item.length > 0);
}

export function readRuntimeRestartSignal(value: unknown, toolName?: string): RuntimeRestartSignal | undefined {
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

  if (typeof toolName === 'string' && toolName.endsWith('__evolve')) {
    const changedFiles = value['changedFiles'];
    const backupDir = value['backupDir'];
    if (hasChangedFiles(changedFiles) && typeof backupDir === 'string' && backupDir.trim().length > 0) {
      return {
        requested: true,
        reason: 'tool:evolve',
      };
    }
  }

  return undefined;
}
