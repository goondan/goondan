## 11. 라이프사이클 파이프라인 (미들웨어)

Goondan v2에서는 모든 파이프라인 훅을 **Middleware** 형태로 통일한다. 기존의 Mutator 타입과 13개 세분화 파이프라인 포인트를 제거하고, `next()` 호출 전후로 전처리(pre)/후처리(post)를 수행하는 3종 미들웨어로 단순화한다.

### 11.1 파이프라인 타입: Middleware Only

규칙:

1. 모든 파이프라인 훅은 **Middleware** 형태여야 한다(MUST). Mutator 타입은 제거한다.
2. Middleware는 `next()` 함수를 호출하여 다음 레이어를 실행하는 온니언(onion) 패턴을 따라야 한다(MUST).
3. `next()` 호출 전은 전처리(pre), `next()` 호출 후는 후처리(post) 시점에 해당한다.
4. Middleware는 `next()`를 반드시 한 번 호출해야 한다(MUST). 호출하지 않으면 이후 레이어와 핵심 로직이 실행되지 않는다.
5. Middleware는 `next()`의 반환값을 변환하여 반환할 수 있다(MAY).

### 11.2 미들웨어 종류

Runtime은 다음 3종의 미들웨어를 제공해야 한다(MUST).

#### 11.2.1 `turn` 미들웨어

Turn 전체를 감싸는 미들웨어이다.

규칙:

1. `turn` 미들웨어는 Turn의 전체 실행을 래핑해야 한다(MUST).
2. `next()` 호출 전(turn.pre 시점): 메시지 히스토리 조작, ConversationState 접근, MessageEvent 발행이 가능해야 한다(MUST).
3. `next()` 호출 후(turn.post 시점): Turn 결과 후처리, 추가 MessageEvent 발행이 가능해야 한다(MUST).
4. 컨텍스트에는 `agentName`, `instanceKey`, `inputEvent`, `conversationState`, `emitMessageEvent()`, `metadata`가 포함되어야 한다(MUST).

기존 `turn.pre`, `turn.post` 두 개의 파이프라인 포인트가 이 단일 미들웨어로 통합된다.

#### 11.2.2 `step` 미들웨어

Step(LLM 호출 + 도구 실행)을 감싸는 미들웨어이다.

규칙:

1. `step` 미들웨어는 단일 Step의 전체 실행(LLM 호출 및 도구 실행)을 래핑해야 한다(MUST).
2. `next()` 호출 전(step.pre 시점): Tool Catalog 조작, ConversationState 접근, MessageEvent 발행, 컨텍스트 메타데이터 설정이 가능해야 한다(MUST).
3. `next()` 호출 후(step.post 시점): Step 결과 검사/변환, 로깅, 재시도 판단이 가능해야 한다(MUST).
4. 컨텍스트에는 `turn`, `stepIndex`, `conversationState`, `emitMessageEvent()`, `toolCatalog`, `metadata`가 포함되어야 한다(MUST).
5. `toolCatalog`는 변경 가능(mutable)해야 하며, 미들웨어에서 도구 목록을 필터링/추가/수정할 수 있어야 한다(MUST).

기존 `step.pre`, `step.config`, `step.tools`, `step.blocks`, `step.llmInput`, `step.llmCall`, `step.llmError`, `step.post` 8개의 파이프라인 포인트가 이 단일 미들웨어로 통합된다.

#### 11.2.3 `toolCall` 미들웨어

개별 도구 호출을 감싸는 미들웨어이다.

규칙:

1. `toolCall` 미들웨어는 개별 도구 호출의 전체 실행을 래핑해야 한다(MUST).
2. `next()` 호출 전(toolCall.pre 시점): 입력 인자 검증/변환이 가능해야 한다(MUST).
3. `next()` 호출 후(toolCall.post 시점): 도구 호출 결과 변환/로깅이 가능해야 한다(MUST).
4. 컨텍스트에는 `toolName`, `toolCallId`, `args`, `metadata`가 포함되어야 한다(MUST).
5. `args`는 변경 가능(mutable)해야 하며, 미들웨어에서 도구 호출 인자를 수정할 수 있어야 한다(MUST).

기존 `toolCall.pre`, `toolCall.exec`, `toolCall.post` 3개의 파이프라인 포인트가 이 단일 미들웨어로 통합된다.

### 11.3 실행 순서

#### 11.3.1 온니언 모델

규칙:

1. 미들웨어는 **온니언(onion) 모델**로 실행되어야 한다(MUST). 먼저 등록된 Extension의 미들웨어가 바깥 레이어(outermost)가 된다.
2. 실행 흐름: 바깥 레이어 pre -> 안쪽 레이어 pre -> 핵심 로직 -> 안쪽 레이어 post -> 바깥 레이어 post 순서를 따라야 한다(MUST).

```text
Extension-A.turn (바깥)
  ├── pre 처리
  ├── Extension-B.turn (안쪽)
  │   ├── pre 처리
  │   ├── [핵심 Turn 로직: Step 루프 실행]
  │   └── post 처리
  └── post 처리
```

#### 11.3.2 등록 순서와 우선순위

규칙:

1. 동일 종류 미들웨어의 실행 순서는 Extension 등록 순서에 의해 결정론적으로 재현 가능해야 한다(MUST).
2. Extension 등록 순서는 Agent 리소스의 `extensions` 배열 순서를 따라야 한다(MUST).
3. `priority`가 지정된 경우 priority 값으로 정렬한 뒤, 동일 priority 내에서는 등록 순서로 안정 정렬(stable sort)을 적용해야 한다(SHOULD).
4. 먼저 등록된(또는 priority가 높은) Extension의 미들웨어가 바깥 레이어가 되어야 한다(MUST).

#### 11.3.3 Extension 등록

규칙:

1. Extension은 entry 함수에서 `ExtensionApi.pipeline.register(type, handler)` 호출로 미들웨어를 등록해야 한다(MUST).
2. `type`은 `'turn'`, `'step'`, `'toolCall'` 중 하나여야 한다(MUST).
3. 하나의 Extension이 여러 종류의 미들웨어를 동시에 등록할 수 있어야 한다(MUST).
4. 하나의 Extension이 같은 종류의 미들웨어를 여러 개 등록할 수 있어야 한다(MAY).

### 11.4 Turn 메시지 상태 계약

Turn 미들웨어는 다음 메시지 상태 계약을 따라야 한다.

규칙:

1. `turn` 미들웨어 진입 시(`next()` 호출 전) 컨텍스트의 `conversationState`에는 Turn 시작 기준 `baseMessages`가 포함되어야 한다(MUST).
2. `turn` 미들웨어에서 `emitMessageEvent()`로 발행한 이벤트는 `conversationState.events`에 누적되어야 한다(MUST).
3. `next()` 호출 후(turn.post 시점)에도 추가 MessageEvent를 발행할 수 있어야 한다(MUST).
4. Runtime은 모든 `turn` 미들웨어의 `next()` 체인이 완료된 후에만 `base + SUM(events)`를 base에 반영해야 한다(MUST).
5. `turn` 미들웨어 체인에서 오류가 발생하면 복원을 위해 해당 Turn의 `events`를 유지해야 한다(SHOULD).

### 11.5 제거된 항목

v2에서 다음 항목은 제거된다:

- **Mutator 타입**: 순차 실행으로 상태를 변형하는 Mutator는 제거된다. 모든 훅은 Middleware 형태를 사용한다.
- **13개 세분화 파이프라인 포인트**: `turn.pre`, `turn.post`, `step.pre`, `step.config`, `step.tools`, `step.blocks`, `step.llmInput`, `step.llmCall`, `step.llmError`, `step.post`, `toolCall.pre`, `toolCall.exec`, `toolCall.post`는 3종 미들웨어로 통합된다.
- **Reconcile Identity 규칙**: Step 간 Effective Config 비교 및 identity key 기반 reconcile 알고리즘은 제거된다.
- **Changeset 커밋/활성화 실패 처리**: Changeset 시스템이 제거되었으므로 관련 파이프라인 포인트도 제거된다.
- **Stateful MCP 연결 유지 규칙**: Reconcile과 연계된 MCP 연결 유지 규칙은 제거된다.

### 11.6 선택 포인트(비표준)

구현체는 3종 표준 미들웨어 외에 추가 미들웨어 종류를 제공할 수 있다(MAY).

규칙:

1. 비표준 미들웨어는 표준 미들웨어(`turn`, `step`, `toolCall`)의 동작을 깨뜨리지 않아야 한다(MUST).
2. 비표준 미들웨어를 제공하는 경우 문서화해야 한다(SHOULD).
3. 비표준 미들웨어도 동일한 `next()` 기반 온니언 모델을 따라야 한다(MUST).
