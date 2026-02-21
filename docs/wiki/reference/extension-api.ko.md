# Extension API 레퍼런스

> **대상 독자**: Extension Maker
> **버전**: v0.0.3
> **정규 스펙**: [`docs/specs/extension.md`](../../specs/extension.md), [`docs/specs/api.md`](../../specs/api.md), [`docs/specs/pipeline.md`](../../specs/pipeline.md)

[English version](./extension-api.md)

---

## 개요

Extension은 런타임 라이프사이클에 개입하는 미들웨어 로직 묶음입니다. Extension은 LLM의 tool call을 직접 받지 않으며, 대신 미들웨어를 등록하고, 상태를 관리하고, 이벤트를 구독하고, `ExtensionApi`를 통해 동적 도구를 등록합니다. 또한 `turn` / `step` 미들웨어에서는 `ctx.agents`로 다른 에이전트를 프로그래매틱하게 호출할 수 있습니다.

이 문서는 Extension 작성자가 사용할 수 있는 모든 프로퍼티와 메서드에 대한 정밀 레퍼런스입니다. 개념적 배경은 [Extension Pipeline (Explanation)](../explanation/extension-pipeline.ko.md), 실용 가이드는 [Extension 작성법 (How-to)](../how-to/write-an-extension.ko.md)을 참조하세요.

---

## 엔트리 모듈

모든 Extension 모듈은 `register` 함수를 named export해야 합니다. AgentProcess는 초기화 시 Agent의 `spec.extensions` 배열에 선언된 순서대로 `register(api)`를 호출합니다.

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi } from '@goondan/types';

export function register(api: ExtensionApi): void {
  // 미들웨어, 도구, 이벤트 핸들러 등을 등록
}
```

### 시그니처

```typescript
export function register(api: ExtensionApi): void | Promise<void>;
```

### 규칙

- 모듈은 반드시 `register`를 named export해야 합니다.
- `register`는 `void`(동기) 또는 `Promise<void>`(비동기)를 반환할 수 있습니다. AgentProcess는 반환을 대기한 후 다음으로 진행합니다.
- Extension은 순차적으로 초기화됩니다 -- 이전 Extension의 `register()`가 완료된 후 다음 Extension이 호출됩니다.
- `register()` 중 예외가 발생하면 AgentProcess 초기화가 실패합니다.

---

## ExtensionApi

`ExtensionApi` 인터페이스는 Extension에 제공되는 유일한 API 표면입니다. 5개 영역으로 구성됩니다.

```typescript
interface ExtensionApi {
  /** 미들웨어 등록 */
  pipeline: PipelineRegistry;

  /** 동적 도구 등록 */
  tools: ExtensionToolsApi;

  /** Extension별 영속 상태 (JSON) */
  state: ExtensionStateApi;

  /** 프로세스 내 이벤트 버스 (pub/sub) */
  events: ExtensionEventsApi;

  /** 구조화된 로거 */
  logger: Console;
}
```

| 영역 | 용도 |
|------|------|
| [`pipeline`](#1-pipeline--pipelineregistry) | `turn` / `step` / `toolCall` 미들웨어 등록 |
| [`tools`](#2-tools--extensiontoolsapi) | 런타임에 동적으로 도구 등록 |
| [`state`](#3-state--extensionstateapi) | 인스턴스별 JSON 상태 읽기/쓰기 (자동 영속화) |
| [`events`](#4-events--extensioneventsapi) | 프로세스 내 이벤트 발행 및 구독 |
| [`logger`](#5-logger--console) | 표준 `Console` 메서드 기반 구조화 로깅 |

---

### 1. `pipeline` -- PipelineRegistry

Turn, Step, ToolCall 세 수준에서 런타임 실행을 감싸는 미들웨어를 등록합니다.

```typescript
interface PipelineRegistry {
  register(type: 'turn', fn: TurnMiddleware, options?: MiddlewareOptions): void;
  register(type: 'step', fn: StepMiddleware, options?: MiddlewareOptions): void;
  register(type: 'toolCall', fn: ToolCallMiddleware, options?: MiddlewareOptions): void;
}

