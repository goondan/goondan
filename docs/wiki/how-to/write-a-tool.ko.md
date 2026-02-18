# Tool 작성 가이드

> **프로덕션 품질의 커스텀 Tool을 만들기 위한 체크리스트.**

[English version](./write-a-tool.md)

**함께 참고:**

- [Tool API 레퍼런스](../reference/tool-api.ko.md) -- 전체 TypeScript 인터페이스
- [Tool 시스템 이해](../explanation/tool-system.ko.md) -- 설계 철학과 아키텍처
- [첫 Tool 만들기 (튜토리얼)](../tutorials/02-build-your-first-tool.ko.md) -- 단계별 초보자 가이드

---

## 사전 준비

시작 전에 다음을 확인하세요:

- Goondan 프로젝트가 초기화되어 있어야 합니다 (`gdn init`)
- `goondan.yaml` 파일에 최소 `Package` 리소스가 있어야 합니다
- Bun이 설치되어 있어야 합니다 (Tool은 AgentProcess에서 Bun으로 실행됩니다)
- [더블 언더스코어 네이밍 규칙](../explanation/tool-system.ko.md#더블-언더스코어-네이밍-규칙)을 이해하고 있어야 합니다

---

## 1단계: YAML에 Tool 리소스 정의

`goondan.yaml`에 `kind: Tool` 문서를 작성합니다. 모든 Tool 리소스는 `name`, 핸들러 모듈을 가리키는 `entry`, 그리고 최소 1개의 `export`가 필요합니다.

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: weather          # 리소스 이름 (더블 언더스코어 금지)
spec:
  entry: "./tools/weather/index.ts"   # 핸들러 모듈 경로 (프로젝트 루트 기준)
  errorMessageLimit: 1500             # 선택: 오류 메시지 최대 길이 (기본값: 1000)

  exports:
    - name: forecast                  # export 이름 (더블 언더스코어 금지)
      description: "도시의 날씨 예보를 가져옵니다"
      parameters:
        type: object
        properties:
          city:
            type: string
            description: "도시 이름 (예: Seoul, Tokyo, New York)"
          days:
            type: number
            description: "예보 일수 (기본값: 3)"
        required: [city]

    - name: current
      description: "도시의 현재 날씨 상태를 가져옵니다"
      parameters:
        type: object
        properties:
          city:
            type: string
            description: "도시 이름"
        required: [city]
```

LLM에는 `weather__forecast`와 `weather__current`로 노출됩니다.

### 네이밍 규칙 체크리스트

- [ ] 리소스 이름은 소문자, 숫자, 하이픈만 포함
- [ ] 리소스 이름에 `__`가 포함되지 **않음**
- [ ] export 이름에 `__`가 포함되지 **않음**
- [ ] export 이름이 동일 Tool 리소스 내에서 고유
- [ ] 각 export에 명확한 `description` 작성 (LLM이 이를 기반으로 도구 호출 여부를 결정합니다)

> 전체 Tool YAML 스키마는 [리소스 레퍼런스 -- Tool](../reference/resources.ko.md#tool)을 참고하세요.

---

## 2단계: JSON Schema 파라미터 작성

좋은 JSON Schema 정의는 LLM이 정확한 입력을 제공하는 데 도움을 줍니다. 다음 모범 사례를 따르세요:

### description을 명확하게 작성

```yaml
parameters:
  type: object
  properties:
    query:
      type: string
      description: "검색 쿼리. 자연어 사용. 최대 200자."
    limit:
      type: number
      description: "반환할 최대 결과 수 (1-100, 기본값: 10)"
    format:
      type: string
      description: "출력 형식"
      enum: [json, csv, text]
  required: [query]
```

### 제한된 값에 `enum` 사용

파라미터에 유효한 값의 집합이 정해져 있다면 `enum`을 사용하세요. LLM이 잘못된 입력을 만들어내는 것을 방지합니다:

```yaml
mode:
  type: string
  description: "처리 모드"
  enum: [fast, balanced, thorough]
```

### `required`는 신중하게 사용

도구가 진정으로 해당 파라미터 없이는 동작할 수 없는 경우에만 `required`로 표시하세요. 합리적인 기본값을 가진 선택 파라미터는 LLM의 사용을 더 편하게 만듭니다.

### 깊은 중첩 스키마 지양

LLM은 평면적이거나 얕은 객체 구조를 깊게 중첩된 것보다 더 안정적으로 처리합니다. 3단계 이상 중첩이 필요하다면 별도의 export로 분리하는 것을 고려하세요.

---

## 3단계: ToolHandler 구현

`spec.entry`에 지정된 경로에 핸들러 모듈을 만듭니다. 모듈은 export 이름을 핸들러 함수에 매핑하는 `handlers` 객체를 export해야 합니다.

```typescript
// tools/weather/index.ts
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';

export const handlers: Record<string, ToolHandler> = {
  forecast: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const city = String(input.city);
    const days = typeof input.days === 'number' ? input.days : 3;

    ctx.logger.info(`${city}의 ${days}일 예보 가져오는 중`);

    const response = await fetch(
      `https://api.weather.example/v1/forecast?city=${encodeURIComponent(city)}&days=${days}`
    );

    if (!response.ok) {
      throw new Error(
        `날씨 API가 ${response.status}를 반환했습니다: ${response.statusText}`
      );
    }

    const data = await response.json();
    return {
      city,
      days,
      forecast: data.forecast,
    };
  },

  current: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const city = String(input.city);

    const response = await fetch(
      `https://api.weather.example/v1/current?city=${encodeURIComponent(city)}`
    );

    if (!response.ok) {
      throw new Error(
        `날씨 API가 ${response.status}를 반환했습니다: ${response.statusText}`
      );
    }

    const data = await response.json();
    return {
      city,
      temperature: data.temperature,
      conditions: data.conditions,
      humidity: data.humidity,
    };
  },
};
```

### 핸들러 구현 체크리스트

- [ ] 모듈이 `handlers: Record<string, ToolHandler>` 타입의 객체를 export
- [ ] `handlers`의 각 키가 YAML의 export `name`과 일치
- [ ] 핸들러가 `(ctx: ToolContext, input: JsonObject)`를 받아 `Promise<JsonValue> | JsonValue`를 반환
- [ ] 입력 파라미터를 사용 전에 검증/변환 (LLM의 raw 입력을 맹목적으로 신뢰하지 말 것)
- [ ] 파일 시스템 작업 시 `ctx.workdir`을 기본 디렉토리로 사용
- [ ] 진단 로깅에 `ctx.logger` 사용 (`console.log` 대신)

---

## 4단계: ToolContext 활용

`ToolContext`는 필수 런타임 서비스를 제공합니다. 각 필드의 사용법은 다음과 같습니다:

### `ctx.workdir` -- 인스턴스 워크스페이스

파일 작업의 기본 작업 디렉토리로 사용합니다. 이를 통해 각 에이전트 인스턴스의 데이터가 격리됩니다.

```typescript
import { join, isAbsolute } from 'path';

