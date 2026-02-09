# Goondan Runtime/SDK API 스펙 (v0.12)

본 문서는 `docs/requirements/index.md`를 기반으로 런타임과 확장(Extension/Tool/Connector)의 **실행 API**를 정의한다. 구성 스펙은 `docs/requirements/06_config-spec.md` 및 `docs/specs/bundle.md`를 따른다.

---

## 1. 공통 타입

### 1.1 JSON 기본 타입

```ts
/**
 * JSON null, boolean, number, string
 */
type JsonPrimitive = string | number | boolean | null;

/**
 * JSON 배열
 */
type JsonArray = JsonValue[];

/**
 * JSON 객체
 */
type JsonObject = { [key: string]: JsonValue };

/**
 * 모든 JSON 값
 */
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
```

### 1.2 리소스 참조 타입

```ts
/**
 * 리소스 참조 - 문자열 축약 또는 객체형
 *
 * 문자열 축약: "Kind/name" (예: "Tool/fileRead", "Agent/planner")
 * 객체형: { apiVersion?, kind, name }
 */
type ObjectRefLike =
  | string                                      // "Kind/name" 축약
  | { apiVersion?: string; kind: string; name: string };

// 사용 예시
const toolRef1: ObjectRefLike = "Tool/fileRead";
const toolRef2: ObjectRefLike = { kind: "Tool", name: "fileRead" };
const toolRef3: ObjectRefLike = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Tool",
  name: "fileRead"
};

/**
 * ObjectRef를 정규화된 형태로 변환
 */
function normalizeRef(ref: ObjectRefLike): { kind: string; name: string } {
  if (typeof ref === 'string') {
    const [kind, name] = ref.split('/');
    return { kind, name };
  }
  return { kind: ref.kind, name: ref.name };
}
```

### 1.3 Resource 제네릭 구조

```ts
/**
 * Config Plane 리소스 공통 형태
 */
interface Resource<TSpec = JsonObject> {
  apiVersion: string;
  kind: string;
  metadata: ResourceMetadata;
  spec: TSpec;
}

interface ResourceMetadata {
  name: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

// 사용 예시
type ToolResource = Resource<ToolSpec>;
type AgentResource = Resource<AgentSpec>;
type SwarmResource = Resource<SwarmSpec>;
```

### 1.4 LLM 메시지 타입

```ts
/**
 * LLM Tool 호출 정보
 */
interface ToolCall {
  id: string;
  name: string;
  args: JsonObject;
}

/**
 * LLM 메시지 - 역할별 variant
 */
type LlmMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

/**
 * 시스템 메시지 - LLM에게 지시/컨텍스트 제공
 */
interface SystemMessage {
  id: string;
  role: 'system';
  content: string;
}

/**
 * 사용자 메시지 - 사용자 입력
 */
interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  /** 멀티모달 콘텐츠 (선택) */
  attachments?: MessageAttachment[];
}

interface MessageAttachment {
  type: 'image' | 'file';
  url?: string;
  base64?: string;
  mimeType?: string;
}

/**
 * 어시스턴트 메시지 - LLM 응답
 */
interface AssistantMessage {
  id: string;
  role: 'assistant';
  content?: string;
  /** tool call 요청 목록 (선택) */
  toolCalls?: ToolCall[];
}

/**
 * Tool 결과 메시지
 */
interface ToolMessage {
  id: string;
  role: 'tool';
  toolCallId: string;
  toolName: string;
  output: JsonValue;
}

type MessageEvent =
  | { type: 'system_message'; seq: number; message: SystemMessage }
  | { type: 'llm_message'; seq: number; message: UserMessage | AssistantMessage | ToolMessage }
  | { type: 'replace'; seq: number; targetId: string; message: LlmMessage }
  | { type: 'remove'; seq: number; targetId: string }
  | { type: 'truncate'; seq: number };

// 사용 예시
const messages: LlmMessage[] = [
  { id: 'msg-sys-1', role: 'system', content: '너는 도움이 되는 AI 어시스턴트다.' },
  { id: 'msg-user-1', role: 'user', content: '파일 목록을 보여줘' },
  {
    id: 'msg-asst-1',
    role: 'assistant',
    content: '파일 목록을 조회하겠습니다.',
    toolCalls: [{ id: 'call_1', name: 'file.list', args: { path: '.' } }]
  },
  {
    id: 'msg-tool-1',
    role: 'tool',
    toolCallId: 'call_1',
    toolName: 'file.list',
    output: { files: ['README.md', 'package.json'] }
  }
];
```

### 1.5 Turn/Step 컨텍스트 타입

```ts
/**
 * Turn - 하나의 입력 이벤트 처리 단위
 */
interface Turn {
  id: string;
  /** 분산 추적용 Trace ID */
  traceId: string;
  /** Turn 메시지 상태 (NextMessages = BaseMessages + SUM(Events)) */
  messageState: {
    baseMessages: LlmMessage[];
    events: MessageEvent[];
    nextMessages: LlmMessage[];
  };
  /** Tool 실행 결과 (Step별 누적) */
  toolResults: ToolResult[];
  /** Turn 시작 시간 */
  startedAt: string;
  /** Turn 종료 시간 (선택) */
  endedAt?: string;
  /** 호출 맥락 정보 */
  origin?: TurnOrigin;
  /** 인증 컨텍스트 */
  auth?: TurnAuth;
  /** Turn 메타데이터 */
  metadata?: JsonObject;
  /** Turn 요약 (turn.post에서 생성) */
  summary?: string;
}

/**
 * Turn 호출 맥락 정보
 */
interface TurnOrigin {
  connector: string;
  channel?: string;
  threadTs?: string;
  [key: string]: JsonValue | undefined;
}

/**
 * Turn 인증 컨텍스트
 */
interface TurnAuth {
  actor: {
    type: 'user' | 'service' | 'system';
    id: string;
    display?: string;
  };
  subjects: {
    /** 전역 토큰 조회용 (예: slack:team:T111) */
    global?: string;
    /** 사용자별 토큰 조회용 (예: slack:user:T111:U234567) */
    user?: string;
  };
}

/**
 * Step - LLM 호출 1회 중심 단위
 */
interface Step {
  id: string;
  index: number;
  /** LLM 호출 결과 */
  llmResult?: LlmResult;
  /** Step 시작 시간 */
  startedAt: string;
  /** Step 종료 시간 (선택) */
  endedAt?: string;
  /** Step 상태 */
  status: 'pending' | 'running' | 'completed' | 'failed';
}

/**
 * LLM 호출 결과
 */
interface LlmResult {
  message: AssistantMessage;
  meta: {
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    model?: string;
    finishReason?: string;
  };
}
```

---

## 2. Extension API

Extension은 런타임 라이프사이클의 특정 지점에 개입하기 위해 등록되는 실행 로직 묶음이다.

### 2.1 엔트리포인트

