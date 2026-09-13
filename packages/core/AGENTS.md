# packages/core

`@goondan/core`는 `goondan.yaml` 구성을 실행하는 TypeScript 런타임입니다.

## 구조적 결정

1. 공개 인터페이스는 구성을 불러오는 `loadConfig`와 실행기를 만드는 `createRuntime`에 집중합니다. 모델, 도구, 함수, 확장, 저장소와 호스트 기능은 이름으로 받습니다.
2. 여덟 값의 훅 순서는 `goondan.yaml`만 소유합니다. 확장 구현은 다른 확장의 이름이나 실행 순서를 알지 못합니다.
3. 직렬화되는 값은 `spec/goondan.schema.json`과 `fixtures/conformance`를 기준으로 TypeScript와 Python에서 같은 JSON 모양을 사용합니다.
4. 런타임이 메시지 식별자, 도구 호출과 결과 연결, 중복 제거, 저장 시점과 훅 기록을 소유합니다.
5. 승인 작업은 대화 턴과 분리된 operation으로 저장하며, 실행 상태와 완료 입력 전달 상태를 각각 원자적으로 전이합니다.

## 불변 규칙

- 구성 디렉터리는 `goondan.yaml`, `templates`, `variants`를 기준으로 구성합니다.
- 훅은 받은 값을 반환하며 공유 대화를 직접 수정하지 않습니다.
- 확장 인스턴스는 에이전트와 대화의 조합마다 하나씩 생성합니다.
- 공개 타입은 `src/types.ts`, 설정 검사는 `src/config.ts`, 실행 의미는 `src/runtime.ts`에 둡니다.
- 재시작 시 `running` 작업은 중복 실행하지 않고 실패로 종결하며, 전달 중이던 완료 입력은 같은 `deliveryId`로 복구합니다.

## 참조

- `docs/specs/core-runtime.md`
- `spec/goondan.schema.json`
- `fixtures/conformance`
