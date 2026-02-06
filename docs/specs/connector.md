# Goondan Connector 스펙 (v0.9)

본 문서는 `docs/requirements/index.md`(특히 5.3.2 및 7.6)와 `docs/specs/api.md`를 기반으로 Connector 시스템의 구현 스펙을 정의한다.

> **v0.9 주요 변경**: Connector를 **Connector**(프로토콜 구현 패키지)와 **Connection**(배포/바인딩 설정)으로 분리. Connection 스펙은 [`docs/specs/connection.md`](./connection.md)를 참조한다.

---

## 1. 개요

Connector는 외부 채널 프로토콜의 **순수 구현 패키지**이다. 채널별 이벤트 수신/송신 프로토콜과 Trigger Handler를 정의하되, 인증/라우팅/이그레스 등 배포 환경에 종속적인 바인딩은 포함하지 않는다.

배포 시점의 인증, 라우팅 규칙(Ingress Rules), Egress 설정은 별도의 **Connection** 리소스가 담당한다.

### 1.1 핵심 책임

1. **프로토콜 구현**: 외부 채널(Slack, CLI, Telegram, GitHub, Webhook 등)의 이벤트 수신/송신 프로토콜 정의
2. **Trigger Handler**: 커스텀 이벤트 처리 로직(Webhook, Cron, Queue 등) 제공

### 1.2 Connection이 담당하는 영역

Connection 리소스는 다음 책임을 가진다. 상세는 [`docs/specs/connection.md`](./connection.md)를 참조한다.

1. **connectorRef**: 사용할 Connector 참조
2. **인증 컨텍스트 설정**: Turn의 `origin`과 `auth` 정보를 채워 OAuth 통합 지원
3. **Ingress Rules**: 외부 이벤트를 필터링/라우팅하는 규칙
4. **Egress**: AgentInstance의 응답을 외부 채널로 전송 (진행상황 업데이트, 최종 응답)

### 1.3 설계 원칙

- Connector는 프로토콜 구현만을 포함하며, 배포 환경 설정(auth, rules, egress)을 포함하지 않는다(MUST).
- Connector는 에이전트 실행 모델(Instance/Turn/Step)을 직접 제어하지 않는다(MUST).
- 하나의 Connector에 여러 Connection을 바인딩할 수 있다(MAY). 동일 프로토콜을 다른 인증/라우팅으로 재사용 가능.
- 각 canonical event는 독립적인 Turn으로 처리된다(MUST).

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
  type: <connector-type>  # slack | cli | telegram | github | custom 등

  # 커스텀 런타임 (선택, type: custom 또는 triggers 사용 시)
  runtime: node
  entry: "./connectors/custom/index.ts"

  # Trigger 핸들러 (선택)
  triggers:
    - handler: <function-name>
```

### 2.2 ConnectorSpec TypeScript 인터페이스

```ts
interface ConnectorSpec {
  /** Connector 프로토콜 타입 (slack, cli, telegram, github, custom 등) */
  type: string;

  /** 커스텀 런타임 환경 (선택, type: custom 또는 triggers 사용 시) */
  runtime?: 'node';

  /** 엔트리 파일 경로 (선택, type: custom 또는 triggers 사용 시) */
  entry?: string;

  /** Trigger 핸들러 목록 (선택) */
  triggers?: TriggerConfig[];
}

