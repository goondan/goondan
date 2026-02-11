## 5. 핵심 개념

### 5.1 Orchestrator, AgentProcess, Turn, Step

- **Orchestrator**: `gdn run`으로 기동되는 **상주 프로세스**다. Swarm 전체의 생명주기를 관리하며, AgentProcess와 ConnectorProcess를 스폰/감시/재시작한다. 모든 에이전트 간 통신(delegate/handoff)은 Orchestrator를 경유하는 IPC 메시지 패싱으로 이루어진다.
- **AgentProcess**: Agent 정의를 바탕으로 생성되는 **독립 Bun 프로세스**다. 각 AgentInstance는 자체 메모리 공간을 가지며, 크래시 시 Orchestrator가 감지하여 자동 재스폰할 수 있다. 입력 이벤트 큐를 보유한다.
- **Turn**: AgentProcess가 하나의 입력 이벤트(`AgentEvent`)를 처리하는 단위. 필요한 Step을 반복한 후 종료한다.
- **Step**: LLM 호출 1회를 중심으로 하는 실행 단위. 해당 응답의 tool call 처리까지 포함한다.

규칙:

1. AgentInstance 이벤트 큐는 FIFO 직렬 처리여야 한다(MUST).
2. 각 AgentInstance는 독립 Bun 프로세스로 실행되어야 한다(MUST). 프로세스 간 상태 공유는 IPC를 통해서만 이루어져야 한다(MUST).
3. Orchestrator는 에이전트가 모두 종료되어도 상주하며, 새로운 이벤트(Connector 수신, CLI 입력 등)가 오면 필요한 AgentProcess를 다시 스폰해야 한다(MUST).
4. Runtime은 Turn 메시지를 `NextMessages = BaseMessages + SUM(Events)` 규칙으로 계산해야 하며, 각 Step의 LLM 입력은 항상 이 계산 결과를 사용해야 한다(MUST).
5. `BaseMessages`는 Turn 시작 시 디스크(`base.jsonl`)에서 로드된 기준 메시지 집합이고, `Events`는 Turn 중 누적되는 `MessageEvent` 집합이어야 한다(MUST).
6. Turn 종료 시 Runtime은 최종 `BaseMessages + SUM(Events)`를 새로운 base로 저장하고, 적용된 `Events`를 비워야 한다(MUST).
7. Turn은 추적 가능성을 위해 `traceId`를 가져야 하며, Step/ToolCall/Event 로그로 전파되어야 한다(SHOULD).

#### 5.1.1 IPC (Inter-Process Communication)

에이전트 간 통신은 Orchestrator를 경유하는 메시지 패싱으로 구현한다.

규칙:

1. 위임(delegate) 요청은 Orchestrator가 수신하여 대상 AgentProcess로 라우팅해야 한다(MUST). 대상 프로세스가 없으면 Orchestrator가 스폰해야 한다(MUST).
2. 위임 결과는 `correlationId`를 통해 원래 요청자에게 반환되어야 한다(MUST).
3. IPC 메시지 타입은 최소 `delegate`, `delegate_result`, `event`, `shutdown`을 포함해야 한다(MUST).

#### 5.1.2 Message (메시지 래퍼)

모든 LLM 메시지는 AI SDK의 `CoreMessage`를 `Message`로 감싸서 관리한다.

```typescript
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
```

규칙:

1. `Message.data`는 AI SDK `CoreMessage` 형식을 그대로 사용해야 한다(MUST).
2. `Message.id`는 메시지를 고유하게 식별해야 하며, `MessageEvent`의 `targetId`로 참조된다(MUST).
3. `Message.metadata`는 Extension 미들웨어에서 자유롭게 읽기/쓰기할 수 있어야 한다(MUST).

#### 5.1.3 MessageEvent (이벤트 소싱)

메시지 상태는 이벤트 소싱 모델로 관리한다.

```
NextMessages = BaseMessages + SUM(Events)
```

`MessageEvent` 타입:

