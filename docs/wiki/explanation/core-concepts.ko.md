# 핵심 개념

> Goondan의 선언형 구성 모델과 에이전트 스웜을 구성하는 빌딩 블록을 이해합니다.

[English version](./core-concepts.md)

---

## "Kubernetes for Agent Swarm" 철학

Goondan은 Kubernetes에서 직접적인 영감을 받았습니다. Kubernetes가 Pod, Service, Deployment를 YAML로 선언하면 클러스터가 현실을 그에 맞게 조정하듯이, Goondan에서는 **Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package**를 `goondan.yaml` 파일에 선언하면 런타임이 이를 실행합니다.

핵심 원칙은 **"What, not How"** 입니다:

- 당신은 _무엇을_ 원하는지 기술합니다 (이런 도구를 가진 에이전트, Telegram에 연결, Claude 사용).
- Goondan이 _어떻게_ 실행할지 결정합니다 (프로세스 생성, IPC 관리, 크래시 처리).

이 선언형 접근 방식은 에이전트 스웜 구성을 다음과 같이 만듭니다:

- **재현 가능** -- 동일한 YAML은 항상 동일한 동작을 생성합니다.
- **버전 관리 가능** -- 구성이 코드와 함께 소스 컨트롤에 저장됩니다.
- **이식 가능** -- 환경 간 이동 시 구조가 아닌 시크릿만 변경합니다.

---

## 리소스 모델

Goondan의 모든 구성 요소는 **리소스**입니다. 모든 리소스는 동일한 최상위 구조를 공유합니다:

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <string>
spec:
  # Kind별 필드
```

| 필드 | 용도 |
|------|------|
| `apiVersion` | 스키마 버전. 현재 모든 리소스에서 `goondan.ai/v1`. |
| `kind` | 리소스 유형. 8종의 알려진 Kind 중 하나. |
| `metadata.name` | 동일 Kind 내 고유한 이름 (소문자, 하이픈, 최대 63자 권장). |
| `spec` | Kind에 따라 달라지는 리소스의 구성. |

이 일관된 구조 덕분에 검증기, 로더, 편집기 등의 도구가 Kind별 세부 사항을 확인하기 전에 모든 리소스를 범용으로 처리할 수 있습니다.

> **Kubernetes 비유**: 모든 Kubernetes 오브젝트가 `apiVersion`, `kind`, `metadata`, `spec` (또는 `data`)을 갖는 것과 유사합니다. Kubernetes 매니페스트를 다뤄본 적이 있다면 Goondan의 리소스가 매우 익숙하게 느껴질 것입니다.

---

## 8종 리소스 Kind

Goondan은 정확히 **8종의 Kind**를 지원합니다. 각각은 시스템에서 고유한 역할을 담당합니다. 세 계층으로 나누어 볼 수 있습니다:

### 인프라 계층

| Kind | 역할 | Kubernetes 비유 |
|------|------|-----------------|
| **Model** | LLM 프로바이더 설정 (프로바이더, 모델명, API 키) | _StorageClass와 유사 -- 외부 기능을 선언_ |
| **Package** | 프로젝트 매니페스트, 의존성, 레지스트리 메타데이터 | _Helm 차트와 유사 -- 배포 가능한 단위_ |

### 에이전트 계층

| Kind | 역할 | Kubernetes 비유 |
|------|------|-----------------|
| **Agent** | 단일 에이전트 정의: 모델, 시스템 프롬프트, 도구, 익스텐션 | _Pod 스펙과 유사 -- 연산의 단위_ |
| **Swarm** | 에이전트들을 그룹화하고 실행 정책 설정 (진입 에이전트, 최대 스텝, 종료 정책) | _Deployment와 유사 -- Pod의 집합을 관리_ |

### 기능 계층

| Kind | 역할 | Kubernetes 비유 |
|------|------|-----------------|
| **Tool** | LLM이 호출할 수 있는 함수 (bash, file-system, HTTP fetch 등) | _사이드카 컨테이너와 유사 -- 기능을 제공_ |
| **Extension** | 라이프사이클 미들웨어 (로깅, 메시지 압축, 스킬 주입) | _Admission webhook과 유사 -- 동작을 가로채고 수정_ |
| **Connector** | 외부 프로토콜 이벤트 수신 (Telegram, Slack, CLI), 자체 프로세스로 실행 | _Ingress controller와 유사 -- 외부 트래픽을 연결_ |
| **Connection** | Connector를 Swarm에 바인딩, config/secrets/라우팅 규칙 포함 | _Ingress 리소스와 유사 -- 특정 controller에 대한 라우팅 정의_ |

### 관계 한눈에 보기

```
Package (프로젝트 매니페스트)
  └── 다른 Package에 의존

