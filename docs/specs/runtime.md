# Goondan Runtime 실행 모델 스펙 (v2.0)

> 이 문서는 Goondan v2 Runtime의 유일한 source of truth이다. Config/Bundle 스펙은 `docs/specs/bundle.md`를, API 스펙은 `docs/specs/api.md`를 따른다.

---

## 1. 개요

### 1.1 배경 및 설계 동기

Goondan v2 Runtime은 **Process-per-Agent** 아키텍처를 채택한다. v1의 단일 프로세스 내 다중 AgentInstance 모델은 하나의 에이전트 크래시가 전체 Swarm에 영향을 주는 문제가 있었고, 에이전트별 독립적인 메모리 공간과 스케일링이 불가능했다.

v2에서는 Orchestrator가 **상주 프로세스**로 전체 Swarm의 생명주기를 관리하고, 각 AgentInstance와 Connector는 **독립 Bun 프로세스**로 실행된다. 이를 통해:

- **크래시 격리**: 개별 에이전트의 비정상 종료가 다른 에이전트에 영향을 주지 않는다.
- **독립 스케일링**: 각 에이전트 프로세스가 독립적으로 자원을 사용하고 관리된다.
- **단순한 재시작**: 설정 변경 시 영향받는 프로세스만 선택적으로 재시작할 수 있다.

또한 v1의 Changeset/SwarmBundleRef 기반 자기 수정 패턴을 제거하고, **Edit & Restart** 모델로 단순화했다. `goondan.yaml`을 직접 수정하고 Orchestrator가 프로세스를 재시작하는 방식으로, 개발자 경험을 크게 개선한다.

메시지 상태 관리는 **이벤트 소싱**을 유지한다. `NextMessages = BaseMessages + SUM(Events)` 규칙으로 메시지 상태를 결정론적으로 계산하며, 이는 복구, 관찰, Extension 기반 메시지 조작, Compaction을 가능하게 한다.

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
| **Edit & Restart** | Changeset/SwarmBundleRef 제거. `goondan.yaml` 수정 후 Orchestrator가 에이전트 프로세스 재시작 |
| **Message** | AI SDK 메시지를 감싸는 단일 래퍼. 메타데이터로 메시지 식별/조작 |
| **Middleware Pipeline** | 모든 파이프라인 훅은 Middleware 형태. `next()` 호출 전후로 전처리/후처리 |

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

### 2.2 AgentProcess 규칙

1. 각 AgentProcess는 독립된 메모리 공간에서 실행되어야 한다(MUST). 크래시 격리를 보장한다.
2. AgentProcess는 Orchestrator와 IPC를 통해 통신해야 한다(MUST).
3. AgentProcess는 독립적인 Turn/Step 루프를 실행해야 한다(MUST).
4. AgentProcess의 이벤트 큐는 FIFO 순서로 직렬 처리되어야 한다(MUST).
5. 같은 AgentProcess에 대해 Turn을 동시에 실행해서는 안 된다(MUST NOT).
6. AgentProcess가 비정상 종료(크래시)되면 Orchestrator가 자동 재스폰할 수 있어야 한다(SHOULD).

### 2.3 IPC 규칙

1. IPC 메시지는 최소 `delegate`, `delegate_result`, `event`, `shutdown` 타입을 지원해야 한다(MUST).
2. 모든 IPC 메시지는 `from`, `to`, `payload`를 포함해야 한다(MUST).
3. `delegate`와 `delegate_result`는 `correlationId`를 포함하여 요청-응답을 매칭할 수 있어야 한다(MUST).
4. IPC 메시지는 JSON 직렬화 가능해야 한다(MUST).
5. 메시지 순서가 보장되어야 한다(MUST).

### 2.4 Turn/Step 규칙

1. Turn은 하나의 `AgentEvent`를 입력으로 받아야 한다(MUST).
2. Turn은 하나 이상의 Step을 포함해야 한다(MUST).
3. Turn은 `TurnResult`를 출력으로 생성해야 한다(MUST).
4. Step은 LLM에 메시지를 전달하고 응답을 받는 단위여야 한다(MUST).
5. LLM 응답에 도구 호출이 포함되면 도구를 실행한 뒤 다음 Step을 실행해야 한다(MUST).
6. LLM 응답이 텍스트 응답만 포함하면 Turn을 종료해야 한다(MUST).
7. Runtime은 Turn마다 `traceId`를 생성/보존해야 한다(MUST).
8. Runtime이 Handoff를 위해 내부 이벤트를 생성할 때 `turn.auth`를 변경 없이 전달해야 한다(MUST).

