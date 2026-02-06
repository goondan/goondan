/**
 * Text Transform Tool - 텍스트 변환 (템플릿, 정규식, 포맷 변환)
 *
 * Mustache-like 템플릿 렌더링, 정규식 매칭/치환, JSON/YAML/CSV 포맷 변환을 제공합니다.
 * 외부 라이브러리 없이 기본적인 기능을 구현합니다.
 *
 * @see /docs/specs/tool.md
 */

import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

// =============================================================================
// 공통 유틸리티
// =============================================================================

/**
 * unknown 값을 재귀적으로 JsonValue로 변환
 */
function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === 'object' && value !== null) {
    const result: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = toJsonValue(v);
    }
    return result;
  }
  return null;
}

/**
 * JSON 문자열을 안전하게 파싱
 */
function safeJsonParse(text: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(text);
    return toJsonValue(parsed);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`유효하지 않은 JSON: ${e.message}`);
    }
    throw e;
  }
}

/**
 * JsonValue가 JsonObject인지 타입 가드
 */
function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// =============================================================================
// text.template
// =============================================================================

interface TemplateInput {
  template: string;
  variables: JsonObject;
}

function parseTemplateInput(input: JsonObject): TemplateInput {
  const template = input['template'];
  if (typeof template !== 'string') {
    throw new Error('template은 문자열이어야 합니다.');
  }

  const variablesStr = input['variables'];
  if (typeof variablesStr !== 'string') {
    throw new Error('variables는 JSON 문자열이어야 합니다.');
  }

  const parsed = safeJsonParse(variablesStr);
  if (!isJsonObject(parsed)) {
    throw new Error('variables는 JSON 객체여야 합니다.');
  }

  return { template, variables: parsed };
}

/**
 * Mustache-like 템플릿 렌더링
 *
 * 지원:
 * - {{key}}: 단순 변수 치환
 * - {{#key}}...{{/key}}: 조건부 섹션 (truthy일 때 렌더링)
 * - {{^key}}...{{/key}}: 반전 섹션 (falsy일 때 렌더링)
 */
function renderTemplate(template: string, variables: JsonObject): string {
  let result = template;

  // 조건부 섹션: {{#key}}content{{/key}}
  result = result.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match: string, key: string, content: string): string => {
      const value = variables[key];
      if (value && value !== '' && value !== 0 && value !== false) {
        if (Array.isArray(value)) {
          // 배열인 경우 각 항목에 대해 렌더링
          return value
            .map((item): string => {
              if (isJsonObject(item)) {
                return renderTemplate(content, item);
              }
              // 원시값인 경우 {{.}}를 대체
              return content.replace(/\{\{\.\}\}/g, String(item));
            })
            .join('');
        }
        return content;
      }
      return '';
    }
  );

  // 반전 섹션: {{^key}}content{{/key}}
  result = result.replace(
    /\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match: string, key: string, content: string): string => {
      const value = variables[key];
      if (!value || value === '' || value === 0 || value === false) {
        return content;
      }
      return '';
    }
  );

  // 단순 변수 치환: {{key}}
  result = result.replace(
    /\{\{(\w+)\}\}/g,
    (_match: string, key: string): string => {
      const value = variables[key];
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    }
  );

  return result;
}

// =============================================================================
// text.regex
// =============================================================================

type RegexOperation = 'match' | 'replace' | 'test';
const VALID_REGEX_OPERATIONS = new Set<string>(['match', 'replace', 'test']);

function isValidRegexOperation(value: string): value is RegexOperation {
  return VALID_REGEX_OPERATIONS.has(value);
}

/** 허용되는 정규식 플래그 */
const ALLOWED_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y']);

function validateFlags(flags: string): string {
  for (const flag of flags) {
    if (!ALLOWED_FLAGS.has(flag)) {
      throw new Error(`지원하지 않는 정규식 플래그: ${flag}. 지원: ${[...ALLOWED_FLAGS].join(', ')}`);
    }
  }
  // 중복 플래그 제거
  return [...new Set(flags)].join('');
}

interface RegexInput {
  text: string;
  pattern: string;
  flags: string;
  operation: RegexOperation;
  replacement: string | undefined;
}