Swarm
  ├── agents: [Agent/coder, Agent/reviewer]
  ├── entryAgent: Agent/coder
  └── policy: { maxStepsPerTurn: 32 }

Agent
  ├── modelConfig.modelRef: Model/claude
  ├── tools: [Tool/bash, Tool/file-system]
  └── extensions: [Extension/logging]

Connection
  ├── connectorRef: Connector/telegram
  ├── swarmRef: Swarm/default
  ├── config: { PORT: ... }
  ├── secrets: { BOT_TOKEN: ... }
  └── ingress.rules: [...]
```

각 Kind의 전체 YAML 스키마는 [리소스 레퍼런스](../reference/resources.ko.md)를 참조하세요.

---

## ObjectRef: 리소스가 서로를 참조하는 방법

리소스는 독립적으로 존재하지 않습니다 -- Agent는 Model을 참조하고, Swarm은 Agent를 참조하며, Connection은 Connector를 참조합니다. Goondan은 **ObjectRef**를 이러한 관계를 표현하는 통합된 방법으로 사용합니다.

### 문자열 축약형 (권장)

```yaml
modelRef: "Model/claude"
toolRef: "Tool/bash"
agentRef: "Agent/coder"
```

형식은 항상 `Kind/name`입니다. 단순하고, 읽기 쉽고, 대부분의 경우 충분합니다.

### 객체형

다른 Package의 리소스를 참조해야 할 때는 객체형을 사용합니다:

```yaml
toolRef:
  kind: Tool
  name: bash
  package: "@goondan/base"
```

### RefItem 래퍼

배열(예: `Agent.spec.tools`나 `Swarm.spec.agents`)에서는 참조를 `ref` 속성으로 감쌉니다:

```yaml
tools:
  - ref: "Tool/bash"
  - ref: "Tool/file-system"
```

### 왜 중요한가

ObjectRef는 **참조 무결성**을 가능하게 합니다 -- 로더는 런타임이 시작되기 전에 참조된 모든 리소스가 실제로 존재하는지 검증합니다. `"Tool/bash"` 대신 `"Tool/bsh"`로 잘못 입력하면 런타임에서 알 수 없는 오류가 발생하는 대신 검증 시점에 명확한 오류를 받습니다.

```json
{
  "code": "E_CONFIG_REF_NOT_FOUND",
  "message": "Tool/bsh 참조를 찾을 수 없습니다.",
  "suggestion": "kind/name 또는 package 범위를 확인하세요."
}
```

> **Kubernetes 비유**: ObjectRef는 Kubernetes의 리소스 참조(`serviceAccountName`이나 `configMapRef` 등)에 해당하지만, 모든 Kind 타입에서 동작하는 통합된 문법을 가집니다.

---

## Selector와 Overrides

ObjectRef가 리소스를 참조하는 주요 방법이지만, Goondan은 더 유연한 리소스 매칭을 위해 **Selector with Overrides**도 지원합니다. Selector는 Kind와/또는 라벨로 리소스를 매칭할 수 있게 합니다:

```yaml
agents:
  - selector:
      kind: Agent
      matchLabels:
        role: reviewer
    overrides:
      spec:
        modelConfig:
          params:
            temperature: 0.2
```

이 접근 방식은 다음과 같은 경우에 유용합니다:

- 각각을 명시적으로 이름 지정하는 대신 **라벨로 리소스 그룹을 매칭**하고 싶을 때.
- 원래 정의를 수정하지 않고 매칭된 리소스의 **특정 필드를 오버라이드**하고 싶을 때.

> **참고**: 라벨 기반 선택은 고급 기능입니다. 대부분의 사용 사례에서는 직접적인 ObjectRef 참조(`ref: "Agent/coder"`)가 더 명확하고 권장됩니다.

---

## ValueSource: 설정값 주입

많은 리소스에는 민감한 데이터(API 키, 토큰)나 환경별 값이 필요합니다. YAML에 이들을 하드코딩하는 것은 보안 위험입니다. Goondan의 **ValueSource** 패턴은 값 자체를 내장하지 않고 값이 _어디서_ 오는지를 선언하여 이 문제를 해결합니다.

### 세 가지 소스

```yaml
# 1. 리터럴 값 (조심해서 사용 -- 시크릿에는 사용 자제)
apiKey:
  value: "sk-..."

# 2. 환경 변수 (권장)
apiKey:
  valueFrom:
    env: "ANTHROPIC_API_KEY"

