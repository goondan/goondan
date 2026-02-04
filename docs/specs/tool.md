# Goondan Tool 시스템 구현 스펙 (v0.8)

본 문서는 Goondan의 Tool 시스템을 정의한다. Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위이며, Runtime 컨텍스트 및 이벤트 시스템에 접근할 수 있다.

## 1. 핵심 개념

### 1.1 Tool Registry vs Tool Catalog

| 개념 | 설명 |
|------|------|
| **Tool Registry** | Runtime이 보유한 **실행 가능한 전체 도구 엔드포인트(핸들러 포함) 집합**. Tool 리소스 로딩 및 동적 등록(`api.tools.register`)으로 구성된다. |
| **Tool Catalog** | **특정 Step에서 LLM에 노출되는 도구 목록**. Runtime은 매 Step마다 `step.tools` 파이프라인을 통해 Tool Catalog를 구성한다. |

```
┌─────────────────────────────────────────────────────────────┐
│                      Tool Registry                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Tool A (exports: a.foo, a.bar)                      │  │
│  │  Tool B (exports: b.run)                             │  │
│  │  Dynamic Tool C (api.tools.register)                 │  │
│  │  MCP Extension D (tools: d.query, d.mutate)          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ step.tools 파이프라인
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Tool Catalog (Step N)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  a.foo, a.bar, b.run  (Agent.spec.tools에 선언된 것)   │  │
│  │  + Extension이 추가한 도구들                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Tool Identity

Tool의 identity는 `"{kind}/{name}"` 형식으로 표현된다.

```typescript
type ToolIdentity = `Tool/${string}`;

// 예시
const identity: ToolIdentity = "Tool/slackToolkit";
```

Runtime은 Effective Config의 `tools` 배열을 identity 기반으로 정규화하며, 동일 identity가 중복될 경우 마지막에 나타난 항목이 내용을 대표(last-wins)한다.

---

## 2. Tool 리소스 스키마

### 2.1 YAML 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: slackToolkit
  labels:                           # 선택
    tier: integration
spec:
  runtime: node                     # 필수: 런타임 환경
  entry: "./tools/slack/index.js"   # 필수: Bundle Package Root 기준 경로
  errorMessageLimit: 1200           # 선택: 오류 메시지 최대 길이 (기본값: 1000)

  # 선택: 이 Tool이 기본적으로 사용하는 OAuthApp
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write"]          # 선택: OAuthApp.spec.scopes의 부분집합

  # 필수: 최소 1개의 export
  exports:
    - name: slack.postMessage
      description: "채널에 메시지를 전송합니다"
      parameters:
        type: object
        properties:
          channel:
            type: string
            description: "대상 채널 ID"
          text:
            type: string
            description: "전송할 메시지 내용"
        required: ["channel", "text"]
      # 선택: export 레벨 auth (tool 레벨보다 좁게만 선언 가능)
      auth:
        scopes: ["chat:write"]

    - name: slack.listChannels
      description: "사용자가 접근 가능한 채널 목록을 조회합니다"
      parameters:
        type: object
        properties:
          limit:
            type: number
            description: "최대 조회 개수"
        required: []
      auth:
        scopes: ["channels:read"]
```

### 2.2 ToolSpec TypeScript 인터페이스

```typescript
interface ToolSpec {
  /** 런타임 환경 (현재 'node'만 지원) */
  runtime: 'node';

  /** 핸들러 모듈 경로 (Bundle Package Root 기준) */
  entry: string;

  /** Tool 오류 메시지 최대 길이 (기본값: 1000) */
  errorMessageLimit?: number;

  /** Tool 레벨 OAuth 설정 */
  auth?: ToolAuthSpec;

  /** LLM에 노출되는 함수 목록 */
  exports: ToolExportSpec[];
}

interface ToolAuthSpec {
  /** 참조할 OAuthApp */
  oauthAppRef: ObjectRef;

  /** OAuthApp.spec.scopes의 부분집합 (선택) */
  scopes?: string[];
}
```