function parseRegexInput(input: JsonObject): RegexInput {
  const text = input['text'];
  if (typeof text !== 'string') {
    throw new Error('text는 문자열이어야 합니다.');
  }

  const pattern = input['pattern'];
  if (typeof pattern !== 'string') {
    throw new Error('pattern은 문자열이어야 합니다.');
  }

  const operation = input['operation'];
  if (typeof operation !== 'string' || !isValidRegexOperation(operation)) {
    throw new Error(`operation은 match, replace, test 중 하나여야 합니다.`);
  }

  let flags = '';
  const flagsInput = input['flags'];
  if (typeof flagsInput === 'string') {
    flags = validateFlags(flagsInput);
  }

  let replacement: string | undefined;
  const replacementInput = input['replacement'];
  if (typeof replacementInput === 'string') {
    replacement = replacementInput;
  }

  if (operation === 'replace' && replacement === undefined) {
    throw new Error('replace 작업에는 replacement가 필요합니다.');
  }

  return { text, pattern, flags, operation, replacement };
}

// =============================================================================
// text.format
// =============================================================================

type FormatType = 'json' | 'yaml' | 'csv';
const VALID_FORMATS = new Set<string>(['json', 'yaml', 'csv']);

function isValidFormat(value: string): value is FormatType {
  return VALID_FORMATS.has(value);
}

interface FormatInput {
  data: string;
  from: FormatType;
  to: FormatType;
}

function parseFormatInput(input: JsonObject): FormatInput {
  const data = input['data'];
  if (typeof data !== 'string') {
    throw new Error('data는 문자열이어야 합니다.');
  }

  const from = input['from'];
  if (typeof from !== 'string' || !isValidFormat(from)) {
    throw new Error(`from은 json, yaml, csv 중 하나여야 합니다.`);
  }

  const to = input['to'];
  if (typeof to !== 'string' || !isValidFormat(to)) {
    throw new Error(`to는 json, yaml, csv 중 하나여야 합니다.`);
  }

  return { data, from, to };
}

/**
 * 간단한 YAML 파서 (외부 라이브러리 없이)
 *
 * 지원:
 * - key: value (문자열, 숫자, boolean, null)
 * - 중첩 객체 (인덴트 기반)
 * - 배열 (- item 형태)
 */
function parseSimpleYaml(text: string): JsonValue {
  const lines = text.split('\n');
  const result: JsonObject = {};
  let currentKey = '';
  const stack: Array<{ obj: JsonObject; indent: number }> = [{ obj: result, indent: -1 }];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // 스택에서 현재 인덴트에 맞는 레벨 찾기
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const current = stack[stack.length - 1].obj;

    // 배열 항목: - value
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      const arr = current[currentKey];
      if (Array.isArray(arr)) {
        arr.push(parseYamlValue(value));
      }
      continue;
    }

    // key: value
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const valueStr = trimmed.slice(colonIndex + 1).trim();

      if (valueStr === '') {
        // 다음 라인에 중첩 값이 올 수 있음
        const nextObj: JsonObject = {};
        current[key] = nextObj;
        stack.push({ obj: nextObj, indent });
        currentKey = key;
      } else if (valueStr.startsWith('[') || valueStr === '[]') {
        // 인라인 배열 시작 또는 빈 배열
        if (valueStr === '[]') {
          current[key] = [];
        } else {
          current[key] = parseYamlValue(valueStr);
        }
        currentKey = key;
      } else {
        current[key] = parseYamlValue(valueStr);
        currentKey = key;
      }
    }
  }

  return result;
}

function parseYamlValue(value: string): JsonValue {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  // 따옴표로 감싸진 문자열
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // 숫자
  const num = Number(value);
  if (!isNaN(num) && value !== '') {
    return num;
  }

  return value;
}

/**
 * JsonValue를 간단한 YAML 문자열로 직렬화
 */
