## 9. Runtime 실행 모델

### 9.1 인스턴스 생성과 라우팅

Runtime은 Connector로부터 입력 이벤트를 수신하고, 라우팅 규칙에 따라 SwarmInstance를 조회/생성한다.

* `instanceKey`를 사용하여 동일 맥락을 같은 인스턴스로 라우팅할 수 있어야 한다(MUST).
* SwarmInstance 내부에 AgentInstance를 생성하고 유지해야 한다(MUST).

#### 9.1.1 Turn Origin 컨텍스트와 인증 컨텍스트

OAuth 기반 통합을 위해 Runtime은 Turn 컨텍스트에 호출 맥락(origin)과 인증 컨텍스트(auth)를 유지해야 한다(SHOULD).

```yaml
turn:
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
      user:   "slack:user:T111:U234567"
```

규칙:

1. Runtime이 에이전트 간 handoff를 위해 내부 이벤트를 생성하거나 라우팅할 때, `turn.auth`는 변경 없이 전달되어야 한다(MUST). 이 규칙은 “Turn을 트리거한 사용자 컨텍스트가 handoff 이후에도 유지된다”는 요구를 보장하기 위한 것이다.
2. Runtime은 `turn.auth`가 누락된 Turn에 대해 사용자 토큰이 필요한 OAuthApp(`subjectMode=user`)을 사용해 토큰을 조회하거나 승인 플로우를 시작해서는 안 된다(MUST). 이 경우에는 오류로 처리하고, 에이전트가 사용자에게 필요한 컨텍스트(예: 다시 호출, 계정 연결 필요)를 안내하도록 하는 것이 바람직하다(SHOULD).

---

#### 9.1.2 Canonical Event Flow

Connector trigger handler가 `ctx.emit(canonicalEvent)`를 호출하면, Runtime은 이를 내부 이벤트 큐에 enqueue한다.

Canonical event는 다음 처리 흐름을 따른다.

1. Runtime은 canonical event의 `type`과 Connector ingress 설정을 기준으로 대상 Swarm을 결정한다.
2. `instanceKey` 계산 규칙에 따라 SwarmInstance를 조회하거나 생성한다.
3. Canonical event는 Turn 입력 이벤트로 변환되어 AgentInstance 이벤트 큐에 enqueue된다.
4. AgentInstance는 해당 이벤트를 하나의 Turn으로 소비한다.

이 과정에서 Connector는 에이전트 실행 모델(Instance/Turn/Step)을 직접 제어하지 않으며,
오직 canonical event 생성 책임만을 가진다(MUST).

### 9.2 이벤트 큐와 Turn 실행

* AgentInstance는 이벤트 큐를 가진다(MUST).
* 큐의 이벤트 하나가 Turn의 입력이 된다(MUST).
* Runtime은 Turn 내에서 Step을 반복 실행할 수 있어야 한다(MUST).
* `Swarm.policy.maxStepsPerTurn` 정책을 적용할 수 있어야 한다(MAY).

### 9.3 Step 실행과 도구 호출 처리

Step은 다음 순서로 진행된다.

1. **step.config**: Runtime은 이번 Step의 `activeSwarmRef`(= SwarmBundleRef)를 스냅샷으로 확정하고, Effective Config를 해당 Ref 기준으로 로드/조립
2. `step.tools`: Tool Catalog 구성
3. `step.blocks`: Context Blocks 구성
4. `step.llmCall`: LLM 호출
5. tool call 처리(동기 실행 또는 비동기 큐잉)
6. `step.post`: 결과 반영 후 Step 종료

### 9.4 Changeset/SwarmBundleRef 적용 의미론 (MUST)

#### 9.4.1 적용 단위

* Runtime은 각 Step 시작 시 `step.config`에서 현재 `activeSwarmRef`(= SwarmBundleRef)를 결정해야 한다(MUST).
* Step 실행 중에는 SwarmBundleRef와 Effective Config를 변경해서는 안 된다(MUST).

#### 9.4.2 커밋과 활성화(권장 표준)

* `swarmBundle.commitChangeset`은 Git commit을 생성하고 SwarmBundleRoot의 활성 Ref를 업데이트한다(§6.4).
* 새 SwarmBundleRef는 `step.config` Safe Point에서 `activeSwarmRef`로 활성화되며, 기본 규칙은 “다음 Step부터 반영”이다(MUST).

#### 9.4.3 반영 시점

Step N 중 commit된 changeset으로 생성된 SwarmBundleRef는, Step N+1의 `step.config`에서 활성화되는 것이 기본 규칙이다(MUST).
(단, Step N 시작 전에 이미 활성 Ref가 업데이트된 경우 Step N에서 그 Ref를 활성화하는 것은 자연스럽게 허용된다.)

#### 9.4.4 변경 가시성(권장)

`emitRevisionChangedEvent=true`인 경우, Runtime은 revision 변경 요약을 다음 Step 입력 또는 블록에 포함시키는 것을 SHOULD 한다.

#### 9.4.7 Effective Config 배열 정규화 규칙 (SHOULD)

Runtime은 Effective Config 생성 후 다음 배열을 **identity key 기반으로 정규화**하는 것을 SHOULD 한다.

* `/spec/tools`, `/spec/extensions`

정규화 규칙(SHOULD):

* identity key가 동일한 항목이 중복될 경우, 마지막에 나타난 항목이 내용을 대표(last-wins)한다.
* 배열의 순서는 bundle 파일 변경(커밋 결과)에 의해 만들어진 순서를 유지한다.
* 실행 상태 유지(reconcile)는 순서가 아니라 identity key 기준으로 수행한다(§11.6).
