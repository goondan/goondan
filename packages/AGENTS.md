# packages

`packages`는 Goondan 구현체의 배포 단위 패키지를 담는 루트입니다.

## 목적

- `runtime`, `types`, `base`, `cli`, `registry` 패키지의 소스/테스트를 관리한다.
- 각 패키지는 스펙(`docs/specs/*.md`)의 소유 범위에 맞는 책임만 구현한다.

## 공통 규칙

1. 패키지별 소스는 `src/`, 테스트는 `test/`에 둔다.
2. 각 패키지는 독립적으로 `build`, `typecheck`, `test` 스크립트를 제공해야 한다.
3. 타입 단언(`as`, `as unknown as`) 없이 타입 가드/정확한 타입 정의로 구현한다.
4. 공통 타입은 `@goondan/types`를 기준으로 사용하며 중복 정의를 피한다.
5. 스펙 변경 또는 구현 경계 변경이 있으면 루트 `AGENTS.md`와 이 문서를 함께 갱신한다.

## 패키지별 책임 요약

- `runtime`: Orchestrator/AgentProcess 실행 모델, IPC, 파이프라인, 상태/검증
- `types`: 공통 타입 계약(SSOT), 리소스/이벤트/IPC 타입과 유틸리티
- `base`: 기본 Tool/Extension/Connector 구현
- `cli`: `gdn` 운영 인터페이스(run/restart/validate/instance/package/doctor)
- `registry`: 패키지 유통 API 서버와 메타데이터/아티팩트 저장소
