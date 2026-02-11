# Goondan Tool 시스템 스펙 v2.0

본 문서는 Goondan v2의 Tool 시스템을 정의한다. Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위이며, AgentProcess 내에서 실행된다.

> 기반 요구사항: `docs/requirements/05_core-concepts.md` §5.2, `docs/requirements/07_config-resources.md` §7.2, `docs/requirements/12_tool-spec-runtime.md`

---

## 1. 핵심 개념

### 1.1 Tool Registry vs Tool Catalog

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

### 1.2 Tool Identity

Tool의 identity는 `"{kind}/{name}"` 형식으로 표현된다.

```typescript
type ToolIdentity = `Tool/${string}`;

// 예시
const identity: ToolIdentity = "Tool/bash";
```

규칙:

1. AgentProcess는 Step마다 Tool Catalog를 구성해야 한다(MUST).
2. Tool Catalog는 Agent 리소스의 `spec.tools` 선언을 기반으로 초기화해야 한다(MUST).
3. Step 미들웨어는 `ctx.toolCatalog`를 조작하여 LLM에 노출되는 도구를 변경할 수 있다(MAY).
4. Extension이 `api.tools.register()`로 동적 등록한 도구도 Tool Registry에 포함되어야 한다(MUST).

---

## 2. Tool 리소스 스키마

### 2.1 YAML 정의

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
  labels:
    tier: base
spec:
  entry: "./tools/bash/index.ts"     # 필수: Bun으로 실행 (runtime 필드 없음)
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

### 2.2 ToolSpec TypeScript 인터페이스

```typescript
interface ToolSpec {
  /** 핸들러 모듈 경로 (프로젝트 루트 기준). 항상 Bun으로 실행. */
  entry: string;

  /** Tool 오류 메시지 최대 길이 (기본값: 1000) */
  errorMessageLimit?: number;

  /** LLM에 노출되는 함수 목록 */
  exports: ToolExportSpec[];
}
```

> **v2 변경**: `runtime` 필드 제거(항상 Bun), `auth` 필드 제거(OAuth는 Extension 내부 구현으로 이동).

### 2.3 검증 규칙

| 규칙 | 수준 | 설명 |
|------|------|------|
| `spec.entry` 필수 | MUST | 핸들러 모듈 경로가 반드시 존재해야 한다 |
| `spec.exports` 최소 1개 | MUST | 최소 하나의 export가 필요하다 |
| `exports[].name` 고유성 | MUST | Tool 리소스 내에서 export name이 고유해야 한다 |
| `__` 금지 (이름 내부) | MUST NOT | Tool 리소스 이름과 export name에는 `__`를 포함해서는 안 된다 |
| `errorMessageLimit` 기본값 | MUST | 미설정 시 1000자로 적용한다 |
| entry default export | MUST | entry 모듈에 `handlers: Record<string, ToolHandler>` export가 존재해야 한다 |

---

## 3. 도구 이름 규칙

### 3.1 네이밍 컨벤션

LLM에 노출되는 도구 이름은 **`{Tool 리소스 metadata.name}__{export name}`** 형식이어야 한다(MUST). 구분자는 `__`(더블 언더스코어)를 사용한다.

```
Tool 리소스: bash          → exports: exec, script
LLM 도구 이름: bash__exec, bash__script

Tool 리소스: file-system   → exports: read, write
LLM 도구 이름: file-system__read, file-system__write

Tool 리소스: http-fetch    → exports: get, post
LLM 도구 이름: http-fetch__get, http-fetch__post
```

### 3.2 규칙

1. 더블 언더스코어(`__`)를 리소스 이름과 하위 도구 이름의 구분자로 사용해야 한다(MUST).
2. AI SDK에서 허용되는 문자이므로 별도 인코딩/디코딩 없이 그대로 사용해야 한다(MUST).
3. Tool 리소스 이름과 하위 도구 이름 각각에는 `__`를 포함해서는 안 된다(MUST NOT).
4. 단일 export만 가진 Tool 리소스도 `{리소스명}__{export명}` 형식을 따라야 한다(MUST).

### 3.3 이름 파싱/조합

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

## 4. Tool Export 스키마

### 4.1 ToolExportSpec 인터페이스

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

### 4.2 Export 이름 규칙

- **식별자 규칙**: 영문 소문자, 숫자, `_`, `-`만 허용. `__`는 금지.
- **고유성**: 동일 Tool 리소스 내에서 중복될 수 없다(MUST).
- **예시**: `exec`, `script`, `read`, `write`, `list-channels`, `post_message`

---

## 5. ToolHandler 인터페이스

### 5.1 핸들러 시그니처

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

### 5.2 핸들러 모듈 형식

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

### 5.3 ToolContext 구조

