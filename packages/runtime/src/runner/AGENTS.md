# packages/runtime/src/runner

`runner`는 Goondan 런타임의 AgentProcess 실행 엔트리와 번들 해석-실행 연결 경계를 담당한다.

## 존재 이유

- Orchestrator가 스폰하는 독립 child process(AgentProcess)의 진입점과 Turn 실행 루프를 제공한다.
- 번들 해석 결과를 실제 실행 루프로 연결하고, IPC를 통해 Orchestrator와 통신한다.

## 구조적 결정

1. **agent-runner.ts가 AgentProcess의 진입점이다.** Orchestrator가 fork()로 기동하는 독립 child process.
이유: Process-per-Agent 전환에 따라 에이전트마다 독립 프로세스가 필요하므로 전용 entry point를 둔다.
2. **agent-process-plan.ts가 에이전트별 plan을 빌드한다.** 번들 로드 후 자신에게 할당된 에이전트의 plan만 추출.
이유: AgentProcess는 전체 swarm이 아닌 단일 에이전트만 책임지므로, 필요한 리소스만 추출해 메모리를 절약.
3. 인터-에이전트 통신은 IPC 메시지를 Orchestrator에 전달하여 수행한다 (직접 호출 없음).
이유: 모든 통신이 Orchestrator를 경유해야 관측 가능하고, 순환 호출 감지가 가능하다.
4. IPC 응답 대기는 correlationId 기반 pending 맵으로 구현한다 (`sync`: `pendingResponses`, `async`: `pendingAsyncResponses`).
이유: 블로킹 요청과 async 큐잉 요청의 응답 소비 시점이 다르므로, 요청 모드별로 응답 수명주기를 분리해야 한다.
5. `request(async=true)` 응답은 새 Turn 이벤트가 아니라 inbox 메시지로 처리한다.
이유: 응답 수신 직후의 다음 Step에서 즉시 활용되도록 해야 하며, 다음 Turn까지 지연되면 시맨틱스가 깨진다.

## 불변 규칙

- provider 전용 메시지 정책은 runner 코어가 아니라 Extension 계층에서 처리한다.
- Tool/감시 기반 재기동 신호 해석은 일관된 계약을 유지한다.
- AgentProcess는 shutdown 프로토콜을 준수한다 (drain -> current turn 완료 대기 -> ack -> exit).
- `request(async=true)`로 주입되는 메시지는 `metadata.__goondanInterAgentResponse`를 포함해야 한다.
- 타입 단언(`as`, `as unknown as`) 없이 타입 가드로 처리한다.

## 참조

- `packages/runtime/AGENTS.md`
- `docs/specs/runtime.md`
- `docs/specs/pipeline.md`
