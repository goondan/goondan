## 9. Runtime 실행 모델

### 9.1 인스턴스 생성과 라우팅

Runtime은 Connector/Connection에서 전달된 canonical event를 입력으로 받아 SwarmInstance를 조회/생성한다.

규칙:

1. `instanceKey`를 사용해 동일 맥락 이벤트를 동일 SwarmInstance로 라우팅할 수 있어야 한다(MUST).
2. SwarmInstance 내부에서 AgentInstance를 생성/유지해야 한다(MUST).
3. connector는 실행 모델을 직접 제어하지 않고 canonical event 생성 책임만 가져야 한다(MUST).

#### 9.1.1 Turn Origin/Auth 컨텍스트

```yaml
turn:
  traceId: "tr-01J9..."
  origin:
    connector: slack-main
    channel: "C123"
    threadTs: "1700000000.000100"

  auth:
    actor:
      type: "user"
      id: "slack:U234567"
      display: "alice"
    subjects:
      global: "slack:team:T111"
      user: "slack:user:T111:U234567"
```

규칙:

1. Runtime은 Turn마다 `traceId`를 생성/보존해야 한다(MUST).
2. OAuth가 필요한 경로에서는 Connection이 필요한 `turn.auth.subjects`를 채우지 못하면 Turn을 실패 처리해야 한다(MUST).
3. Runtime이 handoff를 위해 내부 이벤트를 생성할 때 `turn.auth`를 변경 없이 전달해야 한다(MUST).

#### 9.1.2 Canonical Event Flow

1. Connector trigger handler가 `ctx.emit(canonicalEvent)`를 호출한다.
2. Runtime은 event type + ingress rule로 대상 Swarm을 결정한다.
3. `instanceKey` 규칙으로 SwarmInstance를 조회/생성한다.
4. event를 Turn 입력으로 변환하여 AgentInstance 큐에 enqueue한다.

### 9.2 이벤트 큐, 동시성, Turn 실행

규칙:

1. AgentInstance는 이벤트 큐를 가져야 한다(MUST).
2. AgentInstance 큐는 FIFO 순서로 직렬 처리되어야 한다(MUST).
3. 같은 AgentInstance에 대해 Turn 동시 실행은 허용되지 않는다(MUST NOT).
4. 서로 다른 AgentInstance는 구현 정책에 따라 병렬 실행할 수 있다(MAY).
5. `Swarm.policy.maxStepsPerTurn`을 적용할 수 있어야 한다(MAY).

#### 9.2.1 Changeset 동시성

1. 여러 Agent가 동시에 changeset을 열 수 있어야 한다(MUST).
2. commit 충돌 시 `status="conflict"`와 충돌 상세를 반환해야 하며, 충돌 정보를 숨겨서는 안 된다(MUST).
3. Runtime은 충돌 상세를 통해 에이전트가 후속 Step에서 스스로 복구할 수 있게 해야 한다(SHOULD).

#### 9.2.2 Turn 메시지 상태 모델(Base + Events)

Turn의 LLM 입력 메시지는 다음 규칙으로 계산되어야 한다(MUST).

```text
NextMessages = BaseMessages + SUM(Events)
```

- `BaseMessages`: turn 시작 시점에 로드된 기준 메시지 집합(`base.jsonl`)
- `Events`: turn 동안 append되는 메시지 조작 이벤트 집합(`events.jsonl`)

Turn 라이프사이클 규칙:

1. turn 시작 시 Runtime은 `BaseMessages`를 로드하고 이를 초기 LLM 입력으로 사용해야 한다(MUST).
2. turn 진행 중 발생하는 메시지 변경은 직접 배열 수정이 아니라 이벤트 append로 기록해야 한다(MUST).
3. turn 종료 단계(`turn.post`)에서는 Hook에 `(base, events)`를 전달해야 하며, Hook은 추가 이벤트를 발행할 수 있어야 한다(MUST).
4. turn 종료 Hook이 모두 끝난 뒤 Runtime은 `BaseMessages + SUM(Events)`를 새 base로 저장해야 한다(MUST).
5. 새 base 저장이 완료되면 적용된 `Events`를 비워야 한다(MUST).

메시지 이벤트 종류와 의미:

1. `system_message`: system 메시지를 교체하며, 기존 system 메시지가 없으면 추가한다(MUST).
2. `llm_message`: system을 제외한 메시지를 append한다(MUST).
3. `replace`: 특정 `message.id`의 내용을 교체한다(MUST).
4. `remove`: 특정 `message.id`를 제거한다(MUST).
5. `truncate`: system 메시지를 제외한 모든 메시지를 제거한다(MUST).

적용/복원 규칙:

1. `SUM(Events)`는 기록 순서(append order)대로 결정론적으로 적용되어야 한다(MUST).
2. `system_message`는 단일 슬롯으로 취급되어야 하며, 여러 이벤트가 있을 때 마지막 이벤트 결과가 최종 system 메시지가 되어야 한다(MUST).
3. `replace`/`remove` 대상 id가 존재하지 않는 경우 Runtime은 turn 전체를 즉시 실패시키지 않고 구조화된 경고 이벤트를 남겨야 한다(SHOULD).
4. Runtime 재시작 시 미처리 `Events`가 남아 있으면 `BaseMessages + SUM(Events)`를 재계산해 turn 상태를 복원해야 한다(MUST).
5. 메시지 id는 turn 범위에서 고유해야 하며, `replace`/`remove`의 참조 키로 사용되어야 한다(MUST).

