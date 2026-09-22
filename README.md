# Goondan

Goondan은 여러 에이전트를 하나의 군단(goondan)으로 구성하고 실행하는 런타임입니다. `goondan.yaml`에는 모델·도구·함수·확장의 이름과 에이전트 사이의 `routes`를 선언하고, 호스트 프로그램은 각 이름에 실제 구현을 주입합니다. TypeScript와 Python 호스트는 같은 YAML을 각 언어의 프로세스에서 같은 의미로 실행합니다.

이 문서는 YAML 작성법과 두 호스트의 공개 API를 설명합니다. 모든 구성 필드와 실행 규칙은 [YAML과 동작 규격](spec/goondan.md), 편집기와 검증기가 사용하는 구조는 [JSON Schema](spec/goondan.schema.json), 공식 모델 어댑터의 요청 변환 규칙은 [모델 어댑터 규격](spec/model-adapters.md)에 있습니다.

## 핵심 개념

군단은 입력을 받아 하나 이상의 에이전트를 실행하고 출력 메시지를 반환하는 단위입니다. 에이전트는 선언 이름으로 식별하며, `routes`는 군단의 진입점 `$input`에서 에이전트나 함수 노드를 거쳐 선택적인 종료점 `$output`으로 이어집니다.

| 하고 싶은 일 | Goondan에서 표현하는 방법 |
|---|---|
| 모델과 도구를 반복 실행합니다. | 에이전트의 `model`과 `tools`를 선언합니다. |
| 입력 묶음마다 문서를 검색합니다. | `onPrompt` 훅을 선언합니다. |
| 모델 호출 전에 저장된 대화를 압축합니다. | `onStep` 훅을 선언합니다. |
| 여러 훅과 도구를 한 기능으로 묶습니다. | `extensions`에 확장을 등록합니다. |
| 에이전트 결과를 전달하거나 분기합니다. | 최상위 `routes`를 선언합니다. |
| 에이전트 설정과 구성 파일을 재사용합니다. | `inherit`와 `resources`를 사용합니다. |
| 대화를 턴 사이에 이어 갑니다. | `stateful: true`인 에이전트를 같은 `sessionId`로 실행합니다. |

세션은 호스트가 정하는 지속 가능한 실행 범위이며, 세션마다 append 전용 이벤트 스트림인 저널이 하나씩 있습니다. 대화(conversation)는 한 세션 안에서 에이전트 인스턴스 하나가 쌓는 메시지 기록입니다. `stateful: true`인 에이전트는 `(sessionId, 에이전트 이름)`에 해당하는 인스턴스의 대화를 이어 갑니다. `stateful: false`인 에이전트는 실행마다 빈 대화와 새 인스턴스로 시작합니다. 두 종류의 실행 기록은 모두 저널에 남지만, stateless 실행 기록은 다음 실행의 대화 맥락으로 재사용하지 않습니다.

```text
goondan.yaml + templates                 모델·도구·함수·확장 구현
             │                                      │
             ▼                                      ▼
   loadConfig / load_config                 이름별 구현 주입
             └──────────────────┬───────────────────┘
                                ▼
                     createGoondan / create_goondan
                                │
                                ▼
                     goondan.run(입력, 세션 옵션)
                                │
                                ▼
                    저널 기록과 routes 실행
```

Goondan 런타임은 도구 실행의 격리, 자격 증명 관리와 비용 통제를 제공하지 않습니다. 호스트는 필요한 도구 실행을 별도 프로세스나 샌드박스로 보내고, 권한과 사용 한도를 도구·모델 구현의 바깥에서 적용해야 합니다.

## 빠른 시작

아래 예제는 로컬 모델이 도구를 호출하고 도구의 텍스트 결과를 최종 출력으로 반환합니다. 외부 모델 서비스는 호출하지 않습니다.

저장소에서 TypeScript 코어를 빌드합니다.

```bash
pnpm --filter @goondan/core build
```

### 1. 구성 작성

저장소 루트에 `goondan.yaml`을 작성합니다.

```yaml
name: hello-goondan
agents:
  assistant:
    model: main
    stateful: true
    systemMessage:
      text: 도구 결과를 바탕으로 설명하세요.
    tools: [lookup]
    extensions:
      documentation: {}
    hooks:
      onPrompt:
        - {extension: documentation}

routes:
  - {from: $input, to: assistant}
  - {from: assistant, to: $output}
```

`main`, `lookup`, `documentation`은 호스트가 등록할 이름입니다. `version`을 생략하면 `1`입니다. `routes`를 생략하면 처음 선언한 에이전트 하나를 실행합니다.

### 2. TypeScript에서 실행

저장소 루트에 `run.ts`를 작성합니다. 타입 있는 `documentationExtension` 생성 함수가 검색 의존성을 직접 받고 확장 정의를 반환합니다.

