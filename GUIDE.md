# Goondan: Agent Swarm Orchestrator 가이드

> "Kubernetes for Agent Swarm"

이 문서는 Goondan 시스템을 처음 접하는 개발자가 바로 이해하고 실전 개발을 시작할 수 있도록 작성되었습니다.

---

## 목차

1. [Goondan이란?](#1-goondan이란)
2. [핵심 개념](#2-핵심-개념)
3. [빠른 시작](#3-빠른-시작)
4. [Config 작성법](#4-config-작성법)
5. [Tool 개발](#5-tool-개발)
6. [Extension 개발](#6-extension-개발)
7. [Connector 개발](#7-connector-개발)
8. [Bundle Package 패키징](#8-bundle-package-패키징)
9. [CLI 활용](#9-cli-활용)
10. [고급 주제](#10-고급-주제)

---

## 1. Goondan이란?

Goondan은 **멀티 에이전트 스웜(Swarm)을 선언형으로 정의하고 실행**하는 오케스트레이터입니다.

### 1.1 왜 Goondan인가?

AI 에이전트 개발에서 겪는 문제들:

| 문제 | Goondan의 해결책 |
|------|------------------|
| 에이전트 구성 복잡성 | **선언형 YAML**로 모델, 프롬프트, 도구, 확장 조합 |
| 라이프사이클 관리 | **Turn/Step 추상화**와 파이프라인 훅 |
| 상태 유지 (Long-running) | **SwarmInstance/AgentInstance** 모델 |
| 다양한 입력 채널 | **Connector** 추상화 (Slack, CLI, GitHub 등) |
| 구성 재사용 | **Bundle Package** 시스템으로 확장 패키징 |

### 1.2 핵심 철학

```
"Kubernetes가 컨테이너 워크로드를 오케스트레이션하듯,
 Goondan은 에이전트 스웜을 오케스트레이션한다."
```

- **Config Plane**: YAML로 선언한 리소스 정의
- **Runtime Plane**: 상태를 유지하며 실행하는 인스턴스
- **Live Config**: 실행 중 동적으로 변경되는 설정

---

## 2. 핵심 개념

### 2.1 리소스 계층

```
┌─────────────────────────────────────────────────────────┐
│                      Swarm                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │                    Agent                         │   │
│  │  ┌─────────┐  ┌───────────┐  ┌──────────────┐  │   │
│  │  │  Model  │  │   Tools   │  │  Extensions  │  │   │
│  │  └─────────┘  └───────────┘  └──────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  Connector                       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

| 리소스 | 역할 |
|--------|------|
| **Model** | LLM 모델 설정 (provider, name, params) |
| **Tool** | LLM이 호출할 수 있는 함수 |
| **Extension** | 라이프사이클에 개입하는 확장 로직 |
| **Agent** | Model + Prompt + Tools + Extensions 조합 |
| **Swarm** | Agent들의 집합과 실행 정책 |
| **Connector** | 외부 입력을 받아 Swarm으로 라우팅 |

### 2.2 Bundle / SwarmBundle / Bundle Package

- **Bundle**: YAML 리소스 + 코드(프롬프트/툴/확장/커넥터)를 함께 담는 폴더 트리(구성+코드).
- **SwarmBundle**: Swarm 정의를 담는 Bundle. 런타임에서는 Changeset → SwarmRevision으로 변경이 안전하게 반영됨.
- **Bundle Package**: Bundle을 Git 기반으로 배포/의존성 해석하는 패키징 단위(기존 “Bundle”). `bundle.yaml`의 `kind: Bundle` 표기는 하위 호환을 위해 유지됨.

### 2.3 실행 모델: Instance → Turn → Step

```
[외부 이벤트 (Slack, CLI, ...)]
          │
          ▼
    SwarmInstance (instanceKey로 식별)
          │
          ▼
    AgentInstance (이벤트 큐 보유)
          │
          ▼
    ┌─────────────────────────────┐
    │          Turn               │  ← 하나의 입력 이벤트 처리
    │  ┌─────────────────────┐   │
    │  │       Step 0        │   │  ← LLM 호출 1회
    │  │  (LLM → tool call)  │   │
    │  └─────────────────────┘   │
    │  ┌─────────────────────┐   │
    │  │       Step 1        │   │
    │  │  (LLM → response)   │   │
    │  └─────────────────────┘   │
    └─────────────────────────────┘
```

- **Turn**: 하나의 입력을 처리하는 단위
- **Step**: LLM 호출 1회 + tool call 처리
- **messages**: Turn 내에서 누적되는 대화 기록

### 2.4 파이프라인 포인트

Extension이 개입할 수 있는 지점:

```
Turn: turn.pre → turn.post
Step: step.pre → step.config → step.tools → step.blocks → step.llmCall → step.post
ToolCall: toolCall.pre → toolCall.exec → toolCall.post
Workspace: workspace.repoAvailable, workspace.worktreeMounted
```

---

## 3. 빠른 시작

### 3.1 설치

```bash
# 패키지 설치
pnpm add @goondan/core

# 또는 전역 CLI
npm install -g @goondan/core
```

### 3.2 프로젝트 초기화

```bash
# 현재 디렉터리에 goondan.yaml 생성
goondan init
```

생성되는 `goondan.yaml`:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

---
kind: Agent
metadata:
  name: default
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    system: |
      너는 Goondan default 에이전트다.
      사용자의 요청에 도움이 되도록 응답하라.
  tools:
    - { kind: Tool, name: fileRead }
  extensions:
    - { kind: Extension, name: compaction }

---
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: default }
  agents:
    - { kind: Agent, name: default }
  policy:
    maxStepsPerTurn: 8

---
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  ingress: []
```

### 3.3 실행

```bash
# 환경 변수 설정 (LLM API 키)
export ANTHROPIC_API_KEY="sk-ant-..."

# 실행
goondan run
```

대화형 CLI가 시작됩니다:

```
> 현재 디렉터리의 파일 목록을 보여줘
[에이전트가 fileRead 도구를 사용하여 응답]
```

---

## 4. Config 작성법

### 4.1 리소스 기본 구조

모든 리소스는 다음 형식을 따릅니다:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: <리소스 종류>
metadata:
  name: <고유 이름>
  labels:            # 선택
    tier: base
spec:
  # 리소스별 설정
```

### 4.2 Model 정의

```yaml
kind: Model
metadata:
  name: gpt-5
spec:
  provider: openai          # openai | anthropic | google
  name: gpt-5.2             # 모델 이름
  endpoint: "https://..."   # 선택: 커스텀 엔드포인트
  options: {}               # 선택: provider별 옵션
```

지원 provider:
- `openai` → `@ai-sdk/openai`
- `anthropic` → `@ai-sdk/anthropic`
- `google` → `@ai-sdk/google`

### 4.3 Agent 정의

```yaml
kind: Agent
metadata:
  name: planner
spec:
  # 모델 설정
  modelConfig:
    modelRef: { kind: Model, name: gpt-5 }
    params:
      temperature: 0.7
      maxTokens: 4096

  # 프롬프트 (인라인 또는 파일 참조)
  prompts:
    system: |
      너는 planner 에이전트다.
    # 또는
    # systemRef: "./prompts/planner.system.md"

  # 도구 목록
  tools:
    - { kind: Tool, name: fileRead }
    - { kind: Tool, name: webSearch }

  # 확장 목록
  extensions:
    - { kind: Extension, name: compaction }
    - { kind: Extension, name: skills }

  # MCP 서버 (선택)
  mcpServers:
    - { kind: MCPServer, name: github-mcp }

  # 훅 (선택)
  hooks:
    - point: turn.post
      action:
        toolCall:
          tool: slack.postMessage
          input:
            text: { expr: "$.turn.summary" }
```

### 4.4 Swarm 정의

```yaml
kind: Swarm
metadata:
  name: default
spec:
  # 진입점 에이전트
  entrypoint: { kind: Agent, name: planner }

  # 포함된 에이전트들
  agents:
    - { kind: Agent, name: planner }
    - { kind: Agent, name: executor }

  # 실행 정책
  policy:
    maxStepsPerTurn: 32

    # Live Config 정책 (선택)
    liveConfig:
      enabled: true
      applyAt: ["step.config"]
      allowedPaths:
        agentRelative:
          - "/spec/tools"
          - "/spec/extensions"
```

### 4.5 Connector 정의

```yaml
# CLI Connector
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"

---
# Slack Connector
kind: Connector
metadata:
  name: slack
spec:
  type: slack
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  ingress:
    - match:
        command: "/agent"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
  egress:
    updatePolicy:
      mode: updateInThread
      debounceMs: 1500
```

### 4.6 리소스 참조 방식

```yaml
# 문자열 축약
tools:
  - Tool/fileRead

# 객체형
tools:
  - { kind: Tool, name: fileRead }

# 전체 참조
tools:
  - apiVersion: agents.example.io/v1alpha1
    kind: Tool
    name: fileRead
```

### 4.7 Selector + Overrides

```yaml
# 라벨로 선택하고 설정 덮어쓰기
tools:
  - selector:
      kind: Tool
      matchLabels:
        tier: base
    overrides:
      spec:
        errorMessageLimit: 2000
```

---

## 5. Tool 개발

Tool은 LLM이 호출할 수 있는 함수입니다.

### 5.1 Tool 구조

```
my-tool/
├── tool.yaml       # Tool 리소스 정의
└── index.ts        # 핸들러 구현
```

### 5.2 Tool 정의 (YAML)

```yaml
# tool.yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: calculator
  labels:
    tier: base
spec:
  runtime: node
  entry: "./index.js"           # Bundle Package Root 기준 경로
  errorMessageLimit: 1000       # 에러 메시지 최대 길이

  exports:
    - name: calc.add
      description: "두 숫자를 더합니다"
      parameters:
        type: object
        properties:
          a:
            type: number
            description: "첫 번째 숫자"
          b:
            type: number
            description: "두 번째 숫자"
        required: ["a", "b"]

    - name: calc.multiply
      description: "두 숫자를 곱합니다"
      parameters:
        type: object
        properties:
          a: { type: number }
          b: { type: number }
        required: ["a", "b"]
```

### 5.3 Tool 구현 (TypeScript)

```typescript
// index.ts
import type { ToolHandler, ToolContext, JsonValue } from '@goondan/core';

interface CalcInput {
  a: number;
  b: number;
}

// handlers 객체로 export (export name → handler 매핑)
export const handlers: Record<string, ToolHandler> = {
  'calc.add': async (ctx: ToolContext, input: CalcInput): Promise<JsonValue> => {
    const { a, b } = input;

    // 입력 검증
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new Error('a와 b는 숫자여야 합니다.');
    }

    return {
      result: a + b,
      expression: `${a} + ${b} = ${a + b}`,
    };
  },

  'calc.multiply': async (ctx: ToolContext, input: CalcInput): Promise<JsonValue> => {
    const { a, b } = input;
    return {
      result: a * b,
      expression: `${a} × ${b} = ${a * b}`,
    };
  },
};
```

### 5.4 ToolContext 활용

```typescript
interface ToolContext {
  instance: unknown;           // SwarmInstance
  swarm: Resource<SwarmSpec>;  // Swarm 정의
  agent: Resource<AgentSpec>;  // Agent 정의
  turn: Turn;                  // 현재 Turn
  step: Step;                  // 현재 Step
  toolCatalog: ToolCatalogItem[];  // 현재 노출된 도구 목록
  liveConfig: LiveConfigApi;   // Live Config patch 제안
  oauth: OAuthApi;             // OAuth 토큰 접근
  events: EventBus;            // 이벤트 발행
  logger: Console;             // 로깅
}
```

### 5.5 실전 예시: 파일 읽기 도구

```typescript
// tools/file-read/index.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolHandler, ToolContext } from '@goondan/core';

interface FileReadInput {
  path: string;
  encoding?: BufferEncoding;
  maxBytes?: number;
}

export const handlers: Record<string, ToolHandler> = {
  'file.read': async (ctx: ToolContext, input: FileReadInput) => {
    const targetPath = String(input.path || '');

    if (!targetPath) {
      throw new Error('path가 필요합니다.');
    }

    // 상대 경로를 절대 경로로 변환
    const resolved = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(process.cwd(), targetPath);

    // 파일 존재 확인
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw new Error(`${resolved}는 파일이 아닙니다.`);
    }

    // 파일 읽기
    const encoding = input.encoding || 'utf8';
    const maxBytes = input.maxBytes ?? 100_000;
    const content = await fs.readFile(resolved, encoding);

    // 크기 제한
    const truncated = content.length > maxBytes;
    const finalContent = truncated ? content.slice(0, maxBytes) : content;

    return {
      path: resolved,
      size: stat.size,
      truncated,
      content: finalContent,
    };
  },
};
```

### 5.6 Live Config를 활용한 도구

Tool이 다음 Step의 도구 목록을 동적으로 변경할 수 있습니다:

```typescript
// tools/tool-search/index.ts
export const handlers: Record<string, ToolHandler> = {
  'toolSearch.find': async (ctx: ToolContext, input: { query: string; autoAdd?: boolean }) => {
    const query = String(input.query || '').toLowerCase();

    // 현재 Tool Catalog에서 검색
    const matches = ctx.toolCatalog
      .filter(tool =>
        tool.name.toLowerCase().includes(query) ||
        tool.description?.toLowerCase().includes(query)
      )
      .slice(0, 5);

    // autoAdd가 true면 다음 Step부터 활성화
    if (input.autoAdd && matches.length > 0) {
      for (const match of matches) {
        await ctx.liveConfig.proposePatch({
          scope: 'agent',
          applyAt: 'step.config',
          patch: {
            type: 'json6902',
            ops: [{
              op: 'add',
              path: '/spec/tools/-',
              value: { kind: 'Tool', name: match.name },
            }],
          },
          source: { type: 'tool', name: 'toolSearch.find' },
          reason: `검색어 "${query}"에 매칭된 도구 추가`,
        });
      }
    }

    return { query, matches, proposed: input.autoAdd ? matches.length : 0 };
  },
};
```

### 5.7 OAuth를 활용한 도구

```typescript
// tools/slack/index.ts
export const handlers: Record<string, ToolHandler> = {
  'slack.postMessage': async (ctx: ToolContext, input: { channel: string; text: string }) => {
    // OAuth 토큰 획득
    const tokenResult = await ctx.oauth.getAccessToken({
      oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      scopes: ['chat:write'],
    });

    if (tokenResult.status === 'authorization_required') {
      // 사용자에게 승인 요청 안내
      return {
        status: 'authorization_required',
        message: tokenResult.message,
        authorizationUrl: tokenResult.authorizationUrl,
      };
    }

    if (tokenResult.status === 'error') {
      throw new Error(tokenResult.error.message);
    }

    // Slack API 호출
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: input.channel,
        text: input.text,
      }),
    });

    return await response.json();
  },
};
```

---

## 6. Extension 개발

Extension은 런타임 라이프사이클에 개입하는 확장 로직입니다.

### 6.1 Extension 구조

```
my-extension/
├── extension.yaml  # Extension 리소스 정의
└── index.ts        # register 함수 구현
```

### 6.2 Extension 정의 (YAML)

```yaml
# extension.yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: myExtension
spec:
  runtime: node
  entry: "./index.js"
  config:
    maxTokens: 8000
    enableLogging: true
```

### 6.3 Extension 구현 (TypeScript)

```typescript
// index.ts
import type { ExtensionApi, StepContext } from '@goondan/core';

interface MyConfig {
  maxTokens?: number;
  enableLogging?: boolean;
}

interface MyState {
  processedSteps: number;
}

// register 함수 필수 export
export async function register(
  api: ExtensionApi<MyState, MyConfig>
): Promise<void> {
  // 상태 초기화
  const state = api.extState();
  state.processedSteps = 0;

  // 설정 읽기
  const config = api.extension.spec?.config || {};
  const maxTokens = config.maxTokens ?? 8000;

  // 파이프라인에 mutator 등록
  api.pipelines.mutate('step.post', async (ctx: StepContext) => {
    state.processedSteps++;

    if (config.enableLogging) {
      api.logger?.info?.(`Step ${state.processedSteps} 완료`);
    }

    return ctx;
  });
}
```

### 6.4 ExtensionApi 인터페이스

```typescript
interface ExtensionApi<State = JsonObject, Config = JsonObject> {
  extension: Resource<ExtensionSpec<Config>>;  // Extension 정의
  pipelines: PipelineApi;      // 파이프라인 등록
  tools: ToolRegistryApi;      // 동적 Tool 등록
  events: EventBus;            // 이벤트 버스
  liveConfig: LiveConfigApi;   // Live Config patch 제안
  extState: () => State;       // 확장별 상태 저장소
  logger?: Console;            // 로거
}
```

### 6.5 파이프라인 포인트와 사용법

#### Mutator (순차 변형)

```typescript
// step.blocks: 컨텍스트 블록 조작
api.pipelines.mutate('step.blocks', async (ctx) => {
  const blocks = [...(ctx.blocks || [])];

  // 커스텀 블록 추가
  blocks.push({
    type: 'custom.info',
    data: { timestamp: Date.now() },
  });

  return { ...ctx, blocks };
});

// turn.pre: Turn 시작 전 처리
api.pipelines.mutate('turn.pre', async (ctx) => {
  // 입력 전처리
  ctx.turn.metadata = { startTime: Date.now() };
  return ctx;
});

// turn.post: Turn 종료 후 처리
api.pipelines.mutate('turn.post', async (ctx) => {
  // 요약 생성, 메트릭 수집 등
  const duration = Date.now() - (ctx.turn.metadata?.startTime || 0);
  api.logger?.info?.(`Turn 완료: ${duration}ms`);
  return ctx;
});
```

#### Middleware (래핑)

```typescript
// step.llmCall: LLM 호출 래핑
api.pipelines.wrap('step.llmCall', async (ctx, next) => {
  const startTime = Date.now();

  // LLM 호출 전 처리
  api.logger?.debug?.('LLM 호출 시작');

  // 실제 LLM 호출
  const result = await next(ctx);

  // LLM 호출 후 처리
  const elapsed = Date.now() - startTime;
  api.logger?.debug?.(`LLM 호출 완료: ${elapsed}ms`);

  return result;
});

// toolCall.exec: Tool 실행 래핑
api.pipelines.wrap('toolCall.exec', async (ctx, next) => {
  const toolName = ctx.toolCall?.name;

  try {
    return await next(ctx);
  } catch (error) {
    api.logger?.error?.(`Tool 실행 실패: ${toolName}`, error);
    throw error;
  }
});
```

### 6.6 동적 Tool 등록

Extension에서 런타임에 Tool을 등록할 수 있습니다:

```typescript
export async function register(api: ExtensionApi): Promise<void> {
  // 동적 Tool 등록
  api.tools.register({
    name: 'myExt.getData',
    description: '확장에서 제공하는 데이터 조회',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
      },
      required: ['key'],
    },
    handler: async (ctx, input) => {
      const key = String(input.key);
      return { key, value: `data for ${key}` };
    },
  });
}
```

### 6.7 이벤트 처리

```typescript
export async function register(api: ExtensionApi): Promise<void> {
  // 이벤트 구독
  api.events.on?.('workspace.repoAvailable', async (payload) => {
    const repoPath = payload.path;
    api.logger?.info?.(`Repo 사용 가능: ${repoPath}`);

    // repo 스캔, 인덱싱 등
  });

  // 이벤트 발행
  api.events.emit?.('myExtension.initialized', { timestamp: Date.now() });
}
```

### 6.8 실전 예시: 메시지 압축 Extension

```typescript
// extensions/compaction/index.ts
import type { ExtensionApi, StepContext } from '@goondan/core';

interface CompactionConfig {
  maxTokens?: number;
  maxChars?: number;
}

interface CompactionState {
  lastCompactionStep?: string;
}

export async function register(
  api: ExtensionApi<CompactionState, CompactionConfig>
): Promise<void> {
  const state = api.extState();
  const config = api.extension.spec?.config || {};
  const maxTokens = config.maxTokens ?? 8000;
  const maxChars = config.maxChars ?? 32000;

  api.pipelines.mutate('step.post', async (ctx: StepContext) => {
    if (!ctx.step?.llmResult?.meta?.usage) return ctx;

    const usage = ctx.step.llmResult.meta.usage;

    // 토큰 수가 임계치를 초과하면 압축
    if (usage.totalTokens > maxTokens) {
      const summary = await compactMessages(ctx.turn.messages, maxChars);

      ctx.turn.metadata = ctx.turn.metadata || {};
      ctx.turn.metadata.compaction = {
        appliedAt: ctx.step.id,
        originalTokens: usage.totalTokens,
        summary,
      };

      state.lastCompactionStep = ctx.step.id;
    }

    return ctx;
  });
}

async function compactMessages(messages: LlmMessage[], maxChars: number): Promise<string> {
  // 메시지 압축 로직
  // 실제 구현에서는 LLM을 호출하여 요약 생성
  return messages
    .map(m => `${m.role}: ${m.content?.slice(0, 100)}...`)
    .join('\n')
    .slice(0, maxChars);
}
```

### 6.9 실전 예시: Skill 스캔 Extension

```typescript
// extensions/skill/index.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExtensionApi } from '@goondan/core';

interface SkillConfig {
  skillDirs?: string[];
}

interface SkillItem {
  name: string;
  path: string;
  description: string;
}

interface SkillState {
  catalog: SkillItem[];
  rootDir: string;
}

export async function register(
  api: ExtensionApi<SkillState, SkillConfig>
): Promise<void> {
  const state = api.extState();
  const config = api.extension.spec?.config || {};
  const skillDirs = config.skillDirs || ['.claude/skills', '.agent/skills'];

  state.rootDir = process.cwd();
  state.catalog = await scanSkills(state.rootDir, skillDirs);

  // 컨텍스트 블록에 스킬 카탈로그 추가
  api.pipelines.mutate('step.blocks', async (ctx) => {
    const blocks = [...(ctx.blocks || [])];
    blocks.push({
      type: 'skills.catalog',
      items: state.catalog,
    });
    return { ...ctx, blocks };
  });

  // 스킬 목록 조회 Tool
  api.tools.register({
    name: 'skills.list',
    description: '사용 가능한 스킬 목록',
    handler: async () => ({ items: state.catalog }),
  });

  // 스킬 실행 Tool
  api.tools.register({
    name: 'skills.run',
    description: '스킬 스크립트 실행',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
      },
      required: ['command'],
    },
    handler: async (ctx, input) => {
      const { spawn } = await import('child_process');
      const command = String(input.command);
      const args = Array.isArray(input.args) ? input.args.map(String) : [];

      return new Promise((resolve) => {
        const proc = spawn(command, args, { cwd: state.rootDir });
        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (d) => { stdout += d; });
        proc.stderr?.on('data', (d) => { stderr += d; });
        proc.on('close', (code) => {
          resolve({ code, stdout, stderr });
        });
      });
    },
  });

  // workspace 이벤트 구독
  api.events.on?.('workspace.repoAvailable', async (payload) => {
    const repoPath = payload.path || state.rootDir;
    state.catalog = await scanSkills(repoPath, skillDirs);
  });
}

