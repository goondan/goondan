# Goondan 공통 타입 스펙 (v0.0.3)

`docs/specs` 전반에서 반복되는 타입 정의의 단일 기준(SSOT)을 정의한다.
다른 스펙 문서(`api`, `runtime`, `pipeline`, `tool`, `connection`, `resources`)는 이 문서를 우선 참조해야 하며, 동일 타입의 재정의를 지양한다.

---

## 1. 공통 JSON 타입

```typescript
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];
```

---

## 2. 리소스 참조 타입

```typescript
/**
 * ObjectRef 문자열 축약 또는 객체형
 * - 문자열: "Kind/name"
 * - 객체형: { kind, name, package?, apiVersion? }
 */
type ObjectRefLike = string | ObjectRef;

interface ObjectRef {
  kind: string;
  name: string;
  package?: string;
  apiVersion?: string;
}

/** ref 래퍼 형태 (YAML에서 권장) */
interface RefItem {
  ref: ObjectRefLike;
}
```

---

## 3. ValueSource / SecretRef

```typescript
type ValueSource =
  | { value: string; valueFrom?: never }
  | { value?: never; valueFrom: ValueFrom };

type ValueFrom =
  | { env: string; secretRef?: never }
  | { env?: never; secretRef: SecretRef };

interface SecretRef {
  ref: string; // "Secret/<name>"
  key: string;
}
```

---

## 4. 메시지 이벤트 소싱 타입

```typescript
import type { CoreMessage } from 'ai';

type MessageSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };

interface Message {
  readonly id: string;
  readonly data: CoreMessage;
  metadata: Record<string, JsonValue>;
  readonly createdAt: Date;
  readonly source: MessageSource;
}

type MessageEvent =
  | { type: 'append'; message: Message }
  | { type: 'replace'; targetId: string; message: Message }
  | { type: 'remove'; targetId: string }
  | { type: 'truncate' };

interface ConversationState {
  readonly baseMessages: Message[];
  readonly events: MessageEvent[];
  readonly nextMessages: Message[];
  toLlmMessages(): CoreMessage[];
}
```

---

## 5. TraceContext (OTel 호환 추적 컨텍스트)

에이전트 스웜 실행의 인과 체인을 추적하기 위한 OTel(OpenTelemetry) 호환 추적 컨텍스트.

### 5.1 타입 정의

```typescript
interface TraceContext {
  /** 최초 입력부터 전체 실행 체인 끝까지 유지되는 추적 ID */
  readonly traceId: string;

  /** 현재 실행 단위(Turn/Step/Tool Call)의 고유 ID */
  readonly spanId: string;

  /** 이 실행을 유발한 상위 실행 단위의 spanId. root span은 undefined */
  readonly parentSpanId?: string;
}
```

### 5.2 Span 계층 구조

```
[Connector Event 수신]           <- root span (traceId 생성, parentSpanId 없음)
  +-- [Agent A Turn]             <- child span
       +-- [Step 1]              <- child span
       |    +-- [LLM 호출]       <- child span
       |    +-- [Tool: bash]     <- child span
       |    +-- [Tool: agents__request]  <- child span
       |         +-- [Agent B Turn]      <- child span (같은 traceId!)
       |              +-- [Step 1]       <- child span
       |                   +-- [LLM 호출] <- child span
       +-- [Step 2]              <- child span
            +-- [LLM 호출]       <- child span
```

### 5.3 TraceContext 전파 규칙

1. `traceId`는 최초 입력 시점(Connector event 수신, CLI 입력 등)에 한 번 생성되고, 인터-에이전트 호출을 포함한 전체 실행 체인에서 **절대 재생성하지 않는다**(MUST).
2. 각 실행 단위(Turn, Step, Tool Call)는 새 `spanId`를 생성하되, `parentSpanId`로 상위 실행 단위와 연결한다(MUST).
3. 인터-에이전트 호출(`agents__request`, `agents__send`) 시 호출자의 `traceId`를 피호출자에게 전달한다(MUST). 피호출자의 Turn은 호출자의 Tool Call `spanId`를 `parentSpanId`로 사용한다.
4. Orchestrator는 IPC 라우팅 시 `TraceContext`를 손실 없이 전달한다(MUST).

### 5.4 ID 생성 규칙

- `traceId`: 32자 hex 문자열 (OTel Trace ID 호환, 128-bit)
- `spanId`: 16자 hex 문자열 (OTel Span ID 호환, 64-bit)
- 생성 방법: `crypto.randomBytes(16).toString('hex')` (traceId), `crypto.randomBytes(8).toString('hex')` (spanId)

---

## 6. 통합 이벤트 / IPC 타입

