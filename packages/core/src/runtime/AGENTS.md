# Runtime 모듈

Goondan Runtime 실행 모델을 구현합니다.

## 스펙 문서

- `/docs/specs/runtime.md` - Runtime 실행 모델 스펙

## 디렉토리 구조

```
runtime/
├── types.ts              # Runtime 타입 (LlmMessage, ToolCall, MessageEvent, Observability 등)
├── swarm-instance.ts     # SwarmInstance, SwarmInstanceManager, SwarmInstanceInfo
├── agent-instance.ts     # AgentInstance 클래스, AgentEventQueue
├── turn-runner.ts        # Turn 실행 로직, TurnRunner, TurnMetrics
├── step-runner.ts        # Step 실행 로직, StepRunner
├── effective-config.ts   # EffectiveConfig 계산, normalizeByIdentity
├── message-builder.ts    # LLM 메시지 빌더 (MessageEvent 기반)
├── persistence.ts        # Workspace persistence 바인딩 (messageState/extension state)
└── index.ts              # 모든 기능 re-export
```

## 핵심 개념

### 실행 계층

```
Runtime
└── SwarmInstance (long-running, instanceKey로 라우팅)
    └── AgentInstance (Agent별 이벤트 큐, 상태 관리)
        └── Turn (하나의 입력 이벤트 처리)
            └── Step (LLM 호출 1회 단위)
```

### SwarmInstance

- Swarm 정의를 바탕으로 생성되는 long-running 실행체
- `instanceKey`로 동일 맥락을 같은 인스턴스로 라우팅
- `activeSwarmBundleRef`로 현재 활성 Bundle 스냅샷 식별
- 상태: `active` | `idle` | `paused` | `terminated`
- **SwarmInstanceManager**: `getOrCreate`, `get`, `terminate`, `inspect`, `pause`, `resume`, `delete`, `list`
- **SwarmInstanceLifecycleHooks** (선택): pause/resume/terminate/delete 시 metadata 갱신 훅 연결
- **SwarmInstanceInfo**: inspect/list 결과용 DTO (id, instanceKey, swarmRef, status, agentNames 등)
- `pause()`: 새 Turn 실행을 중단시킴 (MUST: paused 상태에서는 새 Turn 실행 불가)
- `resume()`: paused 상태에서만 호출 가능, active로 전환
- `delete()`: 인스턴스 상태 제거 (시스템 전역 상태 보존)

### AgentInstance

- Agent 정의를 바탕으로 생성
- 이벤트 큐 (FIFO 순서 처리)
- Extension별 상태 저장소 (`extensionStates`)
- 공유 상태 (`sharedState`)
- **대화 히스토리** (`conversationHistory`): Turn 간 LlmMessage 누적, 다음 Turn에서 baseMessages로 전달

### Turn

- 하나의 입력 이벤트 처리 단위
- **traceId**: Turn마다 생성, Step/ToolCall/Event 로그로 전파
- `origin`과 `auth`는 Turn 생애주기 동안 불변
- `turn.pre`/`turn.post` Mutator 파이프라인 실행
- **messageState** (TurnMessageState): `baseMessages` + `events` -> `nextMessages` (핵심 공식)
- `messages` 필드: messageState.nextMessages에 대한 편의 별칭 (@deprecated)
- **metrics** (TurnMetrics): latencyMs, stepCount, toolCallCount, errorCount, tokenUsage
- `maxStepsPerTurn` 정책 적용
- Turn 완료 시 nextMessages가 AgentInstance.conversationHistory에 저장되어 다음 Turn으로 전달
- (선택) `messageStateLogger` 연결 시 Turn 종료 시점에 events/base 로그 반영 후 events clear 수행
  - **Delta Append**: mutation 없는 일반 Turn → `appendDelta()`로 새 메시지만 추가
  - **Rewrite**: replace/remove/truncate mutation 발생 시 → `rewrite()`로 전체 파일 재기록
- (선택) `messageStateRecovery` 연결 시 Turn 시작 시점에 base+events 복구 후 초기 baseMessages 구성
- paused 상태의 SwarmInstance에서 Turn 실행 시 `interrupted` 상태로 즉시 반환

### Step

- LLM 호출 1회를 중심으로 한 단위
- Step 시작 시 `SwarmBundleRef`와 `EffectiveConfig` 고정
- 실행 순서: pre → config → tools → blocks → llmInput → llmCall → toolExec → post
- `toolCall.pre`/`toolCall.post` Mutator 및 `toolCall.exec` Middleware 실행
- LLM 응답과 Tool 결과를 MessageEvent로 기록, nextMessages 재계산

## 주요 타입

### LlmMessage

```typescript
type LlmMessage =
  | LlmSystemMessage  // { id, role: 'system', content: string }
  | LlmUserMessage    // { id, role: 'user', content: string, attachments? }
  | LlmAssistantMessage // { id, role: 'assistant', content?, toolCalls? }
  | LlmToolMessage;   // { id, role: 'tool', toolCallId, toolName, output }
```

