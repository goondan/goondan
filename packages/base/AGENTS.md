# packages/base

`@goondan/base`는 Goondan 런타임이 즉시 사용할 수 있는 기본 Tool/Extension/Connector 묶음을 제공하는 기준 패키지다.

## 존재 이유

- 신규 번들이 최소 설정으로 실행되도록 기본 리소스 구현을 제공한다.
- 스펙 계약의 실전 레퍼런스 구현을 한곳에서 유지한다.

## 구조적 결정

1. 배포는 `gdn package publish` 경로만 사용한다.
이유: npm 패키지가 아니라 goondan 리소스 패키지로 유통되는 자산이기 때문.
2. Tool/Extension/Connector 계약은 각 스펙 문서를 단일 기준으로 따른다.
이유: 런타임과 계약 불일치가 누적되는 것을 막기 위해.
3. 기본 메시지 정책은 tool-call/tool-result 정합성을 보존한다.
이유: 장기 실행에서 대화 상태 붕괴를 방지하기 위해.

## 불변 규칙

- Tool 이름 규칙 `{resource}__{export}`를 유지한다.
- Tool manifest 입력 스키마는 속성 설명(`description`)과 닫힌 스키마(`additionalProperties: false`) 원칙을 기본으로 유지한다.
- `@goondan/base`는 npm publish를 수행하지 않는다.

## 참조

- `docs/specs/tool.md`
- `docs/specs/extension.md`
- `docs/specs/connector.md`
- `docs/specs/connection.md`
- `docs/specs/shared-types.md`
