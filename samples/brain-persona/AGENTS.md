# samples/brain-persona

이 샘플은 "하나의 인격체(Brain Persona) '브렌'을 뇌의 작용을 본딴 다중 에이전트가 협업해 구현"하는 레퍼런스다.

## 구성 원칙

1. 모든 외부 입력은 `coordinator`로 진입한다.
2. `coordinator`는 반사적(reflexive) 뇌로, 사용자 의도를 해석하거나 매니징하지 않고 `agents__send`로 Worker에 비동기 라우팅만 수행한다.
3. `worker`는 모든 비반사적 작업을 수행하며, 다중 인스턴스 가능하다. 필요시 하위 worker를 spawn한다.
4. `unconscious`는 Worker의 Extension turn.pre에서 자동 호출되어 관련 기억/지식 맥락을 Worker에 주입한다. Worker LLM은 이 과정을 인지하지 않는다.
5. `observer`는 Worker의 Extension turn.post에서 자동 호출되어 의미 있는 행동만 3인칭 관점으로 관측 기록한다. Worker LLM은 이 과정을 인지하지 않는다.
6. `reflection`은 관측 축적 시 Observer가 트리거하여 관측을 압축/성찰로 전환한다. 셀프 업데이트도 수행한다.
7. `dream`은 유휴 시간에 Coordinator가 트리거하여 일지/관측/성찰로부터 주제별 지식 문서를 생성한다.
8. 최종 사용자 출력은 Connector가 아니라 채널별 Tool(`telegram__send` 또는 `slack__send`)로 전달한다.
9. 하위 에이전트는 작업 결과를 `coordinator`에게 `agents__send`로 보고하며, 외부 채널에는 직접 응답하지 않는다.
10. 각 에이전트는 독립 `AgentProcess`로 실행된다 (Process-per-Agent).
11. 에이전트 간 통신(`agents__send`, `ctx.agents.request/send`)은 모두 Orchestrator IPC를 경유한다.

## 에이전트 구성

| Agent | Model | Extension | Tool | 역할 |
|-------|-------|-----------|------|------|
| coordinator | fast-model (claude-haiku-4-5) | message-window, message-compaction, context-injector, idle-monitor | agents, telegram, slack, wait, self-restart | 반사적 뇌. 사용자 메시지를 Worker에 라우팅하고, 필요 시 wait로 대기하며 Worker 결과를 채널에 전달 |
| worker | default-model (claude-sonnet-4-5) | message-window, worker-lifecycle | agents, bash, file-system, http-fetch, json-query, text-transform | 실행 뇌. 모든 비반사적 작업(사고, 분석, 구현, 조사) 수행 |
| unconscious | fast-model (claude-haiku-4-5) | message-window | agents, file-system, bash | 무의식. qmd 검색 + 메모리 검색으로 맥락 반환 (Worker가 인지하지 못함) |
| observer | fast-model (claude-haiku-4-5) | message-window | agents, file-system | 관측자. Worker 행동을 3인칭 시점으로 선별 기록 (Worker가 인지하지 못함) |
| reflection | default-model (claude-sonnet-4-5) | message-window | agents, file-system, bash | 성찰. 관측 압축, 패턴 발견, 셀프 업데이트 수행 |
| dream | default-model (claude-sonnet-4-5) | message-window | agents, file-system, bash | 꿈(통합). 유휴 시 기억을 주제별 지식 문서로 생성/갱신 |

**Swarm 구성**: `Swarm/brain` — entryAgent=coordinator, maxStepsPerTurn=24

**Connection 구성**:
- `telegram-to-brain`: `@goondan/base` `Connector/telegram-polling` → instanceKey=`brain-persona-shared`
- `slack-to-brain`: `@goondan/base` `Connector/slack` (port 3102) → instanceKey=`brain-persona-shared` (이벤트: `message_im`, `app_mention`)

두 Connection이 동일한 instanceKey를 사용하여 채널 간 기억을 공유한다.

## 메시지 흐름 상세

### 시나리오 1: 사용자 메시지 수신 → 응답 전달