| 타입 | 설명 |
|------|------|
| `append` | 새 Message를 목록 끝에 추가 |
| `replace` | `targetId`로 식별된 기존 Message를 새 Message로 교체 |
| `remove` | `targetId`로 식별된 기존 Message를 제거 |
| `truncate` | 전체 메시지 목록을 비움 |

규칙:

1. Extension 미들웨어는 메시지를 직접 배열 변경하는 대신 `MessageEvent`를 발행하여 조작해야 한다(MUST).
2. Turn 종료 후 `events`는 `base`로 폴딩되고, `events`는 클리어되어야 한다(MUST).
3. 복구 시 `base + events` 재생으로 정확한 상태를 복원할 수 있어야 한다(MUST).

### 5.2 Tool

Tool은 LLM이 tool call로 호출하는 1급 실행 단위다. Tool은 외부 API 호출, 파일 수정, 에이전트 간 위임(delegate) 같은 작업을 수행할 수 있다.

#### 5.2.1 도구 이름 규칙

LLM에 노출되는 도구 이름은 **`{Tool 리소스 이름}__{하위 도구 이름}`** 형식을 따른다. `__` (더블 언더스코어)를 구분자로 사용한다.

```
Tool 리소스: bash        → exports: exec, script
LLM 도구 이름: bash__exec, bash__script

Tool 리소스: file-system → exports: read, write
LLM 도구 이름: file-system__read, file-system__write
```

규칙:

1. Tool 실행 허용 범위는 기본적으로 현재 Step의 Tool Catalog에 의해 제한되어야 한다(MUST).
2. Tool 오류는 예외 전파 대신 구조화된 ToolResult로 LLM에 전달되어야 한다(MUST).
3. LLM에 노출되는 도구 이름은 `{Tool 리소스 metadata.name}__{export name}` 형식이어야 한다(MUST). 구분자는 `__`(더블 언더스코어)를 사용해야 한다(MUST).
4. Tool 리소스 이름과 export name에는 `__`가 포함되어서는 안 된다(MUST NOT).

### 5.3 Extension

Extension은 런타임 라이프사이클에 개입하는 미들웨어 로직 묶음이다. Extension은 파이프라인을 통해 도구 카탈로그, 메시지 히스토리, LLM 호출, tool call 실행을 제어할 수 있다.

#### 5.3.1 미들웨어 모델

모든 파이프라인 훅은 **Middleware** 형태로 통일된다. `next()` 호출 전후로 전처리(pre)/후처리(post)를 수행한다.

| 미들웨어 | 설명 |
|----------|------|
| `turn` | Turn 전체를 감싸는 미들웨어. `next()` 전: 메시지 히스토리 조작. `next()` 후: 결과 후처리 |
| `step` | Step(LLM 호출 + 도구 실행)을 감싸는 미들웨어. `next()` 전: 도구/컨텍스트 조작. `next()` 후: 결과 변환, 로깅, 재시도 |
| `toolCall` | 개별 도구 호출을 감싸는 미들웨어. `next()` 전: 입력 검증/변환. `next()` 후: 결과 변환 |

규칙:

1. Extension은 `register(api: ExtensionApi)` 함수를 통해 미들웨어를 등록해야 한다(MUST).
2. 미들웨어는 반드시 `next()`를 호출하여 다음 미들웨어 또는 핵심 로직을 실행해야 한다(MUST). `next()`를 호출하지 않으면 해당 실행 단계가 스킵된다.
3. 미들웨어 실행 순서는 Extension 등록 순서를 따라야 한다(MUST).

#### 5.3.2 Skill

Skill은 `SKILL.md`를 중심으로 한 파일 번들이다. Skill 발견/카탈로그/주입/열기는 Extension 패턴으로 구현한다.

#### 5.3.3 MCP Extension (패턴)

MCP 연동은 MCP 서버의 tool/resource/prompt를 런타임에 연결하는 Extension 패턴이다. MCP Extension은 Extension의 `tools.register`를 통해 동적으로 도구를 등록하는 방식으로 구현할 수 있다(MAY).