```ts
import {
  createGoondan,
  defineExtension,
  loadConfig,
  type ExtensionDefinition,
  type RuntimeBindings,
} from "./packages/core/dist/index.js";

function documentationExtension(
  search: (query: string) => string,
): ExtensionDefinition {
  return defineExtension({
    name: "documentation",
    hooks: ["onPrompt"],
    create() {
      return {
        hooks: {
          onPrompt(value, ctx) {
            return [...value, ctx.message.system(search("Goondan"))];
          },
        },
      };
    },
  });
}

const bindings: RuntimeBindings = {
  models: {
    main: {
      async generate(input) {
        const result = input.messages
          .flatMap((message) => message.content)
          .find((part) => part.type === "tool.result");
        return {
          message: {
            role: "assistant",
            content: result
              ? result.content
              : [{
                  type: "tool.call",
                  callId: "lookup-1",
                  name: "lookup",
                  args: {query: "Goondan"},
                }],
          },
          finishReason: result ? "stop" : "tool",
        };
      },
    },
  },
  tools: {
    lookup: {
      name: "lookup",
      description: "제품 설명을 찾습니다.",
      input: {
        type: "object",
        properties: {query: {type: "string"}},
        required: ["query"],
      },
      execute() {
        return [{
          type: "text",
          text: "Goondan은 YAML로 에이전트를 구성합니다.",
        }];
      },
    },
  },
  extensions: {
    documentation: documentationExtension(
      () => "참고 문서: 에이전트 구성은 YAML에 선언합니다.",
    ),
  },
};

const goondan = createGoondan(await loadConfig("."), bindings);
try {
  const run = await goondan.run("Goondan을 설명해 주세요.", {
    sessionId: "example",
  });
  const result = await run.result;
  console.log(result.output);
} finally {
  await goondan.close();
}
```

저장소의 `mise.toml`이 지정한 Node 환경에서 실행합니다.

```bash
node run.ts
```

### 3. Python에서 실행

같은 `goondan.yaml`을 사용합니다. 저장소 루트에 `run.py`를 작성합니다.

```python
import asyncio
from collections.abc import Callable

from goondan import (
    Extension,
    ExtensionDefinition,
    create_goondan,
    define_extension,
    define_tool,
    load_config,
)


async def model(model_input):
    result = next((
        part
        for message in model_input["messages"]
        for part in message["content"]
        if part["type"] == "tool.result"
    ), None)
    return {
        "message": {
            "role": "assistant",
            "content": result["content"] if result else [{
                "type": "tool.call",
                "callId": "lookup-1",
                "name": "lookup",
                "args": {"query": "Goondan"},
            }],
        },
        "finishReason": "stop" if result else "tool",
    }


def lookup(value, ctx):
    return [{
        "type": "text",
        "text": "Goondan은 YAML로 에이전트를 구성합니다.",
    }]


def documentation_extension(
    search: Callable[[str], str],
) -> ExtensionDefinition:
    def create(**_):
        def add_context(value, ctx):
            return [*value, ctx.message.system(search("Goondan"))]

        return Extension(hooks={"onPrompt": add_context})

    return define_extension(
        name="documentation",
        hooks=["onPrompt"],
        create=create,
    )


async def main():
    goondan = create_goondan(
        config=load_config("."),
        models={"main": model},
        tools={"lookup": define_tool(
            name="lookup",
            description="제품 설명을 찾습니다.",
            input={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            execute=lookup,
        )},
        extensions={
            "documentation": documentation_extension(
                lambda _: "참고 문서: 에이전트 구성은 YAML에 선언합니다."
            ),
        },
    )
    try:
        run = await goondan.run(
            "Goondan을 설명해 주세요.",
            session_id="example",
        )
        result = await run.result
        print(result["output"])
    finally:
        await goondan.close()


asyncio.run(main())
```

```bash
uv run --project python/goondan python run.py
```

두 예제는 `Goondan은 YAML로 에이전트를 구성합니다.`를 출력합니다. 도구 구현은 내용 부분만 반환하고, 런타임이 `callId`, `name`, `args`를 채웁니다. 모델 구현의 작성용 응답에서 메시지 `id`와 `source`를 생략하면 런타임이 채웁니다.

## YAML 구성

### routes, 함수 노드와 최종 출력

이름 배열은 직렬 route의 축약형입니다. 다음 선언은 `$input → analyst → editor → $output`을 뜻합니다.

```yaml
agents:
  analyst:
    model: main
    systemMessage: {text: 근거를 찾아 보고서를 작성하세요.}
  editor:
    inherit: analyst
    systemMessage: {text: 내용을 보존하고 문장을 다듬으세요.}

routes: [analyst, editor]
```

조건과 분기를 표현할 때에는 route 객체를 사용합니다. `when.output`이 문자열이면 출력 텍스트와 정확히 비교하고, 객체이면 출력 텍스트를 JSON 객체로 해석해 최상위 키가 부분 일치하는지 확인합니다.

```yaml
agents:
  classify: {model: main, stateful: false}
  specialist: {model: main}
  general: {model: main}
  editor: {model: main}

routes:
  - {from: $input, to: classify}
  - {from: classify, to: specialist, when: {output: {route: specialist}}}
  - {from: classify, to: general, when: {output: {route: general}}}
  - {from: specialist, to: editor}
  - {from: general, to: editor}
  - {from: editor, to: $output}
```

