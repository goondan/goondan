# Goondan Extension 시스템 스펙 (v0.0.3)

> 공통 타입(`ExecutionContext`, `TurnResult`, `ConversationState`, `MessageEvent`, `ToolCallResult`)은 `docs/specs/shared-types.md`를 기준으로 한다.

---

## 1. 개요

### 1.1 배경 및 설계 동기

Extension은 런타임 라이프사이클에 개입하는 미들웨어 로직 묶음이다. Extension은 파이프라인을 통해 도구 카탈로그, 메시지 히스토리, LLM 호출, tool call 실행을 제어할 수 있다. 또한 `turn`/`step` 미들웨어에서는 `ctx.agents` API로 다른 Agent를 프로그래매틱하게 호출할 수 있다. Extension은 Tool과 달리 LLM이 직접 호출하지 않으며, AgentProcess 내부에서 자동으로 실행된다.

`ExtensionApi` 표면은 **5개 핵심 API**(`pipeline`, `tools`, `state`, `events`, `logger`)로 구성된다. OAuth/설정 갱신 같은 도메인 기능은 Extension 내부에서 구현하며, 파이프라인 훅은 Middleware 형태(`docs/specs/pipeline.md`)를 따른다.
메시지 windowing/compaction 같은 정책은 Runtime 코어가 아닌 Extension에서 선택적으로 제공한다.

## 2. 핵심 규칙

Extension 시스템에 공통으로 적용되는 규범적 규칙이다.

### 2.1 엔트리포인트 규칙

1. Extension 구현은 `register(api)` 함수를 내보내야 한다(MUST).
2. AgentProcess는 초기화 시 Agent에 선언된 Extension 목록 순서대로 `register(api)`를 호출해야 한다(MUST).
3. `register()` 중 발생한 예외는 AgentProcess 초기화 실패로 처리해야 한다(MUST).
4. 이전 Extension의 `register()` 완료 후 다음 Extension의 `register()`를 호출해야 한다(MUST).
5. 코어 API 부재로 Extension이 초기화 실패하는 상황이 없어야 한다(MUST).

### 2.2 API 규칙

1. 미들웨어 등록은 `api.pipeline.register(type, middlewareFn)` 형태를 사용해야 한다(MUST).
2. 미들웨어 타입은 `'turn'`, `'step'`, `'toolCall'` 세 가지만 허용해야 한다(MUST).
3. `mutate(point, fn)`, `wrap(point, fn)` API는 지원하지 않아야 한다(MUST NOT).
4. 동일 타입에 여러 미들웨어가 등록되면 등록 순서대로 onion 방식으로 체이닝해야 한다(MUST).
5. `api.events.on()` 구독 해제를 위해 반환 함수를 제공해야 한다(MUST).
6. `api.tools.register()`로 등록한 도구는 도구 이름 규칙(`{리소스명}__{하위도구명}`)을 따라야 한다(MUST).
7. `turn`/`step` 미들웨어 컨텍스트는 `ctx.agents.request/send`을 제공해야 하며, `toolCall` 컨텍스트에는 이를 제공하지 않아야 한다(MUST).

### 2.3 상태 관리 규칙

1. Extension 상태는 인스턴스별로 격리되어야 한다(MUST).
2. AgentProcess는 인스턴스 초기화 시 디스크에서 Extension 상태를 자동 복원해야 한다(MUST).
3. AgentProcess는 Turn 종료 시점에 변경된 Extension 상태를 디스크에 기록해야 한다(MUST).
4. Extension 상태 파일은 `extensions/<ext-name>.json` 경로에 저장해야 한다(MUST).

### 2.4 에러/호환성 규칙

1. Extension 초기화/실행 오류는 표준 오류 코드와 함께 보고되어야 한다(MUST).
2. 에러에는 가능한 경우 `suggestion`, `helpUrl`을 포함하는 것을 권장한다(SHOULD).
3. AgentProcess는 Extension 호환성 검증(`apiVersion: goondan.ai/v1`)을 로드 단계에서 수행해야 한다(SHOULD).
4. Extension이 필요한 API가 없어 초기화 실패하는 경우 명확한 에러 메시지와 함께 AgentProcess 기동을 중단해야 한다(MUST).

