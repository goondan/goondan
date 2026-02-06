# text-transform Tool

텍스트 변환 도구 (템플릿 렌더링, 정규식 매칭/치환, 포맷 변환).

## exports

- `text.template`: Mustache-like 템플릿 렌더링 ({{변수}}, {{#조건}}, {{^반전}})
- `text.regex`: 정규식 매칭(match), 치환(replace), 존재 확인(test)
- `text.format`: 포맷 변환 (JSON <-> YAML <-> CSV)

## 구현 상세

- 외부 라이브러리 없이 순수 구현
- `text.template`: {{key}} 치환, {{#key}}...{{/key}} 조건부 섹션, {{^key}}...{{/key}} 반전 섹션, 배열 반복
- `text.regex`: 안전한 RegExp 생성, 플래그 검증 (g, i, m, s, u, y)
- `text.format`: 간단한 YAML 파서/직렬화, CSV 파서/직렬화 (RFC 4180 기반 따옴표 이스케이프)

## 작성 규칙

- `as` 타입 단언 금지
- `@goondan/core`에서 `ToolHandler`, `ToolContext`, `JsonValue`, `JsonObject` import
- `handlers` 객체를 export
