# CLI 대화형 호스트

이 폴더는 `gdn chat`의 터미널 입출력, 모델·도구 바인딩과 로컬 세션 수명을 관리합니다. 에이전트의 모델·도구 반복은 `@goondan/core`의 `createRuntime`이 담당합니다.

## 구조적 결정

1. `ChatHost`는 실행 중인 대화마다 하나의 코어 런타임을 소유합니다. 실행 중에 받은 추가 입력은 `steer`로 전달합니다.
2. Provider와 로컬 도구는 코어의 `Model`과 `Tool` 인터페이스를 구현합니다. 테스트와 사용자 바인딩은 같은 인터페이스로 주입합니다.
3. 세션 저장소는 에이전트별 메시지를 JSON으로 보존하고 파일을 원자적으로 교체합니다.
4. REPL은 입력과 프로세스 신호를 호스트 명령으로 변환하며, 실행 결과를 생성하는 별도 루프를 구현하지 않습니다.
5. `bash` 실행 시간은 호스트가 `bashTimeoutMs`를 명시했을 때만 제한합니다.

## 참조

- `docs/specs/chat-runtime.md`
- `docs/specs/core-runtime.md`
- `packages/core/AGENTS.md`
