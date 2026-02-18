# Proposal: Extension에서 Agent 호출 API

> Extension 미들웨어가 다른 에이전트를 프로그래매틱하게 호출할 수 있는 API 제안

---

## 1. 현재 시스템 이해

### Extension API (v0.0.3)

Extension은 `register(api: ExtensionApi)` 패턴으로 등록되며, 5개 API 영역을 제공받습니다:

```typescript
interface ExtensionApi {
  pipeline: PipelineRegistry;   // turn / step / toolCall 미들웨어 등록
  tools: ExtensionToolsApi;     // 동적 도구 등록
  state: ExtensionStateApi;     // 인스턴스별 영속 JSON 상태
  events: ExtensionEventsApi;   // 프로세스 내 이벤트 pub/sub
  logger: Console;              // 구조화 로깅
}
```

### 에이전트 간 통신 (현재)

에이전트 간 통신은 **IPC 기반 이벤트**를 통해 **Orchestrator를 경유**해서만 가능합니다. 모든 통신은 `@goondan/base`의 `agents` Tool을 통해 이루어지며, 이 Tool은 **LLM이 호출**합니다:

| Tool | 패턴 | 사용 주체 |
|------|------|-----------|
| `agents__request` | 동기 요청-응답 | LLM (tool call) |
| `agents__send` | 비동기 fire-and-forget | LLM (tool call) |
| `agents__spawn` | 인스턴스 사전 준비 | LLM (tool call) |

```
AgentProcess A ──(LLM tool call)──> agents__request ──(IPC)──> Orchestrator ──> AgentProcess B
```

### 한계

Extension 미들웨어는 다음을 할 수 **있습니다**:
- 메시지를 주입/제거/교체 (`emitMessageEvent`)
- 도구 카탈로그를 필터링 (`ctx.toolCatalog`)
- 상태를 영속화 (`api.state`)
- 이벤트를 발행/구독 (`api.events`, 프로세스 내 범위)

Extension 미들웨어가 할 수 **없는** 것:
- **다른 에이전트를 호출하는 것** — Extension은 AgentProcess 내부에서 실행되지만, Orchestrator IPC에 접근할 수 없습니다
- Tool 핸들러를 프로그래매틱하게 실행하는 것 — Tool은 LLM의 tool call에 의해서만 실행됩니다

---

## 2. 필요한 이유

### 사용 사례: 뇌 기능 모방 멀티 에이전트 시스템

인간의 뇌에는 "의식적 행동"과 "무의식적/자동적 처리"가 구분됩니다:

| 뇌 기능 | 특성 | 해당 시점 |
|---------|------|-----------|
| **무의식적 맥락 로드** | 의식(Worker LLM)이 인지하기 전에 관련 기억을 자동으로 활성화 | turn.pre |
| **자동 관측** | 행동 후 자동으로 3인칭 관점에서 관측 기록 | turn.post |

이 두 기능은 모두 **LLM 추론이 필요**합니다:

- **무의식**: qmd로 키워드 검색 → LLM이 결과를 리랭킹하여 관련 맥락 선별
- **관측**: Turn의 행동 데이터를 LLM이 3인칭 관점으로 재구성하여 의미 있는 관측만 저장

그러나 이 처리는 Worker LLM이 "의식적으로" 호출해서는 안 됩니다:
- Worker가 `agents__request(unconscious, ...)` 를 호출하면, 그것은 이미 "의식적" 행동입니다
- 무의식과 관측은 Worker의 인지 밖에서 자동으로 이루어져야 합니다

**현재 API로는 이것이 불가능합니다.** Extension 미들웨어(turn.pre/turn.post)에서 에이전트를 호출할 수 있어야만 구현할 수 있습니다.

### 일반화된 유스케이스

이 기능은 뇌 모방 시스템에 국한되지 않습니다:

1. **Turn 전 자동 맥락 보강** — 외부 에이전트가 검색/분석한 맥락을 Turn 시작 전에 주입
2. **Turn 후 자동 감사/분석** — 에이전트의 행동을 다른 에이전트가 분석하여 품질 관리
3. **자동 번역/변환** — 입력/출력을 다른 에이전트가 자동으로 전처리/후처리
4. **가드레일** — Turn 전에 안전성 에이전트가 입력을 검증