Extension 모듈은 `register(api)` 함수를 **반드시** 제공해야 한다.

```ts
/**
 * Extension 등록 함수
 * Runtime은 AgentInstance 초기화 시점에 확장 목록 순서대로 이를 호출한다.
 */
export async function register(api: ExtensionApi): Promise<void>;

// 사용 예시
export async function register(api: ExtensionApi<MyState, MyConfig>): Promise<void> {
  // 상태 초기화
  api.setState({ ...api.getState(), initialized: true });

  // 파이프라인 등록
  api.pipelines.mutate('step.blocks', async (ctx) => {
    // 컨텍스트 블록 추가
    return ctx;
  });

  // 동적 도구 등록
  api.tools.register({
    name: 'myExt.getData',
    description: '데이터 조회',
    parameters: { type: 'object', properties: {} },
    handler: async (ctx, input) => ({ data: 'result' })
  });
}
```

### 2.2 ExtensionApi 인터페이스

```ts
/**
 * Extension 등록 시 제공되는 API
 */
interface ExtensionApi<State = JsonObject, Config = JsonObject> {
  /** Extension 리소스 정의 */
  extension: Resource<ExtensionSpec<Config>>;

  /** 파이프라인 등록 API */
  pipelines: PipelineApi;

  /** 동적 Tool 등록 API */
  tools: ToolRegistryApi;

  /** 이벤트 버스 */
  events: EventBus;

  /** SwarmBundle Changeset API (선택 - Runtime capability에 따라 제공) */
  swarmBundle?: SwarmBundleApi;

  /** Live Config API (선택 - Runtime capability에 따라 제공) */
  liveConfig?: LiveConfigApi;

  /** OAuth API */
  oauth: OAuthApi;

  /** 확장별 상태 조회 (인스턴스별 격리, 자동 영속화) */
  getState: () => State;

  /** 확장별 상태 저장 (Turn 종료 시 Runtime이 디스크에 자동 기록) */
  setState: (next: State) => void;

  /** 로거 */
  logger?: Console;
}

/**
 * Extension Spec 구조
 */
interface ExtensionSpec<Config = JsonObject> {
  runtime: 'node' | 'deno' | 'python';
  entry: string;
  config?: Config;
}
```

### 2.3 PipelineApi 상세

```ts
/**
 * 파이프라인 등록 API
 */
interface PipelineApi {
  /**
   * Mutator 등록 - 순차 실행을 통해 컨텍스트를 변형
   * extensions 등록 순서대로 선형 실행
   */
  mutate<T extends PipelinePoint>(
    point: T,
    handler: MutatorHandler<PipelineContext[T]>
  ): void;

  /**
   * Middleware 등록 - next() 기반 래핑 (onion 구조)
   * 먼저 등록된 확장이 더 바깥 레이어
   */
  wrap<T extends PipelinePoint>(
    point: T,
    handler: MiddlewareHandler<PipelineContext[T]>
  ): void;
}

/**
 * Mutator 핸들러 - 컨텍스트를 변형하여 반환
 */
type MutatorHandler<Ctx> = (ctx: Ctx) => Promise<Ctx> | Ctx;

/**
 * Middleware 핸들러 - next()로 다음 핸들러 호출
 */
type MiddlewareHandler<Ctx> = (
  ctx: Ctx,
  next: (ctx: Ctx) => Promise<Ctx>
) => Promise<Ctx>;

// 사용 예시: Mutator
api.pipelines.mutate('step.blocks', async (ctx) => {
  const blocks = [...(ctx.blocks || [])];
  blocks.push({
    type: 'custom.info',
    data: { timestamp: Date.now() }
  });
  return { ...ctx, blocks };
});

// 사용 예시: Middleware (onion 구조)
api.pipelines.wrap('step.llmCall', async (ctx, next) => {
  const startTime = Date.now();
  api.logger?.debug?.('LLM 호출 시작');

  // 실제 LLM 호출
  const result = await next(ctx);

  const elapsed = Date.now() - startTime;
  api.logger?.debug?.(`LLM 호출 완료: ${elapsed}ms`);
  return result;
});
```

### 2.4 Pipeline Point 전체 목록

```ts
/**
 * 파이프라인 포인트 - 라이프사이클 개입 지점
 */
type PipelinePoint =
  // Turn 레벨
  | 'turn.pre'          // Turn 시작 전 (Mutator)
  | 'turn.post'         // Turn 종료 후 (base/events 전달, Mutator)
  // Step 레벨
  | 'step.pre'          // Step 시작 전 (Mutator)
  | 'step.config'       // SwarmBundleRef 활성화 + Config 로드 (Mutator)
  | 'step.tools'        // Tool Catalog 구성 (Mutator)
  | 'step.blocks'       // Context Blocks 구성 (Mutator)
  | 'step.llmCall'      // LLM 호출 (Middleware)
  | 'step.llmError'     // LLM 호출 실패 시 (Mutator)
  | 'step.post'         // Step 종료 후 (Mutator)
  // ToolCall 레벨
  | 'toolCall.pre'      // Tool 호출 전 (Mutator)
  | 'toolCall.exec'     // Tool 실행 (Middleware)
  | 'toolCall.post'     // Tool 호출 후 (Mutator)
  // Workspace 레벨
  | 'workspace.repoAvailable'      // Repo 사용 가능 시
  | 'workspace.worktreeMounted';   // Worktree 마운트 시

/**
 * 각 파이프라인 포인트별 컨텍스트 타입
 */
interface PipelineContext {
  'turn.pre': TurnContext;
  'turn.post': TurnContext;
  'step.pre': StepContext;
  'step.config': StepContext;
  'step.tools': StepContext;
  'step.blocks': StepContext;
  'step.llmCall': StepContext;
  'step.llmError': StepContext & { error: Error };
  'step.post': StepContext;
  'toolCall.pre': ToolCallContext;
  'toolCall.exec': ToolCallContext;
  'toolCall.post': ToolCallContext;
  'workspace.repoAvailable': WorkspaceContext;
  'workspace.worktreeMounted': WorkspaceContext;
}

/**
 * Turn 컨텍스트
 */
interface TurnContext {
  instance: SwarmInstanceRef;
  swarm: Resource<SwarmSpec>;
  agent: Resource<AgentSpec>;
  turn: Turn;
  /** turn.post에서 제공되는 기준 메시지 스냅샷 */
  baseMessages?: LlmMessage[];
  /** turn.post에서 제공되는 메시지 이벤트 뷰 */
  messageEvents?: MessageEvent[];
  effectiveConfig: EffectiveConfig;
}

/**
 * Step 컨텍스트
 */
interface StepContext extends TurnContext {
  step: Step;
  /** Tool Catalog (step.tools 이후 사용 가능) */
  toolCatalog?: ToolCatalogItem[];
  /** Context Blocks (step.blocks 이후 사용 가능) */
  blocks?: ContextBlock[];
  /** LLM 결과 (step.llmCall 이후 사용 가능) */
  llmResult?: LlmResult;
}

/**
 * ToolCall 컨텍스트
 */
interface ToolCallContext extends StepContext {
  toolCall: ToolCall;
  toolResult?: ToolResult;
}

/**
 * Workspace 컨텍스트
 */
interface WorkspaceContext {
  path: string;
  type: 'repo' | 'worktree';
}

/**
 * Context Block - LLM 컨텍스트에 주입되는 정보 블록
 */
interface ContextBlock {
  type: string;
  data?: JsonObject;
  items?: JsonArray;
}
```