### 2.5 메시지 상태 규칙

1. Turn의 LLM 입력 메시지는 `NextMessages = BaseMessages + SUM(Events)` 규칙으로 계산되어야 한다(MUST).
2. Turn 진행 중 발생하는 메시지 변경은 직접 배열 수정이 아니라 `MessageEvent` 발행으로 기록해야 한다(MUST).
3. 모든 Turn 미들웨어 종료 후 Runtime은 `BaseMessages + SUM(Events)`를 새 base로 저장해야 한다(MUST).
4. 새 base 저장이 완료되면 적용된 `Events`를 비워야 한다(MUST).
5. Runtime 재시작 시 미처리 `Events`가 남아 있으면 재계산해 Turn 상태를 복원해야 한다(MUST).
6. `replace`/`remove` 대상 `targetId`가 존재하지 않는 경우 Runtime은 구조화된 경고 이벤트를 남겨야 한다(SHOULD).

### 2.6 Observability 규칙

1. Runtime은 Turn/Step/ToolCall 로그에 `traceId`를 포함해야 한다(MUST).
2. 민감값(access token, refresh token, secret)은 로그/메트릭에 평문으로 포함되어서는 안 된다(MUST).
3. Runtime은 최소 `latencyMs`, `toolCallCount`, `errorCount`, `tokenUsage`를 기록해야 한다(SHOULD).
4. Runtime 상태 점검(health check) 인터페이스를 제공하는 것을 권장한다(SHOULD).

### 2.7 Edit & Restart 규칙

1. 설정 변경은 `goondan.yaml` 또는 개별 리소스 파일을 직접 수정하는 방식으로 수행해야 한다(MUST).
2. Orchestrator는 설정 변경을 감지하거나 외부 명령을 수신하여 에이전트 프로세스를 재시작해야 한다(MUST).
3. 재시작 시 Orchestrator는 해당 AgentProcess를 kill한 뒤 새 설정으로 re-spawn해야 한다(MUST).
4. 기본 동작은 기존 메시지 히스토리를 유지한 채 새 설정으로 계속 실행하는 것이어야 한다(MUST).

---

## 3. 핵심 타입 정의

### 3.1 공통 타입

```typescript
/**
 * JSON 호환 기본 타입
 */
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

/**
 * 리소스 참조 타입
 * - 문자열 축약: "Kind/name"
 * - 객체형: { apiVersion?, kind, name }
 */
type ObjectRefLike =
  | string
  | { apiVersion?: string; kind: string; name: string };

/**
 * Config Plane 리소스 공통 형태
 */
interface Resource<TSpec> {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: TSpec;
}

/**
 * 고유 식별자 생성 함수 시그니처
 */
type IdGenerator = () => string;
```

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
  readonly status: 'starting' | 'idle' | 'processing' | 'terminated';

  /** IPC 메시지 전송 */
  send(message: IpcMessage): void;

  /** 프로세스 종료 */
  kill(): void;
}
```

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
  readonly status: 'idle' | 'processing' | 'terminated';

  /** 대화 히스토리 */
  readonly conversationHistory: Message[];
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

### 5.5 AgentEvent 타입

```typescript
/**
 * AgentEvent: AgentProcess로 전달되는 이벤트
 */
interface AgentEvent {
  /** 이벤트 ID */
  readonly id: string;

  /** 이벤트 타입 */
  readonly type: AgentEventType;

  /** 입력 텍스트 (user input 등) */
  readonly input?: string;

  /** 호출 맥락 (Connector 정보 등) */
  readonly origin?: TurnOrigin;

  /** 인증 컨텍스트 */
  readonly auth?: TurnAuth;

  /** 이벤트 메타데이터 */
  readonly metadata?: JsonObject;

  /** 이벤트 생성 시각 */
  readonly createdAt: Date;
}

type AgentEventType =
  | 'user.input'             // 사용자 입력
  | 'connector.event'        // Connector에서 전달된 이벤트
  | 'agent.delegate'         // 다른 에이전트로부터 위임
  | 'agent.delegationResult' // 위임 결과 반환
  | 'system.wakeup'          // 시스템 재개
  | string;                  // 확장 이벤트 타입
