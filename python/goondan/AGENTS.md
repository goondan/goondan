# goondan Python 패키지

이 패키지는 Goondan 구성 파일을 Python 프로세스에서 직접 실행합니다. 공개 인터페이스와 실행 동작은 TypeScript의 `@goondan/core`, `spec/goondan.schema.json`, `fixtures/conformance/`와 같은 의미를 유지합니다.

`goondan/runtime.py`는 구성 합성, 값별 훅, 확장 인스턴스, 모델·도구 반복, 흐름, 저장, `maintain`과 `prewarm`을 함께 소유합니다. `tests/test_conformance.py`는 루트의 모든 공통 검사 사례를 자동으로 읽으므로 사례가 추가되면 Python 검사에도 바로 포함됩니다.

비동기 승인은 공개 `OperationStore` 계약의 상태 전이와 delivery claim을 기준으로 복구합니다. `InMemoryOperationStore`는 메모리 호스트의 기본 구현입니다. 최초 도구 호출에는 `pending` 결과를 연결하고, 종결 결과는 같은 대화의 별도 `operation_completion` 입력으로 전달합니다. 승인 입력 수정은 호스트 검증을 거쳐 `inputPatch`와 `resolvedToolCall`에 기록하며 원래 `toolCall`을 보존합니다. 호스트가 completion 전달 함수를 제공하면 호스트가 안정적인 `deliveryId`로 durable inbound를 처리합니다.

Python 공개 이름에는 snake_case를 사용합니다. 직렬화되는 메시지, 모델 입력, 도구 호출, 결과와 오류의 필드 이름은 언어 중립 스펙의 camelCase를 그대로 사용합니다.
