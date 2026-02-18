# Goondan 라이프사이클 파이프라인 스펙 (v0.0.3)

> 공통 타입(`Message`, `MessageEvent`, `ConversationState`, `TurnResult`, `ToolCallResult`, `ExecutionContext`)의 기준은 `docs/specs/shared-types.md`를 따른다.

---

## 1. 개요

### 1.1 배경 및 설계 동기

파이프라인은 **Middleware Only** 모델을 사용한다. 파이프라인 훅은 `next()` 호출 전후로 전처리(pre)/후처리(post)를 수행하는 Middleware 형태로 통일하며, Koa/Express 계열의 온니언(Onion) 패턴을 따른다. 구현은 `turn`, `step`, `toolCall` 3개 미들웨어 표면을 제공해야 한다.

파이프라인은 Goondan Runtime의 실행 라이프사이클에서 Extension이 개입할 수 있는 **표준 확장 지점**이다. 파이프라인을 통해 Extension은 메시지 히스토리 조작, 도구 카탈로그 조작, LLM 호출 래핑, 도구 실행 제어, 로깅/관찰, 재시도 등을 수행할 수 있다.

### 1.2 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Middleware Only** | 모든 파이프라인 훅은 `next()` 기반 Middleware 형태 |
| **Onion Pattern** | 먼저 등록된 Extension의 미들웨어가 바깥 레이어(outermost)를 형성 |
| **3종 미들웨어** | `turn`, `step`, `toolCall` 3종만 제공. 세분화 포인트를 단일 표면으로 통합 |
| **결정론적 실행** | 동일 구성과 입력에 대해 파이프라인 실행 순서는 항상 동일 |
| **ConversationState 기반** | 메시지 조작은 `ConversationState` + `emitMessageEvent()` 이벤트 소싱으로 수행 |

## 2. 핵심 규칙

모든 미들웨어에 공통으로 적용되는 규범적 규칙이다.

1. 모든 파이프라인 훅은 **Middleware** 형태여야 한다(MUST).
2. Middleware는 `next()` 함수를 호출하여 다음 레이어를 실행하는 온니언(onion) 패턴을 따라야 한다(MUST).
3. `next()` 호출 전은 전처리(pre), `next()` 호출 후는 후처리(post) 시점에 해당한다.
4. Middleware는 `next()`를 반드시 한 번 호출해야 한다(MUST). 호출하지 않으면 이후 레이어와 핵심 로직이 실행되지 않는다.
5. Middleware는 `next()`의 반환값을 변환하여 반환할 수 있다(MAY).
6. 미들웨어는 **온니언(onion) 모델**로 실행되어야 한다(MUST). 먼저 등록된 Extension의 미들웨어가 바깥 레이어(outermost)가 된다.
7. 동일 종류 미들웨어의 실행 순서는 Extension 등록 순서에 의해 결정론적으로 재현 가능해야 한다(MUST).
8. Extension 등록 순서는 Agent 리소스의 `extensions` 배열 순서를 따라야 한다(MUST).
9. Extension은 entry 함수에서 `ExtensionApi.pipeline.register(type, handler)` 호출로 미들웨어를 등록해야 한다(MUST).
10. 비표준 미들웨어는 표준 미들웨어(`turn`, `step`, `toolCall`)의 동작을 깨뜨리지 않아야 한다(MUST).
11. 재시도는 동일 Step 내부에서 `next()`를 재호출하는 방식이 아니라, 결과 변환 또는 예외 전파로 Runtime에 의도를 전달해야 한다(SHOULD).

---

## 3. 미들웨어 타입

Runtime은 다음 3종의 미들웨어를 제공해야 한다(MUST).

### 3.1 `turn` 미들웨어

Turn 전체를 감싸는 미들웨어이다. 하나의 입력 이벤트(`AgentEvent`)를 처리하는 Turn의 시작부터 종료까지를 래핑한다.

**역할:**
- `next()` 호출 전 (turn.pre 시점): 메시지 히스토리 조작, ConversationState 접근, MessageEvent 발행, 필요 시 다른 Agent 요청
- `next()` 호출 후 (turn.post 시점): Turn 결과 후처리, 추가 MessageEvent 발행

**컨텍스트 필드:**

