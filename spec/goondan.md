# Goondan YAML 규격

이 문서는 `goondan.yaml`이 선언하는 에이전트, 값 처리 단계, 도구와 실행 연결의 의미를 정의한다. 필드의 정확한 JSON 구조와 허용 형식은 [`goondan.schema.json`](./goondan.schema.json)을 기준으로 삼는다. 호스트가 YAML 밖에서 제공하는 API와 바인딩의 전체 목록은 [README](../README.md)를 참고한다.

Goondan 구성은 실행 의도를 담은 데이터다. YAML에 적힌 모델, 도구, 함수와 확장 이름은 호스트가 주입한 구현을 가리킨다. 같은 YAML을 읽는 호스트는 이 문서에 정의된 순서, 기본값, 전달 규칙과 오류 의미를 지켜야 한다.

## 최상위 구성

```yaml
version: 1
name: support

agents:
  responder:
    model: main

flow:
  in: responder
```

| 필드 | 의미 |
|---|---|
| `version` | 구성 형식의 버전이다. 생략하면 `1`이며, 지원하지 않는 값은 구성 오류다. |
| `name` | 구성의 이름이다. 생략하면 `goondan`이다. |
| `agents` | 이름으로 식별하는 에이전트 맵이다. 합성이 끝난 구성에는 에이전트가 하나 이상 있어야 한다. |
| `flow` | 최초 에이전트와 후속 연결을 정한다. 생략하면 `agents`에 처음 선언된 에이전트가 진입점이다. |
| `extends` | 현재 파일보다 먼저 합성할 YAML 파일이나 디렉터리 하나를 가리킨다. |
| `resources` | 현재 파일보다 먼저 선언 순서대로 합성할 YAML 파일이나 디렉터리 목록이다. |

최상위 문서는 `agents`, `resources`, `extends` 가운데 하나 이상을 선언해야 한다. `resources`와 `extends`만 있는 조각은 합성 결과에 유효한 `agents`와 `flow`를 제공해야 한다.

## 파일 합성, variant와 경로 기준

호스트는 진입 경로가 디렉터리이면 그 안의 `goondan.yaml`을 읽고, 파일이면 그 YAML 파일을 읽는다. `extends`와 `resources`의 상대 경로는 이를 선언한 YAML 파일의 디렉터리를 기준으로 해석한다. 디렉터리 참조는 그 디렉터리의 `goondan.yaml`을 가리킨다.

파일 하나의 합성 순서는 다음과 같다.

1. `extends`가 가리킨 구성을 합성한다.
2. `resources`를 배열 순서대로 합성한다.
3. 현재 파일에서 `extends`와 `resources`를 제외한 값을 합성한다.

호스트가 variant 이름을 전달하면 진입 파일이 있는 디렉터리의 `variants/<이름>.yaml`을 요청 순서대로 추가 합성한다. 각 variant도 자신의 `extends`와 `resources`를 같은 규칙으로 해석한다.

객체는 키별로 재귀 병합한다. 배열과 문자열, 숫자, 불리언, `null`은 뒤에서 선언한 값으로 전체를 교체한다. 동일한 실제 파일을 한 번의 리소스 그래프에서 두 번 읽으면 중복 리소스 오류가 발생하며, 리소스 참조가 순환하면 순환 경로를 포함한 구성 오류가 발생한다. 존재하지 않는 경로, YAML 파일이 아닌 파일과 객체가 아닌 YAML 문서도 구성 오류다.

경로를 포함하는 다음 선언은 해당 선언이 처음 나타난 YAML 파일의 디렉터리를 기준으로 절대 위치가 확정된다.

- `agents.<name>.config`
- `agents.<name>.input.template`
- `agents.<name>.systemMessage[].template`
- `agents.<name>.hooks.<단계>[].template`
- `flow.routes[].carry.message.template`

따라서 다른 디렉터리의 조각을 합성해도 그 조각이 참조한 템플릿과 중첩 구성의 출처가 유지된다. `params`와 `extensions.<name>.options` 안의 `template`, `config`, `extends`, `resources`라는 사용자 데이터 키는 경로나 합성 지시로 해석하지 않는다.

## 에이전트

에이전트는 모델을 직접 사용하거나 다른 Goondan 구성을 중첩 실행한다.

