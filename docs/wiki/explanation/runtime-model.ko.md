# 런타임 모델

> Orchestrator, Process-per-Agent, IPC, Reconciliation Loop, Graceful Shutdown

[English version](./runtime-model.md)

---

## 왜 런타임 모델이 중요한가

`gdn run`을 실행하면, Goondan은 에이전트를 단일 프로세스에 로드하지 않습니다. 대신 **상주 Orchestrator**를 기동하고, 각 에이전트를 독립 자식 프로세스로 생성합니다. 이 모델을 이해하면 크래시 격리, 재시작, 메시지 전달, 설정 변경 전파 등 프로덕션 스웜 운영에 핵심적인 동작을 파악할 수 있습니다.

이 문서는 각 컴포넌트의 _설계 동기_를 설명합니다. 정확한 인터페이스 정의는 `docs/specs/runtime.md`를, CLI 사용법은 [CLI 레퍼런스](../reference/cli-reference.ko.md)를 참고하세요.

---

## 전체 구조

```
gdn run
  |
  v
+---------------------------------------------------------------+
|                    Orchestrator                                |
|                  (상주 프로세스)                                 |
|                                                               |
|   +------------------+  +------------------+                  |
|   | AgentProcess-A   |  | AgentProcess-B   |   ...            |
|   | (Bun 자식 프로세스)|  | (Bun 자식 프로세스)|                  |
|   |                  |  |                  |                  |
|   | Turn -> Step ... |  | Turn -> Step ... |                  |
|   +------------------+  +------------------+                  |
|                                                               |
|   +------------------------+                                  |
|   | ConnectorProcess       |                                  |
|   | (Bun 자식 프로세스)      |                                  |
|   | HTTP 서버 / 폴링        |                                  |
|   +------------------------+                                  |
+---------------------------------------------------------------+
```

실행 중인 스웜은 세 종류의 프로세스로 구성됩니다:

| 프로세스 | 역할 | Kubernetes 비유 |
|----------|------|-----------------|
| **Orchestrator** | 다른 모든 프로세스의 라이프사이클 관리, IPC 메시지 라우팅 | kube-controller-manager |
| **AgentProcess** | 단일 에이전트의 Turn/Step 루프를 격리 실행 | Pod |
| **ConnectorProcess** | 외부 이벤트(HTTP, 폴링, cron) 수신 후 Orchestrator로 전달 | Ingress controller |

---

## Orchestrator: 상주하는 수퍼바이저

Orchestrator는 `gdn run` 실행 시 기동되어 세션 전체 동안 살아있습니다. 모든 AgentProcess가 종료되더라도(처리할 이벤트가 없는 경우 등) Orchestrator는 유지되며, 새 이벤트가 도착하면 필요한 프로세스를 즉시 생성합니다.

### 핵심 책임

1. **Config Plane 구성** -- `goondan.yaml`과 관련 리소스 파일을 파싱하여 선언된 에이전트, 커넥터, 연결 집합을 구축합니다.
2. **생성 및 감시** -- AgentProcess와 ConnectorProcess 자식을 생성하고 종료를 감시합니다.
3. **이벤트 라우팅** -- ConnectorProcess의 이벤트나 에이전트 간 메시지를 받아 `instanceKey` 기반으로 올바른 AgentProcess에 전달합니다.
4. **IPC 브로커** -- 모든 에이전트 간 통신은 Orchestrator를 경유합니다.
5. **설정 변경 반응** -- 재시작 신호(`gdn restart`, `--watch` 모드) 수신 시 영향받는 프로세스를 graceful shutdown한 뒤 새 설정으로 재생성합니다.

### 왜 단일 Orchestrator인가?

감시를 하나의 프로세스에 집중하면 라우팅 로직이 단순해지고 상태가 일관됩니다. Orchestrator 자체는 에이전트 로직을 실행하지 않으며, 자식 프로세스에 전적으로 위임합니다. 이는 Kubernetes 컨트롤 플레인과 동일한 구조입니다: controller-manager가 판단하고, kubelet이 워크로드를 실행합니다.

