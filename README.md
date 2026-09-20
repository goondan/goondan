# Goondan

Goondan은 여러 에이전트를 하나의 군단(goondan)으로 구성하고 실행하는 프레임워크입니다. `goondan.yaml`에는 모델·도구·함수·확장의 이름과 에이전트 사이의 `routes`를 선언하고, 호스트 프로그램은 각 이름에 실제 구현을 주입합니다. TypeScript와 Python 호스트는 같은 YAML을 각 언어의 프로세스에서 같은 의미로 실행합니다.

이 문서는 YAML 작성법과 두 호스트의 공개 API를 설명합니다. 모든 구성 필드와 실행 규칙은 [YAML과 동작 규격](spec/goondan.md), 편집기와 검증기가 사용하는 구조는 [JSON Schema](spec/goondan.schema.json), 공식 모델 어댑터의 요청 변환 규칙은 [모델 어댑터 규격](spec/model-adapters.md)에 있습니다.

## 핵심 개념

군단은 입력을 받아 하나 이상의 에이전트를 실행하고 출력 메시지를 반환하는 단위입니다. 에이전트는 선언 이름으로 식별하며, `routes`는 군단의 진입점 `$input`과 종료점 `$output` 사이에서 에이전트를 연결합니다.

| 하고 싶은 일 | Goondan에서 표현하는 방법 |
|---|---|
| 목표를 따라 모델과 도구를 반복 실행합니다. | 에이전트의 `model`과 `tools`를 선언합니다. |
| 특정 값이 만들어질 때 보조 기능을 적용합니다. | `input`, `modelInput`, `output` 등의 단계에 훅을 선언합니다. |
| 여러 훅과 도구를 한 기능으로 묶습니다. | `extensions`에 확장을 등록합니다. |
| 에이전트의 결과를 다른 에이전트에 전달하거나 분기합니다. | 최상위 `routes`를 선언합니다. |
| 에이전트 설정과 구성 파일을 재사용합니다. | `inherit`, `extends`, `resources`를 사용합니다. |
| 대화를 턴 사이에 이어 갑니다. | `stateful: true`인 에이전트를 같은 `sessionId`로 실행합니다. |

세션은 호스트가 정하는 상태 범위입니다. 대화(conversation)는 한 세션 안에서 `stateful: true`인 에이전트 하나가 쌓는 메시지 기록입니다. 같은 세션에서도 에이전트 이름이 다르면 대화를 공유하지 않습니다. `stateful: false`인 에이전트는 도달할 때마다 빈 대화와 새 인스턴스로 실행되며 대화를 저장하지 않습니다.

```text
구성 작성자                              호스트 작성자
 goondan.yaml                            모델·도구·함수·확장 구현
 templates/                              저장소·외부 서비스 연결
       │                                         │
       ▼                                         ▼
 loadConfig / load_config                 이름별 구현 주입
       └─────────────────┬───────────────────────┘
                         ▼
              createGoondan / create_goondan
                         │
                         ▼
              goondan.run(입력, 세션 옵션)
                         │
                         ▼
              routes에 따른 에이전트 실행
```

## 같은 YAML을 두 언어에서 실행하기

아래 예제는 모델이 도구를 호출하고 도구 결과를 최종 출력으로 반환합니다. 외부 모델 서비스는 호출하지 않습니다.

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
    stateful: true
    systemMessage:
      text: 도구 결과를 바탕으로 설명하세요.
    tools: [lookup]
    extensions:
      memory:
        options: {prefix: "참고: "}
    hooks:
      modelInput:
        - {extension: memory}

routes:
  - {from: $input, to: assistant}
  - {from: assistant, to: $output}
```

`main`, `lookup`, `memory`는 호스트가 등록할 이름입니다. `memory.options`는 확장에 전달하는 설정입니다. `version`을 생략하면 `1`입니다. `routes`를 생략하면 처음 선언한 에이전트 하나를 실행합니다.

### 2. TypeScript 구현 주입

저장소 루트에 `bindings.ts`를 작성합니다. 이 예제는 로컬 빌드 결과를 가져옵니다. 별도 호스트 프로젝트에서는 import 경로를 `@goondan/core`로 지정합니다.

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
            id: crypto.randomUUID(),
            role: "assistant",
            source: "model",
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
      execute(value, ctx) {
        return {
          callId: ctx.toolCall.id,
          name: "lookup",
          args: value,
          content: [{type: "text", text: "Goondan은 YAML로 에이전트를 구성합니다."}],
        };
      },
    },
  },
  ports: {
    memoryText: "독자가 따라갈 수 있도록 순서대로 설명하세요.",
  },
  extensions: {
    memory: defineExtension({
      name: "memory",
      requires: ["memoryText"],
      hooks: ["modelInput"],
      create({options, ports}) {
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

`run.ts`에서는 구성과 구현을 연결해 군단 객체를 실행합니다.

```ts
import {createGoondan, loadConfig} from "./packages/core/dist/index.js";
import {bindings} from "./bindings.ts";

