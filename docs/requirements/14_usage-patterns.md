## 14. 활용 예시 패턴

### 14.1 Skill 패턴(Extension 기반)

Skill은 `SKILL.md` 중심 번들을 런타임에 노출하는 Extension 패턴이다.

핵심 동작:

1. 스킬 카탈로그 인덱싱
2. 선택된 스킬 본문 로드
3. 스크립트 실행 연결

권장 미들웨어 활용:

- `step` 미들웨어: `next()` 호출 전에 `ctx.toolCatalog`를 조작하여 스킬 관련 도구 노출을 제어한다. 스킬 카탈로그/본문을 메시지 이벤트로 주입할 수 있다.
- `turn` 미들웨어: 스킬 실행 결과를 Turn 단위로 추적하고 후처리한다.

```typescript
api.pipeline.register('step', async (ctx) => {
  // 스킬 관련 도구를 catalog에 추가
  const skillTools = await loadSkillTools();
  ctx.toolCatalog = [...ctx.toolCatalog, ...skillTools];

  // 스킬 컨텍스트를 메시지로 주입
  const skillContext = await getActiveSkillContext();
  if (skillContext) {
    ctx.emitMessageEvent({
      type: 'append',
      message: createSystemMessage(skillContext),
    });
  }

  return ctx.next();
});
```

### 14.2 ToolSearch 패턴

ToolSearch는 LLM이 "다음 Step에서 필요한 도구"를 선택하도록 돕는 메타 도구다.

규칙:

1. 현재 Catalog를 기반으로 검색/요약해야 한다(MUST).
2. 다음 Step부터 노출할 도구 변경은 `step` 미들웨어의 `ctx.toolCatalog` 조작으로 반영해야 한다(SHOULD).
3. 허용되지 않은 도구를 직접 실행시키는 우회 경로가 되어서는 안 된다(MUST NOT).
4. ToolSearch 결과는 Extension 상태(`api.state`)에 저장하여 다음 Step에서 참조할 수 있도록 하는 것을 권장한다(SHOULD).

```typescript
// ToolSearch 결과를 step 미들웨어에서 반영하는 예시
api.pipeline.register('step', async (ctx) => {
  const state = await api.state.get();
  const selectedTools = state?.selectedTools;

  if (selectedTools) {
    ctx.toolCatalog = ctx.toolCatalog.filter(
      t => selectedTools.includes(t.name)
    );
  }

  return ctx.next();
});
```

### 14.3 컨텍스트 윈도우 최적화 패턴

컨텍스트 윈도우 관리는 `turn` 미들웨어를 통해 구현한다. Extension은 `emitMessageEvent`로 MessageEvent를 발행하여 메시지를 조작한다.

권장 전략:

- sliding window: 오래된 메시지 `remove` 이벤트 발행
- turn 요약(compaction): 복수 메시지를 `remove` 후 요약 메시지 `append`
- 중요 메시지 pinning: `metadata`에 `pinned: true` 표시하여 compaction 대상에서 제외
- truncate: 전체 메시지 초기화 후 요약 `append`

```typescript
api.pipeline.register('turn', async (ctx) => {
  const { nextMessages } = ctx.conversationState;

  // metadata로 "요약 가능" 메시지 식별
  const compactable = nextMessages.filter(
    m => m.metadata['compaction.eligible'] === true
      && m.metadata['pinned'] !== true
  );

  if (compactable.length > 20) {
    const summary = await summarize(compactable);

    // 이벤트 발행으로 메시지 조작 (next() 호출 전 = turn.pre)
    for (const m of compactable) {
      ctx.emitMessageEvent({ type: 'remove', targetId: m.id });
    }
    ctx.emitMessageEvent({
      type: 'append',
      message: createSystemMessage(summary, { 'compaction.summary': true }),
    });
  }

  // Turn 실행
  const result = await ctx.next();

  // next() 호출 후 = turn.post: 결과 후처리
  return result;
});
```

규칙:

1. 메시지 상태는 `base + events` 구조를 유지해야 하며, compaction도 MessageEvent(`replace`/`remove`/`truncate`/`append`)로 표현되어야 한다(MUST).
2. compaction 과정은 traceId 기준으로 추적 가능해야 한다(SHOULD).
3. Turn 종료 시 최종 `base + SUM(events)`가 새 base로 커밋되어 다음 Turn의 시작점이 되어야 한다(MUST).
4. MessageEvent 타입(`append`, `replace`, `remove`, `truncate`) 중 적절한 것을 선택하여 사용해야 한다(MUST).

### 14.4 Handoff 패턴(IPC 기반)

Handoff는 도구 호출로 대상 Agent에 작업을 위임하는 패턴이다. v2에서는 Orchestrator를 경유하는 IPC로 구현한다.

권장 흐름:

1. 원 Agent가 handoff 도구를 호출한다.
2. AgentProcess가 Orchestrator에 IPC `delegate` 메시지를 전송한다.
3. Orchestrator가 대상 AgentProcess로 라우팅한다(필요시 스폰).
4. 대상 Agent가 처리 후 `delegate_result` IPC로 응답한다.
5. Orchestrator가 원 Agent에 결과를 전달한다.

```typescript
// handoff 도구 핸들러 예시
const handlers = {
  delegate: async (ctx: ToolContext, input: JsonObject) => {
    // Orchestrator IPC를 통해 대상 에이전트에 위임
    const result = await ipc.send({
      type: 'delegate',
      from: ctx.agentName,
      to: input.targetAgent as string,
      payload: input.payload,
      correlationId: ctx.turnId,
    });
    return result;
  },
};
```

규칙:

1. handoff 전후 trace 컨텍스트를 `correlationId`로 보존해야 한다(MUST).
2. handoff 실패는 구조화된 ToolResult로 반환해야 한다(MUST).
3. Orchestrator는 대상 AgentProcess가 없으면 자동 스폰해야 한다(MUST).
4. 프로세스 격리를 유지하면서 IPC를 통해서만 통신해야 한다(MUST).
