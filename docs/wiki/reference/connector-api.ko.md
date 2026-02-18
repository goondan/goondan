# Connector API 레퍼런스

> Goondan v0.0.3

[English version](./connector-api.md)

---

## 개요

**Connector**는 외부 채널 이벤트를 정규화된 `ConnectorEvent` 객체로 변환하는 프로토콜 어댑터입니다. 각 Connector는 Orchestrator가 스폰하는 독립 Bun 자식 프로세스로 실행됩니다. Connector는 프로토콜 처리(HTTP 서버, WebSocket, 롱 폴링, cron 등)를 직접 구현하고, IPC를 통해 이벤트를 Orchestrator에 전달합니다.

**Connection**은 Connector를 Swarm에 바인딩하며, config/secrets 제공 및 ingress 라우팅 규칙을 정의합니다.

> Connector를 만드는 단계별 가이드는 [How to: Connector 작성하기](../how-to/write-a-connector.ko.md)를 참조하세요.
> 런타임 실행 모델에 대한 이해는 [설명: 런타임 모델](../explanation/runtime-model.ko.md)을 참조하세요.

---

## Connector 리소스

### YAML 스키마

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: <string>          # Bundle 내에서 고유한 이름
spec:
  entry: <string>          # 엔트리 모듈 경로 (Bundle 루트 기준)
  events:                  # Connector가 발행할 수 있는 이벤트 스키마
    - name: <string>       # 이벤트 이름 (Connector 내 고유)
      properties:          # 선택: 타입이 지정된 속성
        <key>:
          type: string | number | boolean
          optional: true | false    # 기본값: false
```

### ConnectorSpec

```typescript
interface ConnectorSpec {
  /** 엔트리 파일 경로 (단일 default export). 항상 Bun으로 실행 */
  entry: string;

  /** Connector가 emit할 수 있는 이벤트 스키마 */
  events?: EventSchema[];
}

interface EventSchema {
  /** 이벤트 이름 (Connection match 규칙에서 참조) */
  name: string;
  /** 속성 타입 선언 */
  properties?: Record<string, EventPropertyType>;
}

interface EventPropertyType {
  type: 'string' | 'number' | 'boolean';
  optional?: boolean;
}
```

### 검증 규칙

| 필드 | 필수 | 규칙 |
|------|------|------|
| `spec.entry` | MUST | 유효한 파일 경로 |
| `spec.events[].name` | MUST | Connector 내 고유 |
| Entry default export | MUST | 엔트리 모듈에 default export 함수 존재 |
| `triggers` 필드 | MUST NOT | 존재하지 않음 |
| `runtime` 필드 | MUST NOT | 존재하지 않음 (항상 Bun) |

### 예시

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: telegram
spec:
  entry: "./connectors/telegram/index.ts"
  events:
    - name: user_message
      properties:
        chat_id: { type: string }
        user_id: { type: string }
    - name: command
      properties:
        chat_id: { type: string }
        command: { type: string }
```

---

## Entry 함수

Connector 엔트리 모듈은 **단일 default export** 함수를 제공해야 합니다. 이 함수는 `ConnectorContext`를 전달받아 프로토콜 처리 루프를 구현합니다.

```typescript
type ConnectorEntryFunction = (ctx: ConnectorContext) => Promise<void>;
```

### 규칙

1. 엔트리 모듈은 반드시 단일 default export를 제공해야 합니다(MUST).
2. 엔트리 함수는 프로토콜 수신 루프(HTTP 서버, WebSocket, 폴링 등)를 직접 구현해야 합니다(MUST).
3. 엔트리 함수가 resolve되면 Connector 프로세스가 종료될 수 있습니다(MAY).
4. 엔트리 함수가 예기치 않게 reject되면 Orchestrator는 재시작 정책에 따라 재스폰할 수 있습니다(MAY).

### 최소 예시

