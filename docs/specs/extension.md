# Goondan Extension 시스템 스펙 (v0.9)

본 문서는 `@docs/requirements/index.md`를 기반으로 Extension 시스템의 **구현 스펙**을 정의한다.

## 목차

1. [개요](#1-개요)
2. [Extension 리소스 스키마](#2-extension-리소스-스키마)
3. [Extension 엔트리포인트](#3-extension-엔트리포인트)
4. [ExtensionApi 인터페이스](#4-extensionapi-인터페이스)
5. [파이프라인 API](#5-파이프라인-api)
6. [Tool 등록 API](#6-tool-등록-api)
7. [이벤트 API](#7-이벤트-api)
8. [SwarmBundle API](#8-swarmbundle-api)
9. [상태 관리](#9-상태-관리)
10. [Extension 로딩과 초기화](#10-extension-로딩과-초기화)
11. [MCP Extension 패턴](#11-mcp-extension-패턴)
12. [Skill Extension 패턴](#12-skill-extension-패턴)

---

## 1. 개요

Extension은 런타임 라이프사이클의 특정 지점에 개입하기 위해 등록되는 실행 로직 묶음이다. Extension은 파이프라인 포인트에 핸들러를 등록하여 다음에 영향을 줄 수 있다.

- **도구 카탈로그**: LLM에 노출되는 도구 목록 조작
- **컨텍스트 블록**: LLM 입력에 포함되는 정보 블록 추가/변경
- **LLM 호출**: 호출 전후 래핑, 재시도, 로깅
- **도구 실행**: 도구 호출 전후 처리, 권한 검사
- **워크스페이스 이벤트**: repo 확보, worktree 마운트 등

Extension은 Tool과 달리 LLM이 직접 호출하지 않으며, 런타임 내부에서 자동으로 실행된다.

---

## 2. Extension 리소스 스키마

### 2.1 기본 구조

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: <확장 이름>
  labels:
    tier: base           # 선택
spec:
  runtime: node          # 필수: 런타임 환경
  entry: "./index.js"    # 필수: 엔트리 모듈 경로 (Bundle Package Root 기준)
  config:                # 선택: 확장별 설정
    <key>: <value>
```

### 2.2 ExtensionSpec 타입 정의

```typescript
interface ExtensionSpec<TConfig = JsonObject> {
  /**
   * 런타임 환경
   * @required
   */
  runtime: 'node';

  /**
   * 엔트리 모듈 경로
   * Bundle Package Root 기준 상대 경로
   * @required
   */
  entry: string;

  /**
   * 확장별 설정
   * Extension 구현에서 자유롭게 정의
   * @optional
   */
  config?: TConfig;
}
```

### 2.3 예시: 기본 Extension

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: compaction
spec:
  runtime: node
  entry: "./extensions/compaction/index.js"
  config:
    maxTokens: 8000
    maxChars: 32000
    enableLogging: true
```

### 2.4 예시: MCP 연동 Extension

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: mcp-github
spec:
  runtime: node
  entry: "./extensions/mcp/index.js"
  config:
    transport:
      type: stdio
      command: ["npx", "-y", "@modelcontextprotocol/server-github"]
    attach:
      mode: stateful
      scope: instance
    expose:
      tools: true
      resources: true
      prompts: true
```

### 2.5 예시: Skill Extension

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: skills
spec:
  runtime: node
  entry: "./extensions/skills/index.js"
  config:
    discovery:
      repoSkillDirs:
        - ".claude/skills"
        - ".agent/skills"
```

---

## 3. Extension 엔트리포인트

### 3.1 register 함수

Extension 모듈은 `register(api)` 함수를 **반드시** 제공해야 한다(MUST).

```typescript
/**
 * Extension 엔트리포인트
 * Runtime은 AgentInstance 초기화 시점에 이 함수를 호출한다.
 *
 * @param api - Extension API 인터페이스
 * @returns Promise<void> 또는 void
 */
export async function register(api: ExtensionApi): Promise<void>;
```

### 3.2 기본 구현 예시

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi, StepContext } from '@goondan/core';

interface MyConfig {
  maxTokens?: number;
  enableLogging?: boolean;
}

interface MyState {
  processedSteps: number;
  lastProcessedAt?: number;
}

export async function register(
  api: ExtensionApi<MyState, MyConfig>
): Promise<void> {
  // 1. 상태 초기화
  const state = api.extState();
  state.processedSteps = 0;

  // 2. 설정 읽기
  const config = api.extension.spec?.config ?? {};
  const maxTokens = config.maxTokens ?? 8000;

  // 3. 파이프라인 등록
  api.pipelines.mutate('step.post', async (ctx: StepContext) => {
    state.processedSteps++;
    state.lastProcessedAt = Date.now();

    if (config.enableLogging) {
      api.logger?.info?.(`Step ${state.processedSteps} completed`);
    }

    return ctx;
  });

  // 4. 이벤트 구독 (선택)
  api.events.on?.('workspace.repoAvailable', async (payload) => {
    api.logger?.info?.(`Repo available: ${payload.path}`);
  });

  // 5. 초기화 완료 이벤트 발행 (선택)
  api.events.emit?.('extension.initialized', {
    name: api.extension.metadata?.name,
    timestamp: Date.now(),
  });
}
```

---

## 4. ExtensionApi 인터페이스

### 4.1 전체 인터페이스

```typescript
interface ExtensionApi<
  TState = JsonObject,
  TConfig = JsonObject
> {
  /**
   * Extension 리소스 정의
   * YAML에 정의된 Extension 리소스 전체
   */
  extension: Resource<ExtensionSpec<TConfig>>;

  /**
   * 파이프라인 등록 API
   * mutate/wrap 메서드로 파이프라인 포인트에 핸들러 등록
   */
  pipelines: PipelineApi;

  /**
   * Tool 등록 API
   * Extension에서 동적으로 Tool을 등록
   */
  tools: ToolRegistryApi;

  /**
   * 이벤트 버스
   * 런타임 이벤트 발행/구독
   */
  events: EventBus;

  /**
   * SwarmBundle Changeset API
   * SwarmBundle 변경 작업 (구현 선택)
   */
  swarmBundle: SwarmBundleApi;

  /**
   * Live Config API
   * 동적 Config 패치 제안
   */
  liveConfig: LiveConfigApi;

  /**
   * OAuth API
   * OAuth 토큰 접근 (Tool의 ctx.oauth와 동일)
   */
  oauth: OAuthApi;

  /**
   * 확장별 상태 저장소
   * Extension 인스턴스별 격리된 상태
   */
  extState: () => TState;

  /**
   * 인스턴스 공유 상태
   * 동일 AgentInstance 내 Extension 간 공유
   */
  instance: {
    shared: JsonObject;
  };

  /**
   * 로거
   * 런타임 로거 인스턴스
   */
  logger?: Console;
}
```

### 4.2 Resource 타입

```typescript
interface Resource<TSpec> {
  apiVersion?: string;
  kind: string;
  metadata?: {
    name: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: TSpec;
}
```

---

## 5. 파이프라인 API

### 5.1 PipelineApi 인터페이스

```typescript
interface PipelineApi {
  /**
   * Mutator 등록
   * 순차 실행으로 컨텍스트를 변형
   *
   * @param point - 파이프라인 포인트
   * @param handler - 변형 핸들러
   */
  mutate<T extends PipelineContext>(
    point: MutatorPoint,
    handler: MutatorHandler<T>
  ): void;

  /**
   * Middleware 등록
   * next() 기반 래핑 (onion 구조)
   *
   * @param point - 파이프라인 포인트
   * @param handler - 미들웨어 핸들러
   */
  wrap<T extends PipelineContext>(
    point: MiddlewarePoint,
    handler: MiddlewareHandler<T>
  ): void;
}
```

### 5.2 파이프라인 포인트

```typescript
/**
 * 모든 파이프라인 포인트
 */
type PipelinePoint =
  // Turn 레벨
  | 'turn.pre'
  | 'turn.post'
  // Step 레벨
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmCall'
  | 'step.llmError'
  | 'step.post'
  // ToolCall 레벨
  | 'toolCall.pre'
  | 'toolCall.exec'
  | 'toolCall.post'
  // Workspace 레벨
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

/**
 * Mutator 포인트
 * 순차 실행으로 컨텍스트 변형
 */
type MutatorPoint =
  | 'turn.pre'
  | 'turn.post'
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.post'
  | 'toolCall.pre'
  | 'toolCall.post'
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

/**
 * Middleware 포인트
 * next() 기반 래핑
 */
type MiddlewarePoint =
  | 'step.llmCall'
  | 'step.llmError'
  | 'toolCall.exec';
```

### 5.3 핸들러 타입

```typescript
/**
 * Mutator 핸들러
 * 컨텍스트를 받아 변형된 컨텍스트를 반환
 */
type MutatorHandler<T extends PipelineContext> = (
  ctx: T
) => Promise<T> | T;

/**
 * Middleware 핸들러
 * 컨텍스트와 next 함수를 받아 결과를 반환
 */
type MiddlewareHandler<T extends PipelineContext> = (
  ctx: T,
  next: (ctx: T) => Promise<T>
) => Promise<T>;
```

### 5.4 컨텍스트 타입

```typescript
interface TurnContext {
  turn: Turn;
  swarm: Resource<SwarmSpec>;
  agent: Resource<AgentSpec>;
  effectiveConfig: EffectiveConfig;
}

interface StepContext extends TurnContext {
  step: Step;
  blocks: ContextBlock[];
  toolCatalog: ToolCatalogItem[];
}

interface ToolCallContext extends StepContext {
  toolCall: ToolCall;
  toolResult?: ToolResult;
}

interface WorkspaceContext {
  path: string;
  type: 'repo' | 'worktree';
  metadata?: JsonObject;
}
```

### 5.5 Mutator 사용 예시

```typescript
// step.blocks: 컨텍스트 블록 추가
api.pipelines.mutate('step.blocks', async (ctx: StepContext) => {
  const blocks = [...ctx.blocks];

  // 커스텀 블록 추가
  blocks.push({
    type: 'custom.info',
    data: {
      timestamp: Date.now(),
      stepIndex: ctx.step?.index,
    },
  });

  return { ...ctx, blocks };
});

// step.tools: 도구 카탈로그 필터링
api.pipelines.mutate('step.tools', async (ctx: StepContext) => {
  const filteredCatalog = ctx.toolCatalog.filter(
    tool => !tool.name.startsWith('internal.')
  );

  return { ...ctx, toolCatalog: filteredCatalog };
});

// turn.pre: Turn 시작 전 메타데이터 설정
api.pipelines.mutate('turn.pre', async (ctx: TurnContext) => {
  ctx.turn.metadata = {
    ...ctx.turn.metadata,
    startTime: Date.now(),
    extensionVersion: '1.0.0',
  };
  return ctx;
});

// turn.post: Turn 종료 후 메트릭 수집
api.pipelines.mutate('turn.post', async (ctx: TurnContext) => {
  const duration = Date.now() - (ctx.turn.metadata?.startTime ?? 0);
  api.logger?.info?.(`Turn completed in ${duration}ms`);
  return ctx;
});
```

### 5.6 Middleware 사용 예시

```typescript
// step.llmCall: LLM 호출 래핑
api.pipelines.wrap('step.llmCall', async (ctx, next) => {
  const startTime = Date.now();

  // 호출 전 로깅
  api.logger?.debug?.('LLM call starting', {
    model: ctx.agent.spec?.modelConfig?.modelRef,
    toolCount: ctx.toolCatalog.length,
  });

  try {
    // 실제 LLM 호출
    const result = await next(ctx);

    // 호출 후 로깅
    const elapsed = Date.now() - startTime;
    api.logger?.debug?.(`LLM call completed in ${elapsed}ms`);

    return result;
  } catch (error) {
    api.logger?.error?.('LLM call failed', error);
    throw error;
  }
});

// toolCall.exec: Tool 실행 래핑
api.pipelines.wrap('toolCall.exec', async (ctx, next) => {
  const toolName = ctx.toolCall?.name;

  // 권한 검사 예시
  if (toolName?.startsWith('admin.') && !ctx.turn?.auth?.actor?.isAdmin) {
    throw new Error(`Permission denied for tool: ${toolName}`);
  }

  try {
    const result = await next(ctx);
    return result;
  } catch (error) {
    api.logger?.error?.(`Tool execution failed: ${toolName}`, error);
    throw error;
  }
});

// step.llmError: LLM 오류 처리
api.pipelines.wrap('step.llmError', async (ctx, next) => {
  // 재시도 전 대기
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 오류 컨텍스트에 재시도 정보 추가
  ctx.step.metadata = {
    ...ctx.step.metadata,
    retryAttempt: (ctx.step.metadata?.retryAttempt ?? 0) + 1,
  };

  return next(ctx);
});
```

### 5.7 실행 순서 규칙

**Mutator 포인트:**
- Extension 등록 순서대로 선형 실행
- 이전 핸들러의 반환값이 다음 핸들러의 입력

**Middleware 포인트:**
- 먼저 등록된 Extension이 더 바깥 레이어 (onion 구조)
- 실행 순서: Ext1.before -> Ext2.before -> Core -> Ext2.after -> Ext1.after

**hooks 합성:**
- 동일 포인트 내 실행 순서는 결정론적으로 재현 가능해야 한다(MUST)
- priority가 있으면 priority 정렬 후 안정 정렬(SHOULD)

---

## 6. Tool 등록 API

### 6.1 ToolRegistryApi 인터페이스

```typescript
interface ToolRegistryApi {
  /**
   * 동적 Tool 등록
   * Extension에서 런타임에 Tool을 등록
   *
   * @param toolDef - Tool 정의
   */
  register(toolDef: DynamicToolDefinition): void;

  /**
   * Tool 등록 해제
   * 이전에 등록한 Tool 제거
   *
   * @param name - Tool 이름
   */
  unregister?(name: string): void;
}
```

### 6.2 DynamicToolDefinition 타입

```typescript
interface DynamicToolDefinition {
  /**
   * Tool 이름
   * LLM이 호출할 때 사용하는 식별자
   * @required
   */
  name: string;

  /**
   * Tool 설명
   * LLM에게 이 도구의 용도를 설명
   * @required
   */
  description: string;

  /**
   * 파라미터 스키마
   * JSON Schema 형식
   * @optional
   */
  parameters?: {
    type: 'object';
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
  };

  /**
   * Tool 핸들러
   * 실제 실행 로직
   * @required
   */
  handler: DynamicToolHandler;

  /**
   * 메타데이터
   * 추가 정보 (source extension 등)
   * @optional
   */
  metadata?: {
    source?: string;
    version?: string;
    [key: string]: JsonValue | undefined;
  };
}

type DynamicToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;
```

### 6.3 동적 Tool 등록 예시

```typescript
export async function register(api: ExtensionApi): Promise<void> {
  // 단순 Tool 등록
  api.tools.register({
    name: 'myExt.echo',
    description: 'Echo the input message',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Message to echo',
        },
      },
      required: ['message'],
    },
    handler: async (ctx, input) => {
      return { echoed: input.message };
    },
    metadata: {
      source: 'myExtension',
      version: '1.0.0',
    },
  });

  // 파라미터 없는 Tool
  api.tools.register({
    name: 'myExt.getStatus',
    description: 'Get current extension status',
    handler: async (ctx) => {
      const state = api.extState();
      return {
        processedSteps: state.processedSteps,
        uptime: Date.now() - state.startTime,
      };
    },
  });

  // 복잡한 파라미터 Tool
  api.tools.register({
    name: 'myExt.search',
    description: 'Search for items matching criteria',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        filters: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            status: { type: 'string', enum: ['active', 'inactive'] },
          },
        },
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
      required: ['query'],
    },
    handler: async (ctx, input) => {
      const query = String(input.query);
      const limit = Number(input.limit) || 10;
      // 검색 로직...
      return { results: [], total: 0 };
    },
  });
}
```

### 6.4 Tool Catalog 노출 규칙

동적으로 등록된 Tool이 LLM에 노출되려면 다음 조건 중 하나를 만족해야 한다.

1. Agent의 `spec.tools`에 해당 Tool 참조가 포함됨
2. `step.tools` 파이프라인에서 toolCatalog에 추가됨
3. LiveConfig 패치로 Tool 참조가 추가됨

---

## 7. 이벤트 API

### 7.1 EventBus 인터페이스

```typescript
interface EventBus {
  /**
   * 이벤트 발행
   *
   * @param type - 이벤트 타입
   * @param payload - 이벤트 페이로드
   */
  emit?(type: string, payload?: JsonObject): void;

  /**
   * 이벤트 구독
   *
   * @param type - 이벤트 타입 (glob 패턴 지원)
   * @param handler - 이벤트 핸들러
   * @returns 구독 해제 함수
   */
  on?(
    type: string,
    handler: (payload: JsonObject) => Promise<void> | void
  ): () => void;

  /**
   * 일회성 이벤트 구독
   *
   * @param type - 이벤트 타입
   * @param handler - 이벤트 핸들러
   */
  once?(
    type: string,
    handler: (payload: JsonObject) => Promise<void> | void
  ): void;
}
```

### 7.2 표준 이벤트 타입

```typescript
/**
 * Workspace 이벤트
 */
interface WorkspaceRepoAvailableEvent {
  type: 'workspace.repoAvailable';
  path: string;
  metadata?: {
    remote?: string;
    branch?: string;
  };
}

interface WorkspaceWorktreeMountedEvent {
  type: 'workspace.worktreeMounted';
  path: string;
  changesetId?: string;
}

/**
 * Auth 이벤트
 */
interface AuthGrantedEvent {
  type: 'auth.granted';
  oauthAppRef: ObjectRef;
  subject: string;
  scopes: string[];
}

/**
 * Agent 이벤트
 */
interface AgentDelegateEvent {
  type: 'agent.delegate';
  targetAgent: string;
  input: string;
  metadata?: JsonObject;
}

interface AgentDelegationResultEvent {
  type: 'agent.delegationResult';
  sourceAgent: string;
  result: JsonValue;
}
```

### 7.3 이벤트 사용 예시

```typescript
export async function register(api: ExtensionApi): Promise<void> {
  // 이벤트 구독
  api.events.on?.('workspace.repoAvailable', async (payload) => {
    const { path, metadata } = payload;
    api.logger?.info?.(`Repo available at ${path}`);

    // repo 스캔, 인덱싱 등
    await scanRepository(path);
  });

  // glob 패턴으로 구독
  api.events.on?.('workspace.*', async (payload) => {
    api.logger?.debug?.('Workspace event:', payload);
  });

  // 일회성 구독
  api.events.once?.('auth.granted', async (payload) => {
    api.logger?.info?.('OAuth granted:', payload.oauthAppRef);
  });

  // 이벤트 발행
  api.events.emit?.('myExtension.initialized', {
    name: api.extension.metadata?.name,
    timestamp: Date.now(),
    config: api.extension.spec?.config,
  });
}
```

---

## 8. SwarmBundle API

### 8.1 SwarmBundleApi 인터페이스

```typescript
interface SwarmBundleApi {
  /**
   * Changeset 열기
   * Git worktree를 생성하고 workdir 경로 반환
   *
   * @param input - 옵션 (reason 등)
   * @returns Changeset 정보
   */
  openChangeset(input?: {
    reason?: string;
  }): Promise<OpenChangesetResult> | OpenChangesetResult;

  /**
   * Changeset 커밋
   * workdir 변경사항을 Git commit으로 생성
   *
   * @param input - changesetId와 커밋 메시지
   * @returns 커밋 결과
   */
  commitChangeset(input: {
    changesetId: string;
    message?: string;
  }): Promise<CommitChangesetResult> | CommitChangesetResult;
}
```

### 8.2 결과 타입

```typescript
interface OpenChangesetResult {
  changesetId: string;
  baseRef: string;
  workdir: string;
  hint?: {
    bundleRootInWorkdir: string;
    recommendedFiles: string[];
  };
}

interface CommitChangesetResult {
  status: 'ok' | 'rejected' | 'failed';
  changesetId: string;
  baseRef: string;
  newRef?: string;           // status=ok인 경우
  summary?: {
    filesChanged: string[];
    filesAdded: string[];
    filesDeleted: string[];
  };
  error?: {                  // status=rejected|failed인 경우
    code: string;
    message: string;
  };
}
```

### 8.3 SwarmBundle 변경 예시

```typescript
export async function register(api: ExtensionApi): Promise<void> {
  api.tools.register({
    name: 'myExt.updatePrompt',
    description: 'Update agent system prompt',
    parameters: {
      type: 'object',
      properties: {
        newPrompt: { type: 'string' },
      },
      required: ['newPrompt'],
    },
    handler: async (ctx, input) => {
      // 1. Changeset 열기
      const { changesetId, workdir } = await api.swarmBundle.openChangeset({
        reason: 'Update system prompt via myExt',
      });

      // 2. 파일 수정
      const fs = await import('fs/promises');
      const path = await import('path');
      const promptPath = path.join(workdir, 'prompts', 'system.md');
      await fs.writeFile(promptPath, String(input.newPrompt), 'utf8');

      // 3. Changeset 커밋
      const result = await api.swarmBundle.commitChangeset({
        changesetId,
        message: 'chore: update system prompt',
      });

      if (result.status === 'ok') {
        return {
          success: true,
          newRef: result.newRef,
          message: 'Prompt updated. Changes will apply from next Step.',
        };
      } else {
        return {
          success: false,
          error: result.error,
        };
      }
    },
  });
}
```

---

## 9. 상태 관리

### 9.1 확장별 상태 (extState)

각 Extension 인스턴스는 격리된 상태 저장소를 가진다.

```typescript
interface ExtensionApi<TState = JsonObject> {
  /**
   * 확장별 상태 저장소 반환
   * 동일 Extension 인스턴스 내에서 상태 유지
   * AgentInstance 생명주기와 함께 유지됨
   */
  extState(): TState;
}
```

**특징:**
- Extension 인스턴스별 격리 (다른 Extension과 공유되지 않음)
- AgentInstance 생명주기와 함께 유지
- 메모리 기반 (재시작 시 초기화)

**사용 예시:**

```typescript
interface MyState {
  processedSteps: number;
  catalog: SkillItem[];
  lastUpdated: number;
}

export async function register(
  api: ExtensionApi<MyState>
): Promise<void> {
  const state = api.extState();

  // 초기화
  state.processedSteps = 0;
  state.catalog = [];
  state.lastUpdated = Date.now();

  // 파이프라인에서 상태 접근
  api.pipelines.mutate('step.post', async (ctx) => {
    state.processedSteps++;
    state.lastUpdated = Date.now();
    return ctx;
  });

  // Tool에서 상태 접근
  api.tools.register({
    name: 'myExt.getStats',
    description: 'Get extension statistics',
    handler: async () => ({
      processedSteps: state.processedSteps,
      catalogSize: state.catalog.length,
      lastUpdated: state.lastUpdated,
    }),
  });
}
```

### 9.2 인스턴스 공유 상태 (instance.shared)

동일 AgentInstance 내 Extension 간 상태 공유가 필요한 경우 사용한다.

```typescript
interface ExtensionApi {
  instance: {
    /**
     * 인스턴스 공유 상태
     * 동일 AgentInstance 내 모든 Extension이 접근 가능
     */
    shared: JsonObject;
  };
}
```

**특징:**
- 동일 AgentInstance 내 모든 Extension이 접근 가능
- 키 충돌 방지를 위해 네임스페이스 사용 권장
- AgentInstance 생명주기와 함께 유지

**사용 예시:**

```typescript
export async function register(api: ExtensionApi): Promise<void> {
  const extName = api.extension.metadata?.name ?? 'unknown';

  // 네임스페이스로 키 충돌 방지
  const sharedKey = `${extName}:data`;

  api.instance.shared[sharedKey] = {
    initialized: true,
    version: '1.0.0',
  };

  // 다른 Extension의 데이터 읽기 (주의: 존재 여부 확인 필요)
  api.pipelines.mutate('step.pre', async (ctx) => {
    const otherExtData = api.instance.shared['otherExt:data'];
    if (otherExtData) {
      api.logger?.debug?.('Other extension data:', otherExtData);
    }
    return ctx;
  });
}
```

### 9.3 영속 상태

메모리 기반 상태 외에 영속 저장이 필요한 경우, Extension은 직접 파일시스템이나 외부 저장소를 사용해야 한다.

```typescript
export async function register(api: ExtensionApi): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  // 상태 파일 경로 (권장: System State Root 활용)
  const stateDir = process.env.GOONDAN_STATE_ROOT || '~/.goondan';
  const stateFile = path.join(
    stateDir,
    'extensions',
    api.extension.metadata?.name ?? 'unknown',
    'state.json'
  );

  // 상태 로드
  let persistedState: JsonObject = {};
  try {
    const content = await fs.readFile(stateFile, 'utf8');
    persistedState = JSON.parse(content);
  } catch {
    // 파일 없음 - 초기 상태 사용
  }

  // 상태 저장 함수
  async function saveState() {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(persistedState, null, 2));
  }

  // Turn 종료 시 상태 저장
  api.pipelines.mutate('turn.post', async (ctx) => {
    persistedState.lastTurnAt = Date.now();
    await saveState();
    return ctx;
  });
}
```

---

## 10. Extension 로딩과 초기화

### 10.1 로딩 순서

Runtime은 AgentInstance 초기화 시점에 다음 순서로 Extension을 로드한다.

1. Agent의 `spec.extensions` 배열 순서대로 Extension 리소스 해석
2. 각 Extension의 entry 모듈 로드
3. `register(api)` 함수 순차 호출
4. 파이프라인/Tool/이벤트 핸들러 등록 완료

```typescript
// Agent.spec.extensions 순서대로 로드
extensions:
  - { kind: Extension, name: compaction }    // 1번째
  - { kind: Extension, name: skills }        // 2번째
  - { kind: Extension, name: mcp-github }    // 3번째
```

### 10.2 초기화 규칙

**MUST:**
- Runtime은 `register(api)` 반환(또는 Promise resolve)을 대기해야 한다
- 이전 Extension의 register 완료 후 다음 Extension register 호출
- register 중 발생한 예외는 AgentInstance 초기화 실패로 처리

**SHOULD:**
- Extension 로드 실패 시 상세 오류 메시지 로깅
- 순환 의존성 감지 및 경고

### 10.3 Reconcile 규칙

Runtime은 step.config 이후 reconcile 단계에서 Extension 배열을 identity 기반으로 비교해야 한다(MUST).

**Identity Key 정의:**
```typescript
// ExtensionRef identity: "{kind}/{name}"
const extensionIdentity = `${ref.kind}/${ref.name}`;
```

**Reconcile 알고리즘 요구사항:**
- 동일 identity key가 Effective Config에 계속 존재하는 한, 실행 상태 유지
- 배열의 순서 변경은 연결/상태 재생성의 원인이 되어서는 안 됨

### 10.4 정리(Cleanup)

Extension이 리소스 정리가 필요한 경우, 다음 패턴을 권장한다.

```typescript
export async function register(api: ExtensionApi): Promise<void> {
  // 리소스 할당
  const connection = await createConnection();

  // cleanup 이벤트 구독 (구현에 따라 제공)
  api.events.on?.('extension.cleanup', async () => {
    await connection.close();
  });

  // 또는 process 이벤트 활용
  process.on('beforeExit', async () => {
    await connection.close();
  });
}
```

---

## 11. MCP Extension 패턴

MCP(Model Context Protocol) 연동은 Extension 패턴으로 구현된다. MCP Extension은 외부 MCP 서버와 통신하여 도구/리소스/프롬프트를 제공한다.

### 11.1 MCP Extension Config 스키마

```typescript
interface MCPExtensionConfig {
  /**
   * Transport 설정
   * MCP 서버와의 통신 방식
   */
  transport: MCPTransportConfig;

  /**
   * Attach 설정
   * 연결 생명주기 관리
   */
  attach: MCPAttachConfig;

  /**
   * Expose 설정
   * 노출할 기능 선택
   */
  expose: MCPExposeConfig;
}

interface MCPTransportConfig {
  /**
   * Transport 타입
   * stdio: 자식 프로세스로 MCP 서버 실행
   * http: HTTP 엔드포인트로 MCP 서버 연결
   */
  type: 'stdio' | 'http';

  // stdio 전용
  command?: string[];        // 실행 명령어
  env?: Record<string, string>;  // 환경 변수

  // http 전용
  endpoint?: string;         // HTTP 엔드포인트 URL
  headers?: Record<string, string>;  // HTTP 헤더
}

interface MCPAttachConfig {
  /**
   * 연결 모드
   * stateful: 연결 유지 (프로세스/세션 지속)
   * stateless: 요청별 연결
   */
  mode: 'stateful' | 'stateless';

  /**
   * 연결 스코프
   * instance: SwarmInstance별 1개 연결
   * agent: AgentInstance별 1개 연결
   */
  scope: 'instance' | 'agent';
}

interface MCPExposeConfig {
  /**
   * MCP 도구 노출 여부
   */
  tools?: boolean;

  /**
   * MCP 리소스 노출 여부
   */
  resources?: boolean;

  /**
   * MCP 프롬프트 노출 여부
   */
  prompts?: boolean;
}
```

### 11.2 MCP Extension YAML 예시

```yaml
# stdio transport
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: mcp-github
spec:
  runtime: node
  entry: "./extensions/mcp/index.js"
  config:
    transport:
      type: stdio
      command:
        - "npx"
        - "-y"
        - "@modelcontextprotocol/server-github"
      env:
        GITHUB_TOKEN: "${GITHUB_TOKEN}"
    attach:
      mode: stateful
      scope: instance
    expose:
      tools: true
      resources: true
      prompts: true

---
# http transport
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: mcp-custom-api
spec:
  runtime: node
  entry: "./extensions/mcp/index.js"
  config:
    transport:
      type: http
      endpoint: "http://localhost:8080/mcp"
      headers:
        Authorization: "Bearer ${API_TOKEN}"
    attach:
      mode: stateless
      scope: agent
    expose:
      tools: true
      resources: false
      prompts: false
```

### 11.3 MCP Extension 구현 예시

```typescript
// extensions/mcp/index.ts
import type { ExtensionApi, StepContext } from '@goondan/core';
import { spawn, type ChildProcess } from 'child_process';

interface MCPConfig {
  transport: {
    type: 'stdio' | 'http';
    command?: string[];
    env?: Record<string, string>;
    endpoint?: string;
    headers?: Record<string, string>;
  };
  attach: {
    mode: 'stateful' | 'stateless';
    scope: 'instance' | 'agent';
  };
  expose: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

interface MCPState {
  process?: ChildProcess;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  connected: boolean;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
}

interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: JsonObject[];
}

export async function register(
  api: ExtensionApi<MCPState, MCPConfig>
): Promise<void> {
  const state = api.extState();
  const config = api.extension.spec?.config;

  if (!config) {
    api.logger?.warn?.('MCP Extension: config is missing');
    return;
  }

  state.tools = [];
  state.resources = [];
  state.prompts = [];
  state.connected = false;

  // Stateful 모드: 초기화 시 연결
  if (config.attach.mode === 'stateful') {
    await connect(config, state, api.logger);
  }

  // MCP 도구를 Tool Catalog에 추가
  if (config.expose.tools) {
    api.pipelines.mutate('step.tools', async (ctx: StepContext) => {
      // Stateless 모드: 매 Step마다 연결/해제
      if (config.attach.mode === 'stateless') {
        await connect(config, state, api.logger);
      }

      const mcpTools = state.tools.map(tool => ({
        name: `mcp.${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema,
        source: { type: 'mcp', extension: api.extension.metadata?.name },
      }));

      return {
        ...ctx,
        toolCatalog: [...ctx.toolCatalog, ...mcpTools],
      };
    });
  }

  // MCP 리소스를 컨텍스트 블록에 추가
  if (config.expose.resources) {
    api.pipelines.mutate('step.blocks', async (ctx: StepContext) => {
      if (state.resources.length > 0) {
        const blocks = [...ctx.blocks];
        blocks.push({
          type: 'mcp.resources',
          items: state.resources,
          source: api.extension.metadata?.name,
        });
        return { ...ctx, blocks };
      }
      return ctx;
    });
  }

  // MCP 도구 핸들러 등록
  for (const tool of state.tools) {
    api.tools.register({
      name: `mcp.${tool.name}`,
      description: tool.description,
      parameters: tool.inputSchema,
      handler: async (ctx, input) => {
        return await invokeMCPTool(state, tool.name, input, api.logger);
      },
      metadata: {
        source: 'mcp',
        mcpServer: api.extension.metadata?.name,
      },
    });
  }

  // Cleanup 이벤트 처리
  api.events.on?.('extension.cleanup', async () => {
    if (state.process) {
      state.process.kill();
      state.connected = false;
    }
  });
}

async function connect(
  config: MCPConfig,
  state: MCPState,
  logger?: Console
): Promise<void> {
  if (config.transport.type === 'stdio') {
    await connectStdio(config, state, logger);
  } else if (config.transport.type === 'http') {
    await connectHttp(config, state, logger);
  }
}

async function connectStdio(
  config: MCPConfig,
  state: MCPState,
  logger?: Console
): Promise<void> {
  const command = config.transport.command;
  if (!command || command.length === 0) {
    throw new Error('MCP stdio transport requires command');
  }

  const [cmd, ...args] = command;
  const proc = spawn(cmd, args, {
    env: { ...process.env, ...config.transport.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  state.process = proc;
  state.connected = true;

  // MCP 프로토콜 초기화 및 도구 목록 조회
  // (실제 구현에서는 MCP JSON-RPC 프로토콜 사용)
  const tools = await listMCPTools(proc);
  state.tools = tools;

  if (config.expose.resources) {
    const resources = await listMCPResources(proc);
    state.resources = resources;
  }

  if (config.expose.prompts) {
    const prompts = await listMCPPrompts(proc);
    state.prompts = prompts;
  }

  logger?.info?.(`MCP connected: ${command.join(' ')}`);
}

async function connectHttp(
  config: MCPConfig,
  state: MCPState,
  logger?: Console
): Promise<void> {
  const endpoint = config.transport.endpoint;
  if (!endpoint) {
    throw new Error('MCP http transport requires endpoint');
  }

  // HTTP 엔드포인트에서 도구 목록 조회
  const response = await fetch(`${endpoint}/tools/list`, {
    headers: config.transport.headers,
  });
  const data = await response.json();
  state.tools = data.tools || [];
  state.connected = true;

  logger?.info?.(`MCP HTTP connected: ${endpoint}`);
}

async function listMCPTools(proc: ChildProcess): Promise<MCPTool[]> {
  // MCP JSON-RPC: tools/list 호출
  // 실제 구현 필요
  return [];
}

async function listMCPResources(proc: ChildProcess): Promise<MCPResource[]> {
  // MCP JSON-RPC: resources/list 호출
  return [];
}

async function listMCPPrompts(proc: ChildProcess): Promise<MCPPrompt[]> {
  // MCP JSON-RPC: prompts/list 호출
  return [];
}

async function invokeMCPTool(
  state: MCPState,
  toolName: string,
  input: JsonObject,
  logger?: Console
): Promise<JsonValue> {
  // MCP JSON-RPC: tools/call 호출
  // 실제 구현 필요
  logger?.debug?.(`MCP tool call: ${toolName}`, input);
  return { status: 'not_implemented' };
}
```

### 11.4 Stateful MCP 연결 유지 규칙

- `config.attach.mode=stateful`인 MCP Extension은 동일 identity key로 Effective Config에 유지되는 동안 연결(프로세스/세션)을 유지해야 한다(MUST)
- Runtime이 stateful MCP 연결을 재연결할 수 있는 경우는 다음에 한정된다(MUST):
  - 해당 MCP Extension이 Effective Config에서 제거된 경우
  - 해당 Extension의 연결 구성(transport/attach/expose 등)이 변경되어 연결 호환성이 깨진 경우

---

## 12. Skill Extension 패턴

Skill Extension은 SKILL.md 기반 파일 번들을 발견/카탈로그화/실행하는 Extension 패턴이다.

### 12.1 Skill Extension Config 스키마

```typescript
interface SkillExtensionConfig {
  /**
   * Skill 발견 설정
   */
  discovery: {
    /**
     * Skill 디렉터리 목록
     * repo root 기준 상대 경로
     */
    repoSkillDirs: string[];
  };

  /**
   * 자동 스캔 설정
   */
  autoScan?: {
    /**
     * workspace.repoAvailable 이벤트 시 자동 스캔
     */
    onRepoAvailable?: boolean;

    /**
     * 초기화 시 스캔
     */
    onInit?: boolean;
  };
}
```

### 12.2 Skill Extension YAML 예시

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: skills
spec:
  runtime: node
  entry: "./extensions/skills/index.js"
  config:
    discovery:
      repoSkillDirs:
        - ".claude/skills"
        - ".agent/skills"
        - "skills"
    autoScan:
      onRepoAvailable: true
      onInit: true
```

### 12.3 Skill 디렉터리 구조

```
.claude/skills/
├── deploy/
│   ├── SKILL.md          # Skill 설명 및 사용법
│   ├── deploy.sh         # 실행 스크립트
│   └── config.yaml       # 설정 파일
├── test/
│   ├── SKILL.md
│   └── run-tests.sh
└── refactor/
    ├── SKILL.md
    └── refactor.py
```

### 12.4 SKILL.md 형식

```markdown
# Deploy to Production

Production 환경에 애플리케이션을 배포합니다.

## 사용법

```bash
./deploy.sh [environment] [version]
```

## 파라미터

- `environment`: 배포 환경 (staging, production)
- `version`: 배포할 버전 태그

## 예시

```bash
./deploy.sh production v1.2.3
```

## 주의사항

- Production 배포 전 staging에서 테스트 필수
- 배포 시간: 약 5-10분 소요
```

### 12.5 Skill Extension 구현 예시

```typescript
// extensions/skills/index.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import type { ExtensionApi, StepContext } from '@goondan/core';

interface SkillConfig {
  discovery: {
    repoSkillDirs: string[];
  };
  autoScan?: {
    onRepoAvailable?: boolean;
    onInit?: boolean;
  };
}

interface SkillItem {
  name: string;
  path: string;
  dir: string;
  description: string;
  content?: string;
}

interface SkillState {
  catalog: SkillItem[];
  rootDir: string;
  openedSkills: Map<string, string>;  // name -> content
}

export async function register(
  api: ExtensionApi<SkillState, SkillConfig>
): Promise<void> {
  const state = api.extState();
  const config = api.extension.spec?.config;

  if (!config) {
    api.logger?.warn?.('Skills Extension: config is missing');
    return;
  }

  const skillDirs = config.discovery.repoSkillDirs || ['.claude/skills'];

  state.catalog = [];
  state.rootDir = process.cwd();
  state.openedSkills = new Map();

  // 초기화 시 스캔
  if (config.autoScan?.onInit !== false) {
    state.catalog = await scanSkills(state.rootDir, skillDirs, api.logger);
  }

  // workspace.repoAvailable 이벤트 시 재스캔
  if (config.autoScan?.onRepoAvailable !== false) {
    api.events.on?.('workspace.repoAvailable', async (payload) => {
      const repoPath = payload.path || state.rootDir;
      state.rootDir = repoPath;
      state.catalog = await scanSkills(repoPath, skillDirs, api.logger);
      api.logger?.info?.(`Skills rescanned: ${state.catalog.length} found`);
    });
  }

  // 컨텍스트 블록에 스킬 카탈로그 추가
  api.pipelines.mutate('step.blocks', async (ctx: StepContext) => {
    const blocks = [...ctx.blocks];

    // 스킬 카탈로그 블록
    if (state.catalog.length > 0) {
      blocks.push({
        type: 'skills.catalog',
        items: state.catalog.map(s => ({
          name: s.name,
          description: s.description,
        })),
      });
    }

    // 열린 스킬 내용 블록
    for (const [name, content] of state.openedSkills) {
      blocks.push({
        type: 'skills.open',
        name,
        content,
      });
    }

    return { ...ctx, blocks };
  });

  // skills.list Tool
  api.tools.register({
    name: 'skills.list',
    description: 'List all available skills with their descriptions',
    handler: async () => ({
      items: state.catalog.map(s => ({
        name: s.name,
        description: s.description,
        path: s.path,
      })),
      total: state.catalog.length,
    }),
  });

  // skills.open Tool
  api.tools.register({
    name: 'skills.open',
    description: 'Open a skill to read its full SKILL.md content and get the skill directory path',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the skill to open',
        },
      },
      required: ['name'],
    },
    handler: async (ctx, input) => {
      const name = String(input.name);
      const skill = state.catalog.find(s => s.name === name);

      if (!skill) {
        throw new Error(`Skill not found: ${name}`);
      }

      // SKILL.md 전체 내용 읽기
      const content = await fs.readFile(skill.path, 'utf8');

      // 열린 스킬 목록에 추가 (다음 Step 블록에 포함됨)
      state.openedSkills.set(name, content);

      return {
        name: skill.name,
        path: skill.path,
        dir: skill.dir,
        content,
        hint: 'Use skills.run to execute scripts in the skill directory',
      };
    },
  });

  // skills.close Tool
  api.tools.register({
    name: 'skills.close',
    description: 'Close an opened skill (remove from context)',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the skill to close',
        },
      },
      required: ['name'],
    },
    handler: async (ctx, input) => {
      const name = String(input.name);
      const removed = state.openedSkills.delete(name);
      return { closed: removed, name };
    },
  });

  // skills.run Tool
  api.tools.register({
    name: 'skills.run',
    description: 'Run a command in the skill directory',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the skill',
        },
        command: {
          type: 'string',
          description: 'Command to run (e.g., "./deploy.sh production")',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 60000)',
        },
      },
      required: ['name', 'command'],
    },
    handler: async (ctx, input) => {
      const name = String(input.name);
      const command = String(input.command);
      const args = Array.isArray(input.args)
        ? input.args.map(String)
        : [];
      const timeout = Number(input.timeout) || 60000;

      const skill = state.catalog.find(s => s.name === name);
      if (!skill) {
        throw new Error(`Skill not found: ${name}`);
      }

      return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
          cwd: skill.dir,
          shell: true,
          timeout,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (d) => { stdout += d; });
        proc.stderr?.on('data', (d) => { stderr += d; });

        proc.on('error', (err) => {
          reject(new Error(`Failed to run command: ${err.message}`));
        });

        proc.on('close', (code) => {
          resolve({
            code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            skill: name,
            command,
            args,
          });
        });
      });
    },
  });
}