### 2.5 ToolRegistryApi 상세

```ts
/**
 * 동적 Tool 등록 API
 */
interface ToolRegistryApi {
  /**
   * 동적 Tool 등록
   * 등록된 Tool은 Registry에 추가되며, Catalog 노출은 별도 설정 필요
   */
  register(toolDef: DynamicToolDefinition): void;

  /**
   * 등록된 Tool 제거
   */
  unregister(name: string): void;

  /**
   * 등록된 Tool 조회
   */
  get(name: string): DynamicToolDefinition | undefined;

  /**
   * 등록된 모든 Tool 목록
   */
  list(): DynamicToolDefinition[];
}

/**
 * 동적 Tool 정의
 */
interface DynamicToolDefinition {
  name: string;
  description: string;
  parameters?: JsonObject;  // JSON Schema
  handler: ToolHandler;
  /** 이 Tool이 사용하는 OAuthApp (선택) */
  auth?: {
    oauthAppRef: ObjectRefLike;
    scopes?: string[];
  };
}

// 사용 예시
api.tools.register({
  name: 'myExt.search',
  description: '데이터 검색',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '검색어' },
      limit: { type: 'number', description: '최대 결과 수' }
    },
    required: ['query']
  },
  handler: async (ctx, input) => {
    const query = String(input.query || '');
    const limit = Number(input.limit || 10);
    // 검색 로직
    return { results: [], total: 0 };
  }
});
```

### 2.6 EventBus 상세

```ts
/**
 * 런타임 이벤트 버스
 */
interface EventBus {
  /**
   * 이벤트 발행
   */
  emit(type: string, payload?: JsonObject): void;

  /**
   * 이벤트 구독
   */
  on(type: string, handler: EventHandler): () => void;

  /**
   * 이벤트 일회성 구독
   */
  once(type: string, handler: EventHandler): () => void;

  /**
   * 구독 해제
   */
  off(type: string, handler: EventHandler): void;
}

type EventHandler = (payload: JsonObject) => void | Promise<void>;

// 사용 예시
// 이벤트 발행
api.events.emit('myExtension.initialized', { timestamp: Date.now() });

// 이벤트 구독
const unsubscribe = api.events.on('workspace.repoAvailable', async (payload) => {
  const repoPath = payload.path;
  api.logger?.info?.(`Repo 사용 가능: ${repoPath}`);
  // repo 스캔, 인덱싱 등
});

// 구독 해제
unsubscribe();
```

### 2.7 SwarmBundleApi 상세

```ts
/**
 * SwarmBundle Changeset API
 * SwarmBundle 정의(YAML/코드)를 변경하기 위한 인터페이스
 */
interface SwarmBundleApi {
  /**
   * Changeset 열기 - Git worktree 생성
   */
  openChangeset(input?: OpenChangesetInput): Promise<OpenChangesetResult>;

  /**
   * Changeset 커밋 - Git commit 생성 및 활성 Ref 업데이트
   */
  commitChangeset(input: CommitChangesetInput): Promise<CommitChangesetResult>;

  /**
   * 현재 활성 SwarmBundleRef 조회
   */
  getActiveRef(): string;
}

interface OpenChangesetInput {
  reason?: string;
}

interface OpenChangesetResult {
  changesetId: string;
  baseRef: string;
  workdir: string;
  hint?: {
    bundleRootInWorkdir: string;
    recommendedFiles: string[];
  };
}

interface CommitChangesetInput {
  changesetId: string;
  message?: string;
}

interface CommitChangesetResult {
  status: 'ok' | 'rejected' | 'conflict' | 'failed';
  changesetId: string;
  baseRef: string;
  newRef?: string;       // status === 'ok' 인 경우
  summary?: {
    filesChanged: string[];
    filesAdded: string[];
    filesDeleted: string[];
  };
  error?: {              // status !== 'ok' 인 경우
    code: string;
    message: string;
  };
}
```

### 2.8 LiveConfigApi 상세

```ts
/**
 * Live Config API
 * 실행 중 Config를 동적으로 변경하기 위한 인터페이스
 */
interface LiveConfigApi {
  /**
   * Config 변경 패치 제안
   */
  proposePatch(patch: LiveConfigPatch): Promise<void>;

  /**
   * 현재 Effective Config 조회
   */
  getEffectiveConfig(): EffectiveConfig;

  /**
   * 현재 revision 조회
   */
  getRevision(): number;
}

interface LiveConfigPatch {
  scope: 'swarm' | 'agent';
  applyAt: 'step.config' | 'immediate';
  patch: {
    type: 'json6902';
    ops: JsonPatchOperation[];
  };
  source: {
    type: 'tool' | 'extension';
    name: string;
  };
  reason?: string;
}

interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: JsonValue;
  from?: string;
}

// 사용 예시
await ctx.liveConfig.proposePatch({
  scope: 'agent',
  applyAt: 'step.config',
  patch: {
    type: 'json6902',
    ops: [{
      op: 'add',
      path: '/spec/tools/-',
      value: { kind: 'Tool', name: 'newTool' }
    }]
  },
  source: { type: 'tool', name: 'toolSearch' },
  reason: '사용자 요청으로 도구 추가'
});
```

### 2.9 getState/setState 상세

```ts
/**
 * 확장별 상태 저장소
 * SwarmInstance별로 격리되며 Runtime이 자동 영속화
 * Extension identity에 귀속되며 reconcile 규칙을 따른다
 *
 * 영속화 규칙:
 * - 인스턴스 초기화 시 디스크에서 자동 복원(MUST)
 * - Turn 종료 시 변경된 상태를 디스크에 자동 기록(MUST)
 * - 저장 경로: <instanceStateRoot>/extensions/<extensionName>/state.json
 */
interface ExtensionApi<State = JsonObject, Config = JsonObject> {
  /**
   * 확장별 상태 조회
   * 현재 상태의 스냅샷을 반환
   * 인스턴스 재시작 시 디스크에서 복원된 상태가 반환됨
   */
  getState: () => State;

  /**
   * 확장별 상태 저장
   * 새 상태로 교체 (변경 감지 가능)
   * JSON 직렬화 가능한 값만 허용(MUST)
   */
  setState: (next: State) => void;
}

// 사용 예시
interface MyExtensionState {
  processedSteps: number;
  lastCompactionStep?: string;
  catalog: SkillItem[];
}

export async function register(
  api: ExtensionApi<MyExtensionState, MyConfig>
): Promise<void> {
  // 인스턴스 재시작 시 이전 상태가 자동 복원됨
  const existing = api.getState();
  if (!existing.processedSteps) {
    // 최초 실행: 초기 상태 설정
    api.setState({
      processedSteps: 0,
      catalog: []
    });
  }

  api.pipelines.mutate('step.post', async (ctx) => {
    // 상태 업데이트 — Turn 종료 시 자동으로 디스크에 기록됨
    const state = api.getState();
    api.setState({
      ...state,
      processedSteps: state.processedSteps + 1
    });
    return ctx;
  });
}
```

