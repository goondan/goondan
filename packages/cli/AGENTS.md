# packages/cli

`@goondan/cli`는 `@goondan/core`를 직접 실행하는 `gdn` 명령과 대화형 호스트를 제공합니다.

## 존재 이유

- `run`, `validate`, `config`, `chat`을 새 코어의 단일 실행 계약으로 제공합니다.
- 터미널 입출력과 로컬 대화 세션의 수명을 CLI 경계에서 관리합니다.

## 구조적 결정

1. `gdn run`은 구성과 호스트 바인딩 모듈을 불러와 `@goondan/core`를 같은 프로세스에서 실행합니다.
2. `gdn validate`와 `gdn config`는 코어의 구성 로더를 사용하여 실행과 동일한 해석 결과를 제공합니다.
3. `gdn chat`은 대화마다 하나의 코어 런타임을 소유하며, 터미널 입력과 로컬 세션 저장을 관리합니다.

## 불변 규칙

- CLI의 구성 해석과 에이전트 실행은 `@goondan/core`의 공개 계약을 사용합니다.
- 대화 중 추가 입력은 실행 중인 코어 런타임의 `steer`로 전달합니다.
- 세션 파일은 원자적으로 교체합니다.

## 참조

- `spec/goondan.md`
- `packages/core/AGENTS.md`
