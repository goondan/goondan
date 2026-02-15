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

- `runtime`: Orchestrator/AgentProcess 실행 모델, IPC, 파이프라인, 상태/검증(Kind별 최소 스키마 + Package 문서 위치 규칙 포함), reconcile 기반 desired state 보정(누락 agent 자동 spawn/불필요 connector 정리), dependency 패키지 리소스 병합 로딩(`dist/goondan.yaml` 우선 / Package Root 경로 기준)
- `types`: 공통 타입 계약(SSOT), 리소스/이벤트/IPC 타입과 유틸리티
- `base`: 기본 Tool/Extension/Connector 구현 (`telegram-polling`의 bot-origin self-feedback 필터 포함)
- `cli`: `gdn` 운영 인터페이스(run/restart/validate/instance/logs/package/doctor), Optique 기반 type-safe CLI 파서(discriminated union 라우팅, 자동 help/version/completion), package install/publish 파이프라인, `run` startup handshake 기반 오류 표면화/로그 파일 기록, `run --watch` 파일 변경 감지 기반 replacement orchestrator 재기동, Connection별 Connector child process 실행+IPC 연동, `config`/`secrets`의 `valueFrom.secretRef` 해석 지원, `.env`/`.env.local`/`--env-file` 우선순위 로딩(기존 env 우선 유지), `--instance-key` 미지정 시 Project Root+Package 기반 human-readable 해시 키 사용/동일 키 active runtime resume, runtime runner의 Swarm/Connection/ingress 기반 Connector 실행 + Agent LLM(Tool 포함) 처리  + `ToolContext.runtime`(agents request/send/spawn/list) 연결 + inbound context 주입 + `Agent.spec.requiredTools` 기반 필수 Tool 호출 강제 + ingress route 기반 inbound instanceKey 오버라이드(`route.instanceKey`/`route.instanceKeyProperty`/`route.instanceKeyPrefix`) + Turn 종료 시 `base.jsonl`에 CoreMessage content(assistant tool_use/user tool_result 포함) 보존, Tool 기반 self-evolution 재시작 신호 감지 시 replacement orchestrator 기동 + active pid 갱신 + self-shutdown 수행, `validate`의 runtime BundleLoader 기반 fail-fast 검증, `instance list`는 active orchestrator(`runtime/active.json`) + 동일 state-root의 managed runtime-runner를 함께 표시(Agent 대화 인스턴스 + legacy `instances/*` 제외), `instance restart`의 최신 runner 바이너리 재기동 + active pid 교체, 인터랙티브 `instance`에서 started 시각 표시로 재시작 확인, `instance delete`는 active 여부와 무관하게 동일 state-root의 managed runtime-runner pid 종료 + workspace 상태 정리 + pid 검증, `dist/bin.js` 실행 가능 권한 유지
- `registry`: 패키지 유통 API 서버와 메타데이터/아티팩트 저장소
- `sample`: 기능 검증 및 온보딩용 실행 가능한 샘플 패키지 모음