한 출발점에서 조건이 일치한 route가 여러 개이면 분기가 동시에 진행됩니다. 여러 route가 `stateful: true`인 같은 에이전트에 도달하면, 그 에이전트는 출발 집합이 끝날 때까지 기다린 뒤 입력 메시지를 route 선언 순서로 이어 붙여 한 번 실행합니다. `stateful: false`인 에이전트는 도달한 입력마다 독립적으로 실행합니다.

`from`과 `to`에는 `{fn: 이름}` 함수 노드도 사용할 수 있습니다. 함수 노드는 메시지 배열을 받고 메시지 배열을 반환하며, 인스턴스와 입력 대기열을 만들지 않습니다. 호출 결과는 `route.function` 저널 이벤트로 기록됩니다.

```yaml
routes:
  - {from: $input, to: {fn: normalize}}
  - {from: {fn: normalize}, to: writer}
  - {from: writer, to: $output}
```

`to: $output`인 route는 선택 사항입니다. 어떤 갈래도 `$output`에 도달하지 않으면 턴은 성공하고 `outputs`는 빈 배열이며 `output`은 생략됩니다.

### 상속, 파일 합성과 템플릿

객체 필드는 키별로 병합하고 배열은 뒤의 값으로 전체 교체합니다. `inherit`로 같은 군단의 에이전트 설정을 물려받고, `remove.extensions`, `remove.tools`, `remove.hooks`로 항목을 제거할 수 있습니다. 확장을 `enabled: false`로 설정하면 해당 확장과 그 훅을 제외합니다.

`resources`는 YAML 파일이나 구성 디렉터리를 배열 순서대로 합성하고 현재 파일의 값을 마지막에 적용합니다.

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

템플릿 경로는 그 경로를 선언한 YAML 파일을 기준으로 해석합니다. 군단 객체는 선언했거나 정적으로 include한 템플릿을 구성 로딩 시 읽고, 실행 중에는 파일을 다시 읽지 않습니다. 신뢰할 수 없는 구성을 실행하는 호스트는 파일 접근 범위를 별도 프로세스나 호스트 정책으로 제한해야 합니다.

### 입력 형식과 추가 입력

`run`은 다음 네 형식의 입력을 받습니다. 모든 입력은 `onInput` 전에 메시지 배열로 바뀝니다.

| 입력 | 메시지 변환 |
|---|---|
| 메시지 배열 | 값을 그대로 사용합니다. 빈 배열도 메시지 배열입니다. |
| 내용 부분 배열 | 부분들을 가진 `user` 메시지 하나를 만듭니다. |
| 문자열 | `text` 부분 하나를 가진 `user` 메시지 하나를 만듭니다. |
| 그 밖의 JSON 값 | `json` 부분 하나를 가진 `user` 메시지 하나를 만듭니다. |

같은 `sessionId`의 턴이 진행 중일 때 다시 `run`을 호출하면 런타임은 입력을 대상 stateful 인스턴스의 대기열에 넣습니다. 실행은 다음 안전한 대화 처리 지점에서 그때까지 받은 입력을 처리합니다. 진행 중인 실행이 끝난 뒤 대기열에 입력이 남아 있으면 다음 실행을 시작합니다. 각 `run` 호출은 입력이 저널에 수락되면 실행 핸들을 반환하며, 핸들의 `result`가 자신이 합류한 턴의 결과를 전달합니다. 같은 턴에 합류한 핸들은 같은 턴 결과를 공유합니다.

`meta`에는 채널이나 요청 종류처럼 호스트가 입력에 붙이는 JSON 객체를 전달할 수 있습니다. 런타임은 이 값을 입력 메시지의 `meta`에 병합하며, 완성된 메시지에 같은 키가 있으면 메시지 값을 사용합니다. `kind`, `from`, `instance`, `operationId`는 런타임 예약 키입니다.

TypeScript의 `signal`이나 Python 호출 태스크 취소는 입력이 수락된 뒤에는 해당 호출자의 결과 대기만 끝냅니다. 수락된 입력과 턴은 계속 실행됩니다. 세션의 턴 전체를 중단하려면 `abort`를 사용합니다.

### 훅 시점

훅은 에이전트 실행의 값을 변환하거나 메시지를 보강합니다. 훅 하나에는 `extension`, `fn`, `agent`, `template` 가운데 실행 요소 하나만 선언합니다. `optional`의 기본값은 `false`입니다.