const goondan = createGoondan(await loadConfig("."), bindings);
try {
  const result = await goondan.run("Goondan을 설명해 주세요.", {
    sessionId: "example",
  });
  console.log(result.output.content);
} finally {
  await goondan.close();
}
```

TypeScript를 직접 실행할 수 있는 Node 환경에서 실행합니다. 저장소의 `mise.toml`은 Node 25를 지정합니다.

```bash
node run.ts
```

### 3. Python 구현 주입

같은 `goondan.yaml`을 사용합니다. 저장소 루트에 `run.py`를 작성합니다.

```python
import asyncio

from goondan import Extension, create_goondan, define_extension, define_tool, load_config


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
            "source": "model",
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
    return [{"type": "text", "text": "Goondan은 YAML로 에이전트를 구성합니다."}]


def memory(*, options, ports, agent, log):
    def add_context(value, ctx):
        text = options.get("prefix", "") + ports["memoryText"]
        return ctx.append(ctx.message.user(text))

    return Extension(hooks={"modelInput": add_context})


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
        ports={"memoryText": "독자가 따라갈 수 있도록 순서대로 설명하세요."},
        extensions={"memory": define_extension(
            name="memory",
            requires=["memoryText"],
            hooks=["modelInput"],
            create=memory,
        )},
    )
    try:
        result = await goondan.run("Goondan을 설명해 주세요.", session_id="example")
        print(result["output"]["content"])
    finally:
        await goondan.close()


asyncio.run(main())
```

```bash
uv run --project python/goondan python run.py
```

두 예제는 모두 `Goondan은 YAML로 에이전트를 구성합니다.`라는 텍스트 부분을 출력합니다. Python 도구 구현은 내용 부분 배열을 반환하고 군단 객체가 호출 식별자를 붙입니다. Python 모델은 모델 입력 하나만 받는 호출 가능 객체이거나 `generate(model_input, ctx)`를 가진 객체입니다. 메시지의 `id`와 `source`가 빠졌으면 군단 객체가 채웁니다.

실제 모델을 연결할 때에는 `models.main`에 공식 어댑터나 직접 만든 구현을 넣습니다([공식 모델 어댑터](#공식-모델-어댑터)). YAML의 `model: main`은 그대로 유지할 수 있습니다.

## YAML 구성

### routes, 분기와 fan-in

이름 배열은 직렬 route의 축약형입니다. 다음 선언은 `$input → analyst → editor → $output`을 뜻합니다.

```yaml
agents:
  analyst:
    model: main
    systemMessage: {text: 근거를 찾아 보고서를 작성하세요.}
  editor:
    inherit: analyst
    systemMessage: {text: 내용은 보존하고 자연스러운 문장으로 다듬으세요.}

routes: [analyst, editor]
```

조건과 분기를 표현할 때에는 route 객체를 사용합니다. `when.output`이 문자열이면 출력 텍스트와 정확히 비교하고, 객체이면 출력 텍스트를 JSON 객체로 해석해 최상위 키가 부분 일치하는지 확인합니다.

```yaml
agents:
  classify:
    model: main
    stateful: false
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

route로 전달하는 메시지는 출발 에이전트의 출력 `content`를 보존하고 `role: user`, `meta.from`, `meta.instance`를 가집니다. `$output`에 도달한 메시지는 route 선언 순서로 `result.outputs`에 들어갑니다.

### 상속, 파일 합성과 템플릿

객체 필드는 키별로 병합하고 배열은 뒤의 값으로 전체 교체합니다. `inherit`로 같은 군단의 에이전트 설정을 물려받고, `remove.extensions`, `remove.tools`, `remove.hooks`로 항목을 제거할 수 있습니다. 확장을 `enabled: false`로 설정하면 해당 확장과 그 훅을 제외합니다.