---

## Process-per-Agent: 설계에 의한 크래시 격리

Swarm에 선언된 각 `Agent`는 자체 Bun 자식 프로세스에서 실행됩니다. 이것이 Goondan 런타임의 가장 중요한 아키텍처 결정입니다:

- **크래시 격리** -- Agent-A에서 처리되지 않은 예외가 발생해도 Agent-B는 계속 실행됩니다. Orchestrator가 크래시를 감지하고 Agent-A를 재생성할 수 있습니다.
- **독립 스케일링** -- 각 프로세스가 자체 메모리 공간과 이벤트 루프를 가집니다. 느린 에이전트가 다른 에이전트를 차단하지 않습니다.
- **선택적 재시작** -- 한 에이전트가 사용하는 Tool이나 Extension을 변경하면, 해당 에이전트의 프로세스만 재시작하면 됩니다. 다른 에이전트의 대화는 영향받지 않습니다.

### Kubernetes와의 비교

| Kubernetes | Goondan |
|------------|---------|
| Pod가 격리된 리소스로 컨테이너 실행 | AgentProcess가 격리된 Bun 프로세스로 에이전트 실행 |
| Pod 크래시 시 kubelet이 재시작 | AgentProcess 크래시 시 Orchestrator가 재생성 |
| Pod 간 통신은 Service/네트워크 경유 | AgentProcess 간 통신은 Orchestrator IPC 경유 |
| Deployment에 선언적 desired state | `goondan.yaml`에 선언적 desired state |

---

## IPC: 메시지 브로커

에이전트는 서로 직접 통신하지 않습니다. 모든 프로세스 간 통신은 **메시지 브로커** 역할을 하는 Orchestrator를 경유합니다.

### 3종 IPC 메시지

IPC 프로토콜은 의도적으로 최소화되어 있으며, 단 세 가지 메시지 타입만 존재합니다:

| 타입 | 방향 | 목적 |
|------|------|------|
| `event` | 양방향 | `AgentEvent` 페이로드를 전달 -- 커넥터 입력, 에이전트 간 요청, 응답을 위한 범용 이벤트 봉투 |
| `shutdown` | Orchestrator -> 자식 | 프로세스에 drain 후 종료를 지시; `gracePeriodMs`와 `reason` 포함 |
| `shutdown_ack` | 자식 -> Orchestrator | drain 완료를 확인; 이 메시지 전송 후 프로세스 종료 |

모든 IPC 메시지는 `from`, `to`, `payload` 필드를 포함하며, JSON 직렬화 가능하고 순서가 보장됩니다.

### 이벤트 흐름: Connector에서 Agent로

```
외부 이벤트 (예: Telegram 웹훅)
          |
          v
ConnectorProcess
  - 페이로드를 ConnectorEvent로 정규화
  - ctx.emit(ConnectorEvent)
          |
          v  (IPC)
Orchestrator
  - Connection ingress 규칙 매칭
  - 대상 Agent + instanceKey 결정
  - AgentProcess 조회 또는 생성
          |
          v  (IPC)
AgentProcess
  - AgentEvent 큐에 추가
  - 준비되면 Turn 처리
```

### 이벤트 흐름: Agent 간 (요청/응답)

```
AgentProcess-A
  - Tool 호출: agents__request("reviewer", ...)
  - replyTo.correlationId가 포함된 IPC 이벤트 전송
          |
          v  (IPC)
Orchestrator
  - AgentProcess-B로 라우팅 (필요 시 생성)
          |
          v  (IPC)
AgentProcess-B
  - Turn 처리
  - metadata.inReplyTo = correlationId가 포함된 응답 IPC 이벤트 전송
          |
          v  (IPC)
Orchestrator
  - correlationId를 매칭하여 AgentProcess-A로 전달
          |
          v
AgentProcess-A
  - 응답 수신, Turn 계속
```

`replyTo` + `correlationId` 패턴으로 전용 응답 채널 없이 요청-응답 시맨틱을 구현합니다. 단방향(fire-and-forget) 통신은 `replyTo`를 생략하면 됩니다.