| 훅 | 실행 시점 | 저장 방식 |
|---|---|---|
| `onInput` | 입력 요청 하나마다 실행합니다. | 결과를 바로 저장하지 않습니다. |
| `onPrompt` | 시작 입력 묶음과 실행 중에 받은 입력 묶음마다 한 번 실행합니다. | 결과 메시지 배열을 대화에 저장합니다. |
| `onStep` | 재시도를 포함하여 모델을 호출하기 직전마다 실행합니다. | 저장된 대화와 결과의 차이를 저널에 기록합니다. |
| `onModelInput` | `onStep` 다음, 모델 호출 직전에 실행합니다. | 변경 사항은 해당 모델 호출에만 쓰고 저장하지 않습니다. |
| `onModelResult` | 작성용 모델 응답을 정규화한 뒤 실행합니다. | 결과 메시지를 대화에 저장합니다. |
| `onToolCall` | 모델 결과의 도구 호출마다 실행합니다. | 호출 자체는 직접 저장하지 않습니다. |
| `onToolResult` | 도구 반환값을 정규화한 뒤 실행합니다. | 도구 결과 메시지를 대화에 저장합니다. |
| `onOutput` | 에이전트 실행을 끝내기 직전에 실행합니다. | 최종 assistant 메시지를 저장하거나 교체합니다. |
| `onError` | 모델 호출이나 도구 호출이 실패한 뒤 실행합니다. | 결과를 직접 저장하지 않습니다. |

문서 검색처럼 새 입력 묶음에 대응하는 기능은 `onPrompt`에 둡니다. 다음 예시는 검색 결과를 입력 묶음마다 시스템 메시지로 추가합니다.

```yaml
hooks:
  onPrompt:
    - {fn: searchDocs, role: system}
```

대화 압축처럼 모델 호출마다 현재 저장 대화를 점검하는 기능은 `onStep`에 둡니다. 압축 함수는 메시지 배열을 받아 같은 형식의 배열을 반환해야 하며, 런타임은 전후 차이를 저널 이벤트로 기록합니다.

```yaml
hooks:
  onStep:
    - {fn: compactConversation}
```

`mode: async`인 훅은 아홉 시점에서 모두 사용할 수 있습니다. 비동기 훅은 현재 값을 막거나 바꾸지 않으며, 완료한 결과 메시지는 같은 stateful 인스턴스의 다음 안전한 대화 처리 지점에 예약 순서대로 반영됩니다. 실행이 끝난 뒤 완료되면 다음 실행의 첫 `onStep` 직전에 반영됩니다. stateless 인스턴스가 끝난 뒤 완료된 결과는 저장하지 않고 완료 이벤트만 알립니다.

업무상 반드시 지켜야 하는 조건은 프롬프트 문구에만 맡기지 말고 훅, 확장 또는 함수 route의 코드로 검사해야 합니다. 예를 들어 문서 검색의 페이지네이션은 `onPrompt` 확장이 다음 커서를 끝까지 소비하도록 구현하고, 부수 효과의 중복 제거는 도구 확장이 도메인 멱등 키를 검사하게 하며, 현재 commit 확인은 배포 함수 노드가 예상 SHA와 실제 SHA를 비교한 뒤에만 다음 route로 진행하게 합니다.

### 도구 반환값

도구 구현은 호출 메타데이터를 만들 필요가 없습니다. 다음 세 형식 가운데 하나를 반환하면 런타임이 `callId`, `name`, `args`를 채웁니다.

```ts
return [{type: "text", text: "완료했습니다."}];

return {
  content: [{type: "text", text: "실패했습니다."}],
  isError: true,
  meta: {retryable: false},
};

return {rows: 3};
```

객체에 `content` 키가 있으면 결과 객체로 해석합니다. `content`라는 데이터 필드 자체를 반환하려면 명시적인 `json` 부분으로 감쌉니다.

```ts
return [{type: "json", value: {content: "원본 데이터"}}];
```

### 확장 조립

확장은 외부 의존성을 인수로 받는 타입 있는 생성 함수로 조립하는 방식을 권장합니다. 빠른 시작의 `documentationExtension(search)`처럼 생성 함수가 완성된 확장 정의를 반환하면, 의존성의 타입과 수명이 호스트 코드에 드러납니다.

호스트 환경이 이름 기반 연결을 요구하면 확장 정의의 `requires`와 바인딩의 `ports`를 선택적으로 사용할 수 있습니다.

```ts
const extension = defineExtension({
  name: "memory",
  requires: ["memoryClient"],
  create({ports}) {
    const client = ports.memoryClient;
    if (!isMemoryClient(client)) throw new Error("memoryClient is invalid");
    return createMemoryInstance(client);
  },
});

const bindings = {
  models,
  extensions: {memory: extension},
  ports: {memoryClient},
};
```

## 호스트 API

TypeScript는 `@goondan/core`, Python은 `goondan` 패키지에서 공개 API를 가져옵니다. TypeScript 공개 이름은 camelCase, Python 공개 이름은 snake_case를 사용합니다. 직렬화되는 메시지·모델 입력·도구 결과·이벤트·작업 기록의 필드 이름은 두 언어 모두 camelCase입니다.

### 구성 로딩과 군단 객체 생성

| 하는 일 | TypeScript | Python |
|---|---|---|
| 디렉터리나 파일에서 구성 읽기 | `await loadConfig(path)`, `loadConfigSync(path)` | `load_config(path)` |
| 파일을 읽지 않고 구성 문서 검사 | `validateConfig(document)` | `validate_config(document)` |
| 군단 객체 생성 | `createGoondan(config, bindings)` | `create_goondan(config=config, **bindings)` |