`extends`와 `resources`는 YAML 파일이나 구성 디렉터리를 합성합니다. `resources`는 배열 순서대로 합성하고 현재 파일의 값을 마지막에 적용합니다. 환경별 값은 `variants/<이름>.yaml`에 두고 구성 로딩 시 선택합니다.

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

템플릿 경로는 그 경로를 선언한 YAML 파일을 기준으로 해석합니다. 군단 객체는 선언했거나 정적으로 include한 템플릿을 구성 로딩 시 읽고, 실행 중에는 파일을 다시 읽지 않습니다. YAML 작성자가 템플릿 경로에 절대 경로나 `..`를 사용할 수 있으므로, 신뢰할 수 없는 구성을 실행하는 호스트는 파일 접근 범위를 별도 프로세스나 호스트 정책으로 제한해야 합니다.

### 입력과 출력

`Goondan.run`은 다음 네 형식의 입력을 받습니다. 모든 입력은 `input` 단계 전에 메시지 배열로 바뀝니다.

| 입력 | 메시지 변환 |
|---|---|
| 메시지 배열 | 값을 그대로 사용합니다. 빈 배열도 메시지 배열입니다. |
| 내용 부분 배열 | 부분들을 가진 `user` 메시지 하나를 만듭니다. |
| 문자열 | `text` 부분 하나를 가진 `user` 메시지 하나를 만듭니다. |
| 그 밖의 JSON 값 | `json` 부분 하나를 가진 `user` 메시지 하나를 만듭니다. |

메시지 배열은 스키마의 메시지 형식을 만족해야 합니다. 내용 부분 배열은 비어 있지 않아야 합니다. `image`는 `url`, `media`는 `ref`와 `mediaType`으로 파일을 참조합니다.

에이전트의 `input` 규칙은 `input` 훅을 마친 메시지 배열 안의 `json` 부분을 `text` 부분으로 바꿉니다. `input.fn`은 각 `json` 값에 호스트 함수를 적용하고, `input.template`은 객체의 키 또는 객체가 아닌 값을 담은 `text` 변수로 템플릿을 렌더링합니다. 규칙을 생략하면 JSON 텍스트로 직렬화합니다. `text`, `image`, `media` 부분은 그대로 유지합니다.

시스템 메시지와 인라인 훅 템플릿은 에이전트 입력 메시지 배열인 `input`과 입력 텍스트인 `inputText`를 사용할 수 있습니다. 입력 텍스트는 메시지별 텍스트를 줄바꿈으로 연결합니다. 출력 텍스트는 assistant 메시지의 `text` 부분만 구분자 없이 이어 붙인 값입니다.

### 승인과 실행 완료

