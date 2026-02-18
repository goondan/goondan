# Extension & Pipeline 아키텍처

> Extension이 미들웨어 파이프라인을 통해 Goondan 런타임에 개입하는 방식에 대한 이해

[English version](./extension-pipeline.md)

---

## Extension과 Pipeline이 왜 필요한가?

Goondan은 _에이전트가 무엇을 하는지_(YAML 구성으로 정의)와 _런타임이 실행 중에 어떻게 동작하는지_를 분리합니다. Tool은 LLM에게 수행할 행동을 제공하고, Extension은 _개발자인 여러분_에게 런타임 실행을 내부에서 관찰하고 변형할 능력을 제공합니다.

Extension 없이는 모든 횡단 관심사(로깅, 메시지 압축, 도구 필터링, 컨텍스트 주입)를 런타임 코어에 내장해야 합니다. 그러면 코어가 경직되고 모든 사용자가 동일한 정책을 강제로 사용하게 됩니다. 대신 Goondan은 **Middleware Only** 모델을 따릅니다: 런타임이 세 개의 명확한 개입 지점을 노출하고, Extension은 그 지점에 미들웨어 함수를 등록합니다.

이는 Koa, Express 등 서버 프레임워크에서 사용하는 것과 같은 패턴이지만, AI 에이전트 대화의 라이프사이클에 적용한 것입니다.

---

## Extension 리소스

Extension은 Goondan의 8종 리소스 Kind 중 하나입니다. YAML 선언은 의도적으로 최소화되어 있습니다:

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: my-extension
spec:
  entry: "./extensions/my-extension/index.ts"
  config:                # 선택: 임의의 키-값 쌍
    maxMessages: 50
```

| 필드 | 용도 |
|------|------|
| `spec.entry` | TypeScript 모듈 경로 (Bundle Root 기준, Bun으로 실행) |
| `spec.config` | Extension 자체 로직에서 사용하는 선택적 구성 |

Extension은 그 자체로는 아무것도 하지 않습니다. **Agent**가 참조해야만 활성화됩니다:

```yaml
kind: Agent
metadata:
  name: coder
spec:
  extensions:
    - ref: "Extension/logging"           # 1번째 로드
    - ref: "Extension/message-compaction" # 2번째 로드
    - ref: "Extension/skills"            # 3번째 로드
```

이 배열의 순서가 중요합니다 -- 미들웨어 레이어링 순서를 결정합니다 (아래에서 자세히 설명).

---

## `register(api)` 패턴

모든 Extension 엔트리 모듈은 `register` 함수를 export해야 합니다:

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi } from '@goondan/core';

export function register(api: ExtensionApi): void {
  // api.pipeline, api.tools, api.state, api.events, api.logger 사용
}
```

AgentProcess가 시작되면 `Agent.spec.extensions`에 선언된 각 Extension을 **순서대로 순차 로드**합니다. 각 Extension에 대해:

1. 엔트리 모듈을 import
2. `register(api)`를 호출하고 반환(또는 비동기인 경우 resolve)을 대기
3. 다음 Extension으로 이동

어떤 `register()` 호출이 예외를 던지면, AgentProcess 초기화 전체가 실패합니다. 이 fail-fast 동작은 잘못 구성된 Extension이 나중에 미묘한 런타임 오류를 유발하는 대신 즉시 포착되도록 보장합니다.

---

## ExtensionApi: 런타임으로 통하는 다섯 개의 문

`register()`에 전달되는 `api` 객체는 다섯 가지 기능을 노출합니다:

```text
ExtensionApi
  +-- pipeline   미들웨어 등록 (turn / step / toolCall)
  +-- tools      런타임에 동적 도구 등록
  +-- state      인스턴스별 영속 JSON 상태 읽기/쓰기
  +-- events     런타임 이벤트 구독/발행 (pub/sub)
  +-- logger     구조화 로깅 (Console 인터페이스)
```

