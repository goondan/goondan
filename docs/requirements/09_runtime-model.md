## 9. Runtime 실행 모델

Goondan v2의 Runtime은 **Process-per-Agent** 아키텍처를 채택한다. Orchestrator가 상주 프로세스로 전체 Swarm의 생명주기를 관리하고, 각 AgentInstance와 Connector는 독립 Bun 프로세스로 실행된다.

### 9.1 Orchestrator (상주 프로세스)

Orchestrator는 `gdn run`으로 기동되는 **상주 프로세스**로, Swarm 전체의 생명주기를 관리한다.

#### 9.1.1 핵심 책임

규칙:

1. Orchestrator는 `goondan.yaml` 및 관련 리소스 파일을 파싱하여 Config Plane을 구성해야 한다(MUST).
2. Orchestrator는 각 Agent 정의에 대해 AgentProcess를 스폰하고 감시해야 한다(MUST).
3. Orchestrator는 각 Connector 정의에 대해 ConnectorProcess를 스폰하고 감시해야 한다(MUST).
4. Orchestrator는 `instanceKey`를 기준으로 이벤트를 적절한 AgentProcess로 라우팅해야 한다(MUST).
5. Orchestrator는 에이전트 간 IPC 메시지 브로커 역할을 수행해야 한다(MUST).
6. Orchestrator는 설정 변경 감지 또는 외부 명령 수신 시 에이전트 프로세스를 재시작할 수 있어야 한다(MUST).
7. Orchestrator는 모든 AgentProcess가 종료되어도 상주해야 하며, 새로운 이벤트(Connector 수신, CLI 입력 등) 발생 시 필요한 AgentProcess를 다시 스폰해야 한다(MUST).
8. Orchestrator가 종료될 때 모든 자식 프로세스(AgentProcess, ConnectorProcess)도 종료해야 한다(MUST).

#### 9.1.2 instanceKey 라우팅

규칙:

1. Orchestrator는 `instanceKey`를 사용해 동일 맥락 이벤트를 동일 AgentProcess로 라우팅해야 한다(MUST).
2. 라우팅 대상 AgentProcess가 아직 존재하지 않으면 Orchestrator가 새로 스폰해야 한다(MUST).
3. ConnectorEvent의 `instanceKey`와 Connection의 `ingress.rules`를 조합하여 대상 Agent와 인스턴스를 결정해야 한다(MUST).

#### 9.1.3 Canonical Event Flow

1. ConnectorProcess가 외부 프로토콜 이벤트를 수신하여 `ConnectorEvent`를 Orchestrator로 전달한다.
2. Orchestrator는 Connection의 `ingress.rules`에 따라 대상 Agent를 결정한다.
3. `instanceKey` 규칙으로 기존 AgentProcess를 조회하거나 새로 스폰한다.
4. 이벤트를 `AgentEvent`로 변환하여 대상 AgentProcess로 IPC 전달한다.

### 9.2 AgentProcess (에이전트 프로세스)

각 AgentInstance는 **독립 Bun 프로세스**로 실행된다.

#### 9.2.1 프로세스 특성

규칙:

1. 각 AgentProcess는 독립된 메모리 공간에서 실행되어야 한다(MUST). 이를 통해 크래시 격리를 보장한다.
2. AgentProcess는 Orchestrator와 IPC(Bun의 `process.send`/`process.on("message")` 또는 Unix socket)를 통해 통신해야 한다(MUST).
3. AgentProcess는 독립적인 Turn/Step 루프를 실행해야 한다(MUST).
4. AgentProcess는 자신에게 할당된 Extension/Tool 코드를 자체 프로세스에서 로딩해야 한다(MUST).
5. AgentProcess가 비정상 종료(크래시)되면 Orchestrator가 이를 감지하고 자동 재스폰할 수 있어야 한다(SHOULD).

#### 9.2.2 이벤트 큐와 직렬 처리

규칙:

1. AgentProcess는 이벤트 큐를 가져야 한다(MUST).
2. AgentProcess의 이벤트 큐는 FIFO 순서로 직렬 처리되어야 한다(MUST).
3. 같은 AgentProcess에 대해 Turn을 동시에 실행해서는 안 된다(MUST NOT).
4. 서로 다른 AgentProcess는 독립 프로세스이므로 자연스럽게 병렬 실행된다.
5. `Swarm.policy.maxStepsPerTurn`을 적용할 수 있어야 한다(MAY).

#### 9.2.3 프로세스 기동 파라미터

AgentProcess는 최소 다음 정보로 기동되어야 한다(MUST):

- `--bundle-dir`: 프로젝트 디렉터리 경로
- `--agent-name`: Agent 리소스 이름
- `--instance-key`: 인스턴스 식별 키

### 9.3 IPC (Inter-Process Communication)

에이전트 간 통신은 Orchestrator를 경유하는 메시지 패싱 방식을 사용한다.

#### 9.3.1 IPC 메시지 타입

규칙:

1. IPC 메시지는 최소 다음 타입을 지원해야 한다(MUST):
   - `delegate`: 다른 Agent에게 작업 위임 요청
   - `delegate_result`: 위임 작업의 결과 반환
   - `event`: 일반 이벤트 전달 (ConnectorEvent 포함)
   - `shutdown`: 프로세스 종료 요청
2. 모든 IPC 메시지는 `from`(발신 Agent), `to`(수신 Agent), `payload`를 포함해야 한다(MUST).
3. `delegate`와 `delegate_result`는 `correlationId`를 포함하여 요청-응답을 매칭할 수 있어야 한다(MUST).

#### 9.3.2 위임(Delegate) 흐름

Handoff는 IPC를 통한 도구 호출 기반 비동기 패턴으로 제공한다.

규칙:

1. Handoff는 표준 Tool API를 통해 요청되어야 한다(MUST).
2. 최소 입력으로 대상 Agent 식별자와 입력 프롬프트를 포함해야 한다(MUST).
3. 추가 context 전달 필드를 지원할 수 있다(MAY).

위임 흐름:

1. AgentA가 delegate Tool을 호출하면, AgentProcess-A가 Orchestrator에 `{ type: 'delegate', to: 'AgentB', payload: {...}, correlationId: '...' }` IPC 메시지를 전송한다.
2. Orchestrator는 AgentB의 AgentProcess로 라우팅한다. AgentProcess-B가 아직 없으면 스폰한다.
3. AgentB가 처리를 완료하면 `{ type: 'delegate_result', to: 'AgentA', correlationId: '...', payload: {...} }` IPC 메시지를 Orchestrator에 전송한다.
4. Orchestrator가 AgentA로 결과를 전달한다.

규칙:

4. Handoff 요청 후 원래 Agent는 상태를 종료하지 않고 비동기 응답을 대기할 수 있어야 한다(SHOULD).
5. Handoff 결과는 동일 Turn 또는 후속 Turn에서 구조화된 메시지로 합류되어야 한다(SHOULD).
6. Orchestrator는 위임 대상 Agent의 `instanceKey` 결정 규칙을 적용해야 한다(MUST).

### 9.4 Turn / Step

Turn과 Step은 기존과 동일한 개념이나, **단일 AgentProcess 내에서** 실행된다.

#### 9.4.1 Turn

Turn은 하나의 입력 이벤트 처리 단위이다.

규칙:

1. Turn은 하나의 `AgentEvent`(사용자 메시지, delegate, ConnectorEvent 등)를 입력으로 받아야 한다(MUST).
2. Turn은 하나 이상의 Step을 포함해야 한다(MUST).
3. Turn은 `TurnResult`(응답 메시지, 상태 변화)를 출력으로 생성해야 한다(MUST).
4. Turn은 `running`, `completed`, `failed` 상태를 가져야 한다(MUST).

#### 9.4.2 Step

Step은 단일 LLM 호출 단위이다.

규칙:

1. Step은 LLM에 메시지를 전달하고 응답을 받는 단위여야 한다(MUST).
2. LLM 응답에 도구 호출이 포함되면 도구를 실행한 뒤 다음 Step을 실행해야 한다(MUST).
3. LLM 응답이 텍스트 응답만 포함하면 Turn을 종료해야 한다(MUST).
4. Step은 Tool Catalog를 구성하여 LLM에 사용 가능한 도구 목록을 전달해야 한다(MUST).
5. Step은 `llm_call`, `tool_exec`, `completed` 상태를 가져야 한다(MUST).

