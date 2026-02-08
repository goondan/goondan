# Goondan Runtime 실행 모델 스펙 (v0.10)

본 문서는 `docs/requirements/index.md`(특히 05/09/11 섹션)를 기반으로 Runtime 실행 모델의 상세 구현 스펙을 정의한다. Config/Bundle 스펙은 `docs/specs/bundle.md`를, API 스펙은 `docs/specs/api.md`를 따른다.

---

## 1. 개요

Goondan Runtime은 다음 계층으로 구성된다.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Runtime                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   SwarmInstance                           │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │              AgentInstance (entrypoint)             │  │  │
│  │  │  ┌──────────────────────────────────────────────┐  │  │  │
│  │  │  │        Turn (입력 이벤트 처리 단위)            │  │  │  │
│  │  │  │  ┌────────────────────────────────────────┐  │  │  │  │
│  │  │  │  │      Step (LLM 호출 1회 단위)           │  │  │  │  │
│  │  │  │  └────────────────────────────────────────┘  │  │  │  │
│  │  │  └──────────────────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │           AgentInstance (delegate target)           │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 핵심 타입 정의

### 2.1 공통 타입

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

### 2.2 SwarmInstance 타입

```typescript
/**
 * SwarmInstance: Swarm 정의를 바탕으로 만들어지는 long-running 실행체
 *
 * 규칙:
 * - MUST: SwarmInstance는 하나 이상의 AgentInstance를 포함한다
 * - MUST: instanceKey로 고유하게 식별된다
 * - MUST: swarmRef로 Swarm 정의를 참조한다
 */
interface SwarmInstance {
  /** 인스턴스 고유 ID (내부 식별용, UUID 권장) */
  readonly id: string;

  /** 라우팅 키 (동일 맥락을 같은 인스턴스로 연결) */
  readonly instanceKey: string;

  /** 참조하는 Swarm 정의 */
  readonly swarmRef: ObjectRefLike;

  /** 현재 활성화된 SwarmBundleRef (불변 스냅샷 식별자) */
  activeSwarmBundleRef: SwarmBundleRef;

  /** 포함된 AgentInstance 맵 (agentName -> AgentInstance) */
  readonly agents: Map<string, AgentInstance>;

  /** 인스턴스 생성 시각 */
  readonly createdAt: Date;

  /** 마지막 활동 시각 */
  lastActivityAt: Date;

  /** 인스턴스 상태 */
  status: SwarmInstanceStatus;

  /** 인스턴스 메타데이터 (확장용) */
  metadata: JsonObject;
}

type SwarmInstanceStatus = 'active' | 'idle' | 'paused' | 'terminated';

/**
 * SwarmBundleRef: 특정 SwarmBundle 스냅샷을 식별하는 불변 식별자
 *
 * 규칙:
 * - MUST: 동일 SwarmBundleRef는 동일한 Bundle 콘텐츠를 재현 가능해야 한다
 * - SHOULD: Git 기반 구현에서는 commit SHA를 사용한다
 */
type SwarmBundleRef = string; // opaque string (예: "git:abc123...")
```

### 2.3 AgentInstance 타입

```typescript
/**
 * AgentInstance: Agent 정의를 바탕으로 만들어지는 long-running 실행체
 *
 * 규칙:
 * - MUST: 이벤트 큐를 보유하고 FIFO 순서로 처리한다
 * - MUST: agentName으로 SwarmInstance 내에서 고유하게 식별된다
 */
interface AgentInstance {
  /** 인스턴스 고유 ID */
  readonly id: string;

  /** Agent 이름 (SwarmInstance 내 고유) */
  readonly agentName: string;

  /** 소속된 SwarmInstance 참조 */
  readonly swarmInstance: SwarmInstance;

  /** 참조하는 Agent 정의 */
  readonly agentRef: ObjectRefLike;

  /** 이벤트 큐 */
  readonly eventQueue: AgentEventQueue;

  /** 현재 진행 중인 Turn (없으면 null) */
  currentTurn: Turn | null;

  /** 완료된 Turn 수 */
  completedTurnCount: number;

  /** Extension별 상태 저장소 */
  readonly extensionStates: Map<string, JsonObject>;

  /** 인스턴스 공유 상태 (모든 Extension이 접근 가능) */
  readonly sharedState: JsonObject;

  /** 인스턴스 생성 시각 */
  readonly createdAt: Date;

  /** 마지막 활동 시각 */
  lastActivityAt: Date;

  /** 인스턴스 상태 */
  status: AgentInstanceStatus;
}

type AgentInstanceStatus = 'idle' | 'processing' | 'terminated';

/**
 * AgentEventQueue: AgentInstance의 이벤트 큐
 */
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

/**
 * AgentEvent: AgentInstance로 전달되는 이벤트
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
  | 'user.input'           // 사용자 입력
  | 'agent.delegate'       // 다른 에이전트로부터 위임
  | 'agent.delegationResult' // 위임 결과 반환
  | 'auth.granted'         // OAuth 승인 완료
  | 'system.wakeup'        // 시스템 재개
  | string;                // 확장 이벤트 타입
```

### 2.4 Turn 타입

```typescript
/**
 * Turn: AgentInstance가 "하나의 입력 이벤트"를 처리하는 단위
 *
 * 규칙:
 * - MUST: 작업이 소진될 때까지 Step 반복 후 제어 반납
 * - MUST: NextMessages = BaseMessages + SUM(Events) 규칙으로 LLM 입력 메시지를 계산
 * - MUST: origin과 auth는 Turn 생애주기 동안 불변
 */
interface Turn {
  /** Turn 고유 ID */
  readonly id: string;

  /** 추적 ID (MUST: Turn마다 생성/보존, Step/ToolCall/Event 로그로 전파) */
  readonly traceId: string;

  /** 소속된 AgentInstance 참조 */
  readonly agentInstance: AgentInstance;

  /** 입력 이벤트 */
  readonly inputEvent: AgentEvent;

  /** 호출 맥락 (불변) */
  readonly origin: TurnOrigin;

  /** 인증 컨텍스트 (불변) */
  readonly auth: TurnAuth;

  /** Turn 메시지 상태 (base + events + 계산 결과) */
  readonly messageState: TurnMessageState;

  /** 실행된 Step 목록 */
  readonly steps: Step[];

  /** 현재 Step 인덱스 */
  currentStepIndex: number;

  /** Turn 상태 */
  status: TurnStatus;

  /** Turn 시작 시각 */
  readonly startedAt: Date;

  /** Turn 종료 시각 (완료 시 설정) */
  completedAt?: Date;

  /** Turn 메타데이터 (확장용) */
  metadata: JsonObject;
}

/**
 * Turn 메시지 상태
 *
 * 규칙:
 * - MUST: nextMessages = fold(baseMessages, events)
 * - MUST: events는 append order를 보존
 */
interface TurnMessageState {
  /** Turn 시작 시 로드한 기준 메시지 */
  baseMessages: LlmMessage[];
  /** Turn 중 누적된 메시지 이벤트 */
  events: MessageEvent[];
  /** 현재 Step에서 사용할 계산 결과 */
  nextMessages: LlmMessage[];
}

type TurnStatus =
  | 'pending'      // 대기 중
  | 'running'      // 실행 중
  | 'completed'    // 정상 완료
  | 'failed'       // 실패
  | 'interrupted'; // 중단됨

/**
 * TurnOrigin: Turn의 호출 맥락 정보
 *
 * 규칙:
 * - SHOULD: Connector가 ingress 이벤트 변환 시 채운다
 */
interface TurnOrigin {
  /** Connector 이름 */
  connector?: string;

  /** 채널 식별자 (예: Slack channel ID) */
  channel?: string;

  /** 스레드 식별자 (예: Slack thread_ts) */
  threadTs?: string;

  /** 추가 맥락 정보 */
  [key: string]: JsonValue | undefined;
}

/**
 * TurnAuth: Turn의 인증 컨텍스트
 *
 * 규칙:
 * - MUST: 에이전트 간 handoff 시 변경 없이 전달되어야 한다
 * - MUST: subjectMode=user인 OAuthApp 사용 시 auth가 필수이다
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
    /** 전역 토큰용 (예: "slack:team:T111") */
    global?: string;
    /** 사용자 토큰용 (예: "slack:user:T111:U234567") */
    user?: string;
  };

  /** 추가 인증 메타데이터 */
  [key: string]: JsonValue | undefined;
}
```

### 2.5 Step 타입

```typescript
/**
 * Step: "LLM 호출 1회"를 중심으로 한 단위
 *
 * 규칙:
 * - MUST: Step이 시작되면 종료까지 Effective Config와 SwarmBundleRef가 고정
 * - MUST: LLM 응답의 tool call을 모두 처리한 시점에 종료
 */
interface Step {
  /** Step 고유 ID */
  readonly id: string;

  /** 소속된 Turn 참조 */
  readonly turn: Turn;

  /** Step 인덱스 (Turn 내에서 0부터 시작) */
  readonly index: number;

  /** 이 Step에 고정된 SwarmBundleRef */
  readonly activeSwarmBundleRef: SwarmBundleRef;

  /** 이 Step의 Effective Config */
  readonly effectiveConfig: EffectiveConfig;

  /** LLM에 노출된 Tool Catalog */
  readonly toolCatalog: ToolCatalogItem[];

  /** 컨텍스트 블록 */
  readonly blocks: ContextBlock[];

  /** LLM 호출 결과 */
  llmResult?: LlmResult;

  /** Tool 호출 목록 */
  readonly toolCalls: ToolCall[];

  /** Tool 결과 목록 */
  readonly toolResults: ToolResult[];

  /** Step 상태 */
  status: StepStatus;

  /** Step 시작 시각 */
  readonly startedAt: Date;

  /** Step 종료 시각 */
  completedAt?: Date;

  /** Step 메타데이터 */
  metadata: JsonObject;
}

type StepStatus =
  | 'pending'
  | 'config'        // step.config 단계
  | 'tools'         // step.tools 단계
  | 'blocks'        // step.blocks 단계
  | 'llmCall'       // step.llmCall 단계
  | 'toolExec'      // tool call 처리 중
  | 'post'          // step.post 단계
  | 'completed'
  | 'failed';

/**
 * EffectiveConfig: Step에서 사용할 최종 구성
 *
 * 규칙:
 * - MUST: Step 시작 시 activeSwarmBundleRef 기준으로 로드/조립
 * - MUST: Step 실행 중 변경 불가
 * - SHOULD: tools/extensions 배열은 identity key 기반으로 정규화
 */
interface EffectiveConfig {
  /** Swarm 구성 */
  readonly swarm: Resource<SwarmSpec>;

  /** Agent 구성 */
  readonly agent: Resource<AgentSpec>;

  /** 사용 가능한 Tool 목록 */
  readonly tools: readonly Resource<ToolSpec>[];

  /** 활성화된 Extension 목록 */
  readonly extensions: readonly Resource<ExtensionSpec>[];

  /** Model 구성 */
  readonly model: Resource<ModelSpec>;

  /** 시스템 프롬프트 */
  readonly systemPrompt: string;

  /** Effective Config 버전 (변경 감지용) */
  readonly revision: number;
}
```

### 2.6 LLM 메시지 타입

