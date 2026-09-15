# Goondan

Goondan은 에이전트의 구성과 실행을 YAML로 정의하는 프레임워크입니다. YAML에는 사용할 모델·도구·함수·확장의 이름과 연결 순서를 적고, 호스트 프로그램이 그 이름에 실제 구현을 주입합니다. TypeScript와 Python은 같은 YAML을 읽고 각 언어의 프로세스에서 실행합니다.

이 문서는 설계의 출발점부터 YAML 작성, 구현 주입과 실행까지 설명하고 두 호스트의 공개 API를 정리합니다. 모든 구성 필드와 실행 규칙은 [YAML과 동작 스펙](spec/goondan.md), 편집기에서 사용하는 형식 정의는 [JSON Schema](spec/goondan.schema.json), 공식 모델 어댑터의 요청 변환 규칙은 [모델 어댑터 규격](spec/model-adapters.md)에 있습니다.

## 설계의 목적

Goondan은 에이전트의 실행 과정에 필요한 기능을 쉽게 조합하고 바꿀 수 있도록 합니다. 모델을 호출하기 전에 관련 지식을 추가하거나, 도구 결과를 정리하거나, 완성된 응답을 다른 에이전트가 다듬는 구성을 표현할 수 있습니다. 중심 에이전트의 구현은 유지하면서 어떤 기능을 언제 적용할지 YAML에서 정합니다.

각 기능은 자신이 받은 값과 자신의 작업에 집중합니다. 훅은 값을 받아 결과를 반환하고, 목록에 적힌 순서가 실행 순서가 됩니다. 확장은 다른 확장의 이름이나 순서를 알 필요가 없습니다. 에이전트 사이의 연결도 구성에서 정하므로, 같은 에이전트를 단독으로 쓰거나 여러 단계 중 하나로 재사용할 수 있습니다.

| 하고 싶은 일 | Goondan에서 표현하는 방법 |
|---|---|
| 목표를 따라 모델과 도구를 반복 실행합니다. | 에이전트의 `model`과 `tools`를 선언합니다. |
| 특정 값이 만들어질 때 보조 기능을 적용합니다. | `input`, `modelInput`, `output` 등의 값에 훅을 선언합니다. |
| 여러 훅과 도구를 한 기능으로 켜거나 끕니다. | `extensions`에 확장을 등록합니다. |
| 앞 에이전트의 결과를 다음 에이전트에 전달합니다. | 구성 최상위의 `flow`에 연결 순서를 선언합니다. |
| 조립한 전체를 다시 사용합니다. | 에이전트의 `config`로 다른 구성 파일을 참조합니다. |

### ‘마음’에서 얻은 영감

설계 과정에서 영감을 준 예시 중 하나가 의식과 무의식으로 설명하는 ‘마음’입니다. 목표를 따라 명시적으로 도구를 사용하는 에이전트를 의식에, 필요할 때 맥락을 보태는 보조 기능을 무의식에 빗대어 볼 수 있습니다. 이 예시는 중심 에이전트가 모든 보조 기능을 직접 호출하고 관리하지 않아도 여러 기능이 함께 작동하는 구성을 설명해 줍니다.

Goondan은 이런 조합에 필요한 훅, 확장과 에이전트 연결을 제공합니다. 사용자는 작업에 맞춰 검색·검증·편집 등을 연결하고, 조립한 전체를 더 큰 구성 안에서 다시 사용할 수 있습니다.

## YAML에서 실행까지

```text
구성 작성자                              호스트 작성자
 goondan.yaml                            모델·도구·함수·확장 구현
 templates/                              저장소·외부 서비스 연결
       │                                         │
       ▼                                         ▼
 loadConfig / load_config                 이름별 구현 주입
       └─────────────────┬───────────────────────┘
                         ▼
              createRuntime / create_runtime
                         │
                         ▼
                입력 → 모델 → 도구 → 결과
                         │
                         ▼
                 다음 에이전트 또는 출력
```

구성 작성자는 어떤 기능을 어떤 순서로 쓸지 정합니다. 호스트 작성자는 모델 제공자, 도구 구현, 데이터베이스나 검색 서비스 같은 외부 연결을 준비합니다. Goondan은 구성을 해석하고 훅을 적용하며 모델·도구 반복과 대화 저장을 진행합니다.

## 같은 YAML을 두 언어에서 실행하기

아래 예제는 입력을 정리하고, 메모리를 모델 입력에 추가한 뒤, 도구로 얻은 내용을 출력합니다. 연결을 직접 확인할 수 있도록 모델 구현도 코드 안에 작성했습니다. 이 예제는 외부 모델 서비스를 호출하지 않습니다.

저장소 루트에서 의존성과 빌드 산출물을 준비합니다.

```bash
pnpm install
pnpm build
```

### 1. 구성 작성

저장소 루트에 `goondan.yaml`을 작성합니다.

```yaml
name: hello-goondan
agents:
  assistant:
    model: main
    input: {fn: normalize}
    systemMessage:
      text: 참고 자료와 도구 결과를 바탕으로 설명하세요.
    tools: [lookup]
    extensions:
      memory:
        options: {prefix: "참고: "}
    hooks:
      modelInput:
        - {extension: memory}
```

`main`, `normalize`, `lookup`, `memory`는 호스트가 등록할 이름입니다. `memory.options`는 확장에 전달하는 설정입니다. `version`을 생략하면 `1`이고, `flow`를 생략하면 처음 선언한 에이전트 하나를 실행합니다. 입력 변환이 필요 없으면 `input`도 생략할 수 있습니다.

### 2. TypeScript 구현 주입

저장소 루트에 `bindings.ts`를 작성합니다. 예제는 로컬 빌드 결과를 import합니다. 별도 호스트 프로젝트에서 패키지를 설치해 사용할 때에는 import 경로를 `@goondan/core`로 지정합니다.