# 3. 시크릿 저장소 참조
clientSecret:
  valueFrom:
    secretRef:
      ref: "Secret/slack-oauth"
      key: "client_secret"
```

### 상호 배타 규칙

- `value`와 `valueFrom`은 동시에 존재할 수 없습니다.
- `valueFrom` 내에서 `env`와 `secretRef`는 동시에 존재할 수 없습니다.
- `value`도 `valueFrom`도 제공되지 않으면 검증 오류가 발생합니다.

이 설계 덕분에 `goondan.yaml`에는 절대 원시 시크릿이 포함되지 않습니다. API 키는 `.env` 파일이나 외부 시크릿 저장소에 있고, YAML에는 참조만 담깁니다.

> **Kubernetes 비유**: ValueSource는 Kubernetes의 `valueFrom`에서 `secretKeyRef`와 `configMapKeyRef`와 같은 목적을 합니다 -- 시크릿 관리를 리소스 정의에서 분리합니다.

---

## instanceKey: 스웜 인스턴스 식별

에이전트 스웜이 메시지를 받으면 Goondan은 _어떤 대화_로 라우팅할지 알아야 합니다. 이것이 **instanceKey**가 하는 일입니다 -- 스웜의 실행 중인 인스턴스를 고유하게 식별합니다.

### instanceKey 결정 방법

```yaml
kind: Swarm
metadata:
  name: my-swarm
spec:
  instanceKey: "main"   # 명시적: "main" 사용
```

규칙은: **`Swarm.spec.instanceKey ?? Swarm.metadata.name`**

- `spec.instanceKey`가 설정되어 있으면 해당 값을 사용합니다.
- 생략되면 `metadata.name`이 instanceKey가 됩니다.

### 멀티 테넌트 시나리오에서의 instanceKey

채팅 기반 애플리케이션에서는 각 대화마다 고유한 인스턴스가 필요합니다. Connection의 ingress 규칙이 수신 이벤트에서 instanceKey를 도출할 수 있습니다:

```yaml
kind: Connection
metadata:
  name: telegram-connection
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - match:
          event: user_message
        route:
          instanceKeyProperty: "chat_id"     # 이벤트 properties에서 읽기
          instanceKeyPrefix: "telegram:"      # 결과: "telegram:12345"
```

이렇게 하면 각 Telegram 채팅이 동일한 스웜 정의를 공유하면서 자체적으로 격리된 대화 상태를 갖게 됩니다.

> **Kubernetes 비유**: instanceKey는 개념적으로 Kubernetes가 라벨이나 namespace+name으로 특정 Pod 인스턴스에 요청을 라우팅하는 방식과 유사합니다. 실행 중인 대화를 영속화된 상태에 연결하는 ID입니다.

---

## Bundle: YAML로 구성된 프로젝트

**Bundle**은 프로젝트에 정의된 리소스의 모음입니다. 기본 파일은 `goondan.yaml`이며, `---`(멀티 문서 YAML)로 구분된 여러 리소스를 포함할 수 있습니다:

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
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coder
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompt:
    system: "You are a coding assistant."
  tools:
    - ref: "Tool/bash"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
```

### 단일 파일을 넘어서

프로젝트가 커지면 리소스를 별도 파일로 분할할 수 있습니다. 번들 로더는 특정 파일명을 인식합니다:

```
my-swarm/
├── goondan.yaml        # Package + Swarm + Connection
├── models.yaml         # Model 리소스
├── agents.yaml         # Agent 리소스
├── tools/
│   └── tools.yaml      # Tool 리소스 정의
├── extensions/
│   └── extensions.yaml
└── connectors/
    └── connectors.yaml
```

인식되는 파일명에는 `goondan`, `model(s)`, `agent(s)`, `tool(s)`, `extension(s)`, `connector(s)`, `connection(s)`, `swarm(s)`, `resources`가 있습니다 (`.yaml` 또는 `.yml` 확장자).

### Fail-fast 검증

번들 로더는 런타임이 시작되기 전에 _모든 것을_ 검증합니다:

- 모든 `apiVersion` 값이 `goondan.ai/v1`이어야 합니다.
- 모든 ObjectRef가 존재하는 리소스로 해석되어야 합니다.
- 모든 `spec.entry` 경로가 존재하는 파일을 가리켜야 합니다.
- ValueSource 필드가 상호 배타 규칙을 따라야 합니다.

하나라도 검증이 실패하면 전체 번들이 거부됩니다 -- 부분 로딩은 없습니다. 이렇게 하면 잘못 구성된 리소스로 인한 미묘한 런타임 오류를 방지합니다.

---

## Package: 재사용 가능한 배포 단위

