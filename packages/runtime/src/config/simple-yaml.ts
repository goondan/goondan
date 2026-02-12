import { isJsonObject } from "../types.js";

interface ParsedLine {
  indent: number;
  content: string;
  line: number;
}

interface ParseResult {
  value: unknown;
  nextIndex: number;
}

export function splitYamlDocuments(input: string): string[] {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const documents: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim() === "---") {
      if (current.some((entry) => entry.trim().length > 0)) {
        documents.push(current.join("\n"));
      }
      current = [];
      continue;
    }

    current.push(line);
  }

  if (current.some((entry) => entry.trim().length > 0)) {
    documents.push(current.join("\n"));
  }

  return documents;
}

export function parseYamlDocument(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {};
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  const lines = tokenize(input);
  if (lines.length === 0) {
    return {};
  }

  const firstLine = lines[0];
  if (firstLine === undefined) {
    return {};
  }

  const parsed = parseBlock(lines, 0, firstLine.indent);
  return parsed.value;
}

function tokenize(input: string): ParsedLine[] {
  const rawLines = input.replace(/\r\n/g, "\n").split("\n");
  const tokens: ParsedLine[] = [];

  rawLines.forEach((rawLine, index) => {
    const withoutComment = stripComment(rawLine);
    const trimmed = withoutComment.trim();
    if (trimmed.length === 0) {
      return;
    }

    const indent = countIndent(withoutComment);
    if (indent % 2 !== 0) {
      throw new Error(`Invalid indentation at line ${index + 1}`);
    }

    tokens.push({
      indent,
      content: withoutComment.slice(indent),
      line: index + 1,
    });
  });

  return tokens;
}

function stripComment(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("#")) {
    return "";
  }

  return line;
}

function countIndent(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") {
    count += 1;
  }
  return count;
}

function parseBlock(lines: ParsedLine[], startIndex: number, indent: number): ParseResult {
  const line = lines[startIndex];
  if (line === undefined) {
    return { value: {}, nextIndex: startIndex };
  }

  if (line.indent < indent) {
    return { value: {}, nextIndex: startIndex };
  }

  if (line.indent === indent && line.content.startsWith("-")) {
    return parseArray(lines, startIndex, indent);
  }

  return parseObject(lines, startIndex, indent);
}

function parseArray(lines: ParsedLine[], startIndex: number, indent: number): ParseResult {
  const items: unknown[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) {
      break;
    }

    if (line.indent < indent) {
      break;
    }

    if (line.indent !== indent || !line.content.startsWith("-")) {
      break;
    }

    const afterDash = line.content.slice(1).trimStart();
    if (afterDash.length === 0) {
      const nestedStart = index + 1;
      const nestedLine = lines[nestedStart];
      if (nestedLine === undefined || nestedLine.indent <= indent) {
        items.push(null);
        index += 1;
        continue;
      }

      const nested = parseBlock(lines, nestedStart, nestedLine.indent);
      items.push(nested.value);
      index = nested.nextIndex;
      continue;
    }

    if (looksLikeKeyValue(afterDash)) {
      const kv = parseKeyValue(afterDash, line.line);
      const objectValue: Record<string, unknown> = {};

      if (kv.valuePart.length === 0) {
        const nestedStart = index + 1;
        const nestedLine = lines[nestedStart];
        if (nestedLine !== undefined && nestedLine.indent > indent) {
          const nested = parseBlock(lines, nestedStart, nestedLine.indent);
          objectValue[kv.key] = nested.value;
          index = nested.nextIndex;
        } else {
          objectValue[kv.key] = {};
          index += 1;
        }
      } else {
        objectValue[kv.key] = parseScalar(kv.valuePart);
        index += 1;
      }

      const currentLine = lines[index];
      if (currentLine !== undefined && currentLine.indent > indent) {
        const continuation = parseObject(lines, index, indent + 2, objectValue);
        items.push(continuation.value);
        index = continuation.nextIndex;
      } else {
        items.push(objectValue);
      }

      continue;
    }

    items.push(parseScalar(afterDash));
    index += 1;
  }

  return {
    value: items,
    nextIndex: index,
  };
}

function parseObject(
  lines: ParsedLine[],
  startIndex: number,
  indent: number,
  initial: Record<string, unknown> = {},
): ParseResult {
  const objectValue: Record<string, unknown> = { ...initial };
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) {
      break;
    }

    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.line}`);
    }

    if (line.content.startsWith("-")) {
      break;
    }

    const kv = parseKeyValue(line.content, line.line);
    if (kv.valuePart.length === 0) {
      const nestedStart = index + 1;
      const nestedLine = lines[nestedStart];
      if (nestedLine !== undefined && nestedLine.indent > indent) {
        const nested = parseBlock(lines, nestedStart, nestedLine.indent);
        objectValue[kv.key] = nested.value;
        index = nested.nextIndex;
      } else {
        objectValue[kv.key] = {};
        index += 1;
      }
      continue;
    }

    objectValue[kv.key] = parseScalar(kv.valuePart);
    index += 1;
  }

  return {
    value: objectValue,
    nextIndex: index,
  };
}

function looksLikeKeyValue(value: string): boolean {
  return value.includes(":");
}

function parseKeyValue(value: string, line: number): { key: string; valuePart: string } {
  const delimiter = value.indexOf(":");
  if (delimiter <= 0) {
    throw new Error(`Invalid key/value pair at line ${line}`);
  }

  const key = value.slice(0, delimiter).trim();
  const valuePart = value.slice(delimiter + 1).trimStart();
  return {
    key,
    valuePart,
  };
}

function parseScalar(value: string): unknown {
  if (value === "null" || value === "~") {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (isNumeric(value)) {
    return Number(value);
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    try {
      return JSON.parse(value.replace(/'/g, '"'));
    } catch {
      return value;
    }
  }

  return value;
}

function isNumeric(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

export function parseYamlDocuments(input: string): unknown[] {
  const documents = splitYamlDocuments(input);
  return documents.map((document) => parseYamlDocument(document));
}

export function ensureObject(value: unknown, message: string): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new Error(message);
  }

  return value;
}
