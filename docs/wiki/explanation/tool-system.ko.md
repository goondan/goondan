# Tool 시스템

> **Goondan의 Tool 시스템이 어떻게 동작하며, 왜 이렇게 설계되었는지 깊이 들여다봅니다.**

[English version](./tool-system.md)

---

## Tool이란 무엇인가?

Tool은 Goondan에서 _행동_ 의 기본 단위입니다. 에이전트는 LLM 호출을 통해 사고하고 대화하지만, 실제로 무언가를 **수행할 때는** Tool을 사용합니다 -- 셸 명령 실행, 파일 읽기, HTTP 요청, 다른 에이전트와의 통신 등. LLM이 함수를 호출하기로 결정할 때마다, 그것은 Tool을 호출하는 것입니다.

Goondan의 선언적 설정 모델에서 Tool은 `goondan.yaml`에 선언되는 1급 리소스(`kind: Tool`)입니다. 이는 Tool이 에이전트에 하드코딩되지 않고, 독립적으로 정의되고 버전 관리되며 조합 가능하다는 뜻입니다 -- Kubernetes의 컨테이너처럼요.

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
spec:
  entry: "./tools/bash/index.ts"
  exports:
    - name: exec
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
```

---

## 더블 언더스코어 네이밍 규칙

Tool이 LLM에 노출될 때, 함수 이름은 **더블 언더스코어**(`__`) 규칙을 따릅니다:

```
{리소스 이름}__{export 이름}
```

예를 들어, `bash`라는 Tool 리소스의 `exec`라는 export는 LLM의 도구 카탈로그에서 `bash__exec`가 됩니다.

### 왜 이런 규칙인가?

이 설계는 여러 문제를 한 번에 해결합니다:

1. **리소스 경계의 명확성** -- 하나의 Tool 리소스가 여러 함수를 export할 수 있습니다(예: `file-system__read`, `file-system__write`). 더블 언더스코어는 LLM과 디버깅하는 개발자 모두에게 그룹핑을 즉시 보여줍니다.

2. **인코딩 오버헤드 없음** -- `__` 구분자는 Vercel AI SDK의 도구 이름 체계에서 허용되는 문자 시퀀스입니다. `/`나 `.` 같은 대안과 달리 URL 인코딩, 이스케이핑, 별도 파서 로직이 전혀 필요 없습니다. 그냥 동작합니다.

3. **결정론적 파싱** -- 전체 도구 이름이 주어지면, 첫 번째 `__`에서 분리하여 리소스 이름과 export 이름을 항상 복원할 수 있습니다. 이것이 라우팅을 단순하게 만듭니다:

   ```
   "file-system__read"  -->  리소스: "file-system",  export: "read"
   "http-fetch__post"   -->  리소스: "http-fetch",   export: "post"
   ```

4. **충돌 방지** -- Tool 리소스 이름과 export 이름 자체에는 `__`를 포함할 수 없습니다. 이 제약이 분리가 항상 모호하지 않음을 보장합니다.

단일 export만 가진 Tool도 이 패턴을 따라야 합니다(예: `self-restart__request`). 이 일관성 덕분에 런타임은 "단일 함수 Tool"과 "다중 함수 Tool"에 대한 특별한 분기 로직이 필요 없습니다.

---

## Tool 리소스 스키마

Tool 리소스는 세 가지 핵심 부분으로 구성됩니다:

| 필드 | 목적 |
|------|------|
| `spec.entry` | 핸들러가 포함된 JavaScript/TypeScript 모듈 경로 |
| `spec.exports` | Tool이 LLM에 노출하는 함수 배열 (이름, 설명, JSON Schema 파라미터) |
| `spec.errorMessageLimit` | LLM에 반환되는 오류 메시지 최대 길이 (기본값: 1000자) |

`exports` 배열이 핵심입니다: Tool과 LLM 사이의 계약을 정의합니다. 각 export는 `name`, 사람이 읽을 수 있는 `description`(LLM이 도구 호출 시점을 결정하는 데 사용), JSON Schema 형식의 `parameters` 스키마를 지정합니다.

```yaml
spec:
  entry: "./tools/file-system/index.ts"
  exports:
    - name: read
      description: "파일 내용을 읽습니다"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: [path]
    - name: write
      description: "파일에 내용을 씁니다"
      parameters:
        type: object
        properties:
          path: { type: string }
          content: { type: string }
        required: [path, content]
