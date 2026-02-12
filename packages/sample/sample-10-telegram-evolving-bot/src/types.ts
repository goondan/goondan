export type JsonRecord = Record<string, unknown>;

export type ConnectorEventMessage =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "file"; url: string; name: string };

export interface ConnectorEvent {
  name: string;
  message: ConnectorEventMessage;
  properties: Record<string, string>;
  instanceKey: string;
}

export interface ConnectorContext {
  emit(event: ConnectorEvent): Promise<void>;
  secrets: Record<string, string>;
  logger: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

export function readString(
  record: JsonRecord,
  key: string,
): string | undefined {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

export function readNumber(
  record: JsonRecord,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "알 수 없는 오류";
}