```ts
import {
  defineExtension,
  type RuntimeBindings,
} from "./packages/core/dist/index.js";

export const bindings: RuntimeBindings = {
  models: {
    main: {
      async generate(input) {
        const result = input.messages.flatMap((message) => message.content)
          .find((part) => part.type === "tool.result");
        return {
          message: {
            id: crypto.randomUUID(), role: "assistant", source: "model",
            content: result
              ? result.content
              : [{ type: "tool.call", callId: "lookup-1", name: "lookup", args: { query: "Goondan" } }],
          },
          finishReason: result ? "stop" : "tool",
        };
      },
    },
  },
  functions: {
    normalize: (value) => typeof value === "string" ? value.trim() : value,
  },
  tools: {
    lookup: {
      name: "lookup", description: "제품 설명을 찾습니다.",
      input: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      execute(value, ctx) {
        return {
          callId: ctx.toolCall.id, name: "lookup", args: value,
          content: [{ type: "text", text: "Goondan은 YAML로 에이전트를 구성합니다." }],
        };
      },
    },
  },
  ports: { memoryText: "독자가 따라갈 수 있도록 순서대로 설명하세요." },
  extensions: {
    memory: defineExtension({
      name: "memory",
      requires: ["memoryText"],
      hooks: ["modelInput"],
      create({ options, ports }) {
        const note = ports.memoryText;
        if (typeof note !== "string") throw new Error("memoryText must be a string");
        const prefix = options && typeof options === "object" && !Array.isArray(options)
          && typeof options.prefix === "string" ? options.prefix : "";
        return {
          hooks: {
            modelInput(_value, ctx) {
              return ctx.append(ctx.message.user(prefix + note));
            },
          },
        };
      },
    }),
  },
};
```

이름별 구현을 담은 객체가 `bindings`입니다. `models`는 모델 응답을 만들고, `functions`는 값을 변환하며, `tools`는 모델이 요청한 작업을 실행합니다. `extensions`는 훅·도구·상태를 묶는 기능을 만들고, `ports`는 그 기능이 사용할 외부 연결을 전달합니다. 예제의 문자열 포트는 실제 호스트에서 검색 서비스나 저장소 객체로 바꿀 수 있습니다. 확장 정의의 `requires`는 필요한 포트 이름 배열, `hooks`는 인스턴스가 제공할 단계 이름 배열입니다.

`run.ts`에서는 구성과 구현을 연결하고 실행합니다.

```ts
import { createRuntime, loadConfig } from "./packages/core/dist/index.js";
import { bindings } from "./bindings.ts";

const runtime = createRuntime(await loadConfig("."), bindings);
try {
  const result = await runtime.runTurn("  Goondan을 설명해 주세요.  ", {
    conversationId: "example",
  });
  console.log(result.output.content);
} finally {
  await runtime.close();
}
```

TypeScript를 직접 실행할 수 있는 Node 환경에서 다음 명령을 실행합니다. 저장소의 `mise.toml`은 Node 25를 지정합니다. 다른 환경에서는 호스트 파일을 JavaScript로 컴파일하여 실행할 수 있습니다.

```bash
node run.ts
```

### 3. Python 구현 주입

같은 `goondan.yaml`을 사용합니다. 저장소 루트에 `run.py`를 작성합니다.

```python
import asyncio
from goondan import (
    Extension, create_runtime, define_extension, define_tool, load_config,
)

async def model(model_input):
    result = next((
        part for message in model_input["messages"] for part in message["content"]
        if part["type"] == "tool.result"
    ), None)
    return {
        "message": {
            "role": "assistant", "source": "model",
            "content": result["content"] if result else [{
                "type": "tool.call", "callId": "lookup-1", "name": "lookup",
                "args": {"query": "Goondan"},
            }],
        },
        "finishReason": "stop" if result else "tool",
    }

def lookup(value, ctx):
    return [{"type": "text", "text": "Goondan은 YAML로 에이전트를 구성합니다."}]

def memory(*, options, ports, agent, log):
    def add_context(value, ctx):
        return ctx.append(ctx.message.user(options.get("prefix", "") + ports["memoryText"]))
    return Extension(hooks={"modelInput": add_context})

async def main():
    runtime = create_runtime(
        config=load_config("."),
        models={"main": model},
        functions={"normalize": lambda value: value.strip() if isinstance(value, str) else value},
        tools={"lookup": define_tool(
            name="lookup", description="제품 설명을 찾습니다.",
            input={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
            execute=lookup,
        )},
        ports={"memoryText": "독자가 따라갈 수 있도록 순서대로 설명하세요."},
        extensions={"memory": define_extension(
            name="memory", requires=["memoryText"], hooks=["modelInput"], create=memory,
        )},
    )
    try:
        result = await runtime.run_turn("  Goondan을 설명해 주세요.  ", conversation_id="example")
        print(result["output"]["content"])
    finally:
        await runtime.close()

asyncio.run(main())
```

```bash
uv run --project python/goondan python run.py
```

두 언어의 예제는 모두 `Goondan은 YAML로 에이전트를 구성합니다.`를 출력합니다. Python 도구 구현은 내용 부분 배열을 반환하고 런타임이 호출 식별자를 붙입니다. TypeScript 도구는 `ToolResult`를 반환합니다. Python 모델 구현은 모델 입력 하나만 받는 호출 가능 객체이거나 `generate(model_input, ctx)`를 가진 객체이며, 메시지의 `id`와 `source`는 런타임이 채웁니다.