async function scanSkills(rootDir: string, dirs: string[]): Promise<SkillItem[]> {
  const items: SkillItem[] = [];

  for (const dir of dirs) {
    const skillDir = path.join(rootDir, dir);
    try {
      const entries = await fs.readdir(skillDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMd = path.join(skillDir, entry.name, 'SKILL.md');
          try {
            const content = await fs.readFile(skillMd, 'utf8');
            items.push({
              name: entry.name,
              path: skillMd,
              description: content.split('\n')[0].replace(/^#\s*/, ''),
            });
          } catch {
            // SKILL.md 없음
          }
        }
      }
    } catch {
      // 디렉터리 없음
    }
  }

  return items;
}
```

---

## 7. Connector 개발

Connector는 외부 이벤트를 Runtime으로 전달하고, 응답을 외부로 송신합니다.

### 7.1 Connector 구조

```
my-connector/
├── connector.yaml  # Connector 리소스 정의
└── index.ts        # createConnector 함수 구현
```

### 7.2 Connector 정의 (YAML)

```yaml
# connector.yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: myConnector
spec:
  type: myConnector
  ingress:
    - match:
        command: "/agent"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.sessionId"
        inputFrom: "$.message"
  egress:
    updatePolicy:
      mode: replace
```

### 7.3 Connector 구현 (TypeScript)

```typescript
// index.ts
import type { JsonObject, ObjectRefLike } from '@goondan/core';

