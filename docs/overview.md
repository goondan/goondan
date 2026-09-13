# Goondan 개요

Goondan은 에이전트, 모델, 도구, 확장과 실행 흐름을 `goondan.yaml`로 구성하는 다중 언어 런타임입니다. 구성은 실행 관계를 표현하고, 호스트는 실제 모델과 기능을 이름으로 등록합니다.

TypeScript `@goondan/core`와 Python `goondan`은 각 언어의 프로세스에서 같은 계약을 구현합니다. `@goondan/cli`는 TypeScript 코어를 직접 사용하는 Node 호스트로서 한 번 실행과 터미널 대화를 제공합니다.

핵심 실행 단위는 에이전트의 턴입니다. 런타임은 입력과 대화를 모델 입력으로 만들고, 모델이 요청한 도구를 실행하여 결과를 저장하며, 최종 assistant 메시지를 출력 훅에 통과시킵니다. 여러 에이전트의 구성 계층 연결은 `flow`가 담당합니다.

승인과 같은 지연 작업은 대화 턴과 독립된 operation입니다. `operationStore`가 상태와 결과 전달의 정본이며, 완료 결과는 같은 에이전트와 대화에 별도 입력으로 전달됩니다.

- [아키텍처](architecture.md)
- [코어 런타임 계약](specs/core-runtime.md)
- [대화형 CLI 계약](specs/chat-runtime.md)
- [사용 가이드](../GUIDE.md)
