# Goondan Tool 시스템 스펙 v0.0.3

> 공통 타입(`ToolCall`, `ToolCallResult`, `ToolContext`, `IpcMessage`)의 기준은 `docs/specs/shared-types.md`를 따른다.

## 1. 개요

### 1.1 배경 및 설계 철학

Tool은 LLM이 tool call로 호출하는 **1급 실행 단위**다. Tool을 통해 에이전트는 외부 API 호출, 파일 수정, 에이전트 간 통신 같은 실제 작업을 수행한다. Tool 시스템은 다음 원칙에 따라 설계되었다:

- **Registry와 Catalog의 분리**: 실행 가능한 전체 도구 집합(Registry)과 LLM에 노출되는 도구 목록(Catalog)을 분리하여, Extension이 Step 단위로 도구 가시성을 제어할 수 있게 한다.
- **더블 언더스코어 네이밍**: `{리소스명}__{export명}` 형식으로 리소스 경계를 명확히 하며, AI SDK에서 별도 인코딩 없이 사용 가능한 문자열을 구분자로 채택했다.
- **AgentProcess 내 실행**: Tool 호출은 AgentProcess(Bun) 내부에서 `spec.entry` JS 모듈을 로드하고 `handlers` 함수를 호출하는 방식으로 수행한다.
- **통합 이벤트 기반 에이전트 간 통신**: Orchestrator 경유 IPC 통합 이벤트 모델을 사용하며, `request`(응답 대기)와 `send`(fire-and-forget) 두 가지 패턴을 제공한다.
- **오류 전파 차단**: Tool 실행 오류는 예외로 전파하지 않고, 구조화된 `ToolCallResult`로 LLM에 전달하여 에이전트가 스스로 복구 전략을 수립할 수 있게 한다.

### 1.2 Tool 실행 컨텍스트

Tool 실행은 별도 Tool 프로세스를 만들지 않는다. AgentProcess가 Step 실행 중 Tool 핸들러 모듈을 로드하고 같은 프로세스에서 핸들러 함수를 호출한다.

```
LLM tool call
   → AgentProcess(Bun)
      → ToolRegistry lookup
      → import(spec.entry) / handlers resolve
      → handlers[exportName](ctx, input)   # same process call
      → ToolCallResult
```

---

## 2. 핵심 규칙

다음은 Tool 시스템 구현 시 반드시 준수해야 하는 규범적 규칙을 요약한 것이다. 세부 사항은 이후 각 섹션에서 설명한다.

### 2.1 Registry / Catalog 규칙

1. AgentProcess는 Step마다 Tool Catalog를 구성해야 한다(MUST).
2. Tool Catalog는 Agent 리소스의 `spec.tools` 선언을 기반으로 초기화해야 한다(MUST).
3. Step 미들웨어는 `ctx.toolCatalog`를 조작하여 LLM에 노출되는 도구를 변경할 수 있다(MAY).
4. Extension이 `api.tools.register()`로 동적 등록한 도구도 Tool Registry에 포함되어야 한다(MUST).

### 2.2 도구 이름 규칙

1. LLM에 노출되는 도구 이름은 `{Tool metadata.name}__{export name}` 형식이어야 한다(MUST).
2. 더블 언더스코어(`__`)를 리소스 이름과 하위 도구 이름의 구분자로 사용해야 한다(MUST).
3. Tool 리소스 이름과 하위 도구 이름 각각에는 `__`를 포함해서는 안 된다(MUST NOT).
4. 단일 export만 가진 Tool 리소스도 `{리소스명}__{export명}` 형식을 따라야 한다(MUST).

### 2.3 Tool Call 허용 범위 규칙

1. Tool call의 기본 허용 범위는 현재 Step의 Tool Catalog여야 한다(MUST).
2. Catalog에 없는 도구 호출은 명시적 정책이 없는 한 거부해야 한다(MUST).
3. Registry 직접 호출 허용 모드는 명시적 보안 정책으로만 활성화할 수 있다(MAY).
4. 거부 결과는 구조화된 `ToolCallResult`(`status="error"`, `code`)로 반환해야 한다(MUST).