| API 영역 | 역할 |
|----------|------|
| `pipeline` | 핵심 확장 메커니즘. turn 실행, LLM 호출, 도구 호출을 감싸는 미들웨어 등록. `turn`/`step`에서는 `ctx.agents`로 다른 에이전트 호출도 가능. |
| `tools` | LLM의 도구 카탈로그에 나타나는 도구를 동적으로 등록 -- MCP, 스킬 디스커버리 같은 패턴에 유용. |
| `state` | 에이전트 인스턴스별 JSON 데이터 영속화. 재시작 시 자동 복원, 각 turn 후 자동 저장. |
| `events` | 경량 프로세스 내 이벤트 버스. Extension이 서로 결합하지 않고 `turn.completed`, `step.started` 등에 반응 가능. |
| `logger` | 구조화 로그로 라우팅되는 표준 `Console` 인터페이스. |

Extension 로직의 대부분은 `pipeline` API에 집중됩니다. 이후 섹션에서 이를 집중적으로 다룹니다.

> 상세 인터페이스 시그니처는 [Extension API 레퍼런스](../reference/extension-api.ko.md)를 참조하세요.

---

## 미들웨어 파이프라인 (Onion 모델)

### 세 가지 미들웨어 계층

Goondan의 파이프라인은 정확히 세 가지 미들웨어 타입을 제공합니다. 각각은 에이전트 실행 라이프사이클의 서로 다른 세분화 수준에 대응합니다:

| 미들웨어 | 감싸는 범위 | 대표적 용도 |
|----------|-----------|------------|
| **`turn`** | 전체 대화 턴 (하나의 인바운드 이벤트부터 완료까지) | 메시지 압축, 대화 윈도잉, 턴 수준 메트릭, `ctx.agents` 기반 전/후처리 호출 |
| **`step`** | 단일 LLM 호출과 후속 도구 실행 | 도구 카탈로그 필터링, 컨텍스트 주입, step 타이밍, `ctx.agents` 기반 위임 호출 |
| **`toolCall`** | 개별 도구 호출 하나 | 인자 검증/변환, 도구별 로깅 |

이 세 계층은 **중첩 관계**입니다: turn은 여러 step을 포함하고, step은 여러 tool call을 포함할 수 있습니다.

### Onion 모델

각 미들웨어는 **양파(onion) 패턴**을 따릅니다: `next()` 함수가 포함된 컨텍스트 객체를 받습니다. `next()` 호출 전은 전처리(pre), `next()` 호출 후는 후처리(post)입니다. 먼저 등록된 미들웨어가 바깥 레이어를 형성합니다.

```text
  요청이 바깥에서 진입
         |
         v
  +-------------------------------+
  | Extension A  (1번째 등록)      |  <-- 가장 바깥 레이어
  |   전처리                       |
  |   +--------------------------+|
  |   | Extension B  (2번째 등록)||
  |   |   전처리                 ||
  |   |   +--------------------+||
  |   |   |  코어 런타임        |||  <-- 가장 안쪽: 실제 실행
  |   |   |  로직              |||
  |   |   +--------------------+||
  |   |   후처리                ||
  |   +--------------------------+|
  |   후처리                      |
  +-------------------------------+
         |
         v
  결과가 호출자에게 반환
```

logging과 compaction을 사용한 구체적 예시:

```text
  수신 AgentEvent
         |
         v
  +---------------------------------------+
  | logging.turn.pre  ("turn 시작" 로깅)   |
  |  +-----------------------------------+|
  |  | compaction.turn.pre (메시지 압축) ||
  |  |  +-------------------------------+||
  |  |  | [코어 Turn 로직]              |||
  |  |  |  Step 0..N                    |||
  |  |  +-------------------------------+||
  |  | compaction.turn.post             ||
  |  +-----------------------------------+|
  | logging.turn.post ("turn 종료" 로깅)   |
  +---------------------------------------+
         |
         v
  TurnResult
```

