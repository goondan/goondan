# Goondan Runtime 실행 모델 스펙 (v0.0.3)

> 이 문서는 Goondan v0.0.3 Runtime의 유일한 source of truth이다. Config/Bundle 스펙은 `docs/specs/bundle.md`를, API 스펙은 `docs/specs/api.md`를 따른다.
> 공통 타입(`Message`, `MessageEvent`, `AgentEvent`, `IpcMessage`, `TurnResult`, `ToolCallResult` 등)은 `docs/specs/shared-types.md`를 기준으로 동기화한다.

---

## 1. 개요

### 1.1 배경 및 설계 동기

Goondan Runtime은 **Process-per-Agent** 아키텍처를 유일한 실행 모델로 사용한다. In-process 모델은 지원하지 않는다. Orchestrator는 **상주 프로세스(프로세스 매니저)**로 전체 Swarm의 생명주기를 관리하고, 각 AgentInstance와 Connector는 **독립 Bun 프로세스(실행 엔진)**로 실행된다. 이를 통해:

- **크래시 격리**: 개별 에이전트의 비정상 종료가 다른 에이전트에 영향을 주지 않는다.
- **독립 스케일링**: 각 에이전트 프로세스가 독립적으로 자원을 사용하고 관리된다.
- **단순한 재시작**: 설정 변경 시 영향받는 프로세스만 선택적으로 재시작할 수 있다.
- **Self-modification 지원**: 에이전트가 자기 manifest를 수정하면 해당 프로세스만 restart된다.
- **중앙 관측**: 모든 인터-에이전트 통신이 Orchestrator IPC를 경유하므로 중앙에서 관측 가능하다.

**Orchestrator와 AgentProcess의 책임 분리:**

- **Orchestrator (프로세스 매니저)**: Config Plane 파싱/검증/로딩, AgentProcess/ConnectorProcess 스폰/감시/재시작, IPC 메시지 브로커, Reconciliation Loop, Watch 모드, Graceful Shutdown 조율. 에이전트의 Turn 실행 로직은 **일절 모른다** -- 단지 이벤트를 올바른 프로세스에 전달할 뿐이다.
- **AgentProcess (실행 엔진)**: IPC로 이벤트를 받아 Turn/Step 루프 실행, LLM 호출, Tool 실행, Middleware Pipeline 운영, Extension 로딩/실행, Message State 관리, O11y 이벤트 발행. 인터-에이전트 통신은 Orchestrator IPC를 경유하며, 직접 다른 에이전트를 호출하지 않는다.

설정 변경은 **Edit & Restart** 모델을 따른다. `goondan.yaml`을 직접 수정하고 Orchestrator가 프로세스를 재시작하여 변경을 반영한다.

메시지 상태 관리는 **이벤트 소싱**을 유지한다. `NextMessages = BaseMessages + SUM(Events)` 규칙으로 메시지 상태를 결정론적으로 계산하며, 이는 복구, 관찰, Extension 기반 메시지 조작, Compaction을 가능하게 한다.

실행 엔진 엔트리(`runtime-runner`)와 관련 유틸(`runtime-routing`, `turn-policy`, `runtime-restart-signal`)은 `@goondan/runtime` 패키지의 `src/runner/*`가 소유한다. CLI는 해당 엔진을 기동/재기동/상태조회하는 제어면으로 동작한다.
CLI와 runtime runner는 startup handshake(`ready`/`start_error`) 및 실행 인자 계약을 공유하므로, 배포 시 두 패키지 버전을 동기화해야 한다.

### 1.2 계층 구조

```
Orchestrator (상주 프로세스, gdn run으로 기동)
  ├── AgentProcess-A  (별도 Bun 프로세스)
  │   └── Turn → Step → Step → ...
  ├── AgentProcess-B  (별도 Bun 프로세스)
  │   └── Turn → Step → ...
  └── ConnectorProcess-telegram (별도 Bun 프로세스)
      └── 자체 HTTP 서버/cron 스케줄러 등 프로토콜 직접 관리
```

### 1.3 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Bun-native** | 스크립트 런타임은 Bun만 지원. Node.js 호환 레이어 불필요 |
| **Process-per-Agent** | 각 AgentInstance는 독립 Bun 프로세스로 실행. 크래시 격리, 독립 스케일링 |
| **Edit & Restart** | `goondan.yaml` 수정 후 Orchestrator가 에이전트 프로세스 재시작 |
| **Message** | AI SDK 메시지를 감싸는 단일 래퍼. 메타데이터로 메시지 식별/조작 |
| **Middleware Pipeline** | 모든 파이프라인 훅은 Middleware 형태. `next()` 호출 전후로 전처리/후처리 |
| **Runtime 책임 최소화** | 코어는 실행 루프/이벤트/파이프라인만 담당하고, 메시지 윈도우/컴팩션 정책은 Extension이 담당 |
| **Provider 중립성** | Runtime 코어는 provider 전용 대화 정규화 로직을 포함하지 않고, 모델 호출 어댑터만 제공 |
| **O11y는 Core 책임** | O11y 이벤트 발행은 AgentProcess(Core)가 담당. Extension은 프로세스 간 통신/Orchestrator 레벨 관측 불가 |
| **OTel 호환 추적** | TraceContext(traceId + spanId + parentSpanId)로 Turn/Step/Tool/인터-에이전트 인과 체인 추적 |

---

## 2. 핵심 규칙

이 섹션은 Runtime 구현자가 반드시 따라야 할 규범적 규칙들을 요약한다.

### 2.1 Orchestrator 규칙

1. Orchestrator는 `goondan.yaml` 및 관련 리소스 파일을 파싱하여 Config Plane을 구성해야 한다(MUST).
2. Orchestrator는 각 Agent 정의에 대해 AgentProcess를 스폰하고 감시해야 한다(MUST).
3. Orchestrator는 각 Connector 정의에 대해 ConnectorProcess를 스폰하고 감시해야 한다(MUST).
4. Orchestrator는 `instanceKey`를 기준으로 이벤트를 적절한 AgentProcess로 라우팅해야 한다(MUST).
5. Orchestrator는 에이전트 간 IPC 메시지 브로커 역할을 수행해야 한다(MUST).
6. Orchestrator는 설정 변경 감지 또는 외부 명령 수신 시 에이전트 프로세스를 재시작할 수 있어야 한다(MUST).
7. Orchestrator는 모든 AgentProcess가 종료되어도 상주해야 하며, 새로운 이벤트 발생 시 필요한 AgentProcess를 다시 스폰해야 한다(MUST).
8. Orchestrator가 종료될 때 모든 자식 프로세스(AgentProcess, ConnectorProcess)도 종료해야 한다(MUST).
9. Orchestrator는 주기적으로 실제 프로세스 상태와 설정 상태를 비교하여 불일치를 교정해야 한다(MUST). (Reconciliation Loop)
10. AgentProcess가 반복적으로 크래시하면 Orchestrator는 지수 백오프(exponential backoff)를 적용하여 재스폰 간격을 늘려야 한다(MUST).
11. Orchestrator는 에이전트 프로세스 종료 시 현재 진행 중인 Turn이 완료될 때까지 유예 기간(grace period)을 제공해야 한다(MUST).
12. 유예 기간이 초과되면 Orchestrator는 프로세스를 강제 종료(SIGKILL)해야 한다(MUST).

### 2.2 AgentProcess 규칙

1. 각 AgentProcess는 독립된 메모리 공간에서 실행되어야 한다(MUST). 크래시 격리를 보장한다.
2. AgentProcess는 Orchestrator와 IPC를 통해 통신해야 한다(MUST).
3. AgentProcess는 독립적인 Turn/Step 루프를 실행해야 한다(MUST).
4. AgentProcess의 이벤트 큐는 FIFO 순서로 직렬 처리되어야 한다(MUST).
5. 같은 AgentProcess에 대해 Turn을 동시에 실행해서는 안 된다(MUST NOT).
6. AgentProcess가 비정상 종료(크래시)되면 Orchestrator가 자동 재스폰할 수 있어야 한다(SHOULD).
7. AgentProcess는 `shutdown` IPC 메시지를 수신하면 새 이벤트 수신을 중단하고, 현재 Turn을 마무리한 뒤 정상 종료해야 한다(MUST).

### 2.3 IPC 규칙