### 2.5 메시지 정책 책임 분리 규칙

1. 메시지 길이/개수 제한(windowing), 요약(compaction), 핀 보존 정책은 Extension 미들웨어로 구현해야 한다(MUST).
2. Extension은 메시지 조작 시 `emitMessageEvent`를 사용해야 하며, `conversationState.nextMessages`를 직접 변경해서는 안 된다(MUST NOT).
3. Runtime 코어가 강제하지 않는 정책(예: message-window, message-compaction)은 Agent `spec.extensions` 구성으로 선택적으로 적용해야 한다(SHOULD).
4. 장기 세션/고빈도 이벤트를 처리하는 Agent는 메시지 정책 Extension을 최소 1개 이상 등록하는 것을 권장한다(SHOULD). 미적용 시 메시지 히스토리 누적으로 token limit 초과 또는 비용 급증이 발생할 수 있다.

---

## 3. Extension 리소스 스키마

### 3.1 기본 구조

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: <확장 이름>
  labels:
    tier: base           # 선택
spec:
  entry: "./index.ts"    # 필수: 엔트리 모듈 경로 (Bundle Root 기준)
  config:                # 선택: 확장별 설정
    <key>: <value>
```

### 3.2 ExtensionSpec 타입 정의

```typescript
interface ExtensionSpec<TConfig = JsonObject> {
  /**
   * 엔트리 모듈 경로
   * Bundle Root 기준 상대 경로
   * Bun으로 실행
   * @required
   */
  entry: string;

  /**
   * 확장별 설정
   * Extension 구현에서 자유롭게 정의
   * @optional
   */
  config?: TConfig;
}
```

**비노출 필드:**
- `runtime` -- 항상 Bun이므로 불필요

### 3.3 예시

```yaml
# Message Compaction Extension
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: message-compaction
spec:
  entry: "./extensions/compaction/index.ts"
  config:
    maxMessages: 50
    maxCharacters: 12000
---
# Message Window Extension
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: message-window
spec:
  entry: "./extensions/message-window/index.ts"
  config:
    maxMessages: 80
---
# Logging Extension
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: logging
spec:
  entry: "./extensions/logging/index.ts"
  config:
    level: debug
    includeToolArgs: true
---
# Skills Extension
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: skills
spec:
  entry: "./extensions/skills/index.ts"
  config:
    discovery:
      repoSkillDirs:
        - ".agents/skills"
        - "skills"
```

---

## 4. Extension 엔트리포인트

### 4.1 register 함수

Extension 모듈은 `register(api)` 함수를 **반드시** export해야 한다(MUST).

```typescript
/**
 * Extension 엔트리포인트
 * AgentProcess는 초기화 시 Agent에 선언된 Extension 목록 순서대로 이를 호출한다.
 *
 * @param api - Extension API 인터페이스
 */
export function register(api: ExtensionApi): void;
```

**규칙:**

1. Extension 모듈은 named export `register`를 제공해야 한다(MUST).
2. `register` 함수는 동기(`void`) 또는 비동기(`Promise<void>`)를 반환할 수 있다(MAY).
3. AgentProcess는 `register()` 반환(또는 Promise resolve)을 대기해야 한다(MUST).
4. 이전 Extension의 `register()` 완료 후 다음 Extension의 `register()`를 호출해야 한다(MUST).
5. `register()` 중 발생한 예외는 AgentProcess 초기화 실패로 처리해야 한다(MUST).

### 4.2 기본 구현 예시

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi } from '@goondan/core';

export function register(api: ExtensionApi): void {
  // 1. 미들웨어 등록
  api.pipeline.register('step', async (ctx) => {
    const start = Date.now();
    const result = await ctx.next();
    api.logger.info(`Step ${ctx.stepIndex} completed in ${Date.now() - start}ms`);
    return result;
  });

  // 2. 동적 도구 등록
  api.tools.register(
    {
      name: 'my-ext__status',
      description: 'Get extension status',
      parameters: { type: 'object', properties: {} },
    },
    async (ctx, input) => {
      const state = await api.state.get();
      return { status: 'ok', state };
    }
  );

  // 3. 이벤트 구독
  api.events.on('turn.completed', () => {
    api.logger.info('Turn completed');
  });
}
```

