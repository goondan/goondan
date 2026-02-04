# Goondan Connector 스펙 (v0.8)

본 문서는 `docs/requirements/index.md`(특히 5.3.2 및 7.6)와 `docs/specs/api.md`를 기반으로 Connector 시스템의 구현 스펙을 정의한다.

---

## 1. 개요

Connector는 외부 채널 이벤트를 수신하여 SwarmInstance/AgentInstance로 라우팅하고, 진행상황 업데이트와 완료 보고를 같은 맥락으로 송신하는 컴포넌트이다.

### 1.1 핵심 책임

1. **Ingress**: 외부 이벤트(Slack 메시지, CLI 입력, Webhook 등)를 canonical event로 변환하여 Runtime에 전달
2. **Egress**: AgentInstance의 응답을 외부 채널로 전송 (진행상황 업데이트, 최종 응답)
3. **인증 컨텍스트 설정**: Turn의 `origin`과 `auth` 정보를 채워 OAuth 통합 지원

### 1.2 설계 원칙

- Connector는 에이전트 실행 모델(Instance/Turn/Step)을 직접 제어하지 않는다(MUST).
- Connector는 canonical event 생성 책임만을 가지며, `ctx.emit(...)`을 통해 Runtime으로 전달한다(MUST).
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

  # 인증 설정 (선택)
  auth:
    oauthAppRef: { kind: OAuthApp, name: <oauth-app> }
    # 또는
    staticToken:
      value: "<plain-token>"
      # 또는
      valueFrom:
        env: "TOKEN_ENV_VAR"
        # 또는
        secretRef: { ref: "Secret/<name>", key: "<key>" }

  # 커스텀 런타임 (선택, type: custom 또는 triggers 사용 시)
  runtime: node
  entry: "./connectors/custom/index.ts"

  # Ingress 규칙
  ingress:
    - match: {}           # 선택: 매칭 조건
      route: {}           # 필수: 라우팅 설정

  # Egress 규칙 (선택)
  egress:
    updatePolicy: {}

  # Trigger 핸들러 (선택)
  triggers:
    - handler: <function-name>
```

### 2.2 ConnectorSpec TypeScript 인터페이스

```ts
interface ConnectorSpec {
  type: string;

  auth?: ConnectorAuth;

  runtime?: 'node';
  entry?: string;

  ingress: IngressRule[];
  egress?: EgressConfig;
  triggers?: TriggerConfig[];
}

interface ConnectorAuth {
  oauthAppRef?: ObjectRef;
  staticToken?: ValueSource;
}

interface IngressRule {
  match?: IngressMatch;
  route: IngressRoute;
}

interface IngressMatch {
  command?: string;
  eventType?: string;
  channel?: string;
  // 확장 가능
  [key: string]: unknown;
}

interface IngressRoute {
  swarmRef: ObjectRef;
  instanceKeyFrom: string;  // JSONPath 표현식
  inputFrom: string;        // JSONPath 표현식
  agentName?: string;       // 선택: 특정 에이전트로 라우팅
}

interface EgressConfig {
  updatePolicy: UpdatePolicy;
}

interface UpdatePolicy {
  mode: 'replace' | 'updateInThread' | 'append';
  debounceMs?: number;
}

interface TriggerConfig {
  handler: string;  // entry 모듈의 export 함수 이름
}
```

---

## 3. 인증 모드

Connector는 두 가지 인증 모드 중 하나를 사용할 수 있으며, 두 모드를 동시에 활성화할 수 없다(MUST).

### 3.1 OAuthApp 기반 모드

설치/승인 플로우를 통해 토큰을 획득하는 모드이다.

```yaml
kind: Connector
spec:
  type: slack
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  ingress:
    - match:
        command: "/agent"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
```

규칙:
1. Runtime은 OAuthApp 참조를 해석하여 토큰 조회 인터페이스를 제공해야 한다(SHOULD).
2. 토큰이 없거나 만료된 경우, 승인 플로우를 트리거할 수 있다(MAY).

### 3.2 Static Token 기반 모드

운영자가 발급한 토큰을 Secret으로 주입하는 모드이다.

```yaml
kind: Connector
spec:
  type: slack
  auth:
    staticToken:
      valueFrom:
        secretRef: { ref: "Secret/slack-bot-token", key: "bot_token" }
  ingress:
    - match:
        command: "/agent"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