#### 9.4.3 Turn Origin/Auth 컨텍스트

규칙:

1. Runtime은 Turn마다 `traceId`를 생성/보존해야 한다(MUST).
2. Runtime이 Handoff를 위해 내부 이벤트를 생성할 때 `turn.auth`를 변경 없이 전달해야 한다(MUST).

### 9.5 메시지 상태 모델 (이벤트 소싱)

Turn의 LLM 입력 메시지는 다음 규칙으로 계산되어야 한다(MUST).

```text
NextMessages = BaseMessages + SUM(Events)
```

- `BaseMessages`: Turn 시작 시점에 로드된 확정 메시지 집합(`messages/base.jsonl`)
- `Events`: Turn 동안 누적되는 `MessageEvent` 집합(`messages/events.jsonl`)

#### 9.5.1 Message 타입

모든 LLM 메시지는 AI SDK의 `CoreMessage`를 `Message`로 감싸서 관리한다.

규칙:

1. `Message`는 고유 `id`, AI SDK `CoreMessage`를 담는 `data`, 메타데이터 `metadata`, 생성 시각 `createdAt`, 생성 주체 `source`를 포함해야 한다(MUST).
2. `source`는 `user`, `assistant`, `tool`, `system`, `extension` 타입 중 하나여야 한다(MUST).
3. `metadata`는 Extension/미들웨어가 읽고 쓸 수 있는 자유 형식 키-값 저장소여야 한다(MUST).
4. `id`는 Turn 범위에서 고유해야 하며, `replace`/`remove` 이벤트의 참조 키로 사용되어야 한다(MUST).

#### 9.5.2 MessageEvent 타입

규칙:

1. `append`: 새로운 `Message`를 메시지 목록 끝에 추가한다(MUST).
2. `replace`: `targetId`로 지정된 기존 메시지를 새 `Message`로 교체한다(MUST).
3. `remove`: `targetId`로 지정된 메시지를 제거한다(MUST).
4. `truncate`: 모든 메시지를 제거한다(MUST).

#### 9.5.3 Turn 메시지 라이프사이클

규칙:

1. Turn 시작 시 Runtime은 `BaseMessages`를 로드하고 이를 초기 LLM 입력으로 사용해야 한다(MUST).
2. Turn 진행 중 발생하는 메시지 변경은 직접 배열 수정이 아니라 `MessageEvent` 발행으로 기록해야 한다(MUST).
3. LLM 출력 메시지는 `append` 이벤트로 기록되어야 한다(MUST).
4. 메시지 편집/삭제/요약은 `replace`/`remove`/`truncate` 이벤트로 기록되어야 한다(MUST).
5. Turn 종료 시 미들웨어(`turn` 미들웨어의 `next()` 이후)에서 추가 MessageEvent를 발행할 수 있어야 한다(MUST).
6. 모든 Turn 미들웨어 종료 후 Runtime은 `BaseMessages + SUM(Events)`를 새 base로 저장해야 한다(MUST).
7. 새 base 저장이 완료되면 적용된 `Events`를 비워야 한다(MUST).

#### 9.5.4 적용/복원 규칙

규칙:

1. `SUM(Events)`는 기록 순서(append order)대로 결정론적으로 적용되어야 한다(MUST).
2. `replace`/`remove` 대상 `targetId`가 존재하지 않는 경우 Runtime은 Turn 전체를 즉시 실패시키지 않고 구조화된 경고 이벤트를 남겨야 한다(SHOULD).
3. Runtime 재시작 시 미처리 `Events`가 남아 있으면 `BaseMessages + SUM(Events)`를 재계산해 Turn 상태를 복원해야 한다(MUST).

#### 9.5.5 이벤트 소싱의 이점

이벤트 소싱 모델은 다음 이점을 제공한다:

- **복구**: `base + events` 재생으로 정확한 상태 복원
- **관찰**: 모든 메시지 변경이 이벤트로 추적됨
- **Extension 조작**: 미들웨어에서 이벤트를 발행하여 메시지 조작 (직접 배열 변경 대신)
- **Compaction**: 주기적으로 `events -> base` 폴딩으로 정리

