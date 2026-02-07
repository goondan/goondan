## 11. 라이프사이클 파이프라인(훅) 스펙

### 11.1 파이프라인 타입

- Mutator: 순차 실행으로 상태를 변형
- Middleware: `next()` 기반 래핑(온니언 구조)

### 11.2 표준 파이프라인 포인트

Runtime은 최소 다음 포인트를 제공해야 한다(MUST).

- Turn: `turn.pre`, `turn.post`
- Step: `step.pre`, `step.config`, `step.tools`, `step.blocks`, `step.llmCall`, `step.llmError`, `step.post`
- ToolCall: `toolCall.pre`, `toolCall.exec`, `toolCall.post`

규칙:

1. `step.config`는 `step.tools`보다 먼저 실행되어야 한다(MUST).
2. `step.llmError`는 LLM 호출 실패 시 실행되어야 한다(MUST).
3. LLM 재시도 여부는 정책에 따라 결정할 수 있다(MAY).

#### 11.2.1 Turn 메시지 상태 계약

Turn 포인트는 다음 메시지 상태 계약을 따라야 한다.

1. `turn.pre` 시점 컨텍스트에는 turn 시작 기준 `base` 메시지가 포함되어야 한다(MUST).
2. `turn.post` 시점 Hook 입력에는 `(base, events)`가 모두 포함되어야 한다(MUST).
3. `turn.post` Hook은 추가 메시지 이벤트를 발행할 수 있어야 한다(MUST).
4. Runtime은 모든 `turn.post` Hook 종료 후에만 `base + SUM(events)`를 base에 반영해야 한다(MUST).
5. `turn.post` Hook 단계에서 오류가 발생하면 복원을 위해 해당 turn의 `events`를 유지해야 한다(SHOULD).

### 11.3 실행 순서와 확장 순서

1. Mutator 포인트는 extension 등록 순서대로 실행되어야 한다(MUST).
2. Middleware 포인트는 먼저 등록된 extension이 바깥 레이어가 되어야 한다(MUST).
3. 동일 포인트 실행 순서는 결정론적으로 재현 가능해야 한다(MUST).
4. priority가 존재하면 priority 정렬 후 안정 정렬을 적용해야 한다(SHOULD).

#### 11.3.1 Extension 파이프라인과 Agent Hook의 실행 순서

1. Extension 파이프라인은 Agent Hook보다 항상 먼저 실행되어야 한다(MUST).
2. Middleware 포인트에서 Extension은 Agent Hook보다 바깥 레이어여야 한다(MUST).
3. 동일 포인트에 Extension 파이프라인과 Agent Hook이 모두 등록된 경우, Extension 전체 → Agent Hook 전체 순서를 따라야 한다(MUST).

### 11.4 changeset 커밋/활성화 실패 처리

1. changeset commit/activation 실패는 tool 결과로 관측 가능해야 한다(MUST).
2. Runtime은 실패 이벤트를 Instance event log에 기록하는 것을 권장한다(SHOULD).
3. 실패가 발생해도 Step 자체를 즉시 중단하지 않고 후속 판단을 LLM/정책에 위임할 수 있다(SHOULD).

### 11.5 선택 포인트(비표준)

구현체는 표준 포인트 외에 추가 파이프라인 포인트를 제공할 수 있다(MAY).

규칙:

1. 비표준 포인트는 표준 포인트 동작을 깨뜨리지 않아야 한다(MUST).
2. 비표준 포인트를 제공하는 경우 문서화해야 한다(SHOULD).

### 11.6 Reconcile Identity 규칙

Runtime은 `step.config` 이후 reconcile 단계에서 배열을 인덱스가 아닌 identity key 기반으로 비교해야 한다(MUST).

#### 11.6.1 Reconcile 대상

Reconcile 대상은 "이전 Step에서 활성화된 Effective Config"와 "현재 Step에서 활성화될 Effective Config"의 차이여야 한다(MUST).

이 비교는 changeset merge로 SwarmBundleRef가 변경된 경우에도 동일하게 적용되어야 한다(MUST).

#### 11.6.2 Identity Key 정의

- ToolRef identity: `"{kind}/{name}"`
- ExtensionRef identity: `"{kind}/{name}"`
- Hook identity: `hook.id` 권장, 없으면 `(point, priority, actionFingerprint)` 조합

#### 11.6.3 Reconcile 알고리즘 요구사항

1. 동일 identity가 유지되는 항목은 실행 상태를 유지해야 한다(MUST).
2. 배열 순서 변경만으로 상태 재생성이 발생해서는 안 된다(MUST).
3. 항목 제거 시 cleanup을 수행해야 한다(MUST).
4. 항목 추가 시 초기화(init)를 수행해야 한다(MUST).

#### 11.6.4 Stateful MCP 연결 유지

1. `attach.mode=stateful` MCP Extension은 동일 identity로 유지되는 동안 연결을 유지해야 한다(MUST).
2. 다음 경우에만 재연결할 수 있다(MUST).
   - Extension이 Effective Config에서 제거된 경우
   - transport/attach/expose 변경으로 연결 호환성이 깨진 경우