```

규칙:
1. Static Token 모드에서는 OAuth 승인 플로우를 수행하지 않는다(MUST).
2. OAuthStore를 참조하지 않는다(MUST).
3. 토큰은 ValueSource 패턴을 따른다.

### 3.3 ValueSource 패턴

```ts
interface ValueSource {
  value?: string;
  valueFrom?: {
    env?: string;
    secretRef?: {
      ref: string;  // "Secret/<name>" 형식
      key: string;
    };
  };
}
```

규칙:
1. `value`와 `valueFrom`은 동시에 존재할 수 없다(MUST).
2. `valueFrom` 내에서 `env`와 `secretRef`는 동시에 존재할 수 없다(MUST).

---

## 4. Ingress 규칙

### 4.1 Match 조건

`match` 블록은 외부 이벤트를 필터링하는 조건을 정의한다.

```yaml
ingress:
  - match:
      command: "/swarm"      # Slack 슬래시 커맨드 매칭
      eventType: "message"   # 이벤트 타입 매칭
      channel: "C123456"     # 특정 채널 매칭
    route:
      # ...
```

`match`가 생략되면 모든 이벤트가 해당 규칙으로 라우팅된다.

### 4.2 Route 설정

`route` 블록은 매칭된 이벤트를 어떤 Swarm/Instance로 전달할지 정의한다.

```yaml
route:
  swarmRef: { kind: Swarm, name: default }
  instanceKeyFrom: "$.event.thread_ts"   # JSONPath
  inputFrom: "$.event.text"              # JSONPath
  agentName: "planner"                   # 선택: 특정 에이전트
```

규칙:
1. `swarmRef`는 필수이며, 유효한 Swarm을 참조해야 한다(MUST).
2. `instanceKeyFrom`은 JSONPath 표현식으로, 동일 맥락의 이벤트를 같은 인스턴스로 라우팅한다(MUST).
3. `inputFrom`은 JSONPath 표현식으로, LLM에 전달할 입력 텍스트를 추출한다(MUST).
4. `agentName`이 지정되면 해당 에이전트로 직접 라우팅하고, 생략되면 Swarm의 entrypoint 에이전트로 라우팅한다(SHOULD).

### 4.3 JSONPath 해석 규칙

```ts
// JSONPath 간단 구현 예시
function readPath(payload: JsonObject, expr: string): unknown {
  if (!expr || !expr.startsWith('$.')) return undefined;
  const keys = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as JsonObject)[key];
  }
  return current;
}
```

---

## 5. Egress 규칙

### 5.1 UpdatePolicy

```yaml
egress:
  updatePolicy:
    mode: updateInThread   # replace | updateInThread | append
    debounceMs: 1500       # 선택: 디바운스 시간(ms)
