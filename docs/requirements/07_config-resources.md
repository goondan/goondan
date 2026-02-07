## 7. Config 리소스 정의

예시는 `agents.example.io/v1alpha1`을 사용한다.

### 7.1 Model

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: openai-gpt-5
spec:
  provider: openai
  name: gpt-5
  endpoint: "https://..."   # 선택
  options: {}                 # 선택
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
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: slackToolkit
spec:
  runtime: node
  entry: "./tools/slack/index.js"
  errorMessageLimit: 1200

  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write"]

  exports:
    - name: slack.postMessage
      description: "메시지 전송"
      parameters:
        type: object
        additionalProperties: true
      auth:
        scopes: ["chat:write"]
```

규칙:

1. `spec.auth.oauthAppRef`가 존재하면 Runtime은 Tool 실행 컨텍스트에 `ctx.oauth`를 제공해야 한다(MUST).
2. Tool/export의 `auth.scopes`는 `OAuthApp.spec.scopes`의 부분집합이어야 하며, 로드 단계에서 검증해야 한다(MUST).
3. `errorMessageLimit` 미설정 시 기본값은 1000이어야 한다(MUST).

### 7.3 Extension

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
      repoSkillDirs: [".claude/skills", ".agents/skills"]
```

예시: MCP 연동 Extension

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
      command: ["npx", "-y", "@acme/github-mcp"]
    attach:
      mode: stateful
      scope: instance
    expose:
      tools: true
      resources: true
      prompts: true
```

### 7.4 Agent

Agent는 에이전트 실행을 구성하는 중심 리소스다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
spec:
  modelConfig:
    modelRef: { kind: Model, name: openai-gpt-5 }
    params:
      temperature: 0.5

  prompts:
    systemRef: "./prompts/planner.system.md"

  tools:
    - { kind: Tool, name: slackToolkit }

  extensions:
    - { kind: Extension, name: skills }
    - { kind: Extension, name: toolSearch }

  hooks:
    - id: notify-summary
      point: turn.post
      priority: 0
      action:
        runtime: node
        entry: "./hooks/notify-summary.js"
        export: default
        input:
          channel: { expr: "$.turn.origin.channel" }
          threadTs: { expr: "$.turn.origin.threadTs" }
          text: { expr: "$.turn.summary" }
```

#### 7.4.1 Hook Action 스키마

규칙:

1. `hooks[].action`은 "스크립트 실행 기술자"여야 하며, 직접 `toolCall` 스키마를 사용해서는 안 된다(MUST NOT).
2. Runtime은 `action.entry` 모듈의 `action.export` 함수를 호출하고 HookContext를 전달해야 한다(MUST).
3. `action.input`의 `expr`은 JSONPath 호환 부분집합으로 해석해야 하며, 해석 실패는 구조화된 훅 오류로 기록해야 한다(MUST).
4. Hook 스크립트는 필요 시 표준 API를 통해 도구 실행을 간접 호출할 수 있다(SHOULD).

#### 7.4.2 Agent 단위 ChangesetPolicy

Agent는 Swarm 정책을 더 좁게 제한하는 allowlist를 제공할 수 있다(MAY).

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
spec:
  changesets:
    allowed:
      files:
        - "prompts/**"
        - "resources/**"
```

규칙:

1. Agent 정책은 Swarm 정책의 추가 제약으로 해석해야 한다(MUST).
2. commit 허용 조건은 `Swarm.allowed ∩ Agent.allowed`를 만족해야 한다(MUST).

### 7.5 Swarm

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
  policy:
    maxStepsPerTurn: 32
    queueMode: serial
    lifecycle:
      autoPauseIdleSeconds: 3600
      ttlSeconds: 604800
      gcGraceSeconds: 86400
    changesets:
      enabled: true
      applyAt:
        - step.config
      allowed:
        files:
          - "resources/**"
          - "prompts/**"
          - "tools/**"
          - "extensions/**"
      emitRevisionChangedEvent: true
```

규칙:

1. `policy.queueMode`는 기본 `serial`이며, AgentInstance 큐는 FIFO 직렬 처리되어야 한다(MUST).
2. `policy.lifecycle`가 설정되면 Runtime은 pause/resume/terminate/delete/GC 정책에 반영해야 한다(SHOULD).
3. changeset commit 시 `allowed.files` 위반은 `status="rejected"`로 반환해야 한다(MUST).