---

## 5. ExtensionApi 인터페이스

### 5.1 전체 인터페이스

AgentProcess는 Extension에 다음 API를 제공해야 한다(MUST).

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

**ExtensionApi 구성 요소:**

| 영역 | 설명 |
|------|------|
| `pipeline` | `turn`/`step`/`toolCall` 미들웨어 등록 |
| `tools` | 동적 도구 등록 |
| `state` | Extension별 JSON 상태 읽기/쓰기 |
| `events` | 프로세스 내 이벤트 버스 |
| `logger` | Extension 로깅 인터페이스 |

### 5.2 PipelineRegistry

미들웨어 등록 API. 상세 스펙은 `docs/specs/pipeline.md`를 참조한다.

`PipelineRegistry`, `TurnMiddleware`, `StepMiddleware`, `ToolCallMiddleware`, `MiddlewareOptions` 원형은 `docs/specs/pipeline.md` 5절을 따른다.

**규칙:**

1. 미들웨어 타입은 `'turn'`, `'step'`, `'toolCall'` 세 가지만 허용해야 한다(MUST).
2. 미들웨어 등록은 `pipeline.register(type, handler)`로 수행해야 한다(MUST).
3. 동일 타입에 여러 미들웨어가 등록되면 등록 순서대로 onion 방식으로 체이닝해야 한다(MUST).
4. 하나의 Extension이 여러 종류의 미들웨어를 동시에 등록할 수 있어야 한다(MUST).
5. 하나의 Extension이 같은 종류의 미들웨어를 여러 개 등록할 수 있어야 한다(MAY).
6. `turn`/`step` 미들웨어는 필요 시 `ctx.agents.request/send`으로 다른 Agent를 호출할 수 있어야 한다(MUST).

### 5.3 Tool 등록 API

Extension이 런타임에 동적으로 도구를 등록하는 API.

```typescript
interface ExtensionToolsApi {
  /**
   * 동적 Tool 등록
   * @param item - Tool Catalog 항목 (이름, 설명, 파라미터 스키마)
   * @param handler - Tool 핸들러 함수
   */
  register(item: ToolCatalogItem, handler: ToolHandler): void;
}
```

`ToolCatalogItem` 원형은 `docs/specs/tool.md` 13절을, `ToolHandler` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

**규칙:**

1. `api.tools.register()`로 등록한 도구는 도구 이름 규칙(`{리소스명}__{하위도구명}`)을 따라야 한다(MUST).
2. 동적 등록된 도구는 `step` 미들웨어의 `ctx.toolCatalog`에 자동으로 포함되어야 한다(SHOULD).
3. 동일 이름의 도구를 중복 등록하면 나중 등록이 이전 등록을 덮어써야 한다(MUST).

### 5.4 State API

Extension별 JSON 상태를 관리하는 API. 인스턴스별로 격리되며 AgentProcess가 영속화를 자동 관리한다.

```typescript
interface ExtensionStateApi {
  /** 현재 상태 조회 (없으면 null 반환) */
  get(): Promise<JsonValue>;

  /** 상태 저장 */
  set(value: JsonValue): Promise<void>;
}
```

**규칙:**

1. `api.state.get()`과 `api.state.set(value)`를 통해 Extension별 JSON 상태를 관리해야 한다(MUST).
2. 상태 저장은 Extension identity(이름)에 귀속되어야 한다(MUST).
3. Extension 상태는 인스턴스별로 격리되어야 한다(MUST).
4. AgentProcess는 인스턴스 초기화 시 디스크에서 Extension 상태를 자동 복원해야 한다(MUST).
5. AgentProcess는 Turn 종료 시점에 변경된 Extension 상태를 디스크에 기록해야 한다(MUST).
6. Extension 상태 파일은 `extensions/<ext-name>.json` 경로에 저장해야 한다(MUST).
7. 상태 값은 JSON 직렬화 가능한 값만 포함해야 한다(MUST). 함수, Symbol, 순환 참조 등은 허용되지 않는다.

**저장 경로:**