규칙은 간단합니다: **`Agent.spec.extensions`에서 먼저 나열된 Extension이 가장 바깥 레이어가 됩니다**. 전처리가 가장 먼저 실행되고, 후처리가 가장 나중에 실행됩니다.

### 중첩 실행: turn > step > toolCall

세 가지 미들웨어 타입은 실행 중에 서로 중첩됩니다:

```text
Turn 미들웨어 체인
  |-- turn.pre (모든 turn 미들웨어, onion 순서)
  |-- [코어 Turn: Step 루프 0..N]
  |     |
  |     +-- Step 미들웨어 체인
  |           |-- step.pre (모든 step 미들웨어, onion 순서)
  |           |-- [코어 Step: LLM 호출]
  |           |-- [ToolCall 루프 0..M]
  |           |     |
  |           |     +-- ToolCall 미들웨어 체인
  |           |           |-- toolCall.pre (모든 toolCall 미들웨어)
  |           |           |-- [코어: 도구 핸들러 실행]
  |           |           +-- toolCall.post (모든 toolCall 미들웨어)
  |           |
  |           +-- step.post (모든 step 미들웨어, onion 순서)
  |
  +-- turn.post (모든 turn 미들웨어, onion 순서)
```

각 계층은 해당 범위에 관련된 필드를 가진 전용 컨텍스트를 제공합니다:

- **`turn` 컨텍스트** -- `conversationState`, `emitMessageEvent()`, `inputEvent`, `metadata`
- **`step` 컨텍스트** -- turn의 모든 것 + `stepIndex`, `toolCatalog` (변경 가능)
- **`toolCall` 컨텍스트** -- `toolName`, `toolCallId`, `args` (변경 가능), `metadata`
- **`turn`/`step` 추가 표면** -- `ctx.agents.request/send`로 프로그래매틱 에이전트 호출 (`toolCall`에는 없음)

### 왜 하나가 아닌 세 개의 계층인가?

단일 "before/after" 훅이 있다면 모든 Extension이 지금 실행의 어떤 단계에 있는지를 직접 파악해야 합니다. 세 개의 명시적 계층으로 분리함으로써:

- **Compaction**은 `turn` 미들웨어만 등록하면 됩니다 -- 전체 메시지 히스토리를 turn당 한 번 처리합니다.
- **도구 필터링**은 `step` 미들웨어만 등록하면 됩니다 -- 각 LLM 호출 전에 도구 카탈로그를 조정합니다.
- **인자 검사**는 `toolCall` 미들웨어만 등록하면 됩니다 -- 도구 호출마다 실행됩니다.

이 분리는 각 Extension이 자기 관심사에 집중하게 하고, 관심사 간의 우발적 간섭을 방지합니다.

---

## ConversationState와 이벤트 소싱

### 문제

에이전트의 대화는 메시지 목록입니다. 동일한 turn에서 여러 Extension이 이 목록을 조작하려 할 수 있습니다 -- 하나는 오래된 메시지를 제거하고(compaction), 다른 하나는 컨텍스트를 주입하고(skills), 또 다른 하나는 중요한 메시지를 고정(pin)할 수 있습니다. 모두가 같은 배열을 직접 변경하면 실행 순서에 따른 버그가 불가피합니다.

### 해결책: 이벤트 소싱

Goondan은 메시지 관리에 **이벤트 소싱** 모델을 사용합니다:

```text
NextMessages = BaseMessages + SUM(Events)
```

- **`baseMessages`** -- turn 시작 시점의 메시지 스냅샷 (디스크에서 로드)
- **`events`** -- turn 동안 발행된 `MessageEvent` 객체의 순서 보장 목록
- **`nextMessages`** -- 모든 이벤트를 base에 적용한 계산된 결과

Extension은 `nextMessages`를 직접 수정하지 않습니다. 대신 `ctx.emitMessageEvent()`를 호출해 이벤트를 발행합니다:

