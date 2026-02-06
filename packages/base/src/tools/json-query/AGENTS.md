# tools/json-query - JSON 쿼리/변환 도구

JSONPath 기반 데이터 추출과 변환 기능을 제공하는 도구입니다.

## 파일 구성

- `tool.yaml`: Tool 리소스 정의 (json.query, json.transform export)
- `index.ts`: Tool 핸들러 구현

## exports

| 이름 | 설명 |
|------|------|
| `json.query` | JSONPath 표현식으로 데이터 추출 |
| `json.transform` | 데이터 변환 (pick, omit, flatten, keys, values, entries, merge) |

## JSONPath 지원 범위

- `$.field` - 필드 접근
- `$.parent.child` - 중첩 접근
- `$.array[0]` - 배열 인덱스
- `$.array[*]` - 배열 전체 요소
- `$.array[*].field` - 배열 전체 요소의 필드

## 수정 시 주의사항

1. 타입 단언(`as`) 금지 - 타입 가드로 해결
2. 외부 라이브러리 사용 금지 - 자체 JSONPath 파서 사용
3. handlers 객체의 키는 tool.yaml의 exports[].name과 일치해야 함