interface TriggerConfig {
  /** entry 모듈의 export 함수 이름 */
  handler: string;
}
```

### 2.3 Connector vs Connection 분리 요약

| 항목 | Connector | Connection |
|------|-----------|------------|
| `type` | O | - |
| `runtime` / `entry` | O | - |
| `triggers` | O | - |
| `auth` | - | O |
| `rules` (구 ingress) | - | O |
| `egress` | - | O |
| `connectorRef` | - | O |

> Connection 리소스의 상세 스키마는 [`docs/specs/connection.md`](./connection.md)를 참조한다.

---

## 3. 인증 모드 (Connection으로 이전)

인증 설정은 **Connection** 리소스의 `auth` 필드에서 관리한다. Connector 자체는 인증 정보를 포함하지 않는다.

상세 인증 모드(OAuthApp 기반, Static Token 기반, ValueSource 패턴)는 [`docs/specs/connection.md` 3절](./connection.md#3-인증-모드)을 참조한다.

---

## 4. 라우팅 규칙 (Connection으로 이전)

이벤트 필터링 및 라우팅 규칙은 **Connection** 리소스의 `rules` 필드에서 관리한다. 기존 `ingress` 개념이 `rules`로 이전되었다.

상세 규칙(Match 조건, Route 설정, JSONPath 해석)은 [`docs/specs/connection.md` 4절](./connection.md#4-connection-rules)을 참조한다.

---

## 5. Egress 규칙 (Connection으로 이전)

Egress 설정(UpdatePolicy, Progress vs Final)은 **Connection** 리소스의 `egress` 필드에서 관리한다.

상세 Egress 설정은 [`docs/specs/connection.md` 5절](./connection.md#5-egress-규칙)을 참조한다.

---

## 6. Trigger Handler 시스템

### 6.1 Handler 해석 및 로딩 규칙

Connector가 `spec.runtime`, `spec.entry`와 `triggers`를 사용하는 경우, Runtime은 다음 규칙을 따른다.

```yaml
kind: Connector
spec:
  type: custom
  runtime: node
  entry: "./connectors/custom/index.ts"
  triggers:
    - handler: onWebhook
    - handler: onCron
```

규칙:
1. Runtime은 Connector 초기화 시점에 entry 모듈을 단 한 번 로드해야 한다(MUST).
2. 하나의 Connector가 여러 trigger를 노출하더라도, 런타임 모듈은 공유 인스턴스로 유지되어야 한다(MUST).
3. 각 trigger는 자신의 `handler`에 해당하는 함수 레퍼런스를 통해 호출된다(MUST).
4. 트리거 간 상태 공유 여부는 Connector 구현자가 결정한다(MAY).

### 6.2 Handler Export 검증

```ts
import type { TriggerEvent, TriggerContext, Resource } from '@goondan/core';
import type { ConnectionSpec } from '@goondan/core';

// entry 모듈 예시: ./connectors/custom/index.ts
export async function onWebhook(
  event: TriggerEvent,
  connection: Resource<ConnectionSpec>,
  ctx: TriggerContext
): Promise<void> {
  // ...
}

export async function onCron(
  event: TriggerEvent,
  connection: Resource<ConnectionSpec>,
  ctx: TriggerContext
): Promise<void> {
  // ...
}
```

규칙:
1. `triggers[].handler`는 entry 모듈에서 export된 함수 이름이어야 한다(MUST).
2. 모듈 한정자(`exports.`, 파일 경로 등)를 포함해서는 안 된다(MUST NOT).
3. 지정된 handler export가 존재하지 않으면 구성 로드 단계에서 오류로 처리해야 한다(MUST).

---

## 7. Trigger Execution Model

### 7.1 실행 인터페이스

Trigger handler 호출 시 Runtime은 다음 정보를 주입해야 한다(MUST).

```ts
type TriggerHandler = (
  event: TriggerEvent,
  connection: Resource<ConnectionSpec>,
  ctx: TriggerContext
) => Promise<void>;

interface TriggerEvent {
  type: 'webhook' | 'cron' | 'queue' | 'message' | string;
  payload: JsonObject;
  timestamp: string;
  metadata?: JsonObject;
}

interface TriggerContext {
  /** canonical event 발행 */
  emit: (event: CanonicalEvent) => Promise<void>;

  /** 로깅 */
  logger: Console;

  /** OAuth 토큰 접근 (Connection의 OAuthApp 기반 모드인 경우) */
  oauth?: {
    getAccessToken: (request: OAuthTokenRequest) => Promise<OAuthTokenResult>;
  };

  /** LiveConfig 제안 (선택) */
  liveConfig?: {
    proposePatch: (patch: LiveConfigPatch) => Promise<void>;
  };

  /** Connector 리소스 (프로토콜 설정) */
  connector: Resource<ConnectorSpec>;