```

---

## 6. IPC (Inter-Process Communication)

에이전트 간 통신은 Orchestrator를 경유하는 메시지 패싱 방식을 사용한다.

### 6.1 IPC 메시지 타입

```typescript
interface IpcMessage {
  /** 메시지 타입 */
  type: 'delegate' | 'delegate_result' | 'event' | 'shutdown';

  /** 발신 Agent 이름 */
  from: string;

  /** 수신 Agent 이름 */
  to: string;

  /** 메시지 페이로드 */
  payload: JsonValue;

  /** 요청-응답 매칭용 상관 ID */
  correlationId?: string;
}
```

**규칙:**

1. IPC 메시지는 최소 `delegate`, `delegate_result`, `event`, `shutdown` 타입을 지원해야 한다(MUST).
2. 모든 IPC 메시지는 `from`(발신 Agent), `to`(수신 Agent), `payload`를 포함해야 한다(MUST).
3. `delegate`와 `delegate_result`는 `correlationId`를 포함하여 요청-응답을 매칭할 수 있어야 한다(MUST).

### 6.2 위임(Delegate) 흐름

Handoff는 IPC를 통한 도구 호출 기반 비동기 패턴으로 제공한다.

```
1. AgentA → Orchestrator:
   { type: 'delegate', to: 'AgentB', payload: {...}, correlationId: '...' }

2. Orchestrator → AgentB 프로세스로 라우팅 (필요시 스폰)

3. AgentB 처리 후 → Orchestrator:
   { type: 'delegate_result', to: 'AgentA', correlationId: '...', payload: {...} }

4. Orchestrator → AgentA로 결과 전달
```

**규칙:**

1. Handoff는 표준 Tool API를 통해 요청되어야 한다(MUST).
2. 최소 입력으로 대상 Agent 식별자와 입력 프롬프트를 포함해야 한다(MUST).
3. 추가 context 전달 필드를 지원할 수 있다(MAY).
4. Handoff 요청 후 원래 Agent는 상태를 종료하지 않고 비동기 응답을 대기할 수 있어야 한다(SHOULD).
5. Handoff 결과는 동일 Turn 또는 후속 Turn에서 구조화된 메시지로 합류되어야 한다(SHOULD).
6. Orchestrator는 위임 대상 Agent의 `instanceKey` 결정 규칙을 적용해야 한다(MUST).

### 6.3 IPC 전송 메커니즘

v2에서는 Bun의 내장 IPC를 기본으로 사용한다.

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

Turn과 Step은 기존과 동일한 개념이나, **단일 AgentProcess 내에서** 실행된다.

### 7.1 Turn

Turn은 하나의 입력 이벤트 처리 단위이다.

- 입력: `AgentEvent` (사용자 메시지, delegate, ConnectorEvent 등)
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

interface TurnResult {
  /** Turn ID */
  readonly turnId: string;

  /** 최종 응답 메시지 */
  readonly responseMessage?: Message;

  /** Turn 종료 사유 */
  readonly finishReason: 'text_response' | 'max_steps' | 'error';

  /** 오류 정보 (실패 시) */
  readonly error?: {
    message: string;
    code?: string;
  };
}
```

### 7.2 Step

Step은 단일 LLM 호출 단위이다.

- 도구 호출이 있으면 다음 Step 실행
- 텍스트 응답만 있으면 Turn 종료

**규칙:**

