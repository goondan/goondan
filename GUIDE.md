# Goondan(군단) 개발자 가이드

> **Kubernetes for Agent Swarm** - 선언적 YAML로 AI 에이전트 스웜을 오케스트레이션합니다.

Goondan은 LLM 기반 에이전트 스웜을 선언적으로 정의하고 실행하는 오케스트레이터입니다.
Kubernetes가 컨테이너 워크로드를 관리하듯, Goondan은 AI 에이전트의 구성, 라우팅, 도구 바인딩, 외부 채널 연동을 YAML 리소스로 관리합니다.

---

## 목차

1. [소개](#1-소개)
2. [Quick Start](#2-quick-start)
3. [핵심 개념](#3-핵심-개념)
4. [리소스 정의](#4-리소스-정의)
5. [커스텀 Tool 작성](#5-커스텀-tool-작성)
6. [커스텀 Extension 작성](#6-커스텀-extension-작성)
7. [커스텀 Connector 작성](#7-커스텀-connector-작성)
8. [Bundle Package](#8-bundle-package)
9. [샘플 모음](#9-샘플-모음)
10. [FAQ & 트러블슈팅](#10-faq--트러블슈팅)

---

## 1. 소개

### 1.1 왜 Goondan인가?

LLM 에이전트를 프로덕션에 배치할 때, 다음 문제들을 반복적으로 만납니다:

- **멀티 에이전트 구성**: 여러 에이전트가 역할을 나누어 협업해야 합니다.
- **도구 바인딩**: 에이전트가 사용할 도구를 유연하게 붙였다 뗐다 할 수 있어야 합니다.
- **외부 채널 연동**: Slack, Telegram, CLI 등 다양한 입구를 지원해야 합니다.
- **실행 정책**: 토큰 제한, 단계 제한, 컨텍스트 압축 등을 선언적으로 관리해야 합니다.
- **재사용과 공유**: 도구와 확장을 패키지로 배포하고 공유할 수 있어야 합니다.

Goondan은 이 모든 것을 **Kubernetes 스타일의 선언적 리소스 모델**로 해결합니다.

### 1.2 Kubernetes와의 비유

| Kubernetes | Goondan | 역할 |
|------------|---------|------|
| Pod | Agent | 실행 단위 |
| Deployment | Swarm | 에이전트 집합 + 정책 |
| Service | Connector + Connection | 외부 트래픽 라우팅 |
| ConfigMap | Model | LLM 설정 |
| CRD | ResourceType | 사용자 정의 리소스 |
| Helm Chart | Bundle Package | 패키징/배포 단위 |
| Admission Webhook | Extension | 라이프사이클 훅 |

### 1.3 아키텍처 개요

```
                    ┌─────────────────────────────┐
                    │     외부 채널 (Slack, CLI)     │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │   Connector + Connection     │
                    │  (프로토콜 + 라우팅/Egress)     │
                    └──────────┬──────────────────┘
                               │ Canonical Event
                    ┌──────────▼──────────────────┐
                    │     SwarmInstance             │
                    │  ┌───────────────────────┐   │
                    │  │   AgentInstance        │   │
                    │  │  ┌─────────────────┐   │   │
                    │  │  │    Turn          │   │   │
                    │  │  │  ┌───────────┐   │   │   │
                    │  │  │  │   Step     │   │   │   │
                    │  │  │  │ (LLM 호출) │   │   │   │
                    │  │  │  └───────────┘   │   │   │
                    │  │  └─────────────────┘   │   │
                    │  └───────────────────────┘   │
                    └──────────────────────────────┘
```

---

## 2. Quick Start

### 2.1 설치

```bash
npm install -g @goondan/cli
# 또는
pnpm add -g @goondan/cli
```

### 2.2 프로젝트 초기화

```bash
# 새 프로젝트 생성
gdn init my-first-agent
cd my-first-agent
```

### 2.3 환경 변수 설정

사용할 LLM 제공자의 API 키를 설정합니다:

```bash
# Anthropic (Claude)
export ANTHROPIC_API_KEY="sk-ant-..."

# 또는 OpenAI
export OPENAI_API_KEY="sk-..."
```

### 2.4 실행

```bash
gdn run
```

대화형 모드가 시작됩니다:

```
Goondan v0.0.2 - Agent Swarm Orchestrator
Swarm: default | Agent: assistant | Model: claude-sonnet-4-5

> 안녕하세요!
assistant: 안녕하세요! 무엇을 도와드릴까요?

> /exit
```

### 2.5 기본 프로젝트 구조

`gdn init`이 생성하는 기본 구조:

```
my-first-agent/
├── goondan.yaml            # 메인 구성 파일 (모든 리소스 정의)
├── prompts/
│   └── default.system.md   # 시스템 프롬프트
└── .gitignore
```

---

## 3. 핵심 개념

### 3.1 Resource Model

Goondan의 모든 구성은 **리소스(Resource)** 단위로 관리됩니다.
모든 리소스는 동일한 기본 구조를 따릅니다:

```yaml
apiVersion: agents.example.io/v1alpha1   # API 버전
kind: <리소스 종류>                        # Model, Agent, Swarm, Tool 등
metadata:
  name: <고유 이름>                        # 같은 kind 내에서 유일
  labels: {}                              # 선택: 라벨 (Selector 매칭용)
  annotations: {}                         # 선택: 메타데이터
spec:
  # kind별 상세 설정
```

### 3.2 리소스 Kind 목록

| Kind | 역할 | 필수 |
|------|------|------|
| **Model** | LLM 모델 설정 (제공자, 이름, 옵션) | O |
| **Agent** | 에이전트 정의 (모델, 프롬프트, 도구, 확장) | O |
| **Swarm** | 에이전트 집합 + 실행 정책 | O |
| **Connector** | 외부 채널 연동 (CLI, Slack, Telegram) | O |
| **Tool** | LLM이 호출할 수 있는 도구 | 선택 |
| **Extension** | 라이프사이클 파이프라인 확장 | 선택 |
| **OAuthApp** | OAuth 인증 구성 | 선택 |
| **Connection** | Connector와 Swarm의 라우팅 규칙 | O |
| **ResourceType** | 사용자 정의 Kind 등록 | 선택 |
| **ExtensionHandler** | ResourceType 처리 핸들러 | 선택 |

### 3.3 실행 계층: Swarm > Agent > Turn > Step

Goondan의 실행 모델은 4단계 계층 구조입니다:

**Swarm** (스웜)
- Agent들의 집합과 실행 정책을 정의합니다.
- 진입점 Agent(entrypoint)를 지정합니다.
- `maxStepsPerTurn` 등 정책을 설정합니다.

**Agent** (에이전트)
- 하나의 LLM 모델, 프롬프트, 도구, 확장을 묶은 실행 단위입니다.
- 에이전트 간 위임(delegate)이 가능합니다.

**Turn** (턴)
- 사용자의 하나의 입력 이벤트를 처리하는 단위입니다.
- 하나의 Turn은 여러 Step으로 구성됩니다.

**Step** (스텝)
- LLM 호출 1회 단위입니다.
- LLM이 도구를 호출하면 다음 Step에서 결과를 전달합니다.
- LLM이 도구 호출 없이 텍스트만 반환하면 Turn이 종료됩니다.

```
사용자 입력 → Turn 시작
  → Step 1: LLM 호출 → tool_call(file.read)
  → Step 2: LLM 호출 (도구 결과 포함) → tool_call(file.write)
  → Step 3: LLM 호출 (도구 결과 포함) → 텍스트 응답
Turn 종료 → 사용자에게 응답 전달
```

### 3.4 참조 문법: ObjectRef

리소스 간 참조는 두 가지 형식을 지원합니다:

```yaml
# 문자열 축약 형식
tools:
  - Tool/fileRead

# 객체형 참조
tools:
  - kind: Tool
    name: fileRead

# 중괄호 인라인 형식 (권장)
tools:
  - { kind: Tool, name: fileRead }
```

### 3.5 Selector + Overrides

라벨 기반으로 리소스를 선택하고, 선택된 리소스의 설정을 덮어쓸 수 있습니다:

```yaml
tools:
  # 라벨이 tier=base인 모든 Tool을 선택하고, errorMessageLimit을 오버라이드
  - selector:
      kind: Tool
      matchLabels:
        tier: base
    overrides:
      spec:
        errorMessageLimit: 2000
```

### 3.6 Pipeline (Mutator & Middleware)

Extension은 파이프라인을 통해 런타임에 개입합니다.

**Mutator** (순차 변형): 컨텍스트를 순차적으로 변형하는 함수 체인
```
입력 → Mutator A → Mutator B → Mutator C → 출력
```

**Middleware** (래핑): `next()` 기반 onion 구조로 핵심 실행을 래핑
```
Middleware A (전처리)
  → Middleware B (전처리)
    → 핵심 실행
  ← Middleware B (후처리)
← Middleware A (후처리)
```

**주요 파이프라인 포인트:**

| 포인트 | 타입 | 설명 |
|--------|------|------|
| `turn.pre` | Mutator | Turn 시작 전 |
| `turn.post` | Mutator | Turn 종료 훅 (`base/events` 전달, 추가 이벤트 발행 가능) |
| `step.config` | Mutator | Step 설정 결정 |
| `step.tools` | Mutator | Tool Catalog 구성 |
| `step.blocks` | Mutator | 컨텍스트 블록 구성 |
| `step.llmCall` | Middleware | LLM 호출 래핑 |
| `step.llmError` | Mutator | LLM 에러 처리 |
| `toolCall.pre` | Mutator | 도구 호출 전 |
| `toolCall.exec` | Middleware | 도구 실행 래핑 |
| `toolCall.post` | Mutator | 도구 호출 후 |

**Turn 메시지 상태 모델 (MUST):**
- `NextMessages = BaseMessages + SUM(Events)`
- turn 시작 시 `messages/base.jsonl` 로드
- turn 진행 중 `messages/events.jsonl`에 메시지 이벤트 append
- `turn.post` 훅 완료 후 fold 결과를 새 base로 저장하고 events 비움

---

## 4. 리소스 정의

### 4.1 Model 정의

Model은 LLM 모델의 제공자와 이름을 지정합니다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: default-model
  labels:
    provider: anthropic
spec:
  provider: anthropic          # openai, anthropic, google 중 선택
  name: claude-sonnet-4-5      # 모델 이름
  # endpoint: "..."            # 선택: 커스텀 엔드포인트
  # options:                   # 선택: 제공자별 추가 옵션
  #   organization: "org-xxx"
```

**지원 제공자:**
- `anthropic` - Claude 모델 (claude-sonnet-4-5, claude-opus-4 등)
- `openai` - GPT 모델 (gpt-4o, gpt-4-turbo 등)
- `google` - Gemini 모델 (gemini-2.0-flash 등)

### 4.2 Agent 정의

Agent는 에이전트의 모델, 프롬프트, 도구, 확장을 정의합니다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: assistant
  labels:
    role: general
spec:
  # 모델 설정 (필수)
  modelConfig:
    modelRef: { kind: Model, name: default-model }
    params:
      temperature: 0.7       # 0.0 ~ 2.0 (창의성 조절)
      maxTokens: 4096         # 최대 출력 토큰

  # 프롬프트 설정 (필수: system 또는 systemRef 중 하나)
  prompts:
    # 파일 참조 방식 (권장)
    systemRef: "./prompts/assistant.system.md"
    # 또는 인라인 방식
    # system: |
    #   너는 도움이 되는 AI 어시스턴트입니다.

  # 도구 목록 (선택)
  tools:
    - { kind: Tool, name: bash }
    - { kind: Tool, name: file-read }

  # 확장 목록 (선택)
  extensions:
    - { kind: Extension, name: compaction }

  # 훅 목록 (선택)
  hooks:
    - point: turn.post
      priority: 0
      action:
        toolCall:
          tool: log.info
          input:
            message: { expr: "$.turn.summary" }
```

**중요 규칙:**
- `prompts.system`과 `prompts.systemRef`는 동시에 사용할 수 없습니다 (MUST).
- `modelConfig.modelRef`는 반드시 존재하는 Model을 참조해야 합니다 (MUST).

### 4.3 Swarm 정의

Swarm은 에이전트 집합과 실행 정책을 정의합니다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  # 진입점 Agent (필수 - agents 배열에 포함되어야 함)
  entrypoint: { kind: Agent, name: planner }

  # 에이전트 목록 (필수)
  agents:
    - { kind: Agent, name: planner }
    - { kind: Agent, name: coder }
    - { kind: Agent, name: reviewer }

  # 실행 정책 (선택)
  policy:
    maxStepsPerTurn: 32       # Turn당 최대 Step 수 (기본: 32)

    # Changeset 정책 (선택 - 자기 수정 에이전트용)
    changesets:
      enabled: true
      applyAt: [step.config]
      allowed:
        files: ["prompts/**", "resources/**"]

    # Live Config 정책 (선택)
    liveConfig:
      enabled: true
      applyAt: [step.config]
```

**중요 규칙:**
- `entrypoint`는 `agents` 배열에 반드시 포함되어야 합니다 (MUST).
- `agents`에는 최소 1개 이상의 Agent 참조가 있어야 합니다 (MUST).
- Changeset 반영 시점은 기본적으로 `step.config`이며, 구현에 따라 `turn.start` Safe Point를 추가로 사용할 수 있습니다 (MAY).

### 4.4 Connector & Connection 정의

Connector는 외부 프로토콜 이벤트를 수신하여 정규화된 ConnectorEvent를 발행하고, Connection은 Connector와 Agent 사이의 라우팅 규칙을 정의합니다.

**CLI Connector (가장 단순한 형태):**

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  runtime: node
  entry: "./connectors/cli/index.ts"
  triggers:
    - type: cli
  events:
    - name: user_input

---

apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - route: {}  # entrypoint Agent로 라우팅
```

**Telegram Connector:**

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: telegram
spec:
  runtime: node
  entry: "./connectors/telegram/index.ts"
  triggers:
    - type: custom
    - type: http
      endpoint:
        path: /webhook/telegram
        method: POST
  events:
    - name: message
      properties:
        chat_id: { type: string }

---

apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: telegram-to-swarm
spec:
  connectorRef: { kind: Connector, name: telegram }
  auth:
    staticToken:
      valueFrom:
        env: "TELEGRAM_BOT_TOKEN"
  ingress:
    rules:
      - match:
          event: message
        route: {}  # entrypoint Agent로 라우팅
```

### 4.5 Tool 정의

Tool은 LLM이 호출할 수 있는 함수를 정의합니다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: file-read
  labels:
    tier: base
    category: filesystem
spec:
  runtime: node
  entry: "./tools/file-read/index.ts"     # 핸들러 파일 경로
  errorMessageLimit: 1000                  # 에러 메시지 최대 길이
  exports:
    - name: file.read                      # 도구 이름 (LLM이 호출할 이름)
      description: "파일 내용을 읽습니다."   # 설명 (LLM에 전달)
      parameters:                          # JSON Schema 형식 파라미터 정의
        type: object
        properties:
          path:
            type: string
            description: "읽을 파일 경로"
        required: ["path"]
```

**중요 규칙:**
- `exports`에는 최소 1개 이상의 함수가 정의되어야 합니다 (MUST).
- `exports[].parameters`는 유효한 JSON Schema여야 합니다 (MUST).

### 4.6 Extension 정의

Extension은 라이프사이클 파이프라인에 개입하는 확장 로직을 정의합니다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: compaction
  labels:
    tier: base
spec:
  runtime: node
  entry: "./extensions/compaction/index.ts"
  config:                      # Extension별 자유 설정
    maxTokens: 8000
    enableLogging: true
```

### 4.7 전체 예제: 최소 구성

모든 것을 하나의 `goondan.yaml`에 정의할 수 있습니다:

```yaml
# 1. Model 정의
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

---

# 2. Agent 정의
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    systemRef: "./prompts/system.md"

---

# 3. Swarm 정의
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: assistant }
  agents:
    - { kind: Agent, name: assistant }
  policy:
    maxStepsPerTurn: 8

---

# 4. Connector 정의
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  runtime: node
  entry: "./connectors/cli/index.ts"
  triggers:
    - type: cli
  events:
    - name: user_input

---

# 5. Connection 정의
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - route: {}  # entrypoint Agent로 라우팅
```

---

## 5. 커스텀 Tool 작성

### 5.1 디렉토리 구조

```
my-project/
├── goondan.yaml
└── tools/
    └── my-tool/
        ├── tool.yaml      # Tool 리소스 정의 (선택: goondan.yaml에 인라인 가능)
        └── index.ts        # Tool 핸들러 구현
```

### 5.2 Tool 핸들러 작성

Tool 핸들러는 `handlers` 객체를 export합니다. 각 키는 `exports[].name`에 대응합니다.

```typescript
// tools/my-tool/index.ts
import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

/**
 * handlers 객체를 export합니다.
 * 키 이름은 tool.yaml의 exports[].name과 일치해야 합니다.
 */
export const handlers: Record<string, ToolHandler> = {
  /**
   * 'myTool.greet' 도구 핸들러
   */
  'myTool.greet': async (
    ctx: ToolContext,
    input: JsonObject
  ): Promise<JsonValue> => {
    const name = input.name;
    if (typeof name !== 'string') {
      return { error: 'name must be a string' };
    }
    return { message: `Hello, ${name}!` };
  },

  /**
   * 'myTool.calculate' 도구 핸들러
   */
  'myTool.calculate': async (
    ctx: ToolContext,
    input: JsonObject
  ): Promise<JsonValue> => {
    const a = input.a;
    const b = input.b;
    if (typeof a !== 'number' || typeof b !== 'number') {
      return { error: 'a and b must be numbers' };
    }
    return { result: a + b };
  },
};
```

### 5.3 Tool 리소스 정의

`goondan.yaml`에 Tool 리소스를 추가합니다:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: my-tool
  labels:
    tier: custom
spec:
  runtime: node
  entry: "./tools/my-tool/index.ts"
  exports:
    - name: myTool.greet
      description: "이름을 받아 인사 메시지를 반환합니다."
      parameters:
        type: object
        properties:
          name:
            type: string
            description: "인사할 이름"
        required: ["name"]

    - name: myTool.calculate
      description: "두 숫자를 더합니다."
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
```

### 5.4 Agent에 도구 연결

```yaml
kind: Agent
metadata:
  name: assistant
spec:
  # ...
  tools:
    - { kind: Tool, name: my-tool }
```

### 5.5 ToolContext API

핸들러의 `ctx` 파라미터는 다음 정보를 제공합니다:

```typescript
interface ToolContext {
  /** 현재 Turn 정보 */
  turn: {
    id: string;
    origin: TurnOrigin;
    auth: TurnAuth;
  };
  /** 현재 Agent 정보 */
  agent: {
    name: string;
  };
  /** 현재 Swarm 정보 */
  swarm: {
    name: string;
    instanceKey: string;
  };
  /** 이벤트 발행 */
  emit: (type: string, payload: JsonValue) => void;
  /** 로깅 */
  log: {
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}
```

---

## 6. 커스텀 Extension 작성

### 6.1 디렉토리 구조

```
my-project/
├── goondan.yaml
└── extensions/
    └── my-extension/
        ├── extension.yaml   # Extension 리소스 정의
        └── index.ts         # Extension 핸들러 구현
```

### 6.2 Extension 핸들러 작성

Extension은 `register` 함수를 export합니다. 이 함수에서 파이프라인 훅을 등록합니다.

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi } from '@goondan/core';

/**
 * Extension 등록 함수
 * 런타임 초기화 시 한 번 호출됩니다.
 */
export function register(api: ExtensionApi): void {
  const config = api.config;  // extension.yaml의 spec.config

  // Mutator: Tool Catalog에 동적 도구 추가
  api.pipelines.mutate('step.tools', async (ctx) => {
    return {
      ...ctx,
      toolCatalog: [
        ...ctx.toolCatalog,
        {
          name: 'dynamic.hello',
          description: '동적으로 추가된 인사 도구',
          parameters: { type: 'object', properties: {} },
        },
      ],
    };
  });

  // Middleware: LLM 호출 래핑 (로깅, 재시도 등)
  api.pipelines.wrap('step.llmCall', async (ctx, next) => {
    const startTime = Date.now();
    api.log.info(`LLM 호출 시작 (agent: ${ctx.agentName})`);

    try {
      const result = await next(ctx);
      const elapsed = Date.now() - startTime;
      api.log.info(`LLM 호출 완료 (${elapsed}ms)`);
      return result;
    } catch (error) {
      api.log.error(`LLM 호출 실패: ${String(error)}`);
      throw error;
    }
  });

  // Mutator: 컨텍스트 블록 추가
  api.pipelines.mutate('step.blocks', async (ctx) => {
    return {
      ...ctx,
      blocks: [
        ...ctx.blocks,
        {
          type: 'text',
          content: `현재 시간: ${new Date().toISOString()}`,
        },
      ],
    };
  });

  // 이벤트 구독
  api.events.on('turn.completed', (payload) => {
    api.log.info(`Turn 완료: ${JSON.stringify(payload)}`);
  });
}
```

### 6.3 Extension 리소스 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: my-extension
spec:
  runtime: node
  entry: "./extensions/my-extension/index.ts"
  config:
    logLevel: "info"
    customSetting: "value"
```

### 6.4 Agent에 Extension 연결

```yaml
kind: Agent
metadata:
  name: assistant
spec:
  # ...
  extensions:
    - { kind: Extension, name: my-extension }
```

### 6.5 ExtensionApi 주요 인터페이스

```typescript
interface ExtensionApi {
  /** Extension 설정 (spec.config) */
  config: JsonObject;

  /** 파이프라인 등록 */
  pipelines: {
    /** Mutator 등록 (순차 변형) */
    mutate(point: PipelinePoint, handler: Mutator): void;
    /** Middleware 등록 (래핑) */
    wrap(point: PipelinePoint, handler: Middleware): void;
  };

  /** 동적 Tool 등록 */
  tools: {
    register(toolDef: DynamicToolDef): void;
    unregister(name: string): void;
  };

  /** 이벤트 시스템 */
  events: {
    on(type: string, handler: EventHandler): void;
    emit(type: string, payload: JsonValue): void;
  };

  /** 상태 저장소 */
  state: {
    get(key: string): JsonValue | undefined;
    set(key: string, value: JsonValue): void;
  };

  /** 로깅 */
  log: Logger;
}
```

---

## 7. 커스텀 Connector 작성

### 7.1 Connector의 책임

Connector는 다음을 담당합니다:

1. **프로토콜 수신 선언**: 어떤 방식(HTTP, cron, CLI)으로 이벤트를 수신할지 선언
2. **이벤트 스키마 선언**: emit할 수 있는 이벤트의 이름과 속성 타입 선언
3. **이벤트 정규화**: 외부 페이로드를 ConnectorEvent로 변환
4. **서명 검증**: Connection이 제공한 시크릿으로 inbound 요청 검증

> 응답 전송은 Tool을 통해 처리합니다. Connector는 이벤트 수신/정규화에만 집중합니다.

### 7.2 디렉토리 구조

```
my-project/
├── goondan.yaml
└── connectors/
    └── webhook/
        ├── connector.yaml  # Connector 리소스 정의
        └── index.ts        # Entry Function (단일 default export)
```

### 7.3 Entry Function 작성

```typescript
// connectors/webhook/index.ts
import type { ConnectorContext } from '@goondan/core';

/**
 * Connector Entry Function
 * 단일 default export로 제공합니다.
 */
export default async function (context: ConnectorContext): Promise<void> {
  const { event, emit, verify, logger } = context;

  if (event.type !== "connector.trigger") return;
  if (event.trigger.type !== "http") return;

  const req = event.trigger.payload.request;

  // 서명 검증
  const signingSecret = verify?.webhook?.signingSecret;
  if (signingSecret) {
    const isValid = await verifySignature(req, signingSecret);
    if (!isValid) {
      logger.warn("서명 검증 실패");
      return;
    }
  }

  // ConnectorEvent 발행
  const body = req.body;
  await emit({
    type: "connector.event",
    name: "webhook_received",
    message: { type: "text", text: String(body.message) },
    properties: {
      session_id: String(body.sessionId),
    },
    auth: {
      actor: { id: `webhook:${body.userId}` },
      subjects: { global: "webhook:default" },
    },
  });
}
```

### 7.4 Connector 리소스 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: custom-webhook
spec:
  runtime: node
  entry: "./connectors/webhook/index.ts"
  triggers:
    - type: http
      endpoint:
        path: /webhook/custom
        method: POST
  events:
    - name: webhook_received
      properties:
        session_id: { type: string }
```

### 7.5 Connection 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: webhook-to-swarm
spec:
  connectorRef: { kind: Connector, name: custom-webhook }
  ingress:
    rules:
      - match:
          event: webhook_received
        route:
          agentRef: { kind: Agent, name: handler }
  verify:
    webhook:
      signingSecret:
        valueFrom:
          secretRef: { ref: "Secret/webhook-secret", key: "signing_secret" }
```

---

## 8. Bundle Package

### 8.1 Bundle Package란?

Bundle Package는 Tool, Extension, Connector 등의 리소스를 패키징하여 레지스트리에 배포하고, 다른 프로젝트에서 의존성으로 사용할 수 있는 단위입니다.

### 8.2 Package 생성

```bash
gdn init --package --name @myorg/my-tools
```

### 8.3 package.yaml 구조

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Bundle
metadata:
  name: "@myorg/my-tools"
  labels:
    tier: community
spec:
  version: "1.0.0"
  description: "유용한 도구 모음"
  resources:
    - "tools/*/tool.yaml"
    - "extensions/*/extension.yaml"
  dist: "./dist"
  dependencies:
    "@goondan/base": "^1.0.0"
```

### 8.4 패키지 배포

```bash
# 레지스트리 로그인
gdn package login

# 빌드 (TypeScript 사용 시)
npm run build

# 검증
gdn validate

# 발행
gdn package publish

# 베타 태그로 발행
gdn package publish --tag beta

# 시뮬레이션 (실제 발행하지 않음)
gdn package publish --dry-run
```

### 8.5 패키지 사용

```bash
# 의존성 추가
gdn package add @myorg/my-tools

# 의존성 설치
gdn package install

# 설치된 패키지 목록
gdn package list
```

추가된 패키지의 리소스는 자동으로 로드됩니다. `goondan.yaml`에서 바로 참조할 수 있습니다:

```yaml
kind: Agent
metadata:
  name: assistant
spec:
  tools:
    # @myorg/my-tools 패키지의 Tool 참조
    - { kind: Tool, name: myTool }
```

---

## 9. 샘플 모음

### 9.1 sample-6-cli-chatbot (초보자 권장)

가장 단순한 CLI 채팅봇입니다. Goondan을 처음 접하는 분에게 권장합니다.

**구성**: Model + Agent + Swarm + Connector + Connection (5개 리소스)
**학습 포인트**: 최소 리소스 구성, CLI Connector 사용법

```bash
cd packages/sample/sample-6-cli-chatbot
gdn run
```

### 9.2 sample-7-multi-model (멀티 모델)

여러 LLM 제공자의 모델을 조합하여 작업 성격에 따라 다른 에이전트에게 위임합니다.

**구성**: Anthropic + OpenAI 모델, Router/Creative-Writer/Analyst 에이전트
**학습 포인트**: 멀티 모델 조합, 에이전트 간 위임(delegate), 라우팅 패턴

```bash
cd packages/sample/sample-7-multi-model
export ANTHROPIC_API_KEY="..."
export OPENAI_API_KEY="..."
gdn run
```

### 9.3 sample-2-telegram-coder (Telegram 봇)

Telegram 봇을 통해 원격으로 코딩 작업을 수행하는 멀티 에이전트 스웜입니다.

**구성**: Planner/Coder/Reviewer 3개 에이전트, Telegram Connector + Connection
**학습 포인트**: 외부 채널 연동, ConnectorEvent 기반 라우팅, Static Token 인증

```bash
cd packages/sample/sample-2-telegram-coder
export TELEGRAM_BOT_TOKEN="..."
export ANTHROPIC_API_KEY="..."
gdn run
```

### 9.4 sample-3-self-evolving (자기 진화)

Changeset 기능으로 에이전트가 스스로 프롬프트와 설정을 수정합니다.

**구성**: evolving-agent + self-modify Tool + Changeset 정책
**학습 포인트**: Changeset 시스템, 자기 수정 패턴, 허용 파일 정책

```bash
cd packages/sample/sample-3-self-evolving
gdn run
```

### 9.5 sample-4-compaction (컨텍스트 압축)

긴 대화에서 컨텍스트 윈도우를 관리하는 Compaction Extension을 사용합니다.

**구성**: Extension으로 Token/Turn/Sliding Window 전략 설정
**학습 포인트**: Extension 작성, 파이프라인 훅, LLM 호출 래핑

```bash
cd packages/sample/sample-4-compaction
gdn run
```

### 9.6 sample-1-coding-swarm (코딩 스웜)

Planner/Coder/Reviewer 역할을 분담하는 코딩 에이전트 스웜입니다. Bundle Package로 배포 가능합니다.

**구성**: 3개 에이전트 협업, 파일 읽기/쓰기/bash 도구
**학습 포인트**: 멀티 에이전트 협업, 역할 분담, 도구 조합

### 9.7 sample-5-package-consumer (패키지 사용)

sample-1의 Bundle Package를 의존성으로 참조하는 예제입니다.

**학습 포인트**: Bundle Package 의존성 관리, 리소스 재사용, 오버라이드

---

## 10. FAQ & 트러블슈팅

### Q: `gdn run` 실행 시 "API key not found" 오류가 발생합니다.

A: Model 리소스에 지정한 provider에 맞는 API 키 환경 변수를 설정해야 합니다:

```bash
# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# OpenAI
export OPENAI_API_KEY="sk-..."

# Google
export GOOGLE_GENERATIVE_AI_API_KEY="..."
```

### Q: `gdn validate`에서 "File not found" 오류가 나옵니다.

A: `spec.entry`나 `prompts.systemRef`에 지정한 파일 경로가 실제로 존재하는지 확인하세요.
- Tool/Extension의 `spec.entry`는 Bundle Root(goondan.yaml이 있는 디렉터리) 기준 상대 경로입니다.
- 로컬 개발 시 `.ts`, 패키지 배포 시 `.js` 확장자를 사용합니다.

### Q: 여러 YAML 파일로 리소스를 분리할 수 있나요?

A: 가능합니다. 하나의 `goondan.yaml`에 모든 리소스를 `---`로 구분하여 정의할 수도 있고, 별도 YAML 파일로 분리할 수도 있습니다. Bundle Package의 `spec.resources` 또는 `spec.include`에 파일 경로를 나열하면 됩니다.

### Q: 에이전트 간 위임(delegate)은 어떻게 구현하나요?

A: 위임 도구(delegate Tool)를 만들어 Agent에 연결합니다. sample-7-multi-model이 이 패턴을 보여줍니다.

```yaml
# 위임 도구 정의
kind: Tool
metadata:
  name: delegate-tool
spec:
  runtime: node
  entry: "./tools/delegate/index.ts"
  exports:
    - name: agent.delegate
      description: "다른 에이전트에게 작업을 위임합니다."
      parameters:
        type: object
        properties:
          agentName:
            type: string
            description: "위임할 에이전트 이름"
          task:
            type: string
            description: "작업 내용"
        required: ["agentName", "task"]
```

### Q: 비밀 값(API 키 등)은 어떻게 관리하나요?

A: `ValueSource`를 사용하여 환경 변수나 비밀 저장소에서 주입합니다. YAML에 직접 비밀 값을 작성하지 마세요:

```yaml
# 환경 변수에서 주입 (권장)
auth:
  staticToken:
    valueFrom:
      env: "MY_API_TOKEN"

# 비밀 저장소에서 주입
auth:
  staticToken:
    valueFrom:
      secretRef:
        ref: "Secret/my-secret"
        key: "api_token"
```

### Q: `metadata.name` 명명 규칙은?

A: 영문 소문자, 숫자, 하이픈(`-`)만 사용하며, 영문 소문자로 시작해야 합니다. 최대 63자를 권장합니다.

```yaml
# 올바른 예시
metadata:
  name: slack-bot
  name: my-tool-v2
  name: planner-agent

# 잘못된 예시
metadata:
  name: SlackBot        # 대문자 불가
  name: _invalid        # 언더스코어/특수문자 불가
  name: -starts-hyphen  # 하이픈으로 시작 불가
```

### Q: 로그를 확인하려면?

A: `gdn logs` 명령어를 사용합니다:

```bash
# 현재 인스턴스 로그
gdn logs

# 실시간 스트리밍
gdn logs --follow

# 특정 에이전트 로그만
gdn logs --agent planner

# 메시지 로그만
gdn logs --type messages
```

### Q: Bundle을 배포하기 전에 검증하려면?

A: `gdn validate` 명령어로 스키마, 참조 무결성, 파일 존재 여부 등을 검증할 수 있습니다:

```bash
# 기본 검증
gdn validate

# 엄격 모드 (경고도 오류로 처리)
gdn validate --strict

# JSON 형식 출력
gdn validate --format json
```

---

## 참고 문서

- **스펙 문서**: `docs/specs/` 디렉터리의 상세 스펙
  - `resources.md` - 리소스 정의 스펙
  - `bundle.md` - Bundle YAML 스펙
  - `runtime.md` - Runtime 실행 모델
  - `pipeline.md` - 파이프라인 시스템
  - `tool.md` - Tool 시스템
  - `extension.md` - Extension 시스템
  - `connector.md` - Connector 시스템
  - `connection.md` - Connection 시스템
  - `cli.md` - CLI 명령어
  - `bundle_package.md` - Bundle Package
  - `oauth.md` - OAuth 시스템
  - `changeset.md` - Changeset 시스템
  - `workspace.md` - Workspace 모델
- **요구사항**: `docs/requirements/index.md`
- **패키지 소스**: `packages/core`, `packages/cli`, `packages/base`
- **샘플**: `packages/sample/`

---

**문서 버전**: v0.0.2
**최종 수정**: 2026-02-07
