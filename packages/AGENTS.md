# packages

`packages`는 Goondan의 TypeScript 코어, 공식 모델 어댑터와 CLI 배포 경계를 관리합니다.

## 존재 이유

- `core`는 Goondan 구성과 바인딩을 실행하는 TypeScript 런타임을 제공합니다.
- `models`는 Anthropic Messages API와 OpenAI Chat Completions API의 공식 모델 어댑터를 제공합니다.
- `cli`는 코어를 직접 사용하는 명령행 인터페이스와 대화형 호스트를 제공합니다.

## 구조적 결정

1. 실행 모델과 공개 타입은 `@goondan/core`가 함께 소유합니다. 타입과 구현의 변경을 하나의 계약에서 관리하여 런타임 간 해석 차이를 방지합니다.
2. `@goondan/models`는 코어의 `Model` 인터페이스만 사용하는 별도 패키지이며 코어를 peer dependency로 둡니다. 제공자별 요청 변환과 HTTP 처리를 코어 밖에 두어 코어가 네트워크 코드를 갖지 않게 합니다.
3. `@goondan/cli`는 코어를 같은 프로세스에서 직접 실행하고, 바인딩 모듈이 없을 때 쓸 기본 모델은 `@goondan/models`에서 가져옵니다.

## 불변 규칙

- 패키지는 `core`, `models`, `cli`의 책임 경계를 유지합니다.
- 빌드와 배포 순서는 `core`, `models`, `cli`입니다.
- 공개 npm 패키지는 `publishConfig.access = "public"`을 유지합니다.
- 타입 단언 대신 타입 가드와 정확한 타입 모델을 사용합니다.
- 어댑터에 내장하는 주소는 두 제공자의 공식 주소뿐이며 사내 호스트와 게이트웨이 주소를 넣지 않습니다.

## 참조

- `spec/goondan.md`
- `spec/model-adapters.md`
- `AGENTS.md`