```typescript
/**
 * LlmMessage: LLM과의 대화 메시지 단위
 *
 * 규칙:
 * - MUST: 각 메시지는 id를 가져야 한다
 * - MUST: MessageEvent(replace/remove)의 참조 대상으로 사용 가능해야 한다
 */
type LlmMessage =
  | LlmSystemMessage
  | LlmUserMessage
  | LlmAssistantMessage
  | LlmToolMessage;

interface LlmSystemMessage {
  readonly id: string;
  readonly role: 'system';
  readonly content: string;
}

interface LlmUserMessage {
  readonly id: string;
  readonly role: 'user';
  readonly content: string;
}

interface LlmAssistantMessage {
  readonly id: string;
  readonly role: 'assistant';
  readonly content?: string;
  readonly toolCalls?: ToolCall[];
}

interface LlmToolMessage {
  readonly id: string;
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: JsonValue;
}

/**
 * Turn 메시지 조작 이벤트
 */
type MessageEvent =
  | SystemMessageEvent
  | LlmMessageEvent
  | ReplaceMessageEvent
  | RemoveMessageEvent
  | TruncateMessageEvent;

interface BaseMessageEvent {
  readonly seq: number;
  readonly recordedAt: string;
}

interface SystemMessageEvent extends BaseMessageEvent {
  readonly type: 'system_message';
  readonly message: LlmSystemMessage;
}

interface LlmMessageEvent extends BaseMessageEvent {
  readonly type: 'llm_message';
  readonly message: LlmUserMessage | LlmAssistantMessage | LlmToolMessage;
}

interface ReplaceMessageEvent extends BaseMessageEvent {
  readonly type: 'replace';
  readonly targetId: string;
  readonly message: LlmMessage;
}

interface RemoveMessageEvent extends BaseMessageEvent {
  readonly type: 'remove';
  readonly targetId: string;
}

interface TruncateMessageEvent extends BaseMessageEvent {
  readonly type: 'truncate';
}

/**
 * LlmResult: LLM 호출 결과
 */
interface LlmResult {
  /** 응답 메시지 */
  readonly message: LlmAssistantMessage;

  /** 사용량 정보 */
  readonly usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /** 완료 이유 */
  readonly finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter';

  /** 응답 메타데이터 */
  readonly meta?: JsonObject;
}
```

### 2.7 Tool 관련 타입

```typescript
/**
 * ToolCatalogItem: Step에서 LLM에 노출되는 도구 항목
 */
interface ToolCatalogItem {
  /** 도구 이름 */
  readonly name: string;

  /** 도구 설명 */
  readonly description?: string;

  /** 파라미터 스키마 (JSON Schema) */
  readonly parameters?: JsonObject;

  /** 원본 Tool 리소스 참조 */
  readonly tool?: Resource<ToolSpec> | null;

  /** Tool export 정보 */
  readonly export?: ToolExportSpec | null;

  /** 도구 소스 정보 (MCP, Extension 등) */
  readonly source?: JsonObject;
}

/**
 * ToolCall: LLM이 요청한 도구 호출
 */
interface ToolCall {
  /** Tool call 고유 ID */
  readonly id: string;

  /** 도구 이름 */
  readonly name: string;

  /** 입력 인자 */
  readonly input: JsonObject;
}

/**
 * ToolResult: 도구 실행 결과
 *
 * 규칙:
 * - MUST: 동기 완료 시 output 포함
 * - MAY: 비동기 제출 시 handle 포함
 * - MUST: 오류 시 error 정보를 output에 포함 (예외 전파 금지)
 */
interface ToolResult {
  /** 해당 tool call ID */
  readonly toolCallId: string;

  /** 도구 이름 */
  readonly toolName: string;

  /** 실행 결과 (동기 완료) */
  readonly output?: JsonValue;

  /** 비동기 핸들 */
  readonly handle?: string;

  /** 오류 정보 (output에 포함될 때의 형태) */
  readonly error?: {
    status: 'error';
    error: {
      message: string;
      name?: string;
      code?: string;
    };
  };
}

/**
 * ContextBlock: Step 컨텍스트에 주입되는 블록
 */
interface ContextBlock {
  /** 블록 타입 */
  readonly type: string;

  /** 블록 데이터 */
  readonly data?: JsonValue;

  /** 블록 아이템 목록 */
  readonly items?: JsonValue[];
}
```

---

## 3. 인스턴스 생명주기

### 3.1 SwarmInstance 생성 규칙

```typescript
/**
 * SwarmInstance 생성 알고리즘
 *
 * 규칙:
 * - MUST: instanceKey를 사용하여 동일 맥락을 같은 인스턴스로 라우팅
 * - MUST: 존재하지 않으면 새로 생성, 존재하면 기존 인스턴스 반환
 */
interface SwarmInstanceManager {
  /**
   * SwarmInstance 조회 또는 생성
   *
   * @param swarmRef - Swarm 정의 참조
   * @param instanceKey - 인스턴스 라우팅 키
   * @returns SwarmInstance
   */
  getOrCreate(
    swarmRef: ObjectRefLike,
    instanceKey: string
  ): Promise<SwarmInstance>;

  /**
   * SwarmInstance 조회
   *
   * @param instanceKey - 인스턴스 라우팅 키
   * @returns SwarmInstance 또는 undefined
   */
  get(instanceKey: string): SwarmInstance | undefined;

  /**
   * SwarmInstance 종료
   *
   * @param instanceKey - 인스턴스 라우팅 키
   */
  terminate(instanceKey: string): Promise<void>;

  /**
   * SwarmInstance 상태 조회
   *
   * @param instanceKey - 인스턴스 라우팅 키
   * @returns 인스턴스 상태 정보
   */
  inspect(instanceKey: string): Promise<SwarmInstanceInfo | undefined>;

  /**
   * SwarmInstance 일시정지
   * - MUST: paused 상태에서는 새 Turn을 실행해서는 안 된다
   *
   * @param instanceKey - 인스턴스 라우팅 키
   */
  pause(instanceKey: string): Promise<void>;

  /**
   * SwarmInstance 처리 재개
   * - MUST: 큐 적재 이벤트를 순서대로 재개해야 한다
   *
   * @param instanceKey - 인스턴스 라우팅 키
   */
  resume(instanceKey: string): Promise<void>;

  /**
   * SwarmInstance 상태 삭제
   * - MUST: 인스턴스 상태를 제거하되 시스템 전역 상태(OAuth grant 등)는 보존한다
   *
   * @param instanceKey - 인스턴스 라우팅 키
   */
  delete(instanceKey: string): Promise<void>;

  /**
   * 전체 SwarmInstance 목록 조회
   *
   * @returns 인스턴스 정보 목록
   */
  list(): Promise<SwarmInstanceInfo[]>;
}

/**
 * SwarmInstance 상태 정보 (inspect/list 용)
 */
interface SwarmInstanceInfo {
  /** 인스턴스 고유 ID */
  readonly id: string;

  /** 라우팅 키 */
  readonly instanceKey: string;

  /** Swarm 참조 */
  readonly swarmRef: ObjectRefLike;

  /** 현재 활성 SwarmBundleRef */
  readonly activeSwarmBundleRef: SwarmBundleRef;

  /** 인스턴스 상태 */
  readonly status: SwarmInstanceStatus;

  /** 포함된 Agent 이름 목록 */
  readonly agentNames: string[];

  /** 생성 시각 */
  readonly createdAt: Date;

  /** 마지막 활동 시각 */
  readonly lastActivityAt: Date;

  /** 메타데이터 */
  readonly metadata: JsonObject;
}

/**
 * SwarmInstance 생성 의사 코드
 */
async function getOrCreateSwarmInstance(
  swarmRef: ObjectRefLike,
  instanceKey: string,
  workspaceId: string
): Promise<SwarmInstance> {
  // 1. 기존 인스턴스 조회
  const existing = instanceStore.get(instanceKey);
  if (existing) {
    existing.lastActivityAt = new Date();
    return existing;
  }

  // 2. Swarm 정의 로드
  const swarmConfig = await configLoader.loadSwarm(swarmRef);

  // 3. 현재 활성 SwarmBundleRef 결정
  const activeSwarmBundleRef = await swarmBundleManager.getActiveRef();

  // 4. SwarmInstance 생성
  const instance: SwarmInstance = {
    id: generateId(),
    instanceKey,
    swarmRef,
    activeSwarmBundleRef,
    agents: new Map(),
    createdAt: new Date(),
    lastActivityAt: new Date(),
    status: 'active',
    metadata: {},
  };

  // 5. 진입점 AgentInstance 생성
  const entrypointAgent = await createAgentInstance(
    instance,
    swarmConfig.spec.entrypoint
  );
  instance.agents.set(entrypointAgent.agentName, entrypointAgent);

  // 6. 인스턴스 저장
  instanceStore.set(instanceKey, instance);

  // 7. 상태 디렉토리 초기화
  await initializeInstanceStateDir(workspaceId, instance.id);

  // 8. Swarm 이벤트 로그 기록
  await logSwarmEvent(instance, {
    kind: 'swarm.created',
    data: { swarmRef, instanceKey },
  });

  return instance;
}
```

### 3.2 AgentInstance 생성 규칙

```typescript
/**
 * AgentInstance 생성 알고리즘
 */
async function createAgentInstance(
  swarmInstance: SwarmInstance,
  agentRef: ObjectRefLike
): Promise<AgentInstance> {
  // 1. Agent 정의 로드
  const agentConfig = await configLoader.loadAgent(agentRef);
  const agentName = resolveRefName(agentRef);

  // 2. AgentInstance 생성
  const instance: AgentInstance = {
    id: generateId(),
    agentName,
    swarmInstance,
    agentRef,
    eventQueue: createEventQueue(),
    currentTurn: null,
    completedTurnCount: 0,
    extensionStates: new Map(),
    sharedState: {},
    createdAt: new Date(),
    lastActivityAt: new Date(),
    status: 'idle',
  };

  // 3. Extension 초기화 (register 호출)
  const extensions = await loadExtensions(agentConfig.spec.extensions);
  for (const ext of extensions) {
    const api = createExtensionApi(instance, ext);
    await ext.register(api);
  }

  // 4. 상태 디렉토리 초기화
  await initializeAgentStateDir(swarmInstance.id, agentName);

  // 5. Agent 이벤트 로그 기록
  await logAgentEvent(instance, {
    kind: 'agent.created',
    data: { agentRef },
  });

  return instance;
}
```

### 3.3 인스턴스 상태 저장 경로

```
<stateRootDir>/instances/<workspaceId>/<instanceId>/
  swarm/
    events/
      events.jsonl          # SwarmInstance 이벤트 로그 (append-only)
  agents/
    <agentName>/
      messages/
        base.jsonl          # 기준 메시지 스냅샷 로그 (append-only)
        events.jsonl        # Turn 메시지 이벤트 로그 (turn 단위)
      events/
        events.jsonl        # AgentInstance 이벤트 로그 (append-only)
```

---

## 4. instanceKey 기반 라우팅

> **v1.0**: instanceKey는 ConnectorEvent.properties에서 런타임이 결정한다. Connection의 IngressRoute에는 agentRef만 존재하며, 구 패턴의 instanceKeyFrom/inputFrom은 삭제되었다. `swarmRef`는 Connection 최상위 필드(`spec.swarmRef`)로 복원되어 Connection이 바인딩할 Swarm을 명시한다. 자세한 내용은 [`connector.md`](./connector.md) §5.4, [`connection.md`](./connection.md) §3.5를 참조한다.

### 4.1 라우팅 알고리즘