interface ConnectorOptions {
  runtime: {
    handleEvent: (event: {
      swarmRef: ObjectRefLike;
      instanceKey: string;
      input: string;
      origin?: JsonObject;
      auth?: JsonObject;
      metadata?: JsonObject;
    }) => Promise<void>;
  };
  connectorConfig: JsonObject;
  logger?: Console;
}

interface ConnectorAdapter {
  handleEvent: (payload: JsonObject) => Promise<void>;
  send?: (input: {
    text: string;
    origin?: JsonObject;
    auth?: JsonObject;
    metadata?: JsonObject;
    kind?: 'progress' | 'final';
  }) => Promise<unknown>;
}

export function createMyConnector(options: ConnectorOptions): ConnectorAdapter {
  const { runtime, connectorConfig, logger } = options;
  const config = connectorConfig.spec || {};
  const ingressRules = config.ingress || [];

  async function handleEvent(payload: JsonObject): Promise<void> {
    const message = String(payload.message || '');

    // ingress 규칙 매칭
    for (const rule of ingressRules) {
      const match = rule.match as { command?: string } | undefined;

      // command 매칭
      if (match?.command && !message.startsWith(match.command)) {
        continue;
      }

      const route = rule.route;
      if (!route?.swarmRef) {
        logger?.warn?.('ingress rule에 swarmRef가 없습니다.');
        continue;
      }

      // Runtime에 이벤트 전달
      await runtime.handleEvent({
        swarmRef: route.swarmRef,
        instanceKey: String(readPath(payload, route.instanceKeyFrom) || 'default'),
        input: String(readPath(payload, route.inputFrom) || message),
        origin: {
          connector: connectorConfig.metadata?.name || 'myConnector',
          sessionId: payload.sessionId,
        },
        auth: {
          actor: { type: 'user', id: payload.userId },
          subjects: {
            global: `myService:${payload.tenantId}`,
            user: `myService:${payload.tenantId}:${payload.userId}`,
          },
        },
        metadata: {
          connector: connectorConfig.metadata?.name,
        },
      });
      return;
    }

    logger?.warn?.('매칭되는 ingress 규칙이 없습니다.');
  }

  async function send(input: {
    text: string;
    origin?: JsonObject;
    kind?: 'progress' | 'final';
  }): Promise<{ ok: true }> {
    // 외부 시스템으로 응답 전송
    // 실제 구현에서는 WebSocket, HTTP callback 등 사용
    logger?.info?.(`[${input.kind}] ${input.text}`);
    return { ok: true };
  }

  return { handleEvent, send };
}