function toSimpleYaml(value: JsonValue, indent: number = 0): string {
  const prefix = '  '.repeat(indent);

  if (value === null) return `${prefix}null`;
  if (typeof value === 'string') return `${prefix}${value}`;
  if (typeof value === 'number') return `${prefix}${value}`;
  if (typeof value === 'boolean') return `${prefix}${String(value)}`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `${prefix}[]`;
    return value
      .map((item): string => {
        if (isJsonObject(item)) {
          const inner = toSimpleYaml(item, indent + 1).trimStart();
          return `${prefix}- ${inner}`;
        }
        return `${prefix}- ${item === null ? 'null' : String(item)}`;
      })
      .join('\n');
  }

  if (isJsonObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${prefix}{}`;
    return entries
      .map(([k, v]): string => {
        if (isJsonObject(v) || Array.isArray(v)) {
          return `${prefix}${k}:\n${toSimpleYaml(v, indent + 1)}`;
        }
        return `${prefix}${k}: ${v === null ? 'null' : String(v)}`;
      })
      .join('\n');
  }

  return `${prefix}${String(value)}`;
}

/**
 * CSV 문자열을 JSON 배열(배열의 배열)로 파싱
 */
function parseCsv(text: string): JsonValue {
  const lines = text.split('\n').filter(line => line.trim() !== '');
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows: JsonObject[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: JsonObject = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (typeof header === 'string') {
        row[header] = j < values.length ? (values[j] ?? null) : null;
      }
    }
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // 이스케이프된 따옴표 건너뛰기
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

/**
 * JSON 배열(객체 배열)을 CSV 문자열로 변환
 */
function toCsv(value: JsonValue): string {
  if (!Array.isArray(value)) {
    throw new Error('CSV로 변환하려면 데이터가 배열이어야 합니다.');
  }

  if (value.length === 0) {
    return '';
  }

  // 첫 번째 항목에서 헤더 추출
  const first = value[0];
  if (!isJsonObject(first)) {
    throw new Error('CSV로 변환하려면 데이터가 객체 배열이어야 합니다.');
  }

  const headers = Object.keys(first);
  const headerLine = headers.map(escapeCsvValue).join(',');

  const dataLines = value.map((item): string => {
    if (!isJsonObject(item)) {
      return headers.map(() => '').join(',');
    }
    return headers
      .map((h): string => {
        const val = item[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return escapeCsvValue(JSON.stringify(val));
        return escapeCsvValue(String(val));
      })
      .join(',');
  });

  return [headerLine, ...dataLines].join('\n');
}

function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * 포맷 변환 실행
 */
function convertFormat(data: string, from: FormatType, to: FormatType): string {
  if (from === to) {
    return data;
  }

  // 원본 포맷에서 JsonValue로 파싱
  let parsed: JsonValue;
  switch (from) {
    case 'json':
      parsed = safeJsonParse(data);
      break;
    case 'yaml':
      parsed = parseSimpleYaml(data);
      break;
    case 'csv':
      parsed = parseCsv(data);
      break;
  }

  // 대상 포맷으로 직렬화
  switch (to) {
    case 'json':
      return JSON.stringify(parsed, null, 2);
    case 'yaml':
      return toSimpleYaml(parsed);
    case 'csv':
      return toCsv(parsed);
  }
}

// =============================================================================
// Tool handlers
// =============================================================================

export const handlers: Record<string, ToolHandler> = {
  /**
   * text.template - Mustache-like 템플릿 렌더링
   */
  'text.template': async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseTemplateInput(input);
    const rendered = renderTemplate(parsed.template, parsed.variables);

    return {
      result: rendered,
      success: true,
    };
  },

  /**
   * text.regex - 정규식 매칭/치환
   */
  'text.regex': async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseRegexInput(input);

    let regex: RegExp;
    try {
      regex = new RegExp(parsed.pattern, parsed.flags);
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`유효하지 않은 정규식: ${e.message}`);
      }
      throw e;
    }

    switch (parsed.operation) {
      case 'match': {
        const matches = parsed.text.match(regex);
        return {
          matches: matches !== null ? [...matches] : [],
          found: matches !== null,
          count: matches !== null ? matches.length : 0,
          success: true,
        };
      }

      case 'replace': {
        const replaced = parsed.text.replace(regex, parsed.replacement ?? '');
        return {
          result: replaced,
          success: true,
        };
      }

      case 'test': {
        const found = regex.test(parsed.text);
        return {
          found,
          success: true,
        };
      }
    }
  },

  /**
   * text.format - 포맷 변환 (JSON/YAML/CSV)
   */
  'text.format': async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseFormatInput(input);
    const result = convertFormat(parsed.data, parsed.from, parsed.to);

    return {
      result,
      from: parsed.from,
      to: parsed.to,
      success: true,
    };
  },
};
