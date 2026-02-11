# Goondan Runtime/SDK API 스펙 (v2.0)

v2 런타임과 확장(Extension/Tool/Connector/Connection)의 **실행 API**를 정의한다. v2에서는 프로세스-per-에이전트 모델, Bun-native 런타임, Middleware Only 파이프라인을 기반으로 API 표면을 대폭 단순화한다.

> 공통 타입의 단일 기준(SSOT)은 `docs/specs/shared-types.md`이다. 이 문서의 타입 예시는 API 맥락 설명을 위한 축약본이며, 구조 변경 시 `shared-types.md`를 먼저 갱신해야 한다.

---

## 1. 공통 타입

이 문서는 API 표면의 사용 맥락을 설명하며, 공통 타입의 원형은 다음 SSOT를 따른다.

- `docs/specs/shared-types.md`
- `docs/specs/resources.md`
- `docs/specs/help.md`

### 1.1 타입 소유권

아래 타입은 `docs/specs/shared-types.md`를 단일 기준으로 사용한다.

- JSON 계열: `JsonPrimitive`, `JsonObject`, `JsonArray`, `JsonValue`
- 참조/값 주입: `ObjectRefLike`, `ObjectRef`, `ValueSource`, `SecretRef`
- 메시지/이벤트: `Message`, `MessageEvent`, `ConversationState`, `AgentEvent`, `EventSource`, `ReplyChannel`, `TurnAuth`
- 런타임/도구: `ProcessStatus`, `IpcMessage`, `ToolCall`, `ToolCallResult`, `ToolContext`, `TurnResult`

`Resource<T>`, `ResourceMetadata` 및 Kind별 스키마는 `docs/specs/resources.md`를 따른다.

### 1.2 API 문맥 규칙

1. 메시지 상태는 `NextMessages = BaseMessages + SUM(Events)` 계약을 따라야 한다(MUST).
2. v1의 `ctx.turn.messages.base/events/next/emit` 구조는 제거하고 `conversationState` + `emitMessageEvent`를 사용해야 한다(MUST).
3. IPC 타입은 `event`/`shutdown`/`shutdown_ack` 3종만 허용해야 한다(MUST).
4. 도구 이름은 `{리소스명}__{export명}` 규칙을 따라야 한다(MUST).
5. 공통 타입 변경 시 `shared-types.md`를 먼저 갱신하고 이 문서는 참조를 유지해야 한다(MUST).

### 1.3 최소 예시

```typescript
import type {
  ConversationState,
  AgentEvent,
  ToolCall,
  ToolCallResult,
  ToolContext,
  TurnResult,
  ProcessStatus,
  IpcMessage,
} from './shared-types';
```

---

## 2. ExtensionApi

Extension은 런타임 라이프사이클에 개입하는 미들웨어 로직 묶음이다. 상세 스펙은 `docs/specs/extension.md`를 참조한다.

### 2.1 엔트리포인트

```typescript
/**
 * Extension 등록 함수
 * AgentProcess는 초기화 시 Agent에 선언된 Extension 목록 순서대로 이를 호출한다.
 */
export function register(api: ExtensionApi): void;
```

### 2.2 ExtensionApi 인터페이스

`ExtensionApi` 원형은 `docs/specs/extension.md` 5.1절을 따른다.

### 2.3 PipelineRegistry

`PipelineRegistry`, `TurnMiddleware`, `StepMiddleware`, `ToolCallMiddleware`, `MiddlewareOptions` 원형은 `docs/specs/pipeline.md` 5절을 따른다.

상세 미들웨어 컨텍스트는 `docs/specs/pipeline.md` 4절을 참조한다.

### 2.4 사용 예시

```typescript
export function register(api: ExtensionApi): void {
  // 미들웨어 등록
  api.pipeline.register('step', async (ctx) => {
    const start = Date.now();
    const result = await ctx.next();
    api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
    return result;
  });

  // 동적 도구 등록
  api.tools.register(
    {
      name: 'my-ext__getData',
      description: '데이터 조회',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    },
    async (ctx, input) => {
      return { data: 'result', query: input.query };
    }
  );

  // 상태 관리
  api.state.set({ initialized: true, processedSteps: 0 });

  // 이벤트 구독
  api.events.on('turn.completed', () => {
    api.logger.info('Turn completed');
  });
}
```