```yaml
agents:
  responder:
    description: 고객 문의에 답변한다.
    model: main
    params:
      locale: ko-KR
    input: asis
    systemMessage:
      - text: 정확하고 간결하게 답변한다.
        cache: true
    tools:
      - search
    extensions:
      memory:
        enabled: true
        options:
          namespace: support
    hooks: {}
```

| 필드 | 의미 |
|---|---|
| `description` | 에이전트를 도구로 노출할 때 사용하는 설명이다. |
| `model` | 호스트에 등록된 모델 이름이다. 일반 에이전트에는 필수다. |
| `config` | 중첩 실행할 다른 Goondan 구성의 경로다. `config` 에이전트는 자신의 나머지 실행 필드를 사용하지 않고 중첩 구성에 입력을 전달한다. |
| `params` | 템플릿과 확장에 전달할 JSON 객체다. |
| `input` | 턴 입력을 첫 사용자 메시지로 만드는 규칙이다. |
| `systemMessage` | 모델에 전달할 시스템 블록 한 개 또는 배열이다. |
| `tools` | 모델이 호출할 수 있는 호스트 도구와 에이전트 도구의 목록이다. |
| `extensions` | 호스트가 등록한 확장의 사용 설정이다. |
| `hooks` | 값 처리 단계마다 실행할 훅 배열이다. |
| `inherit` | 같은 최종 구성에 있는 부모 에이전트 이름이다. |
| `remove` | 상속과 합성으로 받은 도구, 확장과 훅을 이름으로 제거한다. |

### 입력

`input: asis`는 문자열을 그대로 사용하고 다른 JSON 값은 JSON 문자열로 직렬화하여 사용자 메시지를 만든다. `input` 객체는 다음 규칙을 사용한다.

- `fn`은 원래 JSON 입력을 호스트 함수에 전달하고 반환값을 문자열로 바꾼다.
- `template`은 객체 입력의 키를 템플릿 변수로 제공한다. 입력이 객체가 아니면 `text` 변수로 제공한다.
- `fields`는 입력 필드의 선언적 설명을 보존하는 맵이다. 현재 메시지 생성 결과는 `fn` 또는 `template`이 정한다.
- `fn`과 `template`이 모두 없으면 `asis`와 같은 방식으로 메시지를 만든다.

입력 메시지를 만들기 전에 `input` 단계 훅이 실행된다. 훅이 바꾼 값이 에이전트의 실제 입력이 된다.

### 시스템 메시지와 매개변수

각 시스템 블록은 `text` 또는 `template` 가운데 하나를 선언한다. `text`는 그대로 모델에 전달된다. `template`에는 다음 변수가 제공된다.

| 변수 | 값 |
|---|---|
| `params` | 에이전트의 `params` 객체이며, 생략한 경우 빈 객체다. |
| `tools` | 현재 에이전트에 노출되는 도구 정의 배열이다. |
| `agent.name` | 현재 에이전트 이름이다. |
| `model` | 현재 에이전트가 참조하는 모델 이름이다. |

`cache`는 해당 시스템 블록을 캐시 대상으로 취급할 수 있다는 힌트다. 실제 캐시 지원과 비용 계산은 모델 호스트가 결정한다.

### 도구

문자열 도구 항목은 같은 이름으로 호스트에 등록된 도구를 노출한다. 객체 항목은 다음 의미를 갖는다.

- `tool`은 호스트 도구 이름이다.
- `agent`는 같은 구성의 에이전트를 도구로 노출한다. 이 도구가 호출되면 호출 인수를 해당 에이전트의 입력으로 사용하고, 에이전트 출력 콘텐츠를 도구 결과로 반환한다.
- `hint`는 호스트 도구의 설명 뒤에 추가되어 모델에 전달된다.
- `approval: required`는 해당 호출을 승인 작업으로 전환한다.

존재하지 않는 도구나 에이전트 이름은 실행할 수 없다. 같은 객체에 `tool`과 `agent`를 함께 선언하면 의미가 모호하므로 구성은 둘 가운데 하나만 사용해야 한다.

### 확장