  /** Connection 리소스 (바인딩/배포 설정) */
  connection: Resource<ConnectionSpec>;
}
```

### 7.2 Canonical Event

Trigger handler는 외부 이벤트를 canonical event로 변환하여 `ctx.emit(...)`으로 Runtime에 전달한다.

```ts
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

interface TurnAuth {
  actor: {
    type: string;
    id: string;
    display?: string;
  };
  subjects: {
    global?: string;
    user?: string;
  };
}
```

### 7.3 Canonical Event Flow

```
[외부 이벤트]
     |
     v
[Trigger Handler]
     |  connection: Resource<ConnectionSpec>
     |  ctx.connection, ctx.connector
     |
     |  ctx.emit(canonicalEvent)
     v
[Runtime 내부 이벤트 큐]
     |
     v
[SwarmInstance 조회/생성]
     |
     v
[AgentInstance 이벤트 큐]
     |
     v
[Turn 처리]
```

---

## 8. ConnectorAdapter 인터페이스

Runtime과 Connector 간의 표준 인터페이스이다.

### 8.1 TypeScript 인터페이스

```ts
interface ConnectorAdapter {
  /**
   * 외부 이벤트를 처리하여 Runtime에 전달
   */
  handleEvent(payload: JsonObject): Promise<void>;

  /**
   * 에이전트 응답을 외부 채널로 전송
   */
  send?(input: ConnectorSendInput): Promise<unknown>;

  /**
   * Connector 종료 (선택)
   */
  shutdown?(): Promise<void>;
}

interface ConnectorSendInput {
  text: string;
  origin?: JsonObject;
  auth?: JsonObject;
  metadata?: JsonObject;
  kind?: 'progress' | 'final';
}
```

### 8.2 Factory 함수 패턴

Connector 구현은 factory 함수를 통해 생성된다. `connectionConfig`는 배포 바인딩 정보를 포함한다.

```ts
interface ConnectorOptions {
  runtime: {
    handleEvent: (event: RuntimeEvent) => Promise<void>;
  };
  connectorConfig: Resource<ConnectorSpec>;
  connectionConfig: Resource<ConnectionSpec>;
  logger?: Console;
}

type ConnectorFactory = (options: ConnectorOptions) => ConnectorAdapter;
```

> Connection 리소스의 상세 스키마는 [`docs/specs/connection.md`](./connection.md)를 참조한다.

---

## 9. CLI Connector 구현 예시

### 9.1 YAML 정의

Connector와 Connection을 분리하여 정의한다.

```yaml
# Connector: 프로토콜 구현 패키지
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  type: cli
```

```yaml
# Connection: 배포 바인딩
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli-default
spec:
  connectorRef: { kind: Connector, name: cli }
  rules:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"
```

### 9.2 TypeScript 구현

```ts
import * as readline from 'readline';
import type { JsonObject, ObjectRefLike, Resource } from '@goondan/core';
import type { ConnectorSpec, ConnectionSpec } from '@goondan/core';

interface CliConnectorOptions {
  runtime: {
    handleEvent: (event: {
      swarmRef: ObjectRefLike;
      instanceKey: string;
      input: string;
      origin?: JsonObject;
      auth?: JsonObject;
    }) => Promise<void>;
  };
  connectorConfig: Resource<ConnectorSpec>;
  connectionConfig: Resource<ConnectionSpec>;
  logger?: Console;
}

interface CliConnectorAdapter {
  handleEvent: (payload: JsonObject) => Promise<void>;
  send: (input: { text: string; kind?: 'progress' | 'final' }) => { ok: true };
  startInteractive: (defaultSwarmRef: ObjectRefLike, instanceKey: string) => void;
}

