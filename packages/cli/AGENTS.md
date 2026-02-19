# packages/cli

`@goondan/cli`는 Goondan 운영자가 런타임과 패키지 생태계를 제어하는 표준 인터페이스(`gdn`)를 제공한다.

## 존재 이유

- 실행/검증/관측/패키지 유통 워크플로를 단일 진입점으로 통합한다.
- 런타임 운영 절차를 재현 가능하고 자동화 가능한 형태로 고정한다.

## 구조적 결정

1. CLI는 런타임을 관리형 프로세스로 다루고 lifecycle을 명시적으로 제어한다.
이유: 실행 안정성과 장애 복구 절차를 예측 가능하게 만들기 위해.
2. 명령 파싱/라우팅은 타입 안전한 명령 모델(Optique 기반)을 유지한다.
이유: 명령 확장 시 회귀 위험을 줄이고 오류 표면을 일관화하기 위해.
3. Studio service는 RuntimeEvent의 TraceContext(traceId/spanId/parentSpanId)를 기반으로 trace -> span 트리를 구성한다.
이유: 휴리스틱 기반 추론 대신 구조화된 OTel 호환 데이터로 인과 관계를 정확히 표현하기 위해.
4. `restart --agent`은 Orchestrator IPC를 통해 특정 에이전트만 선택적으로 재시작한다.
이유: Process-per-Agent 전환으로 에이전트별 독립 재시작이 가능해짐.
5. `logs`는 `--agent`, `--trace` 필터링을 지원해 에이전트별/trace별 관측을 제공한다.
이유: 멀티 에이전트 환경에서 특정 에이전트나 특정 실행 체인의 로그만 조회해야 디버깅이 가능.

## 불변 규칙

- `run`의 인스턴스 식별은 `Swarm.spec.instanceKey ?? Swarm.metadata.name` 규칙을 유지한다.
- `run`/`runtime-runner`는 로컬 `kind: Package` + `metadata.name` 문서를 필수로 요구한다.
- 인스턴스 관리 명령은 managed runtime-runner 기준으로 동작한다.
- 오류 출력은 구조화 정보(`code`, `message`, `suggestion`, `helpUrl`)를 유지한다.
- npm 공개 배포 대상 정책(`publishConfig.access = "public"`)을 유지한다.
- Studio의 인과 관계 구성에 routeState 휴리스틱을 사용하지 않는다 -- TraceContext가 SSOT.

## 참조

- `docs/specs/cli.md`
- `docs/specs/runtime.md`
- `docs/specs/api.md` (섹션 9: Studio가 소비하는 계약)
- `docs/specs/bundle_package.md`
- `docs/specs/help.md`
- `packages/runtime/AGENTS.md`
