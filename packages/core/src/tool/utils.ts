/**
 * Tool 유틸리티 함수
 * @see /docs/specs/tool.md - 7.2 오류 메시지 제한 구현
 */

import type { JsonValue } from '../types/json.js';
import type { Resource } from '../types/resource.js';
import type { ToolSpec } from '../types/specs/tool.js';
import type { ToolResult, AsyncToolOutput } from './types.js';

/** 기본 errorMessageLimit */
const DEFAULT_ERROR_MESSAGE_LIMIT = 1000;

/** truncation suffix */
const TRUNCATION_SUFFIX = '... (truncated)';

/**
 * 에러 메시지를 지정된 길이로 truncate
 * @param message - 원본 메시지
 * @param limit - 최대 길이 (기본: 1000)
 * @returns truncate된 메시지
 */
export function truncateErrorMessage(
  message: string,
  limit: number = DEFAULT_ERROR_MESSAGE_LIMIT
): string {
  if (message.length <= limit) {
    return message;
  }

  const maxContentLength = limit - TRUNCATION_SUFFIX.length;
  return message.slice(0, maxContentLength) + TRUNCATION_SUFFIX;
}

/**
 * Error에서 ToolResult를 생성
 * @param toolCallId - tool call ID
 * @param toolName - tool 이름
 * @param error - 에러 객체 또는 값
 * @param tool - Tool 리소스 (errorMessageLimit 참조용)
 * @returns ToolResult (error 상태)
 */
export function createToolErrorResult(
  toolCallId: string,
  toolName: string,
  error: unknown,
  tool?: Resource<ToolSpec>
): ToolResult {
  const limit = tool?.spec.errorMessageLimit ?? DEFAULT_ERROR_MESSAGE_LIMIT;

  let message: string;
  let name: string;
  let code: string | undefined;

  if (error instanceof Error) {
    message = error.message;
    name = error.name;
    code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  } else if (typeof error === 'string') {
    message = error;
    name = 'UnknownError';
  } else {
    message = String(error);
    name = 'UnknownError';
  }

  return {
    toolCallId,
    toolName,
    status: 'error',
    error: {
      message: truncateErrorMessage(message, limit),
      name,
      code,
    },
  };
}

/**
 * 성공 ToolResult를 생성
 * @param toolCallId - tool call ID
 * @param toolName - tool 이름
 * @param output - 출력값
 * @returns ToolResult (ok 상태)
 */
export function createToolSuccessResult(
  toolCallId: string,
  toolName: string,
  output: JsonValue | undefined
): ToolResult {
  const result: ToolResult = {
    toolCallId,
    toolName,
    status: 'ok',
  };

  if (output !== undefined) {
    result.output = output;
  }

  return result;
}

/**
 * Pending ToolResult를 생성
 * @param toolCallId - tool call ID
 * @param toolName - tool 이름
 * @param handle - 비동기 핸들
 * @param output - 추가 출력값
 * @returns ToolResult (pending 상태)
 */
export function createToolPendingResult(
  toolCallId: string,
  toolName: string,
  handle: string,
  output?: JsonValue
): ToolResult {
  const result: ToolResult = {
    toolCallId,
    toolName,
    status: 'pending',
    handle,
  };

  if (output !== undefined) {
    result.output = output;
  }

  return result;
}

/**
 * 핸들러 반환값이 비동기 결과인지 확인
 * @param value - 핸들러 반환값
 * @returns AsyncToolOutput 여부
 */
export function isAsyncToolResult(value: unknown): value is AsyncToolOutput {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  return '__async' in value &&
    (value as Record<string, unknown>)['__async'] === true;
}