export function createCliConnector(options: CliConnectorOptions): CliConnectorAdapter {
  const { runtime, connectionConfig, logger } = options;
  const connectionSpec = connectionConfig.spec;
  const rules = connectionSpec?.rules ?? [];

  async function handleEvent(payload: JsonObject): Promise<void> {
    const text = String(payload.text || '');

    for (const rule of rules) {
      const route = rule.route;
      if (!route?.swarmRef) continue;

      await runtime.handleEvent({
        swarmRef: route.swarmRef,
        instanceKey: String(readPath(payload, route.instanceKeyFrom) || 'cli'),
        input: String(readPath(payload, route.inputFrom) || text),
        origin: { connector: 'cli' },
        auth: {
          actor: { type: 'cli', id: 'local-user' },
          subjects: { global: 'cli:local' },
        },
      });
      return;
    }

    // 기본 라우팅 (rules 없을 때)
    await runtime.handleEvent({
      swarmRef: { kind: 'Swarm', name: 'default' },
      instanceKey: 'cli',
      input: text,
      origin: { connector: 'cli' },
    });
  }

  function send(input: { text: string; kind?: 'progress' | 'final' }): { ok: true } {
    if (input?.text) {
      const prefix = input.kind === 'progress' ? '[...] ' : '';
      console.log(prefix + input.text);
    }
    return { ok: true };
  }

  function startInteractive(defaultSwarmRef: ObjectRefLike, instanceKey: string): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    logger?.info?.('Goondan CLI 시작. :exit 또는 :quit으로 종료.');

    const prompt = (): void => {
      rl.question('> ', async (line: string) => {
        const trimmed = line.trim();

        if (trimmed === ':exit' || trimmed === ':quit') {
          rl.close();
          return;
        }

        if (!trimmed) {
          prompt();
          return;
        }

        try {
          await handleEvent({ text: trimmed, instanceKey });
        } catch (err) {
          logger?.error?.('오류:', err);
        }

        prompt();
      });
    };

    prompt();
  }

  return { handleEvent, send, startInteractive };
}

function readPath(payload: JsonObject, expr?: string): unknown {
  if (!expr || !expr.startsWith('$.')) return undefined;
  const keys = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    const obj = current as Record<string, unknown>;
    current = obj[key];
  }
  return current;
}
```

---

## 10. Slack Connector 구현 예시

### 10.1 YAML 정의

Connector와 Connection을 분리하여 정의한다.

```yaml
# Connector: Slack 프로토콜 구현 패키지
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  type: slack
```

```yaml
# Connection: Slack 배포 바인딩 (OAuthApp 기반)
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-main
spec:
  connectorRef: { kind: Connector, name: slack }

  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }

  rules:
    - match:
        command: "/agent"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
    - match:
        eventType: "app_mention"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"

  egress:
    updatePolicy:
      mode: updateInThread
      debounceMs: 1500
```

### 10.2 turn.auth.subjects 설정 규칙

Slack Connector는 Connection의 rules를 통해 이벤트를 Turn으로 변환할 때, 다음과 같이 `turn.auth.subjects`를 설정해야 한다(SHOULD).

```yaml
turn:
  origin:
    connector: slack
    connection: slack-main
    channel: "C123456"
    threadTs: "1700000000.000100"
    teamId: "T111"
    userId: "U234567"

  auth:
    actor:
      type: "user"
      id: "slack:U234567"
      display: "alice"
    subjects:
      # 워크스페이스 단위 토큰 조회용 (subjectMode=global)
      global: "slack:team:T111"
      # 사용자 단위 토큰 조회용 (subjectMode=user)
      user: "slack:user:T111:U234567"
```

### 10.3 TypeScript 구현 (개요)

```ts
import type { JsonObject, ObjectRefLike, Resource } from '@goondan/core';
import type { ConnectorSpec, ConnectionSpec } from '@goondan/core';

interface SlackEvent {
  type: string;
  team_id: string;
  user: string;
  channel: string;
  thread_ts?: string;
  ts: string;
  text?: string;
  command?: string;
}

interface SlackConnectorOptions {
  runtime: {
    handleEvent: (event: {
      swarmRef: ObjectRefLike;
      instanceKey: string;
      input: string;
      origin?: JsonObject;
      auth?: JsonObject;
    }) => Promise<void>;
  };
  connectorConfig: Resource<ConnectorSpec>;
  connectionConfig: Resource<ConnectionSpec>;
  logger?: Console;
}