```typescript
interface EventEnvelope {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
  readonly traceId?: string;
  readonly metadata?: JsonObject;
}

interface EventSource {
  readonly kind: 'agent' | 'connector';
  readonly name: string;
  readonly [key: string]: JsonValue | undefined;
}

interface ReplyChannel {
  readonly target: string;
  readonly correlationId: string;
}

interface TurnAuth {
  readonly principal?: {
    type: string;
    id: string;
    [key: string]: JsonValue | undefined;
  };
  readonly [key: string]: JsonValue | undefined;
}

interface AgentEvent extends EventEnvelope {
  readonly input?: string;
  readonly instanceKey?: string;
  readonly source: EventSource;
  readonly auth?: TurnAuth;
  readonly replyTo?: ReplyChannel;
}

type ProcessStatus =
  | 'spawning'
  | 'idle'
  | 'processing'
  | 'draining'
  | 'terminated'
  | 'crashed'
  | 'crashLoopBackOff';

interface IpcMessage {
  type: 'event' | 'shutdown' | 'shutdown_ack';
  from: string;
  to: string;
  payload: JsonValue;
}

type ShutdownReason = 'restart' | 'config_change' | 'orchestrator_shutdown';
```

### 6.1 AgentEvent.instanceKey 규칙

1. `instanceKey`는 이벤트를 수신할 에이전트 인스턴스를 식별한다(MUST).
2. Connector가 생성하는 `ConnectorEvent`에 `instanceKey`를 포함하면, Orchestrator는 이를 기반으로 AgentProcess를 라우팅한다(MUST).
3. 에이전트 간 통신(`agents__request`, `agents__send`)에서 `instanceKey`를 명시하면 특정 인스턴스로 라우팅된다(SHOULD). 생략 시 기본 인스턴스로 라우팅된다.
4. `instanceKey`는 `@goondan/types`의 `AgentEvent` 인터페이스에 포함되어야 한다(MUST).

---

## 7. Tool 실행 타입

```typescript
interface ExecutionContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly traceId: string;
}

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: JsonObject;
}

interface ToolCallResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output?: JsonValue;
  readonly status: 'ok' | 'error';
  readonly error?: {
    name?: string;
    message: string;
    code?: string;
    suggestion?: string;
    helpUrl?: string;
  };
}
```

---

## 8. 에이전트 통신 API 타입 (단일 계약)

이 섹션은 에이전트 간 통신의 입출력 계약을 **단일 정의**한다. `pipeline.md`의 `MiddlewareAgentsApi`와 `tool.md`의 agents tool은 이 계약을 참조한다.

### 8.1 통신 옵션 / 결과 타입

```typescript
interface AgentRuntimeRequestOptions {
  timeoutMs?: number;
}

interface AgentRuntimeRequestResult {
  eventId: string;
  target: string;
  response?: JsonValue;
  correlationId: string;
}

interface AgentRuntimeSendResult {
  eventId: string;
  target: string;
  accepted: boolean;
}

interface AgentRuntimeSpawnOptions {
  instanceKey?: string;
  cwd?: string;
}

interface AgentRuntimeSpawnResult {
  target: string;
  instanceKey: string;
  spawned: boolean;
  cwd?: string;
}

interface AgentRuntimeListOptions {
  includeAll?: boolean;
}

interface SpawnedAgentInfo {
  target: string;
  instanceKey: string;
  ownerAgent: string;
  ownerInstanceKey: string;
  createdAt: string;
  cwd?: string;
}

interface AgentRuntimeListResult {
  agents: SpawnedAgentInfo[];
}

interface AgentRuntimeCatalogResult {
  swarmName: string;
  entryAgent: string;
  selfAgent: string;
  availableAgents: string[];
  callableAgents: string[];
}
```

### 8.2 AgentToolRuntime (Tool에서 사용하는 에이전트 통신 인터페이스)

`ToolContext.runtime`을 통해 Tool 핸들러에서 에이전트 간 통신을 수행한다.

```typescript
interface AgentToolRuntime {
  request(
    target: string,
    event: AgentEvent,
    options?: AgentRuntimeRequestOptions
  ): Promise<AgentRuntimeRequestResult>;
  send(target: string, event: AgentEvent): Promise<AgentRuntimeSendResult>;
  spawn(target: string, options?: AgentRuntimeSpawnOptions): Promise<AgentRuntimeSpawnResult>;
  list(options?: AgentRuntimeListOptions): Promise<AgentRuntimeListResult>;
  catalog(): Promise<AgentRuntimeCatalogResult>;
}
```

### 8.3 MiddlewareAgentsApi (Middleware에서 사용하는 에이전트 통신 인터페이스)

