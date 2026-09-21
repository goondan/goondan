# 공통 실행 사례 형식과 러너 계약

이 문서는 `fixtures/conformance`의 공통 실행 사례 형식과 TypeScript·Python 러너의 동작을 정한다. 실행 의미는 [`spec/goondan.md`](../../spec/goondan.md)가 정하며, 두 러너는 같은 사례를 같은 기대 값으로 검증한다.

## 사례 디렉터리

`fixtures/conformance` 바로 아래의 디렉터리 하나가 사례 하나다. 디렉터리 이름은 `^[a-z0-9]+(-[a-z0-9]+)*$`을 만족해야 한다. 이 폴더에는 사례 디렉터리와 `README.md`만 둔다. 이름이 `.`으로 시작하는 항목은 탐색에서 제외한다.

사례 디렉터리는 다음 항목만 가진다.

| 항목 | 필수 | 내용 |
|---|---|---|
| `case.json` | 예 | 구성 위치, 바인딩 스크립트와 실행 단계다. |
| `expected.json` | 예 | 정규화한 기대 결과다. |
| `config/` | 구성 파일을 읽는 사례 | 진입 파일, 템플릿과 리소스 파일이다. |

기본 진입 경로는 `config`다. 사례가 읽는 모든 파일은 사례 디렉터리 안에 둔다.

## `case.json`

`case.json`은 다음 키를 가진다.

