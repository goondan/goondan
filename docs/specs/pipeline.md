# Goondan 라이프사이클 파이프라인(훅) 스펙 (v0.10)

본 문서는 `docs/requirements/11_lifecycle-pipelines.md`를 기반으로 Runtime 파이프라인 시스템의 **구현 스펙**을 정의한다.

---

## 1. 개요

파이프라인은 Goondan Runtime의 실행 라이프사이클에서 Extension이 개입할 수 있는 **표준 확장 지점**이다.
파이프라인을 통해 확장은 도구 카탈로그 조작, 컨텍스트 블록 주입, LLM 호출 래핑, 도구 실행 제어, 워크스페이스 이벤트 처리 등을 수행할 수 있다.

### 1.1 설계 원칙

- **결정론적 실행**: 동일 구성과 입력에 대해 파이프라인 실행 순서는 항상 동일해야 한다.
- **격리된 상태**: 각 파이프라인 포인트는 명확한 입출력 컨텍스트를 갖는다.
- **Identity 기반 Reconcile**: 구성 변경 시 배열 순서가 아닌 identity key로 상태를 유지한다.

---

## 2. 파이프라인 타입

### 2.1 Mutator (순차 변형)

Mutator는 컨텍스트를 순차적으로 변형하는 함수 체인이다.
각 Mutator는 이전 Mutator의 출력을 입력으로 받아 변형된 컨텍스트를 반환한다.

```ts
/**
 * Mutator 함수 시그니처
 * @param ctx - 현재 파이프라인 컨텍스트
 * @returns 변형된 컨텍스트 (또는 원본 그대로 반환)
 */
type Mutator<T extends PipelineContext> = (ctx: T) => Promise<T> | T;
```

**실행 규칙**:
- Extension 등록 순서대로 선형 실행 (MUST)
- 각 Mutator는 컨텍스트를 변형하거나 그대로 반환할 수 있다
- 예외 발생 시 파이프라인 실행이 중단된다

**예시**:
```ts
api.pipelines.mutate('step.tools', async (ctx) => {
  // Tool Catalog에 동적 도구 추가
  const updatedTools = [...ctx.toolCatalog, {
    name: 'dynamic.tool',
    description: '동적으로 추가된 도구',
    parameters: { type: 'object', properties: {} },
  }];
  return { ...ctx, toolCatalog: updatedTools };
});
```

### 2.2 Middleware (래핑)

Middleware는 `next()` 기반 onion 구조로 핵심 실행을 래핑한다.
먼저 등록된 Extension이 더 바깥 레이어를 형성한다.

```ts
/**
 * Middleware 함수 시그니처
 * @param ctx - 현재 파이프라인 컨텍스트
 * @param next - 다음 레이어(또는 핵심 실행) 호출 함수
 * @returns 실행 결과
 */
type Middleware<T extends PipelineContext, R> = (
  ctx: T,
  next: (ctx: T) => Promise<R>
) => Promise<R>;
```

**실행 규칙**:
- 먼저 등록된 Extension이 더 바깥 레이어 (MUST)
- `next()` 호출 전후에 로직을 삽입할 수 있다
- `next()`를 호출하지 않으면 내부 실행이 스킵된다 (주의)

**예시**:
```ts
api.pipelines.wrap('step.llmCall', async (ctx, next) => {
  const startTime = Date.now();
  console.log('[LLM] 호출 시작');

  // 핵심 LLM 호출
  const result = await next(ctx);

  const elapsed = Date.now() - startTime;
  console.log(`[LLM] 호출 완료: ${elapsed}ms`);

  return result;
});
```

### 2.3 Onion 구조 다이어그램

```
┌─────────────────────────────────────────────────────┐
│  Extension A (wrap)                                  │
│  ┌─────────────────────────────────────────────┐    │
│  │  Extension B (wrap)                          │    │
│  │  ┌─────────────────────────────────────┐    │    │
│  │  │  Extension C (wrap)                  │    │    │
│  │  │  ┌─────────────────────────────┐    │    │    │
│  │  │  │     Core Execution          │    │    │    │
│  │  │  │     (LLM / Tool)            │    │    │    │
│  │  │  └─────────────────────────────┘    │    │    │
│  │  │         ↑ next() ↑                  │    │    │
│  │  └─────────────────────────────────────┘    │    │
│  │              ↑ next() ↑                     │    │
│  └─────────────────────────────────────────────┘    │
│                 ↑ next() ↑                          │
└─────────────────────────────────────────────────────┘
```

---

## 3. 표준 파이프라인 포인트

Runtime은 다음 파이프라인 포인트를 MUST 제공한다.

### 3.1 파이프라인 포인트 타입 정의