const targetPath = isAbsolute(input.path)
  ? input.path
  : join(ctx.workdir, String(input.path));
```

### `ctx.logger` -- 구조화된 로깅

`console.log` 대신 logger를 사용하세요. 로그 출력은 프로세스별로 캡처되어 `gdn logs`로 확인할 수 있습니다.

```typescript
ctx.logger.info('처리 시작', { city: input.city });
ctx.logger.warn('Rate limit에 근접');
ctx.logger.error('API 호출 실패', { status: response.status });
```

### `ctx.runtime` -- 에이전트 간 통신

도구가 다른 에이전트와 통신해야 하는 경우 `runtime` API를 사용합니다. 주로 내장 `agents` Tool에서 사용되지만, 커스텀 Tool에서도 활용할 수 있습니다.

```typescript
if (ctx.runtime) {
  const result = await ctx.runtime.request('analyst', {
    type: 'agent.event',
    name: 'analyze',
    message: { type: 'text', text: '이 데이터를 분석해주세요...' },
  });
  return { analysis: result.response };
}
```

### `ctx.toolCallId`와 `ctx.message`

`toolCallId`는 로그 항목 상관 관계에, `message`는 현재 assistant turn에 대한 컨텍스트가 필요할 때 사용합니다.

> 전체 `ToolContext` 및 `AgentToolRuntime` API 상세는 [Tool API 레퍼런스](../reference/tool-api.ko.md#toolcontext)를 참고하세요.

---

## 5단계: 오류를 올바르게 처리

Goondan은 throw된 오류를 `status: "error"`인 구조화된 `ToolCallResult` 객체로 변환합니다. LLM이 이 결과를 받아 복구를 시도할 수 있습니다. 오류를 직접 catch할 필요 없이, 문제가 발생하면 단순히 `throw`하세요.

### 설명적인 오류를 throw

```typescript
// 좋음: 컨텍스트가 포함된 설명적 오류
throw new Error(
  `파일을 찾을 수 없습니다: ${targetPath}. 워크스페이스에 파일이 있는지 확인하세요.`
);