실제 모델을 연결할 때에는 `models.main`에 공식 어댑터나 직접 만든 구현을 넣습니다([공식 모델 어댑터](#공식-모델-어댑터)). YAML의 `model: main`은 그대로 유지할 수 있습니다.

## 구성을 확장하는 방법

### 에이전트 연결과 상속

에이전트를 직렬로 연결하려면 최상위에 `flow: [analyst, editor]`를 선언합니다. 앞 에이전트의 출력 텍스트가 다음 에이전트의 입력이 되고 마지막 결과를 반환합니다. 조건 분기와 전달 방식을 정해야 하면 `flow: {in: ..., routes: [...]}` 형식을 사용합니다. 공통 설정은 `inherit`로 재사용합니다.

```yaml
agents:
  analyst:
    model: main
    tools: [lookup]
    systemMessage: {text: 근거를 찾아 보고서를 작성하세요.}
  editor:
    inherit: analyst
    remove:
      tools: [lookup]
    systemMessage: {text: 내용은 보존하고 친절한 말투와 일상·업계 표준 용어로 다듬으세요.}
flow: [analyst, editor]
```

객체 필드는 키별로 병합하고 배열은 자식의 값으로 교체합니다. `remove.extensions`, `remove.tools`, `remove.hooks`로 특정 항목을 제거할 수 있습니다. 확장을 `enabled: false`로 설정하면 해당 확장과 그 훅을 함께 제외합니다.

### 파일과 템플릿 분리

`resources`에 YAML 파일 또는 구성 디렉터리를 선언하면 순서대로 합성합니다. 현재 파일의 값이 마지막에 적용됩니다. 템플릿 경로는 그 경로를 선언한 파일을 기준으로 해석합니다.

```yaml
resources:
  - ./agents.yaml
  - ./routing.yaml
agents:
  analyst:
    params: {audience: 개발자}
    systemMessage:
      template: templates/analyst.md
```

템플릿에서는 선언한 매개변수를 사용할 수 있습니다. 위 파일의 `templates/analyst.md`에는 `{{ params.audience }}가 이해할 수 있도록 설명하세요.`처럼 작성합니다. 환경별 덮어쓰기는 `variants/<이름>.yaml`에 두고 구성 로딩 시 선택합니다.

런타임은 선언했거나 정적으로 include한 템플릿만 구성을 읽을 때 읽어 둡니다. `templates/` 디렉터리 전체를 훑지 않으므로, 어디에서도 참조하지 않는 템플릿 파일은 읽지 않습니다.

### 승인과 실행 완료

`tools: [{tool: publish, approval: required}]`는 해당 도구 호출에 승인이 필요하다는 뜻입니다. 런타임은 최초 호출에 `pending`과 `operationId`를 담은 도구 결과를 저장하고 같은 에이전트의 독립적인 작업을 계속합니다. 승인 작업은 턴과 별도의 수명을 가지며, 결정과 전달은 호스트가 [승인 작업](#승인-작업) API로 처리합니다.

현재 실행을 도구 결과로 마치려면 동기 `toolResult` 확장 훅에서 `ctx.execution.complete(assistantMessage)`를 호출합니다. 같은 모델 응답에 포함된 도구 결과를 모두 저장한 뒤 `output` 훅을 거쳐 완료합니다. 대기 중인 승인 작업은 자신의 수명을 유지합니다.

## 호스트 API

두 호스트는 같은 실행 의미를 같은 구성의 API로 제공합니다. TypeScript는 `@goondan/core`에서, Python은 `goondan` 패키지에서 가져옵니다. 함수와 멤버 이름은 TypeScript가 camelCase, Python이 snake_case를 쓰지만, 직렬화되는 메시지·모델 입력·도구 결과·작업 기록의 필드 이름은 두 언어 모두 스펙의 camelCase를 그대로 씁니다.

### 구성 로딩과 검증

| 하는 일 | TypeScript | Python |
|---|---|---|
| 디렉터리나 파일에서 구성 읽기 | `await loadConfig(경로, {variants})`, 동기판 `loadConfigSync(경로, {variants})` | `load_config(경로, variants)` |
| 파일을 읽지 않고 구성 문서 검사 | `validateConfig(문서)` | `validate_config(문서)` |
| 런타임이 쓸 구성 준비 | `prepareRuntimeConfig(입력, 디렉터리)` | `create_runtime`이 내부에서 수행 |

`loadConfig`는 읽기·스키마·참조 단계를 적용하고 `directory`, `config`, `templates`, `nested`를 담은 결과를 반환합니다. `templates`에는 이미 읽은 템플릿의 내용이, `nested`에는 `config` 에이전트가 가리키는 중첩 구성이 들어 있으므로 런타임은 실행 중에 파일을 다시 읽지 않습니다. `validateConfig`는 파일을 읽지 않고 스키마와 참조 단계를 적용한 뒤(템플릿 파일 검사는 제외) 유효 구성을 반환합니다. `variants`는 `variants/<이름>.yaml`을 선택하며, 여러 개를 지정하면 배열 순서대로 합성합니다.

### 런타임 생성과 바인딩

```ts
const runtime = createRuntime(await loadConfig("."), bindings);
```

```python
runtime = create_runtime(config=load_config("."), models={...})
```

`createRuntime`은 `loadConfig`의 결과와 일반 구성 문서를 모두 받습니다. 일반 구성 문서를 넘기면 구성 디렉터리는 `directory` 바인딩이고, 지정하지 않으면 현재 작업 디렉터리의 실제 경로입니다. 런타임 생성은 스키마·참조·바인딩 단계를 모두 적용하므로 구성 오류는 첫 턴 전에 드러납니다. 런타임을 만든 뒤에 나오는 구성 오류는 확장 인스턴스를 준비할 때 인스턴스가 실제로 제공한 훅과 도구를 검사하는 오류뿐입니다.

| 바인딩 | TypeScript | Python | 값 |
|---|---|---|---|
| 모델 | `models` | `models` | 이름별 모델 구현이며 유일한 필수 항목입니다. |
| 도구 | `tools` | `tools` | 이름별 도구 구현입니다. |
| 함수 | `functions` | `functions` | 이름별 값 변환 함수입니다. |
| 확장 | `extensions` | `extensions` | 이름별 확장 정의입니다. |
| 포트 | `ports` | `ports` | 확장이 `requires`로 요구하는 외부 연결입니다. |
| 대화 저장소 | `conversationStore` | `conversation_store` | 생략하면 메모리 저장소를 만듭니다. |
| 작업 저장소 | `operationStore` | `operation_store` | 생략하면 메모리 저장소를 만듭니다. |
| 호스트 기능 | `host` | `host` | 승인 콜백과 이벤트 수신을 담은 객체입니다. |
| 이벤트 수신 | `host.emit` | `emit` 또는 `host.emit` | 모든 실행 이벤트를 받는 하나의 통로입니다. |
| 로거 | `logger` | `logger` | 확장 인스턴스가 `log`로 받습니다. |
| 모델 호출 상한 | `maxSteps` | `max_steps` | 에이전트 실행 하나의 모델 호출 수 상한인 1 이상의 정수입니다. 생략하면 상한이 없습니다. |
| 재시도 한도 | `maxRetries` | `max_retries` | 에이전트 실행마다 따르는 재시도 횟수의 상한인 0 이상의 정수이며 기본값은 `3`입니다. |
| 구성 디렉터리 | `directory` | `directory` | 파일에서 읽지 않은 구성 문서의 기준 디렉터리입니다. |

`maxSteps`나 `maxRetries`에 조건을 어기는 값을 지정하면 런타임 생성이 TypeScript에서는 `TypeError`로, Python에서는 `ValueError`로 실패합니다.

### 턴 실행

```ts
const result = await runtime.runTurn(input, { conversationId, agent, startAgent, signal });
```

```python
result = await runtime.run_turn(value, conversation_id=..., agent=..., start_agent=...)
```

`agent`는 [에이전트 경로](spec/goondan.md#에이전트-경로)이며, 그 에이전트 하나만 실행하고 route를 따르지 않습니다. `startAgent`(Python `start_agent`)는 최상위 구성의 에이전트 이름이며, 그 에이전트에서 흐름을 시작합니다. 두 값을 함께 지정하면 어떤 에이전트도 실행하지 않고 흐름 오류로 실패합니다. Python의 `conversation_id`는 기본값이 `"default"`이고, TypeScript는 `conversationId`를 반드시 지정합니다. TypeScript는 이 턴만 중단하는 `signal`도 받습니다.

런타임이 호스트와 구현에 알리는 `agent` 값은 모두 에이전트 경로입니다. YAML이 참조하는 이름, 시스템 블록 템플릿의 `agent.name`과 입력 메시지의 `source`는 선언 이름 그대로입니다.

### 턴 결과

성공한 턴은 다음 키를 가진 값을 반환합니다. Python은 같은 키를 가진 사전을 반환합니다.

| 키 | 값 |
|---|---|
| `output` | 대표 출력 메시지입니다. 출력이 여러 개이면 런타임이 각 출력 텍스트를 빈 줄로 이어 새로 만듭니다. |
| `outputs` | `out`에 도달한 출력 메시지를 도달한 순서대로 담은 배열입니다. |
| `usage` | 턴 전체의 사용량이며 `input`, `output`, `cacheRead`, `cacheWrite`를 가집니다. |
| `finishReason` | 턴의 종료 사유입니다. 출력이 여러 개이고 종료 사유가 서로 다르면 `other`입니다. |
| `status` | `done`입니다. |
| `runs` | 에이전트 실행 기록 배열입니다. |

`runs`의 각 항목은 턴이 기다린 에이전트 실행 하나 또는 훅 컨텍스트의 모델 호출 하나를 나타냅니다.

| 키 | 값 |
|---|---|
| `agent` | 실행한 에이전트의 경로입니다. |
| `turnId` | 그 실행의 턴 식별자이며 이벤트와 컨텍스트의 `turnId`와 같습니다. |
| `kind` | 실행이 시작된 방식인 `flow`, `nested`, `tool`, `hook`, `model` 가운데 하나입니다. |
| `usage` | 그 실행이 직접 받은 모델 응답의 사용량이며 하위 실행의 사용량은 포함하지 않습니다. |
| `finishReason` | 그 실행의 종료 사유이며 `status`가 `done`인 항목에만 있습니다. |
| `status` | 성공한 실행은 `done`, 실패한 실행은 `failed`입니다. |

항목은 흐름 단계의 실행 순서대로 놓이고, 한 실행이 시작한 하위 실행의 항목은 그 실행의 항목 바로 뒤에 시작한 순서로 들어갑니다. 실패한 항목도 그때까지 받은 사용량을 그대로 담으며 `finishReason`만 없습니다.

턴의 `usage`는 `runs`에 있는 모든 항목의 `usage`를 더한 값과 정확히 같습니다. 따라서 흐름 단계, 중첩 구성의 에이전트, 에이전트 도구, 훅의 `agent`, 컨텍스트의 `agents.run`과 `model.run`, 재시도로 다시 받은 모델 응답이 모두 합계에 들어갑니다. 비동기 훅이 시작한 실행, 승인된 작업의 실행과 완료 전달 턴은 자신의 수명을 가지므로 합계에 넣지 않습니다.

실패한 턴은 결과를 반환하지 않고 실행 오류를 던지며, 부분 `runs`도 반환하지 않습니다. 확장 인스턴스 준비의 구성 오류로 실패한 턴은 `GoondanConfigError`를 던집니다.

### 실행 중 제어

| 기능 | TypeScript | Python |
|---|---|---|
| 실행 중 입력 | `steer(conversationId, value)` | `steer(conversation_id, value)` |
| 실행 중단 | `abort(conversationId)` | `abort(conversation_id)` |
| 남은 작업 대기 | `await idle()` | `await idle()` |
| 종료 | `await close()` | `await close()` |

`steer`는 값을 그 대화 식별자의 대기열 끝에 넣고 즉시 반환합니다. 값은 `runs`의 `kind`가 `flow`나 `nested`인 실행이 안전한 대화 처리 지점에 도달할 때 사용자 메시지 하나가 되어 그 대화 끝에 저장됩니다. 하위 대화의 실행은 받지 않습니다. 실행 중 입력은 `input` 단계 훅, `input` 규칙과 제어 결과의 중복 검사를 거치지 않습니다. 진행 중인 턴이 없을 때 보낸 값은 다음 턴이 받습니다.

`abort`는 그 대화 식별자로 진행 중인 모든 턴과 그 턴이 시작한 모든 실행을 중단하고, 중단한 턴이 하나라도 있으면 `true`를 반환합니다. 턴이 끝나기를 기다리지 않으며, 하위 대화의 식별자, 비동기 훅의 작업, 승인된 작업의 실행은 대상이 아닙니다. 대기열에 남은 실행 중 입력도 비우지 않습니다. 중단된 실행은 `where`가 `runtime`이고 `codes`가 `["aborted"]`인 실행 오류로 실패합니다.

`idle()`은 런타임이 호스트 요청 밖에서 이어 가는 작업, 즉 비동기 훅, 승인된 작업의 실행과 완료 전달이 모두 끝날 때까지 기다립니다.

`close()`는 진행 중인 모든 턴, 비동기 작업, 작업 실행과 완료 전달을 중단하고 확장 인스턴스를 정리합니다. 대기열의 실행 중 입력은 버립니다. 작업 저장소에 남은 기록은 그대로 두므로 같은 저장소로 만든 다음 런타임의 복구가 이어서 처리합니다. 닫은 런타임에 턴을 요청하면 `codes`가 `["runtime_error"]`인 실행 오류로 실패합니다.

### 실행 이벤트

런타임은 모든 실행 이벤트를 하나의 통로로 알립니다. TypeScript는 `host.emit`, Python은 `create_runtime(emit=...)` 또는 `host.emit`입니다. 중첩 구성과 하위 대화의 이벤트도 호스트가 만든 런타임의 같은 통로로 옵니다. 런타임은 이벤트를 호스트에 먼저 전달하고, 이어서 그 실행 범위의 확장 인스턴스 가운데 같은 이름의 처리기를 제공한 인스턴스에 인스턴스 생성 순서대로 전달합니다. 수신자가 실패하면 런타임은 그 실패를 무시하고 나머지 수신자에게 전달한 뒤 실행을 계속합니다.

이벤트는 `name`, `agent`, `conversationId`, `turnId`, `at`, `data` 키를 가진 객체입니다. `at`은 1970-01-01T00:00:00Z부터 지난 밀리초 수입니다. 이벤트 이름은 `turn.start`, `turn.done`, `turn.error`, `step.start`, `step.textDelta`, `step.done`, `step.error`, `tool.start`, `tool.done`, `tool.error`, `humanApproval.created`, `hook.applied`, `hook.skipped`, `hook.failed`입니다. 각 이벤트의 `data` 키는 [실행 이벤트](spec/goondan.md#실행-이벤트)에 있습니다.

### 승인 작업

승인 작업은 모델이 요청한 도구 호출을 호스트의 결정 뒤로 미루어 실행하는 작업이며, 작업을 만든 턴과 별도의 수명을 가집니다. 작업 상태의 정본은 작업 저장소입니다. 호스트는 다음 네 가지 요청으로 작업을 다룹니다.

| 요청 | TypeScript | Python | 하는 일 |
|---|---|---|---|
| 조회 | `listOperations(conversationId?)` | `list_operations(conversation_id=None)` | 저장된 작업을 만든 순서대로 반환합니다. |
| 결정 | `decideOperation(conversationId, operationId, {decision, inputPatch})` | `decide_operation(conversation_id, operation_id, decision)` | `pending` 작업을 승인하거나 거절합니다. |
| 취소 | `cancelOperation(conversationId, operationId)` | `cancel_operation(conversation_id, operation_id)` | 아직 실행하지 않은 작업을 취소합니다. |
| 복구 | `recoverOperations(conversationId?)` | `recover_operations(conversation_id=None)` | 저장소에 남은 작업을 이어서 처리합니다. |

결정과 취소는 기록한 직후의 작업을 반환하며 실행이나 전달이 끝나기를 기다리지 않습니다. 거부한 결정은 `codes`가 `["operation_invalid"]`인 실행 오류로 보고합니다. 조회는 닫힌 런타임에서도 저장소의 값을 반환하고, 결정·취소·복구는 `["runtime_error"]`로 실패합니다.

호스트 객체는 다음 선택 콜백을 제공할 수 있습니다.

| 콜백 | TypeScript | Python | 호출 시점 |
|---|---|---|---|
| 작업 문맥 캡처 | `captureOperationContext` | `capture_operation_context` | 작업을 저장하기 전에 승인 요청을 받아 `context`로 저장할 JSON 객체를 반환합니다. |
| 승인 요청 전달 | `requestApproval` | `request_approval` | 승인 요청을 호스트 UI에 전달합니다. 결정을 기다리지 않고 반환해야 합니다. |
| 입력 수정 검증 | `validateOperationInputPatch` | `validate_operation_input_patch` | `inputPatch`가 있는 결정을 받아들일지 판정합니다. 이 콜백이 없으면 입력 수정은 허용하지 않습니다. |
| 작업 검증 | `validateOperation` | `validate_operation` | 승인된 작업을 실행하기 전에 다시 판정합니다. |
| 완료 전달 | `deliverOperationCompletion` | `deliver_operation_completion` | 종결된 작업의 완료 입력을 호스트가 인수합니다. |

완료 전달 콜백이 없으면 런타임이 작업의 대화에서 완료 입력을 턴 입력으로 삼아 단일 에이전트 실행을 시작합니다. 완료 입력은 `type`, `deliveryId`, `operationId`, `conversationId`, `agent`, `status`, `toolCall`을 가지고, `completed`이면 `result`, `failed`이면 `error`와 `errorCode`를 가집니다. 다시 전달하는 완료 입력도 같은 `deliveryId`를 가지므로 호스트는 이 값으로 중복 전달을 판별합니다. 재시작 이후까지 이어갈 작업에는 호스트가 영속 저장소를 주입하고 런타임을 만든 뒤 복구를 요청해야 합니다.

### 저장소

| 저장소 | 기본 구현 | 메서드 |
|---|---|---|
| 대화 저장소 | `MemoryConversationStore` / `InMemoryConversationStore` | `load`, `append`, `replace` |
| 작업 저장소 | `MemoryOperationStore` / `InMemoryOperationStore` | `list`, `get`, `save`, `transition`, `claimDelivery`(`claim_delivery`), `releaseDelivery`(`release_delivery`) |

대화 저장소는 읽기와 저장만 담당합니다. 대화 식별자와 에이전트 경로 두 값을 함께 받으므로, 직접 구현할 때에는 두 값을 하나의 문자열로 이어 붙이지 말고 쌍으로 구분해야 서로 다른 대화가 섞이지 않습니다. 작업 저장소의 `transition`과 전달 관련 메서드는 작업 하나를 원자적으로 바꿔야 합니다. 각 언어의 정확한 시그니처는 `packages/core/src/types.ts`와 `python/goondan/goondan/types.py`에 있습니다.

### 구현 계약

**모델.** TypeScript 모델은 `generate(input, ctx)`를 가진 객체입니다. Python 모델은 `generate(model_input, ctx)`를 가진 객체이거나 모델 입력 하나만 받는 호출 가능 객체입니다. 모델 컨텍스트는 `agent`, `conversationId`(`conversation_id`), `turnId`(`turn_id`), `step`, `onTextDelta`(`on_text_delta`)를 가지며, TypeScript는 취소를 알리는 `signal`을 더 가집니다. Python은 모델 호출을 실행하는 작업을 취소해서 취소를 알립니다.

**도구.** TypeScript 도구는 `name`, `description`, `input`과 `execute(args, ctx)`를 가지며 `ToolResult`를 반환합니다. Python 도구는 `define_tool(name=, description=, input=, execute=)`로 만들고, `execute`는 내용 부분 배열, `content`를 가진 매핑, 그 밖의 임의 JSON 값 가운데 하나를 반환합니다. 부분 배열은 결과의 내용이 되고, 매핑은 도구 결과 자체이므로 `isError`, `keep`, `meta`가 그대로 남으며, 나머지 값은 하나의 `json` 부분이 됩니다. 어느 경우에도 `callId`, `name`, `args`는 런타임이 채웁니다.

도구 컨텍스트는 `input`, `conversation`, `agent`, `conversationId`, `turnId`, `toolCall`, `execution`과 `agents.run(name, value)`(Python `run_agent`)를 가집니다. TypeScript는 `signal`도 가집니다. Python 도구 컨텍스트는 같은 키를 가진 사전입니다.

**함수.** YAML이 이름으로 참조하는 호스트 함수는 JSON 값 하나를 인수로 받아 JSON 값을 반환합니다. 함수는 인수의 복사본을 받으며, 값을 반환하지 않으면 `null`을 반환한 것으로 봅니다. 훅 `when`과 route `when` 함수는 JSON 불리언을 반환해야 하며, 다른 값을 반환하면 훅 실패 또는 흐름 오류입니다.

**확장.** TypeScript는 `defineExtension({name, requires, hooks, tools, options, create})`, Python은 `define_extension(name=, create=, hooks=, tools=, requires=, validate_options=)`로 정의합니다.

| 필드 | 값 |
|---|---|
| `requires` | 인스턴스가 받을 포트 이름 배열입니다. |
| `hooks` | 인스턴스가 제공할 값 처리 단계 이름 배열입니다. 항목이 하나 이상이면 바인딩 단계에서 검사하고, 비어 있으면 인스턴스를 만들 때 검사합니다. |
| `tools` | 인스턴스가 제공할 도구 이름 배열이며 검사 시점은 `hooks`와 같습니다. |
| `options` / `validate_options` | 옵션 검증 함수입니다. 값을 반환하면 그 값이 옵션이 되고, 반환하지 않으면 원래 옵션을 씁니다. |
| `create` | 인스턴스를 만듭니다. |

`create`는 `options`, `ports`, `agent`, `log`를 받습니다. `agent`는 `name`(선언 이름), `path`(에이전트 경로), `spec`(유효 에이전트 구성)을 가집니다. 인스턴스는 `hooks`, `tools`, `on`, `dispose`를 제공할 수 있으며, 런타임은 런타임을 닫을 때와 준비가 실패했을 때 `dispose`를 호출합니다. `create`가 실패하면 실행 오류이지만, 선언한 훅 단계나 도구와 인스턴스가 실제로 제공한 것이 다르면 구성 오류이며 `optional` 설정과 관계없이 턴 전체가 실패합니다. 확장 인스턴스는 에이전트 경로와 대화 식별자의 조합마다 하나씩 만들어 다음 턴에서 재사용합니다.

**훅 컨텍스트.** 확장 훅은 받은 값과 함께 다음 멤버를 가진 컨텍스트를 받습니다.

| 멤버 | 값 |
|---|---|
| `agent` | 현재 에이전트의 경로입니다. |
| `conversationId`(`conversation_id`), `turnId`(`turn_id`) | 현재 에이전트 실행의 대화 식별자와 턴 식별자입니다. 비동기 훅은 예약한 턴의 값을 받습니다. |
| `input` | 에이전트 입력입니다. |
| `conversation` | 그 시점까지 저장된 에이전트 대화의 복사본입니다. |
| `retryCount`(`retry_count`) | 현재 실행에서 이미 따른 재시도 횟수입니다. |
| `message.user(text, extra)`, `message.system(text, extra)` | `text` 부분 하나를 가진 새 메시지를 만듭니다. `extra`로 `key`, `keep`, `meta`를 지정할 수 있으며, Python은 매핑이나 키워드 인수로 받습니다. |
| `append(messages...)` | 전달한 메시지를 담은 `append` 제어 결과를 만듭니다. |
| `agents.run(name, value)`(`run_agent`) | 같은 구성의 에이전트 하나를 같은 훅 하위 대화에서 실행합니다. |
| `model.run(messages)`(`run_model`) | 현재 에이전트의 모델을 한 번 호출하고 모델 결과를 반환합니다. 대화에 저장하지 않고 도구 호출도 실행하지 않습니다. |
| `render(template, variables)` | 이미 읽은 템플릿을 렌더링한 문자열을 반환합니다. Python에서는 `await`로 호출합니다. |
| `execution.complete(message)` | 현재 에이전트 실행을 끝낼 assistant 메시지를 예약합니다. |
| `signal` | TypeScript에서 훅에 취소를 알리는 신호입니다. Python은 훅 작업을 취소해서 알립니다. |

TypeScript는 `log`와 마지막으로 시작한 모델 호출 번호 `step`도 제공합니다. `render`가 받는 경로는 이미 읽은 템플릿의 절대 경로이거나 구성 디렉터리를 기준으로 한 상대 경로이며, 그 밖의 파일은 읽지 않습니다.

인라인 훅의 `agent` 배열은 모든 하위 실행이 끝날 때까지 기다린 뒤에 실패를 보고합니다. 비동기 `conversation` 훅은 언제나 선택 훅이고 실행을 막지 않으며, 실행 범위와 훅 식별자마다 한 번만 예약하고, 결과는 다음 안전한 대화 처리 지점에 반영합니다. 인라인 훅의 `optional` 기본값은 `agent`를 선언한 훅에서만 `true`입니다.

### 오류

구성 오류는 두 호스트 모두 `GoondanConfigError`로 보고합니다. Python의 `GoondanConfigError`는 `GoondanError`를 상속합니다. 예외의 `issues`에는 `code`, `path`, `message`를 가진 항목이 하나 이상 들어 있으며, 위치·코드·메시지 순으로 정렬되고 완전히 같은 항목은 한 번만 들어갑니다. 예외 메시지는 첫 줄 `Invalid Goondan configuration:` 뒤에 항목마다 `- <path>: <message> [<code>]` 한 줄을 이은 문자열이고, 빈 `path`는 `(root)`로 씁니다. TypeScript는 같은 문자열을 만드는 `formatConfigIssues(issues)`와 타입 가드 `isGoondanConfigError(value)`도 내보냅니다.

실행 오류는 `where`, `codes`, `message`, `attempt`를 가지며, `where`가 `tool`인 오류는 실패한 호출도 가집니다. 두 호스트 모두 이 필드를 같은 이름의 속성으로 가진 예외를 던지고, Python은 `toolCall`을 `tool_call` 속성으로 제공합니다. Python은 실행 오류를 `GoondanExecutionError`로, 중단된 실행을 `GoondanAbortError`로 던집니다. 같은 실패는 `error` 단계가 받는 값, `step.error`·`tool.error`·`turn.error` 이벤트의 `codes`, 턴이 던지는 예외에서 모두 같은 값입니다.

### 그 밖에 내보내는 이름

TypeScript `@goondan/core`는 스펙의 규칙을 그대로 구현한 도구 함수도 내보냅니다. 호스트가 런타임과 같은 판정을 직접 해야 할 때 사용합니다.

| 이름 | 하는 일 |
|---|---|
| `configSchema`, `validateSchema`, `unsupportedSchemaKeywords` | 구성 스키마 자체와 스키마 단계 검사입니다. |
| `parseConfigDocument`, `mergeValues` | YAML 해석 규칙과 값 병합 규칙입니다. |
| `bindingIssues`, `enabledExtensions` | 바인딩 단계 검사와 에이전트가 활성화한 확장 목록입니다. |
| `hookIdentifier`, `inlineHookIdentifier`, `templateIdentifier`, `valueNames` | 훅 식별자, 템플릿 식별자와 여덟 값 처리 단계의 이름입니다. |
| `jsonEqual`, `jsonText`, `sortIssues` | JSON 값 비교, JSON 텍스트 직렬화와 구성 오류 정렬입니다. |
| `appendMessages`, `controlResult`, `repairToolPairs`, `stageValueIssue`, `textOf` | 메시지 추가와 중복 제거, 제어 결과 판별, 도구 호출 쌍 정리, 단계 값 검사, 출력 텍스트입니다. |
| `defineExtension`, `defineTool`, `TemplateRenderer`, `TemplateRenderError`, `GoondanRuntime` | 정의 도우미, 템플릿 렌더러와 런타임 클래스입니다. |

Python `goondan`은 `load_config`, `validate_config`, `create_runtime`, `Runtime`, `define_extension`, `define_tool`, `Extension`, `ExtensionDefinition`, `Tool`, `HookContext`, `ModelContext`, `ExecutionHandle`, `Append`, `Completion`, `NoLog`, 두 저장소 프로토콜과 기본 구현, 그리고 `GoondanError`, `GoondanConfigError`, `GoondanExecutionError`, `GoondanAbortError`를 내보냅니다.

## 공식 모델 어댑터

공식 어댑터는 Anthropic Messages API와 OpenAI Chat Completions API(호환 엔드포인트 포함)를 지원합니다. 두 언어의 어댑터는 같은 설정과 모델 입력에서 같은 요청 본문을 만들고, 같은 스트림에서 같은 결과와 텍스트 조각, 오류 코드를 만듭니다. 상세 규칙은 [모델 어댑터 규격](spec/model-adapters.md)에 있습니다.

| 구분 | TypeScript `@goondan/models` | Python `goondan.models` |
|---|---|---|
| Anthropic | `createAnthropicModel(config)` | `anthropic_model(**settings)` |
| OpenAI | `createOpenAIChatModel(config)` | `openai_chat_model(**settings)` |
| 요청 변환 | `buildAnthropicRequest`, `buildOpenAIChatRequest` | `await model.build_request(model_input)` |
| 오류 | `ModelError`, `isModelError(value)` | `ModelError` |

```ts
import { createAnthropicModel } from "@goondan/models";

const bindings = { models: { main: createAnthropicModel({ model: "claude-sonnet-5" }) } };
```

```python
from goondan.models import anthropic_model

runtime = create_runtime(config=config, models={"main": anthropic_model(model="claude-sonnet-5")})
```

Python 어댑터는 `goondan[models]` 선택 의존성으로 설치하는 httpx를 사용하며, `goondan` 패키지 자체는 이를 다시 내보내지 않으므로 `from goondan.models import ...`로 가져옵니다.

설정 이름은 TypeScript가 `model`, `apiKey`, `baseUrl`, `headers`, `options`, `maxRetries`, `idleTimeoutMs`, `resolveMedia`, `env`, `fetch`이고, Python은 같은 이름의 snake_case에 `fetch` 대신 `http_client`를 씁니다. `model`만 필수이며 `maxRetries`의 기본값은 `2`입니다. 자격 증명과 기본 URL은 설정 값을 먼저 쓰고, 없으면 환경 변수를 읽습니다. 빈 문자열인 환경 변수는 없는 것으로 봅니다.

| 제공자 | API 키 | 인증 토큰 | 기본 URL | 공식 주소 |
|---|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_AUTH_TOKEN` | `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` |
| OpenAI | `OPENAI_API_KEY` | 없음 | `OPENAI_BASE_URL` | `https://api.openai.com/v1` |

Anthropic 기본 URL에는 API 버전 경로를 넣지 않고, OpenAI 기본 URL에는 `/v1` 같은 버전 경로까지 넣습니다. 공식 주소를 쓰는데 자격 증명이 없으면 생성 함수가 `authentication` 오류로 실패합니다. 다른 기본 URL은 자격 증명 없이도 쓸 수 있습니다. 어댑터에 내장된 주소는 두 공식 주소뿐이므로 게이트웨이나 호환 서버의 주소는 설정이나 환경 변수로만 지정합니다.

제공자별 설정으로 Anthropic은 `authToken`, `autoCache`, `cacheTtl`, `midConversationSystem`을, OpenAI는 `maxTokensField`, `streamUsage`, `systemRole`, `midConversationSystem`을 더 받습니다.

## 프로세스와 모듈 로딩

TypeScript 에이전트는 호스트의 Node 프로세스 안에서, Python 에이전트는 Python 프로세스 안에서 비동기로 실행합니다. `bash` 같은 도구가 외부 프로그램을 호출할 때에는 그 도구가 자식 프로세스를 만듭니다. 두 언어 사이의 호출이 필요한 호스트는 별도의 프로세스·RPC 연결을 도구로 제공합니다.

YAML은 구현 파일을 import하지 않습니다. 호스트가 구현을 import하여 이름별로 주입하고, Node나 Python의 모듈 로더가 캐시를 관리합니다. 에이전트를 실행할 때마다 구현 모듈을 다시 불러오지 않습니다.

호스트를 번들로 배포한다면 구현 코드와 YAML·템플릿 자산을 함께 배포하고, 구성 파일 사이의 상대 디렉터리 관계를 유지합니다. 공유 상태가 있는 구현은 한 진입점에서 생성해 주입합니다. 같은 코드를 번들 내부와 외부 모듈 양쪽에 포함하면 별개의 복사본이 생길 수 있으므로 빌드에서 포함 방식을 정해야 합니다.

## CLI 사용

위 예제 파일을 작성한 상태에서 다음 명령으로 구성을 검사하거나 실행할 수 있습니다.

```bash
pnpm gdn validate .
pnpm gdn config .
pnpm gdn run . --bindings ./bindings.ts --input "Goondan을 설명해 주세요."
pnpm gdn chat --config . --bindings ./bindings.ts
```

`config`는 파일 합성·상속·제거를 마친 유효 구성을 출력합니다. `--variant <이름>`으로 변형 파일을 선택하며 여러 번 지정하면 지정한 순서대로 합성합니다. `run`은 `--input` 대신 `--input-file <경로>`로 입력을 읽을 수 있고 둘 다 없으면 표준 입력을 읽으며, `--conversation-id`로 대화를, `--agent <에이전트 경로>`로 실행할 에이전트 하나를 지정합니다. `--bindings` 모듈은 `bindings` 또는 default export를 제공하며, TypeScript 파일의 직접 로딩은 실행하는 Node 환경의 지원을 따릅니다.

`chat`은 여러 턴의 대화를 처리합니다. `--session`으로 대화를 이어가고, `--state-dir`로 저장 위치를 지정하며, `--cwd`로 로컬 도구의 작업 디렉터리를 정합니다. 세션 파일의 기본 위치는 `~/.goondan/chat`이고, 형식은 대화 식별자 아래에 에이전트 경로별 메시지를 두는 버전 2입니다. 버전 1 파일은 읽을 때 세션 자신의 대화로 해석하고 다음 쓰기에서 버전 2로 올립니다. 실행 중 입력은 현재 대화에 전달됩니다. `/interrupt`와 실행 중 Ctrl+C는 실행을 취소하며 `/quit`은 종료합니다. `--final-only`는 flow의 최종 출력만 표준 출력에 표시합니다.

바인딩을 생략한 `chat`은 `@goondan/models`의 공식 어댑터와 파일·셸 도구를 사용합니다. 제공자는 `--provider anthropic|openai`, `GOONDAN_CHAT_PROVIDER` 순서로 정합니다. 둘 다 없으면 `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` 가운데 하나가 있을 때 Anthropic을, 그렇지 않고 `OPENAI_API_KEY`나 `OPENAI_BASE_URL`이 있을 때 OpenAI 호환 API를 사용합니다. 모델은 `--model`, `GOONDAN_CHAT_MODEL` 순서로 정하며 Anthropic의 기본값은 `claude-sonnet-5`이고 OpenAI 호환 API는 모델을 반드시 지정해야 합니다. `--base-url`은 선택한 제공자의 기본 URL 환경 변수보다 우선합니다. 예를 들어 로컬 Ollama에 연결하려면 다음과 같이 실행합니다.

```bash
pnpm gdn chat --provider openai --base-url http://localhost:11434/v1 --model llama3.1
```

모델 요청과 셸 실행에 기본 시간 제한을 두지 않으며, 실행 단계 상한은 호스트가 명시했을 때만 적용합니다.
