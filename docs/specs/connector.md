# Goondan Connector 스펙 v0.0.3

> `ConnectorContext`/`ConnectorEvent`의 타입 원형은 이 문서가 소유한다.
> `secrets`/`verify` 해석과 ingress 라우팅 계약은 `docs/specs/connection.md`를 단일 기준으로 따른다.

## 1. 개요

### 1.1 배경 및 설계 철학

Connector는 외부 채널 이벤트를 canonical **ConnectorEvent**로 정규화하는 **프로토콜 어댑터**다. Telegram, Slack, Discord, CLI, cron 등 다양한 외부 프로토콜을 통해 들어오는 이벤트를 단일 형식으로 변환하여 Orchestrator에 전달한다.

Connector는 **프로토콜 수신을 직접 구현**하는 구조를 사용한다. 이 구조는 다음 특성을 가진다:

- **프로토콜 자유도 극대화**: Connector가 HTTP 서버, WebSocket, 롱 폴링, cron 등 어떤 프로토콜이든 자유롭게 구현할 수 있다.
- **Process-per-Connector**: 각 Connector가 독립 Bun 프로세스로 실행되어 크래시 격리와 독립적 스케일링이 가능하다.
- **단순화된 인터페이스**: `entry` + `events` 중심으로 Connector를 정의한다.
- **Connector/Connection 분리**: 프로토콜 구현(Connector)과 배포 바인딩(Connection)을 분리하여, 하나의 Connector를 여러 환경에서 재사용할 수 있게 한다.

### 1.2 핵심 책임

1. **프로토콜 수신 구현**: HTTP 서버, cron 스케줄러, WebSocket, 롱 폴링 등 프로토콜을 자체적으로 구현
2. **이벤트 스키마 선언**: 커넥터가 발행할 수 있는 이벤트의 이름과 속성 타입을 선언
3. **이벤트 정규화**: 외부 프로토콜별 페이로드를 ConnectorEvent로 변환
4. **서명 검증 (권장)**: secrets에서 읽은 시크릿을 사용하여 inbound 요청의 무결성 검증

### 1.3 Connector가 하지 않는 것

- **라우팅**: 어떤 Agent로 이벤트를 전달할지는 Connection의 ingress rules가 담당
- **인증 정보 보유**: API 토큰 등 인증 자격 증명은 Connection의 `secrets`가 제공
- **응답 전송**: 에이전트 응답은 Tool을 통해 전송
- **인스턴스 관리**: Instance/Turn/Step 등 에이전트 실행 모델을 직접 제어하지 않음

---

## 2. 핵심 규칙

다음은 Connector 시스템 구현 시 반드시 준수해야 하는 규범적 규칙을 요약한 것이다. 세부 사항은 이후 각 섹션에서 설명한다.

### 2.1 프로세스 및 실행 규칙

1. Connector는 독립 Bun 프로세스로 실행되어야 한다(MUST). Orchestrator가 프로세스를 스폰하고 감시한다.
2. Connector는 프로토콜 처리를 직접 구현해야 한다(MUST). Runtime이 프로토콜을 대신 관리하지 않는다.
3. `spec.entry`는 필수이며, Bun으로 실행되어야 한다(MUST).
4. entry 모듈은 단일 default export 함수를 제공해야 한다(MUST).

### 2.2 이벤트 발행 규칙

1. Connector는 정규화된 ConnectorEvent를 `ctx.emit()`으로 Orchestrator에 전달해야 한다(MUST).
2. ConnectorEvent는 `instanceKey`를 포함하여 Orchestrator가 적절한 AgentProcess로 라우팅할 수 있게 해야 한다(MUST).
3. `events[].name`은 Connector 내에서 고유해야 한다(MUST).
4. ConnectorEvent의 `message`는 최소 하나의 콘텐츠 타입을 포함해야 한다(MUST).

### 2.3 서명 검증 권장사항

1. Connector는 `ctx.secrets`에서 시크릿을 읽어 inbound 요청의 서명 검증을 수행하는 것이 권장된다(SHOULD).
2. 서명 검증 실패 시 Connector는 ConnectorEvent를 emit하지 않고 처리를 거부해야 한다(MUST).
3. 서명 검증 실패 시 Connector는 실패 사유를 `ctx.logger`로 기록해야 한다(SHOULD).
4. 권장 시크릿 이름: `SIGNING_SECRET`, `WEBHOOK_SECRET`