### 2.3 검증 규칙

| 규칙 | 수준 | 설명 |
|------|------|------|
| `spec.entry` 필수 | MUST | 핸들러 모듈 경로가 반드시 존재해야 한다 |
| `spec.exports` 최소 1개 | MUST | 최소 하나의 export가 필요하다 |
| `auth.scopes` 부분집합 검증 | MUST | Tool/export의 `auth.scopes`는 `OAuthApp.spec.scopes`의 부분집합이어야 한다 |
| export `auth.scopes` 제한 | MUST | export 레벨 `auth.scopes`는 tool 레벨보다 좁게(부분집합)만 선언 가능하다 |
| `errorMessageLimit` 기본값 | MUST | 미설정 시 1000자로 적용한다 |

---

## 3. Tool Export 스키마

### 3.1 ToolExportSpec 인터페이스

```typescript
interface ToolExportSpec {
  /** export 이름 (LLM tool call의 name으로 사용) */
  name: string;

  /** LLM에 제공되는 도구 설명 */
  description?: string;

  /** JSON Schema 형식의 파라미터 정의 */
  parameters?: JsonSchemaObject;

  /** export 레벨 OAuth 설정 (선택) */
  auth?: {
    /** Tool 레벨 scopes의 부분집합 */
    scopes?: string[];
  };
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

### 3.2 Export 이름 규칙

- **권장 형식**: `<namespace>.<action>` (예: `slack.postMessage`, `file.read`)
- **고유성**: 동일 Agent 내에서 중복될 수 없다
- **식별자 규칙**: 영문 소문자, 숫자, `.`, `_`, `-`만 허용

---

## 4. ToolHandler 인터페이스

### 4.1 핸들러 시그니처

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

### 4.2 핸들러 모듈 형식

핸들러 모듈은 `handlers` 객체를 export해야 한다.

```typescript
// tools/calculator/index.ts
import type { ToolHandler, ToolContext, JsonValue } from '@goondan/core';

interface CalcInput {
  a: number;
  b: number;
}

export const handlers: Record<string, ToolHandler> = {
  'calc.add': async (ctx: ToolContext, input: CalcInput): Promise<JsonValue> => {
    const { a, b } = input;

    // 입력 검증
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new Error('a와 b는 숫자여야 합니다.');
    }

    return {
      result: a + b,
      expression: `${a} + ${b} = ${a + b}`,
    };
  },

  'calc.multiply': async (ctx: ToolContext, input: CalcInput): Promise<JsonValue> => {
    const { a, b } = input;
    return {
      result: a * b,
      expression: `${a} × ${b} = ${a * b}`,
    };
  },
};
```

### 4.3 ToolContext 구조

```typescript
interface ToolContext {
  /** SwarmInstance 참조 */
  instance: SwarmInstance;

  /** Swarm 리소스 정의 */
  swarm: Resource<SwarmSpec>;

  /** Agent 리소스 정의 */
  agent: Resource<AgentSpec>;

  /** 현재 Turn */
  turn: Turn;

  /** 현재 Step */
  step: Step;

  /** 현재 Step의 Tool Catalog */
  toolCatalog: ToolCatalogItem[];

  /** SwarmBundle 변경 API */
  swarmBundle: SwarmBundleApi;

  /** OAuth 토큰 접근 API */
  oauth: OAuthApi;

  /** 이벤트 버스 */
  events: EventBus;

  /** 로거 */
  logger: Console;
}
```

### 4.4 Turn/Step 참조

```typescript
interface Turn {
  id: string;
  instanceId: string;
  agentName: string;

  /** Turn 내 누적 메시지 */
  messages: LlmMessage[];

  /** Turn 내 누적 tool 결과 */
  toolResults: Map<string, ToolResult>;