// JSONPath 간단 구현
function readPath(payload: JsonObject, expr?: string): unknown {
  if (!expr || !expr.startsWith('$.')) return undefined;
  const keys = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as JsonObject)[key];
  }
  return current;
}
```

### 7.4 CLI Connector 예시

```typescript
// connectors/cli/index.ts
import * as readline from 'readline';
import type { JsonObject, ObjectRefLike } from '@goondan/core';

interface CliConnectorOptions {
  runtime: {
    handleEvent: (event: {
      swarmRef: ObjectRefLike;
      instanceKey: string;
      input: string;
      origin?: JsonObject;
    }) => Promise<void>;
  };
  connectorConfig: JsonObject;
}

export function createCliConnector(options: CliConnectorOptions) {
  const { runtime, connectorConfig } = options;
  const config = connectorConfig.spec || {};

  async function handleEvent(payload: JsonObject): Promise<void> {
    const ingressRules = config.ingress || [];
    const text = String(payload.text || '');

    for (const rule of ingressRules) {
      const route = rule.route;
      if (!route?.swarmRef) continue;

      await runtime.handleEvent({
        swarmRef: route.swarmRef,
        instanceKey: String(readPath(payload, route.instanceKeyFrom) || 'cli'),
        input: String(readPath(payload, route.inputFrom) || text),
        origin: { connector: 'cli' },
      });
      return;
    }

    // 기본 라우팅 (ingress 규칙 없을 때)
    await runtime.handleEvent({
      swarmRef: { kind: 'Swarm', name: 'default' },
      instanceKey: 'cli',
      input: text,
      origin: { connector: 'cli' },
    });
  }

  function send(input: { text: string }): { ok: true } {
    if (input?.text) {
      console.log(input.text);
    }
    return { ok: true };
  }

  // 대화형 루프 시작
  function startInteractive(defaultSwarmRef: ObjectRefLike, instanceKey: string) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('Goondan CLI 시작. :exit 또는 :quit으로 종료.');

    const prompt = () => {
      rl.question('> ', async (line) => {
        const trimmed = line.trim();

        if (trimmed === ':exit' || trimmed === ':quit') {
          rl.close();
          return;
        }

        if (!trimmed) {
          prompt();
          return;
        }

        try {
          await handleEvent({ text: trimmed, instanceKey });
        } catch (err) {
          console.error('오류:', err);
        }

        prompt();
      });
    };

    prompt();
  }

  return { handleEvent, send, startInteractive };
}
```

---

## 8. Bundle Package 패키징

Bundle은 **YAML+코드로 구성된 폴더 트리(구성+코드)**이고, Bundle Package는 **Bundle을 Git 기반으로 배포/의존성 해석하는 패키징 단위(기존 Bundle)**입니다.  
CLI `goondan bundle` 명령은 Bundle Package를 관리합니다.

### 8.1 Bundle Package 구조

```
my-bundle/
├── bundle.yaml           # Bundle Package 매니페스트
├── dist/                 # 빌드 산출물 (Git에 커밋)
│   ├── tools/
│   │   └── myTool/
│   │       ├── tool.yaml
│   │       └── index.js
│   └── extensions/
│       └── myExt/
│           ├── extension.yaml
│           └── index.js
└── src/                  # 소스 코드
    ├── tools/
    └── extensions/