| 필드 | 타입 | 변경 가능 | 설명 |
|------|------|-----------|------|
| `agentName` | `string` | readonly | 현재 에이전트 이름 |
| `instanceKey` | `string` | readonly | 현재 인스턴스 키 |
| `turnId` | `string` | readonly | 현재 Turn 식별자 |
| `traceId` | `string` | readonly | Turn 추적 식별자 |
| `inputEvent` | `AgentEvent` | readonly | Turn을 트리거한 입력 이벤트 |
| `conversationState` | `ConversationState` | readonly | 대화 상태 (base + events 이벤트 소싱) |
| `agents` | `MiddlewareAgentsApi` | readonly | Extension 미들웨어에서 다른 Agent를 호출하는 API (`request`/`send`) |
| `emitMessageEvent` | `(event: MessageEvent) => void` | - | 메시지 이벤트 발행 (append/replace/remove/truncate) |
| `metadata` | `Record<string, JsonValue>` | mutable | 미들웨어 간 공유 메타데이터 |
| `next` | `() => Promise<TurnResult>` | - | 다음 미들웨어 또는 코어 Turn 로직 실행 |

**규칙:**

1. `turn` 미들웨어는 Turn의 전체 실행을 래핑해야 한다(MUST).
2. `next()` 호출 전에 `conversationState.baseMessages`에 접근하여 Turn 시작 기준 메시지를 확인할 수 있어야 한다(MUST).
3. `next()` 호출 전에 `emitMessageEvent()`로 메시지 이벤트를 발행할 수 있어야 한다(MUST).
4. `next()` 호출 후에도 추가 `emitMessageEvent()` 발행이 가능해야 한다(MUST).
5. `ctx.agents.request/send`을 통해 다른 Agent에 요청/알림을 보낼 수 있어야 한다(MUST).
6. `next()`의 반환값 `TurnResult`를 변환하여 반환할 수 있다(MAY).
7. `next()`를 반드시 한 번 호출해야 한다(MUST). 호출하지 않으면 이후 미들웨어와 코어 Turn 로직이 실행되지 않는다.

### 3.2 `step` 미들웨어

Step(LLM 호출 + 도구 실행)을 감싸는 미들웨어이다. Turn 내에서 각 Step이 실행될 때마다 호출된다.

**역할:**
- `next()` 호출 전: Tool Catalog 조작, ConversationState 접근, MessageEvent 발행, 메타데이터 설정, 필요 시 다른 Agent 요청
- `next()` 호출 후: Step 결과 검사/변환, 로깅, 재시도 판단

**컨텍스트 필드:**

| 필드 | 타입 | 변경 가능 | 설명 |
|------|------|-----------|------|
| `agentName` | `string` | readonly | 현재 에이전트 이름 |
| `instanceKey` | `string` | readonly | 현재 인스턴스 키 |
| `turnId` | `string` | readonly | 현재 Turn 식별자 |
| `traceId` | `string` | readonly | Turn 추적 식별자 |
| `turn` | `Turn` | readonly | 현재 Turn 정보 |
| `stepIndex` | `number` | readonly | 현재 Step 인덱스 (Turn 내 0부터) |
| `conversationState` | `ConversationState` | readonly | 대화 상태 |
| `agents` | `MiddlewareAgentsApi` | readonly | Extension 미들웨어에서 다른 Agent를 호출하는 API (`request`/`send`) |
| `emitMessageEvent` | `(event: MessageEvent) => void` | - | 메시지 이벤트 발행 |
| `toolCatalog` | `ToolCatalogItem[]` | **mutable** | 현재 Step의 도구 카탈로그 (필터링/추가/수정 가능) |
| `metadata` | `Record<string, JsonValue>` | mutable | 미들웨어 간 공유 메타데이터 |
| `next` | `() => Promise<StepResult>` | - | 다음 미들웨어 또는 코어 Step 로직 (LLM 호출 + 도구 실행) |

**규칙:**

1. `step` 미들웨어는 단일 Step의 전체 실행(LLM 호출 및 도구 실행)을 래핑해야 한다(MUST).
2. `toolCatalog`는 변경 가능(mutable)해야 하며, 미들웨어에서 도구 목록을 필터링/추가/수정할 수 있어야 한다(MUST).
3. `next()` 호출 전에 `toolCatalog`를 조작하면, 변경된 카탈로그가 해당 Step의 LLM 호출에 반영되어야 한다(MUST).
4. `ctx.agents.request/send`을 통해 다른 Agent에 요청/알림을 보낼 수 있어야 한다(MUST).
5. `next()` 호출 후 `StepResult`를 검사하여 재시도 여부를 판단할 수 있다(MAY). 재시도 시 `next()`를 다시 호출하는 것이 아니라, 미들웨어가 적절한 결과를 반환하거나 예외를 던져야 한다(SHOULD).
6. `next()`를 반드시 한 번 호출해야 한다(MUST).