1. IPC 메시지는 `event`, `shutdown`, `shutdown_ack` 3종을 지원해야 한다(MUST).
2. 모든 IPC 메시지는 `from`, `to`, `payload`를 포함해야 한다(MUST).
3. 에이전트 간 요청-응답은 `AgentEvent.replyTo.correlationId`로 매칭해야 한다(MUST).
4. IPC 메시지는 JSON 직렬화 가능해야 한다(MUST).
5. 메시지 순서가 보장되어야 한다(MUST).
6. `shutdown` 메시지의 `payload`는 `gracePeriodMs`(밀리초)와 `reason`을 포함해야 한다(MUST).
7. `shutdown_ack` 메시지는 AgentProcess가 drain 완료 후 Orchestrator에 전송해야 한다(MUST).

### 2.4 Turn/Step 규칙

1. Turn은 하나의 `AgentEvent`를 입력으로 받아야 한다(MUST).
2. Turn은 하나 이상의 Step을 포함해야 한다(MUST).
3. Turn은 `TurnResult`를 출력으로 생성해야 한다(MUST).
4. Step은 LLM에 메시지를 전달하고 응답을 받는 단위여야 한다(MUST).
5. LLM 응답에 도구 호출이 포함되면 도구를 실행한 뒤 다음 Step을 실행해야 한다(MUST).
6. `StepResult.shouldContinue`가 `false`이면 Turn을 종료해야 한다(MUST).
7. Core는 StepResult 생성 후 `shouldContinue`를 `toolCalls.length > 0`으로 초기화해야 한다(MUST). step 미들웨어 post에서 이 값을 override할 수 있다.
8. Tool 실행은 AgentProcess(Bun) 내부에서 `spec.entry` 모듈 로드 후 핸들러 함수를 호출하는 방식이어야 한다(MUST).
9. Runtime은 Turn마다 `traceId`를 생성/보존해야 한다(MUST). 인터-에이전트 호출로 시작된 Turn은 호출자의 `traceId`를 유지한다(MUST).
10. Runtime이 Handoff를 위해 내부 이벤트를 생성할 때 `turn.auth`를 변경 없이 전달해야 한다(MUST).
11. Runtime은 Turn/Step/Tool Call마다 새 `spanId`를 생성하고, `parentSpanId`로 상위 실행 단위와 연결해야 한다(MUST). TraceContext 전파 규칙의 SSOT는 `docs/specs/shared-types.md` 5절이다.
12. 직전 Step 입력이 tool-result 전용 메시지인 상태에서 모델이 빈 응답(텍스트/assistant content/tool-call 모두 없음)을 반환하면, Runtime은 empty-output 경고 메시지를 추가하지 않고 Turn을 정상 종료할 수 있어야 한다(MUST).

### 2.5 메시지 상태 규칙

1. Turn의 LLM 입력 메시지는 `NextMessages = BaseMessages + SUM(Events)` 규칙으로 계산되어야 한다(MUST).
2. Turn 진행 중 발생하는 메시지 변경은 직접 배열 수정이 아니라 `MessageEvent` 발행으로 기록해야 한다(MUST).
3. 모든 Turn 미들웨어 종료 후 Runtime은 `BaseMessages + SUM(Events)`를 새 base로 저장해야 한다(MUST).
4. 새 base 저장이 완료되면 적용된 `Events`를 비워야 한다(MUST).
5. Runtime 재시작 시 미처리 `Events`가 남아 있으면 재계산해 Turn 상태를 복원해야 한다(MUST).
6. `replace`/`remove` 대상 `targetId`가 존재하지 않는 경우 Runtime은 구조화된 경고 이벤트를 남겨야 한다(SHOULD).

### 2.6 Observability 규칙

1. Runtime은 Turn/Step/ToolCall 로그에 `traceId`와 `spanId`를 포함해야 한다(MUST).
2. 민감값(access token, refresh token, secret)은 로그/메트릭에 평문으로 포함되어서는 안 된다(MUST).
3. Runtime은 최소 `latencyMs`, `toolCallCount`, `errorCount`, `tokenUsage`를 기록해야 한다(SHOULD).
4. Runtime은 Turn/Step/Tool 런타임 이벤트(`turn.*`, `step.*`, `tool.*`)를 인스턴스별 `messages/runtime-events.jsonl`에 append-only로 기록해야 한다(MUST).
5. Runtime 상태 점검(health check) 인터페이스를 제공하는 것을 권장한다(SHOULD).
6. 모든 RuntimeEvent에 `traceId`, `spanId`를 포함해야 한다(MUST). `parentSpanId`는 root span을 제외하고 포함한다(MUST).
7. 모든 RuntimeEvent에 `instanceKey`를 포함해야 한다(MUST).
8. `turn.completed`의 `stepCount`는 실제 실행된 Step 수를 반영해야 한다(MUST).
9. RuntimeEvent 타입 계약의 SSOT는 `docs/specs/shared-types.md` 9절이다(MUST).

### 2.7 Edit & Restart 규칙

1. 설정 변경은 `goondan.yaml` 또는 개별 리소스 파일을 직접 수정하는 방식으로 수행해야 한다(MUST).
2. Orchestrator는 설정 변경을 감지하거나 외부 명령을 수신하여 에이전트 프로세스를 재시작해야 한다(MUST).
3. 재시작 시 Orchestrator는 해당 AgentProcess에 graceful shutdown(`4.6 Graceful Shutdown Protocol`)을 수행한 뒤 새 설정으로 re-spawn해야 한다(MUST).
4. 기본 동작은 기존 메시지 히스토리를 유지한 채 새 설정으로 계속 실행하는 것이어야 한다(MUST).

### 2.8 Runtime 경계 규칙

1. Runtime 코어는 고정 메시지 트리밍 정책(`maxConversationTurns`, `BOT_MAX_CONVERSATION_TURNS` 등)을 내장해서는 안 된다(MUST NOT).
2. 메시지 개수/길이 제한, 요약(compaction), windowing 정책은 Extension이 `MessageEvent`로 구현해야 한다(MUST).
3. Runtime 코어는 provider-specific 대화 정규화(예: 특정 provider 전용 block 변환/삭제)를 수행해서는 안 된다(MUST NOT).
4. Provider별 차이는 모델 어댑터 선택과 인증정보 해석 수준에서만 처리해야 한다(SHOULD).
5. CLI 구현은 실행 엔진 로직을 자체 보유하지 않고 `@goondan/runtime` runner 엔트리를 사용해야 한다(MUST).
6. 장기 실행 Swarm은 메시지 정책 Extension(`message-window`, `message-compaction` 등)을 명시적으로 등록해야 한다(SHOULD). 미등록 시 메시지 히스토리가 무제한 누적되어 token limit 초과/비용 증가 위험이 있다.

---

## 3. 핵심 타입 정의

### 3.1 공통 타입

런타임은 다음 SSOT를 참조한다.

- 공통 타입 원형: `docs/specs/shared-types.md`
- 리소스 공통/Kind 스키마: `docs/specs/resources.md`
- 공통 운영 계약: `docs/specs/help.md`

이 문서에서는 런타임 동작 규칙(프로세스/IPC/Turn 루프)을 중심으로 설명한다.

---

## 4. Orchestrator (오케스트레이터 상주 프로세스)

Orchestrator는 `gdn run` 시 기동되는 **상주 프로세스**로, Swarm의 전체 생명주기를 관리한다.

### 4.1 핵심 책임

**규칙:**

1. Orchestrator는 `goondan.yaml` 및 관련 리소스 파일을 파싱하여 Config Plane을 구성해야 한다(MUST).
2. Orchestrator는 각 Agent 정의에 대해 AgentProcess를 스폰하고 감시해야 한다(MUST).
3. Orchestrator는 각 Connector 정의에 대해 ConnectorProcess를 스폰하고 감시해야 한다(MUST).
4. Orchestrator는 `instanceKey`를 기준으로 이벤트를 적절한 AgentProcess로 라우팅해야 한다(MUST).
5. Orchestrator는 에이전트 간 IPC 메시지 브로커 역할을 수행해야 한다(MUST).
6. Orchestrator는 설정 변경 감지 또는 외부 명령 수신 시 에이전트 프로세스를 재시작할 수 있어야 한다(MUST).
7. Orchestrator는 모든 AgentProcess가 종료되어도 상주해야 하며, 새로운 이벤트(Connector 수신, CLI 입력 등) 발생 시 필요한 AgentProcess를 다시 스폰해야 한다(MUST).
8. Orchestrator가 종료될 때 모든 자식 프로세스(AgentProcess, ConnectorProcess)도 종료해야 한다(MUST).

