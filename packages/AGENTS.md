# packages

`packages`는 Goondan의 TypeScript 코어와 CLI 배포 경계를 관리합니다.

## 존재 이유

- `core`는 Goondan 구성과 바인딩을 실행하는 TypeScript 런타임을 제공합니다.
- `cli`는 코어를 직접 사용하는 명령행 인터페이스와 대화형 호스트를 제공합니다.

## 구조적 결정

1. 실행 모델과 공개 타입은 `@goondan/core`가 함께 소유합니다. 타입과 구현의 변경을 하나의 계약에서 관리하여 런타임 간 해석 차이를 방지합니다.
2. `@goondan/cli`는 코어를 같은 프로세스에서 직접 실행합니다. 구성, 실행과 대화 흐름을 하나의 Node 호스트에서 유지합니다.

## 불변 규칙

- 패키지는 `core`와 `cli`의 책임 경계를 유지합니다.
- 공개 npm 패키지는 `publishConfig.access = "public"`을 유지합니다.
- 타입 단언 대신 타입 가드와 정확한 타입 모델을 사용합니다.

## 참조

- `docs/specs/core-runtime.md`
- `docs/specs/chat-runtime.md`
- `AGENTS.md`