```typescript
/**
 * instanceKey 계산 규칙 (v1.0)
 *
 * 규칙:
 * - MUST: 동일 맥락의 이벤트는 동일 instanceKey를 생성해야 한다
 * - MUST: ConnectorEvent.properties에서 instanceKey를 추출한다
 * - MUST: properties에 적합한 키가 없으면 Connection 이름 기반 기본값을 사용한다
 */
interface InstanceKeyResolver {
  /**
   * ConnectorEvent에서 instanceKey 추출
   *
   * @param event - ConnectorEvent (connector.md §5.4 참조)
   * @param connection - Connection 리소스 (connection.md 참조)
   * @returns instanceKey 문자열
   */
  resolve(event: ConnectorEvent, connection: Resource<ConnectionSpec>): string;
}

/**
 * instanceKey 추출 의사 코드
 *
 * 프로토콜별 식별 키 우선순위:
 *   1. properties.instanceKey (명시적 지정)
 *   2. properties.chatId (Telegram 등)
 *   3. properties.thread_ts (Slack 등)
 *   4. properties.channel_id (채널 기반 프로토콜)
 *   5. Connection 이름 기반 기본값
 */
function resolveInstanceKey(
  event: ConnectorEvent,
  connection: Resource<ConnectionSpec>
): string {
  // 명시적 instanceKey (CLI의 CliTriggerPayload.payload.instanceKey 등)
  if (event.properties?.instanceKey) {
    return String(event.properties.instanceKey);
  }

  // 프로토콜별 식별 키 (chatId, thread_ts 등)
  if (event.properties?.chatId) {
    return String(event.properties.chatId);
  }
  if (event.properties?.thread_ts) {
    return String(event.properties.thread_ts);
  }
  if (event.properties?.channel_id) {
    return String(event.properties.channel_id);
  }

  // 기본값: Connection 이름 기반
  return `${connection.metadata.name}:default`;
}

/**
 * ConnectorEvent 라우팅 흐름 의사 코드 (v1.0)
 *
 * ConnectorEvent + Connection ingress rules 기반으로 라우팅한다.
 * - instanceKey: ConnectorEvent.properties에서 추출
 * - input: ConnectorEvent.message.text에서 추출
 * - agentRef: 매칭된 IngressRule에서 결정 (없으면 entrypoint)
 */
async function routeConnectorEvent(
  event: ConnectorEvent,
  connection: Resource<ConnectionSpec>,
  swarmRef: ObjectRefLike
): Promise<void> {
  // 1. Connection의 ingress.rules에서 매칭 규칙 찾기
  const matchedRule = findMatchingIngressRule(connection, event);
  if (!matchedRule) {
    throw new RoutingError('No matching ingress rule');
  }

  // 2. instanceKey 결정
  const instanceKey = resolveInstanceKey(event, connection);

  // 3. SwarmInstance 조회/생성
  const swarmInstance = await getOrCreateSwarmInstance(swarmRef, instanceKey);

  // 4. 대상 Agent 결정 (agentRef 없으면 entrypoint)
  const agentRef = matchedRule.route?.agentRef;
  const agentName = agentRef
    ? resolveRefName(agentRef)
    : resolveRefName(swarmInstance.swarmConfig.spec.entrypoint);

  // 5. 입력 텍스트 추출 (ConnectorEvent.message에서)
  const input = event.message.type === 'text' ? event.message.text : '';

  // 6. Auth 컨텍스트 구성 (ConnectorEvent.auth에서)
  const auth: TurnAuth | undefined = event.auth ? {
    actor: {
      type: 'user',
      id: event.auth.actor.id,
      display: event.auth.actor.name,
    },
    subjects: {
      global: event.auth.subjects.global,
      user: event.auth.subjects.user,
    },
  } : undefined;

  // 7. AgentEvent 생성 및 enqueue
  const agentEvent: AgentEvent = {
    id: generateId(),
    type: 'user.input',
    input,
    auth,
    metadata: { connectorEvent: event.properties },
    createdAt: new Date(),
  };

  // 8. 대상 AgentInstance에 이벤트 추가
  let agentInstance = swarmInstance.agents.get(agentName);
  if (!agentInstance) {
    agentInstance = await createAgentInstance(
      swarmInstance,
      { kind: 'Agent', name: agentName }
    );
    swarmInstance.agents.set(agentName, agentInstance);
  }
  agentInstance.eventQueue.enqueue(agentEvent);

  // 9. Turn 처리 트리거 (비동기)
  scheduleAgentProcessing(agentInstance);
}

/**
 * Connection ingress rule 매칭 (v1.0)
 *
 * ConnectorEvent의 name과 properties를 기반으로 매칭한다.
 * connection.md §5.1 참조.
 */
function findMatchingIngressRule(
  connection: Resource<ConnectionSpec>,
  event: ConnectorEvent
): IngressRule | undefined {
  const rules = connection.spec.ingress?.rules;
  if (!rules || rules.length === 0) {
    // 규칙이 없으면 기본 규칙 (entrypoint로 라우팅)
    return { route: {} };
  }

  return rules.find((rule) => {
    if (!rule.match) return true; // match 생략 → 모든 이벤트 매칭
    if (rule.match.event && rule.match.event !== event.name) return false;
    if (rule.match.properties) {
      for (const [key, value] of Object.entries(rule.match.properties)) {
        if (event.properties?.[key] !== value) return false;
      }
    }
    return true;
  });
}
```

### 4.2 라우팅 에러 처리

```typescript
/**
 * 라우팅 에러 타입
 */
class RoutingError extends Error {
  readonly code: string;

  constructor(message: string, code: string = 'ROUTING_ERROR') {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}

/**
 * 라우팅 에러 처리 규칙
 *
 * - MUST: 라우팅 실패 시 에러 로그를 기록한다
 * - SHOULD: ConnectorEvent의 출처를 로그에 포함한다
 * - MAY: 외부 채널에 에러 응답 전송 (Tool을 통해)
 */
async function handleRoutingError(
  connection: Resource<ConnectionSpec>,
  event: ConnectorEvent,
  error: RoutingError
): Promise<void> {
  // 1. 에러 로그 기록
  logger.error('Routing failed', {
    connection: connection.metadata.name,
    eventName: event.name,
    error: error.message,
    code: error.code,
  });
}
```

---

## 5. Turn 실행 흐름

### 5.1 Turn 실행 알고리즘

```typescript
/**
 * Turn 실행 메인 루프
 *
 * 규칙:
 * - MUST: 작업이 소진될 때까지 Step 반복
 * - MUST: maxStepsPerTurn 정책 적용
 * - MUST: turn.pre/post 파이프라인 포인트 실행
 */
async function runTurn(
  agentInstance: AgentInstance,
  event: AgentEvent
): Promise<Turn> {
  // 1. Turn 생성 (MUST: traceId를 생성하여 추적 가능성 보장)
  const turn: Turn = {
    id: generateId(),
    traceId: generateTraceId(), // MUST: Turn마다 traceId 생성
    agentInstance,
    inputEvent: event,
    origin: event.origin ?? {},
    auth: event.auth ?? {},
    messageState: {
      baseMessages: await loadMessageBase(agentInstance),
      events: [],
      nextMessages: [],
    },
    steps: [],
    currentStepIndex: 0,
    status: 'pending',
    startedAt: new Date(),
    metadata: {},
  };
  turn.messageState.nextMessages = foldMessageEvents(
    turn.messageState.baseMessages,
    turn.messageState.events
  );

  agentInstance.currentTurn = turn;
  agentInstance.status = 'processing';

  try {
    // 2. turn.pre 파이프라인 실행
    const turnContext = await runPipeline('turn.pre', { turn });

    // 3. 초기 사용자 메시지 이벤트 추가
    if (event.input) {
      await appendMessageEvent(turn, {
        type: 'llm_message',
        seq: nextMessageEventSeq(turn),
        recordedAt: new Date().toISOString(),
        message: {
          id: generateMessageId(),
          role: 'user',
          content: event.input,
        },
      });
    }

    // 4. Step 루프
    const maxSteps = getMaxStepsPerTurn(agentInstance);
    turn.status = 'running';

    while (turn.currentStepIndex < maxSteps) {
      // 4.1 Step 실행
      const step = await runStep(turn);
      turn.steps.push(step);

      // 4.2 Step 결과 평가
      if (shouldContinueStepLoop(step)) {
        turn.currentStepIndex++;
        continue;
      }

      // 4.3 루프 종료 조건 충족
      break;
    }

    // 5. turn.post 파이프라인 실행 (base, events 전달)
    await runPipeline('turn.post', {
      turn,
      baseMessages: turn.messageState.baseMessages,
      messageEvents: turn.messageState.events,
    });

    // 6. Turn 메시지 상태 finalize
    const finalizedBase = foldMessageEvents(
      turn.messageState.baseMessages,
      turn.messageState.events
    );
    await persistMessageBase(turn, finalizedBase);
    await clearMessageEvents(turn);
    turn.messageState.baseMessages = finalizedBase;
    turn.messageState.events = [];
    turn.messageState.nextMessages = finalizedBase;

    // 7. Turn 완료
    turn.status = 'completed';
    turn.completedAt = new Date();

  } catch (error) {
    // 8. 에러 처리
    turn.status = 'failed';
    turn.completedAt = new Date();
    turn.metadata.error = serializeError(error);

    // 에러 로그 기록
    await logAgentEvent(agentInstance, {
      kind: 'turn.failed',
      turnId: turn.id,
      data: { error: turn.metadata.error },
    });
  } finally {
    // 9. 정리
    agentInstance.currentTurn = null;
    agentInstance.completedTurnCount++;
    agentInstance.lastActivityAt = new Date();
    agentInstance.status = 'idle';
  }

  return turn;
}

/**
 * Step 계속 여부 판단
 */
function shouldContinueStepLoop(step: Step): boolean {
  // 1. Step 실패 시 중단
  if (step.status === 'failed') {
    return false;
  }

  // 2. LLM이 tool call 없이 응답 완료
  if (
    step.llmResult?.finishReason === 'stop' &&
    (!step.toolCalls || step.toolCalls.length === 0)
  ) {
    return false;
  }

  // 3. Tool call이 있으면 계속
  if (step.toolCalls && step.toolCalls.length > 0) {
    return true;
  }

  // 4. 기본: 중단
  return false;
}

/**
 * maxStepsPerTurn 조회
 */
function getMaxStepsPerTurn(agentInstance: AgentInstance): number {
  const policy = agentInstance.swarmInstance.swarmConfig?.spec?.policy;
  return policy?.maxStepsPerTurn ?? 32; // 기본값 32
}
```

### 5.2 Turn 상태 전이 다이어그램

```
         ┌─────────┐
         │ pending │
         └────┬────┘
              │ runTurn() 호출
              ▼
         ┌─────────┐
    ┌────│ running │────┐
    │    └────┬────┘    │
    │         │         │
    │    Step 루프      │ 예외 발생
    │         │         │
    │         ▼         │
    │    ┌─────────┐    │
    └───▶│completed│    │
         └─────────┘    │
                        ▼
                   ┌────────┐
                   │ failed │
                   └────────┘
```

---

## 6. Step 실행 순서

### 6.1 Step 실행 상세 알고리즘