```ts
type PipelinePoint =
  // Turn 레벨
  | 'turn.pre'
  | 'turn.post'
  // Step 레벨
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmCall'
  | 'step.llmError'
  | 'step.post'
  // ToolCall 레벨
  | 'toolCall.pre'
  | 'toolCall.exec'
  | 'toolCall.post'
  // Workspace 레벨 (비표준/선택 포인트)
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';
```

### 3.2 포인트별 타입과 의미론

**표준 파이프라인 포인트 (MUST)**:

| 포인트 | 타입 | 설명 |
|--------|------|------|
| `turn.pre` | Mutator | Turn 시작 직전, 입력 전처리 |
| `turn.post` | Mutator | Turn 종료 훅, `(base, events)` 입력 기반 후처리 |
| `step.pre` | Mutator | Step 시작 직전 |
| `step.config` | Mutator | SwarmBundleRef 활성화 및 Effective Config 로드 |
| `step.tools` | Mutator | Tool Catalog 구성 |
| `step.blocks` | Mutator | Context Blocks 구성 |
| `step.llmCall` | Middleware | LLM 호출 래핑 |
| `step.llmError` | Mutator | LLM 호출 실패 시 오류 처리 |
| `step.post` | Mutator | Step 종료 직후, tool call 처리 완료 후 |
| `toolCall.pre` | Mutator | 개별 tool call 실행 직전 |
| `toolCall.exec` | Middleware | tool call 실행 래핑 |
| `toolCall.post` | Mutator | 개별 tool call 실행 직후 |

**비표준 파이프라인 포인트 (선택)**:

비표준 포인트는 Runtime이 선택적으로 제공할 수 있다. 비표준 포인트는 표준 동작을 깨뜨려서는 안 되며(MUST NOT), 해당 포인트의 존재 여부와 동작을 문서화해야 한다(MUST).

| 포인트 | 타입 | 설명 |
|--------|------|------|
| `workspace.repoAvailable` | Mutator | 레포지토리 확보 시 |
| `workspace.worktreeMounted` | Mutator | worktree 마운트 시 |

### 3.3 실행 순서 제약 (MUST)

```
step.config → step.tools → step.blocks → step.llmInput → step.llmCall
```

- `step.config`는 `step.tools`보다 **반드시 먼저** 실행되어야 한다 (MUST)
- `step.config`에서 SwarmBundleRef가 확정되면 Step 종료까지 변경 불가 (MUST)

---

## 4. 컨텍스트 구조

### 4.1 기본 컨텍스트 인터페이스

```ts
interface BasePipelineContext {
  /** 현재 SwarmInstance */
  instance: SwarmInstance;
  /** Swarm 리소스 정의 */
  swarm: Resource<SwarmSpec>;
  /** 현재 Agent 리소스 정의 */
  agent: Resource<AgentSpec>;
  /** 현재 Effective Config */
  effectiveConfig: EffectiveConfig;
  /** 이벤트 버스 */
  events: EventBus;
  /** 로거 */
  logger: Console;
}
```

### 4.2 Turn 컨텍스트

```ts
interface TurnContext extends BasePipelineContext {
  /** 현재 Turn */
  turn: Turn;
  /** turn 시작 기준 메시지 (turn.post에서 제공) */
  baseMessages?: LlmMessage[];
  /** turn 중 누적 메시지 이벤트 (turn.post에서 제공) */
  messageEvents?: MessageEvent[];
}

interface Turn {
  /** Turn 고유 식별자 */
  id: string;
  /** Turn 입력 텍스트 */
  input: string;
  /** Turn 메시지 상태 */
  messageState: {
    baseMessages: LlmMessage[];
    events: MessageEvent[];
    nextMessages: LlmMessage[];
  };
  /** Tool 실행 결과 */
  toolResults: ToolResult[];
  /** 호출 원점 정보 (Connector 등) */
  origin?: JsonObject;
  /** 인증 컨텍스트 */
  auth?: TurnAuth;
  /** 메타데이터 */
  metadata?: JsonObject;
  /** Turn 요약 (turn.post에서 생성) */
  summary?: string;
}

type MessageEvent =
  | { type: 'system_message'; seq: number; message: LlmMessage }
  | { type: 'llm_message'; seq: number; message: LlmMessage }
  | { type: 'replace'; seq: number; targetId: string; message: LlmMessage }
  | { type: 'remove'; seq: number; targetId: string }
  | { type: 'truncate'; seq: number };

interface TurnAuth {
  /** 호출자 정보 */
  actor?: {
    type: 'user' | 'system';
    id: string;
    display?: string;
  };
  /** Subject 식별자 (OAuth 토큰 조회용) */
  subjects?: {
    global?: string;
    user?: string;
  };
}
```

### 4.3 Step 컨텍스트

