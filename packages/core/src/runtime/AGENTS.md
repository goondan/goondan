# Runtime 모듈

Goondan Runtime 실행 모델을 구현합니다.

## 스펙 문서

- `/docs/specs/runtime.md` - Runtime 실행 모델 스펙

## 디렉토리 구조

```
runtime/
├── types.ts              # Runtime 타입 (LlmMessage, ToolCall, TurnOrigin 등)
├── swarm-instance.ts     # SwarmInstance 클래스, SwarmInstanceManager
├── agent-instance.ts     # AgentInstance 클래스, AgentEventQueue
├── turn-runner.ts        # Turn 실행 로직, TurnRunner
├── step-runner.ts        # Step 실행 로직, StepRunner
├── effective-config.ts   # EffectiveConfig 계산, normalizeByIdentity
├── message-builder.ts    # LLM 메시지 빌더
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

### AgentInstance

- Agent 정의를 바탕으로 생성
- 이벤트 큐 (FIFO 순서 처리)
- Extension별 상태 저장소 (`extensionStates`)
- 공유 상태 (`sharedState`)
- **대화 히스토리** (`conversationHistory`): Turn 간 LlmMessage 누적, 다음 Turn에서 이전 대화 맥락으로 프리펜드

### Turn

- 하나의 입력 이벤트 처리 단위
- `origin`과 `auth`는 Turn 생애주기 동안 불변
- `messages` 배열에 LLM 응답과 Tool 결과 누적 (이전 Turn의 conversationHistory가 프리펜드됨)
- `maxStepsPerTurn` 정책 적용
- Turn 완료 시 messages가 AgentInstance.conversationHistory에 저장되어 다음 Turn으로 전달

### Step

- LLM 호출 1회를 중심으로 한 단위
- Step 시작 시 `SwarmBundleRef`와 `EffectiveConfig` 고정
- 실행 순서: config → tools → blocks → llmCall → toolExec → post

## 주요 타입

### LlmMessage

```typescript
type LlmMessage =
  | LlmSystemMessage  // { role: 'system', content: string }
  | LlmUserMessage    // { role: 'user', content: string }
  | LlmAssistantMessage // { role: 'assistant', content?, toolCalls? }
  | LlmToolMessage;   // { role: 'tool', toolCallId, toolName, output }
```

### TurnOrigin / TurnAuth

- `TurnOrigin`: 호출 맥락 (connector, channel, threadTs 등)
- `TurnAuth`: 인증 컨텍스트 (actor, subjects)
- 에이전트 간 handoff 시 변경 없이 전달되어야 함

### EffectiveConfig

- Step에서 사용할 최종 구성
- swarm, agent, model, tools, extensions, systemPrompt 포함
- `normalizeByIdentity`로 중복 처리 (last-wins)

## 개발 규칙

1. **타입 단언 금지**: `as` 사용 금지, 타입 가드와 정확한 타입 정의로 해결
2. **에러 처리**: Tool 실행 오류는 `ToolResult.error`로 변환 (예외 전파 금지)
3. **불변성**: `origin`, `auth`는 Turn 생애주기 동안 불변
4. **Step 고정**: Step 시작 후 `SwarmBundleRef`와 `EffectiveConfig` 변경 불가

## 의존성

- `types/` - Resource, ObjectRef, JsonValue 등 기본 타입
- `types/specs/` - AgentSpec, SwarmSpec, ModelSpec 등 Kind별 스펙

## 테스트

```bash
pnpm test -- __tests__/runtime/
```

## 구현 상태

- [x] types.ts - LlmMessage, ToolCall, TurnOrigin, TurnAuth 등
- [x] swarm-instance.ts - SwarmInstance, SwarmInstanceManager
- [x] agent-instance.ts - AgentInstance, AgentEventQueue
- [x] turn-runner.ts - Turn, TurnRunner
- [x] step-runner.ts - Step, StepRunner
- [x] effective-config.ts - EffectiveConfig, EffectiveConfigLoader
- [x] message-builder.ts - MessageBuilder, buildLlmMessages