### 2.4 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Process-per-Connector** | Connector는 Orchestrator가 스폰하는 별도 Bun 프로세스로 실행 |
| **자체 프로토콜 관리** | Runtime이 프로토콜을 대신 처리하지 않음. Connector가 직접 HTTP 서버/WebSocket/폴링 등을 구현 |
| **Bun-native** | `runtime` 필드 없음 -- 항상 Bun으로 실행 |
| **단일 default export** | entry 모듈은 단일 default export 함수를 제공 |

---

## 3. Connector 리소스 스키마

### 3.1 YAML 정의

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
    - name: command
      properties:
        chat_id: { type: string }
        command: { type: string }
```

### 3.2 ConnectorSpec TypeScript 인터페이스

```typescript
interface ConnectorSpec {
  /** 엔트리 파일 경로 (단일 default export). 항상 Bun으로 실행. */
  entry: string;

  /** 커넥터가 emit할 수 있는 이벤트 스키마 */
  events?: EventSchema[];
}

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

> Connector entry는 Bun 프로세스에서 실행되며, 프로토콜 처리는 Connector가 직접 수행한다.

### 3.3 검증 규칙

| 항목 | 규칙 | 수준 |
|------|------|------|
| `spec.entry` | 필수, 유효한 파일 경로 | MUST |
| `spec.events[].name` | Connector 내 고유 | MUST |
| Entry default export | entry 모듈에 default export 함수 존재 | MUST |
| `triggers` 필드 | 존재하지 않음 | MUST NOT |
| `runtime` 필드 | 존재하지 않음 (항상 Bun) | MUST NOT |

---

## 4. Connector 프로세스 모델

### 4.1 프로세스 구조

Connector는 Orchestrator가 스폰하는 **별도 Bun 프로세스**로 실행된다.

```
Orchestrator (상주 프로세스)
  ├── AgentProcess-A
  ├── AgentProcess-B
  └── ConnectorProcess-telegram    ← Connector 프로세스
      └── 자체 HTTP 서버 / cron 스케줄러 / WebSocket / 롱 폴링 등
```

### 4.2 프로세스 특성

- **독립 메모리 공간**: 크래시 격리
- **Orchestrator와 IPC**: `process.send`/`process.on("message")` 또는 Unix socket으로 ConnectorEvent 전달
- **자체 프로토콜 관리**: HTTP 서버, WebSocket 커넥션, 롱 폴링 등을 직접 구현
- **크래시 시 재스폰**: Orchestrator가 감지하고 자동 재스폰 가능

### 4.3 실행 명령 예시

```bash
bun run connector-runner.ts \
  --bundle-dir ./my-swarm \
  --connector-name telegram \
  --connection-name telegram-to-swarm
```

---

## 5. Entry Function 실행 모델

### 5.1 단일 Default Export

Connector의 entry 모듈은 **단일 default export 함수**를 제공해야 한다(MUST).

```typescript
/** Connector Entry Function */
type ConnectorEntryFunction = (ctx: ConnectorContext) => Promise<void>;

export default async function(ctx: ConnectorContext): Promise<void> {
  // 프로토콜 수신 및 이벤트 emit
}
```

규칙:

1. Entry 모듈은 단일 default export를 제공해야 한다(MUST).
2. Entry 함수는 프로토콜 수신 루프(HTTP 서버, WebSocket, 폴링 등)를 자체적으로 실행해야 한다(MUST).
3. Entry 함수가 반환(resolve)하면 Connector 프로세스가 종료될 수 있다(MAY).
4. Entry 함수가 예기치 않게 reject되면 Orchestrator는 재시작 정책에 따라 재스폰할 수 있다(MAY).

### 5.2 ConnectorContext

Entry 함수에 전달되는 컨텍스트이다.

```typescript
interface ConnectorContext {
  /** ConnectorEvent 발행 (Orchestrator로 전달) */
  emit(event: ConnectorEvent): Promise<void>;

  /** Connection의 config에서 해석된 일반 설정 */
  config: Record<string, string>;

  /** Connection의 secrets에서 해석된 비밀값 */
  secrets: Record<string, string>;

  /** 로깅 */
  logger: Console;
}
```

규칙:

1. `emit()`은 ConnectorEvent를 Orchestrator로 전달해야 한다(MUST). Orchestrator는 Connection의 ingress rules에 따라 적절한 AgentProcess로 라우팅한다.
2. `config`는 Connection의 `spec.config`에서 해석된 key-value 쌍이다(MUST).
3. `secrets`는 Connection의 `spec.secrets`에서 해석된 key-value 쌍이다(MUST).
3. `logger`는 구조화된 로깅을 제공해야 한다(SHOULD).

