# 리소스 YAML 레퍼런스

> **apiVersion: `goondan.ai/v1`** -- 선언적 에이전트 스웜 구성을 위한 8종 리소스 Kind

[English version](./resources.md)

---

## 리소스 공통 구조

모든 Goondan 리소스는 동일한 4필드 구조를 따릅니다:

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <string>
  labels: {}          # 선택
  annotations: {}     # 선택
spec:
  # Kind별 스키마
```

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `apiVersion` | 필수 | `string` | 항상 `goondan.ai/v1` |
| `kind` | 필수 | `string` | 8종 Kind 중 하나 (아래 참조) |
| `metadata.name` | 필수 | `string` | 동일 Kind 내에서 고유. 소문자, 숫자, 하이픈 사용; 문자로 시작; 최대 63자 권장 |
| `metadata.labels` | 선택 | `Record<string, string>` | 미래 확장용 예약; 현재는 문서화 목적 |
| `metadata.annotations` | 선택 | `Record<string, string>` | 임의의 메타데이터; 런타임 동작에 영향 없음 |
| `spec` | 필수 | `object` | Kind별 구성 (아래 각 섹션 참조) |

### 지원 Kind

| Kind | 역할 |
|------|------|
| [Model](#model) | LLM 프로바이더 설정 |
| [Agent](#agent) | 에이전트 정의 (모델, 프롬프트, 도구, 익스텐션) |
| [Swarm](#swarm) | 에이전트 집합 + 실행 정책 |
| [Tool](#tool) | LLM이 호출하는 함수 |
| [Extension](#extension) | 라이프사이클 미들웨어 인터셉터 |
| [Connector](#connector) | 외부 프로토콜 수신 (별도 프로세스) |
| [Connection](#connection) | Connector-Swarm 바인딩 |
| [Package](#package) | 프로젝트 매니페스트 / 배포 단위 |

> Kind와 선언적 구성 모델의 개념적 소개는 [핵심 개념](../explanation/core-concepts.ko.md)을 참조하세요.

---

## ObjectRef

ObjectRef는 리소스 간 참조에 사용되는 패턴입니다.

### 문자열 축약형 (권장)

```yaml
modelRef: "Model/claude"
toolRef: "Tool/bash"
agentRef: "Agent/coder"
```

형식: `Kind/name`. 정확히 하나의 `/`를 포함해야 합니다.

### 객체형

```yaml
modelRef:
  kind: Model
  name: claude

# 패키지 간 참조
toolRef:
  kind: Tool
  name: bash
  package: "@goondan/base"
```

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `kind` | 필수 | `string` | 리소스 Kind |
| `name` | 필수 | `string` | 리소스 이름 |
| `package` | 선택 | `string` | 패키지 범위 (패키지 간 참조 시) |
| `apiVersion` | 선택 | `string` | API 버전 제약 |

### RefItem 래퍼

배열에서 참조를 사용할 때(예: `tools`, `agents`, `extensions`)에는 `ref` 키로 감쌉니다:

```yaml
tools:
  - ref: "Tool/bash"
  - ref: "Tool/file-system"
```

### 규칙

- 참조된 리소스가 반드시 존재해야 하며, 없으면 검증 오류입니다.
- 문자열 형식에서 `/`가 없거나 2개 이상이면 검증 오류입니다.

---

## ValueSource

ValueSource는 다양한 소스에서 설정 값을 주입하여 YAML 파일에 비밀값이 노출되지 않도록 합니다.

### 직접 값

```yaml
apiKey:
  value: "plain-text-value"
```

### 환경 변수 (권장)

```yaml
apiKey:
  valueFrom:
    env: "ANTHROPIC_API_KEY"
```

### 비밀 저장소 참조

```yaml
clientSecret:
  valueFrom:
    secretRef:
      ref: "Secret/slack-oauth"
      key: "client_secret"
