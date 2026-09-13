# CLI 계약

`@goondan/cli`는 `@goondan/core`를 같은 Node 프로세스에서 실행합니다.

- `gdn validate [path]`: 구성을 불러오고 검증합니다.
- `gdn config [path]`: 합성·상속·제거를 마친 유효 구성을 출력합니다.
- `gdn run [path]`: 호스트 바인딩과 구성을 사용해 한 번 실행합니다.
- `gdn chat`: 여러 턴의 터미널 대화를 실행합니다.

모든 명령은 코어의 `loadConfig`를 사용합니다. 따라서 검증 결과와 실제 실행에 적용되는 구성은 같습니다. 대화형 동작은 [chat-runtime.md](chat-runtime.md)를 따릅니다.
