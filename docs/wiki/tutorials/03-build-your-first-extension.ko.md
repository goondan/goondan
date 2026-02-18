# 첫 Extension 만들기

> **만들 것**: 대화 통계를 추적하고, step 타이밍을 로깅하며, 영속 상태를 저장하는 대화 로깅 Extension
>
> **소요 시간**: 약 30분
>
> **사전 준비**: 동작하는 Goondan 프로젝트 ([시작하기](./01-getting-started.ko.md)를 먼저 완료하세요)

[English version](./03-build-your-first-extension.md)

---

## 배울 내용

이 튜토리얼을 마치면 다음을 완성하게 됩니다:

1. YAML로 Extension 리소스 정의
2. `register(api)` 엔트리 포인트 구현
3. 전체 대화 턴을 감싸는 `turn` 미들웨어 작성
4. state API로 통계를 영속 저장하여 재시작 시에도 유지
5. `step`과 `toolCall` 미들웨어 추가로 세밀한 제어
6. Agent에 Extension을 등록하고 동작 확인

---

## 1단계: Extension이 하는 일 이해하기

코드를 작성하기 전에 **Tool**과 **Extension**의 차이를 명확히 합시다:

| | Tool | Extension |
|--|------|-----------|
| **누가 호출하나** | LLM이 필요할 때 직접 호출 | 런타임이 매 turn/step/tool call마다 자동으로 호출 |
| **목적** | LLM에게 수행할 액션 제공 | *개발자*에게 런타임 라이프사이클 제어 권한 제공 |
| **예시** | HTTP 요청, 데이터베이스 쿼리, 파일 쓰기 | 로깅, 메시지 압축, 도구 필터링, 사용량 추적 |

Extension은 런타임 실행을 감싸는 **미들웨어**를 등록합니다. Express나 Koa 미들웨어와 동일한 패턴입니다 -- 코어 로직 전후에 코드가 실행되며, `next()`를 호출해 진행합니다.

> 전체 개념 모델은 [Extension 파이프라인 (설명)](../explanation/extension-pipeline.ko.md)을 참조하세요.

---

## 2단계: Extension 설계하기

**conversation-stats** Extension을 만들겠습니다. 기능:

- 전체 turn 수를 세고 각 turn의 타임스탬프를 추적
- 각 step(LLM 호출)의 소요 시간 측정
- 도구 호출 이름과 결과를 로깅
- 모든 통계를 디스크에 영속 저장하여 재시작 후에도 유지

5가지 `ExtensionApi` 영역 중 3가지를 사용합니다:

| 영역 | 사용 방법 |
|------|----------|
| `pipeline` | `turn`, `step`, `toolCall` 미들웨어 등록 |
| `state` | turn 횟수 및 타이밍 데이터 영속 저장 |
| `logger` | 구조화된 로그 출력 |

---

## 3단계: YAML로 Extension 리소스 정의

`goondan.yaml`을 열고 다음 Extension 리소스를 추가합니다. 파일에 이미 다른 리소스(Package, Model, Agent, Swarm 등)가 있다면 `---`로 구분된 새 YAML 문서로 추가합니다.

```yaml
---
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: conversation-stats
spec:
  entry: "./extensions/conversation-stats/index.ts"
```

이게 전부입니다. Extension 리소스는 최소한의 구성만 필요합니다 -- `name`과 TypeScript 모듈을 가리키는 `entry`만 있으면 됩니다.

**각 필드의 의미:**

| 필드 | 값 | 목적 |
|------|---|------|
| `apiVersion` | `goondan.ai/v1` | 모든 Goondan 리소스에 필수 |
| `kind` | `Extension` | 이 리소스가 Extension임을 식별 |
| `metadata.name` | `conversation-stats` | 번들 내 고유 이름 -- 이 Extension을 참조할 때 사용 |
| `spec.entry` | `./extensions/conversation-stats/index.ts` | 프로젝트 루트 기준 엔트리 모듈 경로 |