export function createSlackConnector(options: SlackConnectorOptions) {
  const { runtime, connectorConfig, connectionConfig, logger } = options;
  const connectionSpec = connectionConfig.spec;
  const rules = connectionSpec?.rules ?? [];
  const egressConfig = connectionSpec?.egress;

  // 디바운스 상태 관리
  const pendingUpdates = new Map<string, NodeJS.Timeout>();

  async function handleEvent(payload: JsonObject): Promise<void> {
    const eventValue = payload.event;
    if (!eventValue || typeof eventValue !== 'object' || Array.isArray(eventValue)) {
      logger?.warn?.('Slack 이벤트가 없습니다.');
      return;
    }
    const event = eventValue as Record<string, unknown>;

    // Connection rules 매칭
    for (const rule of rules) {
      const match = rule.match ?? {};

      // command 매칭
      if (match.command && event.command !== match.command) {
        continue;
      }

      // eventType 매칭
      if (match.eventType && event.type !== match.eventType) {
        continue;
      }

      // channel 매칭
      if (match.channel && event.channel !== match.channel) {
        continue;
      }

      const route = rule.route;
      if (!route?.swarmRef) {
        logger?.warn?.('rule에 swarmRef가 없습니다.');
        continue;
      }

      const threadTs = typeof event.thread_ts === 'string' ? event.thread_ts : undefined;
      const ts = typeof event.ts === 'string' ? event.ts : '';
      const userId = typeof event.user === 'string' ? event.user : '';
      const teamId = typeof event.team_id === 'string' ? event.team_id : '';
      const channel = typeof event.channel === 'string' ? event.channel : '';
      const text = typeof event.text === 'string' ? event.text : '';

      // canonical event 생성
      await runtime.handleEvent({
        swarmRef: route.swarmRef,
        instanceKey: String(readPath(payload, route.instanceKeyFrom) || threadTs || ts),
        input: String(readPath(payload, route.inputFrom) || text),
        origin: {
          connector: connectorConfig.metadata?.name ?? 'slack',
          connection: connectionConfig.metadata?.name ?? 'slack-main',
          channel,
          threadTs: threadTs ?? ts,
          teamId,
          userId,
        },
        auth: {
          actor: {
            type: 'user',
            id: `slack:${userId}`,
          },
          subjects: {
            global: `slack:team:${teamId}`,
            user: `slack:user:${teamId}:${userId}`,
          },
        },
      });
      return;
    }

    logger?.debug?.('매칭되는 Connection rule이 없습니다.');
  }

  async function send(input: {
    text: string;
    origin?: JsonObject;
    kind?: 'progress' | 'final';
  }): Promise<{ ok: boolean }> {
    const channel = typeof input.origin?.channel === 'string' ? input.origin.channel : undefined;
    const threadTs = typeof input.origin?.threadTs === 'string' ? input.origin.threadTs : undefined;

    if (!channel) {
      logger?.error?.('channel 정보가 없어 메시지를 전송할 수 없습니다.');
      return { ok: false };
    }

    // 디바운스 처리
    const debounceMs = egressConfig?.updatePolicy?.debounceMs ?? 0;
    const debounceKey = `${channel}:${threadTs ?? ''}`;

    if (debounceMs > 0 && input.kind === 'progress') {
      const existing = pendingUpdates.get(debounceKey);
      if (existing) {
        clearTimeout(existing);
      }

      return new Promise((resolve) => {
        const timeout = setTimeout(async () => {
          pendingUpdates.delete(debounceKey);
          const result = await sendToSlack(channel, threadTs, input.text);
          resolve(result);
        }, debounceMs);
        pendingUpdates.set(debounceKey, timeout);
      });
    }

    return sendToSlack(channel, threadTs, input.text);
  }

  async function sendToSlack(
    channel: string,
    threadTs: string | undefined,
    text: string
  ): Promise<{ ok: boolean }> {
    // 실제 Slack API 호출 구현
    // ctx.oauth.getAccessToken()으로 토큰 획득 후 API 호출
    logger?.info?.(`[Slack] ${channel}${threadTs ? ` (thread: ${threadTs})` : ''}: ${text}`);
    return { ok: true };
  }

  return { handleEvent, send };
}