  /** 호출 맥락 */
  origin?: {
    connector?: string;
    channel?: string;
    threadTs?: string;
    [key: string]: JsonValue;
  };

  /** 인증 컨텍스트 */
  auth?: TurnAuth;

  /** Turn 메타데이터 */
  metadata?: JsonObject;
}

interface Step {
  id: string;
  index: number;
  turnId: string;

  /** LLM 호출 결과 */
  llmResult?: LlmResult;

  /** 현재 Step에서 처리 중인 tool calls */
  pendingToolCalls?: ToolCall[];
}
```

---

## 5. Tool 실행 흐름

### 5.1 파이프라인 포인트

```
LLM 응답에 tool_calls 포함
           │
           ▼
┌─────────────────────────────┐
│  toolCall.pre (Mutator)     │  ← tool call 전처리, 입력 변환
└─────────────────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  toolCall.exec (Middleware) │  ← 실제 핸들러 실행 (onion 래핑)
│    EXT.before               │
│      → CORE handler exec    │
│    EXT.after                │
└─────────────────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  toolCall.post (Mutator)    │  ← 결과 후처리, 로깅
└─────────────────────────────┘
           │
           ▼
    ToolResult → Turn.messages
```

### 5.2 ToolCall 구조

```typescript
interface ToolCall {
  /** tool call ID (LLM이 생성) */
  id: string;

  /** 호출할 tool export name */
  name: string;

  /** LLM이 전달한 인자 (JSON) */
  arguments: JsonObject;
}
```

### 5.3 실행 컨텍스트 (toolCall.exec)

```typescript
interface ToolCallExecContext {
  /** 현재 tool call */
  toolCall: ToolCall;

  /** 실행 전까지는 undefined, 실행 후 채워짐 */
  toolResult?: ToolResult;

  /** Turn 참조 */
  turn: Turn;

  /** Step 참조 */
  step: Step;

  /** Effective Config */
  effectiveConfig: EffectiveConfig;

  /** 현재 Step의 Tool Catalog */
  toolCatalog: ToolCatalogItem[];
}
```

### 5.4 Extension에서의 파이프라인 등록

```typescript
// extensions/tool-logger/index.ts
export async function register(api: ExtensionApi): Promise<void> {
  // toolCall.pre: 입력 검증/변환
  api.pipelines.mutate('toolCall.pre', async (ctx) => {
    api.logger?.debug?.(`Tool 호출: ${ctx.toolCall.name}`, ctx.toolCall.arguments);
    return ctx;
  });

  // toolCall.exec: 실행 래핑 (타이밍, 재시도 등)
  api.pipelines.wrap('toolCall.exec', async (ctx, next) => {
    const startTime = Date.now();
    try {
      const result = await next(ctx);
      const elapsed = Date.now() - startTime;
      api.logger?.debug?.(`Tool 완료: ${ctx.toolCall.name} (${elapsed}ms)`);
      return result;
    } catch (error) {
      api.logger?.error?.(`Tool 실패: ${ctx.toolCall.name}`, error);
      throw error;
    }
  });

  // toolCall.post: 결과 로깅/변환
  api.pipelines.mutate('toolCall.post', async (ctx) => {
    if (ctx.toolResult?.status === 'error') {
      api.events.emit?.('tool.error', {
        toolName: ctx.toolCall.name,
        error: ctx.toolResult.error,
      });
    }
    return ctx;
  });
}
```

---

## 6. Tool 결과 처리

### 6.1 ToolResult 구조

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
}
```

### 6.2 동기 완료 결과

핸들러가 값을 반환하면 동기 완료로 처리된다.

```typescript
// 성공
{
  status: 'ok',
  output: {
    result: 42,
    expression: "6 × 7 = 42"
  }
}

// LLM 메시지로 변환
{
  role: 'tool',
  toolCallId: 'call_abc123',
  toolName: 'calc.multiply',
  output: { result: 42, expression: "6 × 7 = 42" }
}
```