### 5.3 ConnectorEvent

Entry 함수가 `ctx.emit()`으로 발행하는 정규화된 이벤트이다.

```typescript
interface ConnectorEvent {
  /** 이벤트 이름 (Connector의 events[]에 선언된 이름) */
  name: string;

  /** 멀티모달 입력 메시지 */
  message: ConnectorEventMessage;

  /** 이벤트 속성 (events[].properties에 선언된 키-값) */
  properties: Record<string, string>;

  /** 인스턴스 라우팅 키 (Orchestrator가 AgentProcess를 매핑하는 데 사용) */
  instanceKey: string;
}

type ConnectorEventMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'file'; url: string; name: string };
```

규칙:

1. `name`은 Connector의 `events[].name`에 선언된 이벤트 이름이어야 한다(SHOULD).
2. `message`는 최소 하나의 콘텐츠 타입을 포함해야 한다(MUST).
3. `properties`의 키는 `events[].properties`에 선언된 키와 일치해야 한다(SHOULD).
4. `instanceKey`는 Orchestrator가 적절한 AgentProcess로 라우팅할 수 있도록 포함해야 한다(MUST).

### 5.4 서명 검증 권장사항

Connection은 `secrets`를 통해 시크릿을 제공한다. Connector는 `ctx.secrets`에서 시크릿을 읽어 검증을 수행하는 것이 권장된다(SHOULD).

**권장 시크릿 이름:**
- `SIGNING_SECRET`: 일반적인 서명 검증 시크릿
- `WEBHOOK_SECRET`: 웹훅 전용 서명 시크릿

**권장 처리 절차:**
1. `ctx.secrets`에서 서명 시크릿 읽기
2. 요청 헤더/바디에서 서명 추출
3. 서명 검증 알고리즘 실행
4. 검증 실패 시 ConnectorEvent emit 중단 및 401/403 응답 반환
5. 실패 사유를 `ctx.logger`로 기록

---

## 6. Connector Event Flow

```
[Connector 프로세스: 자체 프로토콜 수신 (HTTP/WebSocket/Polling/Cron)]
     |
     |  외부 이벤트 수신 → 정규화
     |
     v
[ctx.emit(ConnectorEvent)]
     |
     |  IPC로 Orchestrator에 전달
     |
     v
[Orchestrator: ConnectorEvent 수신]
     |
     |  Connection.ingress.rules로 매칭
     |  match.event와 ConnectorEvent.name 비교
     |  match.properties와 ConnectorEvent.properties 비교
     |
     v
[매칭된 rule의 route에 따라 AgentProcess로 라우팅]
     |  instanceKey → AgentProcess 매핑 (필요시 스폰)
     |  agentRef → 특정 Agent로 / 생략 → entryAgent로
     |
     v
[AgentProcess에서 Turn 처리]
```

---

## 7. 예시: Telegram Connector (HTTP Webhook)

### 7.1 YAML 정의

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

### 7.2 Entry Function 구현

```typescript
// ./connectors/telegram/index.ts
import type { ConnectorContext } from '@goondan/core';

export default async function(ctx: ConnectorContext): Promise<void> {
  const { config, secrets, logger } = ctx;

  // Connector가 직접 HTTP 서버를 열어 웹훅 수신
  Bun.serve({
    port: Number(config.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();

      // 서명 검증 (권장: secrets에서 시크릿 읽어 자체 수행)
      const signingSecret = secrets.SIGNING_SECRET || secrets.WEBHOOK_SECRET;
      if (signingSecret) {
        const isValid = verifyTelegramSignature(req, signingSecret);
        if (!isValid) {
          logger.warn('Telegram 서명 검증 실패');
          return new Response('Unauthorized', { status: 401 });
        }
      }

      const message = body.message;
      if (!message) {
        return new Response('OK');
      }

      const text = message.text ?? '';
      const chatId = String(message.chat.id);
      const userId = String(message.from?.id ?? 'unknown');

      // 명령어 감지
      const isCommand = text.startsWith('/');

      await emit({
        name: isCommand ? 'command' : 'user_message',
        message: { type: 'text', text },
        properties: isCommand
          ? { chat_id: chatId, command: text.split(' ')[0] }
          : { chat_id: chatId, user_id: userId },
        instanceKey: `telegram:${chatId}`,
      });

      return new Response('OK');
    },
  });

  logger.info('Telegram connector listening on port', Number(config.PORT) || 3000);
}
```

---

## 8. 예시: Slack Connector (HTTP Webhook)