interface MiddlewareOptions {
  /** 실행 우선순위. 낮을수록 바깥 레이어(먼저 실행). 기본값: 0 */
  priority?: number;
}
```

#### 미들웨어 타입

```typescript
type TurnMiddleware = (ctx: TurnMiddlewareContext) => Promise<TurnResult>;
type StepMiddleware = (ctx: StepMiddlewareContext) => Promise<StepResult>;
type ToolCallMiddleware = (ctx: ToolCallMiddlewareContext) => Promise<ToolCallResult>;
```

#### 규칙

- `'turn'`, `'step'`, `'toolCall'` 세 가지 미들웨어 타입만 허용됩니다.
- 동일 타입의 미들웨어가 여러 개 등록되면 **onion 순서**로 체이닝됩니다 (먼저 등록 = 바깥 레이어).
- 하나의 Extension이 여러 종류의 미들웨어를 동시에 등록할 수 있습니다.
- 하나의 Extension이 같은 종류의 미들웨어를 여러 개 등록할 수 있습니다.
- `ctx.agents.request()` / `ctx.agents.send()`은 `turn`, `step` 미들웨어에서만 제공됩니다 (`toolCall`에서는 미제공).

#### 예제

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('step', async (ctx) => {
    const start = Date.now();
    const result = await ctx.next();
    api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
    return result;
  });
}
```

---

#### 1.1 TurnMiddlewareContext

전체 Turn을 감쌉니다 -- 입력 이벤트 수신부터 `TurnResult` 생성까지.

```typescript
interface TurnMiddlewareContext extends ExecutionContext {
  /** 이 Turn을 트리거한 입력 이벤트 */
  readonly inputEvent: AgentEvent;

  /** 대화 상태 (base + events 이벤트 소싱) */
  readonly conversationState: ConversationState;

  /** 미들웨어에서 다른 에이전트를 프로그래매틱하게 호출 */
  readonly agents: MiddlewareAgentsApi;

  /** 메시지 이벤트 발행 (append / replace / remove / truncate) */
  emitMessageEvent(event: MessageEvent): void;

  /** 미들웨어 간 공유 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 다음 미들웨어 또는 코어 Turn 로직 실행 */
  next(): Promise<TurnResult>;
}
```

**`ExecutionContext`에서 상속:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `agentName` | `string` | 현재 에이전트 이름 |
| `instanceKey` | `string` | 현재 인스턴스 키 |
| `turnId` | `string` | 현재 Turn 식별자 |
| `traceId` | `string` | Turn 추적 식별자 |

**Turn 전용 필드:**

| 필드 | 타입 | 변경 가능 | 설명 |
|------|------|-----------|------|
| `inputEvent` | `AgentEvent` | readonly | Turn을 시작한 이벤트 |
| `conversationState` | `ConversationState` | readonly | 현재 대화 상태 |
| `agents` | `MiddlewareAgentsApi` | readonly | 프로그래매틱 에이전트 호출 API (`request` / `send`) |
| `emitMessageEvent` | `(event: MessageEvent) => void` | -- | 메시지 변경 이벤트 발행 |
| `metadata` | `Record<string, JsonValue>` | mutable | 미들웨어 간 공유 메타데이터 |
| `next` | `() => Promise<TurnResult>` | -- | 다음 레이어로 진행 |

**`next()`는 반드시 한 번만 호출해야 합니다.** `next()` 호출 전은 전처리(pre) 시점, `next()` 호출 후는 후처리(post) 시점입니다.

**결과 타입 -- `TurnResult`:**

```typescript
interface TurnResult {
  readonly turnId: string;
  readonly responseMessage?: Message;
  readonly finishReason: 'text_response' | 'max_steps' | 'error';
  readonly error?: { message: string; code?: string };
}
```

**예제:**

