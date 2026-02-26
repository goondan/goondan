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
7. 코어 텍스트 주입은 0을 원칙으로 하며, Runtime 코어는 시스템 프롬프트 텍스트를 직접 조립/주입하지 않는다.
이유: 실행 엔진과 프롬프트 정책을 분리해 런타임 코어의 책임 경계를 안정적으로 유지하기 위해.
8. Runtime은 Extension 연계를 위한 `ctx.runtime.agent`/`ctx.runtime.swarm`/`ctx.runtime.inbound`/`ctx.runtime.call` 실행 컨텍스트를 제공하며, 프롬프트 본문 자체를 직접 구성하지 않는다.
이유: 정책 변화는 Extension에서 흡수하고, Runtime은 중립적인 실행/연계 기반에 집중하기 위해.
9. Agent `prompt.systemRef` 해석은 Runtime이 담당하고, Extension에는 materialize된 `ctx.runtime.agent.prompt.system`만 전달한다.
이유: Extension이 파일 시스템/리소스 해석 규칙을 중복 소유하지 않도록 하여 코어-확장 책임 경계를 고정하기 위해.
10. ObjectRef 해석 규칙은 `src/config/object-ref.ts`를 단일 기준(SSOT)으로 두고, validate/runtime plan/build 경로가 동일 유틸을 사용한다.
이유: 검증 경로와 실행 경로의 ref 해석 드리프트를 방지하기 위해.

## 불변 규칙

- reconcile 루프 기반 desired state 보정 원칙을 유지한다.
- Tool 실행은 catalog 허용 범위와 입력 스키마 검증을 통과한 호출만 허용한다.
- workspace 식별은 인스턴스 키 기반 결정론적 매핑을 유지한다.
- 모든 RuntimeEvent emit에 TraceContext(traceId/spanId/parentSpanId)와 instanceKey를 포함한다.
- 인터-에이전트 호출 시 traceId는 유지하고 spanId만 새로 생성한다.
- 공개 API는 루트 export 경계에서 관리한다.
- Connector child 프로세스의 stdin은 Orchestrator의 stdin이 읽기 가능할 때(foreground 모드) `pipe`로 전달하고, 불가할 때(detached 모드) `ignore`로 설정한다.
- Connector child가 exit code 0으로 종료하면(startup 이후) in-flight 이벤트 처리를 기다린 뒤 정상 종료로 간주한다.
- Runtime 코어는 시스템 프롬프트 텍스트를 직접 조립·병합·주입하지 않는다.
- 프롬프트 조립/메시지 생성은 Extension 책임이며, Runtime은 `ctx.runtime.agent`/`ctx.runtime.swarm`/`ctx.runtime.inbound`/`ctx.runtime.call` 실행 컨텍스트 전달 외에 텍스트 정책을 소유하지 않는다.
- Runtime은 `prompt.systemRef`를 load/materialize한 결과(`ctx.runtime.agent.prompt.system`)만 Extension에 노출하며, raw ref 값을 컨텍스트로 전달하지 않는다.
- ObjectRef 파싱/정규화 로직을 `runner` 등 상위 계층에서 재구현하지 않는다. (`src/config/object-ref.ts` 재사용)

## 참조

- `docs/specs/runtime.md`
- `docs/specs/pipeline.md`
- `docs/specs/tool.md`
- `docs/specs/workspace.md`
- `docs/specs/bundle.md`
- `docs/specs/shared-types.md` (RuntimeEvent, TraceContext 계약)