---

## 3. 제안: `ctx.agents` API

### 3.1 미들웨어 컨텍스트에 `agents` 추가

Turn 및 Step 미들웨어 컨텍스트에 `agents` 프로퍼티를 추가합니다:

```typescript
interface TurnMiddlewareContext extends ExecutionContext {
  // ... 기존 필드 ...

  /** 다른 에이전트를 프로그래매틱하게 호출 */
  readonly agents: MiddlewareAgentsApi;
}

interface StepMiddlewareContext extends ExecutionContext {
  // ... 기존 필드 ...

  /** 다른 에이전트를 프로그래매틱하게 호출 */
  readonly agents: MiddlewareAgentsApi;
}
```

### 3.2 MiddlewareAgentsApi 인터페이스

```typescript
interface MiddlewareAgentsApi {
  /**
   * 동기 요청-응답.
   * 대상 에이전트의 Turn이 완료될 때까지 대기하고 결과를 반환합니다.
   * agents__request Tool과 동일한 라우팅 규칙을 따릅니다.
   */
  request(params: AgentRequestParams): Promise<AgentRequestResult>;

  /**
   * 비동기 fire-and-forget.
   * 이벤트를 Orchestrator에 전달하고 즉시 반환합니다.
   * agents__send Tool과 동일한 라우팅 규칙을 따릅니다.
   */
  send(params: AgentSendParams): Promise<AgentSendResult>;
}

interface AgentRequestParams {
  /** 대상 에이전트 이름 */
  target: string;
  /** 전달할 메시지 */
  input?: string;
  /** 대상 인스턴스 키 (기본값: 호출자의 instanceKey) */
  instanceKey?: string;
  /** 타임아웃 (밀리초, 기본값: 15000) */
  timeoutMs?: number;
  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>;
}

interface AgentSendParams {
  /** 대상 에이전트 이름 */
  target: string;
  /** 전달할 메시지 */
  input?: string;
  /** 대상 인스턴스 키 (기본값: 호출자의 instanceKey) */
  instanceKey?: string;
  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>;
}

interface AgentRequestResult {
  /** 대상 에이전트 이름 */
  target: string;
  /** 대상의 응답 텍스트 */
  response: string;
}

interface AgentSendResult {
  /** 이벤트 전달 수락 여부 */
  accepted: boolean;
}
```

### 3.3 사용 예시

#### 무의식 맥락 로드 (turn.pre)

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn', async (ctx) => {
    // turn.pre: 무의식 에이전트에게 맥락 요청
    const { response } = await ctx.agents.request({
      target: 'unconscious',
      input: extractUserMessage(ctx.inputEvent),
      timeoutMs: 10000,
    });

    // 맥락을 시스템 메시지로 주입
    if (response) {
      ctx.emitMessageEvent({
        type: 'append',
        message: {
          id: createId('unconscious'),
          data: { role: 'system', content: response },
          metadata: { 'unconscious-loader.injected': true },
          createdAt: new Date(),
          source: { type: 'extension', extensionName: 'unconscious-loader' },
        },
      });
    }

    // Worker의 실제 Turn 실행
    const result = await ctx.next();

    // turn.post: 관측 에이전트에게 행동 데이터 전송 (fire-and-forget)
    await ctx.agents.send({
      target: 'observer',
      input: buildObservationInput(ctx, result),
    });

    return result;
  });
}
```

#### 자동 가드레일 (turn.pre)

```typescript
api.pipeline.register('turn', async (ctx) => {
  const { response } = await ctx.agents.request({
    target: 'safety-checker',
    input: extractUserMessage(ctx.inputEvent),
    timeoutMs: 5000,
  });

  if (response.includes('BLOCKED')) {
    // Turn 실행 없이 즉시 종료
    return { turnId: ctx.turnId, finishReason: 'text_response', responseMessage: ... };
  }

  return ctx.next();
});
```

---

## 4. 구현 고려사항

### 4.1 Orchestrator IPC 경유

기존 아키텍처와 일관성을 유지하기 위해, `ctx.agents.request/send`는 기존 `agents__request/send` Tool과 **동일한 IPC 경로**를 사용해야 합니다:

```
Extension middleware
  → ctx.agents.request(params)
    → AgentProcess IPC → Orchestrator → 대상 AgentProcess
    → 대상 Turn 완료 → Orchestrator → 응답 반환
  → Extension이 결과 수신