`loadConfig`와 `load_config`는 읽기·스키마·참조 단계를 적용하고 유효 구성, 구성 디렉터리와 읽은 템플릿을 반환합니다. `validateConfig`와 `validate_config`는 파일을 읽지 않으므로 템플릿 파일을 검사하지 않습니다. 군단 객체 생성은 바인딩 단계까지 적용해 첫 턴 전에 구성 오류를 보고합니다.

| 바인딩 | TypeScript | Python | 값 |
|---|---|---|---|
| 모델 | `models` | `models` | 이름별 모델 구현이며 필수입니다. |
| 도구 | `tools` | `tools` | 이름별 도구 구현입니다. |
| 함수 | `functions` | `functions` | 이름별 값 처리 함수와 route 함수입니다. |
| 확장 | `extensions` | `extensions` | 이름별 확장 정의입니다. |
| 포트 | `ports` | `ports` | 확장이 `requires`로 요구하는 선택적인 이름 기반 연결입니다. |
| 저널 저장소 | `store` | `store` | 생략하면 메모리 저장소를 만듭니다. |
| 호스트 기능 | `host` | `host` | 이벤트 수신 기능을 담습니다. |
| 이벤트 수신 | `host.emit` | `emit` 또는 `host.emit` | 모든 실행 이벤트를 받습니다. |
| 로거 | `logger` | `logger` | 확장 인스턴스가 `log`로 받습니다. |
| 재시도 한도 | `maxRetries` | `max_retries` | 에이전트 실행별 재시도 상한이며 기본값은 `3`입니다. |
| 구성 디렉터리 | `directory` | `directory` | 파일에서 읽지 않은 구성 문서의 기준 디렉터리입니다. |

### run, 세션과 수명

```ts
const run = await goondan.run(input, {
  sessionId, // 생략하면 런타임이 생성합니다.
  meta: { channel: "web" },
  agent,
  startAgent,
  signal,
});
const result = await run.result;
```

```python
run = await goondan.run(
    value,
    session_id=session_id,  # 생략하면 런타임이 생성합니다.
    meta={"channel": "web"},
    agent=agent,
    start_agent=start_agent,
)
result = await run.result
```

TypeScript 실행 핸들은 `sessionId`, `turnId`, `inputId`, `result: Promise<TurnResult>`를 가집니다. Python 실행 핸들은 `session_id`, `turn_id`, `input_id`, 여러 번 기다릴 수 있는 `result`를 가집니다. 핸들 자체는 thenable이나 awaitable이 아닙니다. `sessionId`와 `session_id`를 생략하면 런타임이 세션 식별자를 만들어 핸들로 반환합니다. `agent`는 지정한 에이전트 하나만 실행하고 route를 평가하지 않습니다. `startAgent`와 `start_agent`는 지정한 에이전트에서 시작해 이후 route를 진행합니다. 두 옵션은 함께 사용할 수 없습니다.

입력 수락 전의 오류는 `run` 호출에서 발생하고, 수락 뒤 턴 실행 오류는 `result`에서 발생합니다. `result`를 즉시 기다리지 않아도 런타임이 내부에서 실패를 처리하며, 나중에 기다리면 같은 결과나 오류를 받습니다.

군단 객체의 수명 API는 다음과 같습니다.

| 기능 | TypeScript | Python |
|---|---|---|
| 턴 전체 중단 | `abort(sessionId)` | `abort(session_id)` |
| 남은 작업 대기 | `await idle()` | `await idle()` |
| 세션 스트림과 인스턴스 상태 삭제 | `await sessions.delete(sessionId)` | `await sessions.delete(session_id)` |
| 군단 객체 종료 | `await close()` | `await close()` |

`abort`는 현재 세션에서 진행 중인 턴과 그 턴이 시작한 실행을 중단하고, 대상이 있으면 `true`를 반환합니다. 비동기 훅과 승인된 작업 실행은 해당 턴과 수명이 다릅니다. `idle()`은 호스트가 `result`를 기다리지 않는 진행 중인 턴, 비동기 훅, 승인된 작업 실행과 완료 전달이 끝날 때까지 기다립니다. 턴 안의 훅·도구·함수에서 같은 런타임의 `idle()`을 기다리면 해당 턴이 자기 완료를 기다리므로 교착합니다. `close()`는 진행 중인 턴과 백그라운드 작업을 중단하고 확장 인스턴스와 임대를 정리합니다.

`sessions.delete`는 세션의 저널 스트림 전체를 삭제합니다. 모든 인스턴스 대화, 승인 작업, 입력, 턴 경계와 실행 기록이 함께 삭제됩니다. 열린 턴, 남은 입력, 작업 실행이나 완료 전달이 있으면 삭제를 거부합니다.

### 턴 결과와 실행 식별자

성공한 턴은 다음 키를 가진 값을 반환합니다. Python은 같은 camelCase 키를 가진 사전을 반환합니다.