```
사용자 ──Telegram/Slack──▶ Connection ingress
                            │
                            │ instanceKey="brain-persona-shared"
                            ▼
                     ┌─ Coordinator Turn ──────────────────────────┐
                     │ [Extension turn.pre]                        │
                     │  1. message-window: 히스토리 윈도우 제한     │
                     │  2. message-compaction: 오래된 메시지 압축   │
                     │  3. context-injector: [runtime_catalog] 주입 │
                     │  4. idle-monitor: 유휴 체크, ≥30분이면       │
                     │     [idle_detected] 주입                    │
                     │                                             │
                     │ [LLM] Coordinator:                          │
                     │  ① [goondan_context]에서 채널 정보 파싱      │
                     │  ② 반사: typing/reaction                    │
                     │  ③ agents__list()로 활성 Worker 확인         │
                     │  ④ 새 작업 → agents__spawn(worker, 고유키)   │
                     │  ⑤ agents__send(worker, 사용자 메시지,       │
                     │     metadata={originChannel,                │
                     │     originProperties,                       │
                     │     coordinatorInstanceKey})                 │
                     │  ⑥ 필요 시 wait__seconds로 짧은 대기 반복      │
                     │  ⑦ 과도 대기는 피하고 Turn 종료                │
                     │                                             │
                     │ [Extension turn.post]                       │
                     │  4. idle-monitor: lastTurnCompletedAt 갱신   │
                     └─────────────────────────────────────────────┘
                            │ agents__send (fire-and-forget)
                            ▼
                     ┌─ Worker Turn (비동기) ──────────────────────┐
                     │ [Extension turn.pre]                        │
                     │  1. message-window: 히스토리 윈도우 제한     │
                     │  2. worker-lifecycle:                        │
                     │     - extractUserMessage(ctx)                │
                     │     - ctx.agents.request({                   │
                     │         target: 'unconscious',               │
                     │         input: 메시지,                       │
                     │         timeoutMs: 10000                     │
                     │       })                                    │
                     │     - 맥락이 있으면 [unconscious_context]     │
                     │       시스템 메시지로 emitMessageEvent        │
                     │     - (에러 시 조용히 무시)                   │
                     │                                             │
                     │ [LLM] Worker:                               │
                     │  - 주입된 무의식 맥락 기반으로 작업 수행       │
                     │  - memory/journals/YYYY-MM-DD.md 작업 일지    │
                     │  - agents__send(coordinator, 최종 결과)       │
                     │                                             │
                     │ [Extension turn.post]                       │
                     │  2. worker-lifecycle:                        │
                     │     - buildActionSummary()로 행동 요약 구성   │
                     │       ([input] + [tools] + [output])         │
                     │     - extractCoordinatorInstanceKey(ctx)     │
                     │     - ctx.agents.send({                      │
                     │         target: 'observer',                  │
                     │         input: 행동요약,                     │
                     │         metadata: {coordinatorInstanceKey}   │
                     │       })                                    │
                     │     - (fire-and-forget, 에러 시 무시)        │
                     └─────────────────────────────────────────────┘
                            │ agents__send (Worker 결과)
                            ▼
                     ┌─ Coordinator Turn (결과 수신) ──────────────┐
                     │ - Agent 이벤트로 판별                        │
                     │ - Worker 결과를 telegram__send 또는           │
                     │   slack__send로 사용자에게 1회 전달           │
                     │ - "restart required" 포함 시                 │
                     │   self-restart__request 호출                 │
                     └─────────────────────────────────────────────┘
```

### 시나리오 2: 관측 → 성찰 체인

```
worker-lifecycle turn.post
        │ ctx.agents.send({ target: 'observer', input: 행동요약 })
        ▼
┌─ Observer Turn ─────────────────────────────────────────────┐
│ 1. Worker 행동 요약(input/tools/output)을 분석               │
│ 2. LLM이 기록 가치를 판단 (선별적 관측)                       │
│    - 기록 O: 새 정보, 사용자 선호도, 중요 결정, 파일 변경,     │
│              실패에서의 교훈                                  │
│    - 기록 X: 단순 인사, 반복적 응답, 기존 관측과 동일          │
│ 3. 기록 대상이면:                                            │
│    memory/observations/YYYY-MM-DD.md에 3인칭 관점으로 append  │
│    형식: ## HH:MM / 브렌은 [행동]. [패턴/의미] / ---          │
│ 4. 오늘 관측 항목 수 ≥ 20개 →                                │
│    agents__send(reflection, "관측 축적 임계값 도달")           │
└─────────────────────────────────────────────────────────────┘
        │ (조건부) agents__send
        ▼
┌─ Reflection Turn ───────────────────────────────────────────┐
│ 1. memory/observations/에서 미처리 관측 읽기                  │
│    (<!-- reflected: ... --> 없는 항목)                        │
│ 2. 패턴 분석: 반복 행동, 사용자 선호, 개선점, 학습된 규칙      │
│ 3. memory/reflections/YYYY-MM-DD.md에 성찰 기록               │
│    형식: ## 성찰 - HH:MM                                     │
│          패턴 발견 / 학습된 규칙 / 개선 제안 / 압축된 관측 요약 │
│ 4. 처리 완료된 관측에 <!-- reflected: YYYY-MM-DD HH:MM --> 표시│
│ 5. 셀프 업데이트 필요 시:                                     │
│    - goondan.yaml/prompts/extensions 직접 수정                │
│    - coordinator에게 "restart required" 보고                  │
└─────────────────────────────────────────────────────────────┘
```