### 8.1 YAML 정의

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: slack
spec:
  entry: "./connectors/slack/index.ts"
  events:
    - name: app_mention
      properties:
        channel_id: { type: string }
        ts: { type: string }
        thread_ts: { type: string, optional: true }
    - name: message_im
      properties:
        channel_id: { type: string }
        ts: { type: string }
```

### 8.2 Entry Function 구현

```typescript
// ./connectors/slack/index.ts
import type { ConnectorContext } from '@goondan/core';

export default async function(ctx: ConnectorContext): Promise<void> {
  const { config, secrets, logger } = ctx;

  Bun.serve({
    port: Number(config.PORT) || 3001,
    async fetch(req) {
      const rawBody = await req.text();
      const body = JSON.parse(rawBody);

      // 1. 서명 검증
      if (secrets.SIGNING_SECRET) {
        const isValid = verifySlackSignature(req.headers, rawBody, secrets.SIGNING_SECRET);
        if (!isValid) {
          logger.warn('Slack 서명 검증 실패');
          return new Response('Unauthorized', { status: 401 });
        }
      }

      // 2. Slack URL 검증 챌린지 처리
      if (body.type === 'url_verification') {
        return new Response(body.challenge, {
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      // 3. 이벤트 파싱 및 emit
      const slackEvent = body.event;
      if (!slackEvent) return new Response('OK');

      const channelId = String(slackEvent.channel ?? '');
      const ts = String(slackEvent.ts ?? '');
      const threadTs = slackEvent.thread_ts ? String(slackEvent.thread_ts) : undefined;
      const text = String(slackEvent.text ?? '');
      const eventType = slackEvent.type === 'app_mention' ? 'app_mention' : 'message_im';

      await emit({
        name: eventType,
        message: { type: 'text', text },
        properties: {
          channel_id: channelId,
          ts,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        },
        instanceKey: `slack:${channelId}:${threadTs ?? ts}`,
      });

      return new Response('OK');
    },
  });

  logger.info('Slack connector listening on port', Number(config.PORT) || 3001);
}
```

---

## 9. 예시: Cron 기반 Connector

### 9.1 YAML 정의

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: daily-reporter
spec:
  entry: "./connectors/daily-reporter/index.ts"
  events:
    - name: daily_report
      properties:
        scheduled_at: { type: string }
```

### 9.2 Entry Function 구현

```typescript
// ./connectors/daily-reporter/index.ts
import type { ConnectorContext } from '@goondan/core';

export default async function(ctx: ConnectorContext): Promise<void> {
  const { config, emit, logger } = ctx;
  const schedule = config.CRON_SCHEDULE || '0 9 * * MON-FRI';

  // Connector가 자체적으로 cron 스케줄러를 관리
  // (Bun 환경에서 cron 라이브러리 사용)
  const cron = new CronScheduler(schedule, async () => {
    const scheduledAt = new Date().toISOString();

    await emit({
      name: 'daily_report',
      message: { type: 'text', text: `일일 보고서 생성 요청 (${scheduledAt})` },
      properties: { scheduled_at: scheduledAt },
      instanceKey: 'cron:daily-reporter',
    });

    logger.info(`Daily report event emitted at ${scheduledAt}`);
  });

  cron.start();
  logger.info(`Daily reporter cron started with schedule: ${schedule}`);

  // 프로세스가 종료되지 않도록 유지
  await new Promise(() => {});
}
```

---

## 10. 예시: CLI Connector

### 10.1 YAML 정의

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: cli
spec:
  entry: "./connectors/cli/index.ts"
  events:
    - name: user_input
```

### 10.2 Entry Function 구현

```typescript
// ./connectors/cli/index.ts
import type { ConnectorContext } from '@goondan/core';
import { createInterface } from 'readline';

export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, logger } = ctx;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  rl.prompt();

  for await (const line of rl) {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      continue;
    }

    await emit({
      name: 'user_input',
      message: { type: 'text', text },
      properties: {},
      instanceKey: 'cli:local',
    });

    rl.prompt();
  }

  logger.info('CLI connector terminated');
}
```

---

## 11. 관련 문서

- `docs/specs/connection.md` - Connection 리소스 스펙 (config/secrets, ingress rules, verify)
- `docs/specs/runtime.md` - Runtime 실행 모델 스펙 (Orchestrator, AgentProcess)
- `docs/specs/resources.md` - Config Plane 리소스 정의 (Connector 리소스 스키마)
- `docs/architecture.md` - 아키텍처 개요 (핵심 개념, 설계 패턴)

---

**문서 버전**: v0.0.3
**최종 수정**: 2026-02-12
