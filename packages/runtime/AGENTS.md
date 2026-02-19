# packages/runtime

`@goondan/runtime`은 Process-per-Agent 실행 모델의 Orchestrator와 AgentProcess, 상태 저장, 파이프라인, Tool 실행, 리소스 로딩의 코어를 담당한다.

## 존재 이유

- 선언형 번들을 실제 실행 상태로 변환하고 유지하는 런타임 엔진을 제공한다.
- 에이전트별 독립 프로세스 격리와 IPC 기반 인터-에이전트 통신을 구현한다.
- 메시지 상태와 OTel 호환 관측 이벤트를 일관된 모델로 영속화한다.

## 구조적 결정

1. **Process-per-Agent가 유일한 실행 모델이다** (in-process 모델은 제거됨).
이유: Self-modification, 크래시 격리, 선택적 restart에 필수. Orchestrator가 AgentProcess를 child process로 스폰한다.
2. **Orchestrator = 프로세스 매니저, AgentProcess = 실행 엔진**으로 역할이 분리되어 있다.
이유: 이전 Runtime Runner가 "에이전트 실행"과 "프로세스 관리"를 모두 맡아 이중 구현의 근원이 됐었음.
3. 대화 상태는 event-sourcing(`base/events`) 모델을 사용하고 관측 스트림(`runtime-events`)을 분리한다.
이유: 상태 복원과 관측성 요구를 분리해 신뢰성과 디버깅 성능을 동시에 확보하기 위해.
4. 확장 지점은 turn/step/toolCall 미들웨어 파이프라인으로 통일한다.
이유: 런타임 코어 수정 없이 정책/동작 확장을 가능하게 하기 위해.
5. RuntimeEvent 타입 계약은 `@goondan/types`가 소유하고, 이 패키지는 re-export + EventBus 구현만 담당한다.
이유: SSOT 원칙. Studio/CLI가 계약 수준에서만 결합하도록.
6. 인터-에이전트 통신은 Orchestrator IPC를 경유하며, correlationId 기반 응답 라우팅과 callChain 기반 순환 호출 감지를 지원한다.
이유: 직접 함수 호출 대신 IPC를 경유해야 관측 가능하고, 순환 호출로 인한 deadlock을 방지할 수 있다.

## 불변 규칙

- reconcile 루프 기반 desired state 보정 원칙을 유지한다.
- Tool 실행은 catalog 허용 범위와 입력 스키마 검증을 통과한 호출만 허용한다.
- workspace 식별은 인스턴스 키 기반 결정론적 매핑을 유지한다.
- 모든 RuntimeEvent emit에 TraceContext(traceId/spanId/parentSpanId)와 instanceKey를 포함한다.
- 인터-에이전트 호출 시 traceId는 유지하고 spanId만 새로 생성한다.
- 공개 API는 루트 export 경계에서 관리한다.

## 참조

- `docs/specs/runtime.md`
- `docs/specs/pipeline.md`
- `docs/specs/tool.md`
- `docs/specs/workspace.md`
- `docs/specs/bundle.md`
- `docs/specs/shared-types.md` (RuntimeEvent, TraceContext 계약)