---

## 3. Tool API

Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위이다.

### 3.1 Tool 모듈 구조

Tool 모듈은 `handlers` 맵 또는 default export로 핸들러를 제공한다.

```ts
/**
 * Tool 핸들러 시그니처
 */
export type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;

/**
 * Tool 모듈 export 형식
 */
export const handlers: Record<string, ToolHandler> = {
  "tool.name": async (ctx, input) => {
    // 구현
    return { result: 'ok' };
  }
};

// 사용 예시: 파일 읽기 도구
export const handlers: Record<string, ToolHandler> = {
  "file.read": async (ctx, input) => {
    const path = String(input.path || '');
    const encoding = String(input.encoding || 'utf8');

    if (!path) {
      throw new Error('path가 필요합니다.');
    }

    const content = await readFile(path, { encoding });
    return {
      path,
      content,
      size: content.length
    };
  },

  "file.write": async (ctx, input) => {
    const path = String(input.path || '');
    const content = String(input.content || '');

    await writeFile(path, content);
    return { path, written: content.length };
  }
};
```

### 3.2 ToolContext 전체 필드

```ts
/**
 * Tool 실행 컨텍스트
 */
interface ToolContext {
  /** SwarmInstance 참조 */
  instance: SwarmInstanceRef;

  /** Swarm 리소스 정의 */
  swarm: Resource<SwarmSpec>;

  /** Agent 리소스 정의 */
  agent: Resource<AgentSpec>;

  /** 현재 Turn */
  turn: Turn;

  /** 현재 Step */
  step: Step;

  /** 현재 Step에서 노출된 도구 목록 */
  toolCatalog: ToolCatalogItem[];

  /** SwarmBundle Changeset API */
  swarmBundle: SwarmBundleApi;

  /** Live Config API */
  liveConfig: LiveConfigApi;

  /** OAuth API */
  oauth: OAuthApi;

  /** 이벤트 버스 */
  events: EventBus;

  /** 로거 */
  logger: Console;

  /** 인스턴스별 작업 디렉터리 (Tool CWD 바인딩용) */
  workdir: string;

  /** Agent 위임/관리 API */
  agents: ToolAgentsApi;
}

/**
 * Agent 위임 옵션
 */
interface AgentDelegateOptions {
  /** 추가 컨텍스트 */
  context?: string;
  /** true면 비동기 실행 (응답 대기 안함) */
  async?: boolean;
}

/**
 * Agent 위임/관리 API
 */
interface ToolAgentsApi {
  /** 다른 에이전트에 작업을 위임하고 결과를 반환 */
  delegate(agentName: string, task: string, options?: AgentDelegateOptions): Promise<AgentDelegateResult>;
  /** 현재 Swarm 내 에이전트 인스턴스 목록 조회 */
  listInstances(): Promise<AgentInstanceInfo[]>;
  /** 에이전트 이름으로 새 인스턴스를 생성 (Turn 실행 없이) */
  spawnInstance(agentName: string): Promise<AgentSpawnResult>;
  /** 특정 인스턴스 ID의 에이전트에 작업을 위임 */
  delegateToInstance(instanceId: string, task: string, options?: AgentDelegateOptions): Promise<AgentDelegateResult>;
  /** 인스턴스 ID로 에이전트 인스턴스를 삭제 */
  destroyInstance(instanceId: string): Promise<AgentDestroyResult>;
}

interface AgentDelegateResult {
  success: boolean;
  agentName: string;
  instanceId: string;
  response?: string;
  error?: string;
}

interface AgentSpawnResult {
  instanceId: string;
  agentName: string;
}

interface AgentDestroyResult {
  success: boolean;
  instanceId: string;
  error?: string;
}

interface AgentInstanceInfo {
  instanceId: string;
  agentName: string;
  status: string;
}

interface SwarmInstanceRef {
  id: string;
  instanceKey: string;
  swarmName: string;
  /** 인스턴스 공유 상태 (선택) */
  shared?: JsonObject;
}
```

### 3.3 ToolCatalogItem 구조

```ts
/**
 * Tool Catalog 항목
 * LLM에 노출되는 도구 정보
 */
interface ToolCatalogItem {
  /** 도구 이름 (LLM이 호출하는 이름) */
  name: string;

  /** 도구 설명 */
  description?: string;

  /** 입력 파라미터 JSON Schema */
  parameters?: JsonObject;

  /** 원본 Tool 리소스 (선택) */
  tool?: Resource<ToolSpec> | null;

  /** Tool export 정의 (선택) */
  export?: ToolExportSpec | null;

  /** 도구 출처 정보 */
  source?: {
    type: 'config' | 'extension' | 'mcp';
    name: string;
  };
}

interface ToolExportSpec {
  name: string;
  description: string;
  parameters?: JsonObject;
  auth?: {
    scopes?: string[];
  };
}
```

### 3.4 ToolResult 구조

```ts
/**
 * Tool 실행 결과
 */
interface ToolResult {
  /** Tool 호출 ID */
  toolCallId: string;

  /** 도구 이름 */
  toolName: string;

  /** 결과 상태 */
  status: 'ok' | 'error' | 'pending';

  /** 결과 데이터 (동기 완료 시) */
  output?: JsonValue;

  /** 비동기 핸들 (비동기 제출 시) */
  handle?: string;

  /** 오류 정보 (status === 'error' 시) */
  error?: {
    name: string;
    message: string;
    code?: string;
    /** 사용자에게 제시할 해결 제안 (선택) */
    suggestion?: string;
    /** 관련 도움말 URL (선택) */
    helpUrl?: string;
  };
}

// Tool 오류 결과 예시
const errorResult: ToolResult = {
  toolCallId: 'call_123',
  toolName: 'file.read',
  status: 'error',
  error: {
    name: 'Error',
    message: '파일을 찾을 수 없습니다: /nonexistent',
    code: 'ENOENT',
    suggestion: '파일 경로를 확인하세요',
    helpUrl: 'https://docs.goondan.io/errors/ENOENT'
  }
};
```

