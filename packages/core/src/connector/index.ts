/**
 * Goondan Connector 시스템 (v1.0)
 *
 * Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는
 * 실행 패키지이다. Connection은 Connector와 Agent 사이의 배포 바인딩을 정의한다.
 *
 * @see /docs/specs/connector.md
 * @see /docs/specs/connection.md
 * @packageDocumentation
 */

// Types
export type {
  ConnectorEntryFunction,
  ConnectorContext,
  ConnectorTriggerEvent,
  ConnectorEvent,
  ConnectorEventMessage,
  TriggerPayload,
  HttpTriggerPayload,
  CronTriggerPayload,
  CliTriggerPayload,
  CustomTriggerPayload,
  OAuthTokenRequest,
  OAuthTokenResult,
} from './types.js';

// Ingress
export {
  matchIngressRule,
  routeEvent,
  IngressMatcher,
} from './ingress.js';

// Trigger (Entry Function loading)
export {
  createConnectorContext,
  loadConnectorEntry,
  validateConnectorEntry,
} from './trigger.js';
export type {
  CreateConnectorContextOptions,
  ValidateEntryResult,
} from './trigger.js';
