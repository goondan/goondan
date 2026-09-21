# Goondan 작업 지침

Goondan은 YAML로 에이전트 구성과 연결을 표현하고 TypeScript와 Python 호스트에서 같은 실행 의미를 제공하는 런타임입니다.

## 작업 순서

1. 루트와 작업할 하위 폴더의 `AGENTS.md`를 읽습니다.
2. 실행 계약이 바뀌면 `spec/goondan.md`를, 모델 어댑터 계약이 바뀌면 `spec/model-adapters.md`를 먼저 갱신합니다.
3. TypeScript와 Python 구현, `spec/goondan.schema.json`과 `fixtures`의 공통 사례를 같은 계약에 맞춥니다. 스키마를 고치면 `pnpm schema:sync`로 두 호스트의 사본을 맞춥니다.
4. 호스트 API나 사용자 동작이 바뀌면 `README.md`를 함께 갱신합니다.
5. `pnpm build`, `pnpm test`, `pnpm typecheck`로 검증합니다. `pnpm test`는 두 호스트의 단위 검사와 공통 실행 사례를 모두 실행합니다.

## 구조

- `packages/core`: TypeScript 코어 런타임과 공개 타입
- `packages/models`: Anthropic과 OpenAI 공식 모델 어댑터
- `packages/cli`: Node CLI와 대화형 호스트
- `python/goondan`: Python 코어 런타임과 `goondan.models` 어댑터
- `spec`: 언어 중립 실행 규격, 모델 어댑터 규격과 구성 JSON Schema
- `fixtures/conformance`: 두 호스트가 같은 기대 값으로 통과하는 공통 실행 사례
- `fixtures/models`: 모델 어댑터의 요청 변환과 스트림 조립 사례

## 불변 규칙

- YAML은 데이터 구성으로 유지하며 호스트 구현을 이름으로 참조합니다.
- TypeScript와 Python은 각 언어의 호스트 프로세스에서 직접 실행합니다.
- 구성의 객체는 재귀 병합하고 배열은 뒤의 값으로 전체 교체합니다.
- `routes`는 `$input`에서 에이전트와 함수 노드를 거쳐 선택적인 `$output`으로 이어지며, 일치한 분기는 동시에 진행합니다.
- 세션마다 append 전용 저널 스트림 하나를 두고 입력, 대화, 승인 작업, 턴과 에이전트 실행 상태를 버전이 붙은 순수 `fold`로 재생합니다.
- `stateful: true`인 에이전트는 세션과 선언 이름의 조합으로 정한 인스턴스의 대화를 이어 가고, `stateful: false`인 실행도 저널에 기록합니다.
- 실행 범위는 `sessionId`, `turnId`, `instance`, `executionId`, `inputId`로 구분하고 직접 원인은 `parentExecutionId` 또는 `operationId`로 기록합니다.
- 입력은 `run`으로 수락하며, 진행 중인 stateful 인스턴스에는 다음 안전한 대화 처리 지점에서 반영합니다.
- 훅 시점은 `onInput`, `onPrompt`, `onStep`, `onModelInput`, `onModelResult`, `onToolCall`, `onToolResult`, `onOutput`, `onError`입니다.
- 승인 작업은 `operations.decide`와 `operations.list`로 다루며, 세션 저널을 상태의 정본으로 사용합니다.
- 타입 단언보다 정확한 타입과 타입 가드를 사용합니다. Python 공개 이름은 snake_case를 쓰고 직렬화되는 필드 이름은 camelCase를 유지합니다.
- 공개 저장소이므로 사내 호스트, 게이트웨이 주소와 과금 코드를 넣지 않습니다.

사용법과 호스트 API는 `README.md`, YAML 정의와 실행 규칙은 `spec/goondan.md`, 공통 사례 형식은 `fixtures/conformance/README.md`를 따릅니다.