```typescript
/**
 * Step 실행 알고리즘
 *
 * 규칙:
 * - MUST: step.config -> step.tools -> step.blocks -> step.llmInput -> step.llmCall -> tool call -> step.post 순서
 * - MUST: Step 시작 시 SwarmBundleRef와 Effective Config 고정
 * - MUST: 각 파이프라인 포인트 실행
 */
async function runStep(turn: Turn): Promise<Step> {
  const agentInstance = turn.agentInstance;
  const swarmInstance = agentInstance.swarmInstance;

  // 1. Step 객체 생성
  const step: Step = {
    id: generateId(),
    turn,
    index: turn.currentStepIndex,
    activeSwarmBundleRef: '', // step.config에서 설정
    effectiveConfig: null as unknown as EffectiveConfig,
    toolCatalog: [],
    blocks: [],
    toolCalls: [],
    toolResults: [],
    status: 'pending',
    startedAt: new Date(),
    metadata: {},
  };

  try {
    // ========================================
    // 2. step.pre 파이프라인
    // ========================================
    step.status = 'config';
    await runPipeline('step.pre', { turn, step });

    // ========================================
    // 3. step.config 파이프라인 (Safe Point)
    // ========================================
    // 3.1 현재 활성 SwarmBundleRef 결정
    const activeRef = await swarmBundleManager.getActiveRef();
    (step as { activeSwarmBundleRef: string }).activeSwarmBundleRef = activeRef;

    // 3.2 Effective Config 로드
    const effectiveConfig = await loadEffectiveConfig(
      activeRef,
      agentInstance.agentRef
    );
    (step as { effectiveConfig: EffectiveConfig }).effectiveConfig = effectiveConfig;

    // 3.3 step.config mutator 실행
    await runPipeline('step.config', { turn, step, effectiveConfig });

    // ========================================
    // 4. step.tools 파이프라인
    // ========================================
    step.status = 'tools';

    // 4.1 기본 Tool Catalog 생성
    const baseCatalog = buildToolCatalog(effectiveConfig.tools);

    // 4.2 step.tools mutator 실행 (Extension이 Catalog 변경 가능)
    const toolsContext = await runPipeline('step.tools', {
      turn,
      step,
      effectiveConfig,
      toolCatalog: baseCatalog,
    });
    (step as { toolCatalog: ToolCatalogItem[] }).toolCatalog =
      toolsContext.toolCatalog;

    // ========================================
    // 5. step.blocks 파이프라인
    // ========================================
    step.status = 'blocks';

    // 5.1 기본 블록 생성 (messageState.nextMessages, toolResults 등)
    const baseBlocks = buildContextBlocks(turn, step);

    // 5.2 step.blocks mutator 실행
    const blocksContext = await runPipeline('step.blocks', {
      turn,
      step,
      effectiveConfig,
      toolCatalog: step.toolCatalog,
      blocks: baseBlocks,
    });
    (step as { blocks: ContextBlock[] }).blocks = blocksContext.blocks;

    // ========================================
    // 6. step.llmCall 파이프라인 (Middleware)
    // ========================================
    step.status = 'llmCall';

    // 6.1 LLM 요청 구성
    const llmInput = turn.messageState.nextMessages;
    const llmRequest = buildLlmRequest(step, llmInput);

    // 6.2 step.llmCall middleware 실행 (onion wrapping)
    const llmContext = {
      turn,
      step,
      effectiveConfig,
      toolCatalog: step.toolCatalog,
      blocks: step.blocks,
      request: llmRequest,
    };

    let llmResult: LlmResult;
    try {
      llmResult = await runMiddlewarePipeline('step.llmCall', llmContext, async (ctx) => {
        // Core LLM 호출
        return await callLlm(ctx.request, effectiveConfig.model);
      });
    } catch (llmError) {
      // 6.3 step.llmError 처리
      const errorContext = await runPipeline('step.llmError', {
        turn,
        step,
        error: llmError,
      });

      // 재시도 여부 판단 (MAY)
      if (errorContext.shouldRetry) {
        llmResult = await retryLlmCall(llmRequest, effectiveConfig.model);
      } else {
        throw llmError;
      }
    }

    step.llmResult = llmResult;

    // 6.4 LLM 응답(system 제외)을 메시지 이벤트로 기록
    await appendMessageEvent(turn, {
      type: 'llm_message',
      seq: nextMessageEventSeq(turn),
      recordedAt: new Date().toISOString(),
      message: llmResult.message,
    });

    // ========================================
    // 7. Tool Call 처리
    // ========================================
    if (llmResult.message.toolCalls && llmResult.message.toolCalls.length > 0) {
      step.status = 'toolExec';
      (step as { toolCalls: ToolCall[] }).toolCalls = llmResult.message.toolCalls;

      for (const toolCall of step.toolCalls) {
        // 7.1 toolCall.pre 파이프라인
        const preContext = await runPipeline('toolCall.pre', {
          turn,
          step,
          toolCall,
        });

        // 7.2 toolCall.exec middleware (실제 실행)
        let toolResult: ToolResult;
        try {
          const execContext = {
            turn,
            step,
            toolCall: preContext.toolCall,
          };

          toolResult = await runMiddlewarePipeline(
            'toolCall.exec',
            execContext,
            async (ctx) => {
              return await executeToolCall(ctx.toolCall, step);
            }
          );
        } catch (toolError) {
          // Tool 오류를 ToolResult로 변환 (예외 전파 금지)
          toolResult = {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            output: {
              status: 'error',
              error: {
                message: truncateErrorMessage(
                  toolError.message,
                  getErrorMessageLimit(toolCall.name)
                ),
                name: toolError.name,
                code: toolError.code ?? 'E_TOOL',
              },
            },
          };
        }

        step.toolResults.push(toolResult);

        // 7.3 toolCall.post 파이프라인
        await runPipeline('toolCall.post', {
          turn,
          step,
          toolCall,
          toolResult,
        });

        // 7.4 Tool 결과를 메시지 이벤트로 기록
        await appendMessageEvent(turn, {
          type: 'llm_message',
          seq: nextMessageEventSeq(turn),
          recordedAt: new Date().toISOString(),
          message: {
            id: generateMessageId(),
            role: 'tool',
            toolCallId: toolResult.toolCallId,
            toolName: toolResult.toolName,
            output: toolResult.output,
          },
        });
      }
    }

    // ========================================
    // 8. step.post 파이프라인
    // ========================================
    step.status = 'post';
    await runPipeline('step.post', {
      turn,
      step,
      effectiveConfig,
      toolCatalog: step.toolCatalog,
      blocks: step.blocks,
      llmResult: step.llmResult,
      toolResults: step.toolResults,
    });

    // 9. Step 완료
    step.status = 'completed';
    step.completedAt = new Date();

  } catch (error) {
    step.status = 'failed';
    step.completedAt = new Date();
    step.metadata.error = serializeError(error);
    throw error;
  }

  return step;
}
```

### 6.2 Step 실행 순서 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                      Step Execution Flow                         │
└─────────────────────────────────────────────────────────────────┘

 step.pre (Mutator)
     │
     ▼
 step.config (Mutator) ◄── Safe Point: SwarmBundleRef 활성화
     │                     Effective Config 로드/고정
     ▼
 step.tools (Mutator)  ◄── Tool Catalog 구성
     │                     Extension이 Catalog 변경 가능
     ▼
 step.blocks (Mutator) ◄── Context Blocks 구성
     │                     이전 messages, skills, auth.pending 등
     ▼
 step.llmCall (Middleware) ◄── LLM 호출 (onion wrapping)
     │                         EXT.before → CORE → EXT.after
     │
     ├── step.llmError (Mutator) ◄── LLM 오류 시 (MAY 재시도)
     │
     ▼
 [Tool Calls 있음?]
     │
     ├─ Yes ──▶ for each toolCall:
     │              │
     │              ├─ toolCall.pre (Mutator)
     │              │
     │              ├─ toolCall.exec (Middleware)
     │              │      EXT.before → CORE exec → EXT.after
     │              │
     │              └─ toolCall.post (Mutator)
     │
     └─ No ───▶ (skip)
     │
     ▼
 step.post (Mutator)
     │
     ▼
 Step 완료
```

---

## 7. Turn 메시지 상태 모델 (Base + Events)

### 7.1 계산 규칙

```typescript
/**
 * Turn 메시지 계산 공식
 *
 * MUST:
 * - NextMessages = BaseMessages + SUM(Events)
 * - SUM(Events)는 append order 기준 결정론적 fold
 */
interface MessageStateManager {
  loadBase(turn: Turn): Promise<LlmMessage[]>;
  appendEvent(turn: Turn, event: MessageEvent): Promise<void>;
  buildNextMessages(turn: Turn): LlmMessage[];
  finalizeTurn(turn: Turn): Promise<LlmMessage[]>;
  recover(turn: Turn): Promise<LlmMessage[]>;
}

function foldMessageEvents(
  baseMessages: readonly LlmMessage[],
  events: readonly MessageEvent[]
): LlmMessage[] {
  let next = [...baseMessages];

  for (const event of events) {
    switch (event.type) {
      case 'system_message': {
        const withoutSystem = next.filter((m) => m.role !== 'system');
        next = [event.message, ...withoutSystem];
        break;
      }
      case 'llm_message': {
        next = [...next, event.message];
        break;
      }
      case 'replace': {
        next = next.map((m) => (m.id === event.targetId ? event.message : m));
        break;
      }
      case 'remove': {
        next = next.filter((m) => m.id !== event.targetId);
        break;
      }
      case 'truncate': {
        next = next.filter((m) => m.role === 'system');
        break;
      }
    }
  }

  return next;
}
```

### 7.2 Turn 경계 처리 규칙

```typescript
/**
 * Turn 종료 처리
 *
 * 순서:
 * 1) turn.post 훅 실행 (입력: baseMessages, messageEvents)
 * 2) 훅이 추가 발행한 이벤트까지 포함하여 fold
 * 3) base.jsonl에 최종 스냅샷 append
 * 4) events.jsonl 비우기
 */
async function finalizeTurnMessages(turn: Turn): Promise<void> {
  await runPipeline('turn.post', {
    turn,
    baseMessages: turn.messageState.baseMessages,
    messageEvents: turn.messageState.events,
  });

  const finalMessages = foldMessageEvents(
    turn.messageState.baseMessages,
    turn.messageState.events
  );
  await persistMessageBase(turn, finalMessages);
  await clearMessageEvents(turn);

  turn.messageState.baseMessages = finalMessages;
  turn.messageState.events = [];
  turn.messageState.nextMessages = finalMessages;
}

/**
 * 장애 복원
 *
 * MUST: events.jsonl이 남아 있으면 base + events를 재계산해 복원
 */
async function recoverMessageState(turn: Turn): Promise<void> {
  const base = await loadMessageBase(turn.agentInstance);
  const events = await loadMessageEvents(turn.agentInstance, turn.id);
  turn.messageState.baseMessages = base;
  turn.messageState.events = events;
  turn.messageState.nextMessages = foldMessageEvents(base, events);
}
```

### 7.3 메시지 저장 포맷

```typescript
/**
 * 메시지 base 스냅샷 로그
 *
 * 저장 경로:
 * <stateRootDir>/instances/<workspaceId>/<instanceId>/agents/<agentName>/messages/base.jsonl
 */
interface MessageBaseLogRecord {
  type: 'message.base';
  recordedAt: string;
  traceId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId: string;
  messages: LlmMessage[];
  sourceEventCount?: number;
}

/**
 * 메시지 이벤트 로그
 *
 * 저장 경로:
 * <stateRootDir>/instances/<workspaceId>/<instanceId>/agents/<agentName>/messages/events.jsonl
 */
interface MessageEventLogRecord {
  type: 'message.event';
  recordedAt: string;
  traceId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId: string;
  seq: number;
  eventType: MessageEvent['type'];
  payload: JsonObject;
  stepId?: string;
}
```

### 7.4 이벤트 기록 헬퍼

```typescript
async function appendMessageEvent(turn: Turn, event: MessageEvent): Promise<void> {
  const agentInstance = turn.agentInstance;
  const logPath = path.join(
    getInstanceStatePath(agentInstance),
    'messages',
    'events.jsonl'
  );

  await appendJsonl(logPath, {
    type: 'message.event',
    recordedAt: event.recordedAt,
    traceId: turn.traceId,
    instanceId: agentInstance.swarmInstance.id,
    instanceKey: agentInstance.swarmInstance.instanceKey,
    agentName: agentInstance.agentName,
    turnId: turn.id,
    seq: event.seq,
    eventType: event.type,
    payload: serializeMessageEvent(event),
  } satisfies MessageEventLogRecord);

  turn.messageState.events.push(event);
  turn.messageState.nextMessages = foldMessageEvents(
    turn.messageState.baseMessages,
    turn.messageState.events
  );
}
```

---

## 8. maxStepsPerTurn 정책

### 8.1 정책 적용 알고리즘

```typescript
/**
 * maxStepsPerTurn 정책
 *
 * 규칙:
 * - MAY: Swarm.policy.maxStepsPerTurn으로 제한 설정
 * - SHOULD: 기본값 32
 * - MUST: 제한 초과 시 Turn 종료
 */
interface StepLimitPolicy {
  /**
   * 최대 Step 수 조회
   */
  getMaxSteps(swarmInstance: SwarmInstance): number;

  /**
   * 제한 초과 여부 확인
   */
  isLimitExceeded(turn: Turn, swarmInstance: SwarmInstance): boolean;
}

/**
 * Step 제한 정책 구현
 */
const stepLimitPolicy: StepLimitPolicy = {
  getMaxSteps(swarmInstance: SwarmInstance): number {
    const policy = swarmInstance.swarmConfig?.spec?.policy;
    return policy?.maxStepsPerTurn ?? 32;
  },

  isLimitExceeded(turn: Turn, swarmInstance: SwarmInstance): boolean {
    const maxSteps = this.getMaxSteps(swarmInstance);
    return turn.currentStepIndex >= maxSteps;
  },
};

/**
 * Step 루프에서 정책 적용
 */
async function runStepLoop(turn: Turn): Promise<void> {
  const swarmInstance = turn.agentInstance.swarmInstance;
  const maxSteps = stepLimitPolicy.getMaxSteps(swarmInstance);

  while (turn.currentStepIndex < maxSteps) {
    const step = await runStep(turn);
    turn.steps.push(step);

    if (!shouldContinueStepLoop(step)) {
      break;
    }

    turn.currentStepIndex++;
  }

  // 제한 초과 로그
  if (turn.currentStepIndex >= maxSteps) {
    await logAgentEvent(turn.agentInstance, {
      kind: 'turn.stepLimitReached',
      turnId: turn.id,
      data: {
        maxSteps,
        actualSteps: turn.steps.length,
      },
    });

    // Turn 메타데이터에 기록
    turn.metadata.stepLimitReached = true;
  }
}
```

### 8.2 정책 설정 예시

```yaml
# Swarm 정의
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
  policy:
    maxStepsPerTurn: 32    # 기본값
    # 또는
    # maxStepsPerTurn: 64  # 복잡한 작업용
    # maxStepsPerTurn: 8   # 단순 응답용