```

> 전체 YAML 스키마는 [리소스 레퍼런스](../reference/resources.ko.md)를 참조하세요.

---

## ToolHandler: 구현 계약

`spec.entry`가 가리키는 엔트리 모듈은 `handlers` 객체를 export해야 합니다 -- export 이름에서 핸들러 함수로의 맵입니다:

```typescript
export const handlers: Record<string, ToolHandler> = {
  read: async (ctx, input) => {
    // ... 구현
    return { content: fileContent };
  },
  write: async (ctx, input) => {
    // ... 구현
    return { written: true };
  },
};
```

각 핸들러는 두 개의 인자를 받습니다:

- **`ctx`** (`ToolContext`) -- 실행 컨텍스트로, 워크스페이스 경로, 로깅, 에이전트 간 통신을 제공합니다
- **`input`** (`JsonObject`) -- LLM이 전달한 파라미터로, export의 JSON Schema를 준수합니다

핸들러는 성공 시 `JsonValue`(JSON 직렬화 가능한 모든 값)를 반환합니다. 오류가 발생하면, 런타임은 예외를 전파하는 대신 `status: "error"`가 포함된 구조화된 `ToolCallResult`로 감쌉니다. 이것은 의도적인 설계입니다: 에이전트를 크래시시키는 대신, 오류를 LLM에 되돌려 보내 스스로 복구 전략을 수립할 수 있게 합니다.

---

## ToolContext: 실행 환경

모든 Tool 핸들러는 필수 런타임 서비스를 제공하는 `ToolContext`를 받습니다. 컨텍스트는 의도적으로 작게 유지됩니다 -- Tool이 진짜 필요한 것만 포함하며, 더 넓은 런타임과의 불필요한 결합을 피합니다.

### 주요 필드

| 필드 | 타입 | 목적 |
|------|------|------|
| `workdir` | `string` | 인스턴스 워크스페이스 디렉토리. 파일 시스템 도구(bash, file-system)가 기본 작업 디렉토리로 사용합니다. |
| `logger` | `Console` | 도구의 출력을 위한 표준 로깅 인터페이스. |
| `runtime` | `AgentToolRuntime` (선택) | 에이전트 간 통신 인터페이스 -- `request`, `send`, `spawn`, `list`, `catalog`. |
| `message` | `Message` | 현재 tool call을 포함하는 assistant 메시지. |
| `toolCallId` | `string` | 이 특정 도구 호출의 고유 식별자. |

### 왜 ToolContext는 최소화되어 있는가?

초기 설계에는 `swarmBundle`이나 `oauth` 같은 필드가 도구 컨텍스트에 포함되어 있었습니다. 이들은 의도적으로 제거되었습니다. 원칙은 Tool이 자신의 기능을 실행하는 데 필요한 것만 볼 수 있어야 한다는 것입니다:

- **`workdir`**은 대화 인스턴스에 연결된 샌드박스화된 파일 시스템 위치를 제공합니다.
- **`runtime`**은 에이전트 간 통신의 관문으로, 주로 내장 `agents` 도구에서 사용됩니다.
- **`logger`**와 **`message`**는 관찰성과 컨텍스트 인식을 지원합니다.

그 이상의 것(인증, 번들 접근, 설정)은 Extension이나 Connection에 속하며, Tool 자체에는 속하지 않습니다. 이 분리가 Tool을 단순하고, 테스트 가능하며, 재사용 가능하게 유지합니다.

> 전체 API 시그니처는 [Tool API 레퍼런스](../reference/tool-api.ko.md)를 참조하세요.

---

## AgentProcess 내부에서의 Tool 실행 흐름

Tool이 어디서 어떻게 실행되는지 이해하는 것이 Goondan 아키텍처를 이해하는 핵심입니다. Tool은 별도 프로세스에서 실행되지 **않습니다**. Tool은 **AgentProcess** 안에서 실행됩니다 -- 에이전트의 LLM 루프를 실행하는 바로 그 Bun 프로세스입니다.

실행 흐름은 다음과 같습니다:

```
LLM 응답에 tool_calls 포함
         |
         v