`extensions`의 맵 키는 호스트에 등록된 확장 이름이다. `options`는 확장 생성 시 전달할 JSON 객체다. `enabled: false`인 확장은 인스턴스를 만들지 않으며 그 확장을 참조하는 훅도 유효 에이전트에서 제거된다.

활성화된 확장 훅을 참조하려면 같은 에이전트의 `extensions`에 해당 이름이 있어야 한다. 등록되지 않은 확장이나 확장이 제공하지 않는 단계의 훅을 실행하려 하면 오류가 발생한다.

### 상속과 제거

`inherit`는 부모를 먼저 해석한 다음 자식 값을 일반 합성 규칙으로 병합한다. 상속 순환과 존재하지 않는 부모 이름은 구성 오류다. 부모 구성은 자식의 병합이나 제거 때문에 변경되지 않는다.

```yaml
agents:
  base:
    model: main
    tools: [search, write]
    extensions:
      audit: {}
      memory: {}
    hooks:
      modelInput:
        - name: trim-context
          fn: trimContext

  reader:
    inherit: base
    remove:
      tools: [write]
      extensions: [audit]
      hooks:
        modelInput: [trim-context]
```

`remove.tools`는 문자열 항목의 이름, 도구 객체의 `tool` 또는 `agent` 이름과 일치하는 항목을 제거한다. `remove.extensions`는 확장 맵의 키를 제거한다. `remove.hooks`는 단계별 이름 배열이며, 훅의 식별자는 `name`, `extension`, `fn`, `agent`, `template` 순서에서 처음 존재하는 값이다. 확장 제거로 남을 수 없는 해당 확장 훅도 함께 제거된다.

## 값 처리 단계와 훅

에이전트 실행은 다음 값을 순서대로 처리한다.

```text
input → conversation → modelInput → modelResult → toolCall → toolResult → output
                                              ↘ error ↗
```

`toolCall`과 `toolResult`는 모델이 요청한 호출마다 실행되며, 모델이 최종 assistant 메시지를 반환할 때까지 `modelInput` 이후 단계가 반복된다. 모델이나 도구 실행에서 발생한 실패는 `error` 단계에 전달된다. 각 단계의 훅은 YAML 배열 순서대로 실행하고, 앞 훅의 결과를 다음 훅의 현재 값으로 사용한다.

인라인 훅은 `extension`, `fn`, `agent`, `template`을 선언한다. `extension` 훅은 해당 확장이 제공한 단계 함수를 실행한다. 확장 훅이 아닌 인라인 훅에서 실행 요소를 함께 선언하면 다음 순서로 값을 변환한다.

1. `fn`이 현재 JSON 값을 받아 반환한 JSON을 다음 값으로 만든다.
2. `agent`가 그 값을 입력으로 실행된다. 배열이면 모든 에이전트를 같은 입력으로 병렬 실행하고 선언 순서대로 출력 텍스트를 줄바꿈으로 연결한다.
3. `template`이 직전 값을 `text`로 받아 문자열을 만든다.

인라인 템플릿에는 `text`, 원래 턴의 `input`, 현재 에이전트의 `params`가 제공된다. `conversation`과 `modelInput` 단계의 인라인 결과는 `role`이 지정한 메시지로 추가되며 기본 역할은 `user`다. `output` 단계의 결과는 assistant 메시지가 된다. 다른 단계의 결과는 해당 단계의 값 자체가 되므로 그 단계가 요구하는 JSON 구조를 유지해야 한다.

훅 실행 옵션은 다음과 같다.

| 필드 | 동작 |
|---|---|
| `name` | 훅을 식별한다. 제거, 비동기 중복 방지와 실행 기록에 사용한다. |
| `using` | 생략하면 현재 단계 값을 사용한다. `input`은 원래 턴 입력, `conversation`은 현재 대화를 사용한다. `{fn: 이름}`은 현재 값을 함수로 변환한 결과를 사용한다. |
| `when` | 지정한 함수가 `using`으로 선택한 값을 검사하여 참인 값을 반환할 때만 훅을 실행한다. |
| `mode` | 생략하거나 `sync`이면 결과를 기다려 다음 훅에 반영한다. `conversation` 단계에서 `async`를 지정하면 실행을 예약하고 현재 단계의 진행을 막지 않는다. |
| `optional` | 훅 실패를 기록한 뒤 다음 훅을 계속 실행할지를 정한다. 생략한 에이전트 훅은 선택 사항으로 취급하고, 다른 훅은 필수로 취급한다. |
| `role` | `conversation`과 `modelInput` 단계에서 인라인 결과로 만드는 메시지 역할이며 `user` 또는 `system`이다. |
| `timeout` | 양수 밀리초다. 동기 훅이 시간 안에 끝나지 않으면 훅 실패가 된다. |

