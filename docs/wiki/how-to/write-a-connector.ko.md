# How to: Connector 작성하기

> 외부 프로토콜을 Goondan 스웜에 연결하는 커스텀 Connector를 구축하는 가이드입니다.

[English version](./write-a-connector.md)

---

## 사전 준비

- 작동하는 Goondan 프로젝트 (`gdn init` 완료)
- Connector/Connection 분리 구조에 대한 이해 ([Connector API 레퍼런스](../reference/connector-api.ko.md) 참고)
- [런타임 모델](../explanation/runtime-model.ko.md)에 대한 기본 이해

---

## 1. Connector 리소스 정의

`goondan.yaml`에 `kind: Connector` 문서를 작성합니다. 필수 필드는 `spec.entry`(엔트리 모듈 경로)와 `spec.events`(커넥터가 발행할 이벤트 스키마)입니다.

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: my-webhook
spec:
  entry: "./connectors/my-webhook/index.ts"
  events:
    - name: incoming_message
      properties:
        channel_id: { type: string }
        sender_id: { type: string }
    - name: status_update
      properties:
        channel_id: { type: string }
        status: { type: string }
```

**기억할 규칙:**

- `spec.entry`는 필수이며 유효한 파일 경로여야 합니다.
- 각 `events[].name`은 해당 Connector 내에서 고유해야 합니다.
- `triggers`나 `runtime` 필드는 존재하지 않습니다 -- Connector는 항상 Bun 프로세스로 실행됩니다.

---

## 2. 엔트리 모듈 구현

엔트리 모듈은 `ConnectorContext`를 받는 **단일 default export** 함수를 제공해야 합니다. 이 함수가 커넥터가 처리하는 프로토콜을 직접 구현합니다 -- HTTP 서버, WebSocket, 폴링 루프, cron 스케줄러 등.

```typescript
// connectors/my-webhook/index.ts
import type { ConnectorContext } from '@goondan/types';

export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, config, secrets, logger } = ctx;
  const port = Number(config.PORT) || 4000;

  Bun.serve({
    port,
    async fetch(req) {
      const body = await req.json();

      await emit({
        name: 'incoming_message',
        message: { type: 'text', text: body.text },
        properties: {
          channel_id: String(body.channelId),
          sender_id: String(body.senderId),
        },
        instanceKey: `my-webhook:${body.channelId}`,
      });

      return new Response('OK');
    },
  });

  logger.info(`my-webhook connector listening on port ${port}`);
}
```

### ConnectorContext 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `emit` | `(event: ConnectorEvent) => Promise<void>` | IPC를 통해 정규화된 이벤트를 Orchestrator로 전송 |
| `config` | `Record<string, string>` | Connection의 `spec.config`에서 해석된 일반 설정 |
| `secrets` | `Record<string, string>` | Connection의 `spec.secrets`에서 해석된 민감값 |
| `logger` | `Console` | 진단 출력용 구조화 로거 |

### ConnectorEvent 필드

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | `string` | 예 | `spec.events[]`에 선언된 이름 중 하나와 일치해야 함 |
| `message` | `ConnectorEventMessage` | 예 | 입력 콘텐츠 (`text`, `image`, 또는 `file`) |
| `properties` | `Record<string, string>` | 예 | `events[].properties` 키와 일치하는 이벤트 메타데이터 |
| `instanceKey` | `string` | 예 | 어떤 AgentProcess가 이벤트를 수신할지 결정하는 라우팅 키 |

> **팁:** 동일한 `instanceKey`를 가진 이벤트는 같은 AgentProcess로 라우팅되어 대화 컨텍스트가 유지됩니다. 원하는 대화 경계를 반영하는 키를 선택하세요 (예: 채널별, 사용자별, 또는 공유 싱글톤).

---

## 3. 서명 검증 추가 (권장)

인바운드 요청의 진위를 검증하면 위조된 이벤트가 에이전트에 도달하는 것을 방지할 수 있습니다. `ctx.secrets`에서 서명 시크릿을 읽어 emit 전에 검증하세요.

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;

  Bun.serve({
    port: 4000,
    async fetch(req) {
      // 1. 서명 검증
      const signingSecret = secrets.SIGNING_SECRET;
      if (signingSecret) {
        const signature = req.headers.get('x-webhook-signature');
        const rawBody = await req.text();

        if (!verifyHmacSignature(rawBody, signature, signingSecret)) {
          logger.warn('서명 검증 실패');
          return new Response('Unauthorized', { status: 401 });
        }

        // 이미 읽은 raw body에서 파싱
        const body = JSON.parse(rawBody);
        await emit({
          name: 'incoming_message',
          message: { type: 'text', text: body.text },
          properties: { channel_id: body.channelId },
          instanceKey: `my-webhook:${body.channelId}`,
        });

        return new Response('OK');
      }

      // 서명 시크릿 미설정 시 폴백
      const body = await req.json();
      await emit({
        name: 'incoming_message',
        message: { type: 'text', text: body.text },
        properties: { channel_id: body.channelId },
        instanceKey: `my-webhook:${body.channelId}`,
      });

      return new Response('OK');
    },
  });
}

function verifyHmacSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const hmac = new Bun.CryptoHasher('sha256', secret);
  hmac.update(body);
  const expected = hmac.digest('hex');

  // 타이밍 안전 비교 사용
  if (expected.length !== signature.length) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');
  return require('crypto').timingSafeEqual(expectedBuf, receivedBuf);
}
```