#### 5.3.4 컨텍스트 윈도우 관리

컨텍스트 윈도우/메모리 최적화는 코어 런타임의 강제 책임이 아니며, Extension 미들웨어로 구현한다. Extension은 `turn` 미들웨어에서 `ConversationState`의 메시지를 `MessageEvent`로 조작하여 compaction을 수행할 수 있다. 기본 배포(`packages/base`)는 compaction 전략 Extension을 제공하는 것을 권장한다(SHOULD).

### 5.4 Connector / Connection

#### 5.4.1 Connector

Connector는 외부 채널 이벤트를 canonical `ConnectorEvent`로 정규화하는 프로토콜 어댑터다. Connector는 **별도 Bun 프로세스**로 실행되며, 프로토콜 수신(HTTP 서버, cron 스케줄러, WebSocket, 롱 폴링 등)을 **자체적으로** 관리한다.

규칙:

1. Connector는 독립 Bun 프로세스로 실행되어야 한다(MUST). Orchestrator가 프로세스를 스폰하고 감시한다.
2. Connector는 프로토콜 처리를 직접 구현해야 한다(MUST). Runtime이 프로토콜을 대신 관리하지 않는다.
3. Connector는 정규화된 `ConnectorEvent`를 `ctx.emit()`으로 Orchestrator에 전달해야 한다(MUST).
4. Connector는 Connection이 제공한 서명 시크릿을 사용하여 inbound 요청의 서명 검증을 수행해야 한다(MUST).
5. ConnectorEvent는 `instanceKey`를 포함하여 Orchestrator가 적절한 AgentProcess로 라우팅할 수 있게 해야 한다(MUST).

#### 5.4.2 Connection

Connection은 Connector를 특정 배포 환경에 바인딩하는 리소스다. 시크릿(API 토큰, 서명 시크릿 등)을 제공하고, ingress 라우팅 규칙을 정의한다. 하나의 Connector를 여러 Connection이 서로 다른 인증/라우팅으로 재사용할 수 있다.

규칙:

1. Connection은 Connector가 사용할 시크릿(토큰, 서명 키 등)을 제공해야 한다(MUST).
2. Connection의 ingress 규칙은 ConnectorEvent를 특정 Agent로 라우팅하는 데 사용되어야 한다(MUST).
3. `ingress.rules[].route.agentRef`가 생략되면 Swarm의 entryAgent로 라우팅해야 한다(MUST).

### 5.5 Bundle / Package

#### 5.5.1 Bundle

Bundle은 YAML 리소스와 소스코드(도구/확장/커넥터/프롬프트/기타 파일)를 함께 포함하는 폴더 트리다. 기본 번들 파일은 `goondan.yaml`이며, 단일 YAML 파일에 다중 문서(`---`)를 포함하거나 여러 YAML 파일로 분리할 수 있다.

#### 5.5.2 Package

Package는 goondan 프로젝트의 최상위 리소스로, `goondan.yaml`의 첫 번째 YAML 문서로 정의된다. 의존성 해석, 배포, 버전 관리를 위한 메타데이터를 포함한다. `kind: Package`로 표기한다.

#### 5.5.3 설정 변경 (Edit & Restart)

설정 변경은 **Edit & Restart** 모델을 따른다. `goondan.yaml` 또는 개별 리소스 파일을 수정하면, Orchestrator가 설정 변경을 감지(watch 모드)하거나 CLI 명령(`gdn restart`)을 수신하여 해당 에이전트 프로세스를 재시작한다.

규칙:

1. Orchestrator는 `--watch` 모드에서 파일 변경 감지 시 영향받는 에이전트 프로세스만 선택적으로 재시작해야 한다(SHOULD).
2. 재시작 시 기본적으로 기존 대화 히스토리를 유지해야 한다(MUST). `--fresh` 옵션으로 초기화를 선택할 수 있다(MAY).
3. Orchestrator는 `gdn restart` CLI 명령을 수신하여 수동 재시작을 지원해야 한다(MUST).
