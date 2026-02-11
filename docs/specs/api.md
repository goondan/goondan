# Goondan Runtime/SDK API 스펙 (v2.0)

v2 런타임과 확장(Extension/Tool/Connector/Connection)의 **실행 API**를 정의한다. v2에서는 프로세스-per-에이전트 모델, Bun-native 런타임, Middleware Only 파이프라인을 기반으로 API 표면을 대폭 단순화한다.

---

## 1. 공통 타입

### 1.1 JSON 기본 타입

```typescript
type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
```

### 1.2 리소스 참조 타입

```typescript
/**
 * 리소스 참조 - 문자열 축약 또는 객체형
 *
 * 문자열 축약: "Kind/name" (예: "Tool/bash", "Agent/coder")
 * 객체형: { kind, name }
 */
type ObjectRefLike =
  | string
  | { kind: string; name: string };

// 사용 예시
const toolRef1: ObjectRefLike = "Tool/bash";
const toolRef2: ObjectRefLike = { kind: "Tool", name: "bash" };
```

### 1.3 Resource 제네릭 구조

```typescript
interface Resource<TSpec = JsonObject> {
  apiVersion: string;          // "goondan.ai/v1"
  kind: string;
  metadata: ResourceMetadata;
  spec: TSpec;
}

interface ResourceMetadata {
  name: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}
```

### 1.4 Message 타입

v2에서는 AI SDK의 `CoreMessage`를 `Message`로 감싸서 관리한다.

```typescript
import type { CoreMessage } from 'ai';  // ai-sdk

/**
 * AI SDK 메시지를 감싸는 관리 래퍼.
 * Extension 미들웨어에서 메시지 식별/조작에 사용.
 */
interface Message {
  /** 고유 ID */
  readonly id: string;

  /** AI SDK CoreMessage (system | user | assistant | tool) */
  readonly data: CoreMessage;

  /** Extension/미들웨어가 읽고 쓸 수 있는 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 메시지 생성 시각 */
  readonly createdAt: Date;

  /** 이 메시지를 생성한 주체 */
  readonly source: MessageSource;
}

type MessageSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };
```

### 1.5 MessageEvent 타입

메시지 상태는 이벤트 소싱 모델로 관리한다.

```typescript
/**
 * NextMessages = BaseMessages + SUM(Events)
 */
type MessageEvent =
  | { type: 'append';   message: Message }
  | { type: 'replace';  targetId: string; message: Message }
  | { type: 'remove';   targetId: string }
  | { type: 'truncate' };
```

### 1.6 ConversationState

```typescript
interface ConversationState {
  /** Turn 시작 시점의 확정된 메시지들 */
  readonly baseMessages: Message[];

  /** Turn 진행 중 누적된 이벤트 */
  readonly events: MessageEvent[];

  /** 계산된 현재 메시지 상태: base + events 적용 결과 */
  readonly nextMessages: Message[];

  /** LLM에 보낼 메시지만 추출 (message.data 배열) */
  toLlmMessages(): CoreMessage[];
}
```

**규칙:**

1. `conversationState.baseMessages`는 Turn 시작 기준 메시지 스냅샷이어야 한다(MUST).
2. `conversationState.events`는 현재 Turn에서 누적된 메시지 이벤트의 순서 보장 뷰여야 한다(MUST).
3. `conversationState.nextMessages`는 `baseMessages + SUM(events)`와 동일하게 유지해야 한다(MUST).
4. v1의 `ctx.turn.messages.base/events/next/emit` 구조는 제거하고, `conversationState` + `emitMessageEvent`로 대체해야 한다(MUST).

상세 메시지 상태 계약은 `docs/specs/pipeline.md` 7절을 참조한다.

### 1.7 Turn / Step 타입