### 3.5 Tool 오류 처리

```ts
/**
 * Tool 오류 메시지 제한
 * - error.message는 Tool.spec.errorMessageLimit 길이 제한 적용
 * - 기본값: 1000자
 */

// Tool 정의에서 errorMessageLimit 설정
// spec:
//   errorMessageLimit: 1200

// Runtime 처리 예시
function limitErrorMessage(message: string, limit: number = 1000): string {
  if (message.length <= limit) return message;
  return message.slice(0, limit - 3) + '...';
}
```

---

## 4. Connector API

Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 역할을 한다. 응답 전송은 Tool을 통해 처리하며, Connector는 이벤트 수신과 정규화에만 집중한다.

### 4.1 ConnectorEntryFunction

Connector entry 모듈은 단일 default export 함수를 제공해야 한다(MUST).

```ts
/**
 * Connector Entry Function
 * 단일 default export로 제공
 */
type ConnectorEntryFunction = (
  context: ConnectorContext
) => Promise<void>;
```

### 4.2 ConnectorContext

Entry 함수에 전달되는 컨텍스트. Connection마다 한 번씩 호출된다.

```ts
interface ConnectorContext {
  /** 트리거 이벤트 정보 */
  event: ConnectorTriggerEvent;

  /** 현재 Connection 리소스 */
  connection: Resource<ConnectionSpec>;

  /** Connector 리소스 */
  connector: Resource<ConnectorSpec>;

  /** ConnectorEvent 발행 */
  emit: (event: ConnectorEvent) => Promise<void>;

  /** 로깅 */
  logger: Console;

  /** OAuth 토큰 접근 (Connection의 OAuthApp 기반 모드인 경우) */
  oauth?: {
    getAccessToken: (request: OAuthTokenRequest) => Promise<OAuthTokenResult>;
  };

  /** 서명 검증 정보 (Connection의 verify 블록에서 해석) */
  verify?: {
    webhook?: {
      /** 서명 시크릿 (Connection의 verify.webhook.signingSecret에서 해석된 값) */
      signingSecret: string;
    };
  };
}
```

### 4.3 ConnectorTriggerEvent

트리거 프로토콜별 페이로드를 캡슐화한다.

```ts
interface ConnectorTriggerEvent {
  type: 'connector.trigger';
  trigger: TriggerPayload;
  timestamp: string;
}

type TriggerPayload =
  | HttpTriggerPayload
  | CronTriggerPayload
  | CliTriggerPayload;

interface HttpTriggerPayload {
  type: 'http';
  payload: {
    request: {
      method: string;
      path: string;
      headers: Record<string, string>;
      body: JsonObject;
      rawBody?: string;
    };
  };
}

interface CronTriggerPayload {
  type: 'cron';
  payload: {
    schedule: string;
    scheduledAt: string;
  };
}

interface CliTriggerPayload {
  type: 'cli';
  payload: {
    text: string;
    instanceKey?: string;
  };
}
```

### 4.4 ConnectorEvent

Entry 함수가 `ctx.emit()`으로 발행하는 정규화된 이벤트이다.

```ts
/**
 * ConnectorEvent 메시지 (멀티모달)
 */
type ConnectorEventMessage =
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "file"; data: string; mediaType: string };

/**
 * ConnectorEvent
 * Connector가 Runtime으로 전달하는 정규화된 이벤트
 */
interface ConnectorEvent {
  /** 이벤트 타입 (고정) */
  type: "connector.event";

  /** 이벤트 이름 (connector의 events[]에 선언된 이름) */
  name: string;

  /** 멀티모달 입력 메시지 */
  message: ConnectorEventMessage;

  /** 이벤트 속성 (events[].properties에 선언된 키-값) */
  properties?: JsonObject;

  /** 인증 컨텍스트 */
  auth?: {
    actor: { id: string; name?: string };
    subjects: { global?: string; user?: string };
  };
}
```

### 4.5 Runtime handleEvent 입력 구조

Runtime은 ConnectorEvent를 수신하여 Connection의 ingress rules에 따라 Agent로 라우팅한다.

```ts
/**
 * Runtime이 ConnectorEvent를 처리할 때의 내부 입력 구조
 */
interface RuntimeEventInput {
  /** 발신 Connection 참조 */
  connectionRef: ObjectRefLike;

  /** ConnectorEvent */
  event: ConnectorEvent;

  /** 대상 Agent 참조 (ingress rule의 route.agentRef에서 해석) */
  agentRef?: ObjectRefLike;
}
```

### 4.6 사용 예시: Slack Connector Entry Function

```ts
// ./connectors/slack/index.ts
import type { ConnectorContext } from '@goondan/core';

export default async function (context: ConnectorContext): Promise<void> {
  const { event, emit, verify, logger } = context;

  if (event.type !== "connector.trigger") return;
  if (event.trigger.type !== "http") return;

  const req = event.trigger.payload.request;

  // 서명 검증
  const signingSecret = verify?.webhook?.signingSecret;
  if (signingSecret) {
    const isValid = await verifySlackSignature(req, signingSecret);
    if (!isValid) {
      logger.warn("Slack 서명 검증 실패");
      return;
    }
  }

  // 이벤트 파싱 및 emit
  const body = req.body;
  const slackEvent = body.event;
  if (!slackEvent || typeof slackEvent !== "object") return;

  const eventType = typeof slackEvent.type === "string" ? slackEvent.type : "";
  const userId = typeof slackEvent.user === "string" ? slackEvent.user : "";
  const teamId = typeof body.team_id === "string" ? body.team_id : "";
  const text = typeof slackEvent.text === "string" ? slackEvent.text : "";

  await emit({
    type: "connector.event",
    name: eventType === "app_mention" ? "app_mention" : "message.im",
    message: { type: "text", text },
    properties: {
      channel_id: typeof slackEvent.channel === "string" ? slackEvent.channel : "",
      ts: typeof slackEvent.ts === "string" ? slackEvent.ts : "",
    },
    auth: {
      actor: { id: `slack:${userId}` },
      subjects: {
        global: `slack:team:${teamId}`,
        user: `slack:user:${teamId}:${userId}`,
      },
    },
  });
}
```

---

## 5. SwarmBundle Changeset API

SwarmBundle 변경은 Changeset을 통해 수행한다. (세부: `docs/requirements/06_config-spec.md` 6.4)

Runtime이 Extension/Tool 실행 컨텍스트에 programmatic API를 제공하며, 다음과 같은 인터페이스를 사용한다(MUST). 단, 제공 된 것을 실제로 사용할지 여부는 SwarmBundle의 설정에 따른다.

### 5.1 openChangeset 상세