### 2.4 오류 처리 규칙

1. AgentProcess는 Tool 실행 오류를 예외 전파 대신 `ToolCallResult`로 LLM에 전달해야 한다(MUST).
2. `error.message` 길이는 `Tool.spec.errorMessageLimit`를 적용해야 한다(MUST).
3. `errorMessageLimit` 미설정 시 기본값은 1000자여야 한다(MUST).
4. 사용자 복구를 돕는 `suggestion` 필드를 제공하는 것을 권장한다(SHOULD).
5. 문서 링크(`helpUrl`) 제공을 권장한다(SHOULD).

### 2.5 ToolContext 규칙

1. `workdir`은 해당 인스턴스의 워크스페이스 경로를 가리켜야 한다(MUST).
2. bash, file-system 등 파일 시스템 접근 도구는 `ctx.workdir`을 기본 작업 디렉토리로 사용해야 한다(MUST).
3. ToolContext에는 `swarmBundle`, `oauth` 같은 비소유 인터페이스를 포함해서는 안 된다(MUST NOT).
4. `message` 필드는 이 도구 호출을 포함하는 assistant Message를 참조해야 한다(MUST).

### 2.6 에이전트 간 통신 규칙

1. 에이전트 간 통신은 통합 이벤트 모델(`AgentEvent` + `replyTo`)을 사용해야 한다(MUST). (`docs/specs/runtime.md`의 `AgentEvent 타입 (통합 이벤트 모델)` 섹션 참조)
2. `request`(응답 대기) 패턴은 `AgentEvent.replyTo`를 설정하여 요청-응답을 매칭해야 한다(MUST).
3. `send`(fire-and-forget) 패턴은 `AgentEvent.replyTo`를 생략해야 한다(MUST).
4. 원래 Agent의 Turn/Trace 컨텍스트는 `replyTo.correlationId`를 통해 추적 가능해야 한다(MUST).
5. 통신 실패는 구조화된 `ToolCallResult`(`status="error"`)로 반환해야 한다(MUST).
6. 기본 에이전트 간 통신 구현체는 `packages/base`에 제공하는 것을 권장한다(SHOULD).
7. Orchestrator는 대상 AgentProcess가 존재하지 않으면 자동 스폰해야 한다(MUST).
8. `spawn`은 이미 정의된 Agent 리소스의 인스턴스를 준비하는 연산이며, 런타임 중 리소스 정의를 수정해서는 안 된다(MUST NOT).

### 2.7 리소스 스키마 규칙

1. `spec.entry`는 필수이며, AgentProcess(Bun)가 모듈을 로드할 수 있는 유효한 경로여야 한다(MUST).
2. entry 모듈은 `handlers: Record<string, ToolHandler>` 형식으로 하위 도구 핸들러를 export해야 한다(MUST).
3. Tool 핸들러 호출은 AgentProcess 내부 함수 호출로 실행되어야 한다(MUST).
4. `spec.exports`는 최소 1개 이상이어야 한다(MUST).
5. `exports[].name`은 Tool 리소스 내에서 고유해야 한다(MUST).

---

## 3. Tool Registry vs Tool Catalog

| 개념 | 설명 |
|------|------|
| **Tool Registry** | AgentProcess가 보유한 **실행 가능한 전체 도구 엔드포인트(핸들러 포함) 집합**. Bundle에 선언된 모든 Tool 리소스의 핸들러 로딩 및 Extension 동적 등록(`api.tools.register`)으로 구성된다. |
| **Tool Catalog** | **특정 Step에서 LLM에 노출되는 도구 목록**. AgentProcess는 매 Step마다 Step 미들웨어의 `toolCatalog`를 통해 Tool Catalog를 구성한다. |