```typescript
interface Turn {
  readonly id: string;
  readonly agentName: string;
  readonly inputEvent: AgentEvent;
  readonly messages: Message[];
  readonly steps: Step[];
  status: 'running' | 'completed' | 'failed';
  metadata: Record<string, JsonValue>;
}

interface Step {
  readonly id: string;
  readonly index: number;
  readonly toolCatalog: ToolCatalogItem[];
  readonly toolCalls: ToolCall[];
  readonly toolResults: ToolCallResult[];
  status: 'llm_call' | 'tool_exec' | 'completed';
}

/**
 * AgentEvent: AgentProcess로 전달되는 모든 입력의 단일 타입.
 * delegate, connector.event, user.input을 통합한다. (runtime.md §5.5 참조)
 */
interface AgentEvent {
  /** 이벤트 ID */
  readonly id: string;
  /** 이벤트 타입 (자유 문자열, 라우팅/필터링용) */
  readonly type: string;
  /** 입력 텍스트 */
  readonly input?: string;
  /** 이벤트 출처 */
  readonly source: EventSource;
  /** 인증 컨텍스트 */
  readonly auth?: TurnAuth;
  /** 이벤트 메타데이터 */
  readonly metadata?: JsonObject;
  /**
   * 응답 채널. 존재하면 발신자가 응답을 기대한다.
   * - 있으면: 에이전트 간 request (이전의 delegate)
   * - 없으면: fire-and-forget (Connector 이벤트, 단방향 알림 등)
   */
  readonly replyTo?: ReplyChannel;
  /** 이벤트 생성 시각 */
  readonly createdAt: Date;
}

/** 이벤트 출처. 이전의 TurnOrigin을 대체한다. */
interface EventSource {
  readonly kind: 'agent' | 'connector';
  readonly name: string;
  readonly [key: string]: JsonValue | undefined;
}

/** 응답 채널. 발신자가 응답을 기대할 때 설정된다. */
interface ReplyChannel {
  readonly target: string;
  readonly correlationId: string;
}

interface ToolCall {
  id: string;
  name: string;
  args: JsonObject;
}
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

```typescript
interface ExtensionApi {
  /** 미들웨어 등록 */
  pipeline: PipelineRegistry;

  /** 동적 도구 등록 */
  tools: {
    register(item: ToolCatalogItem, handler: ToolHandler): void;
  };

  /** Extension별 상태 (JSON, 영속화) */
  state: {
    get(): Promise<JsonValue>;
    set(value: JsonValue): Promise<void>;
  };

  /** 이벤트 버스 (프로세스 내) */
  events: {
    on(event: string, handler: (...args: unknown[]) => void): () => void;
    emit(event: string, ...args: unknown[]): void;
  };

  /** 로거 */
  logger: Console;
}
```

### 2.3 PipelineRegistry

```typescript
interface PipelineRegistry {
  register(type: 'turn', fn: TurnMiddleware, options?: MiddlewareOptions): void;
  register(type: 'step', fn: StepMiddleware, options?: MiddlewareOptions): void;
  register(type: 'toolCall', fn: ToolCallMiddleware, options?: MiddlewareOptions): void;
}

type TurnMiddleware = (ctx: TurnMiddlewareContext) => Promise<TurnResult>;
type StepMiddleware = (ctx: StepMiddlewareContext) => Promise<StepResult>;
type ToolCallMiddleware = (ctx: ToolCallMiddlewareContext) => Promise<ToolCallResult>;

interface MiddlewareOptions {
  priority?: number;
}
```

상세 미들웨어 컨텍스트는 `docs/specs/pipeline.md` 3절을 참조한다.

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

```typescript
/**
 * Tool 핸들러 시그니처
 */
interface ToolHandler {
  (ctx: ToolContext, input: JsonObject): Promise<JsonValue>;
}

/**
 * Tool 모듈 export 형식
 */
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

```typescript
interface ToolContext {
  /** 현재 에이전트 이름 */
  readonly agentName: string;

  /** 현재 인스턴스 키 */
  readonly instanceKey: string;

  /** 현재 Turn ID */
  readonly turnId: string;

  /** 도구 호출 고유 ID */
  readonly toolCallId: string;

  /** 이 도구 호출을 트리거한 메시지 */
  readonly message: Message;

  /** 인스턴스별 작업 디렉터리 */
  readonly workdir: string;

  /** 로거 */
  readonly logger: Console;
}
```

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

```typescript
interface ToolCatalogItem {
  /** 도구 이름 ({리소스명}__{하위도구명} 형식) */
  name: string;
  /** 도구 설명 */
  description: string;
  /** 입력 파라미터 JSON Schema */
  parameters?: JsonObject;
}
```