### 4.2 TypeScript 인터페이스

```typescript
interface Orchestrator {
  /** Swarm 이름 */
  readonly swarmName: string;

  /** 번들 디렉터리 경로 */
  readonly bundleDir: string;

  /** 관리 중인 AgentProcess 핸들 맵 (agentName:instanceKey → handle) */
  readonly agents: Map<string, AgentProcessHandle>;

  /** 에이전트 프로세스 스폰 */
  spawn(agentName: string, instanceKey: string): AgentProcessHandle;

  /** 특정 에이전트 프로세스 kill → 새 설정으로 re-spawn */
  restart(agentName: string): void;

  /** goondan.yaml 재로딩 후 모든 에이전트 프로세스 재시작 */
  reloadAndRestartAll(): void;

  /** 오케스트레이터 종료 (모든 자식 프로세스도 종료) */
  shutdown(): void;

  /** IPC 메시지 라우팅 */
  route(message: IpcMessage): void;
}

interface AgentProcessHandle {
  /** 프로세스 ID */
  readonly pid: number;

  /** Agent 이름 */
  readonly agentName: string;

  /** 인스턴스 키 */
  readonly instanceKey: string;

  /** 프로세스 상태 */
  readonly status: ProcessStatus;

  /** 연속 크래시 횟수 (reconciliation에 사용) */
  readonly consecutiveCrashes: number;

  /** 다음 재스폰 허용 시각 (crashLoopBackOff 시 설정) */
  readonly nextSpawnAllowedAt?: Date;

  /** IPC 메시지 전송 */
  send(message: IpcMessage): void;

  /** Graceful shutdown 요청 (유예 기간 후 강제 종료) */
  shutdown(options?: ShutdownOptions): Promise<void>;

  /** 프로세스 강제 종료 (SIGKILL) */
  kill(): void;
}
interface ShutdownOptions {
  /** 유예 기간 (밀리초). 기본값: SwarmPolicy.shutdown.gracePeriodSeconds * 1000 */
  gracePeriodMs?: number;
  /** 종료 사유 */
  reason?: ShutdownReason;
}
```

`ProcessStatus`/`ShutdownReason` 원형은 `docs/specs/shared-types.md` 5절을 따른다.

**ProcessStatus 감지 메커니즘**

- Bun 프로세스 API(직접 관찰): `spawn` → `spawning`, `exit code 0` → `terminated`, `exit code != 0` → `crashed`
- Orchestrator 내부 추적: `shutdown` 전송 후 `draining`, 연속 크래시 임계치 도달 시 `crashLoopBackOff`
- AgentProcess 보고(선택): Turn 시작 `processing`, Turn 완료/큐 비어 있음 `idle`
- `idle`/`processing`을 IPC 보고로 구분할 수 없으면 `spawning` 이후 생존 프로세스를 `idle`로 간주한다(SHOULD).

### 4.3 instanceKey 라우팅

**규칙:**

1. Orchestrator는 `instanceKey`를 사용해 동일 맥락 이벤트를 동일 AgentProcess로 라우팅해야 한다(MUST).
2. 라우팅 대상 AgentProcess가 아직 존재하지 않으면 Orchestrator가 새로 스폰해야 한다(MUST).
3. ConnectorEvent의 `instanceKey`와 Connection의 `ingress.rules`를 조합하여 대상 Agent와 인스턴스를 결정해야 한다(MUST).

### 4.4 Canonical Event Flow

1. ConnectorProcess가 외부 프로토콜 이벤트를 수신하여 `ConnectorEvent`를 Orchestrator로 전달한다.
2. Orchestrator는 Connection의 `ingress.rules`에 따라 대상 Agent를 결정한다.
3. `instanceKey` 규칙으로 기존 AgentProcess를 조회하거나 새로 스폰한다.
4. 이벤트를 `AgentEvent`로 변환하여 대상 AgentProcess로 IPC 전달한다.

```
ConnectorProcess ──[ConnectorEvent]──> Orchestrator
                                          │
                                          ├── Connection ingress.rules 매칭
                                          ├── instanceKey로 AgentProcess 조회/스폰
                                          │
                                          └──[AgentEvent via IPC]──> AgentProcess
```

### 4.5 Reconciliation Loop (상태 조정 루프)

Orchestrator는 주기적으로 **desired state**와 **actual state**를 비교하고 불일치를 교정한다.

#### Desired State (설정에서 결정)

- `Swarm.agents[]`에 선언된 Agent 목록
- Bundle 내 Connection이 참조하는 Connector 목록
- ConnectorProcess는 항상 실행 상태를 유지해야 한다 (외부 이벤트 수신 대기)
- AgentProcess는 이벤트 수신 시 on-demand로 스폰된다

#### Actual State (Orchestrator가 직접 관찰)

| 소스 | 관찰 대상 | 설명 |
|------|-----------|------|
| `Bun.spawn()` 반환값 | pid 존재 여부 | 프로세스가 살아있는지 |
| Bun `exit` 이벤트 | exit code | 0이면 정상, ≠0이면 크래시 |
| Orchestrator 내부 맵 | `agents: Map<string, AgentProcessHandle>` | 스폰한 프로세스 목록과 상태 |
| 시간 추적 | `consecutiveCrashes`, `nextSpawnAllowedAt` | crash loop 판정 |

> Orchestrator는 외부 상태 저장소가 아니라 **자신의 프로세스 맵**이 actual state이다. 프로세스를 직접 스폰하고 exit 이벤트를 받으므로 항상 정확한 상태를 알고 있다.

**규칙:**

1. Orchestrator는 주기적으로(기본 5초 간격) reconciliation을 수행해야 한다(MUST).
2. ConnectorProcess가 실행되지 않고 있으면 스폰해야 한다(MUST).
3. 설정에 존재하지 않는 Agent/Connector의 프로세스가 남아 있으면 graceful shutdown을 수행해야 한다(MUST).
4. `crashed` 상태의 프로세스는 백오프 정책에 따라 재스폰해야 한다(MUST).

```typescript
interface ReconciliationResult {
  /** 스폰이 필요한 프로세스 */
  readonly toSpawn: Array<{ agentName: string; instanceKey: string }>;
  /** 종료가 필요한 프로세스 */
  readonly toTerminate: Array<{ agentName: string; reason: string }>;
  /** 재스폰이 필요한 프로세스 (크래시 복구) */
  readonly toRespawn: Array<{ agentName: string; instanceKey: string; backoffMs: number }>;
}
```

#### Crash Loop 감지 및 백오프

**규칙:**

1. AgentProcess가 비정상 종료하면 `consecutiveCrashes`를 1 증가시켜야 한다(MUST).
2. AgentProcess가 정상 Turn을 1회 이상 완료하면 `consecutiveCrashes`를 0으로 리셋해야 한다(MUST).
3. `consecutiveCrashes`가 임계값(기본 5)을 초과하면 상태를 `crashLoopBackOff`로 전환해야 한다(MUST).
4. 백오프 간격은 `min(initialBackoffMs * 2^(crashes - 1), maxBackoffMs)`로 계산해야 한다(MUST). 기본값: `initialBackoffMs=1000`, `maxBackoffMs=300000` (5분).
5. `crashLoopBackOff` 상태인 프로세스는 `nextSpawnAllowedAt` 이전에 재스폰하지 않아야 한다(MUST).
6. Orchestrator는 `crashLoopBackOff` 상태를 구조화된 로그로 출력해야 한다(MUST).

```
예시 시나리오:
  crash 1: 즉시 재스폰
  crash 2: 즉시 재스폰
  crash 3: 즉시 재스폰
  crash 4: 즉시 재스폰
  crash 5: 즉시 재스폰
  crash 6: crashLoopBackOff → 1초 대기 후 재스폰
  crash 7: crashLoopBackOff → 2초 대기
  crash 8: crashLoopBackOff → 4초 대기
  ...
  crash N: crashLoopBackOff → 최대 5분 대기
```

### 4.6 Graceful Shutdown Protocol

Orchestrator가 AgentProcess를 종료할 때, 진행 중인 Turn의 데이터 손실을 방지하기 위한 프로토콜이다.

**규칙:**