```ts
interface StepContext extends TurnContext {
  /** 현재 Step */
  step: Step;
  /** 현재 Step에서 LLM에 노출되는 도구 목록 */
  toolCatalog: ToolCatalogItem[];
  /** 컨텍스트 블록 */
  blocks: ContextBlock[];
  /** 현재 활성화된 SwarmBundleRef */
  activeSwarmRef: string;
}

interface Step {
  /** Step 고유 식별자 */
  id: string;
  /** Step 인덱스 (Turn 내에서 0부터 시작) */
  index: number;
  /** LLM 호출 결과 */
  llmResult?: LlmResult;
  /** Step 시작 시간 */
  startedAt: Date;
  /** Step 종료 시간 */
  endedAt?: Date;
}

interface LlmResult {
  /** LLM 응답 메시지 */
  message: LlmMessage;
  /** tool call 목록 */
  toolCalls: ToolCall[];
  /** 사용량/메타 정보 */
  meta?: {
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    model?: string;
    finishReason?: string;
  };
}
```

### 4.4 ToolCall 컨텍스트

```ts
interface ToolCallContext extends StepContext {
  /** 현재 실행 중인 tool call */
  toolCall: ToolCall;
  /** Tool 실행 결과 (toolCall.post에서 사용) */
  toolResult?: ToolResult;
}

interface ToolCall {
  /** tool call 고유 식별자 (LLM이 생성) */
  id: string;
  /** 호출할 도구 이름 */
  name: string;
  /** 도구 인자 */
  args: JsonObject;
}

interface ToolResult {
  /** 대응하는 tool call ID */
  toolCallId: string;
  /** 도구 이름 */
  toolName: string;
  /** 실행 결과 */
  output: JsonValue;
  /** 실행 상태 */
  status: 'ok' | 'error' | 'pending';
  /** 비동기 제출 시 핸들 */
  handle?: string;
  /** 오류 정보 (status가 error인 경우) */
  error?: {
    name: string;
    message: string;
    code?: string;
    /** 사용자 복구를 위한 제안 (SHOULD) */
    suggestion?: string;
    /** 관련 문서 링크 (SHOULD) */
    helpUrl?: string;
  };
}
```

### 4.5 Workspace 컨텍스트

```ts
interface WorkspaceContext extends BasePipelineContext {
  /** workspace 이벤트 종류 */
  eventType: 'repoAvailable' | 'worktreeMounted';
  /** 레포지토리/worktree 경로 */
  path: string;
  /** 추가 메타데이터 */
  metadata?: JsonObject;
}
```

### 4.6 Error 컨텍스트 (step.llmError)

```ts
interface LlmErrorContext extends StepContext {
  /** 발생한 오류 */
  error: Error;
  /** 재시도 횟수 */
  retryCount: number;
  /** 재시도 여부 결정 */
  shouldRetry: boolean;
  /** 재시도 지연 시간 (ms) */
  retryDelayMs: number;
}
```

---

## 5. Tool Catalog 및 Context Blocks

### 5.1 ToolCatalogItem

```ts
interface ToolCatalogItem {
  /** 도구 이름 (LLM에 노출되는 이름) */
  name: string;
  /** 도구 설명 */
  description?: string;
  /** 입력 파라미터 JSON Schema */
  parameters?: JsonObject;
  /** 원본 Tool 리소스 (있는 경우) */
  tool?: Resource<ToolSpec> | null;
  /** Tool export 정의 (있는 경우) */
  export?: ToolExportSpec | null;
  /** 도구 출처 정보 */
  source?: {
    type: 'static' | 'dynamic' | 'mcp';
    extension?: string;
    mcpServer?: string;
  };
}
```

### 5.2 ContextBlock

```ts
interface ContextBlock {
  /** 블록 타입 */
  type: string;
  /** 블록 데이터 */
  data?: JsonValue;
  /** 블록 항목 목록 (리스트형 블록) */
  items?: JsonValue[];
  /** 블록 우선순위 (높을수록 먼저 표시) */
  priority?: number;
}
```

**표준 블록 타입**:

| 타입 | 설명 | 예시 용도 |
|------|------|----------|
| `system.prompt` | 시스템 프롬프트 | Agent 지시사항 |
| `skills.catalog` | 스킬 카탈로그 | 사용 가능 스킬 목록 |
| `skills.content` | 열린 스킬 내용 | SKILL.md 전문 |
| `memory.context` | 메모리 컨텍스트 | 이전 대화 요약 |
| `auth.pending` | 승인 대기 정보 | OAuth 승인 안내 |
| `compaction.summary` | 압축 요약 | 메시지 압축 결과 |
| `workspace.info` | 워크스페이스 정보 | 현재 작업 디렉터리 |
| `custom.*` | 사용자 정의 블록 | Extension 제공 |

---

## 6. PipelineApi 인터페이스

