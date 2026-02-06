# tools/http-fetch - HTTP 요청 도구

Node.js 내장 fetch API를 사용한 HTTP GET/POST 요청 도구입니다.

## 파일 구성

- `tool.yaml`: Tool 리소스 정의 (http.get, http.post export)
- `index.ts`: Tool 핸들러 구현

## exports

| 이름 | 설명 |
|------|------|
| `http.get` | HTTP GET 요청 실행 |
| `http.post` | HTTP POST 요청 실행 |

## 주요 특징

- fetch API 기반으로 외부 라이브러리 불필요
- AbortController를 사용한 타임아웃 처리
- 응답 본문 100KB 초과 시 자동 truncation
- `as` 타입 단언 사용하지 않음

## 수정 시 주의사항

1. 타입 단언(`as`) 금지 - 타입 가드로 해결
2. handlers 객체의 키는 tool.yaml의 exports[].name과 일치해야 함
3. 모든 핸들러는 `(ctx: ToolContext, input: JsonObject) => Promise<JsonValue>` 시그니처