// 나쁨: 모호한 오류
throw new Error('문제가 발생했습니다');
```

### `suggestion`과 `helpUrl` 패턴 사용

LLM이 복구할 수 있는 오류의 경우, 복구 힌트가 포함된 커스텀 오류를 만드세요. 런타임은 throw된 오류의 `suggestion`과 `helpUrl` 프로퍼티를 확인합니다:

```typescript
function createToolError(
  message: string,
  options?: { suggestion?: string; helpUrl?: string; code?: string }
): Error {
  const error = new Error(message);
  if (options?.suggestion) {
    (error as Error & { suggestion: string }).suggestion = options.suggestion;
  }
  if (options?.helpUrl) {
    (error as Error & { helpUrl: string }).helpUrl = options.helpUrl;
  }
  if (options?.code) {
    (error as Error & { code: string }).code = options.code;
  }
  return error;
}

// 사용 예
throw createToolError('Rate limit 초과 (429)', {
  code: 'E_RATE_LIMIT',
  suggestion: '30초 후에 다시 시도하세요.',
  helpUrl: 'https://api.weather.example/docs/rate-limits',
});
```

결과적인 `ToolCallResult`에 이 필드들이 포함되어, LLM이 정보에 기반한 판단을 내릴 수 있습니다.

### 오류 메시지 길이

오류 메시지는 `spec.errorMessageLimit` (기본값: 1000자)에 따라 잘립니다. 장황한 오류 출력을 생성할 수 있는 Tool (예: bash 명령)의 경우 이 제한을 늘리세요:

```yaml
spec:
  errorMessageLimit: 2000
```

### 오류 처리 체크리스트

- [ ] 오류는 조용히 삼키지 않고 throw
- [ ] 오류 메시지가 설명적이며 관련 컨텍스트 포함 (파일 경로, 상태 코드 등)
- [ ] 복구 가능한 오류에 `suggestion` 텍스트 포함
- [ ] 장황한 출력이 예상되는 Tool에 `errorMessageLimit` 조정
- [ ] 외부 API 오류에 HTTP 상태 코드 포함

---

## 6단계: Agent에 Tool 등록

`goondan.yaml`에서 Agent의 `spec.tools`에 Tool을 추가합니다:

### 로컬 Tool (같은 프로젝트)

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  tools:
    - ref: "Tool/weather"           # 로컬 Tool 문자열 축약형
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"    # 내장 Tool 크로스 패키지 참조
```

### `@goondan/base` 패키지의 Tool 참조

내장 Tool과 커스텀 Tool을 함께 사용하려면:

```yaml
tools:
  - ref: "Tool/weather"                # 커스텀 Tool
  - ref:
      kind: Tool
      name: bash
      package: "@goondan/base"
  - ref:
      kind: Tool
      name: file-system
      package: "@goondan/base"
  - ref:
      kind: Tool
      name: http-fetch
      package: "@goondan/base"
```

