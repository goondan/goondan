/**
 * Goondan Connector 시스템
 *
 * Connector는 외부 채널 이벤트를 수신하여 SwarmInstance/AgentInstance로 라우팅하고,
 * 진행상황 업데이트와 완료 보고를 같은 맥락으로 송신하는 컴포넌트이다.
 *
 * @see /docs/specs/connector.md
 * @packageDocumentation
 */

// Types
export type {
  ConnectorAdapter,
  ConnectorSendInput,
  ConnectorOptions,
  ConnectorFactory,
  RuntimeEventHandler,
  RuntimeEventInput,
  TriggerHandler,
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  // TurnAuth, OAuthTokenRequest, OAuthTokenResult are exported from oauth module
  // Use `import type { TurnAuth } from './types.js'` directly if needed
  TurnAuth as ConnectorTurnAuth,
  OAuthTokenRequest as ConnectorOAuthTokenRequest,
  OAuthTokenResult as ConnectorOAuthTokenResult,
  LiveConfigPatch,
} from './types.js';

// JSONPath
export { readJsonPath, isValidJsonPath, readSimplePath } from './jsonpath.js';

// Ingress
export {
  matchIngressRule,
  routeEvent,
  createCanonicalEventFromIngress,
  IngressMatcher,
} from './ingress.js';
export type { CreateCanonicalEventOptions } from './ingress.js';

// Egress
export { EgressHandler, createEgressHandler } from './egress.js';
export type { EgressOptions } from './egress.js';

// Trigger
export {
  TriggerExecutor,
  createTriggerContext,
  loadTriggerModule,
  validateTriggerHandlers,
} from './trigger.js';
export type {
  TriggerExecutorOptions,
  CreateTriggerContextOptions,
  ValidateResult,
} from './trigger.js';

// Canonical
export {
  createCanonicalEvent,
  validateCanonicalEvent,
  toRuntimeEventInput,
} from './canonical.js';
export type { CreateCanonicalEventParams, ValidationResult } from './canonical.js';

// Adapter
export { BaseConnectorAdapter, createConnectorAdapter } from './adapter.js';
export type { BaseConnectorAdapterOptions } from './adapter.js';
