import type { ExitCode } from './types.js';

export interface StructuredError {
  code: string;
  message: string;
  suggestion?: string;
  helpUrl?: string;
  exitCode: ExitCode;
}

export class CliError extends Error implements StructuredError {
  code: string;

  suggestion?: string;

  helpUrl?: string;

  exitCode: ExitCode;

  constructor(error: StructuredError) {
    super(error.message);
    this.name = 'CliError';
    this.code = error.code;
    this.suggestion = error.suggestion;
    this.helpUrl = error.helpUrl;
    this.exitCode = error.exitCode;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isCliError(value: unknown): value is CliError {
  if (!isObjectRecord(value)) {
    return false;
  }

  const code = value['code'];
  const exitCode = value['exitCode'];
  const name = value['name'];

  return typeof code === 'string' && typeof exitCode === 'number' && name === 'CliError';
}

export function toCliError(error: unknown): CliError {
  if (isCliError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new CliError({
      code: 'INTERNAL_ERROR',
      message: error.message,
      exitCode: 1,
      suggestion: '오류 로그를 확인한 뒤 다시 시도하세요.',
      helpUrl: 'https://docs.goondan.io/errors/INTERNAL_ERROR',
    });
  }

  return new CliError({
    code: 'UNKNOWN_ERROR',
    message: '알 수 없는 오류가 발생했습니다.',
    exitCode: 1,
    suggestion: '명령과 옵션을 확인하고 다시 시도하세요.',
    helpUrl: 'https://docs.goondan.io/errors/UNKNOWN_ERROR',
  });
}

export function usageError(message: string, suggestion?: string): CliError {
  return new CliError({
    code: 'INVALID_ARGUMENT',
    message,
    exitCode: 2,
    suggestion,
    helpUrl: 'https://docs.goondan.io/errors/INVALID_ARGUMENT',
  });
}

export function configError(message: string, suggestion?: string): CliError {
  return new CliError({
    code: 'CONFIG_ERROR',
    message,
    exitCode: 3,
    suggestion,
    helpUrl: 'https://docs.goondan.io/errors/CONFIG_ERROR',
  });
}

export function validateError(message: string, suggestion?: string): CliError {
  return new CliError({
    code: 'VALIDATION_ERROR',
    message,
    exitCode: 4,
    suggestion,
    helpUrl: 'https://docs.goondan.io/errors/VALIDATION_ERROR',
  });
}

export function networkError(message: string, suggestion?: string): CliError {
  return new CliError({
    code: 'NETWORK_ERROR',
    message,
    exitCode: 5,
    suggestion,
    helpUrl: 'https://docs.goondan.io/errors/NETWORK_ERROR',
  });
}

export function authError(message: string, suggestion?: string): CliError {
  return new CliError({
    code: 'AUTH_ERROR',
    message,
    exitCode: 6,
    suggestion,
    helpUrl: 'https://docs.goondan.io/errors/AUTH_ERROR',
  });
}