```

### 8.2 Bundle Package 매니페스트 (bundle.yaml)

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Bundle
metadata:
  name: my-bundle
spec:
  version: "1.0.0"

  # 의존하는 다른 Bundle Package
  dependencies:
    - github.com/goondan/goondan/packages/base@v0.3.0

  # 최종 Config에 포함할 YAML 목록
  include:
    - dist/tools/myTool/tool.yaml
    - dist/extensions/myExt/extension.yaml
```

### 8.3 Git 기반 배포

Bundle Package는 Git 경로로 식별됩니다:

```
github.com/<org>/<repo>/<path>@<ref?>
```

예시:
```
github.com/goondan/goondan/packages/base
github.com/goondan/goondan/packages/base@v0.3.0
github.com/myorg/my-bundles/tools/calculator@main
```

### 8.4 빌드 스크립트 예시

```json
// package.json
{
  "name": "my-bundle",
  "scripts": {
    "build": "tsc && pnpm build:yaml",
    "build:yaml": "cp -r src/**/*.yaml dist/"
  }
}
```

```bash
# 빌드 후 dist를 Git에 커밋
pnpm build
git add dist/
git commit -m "Build bundle package"
git push
```

### 8.5 Bundle Package 사용

```bash
# Bundle Package 설치
goondan bundle add github.com/myorg/my-bundles/tools/calculator

# 설치된 Bundle Package 확인
goondan bundle list

# Config에서 참조
```