1. Orchestrator는 프로세스 종료 시 먼저 `shutdown` IPC 메시지를 전송해야 한다(MUST).
2. `shutdown` 메시지의 `payload`는 `gracePeriodMs`와 `reason`을 포함해야 한다(MUST).
3. AgentProcess는 `shutdown` 수신 시 상태를 `draining`으로 전환해야 한다(MUST).
4. `draining` 상태에서는 새 이벤트를 큐에서 꺼내지 않아야 한다(MUST).
5. `draining` 상태에서 진행 중인 Turn이 있으면 완료까지 실행해야 한다(MUST).
6. Turn 완료 후 `events → base` 폴딩을 수행한 뒤 `shutdown_ack` IPC 메시지를 보내고 프로세스를 종료해야 한다(MUST).
7. 진행 중인 Turn이 없으면 즉시 `shutdown_ack`를 보내고 종료해야 한다(MUST).
8. `gracePeriodMs` 내에 `shutdown_ack`가 도착하지 않으면 Orchestrator는 SIGKILL로 강제 종료해야 한다(MUST).
9. 강제 종료된 경우 미폴딩 events는 다음 프로세스 기동 시 `BaseMessages + SUM(Events)` 재계산으로 복원된다.

**Shutdown 흐름:**

```
Orchestrator                          AgentProcess
    │                                      │
    ├── shutdown IPC ──────────────────>    │
    │   { type: 'shutdown',                │
    │     payload: {                       ├── status → 'draining'
    │       gracePeriodMs: 30000,          ├── 새 이벤트 수신 중단
    │       reason: 'config_change'        ├── 현재 Turn 완료 대기 (restart | config_change | orchestrator_shutdown)
    │     }}                               │
    │                                      ├── Turn 완료
    │                                      ├── events → base 폴딩
    │   <────────── shutdown_ack ───────────┤
    │   { type: 'shutdown_ack',            │
    │     from: 'coder' }                  └── process.exit(0)
    │
    ├── 정상 종료 확인
    │
    ─── (gracePeriodMs 초과 시) ──>    SIGKILL
```

---

## 5. AgentProcess (에이전트 프로세스)

각 AgentInstance는 **독립 Bun 프로세스**로 실행된다.

### 5.1 프로세스 기동

```bash
bun run agent-runner.ts \
  --bundle-dir ./my-swarm \
  --agent-name coder \
  --instance-key "user:123"
```

AgentProcess는 최소 다음 정보로 기동되어야 한다(MUST):

| 파라미터 | 설명 |
|----------|------|
| `--bundle-dir` | 프로젝트 디렉터리 경로 |
| `--agent-name` | Agent 리소스 이름 |
| `--instance-key` | 인스턴스 식별 키 |

### 5.2 프로세스 특성

**규칙:**

1. 각 AgentProcess는 독립된 메모리 공간에서 실행되어야 한다(MUST). 이를 통해 크래시 격리를 보장한다.
2. AgentProcess는 Orchestrator와 IPC(Bun의 `process.send`/`process.on("message")` 또는 Unix socket)를 통해 통신해야 한다(MUST).
3. AgentProcess는 독립적인 Turn/Step 루프를 실행해야 한다(MUST).
4. AgentProcess는 자신에게 할당된 Extension/Tool 코드를 자체 프로세스에서 로딩해야 한다(MUST).
5. AgentProcess가 비정상 종료(크래시)되면 Orchestrator가 이를 감지하고 자동 재스폰할 수 있어야 한다(SHOULD).

### 5.3 TypeScript 인터페이스

```typescript
interface AgentProcess {
  /** Agent 이름 */
  readonly agentName: string;

  /** 인스턴스 키 */
  readonly instanceKey: string;

  /** 프로세스 ID */
  readonly pid: number;

  /** Turn 실행 */
  processTurn(event: AgentEvent): Promise<TurnResult>;

  /** 프로세스 상태 */
  readonly status: ProcessStatus;

  /** 대화 히스토리 */
  readonly conversationHistory: Message[];

  /**
   * Graceful shutdown 처리.
   * draining 상태로 전환 → 현재 Turn 완료 → events 폴딩 → shutdown_ack 전송 → 종료.
   */
  drain(): Promise<void>;
}
```

### 5.4 이벤트 큐와 직렬 처리

**규칙:**

1. AgentProcess는 이벤트 큐를 가져야 한다(MUST).
2. AgentProcess의 이벤트 큐는 FIFO 순서로 직렬 처리되어야 한다(MUST).
3. 같은 AgentProcess에 대해 Turn을 동시에 실행해서는 안 된다(MUST NOT).
4. 서로 다른 AgentProcess는 독립 프로세스이므로 자연스럽게 병렬 실행된다.
5. `Swarm.policy.maxStepsPerTurn`을 적용할 수 있어야 한다(MAY).

```typescript
interface AgentEventQueue {
  /** 이벤트 추가 (FIFO) */
  enqueue(event: AgentEvent): void;

  /** 다음 이벤트 꺼내기 (없으면 null) */
  dequeue(): AgentEvent | null;

  /** 대기 중인 이벤트 수 */
  readonly length: number;

  /** 대기 중인 이벤트 목록 (읽기 전용) */
  peek(): readonly AgentEvent[];
}
```

### 5.5 AgentEvent 타입 (통합 이벤트 모델)

delegate와 connector event를 통합한 **단일 이벤트 모델**이다. 받는 에이전트 입장에서 이벤트의 출처(다른 에이전트, Connector, CLI)는 `source` 메타데이터일 뿐이며, 응답 여부는 `replyTo` 유무로 결정된다.

`AgentEvent`/`EventSource`/`ReplyChannel` 원형은 `docs/specs/shared-types.md` 5절을 따른다.

**이벤트 패턴별 통합 모델 표현:**

| 이벤트 패턴 | 통합 모델 표현 |
|-------------|----------------|
| 에이전트 요청 이벤트 | `source: { kind: 'agent' }` + `replyTo: { target, correlationId }` |
| 에이전트 응답 이벤트 | `source: { kind: 'agent' }` + `metadata.inReplyTo: correlationId` |
| 커넥터 입력 이벤트 | `source: { kind: 'connector', name: 'telegram', ... }` + `replyTo` 없음 |
| CLI 입력 이벤트 | `source: { kind: 'connector', name: 'cli' }` + `replyTo` 없음 |
| 이벤트 출처 모델 | `EventSource` (`kind` 필수) |

---

## 6. IPC (Inter-Process Communication)

에이전트 간 통신은 Orchestrator를 경유하는 메시지 패싱 방식을 사용한다.

### 6.1 IPC 메시지 타입

통합 이벤트 모델에 따라 IPC 메시지는 **3종**(`event`, `shutdown`, `shutdown_ack`)으로 구성하며, 에이전트 요청/응답은 `event` 타입의 `AgentEvent.replyTo`로 처리한다.

`IpcMessage`/`ShutdownReason` 원형은 `docs/specs/shared-types.md` 5절을 따른다.

**규칙:**

1. IPC 메시지는 `event`, `shutdown`, `shutdown_ack` 3종을 지원해야 한다(MUST).
2. 모든 IPC 메시지는 `from`, `to`, `payload`를 포함해야 한다(MUST).
3. `event` 타입의 `payload`는 `AgentEvent` 구조를 따라야 한다(MUST).
4. 에이전트 간 요청-응답은 `AgentEvent.replyTo.correlationId`로 매칭해야 한다(MUST).
5. `shutdown` 메시지의 `payload`는 `gracePeriodMs`와 `reason`을 포함해야 한다(MUST).
6. `shutdown_ack` 메시지는 AgentProcess가 drain 완료 후 Orchestrator에 전송해야 한다(MUST).

### 6.2 통합 이벤트 흐름

모든 에이전트 입력(Connector 이벤트, 에이전트 간 요청, CLI 입력)은 `AgentEvent`로 통합된다.

#### Connector → Agent (fire-and-forget)

```
ConnectorProcess → Orchestrator:
  { type: 'event', payload: {
      id: 'evt-1', type: 'user_message', input: 'Hello',
      source: { kind: 'connector', name: 'telegram', chat_id: '123' },
      replyTo: undefined   ← 응답 불필요
  }}

Orchestrator → AgentProcess:
  (Connection ingress 규칙에 따라 라우팅)
```

#### Agent → Agent (request + response)

