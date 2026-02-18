# Tool API 레퍼런스

> Goondan에서 커스텀 도구를 만들기 위한 TypeScript 인터페이스 참조 문서.

[English version](./tool-api.md)

**함께 보기:**

- [Tool 시스템 (Explanation)](../explanation/tool-system.ko.md) -- 설계 배경과 아키텍처
- [Tool 작성하기 (How-to)](../how-to/write-a-tool.ko.md) -- 프로덕션 체크리스트
- [첫 Tool 만들기 (Tutorial)](../tutorials/02-build-your-first-tool.ko.md) -- 단계별 가이드

---

## 개요

Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위입니다. Tool은 AgentProcess(Bun) 안에 로드되어 인프로세스 JavaScript 함수 호출로 실행됩니다. 이 문서는 Tool 개발자가 구현해야 하는 핵심 TypeScript 인터페이스를 다룹니다.

---

## ToolHandler

모든 tool export가 구현해야 하는 함수 시그니처입니다.

```typescript
type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;
```

### 매개변수

| 매개변수 | 타입 | 설명 |
|---------|------|------|
| `ctx` | [`ToolContext`](#toolcontext) | 워크스페이스 경로, 로거, 런타임 API, 현재 tool call 메타데이터를 제공하는 실행 컨텍스트 |
| `input` | `JsonObject` | LLM이 전달한 인수. `spec.exports[].parameters`에 정의된 JSON Schema와 일치 |

### 반환값

핸들러는 `JsonValue` (또는 `Promise<JsonValue>`)를 반환해야 합니다. 반환된 값은 직렬화되어 LLM에 tool call 결과로 전달됩니다.

핸들러가 에러를 throw하면 런타임이 이를 캐치하여 `status: "error"`인 구조화된 [`ToolCallResult`](#toolcallresult)로 변환합니다. 에러는 절대 예외로 LLM에 전파되지 않습니다.

### 핸들러 모듈 형식

Tool 엔트리 모듈은 `handlers` 맵을 export해야 합니다. 각 키는 Tool 리소스의 `spec.exports`에 선언된 export 이름에 해당합니다.

```typescript
// tools/my-tool/index.ts
import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/types';
// 참고: ToolContext.runtime (AgentToolRuntime)은 @goondan/types에 정의되어 있지 않습니다.
// Runtime이 실행 시점에 ToolContext에 `runtime` 필드를 주입합니다.
// 핸들러에서 ctx.runtime이 존재할 때 안전하게 접근할 수 있습니다 (optional).

export const handlers: Record<string, ToolHandler> = {
  doSomething: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    // 구현
    return { result: 'done' };
  },
};
```

LLM에 노출되는 도구 이름은 **더블 언더스코어 네이밍 규칙**을 따릅니다: `{Tool 리소스 이름}__{export 이름}`. 예를 들어, Tool 리소스 이름이 `my-tool`이고 export가 `doSomething`이면 LLM에는 `my-tool__doSomething`으로 보입니다.

---

## ToolContext

모든 `ToolHandler` 호출에 전달되는 실행 컨텍스트입니다. `ToolContext`는 `ExecutionContext`를 확장합니다.

### ExecutionContext (기본)

```typescript
interface ExecutionContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly traceId: string;
}
```

| 프로퍼티 | 타입 | 설명 |
|---------|------|------|
| `agentName` | `string` | 이 도구를 실행하는 Agent 리소스의 이름 |
| `instanceKey` | `string` | 에이전트 인스턴스를 식별하는 고유 키 (예: `"telegram:12345"`) |
| `turnId` | `string` | 현재 Turn의 고유 ID |
| `traceId` | `string` | 관측성을 위한 분산 추적 ID |

### ToolContext 프로퍼티

```typescript
interface ToolContext extends ExecutionContext {
  readonly toolCallId: string;
  readonly message: Message;
  readonly workdir: string;
  readonly logger: Console;
  readonly runtime?: AgentToolRuntime;
}
```

| 프로퍼티 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `toolCallId` | `string` | Yes | 이 tool call의 고유 ID |
| `message` | `Message` | Yes | 이 tool call을 포함하는 assistant 메시지 |
| `workdir` | `string` | Yes | 인스턴스 워크스페이스 디렉토리 경로. 파일 시스템 도구(bash, file-system 등)는 이 경로를 기본 작업 디렉토리로 사용해야 합니다 |
| `logger` | `Console` | Yes | 진단 출력을 위한 구조화된 로거 (`Console` 인터페이스) |
| `runtime` | [`AgentToolRuntime`](#agenttoolruntime) | No | 에이전트 간 통신 API. **`@goondan/types`에 정의되어 있지 않으며**, Runtime이 실행 시점에 `ToolContext`에 주입합니다. 스웜 내 다른 에이전트와 상호작용이 필요한 도구에서 사용 |

### ToolContext 규칙

1. `workdir`은 인스턴스의 워크스페이스 경로를 가리켜야 합니다 (MUST).
2. 파일 시스템에 접근하는 도구는 `ctx.workdir`을 기본 작업 디렉토리로 사용해야 합니다 (MUST).
3. `ToolContext`에는 `swarmBundle`, `oauth` 같은 비소유 인터페이스를 포함해서는 안 됩니다 (MUST NOT).
4. `message`는 현재 tool call을 포함하는 assistant Message를 참조해야 합니다 (MUST).

---

## AgentToolRuntime

`ctx.runtime`을 통해 사용할 수 있는 에이전트 간 통신 API입니다. 스웜 내 다른 에이전트와 통신하기 위한 5가지 메서드를 제공합니다.

```typescript
interface AgentToolRuntime {
  request(
    target: string,
    event: AgentEvent,
    options?: AgentRuntimeRequestOptions
  ): Promise<AgentRuntimeRequestResult>;

  send(
    target: string,
    event: AgentEvent
  ): Promise<AgentRuntimeSendResult>;

  spawn(
    target: string,
    options?: AgentRuntimeSpawnOptions
  ): Promise<AgentRuntimeSpawnResult>;

  list(
    options?: AgentRuntimeListOptions
  ): Promise<AgentRuntimeListResult>;

  catalog(): Promise<AgentRuntimeCatalogResult>;
}
```

### request(target, event, options?)

다른 에이전트에 동기 요청을 보내고 응답을 기다립니다 (요청-응답 패턴).

| 매개변수 | 타입 | 설명 |
|---------|------|------|
| `target` | `string` | 대상 에이전트 이름 (예: `"coder"`) |
| `event` | `AgentEvent` | 입력 메시지를 포함하는 이벤트 페이로드 |
| `options` | `AgentRuntimeRequestOptions` | 선택. `{ timeoutMs?: number }` |

**반환:** `Promise<AgentRuntimeRequestResult>`

```typescript
interface AgentRuntimeRequestResult {
  eventId: string;        // 응답 이벤트 ID
  target: string;         // 대상 에이전트 이름
  response?: JsonValue;   // 대상 에이전트의 응답 페이로드
  correlationId: string;  // 추적 매칭을 위한 상관관계 ID
}
```

대상 에이전트가 존재하지 않으면 Orchestrator가 이벤트를 전달하기 전에 자동으로 스폰합니다.

### send(target, event)

다른 에이전트에 fire-and-forget 메시지를 보냅니다 (응답 없음).

| 매개변수 | 타입 | 설명 |
|---------|------|------|
| `target` | `string` | 대상 에이전트 이름 |
| `event` | `AgentEvent` | 입력 메시지를 포함하는 이벤트 페이로드 |

**반환:** `Promise<AgentRuntimeSendResult>`

```typescript
interface AgentRuntimeSendResult {
  eventId: string;   // 전송된 이벤트 ID
  target: string;    // 대상 에이전트 이름
  accepted: boolean; // 이벤트가 전달 수락되었는지 여부
}
```

### spawn(target, options?)

정의된 Agent 리소스의 새 인스턴스를 준비(스폰)합니다. 새로운 Agent 리소스를 생성하는 것이 아니라, 기존에 정의된 리소스의 인스턴스를 준비하는 것입니다.

| 매개변수 | 타입 | 설명 |
|---------|------|------|
| `target` | `string` | 대상 에이전트 이름 (현재 Swarm에 정의되어 있어야 함) |
| `options` | `AgentRuntimeSpawnOptions` | 선택. `{ instanceKey?: string, cwd?: string }` |

**반환:** `Promise<AgentRuntimeSpawnResult>`

```typescript
interface AgentRuntimeSpawnResult {
  target: string;       // 대상 에이전트 이름
  instanceKey: string;  // 확정된 인스턴스 키
  spawned: boolean;     // true이면 새 인스턴스 생성; false이면 기존 인스턴스 재사용
  cwd?: string;         // 지정된 경우 작업 디렉토리
}
```

**규칙:**

- `target`은 현재 Swarm에 정의된 Agent 리소스여야 합니다 (MUST).
- `spawn`은 런타임에 Agent 리소스 정의를 수정해서는 안 됩니다 (MUST NOT).
- 동일한 `instanceKey`를 가진 인스턴스가 이미 존재하면 재사용됩니다.

### list(options?)

에이전트 인스턴스 목록을 반환합니다.

| 매개변수 | 타입 | 설명 |
|---------|------|------|
| `options` | `AgentRuntimeListOptions` | 선택. `{ includeAll?: boolean }` |

**반환:** `Promise<AgentRuntimeListResult>`

```typescript
interface AgentRuntimeListResult {
  agents: SpawnedAgentInfo[];
}

interface SpawnedAgentInfo {
  target: string;           // Agent 리소스 이름
  instanceKey: string;      // 인스턴스 키
  ownerAgent: string;       // 이 인스턴스를 스폰한 에이전트
  ownerInstanceKey: string; // 소유자의 인스턴스 키
  createdAt: string;        // ISO 타임스탬프
  cwd?: string;             // 설정된 경우 작업 디렉토리
}
```

기본적으로 `list()`는 호출한 에이전트가 스폰한 인스턴스만 반환합니다. 스웜 내 전체 인스턴스를 조회하려면 `includeAll: true`를 설정하세요.

### catalog()

현재 Swarm의 사용 가능한 에이전트 카탈로그를 반환합니다.

**반환:** `Promise<AgentRuntimeCatalogResult>`

```typescript
interface AgentRuntimeCatalogResult {
  swarmName: string;         // 현재 Swarm 이름
  entryAgent: string;        // 스웜의 엔트리 에이전트
  selfAgent: string;         // 호출한 에이전트의 이름
  availableAgents: string[]; // 스웜에 정의된 모든 에이전트 이름
  callableAgents: string[];  // 호출한 에이전트가 통신할 수 있는 에이전트
}
```

---

## ToolCallResult

Tool call 실행의 구조화된 결과입니다.

```typescript
interface ToolCallResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output?: JsonValue;
  readonly status: 'ok' | 'error';
  readonly error?: ToolCallResultError;
}
```

| 프로퍼티 | 타입 | 설명 |
|---------|------|------|
| `toolCallId` | `string` | Tool call의 고유 ID (`ToolContext.toolCallId`와 일치) |
| `toolName` | `string` | 전체 도구 이름 (예: `"bash__exec"`) |
| `output` | `JsonValue` | 성공 시 핸들러의 반환값 |
| `status` | `'ok' \| 'error'` | 호출 성공 또는 실패 여부 |
| `error` | `ToolCallResultError` | `status`가 `'error'`일 때의 오류 상세 |

### ToolCallResultError

```typescript
interface ToolCallResultError {
  readonly name?: string;      // 오류 타입 이름 (예: "TypeError")
  readonly message: string;    // 오류 메시지 (errorMessageLimit 적용)
  readonly code?: string;      // 기계 판독 가능한 오류 코드 (예: "E_TOOL")
  readonly suggestion?: string; // LLM의 복구를 돕는 실행 가능한 제안
  readonly helpUrl?: string;   // 관련 문서 링크
}
```

**오류 처리 규칙:**

1. Tool 실행 오류는 예외를 throw하지 않고, `status: "error"`인 `ToolCallResult`로 반환해야 합니다 (MUST).
2. `error.message` 길이는 `Tool.spec.errorMessageLimit`(기본값: 1000자)에 의해 제한됩니다 (MUST).
3. LLM의 복구를 돕기 위해 `suggestion` 필드를 제공하는 것이 권장됩니다 (SHOULD).
4. 문서 링크를 위해 `helpUrl` 필드를 제공하는 것이 권장됩니다 (SHOULD).

---

## Tool 리소스 spec.parameters

각 tool export는 Tool 리소스 YAML에서 JSON Schema를 사용해 파라미터를 선언합니다.

### ToolExportSpec

```typescript
interface ToolExportSpec {
  /** Export 이름 (LLM tool call에서 "{리소스이름}__{name}"으로 사용) */
  name: string;

  /** LLM에 표시되는 설명 */
  description?: string;

  /** 파라미터를 정의하는 JSON Schema */
  parameters?: JsonSchemaObject;
}
```

### JSON Schema 형식

```typescript
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

### YAML 예제

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: my-tool
spec:
  entry: "./tools/my-tool/index.ts"
  errorMessageLimit: 1200
  exports:
    - name: search
      description: "쿼리로 항목을 검색합니다"
      parameters:
        type: object
        properties:
          query:
            type: string
            description: "검색 쿼리 문자열"
          limit:
            type: number
            description: "최대 결과 수 (기본값: 10)"
        required: [query]
```

전체 Tool 리소스 스키마는 [리소스 레퍼런스](./resources.ko.md)를 참조하세요.

---

## 보조 타입

### Json 타입

```typescript
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];
```

### Message

```typescript
interface Message {
  readonly id: string;
  readonly data: CoreMessage;       // AI SDK CoreMessage 래퍼
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

---

## 최소 Tool 예제

텍스트를 대문자로 변환하는 완전한 최소 Tool입니다:

**goondan.yaml (Tool 리소스)**

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: text-utils
spec:
  entry: "./tools/text-utils/index.ts"
  exports:
    - name: uppercase
      description: "텍스트를 대문자로 변환합니다"
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "변환할 텍스트"
        required: [text]
```

**tools/text-utils/index.ts**

```typescript
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';
// 참고: ctx.runtime (AgentToolRuntime)은 Runtime이 주입하며, @goondan/types에서 import하지 않습니다.

export const handlers: Record<string, ToolHandler> = {
  uppercase: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text);
    ctx.logger.info(`Converting "${text}" to uppercase`);
    return { result: text.toUpperCase() };
  },
};
```

LLM에는 이 도구가 `text-utils__uppercase`로 보입니다.

---

## 관련 문서

| 문서 | 관계 |
|------|------|
| [Tool 시스템 (Explanation)](../explanation/tool-system.ko.md) | 설계 배경: 더블 언더스코어 네이밍, Registry vs Catalog, 오류 전파 모델 |
| [Tool 작성하기 (How-to)](../how-to/write-a-tool.ko.md) | 프로덕션 체크리스트: 검증, 테스트, 오류 처리 모범 사례 |
| [첫 Tool 만들기 (Tutorial)](../tutorials/02-build-your-first-tool.ko.md) | 처음 Tool을 만드는 개발자를 위한 단계별 튜토리얼 |
| [내장 도구](./builtin-tools.ko.md) | `@goondan/base` 도구 카탈로그 (파라미터 상세 포함) |
| [리소스 레퍼런스](./resources.ko.md) | `kind: Tool`의 전체 YAML 스키마 |
| [Extension API 레퍼런스](./extension-api.ko.md) | `api.tools.register()`를 통한 동적 도구 등록 |

---

_레퍼런스 버전: v0.0.3_
