# Goondan Connector 스펙 (v1.0)

본 문서는 Connector 시스템의 구현 스펙을 정의한다. Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 역할을 한다.

> **v1.0 주요 변경**: spec.type 제거, triggers를 프로토콜 선언으로 변경, events 스키마 추가, 단일 default export 모델, ConnectorAdapter/send/egress/HealthCheck/Reconnection 삭제.

---

## 1. 개요

Connector는 외부 프로토콜 이벤트에 반응하여, 정합성 검증을 통해 **정규화된 ConnectorEvent**를 발행하는 실행 패키지이다.

### 1.1 핵심 책임

1. **프로토콜 수신 선언**: 어떤 방식(HTTP webhook, cron, CLI 등)으로 외부 이벤트를 수신할지 선언
2. **이벤트 스키마 선언**: 커넥터가 발행할 수 있는 이벤트의 이름과 속성 타입을 선언
3. **이벤트 정규화**: 외부 프로토콜별 페이로드를 ConnectorEvent로 변환
4. **서명 검증**: Connection이 제공한 서명 시크릿을 사용하여 inbound 요청의 무결성 검증

### 1.2 Connector가 하지 않는 것

- **라우팅**: 어떤 Agent로 이벤트를 전달할지는 Connection의 ingress rules가 담당
- **인증 정보 보유**: OAuth/Token 등 인증 자격 증명은 Connection이 제공
- **응답 전송**: 에이전트 응답은 Tool을 통해 전송 (send/egress 없음)
- **인스턴스 관리**: Instance/Turn/Step 등 에이전트 실행 모델을 직접 제어하지 않음

### 1.3 설계 원칙

- Connector는 인증 정보(자격 증명)를 자체적으로 보유하지 않되, Connection이 제공한 서명 시크릿을 사용하여 프로토콜 수준의 서명 검증을 수행한다(MUST).
- Connector는 배포 환경 설정(auth, rules)을 포함하지 않는다(MUST).
- 하나의 Connector에 여러 Connection을 바인딩할 수 있다(MAY).
- Entry 함수는 Connection마다 호출된다. 동일 trigger event에 대해 각 Connection별로 entry 함수가 호출된다(MUST).

---

## 2. Connector 리소스 스키마

### 2.1 기본 구조

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: <connector-name>
  labels: {}              # 선택
spec:
  runtime: node
  entry: "./connectors/<name>/index.ts"

  triggers:
    - type: http
      endpoint:
        path: /webhook/<name>/events
        method: POST
    # 또는
    - type: cron
      schedule: "*/5 * * * *"
    # 또는
    - type: cli

  events:
    - name: <event-name>
      properties:
        <key>: { type: string }
```

### 2.2 ConnectorSpec TypeScript 인터페이스

```ts
interface ConnectorSpec {
  /** 런타임 환경 */
  runtime: 'node';

  /** 엔트리 파일 경로 (단일 default export) */
  entry: string;

  /** Trigger 프로토콜 선언 목록 */
  triggers: TriggerDeclaration[];

  /** 커넥터가 emit할 수 있는 이벤트 스키마 */
  events?: EventSchema[];
}

type TriggerDeclaration =
  | HttpTrigger
  | CronTrigger
  | CliTrigger;

interface HttpTrigger {
  type: 'http';
  endpoint: {
    path: string;
    method: 'POST' | 'GET' | 'PUT' | 'DELETE';
  };
}

interface CronTrigger {
  type: 'cron';
  schedule: string;  // cron 표현식
}

interface CliTrigger {
  type: 'cli';
}

interface EventSchema {
  /** 이벤트 이름 */
  name: string;
  /** 이벤트 속성 타입 선언 */
  properties?: Record<string, EventPropertyType>;
}