```ts
/**
 * Changeset 열기
 * Git worktree를 생성하여 파일 수정 가능한 workdir 반환
 */
interface SwarmBundleApi {
  openChangeset(input?: OpenChangesetInput): Promise<OpenChangesetResult>;
}

interface OpenChangesetInput {
  /** 변경 사유 (커밋 메시지 등에 활용) */
  reason?: string;
}

interface OpenChangesetResult {
  /** Changeset 식별자 */
  changesetId: string;

  /** 기준 SwarmBundleRef */
  baseRef: string;

  /**
   * 작업 디렉터리 경로
   * 이 경로에서 파일을 읽고 수정할 수 있음
   */
  workdir: string;

  /** 작업 힌트 (선택) */
  hint?: {
    /** workdir 내 bundle root 경로 */
    bundleRootInWorkdir: string;
    /** 권장 수정 대상 파일 패턴 */
    recommendedFiles: string[];
  };
}

// 사용 예시
const result = await ctx.swarmBundle.openChangeset({
  reason: '프롬프트 개선'
});

console.log(result);
// {
//   changesetId: "cs-000123",
//   baseRef: "git:HEAD",
//   workdir: "/home/user/.goondan/worktrees/workspace-abc/changesets/cs-000123/",
//   hint: {
//     bundleRootInWorkdir: ".",
//     recommendedFiles: ["goondan.yaml", "prompts/**"]
//   }
// }
```

### 5.2 commitChangeset 상세

```ts
/**
 * Changeset 커밋
 * workdir의 변경을 Git commit으로 만들고 SwarmBundleRoot의 활성 Ref 업데이트
 */
interface SwarmBundleApi {
  commitChangeset(input: CommitChangesetInput): Promise<CommitChangesetResult>;
}

interface CommitChangesetInput {
  /** Changeset 식별자 */
  changesetId: string;

  /** 커밋 메시지 (선택) */
  message?: string;
}

interface CommitChangesetResult {
  /** 결과 상태 */
  status: 'ok' | 'rejected' | 'conflict' | 'failed';

  /** Changeset 식별자 */
  changesetId: string;

  /** 기준 SwarmBundleRef */
  baseRef: string;

  /** 새 SwarmBundleRef (status === 'ok' 시) */
  newRef?: string;

  /** 변경 요약 (status === 'ok' 시) */
  summary?: {
    filesChanged: string[];
    filesAdded: string[];
    filesDeleted: string[];
  };

  /** 오류 정보 (status !== 'ok' 시) */
  error?: {
    code: string;
    message: string;
  };
}

// 성공 응답 예시
const successResult: CommitChangesetResult = {
  status: 'ok',
  changesetId: 'cs-000123',
  baseRef: 'git:3d2a...9f',
  newRef: 'git:9b1c...77',
  summary: {
    filesChanged: ['prompts/planner.system.md'],
    filesAdded: [],
    filesDeleted: []
  }
};

// 거부 응답 예시 (ChangesetPolicy 위반)
const rejectedResult: CommitChangesetResult = {
  status: 'rejected',
  changesetId: 'cs-000123',
  baseRef: 'git:3d2a...9f',
  error: {
    code: 'POLICY_VIOLATION',
    message: 'goondan.yaml 파일은 변경이 허용되지 않습니다.'
  }
};

// 충돌 응답 예시 (baseRef가 현재 HEAD와 불일치)
const conflictResult: CommitChangesetConflict = {
  status: 'conflict',
  changesetId: 'cs-000123',
  baseRef: 'git:3d2a...9f',
  currentHeadRef: 'git:5e8f...b2',
  conflicts: ['prompts/planner.system.md'],
  suggestedAction: '기존 changeset에서 충돌 파일을 수정한 뒤 다시 commitChangeset을 시도하세요'
};
```

**CommitChangesetConflict variant:**

```ts
/**
 * Changeset 충돌 (baseRef와 현재 HEAD가 불일치)
 */
interface CommitChangesetConflict {
  status: 'conflict';
  changesetId: string;
  baseRef: string;
  /** 현재 HEAD Ref */
  currentHeadRef: string;
  /** 충돌 파일 목록 */
  conflicts: string[];
  /** 권장 조치 (선택) */
  suggestedAction?: string;
}

### 5.3 ChangesetPolicy 검증

```ts
/**
 * ChangesetPolicy 검증 규칙
 *
 * Swarm.spec.policy.changesets.allowed.files: 최대 허용 범위
 * Agent.spec.changesets.allowed.files: 추가 제약 (더 좁게)
 *
 * 변경은 Swarm + Agent 모두를 만족해야 허용됨
 */

// Swarm ChangesetPolicy 예시
// spec:
//   policy:
//     changesets:
//       enabled: true
//       applyAt:
//         - step.config
//       allowed:
//         files:
//           - "resources/**"
//           - "prompts/**"
//           - "tools/**"
//           - "extensions/**"
//       emitRevisionChangedEvent: true

// Agent ChangesetPolicy 예시 (추가 제약)
// spec:
//   changesets:
//     allowed:
//       files:
//         - "prompts/**"
//         - "resources/**"

// 검증 로직 개념
function validateChangesetPolicy(
  changedFiles: string[],
  swarmPolicy: ChangesetPolicy,
  agentPolicy?: ChangesetPolicy
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const file of changedFiles) {
    // Swarm 정책 검사
    if (!matchesGlob(file, swarmPolicy.allowed.files)) {
      violations.push(`Swarm 정책 위반: ${file}`);
      continue;
    }

    // Agent 정책 검사 (있는 경우)
    if (agentPolicy && !matchesGlob(file, agentPolicy.allowed.files)) {
      violations.push(`Agent 정책 위반: ${file}`);
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}
```

---

## 6. OAuth API

OAuth 토큰 접근 인터페이스. Tool/Connector/Extension이 외부 API 호출에 필요한 토큰을 획득한다.

### 6.1 ctx.oauth.getAccessToken 상세

```ts
/**
 * OAuth API
 */
interface OAuthApi {
  /**
   * Access Token 획득
   * Grant가 있으면 토큰 반환, 없으면 승인 URL 반환
   */
  getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
}

interface OAuthTokenRequest {
  /** OAuthApp 참조 */
  oauthAppRef: ObjectRefLike;

  /**
   * 요청 스코프 (선택)
   * OAuthApp.spec.scopes의 부분집합만 허용
   * 미지정 시 OAuthApp.spec.scopes 사용
   */
  scopes?: string[];

  /**
   * 최소 TTL (선택)
   * 토큰 만료가 이 시간 이내면 refresh 시도
   */
  minTtlSeconds?: number;
}
```

### 6.2 OAuthTokenResult 모든 variant

```ts
/**
 * OAuth Token 결과
 */
type OAuthTokenResult =
  | OAuthTokenReady
  | OAuthTokenAuthorizationRequired
  | OAuthTokenError;

/**
 * 토큰 준비 완료
 */
interface OAuthTokenReady {
  status: 'ready';

  /** Access Token */
  accessToken: string;

  /** 토큰 타입 (일반적으로 'bearer') */
  tokenType: string;

  /** 토큰 만료 시간 */
  expiresAt: string;

  /** 부여된 스코프 */
  scopes: string[];
}

/**
 * 사용자 승인 필요
 */
interface OAuthTokenAuthorizationRequired {
  status: 'authorization_required';

  /** 승인 세션 ID */
  authSessionId: string;

  /** 승인 URL (사용자에게 안내) */
  authorizationUrl: string;

  /** 세션 만료 시간 */
  expiresAt: string;

  /** 사용자 안내 메시지 */
  message: string;

  /** Device Code 플로우 시 추가 정보 (선택) */
  deviceCode?: {
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  };
}

/**
 * 오류
 */
interface OAuthTokenError {
  status: 'error';

  error: {
    code: string;
    message: string;
  };
}

// 사용 예시: Tool에서 OAuth 토큰 사용
export const handlers: Record<string, ToolHandler> = {
  'slack.postMessage': async (ctx, input) => {
    // 토큰 획득 시도
    const tokenResult = await ctx.oauth.getAccessToken({
      oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      scopes: ['chat:write']
    });

    // 상태별 처리
    if (tokenResult.status === 'authorization_required') {
      return {
        status: 'authorization_required',
        message: tokenResult.message,
        authorizationUrl: tokenResult.authorizationUrl
      };
    }

    if (tokenResult.status === 'error') {
      throw new Error(tokenResult.error.message);
    }

    // 토큰 사용하여 API 호출
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel: input.channel,
        text: input.text
      })
    });

    return await response.json();
  }
};
```

### 6.3 OAuth Subject 결정 규칙

```ts
/**
 * OAuth Subject 결정 규칙
 *
 * OAuthApp.spec.subjectMode에 따라 Turn에서 subject 결정:
 * - subjectMode=global: turn.auth.subjects.global 사용
 * - subjectMode=user: turn.auth.subjects.user 사용
 *
 * 해당 키가 Turn에 없으면 오류
 */