```
┌──────────────────────────────────────────────────────────────┐
│                      Tool Registry                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Tool A (exports: a__foo, a__bar)                      │  │
│  │  Tool B (exports: b__run)                              │  │
│  │  Dynamic Tool C (api.tools.register)                   │  │
│  │  MCP Extension D (tools: d__query, d__mutate)          │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           │
                           │ step 미들웨어의 ctx.toolCatalog
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   Tool Catalog (Step N)                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  a__foo, a__bar, b__run  (Agent.spec.tools 선언 기반)   │  │
│  │  + Extension이 동적 등록한 도구들                       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Tool Identity

Tool의 identity는 `"{kind}/{name}"` 형식으로 표현된다.

```typescript
type ToolIdentity = `Tool/${string}`;

// 예시
const identity: ToolIdentity = "Tool/bash";
```

---

## 4. Tool 리소스 스키마

### 4.1 YAML 정의

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
  labels:
    tier: base
spec:
  entry: "./tools/bash/index.ts"     # 필수: AgentProcess(Bun)에서 모듈 로드
  errorMessageLimit: 1200            # 선택: 오류 메시지 최대 길이 (기본값: 1000)

  exports:
    - name: exec                     # LLM에는 "bash__exec"로 노출
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]

    - name: script                   # LLM에는 "bash__script"로 노출
      description: "스크립트 파일 실행"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: [path]
```

### 4.2 ToolSpec TypeScript 인터페이스

```typescript
interface ToolSpec {
  /** 핸들러 모듈 경로 (프로젝트 루트 기준). AgentProcess(Bun)가 로드한다. */
  entry: string;

  /** Tool 오류 메시지 최대 길이 (기본값: 1000) */
  errorMessageLimit?: number;

  /** LLM에 노출되는 함수 목록 */
  exports: ToolExportSpec[];
}
```

> Tool 실행 환경은 Bun이며, 인증 연동은 Extension/Connection 조합으로 구성한다.

### 4.3 검증 규칙

| 규칙 | 수준 | 설명 |
|------|------|------|
| `spec.entry` 필수 | MUST | 핸들러 모듈 경로가 반드시 존재해야 한다 |
| `spec.exports` 최소 1개 | MUST | 최소 하나의 export가 필요하다 |
| `exports[].name` 고유성 | MUST | Tool 리소스 내에서 export name이 고유해야 한다 |
| `__` 금지 (이름 내부) | MUST NOT | Tool 리소스 이름과 export name에는 `__`를 포함해서는 안 된다 |
| `errorMessageLimit` 기본값 | MUST | 미설정 시 1000자로 적용한다 |
| entry default export | MUST | entry 모듈에 `handlers: Record<string, ToolHandler>` export가 존재해야 한다 |

---

## 5. 도구 이름 규칙

### 5.1 네이밍 컨벤션

LLM에 노출되는 도구 이름은 **`{Tool 리소스 metadata.name}__{export name}`** 형식이어야 한다(MUST). 구분자는 `__`(더블 언더스코어)를 사용한다.

```
Tool 리소스: bash          → exports: exec, script
LLM 도구 이름: bash__exec, bash__script

Tool 리소스: file-system   → exports: read, write
LLM 도구 이름: file-system__read, file-system__write

Tool 리소스: http-fetch    → exports: get, post
LLM 도구 이름: http-fetch__get, http-fetch__post
```

### 5.2 규칙

1. 더블 언더스코어(`__`)를 리소스 이름과 하위 도구 이름의 구분자로 사용해야 한다(MUST).
2. AI SDK에서 허용되는 문자이므로 별도 인코딩/디코딩 없이 그대로 사용해야 한다(MUST).
3. Tool 리소스 이름과 하위 도구 이름 각각에는 `__`를 포함해서는 안 된다(MUST NOT).
4. 단일 export만 가진 Tool 리소스도 `{리소스명}__{export명}` 형식을 따라야 한다(MUST).

### 5.3 이름 파싱/조합