```typescript
interface ToolContext {
  /** 현재 에이전트 이름 */
  readonly agentName: string;

  /** 현재 인스턴스 키 */
  readonly instanceKey: string;

  /** 현재 Turn ID */
  readonly turnId: string;

  /** 이 도구 호출의 고유 ID */
  readonly toolCallId: string;

  /** 이 도구 호출을 트리거한 Message */
  readonly message: Message;

  /** 인스턴스 작업 디렉토리 경로 */
  readonly workdir: string;

  /** 로거 */
  readonly logger: Console;
}
```

규칙:

1. `workdir`은 해당 인스턴스의 워크스페이스 경로를 가리켜야 한다(MUST).
2. bash, file-system 등 파일 시스템 접근 도구는 `ctx.workdir`을 기본 작업 디렉토리로 사용해야 한다(MUST).
3. ToolContext에는 `swarmBundle`, `oauth` 등 v1의 제거된 인터페이스를 포함해서는 안 된다(MUST NOT).
4. `message` 필드는 이 도구 호출을 포함하는 assistant Message를 참조해야 한다(MUST).

---

## 6. Tool 실행 흐름

### 6.1 Middleware 기반 파이프라인

v2에서는 모든 파이프라인 훅이 Middleware 형태로 통일된다. Tool 실행은 `toolCall` 미들웨어를 통과한다.

```
LLM 응답에 tool_calls 포함
           │
           ▼
┌──────────────────────────────────┐
│  toolCall 미들웨어 체인           │
│    Extension.before (next 전)    │  ← 입력 검증/변환
│      → CORE handler exec        │  ← 실제 핸들러 실행
│    Extension.after (next 후)     │  ← 결과 변환, 로깅
└──────────────────────────────────┘
           │
           ▼
    ToolResult → MessageEvent(append) 발행
```

### 6.2 ToolCall 구조

```typescript
interface ToolCall {
  /** tool call ID (LLM이 생성) */
  id: string;

  /** 호출할 tool 이름 (예: "bash__exec") */
  name: string;

  /** LLM이 전달한 인자 (JSON) */
  args: JsonObject;
}
```

### 6.3 ToolCallMiddlewareContext

```typescript
interface ToolCallMiddlewareContext {
  /** 호출 대상 도구 이름 */
  readonly toolName: string;

  /** tool call ID */
  readonly toolCallId: string;

  /** LLM이 전달한 인자 (변경 가능) */
  args: JsonObject;

  /** 미들웨어 메타데이터 */
  metadata: Record<string, JsonValue>;

  /** 다음 미들웨어 또는 핵심 핸들러 실행 */
  next(): Promise<ToolCallResult>;
}
```

### 6.4 Extension에서의 toolCall 미들웨어 등록

```typescript
// extension entry point
export function register(api: ExtensionApi): void {
  api.pipeline.register('toolCall', async (ctx) => {
    // next() 전 = 입력 검증/변환 (기존 toolCall.pre)
    api.logger.debug(`Tool 호출: ${ctx.toolName}`, ctx.args);

    const startTime = Date.now();
    const result = await ctx.next();
    const elapsed = Date.now() - startTime;

    // next() 후 = 결과 후처리 (기존 toolCall.post)
    api.logger.debug(`Tool 완료: ${ctx.toolName} (${elapsed}ms)`);

    return result;
  });
}
```

---

## 7. Tool Call 허용 범위

### 7.1 허용 범위 규칙

| 규칙 | 수준 | 설명 |
|------|------|------|
| Catalog 기반 허용 | MUST | Tool call의 기본 허용 범위는 현재 Step의 Tool Catalog여야 한다 |
| Catalog 외 거부 | MUST | Tool Catalog에 없는 도구 호출은 명시적 정책이 없는 한 거부해야 한다 |
| Registry 직접 호출 | MAY | Tool Registry 직접 호출 허용 모드는 명시적 보안 정책으로만 활성화할 수 있다 |
| 거부 결과 반환 | MUST | 거부 시 구조화된 ToolResult를 반환해야 한다 |

### 7.2 거부 시 반환 형식

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

## 8. Tool 결과 처리

### 8.1 ToolResult 구조