---

## 통합 이벤트 모델: AgentEvent

수신하는 에이전트 입장에서 모든 들어오는 이벤트는 동일한 모양 -- `AgentEvent` -- 입니다. Telegram 웹훅에서 왔든, 다른 에이전트에서 왔든, CLI에서 왔든 에이전트는 동일한 봉투를 봅니다:

| 필드 | 설명 |
|------|------|
| `id` | 고유 이벤트 ID |
| `type` | 이벤트 타입 문자열 |
| `input` | 텍스트 내용 |
| `instanceKey` | 에이전트 인스턴스 라우팅 키 |
| `source` | 발신자 (`{ kind: 'agent', name: '...' }` 또는 `{ kind: 'connector', name: '...' }`) |
| `replyTo` | 선택적 응답 채널 (`target`과 `correlationId` 포함) |
| `auth` | 인증 컨텍스트, 핸드오프 시 변경 없이 전달 |

이 통합 모델 덕분에 에이전트는 이벤트 출처별로 특별한 처리가 필요 없습니다. `source`는 메타데이터일 뿐이고, `replyTo`의 유무가 응답 필요 여부를 결정합니다.

---

## ProcessStatus: 7가지 상태

모든 AgentProcess와 ConnectorProcess는 Kubernetes Pod 단계(phase)에서 영감을 받은 상태 모델로 Orchestrator가 추적합니다:

```
                        +---> processing ---+
                        |                   |
spawning ---> idle -----+                   +---> idle
                        |                   |
                        +---> draining ---> terminated
                                            |
         crashed <----- (비정상 종료) <------+
             |
             v  (반복 크래시)
      crashLoopBackOff
```

| 상태 | 의미 |
|------|------|
| `spawning` | 프로세스 생성 중; 아직 이벤트를 처리할 준비가 안 됨 |
| `idle` | 프로세스가 실행 중이지만 활성 Turn이 없음 |
| `processing` | Turn을 실행 중 |
| `draining` | `shutdown` 메시지를 수신함; 현재 Turn을 마무리하고 새 이벤트를 거부 중 |
| `terminated` | 프로세스가 정상 종료함 (exit code 0) |
| `crashed` | 프로세스가 비정상 종료함 (exit code != 0) |
| `crashLoopBackOff` | 프로세스가 반복적으로 크래시함; Orchestrator가 다음 재생성 전 지수 백오프 적용 중 |

Orchestrator는 직접 프로세스 관찰(Bun spawn/exit 이벤트)과 자식 프로세스의 선택적 IPC 보고를 통해 상태 전환을 감지합니다.

---

## Reconciliation Loop: 선언 상태 vs. 실제 상태

Orchestrator는 주기적으로(기본 5초 간격) **Reconciliation Loop**를 실행하여, 설정의 _선언 상태(desired state)_와 실행 중인 프로세스의 _실제 상태(actual state)_를 비교하고 교정 조치를 취합니다.

### 선언 상태 (Desired state)

`goondan.yaml`에서 도출:

- `Swarm.agents[]`에 선언된 Agent 목록
- Connection이 참조하는 Connector 목록
- ConnectorProcess는 항상 실행 상태를 유지해야 함 (외부 이벤트 대기)
- AgentProcess는 이벤트 도착 시 on-demand로 생성

### 실제 상태 (Actual state)

Orchestrator 자체 프로세스 맵에서 직접 관찰:

- 어떤 자식 프로세스가 살아있는지 (pid 존재 여부)
- 어떤 프로세스가 어떤 exit code로 종료했는지
- 프로세스별 연속 크래시 횟수와 백오프 타이머

### 교정 행동

각 루프 반복에서 Orchestrator는 다음 행동을 결정합니다:

| 조건 | 행동 |
|------|------|
| ConnectorProcess가 있어야 하는데 실행되지 않음 | 생성 |
| 설정에서 제거된 Agent/Connector의 프로세스가 남아 있음 | Graceful shutdown |
| 프로세스가 `crashed` 상태 | 재생성 (백오프 적용) |
| 프로세스가 `crashLoopBackOff` 상태이고 `nextSpawnAllowedAt`이 지남 | 재생성 |