interface EventPropertyType {
  type: 'string' | 'number' | 'boolean';
  optional?: boolean;
}
```

### 2.3 Connector vs Connection 분리 요약

| 항목 | Connector | Connection |
|------|-----------|------------|
| `runtime` / `entry` | O | - |
| `triggers` (프로토콜 선언) | O | - |
| `events` (이벤트 스키마) | O | - |
| `auth` | - | O |
| `verify` | - | O |
| `ingress.rules` | - | O |
| `connectorRef` | - | O |

> Connection 리소스의 상세 스키마는 [`docs/specs/connection.md`](./connection.md)를 참조한다.

---

## 3. Trigger 프로토콜 선언

Connector의 `triggers` 필드는 외부 이벤트를 어떤 프로토콜로 수신할지 선언한다. 각 trigger는 프로토콜 타입과 해당 프로토콜에 필요한 설정을 포함한다.

### 3.1 HTTP Trigger

HTTP Webhook을 통해 이벤트를 수신한다.

```yaml
triggers:
  - type: http
    endpoint:
      path: /webhook/slack/events
      method: POST
```

```ts
interface HttpTrigger {
  type: 'http';
  endpoint: {
    /** Webhook 수신 경로 */
    path: string;
    /** HTTP 메서드 */
    method: 'POST' | 'GET' | 'PUT' | 'DELETE';
  };
}
```

규칙:
1. `endpoint.path`는 `/`로 시작해야 한다(MUST).
2. Runtime은 해당 경로로 들어오는 HTTP 요청을 Connector의 entry 함수로 전달해야 한다(MUST).

### 3.2 Cron Trigger

주기적 스케줄에 따라 이벤트를 생성한다.

```yaml
triggers:
  - type: cron
    schedule: "0 9 * * MON-FRI"
```

```ts
interface CronTrigger {
  type: 'cron';
  /** cron 표현식 (5-field 또는 6-field) */
  schedule: string;
}
```

규칙:
1. `schedule`은 유효한 cron 표현식이어야 한다(MUST).
2. Runtime은 스케줄에 따라 entry 함수를 호출해야 한다(MUST).

### 3.3 CLI Trigger

CLI 입력을 통해 이벤트를 수신한다.

```yaml
triggers:
  - type: cli
```

```ts
interface CliTrigger {
  type: 'cli';
}
```

규칙:
1. CLI trigger는 Runtime의 인터랙티브 모드에서 사용자 입력을 수신한다(MUST).
2. 하나의 Connector에 CLI trigger는 최대 1개만 허용된다(SHOULD).

---

## 4. Events 스키마

Connector의 `events` 필드는 해당 커넥터가 emit할 수 있는 이벤트의 이름과 속성 타입을 선언한다. Connection의 `ingress.rules[].match.event`는 이 스키마에 선언된 이벤트 이름과 매칭된다.

### 4.1 Events 정의

```yaml
events:
  - name: app_mention
    properties:
      channel_id: { type: string }
      ts: { type: string }
      thread_ts: { type: string, optional: true }
  - name: message.im
    properties:
      channel_id: { type: string }
      ts: { type: string }
```

```ts
interface EventSchema {
  /** 이벤트 이름 (Connection match에서 참조) */
  name: string;
  /** 이벤트 속성 타입 선언 */
  properties?: Record<string, EventPropertyType>;
}

interface EventPropertyType {
  type: 'string' | 'number' | 'boolean';
  optional?: boolean;
}
```

규칙:
1. `events[].name`은 Connector 내에서 고유해야 한다(MUST).
2. Connection의 `match.event`는 이 스키마에 선언된 이름과 일치해야 한다(SHOULD).
3. `events`가 생략되면 커넥터는 임의의 이벤트 이름으로 emit할 수 있다(MAY).

---

## 5. Entry Function 실행 모델

### 5.1 단일 Default Export

Connector의 entry 모듈은 **단일 default export 함수**를 제공해야 한다(MUST).

```ts
/** Connector Entry Function */
type ConnectorEntryFunction = (
  context: ConnectorContext
) => Promise<void>;