### 6.3 비동기 제출 결과

장시간 작업의 경우 `handle`을 반환하고 이벤트로 완료를 통지할 수 있다.

```typescript
// Tool 핸들러
export const handlers: Record<string, ToolHandler> = {
  'build.start': async (ctx, input) => {
    const buildId = await startBuildAsync(input.project);

    // 비동기 완료를 위한 핸들 반환
    return {
      __async: true,
      handle: buildId,
      message: '빌드가 시작되었습니다. 완료되면 알려드리겠습니다.',
    };
  },
};

// 결과
{
  status: 'pending',
  handle: 'build-12345',
  output: { message: '빌드가 시작되었습니다...' }
}
```

---

## 7. Tool 오류 처리

### 7.1 오류 처리 규칙 (MUST)

1. **예외 전파 금지**: Runtime은 Tool 실행 중 오류가 발생하면 예외를 외부로 전파하지 않고, `ToolResult.output`에 오류 정보를 포함하여 LLM에 전달해야 한다.

2. **메시지 길이 제한**: `error.message`는 `Tool.spec.errorMessageLimit` 길이 제한을 적용한다. 미설정 시 기본값은 1000자이다.

3. **오류 결과 형식**:

```json
{
  "status": "error",
  "error": {
    "message": "요청 실패: 채널을 찾을 수 없습니다 (channel_not_found)",
    "name": "SlackApiError",
    "code": "E_CHANNEL_NOT_FOUND"
  }
}
```

### 7.2 오류 메시지 제한 구현

```typescript
function truncateErrorMessage(message: string, limit: number): string {
  if (message.length <= limit) {
    return message;
  }

  const truncationSuffix = '... (truncated)';
  const maxContentLength = limit - truncationSuffix.length;

  return message.slice(0, maxContentLength) + truncationSuffix;
}

function createToolErrorResult(
  error: Error,
  tool: Resource<ToolSpec>
): ToolResult {
  const limit = tool.spec.errorMessageLimit ?? 1000;

  return {
    status: 'error',
    error: {
      message: truncateErrorMessage(error.message, limit),
      name: error.name,
      code: (error as { code?: string }).code,
    },
  };
}
```

### 7.3 핸들러에서의 오류 처리 패턴

```typescript
export const handlers: Record<string, ToolHandler> = {
  'api.call': async (ctx, input) => {
    try {
      const response = await fetch(input.url);

      if (!response.ok) {
        // 명시적 오류 반환 (throw 대신)
        throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      // Runtime이 오류를 catch하고 ToolResult로 변환
      throw error;
    }
  },
};
```

---

## 8. OAuth 통합

### 8.1 ctx.oauth.getAccessToken

Tool에서 OAuth 토큰이 필요한 경우 `ctx.oauth.getAccessToken`을 사용한다.

```typescript
interface OAuthApi {
  getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
}

interface OAuthTokenRequest {
  /** 참조할 OAuthApp */
  oauthAppRef: ObjectRef;

  /** OAuthApp.spec.scopes의 부분집합 (선택) */
  scopes?: string[];

  /** 만료 임박 판단 기준 (초) */
  minTtlSeconds?: number;
}

type OAuthTokenResult =
  | OAuthTokenReady
  | OAuthAuthorizationRequired
  | OAuthTokenError;

interface OAuthTokenReady {
  status: 'ready';
  accessToken: string;
  tokenType: string;
  expiresAt?: string;
  scopes: string[];
}

interface OAuthAuthorizationRequired {
  status: 'authorization_required';
  authSessionId: string;
  authorizationUrl: string;
  expiresAt: string;
  message: string;
}

interface OAuthTokenError {
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}
```

### 8.2 OAuth 통합 Tool 구현 예시