| 키 | 값 |
|---|---|
| `turnId` | 군단 턴의 식별자입니다. |
| `output` | `outputs`의 텍스트를 빈 줄로 연결한 선택적인 편의 문자열입니다. |
| `outputs` | `$output`에 도달한 메시지 배열입니다. 단일 에이전트 실행에서는 출력 메시지 하나가 들어갑니다. |
| `usage` | 턴 전체의 `input`, `output`, `cacheRead`, `cacheWrite` 사용량입니다. |
| `finishReason` | 출력이 있을 때의 종료 사유입니다. |
| `status` | `done`입니다. |
| `runs` | 턴이 기다린 에이전트 실행 기록입니다. |

식별자는 다음 범위를 각각 나타냅니다.

| 식별자 | 범위 |
|---|---|
| `sessionId` | 군단 인스턴스와 저널 스트림 하나입니다. |
| `turnId` | 군단 턴 하나입니다. 같은 턴에 합류한 입력과 모든 실행이 공유합니다. |
| `instance` | 대화를 이어 가는 에이전트 인스턴스입니다. stateless 에이전트는 실행마다 새 값입니다. |
| `executionId` | 에이전트 실행 한 번입니다. |
| `inputId` | 수락된 `run` 입력이나 승인 완료 입력 하나입니다. |
| `parentExecutionId` | 직접 원인이 다른 에이전트 실행일 때 그 실행을 가리킵니다. |
| `operationId` | 직접 원인이 승인 작업일 때 그 작업을 가리킵니다. |

`runs` 항목은 `agent`, `instance`, `executionId`, `turnId`, 선택적인 `parentExecutionId` 또는 `operationId`, `kind`, `usage`, 선택적인 `finishReason`, `status`를 가집니다. `kind`는 `turn`, `tool`, `hook` 가운데 하나입니다.

### 승인 작업

`tools: [{tool: publish, approval: required}]`는 해당 도구 호출을 호스트의 결정 뒤에 실행한다는 뜻입니다. 작업 상태는 세션 저널에 남으며, 호스트는 실행 이벤트나 다음 두 요청으로 작업을 관측하고 결정합니다.

| 요청 | TypeScript | Python |
|---|---|---|
| 조회 | `operations.list(sessionId?)` | `operations.list(session_id=None)` |
| 결정 | `operations.decide(sessionId, operationId, value)` | `operations.decide(session_id, operation_id, value)` |

결정 값의 `decision`은 `approved`, `rejected`, `cancelled` 가운데 하나입니다. 승인 결정에는 선택적인 `inputPatch`를 넣을 수 있습니다. 런타임은 수정한 입력을 결정 시점과 실제 실행 직전에 현재 도구 입력 스키마로 검사합니다.

결정 요청은 기록 직후의 작업을 반환하며 실행이나 완료 전달을 기다리지 않습니다. 완료 입력은 대상 인스턴스의 입력 대기열로 들어갑니다. 세션을 열 때 저널을 재생하면 런타임이 열린 실행과 턴을 정리하고 승인된 작업과 완료 전달을 자동으로 복구합니다.

### 저널 저장소

`store`는 세션마다 append 전용 이벤트 스트림 하나를 제공합니다.

| 요청 | 역할 |
|---|---|
| `append` | 이벤트 배치를 원자적으로 추가합니다. 저장소가 `seq`를 채우고 `expected`와 펜싱 토큰을 검사합니다. |
| `scan` | 세션 스트림이나 전체 스트림을 순서대로 읽습니다. |
| `head` | 세션 스트림의 마지막 `seq`를 반환합니다. |
| `watch` | 새 이벤트가 생길 수 있음을 깨우기 신호로 알립니다. |
| `acquireLease` | 세션 실행권과 단조 증가하는 펜싱 토큰을 획득합니다. |
| `deleteSession` | 현재 토큰으로 세션 스트림을 원자적으로 삭제합니다. |

대화, 승인 작업, 턴과 에이전트 실행 상태는 저장된 이벤트를 버전이 붙은 순수 함수 `fold`로 재생한 결과입니다. append의 `writeId`는 응답 유실 뒤 같은 배치를 재시도할 때 중복 기록을 막고, `expected`는 낙관적 동시성 충돌을 감지합니다. 임대가 만료될 수 있으면 런타임은 턴 동안 갱신하며, 실행권을 잃은 토큰의 늦은 쓰기와 삭제는 저장소가 거부해야 합니다.

현재 지원 범위는 세션당 활성 작성자 하나입니다. 여러 서버가 같은 영속 저장소를 공유하는 구성을 지원하려면 해당 어댑터가 두 호스트의 공통 사례에서 다음 조건을 모두 통과해야 합니다.

- 같은 세션의 두 턴이 임대 획득 순서대로 실행되고 모든 입력·대화·결과를 보존합니다.
- 만료된 작성자의 append와 삭제를 더 큰 토큰이 발급된 뒤 거부합니다.
- 열린 작업이 있는 세션의 삭제와 삭제 전 토큰의 늦은 쓰기를 거부합니다.
- 긴 모델·도구 호출과 승인 대기 중 임대를 갱신하고, 갱신을 잃으면 실행을 끝내며 늦은 쓰기를 거부합니다.
- 유효한 임대가 있는 작업을 다른 실행자가 복구하지 않고, 임대 만료 뒤 복구할 때 `deliveryId`를 유지합니다.
- 삭제된 세션에 늦게 도착한 작업 완료가 스트림이나 새 턴을 만들지 않습니다.