### 3.4 ToolCallResult

```typescript
interface ToolCallResult {
  /** Tool 호출 ID */
  toolCallId: string;
  /** 도구 이름 */
  toolName: string;
  /** 실행 결과 */
  output: JsonValue;
  /** 실행 상태 */
  status: 'ok' | 'error';
  /** 오류 정보 (status가 error인 경우) */
  error?: {
    name: string;
    message: string;
    code?: string;
    suggestion?: string;
    helpUrl?: string;
  };
}
```

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

```typescript
interface ConnectorContext {
  /** ConnectorEvent 발행 (Orchestrator로 전달) */
  emit(event: ConnectorEvent): Promise<void>;

  /** Connection이 제공한 시크릿 (API 토큰, 포트 등) */
  secrets: Record<string, string>;

  /** 로거 */
  logger: Console;
}
```

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

```typescript
interface ConnectorEvent {
  /** 이벤트 이름 (connector의 events[]에 선언된 이름) */
  name: string;

  /** 멀티모달 입력 메시지 */
  message: ConnectorEventMessage;

  /** 이벤트 속성 (events[].properties에 선언된 키-값) */
  properties?: JsonObject;

  /** 인스턴스 키 (Orchestrator가 AgentProcess로 라우팅) */
  instanceKey: string;

  /** 인증 컨텍스트 (선택) */
  auth?: {
    actor: { id: string; name?: string };
  };
}

type ConnectorEventMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string }
  | { type: 'file'; data: string; mediaType: string };
```

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

```typescript
interface ConnectionSpec {
  /** Connector 참조 */
  connectorRef: ObjectRefLike;

  /** Swarm 참조 */
  swarmRef: ObjectRefLike;

  /** Connector에 전달할 시크릿 */
  secrets?: Record<string, ValueSource>;

  /** Ingress 라우팅 규칙 */
  ingress?: {
    rules: IngressRule[];
  };
}

interface IngressRule {
  /** 이벤트 매칭 조건 */
  match?: {
    event?: string;
    properties?: Record<string, string | number | boolean>;
  };
  /** 라우팅 대상 */
  route: {
    agentRef?: ObjectRefLike;
  };
}

type ValueSource =
  | { value: string }
  | { valueFrom: { env: string } };
```

**규칙:**

1. Connection은 Connector가 사용할 시크릿을 제공해야 한다(MUST).
2. Connection의 ingress 규칙은 ConnectorEvent를 특정 Agent로 라우팅하는 데 사용되어야 한다(MUST).
3. `ingress.rules[].route.agentRef`가 생략되면 Swarm의 `entryAgent`로 라우팅해야 한다(MUST).

---

## 6. Orchestrator API

Orchestrator는 `gdn run`으로 기동되는 **상주 프로세스**로, Swarm의 전체 생명주기를 관리한다.

### 6.1 Orchestrator 인터페이스

```typescript
interface Orchestrator {
  readonly swarmName: string;
  readonly bundleDir: string;
  readonly agents: Map<string, AgentProcessHandle>;

  /** 에이전트 프로세스 스폰 */
  spawn(agentName: string, instanceKey: string): AgentProcessHandle;

  /** 특정 에이전트 프로세스 kill -> 새 설정으로 re-spawn */
  restart(agentName: string): void;

  /** goondan.yaml 재로딩 후 모든 에이전트 프로세스 재시작 */
  reloadAndRestartAll(): void;

  /** 오케스트레이터 종료 (모든 자식 프로세스도 종료) */
  shutdown(): void;

  /** IPC 메시지 라우팅 */
  route(message: IpcMessage): void;
}

interface AgentProcessHandle {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly pid: number;
  readonly status: ProcessStatus;
}

type ProcessStatus =
  | 'spawning'
  | 'idle'
  | 'processing'
  | 'draining'
  | 'terminated'
  | 'crashed'
  | 'crashLoopBackOff';
```

### 6.2 책임

- `goondan.yaml` 파싱 및 리소스 로딩
- AgentProcess 스폰/감시/재시작
- Connector 프로세스 스폰/감시
- 인스턴스 라우팅 (`instanceKey` -> AgentProcess 매핑)
- IPC 메시지 브로커 (통합 이벤트 기반 에이전트 간 통신)
- 설정 변경 감지 및 에이전트 프로세스 재시작 (watch 모드)