function readPath(payload: JsonObject, expr?: string): unknown {
  if (!expr || !expr.startsWith('$.')) return undefined;
  const keys = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    const obj = current as Record<string, unknown>;
    current = obj[key];
  }
  return current;
}
```

---

## 11. Custom Connector with Triggers

### 11.1 YAML 정의

Connector는 프로토콜과 Trigger만 정의하고, Connection에서 라우팅을 설정한다.

```yaml
# Connector: 커스텀 Webhook 프로토콜 + Trigger Handler
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: custom-webhook
spec:
  type: custom
  runtime: node
  entry: "./connectors/webhook/index.ts"
  triggers:
    - handler: onWebhook
    - handler: onSchedule
```

```yaml
# Connection: 라우팅 바인딩
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: webhook-default
spec:
  connectorRef: { kind: Connector, name: custom-webhook }
  rules:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.requestId"
        inputFrom: "$.body.message"
```

### 11.2 TypeScript 구현

```ts
// ./connectors/webhook/index.ts
import type { TriggerEvent, TriggerContext, JsonObject, Resource } from '@goondan/core';
import type { ConnectionSpec } from '@goondan/core';

/**
 * Webhook 이벤트 핸들러
 */
export async function onWebhook(
  event: TriggerEvent,
  connection: Resource<ConnectionSpec>,
  ctx: TriggerContext
): Promise<void> {
  const payload = event.payload;
  const connectionSpec = connection.spec;
  const rules = connectionSpec?.rules ?? [];

  for (const rule of rules) {
    const route = rule.route;
    if (!route?.swarmRef) continue;

    await ctx.emit({
      type: 'webhook',
      swarmRef: route.swarmRef,
      instanceKey: String(readPath(payload, route.instanceKeyFrom) || crypto.randomUUID()),
      input: String(readPath(payload, route.inputFrom) || ''),
      origin: {
        connector: ctx.connector.metadata?.name,
        connection: connection.metadata?.name,
        source: 'webhook',
        requestId: payload.requestId,
      },
      auth: {
        actor: { type: 'system', id: 'webhook' },
        subjects: { global: 'webhook:default' },
      },
    });
    return;
  }

  ctx.logger.warn('매칭되는 Connection rule이 없습니다.');
}

/**
 * 스케줄 이벤트 핸들러
 */
export async function onSchedule(
  event: TriggerEvent,
  connection: Resource<ConnectionSpec>,
  ctx: TriggerContext
): Promise<void> {
  const scheduleName = typeof event.payload.scheduleName === 'string'
    ? event.payload.scheduleName
    : 'default';

  await ctx.emit({
    type: 'cron',
    swarmRef: { kind: 'Swarm', name: 'default' },
    instanceKey: `schedule:${scheduleName}`,
    input: `스케줄 실행: ${scheduleName}`,
    origin: {
      connector: ctx.connector.metadata?.name,
      connection: connection.metadata?.name,
      source: 'cron',
      scheduleName,
    },
    auth: {
      actor: { type: 'system', id: 'scheduler' },
      subjects: { global: 'cron:default' },
    },
  });
}

function readPath(payload: JsonObject, expr?: string): unknown {
  if (!expr || !expr.startsWith('$.')) return undefined;
  const keys = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    const obj = current as Record<string, unknown>;
    current = obj[key];
  }
  return current;
}
```

---

## 12. Health Check

### 12.1 Connector 상태 확인

```typescript
/**
 * Connector Health Check
 *
 * 규칙:
 * - SHOULD: Connector는 외부 서비스 연결 상태를 확인하는 healthCheck를 구현할 수 있다
 * - SHOULD: healthCheck는 주기적으로 호출되며, 상태를 반환한다
 * - MUST: healthCheck 실패 시 해당 Connector를 통한 egress를 일시 중단할 수 있다
 */
interface ConnectorHealthCheck {
  /** 상태 확인 주기(ms) (기본: 30000) */
  intervalMs: number;