1. Step은 LLM에 메시지를 전달하고 응답을 받는 단위여야 한다(MUST).
2. LLM 응답에 도구 호출이 포함되면 도구를 실행한 뒤 다음 Step을 실행해야 한다(MUST).
3. LLM 응답이 텍스트 응답만 포함하면 Turn을 종료해야 한다(MUST).
4. Step은 Tool Catalog를 구성하여 LLM에 사용 가능한 도구 목록을 전달해야 한다(MUST).
5. Step은 `llm_call`, `tool_exec`, `completed` 상태를 가져야 한다(MUST).

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
  readonly toolResults: ToolResult[];

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
  state.emitEvent({ type: 'append', message: createUserMessage(event.input) });

  let stepIndex = 0;
  while (true) {
    // Step 미들웨어 실행 (tool catalog 조작 등)
    const step = await runStep(stepIndex, state);
    turn.steps.push(step);

    // LLM 응답이 텍스트만이면 Turn 종료
    if (step.toolCalls.length === 0) {
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

### 7.4 Turn Origin/Auth 컨텍스트

**규칙:**

1. Runtime은 Turn마다 `traceId`를 생성/보존해야 한다(MUST).
2. Runtime이 Handoff를 위해 내부 이벤트를 생성할 때 `turn.auth`를 변경 없이 전달해야 한다(MUST).

```typescript
/**
 * TurnOrigin: Turn의 호출 맥락 정보
 */
interface TurnOrigin {
  /** Connector 이름 */
  connector?: string;

  /** 채널 식별자 */
  channel?: string;

  /** 스레드 식별자 */
  threadTs?: string;

  /** 추가 맥락 정보 */
  [key: string]: JsonValue | undefined;
}

/**
 * TurnAuth: Turn의 인증 컨텍스트
 */
interface TurnAuth {
  /** 행위자 정보 */
  actor?: {
    type: 'user' | 'system' | 'agent';
    id: string;
    display?: string;
  };

  /** OAuth subject 조회용 키 */
  subjects?: {
    global?: string;
    user?: string;
  };

  /** 추가 인증 메타데이터 */
  [key: string]: JsonValue | undefined;
}
```

---

## 8. Message

### 8.1 핵심 타입

모든 LLM 메시지는 AI SDK의 메시지 형식(`CoreMessage`)을 사용하되, `Message`로 감싸서 관리한다.

```typescript
import type { CoreMessage } from 'ai';  // ai-sdk

/**
 * AI SDK 메시지를 감싸는 관리 래퍼.
 * Extension 미들웨어에서 메시지 식별/조작에 사용.
 */
interface Message {
  /** 고유 ID */
  readonly id: string;

  /** AI SDK CoreMessage (system | user | assistant | tool) */
  readonly data: CoreMessage;

  /**
   * Extension/미들웨어가 읽고 쓸 수 있는 메타데이터.
   * 메시지 식별, 필터링, 조작 판단에 활용.
   */
  metadata: Record<string, JsonValue>;

  /** 메시지 생성 시각 */
  readonly createdAt: Date;

  /** 이 메시지를 생성한 주체 */
  readonly source: MessageSource;
}

type MessageSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };
```

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

```typescript
/**
 * Message에 대한 이벤트 소싱 이벤트.
 * Extension 미들웨어에서 메시지 추가/교체/삭제를 이벤트로 기록.
 */
type MessageEvent =
  | { type: 'append';   message: Message }
  | { type: 'replace';  targetId: string; message: Message }
  | { type: 'remove';   targetId: string }
  | { type: 'truncate' };

interface ConversationState {
  /** Turn 시작 시점의 확정된 메시지들 */
  readonly baseMessages: Message[];

  /** Turn 진행 중 누적된 이벤트 */
  readonly events: MessageEvent[];

  /** 계산된 현재 메시지 상태: base + events 적용 결과 */
  readonly nextMessages: Message[];

  /** LLM에 보낼 메시지만 추출 (message.data 배열) */
  toLlmMessages(): CoreMessage[];

  /** MessageEvent 발행 */
  emitEvent(event: MessageEvent): void;

  /** Turn 종료 시 events → base 폴딩 */
  foldEventsToBase(): Promise<void>;
}
```

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

- `messages/base.jsonl` — Turn 종료 시 확정된 Message 목록
- `messages/events.jsonl` — Turn 진행 중 누적된 MessageEvent 로그
- Turn 종료 후: events → base로 폴딩, events 클리어

```jsonl
# base.jsonl 예시
{"id":"m1","data":{"role":"user","content":"Hello"},"metadata":{},"createdAt":"2026-02-01T12:00:00Z","source":{"type":"user"}}
{"id":"m2","data":{"role":"assistant","content":"Hi!"},"metadata":{},"createdAt":"2026-02-01T12:00:01Z","source":{"type":"assistant","stepId":"s1"}}
```

```jsonl
# events.jsonl 예시
{"type":"append","message":{"id":"m3","data":{"role":"user","content":"Fix the bug"},"metadata":{},"createdAt":"2026-02-01T12:01:00Z","source":{"type":"user"}}}
{"type":"append","message":{"id":"m4","data":{"role":"assistant","content":null,"tool_calls":[...]},"metadata":{},"createdAt":"2026-02-01T12:01:01Z","source":{"type":"assistant","stepId":"s2"}}}
```

### 8.8 Middleware에서의 활용

Extension은 미들웨어에서 `ConversationState`를 받아 metadata 기반으로 이벤트를 발행하여 조작한다.

```typescript
// 예: compaction extension이 turn 시작 전 오래된 메시지를 요약으로 대체
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

v2에서는 Changeset/SwarmBundleRef 시스템을 제거하고 **Edit & Restart** 모델을 채택한다.

### 9.1 제거된 항목

다음 항목은 v2에서 **완전 제거**된다:

- `SwarmBundleRef` (불변 스냅샷 식별자)
- `ChangesetPolicy` (허용 파일, 권한)
- Safe Point (`turn.start`, `step.config`)
- 충돌 감지, 원자적 커밋
- 자기 수정(self-evolving) 에이전트 패턴
- GC (garbage collection of instances — 이제 프로세스 수준)
- In-memory 라우팅 (단일 프로세스 모델)

### 9.2 Edit & Restart 동작 방식

```
1. goondan.yaml (또는 개별 리소스 파일) 수정
2. Orchestrator가 설정 변경을 감지하거나 명령을 수신
3. Orchestrator가 해당 에이전트 프로세스 kill → 새 설정으로 re-spawn
```

**규칙:**

1. 설정 변경은 `goondan.yaml` 또는 개별 리소스 파일을 직접 수정하는 방식으로 수행해야 한다(MUST).
2. Orchestrator는 설정 변경을 감지하거나 외부 명령을 수신하여 에이전트 프로세스를 재시작해야 한다(MUST).
3. 재시작 시 Orchestrator는 해당 AgentProcess를 kill한 뒤 새 설정으로 re-spawn해야 한다(MUST).

### 9.3 재시작 트리거

| 트리거 | 설명 |
|--------|------|
| `--watch` 모드 | Orchestrator가 파일 변경을 감지하면 영향받는 AgentProcess를 자동 재시작(MUST) |
| CLI 명령 | `gdn restart`를 통해 실행 중인 Orchestrator에 재시작 신호 전송(MUST) |
| 크래시 감지 | Orchestrator가 AgentProcess 비정상 종료 시 자동 재스폰(SHOULD) |

### 9.4 재시작 옵션

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

### 9.5 Watch 모드

```bash
gdn run --watch   # goondan.yaml/리소스 파일 변경 시 해당 에이전트 자동 restart
```

**규칙:**

1. Orchestrator가 `--watch` 플래그로 기동되면 `goondan.yaml` 및 관련 리소스 파일의 변경을 감시해야 한다(MUST).
2. Orchestrator는 어떤 리소스가 변경되었는지 파악하여 영향받는 AgentProcess만 선택적으로 재시작하는 것을 권장한다(SHOULD).
3. Tool/Extension/Connector entry 파일 변경 시에도 해당 프로세스를 재시작해야 한다(SHOULD).

---

## 10. 인스턴스 관리

### 10.1 인스턴스 운영

v2에서는 pause/resume/terminate를 제거하고 restart로 통합한다.

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

```typescript
/**
 * ConnectorContext: Connector 핸들러에 제공되는 컨텍스트
 */
interface ConnectorContext {
  /** ConnectorEvent를 Orchestrator로 전달 */
  emit(event: ConnectorEventPayload): Promise<void>;

  /** Connection이 제공한 시크릿 */
  secrets: Record<string, string>;

  /** 로거 */
  logger: Console;
}

interface ConnectorEventPayload {
  /** 이벤트 이름 (events 스키마에 정의된 이름) */
  name: string;

  /** 메시지 (텍스트, 이미지, 파일 등) */
  message: { type: string; text?: string; url?: string };

  /** 이벤트 속성 (Connection ingress 매칭에 사용) */
  properties: Record<string, string>;

  /** 인스턴스 라우팅 키 */
  instanceKey: string;
}
```

**규칙:**

1. ConnectorProcess는 Orchestrator가 스폰하고 감시한다(MUST).
2. ConnectorProcess는 프로토콜 처리를 직접 구현해야 한다(MUST). Runtime이 프로토콜을 대신 관리하지 않는다.
3. ConnectorProcess는 정규화된 `ConnectorEvent`를 `ctx.emit()`으로 Orchestrator에 전달해야 한다(MUST).
4. ConnectorEvent는 `instanceKey`를 포함하여 Orchestrator가 적절한 AgentProcess로 라우팅할 수 있게 해야 한다(MUST).

### 11.2 Connector 핸들러 예시

```typescript
// connectors/telegram/index.ts
export default async function (ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;

  Bun.serve({
    port: Number(secrets.PORT) || 3000,
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

  logger.info('Telegram connector listening on port', Number(secrets.PORT) || 3000);
};
```

---

## 12. Observability

### 12.1 로깅

**규칙:**

1. Runtime은 Turn/Step/ToolCall 로그에 `traceId`를 포함해야 한다(MUST).
2. Runtime은 최소 `latencyMs`, `toolCallCount`, `errorCount`, `tokenUsage`(prompt/completion/total)를 기록해야 한다(SHOULD).
3. 민감값(access token, refresh token, secret)은 로그/메트릭에 평문으로 포함되어서는 안 된다(MUST).
4. 각 프로세스(Orchestrator, AgentProcess, ConnectorProcess)는 stdout/stderr로 구조화된 로그를 출력해야 한다(SHOULD).
5. Runtime 상태 점검(health check) 인터페이스를 제공하는 것을 권장한다(SHOULD).

### 12.2 프로세스별 로깅 모델

v2에서는 별도의 이벤트 로그/메트릭 로그 파일을 제거하고, 각 프로세스의 stdout/stderr를 활용한다.

**규칙:**

1. Orchestrator, AgentProcess, ConnectorProcess는 각각 stdout/stderr로 구조화된 로그를 출력해야 한다(SHOULD).
2. Orchestrator는 자식 프로세스의 stdout/stderr을 수집하여 통합 로그 출력을 제공할 수 있어야 한다(MAY).
3. 로그에는 프로세스 식별 정보(agentName, instanceKey 등)와 `traceId`를 포함해야 한다(SHOULD).

### 12.3 구조화된 로그 형식 예시

```json
{"level":"info","timestamp":"2026-02-05T10:30:00Z","traceId":"trace-abc","agent":"coder","instanceKey":"user:123","event":"turn.started","turnId":"turn-001"}
{"level":"info","timestamp":"2026-02-05T10:30:01Z","traceId":"trace-abc","agent":"coder","instanceKey":"user:123","event":"step.started","turnId":"turn-001","stepIndex":0}
{"level":"info","timestamp":"2026-02-05T10:30:02Z","traceId":"trace-abc","agent":"coder","instanceKey":"user:123","event":"toolCall","turnId":"turn-001","toolName":"bash__exec","latencyMs":150}
{"level":"info","timestamp":"2026-02-05T10:30:03Z","traceId":"trace-abc","agent":"coder","instanceKey":"user:123","event":"turn.completed","turnId":"turn-001","latencyMs":3000,"tokenUsage":{"prompt":150,"completion":30,"total":180}}
```

---

## 13. Tool 관련 타입

### 13.1 ToolCatalogItem

```typescript
interface ToolCatalogItem {
  /** 도구 이름 (LLM 노출 형식: {Tool 리소스 이름}__{하위 도구 이름}) */
  readonly name: string;

  /** 도구 설명 */
  readonly description?: string;

  /** 파라미터 스키마 (JSON Schema) */
  readonly parameters?: JsonObject;

  /** 비활성 여부 */
  disabled?: boolean;
}
```

### 13.2 ToolCall / ToolResult

```typescript
interface ToolCall {
  /** Tool call 고유 ID */
  readonly id: string;

  /** 도구 이름 */
  readonly name: string;

  /** 입력 인자 */
  readonly input: JsonObject;
}

interface ToolResult {
  /** 해당 tool call ID */
  readonly toolCallId: string;

  /** 도구 이름 */
  readonly toolName: string;

  /** 실행 결과 */
  readonly output?: JsonValue;

  /** 오류 정보 */
  readonly error?: {
    status: 'error';
    error: {
      message: string;
      name?: string;
      code?: string;
    };
  };
}
```

### 13.3 ToolHandler / ToolContext

```typescript
interface ToolHandler {
  (ctx: ToolContext, input: JsonObject): Promise<JsonValue>;
}

interface ToolContext {
  /** Agent 이름 */
  readonly agentName: string;

  /** 인스턴스 키 */
  readonly instanceKey: string;

  /** Turn ID */
  readonly turnId: string;

  /** Tool call ID */
  readonly toolCallId: string;

  /** 이 도구 호출을 트리거한 메시지 */
  readonly message: Message;

  /** 로거 */
  readonly logger: Console;
}
```

---

## 14. 규칙 요약

> 상세 규범적 규칙은 [2. 핵심 규칙](#2-핵심-규칙) 섹션을 참조한다. 이하는 빠른 참조용 요약이다.

### MUST 요구사항

1. Orchestrator는 `goondan.yaml`을 파싱하고 AgentProcess/ConnectorProcess를 스폰/감시해야 한다.
2. 각 AgentInstance는 독립 Bun 프로세스로 실행되어야 한다.
3. AgentProcess의 이벤트 큐는 FIFO 직렬 처리여야 한다.
4. 에이전트 간 통신은 Orchestrator를 경유하는 IPC 메시지 패싱이어야 한다.
5. `Message`는 AI SDK `CoreMessage`를 `data` 필드에 래핑해야 한다.
6. 메시지 상태는 `NextMessages = BaseMessages + SUM(Events)` 규칙으로 계산되어야 한다.
7. Turn 종료 시 events → base 폴딩 후 events를 클리어해야 한다.
8. 설정 변경은 Edit & Restart 모델을 따라야 한다.
9. Orchestrator 종료 시 모든 자식 프로세스도 종료해야 한다.
10. 인스턴스 관리 연산(`list`, `delete`)을 제공해야 한다.
11. 민감값은 로그/메트릭에 평문으로 포함되어서는 안 된다.
12. Handoff는 표준 Tool API를 통해 요청되어야 한다.
13. IPC 메시지는 JSON 직렬화 가능해야 하며, 메시지 순서가 보장되어야 한다.
14. Runtime은 Turn마다 `traceId`를 생성/보존해야 한다.

### SHOULD 권장사항

1. AgentProcess 크래시 시 Orchestrator가 자동 재스폰한다.
2. Watch 모드에서 영향받는 AgentProcess만 선택적 재시작한다.
3. Turn/Step/ToolCall 메트릭을 구조화된 로그로 출력한다.
4. TTL/idle 기반 인스턴스 자동 정리 정책을 제공한다.
5. IPC 구현은 Bun의 내장 IPC를 사용한다.
6. Handoff 결과는 동일 Turn 또는 후속 Turn에서 구조화된 메시지로 합류되어야 한다.
7. `replace`/`remove` 대상 `targetId`가 존재하지 않으면 구조화된 경고 이벤트를 남겨야 한다.

### MAY 선택사항

1. `Swarm.policy.maxStepsPerTurn` 적용.
2. Orchestrator가 자식 프로세스 stdout/stderr을 통합 수집.
3. Health check 인터페이스 제공.
4. Handoff 시 추가 context 전달 필드 지원.

---

## 부록 A. 기존 대비 변경 요약

| 영역 | v1 (이전) | v2 (현재) |
|------|-----------|-----------|
| **런타임** | Node.js (`runtime: node`) | Bun only (필드 제거) |
| **에이전트 실행** | 단일 프로세스 내 다중 AgentInstance | **Process-per-Agent** |
| **에이전트 간 통신** | 인-메모리 호출 | IPC (Orchestrator 경유) |
| **설정 변경** | SwarmBundleRef + Changeset + Safe Point | **Edit & Restart** |
| **메시지 타입** | 커스텀 `LlmMessage` | **Message** (AI SDK `CoreMessage` 래핑) |
| **메시지 상태** | `BaseMessages + SUM(Events)` | `BaseMessages + SUM(MessageEvents)` (이벤트 소싱 유지) |
| **인스턴스 관리** | pause/resume/terminate/delete | **restart + delete** |
| **로깅** | 파일 기반 이벤트/메트릭 로그 | **프로세스 stdout/stderr** |
| **GC** | 인스턴스 GC 정책 | **프로세스 수준 관리** |

---

## 부록 B. 관련 문서

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

**문서 버전**: v2.0
**최종 수정**: 2026-02-12