### 6.3 재시작 옵션

```typescript
interface RestartOptions {
  /** 특정 에이전트만 재시작. 생략 시 전체 */
  agent?: string;
  /** 대화 히스토리 초기화 */
  fresh?: boolean;
}
```

---

## 7. AgentProcess API

각 AgentInstance는 **독립 Bun 프로세스**로 실행된다.

### 7.1 AgentProcess 인터페이스

```typescript
interface AgentProcess {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly pid: number;

  /** Turn 실행 */
  processTurn(event: AgentEvent): Promise<TurnResult>;

  /** 상태 */
  readonly status: ProcessStatus;

  /** 대화 히스토리 */
  readonly conversationHistory: Message[];
}
```

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

```typescript
interface TurnResult {
  /** Turn ID */
  readonly turnId: string;
  /** 최종 응답 메시지 */
  readonly responseMessage?: Message;
  /** Turn 종료 사유 */
  readonly finishReason: 'text_response' | 'max_steps' | 'error';
  /** 오류 정보 (실패 시) */
  readonly error?: {
    message: string;
    code?: string;
  };
}
```

---

## 8. IPC API

에이전트 간 통신은 Orchestrator를 경유하는 메시지 패싱으로 구현한다.

### 8.1 IpcMessage 타입

```typescript
interface IpcMessage {
  /** 메시지 타입 */
  type: 'event' | 'shutdown' | 'shutdown_ack';
  /** 발신자 (에이전트 이름 또는 'orchestrator') */
  from: string;
  /** 수신자 (에이전트 이름 또는 'orchestrator') */
  to: string;
  /** 메시지 페이로드 */
  payload: JsonValue;
}

// type: 'event'        → payload: AgentEvent
// type: 'shutdown'     → payload: { gracePeriodMs: number, reason: ShutdownReason }
// type: 'shutdown_ack' → payload: { status: 'drained' }

type ShutdownReason = 'restart' | 'config_change' | 'orchestrator_shutdown';
```

### 8.2 통합 이벤트 흐름

모든 에이전트 입력(Connector 이벤트, 에이전트 간 요청, CLI 입력)은 `AgentEvent`로 통합된다. (상세는 `runtime.md` §6.2 참조)

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

```typescript
// Model Spec
interface ModelSpec {
  provider: 'openai' | 'anthropic' | 'google' | string;
  model: string;
  apiKey?: ValueSource;
  options?: JsonObject;
}

// Tool Spec
interface ToolSpec {
  entry: string;
  exports: ToolExportSpec[];
  errorMessageLimit?: number;
}

interface ToolExportSpec {
  name: string;
  description: string;
  parameters?: JsonObject;
}

// Extension Spec
interface ExtensionSpec<Config = JsonObject> {
  entry: string;
  config?: Config;
}

// Agent Spec
interface AgentSpec {
  modelRef: ObjectRefLike;
  systemPrompt?: string;
  tools?: ObjectRefLike[];
  extensions?: ObjectRefLike[];
}

// Swarm Spec
interface SwarmSpec {
  agents: ObjectRefLike[];
  entryAgent: ObjectRefLike;
  policy?: {
    maxStepsPerTurn?: number;
    retry?: {
      maxRetries?: number;
      backoffMs?: number;
    };
    timeout?: {
      stepTimeoutMs?: number;
      turnTimeoutMs?: number;
    };
  };
}

// Connector Spec
interface ConnectorSpec {
  entry: string;
  events?: EventSchema[];
}

interface EventSchema {
  name: string;
  properties?: Record<string, { type: 'string' | 'number' | 'boolean' }>;
}

// Connection Spec
interface ConnectionSpec {
  connectorRef: ObjectRefLike;
  swarmRef: ObjectRefLike;
  secrets?: Record<string, ValueSource>;
  ingress?: {
    rules: IngressRule[];
  };
}

// Package Spec
interface PackageSpec {
  name: string;
  version: string;
  description?: string;
  dependencies?: Record<string, string>;
}
```

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