```typescript
/** Tool 이름을 리소스 이름과 export 이름으로 분해 */
function parseToolName(fullName: string): { resourceName: string; exportName: string } | null {
  const idx = fullName.indexOf('__');
  if (idx < 0) return null;
  return {
    resourceName: fullName.slice(0, idx),
    exportName: fullName.slice(idx + 2),
  };
}

/** 리소스 이름과 export 이름으로 full tool name 조합 */
function buildToolName(resourceName: string, exportName: string): string {
  return `${resourceName}__${exportName}`;
}
```

---

## 6. Tool Export 스키마

### 6.1 ToolExportSpec 인터페이스

```typescript
interface ToolExportSpec {
  /** export 이름 (LLM tool call에서 "{리소스명}__{name}"으로 사용) */
  name: string;

  /** LLM에 제공되는 도구 설명 */
  description?: string;

  /** JSON Schema 형식의 파라미터 정의 */
  parameters?: JsonSchemaObject;
}

interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  items?: JsonSchemaProperty;
  default?: JsonValue;
}
```

### 6.2 Export 이름 규칙

- **식별자 규칙**: 영문 소문자, 숫자, `_`, `-`만 허용. `__`는 금지.
- **고유성**: 동일 Tool 리소스 내에서 중복될 수 없다(MUST).
- **예시**: `exec`, `script`, `read`, `write`, `list-channels`, `post_message`

---

## 7. ToolHandler 인터페이스

### 7.1 핸들러 시그니처

```typescript
/**
 * Tool 핸들러 함수 시그니처
 * @param ctx - 실행 컨텍스트
 * @param input - LLM이 전달한 입력 (parameters 스키마와 일치)
 * @returns 동기 또는 비동기 결과
 */
type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;
```

### 7.2 핸들러 모듈 형식

핸들러 모듈은 `handlers` 객체를 export해야 한다(MUST). 키는 export name이다.

```typescript
// tools/bash/index.ts
import type { ToolHandler, ToolContext, JsonValue } from '@goondan/core';

export const handlers: Record<string, ToolHandler> = {
  'exec': async (ctx: ToolContext, input: { command: string }): Promise<JsonValue> => {
    const proc = Bun.spawn(['sh', '-c', input.command], {
      cwd: ctx.workdir,
    });
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  },

  'script': async (ctx: ToolContext, input: { path: string }): Promise<JsonValue> => {
    const proc = Bun.spawn(['sh', input.path], {
      cwd: ctx.workdir,
    });
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  },
};
```

### 7.3 ToolContext 구조

`ToolContext` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

**핵심 필드:**
- `workdir`: 인스턴스 워크스페이스 경로 (bash, file-system 등이 기본 CWD로 사용)
- `logger`: Console 인터페이스 (로깅용)
- `runtime`: AgentToolRuntime (선택) - 에이전트 간 통신/카탈로그(request/send/spawn/list/catalog) 인터페이스 제공
- `message`: 현재 Tool call을 포함하는 assistant Message
- `toolCallId`: 현재 Tool call의 고유 ID

`runtime` 필드는 에이전트 간 통신 도구(agents tool)에서 사용되며, Orchestrator와의 IPC를 통해 다른 AgentProcess와 통신하고 현재 Swarm 카탈로그를 조회한다.

---

## 8. Tool 실행 흐름

### 8.1 Middleware 기반 파이프라인

모든 파이프라인 훅은 Middleware 형태로 동작한다. Tool 실행은 `toolCall` 미들웨어를 통과한다.

```
LLM 응답에 tool_calls 포함
           │
           ▼
┌──────────────────────────────────┐
│  toolCall 미들웨어 체인           │
│    Extension.before (next 전)    │  ← 입력 검증/변환
│      → CORE handler exec        │  ← AgentProcess 내부 JS 함수 호출
│    Extension.after (next 후)     │  ← 결과 변환, 로깅
└──────────────────────────────────┘
           │
           ▼
    ToolCallResult → MessageEvent(append) 발행
```