+---------------------------------------------+
|  AgentProcess (Bun)                          |
|                                              |
|  1. toolCall 미들웨어 체인 (before)            |
|     - Extension이 입력을 검증/변환 가능        |
|                                              |
|  2. ToolRegistry 조회                         |
|     - "리소스__export"로 핸들러 찾기           |
|                                              |
|  3. import(spec.entry) + 핸들러 해석           |
|     - 같은 프로세스에 모듈 로드                 |
|                                              |
|  4. handler(ctx, input)                      |
|     - 직접 JS 함수 호출, IPC 없음             |
|                                              |
|  5. toolCall 미들웨어 체인 (after)             |
|     - Extension이 결과를 변환/로깅 가능        |
|                                              |
+---------------------------------------------+
         |
         v
   ToolCallResult  -->  LLM에 되돌려 전달
```

### 왜 프로세스 내 실행인가?

AgentProcess 내부에서 Tool을 실행하는 것(별도 프로세스가 아닌)은 의도적인 트레이드오프입니다:

- **낮은 지연시간** -- 도구 호출은 단순한 JavaScript 함수 호출입니다. 프로세스 스폰 오버헤드, 페이로드의 직렬화/역직렬화, IPC 왕복이 없습니다.
- **공유 컨텍스트** -- 도구는 프로세스 경계를 넘어 데이터를 마샬링할 필요 없이 에이전트의 워크스페이스, 로드된 모듈, 런타임 컨텍스트에 직접 접근할 수 있습니다.
- **단순함** -- Tool 작성자는 순수한 함수를 작성합니다. 서버를 구현하거나, 메시지를 파싱하거나, 통신 프로토콜을 처리할 필요가 없습니다.

단점은 오작동하는 도구(무한 루프, 메모리 누수)가 호스트 AgentProcess에 영향을 줄 수 있다는 것입니다. 그러나 각 에이전트가 자체 Bun 프로세스에서 실행되므로(Process-per-Agent 모델), 피해 범위는 단일 에이전트에 국한됩니다. Orchestrator가 크래시를 감지하고 프로세스를 자동으로 다시 스폰할 수 있습니다.

> Process-per-Agent 모델에 대한 자세한 내용은 [런타임 모델](./runtime-model.ko.md)을 참조하세요.

---

## Tool Registry vs. Tool Catalog

Goondan은 두 가지 도구 컬렉션을 구분합니다:

```
+----------------------------------------------+
|              Tool Registry                    |
|  AgentProcess의 모든 실행 가능한 도구:         |
|  - goondan.yaml의 도구 (spec.tools)           |
|  - 동적 등록된 도구 (Extension)                |
|  - MCP 브릿지된 도구                          |
+----------------------------------------------+
              |
              |  step 미들웨어 필터링
              v