- 모든 LlmMessage는 `readonly id: string` 필드를 가짐

### TurnMessageState

```typescript
interface TurnMessageState {
  baseMessages: LlmMessage[];  // 이전 Turn에서 가져온 기준 메시지
  events: MessageEvent[];       // 메시지 변경 이벤트
  nextMessages: LlmMessage[];   // 계산된 최종 메시지 (= fold(base, events))
}
```

- 핵심 공식: `NextMessages = BaseMessages + SUM(Events)`
- `computeNextMessages()` 함수로 재계산

### MessageEvent

```typescript
type MessageEvent =
  | SystemMessageEvent   // { type: 'system_message', message }
  | LlmMessageEvent      // { type: 'llm_message', message }
  | ReplaceEvent         // { type: 'replace', targetId, message }
  | RemoveEvent          // { type: 'remove', targetId }
  | TruncateEvent;       // { type: 'truncate' }
```

- 타입 가드 함수: `isSystemMessageEvent`, `isLlmMessageEvent`, `isReplaceMessageEvent`, `isRemoveMessageEvent`, `isTruncateMessageEvent`

### ToolCall / ToolResult

- `ToolCall`: `{ id, name, args }` (args는 JsonObject)
- `ToolResult`: `{ toolCallId, toolName, status: 'ok'|'error'|'pending', output?, error? }`

### LlmResult

```typescript
interface LlmResult {
  message: LlmAssistantMessage;
  meta: {
    usage?: { promptTokens, completionTokens, totalTokens };
    model?: string;
    finishReason?: string;
  };
}
```

### TurnOrigin / TurnAuth

- `TurnOrigin`: 호출 맥락 (connector, channel, threadTs 등)
- `TurnAuth`: 인증 컨텍스트 (actor, subjects)
- 에이전트 간 handoff 시 변경 없이 전달되어야 함

### Observability 타입

- `TokenUsage`: promptTokens, completionTokens, totalTokens
- `StepMetrics`: latencyMs, toolCallCount, errorCount, tokenUsage
- `TurnMetrics`: latencyMs, stepCount, toolCallCount, errorCount, tokenUsage
- `RuntimeLogEntry`: timestamp, level, event, traceId, context, data, error
- `HealthCheckResult`: status (healthy/degraded/unhealthy), activeInstances, activeTurns, components
- `InstanceGcPolicy`: ttlMs, idleTimeoutMs, checkIntervalMs

### 민감값 마스킹

- `maskSensitiveValue(value)`: 앞 4자만 노출 + "****"
- `isSensitiveKey(key)`: token/secret/password/credential/api_key 패턴 검사
- `maskSensitiveFields(obj)`: 재귀적으로 민감 필드 마스킹

### EffectiveConfig

- Step에서 사용할 최종 구성
- swarm, agent, model, tools, extensions, connections, systemPrompt 포함
- `normalizeByIdentity`로 중복 처리 (last-wins)

## 개발 규칙

1. **타입 단언 금지**: `as` 사용 금지, 타입 가드와 정확한 타입 정의로 해결
2. **에러 처리**: Tool 실행 오류는 `ToolResult.error`로 변환 (예외 전파 금지)
3. **불변성**: `origin`, `auth`는 Turn 생애주기 동안 불변
4. **Step 고정**: Step 시작 후 `SwarmBundleRef`와 `EffectiveConfig` 변경 불가
5. **메시지 모델**: Turn.messages 직접 push 금지, MessageEvent 기반으로 추가 후 nextMessages 재계산

## 의존성

- `types/` - Resource, ObjectRef, JsonValue 등 기본 타입
- `types/specs/` - AgentSpec, SwarmSpec, ModelSpec 등 Kind별 스펙

## 테스트

```bash
pnpm test -- __tests__/runtime/
```

## 구현 상태

- [x] types.ts - LlmMessage (id 추가), ToolCall (args), MessageEvent, TurnMessageState, Observability, 마스킹
- [x] swarm-instance.ts - SwarmInstance, SwarmInstanceManager (inspect/pause/resume/delete + lifecycle hooks), SwarmInstanceInfo
- [x] agent-instance.ts - AgentInstance, AgentEventQueue
- [x] turn-runner.ts - Turn (traceId, messageState, metrics), TurnRunner (turn.pre/post + messageState 로그 반영 훅)
- [x] step-runner.ts - Step, StepRunner (step.config 선행 active ref 확정 + step.pre/step/toolCall 파이프라인 + llmInput + catalog outside 거부)
- [x] effective-config.ts - EffectiveConfig (connections 포함), EffectiveConfigLoader
- [x] message-builder.ts - MessageBuilder (MessageEvent 기반), buildLlmMessages
- [x] persistence.ts - WorkspaceManager 기반 messageState logger/recovery + Extension state store 주입 바인딩
