# docs/specs

이 폴더는 Goondan의 규범적 계약을 소유합니다.

- `core-runtime.md`는 구성, 호스트 바인딩, 훅, 실행, 흐름과 지연 작업의 기준입니다.
- `chat-runtime.md`는 터미널 호스트의 입력·출력과 세션 수명 계약입니다.
- `host.md`는 프로세스, 구현 모듈 로더와 번들 자산의 관계를 정의합니다.
- `cli.md`는 공개 명령과 코어 사용 경계를 정의합니다.

스펙은 TypeScript와 Python 구현보다 먼저 갱신합니다. 직렬화 형식은 `spec/goondan.schema.json`, 공통 실행 사례는 `fixtures/conformance`와 함께 일치시킵니다.