```yaml
# goondan.yaml
kind: Agent
spec:
  tools:
    - { kind: Tool, name: calculator }  # my-bundle 패키지에서 제공
```

---

## 9. CLI 활용

### 9.1 주요 명령어

| 명령어 | 설명 |
|--------|------|
| `goondan init` | 프로젝트 초기화 (goondan.yaml 생성) |
| `goondan run` | 스웜 실행 |
| `goondan validate` | Config 검증 |
| `goondan export` | 리소스 내보내기 |
| `goondan bundle` | Bundle Package 관리 |

### 9.2 실행 옵션

```bash
# 기본 실행 (goondan.yaml 사용)
goondan run

# 특정 config 파일
goondan run -c ./configs/production.yaml

# 입력 지정
goondan run --input "안녕하세요"

# 새 인스턴스 생성
goondan run --new

# Bundle Package 지정
goondan run -c goondan.yaml -b ./bundles/my-bundle/bundle.yaml

# Mock LLM (테스트용)
goondan run --mock
```

### 9.3 검증 옵션

```bash
# 기본 검증 (스키마)
goondan validate -c goondan.yaml

# 엄격 검증 (참조, entry 존재, 중복)
goondan validate -c goondan.yaml --strict
```

### 9.4 번들 관리

```bash
# 번들 설치
goondan bundle add github.com/goondan/goondan/packages/base
goondan bundle add ./local-bundle/bundle.yaml

# 번들 목록
goondan bundle list

# 번들 정보
goondan bundle info base

# 번들 활성화/비활성화
goondan bundle enable base
goondan bundle disable base

# 무결성 검증
goondan bundle verify base

# Lock 파일 생성/검증
goondan bundle lock
goondan bundle verify-lock

# 번들 갱신
goondan bundle refresh base

# 번들 제거
goondan bundle remove base
```