### Crash Loop 감지와 백오프

AgentProcess가 반복적으로 크래시하면, Orchestrator는 리소스 고갈을 방지하기 위해 지수 백오프를 적용합니다:

```
crash 1-5:  즉시 재생성
crash 6:    crashLoopBackOff -> 1초 대기
crash 7:    2초 대기
crash 8:    4초 대기
...
crash N:    min(1초 * 2^(N-6), 5분) 대기
```

프로세스가 최소 한 번의 Turn을 성공적으로 완료하면 카운터가 0으로 리셋됩니다. 이는 Kubernetes Pod의 `CrashLoopBackOff` 상태와 동일한 패턴입니다.

### 왜 Reconciliation Loop인가?

순수 이벤트 기반 접근(크래시 시 생성, 설정 삭제 시 종료)은 에지 케이스를 놓칠 수 있습니다: 체크 사이에 죽는 프로세스, 프로세스 생성 중에 변경되는 설정 파일 등. Reconciliation 모델은 **자가 치유(self-healing)** 특성을 가집니다 -- 이벤트가 유실되더라도 다음 루프 반복에서 불일치를 감지하고 교정합니다.

---

## Graceful Shutdown Protocol

Orchestrator가 AgentProcess를 종료해야 할 때 -- 설정 변경, 재시작 명령, 자체 종료 등 -- 데이터 손실을 방지하기 위해 다음 프로토콜을 따릅니다:

```
Orchestrator                          AgentProcess
    |                                      |
    |--- shutdown IPC ------------------>  |
    |    { gracePeriodMs: 30000,           |
    |      reason: 'config_change' }       |
    |                                      |--- 상태 -> 'draining'
    |                                      |--- 새 이벤트 수신 중단
    |                                      |--- 현재 Turn 완료 (있는 경우)
    |                                      |--- events -> base 폴딩
    |                                      |
    |  <--------- shutdown_ack ----------  |
    |                                      |--- exit(0)
    |
    |--- (정상 종료 확인)
    |
    |--- (gracePeriodMs 초과 시
    |     shutdown_ack 미수신)
    |                                      |
    |--- SIGKILL ----------------------->  X
```

### 종료 사유

| 사유 | 시점 |
|------|------|
| `config_change` | YAML이 수정되어 에이전트가 새 설정을 필요로 함 |
| `restart` | 명시적 `gdn restart` 명령 또는 self-restart 신호 |
| `orchestrator_shutdown` | Orchestrator 자체가 종료 중 |

### 강제 종료 후 복구

유예 기간이 만료되어 SIGKILL이 사용되면, AgentProcess가 폴딩되지 않은 이벤트를 `events.jsonl`에 남겨둘 수 있습니다. 다음 기동 시 런타임이 `BaseMessages + SUM(Events)`를 재계산하여 메시지 손실 없이 상태를 복원합니다. 이것이 아래에서 설명하는 이벤트 소싱 모델의 핵심 이유입니다.

---

## 관측성: OTel 호환 TraceContext

Goondan은 OpenTelemetry 호환 trace 모델을 사용하여 에이전트 간 **인과 체인**을 추적합니다. 멀티 에이전트 환경에서 _무엇이_ 일어났는지뿐 아니라 _왜_, _어떤 원인으로_ 일어났는지를 파악하는 데 필수적입니다.

### TraceContext

모든 런타임 이벤트에는 세 가지 필드를 가진 `TraceContext`가 포함됩니다:

| 필드 | 목적 |
|------|------|
| `traceId` | 최초 입력(예: connector 이벤트) 시 한 번 생성되며, 인터-에이전트 호출을 포함한 전체 실행 체인에서 유지 |
| `spanId` | 현재 실행 단위(Turn, Step, Tool 호출)의 고유 ID |
| `parentSpanId` | 상위 실행 단위와의 연결 — 트리 구조를 형성 |

### Span 계층 구조

