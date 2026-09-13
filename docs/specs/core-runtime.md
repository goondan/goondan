# 코어 런타임 계약

이 문서는 Goondan 구성과 실행 의미의 기준입니다. TypeScript `@goondan/core`와 Python `goondan`은 각 언어의 호스트 프로세스 안에서 이 계약을 직접 실행합니다.

## 구성

`goondan.yaml`의 최상위 필드는 다음과 같습니다.

- `version`: 생략하면 `1`입니다.
- `name`: 생략하면 `goondan`입니다.
- `agents`: 이름으로 식별하는 에이전트 맵입니다.
- `flow`: 생략하면 `agents`의 첫 번째 에이전트입니다. 문자열 배열은 에이전트를 순서대로 실행하는 축약형입니다. `in`과 `routes` 객체는 조건 분기와 전달 규칙을 표현합니다.
- `extends`: 다른 YAML 구성을 상속합니다.
- `resources`: 여러 YAML 구성을 선언 순서대로 합성합니다.

YAML은 데이터 구성입니다. 모델, 도구, 함수, 확장은 호스트가 등록한 이름을 참조합니다. TypeScript 호스트는 Node 모듈로 TypeScript 구현을 등록하고 Python 호스트는 Python 객체로 Python 구현을 등록합니다.

### 합성과 상속

구성 파일은 `extends`, `resources`, 현재 파일, 요청한 variant 순서로 합성합니다. 객체는 키별로 재귀 병합하고 배열과 scalar는 뒤의 값으로 전체 교체합니다.

`options`와 `params`의 JSON은 사용자 데이터로 그대로 보존합니다. 그 안에 `template`, `config`, `extends` 또는 `resources`라는 키가 있어도 구성 로더가 경로나 합성 지시로 해석하지 않습니다. 경로 정규화는 `systemMessage`, `input`, `hooks`, `flow`의 carry에 명시한 템플릿과 에이전트의 `config`에만 적용합니다.

`agents.<name>.inherit`는 같은 구성의 에이전트 하나를 부모로 지정합니다. 부모를 먼저 해석한 뒤 자식 값을 같은 병합 규칙으로 적용합니다. 순환 상속과 존재하지 않는 부모는 구성 오류입니다.

에이전트는 합성 결과에서 다음 항목을 제거할 수 있습니다.

```yaml
agents:
  editor:
    inherit: base
    remove:
      extensions: [audit]
      tools: [search]
      hooks:
        modelInput: [trim-context]
```

`remove.extensions`와 `remove.tools`는 등록 이름 배열입니다. `remove.hooks`는 값 단계별 훅 이름 배열이며, 훅 이름은 `name`, `extension`, `fn`, `template` 순서로 결정합니다. 제거는 상속과 구성 합성을 마친 유효 에이전트를 만들 때 적용합니다.

### 에이전트 연결

`flow: [analyst, editor]`는 `analyst`의 출력을 `editor`의 입력으로 전달하는 직렬 실행이며 최종 에이전트의 출력 하나를 반환합니다. 고급 흐름은 `in`과 `routes`로 조건 분기와 전달 규칙을 정의합니다. `flow`의 연결은 구성 계층에서 에이전트 사이의 실행 관계를 정의합니다. 에이전트를 도구로 선언하면 모델이 실행 중에 해당 에이전트를 호출합니다.

## 호스트 바인딩

호스트는 모델, 도구, 함수, 확장, 저장소와 관측 포트를 이름으로 등록합니다. `extensions` 맵의 키는 호스트가 등록한 확장 이름입니다. 에이전트에서 제거하거나 `enabled: false`로 설정한 확장은 인스턴스를 만들지 않으며, 그 확장을 참조하는 훅도 실행하지 않습니다. 유효 에이전트에 남아 있는 훅이 등록되지 않은 확장 이름을 참조하면 구성 오류입니다.

대화 저장소는 메시지의 순서와 턴 완료 상태를 보존합니다. 승인과 같은 지연 작업은 `operationStore`가 유일한 정본으로 소유합니다. 작업은 대화 턴과 독립된 수명을 가지며, 완료 결과는 요청한 에이전트와 대화로 전달됩니다.