### 9.3 Step 실행과 도구 호출 처리

Step은 다음 순서를 따른다.

1. `step.config`: activeSwarmRef 확정, Effective Config 로드/조립
2. `step.tools`: Tool Catalog 구성
3. `step.blocks`: Context Blocks 구성
4. `step.llmInput`: `BaseMessages + SUM(Events)` 계산 결과로 LLM 입력 메시지 구성
5. `step.llmCall`: LLM 호출
6. tool call 처리(동기 실행 또는 비동기 제출)
7. `step.post`: 결과 반영 후 종료

추가 규칙:

1. LLM 출력 메시지(system 제외)는 `llm_message` 이벤트로 기록되어야 한다(MUST).
2. 메시지 편집/삭제/요약은 in-memory 메시지 배열 직접 수정이 아니라 `replace`/`remove`/`truncate` 이벤트로 기록되어야 한다(MUST).

### 9.4 Changeset/SwarmBundleRef 적용 의미론

#### 9.4.1 적용 단위

1. Runtime은 Step 시작 시 `step.config`에서 activeSwarmRef를 결정해야 한다(MUST).
2. Step 실행 중에는 Ref/Config를 변경해서는 안 된다(MUST).

#### 9.4.2 커밋과 활성화

1. `swarmBundle.commitChangeset`은 Git commit을 생성하고 활성 Ref를 갱신해야 한다(MUST).
2. 새 Ref는 Safe Point(기본 `step.config`)에서만 활성화되어야 한다(MUST).

#### 9.4.3 반영 시점

Step N 중 commit된 Ref는 기본적으로 Step N+1의 `step.config`에서 활성화되어야 한다(MUST).

#### 9.4.4 변경 가시성

`emitRevisionChangedEvent=true`면 Runtime은 revision 변경 요약을 다음 Step 입력/블록으로 제공하는 것을 권장한다(SHOULD).

#### 9.4.5 코드 변경 반영 의미론

Changeset으로 소스코드(Tool/Extension/Connector entry 모듈)가 변경된 경우, 변경된 코드는 Safe Point(`step.config`)에서 새 SwarmBundleRef 활성화와 함께 반영되어야 한다(MUST).

규칙:

1. Runtime은 Step 시작 시 활성화된 SwarmBundleRef 기준으로 entry 모듈을 resolve해야 한다(MUST).
2. Step 실행 중에는 entry 모듈을 동적으로 교체(hot-reload)해서는 안 된다(MUST NOT).
3. 코드 변경의 반영 단위는 Config 변경과 동일하게 Step 경계여야 한다(MUST).

#### 9.4.6 Effective Config 정규화

Runtime은 `/spec/tools`, `/spec/extensions`를 identity key 기준으로 정규화하는 것을 권장한다(SHOULD).

### 9.5 Agent 간 Handoff 프로토콜

handoff는 도구 호출 기반 비동기 패턴으로 제공한다.

규칙:

1. handoff는 표준 Tool API를 통해 요청되어야 한다(MUST).
2. 최소 입력으로 대상 Agent 식별자와 입력 프롬프트를 포함해야 한다(MUST).
3. 추가 context 전달 필드를 지원할 수 있다(MAY).
4. handoff 요청 후 원래 Agent는 상태를 종료하지 않고 비동기 응답을 대기할 수 있어야 한다(SHOULD).
5. handoff 결과는 동일 Turn 또는 후속 Turn에서 구조화된 이벤트/메시지로 합류되어야 한다(SHOULD).

참고: core는 handoff 인터페이스를 제공하고, 기본 구현체는 `packages/base`에 제공하는 것을 권장한다(SHOULD).

### 9.6 인스턴스 라이프사이클

Runtime은 최소 다음 인스턴스 연산을 지원해야 한다.

- `inspect`: 상태 조회
- `pause`: 처리 일시정지
- `resume`: 처리 재개
- `terminate`: 즉시 종료
- `delete`: 상태 삭제

규칙:

1. pause 상태에서는 새 Turn을 실행해서는 안 된다(MUST NOT).
2. resume 이후에는 큐 적재 이벤트를 순서대로 재개해야 한다(MUST).
3. delete는 인스턴스 상태를 제거하되 시스템 전역 상태(OAuth grant 등)는 보존해야 한다(MUST).
4. TTL/idle 기반 자동 정리(GC)는 정책으로 제공하는 것을 권장한다(SHOULD).

### 9.6.1 운영 인터페이스(예: CLI)

1. 구현은 인스턴스 라이프사이클 연산(`list/inspect/pause/resume/terminate/delete`)을 운영 인터페이스로 제공해야 한다(MUST).
2. CLI를 제공하는 구현은 위 연산을 사람이 재현 가능하고 스크립트 가능한 형태로 노출해야 한다(SHOULD).

### 9.7 Observability

규칙:

1. Runtime은 Turn/Step/ToolCall 로그에 `traceId`를 포함해야 한다(MUST).
2. Runtime은 최소 `latencyMs`, `toolCallCount`, `errorCount`, `tokenUsage`(prompt/completion/total)를 기록해야 한다(SHOULD).
3. 민감값(access token, refresh token, secret)은 로그/메트릭에 평문으로 포함되어서는 안 된다(MUST).
4. Runtime 상태 점검(health check) 인터페이스(명령/엔드포인트)를 제공하는 것을 권장한다(SHOULD).