```typescript
import type { ConnectorContext } from '@goondan/types';

export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, config, secrets, logger } = ctx;

  Bun.serve({
    port: Number(config.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();

      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.text },
        properties: { chat_id: String(body.chatId) },
        instanceKey: `my-connector:${body.chatId}`,
      });

      return new Response('OK');
    },
  });

  logger.info('Connector listening on port', Number(config.PORT) || 3000);
}
```

---

## ConnectorContext

Connector 엔트리 함수에 전달되는 컨텍스트 객체입니다.

```typescript
interface ConnectorContext {
  /** ConnectorEvent를 Orchestrator로 발행 */
  emit(event: ConnectorEvent): Promise<void>;

  /** Connection.spec.config에서 해석된 설정값 */
  config: Record<string, string>;

  /** Connection.spec.secrets에서 해석된 비밀값 */
  secrets: Record<string, string>;

  /** 로거 인스턴스 */
  logger: Console;
}
```

### 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `emit` | `(event: ConnectorEvent) => Promise<void>` | `ConnectorEvent`를 IPC를 통해 Orchestrator로 전달합니다. Orchestrator는 Connection의 ingress 규칙에 따라 라우팅합니다. |
| `config` | `Record<string, string>` | Connection의 `spec.config`에서 해석된 키-값 쌍입니다. |
| `secrets` | `Record<string, string>` | Connection의 `spec.secrets`에서 해석된 키-값 쌍입니다. 서명 시크릿, 봇 토큰 등에 사용합니다. |
| `logger` | `Console` | 구조화된 로깅 인터페이스입니다. 로그는 Connector 프로세스 로그 파일에 기록됩니다. |

---

## ConnectorEvent

`ctx.emit()`으로 발행하는 정규화된 이벤트 객체입니다.

```typescript
interface ConnectorEvent {
  /** 이벤트 이름 (Connector.spec.events[].name에 선언된 이름과 일치해야 함) */
  name: string;

  /** 멀티모달 입력 메시지 */
  message: ConnectorEventMessage;

  /** 이벤트 속성 (events[].properties에 선언된 키와 일치해야 함) */
  properties: Record<string, string>;

  /** 인스턴스 라우팅 키 (Orchestrator가 AgentProcess를 매핑하는 데 사용) */
  instanceKey: string;
}

type ConnectorEventMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'file'; url: string; name: string };
```

### 필드

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | `string` | MUST | 이벤트 이름. `Connector.spec.events[]`에 선언된 이름에 해당해야 합니다. |
| `message` | `ConnectorEventMessage` | MUST | 입력 메시지. 최소 하나의 콘텐츠 타입을 포함해야 합니다. |
| `properties` | `Record<string, string>` | MUST | 이벤트 속성. `events[].properties`에 선언된 키와 일치해야 합니다. |
| `instanceKey` | `string` | MUST | Orchestrator가 올바른 AgentProcess로 라우팅하기 위한 키입니다. 동일한 `instanceKey`를 가진 이벤트는 같은 AgentProcess로 라우팅되어 대화 컨텍스트가 유지됩니다. |

### 메시지 타입

| 타입 | 필드 | 설명 |
|------|------|------|
| `text` | `text: string` | 텍스트 메시지 |
| `image` | `url: string` | 이미지 URL |
| `file` | `url: string`, `name: string` | 파일 URL과 파일명 |

---

## 서명 검증

Connector는 Connection이 제공하는 secrets를 사용하여 인바운드 요청의 진위성을 검증하는 것이 **권장**됩니다.

### 권장 절차

1. `ctx.secrets`에서 서명 시크릿을 읽습니다 (권장 키 이름: `SIGNING_SECRET`, `WEBHOOK_SECRET`).
2. 요청 헤더/바디에서 서명을 추출합니다.
3. 검증 알고리즘을 실행합니다.
4. 실패 시: `ConnectorEvent`를 emit하지 **말고**, HTTP 401/403 응답을 반환하고, `ctx.logger`로 실패를 기록합니다.