```typescript
// tools/slack/index.ts
import type { ToolHandler, ToolContext, JsonValue } from '@goondan/core';

interface PostMessageInput {
  channel: string;
  text: string;
}

export const handlers: Record<string, ToolHandler> = {
  'slack.postMessage': async (
    ctx: ToolContext,
    input: PostMessageInput
  ): Promise<JsonValue> => {
    // 1. OAuth 토큰 획득
    const tokenResult = await ctx.oauth.getAccessToken({
      oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      scopes: ['chat:write'],
    });

    // 2. 승인 필요 시 안내 반환
    if (tokenResult.status === 'authorization_required') {
      return {
        status: 'authorization_required',
        message: tokenResult.message,
        authorizationUrl: tokenResult.authorizationUrl,
      };
    }

    // 3. 오류 시 throw
    if (tokenResult.status === 'error') {
      throw new Error(tokenResult.error.message);
    }

    // 4. API 호출
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: input.channel,
        text: input.text,
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(`Slack API 오류: ${result.error}`);
    }

    return {
      ok: true,
      channel: result.channel,
      ts: result.ts,
      message: result.message,
    };
  },
};
```

### 8.3 OAuth 흐름 다이어그램

```
Tool 실행
    │
    ▼
ctx.oauth.getAccessToken({ oauthAppRef, scopes })
    │
    ├── Grant 존재 + 토큰 유효 ──────────────────────┐
    │                                                │
    ├── Grant 없음 / 토큰 무효 / 스코프 불충분       ▼
    │                                         status: 'ready'
    ▼                                         accessToken: '***'
AuthSession 생성                                    │
status: 'authorization_required'                    │
authorizationUrl: 'https://...'                     │
    │                                               ▼
    ▼                                          API 호출
Tool 결과로 사용자에게 안내                          │
(에이전트가 승인 링크 전달)                          ▼
    │                                          결과 반환
    ▼
사용자가 승인 완료
    │
    ▼
Runtime callback 처리
    │
    ▼
OAuthGrant 저장 + auth.granted 이벤트
    │
    ▼
다음 Turn에서 다시 Tool 호출 시 토큰 사용 가능
```

---

## 9. 동적 Tool 등록

### 9.1 api.tools.register

Extension에서 런타임에 Tool을 등록할 수 있다.

```typescript
interface DynamicToolDefinition {
  /** Tool 이름 */
  name: string;

  /** LLM에 제공되는 설명 */
  description?: string;

  /** JSON Schema 파라미터 */
  parameters?: JsonSchemaObject;

  /** 핸들러 함수 */
  handler: ToolHandler;
}
```

### 9.2 동적 등록 예시

```typescript
// extensions/weather/index.ts
export async function register(api: ExtensionApi): Promise<void> {
  // 동적 Tool 등록
  api.tools.register({
    name: 'weather.get',
    description: '특정 도시의 현재 날씨 정보를 조회합니다',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '도시 이름 (예: Seoul, Tokyo)',
        },
        units: {
          type: 'string',
          enum: ['metric', 'imperial'],
          description: '온도 단위',
        },
      },
      required: ['city'],
    },
    handler: async (ctx, input) => {
      const city = String(input.city);
      const units = String(input.units || 'metric');

      const response = await fetch(
        `https://api.weather.example/v1/current?city=${encodeURIComponent(city)}&units=${units}`
      );

      if (!response.ok) {
        throw new Error(`날씨 API 오류: ${response.status}`);
      }

      return await response.json();
    },
  });
}
```

### 9.3 동적 Tool의 Catalog 노출

동적으로 등록된 Tool은 다음 Step의 Tool Catalog에 포함된다.

```typescript
// step.tools 파이프라인에서 동적 Tool 추가
api.pipelines.mutate('step.tools', async (ctx) => {
  const catalog = [...ctx.toolCatalog];

  // Extension이 등록한 동적 Tool 추가
  for (const dynamicTool of ctx.instance.dynamicTools) {
    catalog.push({
      name: dynamicTool.name,
      description: dynamicTool.description,
      parameters: dynamicTool.parameters,
      source: { type: 'extension', name: api.extension.metadata.name },
    });
  }

  return { ...ctx, toolCatalog: catalog };
});
```

---

## 10. ToolCatalogItem 구조

### 10.1 인터페이스 정의

```typescript
interface ToolCatalogItem {
  /** LLM에 노출되는 Tool 이름 */
  name: string;