### 6.1 Extension에 제공되는 API

```ts
interface PipelineApi {
  /**
   * Mutator 등록
   * @param point - 파이프라인 포인트
   * @param fn - Mutator 함수
   * @param options - 등록 옵션
   */
  mutate<T extends MutatorPoint>(
    point: T,
    fn: Mutator<ContextForPoint<T>>,
    options?: MutatorOptions
  ): void;

  /**
   * Middleware 등록
   * @param point - 파이프라인 포인트
   * @param fn - Middleware 함수
   * @param options - 등록 옵션
   */
  wrap<T extends MiddlewarePoint>(
    point: T,
    fn: Middleware<ContextForPoint<T>, ResultForPoint<T>>,
    options?: MiddlewareOptions
  ): void;
}

interface MutatorOptions {
  /** 실행 우선순위 (낮을수록 먼저 실행, 기본: 0) */
  priority?: number;
  /** 식별자 (reconcile용) */
  id?: string;
}

interface MiddlewareOptions {
  /** 실행 우선순위 (낮을수록 바깥 레이어, 기본: 0) */
  priority?: number;
  /** 식별자 (reconcile용) */
  id?: string;
}
```

### 6.2 포인트별 타입 매핑

```ts
type MutatorPoint =
  | 'turn.pre' | 'turn.post'
  | 'step.pre' | 'step.config' | 'step.tools' | 'step.blocks' | 'step.llmError' | 'step.post'
  | 'toolCall.pre' | 'toolCall.post'
  | 'workspace.repoAvailable' | 'workspace.worktreeMounted';

type MiddlewarePoint =
  | 'step.llmCall'
  | 'toolCall.exec';

type ContextForPoint<T extends PipelinePoint> =
  T extends 'turn.pre' | 'turn.post' ? TurnContext :
  T extends 'step.pre' | 'step.config' | 'step.tools' | 'step.blocks' | 'step.llmCall' | 'step.llmError' | 'step.post' ? StepContext :
  T extends 'toolCall.pre' | 'toolCall.exec' | 'toolCall.post' ? ToolCallContext :
  T extends 'workspace.repoAvailable' | 'workspace.worktreeMounted' ? WorkspaceContext :
  never;

type ResultForPoint<T extends PipelinePoint> =
  T extends 'step.llmCall' ? LlmResult :
  T extends 'toolCall.exec' ? ToolResult :
  never;
```

---

## 7. 실행 순서 규칙

### 7.1 Extension 등록 순서

Extension은 Agent 구성의 `extensions` 배열 순서대로 등록된다 (MUST).

```yaml
kind: Agent
spec:
  extensions:
    - { kind: Extension, name: extA }  # 1번째 등록
    - { kind: Extension, name: extB }  # 2번째 등록
    - { kind: Extension, name: extC }  # 3번째 등록
```

**Mutator 실행 순서**: `extA → extB → extC` (선형)
**Middleware 레이어 순서**: `extA(바깥) → extB → extC(안쪽) → Core`

### 7.2 Priority 기반 정렬

동일 포인트 내에서 `priority` 옵션이 지정된 경우:

```ts
// 등록 순서
api.pipelines.mutate('step.tools', fnA, { priority: 10 });
api.pipelines.mutate('step.tools', fnB, { priority: 5 });
api.pipelines.mutate('step.tools', fnC, { priority: 10 });
```

**실행 순서**: `fnB(5) → fnA(10) → fnC(10)`
- 낮은 priority가 먼저 실행
- 동일 priority는 등록 순서 유지 (안정 정렬, SHOULD)

### 7.3 Hooks 합성 규칙

Agent의 `hooks`와 Extension이 등록한 파이프라인 핸들러는 다음 순서로 합성된다:

1. Extension이 등록한 핸들러 (등록 순서대로)
2. Agent hooks (priority 정렬 후 안정 정렬)

**Extension-Hook 실행순서 MUST 규칙:**

1. **Extension 우선 실행(MUST)**: Extension 파이프라인은 Agent Hook보다 항상 먼저 실행되어야 한다.
2. **Middleware 바깥 레이어(MUST)**: Middleware 포인트에서 Extension은 Agent Hook보다 바깥 레이어(onion 외곽)여야 한다. 즉, Extension이 먼저 진입하고 마지막에 빠져나온다.
3. **전체 순서 보장(MUST)**: 동일 포인트에 Extension 파이프라인과 Agent Hook이 모두 등록된 경우, Extension 전체 → Agent Hook 전체 순서를 따라야 한다.

```
Mutator 실행 순서:
  ExtA.mutate → ExtB.mutate → ExtC.mutate → HookA → HookB

Middleware 레이어 순서 (onion):
  ExtA(바깥) → ExtB → ExtC → HookA → HookB(안쪽) → Core
```

