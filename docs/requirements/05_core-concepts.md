## 5. 핵심 개념

### 5.1 Instance, Turn, Step

- **SwarmInstance**: Swarm 정의를 바탕으로 생성되는 long-running 실행체. 하나 이상의 AgentInstance를 포함한다.
- **AgentInstance**: Agent 정의를 바탕으로 생성되는 long-running 실행체. 입력 이벤트 큐를 보유한다.
- **Turn**: AgentInstance가 하나의 입력 이벤트를 처리하는 단위. 필요한 Step을 반복한 후 종료한다.
- **Step**: LLM 호출 1회를 중심으로 하는 실행 단위. 해당 응답의 tool call 처리(동기 완료 또는 비동기 제출)까지 포함한다.

규칙:

1. AgentInstance 이벤트 큐는 FIFO 직렬 처리여야 한다(MUST).
2. Step 시작 후 종료 전까지 Effective Config와 SwarmBundleRef는 고정되어야 한다(MUST).
3. Changeset 커밋으로 생성된 SwarmBundleRef는 Safe Point(최소 `step.config`)에서만 활성화되어야 한다(MUST).
4. Runtime은 Turn 메시지를 `NextMessages = BaseMessages + SUM(Events)` 규칙으로 계산해야 하며, 각 Step의 LLM 입력은 항상 이 계산 결과를 사용해야 한다(MUST).
5. `BaseMessages`는 turn 시작 시 디스크(`base.jsonl`)에서 로드된 기준 메시지 집합이고, `Events`는 turn 중 append되는 메시지 조작 이벤트 집합이어야 한다(MUST).
6. Turn 종료 시 Runtime은 최종 `BaseMessages + SUM(Events)`를 새로운 base로 저장하고, 적용된 `Events`를 비워야 한다(MUST).
7. Turn은 추적 가능성을 위해 `traceId`를 가져야 하며, Step/ToolCall/Event 로그로 전파되어야 한다(SHOULD).

### 5.2 Tool

Tool은 LLM이 tool call로 호출하는 1급 실행 단위다. Tool은 외부 API 호출, 파일 수정, 런타임 제어(open/commit changeset, handoff 요청) 같은 작업을 수행할 수 있다.

규칙:

1. Tool 실행 허용 범위는 기본적으로 현재 Step의 Tool Catalog에 의해 제한되어야 한다(MUST).
2. Tool 오류는 예외 전파 대신 구조화된 ToolResult로 LLM에 전달되어야 한다(MUST).
3. Tool이 OAuth를 사용하는 경우, subject 결정은 Turn의 인증 컨텍스트(`turn.auth.subjects`)를 기준으로 해야 한다(MUST).

### 5.3 Extension

Extension은 런타임 라이프사이클 포인트에 개입하는 실행 로직 묶음이다. Extension은 파이프라인을 통해 도구 카탈로그, 컨텍스트 블록, LLM 호출, tool call 실행을 제어할 수 있다.

#### 5.3.1 Skill

Skill은 `SKILL.md`를 중심으로 한 파일 번들이다. Skill 발견/카탈로그/주입/열기는 Extension 패턴으로 구현한다.

#### 5.3.2 MCP Extension (패턴)

MCP 연동은 MCP 서버의 tool/resource/prompt를 런타임에 연결하는 Extension 패턴이다. `attach.mode=stateful` 구성은 reconcile 시 identity 기반 연결 유지 규칙을 따라야 한다.

#### 5.3.3 컨텍스트 윈도우 관리

컨텍스트 윈도우/메모리 최적화는 코어 런타임의 강제 책임이 아니며, Extension으로 구현한다. 다만 기본 배포(`packages/base`)는 sliding window/compaction 전략 Extension을 제공하는 것을 권장한다(SHOULD).

### 5.4 Connector / Connection

#### 5.4.1 Connector

Connector는 외부 채널 이벤트를 canonical event로 정규화하는 프로토콜 어댑터다. Connector는 실행 모델(Instance/Turn/Step)을 직접 제어하지 않는다. Connector는 Connection으로부터 제공받은 인증 정보를 사용하여 inbound 서명 검증 등 프로토콜 수준의 인증을 수행한다.

Connector의 이벤트 수신 방식은 두 가지로 구분된다.

1. **Runtime 관리 trigger**: Runtime이 이벤트를 수신하여 Connector에 전달한다 (`http`, `cron`, `cli`).
2. **Custom trigger**: Connector가 자체적으로 이벤트 소스를 관리한다 (`custom`). 예: Telegram 롱 폴링, Discord WebSocket, MQTT 구독 등. Runtime은 Entry 함수를 한 번 호출하고, 함수가 직접 이벤트 수신 루프를 실행한다. Runtime은 `AbortSignal`을 통해 종료를 요청한다.

#### 5.4.2 Connection

Connection은 Connector를 특정 배포 환경에 바인딩하는 리소스다. 인증 정보(OAuth/Static Token/서명 시크릿)를 제공하고, ingress 라우팅 규칙을 정의한다. 하나의 Connector를 여러 Connection이 서로 다른 인증/라우팅으로 재사용할 수 있다.

### 5.5 SwarmBundle / Changeset / SwarmBundleRef

#### 5.5.1 Bundle

Bundle은 YAML 리소스와 소스코드(도구/확장/커넥터/프롬프트/기타 파일)를 함께 포함하는 폴더 트리다.

#### 5.5.2 Bundle Package

Bundle Package는 Bundle을 배포/버전관리/의존성 해석하기 위한 패키징 단위다. 하위 호환을 위해 `kind: Bundle` 표기를 유지할 수 있다.

#### 5.5.3 SwarmBundle

SwarmBundle은 Swarm(및 그 하위 Agent/Tool/Extension/Connector/Connection/OAuthApp 등)을 정의하는 Bundle이다.

#### 5.5.4 SwarmBundleRef

SwarmBundleRef는 특정 SwarmBundle 스냅샷을 식별하는 불변 식별자(opaque string)다. Git 기반 구현에서는 commit SHA 또는 ref를 사용하는 것을 권장한다(SHOULD).

규칙:

1. 동일 SwarmBundleRef는 동일 콘텐츠를 재현 가능해야 한다(MUST).
2. Step은 시작 시점의 SwarmBundleRef로 핀되어야 한다(MUST).

#### 5.5.5 Changeset

Changeset은 SwarmBundle 변경 단위다. open된 changeset은 commit 전까지 실행에 영향을 주지 않고, commit 시 새 SwarmBundleRef를 생성한다.

#### 5.5.6 Canonical Writer 규칙

SwarmBundle 정본은 SwarmBundleRoot의 Git history/refs이며, Ref 이동/commit은 Runtime 내부 SwarmBundleManager만 수행해야 한다(MUST).

#### 5.5.7 Safe Point 규칙

Runtime은 최소 `step.config` Safe Point를 제공해야 하며, Step 실행 중에는 Ref/Config를 변경해서는 안 된다(MUST).
