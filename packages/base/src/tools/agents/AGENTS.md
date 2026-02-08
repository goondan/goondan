# tools/agents/

에이전트 위임 및 인스턴스 관리 Tool입니다.

## 역할

- `agents.delegate`: ctx.agents.delegate()를 호출하여 다른 에이전트에 작업을 위임
- `agents.listInstances`: ctx.agents.listInstances()를 호출하여 현재 Swarm 내 에이전트 인스턴스 목록 조회

## 파일

- `tool.yaml`: Tool 리소스 정의 (exports: agents.delegate, agents.listInstances)
- `index.ts`: Tool 핸들러 구현 (handlers 패턴)

## 참고사항

- 실제 위임 로직은 ToolContext.agents API에 위임됨
- CLI runtime에서 agents API 콜백을 주입하여 실제 TurnRunner 호출
- Worker mode에서는 Worker -> Main API call로 위임됨
- 입력 검증 후 ctx.agents.delegate() 호출, 결과를 JsonValue 호환 객체로 반환