```

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `value` | `valueFrom`과 상호배타 | `string` | 직접 리터럴 값 |
| `valueFrom.env` | `secretRef`와 상호배타 | `string` | 환경 변수 이름 |
| `valueFrom.secretRef.ref` | 필수 | `string` | `"Secret/<name>"` 형식 |
| `valueFrom.secretRef.key` | 필수 | `string` | 비밀 저장소 내 키 |

### 규칙

- `value`와 `valueFrom`은 동시에 존재할 수 없습니다.
- `valueFrom` 내에서 `env`와 `secretRef`는 동시에 존재할 수 없습니다.
- 민감한 값은 `value` 대신 `valueFrom`을 사용하는 것을 권장합니다.

---

## Model

Model은 LLM 프로바이더 설정을 정의합니다. 런타임은 프로바이더 차이를 추상화한 공통 호출 인터페이스를 제공합니다.

```yaml
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
```

### `spec` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `provider` | 필수 | `string` | -- | LLM 프로바이더 (`anthropic`, `openai`, `google` 등) |
| `model` | 필수 | `string` | -- | 모델 이름 (예: `claude-sonnet-4-20250514`, `gpt-5`) |
| `apiKey` | 선택 | [ValueSource](#valuesource) | -- | 인증용 API 키 |
| `endpoint` | 선택 | `string` | -- | 커스텀 엔드포인트 URL |
| `options` | 선택 | `Record<string, unknown>` | -- | 프로바이더별 추가 옵션 |
| `capabilities` | 선택 | `ModelCapabilities` | -- | 기능 플래그 (아래 참조) |

### `capabilities` 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `streaming` | `boolean` | 스트리밍 응답 지원 여부 |
| `toolCalling` | `boolean` | 도구 호출 지원 여부 |
| `[key]` | `boolean` | 확장 가능한 기능 플래그 |

### 확장 예제

```yaml
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: gpt
  labels:
    provider: openai
spec:
  provider: openai
  model: gpt-5
  apiKey:
    valueFrom:
      env: OPENAI_API_KEY
  endpoint: "https://api.openai.com/v1"
  options:
    organization: "org-xxxxx"
  capabilities:
    streaming: true
    toolCalling: true
```

---

## Agent

Agent는 에이전트 실행을 구성하는 중심 리소스입니다 -- 어떤 모델을 사용할지, 어떤 시스템 프롬프트를 따를지, 어떤 도구와 익스텐션을 로드할지를 정의합니다.

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
  tools:
    - ref: "Tool/bash"
    - ref: "Tool/file-system"
  extensions:
    - ref: "Extension/logging"
```

### `spec` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `modelConfig` | 필수 | `AgentModelConfig` | -- | 모델 설정 (아래 참조) |
| `prompts` | 필수 | `AgentPrompts` | -- | 프롬프트 설정 (아래 참조) |
| `tools` | 선택 | `RefItem[]` | `[]` | 이 에이전트에 제공할 Tool 참조 목록 |
| `requiredTools` | 선택 | `string[]` | `[]` | Turn 종료 전 반드시 성공 호출되어야 하는 도구 이름 목록 |
| `extensions` | 선택 | `RefItem[]` | `[]` | 이 에이전트에 로드할 Extension 참조 목록 |

### `modelConfig` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `modelRef` | 필수 | [ObjectRefLike](#objectref) | -- | Model 리소스 참조 |
| `params.temperature` | 선택 | `number` | -- | 샘플링 온도 (0.0 -- 2.0) |
| `params.maxTokens` | 선택 | `number` | -- | 최대 출력 토큰 수 |
| `params.topP` | 선택 | `number` | -- | Top-P 샘플링 |
| `params.[key]` | 선택 | `unknown` | -- | 추가 모델 파라미터 |

### `prompts` 필드

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `systemPrompt` | `systemPrompt` / `systemRef` 중 하나 이상 | `string` | 인라인 시스템 프롬프트 |
| `systemRef` | `systemPrompt` / `systemRef` 중 하나 이상 | `string` | 시스템 프롬프트 파일 경로 (Bundle Root 기준) |

둘 다 존재하면 `systemRef`의 내용이 `systemPrompt` 뒤에 이어 붙여집니다.

### 규칙

- `requiredTools` 항목은 전체 도구 이름을 사용합니다 (예: `channel-dispatch__send`).
- `requiredTools` 충족 여부는 turn 단위로 평가되며, 이전 turn의 성공 호출은 현재 turn을 충족시키지 않습니다.
- `requiredTools`는 `policy.maxStepsPerTurn`에 의해 제한됩니다 -- 필수 도구가 충족되지 않아도 step 한도에 도달하면 Turn이 종료됩니다.
- Agent에는 `hooks` 필드가 없습니다. 모든 라이프사이클 개입은 Extension 미들웨어를 통해 수행합니다.

---

## Swarm