```

---

## 9. Effective Config 고정 규칙

### 9.1 고정 메커니즘

```typescript
/**
 * Effective Config 고정 규칙
 *
 * 규칙:
 * - MUST: Step 시작 시 activeSwarmBundleRef 결정 (step.config)
 * - MUST: Step 실행 중 SwarmBundleRef와 Effective Config 변경 금지
 * - MUST: Changeset 커밋으로 생성된 새 Ref는 다음 Step부터 반영
 */
interface EffectiveConfigManager {
  /**
   * Step의 Effective Config 로드 (고정)
   */
  loadForStep(
    swarmBundleRef: SwarmBundleRef,
    agentRef: ObjectRefLike
  ): Promise<EffectiveConfig>;

  /**
   * 현재 활성 Ref 조회
   */
  getActiveRef(): Promise<SwarmBundleRef>;

  /**
   * Changeset 커밋 후 활성 Ref 업데이트
   * (다음 Step에서만 반영)
   */
  updateActiveRef(newRef: SwarmBundleRef): Promise<void>;
}

/**
 * Effective Config 로드 알고리즘
 */
async function loadEffectiveConfig(
  swarmBundleRef: SwarmBundleRef,
  agentRef: ObjectRefLike
): Promise<EffectiveConfig> {
  // 1. SwarmBundle에서 모든 리소스 로드
  const bundle = await loadSwarmBundle(swarmBundleRef);

  // 2. Agent 정의 조회
  const agent = bundle.getResource<AgentSpec>('Agent', resolveRefName(agentRef));

  // 3. Swarm 정의 조회 (Agent가 속한 Swarm)
  const swarm = bundle.getSwarmForAgent(agent);

  // 4. Model 조회
  const model = bundle.getResource<ModelSpec>(
    'Model',
    resolveRefName(agent.spec.modelConfig.modelRef)
  );

  // 5. Tools 목록 조회 및 정규화
  const tools = normalizeByIdentity(
    await resolveToolRefs(bundle, agent.spec.tools)
  );

  // 6. Extensions 목록 조회 및 정규화
  const extensions = normalizeByIdentity(
    await resolveExtensionRefs(bundle, agent.spec.extensions)
  );

  // 7. 시스템 프롬프트 로드
  const systemPrompt = await loadSystemPrompt(bundle, agent.spec.prompts);

  // 8. Effective Config 조립
  return {
    swarm,
    agent,
    model,
    tools,
    extensions,
    systemPrompt,
    revision: computeRevision(swarmBundleRef),
  };
}

/**
 * Identity 기반 배열 정규화
 *
 * 대상 필드: `/spec/tools`, `/spec/extensions` (SHOULD)
 *
 * 규칙:
 * - SHOULD: identity key 중복 시 last-wins
 * - SHOULD: 순서 변경으로 인한 상태 재생성 방지
 */
function normalizeByIdentity<T extends Resource<unknown>>(
  items: T[]
): readonly T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    const key = `${item.kind}/${item.metadata.name}`;
    map.set(key, item); // last-wins
  }

  return Array.from(map.values());
}
```

### 9.2 Changeset 반영 시점

```typescript
/**
 * Changeset 반영 시점 규칙
 *
 * 규칙:
 * - MUST: Step N 중 커밋된 changeset은 Step N+1의 step.config에서 활성화
 * - MUST: Step 실행 중에는 SwarmBundleRef 변경 불가
 */
async function handleChangesetCommit(
  changesetId: string,
  options: { message?: string }
): Promise<ChangesetCommitResult> {
  // 1. Git commit 생성
  const commitResult = await gitCommit(changesetId, options.message);

  // 2. SwarmBundleRoot의 활성 Ref 업데이트
  const newRef = `git:${commitResult.sha}`;
  await swarmBundleManager.setActiveRef(newRef);

  // 3. 결과 반환 (tool 결과로 관측 가능)
  return {
    status: 'ok',
    changesetId,
    baseRef: commitResult.baseRef,
    newRef,
    summary: commitResult.summary,
  };

  // 주의: 새 Ref는 현재 Step에서는 적용되지 않음
  // 다음 Step의 step.config에서 activeSwarmBundleRef로 활성화됨
}

/**
 * step.config에서 활성 Ref 결정
 */
async function determineActiveRefAtStepConfig(
  swarmInstance: SwarmInstance
): Promise<SwarmBundleRef> {
  // 현재 설정된 활성 Ref 조회
  const currentActiveRef = await swarmBundleManager.getActiveRef();

  // 이전 Step에서 커밋된 changeset이 있으면
  // 여기서 새 Ref가 반영됨
  return currentActiveRef;
}
```

### 9.3 코드 변경 반영 의미론

Changeset으로 소스코드(Tool/Extension/Connector entry 모듈)가 변경된 경우, 변경된 코드는 Safe Point(`step.config`)에서 새 SwarmBundleRef 활성화와 함께 반영된다.

```typescript
/**
 * 코드 변경 반영 규칙
 *
 * 규칙:
 * - MUST: Runtime은 Step 시작 시 활성화된 SwarmBundleRef 기준으로 entry 모듈을 resolve해야 한다
 * - MUST NOT: Step 실행 중에는 entry 모듈을 동적으로 교체(hot-reload)해서는 안 된다
 * - MUST: 코드 변경의 반영 단위는 Config 변경과 동일하게 Step 경계여야 한다
 */

/**
 * Step 시작 시 entry 모듈 resolve (step.config 내부)
 */
async function resolveEntryModules(
  swarmBundleRef: SwarmBundleRef,
  effectiveConfig: EffectiveConfig
): Promise<void> {
  // 1. Tool entry 모듈 resolve
  for (const tool of effectiveConfig.tools) {
    if (tool.spec.entry) {
      await resolveModulePath(swarmBundleRef, tool.spec.entry);
    }
  }

  // 2. Extension entry 모듈 resolve
  for (const ext of effectiveConfig.extensions) {
    if (ext.spec.entry) {
      await resolveModulePath(swarmBundleRef, ext.spec.entry);
    }
  }

  // 이후 Step 종료까지 resolve된 모듈은 교체되지 않는다 (MUST NOT hot-reload)
}
```

### 9.4 인스턴스 GC 정책

TTL/idle 기반 자동 정리(GC)는 정책으로 제공하는 것을 권장한다(SHOULD).

```typescript
/**
 * 인스턴스 GC 정책
 *
 * 규칙:
 * - SHOULD: TTL/idle 기반 자동 정리(GC)를 정책으로 제공한다
 * - SHOULD: GC 대상 인스턴스는 terminate 후 상태를 정리한다
 */
interface InstanceGcPolicy {
  /** 인스턴스 최대 생존 시간(ms) (0이면 비활성화) */
  ttlMs?: number;

  /** 유휴 상태 최대 시간(ms) (0이면 비활성화) */
  idleTimeoutMs?: number;

  /** GC 검사 간격(ms) */
  checkIntervalMs?: number;
}
```

정책 설정 위치:

```yaml
kind: Swarm
metadata:
  name: default
spec:
  policy:
    gc:
      ttlMs: 3600000          # 1시간
      idleTimeoutMs: 1800000  # 30분 유휴 시 정리
      checkIntervalMs: 60000  # 1분마다 검사
```

### 9.5 운영 인터페이스 요구사항

구현은 인스턴스 라이프사이클 연산(`list/inspect/pause/resume/terminate/delete`)을 운영 인터페이스로 제공해야 한다(MUST). CLI를 제공하는 구현은 위 연산을 사람이 재현 가능하고 스크립트 가능한 형태로 노출해야 한다(SHOULD). 실제 CLI 명령어 매핑은 `docs/specs/cli.md`를 참조한다.

---

## 10. Turn Origin/Auth 컨텍스트

### 10.1 Origin 컨텍스트 구조

```typescript
/**
 * TurnOrigin 생성 규칙
 *
 * 규칙:
 * - SHOULD: Connector가 ingress 이벤트 변환 시 채운다
 * - SHOULD: 외부 채널 식별 정보 포함
 */
interface TurnOriginBuilder {
  /**
   * Connector 이벤트에서 Origin 생성
   */
  build(connector: ConnectorConfig, event: JsonObject): TurnOrigin;
}

/**
 * Slack Connector Origin 예시
 */
function buildSlackTurnOrigin(
  connector: ConnectorConfig,
  event: JsonObject
): TurnOrigin {
  return {
    connector: connector.metadata.name,
    channel: event.event?.channel,
    threadTs: event.event?.thread_ts ?? event.event?.ts,
    userId: event.event?.user,
    teamId: event.team_id,
    // 추가 Slack 특화 정보
    eventType: event.event?.type,
    botId: event.bot_id,
  };
}

/**
 * CLI Connector Origin 예시
 */
function buildCliTurnOrigin(
  connector: ConnectorConfig,
  event: JsonObject
): TurnOrigin {
  return {
    connector: connector.metadata.name,
    sessionId: event.sessionId ?? 'default',
    // CLI 특화 정보
    cwd: event.cwd,
    user: event.user ?? process.env.USER,
  };
}
```

### 10.2 Auth 컨텍스트 구조

```typescript
/**
 * TurnAuth 생성 규칙
 *
 * 규칙:
 * - SHOULD: Connector가 인증 정보를 기반으로 채운다
 * - MUST: subjectMode=user인 OAuthApp 사용 시 subjects.user 필수
 * - MUST: subjectMode=global인 OAuthApp 사용 시 subjects.global 필수
 */
interface TurnAuthBuilder {
  /**
   * Connector 이벤트에서 Auth 생성
   */
  build(connector: ConnectorConfig, event: JsonObject): TurnAuth;
}

/**
 * Slack Connector Auth 예시
 *
 * 권장 형식:
 * - subjects.global: "slack:team:<team_id>"
 * - subjects.user: "slack:user:<team_id>:<user_id>"
 */
function buildSlackTurnAuth(
  connector: ConnectorConfig,
  event: JsonObject
): TurnAuth {
  const teamId = event.team_id;
  const userId = event.event?.user;

  return {
    actor: {
      type: 'user',
      id: `slack:${userId}`,
      display: event.event?.user_profile?.display_name,
    },
    subjects: {
      global: `slack:team:${teamId}`,
      user: `slack:user:${teamId}:${userId}`,
    },
  };
}

/**
 * Auth 검증 규칙
 */
function validateTurnAuthForOAuth(
  auth: TurnAuth | undefined,
  oauthApp: OAuthAppConfig
): void {
  if (!auth) {
    throw new AuthError('Turn.auth is required for OAuth operations');
  }

  if (oauthApp.spec.subjectMode === 'global') {
    if (!auth.subjects?.global) {
      throw new AuthError(
        'turn.auth.subjects.global is required for subjectMode=global'
      );
    }
  }

  if (oauthApp.spec.subjectMode === 'user') {
    if (!auth.subjects?.user) {
      throw new AuthError(
        'turn.auth.subjects.user is required for subjectMode=user'
      );
    }
  }
}
```

---

## 11. Connector Event Flow (v1.0)

> **v1.0 주요 변경**: CanonicalEvent → ConnectorEvent로 대체, ConnectorTriggerContext → ConnectorContext로 대체. Connector는 ConnectorEvent만 발행하고, 라우팅(instanceKey 결정, Agent 선택)은 Runtime이 Connection의 ingress rules를 기반으로 수행한다. 자세한 타입 정의는 [`connector.md`](./connector.md) §5를 참조한다.

### 11.1 이벤트 흐름 상세

```typescript
/**
 * Connector Event Flow (v1.0)
 *
 * 규칙:
 * - MUST: Connector는 ConnectorEvent 생성 책임만 가진다 (connector.md §5.4 참조)
 * - MUST: Runtime이 ConnectorEvent를 Connection ingress rules로 라우팅하고 Turn으로 변환
 * - MUST: Connector는 Instance/Turn/Step 실행 모델을 직접 제어하지 않는다
 * - MUST: instanceKey는 런타임이 ConnectorEvent.properties에서 추출한다 (§4.1 참조)
 */

/**
 * ConnectorEvent (connector.md §5.4에서 정의)
 *
 * Connector의 entry 함수가 ctx.emit()으로 발행하는 정규화된 이벤트.
 * 참조용으로 인터페이스를 기재한다.
 */