**권장 시크릿 키 이름:** `SIGNING_SECRET` 또는 `WEBHOOK_SECRET`.

**실패 시:** `ConnectorEvent`를 emit하지 마세요. HTTP 401/403을 반환하고 `ctx.logger`로 실패를 기록합니다.

---

## 4. Connection 리소스 생성

`kind: Connection`은 Connector를 Swarm에 바인딩하며 config, secrets, ingress 라우팅 규칙을 제공합니다. Connector 코드를 수정하지 않고 배포별 설정을 여기서 연결합니다.

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: my-webhook-to-swarm
spec:
  # 필수: Connector 참조
  connectorRef: "Connector/my-webhook"

  # 선택: 바인딩할 Swarm (기본값: 번들의 첫 번째 Swarm)
  swarmRef: "Swarm/default"

  # 일반 설정 -> ConnectorContext.config
  config:
    PORT:
      value: "4000"

  # 민감값 -> ConnectorContext.secrets
  secrets:
    API_TOKEN:
      valueFrom:
        env: MY_WEBHOOK_API_TOKEN
    SIGNING_SECRET:
      valueFrom:
        env: MY_WEBHOOK_SIGNING_SECRET

  # Ingress 라우팅 규칙
  ingress:
    rules:
      - match:
          event: incoming_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: status_update
        route:
          agentRef: "Agent/monitor"
      - route: {}  # Catch-all: Swarm의 entryAgent로 라우팅
```

### 주요 Connection 필드

| 필드 | 설명 |
|------|------|
| `connectorRef` | **필수.** 동일 번들 내 Connector 참조 |
| `swarmRef` | 선택. 기본값은 번들의 첫 번째 Swarm |
| `config` | `ConnectorContext.config`로 전달되는 일반 설정 |
| `secrets` | `ConnectorContext.secrets`로 전달되는 민감값 |
| `ingress.rules` | 순서대로 평가되는 라우팅 규칙 목록 (첫 번째 매칭 적용) |

### Ingress 라우팅 규칙

규칙은 순서대로 평가됩니다. 첫 번째로 매칭되는 규칙이 적용됩니다.

| 패턴 | 의미 |
|------|------|
| `match.event: "incoming_message"` | 해당 이름의 이벤트 매칭 |
| `match.properties: { channel_id: "C123" }` | 특정 속성값 매칭 (`event`와 AND 조건) |
| `match` 생략 | Catch-all (모든 이벤트 매칭) |
| `route.agentRef: "Agent/handler"` | 특정 에이전트로 라우팅 |
| `route: {}` | Swarm의 `entryAgent`로 라우팅 |
| `route.instanceKey: "shared"` | ConnectorEvent의 instanceKey 오버라이드 |
| `route.instanceKeyProperty: "sender_id"` | 속성값을 instanceKey로 사용 |

> **제약:** `route.instanceKey`와 `route.instanceKeyProperty`는 동시에 설정할 수 없습니다.

---

## 5. 우아한 종료 처리

Orchestrator가 Connector 프로세스 라이프사이클을 관리합니다. 종료가 필요할 때(설정 변경, 재시작, Orchestrator 종료) 프로세스가 `SIGINT` 또는 `SIGTERM`을 수신합니다. 리소스를 정리하여 우아하게 종료하세요.

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { config, logger } = ctx;
  const port = Number(config.PORT) || 4000;

  const server = Bun.serve({
    port,
    async fetch(req) {
      // ... 요청 처리
      return new Response('OK');
    },
  });

  logger.info(`Connector listening on port ${port}`);

  // 종료 신호 대기
  const shutdown = new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      logger.info('SIGINT 수신, 종료 중');
      server.stop();
      resolve();
    });
    process.once('SIGTERM', () => {
      logger.info('SIGTERM 수신, 종료 중');
      server.stop();
      resolve();
    });
  });

  await shutdown;
}
```

