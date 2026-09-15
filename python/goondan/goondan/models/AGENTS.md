# goondan.models 패키지

이 패키지는 Anthropic Messages API와 OpenAI Chat Completions API의 공식 모델 어댑터입니다. 규칙의 기준은 `spec/model-adapters.md`와 `spec/goondan.md`의 [모델 입력과 결과](../../../../spec/goondan.md#모델-입력과-결과)이며, TypeScript `@goondan/models`와 같은 설정·모델 입력에서 같은 요청 본문, 모델 결과, 텍스트 조각, 오류 코드를 만들어야 합니다. 두 언어의 동등성은 `fixtures/models`의 공통 사례로 확인합니다.

## 공개 이름

`anthropic_model(**settings)`와 `openai_chat_model(**settings)`가 각각 `AnthropicModel`과 `OpenAIChatModel`을 반환합니다. 두 모델은 `await model.generate(model_input, ctx)`로 호출하고, `await model.build_request(model_input)`은 같은 요청 본문을 HTTP 요청 없이 돌려줍니다. 어댑터가 던지는 오류는 `GoondanError`의 하위 클래스인 `ModelError`이며 `provider`, `code`, `status`, `retry_after_ms`, `request_id`, `retryable`을 가집니다. 원래 예외는 `__cause__`에 둡니다.

설정 이름은 snake_case이고, 직렬화되는 모델 입력·결과·`options`의 필드 이름은 스펙의 camelCase를 그대로 씁니다. `resolve_media`는 `{"ref", "mediaType"}` 매핑 하나를 받아 `{"data"}` 또는 `{"url"}`을 반환하며, 코루틴을 반환해도 됩니다. 모델 컨텍스트는 `ctx.on_text_delta`만 읽으므로 런타임 내부를 가져오지 않습니다. Python에는 `signal`이 없고 모델 호출을 실행하는 작업을 취소해서 알립니다.

## 모듈

`_values.py`는 `JSON.stringify`와 같은 JSON 텍스트, JavaScript `trim()`과 같은 공백 판정, 재귀 병합과 JSON 값 비교를 맡습니다. `_errors.py`는 `ModelError`와 오류 분류, 요청 식별자, 재시도 대기 힌트를 맡습니다. `_options.py`는 설정 검증, 자격 증명과 기본 URL, 헤더 병합, 옵션 병합과 httpx 지연 가져오기를 맡습니다. `_normalize.py`는 도구 짝 복구, 앞쪽 system 메시지 분리, 공백 텍스트 제외와 미디어 해석을 맡습니다. `_sse.py`는 서버 전송 이벤트 해석기, `_transport.py`는 한 번의 스트리밍 호출과 재시도·무응답 제한·취소를 맡습니다. `_anthropic.py`와 `_openai.py`는 제공자별 요청 변환과 스트림 조립을 맡고, `__init__.py`가 공개 이름을 다시 내보냅니다.

## httpx

httpx는 `goondan[models]` 선택 의존성입니다. `http_client`를 지정하지 않았고 httpx도 없으면 생성 함수가 설치를 안내하는 `GoondanError`를 던집니다. 어댑터는 호출자가 전달한 `http_client`를 닫지 않고, 직접 만든 클라이언트만 닫습니다. 요청마다 httpx의 기본 시간 제한을 끄고 `idle_timeout_ms`만 적용합니다.

## 테스트

`tests/test_models_fixtures.py`는 `fixtures/models`의 모든 공통 사례를 `httpx.MockTransport`로 실행합니다. `tests/test_models_sse.py`, `tests/test_models_errors.py`, `tests/test_models_transport.py`, `tests/test_models_anthropic.py`, `tests/test_models_openai.py`가 해석기, 오류 분류, 재시도·취소·무응답 제한, 제공자별 매핑을 확인합니다. `tests/test_models_support.py`는 공용 도구만 담습니다. 규칙이 바뀌면 `spec/model-adapters.md`를 먼저 고치고 두 언어의 어댑터와 사례를 함께 바꿉니다. 실제 제공자를 호출하는 테스트는 두지 않습니다.
