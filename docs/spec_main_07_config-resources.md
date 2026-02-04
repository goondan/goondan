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
  endpoint: "https://..."     # 선택
  options: {...}              # 선택
```

### 7.2 Tool

Tool은 LLM에 노출되는 함수 엔드포인트를 포함한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: slackToolkit
spec:
  runtime: node
  entry: "./tools/slack/index.js"
  errorMessageLimit: 1200

  # 이 Tool이 기본적으로 사용하는 OAuthApp(선택)
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write"]  # 선택: OAuthApp.spec.scopes의 부분집합만 허용

  exports:
    - name: slack.postMessage
      description: "메시지 전송"
      parameters:
        type: object
        additionalProperties: true
      # export-level auth는 tool-level보다 좁게(부분집합으로)만 선언할 수 있다(선택).
      auth:
        scopes: ["chat:write"]
```

규칙:

1. `spec.auth.oauthAppRef`가 존재하면, Runtime은 Tool 실행 컨텍스트에 OAuth 토큰 조회 인터페이스(`ctx.oauth`)를 제공해야 한다(SHOULD).
2. Tool 또는 export가 `auth.scopes`를 선언하는 경우, Runtime은 그 값이 `OAuthApp.spec.scopes`의 부분집합인지 구성 로드/검증 단계에서 검사해야 하며, 부분집합이 아니면 구성을 거부해야 한다(MUST).
3. Tool/export의 `auth.scopes`는 “추가 권한 요청(증분)”을 의미하지 않으며, 선언된 OAuthApp 스코프 중에서 “더 좁은 범위로 제한”하는 의미로만 사용되어야 한다(MUST).
4. `spec.errorMessageLimit`는 Tool 오류 메시지의 최대 길이(문자 수)이며, 미설정 시 기본값은 1000이다(MUST).

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
      repoSkillDirs: [".claude/skills", ".agent/skills"]
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

Agent는 에이전트 실행을 구성하는 중심 리소스이다.

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
    # 파일 참조
    systemRef: "./prompts/planner.system.md"
    # 또는 인라인 시스템 프롬프트
    # system: |
    #   너는 planner 에이전트다.

  tools:
    - { kind: Tool, name: slackToolkit }

  extensions:
    - { kind: Extension, name: skills }
    - { kind: Extension, name: toolSearch }
    - { kind: Extension, name: mcp-github }

  hooks:
    - point: turn.post
      priority: 0
      action:
        toolCall:
          tool: slack.postMessage
          input:
            channel: { expr: "$.turn.origin.channel" }
            threadTs: { expr: "$.turn.origin.threadTs" }
            text: { expr: "$.turn.summary" }
```

#### 7.4.1 Agent 단위 ChangesetPolicy (MAY)

Agent는 Swarm의 changesets 정책을 **추가 제약(더 좁게)** 하는 allowlist를 제공할 수 있다(MAY).

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

* Swarm.allowed.files가 “최대 허용 범위”라면, Agent.allowed.files는 “해당 Agent의 추가 제약”으로 해석한다(MUST).
* 따라서 해당 Agent가 생성/커밋하는 changeset은 **Swarm.allowed + Agent.allowed 모두를 만족**해야 허용된다(MUST).

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
```

#### 7.5.1 Swarm ChangesetPolicy (MAY, 강력 권장)

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

* SwarmBundleManager는 changeset commit 시 변경된 파일 경로가 `allowed.files`에 포함되는지 검사해야 한다(MUST).
* 허용되지 않은 파일을 변경하려는 changeset commit은 `changeset-status`에 `result="rejected"`로 기록되어야 한다(MUST).

### 7.6 Connector

Connector는 외부 채널 이벤트를 수신하여 SwarmInstance/AgentInstance로 라우팅하고, 진행상황 업데이트와 완료 보고를 같은 맥락으로 송신한다.

Connector 인증은 두 가지 모드 중 하나로 구성할 수 있다.

1. OAuthApp 기반 모드(설치/승인 플로우를 통해 토큰을 획득)
2. Static Token 기반 모드(운영자가 발급한 토큰을 Secret으로 주입)

두 모드는 동시에 활성화될 수 없다(MUST).

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack-main
spec:
  type: slack

  # (선택) OAuthApp 기반 인증
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
```

Static Token 기반 모드 예시는 다음과 같다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack-main
spec:
  type: slack
  auth:
    staticToken:
      valueFrom:
        secretRef: { ref: "Secret/slack-bot-token", key: "bot_token" }
  ingress:
    - match:
        command: "/swarm"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
```

CLI Connector 예시는 다음과 같다.

```yaml
apiVersion: agents.example.io/v1alpha1
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
```

Connector의 trigger handler는 런타임 엔트리 모듈에서 export된 함수로 지정한다. 예를 들어, 트리거 핸들러로 `fooBarBaz`를 지정하면, 해당 함수가 엔트리 모듈에서 export되어야 한다.  
`triggers[].handler` MUST be the name of an exported function from `spec.runtime.entry`, and MUST NOT include module qualifiers such as `exports.` or file paths.