### 예시

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;

  Bun.serve({
    port: 3000,
    async fetch(req) {
      // 1. 서명 검증
      const signingSecret = secrets.SIGNING_SECRET;
      if (signingSecret) {
        const signature = req.headers.get('x-signature');
        if (!verifySignature(req, signingSecret, signature)) {
          logger.warn('서명 검증 실패');
          return new Response('Unauthorized', { status: 401 });
        }
      }

      // 2. 파싱 및 발행
      const body = await req.json();
      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.text },
        properties: { chat_id: body.chatId },
        instanceKey: `channel:${body.chatId}`,
      });

      return new Response('OK');
    },
  });
}
```

---

## Connection 리소스

Connection은 Connector를 Swarm에 바인딩하며, config, secrets, ingress 라우팅 규칙을 제공합니다.

### YAML 스키마

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: <string>
spec:
  connectorRef: <ObjectRefLike>             # MUST: 바인딩할 Connector
  swarmRef: <ObjectRefLike>                 # MAY: 바인딩할 Swarm (기본값: Bundle 내 첫 번째 Swarm)

  config:                                    # MAY: Connector에 전달할 일반 설정
    <KEY>:
      value: <string>                        # 직접 값
      # 또는
      valueFrom:
        env: <ENV_VAR_NAME>                  # 환경 변수에서 주입

  secrets:                                   # MAY: Connector에 전달할 민감값
    <KEY>:
      value: <string>
      # 또는
      valueFrom:
        env: <ENV_VAR_NAME>
        # 또는
        secretRef:
          ref: "Secret/<name>"
          key: "<field>"

  ingress:                                   # MAY: 라우팅 규칙
    rules:
      - match:                               # MAY: 생략 시 catch-all
          event: <string>                    # ConnectorEvent.name
          properties:                        # AND 조건
            <key>: <value>
        route:
          agentRef: <ObjectRefLike>          # MAY: 생략 시 entryAgent로 라우팅
          instanceKey: <string>              # MAY: 고정 instanceKey 오버라이드
          instanceKeyProperty: <string>      # MAY: 이벤트 속성에서 instanceKey 읽기
          instanceKeyPrefix: <string>        # MAY: 속성 기반 키 접두어
```

### ConnectionSpec

```typescript
interface ConnectionSpec {
  /** 바인딩할 Connector (MUST) */
  connectorRef: ObjectRefLike;

  /** 바인딩할 Swarm (MAY, 기본값: Bundle 내 첫 번째 Swarm) */
  swarmRef?: ObjectRefLike;

  /** ConnectorContext.config로 전달되는 일반 설정 */
  config?: Record<string, ValueSource>;

  /** ConnectorContext.secrets로 전달되는 민감값 */
  secrets?: Record<string, ValueSource>;

  /** Ingress 라우팅 규칙 */
  ingress?: IngressConfig;
}

interface IngressConfig {
  rules?: IngressRule[];
}

interface IngressRule {
  match?: IngressMatch;
  route: IngressRoute;
}

interface IngressMatch {
  /** ConnectorEvent.name과 매칭 */
  event?: string;
  /** ConnectorEvent.properties와 매칭 (AND 조건) */
  properties?: Record<string, string | number | boolean>;
}

interface IngressRoute {
  /** 대상 Agent (생략 시 Swarm의 entryAgent로 라우팅) */
  agentRef?: ObjectRefLike;
  /** 고정 instanceKey 오버라이드 */
  instanceKey?: string;
  /** ConnectorEvent.properties에서 instanceKey 읽기 */
  instanceKeyProperty?: string;
  /** instanceKeyProperty 사용 시 접두어 */
  instanceKeyPrefix?: string;
}
```

### Ingress 라우팅 규칙

규칙은 **순서대로** 평가되며, 첫 번째 매칭되는 규칙이 적용됩니다.