---

## 3. ToolHandler API

Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위이다.

### 3.1 Tool 모듈 구조

Tool 모듈은 `handlers` 맵으로 핸들러를 제공한다.

`ToolHandler` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

```typescript
/** Tool 모듈 export 형식 */
export const handlers: Record<string, ToolHandler> = {
  exec: async (ctx, input) => {
    const proc = Bun.spawn(['sh', '-c', input.command as string]);
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  },
  script: async (ctx, input) => {
    const proc = Bun.spawn(['sh', input.path as string]);
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  },
};
```

### 3.2 ToolContext

`ToolContext` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

**제거된 필드:**

| 필드 | 사유 |
|------|------|
| `instance` (SwarmInstanceRef) | 프로세스-per-에이전트 모델에서 `agentName` + `instanceKey`로 대체 |
| `swarm` / `agent` (Resource) | ToolHandler는 리소스 정의에 접근 불필요 |
| `turn` / `step` (상세 객체) | `turnId` + `toolCallId`로 최소화 |
| `toolCatalog` | ToolHandler는 카탈로그에 접근 불필요 |
| `swarmBundle` (Changeset API) | Changeset 시스템 제거 |
| `liveConfig` (Config 패치) | Edit & Restart 모델로 대체 |
| `oauth` (OAuth API) | OAuthApp Kind 제거 |
| `events` (EventBus) | ToolHandler는 이벤트 발행 불필요 |
| `agents` (ToolAgentsApi) | 통합 이벤트 모델로 대체 (`AgentEvent` + `replyTo`, IPC Orchestrator 경유) |

### 3.3 ToolCatalogItem

`ToolCatalogItem` 원형은 `docs/specs/tool.md` 13절을 따른다.

### 3.4 ToolCallResult

`ToolCallResult` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

### 3.5 도구 이름 규칙

LLM에 노출되는 도구 이름은 **`{Tool 리소스 이름}__{하위 도구 이름}`** 형식을 따른다(MUST).

```text
Tool 리소스: bash          ->  exports: exec, script
LLM 도구 이름:  bash__exec,  bash__script

Tool 리소스: file-system   ->  exports: read, write
LLM 도구 이름:  file-system__read,  file-system__write
```

`__` (더블 언더스코어)는 AI SDK에서 허용되는 문자이므로 별도 변환 없이 그대로 사용한다.

**규칙:**

1. LLM에 노출되는 도구 이름은 `{Tool 리소스 metadata.name}__{export name}` 형식이어야 한다(MUST).
2. 구분자는 `__`(더블 언더스코어)를 사용해야 한다(MUST).
3. Tool 리소스 이름과 export name에는 `__`가 포함되어서는 안 된다(MUST NOT).
4. Tool 오류는 예외 전파 대신 구조화된 `ToolCallResult`로 LLM에 전달되어야 한다(MUST).

### 3.6 Tool 리소스 스키마

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
  labels:
    tier: base
spec:
  entry: "./tools/bash/index.ts"      # Bun으로 실행
  exports:
    - name: exec
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
    - name: script
      description: "스크립트 파일 실행"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: [path]
```

`runtime` 필드 제거 -- 항상 Bun.

---

## 4. ConnectorContext API

Connector는 **별도 Bun 프로세스**로 실행되며, 프로토콜 수신(HTTP 서버, cron 스케줄러 등)을 **자체적으로** 관리한다. 응답 전송은 Tool을 통해 처리하며, Connector는 이벤트 수신과 정규화에만 집중한다.

### 4.1 Connector 엔트리 함수

Connector entry 모듈은 **단일 default export 함수**를 제공해야 한다(MUST).

```typescript
/**
 * Connector Entry Function
 * 단일 default export로 제공
 * Connector가 프로토콜 처리를 직접 구현
 */