### 7.6 Connector

Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 실행 패키지를 정의한다. entry 모듈은 단일 default export 함수를 제공한다. 인증 정보와 ingress 라우팅 규칙은 Connection에서 정의한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  runtime: node
  entry: "./connectors/slack/index.ts"
  triggers:
    - type: http
      endpoint:
        path: /webhook/slack/events
        method: POST
  events:
    - name: app_mention
      properties:
        channel_id: { type: string }
        ts: { type: string }
    - name: message.im
      properties:
        channel_id: { type: string }
```

규칙:

1. `spec.runtime`과 `spec.entry`는 필수이며, Runtime은 Connector 초기화 시 1회 로드해야 한다(MUST).
2. entry 모듈은 단일 default export 함수를 제공해야 한다(MUST).
3. `triggers`는 최소 1개 이상의 프로토콜 선언(`http`/`cron`/`cli`)을 포함해야 한다(MUST).
4. entry 함수는 ConnectorEvent를 `ctx.emit(...)`으로 Runtime에 전달해야 한다(MUST).
5. Connector는 Connection이 제공한 서명 시크릿을 사용하여 inbound 요청의 서명 검증을 수행해야 한다(MUST).
6. `events[].name`은 Connector 내에서 고유해야 한다(MUST).

### 7.7 Connection

Connection은 Connector를 실제 배포 환경에 바인딩하는 리소스다. 인증 정보 제공, ConnectorEvent 기반 ingress 라우팅 규칙, 서명 검증 시크릿 설정을 담당한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-main
spec:
  connectorRef: { kind: Connector, name: slack }

  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }

  ingress:
    rules:
      - match:
          event: app_mention
        route:
          agentRef: { kind: Agent, name: planner }
      - match:
          event: message.im
        route: {}  # entrypoint Agent로 라우팅

  verify:
    webhook:
      signingSecret:
        valueFrom:
          secretRef: { ref: "Secret/slack-webhook", key: "signing_secret" }
```

Static Token 예시:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: telegram-main
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
        route: {}
```

규칙:

1. `auth.oauthAppRef`와 `auth.staticToken`은 동시에 존재할 수 없다(MUST).
2. Connection은 Connector가 서명 검증에 사용할 시크릿을 제공해야 한다(MUST).
3. 서명 검증 실패 시 Connector는 ConnectorEvent를 emit하지 않아야 한다(MUST).
4. OAuth를 사용하는 Connection은 Turn 생성 시 필요한 `turn.auth.subjects` 키를 채워야 한다(MUST).
5. 하나의 trigger가 여러 ConnectorEvent를 emit하면 각 event는 독립 Turn으로 처리되어야 한다(MUST).
6. `ingress.rules[].match.event`는 Connector의 `events[].name`에 선언된 이름과 일치해야 한다(SHOULD).
7. `ingress.rules[].route.agentRef`가 생략되면 Swarm의 entrypoint Agent로 라우팅한다(MUST).

### 7.8 ResourceType / ExtensionHandler

ResourceType/ExtensionHandler는 사용자 정의 kind의 등록, 검증, 기본값, 런타임 변환을 지원한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: ResourceType
metadata:
  name: rag.acme.io/Retrieval
spec:
  group: rag.acme.io
  names:
    kind: Retrieval
    plural: retrievals
  versions:
    - name: v1alpha1
      served: true
      storage: true
  handlerRef: { kind: ExtensionHandler, name: retrieval-handler }
---
apiVersion: agents.example.io/v1alpha1
kind: ExtensionHandler
metadata:
  name: retrieval-handler
spec:
  runtime: node
  entry: "./extensions/retrieval/handler.js"
  exports: ["validate", "default", "materialize"]
```

### 7.9 OAuthApp

OAuthApp은 OAuth 클라이언트/엔드포인트/subject 모드를 정의한다. 실제 토큰 저장은 시스템 전역 OAuthStore에 속한다.

```yaml
apiVersion: agents.example.io/v1alpha1
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
    - "channels:read"

  redirect:
    callbackPath: "/oauth/callback/slack-bot"
```

규칙:

1. `flow=authorizationCode`는 Authorization Code + PKCE(S256)를 지원해야 한다(MUST).
2. `flow=deviceCode`는 선택 지원이며, 미지원 Runtime은 로드 단계에서 해당 구성을 거부해야 한다(MUST).
3. `subjectMode`에 필요한 subject 키가 Turn에 없으면 토큰 조회를 진행해서는 안 되며 구조화된 오류를 반환해야 한다(MUST).
4. 전역 토큰과 사용자 토큰은 별도 OAuthApp으로 분리하는 것을 권장한다(SHOULD).
