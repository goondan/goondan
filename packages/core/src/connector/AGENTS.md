# Connector 모듈

## 개요

Connector 모듈은 외부 채널 이벤트를 수신하여 SwarmInstance/AgentInstance로 라우팅하고, 진행상황 업데이트와 완료 보고를 같은 맥락으로 송신하는 컴포넌트이다.

## 핵심 책임

1. **Ingress**: 외부 이벤트(Slack 메시지, CLI 입력, Webhook 등)를 canonical event로 변환하여 Runtime에 전달
2. **Egress**: AgentInstance의 응답을 외부 채널로 전송 (진행상황 업데이트, 최종 응답)
3. **인증 컨텍스트 설정**: Turn의 `origin`과 `auth` 정보를 채워 OAuth 통합 지원

## 파일 구조

```
connector/
├── types.ts          # Connector 관련 타입 정의
├── adapter.ts        # ConnectorAdapter 베이스 구현
├── ingress.ts        # Ingress 라우팅 로직 (match, route)
├── egress.ts         # Egress 정책 처리 (debounce, updatePolicy)
├── trigger.ts        # TriggerHandler 실행 (executor, context)
├── jsonpath.ts       # JSONPath 표현식 해석
├── canonical.ts      # CanonicalEvent 처리 (생성, 검증, 변환)
├── index.ts          # 모든 기능 re-export
└── AGENTS.md         # 이 파일
```

## 핵심 타입

### ConnectorAdapter

```typescript
interface ConnectorAdapter {
  handleEvent(payload: JsonObject): Promise<void>;
  send?(input: ConnectorSendInput): Promise<unknown>;
  shutdown?(): Promise<void>;
}
```

### CanonicalEvent

```typescript
interface CanonicalEvent {
  type: string;                    // 이벤트 타입
  swarmRef: ObjectRefLike;         // 대상 Swarm
  instanceKey: string;             // 인스턴스 식별자
  input: string;                   // LLM 입력 텍스트
  agentName?: string;              // 선택: 대상 에이전트
  origin?: JsonObject;             // 호출 맥락
  auth?: TurnAuth;                 // 인증 컨텍스트
  metadata?: JsonObject;           // 추가 메타데이터
}
```

### TriggerHandler

```typescript
type TriggerHandler = (
  event: TriggerEvent,
  connection: JsonObject,
  ctx: TriggerContext
) => Promise<void>;
```

## 사용 예시

### BaseConnectorAdapter 사용

```typescript
import { BaseConnectorAdapter } from './adapter.js';

const adapter = new BaseConnectorAdapter({
  runtime: { handleEvent: async (event) => { /* ... */ } },
  connectorConfig: connectorResource,
  buildOrigin: (payload) => ({ connector: 'my-connector', channel: payload.channel }),
  buildAuth: (payload) => ({
    actor: { type: 'user', id: payload.userId },
    subjects: { global: `team:${payload.teamId}` },
  }),
});

await adapter.handleEvent({ text: 'Hello', channel: 'C123' });
```

### TriggerExecutor 사용

```typescript
import { TriggerExecutor } from './trigger.js';

const executor = new TriggerExecutor({
  onEmit: async (event) => { /* Runtime에 전달 */ },
  logger: console,
  connector: connectorResource,
});

executor.registerHandler('onWebhook', async (event, connection, ctx) => {
  await ctx.emit({
    type: 'webhook',
    swarmRef: { kind: 'Swarm', name: 'default' },
    instanceKey: event.payload.requestId,
    input: event.payload.message,
  });
});
```

## 참고 문서

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/api.md` - Connector API
- `/packages/core/src/types/specs/connector.ts` - Connector 리소스 타입

## 개발 규칙

1. **타입 단언 금지**: `as` 사용 금지, 타입 가드로 처리
2. **TDD 방식**: 테스트 먼저 작성 후 구현
3. **스펙 준수**: MUST/SHOULD/MAY 규칙 엄격히 준수
4. **JSONPath**: jsonpath-plus 패키지 사용