  /** LLM에 제공되는 설명 */
  description?: string;

  /** JSON Schema 파라미터 */
  parameters?: JsonSchemaObject;

  /** 원본 Tool 리소스 (동적 등록 시 null) */
  tool?: Resource<ToolSpec> | null;

  /** 원본 Export 정의 (동적 등록 시 null) */
  export?: ToolExportSpec | null;

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

### 10.2 Catalog 구성 예시

```typescript
// Step N의 Tool Catalog 예시
const toolCatalog: ToolCatalogItem[] = [
  // Config에서 로드된 Tool
  {
    name: 'slack.postMessage',
    description: '채널에 메시지를 전송합니다',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['channel', 'text'],
    },
    tool: slackToolkitResource,
    export: slackToolkitResource.spec.exports[0],
    source: { type: 'config', name: 'slackToolkit' },
  },

  // Extension에서 동적 등록된 Tool
  {
    name: 'skills.list',
    description: '사용 가능한 스킬 목록을 조회합니다',
    parameters: { type: 'object', properties: {} },
    tool: null,
    export: null,
    source: { type: 'extension', name: 'skills' },
  },

  // MCP Extension에서 노출된 Tool
  {
    name: 'github.createIssue',
    description: 'GitHub 이슈를 생성합니다',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['repo', 'title'],
    },
    tool: null,
    export: null,
    source: {
      type: 'mcp',
      name: 'mcp-github',
      mcp: { extensionName: 'mcp-github' },
    },
  },
];
```

---

## 11. 실전 Tool 구현 예시

### 11.1 파일 읽기 Tool

```yaml
# tools/file/tool.yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: fileToolkit
spec:
  runtime: node
  entry: "./tools/file/index.js"
  errorMessageLimit: 2000
  exports:
    - name: file.read
      description: "파일 내용을 읽습니다"
      parameters:
        type: object
        properties:
          path:
            type: string
            description: "읽을 파일 경로"
          encoding:
            type: string
            description: "인코딩 (기본: utf8)"
          maxBytes:
            type: number
            description: "최대 읽기 바이트 (기본: 100000)"
        required: ["path"]

    - name: file.write
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
          encoding:
            type: string
            description: "인코딩 (기본: utf8)"
        required: ["path", "content"]
```

```typescript
// tools/file/index.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolHandler, ToolContext, JsonValue } from '@goondan/core';

interface FileReadInput {
  path: string;
  encoding?: BufferEncoding;
  maxBytes?: number;
}

interface FileWriteInput {
  path: string;
  content: string;
  encoding?: BufferEncoding;
}

export const handlers: Record<string, ToolHandler> = {
  'file.read': async (ctx: ToolContext, input: FileReadInput): Promise<JsonValue> => {
    const targetPath = String(input.path || '');

    if (!targetPath) {
      throw new Error('path가 필요합니다.');
    }

    // 상대 경로를 절대 경로로 변환
    const resolved = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(process.cwd(), targetPath);

    // 파일 존재 확인
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw new Error(`${resolved}는 파일이 아닙니다.`);
    }

    // 파일 읽기
    const encoding = input.encoding || 'utf8';
    const maxBytes = input.maxBytes ?? 100_000;
    const content = await fs.readFile(resolved, encoding);

    // 크기 제한
    const truncated = content.length > maxBytes;
    const finalContent = truncated ? content.slice(0, maxBytes) : content;

    return {
      path: resolved,
      size: stat.size,
      truncated,
      content: finalContent,
    };
  },

  'file.write': async (ctx: ToolContext, input: FileWriteInput): Promise<JsonValue> => {
    const targetPath = String(input.path || '');
    const content = String(input.content || '');

    if (!targetPath) {
      throw new Error('path가 필요합니다.');
    }

    const resolved = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(process.cwd(), targetPath);

    const encoding = input.encoding || 'utf8';

    // 디렉터리 생성
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    // 파일 쓰기
    await fs.writeFile(resolved, content, encoding);

    const stat = await fs.stat(resolved);

    return {
      path: resolved,
      size: stat.size,
      written: true,
    };
  },
};
```

### 11.2 SwarmBundle 변경 Tool

```typescript
// tools/bundle/index.ts
import type { ToolHandler, ToolContext, JsonValue } from '@goondan/core';

export const handlers: Record<string, ToolHandler> = {
  'swarmBundle.openChangeset': async (
    ctx: ToolContext,
    input: { reason?: string }
  ): Promise<JsonValue> => {
    // SwarmBundleApi를 통해 changeset 열기
    const result = await ctx.swarmBundle.openChangeset({
      reason: input.reason,
    });

    return result;
  },

  'swarmBundle.commitChangeset': async (
    ctx: ToolContext,
    input: { changesetId: string; message?: string }
  ): Promise<JsonValue> => {
    // SwarmBundleApi를 통해 changeset 커밋
    const result = await ctx.swarmBundle.commitChangeset({
      changesetId: input.changesetId,
      message: input.message,
    });

    return result;
  },
};
```

---

## 12. 검증 및 디버깅

### 12.1 Tool 검증 체크리스트

| 항목 | 검증 내용 |
|------|----------|
| 스키마 검증 | `spec.entry` 존재, `spec.exports` 최소 1개 |
| 파일 존재 | entry 경로가 실제로 존재하는지 |
| 핸들러 export | `handlers` 객체가 export되는지 |
| export 매핑 | 각 export.name에 대응하는 handler가 있는지 |
| OAuth 스코프 | auth.scopes가 OAuthApp.spec.scopes의 부분집합인지 |
| 파라미터 스키마 | JSON Schema 형식이 유효한지 |

### 12.2 런타임 디버깅

```typescript
// 디버그 로깅 Extension
export async function register(api: ExtensionApi): Promise<void> {
  api.pipelines.wrap('toolCall.exec', async (ctx, next) => {
    const { toolCall } = ctx;

    console.log('[Tool] 호출:', {
      name: toolCall.name,
      arguments: toolCall.arguments,
      turnId: ctx.turn.id,
      stepIndex: ctx.step.index,
    });

    const startTime = Date.now();
    const result = await next(ctx);
    const elapsed = Date.now() - startTime;

    console.log('[Tool] 완료:', {
      name: toolCall.name,
      status: ctx.toolResult?.status,
      elapsed: `${elapsed}ms`,
    });

    return result;
  });
}
```

---

## 부록 A. 타입 정의 요약

```typescript
// 기본 JSON 타입
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

// 리소스 참조
type ObjectRef = { kind: string; name: string; apiVersion?: string };
type ObjectRefLike = string | ObjectRef;

// LLM 메시지
type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; output: JsonValue };

// Tool 핸들러
type ToolHandler = (ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue;

// Tool 결과
type ToolResult = {
  status: 'ok' | 'error' | 'pending';
  output?: JsonValue;
  handle?: string;
  error?: ToolError;
};
```

---

## 부록 B. 참고 문서

- @docs/requirements/05_core-concepts.md: Tool 핵심 개념 정의
- @docs/requirements/07_config-resources.md: Tool 리소스 스키마
- @docs/requirements/12_tool-spec-runtime.md: Tool Registry, Catalog, 실행 모델
- @docs/specs/api.md: Runtime/SDK API 스펙
- @docs/specs/bundle.md: Bundle YAML 스펙