핸들러 구현이 `Bun.spawn()` 등으로 외부 프로세스를 실행할 수는 있지만, 이는 Tool 내부 구현 선택이며 Tool 호출 경계는 여전히 AgentProcess 내부다.

### 8.2 ToolCall 구조

`ToolCall` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

### 8.3 ToolCallMiddlewareContext

`ToolCallMiddlewareContext` 원형은 `docs/specs/pipeline.md` 4.3절을 따른다.

### 8.4 Extension에서의 toolCall 미들웨어 등록

```typescript
// extension entry point
export function register(api: ExtensionApi): void {
  api.pipeline.register('toolCall', async (ctx) => {
    // next() 전 = 입력 검증/변환
    api.logger.debug(`Tool 호출: ${ctx.toolName}`, ctx.args);

    const startTime = Date.now();
    const result = await ctx.next();
    const elapsed = Date.now() - startTime;

    // next() 후 = 결과 후처리
    api.logger.debug(`Tool 완료: ${ctx.toolName} (${elapsed}ms)`);

    return result;
  });
}
```

---

## 9. Tool Call 허용 범위

### 9.1 허용 범위 규칙

| 규칙 | 수준 | 설명 |
|------|------|------|
| Catalog 기반 허용 | MUST | Tool call의 기본 허용 범위는 현재 Step의 Tool Catalog여야 한다 |
| Catalog 외 거부 | MUST | Tool Catalog에 없는 도구 호출은 명시적 정책이 없는 한 거부해야 한다 |
| Registry 직접 호출 | MAY | Tool Registry 직접 호출 허용 모드는 명시적 보안 정책으로만 활성화할 수 있다 |
| 거부 결과 반환 | MUST | 거부 시 구조화된 `ToolCallResult`를 반환해야 한다 |

### 9.2 거부 시 반환 형식

```json
{
  "status": "error",
  "error": {
    "code": "E_TOOL_NOT_IN_CATALOG",
    "name": "ToolNotInCatalogError",
    "message": "Tool 'unknown__action' is not available in the current Tool Catalog.",
    "suggestion": "Agent 구성의 spec.tools에 해당 도구를 추가하거나, step 미들웨어에서 동적으로 등록하세요."
  }
}
```

---

## 10. Tool 결과 처리

### 10.1 ToolCallResult 구조

```typescript
interface ToolError {
  /** 오류 메시지 (errorMessageLimit 적용됨) */
  message: string;

  /** 오류 이름/타입 */
  name?: string;

  /** 오류 코드 */
  code?: string;

  /** 사용자 복구를 위한 제안 (SHOULD) */
  suggestion?: string;

  /** 관련 문서 링크 (SHOULD) */
  helpUrl?: string;
}
```

`ToolCallResult` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

### 10.2 동기/비동기 결과

- **동기 완료**: 핸들러가 값을 반환하면 `output` 포함
- **오류 완료**: 실패 시 `status: 'error'`와 `error`를 함께 반환
- 장기 작업은 별도 상태 폴링 핸들을 `ToolCallResult`에 추가하지 않고, 통합 이벤트 모델 또는 도메인 이벤트로 모델링한다(SHOULD).

### 10.3 오류 결과 및 메시지 제한

AgentProcess는 Tool 실행 오류를 예외 전파 대신 `ToolCallResult`로 LLM에 전달해야 한다(MUST).

```json
{
  "status": "error",
  "error": {
    "code": "E_TOOL",
    "name": "Error",
    "message": "요청 실패",
    "suggestion": "입력 파라미터를 확인하세요.",
    "helpUrl": "https://docs.goondan.ai/errors/E_TOOL"
  }
}
```

### 10.4 오류 메시지 제한 구현

```typescript
function truncateErrorMessage(message: string, limit: number): string {
  if (message.length <= limit) {
    return message;
  }
  const truncationSuffix = '... (truncated)';
  const maxContentLength = limit - truncationSuffix.length;
  return message.slice(0, maxContentLength) + truncationSuffix;
}
```