export default async function (ctx: ConnectorContext): Promise<void> {
  // Connector가 직접 HTTP 서버를 열어 웹훅 수신
  Bun.serve({
    port: Number(ctx.secrets.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();

      await ctx.emit({
        name: 'user_message',
        message: { type: 'text', text: body.message.text },
        properties: { chat_id: String(body.message.chat.id) },
        instanceKey: `telegram:${body.message.chat.id}`,
      });

      return new Response('OK');
    },
  });

  ctx.logger.info('Connector listening');
}
```

### 4.2 ConnectorContext 인터페이스

`ConnectorContext` 원형은 `docs/specs/connector.md` 5.2절을 따른다.

**제거된 필드:**

| 필드 | 사유 |
|------|------|
| `event` (ConnectorTriggerEvent) | Connector가 프로토콜을 자체 관리하므로 트리거 이벤트 불필요 |
| `connection` (Resource) | 리소스 정의 접근 불필요. 필요한 정보는 `secrets`로 제공 |
| `connector` (Resource) | 리소스 정의 접근 불필요 |
| `oauth` | OAuthApp Kind 제거 |
| `verify` | Connector가 자체적으로 서명 검증 수행 (시크릿은 `secrets`로 제공) |

### 4.3 ConnectorEvent

Connector가 `ctx.emit()`으로 Orchestrator에 전달하는 정규화된 이벤트.

`ConnectorEvent`/`ConnectorEventMessage` 원형은 `docs/specs/connector.md` 5.3절을 따른다.

### 4.4 Connector 리소스 스키마

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
```

`triggers` 필드 제거 -- Connector가 프로토콜 처리를 직접 구현.
`runtime` 필드 제거 -- 항상 Bun.

### 4.5 Connector 사용 예시: Telegram

```typescript
export default async function (ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;
  const botToken = secrets.BOT_TOKEN;
  const port = Number(secrets.PORT) || 3000;

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // 서명 검증 (Connector가 자체 수행)
      if (secrets.WEBHOOK_SECRET) {
        const signature = req.headers.get('x-telegram-bot-api-secret-token');
        if (signature !== secrets.WEBHOOK_SECRET) {
          logger.warn('Telegram 서명 검증 실패');
          return new Response('Unauthorized', { status: 401 });
        }
      }

      const body = await req.json();
      const message = body.message;
      if (!message?.text) return new Response('OK');

      await emit({
        name: 'user_message',
        message: { type: 'text', text: message.text },
        properties: {
          chat_id: String(message.chat.id),
          message_id: String(message.message_id),
        },
        instanceKey: `telegram:${message.chat.id}`,
      });

      return new Response('OK');
    },
  });

  logger.info(`Telegram connector listening on port ${port}`);
}
```

---

## 5. Connection 리소스

Connection은 Connector를 특정 배포 환경에 바인딩하는 리소스다. 시크릿을 제공하고, ingress 라우팅 규칙을 정의한다.

### 5.1 Connection 리소스 스키마

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-swarm
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"
  secrets:
    BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
    PORT:
      valueFrom:
        env: TELEGRAM_WEBHOOK_PORT
    WEBHOOK_SECRET:
      valueFrom:
        env: TELEGRAM_WEBHOOK_SECRET
  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
```

### 5.2 ConnectionSpec

`ConnectionSpec`/`IngressRule` 원형은 `docs/specs/connection.md` 3.2절을 따른다.
`ValueSource`/`SecretRef` 원형은 `docs/specs/shared-types.md` 3절을 따른다.

**규칙:**

1. Connection은 Connector가 사용할 시크릿을 제공해야 한다(MUST).
2. Connection의 ingress 규칙은 ConnectorEvent를 특정 Agent로 라우팅하는 데 사용되어야 한다(MUST).
3. `ingress.rules[].route.agentRef`가 생략되면 Swarm의 `entryAgent`로 라우팅해야 한다(MUST).

---

## 6. Orchestrator API

Orchestrator는 `gdn run`으로 기동되는 **상주 프로세스**로, Swarm의 전체 생명주기를 관리한다.

### 6.1 Orchestrator 인터페이스

`Orchestrator`/`AgentProcessHandle` 원형은 `docs/specs/runtime.md` 4.2절을 따른다.

`ProcessStatus` 원형은 `docs/specs/shared-types.md` 5절을 따른다.

### 6.2 책임

- `goondan.yaml` 파싱 및 리소스 로딩
- AgentProcess 스폰/감시/재시작
- Connector 프로세스 스폰/감시
- 인스턴스 라우팅 (`instanceKey` -> AgentProcess 매핑)
- IPC 메시지 브로커 (통합 이벤트 기반 에이전트 간 통신)
- 설정 변경 감지 및 에이전트 프로세스 재시작 (watch 모드)

### 6.3 재시작 옵션

`RestartOptions` 원형은 `docs/specs/runtime.md` 9.4절을 따른다.

---

## 7. AgentProcess API

각 AgentInstance는 **독립 Bun 프로세스**로 실행된다.

### 7.1 AgentProcess 인터페이스

`AgentProcess` 원형은 `docs/specs/runtime.md` 5.3절을 따른다.

### 7.2 프로세스 기동

```bash
bun run agent-runner.ts \
  --bundle-dir ./my-swarm \
  --agent-name coder \
  --instance-key "user:123"
