# 공통 실행 사례 형식과 러너 계약

이 문서는 `fixtures/conformance`에 두는 공통 실행 사례의 파일 형식과, 사례를 실행하고 결과를 비교하는 러너의 동작을 정한다. 구성의 실행 의미는 [`spec/goondan.md`](../../spec/goondan.md)에 있고, 이 문서는 그 의미를 사례로 표현하는 방법과 두 호스트의 결과를 비교하는 방법을 다룬다. TypeScript 러너(`packages/core`의 테스트)와 Python 러너(`python/goondan`의 테스트)는 이 문서를 같은 방식으로 구현하고, 두 호스트는 모든 사례를 같은 기대 결과로 통과해야 한다.

사례 작성자는 [사례 디렉터리](#사례-디렉터리)부터 [비교](#비교)까지와 [사례 추가 절차](#사례-추가-절차)를 따르고, 러너 구현자는 문서 전체를 따른다. 공식 모델 어댑터의 사례는 형식이 다른 `fixtures/models`에 둔다([`fixtures/models`와의 차이](#fixturesmodels와의-차이)).

## 사례 디렉터리

`fixtures/conformance` 바로 아래의 디렉터리 하나가 사례 하나이며, 디렉터리 이름이 사례 식별자다. 사례 식별자는 영문 소문자와 숫자로 된 단어를 `-`로 이은 문자열이다(`^[a-z0-9]+(-[a-z0-9]+)*$`). 이 폴더에는 사례 디렉터리와 이 README만 두며, 그 밖의 항목이 있으면 두 러너의 사례 탐색이 실패한다. 이 폴더와 사례 디렉터리에서 이름이 `.`으로 시작하는 항목은 무시한다.

사례 디렉터리에는 다음 항목만 두며, 그 밖의 항목이 있으면 사례가 실패한다.

| 항목 | 필수 | 내용 |
|---|---|---|
| `case.json` | 예 | 구성 위치, 바인딩 스크립트와 실행 단계 |
| `expected.json` | 예 | 정규화한 기대 결과 |
| `config/` | 구성 파일이나 템플릿을 쓰는 사례 | 진입 파일, variant, 템플릿과 합성할 파일 |

기본 진입 경로가 `config`이므로 보통 `config/goondan.yaml`이 진입 파일이다. `config/` 안의 배치는 사례가 정한다. 사례가 읽는 파일은 모두 사례 디렉터리 안에 둔다.

## 예시

다음 사례는 모델이 도구를 한 번 호출한 뒤 응답을 마치는 턴을 검증한다.

`config/goondan.yaml`:

```yaml
agents:
  main:
    model: m
    tools: [lookup]
```

`case.json`:

```json
{
  "description": "도구 결과를 저장한 뒤 모델을 다시 호출하고 턴 사용량을 합산한다.",
  "spec": ["단계 실행 순서", "사용량 집계"],
  "bindings": {
    "models": {
      "m": {"responses": [
        {"toolCalls": [{"callId": "c-1", "name": "lookup", "args": {"q": "군단"}}], "usage": {"input": 5, "output": 1}},
        {"text": "찾았습니다", "usage": {"input": 8, "output": 2}}
      ]}
    },
    "tools": {"lookup": {"description": "검색", "results": [{"text": "결과"}]}}
  },
  "steps": [{"run": {"sessionId": "c1", "input": "찾아 주세요"}}]
}
```

`expected.json`:

```json
{
  "steps": [{"result": {
    "finishReason": "stop",
    "usage": {"input": 13, "output": 3, "cacheRead": 0, "cacheWrite": 0},
    "runs": [{"agent": "main", "instance": "c1/main", "turnId": "<turn:1>", "kind": "turn",
      "usage": {"input": 13, "output": 3, "cacheRead": 0, "cacheWrite": 0},
      "finishReason": "stop", "status": "done"}]
  }}],
  "observations": {
    "toolCalls": [{"tool": "lookup", "args": {"q": "군단"}}],
    "conversations": {"c1/main": [
      {"role": "user", "source": "main", "content": [{"type": "text", "text": "찾아 주세요"}]},
      {"role": "assistant", "source": "model", "content": [{"type": "tool.call", "callId": "c-1", "name": "lookup", "args": {"q": "군단"}}]},
      {"role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": "c-1", "content": [{"type": "text", "text": "결과"}]}]},
      {"role": "assistant", "source": "model", "content": [{"type": "text", "text": "찾았습니다"}]}
    ]}
  }
}
```

메시지의 `id`는 [정규화](#정규화)에서 제거되고 턴 식별자는 `<turn:1>`로 바뀐다. 모델 스크립트가 `source`를 적지 않았으므로 런타임이 `model`을 채운다.

## `case.json`

`case.json`은 다음 키를 가진 객체다.

| 키 | 필수 | 값 |
|---|---|---|
| `description` | 예 | 사례가 검증하는 동작을 설명하는 비어 있지 않은 문자열 |
| `spec` | 예 | 근거가 되는 `spec/goondan.md` 절 제목의 배열. 하나 이상이며 중복이 없다. |
| `config` | 아니오 | [구성 위치](#구성-위치). 생략하면 `{"path": "config"}`다. |
| `bindings` | 아니오 | [바인딩](#바인딩). 생략하면 빈 객체다. |
| `steps` | 예 | [실행 단계](#실행-단계) 배열. 빈 배열일 수 있다. |

`case.json`과 `expected.json`에서 이 문서가 키를 정한 객체에 다른 키가 있거나 값의 형식이 맞지 않으면 사례가 실패한다. 턴 입력, 포트 값, 연산의 `value`처럼 임의의 JSON을 담는 자리는 그 안의 키를 검사하지 않는다.

### 규격 절 인용과 검증 범위

`spec`의 각 값은 `spec/goondan.md`의 제목 줄에서 앞의 `#`들과 공백을 뺀 문자열과 정확히 같아야 한다. 백틱도 제목에 적힌 그대로 쓴다. 예: `"에이전트 실행 기록"`, `` "`execution.complete`" ``, `"route 조건"`.

두 러너는 사례와 별도로 검증 범위 테스트를 하나씩 둔다. 이 테스트는 다음 경우에 실패한다.

- `spec/goondan.md`의 `##`, `###`, `####` 제목 가운데 어느 사례의 `spec`에도 없는 제목이 있다.
- 사례의 `spec`에 규격에 없는 제목이 있다.
- 규격에 같은 문자열의 제목이 둘 이상 있다.

문서 제목(`#`)은 인용 대상이 아니다. 제목 인용은 검증 범위의 최소 조건이며, 절이 정한 규칙마다 사례가 있는지는 리뷰에서 확인한다. 규격에서 절을 추가하거나 제목을 바꾸는 변경은 같은 변경에서 사례의 인용을 갱신한다.

### 구성 위치

`config`는 파일 방식과 문서 방식 가운데 하나를 쓴다.

| 방식 | 키 | 러너의 호출 |
|---|---|---|
| 파일 | `path`: 진입 경로. 사례 디렉터리 기준 상대 경로이며 기본값은 `config`다. `variants`: variant 이름 배열이며 기본값은 빈 배열이다. | `loadConfig`(`load_config`)로 구성을 읽고, 그 결과로 `createGoondan`(`create_goondan`)을 호출한다. |
| 문서 | `document`: 구성 문서인 JSON 객체. `directory`: 구성 디렉터리. 사례 디렉터리 기준 상대 경로이며 기본값은 `config`다. | `validateConfig`(`validate_config`)에 문서를 전달하고, 성공하면 같은 문서와 구성 디렉터리로 `createGoondan`을 호출한다. |

`path`와 `document`는 함께 쓸 수 없다. `variants`는 파일 방식에서만, `directory`는 문서 방식에서만 쓴다. 러너는 사례 디렉터리의 실제 경로 뒤에 `path`나 `directory`를 이은 절대 경로를 전달한다. 문서 방식에서도 구성 디렉터리를 항상 전달하므로, 디렉터리를 생략하면 프로세스의 현재 디렉터리를 쓰는 규칙은 공통 사례로 검증하지 않는다.

### 바인딩

`bindings`는 다음 키를 가진다. 모든 바인딩은 사례 파일에 적은 스크립트대로 동작하며 네트워크, 환경 변수와 사례 밖의 파일을 쓰지 않는다.

| 키 | 값 | 전달하는 호스트 바인딩 |
|---|---|---|
| `models` | 모델 이름 → [모델 스크립트](#모델-스크립트) | 모델 |
| `tools` | 도구 이름 → [도구 스크립트](#도구-스크립트) | 호스트 도구 |
| `functions` | 함수 이름 → [연산](#연산) | 함수 |
| `extensions` | 확장 이름 → [확장 스크립트](#확장-스크립트) | 확장 |
| `ports` | 포트 이름 → JSON 값 | 포트 |
| `host` | [호스트 콜백](#호스트-콜백) | 호스트 콜백 |
| `maxRetries` | JSON 값 | `maxRetries`(`max_retries`) |
| `maxSteps` | JSON 값 | `maxSteps`(`max_steps`) |

`maxRetries`와 `maxSteps`는 적은 값을 그대로 전달하고, 생략하면 전달하지 않는다. 따라서 규격이 허용하지 않는 값의 처리도 검증할 수 있다([구성 오류와 인수 오류](#구성-오류와-인수-오류)).

러너는 사례와 관계없이 다음 값을 주입하며, 사례는 이 값을 바꿀 수 없다. 로거는 주입하지 않는다.

- 대화 저장소와 작업 저장소: 각 언어의 메모리 저장소에 기록 기능을 더한 러너 저장소다. 관측의 `conversations`, `operations`, `operationHistory`는 이 저장소에서 만든다.
- 이벤트 수신 기능(`emit`): 관측의 `events`는 이 기능이 받은 이벤트로 만든다.

### 모델 스크립트

`models.<이름>`은 `{"responses": [응답, ...]}`이다. 러너는 그 모델이 호출될 때마다 배열의 다음 응답을 쓴다. 훅 컨텍스트의 `model.run` 호출도 같은 배열의 다음 응답을 쓴다.

응답은 다음 키 가운데 하나를 가진 객체다.

| 키 | 모델 구현의 동작 |
|---|---|
| `text` | 문자열. `content`가 `[{"type": "text", "text": <값>}]`인 메시지로 결과를 반환한다. |
| `toolCalls` | `{callId, name, args}` 객체의 배열. 항목마다 `{"type": "tool.call", callId, name, args}` 부분 하나를 만들어 메시지의 `content`로 반환한다. |
| `content` | 부분 배열. 그대로 메시지의 `content`가 된다. |
| `error` | 문자열. 이 문자열을 메시지로 가진 오류를 던진다. 선택 키 `code`를 적으면 던진 오류의 `code` 속성이 그 값이다. |
| `raw` | JSON 값. 모델 결과 대신 이 값을 그대로 반환한다. 형식에 맞지 않는 결과를 검증할 때 쓴다. |
| `await` | 게이트 이름. [게이트](#게이트)가 열릴 때까지 기다린 뒤 필수 키 `then`에 적은 응답대로 동작한다. |

`text`, `toolCalls`, `content` 응답이 반환하는 모델 결과는 `{"message": {"role": "assistant", "content": ...}, "finishReason": ...}`이며, 다음 선택 키를 적으면 그 값을 더한다.

| 키 | 값 |
|---|---|
| `finishReason` | 결과의 `finishReason`. 생략하면 `content`에 `tool.call` 부분이 있을 때 `tool`, 없을 때 `stop`이다. |
| `usage` | 결과의 `usage`. 적은 키만 넣으며, 생략하면 결과에 `usage`가 없다. |
| `meta` | 메시지의 `meta` |
| `id`, `source` | 메시지의 `id`와 `source`. 생략하면 메시지에 이 키가 없으므로 런타임이 [모델 결과](../../spec/goondan.md#모델-결과)에 정한 대로 채운다. |
| `deltas` | 결과를 반환하기 전에 모델 컨텍스트의 `onTextDelta`(`on_text_delta`)에 차례로 전달할 값의 배열. 문자열이 아닌 값도 그대로 전달한다. |

다음 경우에는 사례가 실패한다.

- 응답이 남지 않은 모델이 호출된다. 러너는 그 호출에 오류를 던지며, 런타임이 그 오류를 어떻게 처리하든 사례는 실패로 기록된다.
- 사례를 마쳤을 때 쓰지 않은 응답이 남아 있다.

동시에 실행되는 에이전트(예: `agent` 배열 훅의 대상)가 같은 모델 이름을 쓰면 어느 호출이 어느 응답을 받을지 정해지지 않는다. 이런 에이전트에는 서로 다른 모델 이름을 바인딩한다.

### 도구 스크립트

`tools.<이름>`은 다음 키를 가진 객체다. [확장 스크립트](#확장-스크립트)의 인스턴스 도구도 같은 형식이다.

| 키 | 필수 | 값 |
|---|---|---|
| `description` | 아니오 | 도구 구현의 설명. 기본값은 빈 문자열이다. |
| `input` | 아니오 | 도구 구현의 입력 스키마. 기본값은 `{"type": "object"}`다. |
| `results` | 예 | 결과 항목 배열. 호출마다 다음 항목을 쓴다. |

결과 항목의 소비 규칙은 모델 응답과 같으며, 승인된 작업을 실행할 때의 호출도 같은 배열을 쓴다. 결과 항목은 다음 키 가운데 하나를 가진다.

| 키 | 도구 구현의 동작 |
|---|---|
| `text` | 문자열. 콘텐츠가 `[{"type": "text", "text": <값>}]`인 도구 결과를 반환한다. |
| `json` | JSON 값. 콘텐츠가 `[{"type": "json", "value": <값>}]`인 도구 결과를 반환한다. |
| `content` | 부분 배열. 그대로 도구 결과의 콘텐츠가 된다. |
| `error` | 문자열. 이 문자열을 메시지로 가진 오류를 던진다. |
| `raw` | JSON 값. 도구 결과 대신 이 값을 그대로 반환한다. |
| `runAgent` | `{name, input}`. 도구 컨텍스트의 `agents.run(name, input)`(`run_agent`)을 호출하고, 반환된 결과의 출력 메시지 `content`를 콘텐츠로 가진 도구 결과를 반환한다. 호출이 실패하면 그 오류를 던진다. |
| `await` | 게이트 이름. 게이트가 열릴 때까지 기다린 뒤 필수 키 `then`에 적은 항목대로 동작한다. |

`text`, `json`, `content` 항목은 선택 키 `isError`, `keep`, `meta`를 가질 수 있으며, 적은 키만 도구 결과에 넣는다. 도구 결과를 반환하는 형태는 각 언어의 도구 구현 규약([README](../../README.md))을 따른다. TypeScript 러너는 도구 결과의 `callId`, `name`, `args`를 도구 컨텍스트의 `toolCall`에서 채운다.

### 연산

함수, 확장 훅, 옵션 검증 함수와 호스트 콜백의 동작은 `{"op": <이름>, ...}` 형식의 연산으로 적는다. 연산 목록은 닫힌 집합이며 두 러너는 모든 연산을 이 절의 정의대로 구현한다. 연산을 추가하거나 바꾸려면 이 절과 두 러너를 같은 변경에서 갱신한다.

연산은 받은 값에서 결과를 만든다. 연산이 오류를 던지면 그 오류는 연산을 실행한 함수, 훅이나 콜백이 던진 오류가 된다. 경로 인수는 JSON Pointer(RFC 6901) 문자열이다.

값 연산은 모든 위치에서 쓸 수 있다.

| 연산 | 인수 | 결과 |
|---|---|---|
| `identity` | 없음 | 받은 값 |
| `constant` | `value` | `value` |
| `get` | `path` | `path`가 가리키는 값. 없으면 `null` |
| `set` | `path`, `value` | 받은 값의 복사본에서 `path` 위치를 `value`로 바꾼 값. `path`는 빈 문자열이 아니다. 부모가 객체이면 키를 추가하거나 바꾸고, 부모가 배열이면 마지막 세그먼트가 기존 번호이거나 `-`(끝에 추가)여야 한다. 부모가 없거나 조건을 어기면 오류를 던진다. |
| `merge` | `value`(객체) | 받은 값에 `value`를 [값 병합](../../spec/goondan.md#값-병합) 규칙으로 병합한 값. 받은 값이 객체가 아니면 오류를 던진다. |
| `wrap` | `key`, `with`(선택, 객체) | `{<key>: 받은 값}`에 `with`의 키를 더한 객체. `with`에는 `key`와 같은 키를 쓸 수 없다. |
| `equals` | `path`(선택), `value` | `path`가 가리키는 값(생략하면 받은 값)이 `value`와 [JSON 값 비교](../../spec/goondan.md#json-값-비교)로 같으면 `true`, 아니면 `false`. `path`가 가리키는 값이 없으면 `null`과 비교한다. |
| `text` | 없음 | 받은 값이 문자열이면 그 문자열, `content` 배열을 가진 객체이면 `text` 부분의 `text`를 순서대로 이은 문자열. 그 밖의 값이면 오류를 던진다. |
| `textSuffix` | `suffix` | `text` 연산의 결과 뒤에 `suffix`를 이은 문자열 |
| `result` | `content`, `isError`(선택) | 받은 도구 호출로 만든 제어 결과 `{"result": {"callId": <id>, "name": <name>, "args": <args>, "content": <content>}}`. `isError`를 적으면 도구 결과에 넣는다. 받은 값에 문자열 `id`와 `name`이 없으면 오류를 던진다. |
| `sequence` | `items`(연산 배열) | n번째 호출(0부터)에서 `items[min(n, 마지막 번호)]`를 적용한 결과. 호출 횟수는 사례 파일에서 이 연산이 적힌 자리마다 사례 전체에 걸쳐 센다. |
| `chain` | `ops`(연산 배열) | 첫 연산에는 받은 값을, 다음 연산부터는 앞 연산의 결과를 차례로 적용한 결과 |
| `throw` | `message` | `message`를 메시지로 가진 오류를 던진다. |
| `await` | `gate`, `then`(선택, 연산) | 게이트가 열릴 때까지 기다린 뒤 받은 값에 `then`(생략하면 `identity`)을 적용한 결과 |
| `nonJson` | 없음 | JSON 값이 아닌 값. TypeScript는 `Number.NaN`, Python은 `float("nan")`을 반환한다. |

확장 훅 연산은 확장 인스턴스의 훅 함수에서만 쓸 수 있으며 훅 컨텍스트를 사용한다. 훅 컨텍스트 호출이 오류를 던지면 연산도 그 오류를 던진다.

| 연산 | 인수 | 동작과 결과 |
|---|---|---|
| `append` | `messages`: `{role, text, key?, keep?, meta?}` 배열. `role`은 `user` 또는 `system`이다. | 항목마다 훅 컨텍스트의 `message.user` 또는 `message.system`으로 메시지를 만들고, 그 메시지들로 훅 컨텍스트의 `append`를 호출해 얻은 제어 결과를 반환한다. `key`, `keep`, `meta`는 적은 것만 `extra`로 전달한다. |
| `runAgent` | `name`, `input`(선택) | 훅 컨텍스트의 `agents.run(name, input)`(`run_agent`)을 호출하고 끝나기를 기다린다. `input`을 생략하면 받은 값을 전달한다. `null`을 반환한다. |
| `runModel` | `messages` | 훅 컨텍스트의 `model.run(messages)`(`run_model`)를 호출하고 끝나기를 기다린다. `null`을 반환한다. |
| `render` | `template`, `variables`(선택, 기본값 `{}`) | 훅 컨텍스트의 `render(template, variables)`가 반환한 문자열 |
| `complete` | `message`, `tool`(선택), `useResultContent`(선택, 기본값 `false`) | `tool`을 적었고 받은 도구 결과의 `name`이 그 값과 다르면 아무것도 호출하지 않는다. 그 밖에는 `message`로 훅 컨텍스트의 `execution.complete`를 호출한다. `useResultContent`가 `true`이면 `message`의 `content`를 받은 도구 결과의 `content`로 바꿔 전달한다. `null`을 반환한다. |

`null`을 반환하는 연산은 훅의 현재 값을 바꾸지 않는다([훅 실행과 결과](../../spec/goondan.md#훅-실행과-결과)). `chain`에서 이런 연산 뒤에 오는 연산은 `null`을 받는다.

연산을 쓸 수 있는 위치와 연산이 받는 값은 다음과 같다. 허용하지 않는 위치에 적은 연산은 사례를 실패시킨다.

| 위치 | 받는 값 | 쓸 수 있는 연산 |
|---|---|---|
| `functions.<이름>` | 함수가 받은 JSON 인수 | 값 연산 |
| `extensions.<이름>.definition.validateOptions` | 사용 설정의 `options` | 값 연산 |
| `extensions.<이름>.instance.hooks.<값 처리 단계>` | 훅 함수가 받은 값 | 값 연산, 확장 훅 연산 |
| `host.<콜백>` | [호스트 콜백](#호스트-콜백)의 표에 정한 값 | 값 연산 |

Python에서는 JSON `null`과 값이 없는 반환이 모두 `None`이다. 따라서 규격이 두 경우를 다르게 다루는 동작(예: 작업 문맥 캡처가 값을 반환하지 않는 경우와 `null`을 반환하는 경우)은 공통 사례로 검증하지 않는다.

### 확장 스크립트

`extensions.<이름>`은 확장 정의와 인스턴스를 나눠 적는다. 두 키 모두 생략할 수 있다.

```json
{
  "definition": {
    "requires": ["store"],
    "hooks": ["modelInput"],
    "tools": ["recall"],
    "validateOptions": {"op": "identity"}
  },
  "instance": {
    "hooks": {"modelInput": {"op": "append", "messages": [{"role": "user", "text": "기억"}]}},
    "tools": {"recall": {"results": [{"text": "없음"}]}},
    "events": ["turn.done"]
  }
}
```

| 키 | 값 |
|---|---|
| `definition.requires` | 확장 정의가 요구하는 포트 이름 배열. 생략하면 목록을 전달하지 않는다. |
| `definition.hooks` | 확장 정의가 선언하는 값 처리 단계 이름 배열. 생략하면 목록을 전달하지 않는다. |
| `definition.tools` | 확장 정의가 선언하는 도구 이름 배열. 생략하면 목록을 전달하지 않는다. |
| `definition.validateOptions` | 옵션 검증 함수로 쓸 값 연산. 생략하면 검증 함수가 없다. |
| `definition.createError` | 문자열. 인스턴스 생성이 이 문자열을 메시지로 가진 오류로 실패한다. |
| `instance.hooks` | 값 처리 단계 이름 → 인스턴스가 그 단계에 제공하는 훅 함수의 연산 |
| `instance.tools` | 도구 이름 → 인스턴스가 제공하는 도구의 [도구 스크립트](#도구-스크립트) |
| `instance.events` | 인스턴스가 처리기를 제공하는 이벤트 이름 배열 |

배열을 적으면 빈 배열도 그대로 전달하므로, 빈 목록을 선언하지 않은 것으로 보는 규칙도 검증할 수 있다. 인스턴스는 항상 정리 함수를 제공한다. 옵션 검증, 생성, 이벤트 처리와 정리는 관측의 `extensionLog`에 기록된다. 한 확장의 인스턴스가 여럿이어도 같은 스크립트를 공유하므로, 연산의 호출 횟수와 도구 결과 항목의 소비 순서도 공유한다.

### 호스트 콜백

`host`에 적은 콜백만 런타임에 제공한다. 값이 `true`이면 표의 기본 동작을, 연산이면 그 연산을 실행해 결과를 반환한다.

| 키 | Python 이름 | 연산이 받는 값 | `true`의 동작 |
|---|---|---|---|
| `requestApproval` | `request_approval` | 승인 요청 | 값을 반환하지 않는다. |
| `captureOperationContext` | `capture_operation_context` | 승인 요청 | 값을 반환하지 않는다. |
| `validateOperation` | `validate_operation` | 저장된 작업 | `true`를 반환한다. |
| `validateOperationInputPatch` | `validate_operation_input_patch` | `{"operation": 저장된 작업, "inputPatch": 입력 수정}` | `true`를 반환한다. |
| `deliverOperationCompletion` | `deliver_operation_completion` | 완료 입력 | 값을 반환하지 않는다. |

`validateOperationInputPatch`는 두 인수를 받으므로 러너가 위 객체로 묶어 연산에 전달한다. 모든 호출은 관측의 `hostCalls`에 기록된다.

### 게이트

게이트는 비동기 동작의 순서를 고정하는 이름 붙은 신호다. 모든 게이트는 사례를 시작할 때 닫혀 있고, `release` 단계로 열면 사례가 끝날 때까지 열려 있다. 모델 응답과 도구 결과 항목의 `await`, 그리고 `await` 연산은 게이트가 열릴 때까지 기다리며, 이미 열린 게이트에서는 기다리지 않는다.

- `never`는 열리지 않는 예약된 게이트다. 런타임이 도중에 멈춘 상황을 흉내 낼 때 쓰며, `release`에 쓰면 사례가 실패한다.
- `reach` 단계는 사례를 시작한 뒤 그 게이트를 기다리기 시작한 호출이 하나 이상 생길 때까지 기다린다.
- 모델 호출, 도구 호출과 확장 훅에서 기다리는 중에 그 호출에 취소가 알려지면(TypeScript `signal`, Python 작업 취소) 기다림은 취소 오류로 끝난다.
- 함수와 호스트 콜백은 취소 신호를 받지 않는다. 이들의 기다림은 게이트가 열리거나, 러너가 그 런타임을 닫거나, 사례가 끝날 때 끝난다([러너의 실행 순서](#러너의-실행-순서)).

비동기 동작의 순서는 게이트로 정한다. 훅 `timeout`이나 재시도의 `afterMs`처럼 실제 시간이 필요한 값은 수십 밀리초 이하로 적는다.

## 실행 단계

`steps`의 각 실행 단계는 동작 키 하나와 선택 키 `settle`을 가진 객체다. 러너는 실행 단계를 배열 순서대로 하나씩 실행한다.

| 동작 | 값 | TypeScript | Python | 반환값 |
|---|---|---|---|---|
| `run` | `{sessionId, input, agent?, startAgent?}` | `run(input, {sessionId, agent, startAgent})` | `run(input, session_id=, agent=, start_agent=)` | 턴 결과 |
| `decide` | `{operation, value, sessionId?}` | `decideOperation(sessionId, operationId, value)` | `decide_operation(session_id, operation_id, value)` | 작업 |
| `cancel` | `{operation, sessionId?}` | `cancelOperation(sessionId, operationId)` | `cancel_operation(session_id, operation_id)` | 작업 |
| `list` | `{sessionId?}` | `listOperations(sessionId)` | `list_operations(session_id)` | 작업 배열 |
| `recover` | `{sessionId?}` | `recoverOperations(sessionId)` | `recover_operations(session_id)` | 없음 |
| `abort` | `{sessionId}` | `abort(sessionId)` | `abort(session_id)` | 불리언 |
| `steer` | `{sessionId, value, agent?}` | `steer(sessionId, value, {agent})` | `steer(session_id, value, agent=)` | 없음 |
| `deleteSession` | `{sessionId}` | `sessions.delete(sessionId)` | `sessions.delete(session_id)` | 없음 |
| `restart` | `{}` | 새 런타임 생성 | 새 런타임 생성 | 없음 |
| `close` | `{}` | `close()` | `close()` | 없음 |
| `release` | 게이트 이름 | 러너가 처리 | 러너가 처리 | 없음 |
| `reach` | 게이트 이름 | 러너가 처리 | 러너가 처리 | 없음 |
| `parallel` | 가지 배열 | 러너가 처리 | 러너가 처리 | 없음 |

`?`가 붙은 키는 생략할 수 있으며, 생략한 키는 API에 전달하지 않는다. `run.input`에는 메시지 배열, 비어 있지 않은 부분 배열, 문자열, 그 밖의 JSON 값을 쓸 수 있다. 빈 배열은 메시지 배열로 전달한다. 실행 단계의 값은 그대로 전달하며, 기대 결과에 쓰는 `<turn:N>` 같은 표기는 실행 단계의 값에서 해석하지 않는다.

- `decide`와 `cancel`의 `operation`이 `<op:`로 시작하는 [작업 별칭](#작업-별칭)이면 러너는 작업 저장소에서 그 별칭의 작업을 찾아 실제 `operationId`를 전달하며, 찾지 못하면 사례가 실패한다. `sessionId`를 생략하면 찾은 작업의 `sessionId`를 전달한다. 별칭이 아닌 문자열은 그대로 전달하므로 없는 작업을 가리키는 요청을 검증할 수 있으며, 이때 `sessionId`는 필수다.
- `decide`의 `value`는 결정 값으로 그대로 전달한다. 예: `{"decision": "approved", "inputPatch": {"env": "staging"}}`.
- `restart`는 현재 군단 객체를 닫지 않고 버린 뒤 새 군단 객체를 만든다. 새 객체는 처음과 같은 구성(파일 방식은 처음 `loadConfig`가 반환한 결과, 문서 방식은 같은 문서와 구성 디렉터리), 같은 저장소와 이벤트 수신 기능, 같은 스크립트 진행 상태와 게이트를 쓴다. 이후 실행 단계는 새 객체에서 실행한다. 버린 객체에서 진행 중이던 작업은 그대로 둔다. 영속 저장소를 가진 호스트 프로세스가 다시 시작하는 상황을 흉내 낸다.
- `close`는 [러너의 실행 순서](#러너의-실행-순서)에 정한 방법으로 현재 군단 객체를 닫는다. 이후 실행 단계도 닫힌 객체에서 실행하므로 닫힌 객체에 보낸 요청을 검증할 수 있다.
- `deleteSession`은 해당 세션과 파생 세션의 대화를 삭제한다. 정상 삭제의 기대 결과는 `{}`이며, 진행 중이거나 대기 중인 턴, `#`을 포함한 세션 식별자, 닫힌 군단 객체는 `runtime_error`를 기대 결과로 적는다.
- `parallel`의 각 원소는 실행 단계의 배열이며 이를 가지라 한다. 러너는 각 가지의 첫 실행 단계를 배열 순서대로 시작한 뒤 모든 가지를 동시에 진행하고, 가지 안의 실행 단계는 차례로 실행한다. 모든 가지가 끝나면 다음 실행 단계로 간다. 가지 안에는 `close`를 쓸 수 있으므로 진행 중인 요청과 시작을 기다리는 요청을 함께 검증할 수 있다. 가지 안에는 `restart`, `parallel`과 `settle`을 쓸 수 없다.

### 실행 단계 뒤의 대기와 `idle()`

러너는 최상위 실행 단계가 끝날 때마다 현재 런타임의 `idle()`을 호출하고 반환될 때까지 기다린다. 다음 실행 단계 뒤에는 기다리지 않는다.

- `reach` 단계
- `"settle": false`를 적은 실행 단계

`parallel` 가지 안의 실행 단계 뒤에는 기다리지 않고, `parallel` 단계가 끝난 뒤 한 번 기다린다. `settle: false`는 실행 단계가 끝난 뒤에도 닫힌 게이트를 기다리는 작업이 남는 실행 단계에 적는다. 예를 들어 비동기 훅이 게이트를 기다리는 턴이나, `never` 게이트에서 멈춘 작업을 남기고 `restart`로 넘어가기 직전의 실행 단계다.

각 실행 단계와 그 뒤의 `idle()` 대기는 각각 5초 안에 끝나야 하며, 넘기면 사례가 실패한다. `idle()`이 끝나지 않아 실패하면 실패 메시지에 `settle: false`가 필요한지 확인하라는 안내를 넣는다.

두 호스트의 런타임은 공개 메서드 `idle()`(TypeScript `idle(): Promise<void>`, Python `async def idle(self) -> None`)을 제공해야 한다. `idle()`은 런타임이 호스트의 요청과 별도로 진행하는 다음 작업이 모두 끝나면 반환하며, 기다리는 동안 이 작업들이 새로 시작한 작업도 기다린다.

- 비동기 훅의 작업
- 승인된 작업의 실행. 결정, 취소, 복구 가운데 무엇이 시작했든 포함한다.
- 완료 전달. 호스트의 완료 전달 호출과, 런타임이 전달을 위해 실행하는 턴을 포함한다.

호스트가 요청했지만 아직 반환되지 않은 턴과 작업 요청은 기다리지 않는다. `idle()`은 작업을 새로 시작하거나 저장된 상태를 바꾸지 않는다. 닫힌 런타임의 `idle()`은 닫을 때 중단한 작업이 끝나면 반환한다.

## `expected.json`

`expected.json`은 다음 키를 가진 객체다.

| 키 | 값 |
|---|---|
| `error` | 런타임을 만들기 전에 발생해야 하는 [구성 오류나 인수 오류](#구성-오류와-인수-오류) |
| `steps` | [실행 단계의 기대 결과](#실행-단계의-기대-결과) 배열 |
| `observations` | 비교할 [관측](#관측) 영역 |

`error`를 적은 사례는 `case.json`의 `steps`가 빈 배열이어야 하며, `steps`와 `observations`를 쓰지 않는다. `error`가 없으면 `steps`는 필수이고 길이가 `case.json`의 `steps`와 같아야 한다. `observations`는 생략할 수 있다.

실제 결과에서 비교할 값만 골라 만든 값을 투영이라 한다. 러너는 실제 결과를 이 절에 정한 투영으로 바꿔 기대 값과 비교한다.

### 구성 오류와 인수 오류

`error`는 다음 두 형식 가운데 하나다.

- 구성 오류: `{"phase": <API>, "issues": [{"code": ..., "path": ..., "message": ...}, ...]}`. `message`는 선택 키다.
- 인수 오류: `{"phase": "create", "invalidArgument": true}`

`phase`는 오류를 던진 API이며, 규격의 [검증 단계](../../spec/goondan.md#검증-단계)(읽기, 스키마, 참조, 바인딩)와는 다른 값이다. 규격이 API마다 적용하는 검증 단계를 정하므로 한 사례의 `phase`는 하나로 정해진다. 예를 들어 파일 방식에서 템플릿 오류와 알 수 없는 필드는 `load`, 등록되지 않은 모델은 `create`다.

| `phase` | 오류를 던진 API |
|---|---|
| `load` | `loadConfig`, `load_config` |
| `validate` | `validateConfig`, `validate_config` |
| `create` | `createGoondan`, `create_goondan` |

`issues`는 `GoondanConfigError`의 `issues`와 배열 순서까지 비교하므로, 규격의 [구성 오류](../../spec/goondan.md#구성-오류)에 정한 정렬 순서로 적는다. 각 항목의 `code`는 규격의 [오류 코드](../../spec/goondan.md#오류-코드) 표에 있는 구성 오류 코드이고, `path`는 JSON Pointer다. `message`는 규격이 문구를 정한 `template.*` 항목에만 적을 수 있으며([템플릿 구성 오류](../../spec/goondan.md#템플릿-구성-오류)), 적은 경우에만 비교한다.

러너는 사례 파일을 검사할 때 기대 값의 `code`가 다음 닫힌 집합에 속하는지 확인한다. 이 목록은 규격의 오류 코드 표와 같으며, 표가 바뀌면 이 목록과 두 러너를 함께 갱신한다.

- `load.not_found`, `load.not_yaml`, `load.yaml`, `load.not_object`, `load.duplicate_resource`, `load.resource_cycle`
- `schema.<키워드>`. 키워드는 `type`, `const`, `enum`, `required`, `additionalProperties`, `propertyNames`, `minProperties`, `minItems`, `uniqueItems`, `minLength`, `pattern`, `exclusiveMinimum`, `oneOf`, `anyOf`, `not`, `false` 가운데 하나다.
- `config.not_json`
- `reference.agent`, `reference.inherit`, `reference.inherit_cycle`, `reference.extension`, `reference.duplicate_tool`, `reference.duplicate_hook`
- `routes.reserved`, `routes.no_route`, `routes.no_input`, `routes.no_output`, `routes.unreachable`, `routes.cycle`, `routes.wait_cycle`
- `template.not_found`, `template.syntax`, `template.unsupported`
- `binding.model`, `binding.tool`, `binding.duplicate_tool`, `binding.function`, `binding.extension`, `binding.port`, `binding.extension_hook`

인수 오류는 `maxRetries`나 `maxSteps`가 규격의 조건을 어겨 군단 객체 생성이 TypeScript에서 `TypeError`, Python에서 `ValueError`로 실패하는 경우다.

오류 사례에는 결함을 하나만 둔다. 결함 하나가 규격에 따라 항목 여러 개를 만들 수 있으며(예: 순환에 속한 route마다 보고하는 `routes.cycle`), 이때 `issues`에는 그 항목을 모두 적는다.

### 실행 단계의 기대 결과

`steps`의 각 원소는 같은 위치에 있는 실행 단계의 기대 결과이며 다음 가운데 하나다.

| 형식 | 의미 |
|---|---|
| `{}` | 실행 단계가 오류 없이 끝나야 한다. 반환값은 비교하지 않는다. |
| `{"result": 값}` | 실행 단계가 오류 없이 끝나고 반환값의 투영이 이 값과 같아야 한다. 반환값이 있는 동작에만 쓴다. |
| `{"error": 오류}` | 실행 단계가 이 오류를 던져야 한다. |
| `{"parallel": [[기대 결과, ...], ...]}` | `parallel` 단계의 기대 결과. 가지와 실행 단계의 구조를 그대로 따른다. |

반환값의 투영은 다음과 같다.

| 동작 | 투영 |
|---|---|
| `run` | 턴 결과의 `output`, `outputs`, `usage`, `finishReason`, `status`, `runs`([턴 결과](../../spec/goondan.md#턴-결과), [에이전트 실행 기록](../../spec/goondan.md#에이전트-실행-기록)). `result`에는 비교할 키만 적으며, 적은 키는 값 전체를 비교한다. |
| `decide`, `cancel` | [관측](#관측)의 `operations`와 같은 작업 투영 |
| `list` | 작업 투영의 배열 |
| `abort` | 불리언 |
| `deleteSession`, `steer`, `recover`, `restart`, `close`, `release`, `reach` | 없음 |

`runs`는 턴이 기다린 에이전트 실행과 모델 호출마다 항목 하나를 규격이 정한 순서로 담는다. 따라서 `runs`를 적으면 route 실행, 에이전트 도구, 훅 에이전트와 훅 컨텍스트의 모델 호출이 각각 `agent`, `instance`, `kind`, `usage`, `finishReason`, `status`와 함께 비교된다. `kind`는 `turn`, `tool`, `hook`, `model` 가운데 하나다. 턴의 `usage`는 러너가 모든 사례에서 `runs`의 합계와 대조한다([러너가 항상 검사하는 조건](#러너가-항상-검사하는-조건)).

실행 단계가 던지는 오류의 기대 값은 다음 가운데 하나다.

| 형식 | 대상 | 비교 |
|---|---|---|
| `{"where", "codes", "attempt", "toolCall"?, "message"?}` | 실행 오류 | 러너는 던진 실행 오류의 `where`, `codes`, `attempt`와, 오류에 있으면 `toolCall`(`tool_call`)로 투영을 만들어 정확히 비교한다. `message`는 적은 경우에만 비교한다. |
| `{"issues": [...]}` | 턴이 [확장 인스턴스](../../spec/goondan.md#확장-인스턴스) 준비의 구성 오류로 실패한 경우 | [구성 오류와 인수 오류](#구성-오류와-인수-오류)의 `issues`와 같다. |
| `{"scriptError": 메시지}` | 스크립트가 던진 오류가 그대로 실행 단계 밖으로 나온 경우. 예: 복구가 처음 실패한 승인 요청 전달의 오류로 실패한 경우 | 메시지를 비교한다. |

`codes`의 첫 값은 규격의 실행 오류 코드인 `model_error`, `tool_error`, `tool_unavailable`, `hook_error`, `value_invalid`, `route_error`, `steer_invalid`, `operation_invalid`, `runtime_error`, `aborted` 가운데 하나다. 실행 오류의 `message`는 규격이 내용을 정한 경우에만 적는다. 예를 들어 모델 실패의 `message`는 모델 구현이 던진 오류의 메시지다([모델 실패](../../spec/goondan.md#모델-실패)).

러너는 던진 예외가 `GoondanConfigError`이면 구성 오류로, 스크립트가 던진 오류이면 `scriptError`로, 실행 오류의 필드를 가지면 실행 오류로 투영한다. 그 밖의 예외는 기대 결과와 관계없이 사례를 실패시킨다.

### 관측

`observations`에는 다음 영역 가운데 비교할 영역만 적는다. 러너는 모든 영역을 항상 만들고 적은 영역만 비교한다. 표의 순서는 [턴 번호](#턴-번호)를 매길 때 문서를 훑는 순서다.

| 영역 | 값 |
|---|---|
| `effectiveConfig` | 유효 구성. 파일 방식은 `loadConfig` 결과에 담긴 유효 구성, 문서 방식은 `validateConfig`의 반환값이다. |
| `events` | 이벤트 수신 기능이 받은 이벤트를 받은 순서대로 담은 배열 |
| `modelInputs` | 모델 이름 → 그 모델 구현이 받은 모델 입력을 호출 순서대로 담은 배열 |
| `modelContexts` | 모델 이름 → 모델 컨텍스트 `{agent, sessionId, turnId, step}`을 `modelInputs`와 같은 순서로 담은 배열 |
| `toolCalls` | 도구 구현이 호출될 때마다 `{tool, args}`를 호출 순서대로 담은 배열. `tool`은 바인딩 이름이다. |
| `toolContexts` | 도구 컨텍스트 `{tool, agent, sessionId, turnId, toolCall, input, conversation, execution}`을 `toolCalls`와 같은 순서로 담은 배열 |
| `functionCalls` | 함수가 호출될 때마다 `{fn, value}`를 호출 순서대로 담은 배열. `value`는 함수가 받은 인수다. |
| `hookCalls` | 확장 훅 함수가 호출될 때마다 `{extension, stage, value}`를 호출 순서대로 담은 배열 |
| `hookContexts` | 훅 컨텍스트 `{extension, stage, agent, sessionId, turnId, input, conversation, retryCount}`를 `hookCalls`와 같은 순서로 담은 배열 |
| `hostCalls` | 호스트 콜백이 호출될 때마다 `{callback, value}`를 호출 순서대로 담은 배열. `callback`은 TypeScript 이름이다. |
| `extensionLog` | 확장 스크립트의 옵션 검증, 생성, 이벤트 처리와 정리를 일어난 순서대로 담은 배열 |
| `conversations` | `<sessionId>/<에이전트 이름>` → 그 실행 범위에 저장된 메시지 배열. 대화 저장소에 기록된 모든 실행 범위를 담는다. |
| `operations` | 관측 시점에 현재 런타임의 `listOperations()`가 반환한 작업의 투영 배열 |
| `operationHistory` | 작업 별칭 → 저장소에 기록된 상태 변화의 배열 |

각 영역의 세부 규칙은 다음과 같다.

- 모든 투영의 키는 camelCase다. Python 러너는 `session_id`, `turn_id`, `retry_count`, `tool_call` 같은 이름을 camelCase 키로 바꿔 기록한다.
- `events`: 각 이벤트를 `{name, agent, sessionId, turnId, data}`로 투영하며 `at`은 넣지 않는다. `data`에는 규격의 [이벤트 종류](../../spec/goondan.md#이벤트-종류) 표가 그 이벤트에 요구하는 키 가운데 오류 문구인 `error`를 뺀 키만 넣고, 호스트가 추가한 키는 넣지 않는다. 다만 승인된 작업을 실행할 때 알린 `tool.*` 이벤트처럼 `data`에 `operationId`가 있으면 그 키를 넣는다.
- `toolContexts`: `toolCall`은 도구 컨텍스트의 `{id, name, args}`이고, `execution`은 실행 정보가 없을 때 `{}`다.
- `hookCalls`, `hookContexts`: `stage`는 훅이 실행된 값 처리 단계의 이름이다.
- `hostCalls`: 승인 요청과 완료 입력은 받은 값 그대로, 저장된 작업은 작업 투영으로 기록한다. `validateOperationInputPatch`의 값은 `{"operation": 작업 투영, "inputPatch": 입력 수정}`이다.
- `extensionLog`: 항목은 다음 네 형식이다. `instance`는 사례 전체에서 생성을 시작한 순서대로 1부터 매긴 번호이며, 생성에 실패한 시도도 번호를 받는다.
  - `{"action": "validateOptions", "extension", "options"}`: 옵션 검증 함수가 받은 값
  - `{"action": "create", "instance", "extension", "options", "ports", "agent"}`: 생성 입력. `agent`는 `{name, spec}`이며 `log`는 넣지 않는다.
  - `{"action": "event", "instance", "name"}`: 인스턴스의 이벤트 처리기가 받은 이벤트의 이름
  - `{"action": "dispose", "instance"}`: 정리 함수 호출
- `conversations`: 키는 세션 식별자와 에이전트 이름을 `/`로 이은 문자열이며 파생 세션도 포함한다. 예: `c1/main`, `c1#<turn:1>#worker/worker`.
- `operations`: 작업 투영은 저장된 작업에서 `createdAt`, `updatedAt`, `deliveredAt`을 뺀 값이다. 저장된 작업은 규격의 [작업 기록과 상태](../../spec/goondan.md#작업-기록과-상태)에 정한 필드만 가지므로 그 밖의 키는 비교에서 드러난다.
- `operationHistory`: 러너 저장소가 작업의 기록을 받아들일 때마다 그 작업의 `<status>/<deliveryStatus>` 문자열을 추가하며, 직전 항목과 같으면 추가하지 않는다. 조건이 맞지 않아 기록하지 않은 전이는 추가하지 않는다. 예: `["pending/pending", "approved/pending", "running/pending", "completed/pending", "completed/delivering", "completed/delivered"]`.
- 규격이 순서를 정하지 않는 동시 실행이 있다. 병렬로 실행하는 훅 에이전트 사이의 순서와, 비동기 훅의 완료 이벤트와 다른 이벤트 사이의 순서가 여기에 해당한다. 이런 호출이 섞이는 영역은 기대 값에 적지 않거나, 게이트로 순서를 고정한 뒤 적는다.

## 정규화

러너는 모든 실행 단계의 투영과 모든 관측 영역으로 실제 결과 문서를 만든 뒤 다음 순서로 정규화하고, 정규화한 문서를 기대 값과 비교한다. 기대 값은 정규화한 형태로 적는다.

1. 모든 문자열에서 사례 디렉터리의 실제 경로를 `<case>`로 바꾼다. 예: `<case>/config/templates/system.md`.
2. `role`과 `content` 키를 함께 가진 모든 객체, 즉 메시지에서 `id` 키를 제거한다. 도구 호출의 `id`처럼 메시지가 아닌 객체의 `id`는 남긴다.
3. 모든 문자열에서 실제 `operationId`를 [작업 별칭](#작업-별칭)으로 바꾼다.
4. 유효 구성에서 `stateful: false`인 에이전트의 인스턴스 식별자를 문서에 처음 나타난 순서대로 `<instance:N>`으로 바꾼다.
5. 모든 문자열에서 턴 식별자를 [턴 번호](#턴-번호) 표기 `<turn:N>`으로 바꾼다.

문자열 치환은 객체의 키와 문자열 값에 모두 적용하며 문자열의 일부도 바꾼다. 따라서 메시지 텍스트에 들어 있는 JSON 텍스트와 파생 세션 식별자 안의 값도 바뀐다. 시각 값(`at`, `createdAt`, `updatedAt`, `deliveredAt`)은 투영에 넣지 않는다. 이 밖의 값은 바꾸지 않으므로 `null`과 키가 없는 경우는 계속 구별된다.

### 작업 별칭

작업 별칭은 `<op:<callId>>` 형식이며 `<callId>`는 작업의 `toolCall.id`다. 예를 들어 `callId`가 `danger-1`인 작업의 별칭은 `<op:danger-1>`이다. 같은 `callId`를 가진 작업이 여럿이면 작업 저장소에 처음 저장된 순서로 두 번째 작업부터 `#<번호>`를 붙인다. 예: `<op:danger-1>`, `<op:danger-1#2>`, `<op:danger-1#3>`. 같은 `callId`의 작업을 동시에 만드는 사례는 번호가 정해지지 않으므로 쓰지 않는다.

`deliveryId`는 규격이 `operation:<operationId>:completion`으로 정하므로 치환 뒤에는 `operation:<op:danger-1>:completion`이 된다. 기대 값에는 이 형태를 적는다. 전달 식별자에는 별도의 별칭을 두지 않으며, 형식이 다른 `deliveryId`는 비교에서 드러난다.

### 턴 번호

턴 식별자는 문서에서 `turnId` 키의 문자열 값으로 나타나는 모든 값이다. 러너는 정규화 4단계까지 마친 문서를 다음 규칙으로 훑으며, 턴 식별자가 처음 나타나는 순서대로 1부터 번호를 매긴다.

- `steps`를 먼저 훑고, 이어서 관측 영역을 [관측](#관측) 표의 순서로 훑는다. 기대 값에 적지 않은 영역도 훑는다.
- 배열은 원소 순서로, 객체는 키의 유니코드 코드 포인트 순서로 훑는다. 객체의 각 항목은 키 문자열을 먼저, 값을 나중에 본다.
- 한 문자열에 턴 식별자가 여럿 있으면 앞에 있는 것부터 센다.

성공한 턴의 턴 식별자는 보통 그 턴 결과의 `runs` 순서대로 번호를 받는다. 실패한 턴처럼 `steps`에 나타나지 않는 턴 식별자는 대개 `events`에서 처음 나타나는 순서로 번호를 받는다.

## 비교

- `expected.json`에 적은 최상위 키와 관측 영역만 비교한다.
- `run` 단계의 `result`는 적은 키만, 오류의 `message`는 적은 경우에만 비교한다. 그 밖의 값은 모두 정확히 비교한다.
- 값은 규격의 [JSON 값 비교](../../spec/goondan.md#json-값-비교)로 비교한다. 종류가 다르면 다른 값이며 불리언과 수도 서로 다르다. 수는 수치로 비교하므로 `1`과 `1.0`은 같다. 배열은 길이와 순서까지 비교하고, 객체는 키 집합과 각 값을 비교하며 키 순서는 보지 않는다. 실제 값에만 있는 키도 차이다.
- 규격이 객체의 키 순서를 정한 값(예: 완료 입력)은 객체 비교로는 순서를 확인하지 않고, 그 값을 직렬화한 JSON 텍스트로 확인한다. 예를 들어 런타임이 완료 전달을 위해 실행한 턴의 사용자 메시지 텍스트를 `conversations`나 `modelInputs`로 비교한다.
- 기대하지 않은 오류가 발생하거나 오류를 기대한 실행 단계가 성공하면 사례가 실패한다.
- 실패 메시지는 차이가 있는 위치를 JSON Pointer로 나열하고 위치마다 기대 값과 실제 값을 보여 준다.

## 러너 계약

### 러너의 실행 순서

두 러너는 사례마다 다음 순서로 실행한다.

1. **사례 탐색**: `fixtures/conformance`의 사례 디렉터리를 이름의 코드 포인트 순서로 모두 찾아 사례마다 테스트 하나를 만든다. 사례를 거르거나 건너뛰지 않는다.
2. **사례 파일 검사**: `case.json`과 `expected.json`을 이 문서의 형식대로 검사한다. 모르는 키, 형식이 맞지 않는 값, 허용하지 않는 위치의 연산, 닫힌 집합 밖의 오류 코드가 있으면 사례가 실패한다.
3. **바인딩 준비**: 스크립트로 바인딩을 만들고 러너 저장소와 이벤트 수신 기능을 준비한다.
4. **구성 읽기와 군단 객체 생성**: 파일 방식은 `loadConfig`와 `createGoondan`을, 문서 방식은 `validateConfig`와 `createGoondan`을 호출한다. 오류가 발생하면 5와 6을 건너뛴다.
5. **실행 단계 진행**: 실행 단계를 차례로 실행하고 [실행 단계 뒤의 대기와 `idle()`](#실행-단계-뒤의-대기와-idle)에 따라 기다린다.
6. **관측 수집**: 런타임을 닫기 전에 모든 실행 단계의 투영과 모든 관측 영역을 만든다.
7. **정리**: 사례에서 만든 모든 런타임을 만든 순서대로 닫고, 이미 닫은 런타임은 건너뛴다. 마지막으로 남은 게이트 대기를 모두 취소한다.
8. **검사와 비교**: 스크립트를 모두 소비했는지와 [러너가 항상 검사하는 조건](#러너가-항상-검사하는-조건)을 확인하고, 정규화한 문서를 기대 값과 비교한다.

러너는 런타임마다 바인딩 객체를 따로 만들어 각 호출이 어느 런타임에 속하는지 구분하며, 스크립트 진행 상태와 게이트는 모든 런타임이 공유한다. 러너가 런타임을 닫을 때(`close` 단계와 7단계)는 먼저 `close()`를 호출해 런타임을 닫힌 상태로 만들고, 그 런타임의 바인딩에서 게이트를 기다리는 호출을 모두 취소한 뒤 `close()`가 끝나기를 기다린다. 취소를 먼저 하면 런타임이 닫히기 전에 그 취소를 실패로 기록할 수 있으므로 이 순서를 지킨다.

### 러너가 항상 검사하는 조건

러너는 기대 값과 관계없이 모든 사례에서 다음 조건을 확인하고, 어기면 사례를 실패시킨다.

- 정규화에서 `id`를 제거하기 전의 모든 메시지는 비어 있지 않은 문자열 `id`를 가진다.
- 성공한 턴 결과의 `usage`는 `runs`의 `usage`를 키별로 더한 값과 같다([사용량 집계](../../spec/goondan.md#사용량-집계)).
- `GoondanConfigError`(Python은 `GoondanError`의 하위 클래스)의 `issues`는 비어 있지 않고, 각 항목은 `code`, `path`, 비어 있지 않은 문자열 `message`만 가진다. 예외 메시지는 규격의 [구성 오류](../../spec/goondan.md#구성-오류)에 정한 형식, 즉 첫 줄 `Invalid Goondan configuration:` 뒤에 항목마다 `- <path>: <message> [<code>]` 줄을 이은 문자열이며, 빈 `path`는 `(root)`로 쓴다.
- 저장된 작업의 `createdAt`과 `updatedAt`은 수이고, `deliveredAt`은 `deliveryStatus`가 `delivered`인 작업에만 있는 수다.
- 이벤트의 `at`은 수다.
- 모델 응답과 도구 결과 항목을 모두 썼고, 응답이나 항목이 남지 않은 스크립트를 호출하지 않았다.

### 지원하지 않는 기능

러너가 사례의 일부를 자기 언어의 호스트 API로 표현할 수 없으면(예: 호스트에 해당 API나 옵션이 없음) 그 사례는 `unsupported by <language> runner: <feature>` 메시지로 실패한다. `<language>`는 `TypeScript` 또는 `Python`이다.

사례를 건너뛰거나(skip), 실패를 예상된 실패(xfail)로 표시하거나, 언어별 허용 목록과 조건 분기를 두지 않는다. 사례 파일에도 언어별 값을 두지 않는다. 한 언어에서만 표현할 수 있는 동작은 다른 언어의 호스트에 기능을 추가하거나 규격을 바꿔 해결한다.

### 네트워크와 자격 증명

러너와 사례는 네트워크에 연결하지 않는다. 러너는 공식 모델 어댑터나 실제 제공자 모델을 주입하지 않고 환경 변수를 읽지 않는다. 사례에는 URL, 자격 증명, 사내 호스트 이름을 넣지 않는다.

## `fixtures/models`와의 차이

`fixtures/models`는 공식 모델 어댑터가 모델 입력을 제공자 요청으로 바꾸고 제공자 스트림을 모델 결과로 조립하는 규칙을 검증하는 별도의 사례 모음이다. 형식과 실행 순서는 [모델 어댑터 규격의 공통 사례](../../spec/model-adapters.md#공통-사례)가 정한다.

| 항목 | `fixtures/conformance` | `fixtures/models` |
|---|---|---|
| 검증 대상 | 같은 YAML에 대한 두 런타임의 실행 결과 | 요청 본문, 조립한 모델 결과, 텍스트 조각, 오류 코드 |
| 규격 | `spec/goondan.md` | `spec/model-adapters.md` |
| 배치 | `fixtures/conformance/<사례>/` | `fixtures/models/<제공자>/<사례>/` |
| 구성 | `config/` 또는 `config.document` | 없음. `goondan.yaml`을 두지 않는다. |
| `case.json` | 바인딩 스크립트와 실행 단계 | 어댑터 설정, 모델 입력, 스트림 원문, 조각 크기 |
| `expected.json` | `error`, `steps`, `observations` | `request`, `result`, `deltas`, `error` |
| 모델 | 모델 스크립트 | 검증 대상인 공식 어댑터 |
| 절 인용과 검증 범위 테스트 | 있음 | 없음 |

공통 실행 러너는 `fixtures/models`를 읽지 않고, 모델 사례 러너는 `fixtures/conformance`를 읽지 않는다. 두 모음 모두 네트워크를 쓰지 않으며, 기대 값에 적은 부분만 JSON 값 비교로 확인한다.

## 사례 추가 절차

1. 검증할 규칙을 규격에서 찾는다. 규격에 없는 동작이면 사례보다 규격을 먼저 바꾼다.
2. 사례 디렉터리를 만들고 `config/`에 규칙을 드러내는 가장 작은 구성을 둔다. 오류 사례에는 결함을 하나만 둔다.
3. `case.json`에 설명, 인용할 절 제목, 바인딩 스크립트와 실행 단계를 적는다. 스크립트에는 사례가 쓰는 만큼의 응답과 결과만 적는다.
4. `expected.json`에 규격 문장에서 도출한 기대 값을 정규화한 형태로 적는다. 한 호스트의 출력을 복사하지 않는다.
5. 규칙을 드러내는 관측 영역만 적는다.
6. 두 언어에서 사례를 실행한다. 한 언어만 실패하면 사례를 그 언어에 맞추지 말고, 규격과 대조해 틀린 쪽을 고친다.
7. 연산, 실행 단계, 관측 영역이 새로 필요하면 이 문서와 두 러너를 같은 변경에서 갱신한다.