// OAuthApp 정의 예시
// kind: OAuthApp
// metadata:
//   name: slack-bot
// spec:
//   subjectMode: global  # 팀 단위 토큰
//   ...

// Turn 컨텍스트 예시
// turn.auth:
//   subjects:
//     global: "slack:team:T111"        # subjectMode=global 시 사용
//     user: "slack:user:T111:U234567"  # subjectMode=user 시 사용
```

---

## 7. Runtime Events

Runtime이 발행하는 표준 이벤트 목록.

### 7.1 표준 이벤트 타입

```ts
/**
 * 표준 Runtime 이벤트 타입
 */
type RuntimeEventType =
  // Turn 이벤트
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  // Step 이벤트
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  // Tool 이벤트
  | 'tool.called'
  | 'tool.completed'
  | 'tool.failed'
  // Agent 이벤트
  | 'agent.delegate'
  | 'agent.delegationResult'
  // Auth 이벤트
  | 'auth.granted'
  | 'auth.revoked'
  // SwarmBundle 이벤트
  | 'swarmBundle.revisionChanged'
  // Workspace 이벤트
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';
```

### 7.2 이벤트 Payload 구조

```ts
/**
 * Turn 시작 이벤트
 */
interface TurnStartedEvent {
  type: 'turn.started';
  turnId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  input: string;
  timestamp: string;
}

/**
 * Turn 완료 이벤트
 */
interface TurnCompletedEvent {
  type: 'turn.completed';
  turnId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  stepCount: number;
  duration: number;
  timestamp: string;
}

/**
 * Step 시작 이벤트
 */
interface StepStartedEvent {
  type: 'step.started';
  stepId: string;
  stepIndex: number;
  turnId: string;
  instanceId: string;
  agentName: string;
  timestamp: string;
}

/**
 * Step 완료 이벤트
 */
interface StepCompletedEvent {
  type: 'step.completed';
  stepId: string;
  stepIndex: number;
  turnId: string;
  instanceId: string;
  agentName: string;
  toolCallCount: number;
  duration: number;
  timestamp: string;
}

/**
 * Tool 호출 이벤트
 */
interface ToolCalledEvent {
  type: 'tool.called';
  toolCallId: string;
  toolName: string;
  stepId: string;
  turnId: string;
  instanceId: string;
  agentName: string;
  timestamp: string;
}

/**
 * Tool 완료 이벤트
 */
interface ToolCompletedEvent {
  type: 'tool.completed';
  toolCallId: string;
  toolName: string;
  status: 'ok' | 'error';
  duration: number;
  stepId: string;
  turnId: string;
  instanceId: string;
  agentName: string;
  timestamp: string;
}

/**
 * Agent 위임 이벤트
 */
interface AgentDelegateEvent {
  type: 'agent.delegate';
  fromAgent: string;
  toAgent: string;
  turnId: string;
  instanceId: string;
  input: string;
  timestamp: string;
}

/**
 * OAuth 승인 완료 이벤트
 */
interface AuthGrantedEvent {
  type: 'auth.granted';
  oauthAppRef: ObjectRefLike;
  subject: string;
  scopes: string[];
  instanceId: string;
  agentName: string;
  timestamp: string;
}

/**
 * SwarmBundle Revision 변경 이벤트
 */
interface SwarmBundleRevisionChangedEvent {
  type: 'swarmBundle.revisionChanged';
  baseRef: string;
  newRef: string;
  changesetId: string;
  changedFiles: string[];
  timestamp: string;
}

/**
 * Workspace Repo 사용 가능 이벤트
 */
interface WorkspaceRepoAvailableEvent {
  type: 'workspace.repoAvailable';
  path: string;
  instanceId: string;
  timestamp: string;
}
```

### 7.3 이벤트 구독 예시

```ts
// Extension에서 이벤트 구독
export async function register(api: ExtensionApi): Promise<void> {
  // Turn 완료 시 통계 수집
  api.events.on('turn.completed', async (payload) => {
    const event = payload as TurnCompletedEvent;
    api.logger?.info?.(
      `Turn ${event.turnId} 완료: ${event.stepCount} steps, ${event.duration}ms`
    );
  });

  // OAuth 승인 완료 시 처리
  api.events.on('auth.granted', async (payload) => {
    const event = payload as AuthGrantedEvent;
    api.logger?.info?.(
      `OAuth 승인 완료: ${event.oauthAppRef} for ${event.subject}`
    );
  });

  // Workspace repo 사용 가능 시 스캔
  api.events.on('workspace.repoAvailable', async (payload) => {
    const event = payload as WorkspaceRepoAvailableEvent;
    await scanRepository(event.path);
  });
}
```

---

## 8. 부록: 전체 타입 참조

### 8.1 Spec 타입 모음

```ts
// Model Spec
interface ModelSpec {
  provider: 'openai' | 'anthropic' | 'google' | string;
  name: string;
  endpoint?: string;
  options?: JsonObject;
  capabilities?: {
    streaming?: boolean;
    toolCalling?: boolean;
    [key: string]: boolean | undefined;
  };
}

