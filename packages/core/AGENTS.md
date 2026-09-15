# packages/core

`@goondan/core`는 `goondan.yaml` 구성을 실행하는 TypeScript 런타임입니다.

## 모듈

구성 검사는 읽기, 스키마, 참조, 바인딩 네 단계로 나뉘고 단계마다 소유 모듈이 다릅니다.

| 모듈 | 소유 범위 |
|---|---|
| `yaml.ts` | YAML 해석 규칙과 `load.yaml`, `load.not_object` 판정 |
| `compose.ts` | `extends`와 `resources` 합성, variant, 리소스 그래프, `mergeValues` |
| `schema.ts` | `goondan.schema.json` 해석기와 스키마 단계 검사 |
| `effective.ts` | 합성 문서와 유효 구성, 상속과 제거, 참조 단계 검사, 훅과 템플릿 식별자 |
| `binding.ts` | 바인딩 단계 검사와 확장 인스턴스를 만든 뒤의 재검사 |
| `config.ts` | `loadConfig`, `loadConfigSync`, `validateConfig`, `prepareRuntimeConfig`가 적용할 단계의 조합 |
| `paths.ts` | 구성과 템플릿 경로를 선언한 위치 |
| `template-syntax.ts` | 공통 식 문법 검사. 태그와 공백 규칙은 `scan`이 적용하므로 템플릿 엔진의 같은 기능은 켜지 않습니다. |
| `template-load.ts` | 참조 단계의 템플릿 읽기, include 해석, `ctx.render`의 경로 규칙 |
| `template-render.ts`, `template.ts` | 미리 읽은 맵만 사용하는 렌더러. 렌더링 시점에 파일을 읽지 않습니다. |
| `stage.ts` | 단계 값의 형식, 제어 결과 판별, 메시지 추가와 중복 제거, 도구 호출 쌍 정리 |
| `runs.ts` | 에이전트 실행 기록 트리와 사용량 집계 |
| `operation.ts` | 승인 작업의 상태 전이와 완료 입력 |
| `store.ts` | 메모리 대화 저장소와 메모리 작업 저장소 |
| `runtime.ts` | 단계 실행 순서, 훅 파이프라인, 비동기 훅, 모델과 도구 반복, 흐름, 작업 실행과 이벤트 |
| `types.ts`, `errors.ts`, `json.ts` | 공개 타입, `GoondanConfigError`와 `GoondanExecutionError`, 구성 오류 정렬과 중복 제거, JSON 값 비교와 직렬화 |

실행 기록의 `kind`는 그 실행을 받는 위치가 정합니다. 턴의 흐름 단계는 `flow`, 중첩 구성의 흐름 단계는 `nested`, 도구와 에이전트 도구는 `tool`, 동기 훅은 `hook`, `model.run`은 `model`입니다. 비동기 훅과 승인된 작업의 실행은 기록을 만들지 않으며, `config` 에이전트 자신도 기록을 만들지 않습니다.

## 구조적 결정

1. 공개 인터페이스는 구성을 불러오는 `loadConfig`와 실행기를 만드는 `createRuntime`에 집중합니다. 모델, 도구, 함수, 확장, 저장소와 호스트 기능은 이름으로 받습니다.
2. 여덟 값의 훅 순서는 `goondan.yaml`만 소유합니다. 확장 구현은 다른 확장의 이름이나 실행 순서를 알지 못합니다.
3. 직렬화되는 값은 `spec/goondan.schema.json`과 `fixtures/conformance`를 기준으로 TypeScript와 Python에서 같은 JSON 모양을 사용합니다.
4. 런타임이 메시지 식별자, 도구 호출과 결과 연결, 중복 제거, 저장 시점과 훅 기록을 소유합니다.
5. 에이전트는 에이전트 경로로 식별하고 실행 범위는 대화 식별자와 에이전트 경로의 조합입니다. `GoondanRuntime`은 생성자에서 `config` 에이전트마다 중첩 런타임을 하나씩 만들며, 호스트가 만든 런타임이 실행 중단, 실행 중 입력, 작업 라우팅, 완료 전달과 `idle()`의 작업 집합을 소유합니다.
6. 승인 작업은 대화 턴과 분리된 operation으로 저장하며, 실행 상태와 완료 입력 전달 상태를 각각 원자적으로 전이합니다.

## 불변 규칙

- 구성 디렉터리는 `goondan.yaml`, `templates`, `variants`를 기준으로 구성합니다. 템플릿은 선언했거나 정적으로 include한 파일만 읽습니다.
- 훅은 받은 값을 반환하며 공유 대화를 직접 수정하지 않습니다.
- 확장 인스턴스는 에이전트 경로와 대화 식별자의 조합마다 하나씩 생성합니다. 확장이 선언한 훅 단계나 도구가 인스턴스가 실제로 제공한 것과 다르면 인스턴스를 준비할 때 `binding.extension_hook` 같은 구성 오류로 보고하며, 훅 실패로 바꾸지 않습니다.
- `ConversationStore`는 `load`, `append`, `replace`만 가집니다.
- 모델 호출 번호는 지금 시작하는 호출의 번호입니다.
- 도구 실행을 시도할 때마다 `tool.start`와 함께 `tool.done` 또는 `tool.error` 가운데 하나만 알립니다. 도구 결과 형식 검사 실패(`value_invalid`)와 필수 `toolResult` 훅 실패(`hook_error`)도 이 쌍을 지킵니다. 객체가 아닌 모델 결과는 `modelResult`의 `value_invalid`입니다.
- 이미 저장한 도구 호출을 건너뛰는 것은 같은 모델 응답의 호출 묶음을 이어서 처리하는 재시도뿐입니다.
- 재시작 시 `running` 작업은 중복 실행하지 않고 실패로 종결하며, 전달 중이던 완료 입력은 같은 `deliveryId`로 복구합니다.
- 구성 오류 목록은 `path`와 `code`만으로 정렬하고 중복을 제거합니다. `message`는 정렬에도 중복 제거에도 쓰지 않으므로 문구가 달라도 두 호스트의 목록은 같습니다.
- 실행 오류는 공개 클래스 `GoondanExecutionError` 하나로 던지며 `where`, `codes`, `message`, `attempt`와 도구 실패의 `toolCall`을 속성으로 가집니다. 타입 가드는 `isGoondanExecutionError`입니다.
- 템플릿 식의 수 리터럴은 정수부가 `0` 한 글자이거나 `0`이 아닌 숫자로 시작해야 하므로 `{{ 012 }}`는 `template.syntax`입니다. 따옴표 없는 YAML 스칼라 `012`가 `12`인 것과 다릅니다.

## 참조

- `spec/goondan.md`
- `spec/goondan.schema.json`
- `fixtures/conformance/README.md`
