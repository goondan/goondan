# samples/brain-persona

`brain-persona`는 단일 페르소나를 다중 전문 에이전트 협업으로 구현하는 참조 샘플이다.

## 존재 이유

- 실제 채널(Telegram/Slack)과 멀티 에이전트 조합에서 운영 가능한 패턴을 제공한다.
- coordinator 중심 위임 구조의 안정적 실행 규칙을 검증한다.

## 구조적 결정

1. 외부 입력은 coordinator 단일 진입점으로 통합한다.
이유: 페르소나 일관성과 대화 라우팅 제어를 중앙화하기 위해.
2. 최종 outbound는 채널별 Tool 호출로 수행한다.
이유: 채널 lifecycle 제어와 응답 정책을 명시적으로 다루기 위해.
3. 채널 ingress는 동일 instanceKey 공유 전략을 사용한다.
이유: 채널 간 기억 일관성을 유지하기 위해.
4. 에이전트 간 통신은 Orchestrator IPC를 경유한다(`agents__send`/`agents__request`).
이유: Process-per-Agent 아키텍처에서 크래시 격리와 중앙 관측을 보장하기 위해.
5. 각 에이전트는 독립 AgentProcess로 실행되는 모델을 전제로 한다.
이유: 에이전트 단위 장애 격리와 선택적 재시작 동작을 샘플에서 검증하기 위해.

## 불변 규칙

- 하위 에이전트는 외부 채널에 직접 응답하지 않고 coordinator를 통해 보고한다.
- `coordinator.spec.requiredTools`는 채널 전송 Tool 성공 호출을 강제하도록 유지한다.
- coordinator 프롬프트는 위임 시 `agents__send` 기본 사용 및 필요 시 `agents__catalog` 확인 원칙을 유지한다.
- coordinator Extension 순서는 `message-window -> message-compaction -> context-injector`를 유지한다.
- Extension에서 에이전트 호출이 필요할 때는 `ctx.agents.request/send`(MiddlewareAgentsApi)만 사용하고 Orchestrator IPC 경유를 전제로 한다.
- manifest 변경으로 self-restart가 필요한 turn에서는 `self-restart__request`를 마지막 Tool call로 1회만 호출해 명시적으로 재시작을 요청한다.

## 참조

- `samples/brain-persona/README.md`
- `samples/brain-persona/goondan.yaml`
- `samples/brain-persona/prompts/`
- `docs/wiki/how-to/multi-agent-patterns.md`