```typescript
api.pipeline.register('turn', async (ctx) => {
  // Pre: Turn 실행 전 메시지 검사 또는 조작
  const { nextMessages } = ctx.conversationState;

  if (nextMessages.length > 50) {
    // 이벤트 소싱으로 오래된 메시지 제거
    for (const msg of nextMessages.slice(0, 10)) {
      ctx.emitMessageEvent({ type: 'remove', targetId: msg.id });
    }
  }

  // Turn 실행 (내부에서 Step 루프 진행)
  const result = await ctx.next();

  // Post: 결과 검사 또는 로깅
  api.logger.info(`Turn finished: ${result.finishReason}`);
  return result;
});
```

---

#### 1.2 StepMiddlewareContext

단일 Step(LLM 호출 + 도구 실행)을 감쌉니다. Turn 내에서 각 Step이 실행될 때마다 호출됩니다.

```typescript
interface StepMiddlewareContext extends ExecutionContext {
  /** 현재 Turn 정보 */
  readonly turn: Turn;

  /** Turn 내 Step 인덱스 (0부터 시작) */
  readonly stepIndex: number;

  /** 대화 상태 */
  readonly conversationState: ConversationState;

  /** 미들웨어에서 다른 에이전트를 프로그래매틱하게 호출 */
  readonly agents: MiddlewareAgentsApi;

  /** 메시지 이벤트 발행 */
  emitMessageEvent(event: MessageEvent): void;

  /** 이 Step의 도구 카탈로그 (mutable -- 필터링, 추가, 수정 가능) */
  toolCatalog: ToolCatalogItem[];

  /** 미들웨어 간 공유 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 다음 미들웨어 또는 코어 Step 로직 (LLM 호출 + 도구 실행) */
  next(): Promise<StepResult>;
}
```

**Step 전용 필드:**

| 필드 | 타입 | 변경 가능 | 설명 |
|------|------|-----------|------|
| `turn` | `Turn` | readonly | 현재 Turn 정보 |
| `stepIndex` | `number` | readonly | Turn 내 Step 인덱스 (0부터) |
| `conversationState` | `ConversationState` | readonly | 현재 대화 상태 |
| `agents` | `MiddlewareAgentsApi` | readonly | 프로그래매틱 에이전트 호출 API (`request` / `send`) |
| `emitMessageEvent` | `(event: MessageEvent) => void` | -- | 메시지 변경 이벤트 발행 |
| `toolCatalog` | `ToolCatalogItem[]` | **mutable** | 이 Step에서 LLM에 노출되는 도구 카탈로그 |
| `metadata` | `Record<string, JsonValue>` | mutable | 미들웨어 간 공유 메타데이터 |
| `next` | `() => Promise<StepResult>` | -- | 다음 레이어로 진행 |

`next()` 호출 전에 `toolCatalog`를 수정하면 해당 Step의 LLM 호출에 반영됩니다.

**결과 타입 -- `StepResult`:**

```typescript
interface StepResult {
  status: 'completed' | 'failed';
  hasToolCalls: boolean;
  toolCalls: ToolCall[];
  toolResults: ToolCallResult[];
  metadata: Record<string, JsonValue>;
}
```

**예제:**

```typescript
api.pipeline.register('step', async (ctx) => {
  // Pre: 이 Step의 도구 필터링
  ctx.toolCatalog = ctx.toolCatalog.filter(
    t => !t.name.includes('dangerous')
  );

  const result = await ctx.next();

  // Post: Step 결과 로깅
  api.logger.info(`Step ${ctx.stepIndex}: ${result.toolCalls.length} tool calls`);
  return result;
});
```

---

#### 1.3 MiddlewareAgentsApi (`ctx.agents`)

`turn`과 `step` 미들웨어는 `ctx.agents`를 통해 다른 에이전트를 프로그래매틱하게 호출할 수 있습니다. 이 경로는 `agents__request`, `agents__send`와 동일한 Orchestrator IPC 라우팅을 재사용합니다.

```typescript
interface MiddlewareAgentsApi {
  request(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    timeoutMs?: number; // 기본값: 60000
    metadata?: Record<string, unknown>;
  }): Promise<{ target: string; response: string }>;

  send(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ accepted: boolean }>;
}
```