```typescript
// 새 시스템 메시지 추가
ctx.emitMessageEvent({
  type: 'append',
  message: createSystemMessage('스킬 확장의 컨텍스트'),
});

// ID로 오래된 메시지 제거
ctx.emitMessageEvent({
  type: 'remove',
  targetId: oldMessage.id,
});
```

사용 가능한 이벤트 타입:

| 이벤트 타입 | 효과 |
|------------|------|
| `append` | 목록 끝에 메시지 추가 |
| `replace` | `targetId`로 식별된 메시지 교체 |
| `remove` | `targetId`로 식별된 메시지 제거 |
| `truncate` | 모든 메시지 초기화 |

turn이 끝나면 런타임은 모든 이벤트를 새 base 스냅샷으로 **폴드(fold)** 하고 영속화합니다. 이는 다음을 의미합니다:

- 모든 Extension의 이벤트가 미들웨어 순서와 무관하게 예측 가능하게 합성됨
- 전체 이벤트 히스토리가 디버깅과 감사에 사용 가능
- 대화 상태가 turn 중 어느 시점에서든 `base + events`로 재구성 가능

---

## PipelineRegistry: 미들웨어 연결 방법

Extension은 `api.pipeline.register()`를 통해 미들웨어를 등록합니다:

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn', async (ctx) => {
    // 전처리
    const result = await ctx.next();
    // 후처리
    return result;
  });

  api.pipeline.register('step', async (ctx) => {
    ctx.toolCatalog = ctx.toolCatalog.filter(t => !isDisabled(t));
    return ctx.next();
  });

  api.pipeline.register('toolCall', async (ctx) => {
    const start = Date.now();
    const result = await ctx.next();
    api.logger.debug(`${ctx.toolName}: ${Date.now() - start}ms`);
    return result;
  });
}
```

**핵심 규칙:**

1. `ctx.next()`를 **반드시** 정확히 한 번 호출해야 합니다. 건너뛰면 코어 로직(및 모든 내부 미들웨어)이 실행되지 않습니다.
2. `next()`가 반환한 결과를 변환해서 반환할 수 **있습니다**.
3. 동일한 미들웨어 타입을 등록하는 여러 Extension은 onion 순서로 체이닝됩니다 (먼저 등록 = 바깥).
4. 하나의 Extension이 여러 미들웨어 타입을 등록하거나, 같은 타입의 미들웨어를 여러 개 등록할 수 있습니다.
5. `ctx.agents`는 `turn`, `step` 컨텍스트에서만 제공됩니다.

### Priority

기본적으로 미들웨어 순서는 `Agent.spec.extensions` 배열 순서를 따릅니다. 세밀한 제어를 위해 선택적으로 `priority`를 지정할 수 있습니다:

```typescript
api.pipeline.register('step', myMiddleware, { priority: 10 });
```

낮은 priority 값이 바깥 레이어가 됩니다. 동일 priority 내에서는 등록 순서가 보존됩니다 (안정 정렬).

---

## Agent별 Extension 로드

Extension은 전역이 아닌 **에이전트 인스턴스별로** 로드됩니다. 각 Agent가 자신만의 목록을 선언합니다:

```yaml
# Agent A -- logging + compaction 사용
kind: Agent
metadata:
  name: coordinator
spec:
  extensions:
    - ref: "Extension/logging"
    - ref: "Extension/message-compaction"

# Agent B -- logging + skills 사용 (compaction 없음)
kind: Agent
metadata:
  name: researcher
spec:
  extensions:
    - ref: "Extension/logging"
    - ref: "Extension/skills"