### 시나리오 3: 유휴 시 Dream 트리거

```
┌─ idle-monitor Extension ────────────────────────────────────┐
│ turn.post: api.state.set({ lastTurnCompletedAt: Date.now() })│
└─────────────────────────────────────────────────────────────┘
        │ (시간 경과, 30분 이상 유휴)
        ▼
┌─ 다음 Coordinator Turn 시작 ────────────────────────────────┐
│ idle-monitor turn.pre:                                       │
│   api.state.get() → lastTurnCompletedAt                      │
│   Date.now() - lastTurnCompletedAt ≥ 1800000ms (30분)        │
│   → [idle_detected] 시스템 메시지 주입                        │
│     idle_duration=N분 / last_activity=ISO시각                │
│                                                              │
│ Coordinator LLM:                                             │
│   [idle_detected] 감지 → agents__send(dream) 트리거           │
└──────────────────────────────────────────────────────────────┘
        │ agents__send
        ▼
┌─ Dream Turn ────────────────────────────────────────────────┐
│ 1. memory/ 전체 읽기:                                        │
│    journals/ → observations/ → reflections/ → knowledge/     │
│ 2. 새 정보를 기존 지식과 통합:                                │
│    - 새 주제 → memory/knowledge/{topic}.md 생성               │
│    - 기존 주제 → 해당 문서에 통합 갱신 (덮어쓰지 않음)         │
│    - 파일명: 영문 kebab-case (예: user-preferences.md)        │
│ 3. qmd 재색인:                                               │
│    qmd collection add memory/knowledge                       │
│      --name brain-knowledge --mask "*.md"                    │
│    또는 qmd update (컬렉션이 이미 존재하면)                   │
│ 4. coordinator에게 처리 결과 보고 (선택)                      │
└─────────────────────────────────────────────────────────────┘
```

## Extension 파이프라인 상세

로컬 Extension의 `ctx.agents.request/send`는 Runtime의 `MiddlewareAgentsApi`이며, 실제 에이전트 통신은 Orchestrator IPC를 경유한다.

### coordinator의 Extension 파이프라인

```
turn.pre 순서:
  1. message-window (@goondan/base)
     → 메시지 히스토리 윈도우 제한
  2. message-compaction (@goondan/base)
     → 오래된 메시지 압축
  3. context-injector (로컬: extensions/context-injector.ts)
     → ctx.metadata.runtimeCatalog에서 swarmName, entryAgent, selfAgent,
       availableAgents, callableAgents를 읽어 [runtime_catalog] 시스템 메시지 주입
     → callableAgents 안내 문구 포함
  4. idle-monitor (로컬: extensions/idle-monitor.ts)
     → api.state에서 lastTurnCompletedAt 로드
     → Date.now() - lastTurnCompletedAt ≥ 1800000ms(30분) 시
       [idle_detected] 시스템 메시지 주입 (idle_duration, last_activity 포함)

turn.post 순서 (역순):
  4. idle-monitor
     → api.state.set({ lastTurnCompletedAt: Date.now() })
  3. context-injector
     → (후처리 없음, ctx.next() 직후 반환)
  2. message-compaction
     → (후처리)
  1. message-window
     → (후처리)
```

### worker의 Extension 파이프라인

```
turn.pre 순서:
  1. message-window (@goondan/base)
     → 메시지 히스토리 윈도우 제한
  2. worker-lifecycle (로컬: extensions/worker-lifecycle.ts)
     → extractUserMessage(ctx)로 최근 user 메시지 추출
       (ctx.inputEvent.input 우선, 없으면 conversationState.nextMessages의 최신 user 메시지 역순 탐색)
     → ctx.agents.request({
         target: 'unconscious',
         input: 사용자 메시지,
         timeoutMs: 10000
       })
     → Unconscious가 qmd 검색 + memory 파일 검색 + LLM 리랭킹으로 맥락 반환
     → 응답이 비어 있지 않으면 [unconscious_context] 시스템 메시지로 emitMessageEvent
     → 에러 시 조용히 무시 (logger.debug만 남김)

step.pre 순서:
  1. date-helper (로컬: extensions/date-helper.ts)
     → 매 step 시작 시 [current_time] 시스템 메시지 주입
       (step_index, local, timezone_offset, iso, epoch_ms 포함)

turn.post 순서 (역순):
  2. worker-lifecycle
     → buildActionSummary(userMessage, result)로 행동 요약 구성:
       [input] 사용자 메시지
       [tools] 사용된 tool 이름 목록 (conversationState.nextMessages의 assistant tool-call 파트에서 추출)
       [output] 최종 응답 텍스트 (최대 500자)
     → extractCoordinatorInstanceKey(ctx)로 coordinatorInstanceKey 추출
       ([goondan_context] JSON에서 metadata.coordinatorInstanceKey 파싱)
     → ctx.agents.send({
         target: 'observer',
         input: 행동요약,
         metadata: { coordinatorInstanceKey }
       })
     → fire-and-forget, 에러 시 조용히 무시
  1. message-window
     → (후처리)
```