---

## 11. 에이전트 간 통신 도구 패턴

Agent 간 통신을 Tool call로 구현하며, Orchestrator를 경유하는 통합 이벤트 모델(`AgentEvent`)로 통신한다. `request`(응답 대기), `send`(fire-and-forget), `spawn`(정의된 Agent 인스턴스 준비), `list`(spawn 목록 조회), `catalog`(현재 Swarm 에이전트 카탈로그 조회) 패턴을 지원한다.

> 통합 이벤트 모델 상세는 `docs/specs/runtime.md`의 `AgentEvent 타입 (통합 이벤트 모델)` 섹션, IPC 규격은 `docs/specs/runtime.md`의 `IPC 메시지 타입` 섹션을 참조한다.

### 11.1 통신 패턴

#### request (응답 대기)

```
1. Agent A가 agents__request 도구를 호출 (target: 'AgentB', input: '...')
2. AgentProcess A → Orchestrator: IPC { type: 'event', payload: AgentEvent(replyTo 포함) }
3. Orchestrator → AgentProcess B로 라우팅 (필요시 스폰)
4. AgentProcess B의 Turn 완료 → Orchestrator: IPC { type: 'event', payload: 응답 AgentEvent }
5. Orchestrator → AgentProcess A에 결과 전달 (correlationId로 매칭)
```

#### send (fire-and-forget)

```
1. Agent A가 agents__send 도구를 호출 (target: 'AgentB', input: '...')
2. AgentProcess A → Orchestrator: IPC { type: 'event', payload: AgentEvent(replyTo 없음) }
3. Orchestrator → AgentProcess B로 라우팅 (필요시 스폰)
4. Tool은 즉시 { status: 'ok', output: { sent: true } }를 반환
```

#### spawn (정의된 Agent 인스턴스 준비)

```
1. Agent A가 agents__spawn 도구를 호출 (target: 'AgentB', instanceKey?: '...', cwd?: '...')
2. Runtime은 현재 Swarm에 정의된 Agent 리소스인지 검증
3. 해당 target+instanceKey 인스턴스 상태를 준비(없으면 초기화, 있으면 재사용)
4. 이후 agents__request/send에서 같은 instanceKey로 라우팅 가능
```

#### list (spawn 목록 조회)

```
1. Agent가 agents__list 도구를 호출
2. Runtime이 현재 에이전트가 spawn한 인스턴스(또는 includeAll=true 시 전체)를 반환
```

#### catalog (Swarm 에이전트 카탈로그 조회)

```
1. Agent가 agents__catalog 도구를 호출
2. Runtime이 selected Swarm 기준의 availableAgents/callableAgents를 반환
3. Agent는 필요 시 이 결과를 기반으로 다음 위임 대상을 선택한다
```

### 11.2 IPC 메시지 형식

IPC 메시지 타입/필드/전송 규칙의 단일 기준은 `docs/specs/runtime.md` 6절과 `docs/specs/shared-types.md` 5절이다.
Tool 문맥에서는 에이전트 간 통신이 `event` 기반 `AgentEvent`로 정규화된다는 점만 보장한다(MUST).

### 11.3 에이전트 간 통신 규칙