> ObjectRef 구문의 전체 상세는 [리소스 레퍼런스 -- ObjectRef](../reference/resources.ko.md#objectref)를 참고하세요.

---

## 7단계: 설정 검증

Swarm을 시작하기 전에 `gdn validate`로 Tool 설정을 검증합니다:

```bash
gdn validate
```

검증 항목:

- `spec.entry` 경로가 디스크에 존재하는지
- `spec.exports`에 최소 1개의 항목이 있는지
- export 이름이 고유하고 `__`를 포함하지 않는지
- entry 모듈이 `handlers` 객체를 export하는지
- 각 export 이름에 대응하는 handler가 있는지

`gdn run`을 실행하기 전에 모든 오류를 수정하세요.

---

## 8단계: Tool 테스트

### 핸들러 직접 단위 테스트

핸들러는 순수 함수이므로, 전체 런타임을 구동하지 않고 직접 테스트할 수 있습니다:

```typescript
import { describe, test, expect, mock } from 'bun:test';
import { handlers } from './tools/weather/index.ts';

describe('weather tool', () => {
  const mockContext = {
    toolCallId: 'test-call-1',
    agentName: 'test-agent',
    instanceKey: 'test-instance',
    turnId: 'test-turn',
    traceId: 'test-trace',
    workdir: '/tmp/test-workspace',
    logger: console,
    message: {
      id: 'msg-1',
      data: { role: 'assistant', content: '' },
      metadata: {},
      createdAt: new Date(),
      source: { type: 'assistant', stepId: 'step-1' },
    },
  };

  test('forecast가 예보 데이터를 반환', async () => {
    // fetch를 모킹하거나 테스트 API 사용
    const result = await handlers.forecast(mockContext, {
      city: 'Seoul',
      days: 3,
    });
    expect(result).toHaveProperty('city', 'Seoul');
    expect(result).toHaveProperty('forecast');
  });

  test('잘못된 API 응답 시 forecast가 에러를 throw', async () => {
    // 준비: fetch를 500 반환하도록 모킹
    await expect(
      handlers.forecast(mockContext, { city: '' })
    ).rejects.toThrow();
  });
});
```

### `gdn validate`를 통한 통합 테스트

단위 테스트가 통과한 후, 전체 번들을 검증합니다:

```bash
gdn validate
```

### `gdn run`을 통한 엔드투엔드 테스트

Swarm을 시작하고 설정된 Connector를 통해 Tool 호출을 트리거합니다:

```bash
gdn run
```

### 테스트 체크리스트

- [ ] 각 핸들러에 성공/오류 경로를 다루는 단위 테스트 존재
- [ ] 현실적인 필드 값으로 구성된 모의 `ToolContext` 사용
- [ ] `gdn validate`가 오류 없이 통과
- [ ] 엔드투엔드 테스트로 LLM이 도구를 발견하고 호출할 수 있는지 확인

---

## 전체 예제: 데이터베이스 쿼리 Tool

위의 모든 패턴을 결합한 완전한 프로덕션 수준의 Tool 예제입니다.

### YAML 정의

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: database
  labels:
    tier: custom
spec:
  entry: "./tools/database/index.ts"
  errorMessageLimit: 2000

  exports:
    - name: query
      description: "데이터베이스에 읽기 전용 SQL 쿼리를 실행합니다"
      parameters:
        type: object
        properties:
          sql:
            type: string
            description: "실행할 SQL SELECT 쿼리"
          params:
            type: array
            description: "파라미터화된 쿼리 값 (SQL 인젝션 방지)"
          maxRows:
            type: number
            description: "반환할 최대 행 수 (기본값: 100)"
        required: [sql]

    - name: tables
      description: "사용 가능한 데이터베이스 테이블과 컬럼을 나열합니다"
      parameters:
        type: object
        properties:
          schema:
            type: string
            description: "데이터베이스 스키마 이름 (기본값: public)"
```

### 핸들러 구현

```typescript
// tools/database/index.ts
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';

function validateReadOnly(sql: string): void {
  const normalized = sql.trim().toUpperCase();
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE'];
  for (const keyword of forbidden) {
    if (normalized.startsWith(keyword)) {
      throw Object.assign(
        new Error(`쓰기 작업은 허용되지 않습니다. SELECT 쿼리만 가능합니다.`),
        {
          code: 'E_WRITE_FORBIDDEN',
          suggestion: 'SELECT 문으로 쿼리를 다시 작성하세요.',
        }
      );
    }
  }
}

export const handlers: Record<string, ToolHandler> = {
  query: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const sql = String(input.sql);
    const params = Array.isArray(input.params) ? input.params : [];
    const maxRows = typeof input.maxRows === 'number' ? input.maxRows : 100;

    validateReadOnly(sql);
    ctx.logger.info('쿼리 실행 중', { sql: sql.slice(0, 100) });

    // 실제 데이터베이스 클라이언트로 교체하세요
    const db = getDatabase();
    const rows = await db.query(sql, params);
    const truncated = rows.length > maxRows;
    const result = truncated ? rows.slice(0, maxRows) : rows;

    return {
      rowCount: result.length,
      truncated,
      rows: result,
    };
  },

  tables: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const schema = typeof input.schema === 'string' ? input.schema : 'public';

    ctx.logger.info('테이블 목록 조회 중', { schema });

    const db = getDatabase();
    const tables = await db.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [schema]
    );

    return { schema, tables };
  },
};
```

### Agent 등록

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: data-analyst
spec:
  modelConfig:
    modelRef: "Model/claude"
  tools:
    - ref: "Tool/database"
    - ref:
        kind: Tool
        name: json-query
        package: "@goondan/base"
```