### 3.3 `toolCall` 미들웨어

개별 도구 호출을 감싸는 미들웨어이다. Step 내에서 LLM이 요청한 각 tool call에 대해 호출된다.

**역할:**
- `next()` 호출 전: 입력 인자 검증/변환
- `next()` 호출 후: 도구 호출 결과 변환/로깅

**컨텍스트 필드:**

| 필드 | 타입 | 변경 가능 | 설명 |
|------|------|-----------|------|
| `agentName` | `string` | readonly | 현재 에이전트 이름 |
| `instanceKey` | `string` | readonly | 현재 인스턴스 키 |
| `turnId` | `string` | readonly | 현재 Turn 식별자 |
| `traceId` | `string` | readonly | Turn 추적 식별자 |
| `stepIndex` | `number` | readonly | 현재 Step 인덱스 |
| `toolName` | `string` | readonly | 호출 대상 도구 이름 (`{리소스명}__{하위도구명}`) |
| `toolCallId` | `string` | readonly | 도구 호출 고유 ID |
| `args` | `JsonObject` | **mutable** | 도구 호출 인자 (조작 가능) |
| `metadata` | `Record<string, JsonValue>` | mutable | 미들웨어 간 공유 메타데이터 |
| `next` | `() => Promise<ToolCallResult>` | - | 다음 미들웨어 또는 코어 도구 실행 |

**규칙:**

1. `toolCall` 미들웨어는 개별 도구 호출의 전체 실행을 래핑해야 한다(MUST).
2. `args`는 변경 가능(mutable)해야 하며, 미들웨어에서 도구 호출 인자를 수정할 수 있어야 한다(MUST).
3. `next()` 호출 전에 `args`를 변환하면, 변환된 인자가 실제 도구 핸들러에 전달되어야 한다(MUST).
4. `next()`를 반드시 한 번 호출해야 한다(MUST).

---

## 4. 미들웨어 컨텍스트 인터페이스

### 4.1 TurnMiddlewareContext

```typescript
interface TurnMiddlewareContext extends ExecutionContext {
  /** Turn을 트리거한 입력 이벤트 */
  readonly inputEvent: AgentEvent;

  /** 대화 상태 (base + events 이벤트 소싱) */
  readonly conversationState: ConversationState;

  /** 다른 Agent를 프로그래매틱하게 호출 */
  readonly agents: MiddlewareAgentsApi;

  /** 메시지 이벤트 발행 (append/replace/remove/truncate) */
  emitMessageEvent(event: MessageEvent): void;

  /** 미들웨어 간 공유 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 다음 미들웨어 또는 코어 Turn 로직 실행 */
  next(): Promise<TurnResult>;
}
```

### 4.2 StepMiddlewareContext

```typescript
interface StepMiddlewareContext extends ExecutionContext {
  /** 현재 Turn 정보 */
  readonly turn: Turn;

  /** 현재 Step 인덱스 */
  readonly stepIndex: number;

  /** 대화 상태 */
  readonly conversationState: ConversationState;

  /** 다른 Agent를 프로그래매틱하게 호출 */
  readonly agents: MiddlewareAgentsApi;

  /** 메시지 이벤트 발행 */
  emitMessageEvent(event: MessageEvent): void;

  /** 현재 Step의 도구 카탈로그 (조작 가능) */
  toolCatalog: ToolCatalogItem[];

  /** 미들웨어 간 공유 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 다음 미들웨어 또는 코어 Step 로직 (LLM 호출 + 도구 실행) */
  next(): Promise<StepResult>;
}
```

### 4.3 ToolCallMiddlewareContext

```typescript
interface ToolCallMiddlewareContext extends ExecutionContext {
  /** 현재 Step 인덱스 */
  readonly stepIndex: number;

  /** 호출 대상 도구 이름 ({리소스명}__{하위도구명}) */
  readonly toolName: string;

  /** 도구 호출 고유 ID */
  readonly toolCallId: string;

  /** 도구 호출 인자 (조작 가능) */
  args: JsonObject;

  /** 미들웨어 간 공유 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 다음 미들웨어 또는 코어 도구 실행 */
  next(): Promise<ToolCallResult>;
}
```