// interface ConnectorEvent {
//   type: "connector.event";
//   name: string;
//   message: ConnectorEventMessage;
//   properties?: JsonObject;
//   auth?: {
//     actor: { id: string; name?: string };
//     subjects: { global?: string; user?: string };
//   };
// }

/**
 * ConnectorContext (connector.md §5.2에서 정의)
 *
 * Connector entry 함수에 주입되는 실행 컨텍스트.
 * Connection마다 한 번씩 호출된다.
 * 참조용으로 인터페이스를 기재한다.
 */
// interface ConnectorContext {
//   event: ConnectorTriggerEvent;
//   connection: Resource<ConnectionSpec>;
//   connector: Resource<ConnectorSpec>;
//   emit: (event: ConnectorEvent) => Promise<void>;
//   logger: Console;
//   oauth?: { getAccessToken: (req: OAuthTokenRequest) => Promise<OAuthTokenResult> };
//   verify?: { webhook?: { signingSecret: string } };
// }

/**
 * ConnectorEvent 처리 흐름 (v1.0)
 *
 * Runtime이 Connector의 ctx.emit() 호출을 수신하여 실행한다.
 * Connection의 ingress.rules에서 매칭 규칙을 찾고,
 * ConnectorEvent.properties에서 instanceKey를 추출하여 라우팅한다.
 */
async function handleConnectorEvent(
  event: ConnectorEvent,
  connection: Resource<ConnectionSpec>,
  swarmRef: ObjectRefLike
): Promise<void> {
  // 1. Connection ingress rules에서 매칭 규칙 찾기
  const matchedRule = findMatchingIngressRule(connection, event);
  if (!matchedRule) {
    throw new RoutingError('No matching ingress rule');
  }

  // 2. instanceKey 결정 (ConnectorEvent.properties에서 추출, §4.1 참조)
  const instanceKey = resolveInstanceKey(event, connection);

  // 3. SwarmInstance 조회/생성
  const swarmInstance = await getOrCreateSwarmInstance(swarmRef, instanceKey);

  // 4. 대상 AgentInstance 결정 (agentRef 없으면 entrypoint)
  const agentRef = matchedRule.route?.agentRef;
  const agentName = agentRef
    ? resolveRefName(agentRef)
    : resolveRefName(swarmInstance.swarmConfig.spec.entrypoint);
  let agentInstance = swarmInstance.agents.get(agentName);

  if (!agentInstance) {
    // 새 AgentInstance 생성 (동적 생성 허용 시)
    agentInstance = await createAgentInstance(
      swarmInstance,
      { kind: 'Agent', name: agentName }
    );
    swarmInstance.agents.set(agentName, agentInstance);
  }

  // 5. 입력 추출 (ConnectorEvent.message에서)
  const input = event.message.type === 'text' ? event.message.text : '';

  // 6. Auth 컨텍스트 변환 (ConnectorEvent.auth → TurnAuth)
  const auth: TurnAuth | undefined = event.auth ? {
    actor: {
      type: 'user',
      id: event.auth.actor.id,
      display: event.auth.actor.name,
    },
    subjects: {
      global: event.auth.subjects.global,
      user: event.auth.subjects.user,
    },
  } : undefined;

  // 7. AgentEvent 생성
  const agentEvent: AgentEvent = {
    id: generateId(),
    type: 'user.input',
    input,
    auth,
    metadata: { connectorEvent: event.properties },
    createdAt: new Date(),
  };

  // 8. AgentInstance 이벤트 큐에 enqueue
  agentInstance.eventQueue.enqueue(agentEvent);

  // 9. Agent 이벤트 로그 기록
  await logAgentEvent(agentInstance, {
    kind: 'event.enqueued',
    data: {
      eventId: agentEvent.id,
      eventType: agentEvent.type,
    },
  });

  // 10. Turn 처리 스케줄링 (비동기)
  scheduleAgentProcessing(agentInstance);
}

/**
 * Connector entry function 예시 (Slack) — ConnectorEntryFunction 패턴 (v1.0)
 *
 * connector.md §5.1의 단일 default export 패턴을 따른다.
 * Connector는 ConnectorEvent만 발행하며, 라우팅은 Runtime이 수행한다.
 */
export default async function (ctx: ConnectorContext): Promise<void> {
  // 1. 트리거 이벤트가 HTTP인지 확인
  if (ctx.event.trigger.type !== 'http') return;

  const body = ctx.event.trigger.payload.request.body;

  // 2. 서명 검증 (Connection의 verify 블록이 있는 경우)
  if (ctx.verify?.webhook?.signingSecret) {
    const isValid = verifySlackSignature(
      ctx.event.trigger.payload.request.headers,
      ctx.event.trigger.payload.request.rawBody ?? '',
      ctx.verify.webhook.signingSecret
    );
    if (!isValid) {
      ctx.logger.error('Slack signature verification failed');
      return;
    }
  }

  // 3. Slack 이벤트 필터링
  const slackEvent = body.event;
  if (!slackEvent || slackEvent.bot_id) return;

  // 4. ConnectorEvent 발행 (라우팅은 Runtime이 수행)
  await ctx.emit({
    type: 'connector.event',
    name: 'app_mention',
    message: {
      type: 'text',
      text: slackEvent.text,
    },
    properties: {
      channel_id: slackEvent.channel,
      ts: slackEvent.ts,
      thread_ts: slackEvent.thread_ts,
    },
    auth: {
      actor: {
        id: `slack:${slackEvent.user}`,
        name: slackEvent.user_profile?.display_name,
      },
      subjects: {
        global: `slack:team:${body.team_id}`,
        user: `slack:user:${body.team_id}:${slackEvent.user}`,
      },
    },
  });
}
```

### 11.2 이벤트 흐름 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                  Connector Event Flow (v1.0)                      │
└─────────────────────────────────────────────────────────────────┘

 [External Event]
      │
      │  Webhook / Cron / CLI
      ▼
 ┌────────────────┐
 │    Runtime:    │
 │  trigger 수신  │
 └───────┬────────┘
         │
         │  Connection 목록 조회 (connectorRef가 이 Connector를 참조하는 Connection들)
         ▼
 ┌────────────────────┐
 │  Connection마다    │
 │  Entry Function    │
 │  호출              │
 │  ctx.event:        │
 │   Trigger 정보     │
 │  ctx.connection:   │
 │   현재 Connection  │
 │  ctx.verify:       │
 │   서명 검증 정보   │
 └───────┬────────────┘
         │
         │ ctx.emit(ConnectorEvent)
         ▼
 ┌────────────────────────────────────────────────────────────────┐
 │                         Runtime                                 │
 │                                                                 │
 │   ┌───────────────────┐                                        │
 │   │ handleConnector   │                                        │
 │   │     Event         │                                        │
 │   └────────┬──────────┘                                        │
 │            │                                                    │
 │            │  1. Connection ingress rules 매칭                  │
 │            │  2. instanceKey 추출 (properties에서)              │
 │            │  3. SwarmInstance 조회/생성                        │
 │            │  4. agentRef 결정 (없으면 entrypoint)              │
 │            │  5. AgentEvent 생성                                │
 │            ▼                                                    │
 │   ┌────────────────────┐                                       │
 │   │   SwarmInstance    │                                       │
 │   │                    │                                       │
 │   │  ┌──────────────┐  │                                       │
 │   │  │AgentInstance │  │                                       │
 │   │  │              │  │                                       │
 │   │  │ EventQueue   │◄─┼─── enqueue(agentEvent)                │
 │   │  │   [event]    │  │                                       │
 │   │  │              │  │                                       │
 │   │  └──────────────┘  │                                       │
 │   └────────────────────┘                                       │
 │            │                                                    │
 │            │ scheduleAgentProcessing()                         │
 │            ▼                                                    │
 │   ┌──────────────────┐                                         │
 │   │    runTurn()     │──── Turn/Step 실행                      │
 │   └──────────────────┘                                         │
 │                                                                 │
 └────────────────────────────────────────────────────────────────┘
```

---

## 12. 에이전트 간 Handoff와 Auth 보존

### 12.1 Handoff 메커니즘

```typescript
/**
 * 에이전트 간 Handoff 규칙
 *
 * 규칙:
 * - MUST: handoff 시 turn.auth는 변경 없이 전달
 * - MUST: 원래 사용자 컨텍스트가 위임된 에이전트에서도 유지
 */
interface HandoffRequest {
  /** 위임 대상 Agent 참조 */
  targetAgentRef: ObjectRefLike;

  /** 위임 입력 (대상 에이전트에 전달) */
  input: string;

  /** 추가 메타데이터 */
  metadata?: JsonObject;
}

interface HandoffResult {
  /** Handoff 결과 상태 */
  status: 'completed' | 'failed' | 'pending';

  /** 대상 에이전트의 응답 */
  output?: JsonValue;

  /** 에러 정보 (실패 시) */
  error?: JsonObject;
}

/**
 * Handoff 실행 알고리즘
 */
async function executeHandoff(
  sourceTurn: Turn,
  request: HandoffRequest
): Promise<HandoffResult> {
  const sourceAgent = sourceTurn.agentInstance;
  const swarmInstance = sourceAgent.swarmInstance;

  // 1. 대상 AgentInstance 조회/생성
  const targetAgentName = resolveRefName(request.targetAgentRef);
  let targetAgent = swarmInstance.agents.get(targetAgentName);

  if (!targetAgent) {
    targetAgent = await createAgentInstance(
      swarmInstance,
      request.targetAgentRef
    );
    swarmInstance.agents.set(targetAgentName, targetAgent);
  }

  // 2. Handoff 이벤트 생성 (auth 보존)
  const handoffEvent: AgentEvent = {
    id: generateId(),
    type: 'agent.delegate',
    input: request.input,
    // MUST: 원본 Turn의 origin 전달
    origin: {
      ...sourceTurn.origin,
      delegatedFrom: sourceAgent.agentName,
      delegationTurnId: sourceTurn.id,
    },
    // MUST: 원본 Turn의 auth 변경 없이 전달
    auth: sourceTurn.auth,
    metadata: {
      sourceAgentName: sourceAgent.agentName,
      sourceTurnId: sourceTurn.id,
      ...request.metadata,
    },
    createdAt: new Date(),
  };

  // 3. 대상 AgentInstance 이벤트 큐에 enqueue
  targetAgent.eventQueue.enqueue(handoffEvent);

  // 4. Handoff 이벤트 로그 기록
  await logAgentEvent(sourceAgent, {
    kind: 'agent.delegated',
    turnId: sourceTurn.id,
    data: {
      targetAgent: targetAgentName,
      eventId: handoffEvent.id,
    },
  });

  await logAgentEvent(targetAgent, {
    kind: 'agent.delegateReceived',
    data: {
      sourceAgent: sourceAgent.agentName,
      eventId: handoffEvent.id,
    },
  });

  // 5. 동기 대기 또는 비동기 반환 (구현 선택)
  // 여기서는 비동기 반환 예시
  return {
    status: 'pending',
    output: {
      message: `작업이 ${targetAgentName}에게 위임되었습니다.`,
      delegationEventId: handoffEvent.id,
    },
  };
}

/**
 * Handoff 결과 반환 (대상 에이전트 -> 원본 에이전트)
 */
async function returnHandoffResult(
  targetTurn: Turn,
  result: JsonValue
): Promise<void> {
  const targetAgent = targetTurn.agentInstance;
  const swarmInstance = targetAgent.swarmInstance;

  // 위임 정보 추출
  const sourceAgentName = targetTurn.origin.delegatedFrom;
  const sourceTurnId = targetTurn.origin.delegationTurnId;

  if (!sourceAgentName) {
    return; // 위임된 Turn이 아님
  }

  const sourceAgent = swarmInstance.agents.get(sourceAgentName);
  if (!sourceAgent) {
    logger.warn('Source agent not found for delegation result', {
      sourceAgentName,
    });
    return;
  }

  // 결과 이벤트 생성
  const resultEvent: AgentEvent = {
    id: generateId(),
    type: 'agent.delegationResult',
    input: JSON.stringify(result),
    // MUST: auth 보존
    origin: targetTurn.origin,
    auth: targetTurn.auth,
    metadata: {
      sourceTurnId,
      targetAgentName: targetAgent.agentName,
      targetTurnId: targetTurn.id,
    },
    createdAt: new Date(),
  };

  // 원본 AgentInstance 이벤트 큐에 enqueue
  sourceAgent.eventQueue.enqueue(resultEvent);

  // 이벤트 로그 기록
  await logAgentEvent(targetAgent, {
    kind: 'agent.delegationReturned',
    turnId: targetTurn.id,
    data: {
      sourceAgent: sourceAgentName,
      resultEventId: resultEvent.id,
    },
  });
}
```