```ts
interface HookSpec {
  /** Hook 식별자 (reconcile용, 권장) */
  id?: string;
  /** 파이프라인 포인트 */
  point: PipelinePoint;
  /** 우선순위 (기본: 0) */
  priority?: number;
  /** 실행 액션 */
  action: HookAction;
}

interface HookAction {
  /** tool call 실행 */
  toolCall?: {
    tool: string;
    args: Record<string, JsonValue | { expr: string }>;
  };
}
```

---

## 8. Reconcile Identity 규칙

### 8.0 Reconcile 대상 정의 (MUST)

Reconcile 대상은 **이전 Step에서 활성화된 Effective Config**와 **현재 Step에서 활성화될 Effective Config**의 차이여야 한다(MUST).

- `step.config` Mutator 실행 후, Runtime은 이전 Step의 Effective Config와 현재 Step의 Effective Config를 identity 기반으로 비교하여 retained/added/removed/updated를 판별한다.
- Changeset merge로 SwarmBundleRef가 변경된 경우에도 동일한 Reconcile 알고리즘이 적용되어야 한다(MUST). SwarmBundleRef 변경은 Effective Config 전체가 바뀔 수 있으므로, 모든 항목(Extension, Tool, Hook)에 대해 identity 기반 비교를 수행한다.

### 8.1 Identity Key 정의 (MUST)

Runtime은 `step.config` 이후 reconcile 단계에서 배열을 **identity 기반**으로 비교해야 한다.

```ts
type IdentityKey = string;

/**
 * ToolRef identity: "{kind}/{name}"
 * @example "Tool/fileRead", "Tool/slack.postMessage"
 */
function getToolIdentity(ref: ObjectRefLike): IdentityKey {
  const { kind, name } = normalizeRef(ref);
  return `${kind}/${name}`;
}

/**
 * ExtensionRef identity: "{kind}/{name}"
 * @example "Extension/skills", "Extension/mcp-github"
 */
function getExtensionIdentity(ref: ObjectRefLike): IdentityKey {
  const { kind, name } = normalizeRef(ref);
  return `${kind}/${name}`;
}

/**
 * Hook identity: hook.id 또는 (point, priority, actionFingerprint)
 * @example "hook-slack-notify" 또는 "turn.post:0:toolCall:slack.postMessage"
 */
function getHookIdentity(hook: HookSpec): IdentityKey {
  if (hook.id) {
    return hook.id;
  }
  const actionFingerprint = computeActionFingerprint(hook.action);
  return `${hook.point}:${hook.priority ?? 0}:${actionFingerprint}`;
}

function computeActionFingerprint(action: HookAction): string {
  if (action.toolCall) {
    return `toolCall:${action.toolCall.tool}`;
  }
  return 'unknown';
}
```

### 8.2 Reconcile 알고리즘

```ts
interface ReconcileResult<T> {
  /** 유지되는 항목 (기존 상태 보존) */
  retained: Map<IdentityKey, T>;
  /** 새로 추가된 항목 */
  added: Map<IdentityKey, T>;
  /** 제거된 항목 */
  removed: Map<IdentityKey, T>;
  /** 구성이 변경된 항목 */
  updated: Map<IdentityKey, { prev: T; next: T }>;
}

function reconcile<T>(
  prevItems: T[],
  nextItems: T[],
  getIdentity: (item: T) => IdentityKey,
  hasConfigChanged?: (prev: T, next: T) => boolean
): ReconcileResult<T> {
  const prevMap = new Map<IdentityKey, T>();
  const nextMap = new Map<IdentityKey, T>();

  for (const item of prevItems) {
    prevMap.set(getIdentity(item), item);
  }
  for (const item of nextItems) {
    nextMap.set(getIdentity(item), item);
  }

  const retained = new Map<IdentityKey, T>();
  const added = new Map<IdentityKey, T>();
  const removed = new Map<IdentityKey, T>();
  const updated = new Map<IdentityKey, { prev: T; next: T }>();

  // 추가/유지/업데이트 판별
  for (const [key, nextItem] of nextMap) {
    const prevItem = prevMap.get(key);
    if (!prevItem) {
      added.set(key, nextItem);
    } else if (hasConfigChanged && hasConfigChanged(prevItem, nextItem)) {
      updated.set(key, { prev: prevItem, next: nextItem });
    } else {
      retained.set(key, prevItem);
    }
  }

  // 제거 판별
  for (const [key, prevItem] of prevMap) {
    if (!nextMap.has(key)) {
      removed.set(key, prevItem);
    }
  }

  return { retained, added, removed, updated };
}
```

### 8.3 Reconcile 요구사항 (MUST)

1. **상태 유지**: 동일 identity key가 Effective Config에 계속 존재하는 한, Runtime은 해당 항목의 실행 상태를 유지해야 한다.