### 4.4 MiddlewareAgentsApi

`turn`/`step` 미들웨어는 `ctx.agents`를 통해 다른 Agent를 호출할 수 있다. 이 API는 기존 Tool API(`agents__request`, `agents__send`)와 동일한 라우팅/자동 스폰 규칙을 따르며, Orchestrator IPC 경로를 재사용한다.

```typescript
interface MiddlewareAgentsApi {
  request(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    timeoutMs?: number; // default: 15000
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

**규칙:**

1. `ctx.agents`는 `turn`/`step` 미들웨어에서만 제공되어야 한다(MUST).
2. `toolCall` 미들웨어에서는 `ctx.agents`를 제공하지 않아야 한다(MUST NOT).
3. `request` 기본 타임아웃은 15000ms여야 한다(MUST).
4. Runtime은 `request`에 대해 순환 호출을 감지하고 오류를 반환해야 한다(MUST).

### 4.5 ConversationState

메시지 상태는 이벤트 소싱 모델(`NextMessages = BaseMessages + SUM(Events)`)로 관리된다.
`ConversationState` 원형은 `docs/specs/shared-types.md` 4절을 따른다.

**규칙:**

1. `conversationState.baseMessages`는 Turn 시작 기준 메시지 스냅샷이어야 한다(MUST).
2. `conversationState.events`는 현재 Turn에서 누적된 메시지 이벤트의 순서 보장 뷰여야 한다(MUST).
3. `emitMessageEvent()`로 발행한 이벤트는 동일 Turn의 `SUM(Events)`에 포함되어야 한다(MUST).
4. `conversationState.nextMessages`는 `baseMessages + SUM(events)`와 동일하게 유지해야 한다(MUST).
5. `next()` 호출 전은 전처리(pre) 시점이고, `next()` 호출 후는 후처리(post) 시점이다(MUST).
6. 메시지 컨텍스트는 `conversationState` + `emitMessageEvent`를 사용해야 한다(MUST).

### 4.6 MessageEvent / Message 타입

`MessageEvent`, `Message`, `MessageSource`의 원형은 `docs/specs/shared-types.md`를 참조한다.

### 4.7 결과 타입

```typescript
interface StepResult {
  /** Step 상태 */
  status: 'completed' | 'failed';
  /** LLM 응답에 tool call이 있으면 true (다음 Step 필요) */
  hasToolCalls: boolean;
  /** tool call 목록 */
  toolCalls: ToolCall[];
  /** tool 실행 결과 목록 */
  toolResults: ToolCallResult[];
  /** Step 메타데이터 */
  metadata: Record<string, JsonValue>;
}
```

`TurnResult`와 `ToolCallResult` 원형은 `docs/specs/shared-types.md`를 따른다.

---

## 5. 미들웨어 등록

### 5.1 PipelineRegistry 인터페이스

Extension은 `ExtensionApi.pipeline.register()` 메서드를 통해 미들웨어를 등록한다.

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
  /** 실행 우선순위 (낮을수록 바깥 레이어, 기본: 0) */
  priority?: number;
}
```

**규칙:**

1. 미들웨어 타입은 `'turn'`, `'step'`, `'toolCall'` 세 가지만 허용해야 한다(MUST).
2. `mutate(point, fn)`, `wrap(point, fn)` API는 지원하지 않는다(MUST NOT).
3. 동일 타입에 여러 미들웨어가 등록되면 등록 순서대로 onion 방식으로 체이닝해야 한다(MUST).
4. 하나의 Extension이 여러 종류의 미들웨어를 동시에 등록할 수 있어야 한다(MUST).
5. 하나의 Extension이 같은 종류의 미들웨어를 여러 개 등록할 수 있어야 한다(MAY).

### 5.2 등록 예시