이 조건을 통과하지 않은 저장소 어댑터는 단일 프로세스나 외부에서 단일 작성자를 보장한 구성에서 사용합니다.

저널 이벤트에는 fold 버전이 있습니다. 런타임은 지원 버전 이하의 이벤트를 읽고, 상태에 영향을 주지 않는 새 이벤트는 `skippable: true`일 때 건너뜁니다. 영속 저장소의 쓰기 버전을 올릴 때에는 새 버전을 읽는 런타임을 모든 실행자에 먼저 배포해야 합니다.

### 실행 이벤트

TypeScript는 `host.emit`, Python은 `emit` 또는 `host.emit`으로 실행 이벤트를 받습니다. 저장된 저널 이벤트는 append 직후 같은 봉투로 전달됩니다. 저널에 남지 않는 진행 이벤트는 `observational: true`를 가지며 전달 유실이 복구 결과에 영향을 주지 않습니다.

저널 이벤트에는 `turn.start`, `input.received`, `agent.start`, `agent.done`, `agent.error`, `route.function`, `operation.created` 등이 있습니다. 진행 이벤트에는 `step.*`, `tool.*`, `hook.start`, `hook.applied`, `hook.skipped`, `hook.failed`, `hook.cancelled`, `route.function.start` 등이 있습니다. 에이전트 실행은 `agent.*`, 군단 턴은 `turn.*`로 구분합니다.

이벤트는 범위에 따라 `sessionId`, `turnId`, `instance`, `executionId`, `inputId`, `parentExecutionId`, `operationId`를 사용합니다. 저널 이벤트에는 `seq`, `version`, `writeId`가 있고 관측 전용 이벤트에는 `observational: true`가 있습니다. 수신자 실패는 실행과 저널을 바꾸지 않습니다.

호출 이벤트의 `modelCall`·`hookCall`은 `executionId` 안에서, `routeCall`은 `turnId` 안에서 증가하는 양의 정수입니다. 모델·도구·훅 이벤트는 `retryCount`와 1부터 시작하는 `attempt`를 제공하며, `step.start`는 등록 모델 이름과 선택적인 제공자 식별자를 제공합니다. `step.done.data.usage`가 없으면 제공자가 사용량을 보고하지 않은 호출이고, `tool.done.data.result.isError`가 없으면 `false`로 해석합니다. 이러한 관측 전용 이벤트는 실시간 trace·span·metric·log 연동에 사용할 수 있지만, 저널 재생만으로 복원되는 데이터로 간주할 수는 없습니다.

### 구현 계약

**모델.** TypeScript 모델은 `generate(input, ctx)`를 가진 객체입니다. Python 모델은 `generate(model_input, ctx)`를 가진 객체이거나 모델 입력 하나만 받는 호출 가능 객체입니다. 구현은 관측용 제공자 식별자인 선택 필드 `provider`를 제공할 수 있습니다. 작성용 응답의 assistant 메시지는 `id`와 `source`를 생략할 수 있으며 런타임이 정규화합니다.