2. **순서 불변성**: 배열의 순서 변경만으로는 연결/상태 재생성이 발생해서는 안 된다.

3. **변경 감지**: 구성 내용이 변경된 경우에만 상태를 재초기화한다.

4. **항목 제거 시 cleanup(MUST)**: Reconcile 결과 제거된 항목에 대해 Runtime은 cleanup을 수행해야 한다. (예: Extension 해제, MCP 연결 종료, Tool 핸들러 등록 해제)

5. **항목 추가 시 init(MUST)**: Reconcile 결과 새로 추가된 항목에 대해 Runtime은 init을 수행해야 한다. (예: Extension register 호출, MCP 연결 생성, Tool 핸들러 등록)

```ts
// 잘못된 구현 (배열 비교)
function arrayEqual(prev: unknown[], next: unknown[]): boolean {
  return JSON.stringify(prev) === JSON.stringify(next);
}

// 올바른 구현 (identity 기반)
function reconcileExtensions(
  prevExtensions: ObjectRefLike[],
  nextExtensions: ObjectRefLike[]
): ReconcileResult<ObjectRefLike> {
  return reconcile(
    prevExtensions,
    nextExtensions,
    getExtensionIdentity,
    (prev, next) => {
      // 구성 변경 감지 (Overrides 등)
      return JSON.stringify(prev) !== JSON.stringify(next);
    }
  );
}
```

---

## 9. Stateful MCP Extension 연결 유지

### 9.1 연결 유지 규칙 (MUST)

`config.attach.mode=stateful`인 MCP 연동 Extension은 동일 identity key로 Effective Config에 유지되는 동안 연결(프로세스/세션)을 유지해야 한다.

```ts
interface MCPExtensionConfig {
  transport: {
    type: 'stdio' | 'http';
    command?: string[];
    url?: string;
  };
  attach: {
    mode: 'stateful' | 'stateless';
    scope: 'instance' | 'agent';
  };
  expose: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}
```

### 9.2 재연결 허용 조건 (MUST)

Runtime이 stateful MCP 연결을 재연결할 수 있는 경우:

1. **제거**: 해당 MCP 연동 Extension이 Effective Config에서 제거된 경우
2. **구성 변경**: 해당 Extension의 연결 구성(transport/attach/expose)이 변경되어 연결 호환성이 깨진 경우

### 9.3 구현 예시

```ts
class MCPConnectionManager {
  private connections = new Map<IdentityKey, MCPConnection>();

  async reconcile(
    prevExtensions: ExtensionConfig[],
    nextExtensions: ExtensionConfig[]
  ): Promise<void> {
    const result = reconcile(
      prevExtensions.filter(isMCPExtension),
      nextExtensions.filter(isMCPExtension),
      getExtensionIdentity,
      this.hasConnectionConfigChanged
    );

    // 유지: 연결 유지
    for (const [key] of result.retained) {
      // 아무것도 하지 않음 - 연결 유지
    }

    // 추가: 새 연결 생성
    for (const [key, ext] of result.added) {
      const connection = await this.createConnection(ext);
      this.connections.set(key, connection);
    }

    // 제거: 연결 종료
    for (const [key] of result.removed) {
      const connection = this.connections.get(key);
      if (connection) {
        await connection.disconnect();
        this.connections.delete(key);
      }
    }

    // 업데이트: 재연결
    for (const [key, { next }] of result.updated) {
      const oldConnection = this.connections.get(key);
      if (oldConnection) {
        await oldConnection.disconnect();
      }
      const newConnection = await this.createConnection(next);
      this.connections.set(key, newConnection);
    }
  }

  private hasConnectionConfigChanged(
    prev: ExtensionConfig,
    next: ExtensionConfig
  ): boolean {
    const prevMcp = prev.spec?.config as MCPExtensionConfig | undefined;
    const nextMcp = next.spec?.config as MCPExtensionConfig | undefined;

    if (!prevMcp || !nextMcp) return true;

    // transport 변경
    if (JSON.stringify(prevMcp.transport) !== JSON.stringify(nextMcp.transport)) {
      return true;
    }

    // attach 변경
    if (JSON.stringify(prevMcp.attach) !== JSON.stringify(nextMcp.attach)) {
      return true;
    }

    // expose 변경
    if (JSON.stringify(prevMcp.expose) !== JSON.stringify(nextMcp.expose)) {
      return true;
    }

    return false;
  }
}
```

---

## 10. Changeset 커밋/활성화 실패 처리

### 10.1 실패 처리 정책 (SHOULD)

1. **Tool 결과로 관측 가능**: Changeset commit 또는 활성화 실패는 tool 결과(`status: 'rejected'` 또는 `status: 'error'`)로 반환되어야 한다.