```
[Connector Event]               <- root span (traceId 생성)
  +-- [Agent A Turn]            <- child span
       +-- [Step 1]             <- child span
       |    +-- [LLM 호출]      <- child span
       |    +-- [Tool: bash]    <- child span
       |    +-- [agents__request]  <- child span
       |         +-- [Agent B Turn]   <- child span (동일 traceId!)
       |              +-- [Step 1]    <- child span
       |                   +-- [LLM 호출]  <- child span
       +-- [Step 2]             <- child span
            +-- [LLM 호출]      <- child span
```

### 핵심 규칙

1. **traceId는 인터-에이전트 호출 시에도 재생성되지 않습니다.** 이로써 스웜 전체에 대한 end-to-end 추적이 보장됩니다.
2. 각 실행 단위(Turn, Step, Tool Call)는 새 `spanId`를 생성하되, `parentSpanId`로 상위와 연결됩니다.
3. 모든 `RuntimeEvent` 레코드에 전체 `TraceContext`가 포함됩니다.

### 9종 런타임 이벤트

런타임은 다음 구조화된 이벤트를 발행합니다 (모두 `TraceContext`, `agentName`, `instanceKey` 포함):

| 이벤트 | 발행 시점 |
|--------|-----------|
| `turn.started` / `turn.completed` / `turn.failed` | Turn 생명주기 |
| `step.started` / `step.completed` / `step.failed` | Step 생명주기 |
| `tool.called` / `tool.completed` / `tool.failed` | Tool 호출 생명주기 |

### Trace 조회

```bash
# 에이전트 이름으로 이벤트 필터링
gdn logs --agent coder

# 특정 trace를 모든 에이전트에 걸쳐 추적
gdn logs --trace <traceId>

# 두 필터를 결합
gdn logs --agent coder --trace <traceId>
```

Studio (`gdn studio`)는 이 이벤트들에서 span 트리를 재구성하여 인과 관계 시각화를 렌더링합니다. 모든 관계가 이벤트 자체에 인코딩되어 있으므로 휴리스틱이 필요 없습니다.

또한 `step.started.llmInputMessages`에는 `contentSource(verbatim|summary)`와 `parts[]`(`text`/`tool-call`/`tool-result`)가 포함될 수 있어, Studio Logs 뷰에서 "LLM 입력 원문 vs 요약"과 도구 호출/결과를 구조적으로 구분해 표시할 수 있습니다.

> `TraceContext`와 `RuntimeEvent`의 정확한 타입 정의는 `docs/specs/shared-types.md` 5절과 9절을 참조하세요.

---

## Turn과 Step: 실행 모델

각 AgentProcess 내부에서 작업은 **Turn**과 **Step**으로 구조화됩니다.

### Turn

Turn은 단일 수신 이벤트를 처리하는 단위입니다. 하나의 `AgentEvent`가 들어가고, 하나의 `TurnResult`가 나옵니다. Turn은 하나 이상의 Step을 포함합니다.

```
AgentEvent (입력)
    |
    v
+-- Turn -------------------------------------------+
|                                                   |
|   Step 0: LLM 호출 -> 도구 호출 -> 도구 결과       |
|   Step 1: LLM 호출 -> 도구 호출 -> 도구 결과       |
|   Step 2: LLM 호출 -> 텍스트 응답 (도구 없음)       |
|                                                   |
+---------------------------------------------------+
    |
    v
TurnResult (출력)
```

### Step

Step은 단일 LLM 호출 사이클입니다:

1. `ConversationState`에서 입력 메시지 구성
2. Tool 카탈로그와 함께 LLM 호출
3. LLM이 도구 호출로 응답하면: 도구 실행, 결과 기록, 다음 Step으로 진행
4. LLM이 텍스트만으로 응답하면: Turn 완료

### 미들웨어 통합

Extension 미들웨어가 각 계층을 감쌉니다:

```
[Turn 미들웨어 체인]
  |-- turn.pre
  |-- [Step 루프]
  |   |-- [Step 미들웨어 체인]
  |   |   |-- step.pre (도구 카탈로그 조작 등)
  |   |   |-- [코어: LLM 호출]
  |   |   |-- [ToolCall 루프]
  |   |   |   |-- [ToolCall 미들웨어 체인]
  |   |   |   |   |-- toolCall.pre (입력 검증)
  |   |   |   |   |-- [코어: 도구 실행]
  |   |   |   |   |-- toolCall.post (결과 로깅)
  |   |   |-- step.post
  |-- turn.post
```

미들웨어 파이프라인에 대한 상세한 설명은 [Extension 파이프라인](./extension-pipeline.ko.md)을 참고하세요.

---

## 메시지 이벤트 소싱

Goondan은 메시지 배열을 직접 수정하지 않습니다. 대신 대화 상태에 **이벤트 소싱** 모델을 사용합니다:

```
NextMessages = BaseMessages + SUM(Events)
```

| 구성요소 | 설명 |
|----------|------|
| `BaseMessages` | Turn 시작 시 로드되는 확정 메시지 스냅샷 (`messages/base.jsonl`) |
| `Events` | Turn 중 누적되는 `MessageEvent` 레코드의 순서 보장 시퀀스 (`messages/events.jsonl`) |
| `NextMessages` | 계산된 결과: LLM에 실제로 전달되는 메시지 |

### MessageEvent 타입

| 타입 | 효과 |
|------|------|
| `append` | 끝에 새 메시지 추가 |
| `replace` | `targetId`로 매칭된 기존 메시지를 새 메시지로 교체 |
| `remove` | `targetId`로 매칭된 메시지 삭제 |
| `truncate` | 모든 메시지 제거 |

### Turn 라이프사이클

1. **Turn 시작** -- `base.jsonl`에서 `BaseMessages` 로드
2. **Turn 진행 중** -- 모든 메시지 변경이 `MessageEvent` 항목으로 기록 (LLM 출력, Extension 조작, 도구 결과)
3. **Turn 종료** -- 폴딩: `BaseMessages + SUM(Events)` 계산, 새 `base.jsonl`로 기록, `events.jsonl` 비움

### 왜 이벤트 소싱인가?

- **복구** -- 프로세스가 Turn 도중 크래시하면, 폴딩되지 않은 이벤트가 `events.jsonl`에 남습니다. 재시작 시 런타임이 `Base + SUM(Events)`를 재생하여 정확한 상태를 재구성합니다.
- **관찰성** -- 모든 메시지 변경이 감사 가능한 이벤트입니다.
- **Extension 친화적** -- Extension은 배열을 직접 수정하는 대신 이벤트를 발행하여 메시지를 조작합니다 (예: compaction이 오래된 메시지를 제거하고 요약을 추가).
- **컴팩션** -- 주기적 `events -> base` 폴딩으로 이벤트 로그 크기를 제한합니다.

---

## Edit & Restart: 설정 변경 모델

Goondan은 설정 변경에 **Edit & Restart** 모델을 사용합니다. 핫 리로드나 설정 업데이트용 라이브 API는 없습니다. 대신:

1. `goondan.yaml`(또는 개별 리소스 파일)을 직접 편집
2. Orchestrator가 변경을 감지 (`--watch` 모드 또는 `gdn restart` 명령)
3. 영향받는 AgentProcess에 Graceful Shutdown을 수행한 뒤 새 설정으로 재생성

### 재시작 시 보존되는 것

- **대화 히스토리** -- 기본적으로 `base.jsonl`이 보존됩니다. 에이전트는 새 설정이 적용된 상태로 이전 대화를 이어갑니다.
- **Extension 상태** -- `extensions/<ext-name>.json` 파일이 재시작 전후로 유지됩니다.

### 적용되는 변경 사항

- 에이전트 시스템 프롬프트, 모델 참조, 도구 목록, 확장 목록
- Swarm 레벨 정책 (retry, timeout, maxStepsPerTurn)
- Tool/Extension/Connector 엔트리 코드 (`--watch` 활성 시)

### 재시작 트리거