```

이는 다음을 의미합니다:

- `coordinator` 에이전트에는 compaction 동작이 있지만 `researcher`에는 없습니다.
- 둘 다 `logging`을 공유하지만, 각 에이전트의 인스턴스는 격리된 상태로 자체 복사본을 실행합니다.
- Extension 상태(`api.state`)는 각 `instanceKey`로 범위가 지정되므로, `coordinator:user-1`과 `coordinator:user-2`는 같은 Extension을 사용하더라도 독립적인 상태를 가집니다.

---

## 실전 Extension 패턴

다음 패턴은 파이프라인과 ExtensionApi가 합성되어 일반적인 문제를 해결하는 방법을 보여줍니다. 각각 개념 수준에서 설명하며, 전체 구현 예제는 스펙 문서를 참조하세요.

### 로깅 / 관찰성

`step`과 `toolCall` 미들웨어를 등록하여 타이밍 측정, 입출력 로깅, 메트릭 추적을 수행합니다. Onion 모델은 자연스럽게 전처리/후처리 타이밍을 제공합니다:

```typescript
api.pipeline.register('step', async (ctx) => {
  const start = Date.now();
  const result = await ctx.next();
  api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
  return result;
});
```

### 메시지 압축 (Compaction)

`turn` 미들웨어를 등록하여 `conversationState.nextMessages`를 검사하고 `remove` + `append` 이벤트를 발행해 오래된 메시지를 요약으로 교체합니다. 고정(pin)된 메시지는 메타데이터 확인을 통해 보존됩니다.

### 메시지 윈도우

Compaction의 단순 변형: `turn` 미들웨어가 한도를 초과하는 가장 오래된 메시지에 대해 `remove` 이벤트를 발행하여 최대 메시지 수를 강제합니다.

### 스킬 주입

`api.tools.register()`로 스킬 디스커버리용 동적 도구(예: `skills__list`, `skills__open`)를 등록한 뒤, `step` 미들웨어에서 `emitMessageEvent()`를 통해 활성 스킬 컨텍스트를 대화에 주입합니다.

### 도구 검색 / 필터링

LLM이 필요한 도구를 선택하는 메타 도구(`tool-search__search`)를 등록합니다. `api.state`로 선택 결과를 저장한 뒤, `step` 미들웨어에서 `ctx.toolCatalog`를 필터링하여 적용합니다.

### MCP 통합

Extension 초기화 시 MCP 서버의 도구를 `api.tools.register()`로 동적 등록합니다. Extension이 MCP 클라이언트 연결 라이프사이클을 내부적으로 관리하고, 프로세스 종료 시 정리합니다.

---

## 요약

| 개념 | 핵심 포인트 |
|------|-----------|
| Extension 리소스 | 최소 YAML (`entry` + 선택적 `config`); Agent 참조로 활성화 |
| `register(api)` | 단일 진입점; AgentProcess 초기화 시 한 번 호출 |
| ExtensionApi | 5개 영역: `pipeline`, `tools`, `state`, `events`, `logger` |
| 미들웨어 타입 | `turn` (전체 대화 턴), `step` (LLM 호출 단위), `toolCall` (단일 도구 호출) |
| 미들웨어 에이전트 호출 | `ctx.agents.request/send`은 `turn`/`step`에서만 제공되고 Orchestrator IPC를 재사용 |
| Onion 모델 | 먼저 등록 = 바깥; `next()`가 전처리/후처리 분리; `next()` 반드시 한 번 호출 |
| ConversationState | 이벤트 소싱: `NextMessages = BaseMessages + SUM(Events)`; 직접 변경 금지 |
| Agent별 로드 | 각 Agent가 자신만의 Extension 목록 선언; 상태는 인스턴스별 격리 |

---

## 더 읽을거리

- [Extension API 레퍼런스](../reference/extension-api.ko.md) -- 상세 `ExtensionApi` 인터페이스 시그니처
- [Extension 작성하기 (How-to)](../how-to/write-an-extension.ko.md) -- 프로덕션 확장 작성 실용 체크리스트
- [첫 Extension 만들기 (튜토리얼)](../tutorials/03-build-your-first-extension.ko.md) -- 단계별 안내 워크스루
- [핵심 개념](./core-concepts.ko.md) -- 리소스 Kind, ObjectRef, instanceKey
- [런타임 모델](./runtime-model.ko.md) -- Orchestrator, Process-per-Agent, IPC

---

_문서 버전: v0.0.3_