export default async function (context: ConnectorContext): Promise<void> {
  // 이벤트 처리 및 emit
}
```

규칙:
1. Entry 모듈은 단일 default export를 제공해야 한다(MUST).
2. Named export(onWebhook, onCron 등) 패턴은 더 이상 사용하지 않는다.
3. Runtime은 Connector 초기화 시점에 entry 모듈을 한 번 로드해야 한다(MUST).

### 5.2 ConnectorContext

Entry 함수에 전달되는 컨텍스트이다. **Connection마다 한 번씩** 호출된다.

```ts
interface ConnectorContext {
  /** 트리거 이벤트 정보 */
  event: ConnectorTriggerEvent;

  /** 현재 Connection 리소스 */
  connection: Resource<ConnectionSpec>;

  /** Connector 리소스 */
  connector: Resource<ConnectorSpec>;

  /** ConnectorEvent 발행 */
  emit: (event: ConnectorEvent) => Promise<void>;

  /** 로깅 */
  logger: Console;

  /** OAuth 토큰 접근 (Connection의 OAuthApp 기반 모드인 경우) */
  oauth?: {
    getAccessToken: (request: OAuthTokenRequest) => Promise<OAuthTokenResult>;
  };

  /** 서명 검증 정보 (Connection의 verify 블록에서 해석) */
  verify?: {
    webhook?: {
      /** 서명 시크릿 (Connection의 verify.webhook.signingSecret에서 해석된 값) */
      signingSecret: string;
    };
  };
}
```

### 5.3 ConnectorTriggerEvent

트리거 프로토콜별 페이로드를 캡슐화한다.

```ts
interface ConnectorTriggerEvent {
  type: 'connector.trigger';
  trigger: TriggerPayload;
  timestamp: string;
}

type TriggerPayload =
  | HttpTriggerPayload
  | CronTriggerPayload
  | CliTriggerPayload;

interface HttpTriggerPayload {
  type: 'http';
  payload: {
    request: {
      method: string;
      path: string;
      headers: Record<string, string>;
      body: JsonObject;
      rawBody?: string;
    };
  };
}

interface CronTriggerPayload {
  type: 'cron';
  payload: {
    schedule: string;
    scheduledAt: string;
  };
}

interface CliTriggerPayload {
  type: 'cli';
  payload: {
    text: string;
    instanceKey?: string;
  };
}
```

### 5.4 ConnectorEvent

Entry 함수가 `ctx.emit()`으로 발행하는 정규화된 이벤트이다.

```ts
type ConnectorEventMessage =
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "file"; data: string; mediaType: string };

interface ConnectorEvent {
  /** 이벤트 타입 (고정) */
  type: "connector.event";

  /** 이벤트 이름 (connector의 events[]에 선언된 이름) */
  name: string;

  /** 멀티모달 입력 메시지 */
  message: ConnectorEventMessage;

  /** 이벤트 속성 (events[].properties에 선언된 키-값) */
  properties?: JsonObject;

  /** 인증 컨텍스트 */
  auth?: {
    actor: { id: string; name?: string };
    subjects: { global?: string; user?: string };
  };
}
```

규칙:
1. `name`은 Connector의 `events[].name`에 선언된 이벤트 이름이어야 한다(SHOULD).
2. `message`는 최소 하나의 콘텐츠 타입을 포함해야 한다(MUST).
3. `properties`의 키는 `events[].properties`에 선언된 키와 일치해야 한다(SHOULD).
4. `auth`는 Turn 생성 시 `turn.auth`로 전달된다(MUST).

### 5.5 서명 검증 규칙

Connection이 `verify` 블록을 설정한 경우, Connector는 다음 규칙을 따라야 한다.

1. Connector는 Connection이 제공한 서명 시크릿(`context.verify.webhook.signingSecret`)을 사용하여 inbound 요청의 서명을 검증해야 한다(MUST).
2. 서명 검증 실패 시 Connector는 ConnectorEvent를 emit하지 않고 처리를 거부해야 한다(MUST).
3. 서명 검증 실패 시 Connector는 실패 사유를 `context.logger`로 기록해야 한다(SHOULD).
4. `context.verify`가 제공되지 않은 경우(Connection에 verify 블록이 없는 경우), 서명 검증을 건너뛸 수 있다(MAY).

---

## 6. Connector Event Flow

```
[외부 이벤트 (HTTP/Cron/CLI)]
     |
     v