### 기타 에이전트 (unconscious, observer, reflection, dream)

message-window Extension만 사용하며, 로컬 Extension은 없다.

## 메모리 구조

```
memory/
├── journals/YYYY-MM-DD.md         # Worker가 작성
│   형식: HH:MM | 요청 요약 | 수행 내용 | 결과 요약
│   방식: file-system appendFile
│   생성: 파일이 없으면 자동 생성, 일지 기록 실패는 본 작업을 방해하지 않음
│
├── observations/YYYY-MM-DD.md     # Observer가 작성
│   형식: ## HH:MM
│         브렌은 [3인칭 행동 설명]. [관찰된 패턴이나 의미]
│         ---
│   방식: file-system appendFile, 선별적 기록 (모든 행동을 기록하지 않음)
│   트리거: worker-lifecycle Extension turn.post → ctx.agents.send(observer)
│   정리: Reflection 처리 후 <!-- reflected: YYYY-MM-DD HH:MM --> 표시 추가
│
├── reflections/YYYY-MM-DD.md      # Reflection이 작성
│   형식: ## 성찰 - HH:MM
│         ### 패턴 발견
│         ### 학습된 규칙
│         ### 개선 제안
│         ### 압축된 관측 요약
│         ---
│   방식: file-system appendFile
│   트리거: Observer가 관측 20개 이상 축적 시 agents__send(reflection)
│
└── knowledge/{topic}.md           # Dream이 작성
    형식: # {주제}
          ## 핵심 지식
          ## 관련 맥락
          ## 출처
          마지막 갱신: YYYY-MM-DD HH:MM
    방식: 생성 또는 통합 갱신 (덮어쓰지 않고 병합)
    파일명: 영문 kebab-case (예: user-preferences.md)
    색인: qmd brain-knowledge 컬렉션
    트리거: idle-monitor → [idle_detected] → Coordinator → agents__send(dream)
```

## 셀프 업데이트 메커니즘

### 1. Worker 자율 수정

```
Worker 작업 수행 중
  │ 개선 필요성 판단
  ▼
file-system Tool로 goondan.yaml / prompts/* / extensions/* 직접 수정
  │
  ▼
agents__send(coordinator, "restart required" + 변경 파일 목록 + 사유)
  │
  ▼
Coordinator가 self-restart__request(reason=...) 호출 → 런타임 재기동
```

### 2. Reflection 기반 자동 수정

```
Reflection 성찰 중 시스템 개선 발견
  │ 예: "사용자가 특정 형식의 응답을 선호"
  ▼
file-system Tool로 해당 프롬프트/설정 직접 수정
  │
  ▼
agents__send(coordinator, "restart required" + 변경 파일 목록 + 사유)
  │
  ▼
Coordinator가 self-restart__request(reason=...) 호출 → 런타임 재기동
```

**self-restart 규칙**: `self-restart__request`는 해당 turn의 마지막 Tool call로 1회만 호출하며, 같은 turn에서 중복 호출하지 않는다.

## 파일 가이드

- `goondan.yaml`: 리소스 정의 (6 Agent, 4 Extension, 2 Model, 1 Swarm, 2 Connection)
- `.env.example`: 실행에 필요한 환경변수 템플릿
- `prompts/*`: 에이전트별 시스템 프롬프트
  - coordinator.system.md: 반사적 뇌 (라우팅, 채널 전달)
  - worker.system.md: 실행 뇌 (모든 비반사적 작업)
  - unconscious.system.md: 무의식 (맥락 검색/주입)
  - observer.system.md: 관측자 (3인칭 관측 기록)
  - reflection.system.md: 성찰 (관측 압축/패턴 발견)
  - dream.system.md: 꿈 (유휴 시 지식 생성)
