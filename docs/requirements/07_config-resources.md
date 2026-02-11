## 7. Config 리소스 정의

모든 예시는 `goondan.ai/v1`을 사용한다. v2에서 지원하는 Kind는 8종: Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package.

### 7.1 Model

```yaml
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  endpoint: "https://..."   # 선택
  options: {}                 # 선택
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
  capabilities:
    streaming: true
    toolCalling: true
```

규칙:

1. Runtime은 provider 차이를 추상화한 공통 호출 인터페이스를 제공해야 한다(MUST).
2. 모델이 스트리밍을 지원하는 경우, Runtime은 스트리밍 응답을 표준 이벤트/콜백으로 전달할 수 있어야 한다(SHOULD).
3. provider 전용 옵션은 `spec.options`로 캡슐화해야 한다(MUST).
4. Agent가 요구하는 capability(`toolCalling`, `streaming` 등)를 모델이 선언하지 않은 경우, Runtime은 로드 단계에서 거부해야 한다(MUST).

### 7.2 Tool

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
  labels:
    tier: base
spec:
  entry: "./tools/bash/index.ts"      # Bun으로 실행
  errorMessageLimit: 1200

  exports:
    - name: exec                       # LLM에는 "bash__exec"로 노출
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
    - name: script                     # LLM에는 "bash__script"로 노출
      description: "스크립트 파일 실행"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: [path]
```

규칙:

1. `spec.entry`는 필수이며, Bun으로 실행되어야 한다(MUST). `runtime` 필드는 존재하지 않는다 (항상 Bun).
2. entry 모듈은 `handlers: Record<string, ToolHandler>` 형식으로 하위 도구 핸들러를 export해야 한다(MUST).
3. LLM에 노출되는 도구 이름은 `{Tool metadata.name}__{export name}` 형식이어야 한다(MUST). 구분자는 `__`(더블 언더스코어)를 사용한다.
4. `errorMessageLimit` 미설정 시 기본값은 1000이어야 한다(MUST).
5. `exports[].name`은 Tool 리소스 내에서 고유해야 한다(MUST).
6. Tool 리소스 이름과 export name에는 `__`가 포함되어서는 안 된다(MUST NOT).

### 7.3 Extension

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: logging
spec:
  entry: "./extensions/logging/index.ts"
  config:
    level: info
```

예시: Skill Extension

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: skills
spec:
  entry: "./extensions/skills/index.ts"
  config:
    discovery:
      repoSkillDirs: [".claude/skills", ".agents/skills"]
```

예시: MCP 연동 Extension

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: mcp-github
spec:
  entry: "./extensions/mcp/index.ts"
  config:
    transport:
      type: stdio
      command: ["npx", "-y", "@acme/github-mcp"]
    expose:
      tools: true
      resources: true
      prompts: true
```

규칙:

1. `spec.entry`는 필수이며, Bun으로 실행되어야 한다(MUST). `runtime` 필드는 존재하지 않는다 (항상 Bun).
2. entry 모듈은 `register(api: ExtensionApi)` 함수를 export해야 한다(MUST).
3. `spec.config`는 Extension에 전달될 사용자 정의 설정이며, 자유 형식이다(MAY).
4. Extension은 `api.pipeline.register()`를 통해 `turn`, `step`, `toolCall` 미들웨어를 등록할 수 있다(MAY).
5. Extension은 `api.tools.register()`를 통해 동적으로 도구를 등록할 수 있다(MAY).
6. Extension은 `api.state.get()`/`api.state.set()`을 통해 JSON 기반 상태를 영속화할 수 있다(MAY).

### 7.4 Agent

Agent는 에이전트 실행을 구성하는 중심 리소스다.

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coder
spec:
  modelConfig:
    modelRef: "Model/claude"
    params:
      temperature: 0.5

  prompts:
    systemPrompt: |
      You are a coding assistant.
    systemRef: "./prompts/coder.system.md"   # 선택: 외부 파일 참조

  tools:
    - ref: "Tool/bash"
    - ref: "Tool/file-system"
    - selector:
        kind: Tool
        matchLabels:
          tier: base

  extensions:
    - ref: "Extension/logging"
    - ref: "Extension/skills"
```

규칙:

1. `spec.modelConfig.modelRef`는 필수이며, 유효한 Model 리소스를 참조해야 한다(MUST).
2. `spec.prompts.systemPrompt`와 `spec.prompts.systemRef`가 모두 존재하면 `systemRef`의 내용이 `systemPrompt` 뒤에 이어 붙여져야 한다(MUST).
3. `spec.tools`는 ObjectRef 또는 Selector + Overrides 형식을 지원해야 한다(MUST).
4. `spec.extensions`는 ObjectRef 형식을 지원해야 한다(MUST).
5. Agent 리소스에는 hooks 필드가 존재하지 않는다. 모든 라이프사이클 개입은 Extension 미들웨어를 통해 구현해야 한다(MUST).

### 7.5 Swarm

```yaml
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
    - ref: "Agent/reviewer"
  policy:
    maxStepsPerTurn: 32
    lifecycle:
      ttlSeconds: 604800
      gcGraceSeconds: 86400
