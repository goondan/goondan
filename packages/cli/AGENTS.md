# packages/cli

`@goondan/cli`는 `@goondan/core`를 직접 실행하는 `gdn` 명령과 대화형 호스트를 제공합니다.

## 존재 이유

- `run`, `validate`, `config`, `chat`을 코어의 단일 실행 계약으로 제공합니다.
- 터미널 입출력과 로컬 대화 세션의 수명을 CLI 경계에서 관리합니다.

## 구조적 결정

1. `gdn run`은 구성과 호스트 바인딩 모듈을 불러와 `@goondan/core`를 같은 프로세스에서 실행합니다. `--agent`는 에이전트 이름으로 해석하여 단일 에이전트 실행으로 넘깁니다.
2. `gdn validate`와 `gdn config`는 코어의 구성 로더를 사용하여 실행과 동일한 해석 결과를 제공합니다. `--variant`는 지정한 순서 그대로 코어에 전달합니다.
3. `gdn chat`은 대화마다 하나의 코어 군단 객체를 소유하며, 터미널 입력과 JSONL 저널 저장소를 관리합니다.
4. `gdn chat`의 기본 모델은 `@goondan/models`의 공식 어댑터로 만들며, CLI는 `--provider`, `--model`, `--base-url`과 환경 변수로 제공자와 모델을 고르는 흐름만 소유합니다.
5. 승인 작업 명령은 코어의 `operations.list`와 `operations.decide`만 사용하며, 완료 전달과 복구는 코어의 저널 재생에 맡깁니다.

## 불변 규칙

- CLI의 구성 해석과 에이전트 실행은 `@goondan/core`의 공개 계약을 사용합니다.
- 대화 중 추가 입력은 실행 중인 코어 군단 객체의 `run`으로 전달합니다.
- `/agent`는 추가 입력의 대상 에이전트를 지정하고, `/operations`, `/approve`, `/reject`, `/cancel`은 승인 작업의 조회와 결정을 호출합니다.
- 모델 요청 변환과 스트림 해석은 CLI가 직접 구현하지 않고 `@goondan/models`에 맡깁니다.
- 바인딩 모듈이 없을 때 만드는 기본 바인딩은 구성이 선언한 모든 모델 이름을 고른 어댑터 하나에 묶습니다.
- 세션 파일은 세션 식별자별 JSONL 이벤트 스트림이며, 각 줄에는 완전한 저널 이벤트 봉투를 저장합니다.

## 참조

- `spec/goondan.md`
- `spec/model-adapters.md`
- `packages/core/AGENTS.md`