2. **Event Log 기록**: Runtime은 실패를 Instance event log에 기록하는 것을 SHOULD 한다.

3. **Step 계속 진행**: 실패 후에도 현재 Step은 계속 진행하는 것을 SHOULD 한다. (fail-fast는 구현 선택)

### 10.2 실패 유형

```ts
type ChangesetCommitResult =
  | {
      status: 'ok';
      changesetId: string;
      baseRef: string;
      newRef: string;
      summary: {
        filesChanged: string[];
        filesAdded: string[];
        filesDeleted: string[];
      };
    }
  | {
      status: 'rejected';
      changesetId: string;
      reason: 'policy_violation' | 'conflict' | 'invalid_files';
      message: string;
      violations?: string[];
    }
  | {
      status: 'error';
      changesetId: string;
      error: {
        code: string;
        message: string;
      };
    };
```

### 10.3 Event Log 기록 예시

```ts
interface ChangesetEvent {
  type: 'swarm.event';
  kind: 'changeset.commit' | 'changeset.rejected' | 'changeset.error';
  recordedAt: string;
  instanceId: string;
  instanceKey: string;
  swarmName: string;
  agentName?: string;
  data: {
    changesetId: string;
    baseRef?: string;
    newRef?: string;
    status: 'ok' | 'rejected' | 'error';
    reason?: string;
    message?: string;
  };
}
```

---

## 11. 구현 예시

### 11.1 Pipeline Registry 구현

```ts
class PipelineRegistry {
  private mutators = new Map<MutatorPoint, MutatorEntry[]>();
  private middlewares = new Map<MiddlewarePoint, MiddlewareEntry[]>();

  mutate<T extends MutatorPoint>(
    point: T,
    fn: Mutator<ContextForPoint<T>>,
    options?: MutatorOptions
  ): void {
    const entries = this.mutators.get(point) ?? [];
    entries.push({
      fn,
      priority: options?.priority ?? 0,
      id: options?.id,
      registrationOrder: entries.length,
    });
    this.mutators.set(point, entries);
  }

  wrap<T extends MiddlewarePoint>(
    point: T,
    fn: Middleware<ContextForPoint<T>, ResultForPoint<T>>,
    options?: MiddlewareOptions
  ): void {
    const entries = this.middlewares.get(point) ?? [];
    entries.push({
      fn,
      priority: options?.priority ?? 0,
      id: options?.id,
      registrationOrder: entries.length,
    });
    this.middlewares.set(point, entries);
  }

  async runMutators<T extends MutatorPoint>(
    point: T,
    initialCtx: ContextForPoint<T>
  ): Promise<ContextForPoint<T>> {
    const entries = this.getSortedMutators(point);
    let ctx = initialCtx;

    for (const entry of entries) {
      ctx = await entry.fn(ctx);
    }

    return ctx;
  }

  async runMiddleware<T extends MiddlewarePoint>(
    point: T,
    ctx: ContextForPoint<T>,
    core: (ctx: ContextForPoint<T>) => Promise<ResultForPoint<T>>
  ): Promise<ResultForPoint<T>> {
    const entries = this.getSortedMiddlewares(point);

    // Onion 구조 구성
    let next = core;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const currentNext = next;
      next = (ctx) => entry.fn(ctx, currentNext);
    }

    return next(ctx);
  }

  private getSortedMutators(point: MutatorPoint): MutatorEntry[] {
    const entries = this.mutators.get(point) ?? [];
    return [...entries].sort((a, b) => {
      // priority 오름차순
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // 동일 priority는 등록 순서 유지 (안정 정렬)
      return a.registrationOrder - b.registrationOrder;
    });
  }

  private getSortedMiddlewares(point: MiddlewarePoint): MiddlewareEntry[] {
    const entries = this.middlewares.get(point) ?? [];
    return [...entries].sort((a, b) => {
      // priority 오름차순 (낮을수록 바깥 레이어)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // 동일 priority는 등록 순서 유지
      return a.registrationOrder - b.registrationOrder;
    });
  }
}

interface MutatorEntry {
  fn: Mutator<unknown>;
  priority: number;
  id?: string;
  registrationOrder: number;
}

interface MiddlewareEntry {
  fn: Middleware<unknown, unknown>;
  priority: number;
  id?: string;
  registrationOrder: number;
}
```

### 11.2 Step 실행 흐름 구현

