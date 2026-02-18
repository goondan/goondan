# Extension 작성하기

> **대상 독자**: Extension Maker
> **버전**: v0.0.3
> **스타일**: 체크리스트 기반 how-to -- 각 단계를 따라 프로덕션 품질의 Extension을 작성하세요

[English version](./write-an-extension.md)

---

## 사전 준비

시작하기 전에 다음을 확인하세요:

- 동작하는 Goondan 프로젝트 (없으면 `gdn init` 실행)
- `@goondan/types` 설치 (TypeScript 타입용)
- Goondan의 [핵심 개념](../explanation/core-concepts.ko.md)과 [Extension 파이프라인 아키텍처](../explanation/extension-pipeline.ko.md)에 대한 기본 이해

---

## 1단계: Extension 리소스를 YAML로 정의

모든 Extension은 `goondan.yaml`(또는 번들 내 별도 YAML 파일)에서 YAML 리소스 선언으로 시작합니다.

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: my-extension         # 번들 내 고유 이름
spec:
  entry: "./extensions/my-extension/index.ts"   # 엔트리 모듈 경로 (Bundle Root 기준)
  config:                    # 선택: 임의의 키-값 구성
    maxRetries: 3
    logLevel: "debug"
```

**체크리스트:**

- [ ] `apiVersion`이 `goondan.ai/v1`인가
- [ ] `kind`가 `Extension`인가
- [ ] `metadata.name`이 고유하고 설명적인 이름인가
- [ ] `spec.entry`가 유효한 `.ts` 파일을 가리키는가 (Bundle Root 기준, Bun으로 실행)
- [ ] `spec.config`에 Extension이 필요로 하는 구성만 포함되어 있는가 (선택)

> 전체 Extension 스키마는 [리소스 레퍼런스](../reference/resources.ko.md)를 참조하세요.

---

## 2단계: `register(api)` 엔트리 모듈 생성

`spec.entry`에 선언한 경로에 TypeScript 파일을 생성합니다. 모듈은 **반드시** `register`라는 이름의 함수를 export해야 합니다.

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi } from '@goondan/types';

export function register(api: ExtensionApi): void {
  // 모든 Extension 로직이 여기에 들어갑니다:
  // - 미들웨어 등록 (api.pipeline)
  // - 동적 도구 등록 (api.tools)
  // - 상태 초기화 (api.state)
  // - 이벤트 구독 (api.events)
  // - 초기화 로깅 (api.logger)

  api.logger.info('my-extension initialized');
}
```

**체크리스트:**

- [ ] 모듈이 `register`라는 이름의 함수를 export하는가 (default export가 아님)
- [ ] 함수가 단일 `ExtensionApi` 파라미터를 받는가
- [ ] 함수가 `void` 또는 `Promise<void>`를 반환하는가 (비동기 허용)
- [ ] 초기화 오류가 발생하면 AgentProcess가 fail-fast -- 이는 의도된 설계

