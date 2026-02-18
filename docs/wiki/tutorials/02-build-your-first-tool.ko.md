# 첫 번째 Tool 만들기

> **커스텀 Tool을 처음부터 만들고, 에이전트에 등록하고, 실행하는 단계별 튜토리얼.**

[English version](./02-build-your-first-tool.md)

**만들게 될 것:** `string-utils` Tool -- `reverse`(문자열 뒤집기)와 `count`(문자, 단어, 줄 수 세기) 두 개의 export를 가진 Tool. 튜토리얼을 완료하면 에이전트가 LLM tool call을 통해 `string-utils__reverse`와 `string-utils__count`를 호출할 수 있게 됩니다.

**소요 시간:** 약 15분

**사전 준비:**

- 동작하는 Goondan 프로젝트 ([Getting Started](./01-getting-started.ko.md)를 먼저 완료하세요)
- Bun 설치
- 최소 하나의 LLM 프로바이더 API 키 (Anthropic, OpenAI, 또는 Google)

---

## 1단계: 무엇을 만들지 이해하기

코드를 작성하기 전에, 만들 Tool을 설계합니다.

Goondan에서 Tool은 LLM에 하나 이상의 함수를 노출하는 1급 리소스(`kind: Tool`)입니다. 각 함수를 **export**라고 부릅니다. LLM이 도구를 호출할 때는 **더블 언더스코어 네이밍 규칙**을 사용합니다:

```
{리소스 이름}__{export 이름}
```

`string-utils` Tool에 `reverse`와 `count` export가 있으면, LLM에는 다음과 같이 보입니다:

- `string-utils__reverse` -- 주어진 문자열을 뒤집습니다
- `string-utils__count` -- 문자열의 문자, 단어, 줄 수를 셉니다

이 네이밍 규칙은 여러 Tool 리소스가 로드되어도 도구 이름이 항상 명확하게 구분되도록 보장합니다. `__` 구분자는 AI SDK에서 안전하게 사용할 수 있어 인코딩이나 이스케이핑이 필요 없습니다.

