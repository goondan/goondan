# Goondan

Goondan은 에이전트의 구성과 실행을 YAML로 정의하는 프레임워크입니다. YAML에는 사용할 모델·도구·함수·확장의 이름과 연결 순서를 적고, 호스트 프로그램이 그 이름에 실제 구현을 주입합니다. TypeScript와 Python은 같은 YAML을 읽고 각 언어의 프로세스에서 실행합니다.

이 문서는 설계의 출발점부터 YAML 작성, 구현 주입과 실행까지 설명합니다. 모든 구성 필드와 실행 규칙은 [YAML과 동작 스펙](spec/goondan.md), 편집기에서 사용하는 형식 정의는 [JSON Schema](spec/goondan.schema.json)에 있습니다.

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

`main`, `normalize`, `lookup`, `memory`는 호스트가 등록할 이름입니다. `memory.options`는 확장에 전달하는 설정입니다. `version`을 생략하면 `1`이고, `flow`를 생략하면 첫 에이전트를 실행합니다. 입력 변환이 필요 없으면 `input`도 생략할 수 있습니다.

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
      requires: { memoryText: true },
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

이름별 구현을 담은 객체가 `bindings`입니다. `models`는 모델 응답을 만들고, `functions`는 값을 변환하며, `tools`는 모델이 요청한 작업을 실행합니다. `extensions`는 훅·도구·상태를 묶는 기능을 만들고, `ports`는 그 기능이 사용할 외부 연결을 전달합니다. 예제의 문자열 포트는 실제 호스트에서 검색 서비스나 저장소 객체로 바꿀 수 있습니다.

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
            name="memory", requires=["memoryText"], create=memory,
        )},
    )
    try:
        results = await runtime.run_turn("  Goondan을 설명해 주세요.  ", conversation_id="example")
        print(results[0]["output"]["content"])
    finally:
        await runtime.close()

asyncio.run(main())
```

```bash
uv run --project python/goondan python run.py
```

두 언어의 예제는 모두 `Goondan은 YAML로 에이전트를 구성합니다.`를 출력합니다. Python 도구 구현은 내용 부분을 반환하고 런타임이 호출 식별자를 붙입니다. TypeScript 도구는 `ToolResult`를 반환합니다. Python의 `run_turn`은 flow의 출력 목록을 반환하며, TypeScript의 `runTurn`은 대표 `output`과 `outputs`를 제공합니다.

실제 모델을 연결할 때에는 `models.main`에 제공자의 요청·응답 형식을 Goondan의 모델 입력·결과로 변환하는 구현을 넣습니다. API 자격 증명도 그 호스트 구현에서 관리합니다. YAML의 `model: main`은 그대로 유지할 수 있습니다.

## 구성을 확장하는 방법

### 에이전트 연결과 상속

에이전트를 직렬로 연결하려면 최상위에 `flow: [analyst, editor]`를 선언합니다. 앞 에이전트의 출력 텍스트가 다음 에이전트의 입력이 되고 마지막 결과를 반환합니다. 공통 설정은 `inherit`로 재사용합니다.

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

### 승인과 실행 완료

`tools: [{tool: publish, approval: required}]`는 해당 도구 호출에 승인이 필요하다는 뜻입니다. 런타임은 최초 호출에 `pending`과 `operationId`를 반환하고 같은 에이전트의 독립적인 작업을 계속합니다. 호스트는 승인 UI를 제공하고 결정 API를 호출하며, 승인된 작업의 결과는 같은 대화에 별도 입력으로 전달됩니다.

TypeScript는 `operationStore`와 `host.requestApproval`, `host.validateOperation`, `host.deliverOperationCompletion` 등을 주입하고 `decideOperation`으로 결정을 전달합니다. Python은 `operation_store`와 같은 역할의 snake_case 호스트 메서드, `decide_operation`을 사용합니다. 재시작 이후까지 이어갈 작업에는 호스트가 영속 저장소와 안정적인 완료 입력 전달을 제공해야 합니다. 기본 저장소는 메모리에 유지됩니다.

현재 실행을 도구 결과로 마치려면 동기 `toolResult` 확장 훅에서 `ctx.execution.complete(assistantMessage)`를 호출합니다. 같은 모델 응답에 포함된 도구 결과를 모두 저장한 뒤 `output` 훅을 거쳐 완료합니다. 대기 중인 승인 작업은 자신의 수명을 유지합니다.

## 프로세스와 모듈 로딩

TypeScript 에이전트는 호스트의 Node 프로세스 안에서, Python 에이전트는 Python 프로세스 안에서 비동기로 실행합니다. `bash` 같은 도구가 외부 프로그램을 호출할 때에는 그 도구가 자식 프로세스를 만듭니다. 두 언어 사이의 호출이 필요한 호스트는 별도의 프로세스·RPC 연결을 도구로 제공합니다.

YAML은 구현 파일을 import하지 않습니다. 호스트가 구현을 import하여 이름별로 주입하고, Node나 Python의 모듈 로더가 캐시를 관리합니다. 에이전트를 실행할 때마다 구현 모듈을 다시 불러오지 않습니다. 확장의 `create`는 에이전트와 대화의 조합마다 호출되며 같은 조합의 다음 턴에서는 인스턴스를 재사용합니다.

호스트를 번들로 배포한다면 구현 코드와 YAML·템플릿 자산을 함께 배포하고, 구성 파일 사이의 상대 디렉터리 관계를 유지합니다. 공유 상태가 있는 구현은 한 진입점에서 생성해 주입합니다. 같은 코드를 번들 내부와 외부 모듈 양쪽에 포함하면 별개의 복사본이 생길 수 있으므로 빌드에서 포함 방식을 정해야 합니다.

## CLI 사용

위 예제 파일을 작성한 상태에서 다음 명령으로 구성을 검사하거나 실행할 수 있습니다.

```bash
pnpm gdn validate .
pnpm gdn config .
pnpm gdn run . --bindings ./bindings.ts --input "Goondan을 설명해 주세요."
pnpm gdn chat --config . --bindings ./bindings.ts
```

`config`는 파일 합성·상속·제거를 마친 유효 구성을 출력합니다. `--variant <이름>`으로 변형 파일을 선택할 수 있습니다. `--bindings` 모듈은 `bindings` 또는 default export를 제공하며, TypeScript 파일의 직접 로딩은 실행하는 Node 환경의 지원을 따릅니다.

`chat`은 여러 턴의 대화를 처리합니다. `--session`으로 대화를 이어가고, `--state-dir`로 저장 위치를 지정하며, `--cwd`로 로컬 도구의 작업 디렉터리를 정합니다. 실행 중 입력은 현재 대화에 전달됩니다. `/interrupt`와 실행 중 Ctrl+C는 실행을 취소하며 `/quit`은 종료합니다. `--final-only`는 flow의 최종 출력만 표준 출력에 표시합니다.

바인딩을 생략한 `chat`은 CLI에 포함된 Router 모델 어댑터와 파일·셸 도구를 사용하므로 해당 Router에 접근 가능한 환경이 필요합니다. `--model`은 이 기본 어댑터가 사용할 모델 이름을 선택합니다. 모델 요청과 셸 실행에 기본 시간 제한을 두지 않으며, 실행 단계 상한은 호스트가 명시했을 때만 적용합니다.