| 규칙 | 수준 | 설명 |
|------|------|------|
| 통합 이벤트 모델 | MUST | 에이전트 간 통신은 `AgentEvent` + `replyTo` 패턴을 사용해야 한다 |
| request 패턴 | MUST | 요청-응답 통신은 `replyTo`를 설정하고, `correlationId`로 매칭해야 한다 |
| send 패턴 | MUST | fire-and-forget 통신은 `replyTo`를 생략해야 한다 |
| spawn 대상 제약 | MUST | `agents__spawn`의 `target`은 현재 Swarm에 정의된 Agent 리소스여야 한다 |
| 리소스 불변성 | MUST | `agents__spawn`은 `goondan.yaml`의 Agent 리소스를 런타임에 생성/수정하지 않는다 |
| list 패턴 | SHOULD | `agents__list`는 기본적으로 호출 Agent가 spawn한 인스턴스 목록을 반환한다 |
| catalog 패턴 | SHOULD | `agents__catalog`는 selected Swarm 기준 `availableAgents`/`callableAgents`를 반환한다 |
| 실패 시 에러 반환 | MUST | 통신 실패는 구조화된 `ToolCallResult`(`status="error"`)로 반환해야 한다 |
| 기본 구현체 | SHOULD | 기본 에이전트 간 통신 구현체를 `packages/base`에 제공하는 것이 권장된다 |
| 자동 스폰 | MUST | Orchestrator는 대상 AgentProcess가 존재하지 않으면 자동 스폰해야 한다 |

---

## 12. 동적 Tool 등록

### 12.1 api.tools.register

Extension에서 런타임에 Tool을 동적으로 등록할 수 있다.

`ExtensionApi` 원형은 `docs/specs/extension.md` 5절을 따른다.
`api.tools.register(item, handler)`의 `item`/`handler` 타입은 `ToolCatalogItem`/`ToolHandler` 계약을 따른다.

### 12.2 동적 등록 예시

```typescript
// extensions/weather/index.ts
export function register(api: ExtensionApi): void {
  api.tools.register(
    {
      name: 'weather__get',
      description: '특정 도시의 현재 날씨 정보를 조회합니다',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '도시 이름 (예: Seoul, Tokyo)',
          },
        },
        required: ['city'],
      },
    },
    async (ctx, input) => {
      const city = String(input.city);
      const response = await fetch(
        `https://api.weather.example/v1/current?city=${encodeURIComponent(city)}`
      );
      if (!response.ok) {
        throw new Error(`날씨 API 오류: ${response.status}`);
      }
      return await response.json();
    }
  );
}
```

### 12.3 동적 Tool의 Catalog 노출

동적으로 등록된 Tool은 다음 Step의 Tool Catalog에 자동으로 포함된다. Step 미들웨어에서 `ctx.toolCatalog`를 통해 확인/변경할 수 있다.

---

## 13. ToolCatalogItem 구조

### 13.1 인터페이스 정의

```typescript
interface ToolCatalogItem {
  /** LLM에 노출되는 Tool 이름 (예: "bash__exec") */
  name: string;

  /** LLM에 제공되는 설명 */
  description?: string;

  /** JSON Schema 파라미터 */
  parameters?: JsonSchemaObject;

  /** Tool 출처 정보 */
  source?: ToolSource;
}

interface ToolSource {
  /** 출처 유형 */
  type: 'config' | 'extension' | 'mcp';

  /** 출처 이름 */
  name: string;

  /** MCP 서버 정보 (type='mcp' 시) */
  mcp?: {
    extensionName: string;
    serverName?: string;
  };
}
```

### 13.2 Catalog 구성 예시

```typescript
const toolCatalog: ToolCatalogItem[] = [
  // Config에서 로드된 Tool
  {
    name: 'bash__exec',
    description: '셸 명령 실행',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
      },
      required: ['command'],
    },
    source: { type: 'config', name: 'bash' },
  },

  // Extension에서 동적 등록된 Tool
  {
    name: 'weather__get',
    description: '특정 도시의 현재 날씨 정보를 조회합니다',
    parameters: { type: 'object', properties: {} },
    source: { type: 'extension', name: 'weather-ext' },
  },

  // MCP Extension에서 노출된 Tool
  {
    name: 'github__create_issue',
    description: 'GitHub 이슈를 생성합니다',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['repo', 'title'],
    },
    source: {
      type: 'mcp',
      name: 'mcp-github',
      mcp: { extensionName: 'mcp-github' },
    },
  },
];
```

---

## 14. 실전 Tool 구현 예시

### 14.1 파일 시스템 Tool

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: file-system
  labels:
    tier: base
spec:
  entry: "./tools/file-system/index.ts"
  errorMessageLimit: 2000
  exports:
    - name: read
      description: "파일 내용을 읽습니다"
      parameters:
        type: object
        properties:
          path:
            type: string
            description: "읽을 파일 경로"
          maxBytes:
            type: number
            description: "최대 읽기 바이트 (기본: 100000)"
        required: [path]

    - name: write
      description: "파일에 내용을 씁니다"
      parameters:
        type: object
        properties:
          path:
            type: string
            description: "쓸 파일 경로"
          content:
            type: string
            description: "작성할 내용"
        required: [path, content]
```