```
1. AgentA → Orchestrator:
   { type: 'event', payload: {
       id: 'evt-2', type: 'request', input: 'Review this code',
       source: { kind: 'agent', name: 'coder' },
       replyTo: { target: 'coder', correlationId: 'corr-abc' }  ← 응답 기대
   }}

2. Orchestrator → AgentB로 라우팅 (필요시 스폰)

3. AgentB 처리 후 → Orchestrator:
   { type: 'event', payload: {
       id: 'evt-3', type: 'response', input: 'LGTM',
       source: { kind: 'agent', name: 'reviewer' },
       metadata: { inReplyTo: 'corr-abc' }
   }}

4. Orchestrator → correlationId 'corr-abc'를 대기 중인 AgentA로 전달
```

#### Agent → Agent (fire-and-forget)

```
AgentA → Orchestrator:
  { type: 'event', payload: {
      id: 'evt-4', type: 'notification', input: 'Build completed',
      source: { kind: 'agent', name: 'builder' },
      replyTo: undefined   ← 응답 불필요
  }}
```

**규칙:**

1. 에이전트 간 통신은 표준 Tool API(`agents__request`, `agents__send`) 또는 `turn`/`step` 미들웨어의 `ctx.agents.request/send`를 통해 요청되어야 하며, 두 경로 모두 Orchestrator IPC 라우팅을 재사용해야 한다(MUST).
2. 인스턴스 준비/조회/카탈로그 조회는 표준 Tool API(`agents__spawn`, `agents__list`, `agents__catalog`)를 통해 요청되어야 한다(MUST).
3. `replyTo`가 있는 이벤트를 수신한 AgentProcess는 Turn 완료 후 응답 이벤트를 전송해야 한다(MUST).
4. 응답 이벤트의 `metadata.inReplyTo`는 원본 `replyTo.correlationId`와 일치해야 한다(MUST).
5. `agents__spawn`의 target은 현재 Swarm에 정의된 Agent 리소스여야 한다(MUST).
6. `agents__spawn`은 리소스 정의(`goondan.yaml`)를 수정하지 않고 인스턴스 상태만 준비해야 한다(MUST).
7. Orchestrator는 대상 AgentProcess가 존재하지 않으면 자동 스폰해야 한다(MUST).
8. Orchestrator는 대상 Agent의 `instanceKey` 결정 규칙을 적용해야 한다(MUST).
9. Runtime은 `request` 호출에서 순환 요청 체인을 감지하면 즉시 오류를 반환해야 한다(MUST).
10. `request(async=false)`는 블로킹 응답을 직접 반환해야 한다(MUST).
11. `request(async=true)`는 즉시 ack를 반환하고, 실제 응답은 메시지 큐(inbox)에 적재해야 한다(MUST).
12. `request(async=true)` 응답은 수신 직후의 다음 Step 시작 전에 `conversationState`에 주입해야 하며, 다음 Turn까지 지연되면 안 된다(MUST).
13. `request(async=true)`로 주입된 메시지는 `metadata.__goondanInterAgentResponse`를 포함해야 한다(MUST).
14. 요청 실패는 구조화된 ToolCallResult(`status="error"`) 또는 미들웨어 예외로 반환해야 한다(MUST).

### 6.3 IPC 전송 메커니즘

IPC 전송 메커니즘은 Bun의 내장 IPC를 기본으로 사용한다.

```typescript
// Orchestrator → AgentProcess (자식 프로세스 스폰 시)
const proc = Bun.spawn(['bun', 'run', 'agent-runner.ts', ...args], {
  ipc(message) {
    // AgentProcess → Orchestrator 메시지 수신
    orchestrator.route(message);
  },
});

// Orchestrator → AgentProcess 메시지 전송
proc.send({ type: 'event', from: 'orchestrator', to: 'coder', payload: {...} });
```

**규칙:**

1. IPC 구현은 Bun의 `process.send`/`process.on("message")` 또는 Unix socket을 사용해야 한다(SHOULD).
2. IPC 메시지는 JSON 직렬화 가능해야 한다(MUST).
3. 메시지 순서가 보장되어야 한다(MUST).

---

## 7. Turn / Step

Turn과 Step은 **단일 AgentProcess 내에서** 실행되는 표준 실행 단위다.

### 7.1 Turn

Turn은 하나의 입력 이벤트 처리 단위이다.

- 입력: `AgentEvent` (통합 이벤트: Connector 이벤트, 에이전트 간 요청, CLI 입력 등)
- 출력: `TurnResult` (응답 메시지, 상태 변화)
- 복수 Step을 포함

**규칙:**

1. Turn은 하나의 `AgentEvent`를 입력으로 받아야 한다(MUST).
2. Turn은 하나 이상의 Step을 포함해야 한다(MUST).
3. Turn은 `TurnResult`를 출력으로 생성해야 한다(MUST).
4. Turn은 `running`, `completed`, `failed` 상태를 가져야 한다(MUST).

```typescript
interface Turn {
  /** Turn 고유 ID */
  readonly id: string;

  /** Agent 이름 */
  readonly agentName: string;

  /** 입력 이벤트 */
  readonly inputEvent: AgentEvent;

  /** 이 Turn의 메시지들 */
  readonly messages: Message[];

  /** 실행된 Step 목록 */
  readonly steps: Step[];

  /** Turn 상태 */
  status: 'running' | 'completed' | 'failed';

  /** Turn 메타데이터 (확장용) */
  metadata: Record<string, JsonValue>;
}
```

`TurnResult` 원형은 `docs/specs/shared-types.md` 7절을 따른다.

### 7.2 Step

Step은 단일 LLM 호출 단위이다.

- 도구 호출이 있으면 다음 Step 실행
- 텍스트 응답만 있으면 Turn 종료

**규칙:**

1. Step은 LLM에 메시지를 전달하고 응답을 받는 단위여야 한다(MUST).
2. LLM 응답에 도구 호출이 포함되면 도구를 실행한 뒤 다음 Step을 실행해야 한다(MUST).
3. LLM 응답이 텍스트 응답만 포함하면 Turn을 종료해야 한다(MUST).
4. Step은 Tool Catalog를 구성하여 LLM에 사용 가능한 도구 목록을 전달해야 한다(MUST).
5. Step은 Tool 핸들러를 AgentProcess 내부에서 호출해야 한다(MUST).
6. Step은 `llm_call`, `tool_exec`, `completed` 상태를 가져야 한다(MUST).

```typescript
interface Step {
  /** Step 고유 ID */
  readonly id: string;

  /** Step 인덱스 (Turn 내에서 0부터 시작) */
  readonly index: number;

  /** LLM에 노출된 Tool Catalog */
  readonly toolCatalog: ToolCatalogItem[];

  /** LLM이 요청한 Tool 호출 목록 */
  readonly toolCalls: ToolCall[];

  /** Tool 실행 결과 목록 */
  readonly toolResults: ToolCallResult[];

  /** Step 상태 */
  status: 'llm_call' | 'tool_exec' | 'completed';
}
```

### 7.3 Turn/Step 실행 루프 (의사 코드)

```typescript
async function runTurn(event: AgentEvent, state: ConversationState): Promise<TurnResult> {
  const turn: Turn = {
    id: generateId(),
    agentName: process.agentName,
    inputEvent: event,
    messages: [],
    steps: [],
    status: 'running',
    metadata: {},
  };

  // 입력 이벤트를 메시지로 변환하여 이벤트 발행
  state.emitMessageEvent({ type: 'append', message: createUserMessage(event.input) });

  let stepIndex = 0;
  while (true) {
    // Step 미들웨어 실행 (tool catalog 조작 등)
    const result = await runStep(stepIndex, state);
    // Core: shouldContinue 기본값 초기화 (미들웨어 post에서 override 가능)
    result.shouldContinue ??= result.toolCalls.length > 0;
    turn.steps.push(result);

    // shouldContinue가 false이면 Turn 종료
    if (!result.shouldContinue) {
      turn.status = 'completed';
      break;
    }

    // maxStepsPerTurn 검사
    stepIndex++;
    if (stepIndex >= maxStepsPerTurn) {
      turn.status = 'completed';
      break;
    }
  }

  // Turn 종료: events → base 폴딩
  await state.foldEventsToBase();

  return { turnId: turn.id, responseMessage: getLastAssistantMessage(turn), finishReason: 'text_response' };
}
```

### 7.4 Turn Source/Auth 컨텍스트

**규칙:**

1. Runtime은 Turn마다 `traceId`를 생성/보존해야 한다(MUST).
2. Runtime이 에이전트 간 이벤트를 생성할 때 `turn.auth`를 변경 없이 전달해야 한다(MUST).

