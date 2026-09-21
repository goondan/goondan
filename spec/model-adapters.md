# 모델 어댑터 규격

이 문서는 공식 모델 어댑터가 모델 입력을 제공자 요청으로 바꾸고 제공자 스트림을 모델 결과로 조립하는 규칙을 정의한다. 공식 어댑터는 TypeScript `@goondan/models`와 Python `goondan.models`이며, Anthropic Messages API와 OpenAI Chat Completions API(호환 엔드포인트 포함)를 지원한다. 두 언어의 어댑터는 같은 설정과 모델 입력에서 같은 요청 본문을 만들어야 한다. 또 새로 만드는 메시지 식별자와 도구 호출 식별자를 제외하면 같은 스트림에서 같은 결과, 텍스트 조각과 오류 코드를 만들어야 한다. 이 동등성은 [`fixtures/models`](../fixtures/models)의 공통 사례로 검증한다.

공통 옵션 키, `finishReason`과 `usage`의 의미, 텍스트 조각, 모델 오류 코드와 메시지 `meta` 보존처럼 제공자와 무관한 규칙은 [Goondan YAML 규격의 모델 입력과 결과](./goondan.md#모델-입력과-결과)를 따른다. 호스트가 직접 구현한 모델은 그 규칙만 지키면 되고 이 문서의 매핑은 따르지 않아도 된다.

## 어댑터 구성

| 구분 | TypeScript `@goondan/models` | Python `goondan.models` |
|---|---|---|
| Anthropic 모델 생성 | `createAnthropicModel(config)` | `anthropic_model(**settings)`, `AnthropicModel` 반환 |
| OpenAI 모델 생성 | `createOpenAIChatModel(config)` | `openai_chat_model(**settings)`, `OpenAIChatModel` 반환 |
| 요청 변환 | `buildAnthropicRequest(input, config)`, `buildOpenAIChatRequest(input, config)` | `await model.build_request(model_input)` |
| 오류 | `ModelError`, `isModelError(value)` | `ModelError`(`GoondanError`의 하위 클래스) |

생성 함수가 반환한 모델은 `generate(input, ctx)`로 호출한다. 어댑터는 호출 컨텍스트의 텍스트 조각 콜백(TypeScript `ctx.onTextDelta`, Python `ctx.on_text_delta`)으로 텍스트 조각을 전달하며, TypeScript 어댑터는 `ctx.signal`로 취소를 감지한다. 요청 변환 함수는 `generate`가 보낼 요청 본문을 반환하고 HTTP 요청은 보내지 않는다. `media` 부분의 해석이 비동기일 수 있으므로 두 언어 모두 요청 본문을 비동기로 반환한다.

Python 어댑터는 `goondan[models]` 선택 의존성으로 설치하는 httpx를 사용한다. httpx가 없고 `http_client`도 지정하지 않았으면 생성 함수가 `goondan[models]` 설치를 안내하는 `GoondanError`를 던진다.

## 공통 설정

TypeScript 어댑터는 설정 객체의 필드로, Python 어댑터는 생성 함수의 키워드 인수로 설정을 받는다.

| TypeScript | Python | 기본값 | 의미 |
|---|---|---|---|
| `model` | `model` | 없음(필수) | 제공자 모델 식별자 |
| `apiKey` | `api_key` | 제공자 API 키 환경 변수 | API 키 |
| `baseUrl` | `base_url` | 제공자 기본 URL 환경 변수, 그다음 공식 주소 | 요청을 보낼 기본 URL. 끝의 `/`는 제거한다. |
| `headers` | `headers` | 없음 | 기본 헤더 뒤에 적용하는 추가 헤더. 헤더 이름을 대소문자 구분 없이 비교해 같은 이름의 기본 헤더를 대체한다. |
| `options` | `options` | 빈 객체 | 모든 호출에 적용하는 기본 모델 옵션 |
| `maxRetries` | `max_retries` | `2` | 한 호출에서 요청을 다시 보내는 최대 횟수 |
| `idleTimeoutMs` | `idle_timeout_ms` | 없음 | 응답 헤더나 다음 본문 조각을 기다리는 최대 밀리초 |
| `resolveMedia` | `resolve_media` | 없음 | `media` 부분을 base64 데이터나 URL로 바꾸는 호스트 함수 |
| `env` | `env` | 프로세스 환경 변수 | 환경 변수를 읽을 맵 |
| `fetch` | `http_client` | TypeScript는 전역 `fetch`, Python은 호출마다 새로 만드는 `httpx.AsyncClient` | 요청에 사용할 HTTP 구현. 어댑터는 호출자가 전달한 `http_client`를 닫지 않는다. |

제공자별 설정은 각 제공자 절에 정의한다. 설정 값의 형식이 맞지 않으면 생성 함수가 `invalid_request` 오류로 실패한다.

## 자격 증명과 기본 URL

어댑터는 생성할 때 자격 증명과 기본 URL을 한 번 정한다. 자격 증명은 API 키이며 Anthropic은 인증 토큰도 자격 증명으로 받는다. 설정 값이 있으면 설정 값을 사용하고, 없으면 `env`의 환경 변수를 읽는다. 빈 문자열인 환경 변수는 없는 것으로 본다.

| 제공자 | API 키 변수 | 인증 토큰 변수 | 기본 URL 변수 | 공식 주소 | 요청 주소 |
|---|---|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_AUTH_TOKEN` | `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | `{baseUrl}/v1/messages` |
| OpenAI | `OPENAI_API_KEY` | 없음 | `OPENAI_BASE_URL` | `https://api.openai.com/v1` | `{baseUrl}/chat/completions` |

Anthropic 기본 URL에는 API 버전 경로를 넣지 않고, OpenAI 기본 URL에는 `/v1` 같은 버전 경로까지 넣는다. 예를 들어 로컬 Ollama의 OpenAI 호환 엔드포인트는 `http://localhost:11434/v1`로 지정한다.

끝의 `/`를 제거한 기본 URL이 공식 주소와 정확히 같으면 공식 주소를 사용하는 것으로 본다. 공식 주소를 사용하는데 자격 증명이 없으면 생성 함수가 `authentication` 오류로 실패한다. 다른 기본 URL은 자격 증명 없이 사용할 수 있고, 자격 증명이 있으면 공식 주소와 같은 헤더로 보낸다. Anthropic의 `autoCache`와 OpenAI의 `maxTokensField`는 공식 주소 여부에 따라 기본값이 달라진다.

어댑터에 내장된 주소는 두 공식 주소뿐이다. 게이트웨이와 호환 서버의 주소는 설정이나 환경 변수로만 지정한다.

## 옵션 병합

어댑터는 설정의 `options` 위에 모델 입력의 `options`를 재귀 병합한 값을 사용한다. 객체는 키별로 병합하고, 배열을 포함한 그 밖의 값은 모델 입력의 값으로 교체한다. 병합한 옵션에서 값이 `null`인 키는 없는 것으로 본다. 병합 결과는 다음 순서로 요청 본문에 반영한다.

1. 공통 키를 제공자별 요청 본문 표에 따라 요청 필드로 바꾼다. `maxTokens`는 정수, `temperature`와 `topP`는 숫자, `stop`은 문자열 배열, `toolChoice`는 `auto`, `none`, `required` 가운데 하나이거나 문자열 `name`을 가진 객체여야 한다. 형식이 맞지 않으면 `invalid_request` 오류다.
2. 제공자 이름과 같은 키(`anthropic` 또는 `openai`)의 객체를 요청 본문에 재귀 병합한다. 이 객체는 1단계에서 만든 필드도 덮어쓴다. 값이 객체가 아니거나 어댑터가 관리하는 필드를 포함하면 `invalid_request` 오류다. 어댑터가 관리하는 필드는 `messages`, `tools`, `stream`이며 Anthropic은 `system`을 더한다.
3. 다른 제공자의 이름 키와 알 수 없는 최상위 키는 무시한다.

`onModelInput` 훅은 두 제공자 이름 키를 함께 채워 어느 제공자가 연결되어도 같은 구성을 사용할 수 있다.

모델 구현이 반환하는 작성용 응답은 `message.id`와 `message.source`를 생략할 수 있다. 런타임은 빠진 `id`를 새로 만들고 빠진 `source`를 `model`로 채운 뒤 메시지·종료 사유·사용량을 검증하여 정규화된 모델 결과를 만든다. 이후 `onModelResult`, 저널, 실행 이벤트와 턴 결과에는 정규화된 결과만 사용한다. 어댑터가 제공자 응답을 조립하는 규칙은 작성용 응답을 만드는 규칙이며 런타임 식별자를 미리 만들 의무가 없다.

## 대화 정규화

두 어댑터는 제공자 매핑 전에 모델 입력의 메시지를 다음 순서로 정규화한다.

1. **도구 짝 복구**: `tool.call`과 `tool.result` 부분은 같은 `callId`의 호출과 결과가 메시지 목록에 모두 있을 때만 남긴다. 부분이 모두 제거된 메시지는 목록에서 제거한다.
2. **앞쪽 system 메시지 분리**: 목록 맨 앞에 연속한 `system` 메시지를 떼어 내 시스템 블록 뒤에 이어지는 지시로 사용한다. 이 메시지를 앞쪽 system 메시지라고 한다. 그 뒤에 나오는 `system` 메시지는 중간 system 메시지이며 제공자 절의 규칙을 따른다.
3. **공백 텍스트 제외**: 공백만 있는 시스템 블록, 텍스트 부분과 system 메시지는 보내지 않는다. 보낼 내용이 남지 않은 메시지는 요청에서 제외한다. OpenAI tool 메시지의 `content`만 예외다.

공백만 있는 텍스트는 JavaScript `String.prototype.trim()`의 결과가 빈 문자열인 텍스트다. system 메시지의 텍스트는 `text`와 `json` 부분의 텍스트를 구분자 없이 이어 붙인 문자열이며, 다른 종류의 부분은 사용하지 않는다. `json` 부분의 텍스트는 값을 공백 없이 직렬화한 JSON이고, 키 순서와 숫자·문자열 표기는 JavaScript `JSON.stringify`와 같다. 도구 호출 인수를 JSON 문자열로 보낼 때도 같은 규칙을 적용한다.

도구 정의의 `input`에 `type` 키가 없으면 `type: object`를 추가해 보낸다.

### 미디어 해석

`media` 부분은 `resolveMedia`로 해석한다. 해석 함수는 부분의 `ref`와 `mediaType`을 받아 `{data, mediaType?}` 또는 `{url, mediaType?}`를 반환하거나, 그 값으로 완료되는 비동기 값을 반환한다. `data`는 `data:` 접두사가 없는 base64 문자열이다. TypeScript 해석 함수는 두 번째 인수로 `{signal}`을 받는다. 해석한 미디어의 유형은 결과의 `mediaType`이고, 없으면 부분의 `mediaType`이다.

해석 함수가 없거나 제공자가 받을 수 없는 미디어 유형이면 `unsupported_content` 오류다.

## 스트리밍

어댑터는 항상 `stream: true`로 요청하고 응답 본문을 서버 전송 이벤트(SSE)로 해석한다.

- 본문 조각을 UTF-8로 이어서 디코딩하므로 여러 바이트로 이루어진 문자가 본문 조각 경계에서 나뉘어도 된다.
- 줄 끝은 `\r\n`, `\n`, `\r`이다. 본문 조각이 `\r`로 끝나면 다음 조각을 받은 뒤 `\r\n`인지 판단한다.
- `:`로 시작하는 줄은 주석이므로 무시한다. `data` 필드의 값은 콜론 뒤의 공백 한 개를 제외한 부분이며, 한 이벤트에 `data` 줄이 여럿이면 `\n`으로 연결한다. `event`, `id`, `retry` 필드는 무시한다.
- 빈 줄에서 이벤트 하나가 끝난다. 스트림이 빈 줄 없이 끝나도 마지막 이벤트를 처리한다.
- 각 이벤트의 `data`는 JSON으로 해석하며 OpenAI의 `[DONE]`만 예외다. JSON으로 해석할 수 없으면 `invalid_response` 오류다.

어댑터는 사용자에게 보일 assistant 텍스트 가운데 비어 있지 않은 조각만 받은 순서대로 텍스트 조각 콜백에 전달한다. 추론 내용과 도구 인수는 전달하지 않는다. 제공자의 종료 표시(Anthropic `message_stop`, OpenAI `[DONE]` 또는 `finish_reason`)를 받기 전에 스트림이 끝나면 `network` 오류다.

## 재시도, 시간 제한과 취소

`rate_limited`, `overloaded`, `server_error`, `timeout`, `network` 오류는 재시도 대상이다. 어댑터는 이 오류가 텍스트 조각을 하나도 전달하지 않은 상태에서 발생했을 때만 같은 요청을 다시 보내며, 한 호출에서 최대 `maxRetries`번 다시 보낸다. 텍스트 조각을 전달한 뒤에 발생한 오류는 재시도하지 않고 호출자에게 전달한다. 다시 보내기 전에 이전 응답을 닫고, 다음 시도의 응답으로 결과를 처음부터 조립한다. 결과의 `usage`는 결과를 반환한 시도의 사용량이며 실패한 시도의 사용량은 포함하지 않는다.

n번째 재시도(첫 재시도는 n = 0) 전의 대기 시간은 다음과 같다.

- 실패한 HTTP 응답이 알려 준 대기 시간이 0 이상 60초 이하이면 그 값을 사용한다. 어댑터는 밀리초 단위의 `retry-after-ms` 헤더를 먼저 읽고, 없으면 초 또는 HTTP 날짜인 `retry-after` 헤더를 읽는다. HTTP 날짜는 현재 시각까지 남은 시간을 사용하며 음수이면 0이다.
- 그 밖에는 `min(8000, 500 × 2^n)` 밀리초에 `1 − 0.25 × r`을 곱한 값이다. `r`은 0 이상 1 미만의 균등 난수다.

어댑터는 기본 시간 제한을 두지 않으며 HTTP 라이브러리의 기본 시간 제한도 적용하지 않는다. `idleTimeoutMs`를 지정하면 응답 헤더를 기다리는 시간이나 다음 본문 조각을 기다리는 시간이 그 값을 넘을 때 `timeout` 오류로 실패한다.

취소는 언어별로 다음과 같이 처리한다.

- **TypeScript**: 호출 컨텍스트의 `signal`을 HTTP 요청, 스트림 읽기와 재시도 대기에 연결한다. 취소되면 `signal.reason`이 `Error`이면 그 값을, 아니면 이름이 `AbortError`인 `DOMException`을 던진다. 이 값은 `ModelError`로 감싸지 않으며 재시도하지 않는다.
- **Python**: asyncio 작업 취소로 발생한 `asyncio.CancelledError`를 잡거나 감싸지 않고 전파한다. 전파하기 전에 열린 응답과 어댑터가 만든 클라이언트를 닫는다.

HTTP 구현이 던진 그 밖의 예외는 원래 예외를 원인으로 가진 `network` 오류로 바꾼다. Python에서 httpx의 시간 초과 예외는 `timeout` 오류다.

## 오류

어댑터가 던지는 오류는 `ModelError`이며 다음 속성을 갖는다. 원래 예외가 있으면 TypeScript는 `cause`, Python은 `__cause__`에 둔다.

| TypeScript | Python | 의미 |
|---|---|---|
| `provider` | `provider` | `anthropic` 또는 `openai` |
| `code` | `code` | 아래 표의 오류 코드 |
| `status` | `status` | HTTP 오류 응답의 상태 코드. 그 밖의 오류에는 없다. |
| `retryAfterMs` | `retry_after_ms` | 응답이 알려 준 대기 밀리초 |
| `requestId` | `request_id` | `request-id` 헤더, `x-request-id` 헤더, 응답 본문의 `request_id` 순서로 찾은 요청 식별자 |
| `retryable` | `retryable` | 재시도할 수 있는 코드이면 참 |

런타임은 이 오류의 `code`를 `onError`에 전달하는 `codes`의 두 번째 값으로 사용한다.

| 코드 | 의미 | 재시도 |
|---|---|---|
| `invalid_request` | 제공자가 요청을 거부했거나 어댑터가 요청을 만들 수 없다. | 아니오 |
| `authentication` | 자격 증명이 없거나 유효하지 않다. | 아니오 |
| `permission` | 자격 증명에 필요한 권한이 없다. | 아니오 |
| `not_found` | 엔드포인트나 모델을 찾을 수 없다. | 아니오 |
| `request_too_large` | 요청이 크기 제한을 넘었다. | 아니오 |
| `context_length` | 입력이 모델의 컨텍스트 한도를 넘었다. | 아니오 |
| `quota` | 결제나 사용 한도 문제로 요청할 수 없다. | 아니오 |
| `rate_limited` | 요청 빈도 제한에 걸렸다. | 예 |
| `overloaded` | 제공자가 과부하 상태다. | 예 |
| `server_error` | 제공자 서버에서 오류가 발생했다. | 예 |
| `timeout` | 제한 시간 안에 응답을 받지 못했다. | 예 |
| `network` | 연결에 실패했거나 스트림이 종료 표시 없이 끝났다. | 예 |
| `invalid_response` | 응답이나 도구 인수를 해석할 수 없다. | 아니오 |
| `unsupported_content` | 제공자에 보낼 수 없는 부분이나 미디어가 있다. | 아니오 |

HTTP 오류 응답은 상태 코드가 2xx가 아닌 응답이다. HTTP 오류 응답과 스트림 중 오류는 상태 코드와 오류 객체의 `type`, `code`, `message`로 분류한다. 오류 객체는 응답 본문이나 스트림 이벤트의 `error` 필드이며, HTTP 오류 응답에 오류 객체의 `message`가 없으면 응답 본문 텍스트를 `message`로 사용한다. 스트림 중 오류에는 HTTP 상태 코드가 없으며, 오류 객체의 `code`가 정수이면 그 값을 상태 코드로 사용한다. 어댑터는 다음 조건을 위에서부터 확인해 처음 맞는 코드를 사용한다.

1. `quota`: `code`가 `insufficient_quota`, `type`이 `billing_error`, 또는 상태 코드 402
2. `context_length`: `code`가 `context_length_exceeded`, 또는 `message`가 대소문자 구분 없이 `prompt is too long`, `context length`, `maximum context` 가운데 하나를 포함
3. `overloaded`: `type`이 `overloaded_error`, 또는 상태 코드 529
4. `rate_limited`: `type`이 `rate_limit_error`, 또는 상태 코드 429
5. `authentication`: `type`이 `authentication_error`, 또는 상태 코드 401
6. `permission`: `type`이 `permission_error`, 또는 상태 코드 403
7. `not_found`: `type`이 `not_found_error`, 또는 상태 코드 404
8. `request_too_large`: `type`이 `request_too_large`, 또는 상태 코드 413
9. `timeout`: 상태 코드 408
10. `server_error`: `type`이 `api_error`, 또는 상태 코드 409나 500 이상
11. `invalid_request`: 그 밖의 HTTP 오류 응답, 또는 `type`이 `invalid_request_error`인 스트림 중 오류
12. `server_error`: 그 밖의 스트림 중 오류

`context_length`의 메시지 조건은 제공자 오류 문구에 의존하므로, 제공자가 문구를 바꾸면 `invalid_request`로 분류될 수 있다.

## 결과 메시지

결과 메시지는 새로 만든 고유한 `id`, `role: assistant`, `source: model`을 갖는다. `meta`에는 제공자 이름 키 아래에 응답 정보를 기록하며 필드는 제공자 절에 정의한다. 제공자가 사용량 필드를 하나도 알려 주지 않으면 `usage`를 생략하고, 일부만 알려 주면 나머지 필드를 0으로 채운다.

## Anthropic Messages API

### 요청 헤더와 설정

요청은 `POST {baseUrl}/v1/messages`이며 기본 헤더는 다음과 같다.

- `content-type: application/json`
- `accept: text/event-stream`
- `anthropic-version: 2023-06-01`
- API 키가 있으면 `x-api-key: <API 키>`, API 키가 없고 인증 토큰이 있으면 `authorization: Bearer <인증 토큰>`

베타 기능은 `headers`의 `anthropic-beta` 헤더와 `options.anthropic`으로 켠다.

| TypeScript | Python | 기본값 | 의미 |
|---|---|---|---|
| `authToken` | `auth_token` | `ANTHROPIC_AUTH_TOKEN` | API 키가 없을 때 사용하는 인증 토큰 |
| `autoCache` | `auto_cache` | 공식 주소이면 참, 아니면 거짓 | 최상위 자동 캐시 사용 여부 |
| `cacheTtl` | `cache_ttl` | 없음 | 캐시 지점의 유지 시간. `5m` 또는 `1h` |
| `midConversationSystem` | `mid_conversation_system` | `user` | 중간 system 메시지를 보내는 방식. `user` 또는 `system` |

### 요청 본문

| 요청 필드 | 값 |
|---|---|
| `model` | 설정의 `model` |
| `max_tokens` | `maxTokens`. 없으면 `64000` |
| `stream` | `true` |
| `system` | 시스템 블록과 캐시 절에 따른 텍스트 블록 배열. 보낼 블록이 없으면 생략한다. |
| `messages` | 메시지 배치 절에 따라 만든 배열 |
| `tools` | 도구마다 `{name, description, input_schema}`. 도구가 없으면 생략한다. |
| `cache_control` | `autoCache`가 참이면 `{type: ephemeral}`. `cacheTtl`이 있으면 `ttl`을 추가한다. |
| `temperature` | `temperature` |
| `top_p` | `topP` |
| `stop_sequences` | `stop` |
| `tool_choice` | `auto`는 `{type: auto}`, `none`은 `{type: none}`, `required`는 `{type: any}`, `{name}`은 `{type: tool, name}` |

공통 옵션이 없으면 해당 필드를 보내지 않는다. `options.anthropic`은 마지막에 요청 본문에 병합한다. 어댑터는 모델별 지원 여부를 판단하지 않으므로, 모델이 거부하는 필드나 값(예: 샘플링 매개변수를 받지 않는 모델의 `temperature`)도 그대로 보내며 이때 제공자 응답은 `invalid_request` 오류가 된다.

### 시스템 블록과 캐시

`system` 배열은 공백이 아닌 시스템 블록을 순서대로 `{type: text, text}`로 바꾼 뒤, 앞쪽 system 메시지의 텍스트를 같은 형식으로 이어 붙인 것이다.

`cache: true`인 시스템 블록 가운데 마지막 4개에만 `cache_control: {type: ephemeral}`을 붙인다. `autoCache`가 참이면 마지막 3개에만 붙인다. `cacheTtl`이 있으면 각 `cache_control`에 `ttl`을 추가한다. Anthropic은 요청 하나에 캐시 지점을 4개까지 허용하며 자동 캐시도 그중 하나를 차지한다. 뒤쪽 지점이 앞쪽 접두사까지 함께 캐시하므로 마지막 지점을 남긴다. 앞쪽 system 메시지에서 만든 블록에는 캐시 지점을 붙이지 않는다.

`autoCache`가 참이면 최상위 `cache_control`을 보내 제공자가 대화의 마지막 블록까지 자동으로 캐시하게 한다. 이 필드를 받지 않는 호환 엔드포인트가 있으므로 기본값은 공식 주소에서만 참이다.

### 메시지 배치

1. `assistant` 메시지는 `assistant` 요청 메시지가 되고, `user`와 `tool` 메시지, user 턴으로 보내는 중간 system 메시지는 `user` 요청 메시지가 된다.
2. 역할이 같은 인접 요청 메시지는 내용 블록을 순서대로 이어 붙여 하나로 합친다. 따라서 병렬 도구 결과는 하나의 user 메시지에 들어간다.
3. 합친 각 user 메시지에서 `tool_result` 블록을 다른 블록보다 앞에 둔다. `tool_result` 블록끼리와 나머지 블록끼리의 순서는 유지한다.

중간 system 메시지는 기본적으로 다음 텍스트 블록 하나로 user 턴에 넣는다.

```text
<system-reminder>
{system 메시지의 텍스트}
</system-reminder>
```

`midConversationSystem`이 `system`이면 바로 앞에 만든 요청 메시지의 역할이 `user`이고, 뒤에 남은 메시지가 없거나 다음 메시지가 `assistant`일 때 `{role: system, content: <텍스트>}` 메시지로 보낸다. 이 조건을 만족하지 않으면 기본 방식으로 보낸다. 중간 `role: system` 메시지를 지원하지 않는 모델은 요청을 거부하므로 이 설정은 지원하는 모델에만 사용한다.

### 부분 매핑

| Goondan 부분 | 사용할 수 있는 위치 | Anthropic 블록 |
|---|---|---|
| `text`, `json` | 모든 메시지와 도구 결과 | `{type: text, text}` |
| `image`(base64 `data:` URL) | user·tool 메시지, 도구 결과 | `{type: image, source: {type: base64, media_type, data}}`. `media_type`은 부분의 `mediaType`이고, 없으면 URL에 적힌 미디어 유형이다. |
| `image`(`http`·`https` URL) | user·tool 메시지, 도구 결과 | `{type: image, source: {type: url, url}}` |
| `media` | user·tool 메시지, 도구 결과 | 해석한 미디어 유형이 `image/*`이면 `image` 블록, `application/pdf`이면 `document` 블록. 데이터는 `{type: base64, media_type, data}`, URL은 `{type: url, url}` 원본으로 보낸다. |
| `tool.result` | user·tool 메시지 | `{type: tool_result, tool_use_id, content, is_error}` |
| `tool.call` | assistant 메시지 | `{type: tool_use, id, name, input}` |

- `tool_use_id`와 `tool_use`의 `id`는 `callId`에서 `[A-Za-z0-9_-]`에 속하지 않는 문자를 `_`로 바꾼 값이다. 바꾼 값이 빈 문자열이면 `_`를 사용한다.
- `tool_result`의 `content`는 도구 결과의 내용을 이 표에 따라 바꾼 블록 배열이며, 비어 있으면 생략한다. `is_error: true`는 `isError`가 참일 때만 보낸다.
- `tool_use`의 `input`은 `args`이며, `args`가 `null`이면 빈 객체를 보낸다. `args`가 객체도 `null`도 아니면 `invalid_request` 오류다.
- 표에 없는 부분과 위치의 조합(예: assistant 메시지의 `image`, user 메시지의 `tool.call`)과 그 밖의 이미지 URL은 `unsupported_content` 오류다.

### 원래 블록 재전송

Anthropic 응답에 Goondan 부분으로 표현할 수 없는 블록이 있으면 결과 메시지의 `meta.anthropic.content`에 응답 블록 배열 전체를 기록한다. 이후 요청에서 assistant 메시지의 `meta.anthropic.content`가 배열이고, 그 배열을 결과 절의 규칙으로 바꾼 부분 배열이 메시지의 현재 `content`와 JSON 값으로 같으면 기록된 블록 배열을 그대로 보낸다. 같지 않으면 현재 부분을 부분 매핑 표에 따라 바꾸며 thinking 블록 같은 원래 블록은 보내지 않는다. 두 경우 모두 공백만 있는 텍스트 블록은 제외한다.

이 규칙으로 thinking 블록과 서명이 도구 호출 루프의 다음 요청에 그대로 전달된다. 대화 저장소, 훅이나 호스트가 `meta`를 버리거나 메시지를 새로 만들면 원래 블록 없이 요청하게 되며, 추론 블록의 재전송을 요구하는 모델은 이 요청을 거부할 수 있다.

### 스트림 이벤트

이벤트 종류는 `data` JSON의 `type` 필드로 판단한다. `type`이 없는 이벤트는 `invalid_response` 오류다.

| 이벤트 | 처리 |
|---|---|
| `message_start` | `message.id`, `message.model`, `message.usage`를 기록한다. |
| `content_block_start` | `index` 위치에 `content_block`의 복사본을 만든다. |
| `content_block_delta` | `index` 위치의 블록을 `delta.type`에 따라 갱신한다. `text_delta`는 `text`를 블록 텍스트에 붙이고 텍스트 조각으로 전달한다. `input_json_delta`는 `partial_json`을 인수 문자열에 붙인다. `thinking_delta`는 `thinking`에, `signature_delta`는 `signature`에 붙이며, `citations_delta`는 `citation`을 `citations` 배열에 추가한다. 그 밖의 `delta.type`은 무시한다. |
| `content_block_stop` | 무시한다. |
| `message_delta` | `delta.stop_reason`, `delta.stop_details`, `usage`를 갱신한다. |
| `message_stop` | 응답이 끝났음을 기록한다. |
| `ping` | 무시한다. |
| `error` | `error` 객체로 분류한 `ModelError`를 던진다. |

그 밖의 이벤트는 무시한다.

`tool_use`와 `server_tool_use` 블록의 인수 문자열은 스트림이 끝난 뒤 JSON으로 해석해 `input`에 넣는다. 인수 문자열이 비어 있으면 `content_block_start`에서 받은 `input`을 유지하고, 그 값도 없으면 빈 객체를 사용한다. 해석에 실패했을 때 종료 사유가 `max_tokens`나 `model_context_window_exceeded`이면 그 블록을 결과에서 제외하고, 그 밖에는 `invalid_response` 오류다.

### 결과

결과의 `content`는 블록을 `index` 순서대로 바꾼 부분 배열이다. `text` 블록은 `text` 부분이 되고 `tool_use` 블록은 `{type: tool.call, callId: id, name, args: input}` 부분이 된다. 그 밖의 블록은 부분으로 바꾸지 않는다.

`meta.anthropic`에는 다음 필드를 기록한다.

| 필드 | 값 |
|---|---|
| `id` | 응답 식별자 |
| `model` | 응답을 생성한 모델 |
| `stopReason` | 원래 `stop_reason`. 받지 못했으면 `null` |
| `stopDetails` | `stop_details`. `null`이 아닌 값을 받았을 때만 기록한다. |
| `content` | 전체 블록 배열. `text`나 `tool_use`가 아닌 블록(thinking, redacted_thinking, 서버 도구, 대체 모델 블록 등)이나 `citations`가 있는 `text` 블록이 있을 때만 기록한다. |

| `stop_reason` | `finishReason` |
|---|---|
| `end_turn`, `stop_sequence` | `stop` |
| `tool_use` | `tool` |
| `max_tokens`, `model_context_window_exceeded` | `length` |
| `refusal`, `pause_turn`, 그 밖의 값, 값 없음 | `other` |

`refusal`과 `pause_turn`을 구분해야 하는 호스트는 `meta.anthropic.stopReason`을 확인한다.

사용량은 `input_tokens`를 `input`으로, `output_tokens`를 `output`으로, `cache_read_input_tokens`를 `cacheRead`로, `cache_creation_input_tokens`를 `cacheWrite`로 옮긴다. `message_start`와 `message_delta`가 같은 필드를 알려 주면 나중 값이 앞의 값을 대체한다.

## OpenAI Chat Completions API

### 요청 헤더와 설정

요청은 `POST {baseUrl}/chat/completions`다. 기본 헤더는 `content-type: application/json`과 `accept: text/event-stream`이며, API 키가 있으면 `authorization: Bearer <API 키>`를 추가한다. 이 어댑터는 OpenAI Chat Completions와 호환되는 게이트웨이와 로컬 서버에도 사용한다.

| TypeScript | Python | 기본값 | 의미 |
|---|---|---|---|
| `maxTokensField` | `max_tokens_field` | 공식 주소이면 `max_completion_tokens`, 아니면 `max_tokens` | `maxTokens`를 보낼 요청 필드 |
| `streamUsage` | `stream_usage` | 참 | 스트림 끝의 사용량 청크를 요청할지 여부 |
| `systemRole` | `system_role` | `system` | 시스템 지시 메시지의 역할. `system` 또는 `developer` |
| `midConversationSystem` | `mid_conversation_system` | `system` | 중간 system 메시지를 보내는 방식. `system` 또는 `user` |

공식 API는 `max_tokens` 대신 `max_completion_tokens`를 사용하지만 일부 호환 서버는 `max_tokens`만 해석하므로 `maxTokensField`의 기본값은 기본 URL에 따라 다르다.

### 요청 본문

| 요청 필드 | 값 |
|---|---|
| `model` | 설정의 `model` |
| `messages` | 메시지 매핑 절에 따라 만든 배열 |
| `stream` | `true` |
| `stream_options` | `streamUsage`가 참이면 `{include_usage: true}` |
| `tools` | 도구마다 `{type: function, function: {name, description, parameters}}`. 도구가 없으면 생략한다. |
| `maxTokensField`가 가리키는 필드 | `maxTokens`. 없으면 보내지 않는다. |
| `temperature` | `temperature` |
| `top_p` | `topP` |
| `stop` | `stop` |
| `tool_choice` | `auto`, `none`, `required`는 같은 문자열, `{name}`은 `{type: function, function: {name}}` |

공통 옵션이 없으면 해당 필드를 보내지 않는다. `options.openai`는 마지막에 요청 본문에 병합한다. Chat Completions에는 캐시 지점을 지정하는 필드가 없으므로 시스템 블록의 `cache`는 무시한다.

### 메시지 매핑

| Goondan 메시지 | Chat Completions 메시지 |
|---|---|
| 시스템 블록과 앞쪽 system 메시지 | 맨 앞의 메시지 하나. 역할은 `systemRole`이고, `content`는 공백이 아닌 시스템 블록의 텍스트와 앞쪽 system 메시지의 텍스트를 빈 줄(`\n\n`)로 연결한 문자열이다. 텍스트가 없으면 생략한다. |
| 중간 `system` | 기본값은 `{role: <systemRole>, content: <텍스트>}`. `midConversationSystem`이 `user`이면 Anthropic 절의 `<system-reminder>` 형식 문자열을 `content`로 가진 `user` 메시지다. |
| `user` | 내용 항목이 텍스트 하나이면 `content`는 그 문자열이고, 그 밖에는 내용 항목 배열이다. |
| `assistant` | 공백이 아닌 텍스트를 `\n`으로 연결한 `content`(없으면 `null`)와 `tool_calls` 배열. 텍스트와 도구 호출이 모두 없으면 생략한다. |
| `tool` | `tool.result` 부분마다 `{role: tool, tool_call_id: <callId>, content}` 메시지 하나 |

| Goondan 부분 | Chat Completions 표현 |
|---|---|
| `text`, `json` | `{type: text, text}` |
| `image` | `{type: image_url, image_url: {url}}` |
| `media` | 해석한 미디어 유형이 `image/*`이면 `image_url` 항목이다. 데이터는 `data:<미디어 유형>;base64,<데이터>` URL로 보낸다. `application/pdf` 데이터이면 `{type: file, file: {file_data: "data:application/pdf;base64,<데이터>"}}`다. |
| `tool.call` | `{id: <callId>, type: function, function: {name, arguments}}`. `arguments`는 `args`의 JSON 문자열이며 `args`가 `null`이면 `{}`다. |

`tool_call_id`와 도구 호출의 `id`에는 `callId`를 그대로 사용한다. URL로 해석한 PDF처럼 표에 없는 미디어와, 표에 없는 부분과 메시지 역할의 조합은 `unsupported_content` 오류다.

### 도구 결과

tool 메시지의 `content`는 도구 결과의 `text`와 `json` 텍스트를 `\n`으로 연결한 문자열이며 공백이어도 그대로 보낸다. Chat Completions의 tool 메시지는 이미지와 오류 여부를 담을 수 없으므로 다음과 같이 처리한다.

- `isError`는 보내지 않는다.
- 도구 결과의 이미지(해석한 유형이 `image/*`인 `media` 포함)는 연속한 tool 메시지가 끝난 직후에 추가하는 `user` 메시지 하나로 옮긴다. 이 메시지의 내용은 `{type: text, text: "Images returned by tool calls: <callId 목록>"}` 항목 뒤에 이미지 항목을 이어 붙인 배열이다. `<callId 목록>`은 이미지를 반환한 `callId`를 처음 나온 순서대로 중복 없이 `, `로 연결한 문자열이다.
- 텍스트가 빈 문자열이고 이미지가 있는 도구 결과의 `content`는 `(image output attached in the next user message)`다.
- 도구 결과 안의 PDF는 `unsupported_content` 오류다.

### 스트림 청크

- `data: [DONE]`에서 스트림이 끝난다.
- 청크에 객체인 `error` 필드가 있으면 그 오류 객체로 분류한 `ModelError`를 던진다.
- 문자열 `id`를 가진 첫 청크의 `id`와 `model`을 기록한다.
- 객체인 `usage` 필드는 마지막으로 받은 값을 사용한다. 사용량 청크의 `choices`는 빈 배열일 수 있다.
- `choices`에서 `index`가 0인 항목만 처리하며, `index`가 없는 항목은 0으로 본다.
- `delta.content`가 비어 있지 않은 문자열이면 텍스트에 붙이고 텍스트 조각으로 전달한다. `reasoning_content`, `reasoning`을 비롯한 그 밖의 `delta` 필드는 무시한다.
- `delta.tool_calls`의 각 항목은 키로 도구 호출을 찾는다. `index`가 숫자이면 그 값이 키다. `index`가 없고 `id`가 있으면 같은 `id`를 가진 호출의 키이며, 그런 호출이 없으면 새 키다. 둘 다 없으면 마지막 호출의 키이며, 호출이 아직 없으면 0이다. 새 키는 그때까지 만든 호출의 수다.
- 호출의 `id`와 `function.name`은 처음 받은 비어 있지 않은 값을 사용한다. 문자열 `function.arguments`는 인수 문자열에 이어 붙이고, 객체이면 그 JSON 문자열로 교체한다.
- `finish_reason`이 문자열이면 종료 사유로 기록하고 응답이 끝난 것으로 본다. 그 뒤에 오는 사용량 청크도 처리한다.

### 결과

결과의 `content`는 텍스트가 있으면 `text` 부분 하나를 먼저 두고, 도구 호출을 키 순서대로 `tool.call` 부분으로 추가한 배열이다. 인수 문자열이 비어 있으면 `args`는 빈 객체이고, 아니면 JSON으로 해석한 값이다. 해석에 실패했을 때 `finish_reason`이 `length`이면 그 호출을 제외하고, 그 밖에는 `invalid_response` 오류다. `id`가 없는 호출의 `callId`는 `call_<키>_` 뒤에 소문자 16진수 8자리의 임의 값을 붙인 문자열이다.

`finishReason`은 다음 표를 위에서부터 확인해 처음 맞는 값이다.

| 조건 | `finishReason` |
|---|---|
| `finish_reason`이 `length` | `length` |
| 결과에 `tool.call` 부분이 있음 | `tool` |
| `finish_reason`이 `stop` | `stop` |
| `content_filter`, 그 밖의 값, 값 없음 | `other` |

일부 호환 서버는 도구 호출에도 `finish_reason: stop`을 보내며, 이때도 `finishReason`은 `tool`이다.

`meta.openai`는 `id`, `model`, `finishReason`을 갖는다. `finishReason`은 원래 `finish_reason`이며 받지 못했으면 `null`이다.

사용량 청크를 받으면 `input`은 `prompt_tokens`에서 `prompt_tokens_details.cached_tokens`를 뺀 값, `output`은 `completion_tokens`, `cacheRead`는 `cached_tokens`, `cacheWrite`는 0이다. 없는 값은 0으로 본다. 사용량 청크를 받지 못하면 `usage`를 생략한다.

## 공통 사례

`fixtures/models/<제공자>/<사례>/` 디렉터리 하나가 사례 하나다. `<제공자>`는 `anthropic` 또는 `openai`다. 모델 사례는 `fixtures/conformance`와 분리하며, 사례 디렉터리에는 `goondan.yaml`을 두지 않는다.

`case.json`은 다음 필드를 갖는다.

| 필드 | 필수 | 의미 |
|---|---|---|
| `config` | 예 | 어댑터 설정. TypeScript 설정 이름을 사용하며 JSON으로 표현할 수 있는 설정만 넣는다. `model`은 필수다. |
| `input` | 아니오 | 모델 입력 |
| `stream` | 아니오 | 제공자 응답 본문 전체. 줄 끝 문자를 보존하기 위해 JSON 문자열로 저장한다. |
| `chunkSize` | 아니오 | 스트림을 나눌 바이트 수. 기본값은 `7`이다. |

`expected.json`은 다음 필드를 갖는다.

| 필드 | 의미 |
|---|---|
| `request` | 기대하는 요청 본문 |
| `result` | 기대하는 모델 결과. `message.id`는 넣지 않는다. |
| `deltas` | 텍스트 조각 콜백에 전달되는 문자열 배열 |
| `error` | 기대하는 오류. `{code: <오류 코드>}` 형식이다. |

두 언어의 러너는 사례마다 다음 순서로 실행한다.

1. `config`로 어댑터를 만든다. `config.env`가 없으면 빈 환경 변수 맵을 사용하므로 프로세스 환경은 결과에 영향을 주지 않는다. Python 러너는 설정 이름을 snake_case 키워드 인수로 바꾼다. 생성이 실패하면 오류 코드를 `error.code`와 비교하고 사례를 끝낸다.
2. `input`이 있으면 요청 변환 함수로 요청 본문을 만들어 `request`와 비교한다. 변환이 실패하고 `stream`이 없으면 오류 코드를 `error.code`와 비교한다.
3. `stream`이 있으면 UTF-8 바이트로 바꾼 뒤 `chunkSize` 바이트씩 나눠 어댑터의 SSE 해석과 결과 조립에 넣는다. 조립에 성공하면 `message.id`를 제외한 결과를 `result`와, 전달된 텍스트 조각을 `deltas`와 비교한다. 실패하면 오류 코드를 `error.code`와 비교한다.

러너는 `expected.json`에 있는 필드만 비교한다. `error`가 있는데 해당 단계가 성공하거나, `error`가 없는데 실패하면 사례가 실패한다. 값 비교는 JSON 값 비교이며 객체 키 순서는 무시하고 배열 순서와 값의 형식은 구분한다. 기본 `chunkSize` 7은 한글처럼 여러 바이트로 이루어진 문자를 조각 경계에서 나누기 위한 값이다.

공식 주소를 사용하는 사례는 생성이 실패하지 않도록 임의의 `apiKey`를 넣으며, 요청 본문에는 자격 증명이 들어가지 않는다. 임의로 만든 `callId`는 비교할 수 없으므로 사례의 스트림은 도구 호출 식별자를 포함한다. 재시도, 대기 시간, 취소, 무응답 제한, 헤더와 `media` 해석처럼 HTTP 전송이나 호스트 함수가 필요한 동작은 각 언어의 어댑터 테스트로 검증한다.
