# tools/agents/

에이전트 위임, 인스턴스 생성/삭제/관리 Tool입니다.

## 역할

- `agents.delegate`: ctx.agents.delegate()를 호출하여 다른 에이전트에 작업을 위임 (async 옵션 지원)
- `agents.spawnInstance`: ctx.agents.spawnInstance()를 호출하여 Turn 실행 없이 인스턴스만 생성
- `agents.delegateToInstance`: ctx.agents.delegateToInstance()를 호출하여 특정 instanceId에 작업 위임 (async 옵션 지원)
- `agents.destroyInstance`: ctx.agents.destroyInstance()를 호출하여 인스턴스 삭제
- `agents.listInstances`: ctx.agents.listInstances()를 호출하여 현재 Swarm 내 에이전트 인스턴스 목록 조회

## 파일

- `tool.yaml`: Tool 리소스 정의 (exports: agents.delegate, agents.spawnInstance, agents.delegateToInstance, agents.destroyInstance, agents.listInstances)
- `index.ts`: Tool 핸들러 구현 (handlers 패턴)

## 참고사항

- 실제 위임/생성/삭제 로직은 ToolContext.agents API에 위임됨
- CLI runtime에서 agents API 콜백을 주입하여 실제 TurnRunner 호출
- Worker mode에서는 Worker -> Main API call로 위임됨
- 입력 검증 후 ctx.agents.* 호출, 결과를 JsonValue 호환 객체로 반환
- `delegate`/`delegateToInstance`의 `async: true` 옵션은 fire-and-forget 패턴 (Turn 비동기 시작, 즉시 반환)
- `spawnInstance`로 인스턴스 생성 → `delegateToInstance`로 반복 작업 위임 → `destroyInstance`로 정리 패턴 지원