---

## 6. 비HTTP 커넥터 패턴

모든 커넥터가 HTTP를 수신하는 것은 아닙니다. 다른 일반적인 패턴을 소개합니다.

### 폴링 커넥터

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;
  const token = secrets.API_TOKEN;
  const controller = new AbortController();

  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());

  let cursor = 0;
  while (!controller.signal.aborted) {
    const response = await fetch(`https://api.example.com/updates?after=${cursor}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    const updates = await response.json();
    for (const update of updates.items) {
      cursor = Math.max(cursor, update.id);
      await emit({
        name: 'new_update',
        message: { type: 'text', text: update.content },
        properties: { update_id: String(update.id) },
        instanceKey: `poll:${update.channelId}`,
      });
    }

    // 다음 폴링까지 대기
    await new Promise((r) => setTimeout(r, 5000));
  }
}
```

### Cron 커넥터

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, config, logger } = ctx;
  const intervalMs = Number(config.INTERVAL_MS) || 60_000;

  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());

  while (!controller.signal.aborted) {
    await emit({
      name: 'scheduled_tick',
      message: { type: 'text', text: `예약된 이벤트: ${new Date().toISOString()}` },
      properties: { scheduled_at: new Date().toISOString() },
      instanceKey: 'cron:scheduled',
    });

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

---

## 7. 검증 및 실행

```bash
# 번들 검증 (엔트리 파일 존재, 이벤트 스키마 등 확인)
gdn validate

# 스웜 실행 (Orchestrator가 Connector를 자식 프로세스로 스폰)
gdn run
```

---

## 체크리스트

- [ ] `kind: Connector` 리소스에 `spec.entry`와 `spec.events` 포함
- [ ] 엔트리 모듈에 단일 default export 함수 존재
- [ ] `ctx.emit()`에 유효한 `ConnectorEvent` 전달 (name, message, properties, instanceKey)
- [ ] 서명 검증 구현 (외부 서비스가 지원하는 경우)
- [ ] `kind: Connection` 리소스로 Connector와 Swarm 바인딩 (config/secrets/ingress)
- [ ] Ingress 규칙이 이벤트를 올바른 에이전트로 라우팅
- [ ] 우아한 종료 처리 (SIGINT/SIGTERM)
- [ ] `gdn validate` 통과

---

## 함께 보기

- [Connector API 레퍼런스](../reference/connector-api.ko.md) -- ConnectorContext, ConnectorEvent, Connection의 전체 API 상세
- [런타임 모델](../explanation/runtime-model.ko.md) -- Connector 프로세스가 Orchestrator 아키텍처에서 어떻게 동작하는지
- [리소스 레퍼런스](../reference/resources.ko.md) -- Connector와 Connection의 전체 YAML 스키마
- [How to: 스웜 실행하기](./run-a-swarm.ko.md) -- 스웜 실행 및 관리

---

_How-to 버전: v0.0.3_