```text
~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/extensions/<ext-name>.json
```

**사용 예시:**

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

### 5.5 Events API

프로세스 내 이벤트 버스. Extension 간 느슨한 결합을 위한 pub/sub 패턴.

```typescript
interface ExtensionEventsApi {
  /**
   * 이벤트 구독
   * @param event - 이벤트 이름
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

**규칙:**

1. `api.events.on()` 구독 해제를 위해 반환 함수를 제공해야 한다(MUST).
2. 이벤트는 프로세스 내(동일 AgentProcess) 범위에서만 전파되어야 한다(MUST).
3. 이벤트 핸들러에서 발생한 예외는 다른 핸들러의 실행을 방해하지 않아야 한다(SHOULD).
4. 표준 Runtime 이벤트 이름과 payload 구조는 `docs/specs/api.md` 9절을 단일 기준으로 따른다(MUST).

### 5.6 Logger

표준 `Console` 인터페이스를 따르는 로거.

```typescript
// api.logger 사용 예시
api.logger.info('Extension initialized');
api.logger.debug('Processing step', { stepIndex: 3 });
api.logger.warn('Approaching token limit');
api.logger.error('Failed to load state', error);
```

---

## 6. Extension 로딩과 초기화

### 6.1 로딩 순서

AgentProcess는 초기화 시점에 다음 순서로 Extension을 로드한다.

1. Agent의 `spec.extensions` 배열 순서대로 Extension 리소스 해석
2. 각 Extension의 entry 모듈 로드 (Bun으로 import)
3. `register(api)` 함수 순차 호출
4. 미들웨어/Tool/이벤트 핸들러 등록 완료

```yaml
# Agent.spec.extensions 순서대로 로드
kind: Agent
spec:
  extensions:
    - ref: "Extension/message-window"      # 1번째
    - ref: "Extension/message-compaction"  # 2번째
    - ref: "Extension/logging"       # 3번째