### 9.5 내보내기

```bash
# YAML로 내보내기
goondan export -c goondan.yaml --format yaml > exported.yaml

# JSON으로 내보내기
goondan export -c goondan.yaml --format json > exported.json
```

---

## 10. 고급 주제

### 10.1 Live Config

실행 중 Config를 동적으로 변경할 수 있습니다:

```yaml
# Swarm에서 Live Config 활성화
kind: Swarm
spec:
  policy:
    liveConfig:
      enabled: true
      applyAt: ["step.config"]
      allowedPaths:
        agentRelative:
          - "/spec/tools"
          - "/spec/extensions"
```

Tool/Extension에서 patch 제안:

```typescript
await ctx.liveConfig.proposePatch({
  scope: 'agent',
  applyAt: 'step.config',
  patch: {
    type: 'json6902',
    ops: [{
      op: 'add',
      path: '/spec/tools/-',
      value: { kind: 'Tool', name: 'newTool' },
    }],
  },
  source: { type: 'tool', name: 'toolSearch' },
  reason: '사용자 요청으로 도구 추가',
});
```

### 10.2 OAuth 통합

```yaml
# OAuthApp 정의
kind: OAuthApp
metadata:
  name: slack-bot
spec:
  provider: slack
  flow: authorizationCode
  subjectMode: global
  client:
    clientId:
      valueFrom:
        env: "SLACK_CLIENT_ID"
    clientSecret:
      valueFrom:
        secretRef: { ref: "Secret/slack-oauth", key: "client_secret" }
  endpoints:
    authorizationUrl: "https://slack.com/oauth/v2/authorize"
    tokenUrl: "https://slack.com/api/oauth.v2.access"
  scopes:
    - "chat:write"
  redirect:
    callbackPath: "/oauth/callback/slack"

---
# Tool에서 OAuth 사용
kind: Tool
metadata:
  name: slackTool
spec:
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write"]
```

