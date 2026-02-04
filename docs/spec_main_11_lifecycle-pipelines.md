## 11. 라이프사이클 파이프라인(훅) 스펙

### 11.1 파이프라인 타입

* Mutator: 순차 실행을 통해 상태를 변형
* Middleware: `next()` 기반 래핑(온니언 구조)

### 11.2 표준 파이프라인 포인트

Runtime은 최소 다음 포인트를 제공해야 한다(MUST).

* Turn: `turn.pre`, `turn.post`
* Step: `step.pre`, `step.config`, `step.tools`, `step.blocks`, `step.llmCall`, `step.llmError`, `step.post`
* ToolCall: `toolCall.pre`, `toolCall.exec`, `toolCall.post`
* Workspace: `workspace.repoAvailable`, `workspace.worktreeMounted`

규칙:

* `step.config`는 `step.tools`보다 먼저 실행되어야 한다(MUST).
* `step.llmError`는 LLM 호출 실패 시 실행되며, Runtime은 후속 처리 이후 LLM 재시도를 수행할 수 있다(MAY).

### 11.3 실행 순서와 확장 순서

* Mutator 포인트: extensions 등록 순서대로 선형 실행
* Middleware 포인트: 먼저 등록된 확장이 더 바깥 레이어

hooks 합성:

* 동일 포인트 내 실행 순서는 결정론적으로 재현 가능해야 한다(MUST).
* priority가 있으면 priority 정렬 후 안정 정렬(SHOULD).

### 11.4 changeset 커밋/활성화 실패 처리 (SHOULD)

Changeset commit 또는 활성화 실패는 changeset-status에 `result="failed"`로 기록하고, Step 자체는 계속 진행하는 정책을 SHOULD 한다. (fail-fast는 구현 선택)

### 11.6 Reconcile Identity 규칙 (MUST)

Runtime은 step.config 이후 reconcile 단계에서 배열(list)을 인덱스 기반이 아니라 identity 기반으로 비교해야 한다(MUST).

#### 11.6.1 Identity Key 정의 (MUST)

* ToolRef identity: `"{kind}/{name}"`
* ExtensionRef identity: `"{kind}/{name}"`
* Hook identity: `hook.id`(권장) 또는 `(point, priority, actionFingerprint)` 조합(SHOULD)

#### 11.6.2 Reconcile 알고리즘 요구사항 (MUST)

* 동일 identity key가 Effective Config에 계속 존재하는 한, Runtime은 해당 항목의 실행 상태를 유지해야 한다(MUST).
* 배열의 순서 변경은 연결/상태 재생성의 원인이 되어서는 안 된다(MUST).

#### 11.6.3 Stateful MCP 연동 Extension 연결 유지 규칙 (MUST)

* `config.attach.mode=stateful`인 MCP 연동 Extension은 동일 identity key로 Effective Config에 유지되는 동안 연결(프로세스/세션)을 유지해야 한다(MUST).
* Runtime이 stateful MCP 연결을 재연결할 수 있는 경우는 최소 다음에 한정되어야 한다(MUST).

  * 해당 MCP 연동 Extension이 Effective Config에서 제거된 경우
  * 해당 Extension의 연결 구성(transport/attach/expose 등)이 변경되어 연결 호환성이 깨진 경우