```ts
async function executeStep(
  registry: PipelineRegistry,
  initialCtx: StepContext
): Promise<StepContext> {
  // 1. step.pre
  let ctx = await registry.runMutators('step.pre', initialCtx);

  // 2. step.config (SwarmBundleRef 활성화)
  ctx = await registry.runMutators('step.config', ctx);

  // 3. step.tools (Tool Catalog 구성)
  ctx = await registry.runMutators('step.tools', ctx);

  // 4. step.blocks (Context Blocks 구성)
  ctx = await registry.runMutators('step.blocks', ctx);

  // 5. step.llmCall (LLM 호출)
  try {
    const llmResult = await registry.runMiddleware(
      'step.llmCall',
      ctx,
      async (ctx) => {
        // Core LLM 호출
        return await callLLM(ctx);
      }
    );
    ctx.step.llmResult = llmResult;
  } catch (error) {
    // step.llmError 처리
    const errorCtx: LlmErrorContext = {
      ...ctx,
      error,
      retryCount: 0,
      shouldRetry: false,
      retryDelayMs: 1000,
    };
    const processedCtx = await registry.runMutators('step.llmError', errorCtx);

    if (processedCtx.shouldRetry) {
      // 재시도 로직
      await sleep(processedCtx.retryDelayMs);
      return executeStep(registry, ctx);
    }
    throw error;
  }

  // 6. Tool Call 처리
  const toolCalls = ctx.step.llmResult?.toolCalls ?? [];
  for (const toolCall of toolCalls) {
    let toolCallCtx: ToolCallContext = { ...ctx, toolCall };

    // toolCall.pre
    toolCallCtx = await registry.runMutators('toolCall.pre', toolCallCtx);

    // toolCall.exec
    const toolResult = await registry.runMiddleware(
      'toolCall.exec',
      toolCallCtx,
      async (ctx) => {
        // Core Tool 실행
        return await executeTool(ctx.toolCall);
      }
    );
    toolCallCtx.toolResult = toolResult;

    // toolCall.post
    toolCallCtx = await registry.runMutators('toolCall.post', toolCallCtx);

    // 결과를 Turn에 누적
    ctx.turn.toolResults.push(toolResult);
  }

  // 7. step.post
  ctx = await registry.runMutators('step.post', ctx);

  return ctx;
}
```

---

## 12. 부록: 실행 흐름 다이어그램

```
[External Event via Connector]
          │
          ▼
   [SwarmInstance (instanceKey)]
          │
          ▼
   [AgentInstance Event Queue]
          │  (dequeue 1 event)
          ▼
     ┌───────────────┐
     │   Turn Start   │
     └───────────────┘
          │
          │ load BaseMessages
          ▼
   ┌───────────────────────────────────────┐
   │ Message State Init                    │
   │  - baseMessages                       │
   │  - events = []                        │
   └───────────────────────────────────────┘
          │
          │ turn.pre        (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │            Step Loop (0..N)           │
   └───────────────────────────────────────┘
          │
          │ step.pre        (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.config     (Mutator)             │
   │  - activate SwarmBundleRef + load cfg │
   │  - reconcile Extensions (identity)    │
   └───────────────────────────────────────┘
          │
          │ step.tools      (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.tools      (Mutator)             │
   │  - build/transform Tool Catalog       │
   └───────────────────────────────────────┘
          │
          │ step.blocks     (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.blocks     (Mutator)             │
   │  - build/transform Context Blocks     │
   │  - compose Next = Base + SUM(Events)  │
   └───────────────────────────────────────┘
          │
          │ step.llmCall    (Middleware)
          ▼
   ┌───────────────────────────────────────┐
   │ step.llmCall    (Middleware onion)    │
   │  EXT.before → CORE LLM → EXT.after    │
   └───────────────────────────────────────┘
          │
          ├──── tool calls exist? ────┐
          │                           │
          ▼                           ▼
 (for each tool call)            (no tool call)
          │
          │ toolCall.pre   (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ toolCall.exec   (Middleware onion)    │
   │  EXT.before → CORE exec → EXT.after   │
   └───────────────────────────────────────┘
          │
          │ toolCall.post  (Mutator)
          ▼
          │ step.post      (Mutator)
          ▼
     ┌───────────────────────┐
     │ Continue Step loop?   │
     └───────────────────────┘
          │yes                      │no
          └───────────┐             └─────────────┐
                      ▼                           ▼
                  (next Step)               turn.post (Mutator)
                                                │
                                                │ hooks input: (base, events)
                                                │ hooks may emit events
                                                ▼
                                   fold: Base + SUM(Events)
                                                │
                                                ▼
                                  persist base + clear events
                                                │
                                                ▼
                                             Turn End
                                                │
                                                ▼
                                        wait next event...
```

---

## 참조

- @docs/requirements/11_lifecycle-pipelines.md - 라이프사이클 파이프라인 요구사항
- @docs/requirements/09_runtime-model.md - Runtime 실행 모델
- @docs/requirements/05_core-concepts.md - 핵심 개념
- @docs/specs/api.md - Runtime/SDK API 스펙
- @docs/specs/bundle.md - Bundle YAML 스펙