규칙:

1. `spec.auth.oauthAppRef`와 `spec.auth.staticToken`은 동시에 존재할 수 없다(MUST).
2. Connector는 ingress 이벤트를 Turn으로 변환할 때, Turn의 인증 컨텍스트(`turn.auth`)를 가능한 한 채워야 한다(SHOULD).
3. Slack Connector의 경우, `turn.auth.subjects.global`은 워크스페이스 단위 토큰 조회를 위해 `slack:team:<team_id>` 형태로 채우는 것을 권장하며, `turn.auth.subjects.user`는 사용자 단위 토큰 조회를 위해 `slack:user:<team_id>:<user_id>` 형태로 채우는 것을 권장한다(SHOULD).
4. Static Token 모드에서는 OAuth 승인 플로우를 수행하지 않으며, OAuthStore를 참조하지 않는다(MUST).
5. Connector trigger handler는 여러 개의 canonical event를 emit할 수 있으나, 각 event는 독립적인 Turn으로 처리되어야 한다(MUST).

---

#### 7.6.1 Trigger Handler Resolution and Loading

Connector는 `spec.runtime.entry`로 지정된 런타임 모듈을 로드한 뒤, `triggers[].handler`에 명시된 이름과 동일한 export를 조회하여 핸들러로 바인딩한다.

규칙:

1. Runtime은 Connector 초기화 시점에 entry 모듈을 단 한 번 로드해야 한다(MUST).
2. 하나의 Connector가 여러 trigger를 노출하더라도, 런타임 모듈은 공유 인스턴스로 유지되어야 한다(MUST).
3. 각 trigger는 자신의 `handler`에 해당하는 함수 레퍼런스를 통해 호출되며, 트리거 간 상태 공유 여부는 Connector 구현자가 결정한다(MAY).
4. 지정된 handler export가 존재하지 않으면 구성 로드 단계에서 오류로 처리해야 한다(MUST).

---

#### 7.6.2 Trigger Execution Model

Runtime은 ingress(예: webhook, cron, queue 등)에서 발생한 외부 이벤트를 Connector trigger로 변환하여 실행한다.
이때 모든 trigger handler는 동일한 실행 인터페이스를 가지며, 입력 이벤트의 종류는 공통 envelope로 추상화된다.

Trigger handler 호출 시 Runtime은 다음 정보를 주입해야 한다(MUST).

1. event: trigger 종류에 따른 입력 이벤트(Webhook, Cron 등)
2. connection: Connection 리소스에 정의된 파라미터(비밀값은 resolve된 상태)
3. ctx: 이벤트 발행, 로깅, OAuth, LiveConfig 제안 등을 포함한 실행 컨텍스트

Trigger handler는 외부 시스템 이벤트를 직접 AgentInstance로 전달하지 않고, 반드시 canonical event를 생성하여 `ctx.emit(...)`을 통해 Runtime으로 전달해야 한다(MUST).

### 7.8 ResourceType / ExtensionHandler

ResourceType과 ExtensionHandler는 사용자 정의 kind의 등록, 검증, 기본값, 런타임 변환을 지원하기 위한 구성 단위로 사용될 수 있다. 이 메커니즘은 특정 용도(프리셋 제공 등)에 한정되지 않으며, 다양한 도메인 리소스(예: Retrieval, Memory, Evaluator 등)를 정의하는 데 활용될 수 있다.

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

OAuthApp은 외부 시스템 OAuth 인증을 위한 클라이언트 및 엔드포인트를 정의한다. OAuthApp은 설정 리소스이며, 실제 토큰/그랜트 저장은 런타임의 시스템 전역 OAuthStore(§10.2, §12.5)에 속한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: OAuthApp
metadata:
  name: slack-bot
spec:
  provider: slack

  # authorizationCode | deviceCode
  flow: authorizationCode

  # global | user
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

  options:
    slack:
      tokenMode: "bot"
```

규칙:

1. Runtime은 `flow=authorizationCode`에 대해 **Authorization Code + PKCE(S256)**를 MUST 지원해야 한다.
2. Runtime은 `flow=deviceCode`를 MAY 지원할 수 있다. 미지원 시 `flow=deviceCode` 구성은 로드/검증 단계에서 거부되어야 한다(MUST).
3. `spec.subjectMode`는 Turn의 `turn.auth.subjects`에서 어떤 키를 subject로 사용할지 결정한다(MUST). 해당 키가 Turn에 없으면 오류로 처리해야 한다(MUST).
4. 전역 토큰과 사용자별 토큰이 의미적으로 다른 경우, 이를 하나의 OAuthApp으로 합치지 말고 서로 다른 OAuthApp으로 분리 등록하는 것을 권장한다(SHOULD).