```

### 6.2 초기화 규칙

**MUST:**
- AgentProcess는 `register(api)` 반환(또는 Promise resolve)을 대기해야 한다
- 이전 Extension의 `register()` 완료 후 다음 Extension의 `register()` 호출
- `register()` 중 발생한 예외는 AgentProcess 초기화 실패로 처리
- 코어 API 부재로 Extension이 초기화 실패하는 상황이 없어야 한다

**SHOULD:**
- Extension 로드 실패 시 상세 오류 메시지 로깅
- `apiVersion: goondan.ai/v1` 호환성 검증을 로드 단계에서 수행

### 6.3 정리(Cleanup)

Extension이 리소스 정리가 필요한 경우, 다음 패턴을 권장한다.

```typescript
export function register(api: ExtensionApi): void {
  // 리소스 할당
  const connection = createConnection();

  // process 이벤트 활용 (Bun 프로세스 종료 시)
  process.on('beforeExit', async () => {
    await connection.close();
  });
}
```

---

## 7. 에러/호환성 정책

### 7.1 표준 오류 코드

Extension 초기화/실행 오류는 다음 표준 오류 코드와 함께 보고해야 한다(MUST):

| 오류 코드 | 설명 |
|-----------|------|
| `E_EXT_LOAD` | Extension 모듈 로드 실패 (entry 경로 오류, 모듈 형식 불일치) |
| `E_EXT_INIT` | Extension `register()` 함수 실행 중 예외 |
| `E_EXT_CONFIG` | Extension 구성(`spec.config`) 검증 실패 |
| `E_EXT_COMPAT` | Extension 호환성 검증 실패 (`apiVersion` 불일치) |

### 7.2 suggestion/helpUrl 포함

Extension 오류 보고 시 사용자 복구를 돕는 `suggestion`과 관련 문서 `helpUrl`을 포함하는 것을 권장한다(SHOULD).

```typescript
interface ExtensionError extends Error {
  /** 표준 오류 코드 */
  code: string;
  /** 사용자 복구를 위한 제안 */
  suggestion?: string;
  /** 관련 문서 링크 */
  helpUrl?: string;
}
```

### 7.3 호환성 검증

AgentProcess는 Extension 로드 단계에서 `apiVersion: goondan.ai/v1` 호환성 검증을 수행해야 한다(SHOULD). Extension이 필요한 API가 없어 초기화 실패하는 경우 명확한 에러 메시지와 함께 AgentProcess 기동을 중단해야 한다(MUST).

---

## 8. 활용 패턴

### 8.1 Skill 패턴

Skill은 `SKILL.md` 중심 번들을 런타임에 노출하는 Extension 패턴이다.

**권장 미들웨어 활용:**
- `step` 미들웨어: `ctx.toolCatalog`를 조작하여 스킬 관련 도구 노출 제어. 스킬 컨텍스트를 `emitMessageEvent()`로 주입.
- `turn` 미들웨어: 스킬 실행 결과를 Turn 단위로 추적하고 후처리.

```typescript
export function register(api: ExtensionApi): void {
  // 스킬 카탈로그를 동적 도구로 등록
  api.tools.register(
    {
      name: 'skills__list',
      description: 'List all available skills',
      parameters: { type: 'object', properties: {} },
    },
    async (ctx, input) => {
      const skills = await scanSkillDirs();
      return { skills };
    }
  );

  api.tools.register(
    {
      name: 'skills__open',
      description: 'Open a skill to read its SKILL.md content',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    async (ctx, input) => {
      const content = await readSkillMd(String(input.name));
      return { content };
    }
  );

  // step 미들웨어로 활성 스킬 컨텍스트 주입
  api.pipeline.register('step', async (ctx) => {
    const state = await api.state.get();
    const activeSkill = (state as Record<string, unknown>)?.activeSkill;

    if (activeSkill) {
      ctx.emitMessageEvent({
        type: 'append',
        message: createSystemMessage(`Active skill context: ${activeSkill}`),
      });
    }

    return ctx.next();
  });
}
```

### 8.2 Tool Search 패턴

ToolSearch는 LLM이 "다음 Step에서 필요한 도구"를 선택하도록 돕는 메타 도구다.

```typescript
export function register(api: ExtensionApi): void {
  // toolSearch 도구 등록
  api.tools.register(
    {
      name: 'tool-search__search',
      description: 'Search available tools by query',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    async (ctx, input) => {
      const results = searchTools(String(input.query));
      // 선택된 도구를 상태에 저장 -> 다음 Step에서 반영
      await api.state.set({ selectedTools: results.map(r => r.name) });
      return { results };
    }
  );

  // step 미들웨어에서 선택된 도구 목록 반영
  api.pipeline.register('step', async (ctx) => {
    const state = await api.state.get();
    const selected = (state as Record<string, unknown>)?.selectedTools;

    if (Array.isArray(selected)) {
      ctx.toolCatalog = ctx.toolCatalog.filter(
        t => selected.includes(t.name)
      );
    }

    return ctx.next();
  });
}
```

### 8.3 Message Compaction 패턴

요약 기반 컨텍스트 최적화는 `turn` 미들웨어에서 `emitMessageEvent()`로 MessageEvent를 발행하여 구현한다.

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn', async (ctx) => {
    const { nextMessages } = ctx.conversationState;

    const compactable = nextMessages.filter(
      m => m.metadata['compaction.eligible'] === true
        && m.metadata['pinned'] !== true
    );

    if (compactable.length > 20) {
      const summary = await summarize(compactable);

      for (const m of compactable) {
        ctx.emitMessageEvent({ type: 'remove', targetId: m.id });
      }
      ctx.emitMessageEvent({
        type: 'append',
        message: createSystemMessage(summary, { 'compaction.summary': true }),
      });
    }

    const result = await ctx.next();
    return result;
  });
}
```

**권장 전략:**
- Sliding window: 오래된 메시지 `remove` 이벤트 발행
- Turn 요약(compaction): 복수 메시지를 `remove` 후 요약 메시지 `append`
- 중요 메시지 pinning: `metadata`에 `pinned: true` 표시하여 compaction 대상에서 제외
- Truncate: 전체 메시지 초기화(`truncate`) 후 요약 `append`

### 8.4 Message Window 패턴

고정 크기 대화 윈도우는 오래된 메시지부터 `remove` 이벤트를 발행해 구현한다.

```typescript
export function register(api: ExtensionApi): void {
  const maxMessages = 80;

  api.pipeline.register('turn', async (ctx) => {
    const { nextMessages } = ctx.conversationState;
    const removeCount = Math.max(0, nextMessages.length - maxMessages);

    for (let index = 0; index < removeCount; index += 1) {
      const message = nextMessages[index];
      if (!message) {
        continue;
      }
      ctx.emitMessageEvent({ type: 'remove', targetId: message.id });
    }

    return ctx.next();
  });
}
```

### 8.5 Logging 패턴

Step/ToolCall 미들웨어를 활용한 관찰 패턴.

```typescript
export function register(api: ExtensionApi): void {
  // Step 실행 시간 로깅
  api.pipeline.register('step', async (ctx) => {
    const start = Date.now();
    api.logger.info(`[Step ${ctx.stepIndex}] 시작`);

    try {
      const result = await ctx.next();
      api.logger.info(`[Step ${ctx.stepIndex}] 완료: ${Date.now() - start}ms`);
      return result;
    } catch (error) {
      api.logger.error(`[Step ${ctx.stepIndex}] 실패:`, error);
      throw error;
    }
  });

  // ToolCall 실행 로깅
  api.pipeline.register('toolCall', async (ctx) => {
    api.logger.debug(`[Tool] ${ctx.toolName} 호출:`, ctx.args);

    const start = Date.now();
    const result = await ctx.next();

    api.logger.debug(`[Tool] ${ctx.toolName} 완료: ${Date.now() - start}ms`);
    return result;
  });
}
```

### 8.6 MCP Extension 패턴

MCP 연동은 Extension의 `tools.register`를 통해 동적으로 도구를 등록하는 방식으로 구현한다(MAY). MCP 서버와의 연결/통신은 Extension이 자체적으로 관리한다.

```typescript
export function register(api: ExtensionApi): void {
  // MCP 서버 연결 (Extension 자체 관리)
  const mcpClient = connectToMcpServer({
    command: ['npx', '-y', '@modelcontextprotocol/server-github'],
  });

  // MCP 도구를 동적 등록
  for (const tool of mcpClient.tools) {
    api.tools.register(
      {
        name: `mcp-github__${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema,
      },
      async (ctx, input) => {
        return await mcpClient.callTool(tool.name, input);
      }
    );
  }

  // 프로세스 종료 시 MCP 연결 정리
  process.on('beforeExit', () => {
    mcpClient.disconnect();
  });
}
```

---

## 9. 미들웨어 컨텍스트 요약

각 미들웨어 타입은 전용 컨텍스트를 받으며 `next()` 호출 전후로 전처리/후처리를 수행한다.
컨텍스트 원형과 상세 필드는 `docs/specs/pipeline.md` 4절을 단일 기준으로 따른다.

핵심 포인트:

1. `turn`/`step` 컨텍스트는 `conversationState`, `emitMessageEvent`, `agents`를 제공한다.
2. `step` 컨텍스트는 `toolCatalog` 조작을 허용한다.
3. `toolCall` 컨텍스트는 `args` 조작을 허용한다.
4. 공통 타입(`ConversationState`, `MessageEvent`, `ToolCallResult`) 원형은 `docs/specs/shared-types.md`를 따른다.
5. 런타임은 `ctx.metadata`에 실행 힌트(예: `runtimeCatalog`)를 시드할 수 있으며, Extension은 이를 읽어 필요 시 메시지 주입을 수행할 수 있다(SHOULD).

---

## 10. API 경계

Extension 구현은 `pipeline`, `tools`, `state`, `events`, `logger` 표면만 사용해야 한다(MUST).
리소스 전체 접근, 런타임 설정 패치, 별도 파이프라인 등록 API 등 비표준 표면에 의존해서는 안 된다(MUST NOT).

---

## 관련 문서

- `docs/specs/pipeline.md` - 라이프사이클 파이프라인 스펙
- `docs/specs/api.md` - Runtime/SDK API 스펙
- `docs/specs/shared-types.md` - 공통 타입 SSOT
- `docs/specs/runtime.md` - Runtime 실행 모델 스펙