| 키 | 필수 | 값 |
|---|---|---|
| `description` | 예 | 검증하는 동작을 설명하는 비어 있지 않은 문자열이다. |
| `spec` | 예 | 근거가 되는 `spec/goondan.md`의 절 제목 배열이다. 하나 이상이며 중복이 없다. |
| `config` | 아니오 | [구성 위치](#구성-위치)다. 생략하면 `{"path":"config"}`다. |
| `bindings` | 아니오 | [바인딩](#바인딩)이다. 생략하면 빈 객체다. |
| `steps` | 예 | [실행 단계](#실행-단계) 배열이다. 구성 오류 사례에서는 비어 있을 수 있다. |

이 문서가 형식을 정한 객체에는 명시된 키만 쓴다. 입력 값, 포트 값과 연산의 `value`처럼 임의의 JSON을 담는 위치는 내부 키를 검사하지 않는다.

### 규격 절 인용과 검증 범위

`spec`의 각 값은 `spec/goondan.md`의 `##`, `###`, `####` 제목에서 앞의 `#`과 공백을 뺀 문자열과 정확히 같아야 한다. 두 러너의 검증 범위 테스트는 다음 조건을 검사한다.

- 규격의 모든 `##`, `###`, `####` 제목을 하나 이상의 사례가 인용한다.
- 사례가 인용한 제목은 규격에 존재한다.
- 규격에 같은 제목이 둘 이상 존재하지 않는다.

제목 인용은 최소 조건이다. 절 안의 독립적인 규칙마다 사례가 있는지는 리뷰에서 확인한다.

### 구성 위치

`config`는 다음 두 형식 가운데 하나다.

| 방식 | 키 | 러너의 처리 |
|---|---|---|
| 파일 | `path` | `loadConfig` 또는 `load_config`로 읽은 뒤 군단 객체를 만든다. |
| 문서 | `document`, 선택적인 `directory` | `validateConfig` 또는 `validate_config`로 검사한 뒤 같은 문서와 디렉터리로 군단 객체를 만든다. |

`path`와 `document`는 함께 쓸 수 없다. 경로는 사례 디렉터리를 기준으로 한 절대 경로로 바꾸어 전달한다.

### 바인딩

`bindings`는 `models`, `tools`, `functions`, `extensions`, `ports`, `maxRetries`를 선택적으로 가진다. 러너는 사례마다 기록 기능을 더한 메모리 저널 저장소 하나를 `store`로 주입한다. 저장소는 `append`, `scan`, `head`, `watch`, `acquireLease`, `deleteSession`을 제공한다. 실행 이벤트 수신 함수도 주입한다. 사례는 실제 네트워크, 환경 변수와 사례 밖의 파일을 사용하지 않는다.

### 모델 스크립트

`models.<이름>`은 `{"responses":[응답,...]}`이다. 모델이 호출될 때마다 다음 응답을 소비한다. 훅 컨텍스트의 `model.run`도 같은 배열을 소비한다.

응답은 다음 동작 키 가운데 하나를 가진다.

| 키 | 동작 |
|---|---|
| `text` | 해당 문자열의 `text` 부분 하나를 가진 작성용 응답을 반환한다. |
| `toolCalls` | 각 `{callId,name,args}`를 `tool.call` 부분으로 바꾼 작성용 응답을 반환한다. |
| `content` | 부분 배열을 그대로 사용한 작성용 응답을 반환한다. |
| `error` | 문자열을 메시지로 가진 오류를 던진다. 선택 키 `code`를 오류에 붙인다. |
| `raw` | JSON 값을 그대로 반환한다. 형식 오류를 검증할 때 사용한다. |
| `await` | 이름이 같은 게이트가 열리면 필수 `then` 응답을 실행한다. |

`text`, `toolCalls`, `content` 응답에는 `finishReason`, `usage`, `meta`, `id`, `source`, `deltas`를 선택적으로 쓸 수 있다. `id`와 `source`를 생략하면 런타임이 채운다. `deltas`는 결과를 반환하기 전에 모델 컨텍스트의 텍스트 조각 콜백에 차례로 전달한다. 응답이 부족하거나 사례 종료 시 사용하지 않은 응답이 남으면 사례가 실패한다.

### 도구 스크립트

`tools.<이름>`은 `description`, `input`, `results`를 가진다. `description`의 기본값은 빈 문자열이고 `input`의 기본값은 `{"type":"object"}`다. `results`의 다음 항목을 호출마다 소비한다.

| 키 | 도구 구현의 반환값 |
|---|---|
| `text` | `text` 부분 배열이다. |
| `json` | `json` 부분 배열이다. |
| `content` | 적은 부분 배열이다. 선택 키 `isError`, `keep`, `meta`가 있으면 `{content,...}` 객체로 반환한다. |
| `value` | 적은 JSON 값을 그대로 반환한다. |
| `result` | `{content,isError?,keep?,meta?}`를 그대로 반환한다. 잘못된 결과 객체도 이 키로 표현한다. |
| `error` | 문자열을 메시지로 가진 오류를 던진다. |
| `runAgent` | 도구 컨텍스트의 `agents.run(name,input)`을 호출하고 반환된 출력 메시지의 `content`를 반환한다. |
| `await` | 게이트가 열리면 필수 `then` 항목을 실행한다. |

런타임은 도구 구현 반환값에 현재 호출의 `callId`, `name`, `args`를 채워 도구 결과로 정규화한다. `content` 키가 있는 객체는 결과 객체로 판정하므로 일반 데이터 객체로 반환하려면 `value`에 명시적인 `json` 부분을 적는다.

### 연산

함수와 확장 훅은 `{"op":<이름>,...}` 형식의 연산으로 작성한다. 경로 인수는 JSON Pointer다.

| 연산 | 인수와 결과 |
|---|---|
| `identity` | 받은 값을 반환한다. |
| `constant` | `value`를 반환한다. |
| `get` | `path`의 값이나 `null`을 반환한다. |
| `set` | 복사한 값의 `path`를 `value`로 바꾼다. |
| `merge` | 받은 객체와 객체 `value`를 규격의 값 병합 규칙으로 합친다. |
| `wrap` | 받은 값을 `key`로 감싸고 선택적인 `with`를 합친다. |
| `equals` | 선택적인 `path`의 값과 `value`를 JSON 값 비교한다. |
| `text`, `textSuffix` | 값에서 텍스트를 얻거나 `suffix`를 붙인다. |
| `result` | `content`와 선택적인 `isError`로 도구 결과 대체 제어 값을 만든다. |
| `sequence`, `chain` | 연산을 호출 번호나 배열 순서에 따라 실행한다. |
| `throw` | `message`를 가진 오류를 던진다. |
| `await` | `gate`를 기다린 뒤 선택적인 `then`을 실행한다. |
| `nonJson` | JSON이 아닌 값을 반환한다. |

확장 훅에서는 `append`, `runAgent`, `runModel`, `render`, `complete`도 사용할 수 있다. 훅의 `fn`은 값 변환 방식으로 연산 결과를 적용한다. `agent`·`template`, 그리고 `role`을 가진 `fn`은 메시지 보강 방식으로 결과를 적용한다. 사례 형식은 스키마가 허용한 단계와 실행 요소 조합만 사용한다.

### 확장 스크립트

`extensions.<이름>`은 선택적인 `definition`과 `instance`를 가진다. `definition`에는 `requires`, `hooks`, `tools`, `validateOptions`, `createError`를 쓸 수 있다. `hooks`에는 `onInput`, `onPrompt`, `onStep`, `onModelInput`, `onModelResult`, `onToolCall`, `onToolResult`, `onOutput`, `onError`를 쓴다. `instance.hooks`는 훅 이름에서 연산으로 가는 맵이고 `instance.tools`는 도구 이름에서 도구 스크립트로 가는 맵이다. `instance.events`는 처리할 실행 이벤트 이름 배열이다.

### 게이트

게이트는 비동기 실행 순서를 고정하는 이름 붙은 신호다. 모든 게이트는 닫힌 상태로 시작하며 `release` 단계가 열면 사례가 끝날 때까지 열린 상태를 유지한다. `never`는 열리지 않는 예약 이름이다. `reach`는 호출 하나 이상이 해당 게이트를 기다릴 때까지 기다린다.

## 실행 단계

각 단계는 동작 키 하나와 선택 키 `settle`을 가진다.

| 동작 | 값 | 반환값 |
|---|---|---|
| `run` | `{sessionId,input,agent?,startAgent?}` | 턴 결과다. 두 번째 `run`도 같은 입력 경로를 사용한다. |
| `decide` | `{operation,value,sessionId?}` | `operations.decide`가 반환한 작업이다. |
| `list` | `{sessionId?}` | `operations.list`가 반환한 작업 배열이다. |
| `abort` | `{sessionId}` | 불리언이다. |
| `deleteSession` | `{sessionId}` | 반환값이 없다. |
| `restart`, `close` | `{}` | 군단 객체를 다시 만들거나 닫는다. |
| `release`, `reach` | 게이트 이름 | 게이트를 열거나 대기를 관측한다. |
| `parallel` | 단계 배열의 배열 | 각 가지를 동시에 실행한다. |
| `acquireLease` | `{sessionId,owner,lease}` | 저장소 임대를 얻어 별칭으로 보관하고 `{token, expiresAt}` 또는 `null`을 반환한다. |
| `renewLease`, `releaseLease` | `{lease}` | 임대를 갱신하거나 해제한다. |
| `appendJournal` | `{events,lease?,expected?,writeId?}` | 저장된 이벤트 배열을 반환한다. |
| `appendOperationTransition` | `{sessionId,operation,status}` | 종료된 런타임이 남긴 작업을 장애 주입용으로 `approved`, `running`, `rejected`, `delivering` 상태까지 전이한다. |
| `scanJournal` | `{sessionId?,fromSeq?,limit?}` | 저장된 이벤트 배열을 반환한다. |
| `headJournal` | `{sessionId}` | 현재 head를 반환한다. |
| `deleteStoreSession` | `{sessionId,lease}` | 저장소에서 세션을 직접 삭제한다. |

`operation`이 `<op:<callId>>` 형식이면 러너는 fold 결과에서 실제 작업 식별자를 찾는다. `decide.value.decision`은 `approved`, `rejected`, `cancelled` 가운데 하나다. `restart`는 이전 객체를 닫지 않고 새 객체를 만든다. 새 객체는 세션을 처음 열 때 저널을 재생하여 열린 턴·실행과 작업을 자동 복구한다.

`appendJournal`의 새 이벤트에는 저장소가 붙이는 `seq`, `at`, `writeId`를 적지 않는다. `lease`를 지정하면 보관한 임대의 펜싱 토큰을 전달한다. `appendOperationTransition`은 해당 세션을 사용하던 런타임을 닫은 뒤 사용하며, 저장된 작업 별칭을 찾아 유효한 한 단계 전이만 기록한다. 이 단계들은 메모리 저장소의 낙관적 동시성, 임대와 펜싱, 프로세스 장애 뒤 복구를 직접 검증한다.

### 실행 단계 뒤의 대기와 `idle()`

러너는 최상위 단계가 끝날 때마다 군단 객체의 `idle()`을 호출한다. `reach`와 `settle:false` 단계 뒤에는 호출하지 않는다. `parallel`의 가지 안에서는 기다리지 않고 모든 가지가 끝난 뒤 한 번 기다린다. 각 단계와 `idle()`은 5초 안에 끝나야 한다.

## `expected.json`

`expected.json`은 `error`, `steps`, `observations` 가운데 해당하는 키를 가진다. 구성 오류 사례는 `error`만 사용한다. 실행 사례는 `steps`가 필수이며 `case.json.steps`와 길이가 같다.

### 구성 오류와 인수 오류

구성 오류는 `{"phase":"load|validate|create","issues":[...]}`이고, 잘못된 생성 인수는 `{"phase":"create","invalidArgument":true}`다. 이슈의 `message`는 선택적으로 비교한다. 오류 배열은 규격의 정렬 순서까지 비교한다.

### 실행 단계의 기대 결과

각 기대 단계는 `{}`, `{"result":값}`, `{"error":오류}`, `{"parallel":[[...],...]}` 가운데 하나다. `run` 결과는 `turnId`, 선택적인 `output`, `outputs`, `usage`, 선택적인 `finishReason`, `status`, `runs`를 투영한다. `runs`에는 `executionId`와 선택적인 `parentExecutionId` 또는 `operationId`를 포함한다. 훅 컨텍스트의 `model.run`은 별도 실행 기록을 만들지 않고 호출한 실행의 사용량에 합산한다.

실행 오류는 `where`, `codes`, `attempt`, 선택적인 `toolCall`, `message`를 비교한다. 저장소 직접 실행 단계의 계약 오류는 `{"storeError":"StoreConflictError|StoreInputError"}`로 비교한다. `message`는 기대 값에 적은 경우에만 비교한다. 실행 오류 코드의 닫힌 집합은 `model_error`, `tool_error`, `tool_unavailable`, `hook_error`, `value_invalid`, `route_error`, `operation_invalid`, `runtime_error`, `aborted`다.

### 관측

`observations`에는 다음 영역 가운데 필요한 값만 적는다. 러너는 모든 영역을 만들고 기대 값에 적은 영역만 비교한다.

| 영역 | 값 |
|---|---|
| `effectiveConfig` | 유효 구성이다. |
| `events` | 실행 이벤트 채널이 받은 이벤트의 투영 배열이다. |
| `journalEvents` | 저장소의 모든 세션 스트림에서 읽은 저널 이벤트의 투영 배열이다. |
| `journalStates` | 세션 식별자에서 해당 스트림의 fold 결과로 가는 맵이다. |
| `modelInputs`, `modelContexts` | 모델별 입력과 실행 컨텍스트다. |
| `toolCalls`, `toolContexts` | 도구 호출과 실행 컨텍스트다. |
| `functionCalls`, `functionContexts` | 함수 호출과 함수 컨텍스트다. |
| `hookCalls`, `hookContexts` | 확장 훅 호출과 훅 컨텍스트다. |
| `extensionLog` | 확장 옵션 검증, 생성, 이벤트 처리와 정리 기록이다. |
| `conversations` | 저널 fold의 `journalState.conversations`에서 만든 대화 맵이다. |
| `operations` | 저널 fold의 현재 작업 배열이다. |
| `operationHistory` | 작업별 상태와 전달 상태의 변화다. |

`events`의 저널 이벤트는 `type`, `seq`, `version`, 범위 식별자와 `data`를 가진다. 관측 전용 이벤트는 `type`, 범위 식별자, `data`, `observational:true`를 가진다. `at`과 `writeId`는 투영에서 제외한다. 두 종류는 같은 배열 안에서 명확히 구분된다. `journalEvents`에는 저널 이벤트만 있다.

컨텍스트 투영은 공통 실행 컨텍스트의 `agent`, `sessionId`, `turnId`, `instance`, `executionId`, 선택적인 `parentExecutionId` 또는 `operationId`를 포함한다. 모델 컨텍스트는 `step`, 도구 컨텍스트는 `toolCall`, `input`, `conversation`, `execution`, 훅 컨텍스트는 `inputKind`, `step`, `input`, `conversation`, `retryCount`를 추가한다.

`conversations`의 키는 stateful 인스턴스이면 `<sessionId>/<agent>`다. 그 밖의 인스턴스는 `<sessionId>/<agent>@<instance>`다. 값은 fold 결과의 메시지 배열이다. 저장소 내부 배열을 직접 읽어 기대 값으로 사용하지 않는다. `operationHistory`는 저널 이벤트 순서로 만든 `<status>/<deliveryStatus>` 배열이다.

## 정규화

러너는 전체 결과를 만든 뒤 사례 경로, 메시지 `id`, 작업 식별자, stateless 인스턴스, `turnId`, `executionId`·`parentExecutionId`, `inputId`를 차례로 정규화한다. 식별자는 처음 나타난 순서대로 `<instance:N>`, `<turn:N>`, `<execution:N>`, `<input:N>`이 된다. 작업은 `<op:<callId>>`가 된다.

`steps`를 먼저 훑고 이어서 관측 영역을 위 표의 순서로 훑는다. 배열은 원소 순서, 객체는 키의 유니코드 코드 포인트 순서로 훑는다. 작업의 `deliveryId`는 작업 식별자 치환 뒤 `operation:<op:...>:completion` 형태가 된다.

## 비교

- 기대 값에 적은 최상위 키와 관측 영역만 비교한다.
- `run.result`는 적은 키만 비교하고, 그 밖의 객체와 배열은 정확히 비교한다.
- JSON 값은 종류를 구분하며 수는 수치로 비교한다. 배열은 길이와 순서를, 객체는 키 집합과 값을 비교한다.
- 기대하지 않은 오류와 사용하지 않은 모델·도구 스크립트 항목은 사례를 실패시킨다.

## 러너 계약

### 러너의 실행 순서

러너는 사례 파일을 엄격하게 검사하고 스크립트·기록 저장소·이벤트 수신 기능을 준비한다. 구성을 읽고 실행 단계를 수행한 뒤 저장소 스트림을 `scan`하며, 같은 호스트의 순수 `fold`로 `journalStates`를 만든다. 대화와 작업 관측은 이 fold 결과에서 만든다. 관측 수집 뒤 군단 객체를 닫고 항상 검사하는 조건과 기대 값을 비교한다.

러너는 정규화 전 메시지 식별자, 턴 사용량 합계, 구성 오류 모양, 세션별 연속 `seq`, 이벤트 `at`, 저널 이벤트의 즉시 실행 이벤트 전달, 관측 전용 표시, 작업 시각 필드와 스크립트 소비 여부를 항상 검사한다.
세션 삭제가 성공한 사례에서는 삭제 전에 전달된 실행 이벤트를 최종 빈 스트림과 다시 대조하지 않는다. 삭제가 성공하기 전까지의 전달 일치와 관측 전용 표시는 수신 시점의 기록으로 계속 검사한다.

### 지원하지 않는 기능

러너가 호스트 API로 사례를 표현할 수 없으면 `unsupported by TypeScript runner: <feature>` 또는 `unsupported by Python runner: <feature>`로 실패한다. 사례를 건너뛰거나 예상 실패로 표시하거나 언어별 허용 목록을 두지 않는다.

### 네트워크와 자격 증명

사례와 러너는 네트워크, 실제 제공자 모델, 환경 변수와 자격 증명을 사용하지 않는다.

## `fixtures/models`와의 차이

`fixtures/models`는 공식 모델 어댑터의 요청 변환과 스트림 조립을 검증한다. 공통 실행 사례는 군단 구성·실행·저널 의미를 검증하며 모델 어댑터 사례를 읽지 않는다.

## 사례 추가 절차

1. 규격에서 검증할 규칙과 제목을 찾는다.
2. 규칙을 드러내는 가장 작은 구성과 스크립트를 작성한다. 오류 사례에는 결함을 하나만 둔다.
3. 규격 문장에서 기대 값을 도출한다.
4. 규칙을 확인하는 관측 영역만 적는다.
5. 두 언어의 러너로 실행한다.
6. 한 호스트만 실패하면 규격과 대조하여 해당 호스트를 고친다.