- `extensions/*`: runtime middleware
  - context-injector.ts: coordinator에 [runtime_catalog] 힌트 주입
  - worker-lifecycle.ts: worker의 turn.pre(무의식 맥락 주입) + turn.post(관측 트리거)
  - date-helper.ts: worker의 step.pre에서 [current_time] 현재시각 메시지 주입
  - idle-monitor.ts: coordinator에 유휴 시간 감지 → [idle_detected] 주입
- `memory/`: 파일 기반 메모리 저장소
  - journals/: worker 작업 일지 (YYYY-MM-DD.md)
  - observations/: observer 관측 기록 (YYYY-MM-DD.md)
  - reflections/: reflection 성찰 (YYYY-MM-DD.md)
  - knowledge/: dream 지식 문서 ({topic}.md, qmd brain-knowledge 컬렉션으로 색인)

## 버전 구분 규칙

1. 이 저장소(`bren`)에서 `@goondan/base`는 `package.json` 의존성이 아니다.
2. 즉, `@goondan/base` 상태는 `goondan.yaml`(dependency 범위) + `goondan.lock.yaml`(resolved 버전)으로만 판단한다.
3. `npm 패키지 버전`과 `goondan 패키지 버전`을 절대 섞어서 말하지 않는다.
4. `npm 패키지 버전` 질문은 이 저장소의 `package.json`으로 단정하지 않고, 별도 소스 저장소 기준임을 명시한다.
5. 답변은 짧고 친절하게 작성한다.

### 질문/답변 예시

- 질문 예시: `base 업데이트 됐어?`
- 답변 예시: `bren 기준으로 @goondan/base는 goondan 패키지 의존성(<dependency range>/<resolved version>)으로 관리되고, npm 패키지 버전은 이 저장소 package.json 기준으로 판단하지 않습니다.`

## 수정 시 체크

1. 채널 라우팅 키(`chat_id`, `channel_id`, `thread_ts`)를 깨지지 않게 유지한다.
2. 최종 outbound는 채널별 Tool(`telegram__send` 또는 `slack__send`) 호출로 유지하고, Telegram lifecycle 제어는 `telegram__send/edit/delete/react/setChatAction`, Slack lifecycle 제어는 `slack__send/read/edit/delete/react` 사용을 허용한다.
3. `coordinator.spec.requiredTools`는 채널 전송 Tool 목록 중 최소 1개 성공 호출(any-of)을 강제하도록 유지한다.
4. Telegram/Slack Connection의 `ingress.rules[].route.instanceKey`를 동일하게 유지해 채널 간 기억을 공유한다.
5. `coordinator`는 위임 실행 시 `agents__send`를 기본으로 사용하도록 프롬프트를 유지한다.
6. 프롬프트가 "단일 자아 톤"을 유지하도록 coordinator/하위 에이전트를 함께 점검한다.
7. `coordinator` 프롬프트는 위임 대상이 불명확할 때 `agents__catalog`를 호출해 `callableAgents`를 확인하도록 유지한다.
8. `Extension/context-injector`가 `[runtime_catalog]` 힌트를 주입하는 동작을 유지하고, coordinator 프롬프트와 충돌하지 않게 점검한다.
9. 장기 실행 안정성을 위해 `coordinator`에는 `message-window` + `message-compaction`, 하위 에이전트에는 최소 `message-window`를 유지한다.
10. coordinator의 Extension 선언 순서는 `message-window -> message-compaction -> context-injector -> idle-monitor`를 유지한다.
11. coordinator의 Tool 선언에 `@goondan/base` `Tool/telegram`, `Tool/slack`, `Tool/wait`, `Tool/self-restart`가 포함되어 채널 lifecycle 제어/대기/self-restart를 수행할 수 있게 유지한다.
12. self-restart가 필요한 turn에서는 `self-restart__request`를 마지막 Tool call로 1회만 호출하도록 coordinator 프롬프트를 유지한다.
13. Slack Connection ingress 이벤트는 `app_mention`, `message_im`을 유지한다.
14. Worker의 Extension 선언 순서는 `message-window -> worker-lifecycle -> date-helper`를 유지한다.
15. `Extension/worker-lifecycle`이 turn.pre에서 unconscious를 호출하고 turn.post에서 observer를 트리거하는 동작을 유지한다.
16. `Extension/idle-monitor`가 유휴 시간 감지 시 `[idle_detected]` 시스템 메시지를 주입하는 동작을 유지한다.
17. Worker 프롬프트에는 unconscious/observer에 대한 언급이 없어야 한다 (Worker는 이들의 존재를 모름).