```

차이점은 호출 주체뿐입니다:
- 기존: LLM의 tool call → ToolHandler → IPC
- 제안: Extension middleware → `ctx.agents` → IPC

### 4.2 실행 순서와 교착 방지

Turn 미들웨어에서 다른 에이전트를 `request`로 호출하면, 현재 Turn은 대상 에이전트의 Turn이 완료될 때까지 **일시 중지**됩니다.

주의사항:
- **순환 호출 금지**: A의 turn.pre에서 B를 request → B의 turn.pre에서 A를 request → 교착 상태
- Orchestrator가 순환 감지를 수행하고 에러를 반환해야 합니다
- `timeoutMs`로 최대 대기 시간 설정 (기본값 15000ms)

### 4.3 ToolCall 미들웨어에서의 사용

`toolCall` 미들웨어에서는 `agents`를 제공하지 않는 것을 권장합니다:
- 도구 호출 단위에서 에이전트 호출은 성능 위험이 큼
- 필요하다면 `step` 미들웨어에서 수행

### 4.4 LLM 비가시성

`ctx.agents`를 통한 호출은 **LLM의 tool call 히스토리에 나타나지 않습니다**. 이는 의도된 설계입니다:
- LLM은 Extension이 주입한 맥락만 볼 뿐, 그것이 다른 에이전트에서 왔다는 것을 알 필요 없음
- "무의식" 패턴의 핵심 — 의식(LLM)은 결과만 받고, 과정은 모름

### 4.5 자동 스폰

기존 `agents__request/send`와 동일하게, 대상 에이전트 인스턴스가 없으면 Orchestrator가 자동 스폰합니다.

### 4.6 메타데이터 전파

`ctx.agents.request/send`의 `metadata` 파라미터를 통해 호출 맥락을 전달할 수 있습니다. 기본적으로 다음이 자동 포함됩니다:

```typescript
{
  callerAgent: ctx.agentName,
  callerInstanceKey: ctx.instanceKey,
  callerTurnId: ctx.turnId,
  callSource: 'extension-middleware',  // LLM tool call과 구분
}
```

---

## 5. 대안 검토

### 대안 A: Extension이 직접 파일 I/O로 처리

- 무의식: Bun fs + `Bun.spawn('qmd', ...)` 로 검색, Extension 내에서 직접 처리
- 관측: Extension이 직접 파일에 기록
- **한계**: LLM 추론이 필요한 작업(리랭킹, 3인칭 관측)은 Extension 단독으로 불가능

### 대안 B: 동적 도구 등록 + LLM 유도

- Extension이 `unconscious__load`, `observer__record` 같은 도구를 동적 등록
- 프롬프트로 LLM이 이 도구를 호출하도록 유도
- **한계**: LLM의 "의식적" 호출이 되어 무의식/자동 관측의 설계 의도에 어긋남

### 대안 C: `api.events`를 프로세스 간으로 확장

- 현재 프로세스 내(in-process) 범위인 events를 Orchestrator 경유 프로세스 간으로 확장
- **한계**: 요청-응답 패턴을 이벤트 모델에 맞추는 것이 부자연스러움

### 결론

**대안들은 모두 한계가 있으며**, `ctx.agents` API가 가장 자연스럽고 기존 아키텍처와 일관성 있는 해결책입니다.

---

## 6. 요약

| 항목 | 내용 |
|------|------|
| **문제** | Extension 미들웨어에서 다른 에이전트를 호출할 수 없음 |
| **영향** | turn.pre/turn.post에서 LLM 기반 전처리/후처리가 불가능 |
| **제안** | `TurnMiddlewareContext`와 `StepMiddlewareContext`에 `agents: MiddlewareAgentsApi` 추가 |
| **API** | `ctx.agents.request()` (동기), `ctx.agents.send()` (비동기) |
| **구현** | 기존 IPC 경로 재사용, Orchestrator 경유 |
| **주의** | 순환 호출 감지 필요, toolCall 컨텍스트에서는 미제공 권장 |