  /** 상태 확인 타임아웃(ms) (기본: 5000) */
  timeoutMs: number;

  /** 연속 실패 허용 횟수 (기본: 3) */
  failureThreshold: number;
}

type ConnectorHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface ConnectorHealth {
  status: ConnectorHealthStatus;
  lastCheck: string;          // ISO 8601 timestamp
  consecutiveFailures: number;
  details?: JsonObject;
}
```

### 12.2 Connector YAML에서 Health Check 설정

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  type: slack
  healthCheck:
    intervalMs: 30000
    timeoutMs: 5000
    failureThreshold: 3
```

---

## 13. Reconnection 정책

### 13.1 연결 끊김 시 재연결

```typescript
/**
 * Connector Reconnection 정책
 *
 * 규칙:
 * - SHOULD: WebSocket 등 장기 연결 기반 Connector는 reconnection 정책을 설정할 수 있다
 * - MUST: 재연결 시 exponential backoff를 적용한다
 * - SHOULD: 최대 재연결 횟수를 초과하면 ConnectorError를 발생시키고 로그에 기록한다
 * - SHOULD: 재연결 성공 시 이벤트 수신을 재개한다
 */
interface ReconnectionPolicy {
  /** 자동 재연결 활성화 (기본: true) */
  autoReconnect: boolean;

  /** 초기 재연결 대기 시간(ms) (기본: 1000) */
  initialDelayMs: number;

  /** 최대 재연결 대기 시간(ms) (기본: 60000) */
  maxDelayMs: number;

  /** 최대 재연결 시도 횟수 (기본: 10, -1은 무제한) */
  maxAttempts: number;

  /** backoff 승수 (기본: 2) */
  backoffMultiplier: number;
}
```

### 13.2 Connector YAML에서 Reconnection 설정

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: discord
spec:
  type: discord
  reconnection:
    autoReconnect: true
    initialDelayMs: 1000
    maxDelayMs: 60000
    maxAttempts: 10
```

---

## 14. Validation 포인트 요약

Connector와 Connection의 검증을 분리한다.

### 14.1 Connector Validation

Runtime/Validator는 Connector 리소스에 대해 다음 규칙을 검증해야 한다.

| 항목 | 규칙 | 수준 |
|------|------|------|
| `spec.type` | 필수, 비어있지 않은 문자열 | MUST |
| `spec.runtime` | `type: custom` 또는 triggers 사용 시 필수 | MUST |
| `spec.entry` | `type: custom` 또는 triggers 사용 시 필수 | MUST |
| `spec.triggers[].handler` | entry 모듈의 export 함수명 | MUST |
| `spec.triggers[].handler` | 모듈 한정자 포함 금지 | MUST |

### 14.2 Connection Validation

Connection 리소스의 검증 규칙은 [`docs/specs/connection.md` 14절](./connection.md#14-validation-포인트-요약)을 참조한다.

| 항목 | 규칙 | 수준 |
|------|------|------|
| `spec.connectorRef` | 유효한 Connector 참조, 필수 | MUST |
| `spec.auth` | oauthAppRef와 staticToken 중 하나만 허용 | MUST |
| `spec.rules` | 최소 1개의 규칙 필요 | MUST |
| `spec.rules[].route.swarmRef` | 유효한 Swarm 참조 | MUST |
| `spec.rules[].route.instanceKeyFrom` | 필수 | MUST |
| `spec.rules[].route.inputFrom` | 필수 | MUST |
| `spec.egress.updatePolicy.mode` | 유효한 모드 | MUST |

---

## 15. 참고 문서

- `docs/specs/connection.md` - Connection 리소스 스펙 (auth, rules, egress)
- `docs/specs/resources.md` - Config Plane 리소스 정의 스펙
- `docs/requirements/05_core-concepts.md` - Connector 핵심 개념
- `docs/requirements/07_config-resources.md` - Connector 리소스 정의
- `docs/requirements/09_runtime-model.md` - Runtime 실행 모델, Canonical Event Flow
- `docs/specs/api.md` - Connector API
- `docs/specs/bundle.md` - Connector YAML 스펙