+----------------------------------------------+
|          Tool Catalog (Step별)                |
|  현재 Step에서 LLM에 보이는                    |
|  도구의 부분집합.                              |
+----------------------------------------------+
```

- **Tool Registry**는 프로세스에서 사용 가능한 전체 도구 핸들러 집합입니다. 초기화 시 번들의 Tool 리소스들과 `api.tools.register()`를 호출하는 Extension들로부터 채워집니다.

- **Tool Catalog**는 실제로 LLM에 전달되는 Step별 부분집합입니다. 새로운 Step이 시작될 때마다 에이전트의 `spec.tools` 선언에서 카탈로그가 재구성됩니다. 그런 다음 Step 미들웨어가 `ctx.toolCatalog`에서 항목을 추가하거나 제거할 수 있습니다.

이 분리가 강력한 패턴을 가능하게 합니다:

- **동적 도구 필터링** -- Extension이 현재 작업에 필요하지 않은 도구를 숨겨 LLM의 의사결정 공간을 줄일 수 있습니다.
- **도구 검색** -- 메타 도구가 LLM이 다음 Step에 필요한 도구를 발견하고 선택하게 하여 카탈로그를 집중시킵니다.
- **보안 경계** -- 카탈로그가 허용 목록으로 작동합니다. 카탈로그에 없는 도구는 LLM이 호출할 수 없습니다(구조화된 오류로 거부됩니다).

---

## 오류 처리 철학

Tool이 예외를 발생시키면, Goondan은 그것을 호출 스택 위로 전파하여 에이전트를 크래시시키지 **않습니다**. 대신, 런타임이 오류를 잡아 구조화된 `ToolCallResult`로 감쌉니다:

```json
{
  "status": "error",
  "error": {
    "code": "E_TOOL",
    "name": "Error",
    "message": "파일을 찾을 수 없습니다: /workspace/missing.txt",
    "suggestion": "파일 경로가 올바른지 확인하세요.",
    "helpUrl": "https://docs.goondan.ai/errors/E_TOOL"
  }
}
```

이 결과는 도구의 응답으로 LLM에 되돌려 전달됩니다. LLM은 다른 파라미터로 재시도하거나, 대안적인 접근을 시도하거나, 사용자에게 문제를 보고할 수 있습니다.

주요 사항:
- 오류 메시지는 `spec.errorMessageLimit`(기본값: 1000자)으로 잘려 과도한 LLM 컨텍스트 소비를 방지합니다.
- `suggestion`과 `helpUrl` 필드는 LLM과 운영자 모두가 문제를 진단하는 데 도움을 줍니다.
- 현재 카탈로그에 없는 이름으로의 도구 호출은 특정 오류 코드(`E_TOOL_NOT_IN_CATALOG`)를 반환합니다.

---

## 내장 Tool

`@goondan/base` 패키지는 일반적인 에이전트 요구사항을 충족하는 바로 사용 가능한 Tool들을 제공합니다:

| Tool | Exports | 용도 |
|------|---------|------|
| **bash** | `exec`, `script` | 셸 명령과 스크립트 실행 |
| **file-system** | `read`, `write` | 워크스페이스 내 파일 읽기/쓰기 |
| **http-fetch** | `get`, `post` | HTTP 요청 수행 (SSRF 안전: http/https만) |
| **json-query** | `query` | JSON 데이터 쿼리 및 변환 |
| **text-transform** | `transform` | 텍스트 조작 유틸리티 |
| **agents** | `request`, `send`, `spawn`, `list`, `catalog` | 에이전트 간 통신 |
| **self-restart** | `request` | 런타임에 오케스트레이터 재시작 신호 전달 |
| **telegram** | `send`, `edit`, `delete`, `react`, `setChatAction`, `downloadFile` | Telegram Bot API 작업 |
| **slack** | `send`, `read`, `edit`, `delete`, `react`, `downloadFile` | Slack API 작업 |

이 도구들은 커스텀 Tool과 동일한 `handlers` export 패턴을 따릅니다. 에이전트의 `spec.tools`에서 `@goondan/base` 패키지로의 ObjectRef로 참조합니다:

```yaml
kind: Agent
spec:
  tools:
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
```

`agents` 도구는 특히 주목할 만합니다 -- `ToolContext.runtime`을 통해 Orchestrator의 IPC 시스템에 연결하는 에이전트 간 통신의 주요 메커니즘입니다.

> 상세 파라미터 스키마와 사용 예시는 [내장 도구 레퍼런스](../reference/builtin-tools.ko.md)를 참조하세요.

---

## Extension과 Tool의 관계

Extension과 Tool은 **toolCall 미들웨어**를 통해 명확히 정의된 관계를 가집니다. LLM이 tool call을 반환하면, 핸들러로 직접 가지 않습니다. 대신 Extension이 후킹할 수 있는 미들웨어 체인을 통과합니다:

```
LLM이 tool_call 반환
        |
        v
  Extension A (next 전)     -- 예: 호출 로깅
    Extension B (next 전)   -- 예: 입력 검증
      Core 핸들러 실행       -- 실제 도구 실행
    Extension B (next 후)   -- 예: 결과 변환
  Extension A (next 후)     -- 예: 실행 시간 측정
        |
        v
  ToolCallResult가 LLM에 반환