[Runtime: trigger 수신]
     |
     |  Connection 목록 조회 (connectorRef가 이 Connector를 참조하는 Connection들)
     |
     v
[Connection마다 Entry Function 호출]
     |  context.event: ConnectorTriggerEvent
     |  context.connection: 현재 Connection
     |  context.verify: 서명 검증 정보
     |
     |  서명 검증 → ctx.emit(ConnectorEvent)
     v
[Runtime: ConnectorEvent 수신]
     |
     |  Connection.ingress.rules로 매칭
     |  match.event와 ConnectorEvent.name 비교
     |
     v
[매칭된 rule의 route에 따라 AgentInstance로 라우팅]
     |  agentRef → 특정 Agent로 / 생략 → entrypoint Agent로
     |
     v
[Turn 처리]
```

---

## 7. 예시: Slack Connector

### 7.1 YAML 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  runtime: node
  entry: "./connectors/slack/index.ts"

  triggers:
    - type: http
      endpoint:
        path: /webhook/slack/events
        method: POST

  events:
    - name: app_mention
      properties:
        channel_id: { type: string }
        ts: { type: string }
        thread_ts: { type: string, optional: true }
    - name: message.im
      properties:
        channel_id: { type: string }
        ts: { type: string }
```

### 7.2 Connection 정의 (참고)

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-main
spec:
  connectorRef: { kind: Connector, name: slack }
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  ingress:
    rules:
      - match:
          event: app_mention
        route:
          agentRef: { kind: Agent, name: planner }
      - match:
          event: message.im
        route: {}  # entrypoint로 라우팅
  verify:
    webhook:
      signingSecret:
        valueFrom:
          secretRef: { ref: "Secret/slack-webhook", key: "signing_secret" }
```

### 7.3 Entry Function 구현

```ts
// ./connectors/slack/index.ts
import type { ConnectorContext } from '@goondan/core';

export default async function (context: ConnectorContext): Promise<void> {
  const { event, connection, emit, verify, logger } = context;

  if (event.type !== "connector.trigger") return;
  if (event.trigger.type !== "http") return;

  const req = event.trigger.payload.request;

  // 1. 서명 검증
  const signingSecret = verify?.webhook?.signingSecret;
  if (signingSecret) {
    const isValid = await verifySlackSignature(req, signingSecret);
    if (!isValid) {
      logger.warn("Slack 서명 검증 실패");
      return;
    }
  }

  // 2. Slack URL 검증 챌린지 처리
  const body = req.body;
  if (body.type === "url_verification") {
    // Runtime이 HTTP 응답을 처리하도록 구성
    return;
  }

  // 3. 이벤트 파싱 및 emit
  const slackEvent = body.event;
  if (!slackEvent || typeof slackEvent !== "object") return;

  const eventType = typeof slackEvent.type === "string" ? slackEvent.type : "";
  const userId = typeof slackEvent.user === "string" ? slackEvent.user : "";
  const teamId = typeof body.team_id === "string" ? body.team_id : "";
  const channelId = typeof slackEvent.channel === "string" ? slackEvent.channel : "";
  const ts = typeof slackEvent.ts === "string" ? slackEvent.ts : "";
  const threadTs = typeof slackEvent.thread_ts === "string" ? slackEvent.thread_ts : undefined;
  const text = typeof slackEvent.text === "string" ? slackEvent.text : "";

  await emit({
    type: "connector.event",
    name: eventType === "app_mention" ? "app_mention" : "message.im",
    message: { type: "text", text },
    properties: {
      channel_id: channelId,
      ts,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    },
    auth: {
      actor: { id: `slack:${userId}` },
      subjects: {
        global: `slack:team:${teamId}`,
        user: `slack:user:${teamId}:${userId}`,
      },
    },
  });
}