```

| Mode | 설명 |
|------|------|
| `replace` | 기존 메시지를 새 메시지로 교체 |
| `updateInThread` | 동일 스레드에 메시지 업데이트/추가 |
| `append` | 새 메시지를 추가만 함 |

### 5.2 Progress vs Final

Connector의 `send` 메서드는 `kind` 파라미터로 진행상황/최종 응답을 구분한다.

```ts
send({
  text: string;
  origin?: JsonObject;
  auth?: JsonObject;
  metadata?: JsonObject;
  kind?: 'progress' | 'final';
})
```

---

## 6. Trigger Handler 시스템

### 6.1 Handler 해석 및 로딩 규칙

Connector가 `spec.runtime.entry`와 `triggers`를 사용하는 경우, Runtime은 다음 규칙을 따른다.

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
// entry 모듈 예시: ./connectors/custom/index.ts
export async function onWebhook(event: TriggerEvent, connection: JsonObject, ctx: TriggerContext): Promise<void> {
  // ...
}

export async function onCron(event: TriggerEvent, connection: JsonObject, ctx: TriggerContext): Promise<void> {
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
  connection: JsonObject,
  ctx: TriggerContext
) => Promise<void>;

interface TriggerEvent {
  type: 'webhook' | 'cron' | 'queue' | 'message' | string;
  payload: JsonObject;
  timestamp: string;
  metadata?: JsonObject;
}

interface TriggerContext {
  // canonical event 발행
  emit: (event: CanonicalEvent) => Promise<void>;

  // 로깅
  logger: Console;

  // OAuth 토큰 접근 (OAuthApp 기반 모드인 경우)
  oauth?: {
    getAccessToken: (request: OAuthTokenRequest) => Promise<OAuthTokenResult>;
  };

  // LiveConfig 제안 (선택)
  liveConfig?: {
    proposePatch: (patch: LiveConfigPatch) => Promise<void>;
  };

  // Connector 설정
  connector: Resource<ConnectorSpec>;
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
     │
     ▼
[Trigger Handler]
     │
     │ ctx.emit(canonicalEvent)
     ▼
[Runtime 내부 이벤트 큐]
     │
     ▼
[SwarmInstance 조회/생성]
     │
     ▼
[AgentInstance 이벤트 큐]
     │
     ▼
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

Connector 구현은 factory 함수를 통해 생성된다.

```ts
interface ConnectorOptions {
  runtime: {
    handleEvent: (event: RuntimeEvent) => Promise<void>;
  };
  connectorConfig: Resource<ConnectorSpec>;
  logger?: Console;
}

type ConnectorFactory = (options: ConnectorOptions) => ConnectorAdapter;
```

---

## 9. CLI Connector 구현 예시

### 9.1 YAML 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"
```

### 9.2 TypeScript 구현

```ts
import * as readline from 'readline';
import type { JsonObject, ObjectRefLike } from '@goondan/core';

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
  connectorConfig: JsonObject;
  logger?: Console;
}

interface CliConnectorAdapter {
  handleEvent: (payload: JsonObject) => Promise<void>;
  send: (input: { text: string; kind?: 'progress' | 'final' }) => { ok: true };
  startInteractive: (defaultSwarmRef: ObjectRefLike, instanceKey: string) => void;
}

export function createCliConnector(options: CliConnectorOptions): CliConnectorAdapter {
  const { runtime, connectorConfig, logger } = options;
  const spec = connectorConfig.spec || {};
  const ingressRules = spec.ingress || [];

  async function handleEvent(payload: JsonObject): Promise<void> {
    const text = String(payload.text || '');

    for (const rule of ingressRules) {
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

    // 기본 라우팅 (ingress 규칙 없을 때)
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
    current = (current as JsonObject)[key];
  }
  return current;
}
```

---

## 10. Slack Connector 구현 예시

### 10.1 YAML 정의 (OAuthApp 기반)

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack-main
spec:
  type: slack
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  ingress:
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

Slack Connector는 ingress 이벤트를 Turn으로 변환할 때, 다음과 같이 `turn.auth.subjects`를 설정해야 한다(SHOULD).

```yaml
turn:
  origin:
    connector: slack-main
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
  logger?: Console;
}

export function createSlackConnector(options: SlackConnectorOptions) {
  const { runtime, connectorConfig, logger } = options;
  const spec = connectorConfig.spec || {};
  const ingressRules = spec.ingress || [];
  const egressConfig = spec.egress || {};

  // 디바운스 상태 관리
  const pendingUpdates = new Map<string, NodeJS.Timeout>();

  async function handleEvent(payload: JsonObject): Promise<void> {
    const event = payload.event as SlackEvent | undefined;
    if (!event) {
      logger?.warn?.('Slack 이벤트가 없습니다.');
      return;
    }

    // ingress 규칙 매칭
    for (const rule of ingressRules) {
      const match = rule.match || {};

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
        logger?.warn?.('ingress rule에 swarmRef가 없습니다.');
        continue;
      }

      // canonical event 생성
      await runtime.handleEvent({
        swarmRef: route.swarmRef,
        instanceKey: String(readPath(payload, route.instanceKeyFrom) || event.thread_ts || event.ts),
        input: String(readPath(payload, route.inputFrom) || event.text || ''),
        origin: {
          connector: connectorConfig.metadata?.name || 'slack',
          channel: event.channel,
          threadTs: event.thread_ts || event.ts,
          teamId: event.team_id,
          userId: event.user,
        },
        auth: {
          actor: {
            type: 'user',
            id: `slack:${event.user}`,
          },
          subjects: {
            global: `slack:team:${event.team_id}`,
            user: `slack:user:${event.team_id}:${event.user}`,
          },
        },
      });
      return;
    }

    logger?.debug?.('매칭되는 ingress 규칙이 없습니다.');
  }

  async function send(input: {
    text: string;
    origin?: JsonObject;
    kind?: 'progress' | 'final';
  }): Promise<{ ok: boolean }> {
    const channel = input.origin?.channel as string;
    const threadTs = input.origin?.threadTs as string;

    if (!channel) {
      logger?.error?.('channel 정보가 없어 메시지를 전송할 수 없습니다.');
      return { ok: false };
    }

    // 디바운스 처리
    const debounceMs = egressConfig.updatePolicy?.debounceMs ?? 0;
    const debounceKey = `${channel}:${threadTs}`;

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
    current = (current as JsonObject)[key];
  }
  return current;
}
```