## 값 파이프라인

런타임은 다음 값을 순서대로 처리합니다.

`input → conversation → modelInput → modelResult → toolCall → toolResult → output`

각 값의 훅은 YAML에 선언한 순서대로 앞 훅의 반환값을 다음 훅에 전달합니다. 훅은 `name`으로 식별할 수 있고, 호스트 함수(`fn`), 확장(`extension`), 템플릿(`template`) 또는 에이전트(`agent`)를 실행합니다. `when`, `using`, `mode`, `optional`, `timeout`은 훅의 입력 선택과 실행 정책을 정합니다. 실패는 `error` 값으로 처리합니다.

인라인 훅에 여러 실행 항목을 선언하면 `fn` → `agent` → `template` 순서로 실행합니다. 함수는 현재 값을 받아 변환한 JSON을 다음 항목에 전달합니다. 에이전트는 그 값을 입력으로 받고 최종 출력의 텍스트를 다음 항목에 전달합니다. 에이전트 이름이 배열이면 같은 입력으로 병렬 실행하고, 선언한 순서대로 출력 텍스트를 줄바꿈으로 연결합니다. 템플릿은 직전 값을 `text`, 원래 턴 입력을 `input`, 에이전트 매개변수를 `params`로 받습니다.

`using`을 생략하면 현재 값이 입력입니다. 확장 훅은 `ctx.input`과 `ctx.conversation`에서 턴 입력과 대화를 읽을 수 있습니다. 인라인 훅의 최종 값은 `conversation`·`modelInput` 단계에서는 메시지 추가로, `output` 단계에서는 assistant 메시지로 변환합니다. 나머지 단계에서는 최종 값을 그대로 반환하므로 해당 단계의 JSON 형식을 유지해야 합니다. 다른 조합 순서는 훅 목록에 항목을 나누어 표현하거나 확장 내부 함수로 작성합니다.

동기 `toolResult` 확장 훅은 훅 문맥의 `execution.complete(assistantMessage)`를 호출하여 현재 실행의 완료를 예약할 수 있습니다. 런타임은 모델이 같은 응답에서 요청한 도구 호출을 모두 실행하고 각 결과를 저장합니다. 그 뒤 예약한 assistant 메시지를 `output` 훅에 통과시키고 턴을 완료합니다.

## 모델과 도구 반복

런타임은 사용자 입력을 저장하고 모델을 호출합니다. 모델이 도구를 요청하면 호출과 결과를 연결하여 저장한 뒤 다음 모델 호출을 수행합니다. 모델이 assistant 메시지로 응답하면 `output` 훅을 적용하고 턴을 완료합니다.

`maxSteps`를 지정하면 해당 실행에 명시적인 상한을 적용합니다. 생략한 실행은 모델이 완료하거나 호스트가 취소할 때까지 계속됩니다.

## 지연 작업과 승인

승인이 필요한 도구 호출은 안정적인 `operationId`와 `pending` 도구 결과를 즉시 저장합니다. 이 대기 상태는 에이전트의 실행 수명을 점유하지 않습니다. 호스트는 결정을 `operationStore`에 원자적으로 기록하고, 승인 시 현재 권한과 실행 대상을 다시 검증한 뒤 작업을 한 번 실행합니다.

완료 결과는 안정적인 `deliveryId`를 가진 별도 입력으로 같은 에이전트에 전달합니다. 에이전트가 유휴 상태이면 새 실행을 시작하고 실행 중이면 안전한 전달 지점에 도착 순서대로 반영합니다. 재시작 후에도 작업 상태와 전달 상태를 `operationStore`에서 복구합니다.

## 언어 간 일치

`spec/goondan.schema.json`은 직렬화 형식을 정의하고 `fixtures/conformance`는 공통 실행 사례를 정의합니다. 두 런타임은 메시지, 도구 호출, 도구 결과, 오류, 작업과 흐름 출력에서 같은 JSON 의미를 유지합니다.
