# packages/core

`@goondan/core`는 `goondan.yaml` 구성을 실행하는 TypeScript 런타임입니다.

## 모듈

구성 검사, 저널과 실행은 책임별 모듈로 나눕니다.

| 모듈 | 소유 범위 |
|---|---|
| `yaml.ts` | YAML 해석 규칙과 `load.yaml`, `load.not_object` 판정 |
| `compose.ts` | `resources` 합성, variant, 리소스 그래프와 `mergeValues` |
| `schema.ts` | `goondan.schema.json` 해석기와 스키마 단계 검사 |
| `effective.ts` | 합성 문서와 유효 구성, 상속과 제거, 참조 단계 검사 |
| `binding.ts` | 바인딩 단계 검사와 확장 인스턴스를 만든 뒤의 재검사 |
| `config.ts` | `loadConfig`, `loadConfigSync`, `validateConfig`, `prepareRuntimeConfig`가 적용할 단계의 조합 |
| `paths.ts` | 구성과 템플릿 경로를 선언한 위치 |
| `template-syntax.ts` | 두 호스트가 공유하는 템플릿 식 문법 검사 |
| `template-load.ts` | 템플릿 읽기, 정적 include 해석과 경로 규칙 |
| `template-render.ts`, `template.ts` | 구성 로딩 시 읽은 맵만 사용하는 렌더러 |
| `stage.ts` | 단계 값의 형식, 메시지 보강, 도구 반환값 정규화와 호출 쌍 정리 |
| `runs.ts` | 에이전트 실행 기록과 사용량 집계 |
| `operation.ts` | 승인 작업의 상태 전이와 완료 입력 |
| `store.ts` | `Store` 계약의 오류와 `MemoryStore` |
| `fold.ts` | 버전이 붙은 저널 이벤트를 상태 뷰로 재생하는 순수 `fold` |
| `runtime.ts` | `Goondan`과 `createGoondan`, 입력 대기열, 단계 실행, 모델·도구 반복, route, 승인 작업, 임대와 이벤트 |
| `types.ts`, `errors.ts`, `json.ts` | 공개 타입, 오류 계약과 JSON 공통 처리 |

## 구조적 결정

1. 공개 인터페이스는 구성을 불러오는 `loadConfig`와 군단 객체를 만드는 `createGoondan`에 집중합니다. 모델, 도구, 함수, 확장, 저널 저장소와 호스트 기능은 이름으로 받습니다.
2. 훅 시점은 `onInput`, `onPrompt`, `onStep`, `onModelInput`, `onModelResult`, `onToolCall`, `onToolResult`, `onOutput`, `onError`이며 순서는 `goondan.yaml`이 소유합니다.
3. 직렬화되는 값은 `spec/goondan.schema.json`과 `fixtures/conformance`를 기준으로 TypeScript와 Python에서 같은 JSON 모양을 사용합니다.
4. 세션마다 저널 스트림 하나를 두며 입력, 대화, 승인 작업, 턴과 실행 상태는 `fold`가 만든 뷰입니다. 저장소가 `seq`를 부여하고, 런타임은 `expected`, `writeId`, 임대와 펜싱 토큰으로 상태 변경을 보호합니다.
5. `sessionId`, `turnId`, `instance`, `executionId`, `inputId`를 서로 다른 범위로 유지하고, 직접 원인은 `parentExecutionId` 또는 `operationId`로 기록합니다.
6. `stateful: true`인 인스턴스는 입력 대기열 하나를 가지며 추가 `run` 입력과 하위 입력을 다음 안전한 대화 처리 지점에서 소비합니다. `stateful: false`인 실행도 저널에 기록하되 다음 실행의 대화로 사용하지 않습니다.
7. 에이전트 도구, 훅의 `agent`와 컨텍스트의 `agents.run`은 대상 인스턴스에 공통 입력 요청을 넣고, 그 입력을 소비한 실행의 출력 메시지를 기다립니다. 실제 출력 대기 관계에 순환이 생기면 입력을 넣기 전에 거부합니다.
8. 승인 작업은 `operations.decide`와 `operations.list`로 다룹니다. 알림은 저널·실행 이벤트로, 완료는 대상 인스턴스의 입력 대기열로 전달하며, 세션을 열 때 저널 재생으로 복구합니다.

## 불변 규칙

- 구성 디렉터리는 `goondan.yaml`, `templates`, `variants`를 기준으로 구성합니다. 파일 합성은 `resources`만 사용하며 템플릿은 선언했거나 정적으로 include한 파일만 읽습니다.
- 훅은 받은 값의 복사본을 처리하고 결과를 반환합니다. `onPrompt` 결과와 `onStep`의 대화 변경은 저널에 기록하고, `onModelInput` 변경은 해당 모델 호출에만 적용합니다.
- 훅 하나에는 `extension`, `fn`, `agent`, `template` 가운데 실행 요소 하나만 둡니다. `optional`의 기본값은 `false`이며 실행할 수 없는 단계·요소 조합은 로드 오류입니다.
- stateful 확장 인스턴스는 세션과 에이전트 이름의 조합마다 하나씩 생성합니다. stateless 확장 인스턴스는 실행마다 만들고 실행이 끝나면 정리합니다.
- `Store`는 `append`, `scan`, `head`, `watch`, `acquireLease`, `deleteSession`을 제공합니다. 세션당 활성 작성자 하나를 임대와 펜싱으로 강제하고, 삭제 뒤에도 토큰 세대를 유지합니다.
- 모델 호출 번호는 지금 시작하는 호출의 번호입니다.
- 도구 실행을 시도할 때마다 `tool.start`와 함께 `tool.done` 또는 `tool.error` 가운데 하나만 알립니다. 도구 구현의 반환값은 내용 부분 배열, 결과 객체 또는 JSON 값이며 런타임이 호출 메타데이터를 채웁니다.
- 저널 이벤트는 append 직후 같은 봉투로 실행 이벤트 채널에 전달합니다. 저장하지 않는 진행 이벤트에는 `observational: true`를 붙입니다.
- 세션 재생 시 열린 실행과 턴을 중단 상태로 닫고 승인된 작업과 완료 전달을 자동으로 복구합니다. 삭제한 세션의 늦은 완료는 스트림을 다시 만들지 않습니다.
- 구성 오류 목록은 `path`와 `code`만으로 정렬하고 중복을 제거합니다.
- 실행 오류는 공개 클래스 `GoondanExecutionError` 하나로 던지며 `where`, `codes`, `message`, `attempt`와 도구 실패의 `toolCall`을 속성으로 가집니다.

## 참조

- `spec/goondan.md`
- `spec/goondan.schema.json`
- `fixtures/conformance/README.md`