> `TurnOrigin`은 `EventSource`(`5.5 AgentEvent 타입`)로 통합되었다. Turn의 호출 맥락은 `AgentEvent.source`에서 참조한다.

```typescript
import type { TurnAuth } from './shared-types';
```

`TurnAuth` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

### 7.5 TraceContext 전파

Runtime은 Turn/Step/Tool 실행 시 OTel 호환 `TraceContext`를 생성하고 전파한다. 전파 규칙의 SSOT는 `docs/specs/shared-types.md` 5절이다.

**Turn 시작 시:**
1. 입력 이벤트(`AgentEvent`)에 `traceId`가 있으면 그대로 사용한다(MUST). 없으면 새로 생성한다(MUST).
2. Turn에 대해 새 `spanId`를 생성한다(MUST).
3. 인터-에이전트 호출로 시작된 Turn의 경우, 호출자 Tool Call의 `spanId`를 `parentSpanId`로 설정한다(MUST). 외부 입력(Connector, CLI)이면 `parentSpanId`는 없다.

**Step 시작 시:**
1. Step에 대해 새 `spanId`를 생성한다(MUST).
2. `parentSpanId`는 Turn의 `spanId`로 설정한다(MUST).

**Tool Call 시작 시:**
1. 각 Tool Call에 대해 새 `spanId`를 생성한다(MUST).
2. `parentSpanId`는 Step의 `spanId`로 설정한다(MUST).

**인터-에이전트 호출 시:**
1. `traceId`를 피호출자에게 전달한다(MUST). **절대 재생성하지 않는다.**
2. 호출자의 Tool Call `spanId`를 피호출자의 Turn `parentSpanId`로 전달한다(MUST).

**예시 흐름:**
```
[Connector Event] traceId=aaa, spanId=없음
  +-- [Agent A Turn] traceId=aaa, spanId=bbb, parentSpanId=없음
       +-- [Step 0] traceId=aaa, spanId=ccc, parentSpanId=bbb
            +-- [Tool: agents__request] traceId=aaa, spanId=ddd, parentSpanId=ccc
                 +-- [Agent B Turn] traceId=aaa, spanId=eee, parentSpanId=ddd
                      +-- [Step 0] traceId=aaa, spanId=fff, parentSpanId=eee
```

---

## 8. Message

메시지 처리의 **실행 규칙**(이벤트 적용 순서, 폴딩 시점, 복원)은 이 문서가 소유한다.
파일 경로/디렉터리 레이아웃 같은 **저장 규칙**은 `docs/specs/workspace.md`를 단일 기준으로 따른다.

### 8.1 핵심 타입

모든 LLM 메시지는 AI SDK의 메시지 형식(`CoreMessage`)을 사용하되, `Message`로 감싸서 관리한다.

`Message`/`MessageSource` 원형은 `docs/specs/shared-types.md` 4절을 따른다.

**규칙:**

1. `Message`는 고유 `id`, AI SDK `CoreMessage`를 담는 `data`, 메타데이터 `metadata`, 생성 시각 `createdAt`, 생성 주체 `source`를 포함해야 한다(MUST).
2. `source`는 `user`, `assistant`, `tool`, `system`, `extension` 타입 중 하나여야 한다(MUST).
3. `metadata`는 Extension/미들웨어가 읽고 쓸 수 있는 자유 형식 키-값 저장소여야 한다(MUST).
4. `id`는 Turn 범위에서 고유해야 하며, `replace`/`remove` 이벤트의 참조 키로 사용되어야 한다(MUST).

### 8.2 메시지 상태 모델 (이벤트 소싱)

Turn의 LLM 입력 메시지는 다음 규칙으로 계산되어야 한다(MUST).

```
NextMessages = BaseMessages + SUM(Events)
```

- `BaseMessages`: Turn 시작 시점에 로드된 확정 메시지 집합(`messages/base.jsonl`)
- `Events`: Turn 동안 누적되는 `MessageEvent` 집합(`messages/events.jsonl`)
- `RuntimeEvents`: Turn/Step/Tool 실행 관측 이벤트 집합(`messages/runtime-events.jsonl`, 메시지 상태 계산에는 미포함)

```typescript
interface RuntimeConversationState extends ConversationState {
  /** MessageEvent 발행 */
  emitMessageEvent(event: MessageEvent): void;

  /** Turn 종료 시 events → base 폴딩 */
  foldEventsToBase(): Promise<void>;
}
```

`MessageEvent`/`ConversationState` 원형은 `docs/specs/shared-types.md` 4절을 따른다.

### 8.3 MessageEvent 타입

**규칙:**

1. `append`: 새로운 `Message`를 메시지 목록 끝에 추가한다(MUST).
2. `replace`: `targetId`로 지정된 기존 메시지를 새 `Message`로 교체한다(MUST).
3. `remove`: `targetId`로 지정된 메시지를 제거한다(MUST).
4. `truncate`: 모든 메시지를 제거한다(MUST).

### 8.4 Turn 메시지 라이프사이클

**규칙:**

1. Turn 시작 시 Runtime은 `BaseMessages`를 로드하고 이를 초기 LLM 입력으로 사용해야 한다(MUST).
2. Turn 진행 중 발생하는 메시지 변경은 직접 배열 수정이 아니라 `MessageEvent` 발행으로 기록해야 한다(MUST).
3. LLM 출력 메시지는 `append` 이벤트로 기록되어야 한다(MUST).
4. 메시지 편집/삭제/요약은 `replace`/`remove`/`truncate` 이벤트로 기록되어야 한다(MUST).
5. Turn 종료 시 미들웨어(`turn` 미들웨어의 `next()` 이후)에서 추가 MessageEvent를 발행할 수 있어야 한다(MUST).
6. 모든 Turn 미들웨어 종료 후 Runtime은 `BaseMessages + SUM(Events)`를 새 base로 저장해야 한다(MUST).
7. 새 base 저장이 완료되면 적용된 `Events`를 비워야 한다(MUST).

### 8.5 적용/복원 규칙

**규칙:**

1. `SUM(Events)`는 기록 순서(append order)대로 결정론적으로 적용되어야 한다(MUST).
2. `replace`/`remove` 대상 `targetId`가 존재하지 않는 경우 Runtime은 Turn 전체를 즉시 실패시키지 않고 구조화된 경고 이벤트를 남겨야 한다(SHOULD).
3. Runtime 재시작 시 미처리 `Events`가 남아 있으면 `BaseMessages + SUM(Events)`를 재계산해 Turn 상태를 복원해야 한다(MUST).

### 8.6 이벤트 소싱의 이점

- **복구**: `base + events` 재생으로 정확한 상태 복원
- **관찰**: 모든 메시지 변경이 이벤트로 추적됨
- **Extension 조작**: 미들웨어에서 이벤트를 발행하여 메시지 조작 (직접 배열 변경 대신)
- **Compaction**: 주기적으로 `events → base` 폴딩으로 정리

### 8.7 영속화

`messages/base.jsonl`/`messages/events.jsonl`/`messages/runtime-events.jsonl` 경로 및 파일 레이아웃의 단일 기준은 `docs/specs/workspace.md` 7.3절이다.
Runtime은 해당 저장소 위에서 다음 실행 규칙만 보장한다(MUST).

1. Turn 종료 시 `events -> base` 폴딩을 수행한다.
2. 폴딩 성공 후 `events`를 비운다.
3. 재시작 시 미처리 `events`가 남아 있으면 `Base + SUM(Events)`로 복원한다.
4. Turn/Step/Tool 런타임 이벤트(`turn.*`, `step.*`, `tool.*`)를 `runtime-events`에 append-only로 기록한다.
5. `runtime-events`는 메시지 상태 복원(`Base + SUM(Events)`)의 입력으로 사용하지 않는다.

### 8.8 Middleware에서의 활용

Extension은 미들웨어에서 `ConversationState`를 받아 metadata 기반으로 이벤트를 발행하여 조작한다.