```

### 7.3 프로세스 특성

- 자체 메모리 공간 (크래시 격리)
- Orchestrator와 IPC (Bun의 `process.send`/`process.on("message")` 또는 Unix socket)
- 독립적 Turn/Step 루프 실행
- Extension/Tool 코드를 자체 프로세스에서 로딩
- 크래시 시 Orchestrator가 감지하고 자동 재스폰 가능

### 7.4 TurnResult

`TurnResult` 원형은 `docs/specs/shared-types.md` 7절을 따른다.

---

## 8. IPC API

에이전트 간 통신은 Orchestrator를 경유하는 메시지 패싱으로 구현한다.

### 8.1 IpcMessage 타입

`IpcMessage`/`ShutdownReason` 원형은 `docs/specs/shared-types.md` 5절을 따른다.

### 8.2 통합 이벤트 흐름

모든 에이전트 입력(Connector 이벤트, 에이전트 간 요청, CLI 입력)은 `AgentEvent`로 통합된다. (상세는 `docs/specs/runtime.md`의 `통합 이벤트 흐름` 섹션 참조)

#### request (응답 대기)

1. AgentA → Orchestrator: `{ type: 'event', payload: AgentEvent(replyTo: { target: 'AgentA', correlationId }) }`
2. Orchestrator → AgentB 프로세스로 라우팅 (필요시 스폰)
3. AgentB Turn 완료 → Orchestrator: `{ type: 'event', payload: 응답 AgentEvent }`
4. Orchestrator → AgentA로 결과 전달 (correlationId로 매칭)

#### send (fire-and-forget)

1. AgentA → Orchestrator: `{ type: 'event', payload: AgentEvent(replyTo 없음) }`
2. Orchestrator → AgentB 프로세스로 라우팅 (필요시 스폰)

**규칙:**

1. IPC 메시지는 `event`, `shutdown`, `shutdown_ack` 3종을 지원해야 한다(MUST).
2. 모든 IPC 메시지는 `from`, `to`, `payload`를 포함해야 한다(MUST).
3. `event` 타입의 `payload`는 `AgentEvent` 구조를 따라야 한다(MUST).
4. 에이전트 간 요청-응답은 `AgentEvent.replyTo.correlationId`로 매칭해야 한다(MUST).
5. 대상 프로세스가 없으면 Orchestrator가 자동 스폰해야 한다(MUST).
6. `shutdown` 메시지의 `payload`는 `gracePeriodMs`와 `reason`을 포함해야 한다(MUST).
7. `shutdown_ack` 메시지는 AgentProcess가 drain 완료 후 Orchestrator에 전송해야 한다(MUST).

---

## 9. Runtime Events

Runtime이 발행하는 표준 이벤트 목록. Extension은 `api.events.on()`으로 구독할 수 있다.

### 9.1 표준 이벤트 타입

```typescript
type RuntimeEventType =
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'tool.called'
  | 'tool.completed'
  | 'tool.failed';
```

### 9.2 이벤트 Payload 구조

```typescript
interface TurnStartedEvent {
  type: 'turn.started';
  turnId: string;
  agentName: string;
  instanceKey: string;
  timestamp: string;
}

interface TurnCompletedEvent {
  type: 'turn.completed';
  turnId: string;
  agentName: string;
  instanceKey: string;
  stepCount: number;
  duration: number;
  timestamp: string;
}