| 동작 | 조건 |
|------|------|
| **Catch-all** | `match`가 생략됨 |
| **이벤트 필터** | `match.event`가 `ConnectorEvent.name`과 일치 |
| **속성 필터** | `match.properties`가 `ConnectorEvent.properties`와 일치 (AND 로직) |
| **특정 Agent로 라우팅** | `route.agentRef`가 지정됨 |
| **entryAgent로 라우팅** | `route.agentRef`가 생략됨 |
| **instanceKey 오버라이드** | `route.instanceKey`가 지정됨 (`ConnectorEvent.instanceKey`를 대체) |
| **동적 instanceKey** | `route.instanceKeyProperty`가 이벤트 속성에서 값을 읽음 |

**제약사항:**
- `route.instanceKey`와 `route.instanceKeyProperty`는 동시에 설정할 수 없습니다(MUST NOT).

### 검증 규칙

| 필드 | 필수 | 규칙 |
|------|------|------|
| `spec.connectorRef` | MUST | 같은 Bundle 내 유효한 Connector 참조 |
| `spec.swarmRef` | MAY | 유효한 Swarm 참조 (기본값: 첫 번째 Swarm) |
| `spec.config` | MAY | 각 값이 유효한 `ValueSource` |
| `spec.secrets` | MAY | 각 값이 유효한 `ValueSource` |
| `spec.ingress.rules[].route` | MUST | 규칙이 있으면 필수 |
| `spec.ingress.rules[].match.event` | SHOULD | Connector의 `events[]`에 선언된 이름과 일치 |
| `spec.ingress.rules[].route.agentRef` | SHOULD | 바인딩된 Swarm 내 유효한 Agent |

### 예시: Telegram Connection

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-production
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"

  config:
    PORT:
      value: "3000"
  secrets:
    BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
    SIGNING_SECRET:
      valueFrom:
        env: TELEGRAM_WEBHOOK_SECRET

  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: command
        route: {}  # Swarm entryAgent로 라우팅
```

### 예시: 최소 CLI Connection

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: "Connector/cli"
  ingress:
    rules:
      - route: {}  # 모든 이벤트를 entryAgent로
```

---

## 이벤트 흐름

```
[Connector 프로세스: 프로토콜 수신 (HTTP/WebSocket/Polling/Cron)]
     |
     |  외부 이벤트 수신 -> 정규화
     v
[ctx.emit(ConnectorEvent)]
     |
     |  IPC로 Orchestrator에 전달
     v
[Orchestrator: ConnectorEvent 수신]
     |
     |  Connection.ingress.rules 매칭
     |  match.event vs ConnectorEvent.name
     |  match.properties vs ConnectorEvent.properties
     v
[매칭된 rule의 route -> AgentProcess]
     |  instanceKey -> AgentProcess 매핑 (필요시 스폰)
     |  agentRef -> 특정 Agent / 생략 -> entryAgent
     v
[AgentProcess: Turn 처리]
```

---

## Connector가 하지 않는 것

| 책임 | 담당 |
|------|------|
| **라우팅** (어떤 Agent가 이벤트를 받을지) | Connection ingress 규칙 |
| **인증 자격 증명** (API 토큰) | Connection secrets |
| **응답 전송** (사용자에게 답장) | Tool (예: `telegram__send`, `slack__send`) |
| **인스턴스 관리** (Turn/Step 라이프사이클) | Orchestrator / AgentProcess |

---

## 관련 문서

- [How to: Connector 작성하기](../how-to/write-a-connector.ko.md) -- Connector 작성 단계별 가이드
- [How to: Swarm 실행하기](../how-to/run-a-swarm.ko.md) -- Swarm 실행 및 관리
- [설명: 런타임 모델](../explanation/runtime-model.ko.md) -- 실행 모델 이해
- [레퍼런스: 리소스](./resources.ko.md) -- 8종 리소스 Kind 스키마
- [레퍼런스: CLI](./cli-reference.ko.md) -- CLI 명령어 레퍼런스

---

_위키 버전: v0.0.3_