```

규칙:

1. `spec.entryAgent`는 필수이며, `spec.agents`에 포함된 유효한 Agent를 참조해야 한다(MUST).
2. `spec.agents`는 최소 1개 이상의 Agent 참조를 포함해야 한다(MUST).
3. `policy.maxStepsPerTurn`은 양의 정수여야 하며, Step 수가 이 값에 도달하면 Turn을 강제 종료해야 한다(MUST).
4. `policy.lifecycle`이 설정되면 Runtime은 인스턴스 TTL 및 GC 정책에 반영해야 한다(SHOULD).

### 7.6 Connector

Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 독립 프로세스를 정의한다. entry 모듈은 단일 default export 함수를 제공한다. Connector는 프로토콜 처리(HTTP 서버, cron 스케줄러, WebSocket 등)를 자체적으로 관리한다.

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: telegram
spec:
  entry: "./connectors/telegram/index.ts"
  events:
    - name: user_message
      properties:
        chat_id: { type: string }
    - name: command
      properties:
        chat_id: { type: string }
        command: { type: string }
```

규칙:

1. `spec.entry`는 필수이며, Bun으로 실행되어야 한다(MUST). `runtime` 필드는 존재하지 않는다 (항상 Bun).
2. entry 모듈은 단일 default export 함수를 제공해야 한다(MUST).
3. Connector는 별도 Bun 프로세스로 실행되며, 프로토콜 수신을 자체적으로 관리해야 한다(MUST). `triggers` 필드는 존재하지 않는다.
4. entry 함수는 ConnectorEvent를 `ctx.emit()`으로 Orchestrator에 전달해야 한다(MUST).
5. Connector는 Connection이 제공한 서명 시크릿을 사용하여 inbound 요청의 서명 검증을 수행해야 한다(MUST).
6. `events[].name`은 Connector 내에서 고유해야 한다(MUST).
7. ConnectorEvent는 `instanceKey`를 포함하여 Orchestrator가 적절한 AgentProcess로 라우팅할 수 있게 해야 한다(MUST).

### 7.7 Connection

Connection은 Connector를 실제 배포 환경에 바인딩하는 리소스다. 시크릿 제공, ConnectorEvent 기반 ingress 라우팅 규칙, 서명 검증 시크릿 설정을 담당한다.

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-swarm
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"

  secrets:
    botToken:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
    PORT:
      valueFrom:
        env: TELEGRAM_WEBHOOK_PORT

  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: command
        route: {}  # entryAgent로 라우팅

  verify:
    webhook:
      signingSecret:
        valueFrom:
          env: TELEGRAM_WEBHOOK_SECRET
```

규칙:

1. `spec.connectorRef`는 필수이며, 유효한 Connector 리소스를 참조해야 한다(MUST).
2. `spec.secrets`는 Connector 프로세스에 환경변수 또는 컨텍스트로 전달되어야 한다(MUST).
3. 서명 검증 실패 시 Connector는 ConnectorEvent를 emit하지 않아야 한다(MUST).
4. 하나의 trigger가 여러 ConnectorEvent를 emit하면 각 event는 독립 Turn으로 처리되어야 한다(MUST).
5. `ingress.rules[].match.event`는 Connector의 `events[].name`에 선언된 이름과 일치해야 한다(SHOULD).
6. `ingress.rules[].route.agentRef`가 생략되면 Swarm의 `entryAgent`로 라우팅한다(MUST).
7. OAuth 인증이 필요한 경우 Extension 내부에서 구현해야 한다. Connection은 OAuth를 직접 관리하지 않는다(MUST NOT).

### 7.8 Package

Package는 프로젝트의 최상위 매니페스트 리소스다. 의존성, 버전, 레지스트리 정보를 포함한다.

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-coding-swarm
spec:
  version: "1.0.0"
  description: "코딩 에이전트 스웜"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
  registry:
    url: "https://registry.goondan.ai"
```

규칙:

1. Package는 `goondan.yaml`의 첫 번째 YAML 문서로 정의되어야 한다(SHOULD).
2. `spec.version`은 Semantic Versioning을 따라야 한다(MUST).
3. `spec.dependencies`는 의존성 DAG를 형성하며, 순환 의존은 로드 단계에서 거부해야 한다(MUST).
4. 패키지 게시/폐기/인증은 별도 패키징 요구사항(@08_packaging.md)을 따른다.