**도구.** TypeScript 도구는 `name`, `description`, `input`, `execute(args, ctx)`를 가집니다. Python 도구는 `define_tool`로 만듭니다. 두 언어 모두 [도구 반환값](#도구-반환값)의 세 형식을 사용합니다.

**함수.** `input.fn`과 훅 함수는 현재 값과 실행 컨텍스트를 받습니다. route 함수 노드는 메시지 배열과 턴 컨텍스트를 받아 메시지 배열이나 `null`을 반환합니다. route의 `when.fn`은 `{output, text, input}`을 받고 불리언을 반환해야 합니다.

**확장.** TypeScript는 `defineExtension`, Python은 `define_extension`으로 정의합니다. 생성 함수는 `options`, `ports`, `agent`, `log`를 받으며 인스턴스는 `hooks`, `tools`, `on`, `dispose`를 제공할 수 있습니다. stateful 확장 인스턴스는 세션과 에이전트 이름의 조합마다 재사용하고, stateless 인스턴스는 실행이 끝나면 정리합니다.

### 오류와 주요 공개 이름

구성 오류는 두 호스트 모두 `GoondanConfigError`로 보고합니다. 실행 오류는 `where`, `codes`, `message`, `attempt`를 가지며 도구 오류에는 실패한 호출도 들어 있습니다. Python은 일반 실행 오류를 `GoondanExecutionError`, 중단된 실행을 `GoondanAbortError`로 던집니다. 오류 코드 전체는 [규격의 오류 코드](spec/goondan.md#오류-코드)를 따릅니다.

TypeScript `@goondan/core`의 주요 공개 이름은 `Goondan`, `createGoondan`, 구성 로더와 검사기, `MemoryStore`, 저장소 오류, `fold`, 정의 도우미, 오류 클래스와 공개 타입입니다. Python `goondan`의 주요 공개 이름은 `Goondan`, `create_goondan`, 구성 로더와 검사기, `InMemoryStore`, 저장소·fold 오류, 정의 도우미와 공개 타입입니다. 정확한 목록은 `packages/core/src/index.ts`와 `python/goondan/goondan/__init__.py`를 기준으로 삼습니다.

## 공식 모델 어댑터

공식 어댑터는 Anthropic Messages API와 OpenAI Chat Completions API 호환 엔드포인트를 지원합니다. 두 언어의 어댑터는 같은 설정과 모델 입력에서 같은 요청 본문, 결과, 텍스트 조각과 오류 코드를 만듭니다.

| 구분 | TypeScript `@goondan/models` | Python `goondan.models` |
|---|---|---|
| Anthropic | `createAnthropicModel(config)` | `anthropic_model(**settings)` |
| OpenAI | `createOpenAIChatModel(config)` | `openai_chat_model(**settings)` |
| 요청 변환 | `buildAnthropicRequest`, `buildOpenAIChatRequest` | `await model.build_request(model_input)` |
| 오류 | `ModelError`, `isModelError(value)` | `ModelError` |

```ts
import {createAnthropicModel} from "@goondan/models";

const bindings = {
  models: {main: createAnthropicModel({model: "claude-sonnet-5"})},
};
```

```python
from goondan.models import anthropic_model

goondan = create_goondan(
    config=config,
    models={"main": anthropic_model(model="claude-sonnet-5")},
)
```

Python 어댑터는 `goondan[models]` 선택 의존성으로 설치하는 httpx를 사용합니다. 제공자별 설정과 환경 변수, 요청 변환 규칙은 [모델 어댑터 규격](spec/model-adapters.md)에 있습니다.

## 프로세스와 배포

TypeScript 에이전트는 호스트의 Node 프로세스 안에서, Python 에이전트는 Python 프로세스 안에서 비동기로 실행합니다. YAML은 구현 파일을 import하지 않습니다. 호스트가 구현을 import하여 이름별로 주입하고 각 언어의 모듈 로더가 캐시를 관리합니다.

호스트를 배포할 때에는 구현 코드와 YAML·템플릿 자산을 함께 배포하고 구성 파일 사이의 상대 디렉터리 관계를 유지합니다. 공유 상태가 있는 구현은 한 진입점에서 생성해 주입합니다.

## CLI 사용

```bash
pnpm gdn config .
pnpm gdn run . --bindings ./bindings.ts --input "Goondan을 설명해 주세요."
pnpm gdn chat --config . --bindings ./bindings.ts
```

`config`는 읽기·스키마·참조 검사를 거쳐 파일 합성·상속·제거를 마친 유효 구성을 출력합니다.

`run`은 `--input`의 값을 JSON으로 해석할 수 있으면 JSON 값으로, 그렇지 않으면 원문 문자열로 실행합니다. `--input-file <경로>`도 같은 규칙을 적용하고, 두 옵션을 모두 생략하면 표준 입력을 읽습니다. `--session-id <ID>`로 세션을, `--agent <이름>`으로 단독 실행할 에이전트를 지정합니다. `--bindings` 모듈은 `bindings` 또는 default export로 `RuntimeBindings`를 제공해야 합니다.

`chat`은 `--session`으로 세션을 이어 가고, `--state-dir`로 저장 위치를 지정하며, `--cwd`로 로컬 도구의 작업 디렉터리를 정합니다. 기본 저장 위치는 `~/.goondan/chat/sessions`이며 세션마다 JSONL 저널 파일 하나를 사용합니다. 실행 중에 입력하면 같은 `run` 경로로 현재 턴에 합류하며, `/agent <AGENT> <INPUT>`으로 대상을 지정할 수 있습니다. `/operations`, `/approve`, `/reject`, `/cancel`로 승인 작업을 다루고, `/interrupt`와 실행 중 Ctrl+C로 현재 턴을 중단하며, `/quit`으로 종료합니다. `--final-only`는 최종 출력만 표시합니다.

바인딩을 생략한 `chat`은 `@goondan/models`의 공식 어댑터와 파일·셸 도구를 사용합니다. 이 로컬 도구는 `--cwd` 밖의 절대 경로와 상위 경로도 받을 수 있고 셸 명령을 실행할 수 있으므로, 신뢰 경계에 맞는 별도 프로세스나 샌드박스에서 CLI를 실행해야 합니다. 제공자는 `--provider anthropic|openai`, `GOONDAN_CHAT_PROVIDER`, 자격 증명 환경 변수 순서로 정합니다. 모델은 `--model`, `GOONDAN_CHAT_MODEL` 순서로 정합니다. `--base-url`은 선택한 제공자의 기본 URL 환경 변수보다 우선합니다.

```bash
pnpm gdn chat --provider openai --base-url http://localhost:11434/v1 --model llama3.1
```

모델 요청과 셸 실행에는 기본 시간 제한이 없습니다. 호스트는 필요한 시간 제한, 취소 정책과 사용량 관측을 적용해야 합니다.

## 라이선스

Apache-2.0. 전문은 [`LICENSE`](./LICENSE)에 있습니다.
