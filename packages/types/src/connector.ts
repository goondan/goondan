import { isPlainObject } from "./json.js";

/**
 * Connector 이벤트 메시지 (멀티모달)
 * 원형: docs/specs/connector.md 5.3절
 */
export type ConnectorEventMessage =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "file"; url: string; name: string };

/**
 * 정규화된 Connector 이벤트
 * 원형: docs/specs/connector.md 5.3절
 */
export interface ConnectorEvent {
  readonly name: string;
  readonly message: ConnectorEventMessage;
  readonly properties: Record<string, string>;
  readonly instanceKey: string;
}

/**
 * Connector Entry 함수에 전달되는 컨텍스트
 * 원형: docs/specs/connector.md 5.2절
 */
export interface ConnectorContext {
  emit(event: ConnectorEvent): Promise<void>;
  readonly secrets: Record<string, string>;
  readonly logger: Console;
}

/** ConnectorEventMessage 타입 가드 */
export function isConnectorEventMessage(value: unknown): value is ConnectorEventMessage {
  if (!isPlainObject(value)) return false;

  if (value.type === "text") return typeof value.text === "string";
  if (value.type === "image") return typeof value.url === "string";
  if (value.type === "file") return typeof value.url === "string" && typeof value.name === "string";
  return false;
}

/** ConnectorEvent 타입 가드 */
export function isConnectorEvent(value: unknown): value is ConnectorEvent {
  if (!isPlainObject(value)) return false;

  return (
    typeof value.name === "string" &&
    isConnectorEventMessage(value.message) &&
    isPlainObject(value.properties) &&
    typeof value.instanceKey === "string"
  );
}