`turn`/`step` 미들웨어의 `ctx.agents`를 통해 다른 Agent를 호출한다. `AgentToolRuntime`과 동일한 라우팅/자동 스폰 규칙을 따르며, 편의를 위해 파라미터 형태만 다르다.

```typescript
interface MiddlewareAgentsApi {
  request(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    timeoutMs?: number; // default: 60000
    metadata?: JsonObject;
  }): Promise<{ target: string; response: string }>;

  send(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    metadata?: JsonObject;
  }): Promise<{ accepted: boolean }>;
}
```

### 8.4 ToolContext (완전한 정의)

```typescript
interface ToolContext extends ExecutionContext {
  readonly toolCallId: string;
  readonly message: Message;
  readonly workdir: string;
  readonly logger: Console;
  readonly runtime?: AgentToolRuntime;
}

type ToolHandler = (ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue;
```

### 8.5 에이전트 통신 계약 규칙

1. `AgentToolRuntime`과 `MiddlewareAgentsApi`는 동일한 Orchestrator IPC 라우팅 경로를 재사용한다(MUST).
2. `request`의 기본 타임아웃은 60000ms이다(MUST).
3. Runtime은 `request`에 대해 순환 호출을 감지하고 오류를 반환해야 한다(MUST).
4. `MiddlewareAgentsApi`는 `turn`/`step` 미들웨어에서만 제공된다(MUST). `toolCall` 미들웨어에서는 제공하지 않는다(MUST NOT).
5. `AgentToolRuntime`은 `ToolContext.runtime`을 통해 제공되며, agents tool에서만 사용된다(SHOULD).
6. 통신 실패는 `AgentToolRuntime`에서는 `ToolCallResult`(`status="error"`)로, `MiddlewareAgentsApi`에서는 예외로 반환된다(MUST).

---

## 9. RuntimeEvent 타입 (O11y 이벤트 계약)

Runtime이 발행하는 관측성 이벤트의 계약을 정의한다. 이 계약은 `@goondan/types`가 소유하며, Runtime은 발행자이다.

### 9.1 공통 베이스

모든 RuntimeEvent는 공통 베이스 필드와 `TraceContext`를 포함한다.

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

interface RuntimeEventBase {
  /** 이벤트 종류 (discriminant) */
  type: RuntimeEventType;

  /** ISO 8601 타임스탬프 */
  timestamp: string;

  /** 이벤트를 발행한 에이전트 이름 */
  agentName: string;

  /** 에이전트 인스턴스 키 */
  instanceKey: string;

  /** OTel 호환 추적 컨텍스트 */
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}
```

### 9.2 Turn 이벤트 (3종)

```typescript
interface TurnStartedEvent extends RuntimeEventBase {
  type: 'turn.started';
  turnId: string;
}

interface TurnCompletedEvent extends RuntimeEventBase {
  type: 'turn.completed';
  turnId: string;
  /** 실제 실행된 Step 수 (0이 아닌 실측값이어야 한다) */
  stepCount: number;
  /** Turn 소요 시간 (밀리초) */
  duration: number;
  /** 토큰 사용량 */
  tokenUsage?: TokenUsage;
}