```typescript
// 예: message-compaction extension이 turn 시작 전 오래된 메시지를 요약으로 대체
api.pipeline.register('turn', async (ctx) => {
  const { nextMessages } = ctx.conversationState;

  // metadata로 "요약 가능" 메시지 식별
  const compactable = nextMessages.filter(
    m => m.metadata['compaction.eligible'] === true
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

---

## 9. Edit & Restart (설정 변경 모델)

Runtime은 **Edit & Restart** 모델을 채택한다.

### 9.1 Edit & Restart 동작 방식

```
1. goondan.yaml (또는 개별 리소스 파일) 수정
2. Orchestrator가 설정 변경을 감지하거나 명령을 수신
3. Orchestrator가 해당 에이전트 프로세스에 graceful shutdown → 새 설정으로 re-spawn
```

**규칙:**

1. 설정 변경은 `goondan.yaml` 또는 개별 리소스 파일을 직접 수정하는 방식으로 수행해야 한다(MUST).
2. Orchestrator는 설정 변경을 감지하거나 외부 명령을 수신하여 에이전트 프로세스를 재시작해야 한다(MUST).
3. 재시작 시 Orchestrator는 해당 AgentProcess에 graceful shutdown을 수행한 뒤 새 설정으로 re-spawn해야 한다(MUST). Graceful shutdown 프로토콜은 `4.6 Graceful Shutdown Protocol`을 따른다.

### 9.2 재시작 트리거

| 트리거 | 설명 |
|--------|------|
| `--watch` 모드 | Orchestrator가 파일 변경을 감지하면 영향받는 AgentProcess를 graceful shutdown 후 자동 재시작(MUST) |
| CLI 명령 | `gdn restart`를 통해 실행 중인 Orchestrator에 재시작 신호 전송(MUST) |
| 크래시 감지 | Orchestrator Reconciliation Loop(`4.5 Reconciliation Loop`)가 비정상 종료를 감지하고 백오프 정책에 따라 재스폰(SHOULD) |

### 9.3 재시작 옵션

```typescript
interface RestartOptions {
  /** 특정 에이전트만 재시작. 생략 시 전체 */
  agent?: string;

  /** 대화 히스토리 초기화 */
  fresh?: boolean;
}
```

**규칙:**

1. `--agent <name>` 옵션으로 특정 Agent의 프로세스만 재시작할 수 있어야 한다(MUST). 생략 시 전체 AgentProcess를 재시작한다.
2. `--fresh` 옵션으로 대화 히스토리를 초기화하고 재시작할 수 있어야 한다(MUST).
3. 기본 동작은 기존 메시지 히스토리를 유지한 채 새 설정으로 계속 실행하는 것이어야 한다(MUST).

### 9.4 Watch 모드

```bash
gdn run --watch   # goondan.yaml/리소스 파일 변경 시 해당 에이전트 자동 restart
```

**규칙:**

1. Orchestrator가 `--watch` 플래그로 기동되면 `goondan.yaml` 및 관련 리소스 파일의 변경을 감시해야 한다(MUST).
2. Orchestrator는 어떤 리소스가 변경되었는지 파악하여 영향받는 AgentProcess만 선택적으로 재시작해야 한다(MUST).
3. Tool/Extension/Connector entry 파일 변경 시에도 해당 프로세스를 재시작해야 한다(SHOULD).

**영향 범위 기반 선택적 재시작:**

| 변경 대상 | 영향 범위 | 재시작 대상 |
|-----------|-----------|-------------|
| Agent 리소스 | 해당 Agent만 | 해당 Agent의 모든 AgentProcess |
| Tool 리소스 또는 entry 파일 | 해당 Tool을 사용하는 Agent | Tool을 참조하는 Agent의 AgentProcess |
| Extension 리소스 또는 entry 파일 | 해당 Extension을 사용하는 Agent | Extension을 참조하는 Agent의 AgentProcess |
| Connector 리소스 또는 entry 파일 | 해당 Connector | 해당 ConnectorProcess |
| Connection 리소스 | 해당 Connection이 참조하는 Connector | 해당 ConnectorProcess |
| Swarm 리소스 | 전체 | 모든 AgentProcess + ConnectorProcess |
| `goondan.yaml` (Bundle 루트) | 전체 | Config 재로딩 후 전체 재시작 |

4. Self-modification 시나리오: 에이전트가 자기 Agent 리소스 manifest를 수정하면, watch 모드가 변경을 감지하고 해당 에이전트 프로세스만 graceful restart한다(MUST). 메시지 히스토리는 유지된다.

---

## 10. 인스턴스 관리

### 10.1 인스턴스 운영

인스턴스 운영은 `restart`와 `delete` 중심으로 수행한다.

**규칙:**

1. 구현은 인스턴스 운영 연산(`list`, `delete`)을 제공해야 한다(MUST).
2. `delete`는 인스턴스 상태(메시지 히스토리, Extension 상태)를 제거해야 한다(MUST).
3. TTL/idle 기반 자동 정리는 정책으로 제공하는 것을 권장한다(SHOULD).
4. CLI를 제공하는 구현은 위 연산을 사람이 재현 가능하고 스크립트 가능한 형태로 노출해야 한다(SHOULD).

### 10.2 TypeScript 인터페이스

```typescript
interface InstanceManager {
  /**
   * 인스턴스 목록 조회
   */
  list(): Promise<InstanceInfo[]>;

  /**
   * 인스턴스 삭제
   * - MUST: 인스턴스 상태(메시지 히스토리, Extension 상태)를 제거
   * - MUST: 시스템 전역 상태는 보존
   */
  delete(instanceKey: string): Promise<void>;
}

interface InstanceInfo {
  /** 인스턴스 키 */
  readonly instanceKey: string;

  /** Agent 이름 */
  readonly agentName: string;

  /** 인스턴스 상태 */
  readonly status: 'idle' | 'processing';

  /** 생성 시각 */
  readonly createdAt: string;