### 12.2 Auth 보존 검증

```typescript
/**
 * Auth 보존 규칙 검증
 *
 * 규칙:
 * - MUST: Handoff 시 auth 객체가 동일한지 검증
 * - MUST: auth 누락 시 user 토큰 조회 불가
 */
function validateAuthPreservation(
  sourceAuth: TurnAuth | undefined,
  targetAuth: TurnAuth | undefined
): void {
  // 1. sourceAuth가 있으면 targetAuth도 있어야 함
  if (sourceAuth && !targetAuth) {
    throw new AuthPreservationError(
      'turn.auth must be preserved during handoff'
    );
  }

  // 2. subjects가 동일해야 함
  if (sourceAuth && targetAuth) {
    if (
      sourceAuth.subjects?.global !== targetAuth.subjects?.global ||
      sourceAuth.subjects?.user !== targetAuth.subjects?.user
    ) {
      throw new AuthPreservationError(
        'turn.auth.subjects must be identical during handoff'
      );
    }

    // 3. actor가 동일해야 함
    if (
      sourceAuth.actor?.type !== targetAuth.actor?.type ||
      sourceAuth.actor?.id !== targetAuth.actor?.id
    ) {
      throw new AuthPreservationError(
        'turn.auth.actor must be identical during handoff'
      );
    }
  }
}

/**
 * Auth 누락 시 OAuth 동작 제한
 *
 * 규칙:
 * - MUST: auth가 없는 Turn에서 subjectMode=user OAuthApp 사용 금지
 */
function validateAuthForOAuthRequest(
  turn: Turn,
  oauthApp: OAuthAppConfig
): void {
  if (oauthApp.spec.subjectMode === 'user') {
    if (!turn.auth?.subjects?.user) {
      throw new AuthError(
        'Cannot request user token without turn.auth.subjects.user. ' +
        'Please ensure the Connector provides proper authentication context.'
      );
    }
  }

  if (oauthApp.spec.subjectMode === 'global') {
    if (!turn.auth?.subjects?.global) {
      throw new AuthError(
        'Cannot request global token without turn.auth.subjects.global. ' +
        'Please ensure the Connector provides proper authentication context.'
      );
    }
  }
}
```

---

## 13. 이벤트 로그 스키마

### 13.1 Swarm 이벤트 로그

```typescript
/**
 * Swarm 이벤트 로그 레코드
 *
 * 저장 경로: <stateRootDir>/instances/<workspaceId>/<instanceId>/swarm/events/events.jsonl
 */
interface SwarmEventLogRecord {
  /** 레코드 타입 */
  type: 'swarm.event';

  /** 기록 시각 */
  recordedAt: string; // ISO8601

  /** 이벤트 종류 */
  kind: SwarmEventKind;

  /** 인스턴스 ID */
  instanceId: string;

  /** 인스턴스 키 */
  instanceKey: string;

  /** Swarm 이름 */
  swarmName: string;

  /** 관련 Agent 이름 (선택) */
  agentName?: string;

  /** 이벤트 데이터 (선택) */
  data?: JsonObject;
}

type SwarmEventKind =
  | 'swarm.created'
  | 'swarm.terminated'
  | 'swarm.agentAdded'
  | 'swarm.agentRemoved'
  | 'swarm.configChanged'
  | string; // 확장 이벤트
```

### 13.2 Agent 이벤트 로그

```typescript
/**
 * Agent 이벤트 로그 레코드
 *
 * 저장 경로: <stateRootDir>/instances/<workspaceId>/<instanceId>/agents/<agentName>/events/events.jsonl
 */
interface AgentEventLogRecord {
  /** 레코드 타입 */
  type: 'agent.event';

  /** 기록 시각 */
  recordedAt: string; // ISO8601

  /** 이벤트 종류 */
  kind: AgentEventKind;

  /** 인스턴스 ID */
  instanceId: string;

  /** 인스턴스 키 */
  instanceKey: string;

  /** Agent 이름 */
  agentName: string;

  /** 추적 ID (MUST: Turn에서 전파) */
  traceId?: string;

  /** Turn ID (선택) */
  turnId?: string;

  /** Step ID (선택) */
  stepId?: string;

  /** Step 인덱스 (선택) */
  stepIndex?: number;

  /** 이벤트 데이터 (선택) */
  data?: JsonObject;
}

type AgentEventKind =
  | 'agent.created'
  | 'agent.terminated'
  | 'event.enqueued'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.stepLimitReached'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'agent.delegated'
  | 'agent.delegateReceived'
  | 'agent.delegationReturned'
  | 'changeset.committed'
  | 'changeset.rejected'
  | string; // 확장 이벤트

/**
 * 이벤트 로그 기록 함수
 */
async function logSwarmEvent(
  swarmInstance: SwarmInstance,
  event: Omit<SwarmEventLogRecord, 'type' | 'recordedAt' | 'instanceId' | 'instanceKey' | 'swarmName'>
): Promise<void> {
  const record: SwarmEventLogRecord = {
    type: 'swarm.event',
    recordedAt: new Date().toISOString(),
    instanceId: swarmInstance.id,
    instanceKey: swarmInstance.instanceKey,
    swarmName: resolveRefName(swarmInstance.swarmRef),
    ...event,
  };

  const logPath = path.join(
    getSwarmStatePath(swarmInstance),
    'events',
    'events.jsonl'
  );

  await appendJsonl(logPath, record);
}

async function logAgentEvent(
  agentInstance: AgentInstance,
  event: Omit<AgentEventLogRecord, 'type' | 'recordedAt' | 'instanceId' | 'instanceKey' | 'agentName'>
): Promise<void> {
  const record: AgentEventLogRecord = {
    type: 'agent.event',
    recordedAt: new Date().toISOString(),
    instanceId: agentInstance.swarmInstance.id,
    instanceKey: agentInstance.swarmInstance.instanceKey,
    agentName: agentInstance.agentName,
    ...event,
  };

  const logPath = path.join(
    getAgentStatePath(agentInstance),
    'events',
    'events.jsonl'
  );

  await appendJsonl(logPath, record);
}
```

---

## 14. 에러 처리

### 14.1 에러 타입 정의

```typescript
/**
 * Runtime 에러 기본 클래스
 */
class RuntimeError extends Error {
  readonly code: string;
  readonly details?: JsonObject;

  constructor(message: string, code: string, details?: JsonObject) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 라우팅 에러
 */
class RoutingError extends RuntimeError {
  constructor(message: string, details?: JsonObject) {
    super(message, 'ROUTING_ERROR', details);
    this.name = 'RoutingError';
  }
}

/**
 * 인증 에러
 */
class AuthError extends RuntimeError {
  constructor(message: string, details?: JsonObject) {
    super(message, 'AUTH_ERROR', details);
    this.name = 'AuthError';
  }
}

/**
 * Auth 보존 에러
 */
class AuthPreservationError extends AuthError {
  constructor(message: string) {
    super(message, { subtype: 'AUTH_PRESERVATION' });
    this.name = 'AuthPreservationError';
  }
}

/**
 * Config 로드 에러
 */
class ConfigLoadError extends RuntimeError {
  constructor(message: string, details?: JsonObject) {
    super(message, 'CONFIG_LOAD_ERROR', details);
    this.name = 'ConfigLoadError';
  }
}

/**
 * LLM 호출 에러
 */
class LlmCallError extends RuntimeError {
  constructor(message: string, details?: JsonObject) {
    super(message, 'LLM_CALL_ERROR', details);
    this.name = 'LlmCallError';
  }
}

/**
 * Tool 실행 에러
 */
class ToolExecutionError extends RuntimeError {
  readonly toolName: string;

  constructor(message: string, toolName: string, details?: JsonObject) {
    super(message, 'TOOL_EXECUTION_ERROR', details);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
  }
}

/**
 * Step 제한 초과 에러
 */
class StepLimitExceededError extends RuntimeError {
  readonly maxSteps: number;
  readonly actualSteps: number;

  constructor(maxSteps: number, actualSteps: number) {
    super(
      `Step limit exceeded: ${actualSteps} >= ${maxSteps}`,
      'STEP_LIMIT_EXCEEDED',
      { maxSteps, actualSteps }
    );
    this.name = 'StepLimitExceededError';
    this.maxSteps = maxSteps;
    this.actualSteps = actualSteps;
  }
}
```

### 14.2 에러 처리 규칙

```typescript
/**
 * 에러 처리 규칙
 *
 * 1. Tool 실행 에러: 예외 전파 금지, ToolResult.output에 포함
 * 2. LLM 호출 에러: step.llmError 파이프라인 실행, 재시도 가능
 * 3. Turn 실행 에러: Turn.status = 'failed', 로그 기록
 * 4. 라우팅 에러: Connector에 알림, 외부 채널에 에러 응답 가능
 */

/**
 * Tool 에러 -> ToolResult 변환
 */
function toolErrorToResult(
  error: Error,
  toolCall: ToolCall,
  errorMessageLimit: number = 1000
): ToolResult {
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    output: {
      status: 'error',
      error: {
        message: truncateString(error.message, errorMessageLimit),
        name: error.name,
        code: (error as RuntimeError).code ?? 'E_TOOL',
      },
    },
  };
}

/**
 * 에러 메시지 길이 제한
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * 에러 직렬화 (로그/메타데이터용)
 */
function serializeError(error: Error): JsonObject {
  return {
    name: error.name,
    message: error.message,
    code: (error as RuntimeError).code,
    details: (error as RuntimeError).details,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'),
  };
}
```

---

## 15. Retry / Timeout 정책

### 15.1 LLM 호출 재시도

```typescript
/**
 * LLM 호출 재시도 정책
 *
 * 규칙:
 * - SHOULD: LLM 호출 실패 시 설정된 정책에 따라 재시도할 수 있다
 * - MUST: 재시도 횟수가 maxRetries를 초과하면 LlmCallError를 발생시킨다
 * - MUST: 재시도 간격은 exponential backoff를 따른다
 * - MUST NOT: 4xx 클라이언트 에러(400, 401, 403, 404)는 재시도하지 않는다
 * - SHOULD: 429(Rate Limit), 5xx(서버 에러)는 재시도한다
 */
interface RetryPolicy {
  /** 최대 재시도 횟수 (기본: 3) */
  maxRetries: number;

  /** 초기 재시도 대기 시간(ms) (기본: 1000) */
  initialDelayMs: number;

  /** 최대 재시도 대기 시간(ms) (기본: 30000) */
  maxDelayMs: number;

  /** backoff 승수 (기본: 2) */
  backoffMultiplier: number;

  /** 재시도 가능한 에러 코드 (기본: [429, 500, 502, 503, 504]) */
  retryableStatusCodes: number[];
}
```

### 15.2 Step Timeout

```typescript
/**
 * Step 실행 타임아웃 정책
 *
 * 규칙:
 * - SHOULD: 각 Step에 타임아웃을 설정할 수 있다
 * - MUST: 타임아웃 초과 시 StepTimeoutError를 발생시킨다
 * - SHOULD: LLM 호출과 Tool 실행에 각각 별도의 타임아웃을 설정할 수 있다
 */
interface TimeoutPolicy {
  /** Step 전체 타임아웃(ms) (기본: 300000 = 5분) */
  stepTimeoutMs: number;

  /** LLM 호출 타임아웃(ms) (기본: 120000 = 2분) */
  llmCallTimeoutMs: number;

  /** 개별 Tool 실행 타임아웃(ms) (기본: 60000 = 1분) */
  toolExecutionTimeoutMs: number;
}

class StepTimeoutError extends RuntimeError {
  constructor(phase: 'step' | 'llmCall' | 'toolExecution', timeoutMs: number) {
    super(
      `${phase} timed out after ${timeoutMs}ms`,
      'STEP_TIMEOUT',
      { phase, timeoutMs }
    );
    this.name = 'StepTimeoutError';
  }
}
```

