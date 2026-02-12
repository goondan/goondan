# Goondan v2 구현 검증 보고서

작성일: 2026-02-11

## 1. 범위

아래 패키지를 `docs/architecture.md`, `docs/specs/*.md` 기준으로 신규 구현했다.

- `packages/types`
- `packages/runtime`
- `packages/base`
- `packages/cli`
- `packages/registry`

## 2. 검증 루프 기록

### 루프 1: 패키지별 독립 구현/검증

서브에이전트 병렬 구현 후 각 패키지 단위 테스트/타입체크를 완료했다.

- `@goondan/types`: 4 files, 13 tests pass
- `@goondan/runtime`: 5 files, 5 tests pass
- `@goondan/base`: 5 files, 15 tests pass
- `@goondan/cli`: 5 files, 11 tests pass
- `@goondan/registry`: 2 files, 5 tests pass

### 루프 2: 통합 검증

루트에서 전체 검증을 반복 실행했다.

- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm -r test`

초기 통합 단계에서 `@goondan/runtime`의 export 중복(`types.ts` vs `pipeline/registry.ts`, `tools/registry.ts`)을 발견했고, `packages/runtime/src/index.ts` 정밀 export로 보정 후 재검증 통과했다.

### 루프 3: 문서/운영 규칙 정합성

스펙 운영 규칙(`docs/specs/help.md`)의 링크 자동 점검 체크리스트를 실행했고 모두 통과했다.

- 문서 경로 존재 검사: 통과
- 금지 링크 패턴(`@docs/`) 검사: 통과
- `관련 문서` 섹션 존재 검사: 통과
- 섹션 번호 참조(`§n`) 드리프트 검사: 통과

## 3. 스펙-구현 매핑 요약

- `shared-types.md`/`resources.md`: `packages/types/src/*`
  - ObjectRef/ValueSource/MessageEvent/IPC/8 Kind 타입 및 가드/유틸 구현
- `runtime.md`/`pipeline.md`/`workspace.md`: `packages/runtime/src/*`
  - Orchestrator 모델, Reconciliation/Backoff/Shutdown ACK, Pipeline Onion 체인, 이벤트 소싱/JSONL 저장소 구현
- `tool.md`/`extension.md`/`connector.md`/`connection.md`: `packages/base/src/*`
  - 기본 Tool/Extension/Connector 및 매니페스트 헬퍼 구현
- `cli.md`/`bundle_package.md`/`help.md`: `packages/cli/src/*`
  - `run`, `restart`, `validate`, `instance`, `package`, `doctor` 명령 및 오류 포맷 구현
- `bundle_package.md`/`help.md` 레지스트리 계약: `packages/registry/src/*`
  - 메타/버전/tarball/publish/unpublish/deprecate API 및 registry client 구현

## 4. 정합성 보정 내역

- 루트 스크립트의 구 패키지 참조(`@goondan/core`)를 신규 패키지(`@goondan/runtime`, `@goondan/types`, `@goondan/registry`) 기준으로 갱신
- `AGENTS.md`, `docs/specs/AGENTS.md`, `docs/specs/layers.md`, `GUIDE.md`의 계층/패키지 명칭을 실제 구현 구조에 맞게 동기화
- `GUIDE.md` 코드 예시 import 경로를 `@goondan/types`, `@goondan/runtime` 기준으로 갱신

## 5. 최종 상태

전체 워크스페이스 기준 빌드/타입체크/테스트는 모두 통과한다.

- `pnpm -r typecheck`: pass
- `pnpm -r build`: pass
- `pnpm -r test`: pass