비동기 훅은 `conversation` 단계에서 대화에 추가할 메시지를 준비하는 용도로 사용한다. 다른 단계에 `mode: async`를 선언하면 구성 오류다. 완료된 결과는 다음 안전한 대화 처리 지점에서 반영된다. 같은 에이전트와 대화에서 같은 훅 이름의 실행이 진행 중이면 중복 실행을 예약하지 않는다. 비동기 결과는 현재 단계 값을 교체하거나 승인·재시도·실행 완료를 제어하는 용도로 사용할 수 없다.

필수 훅의 함수, 확장, 에이전트 또는 템플릿 처리에서 오류가 발생하거나 제한 시간을 넘으면 현재 실행은 해당 단계의 `hook_error`로 실패한다. 선택 훅은 실패 사실을 기록하고 원래 현재 값으로 다음 훅을 계속한다. `when`이 거짓인 훅은 건너뛴 것으로 기록한다.

### `execution.complete`

동기 `toolResult` 확장 훅은 `execution.complete(assistantMessage)`를 호출해 현재 실행의 최종 assistant 메시지를 예약할 수 있다. 인수는 유효한 assistant 메시지여야 하며, 한 실행에서 한 번만 예약할 수 있다. 다른 단계와 비동기 훅에서 호출하면 오류가 발생한다.

한 모델 응답에 도구 호출이 여러 개 있으면 런타임은 같은 응답에 포함된 모든 도구를 실행하고 각 도구 결과를 대화에 저장한다. 그다음 예약된 메시지를 `output` 훅에 통과시키고 턴을 완료한다. 이 동작은 도구 결과를 잃지 않으면서 후속 모델 호출을 생략하는 실행 정책을 표현한다.

## 승인 작업

도구 객체의 `approval: required` 또는 동기 `toolCall` 훅의 승인 결과는 도구 실행을 지속 가능한 승인 작업으로 바꾼다. 런타임은 안정적인 `operationId`를 만들고 `pending` 상태와 대기 중인 도구 결과를 저장한 뒤 현재 턴의 실행을 계속한다. 대기 작업은 에이전트 턴을 점유하지 않는다.

호스트가 승인하면 런타임은 현재 권한과 실행 대상을 다시 검증하고 작업 상태를 `approved`, `running`, `completed` 순서로 전이한다. 거절과 취소는 각각 `rejected`, `cancelled`로 끝난다. 검증 또는 실행 실패는 `failed`이며 원인에 따라 `validation_failed`, `execution_failed`, `execution_interrupted` 오류 코드를 갖는다. 승인 결정에 허용된 입력 수정이 있으면 원래 도구 인수 객체에 병합한 값을 실제 호출에 사용한다.

종료된 작업은 안정적인 `deliveryId`를 가진 `operation_completion` 입력으로 요청한 대화와 에이전트에 한 번 전달된다. 호스트가 직접 완료 전달을 처리할 수 있고, 해당 기능이 없으면 런타임이 같은 에이전트의 새 턴으로 전달한다. 재시작한 런타임은 저장소에서 대기, 승인, 실행 중, 전달 대기 작업을 복구해야 한다.

## 흐름

`flow` 배열은 직렬 실행의 축약형이다.

```yaml
flow: [researcher, writer, reviewer]
```

첫 에이전트가 원래 입력을 받고, 각 에이전트의 출력 텍스트가 다음 에이전트의 입력이 된다. 마지막 에이전트에서 `out`으로 나가며 최종 출력만 반환한다. 배열은 비어 있지 않아야 하고 같은 에이전트 이름을 중복해서 포함할 수 없다.

조건 분기와 전달 방식은 객체형 흐름으로 선언한다.

```yaml
flow:
  in: classifier
  routes:
    - from: classifier
      to: specialist
      when: {fn: needsSpecialist}
      carry:
        message: {template: templates/request.md}
        conversation: none
    - from: classifier
      to: out
```