Swarm은 에이전트 집합과 실행 정책을 정의합니다.

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
    shutdown:
      gracePeriodSeconds: 300
```

### `spec` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `entryAgent` | 필수 | [ObjectRefLike](#objectref) | -- | 인바운드 이벤트를 수신하는 기본 에이전트 |
| `agents` | 필수 | `RefItem[]` | -- | Agent 참조 목록 (최소 1개) |
| `instanceKey` | 선택 | `string` | `metadata.name` | 오케스트레이터 인스턴스 식별자 |
| `policy` | 선택 | `SwarmPolicy` | -- | 실행 정책 (아래 참조) |

### `policy` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `maxStepsPerTurn` | 선택 | `number` | `32` | Turn당 최대 Step 수; 도달 시 Turn 강제 종료 |
| `lifecycle.ttlSeconds` | 선택 | `number` | -- | 인스턴스 최대 수명 (초) |
| `lifecycle.gcGraceSeconds` | 선택 | `number` | -- | GC 유예 기간 (초) |
| `shutdown.gracePeriodSeconds` | 선택 | `number` | `300` | Graceful Shutdown 유예 기간 (초) |

### 규칙

- `entryAgent`는 반드시 `agents` 배열에 포함된 Agent를 참조해야 합니다.
- `instanceKey`가 생략되면 런타임은 `metadata.name`을 인스턴스 식별자로 사용합니다.
- `policy`는 `maxStepsPerTurn`, `lifecycle`, `shutdown` 하위 필드만 사용합니다.

> Orchestrator가 Swarm 정책을 어떻게 사용하는지는 [런타임 실행 모델](../explanation/runtime-model.ko.md)을 참조하세요.

---

## Tool

Tool은 LLM이 호출할 수 있는 함수를 정의합니다. Tool은 AgentProcess(Bun) 내부에서 실행됩니다. 각 Tool 리소스는 `exports` 배열을 통해 여러 하위 도구를 내보낼 수 있습니다.

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
spec:
  entry: "./tools/bash/index.ts"
  exports:
    - name: exec
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
```

### `spec` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `entry` | 필수 | `string` | -- | 엔트리 파일 경로 (Bundle Root 기준) |
| `errorMessageLimit` | 선택 | `number` | `1000` | LLM에 반환되는 오류 메시지 최대 문자 수 |
| `exports` | 필수 | `ToolExportSpec[]` | -- | 하위 도구 선언 (최소 1개) |

### `exports[]` 필드

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `name` | 필수 | `string` | 하위 도구 이름; Tool 리소스 내에서 고유 |
| `description` | 필수 | `string` | LLM에 표시되는 설명 |
| `parameters` | 필수 | JSON Schema `object` | 하위 도구의 파라미터 스키마 |

### 도구 이름 규칙

LLM에는 **`{Tool 이름}__{export 이름}`** (더블 언더스코어) 형식으로 노출됩니다:

```
Tool: bash       ->  exports: exec, script
LLM 도구 이름:  bash__exec,  bash__script
```

### 규칙

- Tool 리소스 이름과 export 이름에는 `__`가 포함되어서는 안 됩니다.
- `exports[].name`은 Tool 리소스 내에서 고유해야 합니다.
- entry 모듈은 반드시 `handlers: Record<string, ToolHandler>`를 export해야 합니다.

> 아키텍처 상세는 [Tool 시스템](../explanation/tool-system.ko.md)을, `ToolHandler` / `ToolContext` 인터페이스는 [Tool API](./tool-api.ko.md)를 참조하세요.

---

## Extension

Extension은 라이프사이클 미들웨어 인터셉터를 정의합니다. Extension은 AgentProcess(Bun) 내부에서 실행됩니다.

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

### `spec` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `entry` | 필수 | `string` | -- | 엔트리 파일 경로 (Bundle Root 기준) |
| `config` | 선택 | `Record<string, unknown>` | -- | Extension별 설정 (자유 형식) |

### entry 모듈 계약