interface TurnFailedEvent extends RuntimeEventBase {
  type: 'turn.failed';
  turnId: string;
  duration: number;
  errorMessage: string;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

### 9.3 Step 이벤트 (3종)

```typescript
interface StepStartedLlmInputMessage {
  role: string;
  content: string;
}

interface StepStartedEvent extends RuntimeEventBase {
  type: 'step.started';
  stepId: string;
  stepIndex: number;
  turnId: string;
  /** 관측 목적의 LLM 입력 메시지 요약 (선택) */
  llmInputMessages?: StepStartedLlmInputMessage[];
}

interface StepCompletedEvent extends RuntimeEventBase {
  type: 'step.completed';
  stepId: string;
  stepIndex: number;
  turnId: string;
  toolCallCount: number;
  duration: number;
  /** Step 단위 토큰 사용량 (선택) */
  tokenUsage?: TokenUsage;
}

interface StepFailedEvent extends RuntimeEventBase {
  type: 'step.failed';
  stepId: string;
  stepIndex: number;
  turnId: string;
  duration: number;
  errorMessage: string;
}
```

### 9.4 Tool 이벤트 (3종)

```typescript
interface ToolCalledEvent extends RuntimeEventBase {
  type: 'tool.called';
  toolCallId: string;
  toolName: string;
  stepId: string;
  turnId: string;
}

interface ToolCompletedEvent extends RuntimeEventBase {
  type: 'tool.completed';
  toolCallId: string;
  toolName: string;
  status: 'ok' | 'error';
  duration: number;
  stepId: string;
  turnId: string;
}

interface ToolFailedEvent extends RuntimeEventBase {
  type: 'tool.failed';
  toolCallId: string;
  toolName: string;
  duration: number;
  stepId: string;
  turnId: string;
  errorMessage: string;
}
```

### 9.5 RuntimeEvent 유니언

```typescript
type RuntimeEvent =
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | ToolCalledEvent
  | ToolCompletedEvent
  | ToolFailedEvent;
```

### 9.6 Span 생성 규칙 (RuntimeEvent와 TraceContext의 관계)

각 RuntimeEvent 발행 시 `spanId` 생성과 `parentSpanId` 설정 규칙:

| 이벤트 | spanId | parentSpanId |
|--------|--------|-------------|
| `turn.started` | Turn의 spanId (신규 생성) | 이벤트 소스의 spanId (인터-에이전트 호출이면 호출자 Tool Call의 spanId, 외부 입력이면 undefined) |
| `turn.completed` / `turn.failed` | Turn과 동일한 spanId | Turn과 동일한 parentSpanId |
| `step.started` | Step의 spanId (신규 생성) | Turn의 spanId |
| `step.completed` / `step.failed` | Step과 동일한 spanId | Turn의 spanId |
| `tool.called` | Tool Call의 spanId (신규 생성) | Step의 spanId |
| `tool.completed` / `tool.failed` | Tool Call과 동일한 spanId | Step의 spanId |

### 9.7 RuntimeEvent 규칙

1. `RuntimeEvent` 계약은 `@goondan/types`가 소유한다(MUST). Runtime은 발행자이며 계약 소유자가 아니다.
2. 모든 `RuntimeEvent`에 `traceId`, `spanId`를 포함한다(MUST). `parentSpanId`는 root span을 제외하고 포함한다(MUST).
3. 모든 `RuntimeEvent`에 `instanceKey`를 포함한다(MUST).
4. `turn.completed`의 `stepCount`는 실제 실행된 Step 수를 반영한다(MUST). 항상 0으로 emit하는 것은 버그이다.
5. `TokenUsage`는 `turn.completed`에 포함하는 것을 권장한다(SHOULD). `step.completed`에도 선택적으로 포함할 수 있다(MAY).
6. 이벤트 이름은 dot notation을 사용한다(MUST). `toolCall` (camelCase)이 아닌 `tool.called` (dot notation)을 사용한다.
7. RuntimeEvent는 인스턴스별 `messages/runtime-events.jsonl`에 append-only로 기록된다(MUST). 메시지 상태 계산(`Base + SUM(Events)`)에는 포함하지 않는다(MUST NOT).

---

## 10. Turn 결과 타입

```typescript
interface TurnResult {
  readonly turnId: string;
  readonly responseMessage?: Message;
  readonly finishReason: 'text_response' | 'max_steps' | 'error';
  readonly error?: {
    message: string;
    code?: string;
  };
}
```

---

## 11. 규범 규칙

1. `docs/specs` 내 공통 타입은 이 문서를 기준으로 유지해야 한다(MUST).
2. 개별 스펙 문서는 공통 타입을 재정의하기보다 링크/참조를 우선해야 한다(SHOULD).
3. 불가피하게 재기재할 경우, 타입 구조와 필드명을 이 문서와 동일하게 유지해야 한다(MUST).
4. `ConversationState` 계약은 `NextMessages = BaseMessages + SUM(Events)`를 따라야 한다(MUST).
5. `IpcMessage`는 `event`/`shutdown`/`shutdown_ack` 3종만 허용한다(MUST).
6. `ToolContext`에는 `workdir`를 포함해야 한다(MUST).
7. `ToolContext.runtime`은 `AgentToolRuntime` 인터페이스를 따라야 한다(MUST).
8. 에이전트 통신 API 계약은 이 문서의 8절이 유일한 SSOT이다(MUST). `pipeline.md`와 `tool.md`는 이를 참조만 한다.
9. `RuntimeEvent` 계약은 이 문서의 9절이 유일한 SSOT이다(MUST). `api.md`와 `runtime.md`는 이를 참조만 한다.
10. `TraceContext` 전파 규칙은 이 문서의 5.3절을 단일 기준으로 따른다(MUST).
11. `AgentEvent`는 `instanceKey` 필드를 포함해야 한다(MUST).

---

## 관련 문서

- `docs/specs/runtime.md` - Runtime 실행 모델 (Turn/Step, IPC, O11y)
- `docs/specs/api.md` - Runtime/SDK API (이벤트 표면, Extension API)
- `docs/specs/pipeline.md` - 라이프사이클 파이프라인 (미들웨어 컨텍스트)
- `docs/specs/resources.md` - Config 리소스 (Kind 스키마)
- `docs/specs/tool.md` - Tool 시스템 (ToolContext, agents tool)
- `docs/specs/connection.md` - Connection (IngressRoute)