> `register(api)` 계약 전체는 [Extension API 레퍼런스 -- 엔트리 모듈](../reference/extension-api.ko.md#entry-module)을 참조하세요.

---

## 3단계: 미들웨어 등록 (pipeline)

`api.pipeline` API는 Extension 로직의 핵심입니다. 세 가지 수준 중 하나 이상에 미들웨어를 등록합니다: `turn`, `step`, `toolCall`.

### 3a. Turn 미들웨어

전체 대화 턴을 감쌉니다. 메시지 압축, 대화 윈도잉, 턴 수준 메트릭에 사용합니다.

```typescript
api.pipeline.register('turn', async (ctx) => {
  // 전처리: Turn 실행 전에 실행
  const { nextMessages } = ctx.conversationState;
  api.logger.info(`Turn 시작: ${nextMessages.length}개 메시지`);

  // Turn 실행 (Step 루프가 내부에서 발생)
  const result = await ctx.next();

  // 후처리: Turn 완료 후에 실행
  api.logger.info(`Turn 종료: ${result.finishReason}`);
  return result;
});
```

**주요 컨텍스트 필드:** `conversationState`, `emitMessageEvent()`, `inputEvent`, `metadata`

### 3b. Step 미들웨어

단일 LLM 호출과 도구 실행을 감쌉니다. 도구 카탈로그 필터링, 컨텍스트 주입, step 타이밍에 사용합니다.

```typescript
api.pipeline.register('step', async (ctx) => {
  // 전처리: LLM이 보기 전에 도구 카탈로그 필터링
  ctx.toolCatalog = ctx.toolCatalog.filter(
    t => !t.name.includes('disabled')
  );

  const start = Date.now();
  const result = await ctx.next();

  // 후처리: 타이밍 로깅
  api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
  return result;
});
```

**주요 컨텍스트 필드:** turn의 모든 것 + `stepIndex`, `toolCatalog` (변경 가능)

### 3c. ToolCall 미들웨어

개별 도구 호출을 감쌉니다. 인자 검증, 변환, 도구별 로깅에 사용합니다.

```typescript
api.pipeline.register('toolCall', async (ctx) => {
  // 전처리: 인자 검증 또는 변환
  api.logger.debug(`${ctx.toolName} 호출`, ctx.args);

  const result = await ctx.next();

  // 후처리: 결과 로깅
  api.logger.debug(`${ctx.toolName}: ${result.status}`);
  return result;
});
```

**주요 컨텍스트 필드:** `toolName`, `toolCallId`, `args` (변경 가능), `metadata`

**체크리스트:**

- [ ] 모든 미들웨어가 `ctx.next()`를 정확히 한 번 호출하는가
- [ ] `next()` 반환값을 전파하는가 (결과를 return)
- [ ] 전처리는 `ctx.next()` 전에, 후처리는 후에 발생하는가
- [ ] 용도에 맞는 미들웨어 수준을 선택했는가 (turn / step / toolCall)

> 미들웨어 컨텍스트 상세는 [Extension API 레퍼런스 -- PipelineRegistry](../reference/extension-api.ko.md#1-pipeline----pipelineregistry)를 참조하세요. 개념 모델은 [Extension 파이프라인 (설명)](../explanation/extension-pipeline.ko.md#미들웨어-파이프라인-onion-모델)을 참조하세요.

---

## 4단계: ConversationState와 이벤트 소싱 활용

Extension은 대화 메시지를 직접 변경하지 않고 **이벤트 소싱**을 통해 조작합니다. `ctx.emitMessageEvent()`를 사용해 메시지 이벤트를 발행합니다.

```typescript
api.pipeline.register('turn', async (ctx) => {
  const { nextMessages } = ctx.conversationState;

  // 임계값을 초과하는 오래된 메시지 제거
  if (nextMessages.length > 50) {
    for (const msg of nextMessages.slice(0, 10)) {
      ctx.emitMessageEvent({ type: 'remove', targetId: msg.id });
    }
  }

  // 컨텍스트 메시지 추가
  ctx.emitMessageEvent({
    type: 'append',
    message: {
      id: crypto.randomUUID(),
      data: { role: 'system', content: '추가 컨텍스트 내용' },
      metadata: { 'injected-by': 'my-extension' },
      createdAt: new Date(),
      source: { type: 'extension', extensionName: 'my-extension' },
    },
  });

  return ctx.next();
});
```

**사용 가능한 이벤트 타입:**

| 이벤트 타입 | 효과 |
|------------|------|
| `append` | 목록 끝에 메시지 추가 |
| `replace` | `targetId`로 식별된 메시지 교체 |
| `remove` | `targetId`로 식별된 메시지 제거 |
| `truncate` | 모든 메시지 초기화 |

**체크리스트:**

- [ ] 메시지를 직접 수정하지 않는가 -- 항상 `emitMessageEvent()` 사용
- [ ] `NextMessages = BaseMessages + SUM(Events)` 공식을 이해했는가
- [ ] `ctx.next()` 전후 모두에서 이벤트를 발행할 수 있음을 이해했는가

> 전체 개념 설명은 [Extension 파이프라인 -- ConversationState와 이벤트 소싱](../explanation/extension-pipeline.ko.md#conversationstate와-이벤트-소싱)을 참조하세요.

---

## 5단계: 동적 도구 등록 (`api.tools`)

Extension은 런타임에 도구를 등록할 수 있으며, 정적으로 선언된 도구와 함께 LLM의 도구 카탈로그에 나타납니다.

```typescript
api.tools.register(
  {
    name: 'my-ext__status',           // 반드시 {확장이름}__{도구이름} 형식
    description: 'my-extension 상태 및 메트릭 조회',
    parameters: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: '상세 메트릭 포함 여부' },
      },
    },
  },
  async (ctx, input) => {
    const state = await api.state.get();
    return {
      status: 'ok',
      state,
      verbose: input.verbose === true,
    };
  },
);
```

**체크리스트:**

- [ ] 도구 이름이 더블 언더스코어 규칙을 따르는가: `{확장이름}__{도구이름}`
- [ ] `parameters`가 유효한 JSON Schema 객체인가
- [ ] 핸들러가 JSON 직렬화 가능한 값을 반환하는가
- [ ] 같은 이름으로 도구를 등록하면 이전 등록을 덮어씀을 이해했는가

> 전체 API는 [Extension API 레퍼런스 -- ExtensionToolsApi](../reference/extension-api.ko.md#2-tools----extensiontoolsapi)를 참조하세요.

---

## 6단계: 영속 상태 관리 (`api.state`)

각 Extension은 에이전트 인스턴스별로 격리된 자체 영속 JSON 상태를 가집니다. AgentProcess가 시작 시 자동 복원하고 turn 종료 시 자동 저장합니다.

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn', async (ctx) => {
    // 현재 상태 읽기 (첫 실행 시 null)
    const state = (await api.state.get()) ?? { turnCount: 0, lastTurnAt: 0 };
    const turnCount = (state as Record<string, unknown>).turnCount as number;

    const result = await ctx.next();

    // turn 완료 후 상태 업데이트
    await api.state.set({
      turnCount: turnCount + 1,
      lastTurnAt: Date.now(),
    });

    return result;
  });
}
```

**저장 경로:**

```text
~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/extensions/<ext-name>.json
```

**체크리스트:**

- [ ] 상태 값이 JSON 직렬화 가능한가 (함수, Symbol, 순환 참조 불가)
- [ ] `api.state.get()`이 첫 실행 시 `null`을 반환함을 처리하는가
- [ ] 상태가 인스턴스별로 격리됨을 이해했는가 -- 다른 instanceKey는 독립적인 상태를 가짐

> [Extension API 레퍼런스 -- ExtensionStateApi](../reference/extension-api.ko.md#3-state----extensionstateapi)를 참조하세요.

---

## 7단계: 이벤트 발행/구독 (`api.events`)

이벤트 버스는 Extension 간 느슨한 결합을 가능하게 합니다. 표준 런타임 이벤트를 구독하거나, 다른 Extension이 소비할 커스텀 이벤트를 발행할 수 있습니다.

### 런타임 이벤트 구독

```typescript
const unsubscribe = api.events.on('turn.completed', (payload) => {
  api.logger.info('Turn 완료', payload);
});

// 프로세스 종료 시 정리
process.on('beforeExit', () => {
  unsubscribe();
});
```

### 커스텀 이벤트 발행

```typescript
// 다른 Extension이 들을 수 있는 이벤트 발행
api.events.emit('my-ext.data-ready', { recordCount: 42 });
```

### 다른 Extension의 커스텀 이벤트 구독

```typescript
api.events.on('my-ext.data-ready', (payload) => {
  api.logger.info('데이터 준비됨:', payload);
});
```

**표준 런타임 이벤트:**

| 이벤트 | 발생 시점 |
|--------|----------|
| `turn.started` | Turn 시작 시 |
| `turn.completed` | Turn 정상 완료 시 |
| `turn.failed` | Turn 실패 시 |
| `step.started` | Step 시작 시 |
| `step.completed` | Step 완료 시 |
| `step.failed` | Step 실패 시 |
| `tool.called` | 도구 호출 시 |
| `tool.completed` | 도구 완료 시 |
| `tool.failed` | 도구 실패 시 |

**체크리스트:**

- [ ] `api.events.on()`이 구독 해제 함수를 반환함을 이해했는가 -- 정리가 필요하면 저장
- [ ] 이벤트가 동일 AgentProcess 내에서만 전파됨을 이해했는가 (프로세스 내 범위)
- [ ] 커스텀 이벤트 이름에 네임스페이스 접두사를 사용하여 충돌 방지 (예: `my-ext.event-name`)

> [Extension API 레퍼런스 -- ExtensionEventsApi](../reference/extension-api.ko.md#4-events----extensioneventsapi)를 참조하세요.

---

## 8단계: Agent에 Extension 등록

Extension은 Agent가 `spec.extensions` 배열에서 참조해야만 활성화됩니다. 항목의 순서가 미들웨어 레이어링 순서를 결정합니다.

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: my-agent
spec:
  model:
    ref: "Model/claude-sonnet"
  extensions:
    - ref: "Extension/logging"        # 1번째: 가장 바깥 미들웨어 레이어
    - ref: "Extension/my-extension"   # 2번째: 중간 레이어
    - ref: "Extension/skills"         # 3번째: 가장 안쪽 레이어
```

**체크리스트:**

- [ ] `ref` 값이 Extension 리소스의 `Extension/<metadata.name>`과 일치하는가
- [ ] 순서가 원하는 미들웨어 레이어링을 반영하는가 (처음 = 바깥, 마지막 = 안쪽)
- [ ] 각 Agent가 다른 Extension 목록을 가질 수 있음을 이해했는가 -- Extension은 에이전트 인스턴스별로 로드

---

## 9단계: 검증과 테스트

### 번들 검증

```bash
gdn validate
```

Extension의 `spec.entry` 파일이 존재하고 YAML이 올바른 형식인지 확인합니다.

### 테스트 전략

1. **미들웨어 함수 단위 테스트**: 미들웨어 로직을 독립 함수로 추출하고 모의 컨텍스트로 테스트합니다.

```typescript
// my-extension.test.ts
import { describe, it, expect } from 'bun:test';

// 테스트 가능성을 위해 미들웨어 로직 추출
function createStepMiddleware(logger: Console) {
  return async (ctx: { stepIndex: number; next: () => Promise<unknown> }) => {
    const start = Date.now();
    const result = await ctx.next();
    logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
    return result;
  };
}

describe('my-extension step 미들웨어', () => {
  it('next를 호출하고 타이밍을 로깅한다', async () => {
    const logs: string[] = [];
    const mockLogger = { info: (msg: string) => logs.push(msg) } as Console;
    const middleware = createStepMiddleware(mockLogger);

    const result = await middleware({
      stepIndex: 0,
      next: async () => ({ status: 'completed' }),
    });

    expect(result).toEqual({ status: 'completed' });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('Step 0');
  });
});
```

2. **`gdn run`으로 통합 테스트**: 스웜을 실행하고 실제 LLM 상호작용에서 Extension이 올바르게 동작하는지 확인합니다.

3. **상태 영속성 테스트**: 여러 turn을 실행하고 `api.state.get()`이 예상된 누적 상태를 반환하는지 확인합니다.

**체크리스트:**

- [ ] `gdn validate`가 오류 없이 통과하는가
- [ ] 미들웨어 로직이 테스트 가능한 함수로 추출되어 있는가
- [ ] 전처리/후처리 로직을 커버하는 단위 테스트가 있는가
- [ ] 상태 직렬화/역직렬화가 테스트되었는가

---

## 10단계: 정리와 에러 처리

### 리소스 정리

Extension이 리소스(연결, 파일 핸들 등)를 할당하면, 프로세스 종료 시 정리합니다:

```typescript
export function register(api: ExtensionApi): void {
  const connection = createDatabaseConnection();

  api.tools.register(/* ... */);

  // 프로세스 종료 시 정리
  process.on('beforeExit', async () => {
    await connection.close();
    api.logger.info('연결 종료됨');
  });
}
```

### 미들웨어 에러 처리

미들웨어 에러는 onion 체인을 통해 전파됩니다. 커스텀 처리가 필요하면 에러를 잡으세요:

```typescript
api.pipeline.register('step', async (ctx) => {
  try {
    return await ctx.next();
  } catch (error) {
    api.logger.error(`Step ${ctx.stepIndex} 실패:`, error);
    // 바깥 미들웨어와 런타임이 처리하도록 재throw
    throw error;
  }
});
```

---

## 완성 예제

여러 ExtensionApi 영역을 결합한 전체 Extension 예제입니다:

```yaml
# goondan.yaml (Extension 리소스)
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: usage-tracker
spec:
  entry: "./extensions/usage-tracker/index.ts"
  config:
    maxTurnsPerDay: 100
```

```typescript
// extensions/usage-tracker/index.ts
import type { ExtensionApi } from '@goondan/types';

interface UsageState {
  totalTurns: number;
  todayTurns: number;
  todayDate: string;
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function register(api: ExtensionApi): void {
  // 1. Turn 미들웨어: 사용량 추적 및 일일 한도 적용
  api.pipeline.register('turn', async (ctx) => {
    const raw = await api.state.get();
    const state: UsageState = raw
      ? (raw as UsageState)
      : { totalTurns: 0, todayTurns: 0, todayDate: getTodayDate() };

    // 날짜가 변경되면 일일 카운터 리셋
    const today = getTodayDate();
    if (state.todayDate !== today) {
      state.todayTurns = 0;
      state.todayDate = today;
    }

    // 일일 한도 확인
    if (state.todayTurns >= 100) {
      api.logger.warn('일일 turn 한도 도달');
      ctx.emitMessageEvent({
        type: 'append',
        message: {
          id: crypto.randomUUID(),
          data: { role: 'system', content: '일일 사용 한도에 도달했습니다. 내일 다시 시도해 주세요.' },
          metadata: {},
          createdAt: new Date(),
          source: { type: 'extension', extensionName: 'usage-tracker' },
        },
      });
    }

    const result = await ctx.next();

    // 사용량 상태 업데이트
    state.totalTurns += 1;
    state.todayTurns += 1;
    await api.state.set(state);

    // 커스텀 이벤트 발행
    api.events.emit('usage-tracker.turn-completed', {
      totalTurns: state.totalTurns,
      todayTurns: state.todayTurns,
    });

    return result;
  });

  // 2. Step 미들웨어: step 타이밍 로깅
  api.pipeline.register('step', async (ctx) => {
    const start = Date.now();
    const result = await ctx.next();
    api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
    return result;
  });

  // 3. 동적 도구: 사용량 통계 조회
  api.tools.register(
    {
      name: 'usage-tracker__stats',
      description: '현재 사용량 통계 조회',
      parameters: { type: 'object', properties: {} },
    },
    async () => {
      const state = (await api.state.get()) ?? { totalTurns: 0, todayTurns: 0 };
      return state;
    },
  );

  // 4. 이벤트 구독: 다른 Extension에 반응
  api.events.on('turn.completed', () => {
    api.logger.debug('turn.completed 이벤트 수신');
  });

  api.logger.info('usage-tracker extension 초기화 완료');
}
```

```yaml
# Agent에 등록
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  model:
    ref: "Model/claude-sonnet"
  extensions:
    - ref: "Extension/usage-tracker"
    - ref: "Extension/logging"
```

---

## 빠른 참조 체크리스트

| 단계 | 할 일 | 완료? |
|------|-------|------|
| 1 | `kind: Extension` 리소스 YAML을 `spec.entry`와 함께 정의 | |
| 2 | `register(api)`를 export하는 엔트리 모듈 생성 | |
| 3 | 필요에 따라 미들웨어 등록 (`turn` / `step` / `toolCall`) | |
| 4 | 메시지 조작에 `emitMessageEvent()` 사용 (이벤트 소싱) | |
| 5 | 필요하면 `api.tools.register()`로 동적 도구 등록 | |
| 6 | `api.state.get()` / `set()`으로 영속 상태 관리 | |
| 7 | `api.events.on()` / `emit()`으로 이벤트 기반 통신 | |
| 8 | `Agent.spec.extensions`에 Extension 추가 | |
| 9 | `gdn validate` 실행 및 테스트 작성 | |
| 10 | 리소스 정리와 에러 처리 | |

---

## 더 읽을거리

- [Extension API 레퍼런스](../reference/extension-api.ko.md) -- 모든 ExtensionApi 메서드의 상세 인터페이스 시그니처
- [Extension 파이프라인 (설명)](../explanation/extension-pipeline.ko.md) -- 미들웨어 아키텍처 개념 심층 탐구
- [첫 Extension 만들기 (튜토리얼)](../tutorials/03-build-your-first-extension.ko.md) -- 초보자를 위한 단계별 안내 워크스루
- [Tool API 레퍼런스](../reference/tool-api.ko.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult`
- [리소스 레퍼런스](../reference/resources.ko.md) -- 8종 리소스 Kind의 전체 YAML 스키마

---

_문서 버전: v0.0.3_