entry 모듈은 반드시 `register(api: ExtensionApi)` 함수를 export해야 합니다:

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn', async (ctx) => {
    const result = await ctx.next();
    return result;
  });
}
```

### 규칙

- `runtime` 필드가 없습니다. Extension은 항상 Bun에서 실행됩니다.
- Extension은 `api.pipeline.register()`를 통해 `turn`, `step`, `toolCall` 미들웨어를 등록할 수 있습니다.
- Extension은 `api.tools.register()`를 통해 동적으로 도구를 등록할 수 있습니다.
- Extension은 `api.state.get()` / `api.state.set()`을 통해 JSON 기반 상태를 영속화할 수 있습니다.

> 아키텍처 상세는 [Extension 파이프라인](../explanation/extension-pipeline.ko.md)을, `ExtensionApi` 인터페이스는 [Extension API](./extension-api.ko.md)를 참조하세요.

---

## Connector

Connector는 외부 프로토콜 이벤트를 수신하여 정규화된 `ConnectorEvent`를 Orchestrator에 전달하는 독립 프로세스를 정의합니다. Connector는 프로토콜 처리(HTTP 서버, WebSocket, 폴링, cron 등)를 자체적으로 관리합니다.

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

### `spec` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `entry` | 필수 | `string` | -- | 엔트리 파일 경로 (Bundle Root 기준) |
| `events` | 필수 | `EventSchema[]` | -- | Connector가 발행할 수 있는 이벤트 스키마 (최소 1개) |

### `events[]` 필드

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `name` | 필수 | `string` | 이벤트 이름; Connector 내에서 고유 |
| `properties` | 선택 | `Record<string, { type: string }>` | 이벤트 속성 타입 선언 |

### entry 모듈 계약

entry 모듈은 반드시 단일 default export 함수를 제공해야 합니다:

```typescript
export default async function (ctx: ConnectorContext): Promise<void> {
  const { emit, config, secrets, logger } = ctx;

  Bun.serve({
    port: Number(config.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();
      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.message.text },
        properties: { chat_id: String(body.message.chat.id) },
        instanceKey: `telegram:${body.message.chat.id}`,
      });
      return new Response('OK');
    },
  });
}
```

### 규칙

- `runtime`이나 `triggers` 필드가 없습니다. Connector는 항상 별도 Bun 프로세스로 실행되며 프로토콜 처리를 자체적으로 관리합니다.
- `events[].name`은 Connector 내에서 고유해야 합니다.
- `ConnectorEvent`는 반드시 `instanceKey`를 포함하여 Orchestrator가 올바른 AgentProcess로 라우팅할 수 있게 해야 합니다.
- Connector는 Connection이 제공한 시크릿을 사용하여 서명 검증을 수행하는 것을 권장합니다.

> `ConnectorContext`와 `ConnectorEvent` 인터페이스는 [Connector API](./connector-api.ko.md)를 참조하세요.

---

## Connection

Connection은 Connector를 Swarm에 바인딩하여, 설정과 시크릿, 인그레스 라우팅 규칙을 제공합니다.

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-swarm
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"
  config:
    PORT:
      valueFrom:
        env: TELEGRAM_WEBHOOK_PORT
  secrets:
    BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: command
        route: {}
```