> **심층 학습:** 이 규칙이 선택된 이유를 이해하려면 [Tool 시스템 -- 더블 언더스코어 네이밍 규칙](../explanation/tool-system.ko.md#더블-언더스코어-네이밍-규칙)을 참고하세요.

---

## 2단계: 프로젝트 구조 생성

기존 Goondan 프로젝트에서 Tool의 핸들러 모듈을 위한 디렉토리를 만듭니다:

```bash
mkdir -p tools/string-utils
```

프로젝트 구조는 다음과 같아야 합니다:

```
my-project/
  goondan.yaml          # Getting Started에서 만든 기존 설정
  .env                  # API 키
  tools/
    string-utils/
      index.ts          # (다음 단계에서 생성)
```

---

## 3단계: YAML에 Tool 리소스 정의

`goondan.yaml`을 열고 새로운 `kind: Tool` 문서를 추가합니다. `goondan.yaml`의 각 YAML 문서는 `---`로 구분됩니다.

기존 리소스 뒤에 다음을 추가하세요:

```yaml
---
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: string-utils
spec:
  entry: "./tools/string-utils/index.ts"

  exports:
    - name: reverse
      description: "Reverse a string. Returns the input string with characters in reverse order."
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "The text to reverse"
        required: [text]

    - name: count
      description: "Count characters, words, and lines in a string."
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "The text to analyze"
        required: [text]
```

### 각 필드의 의미

| 필드 | 목적 |
|------|------|
| `metadata.name` | 리소스 이름. `__`를 포함할 수 없습니다. LLM 도구 이름의 앞부분이 됩니다. |
| `spec.entry` | 핸들러 함수가 들어있는 TypeScript 모듈 경로 (프로젝트 루트 기준). |
| `spec.exports` | LLM에 노출되는 함수 배열. 각각 고유한 `name`이 필요합니다. |
| `exports[].name` | export 이름. `__`를 포함할 수 없습니다. LLM 도구 이름의 뒷부분이 됩니다. |
| `exports[].description` | LLM이 이 함수를 언제 호출할지 결정하는 데 사용하는 사람이 읽을 수 있는 설명. 명확하게 작성하세요 -- LLM이 이것을 읽습니다. |
| `exports[].parameters` | LLM이 제공해야 하는 입력을 정의하는 JSON Schema. |

### 네이밍 규칙

리소스 이름과 export 이름 모두 엄격한 규칙이 있습니다:

- 소문자, 숫자, 하이픈만 허용
- `__`(더블 언더스코어)는 이름 내부에서 **금지**
- export 이름은 동일 Tool 리소스 내에서 고유해야 함

Tool에 단일 export만 있더라도 `{리소스}__{export}` 패턴을 따라야 합니다. 이 일관성 덕분에 런타임은 특별한 분기 로직이 필요 없습니다.

> **레퍼런스:** 전체 Tool YAML 스키마는 [리소스 레퍼런스](../reference/resources.ko.md#tool)를 참고하세요.

---

## 4단계: 핸들러 모듈 구현

`tools/string-utils/index.ts` 파일을 생성합니다. 이것이 Goondan의 AgentProcess(Bun)가 런타임에 로드하는 엔트리 모듈입니다.

모듈은 `handlers` 객체를 export해야 합니다 -- export 이름에서 핸들러 함수로의 맵입니다:

```typescript
// tools/string-utils/index.ts
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';

export const handlers: Record<string, ToolHandler> = {
  reverse: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text);
    ctx.logger.info(`길이 ${text.length}의 문자열 뒤집기`);

    const reversed = text.split('').reverse().join('');

    return {
      original: text,
      reversed,
      length: text.length,
    };
  },

  count: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text);
    ctx.logger.info(`길이 ${text.length}의 문자열에서 세기`);

    const characters = text.length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const lines = text.split('\n').length;

    return {
      characters,
      words,
      lines,
    };
  },
};
```

### 핸들러의 핵심 포인트

1. **`handlers` export는 필수** -- 런타임은 정확히 이 이름의 export를 찾습니다. 각 키는 YAML 정의의 export `name`과 일치해야 합니다.

2. **핸들러 시그니처** -- 모든 핸들러는 두 개의 인자를 받습니다:
   - `ctx: ToolContext` -- 실행 컨텍스트 (워크스페이스 경로, 로거, 런타임 API)
   - `input: JsonObject` -- LLM이 제공한 파라미터, JSON Schema와 일치

3. **반환 값** -- 핸들러는 `JsonValue`(JSON 직렬화 가능한 모든 값)를 반환합니다. 이것이 tool call 결과로 LLM에 전달됩니다.

4. **입력 검증** -- 항상 입력을 검증하고 변환하세요. LLM이 예상치 못한 타입을 보낼 수 있습니다. `input.text`가 문자열이라고 신뢰하지 말고 `String(input.text)`를 사용하세요.

5. **`ctx.logger` 사용** -- `console.log` 대신 `ctx.logger.info()`, `ctx.logger.warn()` 등을 사용하세요. 로그 출력은 프로세스별로 캡처되어 `gdn logs`로 확인할 수 있습니다.

> **레퍼런스:** 전체 `ToolHandler`와 `ToolContext` API는 [Tool API 레퍼런스](../reference/tool-api.ko.md)를 참고하세요.

---

## 5단계: ToolContext 활용

`ToolContext`는 필수 런타임 서비스를 제공합니다. 가장 중요한 필드들을 살펴봅시다:

### `ctx.workdir` -- 인스턴스 워크스페이스

도구가 파일을 다루는 경우, 항상 `ctx.workdir`을 기본 디렉토리로 사용하세요. 이를 통해 각 에이전트 인스턴스의 데이터가 격리됩니다:

```typescript
import { join, isAbsolute } from 'path';

// 워크스페이스 기준으로 파일 경로 해석
const targetPath = isAbsolute(input.path)
  ? input.path
  : join(ctx.workdir, String(input.path));
```

우리의 `string-utils` Tool은 파일 접근이 필요 없지만, `file-system`이나 `bash` 같은 도구에서는 이 패턴이 핵심적입니다.

### `ctx.logger` -- 구조화된 로깅

로거는 `Console` 인터페이스를 따릅니다. 출력은 프로세스별로 캡처되어 `gdn logs`로 확인할 수 있습니다:

```typescript
ctx.logger.info('처리 시작', { text: input.text });
ctx.logger.warn('입력이 매우 김', { length: text.length });
ctx.logger.error('예상치 못한 오류', { error: err.message });
```

### `ctx.toolCallId`와 `ctx.message`

- `toolCallId`는 이 특정 도구 호출을 고유하게 식별합니다. 로그 항목 상관 관계에 유용합니다.
- `message`는 현재 tool call을 포함하는 assistant 메시지입니다. LLM이 무엇을 하고 있었는지에 대한 컨텍스트가 필요할 때 유용합니다.

> **심층 학습:** ToolContext가 의도적으로 최소화된 이유는 [Tool 시스템 -- ToolContext: 실행 환경](../explanation/tool-system.ko.md#toolcontext-실행-환경)을 참고하세요.

---

## 6단계: Agent에 Tool 등록

이제 Tool을 Agent에 연결합니다. `goondan.yaml`에서 Agent 리소스를 찾아 `spec.tools`에 Tool을 추가하세요:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  systemPrompt: |
    You are a helpful assistant. You have access to string utility tools.
    Use string-utils__reverse to reverse strings and string-utils__count
    to count characters, words, and lines.
  tools:
    - ref: "Tool/string-utils"
```

`ref: "Tool/string-utils"`는 로컬 Tool 리소스를 참조하는 문자열 축약형입니다. Goondan에게 같은 번들에서 `string-utils`라는 이름의 Tool을 찾으라고 알려줍니다.

### 내장 Tool과 함께 사용

커스텀 Tool을 `@goondan/base`의 내장 Tool과 함께 사용할 수 있습니다:

```yaml
spec:
  tools:
    - ref: "Tool/string-utils"           # 커스텀 Tool
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"         # 내장 Tool (크로스 패키지 참조)
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
```

> **레퍼런스:** 모든 ObjectRef 패턴은 [리소스 레퍼런스 -- ObjectRef](../reference/resources.ko.md#objectref)를 참고하세요.

---

## 7단계: 설정 검증

Swarm을 실행하기 전에, `gdn validate`로 설정 오류를 확인합니다:

```bash
gdn validate
```

검증은 각 Tool 리소스에 대해 다음을 확인합니다:

| 검사 항목 | 확인 내용 |
|----------|----------|
| 엔트리 경로 존재 | `spec.entry`가 디스크의 파일을 가리키는지 |
| 최소 1개의 export | `spec.exports`에 하나 이상의 항목이 있는지 |
| 고유한 export 이름 | 동일 Tool 내에서 중복 이름이 없는지 |
| 이름에 `__` 없음 | 리소스 이름과 export 이름에 `__`가 포함되지 않았는지 |
| 핸들러 모듈 | 엔트리 모듈이 `handlers` 객체를 export하는지 |
| 핸들러 매칭 | 각 export 이름에 대응하는 handler가 있는지 |

**성공 시 예상 출력:**

```
Validating goondan.yaml...
  Package my-project ............. ok
  Model claude ................... ok
  Tool string-utils .............. ok
  Agent assistant ................ ok
  Swarm my-swarm ................. ok

Validation passed.
```

**검증에 실패하면**, 오류 메시지를 주의 깊게 읽으세요. 흔한 문제들:

- **엔트리 파일을 찾을 수 없음** -- `spec.entry` 경로를 확인하세요. 프로젝트 루트 기준 상대 경로여야 합니다.
- **핸들러 누락** -- YAML의 모든 export 이름이 `handlers` 객체에 대응하는 키가 있는지 확인하세요.
- **중복 export 이름** -- 각 export 이름은 Tool 내에서 고유해야 합니다.

오류를 수정하고 통과할 때까지 `gdn validate`를 다시 실행하세요.

---

## 8단계: 실행 및 테스트

Swarm을 시작합니다:

```bash
gdn run
```

런타임이 실행되면, 설정된 Connector(CLI, Telegram, Slack 등)를 통해 에이전트와 상호작용하세요. 다음과 같은 프롬프트를 시도해보세요:

- _"'Hello, Goondan!' 문자열을 뒤집어줘"_
- _"이 텍스트의 문자, 단어, 줄 수를 세줘: 'One\nTwo\nThree'"_
- _"'racecar'를 뒤집으면 뭐가 되지?"_

### 관찰할 것

1. **도구 발견** -- LLM이 description을 보고 `string-utils__reverse`와 `string-utils__count`를 인식하고 적절할 때 호출해야 합니다.

2. **올바른 입력** -- LLM이 JSON Schema에 정의된 대로 `text` 파라미터를 전달해야 합니다.

3. **구조화된 출력** -- 핸들러의 반환 값이 대화에서 tool call 결과로 나타납니다.

4. **로그** -- `ctx.logger` 메시지를 로그에서 확인하세요:

   ```bash
   gdn logs
   ```

### 문제 해결

| 증상 | 가능한 원인 | 해결 방법 |
|------|-----------|----------|
| LLM이 도구를 호출하지 않음 | `description`이 불명확 | export `description`을 더 구체적으로 다시 작성 |
| LLM이 잘못된 도구를 호출 | 도구 이름이 모호 | description을 더 명확히 구분 |
| Tool call이 오류를 반환 | 핸들러가 예외를 throw | `gdn logs`로 로그 확인 |
| "Tool not in catalog" 오류 | Tool이 Agent에 등록되지 않음 | `spec.tools`에 `ref: "Tool/string-utils"` 추가 |

---

## 9단계: 오류 처리 개선

현재 핸들러에서 문제가 발생하면 오류 메시지가 일반적입니다. `suggestion`과 `helpUrl` 필드를 추가하여 더 나은 오류 처리를 만들어봅시다.

`reverse` 핸들러에 입력을 더 세심하게 검증하도록 업데이트합니다:

```typescript
reverse: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const text = String(input.text ?? '');

  if (text.length === 0) {
    const error = new Error('Input text is empty. Provide a non-empty string to reverse.');
    Object.assign(error, {
      code: 'E_EMPTY_INPUT',
      suggestion: 'Pass a non-empty "text" parameter.',
    });
    throw error;
  }

  if (text.length > 100_000) {
    const error = new Error(`Input too long: ${text.length} characters (max: 100,000).`);
    Object.assign(error, {
      code: 'E_INPUT_TOO_LONG',
      suggestion: 'Shorten the input text to under 100,000 characters.',
      helpUrl: 'https://docs.goondan.ai/errors/E_INPUT_TOO_LONG',
    });
    throw error;
  }

  ctx.logger.info(`길이 ${text.length}의 문자열 뒤집기`);
  const reversed = text.split('').reverse().join('');

  return {
    original: text,
    reversed,
    length: text.length,
  };
},
```

### 오류 처리 동작 방식

핸들러가 오류를 throw하면, Goondan은 에이전트를 크래시시키지 **않습니다**. 대신, 런타임이 오류를 잡아 구조화된 `ToolCallResult`로 변환합니다:

```json
{
  "status": "error",
  "error": {
    "code": "E_EMPTY_INPUT",
    "name": "Error",
    "message": "Input text is empty. Provide a non-empty string to reverse.",
    "suggestion": "Pass a non-empty \"text\" parameter."
  }
}
```

이 결과는 LLM에 되돌려 전달되며, LLM은 수정된 입력으로 재시도하거나 사용자에게 알릴 수 있습니다. `suggestion` 필드는 특히 유용합니다 -- LLM에게 실행 가능한 복구 힌트를 제공합니다.

### 오류 메시지 잘림

기본적으로 오류 메시지는 1000자로 잘립니다. 도구가 장황한 오류를 생성할 수 있는 경우(예: 외부 API의 스택 트레이스) 제한을 늘리세요:

```yaml
spec:
  errorMessageLimit: 2000
```

> **가이드:** 전체 오류 처리 체크리스트는 [Tool 작성 가이드 -- 오류를 올바르게 처리](../how-to/write-a-tool.ko.md#5단계-오류를-올바르게-처리)를 참고하세요.

---

## 전체 예제

이 튜토리얼에 필요한 모든 리소스가 포함된 전체 `goondan.yaml`:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-first-tool-project

---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514

---
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: string-utils
spec:
  entry: "./tools/string-utils/index.ts"

  exports:
    - name: reverse
      description: "Reverse a string. Returns the input string with characters in reverse order."
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "The text to reverse"
        required: [text]

    - name: count
      description: "Count characters, words, and lines in a string."
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "The text to analyze"
        required: [text]

---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  systemPrompt: |
    You are a helpful assistant with string utility tools.
    Use string-utils__reverse to reverse strings and
    string-utils__count to count characters, words, and lines.
  tools:
    - ref: "Tool/string-utils"

---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: my-swarm
spec:
  entryAgent:
    ref: "Agent/assistant"
  agents:
    - ref: "Agent/assistant"
```

그리고 오류 처리가 포함된 전체 핸들러 모듈:

```typescript
// tools/string-utils/index.ts
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';

export const handlers: Record<string, ToolHandler> = {
  reverse: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text ?? '');

    if (text.length === 0) {
      const error = new Error('Input text is empty. Provide a non-empty string to reverse.');
      Object.assign(error, {
        code: 'E_EMPTY_INPUT',
        suggestion: 'Pass a non-empty "text" parameter.',
      });
      throw error;
    }

    if (text.length > 100_000) {
      const error = new Error(`Input too long: ${text.length} characters (max: 100,000).`);
      Object.assign(error, {
        code: 'E_INPUT_TOO_LONG',
        suggestion: 'Shorten the input text to under 100,000 characters.',
      });
      throw error;
    }

    ctx.logger.info(`길이 ${text.length}의 문자열 뒤집기`);
    const reversed = text.split('').reverse().join('');

    return {
      original: text,
      reversed,
      length: text.length,
    };
  },

  count: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text ?? '');

    if (text.length === 0) {
      const error = new Error('Input text is empty. Provide a non-empty string to analyze.');
      Object.assign(error, {
        code: 'E_EMPTY_INPUT',
        suggestion: 'Pass a non-empty "text" parameter.',
      });
      throw error;
    }

    ctx.logger.info(`길이 ${text.length}의 문자열에서 세기`);

    const characters = text.length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const lines = text.split('\n').length;

    return {
      characters,
      words,
      lines,
    };
  },
};
```

---

## 배운 것

이 튜토리얼에서 다음을 수행했습니다:

1. **Tool 설계** -- export와 JSON Schema 파라미터 계획
2. **YAML 리소스 작성** -- `kind: Tool`에 `metadata.name`, `spec.entry`, `spec.exports` 정의
3. **핸들러 구현** -- `handlers: Record<string, ToolHandler>`를 export하는 모듈 생성
4. **ToolContext 활용** -- 구조화된 로깅에 `ctx.logger` 활용
5. **Agent에 등록** -- `ref: "Tool/string-utils"`로 `spec.tools`에 Tool 추가
6. **검증 및 실행** -- `gdn validate`와 `gdn run`으로 검증 및 테스트
7. **오류 처리 개선** -- throw하는 오류에 `suggestion`과 `helpUrl` 필드 추가

### 핵심 개념

- **더블 언더스코어 네이밍**: `{리소스}__{export}` -- 예: `string-utils__reverse`
- **`handlers` export**: 엔트리 모듈은 `handlers: Record<string, ToolHandler>`를 export해야 합니다
- **데이터로서의 오류**: throw된 오류는 LLM이 추론할 수 있는 구조화된 `ToolCallResult` 객체로 변환됩니다
- **ToolContext는 최소화됨**: `workdir`, `logger`, `runtime`, `message`, `toolCallId`만 -- Tool을 단순하고 테스트 가능하게 유지

---

## 다음 단계

커스텀 Tool을 만들 수 있게 되었으니, 다음 리소스를 탐색해보세요:

| 다음 | 문서 |
|------|------|
| **Extension 만들기** | [첫 번째 Extension 만들기](./03-build-your-first-extension.ko.md) -- 파이프라인에 후킹되는 미들웨어 만들기 |
| **프로덕션 체크리스트** | [Tool 작성 가이드](../how-to/write-a-tool.ko.md) -- 프로덕션 수준 Tool을 위한 전체 체크리스트 |
| **Tool 아키텍처** | [Tool 시스템 이해](../explanation/tool-system.ko.md) -- Registry vs Catalog, 프로세스 내 실행, 미들웨어 가로채기 |
| **전체 API** | [Tool API 레퍼런스](../reference/tool-api.ko.md) -- `ToolHandler`, `ToolContext`, `AgentToolRuntime`, `ToolCallResult` |
| **내장 Tool** | [내장 Tool 레퍼런스](../reference/builtin-tools.ko.md) -- `@goondan/base` Tool에서 배우기 |
| **멀티 에이전트 패턴** | [멀티 에이전트 패턴](../how-to/multi-agent-patterns.ko.md) -- 에이전트 간 통신에 `ctx.runtime` 사용 |

---

_튜토리얼 버전: v0.0.3_