```typescript
// tools/file-system/index.ts
import type { ToolHandler, ToolContext, JsonValue } from '@goondan/core';
import { join, isAbsolute } from 'path';

export const handlers: Record<string, ToolHandler> = {
  'read': async (ctx: ToolContext, input: { path: string; maxBytes?: number }): Promise<JsonValue> => {
    const targetPath = isAbsolute(input.path)
      ? input.path
      : join(ctx.workdir, input.path);

    const file = Bun.file(targetPath);
    const exists = await file.exists();
    if (!exists) {
      throw new Error(`파일이 존재하지 않습니다: ${targetPath}`);
    }

    const maxBytes = input.maxBytes ?? 100_000;
    const text = await file.text();
    const truncated = text.length > maxBytes;

    return {
      path: targetPath,
      size: file.size,
      truncated,
      content: truncated ? text.slice(0, maxBytes) : text,
    };
  },

  'write': async (ctx: ToolContext, input: { path: string; content: string }): Promise<JsonValue> => {
    const targetPath = isAbsolute(input.path)
      ? input.path
      : join(ctx.workdir, input.path);

    await Bun.write(targetPath, input.content);
    const file = Bun.file(targetPath);

    return {
      path: targetPath,
      size: file.size,
      written: true,
    };
  },
};
```

### 14.2 HTTP Fetch Tool

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: http-fetch
  labels:
    tier: base
spec:
  entry: "./tools/http-fetch/index.ts"
  exports:
    - name: get
      description: "HTTP GET 요청을 수행합니다"
      parameters:
        type: object
        properties:
          url: { type: string, description: "요청 URL" }
          headers: { type: object, description: "요청 헤더" }
        required: [url]
    - name: post
      description: "HTTP POST 요청을 수행합니다"
      parameters:
        type: object
        properties:
          url: { type: string, description: "요청 URL" }
          body: { type: object, description: "요청 본문" }
          headers: { type: object, description: "요청 헤더" }
        required: [url]
```

---

## 15. 검증 체크리스트

| 항목 | 검증 내용 |
|------|----------|
| 스키마 검증 | `spec.entry` 존재, `spec.exports` 최소 1개 |
| 파일 존재 | entry 경로가 실제로 존재하는지 |
| 핸들러 export | `handlers` 객체가 export되는지 |
| export 매핑 | 각 export.name에 대응하는 handler가 있는지 |
| 이름 규칙 | Tool 리소스 이름과 export name에 `__`가 없는지 |
| 파라미터 스키마 | JSON Schema 형식이 유효한지 |

---

## 부록 A. 타입 정의 요약

공통 타입 요약은 `docs/specs/shared-types.md`를 참조한다.

---

## 부록 B. 관련 문서

- `docs/architecture.md`: 아키텍처 개요 (핵심 개념, 설계 패턴)
- `docs/specs/extension.md`: Extension 시스템 (동적 도구 등록, 미들웨어)
- `docs/specs/runtime.md`: Runtime 실행 모델 (Turn/Step, AgentProcess, 통합 이벤트 모델, IPC)
- `docs/specs/resources.md`: Config Plane 리소스 정의 (Tool 리소스 스키마)

---

**문서 버전**: v0.0.3
**최종 수정**: 2026-02-12