```typescript
// extension entry point
export function register(api: ExtensionApi): void {
  // Turn 미들웨어
  api.pipeline.register('turn', async (ctx) => {
    // next() 전 = turn.pre: 메시지 히스토리 조작
    const { nextMessages } = ctx.conversationState;
    console.log(`Turn 시작: ${nextMessages.length} messages`);

    const result = await ctx.next();

    // next() 후 = turn.post: 결과 후처리
    console.log(`Turn 종료: ${result.status}`);
    return result;
  });

  // Step 미들웨어
  api.pipeline.register('step', async (ctx) => {
    // next() 전 = step.pre: 도구 목록 조작
    ctx.toolCatalog = ctx.toolCatalog.filter(t => !t.name.includes('disabled'));

    const start = Date.now();
    const result = await ctx.next();
    console.log(`Step ${ctx.stepIndex} took ${Date.now() - start}ms`);

    // next() 후 = step.post: 결과 검사/변환
    return result;
  });

  // ToolCall 미들웨어
  api.pipeline.register('toolCall', async (ctx) => {
    console.log(`Calling ${ctx.toolName} with`, ctx.args);
    const result = await ctx.next();
    console.log(`${ctx.toolName} returned`, result);
    return result;
  });
}
```

---

## 6. 실행 순서

### 6.1 온니언(Onion) 모델

미들웨어는 **온니언 모델**로 실행된다. 먼저 등록된 Extension의 미들웨어가 바깥 레이어(outermost)가 된다.

```text
Extension-A.turn (바깥)
  |-- pre 처리
  |-- Extension-B.turn (안쪽)
  |   |-- pre 처리
  |   |-- [코어 Turn 로직: Step 루프 실행]
  |   +-- post 처리
  +-- post 처리
```

**실행 흐름 상세:**

```text
바깥 레이어 pre -> 안쪽 레이어 pre -> 핵심 로직 -> 안쪽 레이어 post -> 바깥 레이어 post
```

**규칙:**

1. 미들웨어는 온니언 모델로 실행되어야 한다(MUST).
2. 바깥 레이어의 pre가 먼저, post가 마지막에 실행되어야 한다(MUST).

### 6.2 등록 순서와 우선순위

**규칙:**

1. 동일 종류 미들웨어의 실행 순서는 Extension 등록 순서에 의해 결정론적으로 재현 가능해야 한다(MUST).
2. Extension 등록 순서는 Agent 리소스의 `extensions` 배열 순서를 따라야 한다(MUST).
3. `priority`가 지정된 경우 priority 값으로 정렬한 뒤, 동일 priority 내에서는 등록 순서로 안정 정렬(stable sort)을 적용해야 한다(SHOULD).
4. 먼저 등록된(또는 priority가 높은) Extension의 미들웨어가 바깥 레이어가 되어야 한다(MUST).
5. 낮은 priority 값이 바깥 레이어(먼저 진입, 나중에 빠져나옴)이다(MUST).

```yaml
# Agent 리소스의 extensions 배열 순서 = 미들웨어 등록 순서
kind: Agent
spec:
  extensions:
    - ref: "Extension/logging"      # 1번째: 가장 바깥 레이어
    - ref: "Extension/message-compaction"   # 2번째
    - ref: "Extension/skills"       # 3번째: 가장 안쪽 레이어
```

**Priority를 이용한 순서 조정:**

```typescript
// Extension A (등록 순서: 1번째)
api.pipeline.register('step', stepMiddlewareA, { priority: 10 });

// Extension B (등록 순서: 2번째)
api.pipeline.register('step', stepMiddlewareB, { priority: 5 });

// Extension C (등록 순서: 3번째)
api.pipeline.register('step', stepMiddlewareC, { priority: 10 });
```

**실행 순서**: `B(5, 바깥) -> A(10) -> C(10, 안쪽) -> Core`
- 낮은 priority가 바깥 레이어
- 동일 priority는 등록 순서 유지 (안정 정렬)

### 6.3 중첩 실행 관계

Turn, Step, ToolCall 미들웨어는 중첩 관계로 실행된다.

```text
[Turn 미들웨어 체인]
  |-- turn.pre (모든 turn 미들웨어)
  |-- [Step 루프: 0..N]
  |   |-- [Step 미들웨어 체인]
  |   |   |-- step.pre (모든 step 미들웨어)
  |   |   |-- [코어 LLM 호출]
  |   |   |-- [ToolCall 루프: 0..M]
  |   |   |   |-- [ToolCall 미들웨어 체인]
  |   |   |   |   |-- toolCall.pre (모든 toolCall 미들웨어)
  |   |   |   |   |-- [코어 도구 실행]
  |   |   |   |   +-- toolCall.post (모든 toolCall 미들웨어)
  |   |   +-- step.post (모든 step 미들웨어)
  +-- turn.post (모든 turn 미들웨어)
```

---

## 7. Turn 메시지 상태 계약

Turn 미들웨어는 `ConversationState`를 통해 메시지를 조작하며, 계약의 소유 문서는 다음과 같이 분리된다.

