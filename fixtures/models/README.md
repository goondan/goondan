# 모델 어댑터 공통 사례

이 폴더는 TypeScript `@goondan/models`와 Python `goondan.models`가 함께 실행하는 모델 어댑터 사례를 담습니다. 두 언어의 어댑터는 같은 사례에서 같은 요청 본문, 모델 결과, 텍스트 조각과 오류 코드를 만들어야 합니다. 사례 형식과 실행 순서의 기준은 [모델 어댑터 규격의 공통 사례](../../spec/model-adapters.md#공통-사례)입니다.

## 폴더 구성

`<제공자>/<사례>/` 디렉터리 하나가 사례 하나입니다. `<제공자>`는 `anthropic` 또는 `openai`이며, 사례 디렉터리에는 `case.json`과 `expected.json`만 둡니다. 모델 사례에는 `goondan.yaml`을 두지 않으므로 `fixtures/conformance` 러너가 이 사례를 읽지 않습니다.

사례 이름은 검증하는 단계에 따라 다음 접두사로 시작합니다.

| 접두사 | 검증하는 단계 |
|---|---|
| `config-` | 어댑터 생성 |
| `request-` | 모델 입력을 요청 본문으로 바꾸는 규칙 |
| `stream-` | 응답 스트림 해석과 결과 조립 |

## case.json

| 필드 | 필수 | 내용 |
|---|---|---|
| `config` | 예 | 어댑터 설정입니다. TypeScript 설정 이름(camelCase)을 쓰며 JSON으로 표현할 수 있는 값만 넣습니다. `model`은 필수입니다. |
| `input` | 아니오 | 모델 입력(`system`, `messages`, `tools`, `options`)입니다. |
| `stream` | 아니오 | 제공자 응답 본문 전체를 담은 JSON 문자열입니다. `\r\n`과 `\r` 같은 줄 끝 문자를 그대로 보존합니다. |
| `chunkSize` | 아니오 | 응답 본문을 나눌 바이트 수입니다. 기본값은 `7`입니다. |

## expected.json

| 필드 | 내용 |
|---|---|
| `request` | 요청 변환 함수가 반환해야 하는 요청 본문 |
| `result` | `message.id`를 뺀 모델 결과 |
| `deltas` | 텍스트 조각 콜백에 전달된 문자열 배열 |
| `error` | 기대하는 오류이며 `{"code": "<오류 코드>"}` 형식입니다. |

## 러너 동작

1. `config`로 어댑터를 만듭니다. `config.env`가 없으면 빈 환경 변수 맵을, `config.maxRetries`가 없으면 `0`을 사용하므로 프로세스 환경과 재시도 대기가 결과에 영향을 주지 않습니다. Python 러너는 설정 이름을 snake_case 키워드 인수로 바꿉니다. 생성이 실패하면 오류 코드를 비교하고 사례를 끝냅니다.
2. `input`이 있으면 요청 변환 함수가 반환한 본문을 `request`와 비교합니다. 변환이 실패하고 `stream`이 없으면 오류 코드를 비교합니다.
3. `stream`이 있으면 UTF-8 바이트를 `chunkSize` 바이트씩 나눈 본문을 가짜 HTTP 응답으로 전달하고 모델의 `generate`를 호출합니다. `input`이 없으면 빈 모델 입력을 사용합니다. 호출이 성공하면 결과와 텍스트 조각을, 실패하면 오류 코드를 비교합니다.

러너는 `expected.json`에 있는 필드만 비교합니다. 값은 JSON 값으로 비교하므로 객체 키 순서는 무시하고 배열 순서와 값의 형식은 구분합니다. `error`가 있는데 오류가 발생하지 않거나, `error`가 없는데 한 단계라도 실패하면 사례가 실패합니다.

재시도 대기, 취소, 무응답 제한, 요청 헤더와 `media` 해석처럼 HTTP 전송이나 호스트 함수가 필요한 동작은 이 폴더에 넣지 않고 각 언어의 어댑터 테스트에서 검증합니다.

## 사례 작성 규칙

- 공식 주소를 사용하는 사례에는 임의의 `apiKey`를 넣습니다. 요청 본문에는 자격 증명이 들어가지 않습니다.
- 스트림의 도구 호출에는 식별자를 넣습니다. 어댑터가 임의로 만든 `callId`는 비교할 수 없습니다.
- 게이트웨이와 호환 서버 주소에는 `example.com`이나 `localhost`처럼 공개 문서용 주소만 사용합니다.
- 기본 `chunkSize` 7은 한글처럼 여러 바이트로 이루어진 문자를 조각 경계에서 나눕니다. 줄 끝 처리를 확인하는 사례에는 더 작은 값을 지정합니다.
- 기대 값은 `spec/model-adapters.md`의 규칙으로 판단합니다. 규칙이 바뀌면 규격을 먼저 갱신한 뒤 두 언어의 어댑터와 사례를 함께 바꿉니다.

## 실행

- TypeScript: `pnpm --filter @goondan/models test`가 `packages/models/test/fixtures.test.ts`로 모든 사례를 실행합니다.
- Python: `python/goondan/tests/test_models_fixtures.py`가 같은 사례를 실행합니다.