---

## 11. Custom Connector with Triggers

### 11.1 YAML 정의

```yaml
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
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.requestId"
        inputFrom: "$.body.message"
```

### 11.2 TypeScript 구현

```ts
// ./connectors/webhook/index.ts
import type { TriggerEvent, TriggerContext, JsonObject } from '@goondan/core';

/**
 * Webhook 이벤트 핸들러
 */
export async function onWebhook(
  event: TriggerEvent,
  connection: JsonObject,
  ctx: TriggerContext
): Promise<void> {
  const payload = event.payload;
  const connector = ctx.connector;
  const ingressRules = connector.spec?.ingress || [];

  for (const rule of ingressRules) {
    const route = rule.route;
    if (!route?.swarmRef) continue;

    await ctx.emit({
      type: 'webhook',
      swarmRef: route.swarmRef,
      instanceKey: String(readPath(payload, route.instanceKeyFrom) || crypto.randomUUID()),
      input: String(readPath(payload, route.inputFrom) || ''),
      origin: {
        connector: connector.metadata?.name,
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

  ctx.logger.warn('매칭되는 ingress 규칙이 없습니다.');
}

/**
 * 스케줄 이벤트 핸들러
 */
export async function onSchedule(
  event: TriggerEvent,
  connection: JsonObject,
  ctx: TriggerContext
): Promise<void> {
  const scheduleName = event.payload.scheduleName || 'default';

  await ctx.emit({
    type: 'cron',
    swarmRef: { kind: 'Swarm', name: 'default' },
    instanceKey: `schedule:${scheduleName}`,
    input: `스케줄 실행: ${scheduleName}`,
    origin: {
      connector: ctx.connector.metadata?.name,
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
    current = (current as JsonObject)[key];
  }
  return current;
}
```

---

## 12. Validation 포인트 요약

Runtime/Validator는 다음 규칙을 검증해야 한다.

| 항목 | 규칙 | 수준 |
|------|------|------|
| `spec.type` | 필수 | MUST |
| `spec.auth` | oauthAppRef와 staticToken 중 하나만 허용 | MUST |
| `spec.ingress` | 최소 1개의 규칙 필요 | MUST |
| `spec.ingress[].route.swarmRef` | 유효한 Swarm 참조 | MUST |
| `spec.ingress[].route.instanceKeyFrom` | 필수 | MUST |
| `spec.ingress[].route.inputFrom` | 필수 | MUST |
| `spec.triggers[].handler` | entry 모듈의 export 함수명 | MUST |
| `spec.runtime` / `spec.entry` | triggers 사용 시 필수 | MUST |

---

## 13. 참고 문서

- `docs/requirements/05_core-concepts.md` - Connector 핵심 개념
- `docs/requirements/07_config-resources.md` - Connector 리소스 정의
- `docs/requirements/09_runtime-model.md` - Runtime 실행 모델, Canonical Event Flow
- `docs/specs/api.md` - Connector API
- `docs/specs/bundle.md` - Connector YAML 스펙