**Package**는 번들을 로컬 프로젝트에서 **공유 가능하고 버전 관리되는 단위**로 격상시킵니다. `goondan.yaml`의 첫 번째 문서에 `kind: Package`로 위치합니다:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-coding-swarm
spec:
  version: "1.0.0"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
---
# ... 이후 다른 리소스들
```

### Bundle vs. Package

| 관점 | Bundle | Package |
|------|--------|---------|
| **정의** | YAML 리소스 + 소스 파일의 모음 | 배포를 위한 메타데이터가 포함된 번들 |
| **필수?** | 예 -- 모든 프로젝트는 번들 | 아니오 -- Package 문서는 선택 사항 |
| **파일** | `goondan.yaml` (및 분할 파일) | `goondan.yaml`의 첫 번째 문서, `kind: Package` |
| **의존성** | 의존성 선언 불가 | `spec.dependencies` 선언 가능 |
| **게시** | 게시 불가 | 레지스트리에 게시 가능 |
| **버전 관리** | 버전 없음 | semver 사용 (`spec.version`) |
| **Package 없이** | `gdn run`과 `gdn validate` 정상 동작 | 해당 없음 |
| **Package 있으면** | 위의 모든 것에 더해... | 의존성 해석, `gdn package *` 명령, 레지스트리 게시 |

### 의존성 모델

Package는 다른 Package에 의존할 수 있습니다. 의존성 그래프는 **DAG**(순환 참조 없음)를 형성해야 합니다:

```yaml
spec:
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
    - name: "@myorg/custom-tools"
      version: "^2.0.0"
```

의존성은 `~/.goondan/packages/`에 설치되며, 로딩 중에 해당 리소스가 구성에 병합됩니다. 이름 충돌이 있으면 ObjectRef의 `package` 필드로 구분할 수 있습니다:

```yaml
tools:
  - kind: Tool
    name: bash
    package: "@goondan/base"
```

> **npm 비유**: Package 시스템은 npm과 매우 유사하게 동작합니다 -- 매니페스트(`package.json`과 유사), lockfile(`goondan.lock.yaml`), 레지스트리, 그리고 `gdn package add` / `gdn package install` / `gdn package publish` 명령이 있습니다.

---

## 모든 것을 합치면

핵심 개념을 모두 활용하는 최소한이지만 완전한 `goondan.yaml` 예시입니다:

```yaml
# 1. Package 매니페스트 (선택이지만 권장)
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-assistant
spec:
  version: "0.1.0"
  dependencies:
    - name: "@goondan/base"      # 재사용 가능한 도구 & 커넥터
      version: "^0.0.3"
---
# 2. Model -- LLM 프로바이더 설정
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:                    # ValueSource -- 시크릿을 절대 하드코딩하지 않음
      env: ANTHROPIC_API_KEY
---
# 3. Agent -- 연산의 단위
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"      # ObjectRef -- 위의 Model을 참조
  prompt:
    system: "You are a helpful assistant."
  tools:
    - ref: "Tool/bash"            # RefItem -- @goondan/base 의존성에서 가져옴
      package: "@goondan/base"
---
# 4. Swarm -- 에이전트를 정책과 함께 그룹화
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/assistant"   # ObjectRef -- agents 목록에 포함되어야 함
  agents:
    - ref: "Agent/assistant"
  policy:
    maxStepsPerTurn: 32
---
# 5. Connection -- Connector를 Swarm에 바인딩
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-connection
spec:
  connectorRef:
    kind: Connector
    name: cli
    package: "@goondan/base"      # 크로스 패키지 ObjectRef
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route: {}                 # entryAgent로 라우팅
```

이 YAML은 완전한 에이전트 스웜을 정의합니다: 셸 접근이 가능한 Claude 기반 어시스턴트로, CLI 입력을 통해 접근 가능합니다. `gdn run`으로 실행하면 Goondan이 나머지를 처리합니다 -- 프로세스 관리, IPC, 크래시 복구, 메시지 영속화까지.

---

## 더 읽기

- [리소스 레퍼런스](../reference/resources.ko.md) -- 8종 Kind의 전체 YAML 스키마
- [런타임 모델](./runtime-model.ko.md) -- Orchestrator, AgentProcess, IPC의 동작 방식
- [Tool 시스템](./tool-system.ko.md) -- 더블 언더스코어 네이밍, ToolContext, 도구 실행
- [Extension 파이프라인](./extension-pipeline.ko.md) -- 미들웨어 Onion 모델과 ConversationState
- [시작하기 (튜토리얼)](../tutorials/01-getting-started.ko.md) -- 실습 첫 프로젝트

---

_위키 버전: v0.0.3_