### `spec` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `connectorRef` | 필수 | [ObjectRefLike](#objectref) | -- | Connector 리소스 참조 |
| `swarmRef` | 선택 | [ObjectRefLike](#objectref) | Bundle 내 첫 번째 Swarm | Swarm 리소스 참조 |
| `config` | 선택 | `Record<string, ValueSource>` | -- | Connector에 전달되는 일반 설정 |
| `secrets` | 선택 | `Record<string, ValueSource>` | -- | Connector에 전달되는 민감값 (토큰, 서명 시크릿) |
| `ingress` | 선택 | `IngressConfig` | -- | 라우팅 규칙 (아래 참조) |

### `ingress.rules[]` 필드

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `match.event` | 권장 | `string` | 이벤트 이름 (`Connector.spec.events[].name`에 선언된 이름과 일치해야 함) |
| `match.properties` | 선택 | `Record<string, string>` | 속성 기반 매칭 (`event`와 AND 조건) |
| `route.agentRef` | 선택 | [ObjectRefLike](#objectref) | 대상 에이전트; 생략 시 Swarm의 `entryAgent`로 라우팅 |
| `route.instanceKey` | 선택 | `string` | 특정 대화 instanceKey를 강제 지정 |
| `route.instanceKeyProperty` | 선택 | `string` | 이벤트 properties에서 instanceKey를 읽을 키 |
| `route.instanceKeyPrefix` | 선택 | `string` | `instanceKeyProperty` 사용 시 접두어 |

### 규칙

- `route.instanceKey`와 `route.instanceKeyProperty`는 같은 규칙에서 동시에 사용할 수 없습니다.
- `route.agentRef`가 생략되면 이벤트는 Swarm의 `entryAgent`로 라우팅됩니다.
- `match`가 완전히 생략되면 해당 규칙은 catch-all로 동작합니다.
- 규칙은 순서대로 평가되며, 첫 번째 매칭 규칙이 적용됩니다.
- OAuth 인증은 Extension에서 처리하며, Connection은 관여하지 않습니다.

### 최소 예제 (CLI)

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: "Connector/cli"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route: {}
```

---

## Package

Package는 최상위 프로젝트 매니페스트입니다. 메타데이터, 버전, 의존성, 레지스트리 정보를 선언합니다.

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
    url: "https://goondan-registry.yechanny.workers.dev"
```

### `spec` 필드

| 필드 | 필수 여부 | 타입 | 기본값 | 설명 |
|------|----------|------|--------|------|
| `version` | 필수 (publish 시) | `string` | -- | Semver 버전 문자열 |
| `description` | 선택 | `string` | -- | 패키지 설명 |
| `access` | 선택 | `string` | `"public"` | `"public"` 또는 `"restricted"` |
| `dependencies` | 선택 | `PackageDependency[]` | `[]` | 패키지 의존성 (아래 참조) |
| `registry` | 선택 | `PackageRegistry` | -- | 레지스트리 설정 (아래 참조) |

### `dependencies[]` 필드

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `name` | 필수 | `string` | 패키지 이름 (스코프 포함 가능, 예: `@goondan/base`) |
| `version` | 필수 | `string` | Semver 범위 (예: `^1.0.0`) |

### `registry` 필드

| 필드 | 필수 여부 | 타입 | 설명 |
|------|----------|------|------|
| `url` | 필수 | `string` | 레지스트리 URL |

### 위치 규칙

- Package는 반드시 `goondan.yaml`의 **첫 번째 YAML 문서**에 위치해야 합니다.
- 같은 파일에 두 번째 `kind: Package` 문서가 있으면 검증 오류입니다.
- 하나의 `goondan.yaml`에 최대 하나의 Package 문서만 허용됩니다.
- 의존성은 반드시 DAG(비순환 그래프)를 형성해야 합니다 (순환 참조 금지).

---

## 검증 규칙 요약

### 공통 규칙

| 규칙 | 수준 |
|------|------|
| `apiVersion`은 `goondan.ai/v1`이어야 함 | 필수 |
| `kind`는 8종 Kind 중 하나여야 함 | 필수 |
| `metadata.name`은 비어있지 않아야 함 | 필수 |
| `metadata.name`은 동일 Kind 내에서 고유해야 함 | 필수 |
| 참조된 리소스(ObjectRef)가 존재해야 함 | 필수 |
| `value`와 `valueFrom`은 상호배타 | 필수 |
| `secretRef.ref`는 `Secret/<name>` 형식 | 필수 |

### Kind별 필수 필드

| Kind | 필수 필드 |
|------|----------|
| Model | `provider`, `model` |
| Agent | `modelConfig.modelRef`, `prompts` (systemPrompt 또는 systemRef) |
| Swarm | `entryAgent`, `agents` (최소 1개); `entryAgent`는 `agents`에 포함 |
| Tool | `entry`, `exports` (최소 1개) |
| Extension | `entry` |
| Connector | `entry`, `events` (최소 1개) |
| Connection | `connectorRef` |
| Package | `metadata.name`; 첫 번째 YAML 문서에만 위치; publish 시 `version` 필수 |

---

## 관련 문서

- [핵심 개념](../explanation/core-concepts.ko.md) -- Kind, ObjectRef, instanceKey의 개념적 개요
- [Tool API 레퍼런스](./tool-api.ko.md) -- `ToolHandler`, `ToolContext` 인터페이스
- [Extension API 레퍼런스](./extension-api.ko.md) -- `ExtensionApi` 인터페이스
- [Connector API 레퍼런스](./connector-api.ko.md) -- `ConnectorContext`, `ConnectorEvent` 인터페이스
- [CLI 레퍼런스](./cli-reference.ko.md) -- `gdn validate`, `gdn run` 등 명령어
- 내부 스펙 (SSOT): [resources.md](../../specs/resources.md), [shared-types.md](../../specs/shared-types.md), [bundle.md](../../specs/bundle.md)

---

_위키 버전: v0.0.3_