### 7.1 실행 계약 (SSOT: runtime.md)

1. 메시지 상태 계산 규칙은 `NextMessages = BaseMessages + SUM(Events)`를 따른다(MUST).
2. `emitMessageEvent()`로 발행한 이벤트는 동일 Turn 내 `conversationState.events`에 반영되어야 한다(MUST).
3. `next()` 호출 전/후 모두 이벤트 발행이 가능해야 한다(MUST).
4. 메시지 이벤트 적용 순서, 폴딩 시점, 복원 절차의 규범 정의는 `docs/specs/runtime.md`를 단일 기준으로 따른다(MUST).

### 7.2 저장 계약 (SSOT: workspace.md)

1. `messages/base.jsonl`, `messages/events.jsonl` 파일 구조 및 경로 규칙은 `docs/specs/workspace.md`를 단일 기준으로 따른다(MUST).
2. 파이프라인 문서는 저장 레이어(JSONL 레이아웃, 디렉터리 정책)를 재정의하지 않는다(MUST NOT).

---

## 8. 구현 가이드

### 8.1 PipelineRegistry 구현 예시

```typescript
class PipelineRegistryImpl {
  private turnMiddlewares: MiddlewareEntry<TurnMiddleware>[] = [];
  private stepMiddlewares: MiddlewareEntry<StepMiddleware>[] = [];
  private toolCallMiddlewares: MiddlewareEntry<ToolCallMiddleware>[] = [];

  register(type: 'turn', fn: TurnMiddleware, options?: MiddlewareOptions): void;
  register(type: 'step', fn: StepMiddleware, options?: MiddlewareOptions): void;
  register(type: 'toolCall', fn: ToolCallMiddleware, options?: MiddlewareOptions): void;
  register(type: string, fn: unknown, options?: MiddlewareOptions): void {
    const entry = {
      fn,
      priority: options?.priority ?? 0,
      registrationOrder: this.getEntries(type).length,
    };

    switch (type) {
      case 'turn':
        this.turnMiddlewares.push(entry as MiddlewareEntry<TurnMiddleware>);
        break;
      case 'step':
        this.stepMiddlewares.push(entry as MiddlewareEntry<StepMiddleware>);
        break;
      case 'toolCall':
        this.toolCallMiddlewares.push(entry as MiddlewareEntry<ToolCallMiddleware>);
        break;
    }
  }

  /**
   * Onion 체인 구성 및 실행
   * 가장 안쪽(마지막 등록)부터 감싸 올라가며, 먼저 등록된 것이 바깥 레이어가 됨
   */
  async runTurn(
    ctx: TurnMiddlewareContext,
    core: (ctx: TurnMiddlewareContext) => Promise<TurnResult>
  ): Promise<TurnResult> {
    return this.buildChain(this.turnMiddlewares, ctx, core);
  }

  async runStep(
    ctx: StepMiddlewareContext,
    core: (ctx: StepMiddlewareContext) => Promise<StepResult>
  ): Promise<StepResult> {
    return this.buildChain(this.stepMiddlewares, ctx, core);
  }

  async runToolCall(
    ctx: ToolCallMiddlewareContext,
    core: (ctx: ToolCallMiddlewareContext) => Promise<ToolCallResult>
  ): Promise<ToolCallResult> {
    return this.buildChain(this.toolCallMiddlewares, ctx, core);
  }

  private buildChain<TCtx, TResult>(
    entries: MiddlewareEntry<(ctx: TCtx) => Promise<TResult>>[],
    ctx: TCtx,
    core: (ctx: TCtx) => Promise<TResult>
  ): Promise<TResult> {
    const sorted = this.sortByPriority(entries);

    // Onion 구성: 안쪽부터 감싸 올라감
    let currentNext = core;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const middleware = sorted[i].fn;
      const outerNext = currentNext;
      currentNext = (innerCtx: TCtx) => {
        // ctx에 next 함수를 바인딩
        const ctxWithNext = Object.assign({}, innerCtx, {
          next: () => outerNext(innerCtx),
        });
        return middleware(ctxWithNext);
      };
    }

    return currentNext(ctx);
  }

  private sortByPriority<T>(entries: MiddlewareEntry<T>[]): MiddlewareEntry<T>[] {
    return [...entries].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;  // 낮은 priority = 바깥 레이어
      }
      return a.registrationOrder - b.registrationOrder;  // 안정 정렬
    });
  }

  private getEntries(type: string): unknown[] {
    switch (type) {
      case 'turn': return this.turnMiddlewares;
      case 'step': return this.stepMiddlewares;
      case 'toolCall': return this.toolCallMiddlewares;
      default: return [];
    }
  }
}

interface MiddlewareEntry<T> {
  fn: T;
  priority: number;
  registrationOrder: number;
}
```