interface StepStartedEvent {
  type: 'step.started';
  stepId: string;
  stepIndex: number;
  turnId: string;
  agentName: string;
  timestamp: string;
}

interface StepCompletedEvent {
  type: 'step.completed';
  stepId: string;
  stepIndex: number;
  turnId: string;
  agentName: string;
  toolCallCount: number;
  duration: number;
  timestamp: string;
}

interface ToolCalledEvent {
  type: 'tool.called';
  toolCallId: string;
  toolName: string;
  stepId: string;
  turnId: string;
  agentName: string;
  timestamp: string;
}

interface ToolCompletedEvent {
  type: 'tool.completed';
  toolCallId: string;
  toolName: string;
  status: 'ok' | 'error';
  duration: number;
  stepId: string;
  turnId: string;
  agentName: string;
  timestamp: string;
}
```

---

## 10. 제거된 API

v2에서 다음 API는 **제거**된다.

| 제거된 API | 사유 |
|------------|------|
| **OAuthApi** (`getAccessToken`) | OAuthApp Kind 제거. Extension 내부 구현 |
| **SwarmBundleApi** (`openChangeset`, `commitChangeset`, `getActiveRef`) | Changeset 시스템 제거. Edit & Restart 모델로 대체 |
| **LiveConfigApi** (`proposePatch`, `getEffectiveConfig`) | 동적 Config 변경은 Edit & Restart로 대체 |
| **ChangesetPolicy** 검증 | Changeset 시스템 제거 |
| **ToolAgentsApi** (`delegate`, `listInstances`, `spawnInstance`, `delegateToInstance`, `destroyInstance`) | 통합 이벤트 모델로 대체 (`AgentEvent` + `replyTo`, IPC Orchestrator 경유) |
| **EffectiveConfig** 구조 | Edit & Restart에서 불필요 |
| **Reconcile** 알고리즘 | Edit & Restart에서 불필요 |
| 복잡한 **Lifecycle** API (`pause`, `resume`, `terminate`) | `restart`로 통합 |
| **ConnectorTriggerEvent** / **TriggerPayload** | Connector가 프로토콜 자체 관리 |
| **HookSpec** / **HookAction** | Agent Hooks 제거, Extension 미들웨어로 대체 |
| **LlmMessage** (커스텀) | **Message** (AI SDK `CoreMessage` 래핑)로 대체 |
| **ExtensionHandler** Kind | 제거 |
| `runtime` 필드 (Tool/Extension/Connector) | 항상 Bun |

---

## 부록: Spec 타입 요약 (v2)

중복 타입 재정의를 피하기 위해 부록의 전체 인터페이스 목록은 제거한다.

빠른 참조:

- 공통 타입: `docs/specs/shared-types.md`
- 리소스 Kind 스키마(8종): `docs/specs/resources.md` 8절
- Tool 계약: `docs/specs/tool.md`
- 파이프라인 계약: `docs/specs/pipeline.md`
- 운영 도움말(레지스트리/CLI 매트릭스): `docs/specs/help.md`

---

## 변경 이력

- v2.0 (2026-02-12): Goondan v2 전면 재설계
  - 프로세스-per-에이전트 모델 (Orchestrator + AgentProcess + IPC)
  - Bun-native 런타임 (`runtime` 필드 제거)
  - Middleware Only 파이프라인 (Mutator 제거, 13 포인트 -> 3 미들웨어)
  - Message 래퍼 (AI SDK `CoreMessage` 기반)
  - 이벤트 소싱 유지 (`NextMessages = BaseMessages + SUM(Events)`)
  - ExtensionApi 단순화 (OAuth/SwarmBundle/LiveConfig/Hooks 제거)
  - Connector 자체 프로토콜 관리 (triggers 제거)
  - Edit & Restart 모델 (Changeset/Reconcile 제거)
  - `apiVersion: goondan.ai/v1`

---

## 참조

- @docs/specs/pipeline.md - 라이프사이클 파이프라인 스펙 (v2)
- @docs/specs/extension.md - Extension 시스템 스펙 (v2)
- @docs/architecture.md - 아키텍처 개요 (핵심 개념, 설계 패턴)
- @docs/new_spec.md - Goondan v2 간소화 스펙 원본