### 15.3 Turn Timeout

```typescript
/**
 * Turn 전체 타임아웃
 *
 * 규칙:
 * - SHOULD: Turn에 전체 타임아웃을 설정할 수 있다 (Swarm.policy.maxTurnDurationMs)
 * - MUST: 타임아웃 초과 시 Turn.status를 'failed'로 설정하고 TurnTimeoutError를 기록한다
 */
```

### 15.4 정책 설정 위치

Retry/Timeout 정책은 Swarm 리소스의 `policy` 필드에서 설정한다:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: my-swarm
spec:
  policy:
    maxStepsPerTurn: 32
    retry:
      maxRetries: 3
      initialDelayMs: 1000
      backoffMultiplier: 2
    timeout:
      stepTimeoutMs: 300000
      llmCallTimeoutMs: 120000
      toolExecutionTimeoutMs: 60000
      maxTurnDurationMs: 600000
```

---

## 16. Observability

### 16.1 구조화된 로깅

```typescript
/**
 * Runtime 이벤트 로깅
 *
 * 규칙:
 * - MUST: 모든 Turn/Step 시작/종료를 구조화된 로그로 기록한다
 * - MUST: 에러 발생 시 context 정보(instanceKey, agentName, turnId, stepIndex)를 포함한다
 * - MUST: Turn/Step/ToolCall 로그에 traceId를 포함한다
 * - MUST: 민감값(access token, refresh token, secret)은 로그/메트릭에 평문으로 포함되어서는 안 된다
 * - SHOULD: 로그 레벨을 debug/info/warn/error로 구분한다
 */
interface RuntimeLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  traceId?: string; // MUST: Turn에서 전파된 traceId
  context: {
    instanceKey?: string;
    swarmRef?: string;
    agentName?: string;
    turnId?: string;
    stepIndex?: number;
  };
  data?: JsonObject;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}
```

### 16.2 메트릭 포인트

Extension은 `api.events.emit()`을 통해 다음 메트릭 이벤트를 수집할 수 있다:

| 이벤트 | 설명 | 포함 데이터 |
|--------|------|------------|
| `turn.started` | Turn 시작 | instanceKey, agentName, origin, traceId |
| `turn.completed` | Turn 완료 | duration, stepCount, status, traceId |
| `turn.failed` | Turn 실패 | error, duration, traceId |
| `step.llmCall.started` | LLM 호출 시작 | model, messageCount, traceId |
| `step.llmCall.completed` | LLM 호출 완료 | duration, tokenUsage, traceId |
| `step.llmCall.failed` | LLM 호출 실패 | error, retryCount, traceId |
| `step.toolCall.completed` | Tool 실행 완료 | toolName, duration, traceId |
| `step.toolCall.failed` | Tool 실행 실패 | toolName, error, traceId |

### 16.3 메트릭 인터페이스

```typescript
/**
 * Step/Turn 메트릭
 *
 * 규칙:
 * - SHOULD: Runtime은 최소 latencyMs, toolCallCount, errorCount, tokenUsage를 기록한다
 */
interface StepMetrics {
  /** Step 실행 시간(ms) */
  latencyMs: number;

  /** Tool 호출 횟수 */
  toolCallCount: number;

  /** 오류 횟수 */
  errorCount: number;

  /** 토큰 사용량 */
  tokenUsage: TokenUsage;
}

interface TurnMetrics {
  /** Turn 전체 실행 시간(ms) */
  latencyMs: number;

  /** Step 수 */
  stepCount: number;

  /** 총 Tool 호출 횟수 */
  toolCallCount: number;

  /** 총 오류 횟수 */
  errorCount: number;

  /** 총 토큰 사용량 */
  tokenUsage: TokenUsage;
}
```

### 16.4 Token 사용량 추적

```typescript
/**
 * LLM 토큰 사용량 추적
 *
 * 규칙:
 * - SHOULD: 각 Step에서 LLM 호출의 토큰 사용량을 기록한다
 * - SHOULD: Turn 완료 시 총 토큰 사용량을 집계한다
 */
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

### 16.5 민감값 마스킹

```typescript
/**
 * 민감값 마스킹 규칙
 *
 * 규칙:
 * - MUST: access token, refresh token, secret 등 민감값은 로그/메트릭에 평문으로 포함되어서는 안 된다
 * - SHOULD: 마스킹된 값은 앞 4자만 노출하고 나머지는 "****"로 대체한다
 */
function maskSensitiveValue(value: string): string {
  if (value.length <= 4) {
    return '****';
  }
  return value.slice(0, 4) + '****';
}

/** 민감 필드 키 패턴 */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /api[_-]?key/i,
];
```

### 16.6 Health Check

```typescript
/**
 * Runtime 상태 점검(Health Check) 인터페이스
 *
 * 규칙:
 * - SHOULD: Runtime은 상태 점검 인터페이스를 제공한다
 */
interface HealthCheckResult {
  /** 전체 상태 */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** 활성 인스턴스 수 */
  activeInstances: number;

  /** 현재 실행 중인 Turn 수 */
  activeTurns: number;

  /** 마지막 활동 시각 */
  lastActivityAt?: string;

  /** 구성 요소별 상태 */
  components?: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
  }>;
}
```

---

## 17. 구현 요구사항 요약

### 15.1 MUST 요구사항

| 항목 | 설명 |
|------|------|
| 인스턴스 라우팅 | instanceKey로 동일 맥락을 같은 SwarmInstance로 라우팅 |
| AgentInstance 이벤트 큐 | FIFO 순서로 이벤트 처리 |
| Turn traceId | Turn마다 traceId를 생성/보존하고 Step/ToolCall/Event 로그로 전파 |
| Turn 메시지 모델 | `NextMessages = BaseMessages + SUM(Events)` 규칙으로 계산 |
| Step 실행 순서 | step.config -> step.tools -> step.blocks -> step.llmInput -> step.llmCall -> toolCall -> step.post |
| Effective Config 고정 | Step 시작 시 SwarmBundleRef와 Config 고정, 실행 중 변경 금지 |
| 코드 변경 반영 | Step 시작 시 SwarmBundleRef 기준 entry 모듈 resolve, hot-reload 금지 |
| Tool 오류 처리 | 예외를 전파하지 않고 ToolResult.output에 에러 정보 포함 |
| Auth 보존 | 에이전트 간 handoff 시 turn.auth 변경 없이 전달 |
| Auth 필수 검증 | subjectMode=user OAuthApp 사용 시 auth.subjects.user 필수 |
| 파이프라인 포인트 | turn.pre/post, step.*, toolCall.*, workspace.* 제공 |
| step.config 선행 | step.config는 step.tools보다 먼저 실행 |
| Changeset 반영 시점 | 커밋된 changeset은 다음 Step의 step.config에서 활성화 |
| 인스턴스 라이프사이클 | inspect/pause/resume/terminate/delete 연산 지원 |
| pause 상태 Turn 금지 | paused 상태에서는 새 Turn을 실행해서는 안 된다 |
| resume 큐 재개 | resume 이후 큐 적재 이벤트를 순서대로 재개 |
| delete 전역 상태 보존 | delete 시 인스턴스 상태 제거, 시스템 전역 상태(OAuth grant 등) 보존 |
| 운영 인터페이스 | 라이프사이클 연산을 운영 인터페이스(CLI 등)로 제공 |
| 민감값 마스킹 | access token, refresh token, secret은 로그/메트릭에 평문 금지 |
| 메시지 상태 로그 | `messages/base.jsonl` + `messages/events.jsonl`로 분리 기록 |
| 이벤트 로그 | Swarm/Agent 이벤트를 append-only JSONL로 기록 |

### 15.2 SHOULD 요구사항

| 항목 | 설명 |
|------|------|
| maxStepsPerTurn | 기본값 32, Swarm.policy로 설정 가능 |
| Origin/Auth 채움 | Connector가 ingress 이벤트 변환 시 채움 |
| Identity 기반 정규화 | /spec/tools, /spec/extensions 배열을 identity key로 정규화 |
| Slack subject 형식 | global: "slack:team:\<team_id\>", user: "slack:user:\<team_id\>:\<user_id\>" |
| step.llmError 처리 | LLM 오류 시 파이프라인 실행, 재시도 가능 |
| 이벤트 로그 기록 | changeset 커밋/거부, Step 제한 초과 등 기록 |
| GC 정책 | TTL/idle 기반 인스턴스 자동 정리 |
| 메트릭 기록 | latencyMs, toolCallCount, errorCount, tokenUsage 기록 |
| Health Check | Runtime 상태 점검 인터페이스 제공 |

### 15.3 MAY 요구사항

| 항목 | 설명 |
|------|------|
| maxStepsPerTurn 정책 | 선택적으로 적용 가능 |
| LLM 재시도 | step.llmError 후 재시도 수행 가능 |
| Retry Policy | Swarm.policy.retry로 재시도 정책 설정 가능 |
| Timeout Policy | Swarm.policy.timeout으로 타임아웃 정책 설정 가능 |
| Token 사용량 추적 | Step/Turn 단위로 토큰 사용량 기록 가능 |
| 동기/비동기 Handoff | 위임 결과 대기 방식 선택 가능 |
| Tool call 허용 범위 | Catalog 기반 또는 Registry 기반 선택 |

---

## 부록 A. 전체 실행 흐름 다이어그램

```
[External Event via Connector]
          │
          ▼
   [SwarmInstance (instanceKey)]
          │
          ▼
   [AgentInstance Event Queue]
          │  (dequeue 1 event)
          ▼
     ┌───────────────┐
     │   Turn Start   │
     └───────────────┘
          │
          │ load BaseMessages (base.jsonl)
          ▼
   ┌───────────────────────────────────────┐
   │ Message State Init                    │
   │  - BaseMessages loaded                │
   │  - Events = []                        │
   └───────────────────────────────────────┘
          │
          │ turn.pre        (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │            Step Loop (0..N)           │
   └───────────────────────────────────────┘
          │
          │ step.pre        (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.config     (Mutator)             │
   │  - activate SwarmBundleRef + load cfg │
   └───────────────────────────────────────┘
          │
          │ step.tools      (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.tools      (Mutator)             │
   │  - build/transform Tool Catalog       │
   └───────────────────────────────────────┘
          │
          │ step.blocks     (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.blocks     (Mutator)             │
   │  - build/transform Context Blocks     │
   │  - compose Next = Base + SUM(Events)  │
   └───────────────────────────────────────┘
          │
          │ step.llmCall    (Middleware)
          ▼
   ┌───────────────────────────────────────┐
   │ step.llmCall    (Middleware onion)    │
   │  EXT.before → CORE LLM → EXT.after    │
   └───────────────────────────────────────┘
          │
          ├──── tool calls exist? ────┐
          │                           │
          ▼                           ▼
 (for each tool call)            (no tool call)
          │
          │ toolCall.pre   (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ toolCall.exec   (Middleware onion)    │
   │  EXT.before → CORE exec → EXT.after   │
   └───────────────────────────────────────┘
          │
          │ toolCall.post  (Mutator)
          ▼
          │ step.post      (Mutator)
          ▼
     ┌───────────────────────┐
     │ Continue Step loop?   │
     └───────────────────────┘
          │yes                      │no
          └───────────┐             └─────────────┐
                      ▼                           ▼
                  (next Step)               turn.post (Mutator)
                                                │
                                                │ hooks receive (base, events)
                                                │ hooks may emit events
                                                ▼
                                   fold: Base + SUM(Events)
                                                │
                                                ▼
                                  persist base.jsonl + clear events.jsonl
                                                │
                                                ▼
                                             Turn End
                                                │
                                                ▼
                                        wait next event…
```

---

## 부록 B. 관련 문서

- `docs/requirements/05_core-concepts.md`: Instance, Turn, Step 핵심 개념
- `docs/requirements/09_runtime-model.md`: Runtime 실행 모델 요구사항
- `docs/requirements/11_lifecycle-pipelines.md`: 라이프사이클 파이프라인 스펙
- `docs/requirements/appendix_a_diagram.md`: 실행 흐름 다이어그램
- `docs/specs/api.md`: Runtime/SDK API 스펙
- `docs/specs/bundle.md`: Bundle YAML 스펙