```typescript
interface ToolResult {
  /** 결과 상태 */
  status: 'ok' | 'error' | 'pending';

  /** 동기 완료 시 출력값 */
  output?: JsonValue;

  /** 비동기 제출 시 핸들 */
  handle?: string;

  /** 오류 정보 (status='error' 시) */
  error?: ToolError;
}

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

### 8.2 동기/비동기 결과

- **동기 완료**: 핸들러가 값을 반환하면 `output` 포함
- **비동기 제출**: `handle` 포함(완료 이벤트 또는 polling)

### 8.3 오류 결과 및 메시지 제한

AgentProcess는 Tool 실행 오류를 예외 전파 대신 ToolResult로 LLM에 전달해야 한다(MUST).

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

규칙:

1. `error.message` 길이는 `Tool.spec.errorMessageLimit`를 적용해야 한다(MUST).
2. 미설정 시 기본값은 1000자여야 한다(MUST).
3. 사용자 복구를 돕는 `suggestion` 필드를 제공하는 것을 권장한다(SHOULD).
4. 문서 링크(`helpUrl`) 제공을 권장한다(SHOULD).

### 8.4 오류 메시지 제한 구현

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

## 9. Handoff 도구 패턴

Agent 간 제어 이전(Handoff)을 Tool call로 구현하며, Orchestrator를 경유하는 IPC로 통신한다.

### 9.1 Handoff 흐름

```
1. Agent A가 handoff 도구를 호출
2. AgentProcess A → Orchestrator: { type: 'delegate', to: 'AgentB', payload: {...} }
3. Orchestrator → AgentProcess B로 라우팅 (필요시 스폰)
4. AgentProcess B 처리 후 → Orchestrator: { type: 'delegate_result', to: 'AgentA', ... }
5. Orchestrator → AgentProcess A에 결과 전달
```

### 9.2 IPC 메시지 형식

```typescript
interface IpcMessage {
  type: 'delegate' | 'delegate_result' | 'event' | 'shutdown';
  from: string;          // agentName
  to: string;            // agentName
  payload: JsonValue;
  correlationId?: string;
}
```

### 9.3 Handoff 규칙

| 규칙 | 수준 | 설명 |
|------|------|------|
| 대상+입력 포함 | MUST | handoff 요청은 대상 agent 이름과 입력 payload를 포함해야 한다 |
| 비동기 제출 | SHOULD | 비동기 제출 모델을 지원하는 것이 권장된다 |
| correlationId 추적 | MUST | 원래 Agent의 Turn/Trace 컨텍스트는 `correlationId`를 통해 추적 가능해야 한다 |
| 실패 시 에러 반환 | MUST | handoff 실패는 구조화된 ToolResult(`status="error"`)로 반환해야 한다 |
| 기본 구현체 | SHOULD | 기본 handoff 구현체를 `packages/base`에 제공하는 것이 권장된다 |
| 자동 스폰 | MUST | Orchestrator는 delegate 대상 AgentProcess가 존재하지 않으면 자동 스폰해야 한다 |

---

## 10. 동적 Tool 등록

### 10.1 api.tools.register

Extension에서 런타임에 Tool을 동적으로 등록할 수 있다.

```typescript
interface ExtensionApi {
  tools: {
    register(item: ToolCatalogItem, handler: ToolHandler): void;
  };
  // ... 기타 필드
}
```

### 10.2 동적 등록 예시

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

### 10.3 동적 Tool의 Catalog 노출

동적으로 등록된 Tool은 다음 Step의 Tool Catalog에 자동으로 포함된다. Step 미들웨어에서 `ctx.toolCatalog`를 통해 확인/변경할 수 있다.

---

## 11. ToolCatalogItem 구조

### 11.1 인터페이스 정의

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

### 11.2 Catalog 구성 예시

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

## 12. 실전 Tool 구현 예시

### 12.1 파일 시스템 Tool

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

### 12.2 HTTP Fetch Tool

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

## 13. 검증 체크리스트

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

```typescript
// 기본 JSON 타입
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

// Message (AI SDK CoreMessage 래퍼)
interface Message {
  readonly id: string;
  readonly data: CoreMessage;
  metadata: Record<string, JsonValue>;
  readonly createdAt: Date;
  readonly source: MessageSource;
}

// Tool 핸들러
type ToolHandler = (ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue;

// Tool 결과
interface ToolResult {
  status: 'ok' | 'error' | 'pending';
  output?: JsonValue;
  handle?: string;
  error?: ToolError;
}
```

---

## 부록 B. v1 → v2 변경 요약

| 항목 | v1 | v2 |
|------|----|----|
| `spec.runtime` | `node` (필수) | 제거 (항상 Bun) |
| `spec.auth` | OAuthApp 참조 | 제거 (Extension 내부 구현) |
| 도구 이름 구분자 | `.` (점) | `__` (더블 언더스코어) |
| ToolContext | `instance`, `swarm`, `agent`, `oauth`, `swarmBundle` 포함 | `agentName`, `instanceKey`, `turnId`, `toolCallId`, `message`, `workdir`, `logger` |
| apiVersion | `agents.example.io/v1alpha1` | `goondan.ai/v1` |
| 파이프라인 | `toolCall.pre` / `toolCall.exec` / `toolCall.post` (Mutator + Middleware) | `toolCall` 미들웨어 단일 통합 |
| Handoff | 인메모리 delegate | IPC (Orchestrator 경유) |

---

## 부록 C. 참고 문서

- `docs/requirements/05_core-concepts.md` §5.2: Tool 핵심 개념 정의
- `docs/requirements/07_config-resources.md` §7.2: Tool 리소스 스키마
- `docs/requirements/12_tool-spec-runtime.md`: Tool Registry, Catalog, 실행 모델
- `docs/specs/extension.md`: Extension 시스템 (동적 도구 등록, 미들웨어)
- `docs/specs/runtime.md`: Runtime 실행 모델 (Turn/Step, AgentProcess)

---

**문서 버전**: v2.0
**최종 수정**: 2026-02-12
