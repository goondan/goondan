## 13. Extension 실행 인터페이스

### 13.1 엔트리포인트

Extension 구현은 `register(api)` 함수를 내보내야 하며(MUST), AgentProcess는 초기화 시 Agent에 선언된 Extension 목록 순서대로 이를 호출해야 한다(MUST).

```typescript
// extension entry point
export function register(api: ExtensionApi): void {
  // 미들웨어 등록, 도구 등록, 이벤트 구독 등
}
```

### 13.2 ExtensionApi

AgentProcess는 Extension에 최소 다음 API를 제공해야 한다(MUST).

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

#### 13.2.1 PipelineRegistry

미들웨어 등록은 `api.pipeline.register(type, middlewareFn)` 형태를 사용해야 한다(MUST).

```typescript
interface PipelineRegistry {
  register(type: 'turn', fn: TurnMiddleware): void;
  register(type: 'step', fn: StepMiddleware): void;
  register(type: 'toolCall', fn: ToolCallMiddleware): void;
}

type TurnMiddleware = (ctx: TurnMiddlewareContext) => Promise<TurnResult>;
type StepMiddleware = (ctx: StepMiddlewareContext) => Promise<StepResult>;
type ToolCallMiddleware = (ctx: ToolCallMiddlewareContext) => Promise<ToolCallResult>;
```

규칙:

1. 미들웨어 타입은 `'turn'`, `'step'`, `'toolCall'` 세 가지만 허용해야 한다(MUST).
2. v1의 `mutate(point, fn)`, `wrap(point, fn)` API는 제거해야 한다(MUST NOT).
3. 동일 타입에 여러 미들웨어가 등록되면 등록 순서대로 onion 방식으로 체이닝해야 한다(MUST).
4. `api.events.on()` 구독 해제를 위해 반환 함수를 제공해야 한다(MUST).
5. 코어 API 부재로 Extension이 초기화 실패하는 상황이 없어야 한다(MUST).
6. `api.tools.register()`로 등록한 도구는 도구 이름 규칙(`{리소스명}__{하위도구명}`)을 따라야 한다(MUST).

### 13.3 미들웨어 컨텍스트

각 미들웨어 타입은 전용 컨텍스트를 받으며, `next()` 호출 전후로 전처리/후처리를 수행한다.

#### 13.3.1 TurnMiddlewareContext

```typescript
interface TurnMiddlewareContext {
  /** 현재 에이전트 이름 */
  readonly agentName: string;

  /** 현재 인스턴스 키 */
  readonly instanceKey: string;

  /** Turn을 트리거한 입력 이벤트 */
  readonly inputEvent: AgentEvent;

  /** 대화 상태 (base + events 이벤트 소싱) */
  readonly conversationState: ConversationState;

  /** 메시지 이벤트 발행 (append/replace/remove/truncate) */
  emitMessageEvent(event: MessageEvent): void;

  /** 미들웨어 간 공유 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 다음 미들웨어 또는 코어 Turn 로직 실행 */
  next(): Promise<TurnResult>;
}
```

#### 13.3.2 StepMiddlewareContext

```typescript
interface StepMiddlewareContext {
  /** 현재 Turn 정보 */
  readonly turn: Turn;

  /** 현재 Step 인덱스 */
  readonly stepIndex: number;

  /** 대화 상태 */
  readonly conversationState: ConversationState;

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

#### 13.3.3 ToolCallMiddlewareContext

```typescript
interface ToolCallMiddlewareContext {
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

#### 13.3.4 ConversationState

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

규칙:

1. `conversationState.baseMessages`는 Turn 시작 기준 메시지 스냅샷이어야 한다(MUST).
2. `conversationState.events`는 현재 Turn에서 누적된 메시지 이벤트의 순서 보장 뷰여야 한다(MUST).
3. `emitMessageEvent()`로 발행한 이벤트는 동일 Turn의 `SUM(Events)`에 포함되어야 한다(MUST).
4. `conversationState.nextMessages`는 `baseMessages + SUM(events)`와 동일하게 유지해야 한다(MUST).
5. `next()` 호출 전은 전처리(pre) 시점이고, `next()` 호출 후는 후처리(post) 시점이다(MUST).
6. v1의 `ctx.turn.messages.base/events/next/emit` 구조는 제거하고, `conversationState` + `emitMessageEvent`로 대체해야 한다(MUST).

#### 13.3.5 MessageEvent 타입

```typescript
type MessageEvent =
  | { type: 'append';   message: Message }
  | { type: 'replace';  targetId: string; message: Message }
  | { type: 'remove';   targetId: string }
  | { type: 'truncate' };
```

### 13.4 Extension 상태 관리

규칙:

1. `api.state.get()`과 `api.state.set(value)`를 통해 Extension별 JSON 상태를 관리해야 한다(MUST).
2. 상태 저장은 Extension identity에 귀속되어야 한다(MUST).
3. Extension 상태는 인스턴스별로 격리되어야 한다(MUST).
4. AgentProcess는 인스턴스 초기화 시 디스크에서 Extension 상태를 자동 복원해야 한다(MUST).
5. AgentProcess는 Turn 종료 시점에 변경된 Extension 상태를 디스크에 기록해야 한다(MUST).
6. Extension 상태 파일은 `extensions/<ext-name>.json` 경로에 저장해야 한다(MUST).

### 13.5 에러/호환성 정책

1. Extension 초기화/실행 오류는 표준 오류 코드와 함께 보고되어야 한다(MUST).
2. 에러에는 가능한 경우 `suggestion`, `helpUrl`을 포함하는 것을 권장한다(SHOULD).
3. AgentProcess는 Extension 호환성 검증(`apiVersion: goondan.ai/v1`)을 로드 단계에서 수행해야 한다(SHOULD).
4. Extension이 필요한 API가 없어 초기화 실패하는 경우 명확한 에러 메시지와 함께 AgentProcess 기동을 중단해야 한다(MUST).