async function verifySlackSignature(
  req: { headers: Record<string, string>; rawBody?: string },
  signingSecret: string
): Promise<boolean> {
  // Slack 서명 검증 로직 구현
  // X-Slack-Signature, X-Slack-Request-Timestamp 헤더 사용
  return true; // 실제 구현 필요
}
```

---

## 8. 예시: Cron 기반 Connector

### 8.1 YAML 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: daily-reporter
spec:
  runtime: node
  entry: "./connectors/daily-reporter/index.ts"

  triggers:
    - type: cron
      schedule: "0 9 * * MON-FRI"

  events:
    - name: daily_report
      properties:
        scheduled_at: { type: string }
```

### 8.2 Entry Function 구현

```ts
// ./connectors/daily-reporter/index.ts
import type { ConnectorContext } from '@goondan/core';

export default async function (context: ConnectorContext): Promise<void> {
  const { event, emit } = context;

  if (event.type !== "connector.trigger") return;
  if (event.trigger.type !== "cron") return;

  const cronPayload = event.trigger.payload;
  const { scheduledAt } = cronPayload;

  await emit({
    type: "connector.event",
    name: "daily_report",
    message: { type: "text", text: `일일 보고서 생성 요청 (${scheduledAt})` },
    properties: {
      scheduled_at: scheduledAt,
    },
    auth: {
      actor: { id: "system:cron" },
      subjects: { global: "cron:daily-reporter" },
    },
  });
}
```

---

## 9. 예시: CLI Connector

### 9.1 YAML 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  runtime: node
  entry: "./connectors/cli/index.ts"

  triggers:
    - type: cli

  events:
    - name: user_input
```

### 9.2 Entry Function 구현

```ts
// ./connectors/cli/index.ts
import type { ConnectorContext } from '@goondan/core';

export default async function (context: ConnectorContext): Promise<void> {
  const { event, emit } = context;

  if (event.type !== "connector.trigger") return;
  if (event.trigger.type !== "cli") return;

  const cliPayload = event.trigger.payload;
  const { text } = cliPayload;

  await emit({
    type: "connector.event",
    name: "user_input",
    message: { type: "text", text },
    auth: {
      actor: { id: "cli:local-user" },
      subjects: { global: "cli:local" },
    },
  });
}
```

---

## 10. Validation 규칙

Runtime/Validator는 Connector 리소스에 대해 다음 규칙을 검증해야 한다.

| 항목 | 규칙 | 수준 |
|------|------|------|
| `spec.runtime` | 필수, `"node"` | MUST |
| `spec.entry` | 필수, 유효한 파일 경로 | MUST |
| `spec.triggers` | 필수, 최소 1개 이상의 trigger 선언 | MUST |
| `spec.triggers[].type` | `"http"`, `"cron"`, `"cli"` 중 하나 | MUST |
| `spec.triggers[].endpoint.path` | http trigger에서 필수, `/`로 시작 | MUST |
| `spec.triggers[].endpoint.method` | http trigger에서 필수 | MUST |
| `spec.triggers[].schedule` | cron trigger에서 필수, 유효한 cron 표현식 | MUST |
| `spec.events[].name` | Connector 내 고유 | MUST |
| Entry default export | entry 모듈에 default export 함수 존재 | MUST |

### Connection Validation

Connection 리소스의 검증 규칙은 [`docs/specs/connection.md`](./connection.md)를 참조한다.

---

## 11. 참고 문서

- `docs/specs/connection.md` - Connection 리소스 스펙 (auth, verify, ingress rules)
- `docs/specs/resources.md` - Config Plane 리소스 정의 스펙
- `docs/specs/api.md` - Connector API
- `docs/specs/bundle.md` - Connector YAML 스펙
- `docs/requirements/07_config-resources.md` - Connector 리소스 정의 요구사항

---

**문서 버전**: v1.0
**최종 수정**: 2026-02-08
**참조**: @docs/specs/connection.md, @docs/specs/resources.md, @docs/specs/api.md
