# packages

`packages`는 Goondan 구현체의 배포 단위 패키지를 담는 루트입니다.

## 목적

- `runtime`, `types`, `base`, `cli`, `registry`, `sample` 패키지의 소스/테스트를 관리한다.
- 각 패키지는 스펙(`docs/specs/*.md`)의 소유 범위에 맞는 책임만 구현한다.

## 공통 규칙

1. 패키지별 소스는 `src/`, 테스트는 `test/`에 둔다.
2. 패키지 배포를 지원하는 경우 루트에 `goondan.yaml`(kind: Package)을 두고 CLI publish 입력으로 사용한다.
3. 각 패키지는 독립적으로 `build`, `typecheck`, `test` 스크립트를 제공해야 한다.
4. 타입 단언(`as`, `as unknown as`) 없이 타입 가드/정확한 타입 정의로 구현한다.
5. 공통 타입은 `@goondan/types`를 기준으로 사용하며 중복 정의를 피한다.
6. 스펙 변경 또는 구현 경계 변경이 있으면 루트 `AGENTS.md`와 이 문서를 함께 갱신한다.

## 패키지별 책임 요약

- `runtime`: Orchestrator/AgentProcess 실행 모델, IPC, 파이프라인, 상태/검증, dependency 패키지 리소스 병합 로딩(`dist/goondan.yaml` 우선 / Package Root 경로 기준)
- `types`: 공통 타입 계약(SSOT), 리소스/이벤트/IPC 타입과 유틸리티
- `base`: 기본 Tool/Extension/Connector 구현
- `cli`: `gdn` 운영 인터페이스(run/restart/validate/instance/logs/package/doctor), Optique 기반 type-safe CLI 파서(discriminated union 라우팅, 자동 help/version/completion), package install/publish 파이프라인, `run` startup handshake 기반 오류 표면화/로그 파일 기록, `--instance-key` 미지정 시 Project Root+Package 기반 human-readable 해시 키 사용/동일 키 active runtime resume, runtime runner의 Swarm/Connection/ingress 기반 Connector 실행 + Agent LLM(Tool 포함) 처리 + Telegram 응답 전송, `instance list`의 active runtime 반영(legacy `instances/*` 기본 제외), `instance delete`의 active+workspace 상태 정리 및 pid 검증, `dist/bin.js` 실행 가능 권한 유지
- `registry`: 패키지 유통 API 서버와 메타데이터/아티팩트 저장소
- `sample`: 기능 검증 및 온보딩용 실행 가능한 샘플 패키지 모음
