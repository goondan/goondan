# CLI 대화형 호스트

이 폴더는 `gdn chat`의 터미널 입출력, 모델·도구 바인딩과 로컬 세션 수명을 관리합니다. 에이전트의 모델·도구 반복은 `@goondan/core`의 `createGoondan`이 담당합니다.

`command.ts`가 옵션 해석과 바인딩 구성을, `default.ts`가 구성이 없을 때 쓰는 기본 구성과 상태 디렉터리를, `model.ts`가 제공자와 모델 선택을, `tools.ts`가 로컬 도구를, `host.ts`가 런타임 수명을, `repl.ts`가 터미널 루프를, `session.ts`가 JSONL 저널 저장소를 소유합니다.

## 구조적 결정

1. `ChatHost`는 실행 중인 대화마다 하나의 코어 군단 객체를 소유합니다. 실행 중에 받은 추가 입력도 `run`으로 전달합니다.
2. `model.ts`는 제공자와 모델만 고르고 모델 구현은 `@goondan/models`의 공식 어댑터가 제공합니다. 제공자는 `--provider`, `GOONDAN_CHAT_PROVIDER`, 환경에 있는 자격 증명 순서로 정하고, 모델은 `--model`, `GOONDAN_CHAT_MODEL` 순서로 정하며, `--base-url`은 제공자의 기본 URL 환경 변수보다 우선합니다. 빈 문자열인 환경 변수는 없는 것으로 봅니다.
3. 로컬 도구는 코어의 `Tool` 인터페이스를 구현하며, 테스트와 사용자 바인딩은 같은 인터페이스로 주입합니다.
4. 세션별 JSONL 파일은 append 전용 저널 이벤트 스트림을 보존하고, 재시작할 때 재생하여 상태를 복구합니다.
5. 바인딩 모듈이 없으면 구성이 선언한 모든 모델 이름을 고른 어댑터 하나에 묶습니다.
6. REPL은 입력과 프로세스 신호를 호스트 명령으로 변환하며, 실행 결과를 생성하는 별도 루프를 구현하지 않습니다.
7. `bash` 실행 시간은 호스트가 `bashTimeoutMs`를 명시했을 때만 제한합니다.
8. 승인 작업 UI는 `operations.list`와 `operations.decide`를 사용하고, 작업 알림은 `operation.*` 이벤트로 표시합니다.

## 참조

- `spec/goondan.md`
- `spec/model-adapters.md`
- `packages/core/AGENTS.md`