  /** 마지막 갱신 시각 */
  readonly updatedAt: string;
}
```

---

## 11. Connector / Connection 연동

### 11.1 ConnectorProcess

Connector는 **별도 Bun 프로세스**로 실행되며, 프로토콜 수신(HTTP 서버, cron 스케줄러, WebSocket 등)을 **자체적으로** 관리한다.

`ConnectorContext`/`ConnectorEvent` 원형은 `docs/specs/connector.md` 5.2~5.3절을 따른다.
Runtime 관점의 핵심 제약은 `instanceKey` 기반 라우팅 가능성이다.

**규칙:**

1. ConnectorProcess는 Orchestrator가 스폰하고 감시한다(MUST).
2. ConnectorProcess는 프로토콜 처리를 직접 구현해야 한다(MUST). Runtime이 프로토콜을 대신 관리하지 않는다.
3. ConnectorProcess는 정규화된 `ConnectorEvent`를 `ctx.emit()`으로 Orchestrator에 전달해야 한다(MUST).
4. ConnectorEvent는 `instanceKey`를 포함하여 Orchestrator가 적절한 AgentProcess로 라우팅할 수 있게 해야 한다(MUST).

### 11.2 Connector 핸들러 예시

```typescript
// connectors/telegram/index.ts
export default async function (ctx: ConnectorContext): Promise<void> {
  const { emit, config, logger } = ctx;

  Bun.serve({
    port: Number(config.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();

      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.message.text },
        properties: { chat_id: String(body.message.chat.id) },
        instanceKey: `telegram:${body.message.chat.id}`,
      });

      return new Response('OK');
    },
  });

  logger.info('Telegram connector listening on port', Number(config.PORT) || 3000);
};
```

---

## 12. Observability

O11y 이벤트 발행은 AgentProcess(Core)의 책임이다. Extension은 자기가 등록된 파이프라인 안에서만 관측 가능하고, 프로세스 간 통신이나 Orchestrator 레벨의 이벤트는 볼 수 없으므로, 인과 체인 추적은 Core가 담당한다.

### 12.1 TraceContext 기반 관측 모델

Runtime은 OTel(OpenTelemetry) 호환 `TraceContext`를 사용하여 에이전트 스웜 실행의 인과 체인을 추적한다.

`TraceContext` 타입과 전파 규칙의 SSOT는 `docs/specs/shared-types.md` 5절이다.

**핵심 원칙:**
1. `traceId`는 최초 입력 시점에 한 번 생성되고, 인터-에이전트 호출을 포함한 전체 실행 체인에서 절대 재생성하지 않는다.
2. 각 실행 단위(Turn, Step, Tool Call)는 새 `spanId`를 생성하되, `parentSpanId`로 상위와 연결한다.
3. 모든 `RuntimeEvent`에 `traceId`, `spanId`, `parentSpanId`를 포함한다.

### 12.2 RuntimeEvent 계약

RuntimeEvent 타입 정의의 SSOT는 `docs/specs/shared-types.md` 9절이다. 이 문서에서는 발행 타이밍과 규칙만 다룬다.

**발행 타이밍:**

| 이벤트 | 발행 시점 |
|--------|-----------|
| `turn.started` | AgentProcess가 이벤트 큐에서 AgentEvent를 dequeue하여 Turn을 시작할 때 |
| `turn.completed` | Turn의 모든 Step이 완료되고 events -> base 폴딩 전 |
| `turn.failed` | Turn 실행 중 복구 불가능한 에러 발생 시 |
| `step.started` | Step 시작 시 (LLM 호출 전) |
| `step.completed` | Step의 LLM 호출과 모든 Tool 실행이 완료될 때 |
| `step.failed` | Step 실행 중 에러 발생 시 |
| `tool.called` | Tool 핸들러 호출 직전 |
| `tool.completed` | Tool 핸들러가 정상 완료되거나 에러를 반환할 때 |
| `tool.failed` | Tool 핸들러 실행 중 예외 발생 시 |

### 12.3 로깅 규칙

**규칙:**

1. Runtime은 Turn/Step/ToolCall 로그에 `traceId`와 `spanId`를 포함해야 한다(MUST).
2. Runtime은 최소 `latencyMs`, `toolCallCount`, `errorCount`, `tokenUsage`(promptTokens/completionTokens/totalTokens)를 기록해야 한다(SHOULD).
3. 민감값(access token, refresh token, secret)은 로그/메트릭에 평문으로 포함되어서는 안 된다(MUST).
4. 각 프로세스(Orchestrator, AgentProcess, ConnectorProcess)는 stdout/stderr로 구조화된 로그를 출력해야 한다(SHOULD).
5. Runtime 상태 점검(health check) 인터페이스를 제공하는 것을 권장한다(SHOULD).
6. `turn.completed`의 `stepCount`는 실제 실행된 Step 수를 반영해야 한다(MUST). 항상 0으로 emit하는 것은 버그이다.
7. `turn.completed`에 `tokenUsage`를 포함하는 것을 권장한다(SHOULD).

### 12.4 프로세스별 로깅 모델

프로세스별 로그는 stdout/stderr 기반으로 기록한다.

**규칙:**

1. Orchestrator, AgentProcess, ConnectorProcess는 각각 stdout/stderr로 구조화된 로그를 출력해야 한다(SHOULD).
2. Orchestrator는 자식 프로세스의 stdout/stderr을 수집하여 통합 로그 출력을 제공할 수 있어야 한다(MAY).
3. 로그에는 프로세스 식별 정보(agentName, instanceKey 등)와 `traceId`, `spanId`를 포함해야 한다(SHOULD).

### 12.5 구조화된 로그 형식 예시

```json
{"level":"info","timestamp":"2026-02-05T10:30:00Z","traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"1a2b3c4d5e6f7a8b","agent":"coder","instanceKey":"user:123","event":"turn.started","turnId":"turn-001"}
{"level":"info","timestamp":"2026-02-05T10:30:01Z","traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"2b3c4d5e6f7a8b9c","parentSpanId":"1a2b3c4d5e6f7a8b","agent":"coder","instanceKey":"user:123","event":"step.started","turnId":"turn-001","stepIndex":0}
{"level":"info","timestamp":"2026-02-05T10:30:02Z","traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"3c4d5e6f7a8b9c0d","parentSpanId":"2b3c4d5e6f7a8b9c","agent":"coder","instanceKey":"user:123","event":"tool.called","turnId":"turn-001","toolName":"bash__exec"}
{"level":"info","timestamp":"2026-02-05T10:30:03Z","traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"1a2b3c4d5e6f7a8b","agent":"coder","instanceKey":"user:123","event":"turn.completed","turnId":"turn-001","duration":3000,"stepCount":1,"tokenUsage":{"promptTokens":150,"completionTokens":30,"totalTokens":180}}
```

### 12.6 Runtime Event Stream 영속화

Runtime은 관측성 이벤트를 인스턴스별 `messages/runtime-events.jsonl`에 append-only로 기록한다.

- 이벤트 종류: `turn.started/completed/failed`, `step.started/completed/failed`, `tool.called/completed/failed`
- 모든 레코드에 `traceId`, `spanId`를 포함한다(MUST). `parentSpanId`는 root span을 제외하고 포함한다(MUST).
- 모든 레코드에 `instanceKey`를 포함한다(MUST).
- `step.started`는 관측 목적의 LLM 입력 메시지 요약(`llmInputMessages[]`)을 선택적으로 포함할 수 있다(MAY).
- 레코드 단위: JSONL 1라인 1이벤트
- 목적: Studio/운영 관측성 (메시지 상태 계산과 분리)
- 이벤트 이름은 dot notation을 사용한다(MUST). `toolCall`(camelCase)이 아닌 `tool.called`(dot notation)을 사용한다.

```jsonl
{"type":"turn.started","timestamp":"2026-02-18T10:00:00.000Z","agentName":"assistant","instanceKey":"local","turnId":"turn-001","traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"1a2b3c4d5e6f7a8b"}
{"type":"step.started","timestamp":"2026-02-18T10:00:00.120Z","agentName":"assistant","instanceKey":"local","stepId":"turn-001-step-0","stepIndex":0,"turnId":"turn-001","traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"2b3c4d5e6f7a8b9c","parentSpanId":"1a2b3c4d5e6f7a8b","llmInputMessages":[{"role":"system","content":"You are assistant."},{"role":"user","content":"hello"}]}
{"type":"tool.called","timestamp":"2026-02-18T10:00:00.350Z","agentName":"assistant","instanceKey":"local","toolCallId":"call-1","toolName":"bash__exec","stepId":"turn-001-step-0","turnId":"turn-001","traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"3c4d5e6f7a8b9c0d","parentSpanId":"2b3c4d5e6f7a8b9c"}
{"type":"tool.completed","timestamp":"2026-02-18T10:00:00.640Z","agentName":"assistant","instanceKey":"local","toolCallId":"call-1","toolName":"bash__exec","status":"ok","duration":290,"stepId":"turn-001-step-0","turnId":"turn-001","traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"3c4d5e6f7a8b9c0d","parentSpanId":"2b3c4d5e6f7a8b9c"}
{"type":"turn.completed","timestamp":"2026-02-18T10:00:01.200Z","agentName":"assistant","instanceKey":"local","turnId":"turn-001","stepCount":1,"duration":1200,"traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"1a2b3c4d5e6f7a8b","tokenUsage":{"promptTokens":150,"completionTokens":30,"totalTokens":180}}
```

---

## 13. Tool 관련 타입

### 13.1 ToolCatalogItem

`ToolCatalogItem` 원형은 `docs/specs/tool.md` 13절을 따른다.

### 13.2 ToolCall / ToolCallResult

`ToolCall`/`ToolCallResult` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

### 13.3 ToolHandler / ToolContext

`ToolHandler`/`ToolContext` 원형은 `docs/specs/shared-types.md` 6절을 따른다.

---

## 14. 규칙 요약

상세 규범 규칙은 중복 요약 없이 본문 섹션을 단일 기준으로 참조한다.

- 프로세스/라우팅/복구: `2.1`, `4.5`, `4.6`
- IPC 계약: `2.3`, `6.1`, `6.2`
- Turn/Step 실행 규칙: `2.4`, `7`
- 메시지 상태 실행 규칙: `2.5`, `8.2`, `8.5`
- 런타임 경계/정책 분리: `2.8`, `8.8`
- 편집/재시작 모델: `2.7`, `9`
- 관찰성/보안: `2.6`, `12`

---

## 부록 A. 관련 문서

- `docs/specs/workspace.md`: Workspace 및 Storage 모델 스펙
- `docs/specs/cli.md`: CLI 도구(gdn) 스펙
- `docs/specs/pipeline.md`: 라이프사이클 파이프라인(훅) 스펙
- `docs/specs/tool.md`: Tool 시스템 스펙
- `docs/specs/extension.md`: Extension 시스템 스펙
- `docs/specs/connector.md`: Connector 시스템 스펙
- `docs/specs/connection.md`: Connection 시스템 스펙
- `docs/specs/api.md`: Runtime/SDK API 스펙
- `docs/specs/bundle.md`: Bundle YAML 스펙

---

**문서 버전**: v0.0.3
**최종 수정**: 2026-02-20
