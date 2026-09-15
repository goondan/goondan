# packages/models

`@goondan/models`는 Anthropic Messages API와 OpenAI Chat Completions API(호환 엔드포인트 포함)를 Goondan 모델 구현으로 연결하는 공식 TypeScript 어댑터입니다.

## 존재 이유

- 호스트가 제공자 요청 변환, 스트림 조립, 재시도와 오류 분류를 직접 구현하지 않고 `RuntimeBindings.models`에 모델을 등록할 수 있게 합니다.
- Python `goondan.models`와 같은 설정과 모델 입력에서 같은 요청 본문, 결과, 텍스트 조각과 오류 코드를 만듭니다.

## 구조적 결정

1. 제공자별 매핑은 `spec/model-adapters.md`를, 제공자와 무관한 모델 입력과 결과의 의미는 `spec/goondan.md`의 모델 입력과 결과 절을 따릅니다.
2. 런타임 의존성 없이 전역 `fetch`와 Web Streams만 사용합니다. `@goondan/core`는 타입만 가져오는 peer dependency입니다.
3. 공통 모듈이 제공자와 무관한 처리를 맡습니다. `options.ts`는 설정 검사, 자격 증명과 옵션 병합을, `normalize.ts`는 도구 짝 복구, 앞쪽 system 메시지 분리와 `media` 해석을, `sse.ts`는 SSE 해석을, `transport.ts`는 요청 전송, 재시도, 무응답 제한과 취소를, `errors.ts`는 `ModelError`와 오류 분류를 담당합니다. `anthropic.ts`와 `openai.ts`는 요청 변환과 스트림 조립만 담당합니다.
4. 요청 변환 함수 `buildAnthropicRequest`와 `buildOpenAIChatRequest`는 `generate`가 보낼 본문을 그대로 반환하며 HTTP 요청을 보내지 않습니다.
5. Goondan 부분으로 표현할 수 없는 Anthropic 응답 블록은 결과 메시지의 `meta.anthropic.content`에 기록하고, 부분이 바뀌지 않은 assistant 메시지를 보낼 때 그대로 다시 보냅니다.
6. 테스트는 `vitest.config.ts`에서 `@goondan/core`를 코어 소스로 연결하므로 코어를 먼저 빌드하지 않아도 런타임 연동 테스트를 실행할 수 있습니다. 타입 검사는 `tsconfig.test.json`으로 테스트 코드까지 확인합니다.

## 불변 규칙

- 코드에 내장하는 주소는 두 제공자의 공식 주소뿐입니다. 게이트웨이와 호환 서버의 주소는 설정이나 환경 변수로만 받으며, 사내 호스트, 과금 코드와 내부 서비스 이름을 코드, 테스트와 문서에 넣지 않습니다.
- 매핑을 바꾸면 `spec/model-adapters.md`, Python 어댑터와 `fixtures/models` 사례를 함께 갱신합니다.
- 텍스트 조각을 호출자에게 전달한 뒤에는 재시도하지 않습니다. 취소되면 `ModelError`로 감싸지 않고 `signal.reason`을 던집니다.
- 테스트는 가짜 `fetch`로 실행하며 실제 제공자 API를 호출하지 않습니다.
- 타입 단언 대신 타입 가드와 정확한 타입을 사용합니다.

## 참조

- `spec/model-adapters.md`
- `spec/goondan.md`
- `fixtures/models/README.md`
- `packages/core/AGENTS.md`