---

## 프로덕션 체크리스트 요약

| # | 항목 | 상태 |
|---|------|------|
| 1 | Tool YAML 리소스에 유효한 `name`, `entry`, `exports` 정의 | |
| 2 | JSON Schema 파라미터에 명확한 `description` 필드 작성 | |
| 3 | 핸들러 모듈이 `handlers: Record<string, ToolHandler>`를 export | |
| 4 | 핸들러 키가 YAML export 이름과 정확히 일치 | |
| 5 | 모든 핸들러에서 입력 검증/변환 수행 | |
| 6 | 파일 시스템 작업에 `ctx.workdir` 사용 | |
| 7 | `console.log` 대신 `ctx.logger` 사용 | |
| 8 | 설명적 메시지와 함께 오류를 throw | |
| 9 | 복구 가능한 오류에 `suggestion` 포함 | |
| 10 | 장황한 Tool에 `errorMessageLimit` 설정 | |
| 11 | Agent의 `spec.tools`에 Tool 등록 | |
| 12 | `gdn validate` 통과 | |
| 13 | 성공/오류 경로를 다루는 단위 테스트 작성 | |
| 14 | 엔드투엔드 테스트로 LLM 호출 확인 | |

---

## 관련 문서

| 문서 | 관계 |
|------|------|
| [Tool API 레퍼런스](../reference/tool-api.ko.md) | 전체 TypeScript 인터페이스 (`ToolHandler`, `ToolContext`, `ToolCallResult`) |
| [Tool 시스템 이해](../explanation/tool-system.ko.md) | 설계 철학: 네이밍 규칙, Registry vs Catalog, 오류 철학 |
| [첫 Tool 만들기 (튜토리얼)](../tutorials/02-build-your-first-tool.ko.md) | 단계별 초보자 튜토리얼 |
| [내장 Tool 레퍼런스](../reference/builtin-tools.ko.md) | `@goondan/base` Tool 카탈로그와 파라미터 스키마 |
| [리소스 레퍼런스](../reference/resources.ko.md#tool) | 전체 Tool Kind YAML 스키마 |
| [Extension API 레퍼런스](../reference/extension-api.ko.md) | `api.tools.register()`를 통한 동적 도구 등록 |

---

_위키 버전: v0.0.3_