```

이것은 전형적인 양파(onion) 모델입니다: 각 미들웨어가 다음을 감싸고, `ctx.next()`가 코어 핸들러 안쪽으로 제어를 전달한 다음 레이어를 통해 바깥쪽으로 돌아옵니다.

### Extension이 Tool 호출에 대해 할 수 있는 것

- **입력 검증/변환** -- 도구 실행 전 `ctx.args` 수정
- **출력 변환** -- 도구 완료 후 결과 변경
- **로깅과 관찰성** -- 타이밍, 인자, 결과 기록
- **접근 제어** -- 정책에 따라 특정 도구 호출 차단
- **오류 보강** -- 도구 오류에 `suggestion`이나 `helpUrl` 추가

### Extension이 할 수 없는 것

Extension은 `toolCall` 미들웨어를 통해서만 도구 레이어와 상호작용합니다. 다음은 할 수 없습니다:
- Tool Registry를 직접 수정
- 런타임에 도구의 핸들러를 교체 (미들웨어를 통해 가로채고 재정의할 수는 있지만, 레지스트리 항목 자체는 불변)
- 도구의 내부 모듈 상태에 접근

Extension은 `api.tools.register()`를 통해 완전히 새로운 도구를 동적으로 등록할 수도 있지만, 이것은 카탈로그 수준에서 작동합니다 -- 기존 항목을 수정하는 것이 아니라 Tool Registry에 새 항목을 추가합니다.

> Extension 미들웨어 모델에 대한 심층적인 내용은 [Extension 파이프라인](./extension-pipeline.ko.md)을 참조하세요.

---

## 설계 요약

Goondan의 Tool 시스템은 몇 가지 의도적인 설계 원칙 위에 구축되었습니다:

| 원칙 | 구현 |
|------|------|
| **명령형보다 선언적** | Tool은 에이전트에 하드코딩되지 않는 YAML 리소스 |
| **명시적 네이밍** | 더블 언더스코어 규칙이 모호함을 방지하고 인코딩 불필요 |
| **프로세스 내 실행** | 낮은 지연시간과 단순함을 위해 AgentProcess 내부에서 실행 |
| **데이터로서의 오류** | 예외가 LLM이 추론할 수 있는 구조화된 결과로 변환 |
| **Registry/Catalog 분리** | 전체 도구 집합 vs. Step별 가시적 집합이 동적 필터링 가능 |
| **최소 컨텍스트** | ToolContext는 Tool이 필요한 것만 제공하여 결합도를 낮춤 |
| **미들웨어 가로채기** | Extension이 도구 내부를 수정하지 않고 실행을 감쌈 |

이러한 선택은 Goondan의 더 넓은 철학을 반영합니다: 에이전트에게 세상에서 행동하는 데 필요한 도구를 주면서, 시스템을 예측 가능하고 관찰 가능하며 안전하게 유지하는 것입니다.

---

## 더 읽어보기

- [첫 번째 Tool 만들기 (튜토리얼)](../tutorials/02-build-your-first-tool.ko.md) -- 커스텀 도구 생성 단계별 가이드
- [Tool 작성하기 (How-to)](../how-to/write-a-tool.ko.md) -- Tool 작성자를 위한 프로덕션 체크리스트
- [Tool API 레퍼런스](../reference/tool-api.ko.md) -- 전체 `ToolHandler`, `ToolContext`, `ToolCallResult` API
- [내장 도구 레퍼런스](../reference/builtin-tools.ko.md) -- `@goondan/base` 도구의 파라미터 스키마와 예제
- [Extension 파이프라인](./extension-pipeline.ko.md) -- `toolCall` 미들웨어가 도구 실행을 감싸는 방식
- [런타임 모델](./runtime-model.ko.md) -- Process-per-Agent 아키텍처와 IPC

---

_위키 버전: v0.0.3_