### 9.6 Edit & Restart 모델

v2에서는 Changeset/SwarmBundleRef 시스템을 제거하고 **Edit & Restart** 모델을 채택한다.

#### 9.6.1 제거된 항목

다음 항목은 v2에서 제거된다:

- `SwarmBundleRef` (불변 스냅샷 식별자)
- `ChangesetPolicy` (허용 파일, 권한)
- Safe Point (`turn.start`, `step.config`)
- 충돌 감지, 원자적 커밋
- 자기 수정(self-evolving) 에이전트 패턴

#### 9.6.2 Edit & Restart 동작 방식

규칙:

1. 설정 변경은 `goondan.yaml` 또는 개별 리소스 파일을 직접 수정하는 방식으로 수행해야 한다(MUST).
2. Orchestrator는 설정 변경을 감지하거나 외부 명령을 수신하여 에이전트 프로세스를 재시작해야 한다(MUST).
3. 재시작 시 Orchestrator는 해당 AgentProcess를 kill한 뒤 새 설정으로 re-spawn해야 한다(MUST).

#### 9.6.3 재시작 트리거

규칙:

1. `--watch` 모드: Orchestrator가 파일 변경을 감지하면 영향받는 AgentProcess를 자동 재시작해야 한다(MUST).
2. CLI 명령: `gdn restart`를 통해 실행 중인 Orchestrator에 재시작 신호를 전송할 수 있어야 한다(MUST).
3. 크래시 감지: Orchestrator는 AgentProcess 비정상 종료 시 자동 재스폰할 수 있어야 한다(SHOULD).

#### 9.6.4 재시작 옵션

규칙:

1. `--agent <name>` 옵션으로 특정 Agent의 프로세스만 재시작할 수 있어야 한다(MUST). 생략 시 전체 AgentProcess를 재시작한다.
2. `--fresh` 옵션으로 대화 히스토리를 초기화하고 재시작할 수 있어야 한다(MUST).
3. 기본 동작은 기존 메시지 히스토리를 유지한 채 새 설정으로 계속 실행하는 것이어야 한다(MUST).

#### 9.6.5 Watch 모드

규칙:

1. Orchestrator가 `--watch` 플래그로 기동되면 `goondan.yaml` 및 관련 리소스 파일의 변경을 감시해야 한다(MUST).
2. Orchestrator는 어떤 리소스가 변경되었는지 파악하여 영향받는 AgentProcess만 선택적으로 재시작하는 것을 권장한다(SHOULD).
3. Tool/Extension/Connector entry 파일 변경 시에도 해당 프로세스를 재시작해야 한다(SHOULD).

#### 9.6.6 인스턴스 운영

v2에서는 pause/resume/terminate를 제거하고 restart로 통합한다.

규칙:

1. 구현은 인스턴스 운영 연산(`list`, `delete`)을 제공해야 한다(MUST).
2. `delete`는 인스턴스 상태(메시지 히스토리, Extension 상태)를 제거해야 한다(MUST).
3. TTL/idle 기반 자동 정리(GC)는 정책으로 제공하는 것을 권장한다(SHOULD).
4. CLI를 제공하는 구현은 위 연산을 사람이 재현 가능하고 스크립트 가능한 형태로 노출해야 한다(SHOULD).

### 9.7 Observability

규칙:

1. Runtime은 Turn/Step/ToolCall 로그에 `traceId`를 포함해야 한다(MUST).
2. Runtime은 최소 `latencyMs`, `toolCallCount`, `errorCount`, `tokenUsage`(prompt/completion/total)를 기록해야 한다(SHOULD).
3. 민감값(access token, refresh token, secret)은 로그/메트릭에 평문으로 포함되어서는 안 된다(MUST).
4. 각 프로세스(Orchestrator, AgentProcess, ConnectorProcess)는 stdout/stderr로 구조화된 로그를 출력해야 한다(SHOULD).
5. Runtime 상태 점검(health check) 인터페이스를 제공하는 것을 권장한다(SHOULD).