규칙:

- `turn`, `step` 컨텍스트에서만 사용 가능합니다.
- `toolCall` 컨텍스트에서는 제공되지 않습니다.
- `request` 기본 타임아웃은 `60000ms`입니다.
- 런타임은 순환 요청 체인을 감지하고 오류를 반환합니다.

예제:

```typescript
api.pipeline.register('turn', async (ctx) => {
  const preload = await ctx.agents.request({
    target: 'retriever',
    input: '현재 사용자 입력과 관련된 컨텍스트를 찾으세요',
    timeoutMs: 5000,
  });

  if (preload.response.length > 0) {
    ctx.metadata.preloadedContext = preload.response;
  }

  const result = await ctx.next();

  await ctx.agents.send({
    target: 'observer',
    input: `turn=${ctx.turnId} finish=${result.finishReason}`,
  });

  return result;
});
```

---

#### 1.4 ToolCallMiddlewareContext

단일 도구 호출을 감쌉니다. Step 내에서 각 도구 호출마다 실행됩니다.

```typescript
interface ToolCallMiddlewareContext extends ExecutionContext {
  /** Turn 내 Step 인덱스 */
  readonly stepIndex: number;

  /** 호출 대상 도구 이름 ({리소스명}__{export명}) */
  readonly toolName: string;

  /** 도구 호출 고유 ID */
  readonly toolCallId: string;

  /** 도구 호출 인자 (mutable -- 실행 전 수정 가능) */
  args: JsonObject;

  /** 미들웨어 간 공유 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 다음 미들웨어 또는 코어 도구 실행 */
  next(): Promise<ToolCallResult>;
}
```

**ToolCall 전용 필드:**

| 필드 | 타입 | 변경 가능 | 설명 |
|------|------|-----------|------|
| `stepIndex` | `number` | readonly | Turn 내 Step 인덱스 |
| `toolName` | `string` | readonly | 도구 이름 (`{리소스명}__{export명}`) |
| `toolCallId` | `string` | readonly | 도구 호출 고유 ID |
| `args` | `JsonObject` | **mutable** | 도구 호출 인자 (수정 가능) |
| `metadata` | `Record<string, JsonValue>` | mutable | 미들웨어 간 공유 메타데이터 |
| `next` | `() => Promise<ToolCallResult>` | -- | 다음 레이어로 진행 |

**결과 타입 -- `ToolCallResult`:**

```typescript
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

**예제:**

```typescript
api.pipeline.register('toolCall', async (ctx) => {
  // Pre: 인자 검증 또는 변환
  if (ctx.toolName === 'bash__exec') {
    const cmd = ctx.args.command;
    if (typeof cmd === 'string' && cmd.length > 10000) {
      ctx.args = { ...ctx.args, command: cmd.slice(0, 10000) };
      api.logger.warn('bash command truncated to 10000 chars');
    }
  }

  const result = await ctx.next();

  // Post: 도구 결과 로깅
  api.logger.debug(`${ctx.toolName}: ${result.status}`);
  return result;
});
```

---

#### Onion 실행 모델

미들웨어 레이어는 onion 구조를 형성합니다: 먼저 등록된 미들웨어가 바깥 레이어입니다. Turn, Step, ToolCall 미들웨어는 계층적으로 중첩됩니다.

```text
[Turn 미들웨어 체인]
  |-- turn.pre
  |-- [Step 루프: 0..N]
  |   |-- [Step 미들웨어 체인]
  |   |   |-- step.pre
  |   |   |-- [코어 LLM 호출]
  |   |   |-- [ToolCall 루프: 0..M]
  |   |   |   |-- [ToolCall 미들웨어 체인]
  |   |   |   |   |-- toolCall.pre
  |   |   |   |   |-- [코어 도구 실행]
  |   |   |   |   +-- toolCall.post
  |   |   +-- step.post
  +-- turn.post
