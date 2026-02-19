# packages/runtime/src/orchestrator

`orchestrator`는 Goondan 런타임의 프로세스 매니저로서 AgentProcess 라이프사이클과 IPC 라우팅을 담당한다.

## 존재 이유

- Process-per-Agent 아키텍처의 중앙 허브로서, 에이전트 프로세스의 스폰/감시/재시작과 모든 프로세스 간 통신을 관리한다.
- 에이전트의 turn 실행 로직은 일절 모르며, 이벤트를 올바른 프로세스에 전달할 뿐이다.

## 구조적 결정

1. Orchestrator는 상주 프로세스로서 desired vs actual state를 주기적으로 조정(reconciliation loop)한다.
이유: K8s 컨트롤러 패턴을 차용해 선언적 구성의 실현을 보장.
2. IPC 라우팅은 Orchestrator가 중앙 브로커 역할을 한다 (에이전트 간 직접 통신 없음).
이유: 모든 인터-에이전트 통신을 관측 가능하게 하고, 순환 호출 감지(callChain)를 중앙에서 수행.
3. BunProcessSpawner가 실제 child process fork를 담당하고, Orchestrator는 추상 인터페이스로 의존한다.
이유: 테스트에서 mock spawner를 주입할 수 있도록 분리.
4. pendingRequests Map으로 correlationId 기반 응답 라우팅을 구현한다.
이유: 비동기 request-reply에서 요청자에게 정확히 응답을 전달하기 위해.

## 불변 규칙

- 순환 호출 감지는 callChain 기반으로 Orchestrator 레벨에서 수행한다 (AgentProcess가 아닌 IPC 라우팅 시점).
- crash loop backoff는 exponential backoff를 사용하며, threshold 초과 시 스폰을 중단한다.
- shutdown은 graceful protocol을 따른다 (shutdown 메시지 -> ack 대기 -> grace period 후 kill).

## 참조

- `packages/runtime/AGENTS.md`
- `docs/specs/runtime.md` (Orchestrator vs AgentProcess 책임 분리)