async function scanSkills(
  rootDir: string,
  dirs: string[],
  logger?: Console
): Promise<SkillItem[]> {
  const items: SkillItem[] = [];

  for (const dir of dirs) {
    const skillRoot = path.join(rootDir, dir);

    try {
      const entries = await fs.readdir(skillRoot, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(skillRoot, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        try {
          const content = await fs.readFile(skillMdPath, 'utf8');
          const firstLine = content.split('\n')[0] || '';
          const description = firstLine.replace(/^#\s*/, '').trim();

          items.push({
            name: entry.name,
            path: skillMdPath,
            dir: skillDir,
            description: description || `Skill: ${entry.name}`,
          });

          logger?.debug?.(`Skill found: ${entry.name}`);
        } catch {
          // SKILL.md 없음 - 스킵
        }
      }
    } catch {
      // 디렉터리 없음 - 스킵
      logger?.debug?.(`Skill directory not found: ${skillRoot}`);
    }
  }

  return items;
}
```

### 12.6 Skill Extension 동작 요약

1. **발견(Discovery)**: 지정된 디렉터리에서 SKILL.md가 있는 폴더 스캔
2. **카탈로그화**: 스캔된 스킬을 `skills.catalog` 블록으로 LLM에 노출
3. **열기(Open)**: `skills.open` 도구로 SKILL.md 전체 내용과 경로 제공
4. **실행(Run)**: `skills.run` 도구로 스킬 디렉터리에서 명령 실행
5. **재스캔**: `workspace.repoAvailable` 이벤트 시 자동 재스캔

---

## 부록: 타입 정의 요약

```typescript
// JSON 타입
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

// 리소스 참조
type ObjectRef = { kind: string; name: string };
type ObjectRefLike = string | ObjectRef;

// Extension 등록 함수
type RegisterFunction<TState, TConfig> = (
  api: ExtensionApi<TState, TConfig>
) => Promise<void> | void;

// 컨텍스트 블록
interface ContextBlock {
  type: string;
  [key: string]: JsonValue;
}

// Tool Catalog Item
interface ToolCatalogItem {
  name: string;
  description?: string;
  parameters?: JsonObject;
  tool?: Resource<ToolSpec>;
  export?: ToolExportSpec;
  source?: JsonObject;
}
```

---

## 관련 문서

- @docs/requirements/05_core-concepts.md - Extension 핵심 개념
- @docs/requirements/07_config-resources.md - Extension 리소스 스키마
- @docs/requirements/11_lifecycle-pipelines.md - 파이프라인 스펙
- @docs/requirements/13_extension-interface.md - Extension 실행 인터페이스
- @docs/specs/api.md - Runtime/SDK API 스펙