```

---

### 2. `tools` -- ExtensionToolsApi

런타임에 동적으로 도구를 등록합니다. 등록된 도구는 정적으로 선언된 도구와 함께 LLM에 노출됩니다.

```typescript
interface ExtensionToolsApi {
  /**
   * 동적 도구 등록
   * @param item - 도구 카탈로그 항목 (이름, 설명, 파라미터 스키마)
   * @param handler - 도구 핸들러 함수
   */
  register(item: ToolCatalogItem, handler: ToolHandler): void;
}
```

#### 관련 타입

```typescript
interface ToolCatalogItem {
  name: string;
  description: string;
  parameters: JsonObject; // JSON Schema
}

type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject,
) => Promise<JsonValue> | JsonValue;
```

#### 규칙

- 도구 이름은 반드시 더블 언더스코어 규칙을 따라야 합니다: `{extensionName}__{toolName}`.
- 동적 등록된 도구는 자동으로 Step의 `toolCatalog`에 포함됩니다.
- 같은 이름의 도구를 등록하면 이전 등록을 덮어씁니다.

#### 예제

```typescript
export function register(api: ExtensionApi): void {
  api.tools.register(
    {
      name: 'my-ext__status',
      description: 'Extension 상태 조회',
      parameters: { type: 'object', properties: {} },
    },
    async (ctx, input) => {
      const state = await api.state.get();
      return { status: 'ok', state };
    },
  );
}
```

---

### 3. `state` -- ExtensionStateApi

Extension별 영속 JSON 상태를 읽고 씁니다. 상태는 인스턴스별로 격리되며 AgentProcess가 자동으로 영속화를 관리합니다.

```typescript
interface ExtensionStateApi {
  /** 현재 상태 조회. 저장된 상태가 없으면 null 반환. */
  get(): Promise<JsonValue>;

  /** 상태 저장. JSON 직렬화 가능한 값만 허용. */
  set(value: JsonValue): Promise<void>;
}
```

#### 저장 경로

```text
~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/extensions/<ext-name>.json
```

#### 규칙

- 상태는 Extension 이름(identity)에 귀속됩니다.
- 상태는 인스턴스별로 격리됩니다.
- AgentProcess는 초기화 시 디스크에서 상태를 자동 복원합니다.
- AgentProcess는 Turn 종료 시점에 변경된 상태를 디스크에 기록합니다.
- 상태 값은 JSON 직렬화 가능해야 합니다 (함수, Symbol, 순환 참조 불가).

#### 예제

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('step', async (ctx) => {
    // 상태 조회
    const state = (await api.state.get()) ?? { processedSteps: 0 };
    const count = (state as Record<string, unknown>).processedSteps as number;

    // 상태 업데이트
    await api.state.set({
      processedSteps: count + 1,
      lastStepAt: Date.now(),
    });

    return ctx.next();
  });
}
```

---

### 4. `events` -- ExtensionEventsApi

Extension 간 느슨한 결합을 위한 프로세스 내 이벤트 버스입니다. 표준 런타임 이벤트도 구독할 수 있습니다.

```typescript
interface ExtensionEventsApi {
  /**
   * 이벤트 구독
   * @param event - 이벤트 이름 (예: 'turn.completed')
   * @param handler - 이벤트 핸들러
   * @returns 구독 해제 함수
   */
  on(event: string, handler: (...args: unknown[]) => void): () => void;

  /**
   * 이벤트 발행
   * @param event - 이벤트 이름
   * @param args - 이벤트 인자
   */
  emit(event: string, ...args: unknown[]): void;
}
```

#### 표준 런타임 이벤트

런타임이 발행하는 표준 이벤트로, Extension은 `api.events.on()`으로 구독할 수 있습니다:

| 이벤트 | 주요 payload 필드 |
|--------|------------------|
| `turn.started` | `turnId`, `agentName`, `instanceKey`, `timestamp` |
| `turn.completed` | `turnId`, `agentName`, `instanceKey`, `stepCount`, `duration`, `timestamp` |
| `turn.failed` | `turnId`, `agentName`, `instanceKey`, `timestamp` |
| `step.started` | `stepId`, `stepIndex`, `turnId`, `agentName`, `timestamp` |
| `step.completed` | `stepId`, `stepIndex`, `turnId`, `agentName`, `toolCallCount`, `duration`, `timestamp` |
| `step.failed` | `stepId`, `stepIndex`, `turnId`, `agentName`, `timestamp` |
| `tool.called` | `toolCallId`, `toolName`, `stepId`, `turnId`, `agentName`, `timestamp` |
| `tool.completed` | `toolCallId`, `toolName`, `status`, `duration`, `stepId`, `turnId`, `agentName`, `timestamp` |
| `tool.failed` | `toolCallId`, `toolName`, `stepId`, `turnId`, `agentName`, `timestamp` |

전체 payload 타입 정의는 [`docs/specs/api.md` -- Runtime Events](../../specs/api.md)를 참조하세요.

#### 규칙

- `on()`은 반드시 구독 해제 함수를 반환해야 합니다.
- 이벤트는 동일 AgentProcess 내에서만 전파됩니다 (프로세스 내 범위).
- 이벤트 핸들러의 예외는 다른 핸들러 실행을 방해하지 않아야 합니다.

#### 예제

```typescript
export function register(api: ExtensionApi): void {
  // 런타임 이벤트 구독
  const unsubscribe = api.events.on('turn.completed', (payload) => {
    api.logger.info('Turn completed', payload);
  });

  // 다른 Extension을 위한 커스텀 이벤트 발행
  api.events.emit('my-ext.initialized', { version: '1.0.0' });

  // 더 이상 필요없을 때 구독 해제
  process.on('beforeExit', () => {
    unsubscribe();
  });
}
```

---

### 5. `logger` -- Console

표준 `Console` 인터페이스를 따르는 구조화된 로거입니다.

```typescript
// 사용 가능한 메서드 (표준 Console 인터페이스)
api.logger.info('Extension initialized');
api.logger.debug('Processing step', { stepIndex: 3 });
api.logger.warn('Approaching token limit');
api.logger.error('Failed to load state', error);
```

---

## 보조 타입

### ConversationState

메시지 상태는 이벤트 소싱으로 관리됩니다: `NextMessages = BaseMessages + SUM(Events)`.

```typescript
interface ConversationState {
  readonly baseMessages: Message[];
  readonly events: MessageEvent[];
  readonly nextMessages: Message[];
  toLlmMessages(): CoreMessage[];
}
```

### MessageEvent

```typescript
type MessageEvent =
  | { type: 'append'; message: Message }
  | { type: 'replace'; targetId: string; message: Message }
  | { type: 'remove'; targetId: string }
  | { type: 'truncate' };
```

### Message

```typescript
interface Message {
  readonly id: string;
  readonly data: CoreMessage;
  metadata: Record<string, JsonValue>;
  readonly createdAt: Date;
  readonly source: MessageSource;
}

type MessageSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };
```

### ExecutionContext

모든 미들웨어 컨텍스트 타입이 상속하는 기본 컨텍스트입니다.

```typescript
interface ExecutionContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly traceId: string;
}
```

---

## 참고 문서

- [Extension Pipeline (Explanation)](../explanation/extension-pipeline.ko.md) -- 미들웨어 아키텍처 개념 심층 설명
- [Extension 작성법 (How-to)](../how-to/write-an-extension.ko.md) -- Extension 제작 실용 체크리스트
- [첫 Extension 만들기 (Tutorial)](../tutorials/03-build-your-first-extension.ko.md) -- 초보자를 위한 단계별 튜토리얼
- [Tool API 레퍼런스](./tool-api.ko.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult`
- [`docs/specs/extension.md`](../../specs/extension.md) -- Extension 시스템 스펙 (정규)
- [`docs/specs/pipeline.md`](../../specs/pipeline.md) -- Pipeline 스펙 (정규)
- [`docs/specs/api.md`](../../specs/api.md) -- Runtime/SDK API 스펙 (정규)
- [`docs/specs/shared-types.md`](../../specs/shared-types.md) -- 공통 타입 SSOT (정규)

---

_레퍼런스 버전: v0.0.3_