### 10.3 MCP 서버 연동

```yaml
kind: MCPServer
metadata:
  name: github-mcp
spec:
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

---
kind: Agent
spec:
  mcpServers:
    - { kind: MCPServer, name: github-mcp }
```

### 10.4 멀티 에이전트 구성

```yaml
kind: Agent
metadata:
  name: planner
spec:
  prompts:
    system: |
      너는 작업을 계획하는 planner다.
      복잡한 작업은 executor에게 위임해라.
  tools:
    - { kind: Tool, name: delegateToExecutor }

---
kind: Agent
metadata:
  name: executor
spec:
  prompts:
    system: |
      너는 실제 작업을 수행하는 executor다.
  tools:
    - { kind: Tool, name: fileRead }
    - { kind: Tool, name: fileWrite }

---
kind: Swarm
metadata:
  name: multi-agent
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
    - { kind: Agent, name: executor }
```

### 10.5 Hooks 활용

```yaml
kind: Agent
spec:
  hooks:
    # Turn 종료 후 Slack 알림
    - point: turn.post
      action:
        toolCall:
          tool: slack.postMessage
          input:
            channel: { expr: "$.turn.origin.channel" }
            text: { expr: "$.turn.summary" }

    # LLM 에러 시 재시도 전 처리
    - point: step.llmError
      action:
        toolCall:
          tool: log.error
          input:
            error: { expr: "$.error.message" }
```

### 10.6 상태 디렉터리 구조

```
state/
├── bundles.json              # 등록된 번들 목록
├── bundles/                  # 번들 캐시
│   └── git/
│       └── github.com/
│           └── goondan/
│               └── goondan/
│                   └── main/
│                       └── packages/
│                           └── base/
└── instances/
    └── <instanceId>/
        ├── base/
        │   └── base-config.ref
        └── agents/
            └── <agentName>/
                ├── live-config/
                │   ├── patches.jsonl
                │   ├── patch-status.jsonl
                │   ├── cursor.yaml
                │   └── effective/
                └── messages/
                    └── llm.jsonl
```

---

## 부록: 타입 참조

### A. 주요 타입

```typescript
// 기본 JSON 타입
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

// 리소스 참조
type ObjectRefLike = string | { kind: string; name: string };

// LLM 메시지
type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; output: JsonValue };

// Tool 핸들러
type ToolHandler = (ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue;

// Extension 등록 함수
type RegisterFunction = (api: ExtensionApi) => Promise<void>;
```

### B. 파이프라인 포인트

```typescript
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
```

---

## 다음 단계

1. **시작하기**: `goondan init`으로 프로젝트 생성
2. **도구 추가**: 필요한 Tool 개발 또는 base Bundle Package 활용
3. **확장 개발**: 라이프사이클 훅으로 커스텀 로직 추가
4. **Bundle Package 배포**: Git 기반으로 확장 패키징
5. **프로덕션**: Connector로 Slack, GitHub 등 연동

더 자세한 정보는 다음 문서를 참고하세요:

- @./goondan_spec.md - 전체 스펙
- @./docs/spec_config.md - Config YAML 스펙
- @./docs/spec_api.md - Runtime/SDK API
- @./docs/spec_bundle.md - Bundle Package 요구사항