`tools: [{tool: publish, approval: required}]`는 해당 도구 호출에 승인이 필요하다는 뜻입니다. 군단 객체는 최초 호출에 `pending`과 `operationId`를 담은 도구 결과를 저장하고, 승인 작업은 턴과 별도의 수명으로 작업 저장소에 유지합니다. 호스트는 [승인 작업 API](#승인-작업)로 결정과 전달을 처리합니다.

현재 실행을 도구 결과로 마치려면 동기 `toolResult` 확장 훅에서 `ctx.execution.complete(assistantMessage)`를 호출합니다. 같은 모델 응답의 도구 결과를 모두 저장한 뒤 `output` 훅을 거쳐 실행을 마칩니다.

## 호스트 API

TypeScript는 `@goondan/core`, Python은 `goondan` 패키지에서 공개 API를 가져옵니다. TypeScript 이름은 camelCase, Python 이름은 snake_case를 사용합니다. 직렬화되는 메시지·모델 입력·도구 결과·이벤트·작업 기록의 필드 이름은 두 언어 모두 camelCase입니다.

### 구성 로딩과 군단 객체 생성

| 하는 일 | TypeScript | Python |
|---|---|---|
| 디렉터리나 파일에서 구성 읽기 | `await loadConfig(path, {variants})`, `loadConfigSync(path, {variants})` | `load_config(path, variants)` |
| 파일을 읽지 않고 구성 문서 검사 | `validateConfig(document)` | `validate_config(document)` |
| 군단 객체 생성 | `createGoondan(config, bindings)` | `create_goondan(config=config, **bindings)` |

`loadConfig`와 `load_config`는 읽기·스키마·참조 단계를 적용하고 유효 구성, 구성 디렉터리와 읽은 템플릿을 반환합니다. `validateConfig`와 `validate_config`는 파일을 읽지 않으므로 템플릿 파일을 검사하지 않습니다. 군단 객체 생성은 바인딩 단계까지 적용해 첫 턴 전에 구성 오류를 보고합니다.

```ts
const goondan = createGoondan(await loadConfig("."), bindings);
```

```python
goondan = create_goondan(config=load_config("."), models={...})
```

| 바인딩 | TypeScript | Python | 값 |
|---|---|---|---|
| 모델 | `models` | `models` | 이름별 모델 구현이며 필수입니다. |
| 도구 | `tools` | `tools` | 이름별 도구 구현입니다. |
| 함수 | `functions` | `functions` | 이름별 JSON 값 변환 함수입니다. |
| 확장 | `extensions` | `extensions` | 이름별 확장 정의입니다. |
| 포트 | `ports` | `ports` | 확장이 `requires`로 요구하는 외부 연결입니다. |
| 대화 저장소 | `conversationStore` | `conversation_store` | 생략하면 메모리 저장소를 만듭니다. |
| 작업 저장소 | `operationStore` | `operation_store` | 생략하면 메모리 저장소를 만듭니다. |
| 호스트 기능 | `host` | `host` | 승인 콜백과 이벤트 수신 기능을 담습니다. |
| 이벤트 수신 | `host.emit` | `emit` 또는 `host.emit` | 모든 실행 이벤트를 받습니다. |
| 로거 | `logger` | `logger` | 확장 인스턴스가 `log`로 받습니다. |
| 모델 호출 상한 | `maxSteps` | `max_steps` | 에이전트 실행 하나의 모델 호출 상한입니다. 생략하면 상한이 없습니다. |
| 재시도 한도 | `maxRetries` | `max_retries` | 에이전트 실행별 재시도 상한이며 기본값은 `3`입니다. |
| 구성 디렉터리 | `directory` | `directory` | 파일에서 읽지 않은 구성 문서의 기준 디렉터리입니다. |

`maxSteps`는 1 이상의 정수이고 `maxRetries`는 0 이상의 정수입니다. 조건을 어긴 값은 TypeScript에서 `TypeError`, Python에서 `ValueError`를 발생시킵니다.

### 턴 실행과 세션

```ts
const result = await goondan.run(input, {
  sessionId,
  agent,
  startAgent,
  signal,
});
```

```python
result = await goondan.run(
    value,
    session_id=session_id,
    agent=agent,
    start_agent=start_agent,
)
```

`sessionId`와 `session_id`는 필수이며 `#`을 포함할 수 없습니다. 같은 세션으로 요청한 턴은 도착 순서대로 하나씩 실행하고, 세션이 다르면 동시에 실행할 수 있습니다.

`agent`는 선언 이름으로 지정한 에이전트 하나만 실행하고 route를 평가하지 않습니다. `startAgent`와 `start_agent`는 지정한 에이전트에서 시작해 이후 route를 진행합니다. 두 옵션은 함께 사용할 수 없습니다. TypeScript의 `signal`은 해당 턴에만 취소를 알립니다.

에이전트 도구, 훅의 `agent`, 훅·도구 컨텍스트의 `agents.run`이 시작한 실행은 `<부모 sessionId>#<부모 turnId>#<대상 에이전트 이름>` 형식의 파생 세션을 사용합니다. 같은 부모 실행에서 같은 stateful 에이전트를 다시 호출하면 파생 세션 안의 대화를 이어 가고, 다음 부모 턴에서는 새 파생 세션을 만듭니다.

세션이 끝났으면 상태를 명시적으로 삭제할 수 있습니다.

```ts
await goondan.sessions.delete(sessionId);
```

```python
await goondan.sessions.delete(session_id)
```

세션 삭제는 지정한 세션과 파생 세션의 대화, 확장 인스턴스, 비동기 훅 결과와 실행 중 입력 대기열을 정리합니다. 승인 작업은 별도 수명을 가지므로 남겨 둡니다. 진행 중이거나 시작을 기다리는 턴이 있으면 삭제를 거부합니다.

### 턴 결과

성공한 턴은 다음 키를 가진 값을 반환합니다. Python은 같은 키를 가진 사전을 반환합니다.

| 키 | 값 |
|---|---|
| `output` | 대표 출력 메시지입니다. 출력이 여러 개이면 각 출력 텍스트를 빈 줄로 연결한 메시지입니다. |
| `outputs` | `$output`에 도달한 출력 메시지를 route 선언 순서로 담은 배열입니다. |
| `usage` | 턴 전체의 `input`, `output`, `cacheRead`, `cacheWrite` 사용량입니다. |
| `finishReason` | 턴의 종료 사유입니다. 여러 출력의 종료 사유가 다르면 `other`입니다. |
| `status` | `done`입니다. |
| `runs` | 턴이 기다린 에이전트 실행과 훅 컨텍스트의 모델 호출 기록입니다. |

`runs` 항목은 다음 키를 가집니다.

| 키 | 값 |
|---|---|
| `agent` | 실행한 에이전트의 선언 이름입니다. |
| `instance` | stateful 실행은 `<sessionId>/<agent>`, stateless 실행은 실행마다 새로 만든 식별자입니다. |
| `turnId` | 실행 식별자이며 이벤트와 컨텍스트의 `turnId`와 같습니다. |
| `parentInstance` | 직계 부모 실행의 인스턴스 식별자입니다. 최상위 실행에서는 `null`입니다. |
| `parentTurnId` | 직계 부모 실행의 턴 식별자입니다. 최상위 실행에서는 `null`입니다. |
| `rootTurnId` | 최초 `run` 요청에서 만든 최상위 턴 식별자입니다. 한 요청에서 파생된 실행은 같은 값을 공유합니다. |
| `kind` | 실행 시작 방식인 `turn`, `tool`, `hook`, `model`입니다. |
| `usage` | 해당 실행이 직접 받은 모델 응답의 사용량입니다. |
| `finishReason` | 성공한 실행의 종료 사유입니다. |
| `status` | `done`, `failed`, `aborted` 가운데 하나입니다. |

턴의 `usage`는 `runs`에 기록된 사용량의 합입니다. 비동기 훅이 시작한 실행, 승인된 작업의 실행과 완료 전달 턴은 각자 별도 수명을 가지므로 현재 턴의 합계에서 제외합니다. 실패한 턴은 결과를 반환하지 않고 실행 오류를 던집니다.

### 실행 중 제어와 종료

| 기능 | TypeScript | Python |
|---|---|---|
| 실행 중 입력 | `steer(sessionId, value, {agent})` | `steer(session_id, value, agent=agent)` |
| 실행 중단 | `abort(sessionId)` | `abort(session_id)` |
| 남은 작업 대기 | `await idle()` | `await idle()` |
| 종료 | `await close()` | `await close()` |

`steer`는 값을 세션의 대기열에 넣고 즉시 반환합니다. 진행 중인 `turn` 실행이 하나이면 `agent`를 생략할 수 있습니다. 실행이 여러 개이면 받을 에이전트 이름을 지정해야 합니다. 같은 이름의 실행이 둘 이상이거나 지정한 이름의 실행이 없으면 `steer_invalid` 오류가 발생합니다. 실행 중 입력은 안전한 대화 처리 지점에서 사용자 메시지가 되며 `input` 훅과 입력 규칙을 거치지 않습니다.

`abort`는 그 세션에서 진행 중인 턴과 해당 턴이 시작한 실행을 중단하고, 중단한 턴이 있으면 `true`를 반환합니다. 시작을 기다리는 다음 턴, 비동기 훅과 승인된 작업 실행은 대상이 아닙니다.

`idle()`은 군단 객체가 호스트 요청 밖에서 이어 가는 비동기 훅, 승인된 작업 실행과 완료 전달이 끝날 때까지 기다립니다. `close()`는 진행 중인 실행과 비동기 작업을 중단하고 확장 인스턴스를 정리합니다. 시작을 기다리는 턴은 `runtime_error`로 실패합니다. 작업 저장소의 기록은 유지됩니다.

### 실행 이벤트

TypeScript는 `host.emit`, Python은 `emit` 또는 `host.emit`으로 모든 실행 이벤트를 받습니다. 파생 세션의 이벤트도 같은 수신 기능으로 전달됩니다. 이벤트 수신자가 실패해도 군단 객체는 나머지 수신자와 실행을 계속합니다.

이벤트는 `name`, `agent`, `sessionId`, `turnId`, `instance`, `parentInstance`, `parentTurnId`, `rootTurnId`, `at`, `data`를 가집니다. `instance`와 `turnId`는 이벤트를 낸 실행을 식별합니다. 부모가 없는 최상위 실행은 두 부모 필드가 `null`이고, 같은 `run` 요청에서 route, 하위 에이전트, 비동기 훅과 승인 작업으로 이어진 실행은 같은 `rootTurnId`를 공유합니다. `at`은 Unix epoch부터 지난 밀리초 수입니다. 이벤트 이름은 `turn.start`, `turn.done`, `turn.error`, `step.start`, `step.textDelta`, `step.done`, `step.error`, `tool.start`, `tool.done`, `tool.error`, `humanApproval.created`, `hook.applied`, `hook.skipped`, `hook.failed`입니다. 각 이벤트의 `data`와 식별자 전파 규칙은 [실행 이벤트 규격](spec/goondan.md#실행-이벤트)에 정의되어 있습니다.

### 승인 작업

호스트는 다음 요청으로 승인 작업을 다룹니다.

| 요청 | TypeScript | Python | 하는 일 |
|---|---|---|---|
| 조회 | `listOperations(sessionId?)` | `list_operations(session_id=None)` | 저장된 작업을 만든 순서대로 반환합니다. |
| 결정 | `decideOperation(sessionId, operationId, decision)` | `decide_operation(session_id, operation_id, decision)` | `pending` 작업을 승인하거나 거절합니다. |
| 취소 | `cancelOperation(sessionId, operationId)` | `cancel_operation(session_id, operation_id)` | 아직 실행하지 않은 작업을 취소합니다. |
| 복구 | `recoverOperations(sessionId?)` | `recover_operations(session_id=None)` | 저장소에 남은 작업을 이어서 처리합니다. |

승인 요청은 `operationId`, `sessionId`, `turnId`, `agent`, `instance`, `parentInstance`, `parentTurnId`, `rootTurnId`, `toolCall`, `reasons`를 가집니다. 결정과 취소는 기록 직후의 작업을 반환하며 실행이나 완료 전달을 기다리지 않습니다. 작업 기록에도 같은 실행 식별자를 보존하므로 재시작 뒤의 실행과 전달을 원래 요청에 연결할 수 있습니다.

호스트 객체는 다음 선택 콜백을 제공할 수 있습니다.

| 콜백 | TypeScript | Python | 호출 시점 |
|---|---|---|---|
| 작업 문맥 캡처 | `captureOperationContext` | `capture_operation_context` | 승인 요청을 받아 작업의 `context`를 만듭니다. |
| 승인 요청 전달 | `requestApproval` | `request_approval` | 승인 요청을 호스트 UI에 전달합니다. |
| 입력 수정 검증 | `validateOperationInputPatch` | `validate_operation_input_patch` | 결정의 `inputPatch`를 허용할지 판정합니다. |
| 작업 검증 | `validateOperation` | `validate_operation` | 승인된 작업을 실행하기 전에 판정합니다. |
| 완료 전달 | `deliverOperationCompletion` | `deliver_operation_completion` | 종결된 작업의 완료 입력을 인수합니다. |

완료 전달 콜백이 없으면 군단 객체가 작업의 `sessionId`에서 해당 에이전트를 단독 실행하여 완료 입력을 전달합니다. 완료 입력은 `type`, `deliveryId`, `operationId`, `sessionId`, `agent`, `turnId`, `instance`, `parentInstance`, `parentTurnId`, `rootTurnId`, `status`, `toolCall`을 가지며 상태에 따라 `result` 또는 `error`, `errorCode`를 추가합니다. 호스트는 안정적인 `deliveryId`로 중복 전달을 판별해야 합니다.

### 저장소

| 저장소 | 기본 구현 | 메서드 |
|---|---|---|
| 대화 저장소 | `MemoryConversationStore` / `InMemoryConversationStore` | `load`, `append`, `replace`, `deleteSession` / `delete_session` |
| 작업 저장소 | `MemoryOperationStore` / `InMemoryOperationStore` | `list`, `get`, `save`, `transition`, `claimDelivery` / `claim_delivery`, `releaseDelivery` / `release_delivery` |

대화 저장소의 `load`, `append`, `replace`는 세션 식별자와 에이전트 이름을 함께 받습니다. 두 값을 문자열로 단순 연결하면 조합이 충돌할 수 있으므로 튜플이나 구조화된 키로 구분해야 합니다. `deleteSession`과 `delete_session`은 세션 식별자가 인수와 같거나 `<인수>#`로 시작하는 파생 세션의 대화를 모두 지웁니다.

작업 저장소는 조건부 전이와 전달 선점·반환을 작업별로 원자적으로 처리해야 합니다. 정확한 시그니처는 `packages/core/src/types.ts`, `python/goondan/goondan/types.py`와 [작업 저장소 프로토콜](spec/goondan.md#작업-저장소-프로토콜)에 있습니다.

### 구현 계약

**모델.** TypeScript 모델은 `generate(input, ctx)`를 가진 객체입니다. Python 모델은 `generate(model_input, ctx)`를 가진 객체이거나 모델 입력 하나만 받는 호출 가능 객체입니다. 모델 컨텍스트는 `agent`, `sessionId`(`session_id`), `turnId`(`turn_id`), `step`, `onTextDelta`(`on_text_delta`)를 가지며 TypeScript에는 `signal`도 있습니다.

**도구.** TypeScript 도구는 `name`, `description`, `input`, `execute(args, ctx)`를 가지며 `ToolResult`를 반환합니다. Python 도구는 `define_tool`로 만들며, 실행 함수는 내용 부분 배열, `content`를 가진 매핑 또는 JSON 값을 반환할 수 있습니다. 도구 컨텍스트는 `input`, `conversation`, `agent`, `sessionId`, `turnId`, `toolCall`, `execution`, `agents.run(name, value)`과 취소 상태를 제공합니다. Python은 snake_case 키와 `run_agent`, 취소 상태를 나타내는 `cancelled`를 사용하며 TypeScript는 `signal`을 사용합니다.

**함수.** YAML이 이름으로 참조하는 함수는 JSON 값 하나를 받아 JSON 값을 반환합니다. route의 `when.fn`은 `{output, text, input}`을 받고 불리언을 반환해야 합니다.

**확장.** TypeScript는 `defineExtension`, Python은 `define_extension`으로 정의합니다. 생성 함수는 `options`, `ports`, `agent`, `log`를 받으며, `agent`는 `name`과 유효 에이전트 구성인 `spec`을 가집니다. 인스턴스는 `hooks`, `tools`, `on`, `dispose`를 제공할 수 있습니다. stateful 확장 인스턴스는 세션과 에이전트 이름의 조합마다 재사용하고, stateless 인스턴스는 실행이 끝나면 정리합니다.

**훅 컨텍스트.** 훅 컨텍스트는 다음 공개 멤버를 제공합니다.

| TypeScript | Python | 값 |
|---|---|---|
| `agent` | `agent` | 현재 에이전트의 선언 이름입니다. |
| `sessionId`, `turnId` | `session_id`, `turn_id` | 현재 에이전트 실행의 세션 식별자와 턴 식별자입니다. |
| `step` | `step` | 마지막으로 시작한 모델 호출 번호입니다. 아직 모델을 호출하지 않았으면 각각 `undefined`, `None`입니다. |
| `input`, `conversation` | `input`, `conversation` | 에이전트 입력과 현재 대화의 메시지 배열입니다. |
| `retryCount` | `retry_count` | 현재 실행에서 이미 따른 재시도 횟수입니다. |
| `message.user`, `message.system`, `append` | `message.user`, `message.system`, `append` | 메시지와 메시지 추가 결과를 만듭니다. |
| `agents.run` | `run_agent` | 같은 군단의 에이전트 하나를 파생 세션에서 실행합니다. |
| `model.run` | `run_model` | 현재 에이전트의 모델을 한 번 호출합니다. |
| `render` | `render` | 구성 로딩 시 읽은 템플릿을 렌더링합니다. |
| `execution.complete` | `execution.complete` | 동기 `toolResult` 확장 훅에서 현재 실행의 최종 메시지를 예약합니다. |
| `signal` | `cancelled` | 훅 취소 상태입니다. TypeScript는 `AbortSignal`, Python은 불리언을 사용합니다. |
| `log` | `log` | 호스트 로거이며, 로거를 제공하지 않았으면 아무 동작도 하지 않습니다. |

YAML이 참조하는 호스트 함수는 JSON 값 하나만 받고 별도의 실행 컨텍스트는 받지 않습니다.

### 오류

구성 오류는 두 호스트 모두 `GoondanConfigError`로 보고합니다. `issues`는 `code`, `path`, `message`를 가진 항목 배열입니다. 실행 오류는 `where`, `codes`, `message`, `attempt`를 가지며 도구 오류에는 실패한 호출도 들어 있습니다. Python은 일반 실행 오류를 `GoondanExecutionError`, 중단된 실행을 `GoondanAbortError`로 던집니다.

route 검증 오류는 `routes.reserved`, `routes.no_input`, `routes.no_output`, `routes.no_route`, `routes.unreachable`, `routes.cycle`, `routes.wait_cycle` 가운데 하나입니다. 실행 중 route 처리 오류는 `route_error`, 실행 중 입력의 대상 결정 오류는 `steer_invalid`입니다. 전체 오류 목록은 [오류 코드](spec/goondan.md#오류-코드)에 있습니다.

### 내보내는 주요 이름

TypeScript `@goondan/core`는 `Goondan`, `createGoondan`, 구성 로더와 검사기, 두 메모리 저장소, 정의 도우미, 템플릿 렌더러, 오류 클래스와 공개 타입을 내보냅니다. `jsonEqual`, `jsonText`, `textOf`, `mergeValues`, `validateSchema`처럼 규격의 판정을 구현한 도우미도 제공합니다.

Python `goondan`은 `Goondan`, `create_goondan`, 구성 로더와 검사기, 정의 도우미, 확장·도구·컨텍스트 타입, 두 저장소 프로토콜과 기본 구현, 오류 클래스를 내보냅니다. 정확한 목록은 `packages/core/src/index.ts`와 `python/goondan/goondan/__init__.py`를 기준으로 삼습니다.

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

## 프로세스와 모듈 로딩

TypeScript 에이전트는 호스트의 Node 프로세스 안에서, Python 에이전트는 Python 프로세스 안에서 비동기로 실행합니다. YAML은 구현 파일을 import하지 않습니다. 호스트가 구현을 import하여 이름별로 주입하고 각 언어의 모듈 로더가 캐시를 관리합니다.

호스트를 번들로 배포할 때에는 구현 코드와 YAML·템플릿 자산을 함께 배포하고 구성 파일 사이의 상대 디렉터리 관계를 유지합니다. 공유 상태가 있는 구현은 한 진입점에서 생성해 주입합니다.

## CLI 사용

위 예제 파일을 작성한 상태에서 다음 명령으로 구성을 검사하거나 실행할 수 있습니다.

```bash
pnpm gdn validate .
pnpm gdn config .
pnpm gdn run . --bindings ./bindings.ts --input "Goondan을 설명해 주세요."
pnpm gdn chat --config . --bindings ./bindings.ts
```

`config`는 파일 합성·상속·제거를 마친 유효 구성을 출력합니다. `--variant <이름>`은 여러 번 지정할 수 있으며 지정 순서대로 합성합니다.

`run`은 `--input`의 값을 JSON으로 해석할 수 있으면 JSON 값으로, 그렇지 않으면 원문 문자열로 실행합니다. `--input-file <경로>`도 같은 규칙을 적용하고, 두 옵션을 모두 생략하면 표준 입력을 읽습니다. `--session-id <ID>`로 세션을, `--agent <이름>`으로 단독 실행할 에이전트를 지정합니다. `--bindings` 모듈은 `bindings` 또는 default export로 `RuntimeBindings`를 제공해야 합니다.

`chat`은 `--session`으로 세션을 이어 가고, `--state-dir`로 저장 위치를 지정하며, `--cwd`로 로컬 도구의 작업 디렉터리를 정합니다. 세션 파일의 기본 위치는 `~/.goondan/chat/sessions`이며, 파일마다 에이전트 이름별 메시지를 보존합니다. 실행 중인 분기가 하나이면 일반 입력을 실행 중 입력으로 보내고, 병렬 실행 중 특정 에이전트로 보내려면 `/steer <AGENT> <INPUT>`을 사용합니다. `/interrupt`와 실행 중 Ctrl+C는 현재 턴을 중단하고 `/quit`은 종료합니다. `--final-only`는 최종 출력만 표시합니다.

바인딩을 생략한 `chat`은 `@goondan/models`의 공식 어댑터와 파일·셸 도구를 사용합니다. 제공자는 `--provider anthropic|openai`, `GOONDAN_CHAT_PROVIDER`, 자격 증명 환경 변수 순서로 정합니다. 모델은 `--model`, `GOONDAN_CHAT_MODEL` 순서로 정합니다. `--base-url`은 선택한 제공자의 기본 URL 환경 변수보다 우선합니다.

```bash
pnpm gdn chat --provider openai --base-url http://localhost:11434/v1 --model llama3.1
```

모델 요청과 셸 실행에는 기본 시간 제한이 없으며, 에이전트 실행의 모델 호출 상한도 호스트가 명시했을 때만 적용됩니다.