`in`은 최초 에이전트 이름이다. 각 route의 `from`과 `to`는 구성에 존재하는 에이전트 이름이어야 하며, `to`에는 종료점인 `out`도 사용할 수 있다. 에이전트가 끝나면 같은 `from`을 가진 route를 선언 순서대로 검사한다. `when`이 없거나 함수가 참인 값을 반환한 모든 route를 실행하므로 하나의 출력에서 여러 분기로 진행할 수 있다. 후보 route가 있는데 하나도 일치하지 않으면 흐름 오류가 발생한다.

route 조건 함수와 `carry.message` 함수에는 다음 JSON 객체가 전달된다.

| 키 | 값 |
|---|---|
| `output` | 직전 에이전트의 출력 텍스트다. |
| `input` | 직전 에이전트가 받은 입력이다. |
| `conversation` | 직전 에이전트 실행이 끝난 뒤의 대화 메시지 배열이다. |

`carry.message`를 생략하거나 `output`으로 지정하면 출력 텍스트를 다음 입력으로 사용한다. `{fn: 이름}`은 위 객체를 함수에 전달한 반환값을 사용한다. `{template: 경로}`는 `output`, `input`, `conversation`을 템플릿 변수로 제공하고 렌더링한 문자열을 사용한다.

`carry.conversation`을 생략하거나 `none`으로 지정하면 다음 에이전트가 자신의 대화에서 시작한다. `asis`는 현재 대화의 복사본을 다음 에이전트에 제공한다. `{fn: 이름}`은 현재 대화 배열을 함수에 전달하며, 반환값은 유효한 메시지 배열이어야 한다.

명시적으로 특정 에이전트만 실행하도록 호스트가 요청한 경우에는 흐름 route를 따라가지 않는다.

## 템플릿 지원 범위

템플릿은 Nunjucks와 Jinja2가 공통으로 해석할 수 있는 제한된 문법을 사용한다. 변수 출력, 조건문, 반복문, 정적 `include`와 다음 필터를 사용할 수 있다.

`default`, `join`, `trim`, `length`, `upper`, `lower`, `replace`, `json`

`defined` 테스트를 사용할 수 있다. `macro`, 템플릿 상속, `import`, `from`, `call`, `block`, 동적 `include`와 목록에 없는 필터·테스트는 사용할 수 없다. 정의되지 않은 변수를 읽거나 템플릿 구문을 해석할 수 없으면 오류가 발생한다. 템플릿 파일을 찾을 수 없어도 구성 로드 또는 실행이 실패한다.

템플릿이 받는 변수는 사용 위치별로 정해진다.

| 위치 | 변수 |
|---|---|
| `input.template` | 객체 입력의 각 키 또는 비객체 입력의 `text` |
| `systemMessage.template` | `params`, `tools`, `agent`, `model` |
| 인라인 훅의 `template` | `text`, `input`, `params` |
| `flow.routes[].carry.message.template` | `output`, `input`, `conversation` |

## 구성 오류와 실행 오류

호스트는 합성과 기본값 적용을 마친 구성을 검증하고, 실행 준비 과정에서 주입된 바인딩과 참조 관계를 검증한다. 다음 상태는 해당 선언을 실행하기 전에 오류로 처리해야 한다.

- 구성 버전, 필드 형식 또는 JSON 값이 스키마와 맞지 않는다.
- 에이전트가 모델, 중첩 구성 또는 유효한 상속 결과를 갖지 않는다.
- 흐름, 상속, 도구, 함수 또는 확장 참조가 존재하지 않는다.
- 리소스 그래프가 중복되거나 순환하고, 선언한 파일이나 템플릿을 읽을 수 없다.
- 훅 단계와 옵션의 조합이 지원 범위를 벗어난다.

실행 중 단계 값의 구조가 해당 단계의 요구 형식과 맞지 않거나 호스트 구현이 실패하면 현재 단계가 포함된 실행 오류를 반환한다. 구성과 실행 결과의 직렬화 구조가 필요할 때에는 [`goondan.schema.json`](./goondan.schema.json)과 호스트가 공개하는 타입을 함께 사용한다.