// Tool Spec
interface ToolSpec {
  runtime: 'node' | 'deno' | 'python';
  entry: string;
  errorMessageLimit?: number;
  auth?: {
    oauthAppRef: ObjectRefLike;
    scopes?: string[];
  };
  exports: ToolExportSpec[];
}

// Extension Spec
interface ExtensionSpec<Config = JsonObject> {
  runtime: 'node' | 'deno' | 'python';
  entry: string;
  config?: Config;
}

// Agent Spec
interface AgentSpec {
  modelConfig: {
    modelRef: ObjectRefLike;
    params?: {
      temperature?: number;
      maxTokens?: number;
      [key: string]: JsonValue | undefined;
    };
  };
  prompts: {
    system?: string;
    systemRef?: string;
  };
  tools?: ObjectRefLike[];
  extensions?: ObjectRefLike[];
  hooks?: HookSpec[];
  changesets?: {
    allowed?: {
      files?: string[];
    };
  };
}

// Hook Spec
interface HookSpec {
  id?: string;
  point: PipelinePoint;
  priority?: number;
  action: HookAction;
}

// Hook Action (스크립트 실행 기술자)
interface HookAction {
  runtime: 'node' | 'deno' | 'python';
  entry: string;
  export: string;
  input: Record<string, JsonValue | { expr: string }>;
}

// Swarm Spec
interface SwarmSpec {
  entrypoint: ObjectRefLike;
  agents: ObjectRefLike[];
  policy?: {
    maxStepsPerTurn?: number;
    queueMode?: 'serial';
    lifecycle?: {
      autoPauseIdleSeconds?: number;
      ttlSeconds?: number;
      gcGraceSeconds?: number;
    };
    retry?: {
      maxRetries?: number;
      backoffMs?: number;
    };
    timeout?: {
      stepTimeoutMs?: number;
      turnTimeoutMs?: number;
    };
    changesets?: {
      enabled?: boolean;
      applyAt?: string[];
      allowed?: {
        files?: string[];
      };
      emitRevisionChangedEvent?: boolean;
    };
  };
}

// Connector Spec (프로토콜 선언 + 이벤트 스키마)
interface ConnectorSpec {
  runtime: 'node';
  entry: string;
  triggers: TriggerDeclaration[];
  events?: EventSchema[];
}

type TriggerDeclaration =
  | { type: 'http'; endpoint: { path: string; method: string } }
  | { type: 'cron'; schedule: string }
  | { type: 'cli' };

interface EventSchema {
  name: string;
  properties?: Record<string, { type: 'string' | 'number' | 'boolean'; optional?: boolean }>;
}

// Connection Spec (배포 바인딩 정의)
interface ConnectionSpec {
  connectorRef: ObjectRefLike;
  auth?: ConnectorAuth;
  ingress?: {
    rules: IngressRule[];
  };
  verify?: {
    webhook?: {
      signingSecret: ValueSource;
    };
  };
}

// Ingress Rule
interface IngressRule {
  match?: IngressMatch;
  route: IngressRoute;
}

interface IngressMatch {
  event?: string;
  properties?: Record<string, string | number | boolean>;
}

interface IngressRoute {
  agentRef?: ObjectRefLike;
}

// OAuthApp Spec
interface OAuthAppSpec {
  provider: string;
  flow: 'authorizationCode' | 'deviceCode';
  subjectMode: 'global' | 'user';
  client: {
    clientId: ValueSource;
    clientSecret: ValueSource;
  };
  endpoints: {
    authorizationUrl: string;
    tokenUrl: string;
  };
  scopes: string[];
  redirect: {
    callbackPath: string;
  };
  options?: JsonObject;
}

// ValueSource
type ValueSource =
  | { value: string }
  | { valueFrom: { env: string } }
  | { valueFrom: { secretRef: { ref: string; key: string } } };
```

### 8.2 Effective Config 구조

```ts
/**
 * Effective Config
 * 실행 시점에 해석된 최종 Config
 */
interface EffectiveConfig {
  swarm: Resource<SwarmSpec>;
  agents: Map<string, Resource<AgentSpec>>;
  models: Map<string, Resource<ModelSpec>>;
  tools: Map<string, Resource<ToolSpec>>;
  extensions: Map<string, Resource<ExtensionSpec>>;
  connectors: Map<string, Resource<ConnectorSpec>>;
  connections: Map<string, Resource<ConnectionSpec>>;
  oauthApps: Map<string, Resource<OAuthAppSpec>>;
  revision: number;
  swarmBundleRef: string;
}
```

---

## 변경 이력

- v0.12 (2026-02-08): Connector/Connection API 대규모 리팩터링
  - §4.1 ConnectorAdapter 삭제 → ConnectorEntryFunction (단일 default export)
  - §4.2 RuntimeEventInput 리팩터 (swarmRef/instanceKey → connectionRef + ConnectorEvent 기반)
  - §4.3 TriggerHandler/CanonicalEvent 삭제 → ConnectorContext/ConnectorTriggerEvent/ConnectorEvent
  - 부록: ConnectorSpec에서 type 제거, triggers를 프로토콜 선언으로, events 스키마 추가
  - 부록: ConnectionSpec에서 egress 제거, verify에서 provider 제거, IngressMatch를 event/properties로, IngressRoute를 agentRef로 변경
- v0.10 (2026-02-07): 요구사항 정합성 보강
  - CommitChangesetResult에 'conflict' 상태 및 CommitChangesetConflict variant 추가
  - ConnectorSpec에서 auth/ingress/egress 분리, ConnectionSpec 신규 정의
  - EffectiveConfig에 connections 맵 추가
  - HookAction을 스크립트 실행 기술자 형식으로 변경
  - ModelSpec에 capabilities 필드 추가
  - SwarmSpec.policy에 queueMode, lifecycle, retry, timeout 추가
  - Turn에 traceId 필드 추가
  - ToolResult.error에 suggestion, helpUrl 필드 추가
  - ToolCall.arguments → args 필드명 변경
  - ExtensionApi: extState() → getState()/setState() 패턴 변경
  - ExtensionApi: swarmBundle, liveConfig를 선택 속성(?)으로 변경
- v0.9 (2026-02-05): 전체 API 스펙 대폭 보강
  - 공통 타입 상세화 (JsonObject, ObjectRefLike, Resource, LlmMessage)
  - Extension API 전체 인터페이스 상세화
  - Tool API ToolHandler, ToolContext, ToolResult 상세화
  - Connector API TriggerHandler, CanonicalEvent 추가
  - SwarmBundle Changeset API 입출력 상세화
  - OAuth API 전체 variant 문서화
  - Runtime Events 표준 이벤트 타입 추가
- v0.8: 초기 버전
