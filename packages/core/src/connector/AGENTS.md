# Connector 모듈 (v1.0)

## 개요

Connector 모듈은 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 실행 패키지를 지원한다. Connection은 Connector와 Agent 사이의 배포 바인딩을 정의한다.

## 핵심 책임

1. **프로토콜 수신 선언**: 어떤 방식(HTTP webhook, cron, CLI, custom 등)으로 외부 이벤트를 수신할지 선언
2. **이벤트 정규화**: 외부 프로토콜별 페이로드를 ConnectorEvent로 변환
3. **Ingress 라우팅**: ConnectorEvent의 name/properties를 기반으로 Agent에 라우팅
4. **Entry Function 로딩**: Connector의 단일 default export 함수를 로드하고 ConnectorContext를 생성

## v1.0 주요 변경

- `ConnectorAdapter`, `CanonicalEvent`, `TriggerHandler`, `TriggerEvent`, `TriggerContext` 삭제
- `EgressHandler`, `JSONPath`, `BaseConnectorAdapter` 삭제
- `ConnectorEntryFunction`, `ConnectorContext`, `ConnectorTriggerEvent`, `ConnectorEvent` 추가
- `CustomTriggerPayload` 추가: Connector 자체 이벤트 소스 관리 (롱 폴링, WebSocket 등)
- IngressMatch: `command/eventType/channel` -> `event/properties` 기반
- IngressRoute: `swarmRef/instanceKeyFrom/inputFrom/agentName` -> `agentRef` (선택)
- ConnectorSpec: `type` 제거, `runtime/entry/triggers(프로토콜 선언)/events(이벤트 스키마)` 추가

## 파일 구조

```
connector/
├── types.ts          # ConnectorContext, ConnectorEvent, ConnectorTriggerEvent 등 런타임 타입
├── ingress.ts        # Ingress 라우팅 로직 (ConnectorEvent 기반 match/route)
├── trigger.ts        # Entry Function 로딩 (loadConnectorEntry, createConnectorContext)
├── index.ts          # 모든 기능 re-export
└── AGENTS.md         # 이 파일
```

## 핵심 타입

### ConnectorEntryFunction

```typescript
type ConnectorEntryFunction = (context: ConnectorContext) => Promise<void>;
```

### ConnectorContext

```typescript
interface ConnectorContext {
  event: ConnectorTriggerEvent;
  connection: Resource<ConnectionSpec>;
  connector: Resource<ConnectorSpec>;
  emit: (event: ConnectorEvent) => Promise<void>;
  logger: Console;
  oauth?: { getAccessToken: (request: OAuthTokenRequest) => Promise<OAuthTokenResult> };
  verify?: { webhook?: { signingSecret: string } };
}
```

### ConnectorEvent

```typescript
interface ConnectorEvent {
  type: 'connector.event';
  name: string;
  message: ConnectorEventMessage;
  properties?: JsonObject;
  auth?: { actor: { id: string; name?: string }; subjects: { global?: string; user?: string } };
}
```

### ConnectorTriggerEvent

```typescript
interface ConnectorTriggerEvent {
  type: 'connector.trigger';
  trigger: TriggerPayload;
  timestamp: string;
}
```

### TriggerPayload (4가지)

- `HttpTriggerPayload` - HTTP Webhook 수신
- `CronTriggerPayload` - 스케줄 기반 실행
- `CliTriggerPayload` - CLI 입력 수신
- `CustomTriggerPayload` - Connector 자체 이벤트 소스 관리 (`signal: AbortSignal`)

## 참고 문서

- `/docs/specs/connector.md` - Connector 시스템 스펙 (v1.0)
- `/docs/specs/connection.md` - Connection 시스템 스펙 (v1.0)
- `/docs/specs/api.md` - Connector API
- `/packages/core/src/types/specs/connector.ts` - ConnectorSpec 리소스 타입
- `/packages/core/src/types/specs/connection.ts` - ConnectionSpec 리소스 타입

## 개발 규칙

1. **타입 단언 금지**: `as` 사용 금지, 타입 가드로 처리
2. **TDD 방식**: 테스트 먼저 작성 후 구현
3. **스펙 준수**: MUST/SHOULD/MAY 규칙 엄격히 준수