> 전체 Extension 스키마는 [리소스 레퍼런스](../reference/resources.ko.md#extension)를 참조하세요.

---

## 4단계: `register(api)` 구현

선언한 경로에 엔트리 모듈을 생성합니다. 모든 Extension은 **반드시** `register`라는 이름의 함수를 export해야 합니다.

```bash
mkdir -p extensions/conversation-stats
```

다음 내용으로 `extensions/conversation-stats/index.ts`를 생성합니다:

```typescript
// extensions/conversation-stats/index.ts
import type { ExtensionApi } from '@goondan/types';

export function register(api: ExtensionApi): void {
  api.logger.info('[conversation-stats] Extension loaded');
}
```

이것이 최소한의 Extension입니다 -- 로드되어 메시지를 로깅하지만, 아직 다른 동작은 없습니다. 미들웨어를 추가하기 전에 먼저 이것이 동작하는지 확인합시다.

**런타임에서 일어나는 일:**

1. AgentProcess가 Extension 모듈을 로드
2. `register(api)`를 호출하고 반환을 대기
3. `register()`가 예외를 던지면 AgentProcess 시작 실패 (fail-fast)
4. Extension은 Agent의 `spec.extensions` 배열 순서대로 로드

> `register(api)` 계약 전체는 [Extension API 레퍼런스 -- 엔트리 모듈](../reference/extension-api.ko.md#entry-module)을 참조하세요.

---

## 5단계: turn 미들웨어 작성

이제 첫 번째 실제 로직을 추가합니다 -- turn 수를 세고 타이밍을 로깅하는 `turn` 미들웨어입니다.

`extensions/conversation-stats/index.ts`를 업데이트합니다:

```typescript
// extensions/conversation-stats/index.ts
import type { ExtensionApi } from '@goondan/types';

interface ConversationStats {
  totalTurns: number;
  lastTurnAt: number;
  totalDurationMs: number;
}

export function register(api: ExtensionApi): void {
  // turn 미들웨어 등록
  api.pipeline.register('turn', async (ctx) => {
    const startTime = Date.now();

    // 전처리: turn 실행 전에 실행
    api.logger.info(
      `[conversation-stats] Turn 시작: ${ctx.agentName} ` +
      `(인스턴스: ${ctx.instanceKey})`
    );

    // next()를 호출하여 실제 turn 실행 (및 내부 미들웨어)
    const result = await ctx.next();

    // 후처리: turn 완료 후에 실행
    const duration = Date.now() - startTime;
    api.logger.info(
      `[conversation-stats] Turn 완료: ${duration}ms ` +
      `(종료 사유: ${result.finishReason})`
    );

    // 현재 상태 읽기 (첫 실행 시 null)
    const raw = await api.state.get();
    const stats: ConversationStats = raw
      ? (raw as ConversationStats)
      : { totalTurns: 0, lastTurnAt: 0, totalDurationMs: 0 };

    // 통계 업데이트
    stats.totalTurns += 1;
    stats.lastTurnAt = Date.now();
    stats.totalDurationMs += duration;

    // 업데이트된 상태 영속화
    await api.state.set(stats);

    api.logger.info(
      `[conversation-stats] 누적: ${stats.totalTurns}회, ` +
      `평균 소요: ${Math.round(stats.totalDurationMs / stats.totalTurns)}ms`
    );

    // 항상 next()의 결과를 반환
    return result;
  });

  api.logger.info('[conversation-stats] Extension loaded');
}
```

**turn 미들웨어 동작 방식:**

```text
미들웨어
  |
  |-- 전처리: "Turn 시작..." 로깅
  |
  |-- ctx.next()  ---------> [코어 Turn 로직: Step 루프, LLM 호출, 도구 실행]
  |
  |-- 후처리: 타이밍 로깅, 상태 업데이트, 영속화
  |
  v
결과 반환
```

**핵심 포인트:**

- `ctx.next()`는 **정확히 한 번** 호출해야 합니다. 내부 미들웨어 레이어와 코어 turn 로직을 실행합니다.
- `ctx.next()` 전의 코드가 **전처리** (turn 실행 전에 동작).
- `ctx.next()` 후의 코드가 **후처리** (turn 완료 후에 동작).
- `ctx.agentName`과 `ctx.instanceKey`로 실행 중인 에이전트 인스턴스를 식별합니다.
- `result.finishReason`으로 turn 종료 사유를 알 수 있습니다 (`'text_response'`, `'max_steps'`, `'error'`).

---

## 6단계: state API로 영속 저장

5단계에서 이미 `api.state.get()`과 `api.state.set()`을 사용했습니다. 자세히 살펴봅시다.

### state 동작 방식

```text
                   Turn 시작
                       |
                       v
   +-- api.state.get()으로 이전에 저장된 JSON 반환 (첫 실행 시 null)
   |
   |   ... 미들웨어 실행 ...
   |
   +-- api.state.set(newState)으로 메모리 상의 상태 업데이트
                       |
                       v
                   Turn 종료
                       |
                       v
   AgentProcess가 자동으로 상태를 디스크에 영속화
```

**저장 위치:**

```text
~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/extensions/conversation-stats.json
```

**기억할 규칙:**

- 상태는 **인스턴스별** -- 다른 `instanceKey`는 독립적인 상태를 가집니다.
- AgentProcess 시작 시 **자동 복원**됩니다.
- 각 turn 종료 시 **자동 영속화**됩니다.
- 상태는 **JSON 직렬화 가능**해야 합니다 (함수, Symbol, 순환 참조 불가).
- `api.state.get()`은 아직 저장된 상태가 없으면 `null`을 반환합니다 -- 항상 이 경우를 처리하세요.

**3회 turn 후 예상 결과:**

```json
{
  "totalTurns": 3,
  "lastTurnAt": 1708300000000,
  "totalDurationMs": 4523
}
```

> state API 상세는 [Extension API 레퍼런스 -- ExtensionStateApi](../reference/extension-api.ko.md#3-state----extensionstateapi)를 참조하세요.

---

## 7단계: Agent에 Extension 등록

Extension은 Agent가 참조해야만 실행됩니다. `goondan.yaml`에서 Agent 리소스를 찾고 `spec.extensions`에 Extension을 추가합니다:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  model:
    ref: "Model/claude-sonnet"
  tools:
    - ref: "Tool/bash"
  extensions:
    - ref: "Extension/conversation-stats"    # 이 줄을 추가
```

**`ref` 형식은 `Extension/<metadata.name>`입니다.**

여러 Extension이 있으면 **순서가 중요합니다** -- 배열의 첫 번째 Extension이 가장 바깥 미들웨어 레이어가 됩니다:

```yaml
  extensions:
    - ref: "Extension/conversation-stats"    # 1번째: 가장 바깥 (먼저/마지막에 실행)
    - ref: "Extension/logging"               # 2번째: 중간 레이어
    - ref: "Extension/skills"                # 3번째: 가장 안쪽 (코어에 가장 가까움)
```

> Onion 모델에 대한 자세한 내용은 [Extension 파이프라인 -- Onion 모델](../explanation/extension-pipeline.ko.md#the-onion-model)을 참조하세요.

---

## 8단계: 검증 및 실행

### 번들 검증

```bash
gdn validate
```

예상 출력:

```text
Validation passed.
```

`E_BUNDLE_ENTRY_NOT_FOUND` 같은 오류가 발생하면 확인하세요:
- `spec.entry` 경로가 프로젝트 루트 기준으로 올바른지
- `extensions/conversation-stats/index.ts` 파일이 존재하는지

### 스웜 실행

```bash
gdn run
```

에이전트에 메시지를 보냅니다 (CLI, Telegram, Slack 또는 구성된 Connector를 통해). 로그에서 다음과 같은 출력을 확인할 수 있습니다:

```text
[conversation-stats] Extension loaded
[conversation-stats] Turn 시작: assistant (인스턴스: default)
[conversation-stats] Turn 완료: 1523ms (종료 사유: text_response)
[conversation-stats] 누적: 1회, 평균 소요: 1523ms
```

두 번째 메시지를 보내면 turn 횟수가 증가합니다:

```text
[conversation-stats] Turn 시작: assistant (인스턴스: default)
[conversation-stats] Turn 완료: 987ms (종료 사유: text_response)
[conversation-stats] 누적: 2회, 평균 소요: 1255ms
```

영속화된 상태 파일도 확인할 수 있습니다:

```bash
cat ~/.goondan/workspaces/*/instances/*/extensions/conversation-stats.json
```

---

## 9단계: step과 toolCall 미들웨어 추가

이제 더 세밀한 미들웨어를 추가합니다. turn은 여러 **step**(각 step은 LLM 호출 1회)을 포함하고, 각 step은 여러 **도구 호출**을 트리거할 수 있습니다.

step과 toolCall 미들웨어를 추가하도록 Extension을 업데이트합니다:

```typescript
// extensions/conversation-stats/index.ts
import type { ExtensionApi } from '@goondan/types';

interface ConversationStats {
  totalTurns: number;
  totalSteps: number;
  totalToolCalls: number;
  lastTurnAt: number;
  totalDurationMs: number;
}

export function register(api: ExtensionApi): void {
  // 1. TURN 미들웨어: turn 추적 및 상태 영속화
  api.pipeline.register('turn', async (ctx) => {
    const startTime = Date.now();

    api.logger.info(
      `[conversation-stats] Turn 시작: ${ctx.agentName} ` +
      `(대화 기록 ${ctx.conversationState.nextMessages.length}개 메시지)`
    );

    const result = await ctx.next();

    const duration = Date.now() - startTime;

    // 영속 상태 읽기 및 업데이트
    const raw = await api.state.get();
    const stats: ConversationStats = raw
      ? (raw as ConversationStats)
      : { totalTurns: 0, totalSteps: 0, totalToolCalls: 0, lastTurnAt: 0, totalDurationMs: 0 };

    stats.totalTurns += 1;
    stats.lastTurnAt = Date.now();
    stats.totalDurationMs += duration;

    await api.state.set(stats);

    api.logger.info(
      `[conversation-stats] Turn 완료: ${duration}ms | ` +
      `누적: ${stats.totalTurns} turns, ${stats.totalSteps} steps, ` +
      `${stats.totalToolCalls} tool calls`
    );

    return result;
  });

  // 2. STEP 미들웨어: step 수 및 타이밍 추적
  api.pipeline.register('step', async (ctx) => {
    const startTime = Date.now();

    api.logger.info(
      `[conversation-stats] Step ${ctx.stepIndex} 시작 ` +
      `(${ctx.toolCatalog.length}개 도구 사용 가능)`
    );

    const result = await ctx.next();

    const duration = Date.now() - startTime;

    // 상태에서 step 수 증가
    const raw = await api.state.get();
    if (raw) {
      const stats = raw as ConversationStats;
      stats.totalSteps += 1;
      await api.state.set(stats);
    }

    api.logger.info(
      `[conversation-stats] Step ${ctx.stepIndex} 완료: ${duration}ms ` +
      `(${result.toolCalls.length}개 도구 호출)`
    );

    return result;
  });

  // 3. TOOLCALL 미들웨어: 도구 사용 추적
  api.pipeline.register('toolCall', async (ctx) => {
    const startTime = Date.now();

    api.logger.info(
      `[conversation-stats] 도구 호출: ${ctx.toolName} (id: ${ctx.toolCallId})`
    );

    const result = await ctx.next();

    const duration = Date.now() - startTime;

    // 상태에서 도구 호출 수 증가
    const raw = await api.state.get();
    if (raw) {
      const stats = raw as ConversationStats;
      stats.totalToolCalls += 1;
      await api.state.set(stats);
    }

    api.logger.info(
      `[conversation-stats] 도구 ${ctx.toolName}: ${result.status} (${duration}ms)`
    );

    return result;
  });

  api.logger.info('[conversation-stats] Extension loaded: turn, step, toolCall 미들웨어 등록 완료');
}
```

**실행 중첩 구조는 다음과 같습니다:**

```text
[Turn 미들웨어]
  |-- turn.전처리: "Turn 시작..."
  |
  |-- [Step 0]
  |     |-- step.전처리: "Step 0 시작 (5개 도구 사용 가능)"
  |     |-- [코어 LLM 호출]
  |     |-- [도구 호출: bash__exec]
  |     |     |-- toolCall.전처리: "도구 호출: bash__exec"
  |     |     |-- [코어: bash 실행]
  |     |     +-- toolCall.후처리: "도구 bash__exec: ok (234ms)"
  |     |-- [도구 호출: file-system__read]
  |     |     |-- toolCall.전처리: "도구 호출: file-system__read"
  |     |     |-- [코어: 파일 읽기 실행]
  |     |     +-- toolCall.후처리: "도구 file-system__read: ok (12ms)"
  |     +-- step.후처리: "Step 0 완료: 1823ms (2개 도구 호출)"
  |
  |-- [Step 1]
  |     |-- step.전처리: "Step 1 시작..."
  |     |-- [코어 LLM 호출 -- 이번에는 도구 호출 없음]
  |     +-- step.후처리: "Step 1 완료: 456ms (0개 도구 호출)"
  |
  +-- turn.후처리: "Turn 완료: 2279ms | 누적: 1 turns, 2 steps, 2 tool calls"
```

**각 미들웨어 수준의 주요 컨텍스트 필드:**

| 미들웨어 | 주요 컨텍스트 필드 | 변경 가능 필드 |
|---------|-------------------|---------------|
| `turn` | `agentName`, `instanceKey`, `conversationState`, `inputEvent` | `metadata` |
| `step` | turn의 모든 것 + `stepIndex`, `turn` | `toolCatalog`, `metadata` |
| `toolCall` | `stepIndex`, `toolName`, `toolCallId` | `args`, `metadata` |

> 컨텍스트 인터페이스 상세는 [Extension API 레퍼런스 -- PipelineRegistry](../reference/extension-api.ko.md#1-pipeline----pipelineregistry)를 참조하세요.

---

## 10단계: 완성된 Extension 실행 및 확인

스웜을 다시 실행하고 도구 호출을 트리거하는 메시지를 보냅니다 (예: 에이전트에게 명령 실행이나 파일 읽기를 요청):

```bash
gdn run
```

**예상 로그 출력:**

```text
[conversation-stats] Extension loaded: turn, step, toolCall 미들웨어 등록 완료
[conversation-stats] Turn 시작: assistant (대화 기록 3개 메시지)
[conversation-stats] Step 0 시작 (5개 도구 사용 가능)
[conversation-stats] 도구 호출: bash__exec (id: call_abc123)
[conversation-stats] 도구 bash__exec: ok (342ms)
[conversation-stats] Step 0 완료: 1845ms (1개 도구 호출)
[conversation-stats] Step 1 시작 (5개 도구 사용 가능)
[conversation-stats] Step 1 완료: 623ms (0개 도구 호출)
[conversation-stats] Turn 완료: 2468ms | 누적: 1 turns, 2 steps, 1 tool calls
```

**영속화된 상태 확인:**

```bash
cat ~/.goondan/workspaces/*/instances/*/extensions/conversation-stats.json
```

```json
{
  "totalTurns": 1,
  "totalSteps": 2,
  "totalToolCalls": 1,
  "lastTurnAt": 1708300000000,
  "totalDurationMs": 2468
}
```

스웜을 중지하고 재시작합니다. 다시 메시지를 보내면 카운트가 이전에서 이어집니다. 이것이 상태 영속화가 동작하는 증거입니다:

```text
[conversation-stats] Turn 완료: 1234ms | 누적: 2 turns, 4 steps, 2 tool calls
```

---

## 완성된 프로젝트 구조

이 시점에서 프로젝트는 다음과 같아야 합니다:

```text
my-project/
  goondan.yaml              # Package + Model + Agent + Swarm + Extension 리소스
  extensions/
    conversation-stats/
      index.ts              # Extension 엔트리 모듈
  .env                      # API 키 (ANTHROPIC_API_KEY 등)
```

`goondan.yaml`의 관련 부분:

```yaml
# Extension 리소스
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: conversation-stats
spec:
  entry: "./extensions/conversation-stats/index.ts"
---
# Agent 리소스 (Extension 등록됨)
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  model:
    ref: "Model/claude-sonnet"
  tools:
    - ref: "Tool/bash"
  extensions:
    - ref: "Extension/conversation-stats"
```

---

## 배운 내용 정리

| 개념 | 수행한 작업 |
|------|-----------|
| Extension 리소스 | `kind: Extension`을 정의하고 `spec.entry`로 TypeScript 모듈 지정 |
| `register(api)` | `ExtensionApi`를 받는 named function export |
| Turn 미들웨어 | `api.pipeline.register('turn', ...)`로 전체 turn에 전처리/후처리 적용 |
| State API | `api.state.get()`과 `api.state.set()`으로 통계 영속 저장 |
| Step 미들웨어 | `api.pipeline.register('step', ...)`로 개별 LLM 호출 타이밍 추적 |
| ToolCall 미들웨어 | `api.pipeline.register('toolCall', ...)`로 각 도구 호출 로깅 |
| Agent 등록 | `Agent.spec.extensions`에 `ref: "Extension/conversation-stats"` 추가 |
| 검증 | `gdn validate`로 번들 검증 후 `gdn run`으로 테스트 |

---

## 다음 단계

Extension을 만드는 방법을 알게 되었으니, 다음 방향을 탐색해 보세요:

### Extension 심화

- **동적 도구 추가** -- `api.tools.register()`로 `conversation-stats__report` 도구를 등록하여 LLM이 통계를 조회할 수 있게 합니다. [Extension API 레퍼런스 -- ExtensionToolsApi](../reference/extension-api.ko.md#2-tools----extensiontoolsapi)를 참조하세요.
- **이벤트 소싱 활용** -- `ctx.emitMessageEvent()`로 대화 메시지를 조작합니다 (예: 과거 turn 요약 주입). [Extension 파이프라인 -- ConversationState와 이벤트 소싱](../explanation/extension-pipeline.ko.md#conversationstate와-이벤트-소싱)을 참조하세요.
- **이벤트 구독** -- `api.events.on('turn.completed', ...)`으로 런타임 이벤트에 반응합니다. [Extension API 레퍼런스 -- ExtensionEventsApi](../reference/extension-api.ko.md#4-events----extensioneventsapi)를 참조하세요.

### 프로덕션 패턴

- [Extension 작성하기 (How-to)](../how-to/write-an-extension.ko.md) -- 프로덕션 품질 Extension을 위한 종합 체크리스트
- [Extension API 레퍼런스](../reference/extension-api.ko.md) -- 전체 API 인터페이스 문서
- [Extension 파이프라인 (설명)](../explanation/extension-pipeline.ko.md) -- 미들웨어 아키텍처와 Onion 모델 심층 탐구

### Connector 만들기

- [Connector 작성하기 (How-to)](../how-to/write-a-connector.ko.md) -- 외부 프로토콜(HTTP, WebSocket, 폴링)을 스웜에 연결

### 멀티 에이전트 패턴 탐색

- [멀티 에이전트 패턴](../how-to/multi-agent-patterns.ko.md) -- request/send/spawn으로 여러 에이전트 조율

---

_튜토리얼 버전: v0.0.3_
