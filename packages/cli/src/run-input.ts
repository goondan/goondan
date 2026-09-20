import type { Json, RunInput } from '@goondan/core';

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value !== 'object') return false;
  return Object.values(value).every(isJson);
}

/** CLI 입력을 JSON으로 해석할 수 있으면 JSON 값으로, 그렇지 않으면 원문 문자열로 반환합니다. */
export function parseRunInput(raw: string): RunInput {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isJson(parsed) ? parsed : raw;
  } catch {
    return raw;
  }
}