### 8.2 AgentProcess Turn 실행 흐름

파이프라인 관점에서 이 절의 핵심은 다음 두 가지이다.

1. `PipelineRegistry`는 `turn` → `step` → `toolCall` 체인을 온니언 모델로 조합한다.
2. 코어 Turn/Step 실행 루프(LLM 호출, tool loop, fold/commit)는 `docs/specs/runtime.md`의 `7. Turn / Step`을 단일 기준으로 따른다.

즉, 파이프라인 스펙은 "미들웨어 계약과 체이닝 규칙"을 소유하고, 실행 루프 상세는 Runtime 스펙이 소유한다.

---

## 9. 활용 패턴

### 9.1 Compaction (Turn 미들웨어)

```typescript
api.pipeline.register('turn', async (ctx) => {
  const { nextMessages } = ctx.conversationState;

  // metadata로 "요약 가능" 메시지 식별
  const compactable = nextMessages.filter(
    m => m.metadata['compaction.eligible'] === true
      && m.metadata['pinned'] !== true
  );

  if (compactable.length > 20) {
    const summary = await summarize(compactable);

    // 이벤트 발행으로 메시지 조작 (next() 호출 전 = turn.pre)
    for (const m of compactable) {
      ctx.emitMessageEvent({ type: 'remove', targetId: m.id });
    }
    ctx.emitMessageEvent({
      type: 'append',
      message: createSystemMessage(summary, { 'compaction.summary': true }),
    });
  }

  // Turn 실행
  const result = await ctx.next();

  // next() 호출 후 = turn.post: 결과 후처리
  return result;
});
```

### 9.2 로깅/관찰 (Step + ToolCall 미들웨어)

```typescript
// Step 실행 시간 측정
api.pipeline.register('step', async (ctx) => {
  const start = Date.now();
  api.logger.info(`[Step ${ctx.stepIndex}] 시작, 도구 ${ctx.toolCatalog.length}개`);

  const result = await ctx.next();

  const elapsed = Date.now() - start;
  api.logger.info(`[Step ${ctx.stepIndex}] 완료: ${elapsed}ms`);

  return result;
});

// ToolCall 실행 로깅
api.pipeline.register('toolCall', async (ctx) => {
  api.logger.debug(`[ToolCall] ${ctx.toolName} 호출`, ctx.args);

  const start = Date.now();
  const result = await ctx.next();

  api.logger.debug(`[ToolCall] ${ctx.toolName} 완료: ${Date.now() - start}ms`, {
    status: result.status,
  });

  return result;
});
```

### 9.3 도구 필터링 (Step 미들웨어)

```typescript
api.pipeline.register('step', async (ctx) => {
  // ToolSearch Extension의 상태에서 선택된 도구 목록 가져오기
  const state = await api.state.get();
  const selectedTools = state?.selectedTools;

  if (selectedTools) {
    // 선택된 도구만 노출
    ctx.toolCatalog = ctx.toolCatalog.filter(
      t => selectedTools.includes(t.name)
    );
  }

  return ctx.next();
});
```

### 9.4 입력 검증/변환 (ToolCall 미들웨어)

```typescript
api.pipeline.register('toolCall', async (ctx) => {
  // bash 도구의 command 인자 길이 제한
  if (ctx.toolName === 'bash__exec') {
    const command = ctx.args.command;
    if (typeof command === 'string' && command.length > 10000) {
      ctx.args = {
        ...ctx.args,
        command: command.slice(0, 10000),
      };
      api.logger.warn('bash command truncated to 10000 chars');
    }
  }

  return ctx.next();
});
```

### 9.5 재시도 처리 (Step 미들웨어)

```typescript
api.pipeline.register('step', async (ctx) => {
  try {
    return await ctx.next();
  } catch (error) {
    // LLM 호출 실패 시 재시도 로직
    if (isRetryableError(error)) {
      const retryCount = (ctx.metadata['retryCount'] ?? 0) as number;
      if (retryCount < 3) {
        ctx.metadata['retryCount'] = retryCount + 1;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await sleep(delay);
        api.logger.warn(`Step 재시도 (${retryCount + 1}/3): ${error.message}`);
        // 동일 Step에서 ctx.next()를 재호출하지 않고, Runtime이 다음 Step에서 재시도를 결정
      }
    }
    throw error;
  }
});
```

