# Goondan Bundle YAML 스펙 (v0.8 구체화)

본 문서는 `goondan_spec.md`의 구성 스펙을 YAML 관점에서 구체화한 문서이다. 런타임/툴링/검증기는 본 문서를 기준으로 구조를 해석한다.

## 1. 공통 규칙

모든 리소스는 다음 필드를 반드시 포함한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: <Kind>
metadata:
  name: <string>
spec:
  ...
```

- `metadata.name`은 동일 네임스페이스 내에서 고유해야 한다.
- 하나의 YAML 파일에 여러 문서를 `---` 로 구분하여 포함할 수 있다.

## 2. ObjectRef

```yaml
# 문자열 축약
"Kind/name"

# 객체형
{ apiVersion: agents.example.io/v1alpha1, kind: Kind, name: name }
```

## 3. Selector + Overrides

```yaml
selector:
  kind: Tool
  matchLabels:
    tier: base
overrides:
  spec:
    runtime: node
```

- selector 블록은 선택형 리소스로 해석한다.
- 병합 규칙: 객체 재귀 병합, 스칼라 덮어쓰기, 배열 교체.

## 4. ValueSource

```yaml
value: "plain"
# 또는
valueFrom:
  env: "ENV_NAME"
# 또는
valueFrom:
  secretRef:
    ref: "Secret/name"
    key: "client_secret"
```

- `value`와 `valueFrom`은 동시에 존재할 수 없다.
- `valueFrom.env`와 `valueFrom.secretRef`는 동시에 존재할 수 없다.

## 5. Resource 정의

### 5.1 Model

```yaml
kind: Model
spec:
  provider: openai
  name: gpt-5
  endpoint: "https://..."   # 선택
  options: {}                # 선택
```

### 5.2 Tool

```yaml
kind: Tool
spec:
  runtime: node
  entry: "./tools/slack/index.ts"
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

규칙
- `spec.entry`는 필수.
- `exports`는 최소 1개.
- `auth.scopes`는 OAuthApp.spec.scopes의 부분집합이어야 한다.
- `errorMessageLimit`는 Tool 에러 메시지 최대 길이(문자 수)이며 기본값은 1000.

### 5.3 Extension

```yaml
kind: Extension
spec:
  runtime: node
  entry: "./extensions/skills/index.ts"
  config: {}
```

예시: MCP 연동 Extension

```yaml
kind: Extension
spec:
  runtime: node
  entry: "./extensions/mcp/index.ts"
  config:
    transport:
      type: stdio | http
      command: ["npx", "-y", "@acme/github-mcp"]   # stdio
      url: "https://mcp.example"                   # http
    attach:
      mode: stateful | stateless
      scope: instance | agent
    expose:
      tools: true
      resources: true
      prompts: true
```

### 5.4 Agent

```yaml
kind: Agent
spec:
  modelConfig:
    modelRef: { kind: Model, name: openai-gpt-5 }
    params:
      temperature: 0.5
  prompts:
    # 파일 참조
    systemRef: "./prompts/planner.system.md"
    # 또는 인라인 시스템 프롬프트
    # system: |
    #   너는 planner 에이전트다.
  tools:
    - { kind: Tool, name: slackToolkit }
  extensions:
    - { kind: Extension, name: skills }
    - { kind: Extension, name: mcp-github }
  hooks:
    - point: turn.post
      action:
        toolCall:
          tool: slack.postMessage
          input:
            channel: { expr: "$.turn.origin.channel" }
            threadTs: { expr: "$.turn.origin.threadTs" }
            text: { expr: "$.turn.summary" }
```

참고
- `hooks.point`에는 `step.llmError`를 포함해 Runtime 파이프라인 포인트를 사용할 수 있다.

### 5.5 Swarm

```yaml
kind: Swarm
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
  policy:
    maxStepsPerTurn: 32
    liveConfig:
      enabled: true
      store:
        instanceStateDir: "shared/state/instances/{{instanceId}}"
      applyAt: ["step.config"]
      allowedPaths:
        agentRelative:
          - "/spec/tools"
          - "/spec/extensions"
          - "/spec/hooks"
        swarmAbsolute:
          - "/spec/policy"
      emitConfigChangedEvent: true
```

### 5.6 Connector

```yaml
kind: Connector
spec:
  type: slack
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  ingress:
    - match:
        command: "/swarm"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
  egress:
    updatePolicy:
      mode: updateInThread
      debounceMs: 1500

# CLI connector 예시
kind: Connector
spec:
  type: cli
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"
```

규칙
- `oauthAppRef`와 `staticToken`은 동시에 설정할 수 없다.

### 5.7 OAuthApp

```yaml
kind: OAuthApp
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
    callbackPath: "/oauth/callback/slack-bot"
```

### 5.8 ResourceType / ExtensionHandler

```yaml
kind: ResourceType
spec:
  handlerRef: { kind: ExtensionHandler, name: retrieval-handler }

kind: ExtensionHandler
spec:
  runtime: node
  entry: "./extensions/retrieval/index.ts"
```

## 7. Validation 포인트 요약

- apiVersion/kind/metadata.name 필수
- ObjectRef는 유효한 리소스를 참조해야 한다.
- Tool/Export auth.scopes는 OAuthApp.spec.scopes의 부분집합이어야 한다.
- OAuthApp.flow=authorizationCode인 경우 authorizationUrl/tokenUrl/callbackPath 필수
- Connector auth는 oauthAppRef와 staticToken 중 하나만 허용
