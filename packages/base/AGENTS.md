# packages/base

`@goondan/base` 패키지는 Goondan v2 런타임에서 바로 사용할 수 있는 기본 Tool/Extension/Connector 구현과 리소스 샘플 매니페스트를 제공한다.

## 책임 범위

- Tool 기본 구현: `bash`, `file-system`, `agents`
- Extension 기본 구현: `logging`, `compaction`, `tool-search`
- Connector 기본 구현: `cli`, `webhook`, `telegram-polling`
- 리소스 매니페스트 헬퍼: Tool/Extension/Connector/Connection 샘플 생성
- `vitest` 기반 단위 테스트

## 구현 기준

1. `docs/specs/tool.md`, `docs/specs/extension.md`, `docs/specs/connector.md`, `docs/specs/connection.md` 계약을 우선 반영한다.
2. 공통 타입 계약은 `docs/specs/shared-types.md`를 따른다.
3. Tool 이름 규칙은 `{resource}__{export}`를 유지한다.
4. 타입 단언(`as`, `as unknown as`) 없이 타입 가드와 정확한 타입 정의로 구현한다.
5. 테스트는 네트워크 의존 없이 로컬 재현 가능해야 한다.

## 디렉토리 가이드

- `src/types.ts`: base 패키지의 공통 타입 및 가드
- `src/tools/*`: Tool 핸들러 구현 (`handlers` export)
- `src/extensions/*`: Extension 등록 함수 및 미들웨어
- `src/connectors/*`: Connector entry/skeleton 예시
- `src/manifests/*`: 샘플 리소스 생성 헬퍼
- `test/*`: Tool/Extension 동작 검증 테스트