### 9.6 Skill 주입 (Step 미들웨어)

```typescript
api.pipeline.register('step', async (ctx) => {
  // 스킬 관련 도구를 catalog에 추가
  const skillTools = await loadSkillTools();
  ctx.toolCatalog = [...ctx.toolCatalog, ...skillTools];

  // 스킬 컨텍스트를 메시지로 주입
  const skillContext = await getActiveSkillContext();
  if (skillContext) {
    ctx.emitMessageEvent({
      type: 'append',
      message: createSystemMessage(skillContext),
    });
  }

  return ctx.next();
});
```

---

## 10. 표준 구현 가이드

파이프라인 확장은 표준 미들웨어(`turn`, `step`, `toolCall`)와 이벤트 버스(`api.events`) 조합을 기준으로 구현한다.

1. 메시지 주입/편집은 `conversationState`와 `emitMessageEvent()`로 수행한다.
2. 런타임 컨텍스트 확장은 `metadata` 공유 객체를 사용한다.
3. Agent별 동작 분기는 미들웨어 내부에서 `agentName`, `instanceKey`를 기준으로 처리한다.

---

## 11. 선택 포인트(비표준)

구현체는 3종 표준 미들웨어 외에 추가 미들웨어 종류를 제공할 수 있다(MAY).

**규칙:**

1. 비표준 미들웨어는 표준 미들웨어(`turn`, `step`, `toolCall`)의 동작을 깨뜨리지 않아야 한다(MUST).
2. 비표준 미들웨어를 제공하는 경우 문서화해야 한다(SHOULD).
3. 비표준 미들웨어도 동일한 `next()` 기반 온니언 모델을 따라야 한다(MUST).

---

## 12. 실행 흐름 다이어그램

```text
[External Event via Connector / CLI / IPC]
          |
          v
   [Orchestrator: route to AgentProcess]
          |
          v
   [AgentProcess: event queue]
          |  (dequeue 1 event)
          v
     +---------------+
     |   Turn Start   |
     +---------------+
          |
          | load BaseMessages from base.jsonl
          v
   +---------------------------------------+
   | ConversationState Init                |
   |  - baseMessages (from disk)           |
   |  - events = []                        |
   +---------------------------------------+
          |
          v
   +---------------------------------------+
   | Turn Middleware Chain (onion)          |
   |                                       |
   | ExtA.turn.pre                         |
   |   ExtB.turn.pre                       |
   |     [Core Turn Logic]                 |
   |     +-----------------------------+   |
   |     | Step Loop (0..N)            |   |
   |     |                             |   |
   |     |  Step Middleware Chain       |   |
   |     |  ExtA.step.pre              |   |
   |     |    ExtB.step.pre            |   |
   |     |      [Core Step Logic]      |   |
   |     |      - build LLM input      |   |
   |     |      - call LLM             |   |
   |     |      - for each toolCall:   |   |
   |     |        ToolCall Middleware   |   |
   |     |        ExtA.toolCall.pre    |   |
   |     |          ExtB.toolCall.pre  |   |
   |     |            [Core Tool Exec] |   |
   |     |          ExtB.toolCall.post |   |
   |     |        ExtA.toolCall.post   |   |
   |     |    ExtB.step.post           |   |
   |     |  ExtA.step.post             |   |
   |     |                             |   |
   |     | continue if hasToolCalls    |   |
   |     +-----------------------------+   |
   |   ExtB.turn.post                      |
   | ExtA.turn.post                        |
   +---------------------------------------+
          |
          v
   fold: Base + SUM(Events) -> new Base
          |
          v
   persist base.jsonl + clear events.jsonl
          |
          v
       Turn End
          |
          v
   wait next event...
```

---

## 관련 문서

- `docs/specs/runtime.md` - Runtime 실행 모델 스펙 (Turn/Step 실행 루프, 메시지 상태 실행 규칙)
- `docs/specs/workspace.md` - Workspace/Storage 스펙 (messages 디렉터리 저장 규칙)
- `docs/specs/extension.md` - Extension 시스템 스펙
- `docs/specs/shared-types.md` - 공통 타입 SSOT