| 트리거 | 동작 |
|--------|------|
| `gdn restart` | 활성 Orchestrator에 재시작 신호 전송 |
| `--watch` 모드 | Orchestrator가 파일 변경을 감시하고 영향받는 프로세스를 자동 재시작 |
| 크래시 감지 | Reconciliation Loop가 백오프를 적용하여 크래시된 프로세스를 재생성 |
| Self-restart 신호 | 에이전트의 도구(예: `self-restart`)가 재시작 요청을 발행; Orchestrator가 제어된 shutdown/재생성 사이클 수행 |

---

## Connector와 Connection 프로세스

Connector는 AgentProcess와 마찬가지로 Orchestrator가 관리하는 **별도 Bun 프로세스**로 실행됩니다. 핵심 차이점은 Connector가 외부 이벤트를 _수신_하고(HTTP 서버 실행, API 폴링, WebSocket 관리 등), Agent가 이벤트를 _처리_한다는 것입니다.

### Connector 프로세스 특성

- Orchestrator가 생성하고 감시
- 자체 프로토콜 구현을 관리 (HTTP, WebSocket, 폴링, cron)
- 정규화된 `ConnectorEvent` 객체를 IPC로 Orchestrator에 전달
- 크래시 격리: 커넥터 크래시가 에이전트에 영향을 주지 않음

### Connection: 라우팅 계층

Connection은 다음을 정의하여 Connector를 Swarm에 바인딩합니다:
- **config/secrets** -- Connector에 전달되는 런타임 설정과 자격 증명
- **ingress 규칙** -- 이벤트 이름과 속성을 기반으로 어떤 Agent가 이벤트를 수신할지 결정하는 라우팅 규칙
- **서명 검증** -- 선택적 인바운드 요청 검증

Orchestrator는 각 `ConnectorEvent`에 Connection ingress 규칙을 적용하여 대상 Agent와 `instanceKey`를 결정한 뒤, 이벤트를 `AgentEvent`로 전달합니다.

---

## 요약: 모든 것이 맞물리는 방식

```
[외부 세계]
      |
      v
ConnectorProcess (프로토콜 처리)
      |  IPC를 통한 ConnectorEvent
      v
Orchestrator
  |-- Connection ingress 규칙 -> 대상 Agent + instanceKey
  |-- Reconciliation Loop: 선언 상태 vs. 실제 상태
  |-- IPC 라우팅 (event / shutdown / shutdown_ack)
      |
      v
AgentProcess (격리된 Bun 프로세스)
  |-- 이벤트 큐 (FIFO, 직렬 처리)
  |-- Turn
  |     |-- Step 루프 (LLM 호출 + 도구 실행)
  |     |-- 미들웨어 파이프라인 (turn / step / toolCall)
  |     |-- 메시지 이벤트 소싱 (base + events -> next)
  |     |-- Turn 종료 시 events -> base 폴딩
  |-- 신호 수신 시 Graceful Shutdown
```

이 아키텍처가 달성하는 것:
- Process-per-Agent를 통한 **크래시 격리**
- Reconciliation Loop를 통한 **자가 치유**
- 이벤트 소싱과 Graceful Shutdown을 통한 **데이터 안전성**
- 선언형 설정과 Edit & Restart를 통한 **단순성**
- 미들웨어 파이프라인을 통한 **확장성**
- 전체 인과 체인을 아우르는 OTel 호환 TraceContext를 통한 **관측성**

---

## 교차 참조

- [How-to: Swarm 실행하기](../how-to/run-a-swarm.ko.md) -- 스웜 인스턴스 실행, 재시작, 관리를 위한 실용 명령어
- [CLI 레퍼런스](../reference/cli-reference.ko.md) -- `gdn run`, `gdn restart`, `gdn instance`, `gdn logs`의 전체 레퍼런스
- [Extension 파이프라인](./extension-pipeline.ko.md) -- 미들웨어 Onion 모델과 ConversationState 심층 이해
- [핵심 개념](./core-concepts.ko.md) -- 리소스 Kind, ObjectRef, instanceKey, 선언형 구성 모델

권위 있는 스펙은 `docs/specs/runtime.md`를 참고하세요.

---

_위키 버전: v0.0.3_
