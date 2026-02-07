# Goondan Bundle YAML 스펙 (v0.10)

본 문서는 `docs/requirements/index.md`(특히 6/7)의 구성 스펙을 YAML 관점에서 구체화한 문서이다. 런타임/툴링/검증기는 본 문서를 기준으로 구조를 해석한다.

---

## 1. 공통 규칙

### 1.1 리소스 기본 구조

모든 리소스는 다음 필드를 반드시 포함한다(MUST).

```yaml
apiVersion: agents.example.io/v1alpha1
kind: <Kind>
metadata:
  name: <string>
  labels: {}        # 선택
  annotations: {}   # 선택
spec:
  ...
```

### 1.2 apiVersion 형식 규칙

- **형식**: `<group>/<version>`
- **예시**: `agents.example.io/v1alpha1`, `rag.acme.io/v1beta1`
- **기본값**: `apiVersion`이 생략된 경우, 런타임은 `agents.example.io/v1alpha1`을 기본값으로 사용한다(SHOULD).
- **버전 구분**: `v1alpha1`, `v1beta1`, `v1` 등 Kubernetes 스타일 버전 명명을 따른다.

```yaml
# 권장: apiVersion 명시
apiVersion: agents.example.io/v1alpha1
kind: Model

# apiVersion 생략 시 기본값 적용 (권장하지 않음)
kind: Model
```

### 1.3 kind 목록

Goondan이 지원하는 기본 kind 목록은 다음과 같다.

| Kind | 설명 |
|------|------|
| `Model` | LLM 모델 설정 |
| `Tool` | LLM이 호출할 수 있는 도구 |
| `Extension` | 라이프사이클 파이프라인 확장 |
| `Agent` | 에이전트 실행 구성 |
| `Swarm` | 에이전트 집합과 실행 정책 |
| `Connector` | 외부 채널 연동 |
| `OAuthApp` | OAuth 인증 구성 |
| `ResourceType` | 사용자 정의 kind 등록 |
| `ExtensionHandler` | ResourceType 처리 핸들러 |
| `Bundle` | Bundle Package 매니페스트 |

### 1.4 metadata.name 유일성 규칙

- `metadata.name`은 **동일 kind 내에서 고유**해야 한다(MUST).
- 네임스페이스가 없는 경우, 전역 범위에서 고유성을 보장한다.
- **명명 규칙**: 소문자, 숫자, 하이픈(`-`)만 허용하며, 문자로 시작해야 한다(SHOULD).
- **최대 길이**: 63자를 초과해서는 안 된다(SHOULD).

```yaml
# 올바른 예시
metadata:
  name: slack-bot
  name: mcp-github-v2
  name: planner-agent

# 잘못된 예시 (검증 오류)
metadata:
  name: Slack_Bot      # 대문자, 언더스코어 사용
  name: -invalid       # 하이픈으로 시작
```

### 1.5 다중 YAML 문서 (---) 처리

- 하나의 YAML 파일에 여러 문서를 `---` 로 구분하여 포함할 수 있다(MAY).
- 각 문서는 독립적인 리소스로 해석된다(MUST).
- 문서 순서는 로딩 순서를 결정하지만, 참조 해석 순서에는 영향을 주지 않는다(SHOULD).
- 빈 문서(--- 만 있는 경우)는 무시한다(SHOULD).

```yaml
# goondan.yaml - 다중 문서 예시
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

---

apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    system: "너는 planner 에이전트다."

---

# 빈 문서는 무시됨
---

apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
```

### 1.6 metadata.labels와 annotations

```yaml
metadata:
  name: slack-toolkit
  labels:
    tier: base           # Selector에서 matchLabels로 선택 가능
    category: messaging
  annotations:
    description: "Slack 통합 도구 모음"
    version: "1.2.0"
```

- **labels**: Selector의 `matchLabels`에서 선택 기준으로 사용된다.
- **annotations**: 메타 정보 저장용으로, 런타임 동작에 영향을 주지 않는다.
- 키/값은 모두 문자열이어야 한다(MUST).

---

## 2. ObjectRef 상세

ObjectRef는 다른 리소스를 참조하는 방법을 정의한다.

### 2.1 지원 형식

```yaml
# 1. 문자열 축약 형식
"Kind/name"

# 2. 객체형 형식 (apiVersion 선택)
{ apiVersion: agents.example.io/v1alpha1, kind: Kind, name: name }

# 3. 객체형 형식 (apiVersion 생략)
{ kind: Kind, name: name }

# 4. 패키지 참조 형식 (Bundle Package 간 참조)
{ kind: Kind, name: name, package: package-name }
```

### 2.2 문자열 축약 형식 해석 규칙

문자열 축약 형식 `"Kind/name"`은 다음 규칙에 따라 해석된다(MUST).

1. `/` 를 구분자로 분리한다.
2. 첫 번째 부분을 `kind`로, 두 번째 부분을 `name`으로 해석한다.
3. `apiVersion`은 현재 문서의 `apiVersion` 또는 기본값을 사용한다.
4. `/`가 없거나 2개 이상이면 검증 오류로 처리한다(MUST).

```yaml
# 문자열 축약 형식 예시
tools:
  - Tool/fileRead           # kind: Tool, name: fileRead
  - Tool/slack-postMessage  # kind: Tool, name: slack-postMessage
  - Extension/skills        # kind: Extension, name: skills
  - Model/gpt-5             # kind: Model, name: gpt-5

# 잘못된 형식 (검증 오류)
tools:
  - fileRead                # kind 누락
  - Tool/slack/postMessage  # /가 2개 이상
  - Tool/                   # name 누락
```

### 2.3 객체형 형식 해석 규칙

객체형 형식은 더 명시적이며, 다음 규칙에 따라 해석된다(MUST).

```yaml
# 전체 형식
{ apiVersion: agents.example.io/v1alpha1, kind: Tool, name: fileRead }

# apiVersion 생략 (권장)
{ kind: Tool, name: fileRead }

# 단축 표기
{ kind: Tool, name: fileRead }
```

1. `kind`와 `name`은 필수이다(MUST).
2. `apiVersion` 생략 시 현재 문서의 apiVersion 또는 기본값(`agents.example.io/v1alpha1`)을 사용한다(SHOULD).
3. `package`는 Bundle Package 간 참조 시 참조 범위를 명시하는 데 사용할 수 있다(SHOULD).
4. `package` 외의 추가 필드는 무시한다(SHOULD).

### 2.4 apiVersion 생략 시 기본값 결정

apiVersion 생략 시 기본값 결정 순서:

1. 참조하는 리소스와 동일 파일 내에 있다면, 해당 문서의 apiVersion을 사용한다.
2. 동일 Bundle 내에 대상 리소스가 존재하면, 대상 리소스의 apiVersion을 사용한다.
3. 위 조건에 해당하지 않으면, `agents.example.io/v1alpha1`을 기본값으로 사용한다.

```yaml
# 예시: 동일 파일 내 참조
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
spec:
  modelConfig:
    # 동일 파일의 apiVersion(v1alpha1) 적용
    modelRef: { kind: Model, name: gpt-5 }
```

### 2.5 참조 무결성

- ObjectRef가 참조하는 대상 리소스는 존재해야 한다(MUST).
- 존재하지 않는 리소스를 참조하면 검증 오류로 처리한다(MUST).
- 순환 참조는 허용되지 않으며, 검증 단계에서 탐지해야 한다(SHOULD).

---

## 3. Selector + Overrides 상세

Selector는 라벨 기반으로 리소스를 선택하고, Overrides는 선택된 리소스의 설정을 덮어쓴다.

### 3.1 Selector 형식

```yaml
# 1. 단일 리소스 선택 (name 지정)
selector:
  kind: Tool
  name: fileRead

# 2. 라벨 기반 선택
selector:
  kind: Tool
  matchLabels:
    tier: base
    category: filesystem

# 3. kind만 지정 (해당 kind의 모든 리소스)
selector:
  kind: Tool
```

### 3.2 selector 해석 알고리즘

Selector 해석은 다음 단계를 따른다(MUST).

1. **kind 필터링**: `kind`가 지정되면 해당 kind의 리소스만 대상으로 한다.
2. **name 매칭**: `name`이 지정되면 정확히 일치하는 리소스 1개를 선택한다.
3. **matchLabels 매칭**: `matchLabels`가 지정되면 모든 라벨 조건을 만족하는 리소스를 선택한다.
4. **결과 집합**: 위 조건을 모두 만족하는 리소스 목록을 반환한다.

```yaml
# 예시: 복합 조건
selector:
  kind: Tool
  matchLabels:
    tier: base
    category: filesystem
# 결과: kind가 Tool이고, tier=base AND category=filesystem인 리소스들
```

### 3.3 matchLabels 매칭 규칙

- 모든 지정된 라벨이 일치해야 선택된다(AND 조건)(MUST).
- 라벨 값은 정확히 일치해야 한다(MUST).
- 대상 리소스에 추가 라벨이 있어도 무방하다.
- 라벨 키/값은 대소문자를 구분한다(MUST).

```yaml
# 리소스 정의
kind: Tool
metadata:
  name: fileRead
  labels:
    tier: base
    category: filesystem
    version: "2.0"

# 매칭 예시
selector:
  matchLabels:
    tier: base                    # 매칭됨 (부분 매칭)

selector:
  matchLabels:
    tier: base
    category: filesystem          # 매칭됨 (부분 매칭)

selector:
  matchLabels:
    tier: Base                    # 매칭 안됨 (대소문자 구분)

selector:
  matchLabels:
    tier: base
    nonexistent: value            # 매칭 안됨 (없는 라벨)
```

### 3.4 overrides 병합 알고리즘 상세

overrides는 선택된 리소스의 `spec`을 부분적으로 덮어쓴다.

**병합 규칙(MUST)**:

1. **객체(Object)**: 재귀적으로 병합한다. 양쪽에 동일 키가 있으면 overrides 값이 우선한다.
2. **스칼라(Scalar)**: overrides 값으로 완전히 덮어쓴다.
3. **배열(Array)**: overrides 배열로 완전히 교체한다(병합하지 않음).
4. **null 값**: 명시적 null은 해당 필드를 제거한다(SHOULD).

```yaml
# 원본 리소스
kind: Tool
metadata:
  name: calculator
spec:
  runtime: node
  entry: "./tools/calc/index.ts"
  errorMessageLimit: 1000
  exports:
    - name: calc.add
      description: "덧셈"
    - name: calc.multiply
      description: "곱셈"
  config:
    precision: 10
    enableLogging: true

# Selector + Overrides 적용
- selector:
    kind: Tool
    name: calculator
  overrides:
    spec:
      errorMessageLimit: 2000              # 스칼라: 덮어쓰기
      exports:                              # 배열: 전체 교체
        - name: calc.add
          description: "두 수를 더함"
      config:
        precision: 15                       # 객체 내 스칼라: 덮어쓰기
        # enableLogging은 유지됨 (재귀 병합)

# 결과
spec:
  runtime: node                             # 유지
  entry: "./tools/calc/index.ts"           # 유지
  errorMessageLimit: 2000                   # 덮어쓰기됨
  exports:                                  # 전체 교체됨
    - name: calc.add
      description: "두 수를 더함"
  config:
    precision: 15                           # 덮어쓰기됨
    enableLogging: true                     # 유지됨
```

### 3.5 Selector + Overrides 사용 위치

Selector + Overrides는 다음 위치에서 사용할 수 있다.

```yaml
# Agent의 tools/extensions에서 사용
kind: Agent
spec:
  tools:
    # 직접 참조
    - { kind: Tool, name: fileRead }

    # Selector + Overrides
    - selector:
        kind: Tool
        matchLabels:
          tier: base
      overrides:
        spec:
          errorMessageLimit: 2000

  extensions:
    - selector:
        kind: Extension
        matchLabels:
          category: context
      overrides:
        spec:
          config:
            maxTokens: 16000
```

---

## 4. ValueSource 상세

ValueSource는 설정 값을 다양한 소스에서 가져오는 패턴을 정의한다. OAuthApp의 clientId/clientSecret, Connector의 staticToken 등에서 사용된다.

### 4.1 지원 형식

```yaml
# 1. 직접 값 지정
value: "plain-text-value"

# 2. 환경변수에서 가져오기
valueFrom:
  env: "ENV_VAR_NAME"

# 3. 비밀 저장소에서 가져오기
valueFrom:
  secretRef:
    ref: "Secret/secret-name"
    key: "field-key"
```

### 4.2 상호 배타 규칙

1. `value`와 `valueFrom`은 동시에 존재할 수 없다(MUST).
2. `valueFrom` 내에서 `env`와 `secretRef`는 동시에 존재할 수 없다(MUST).
3. 둘 다 없으면 검증 오류로 처리한다(MUST).

```yaml
# 올바른 예시
client:
  clientId:
    value: "my-client-id"              # 직접 지정
  clientSecret:
    valueFrom:
      env: "OAUTH_CLIENT_SECRET"       # 환경변수

# 잘못된 예시 (검증 오류)
client:
  clientId:
    value: "my-client-id"
    valueFrom:                         # value와 valueFrom 동시 사용
      env: "CLIENT_ID"

# 잘못된 예시 (검증 오류)
client:
  clientSecret:
    valueFrom:
      env: "SECRET"                    # env와 secretRef 동시 사용
      secretRef:
        ref: "Secret/oauth"
        key: "secret"
```

### 4.3 value 직접 지정

```yaml
# 단순 문자열
value: "plain-text-value"

# 빈 문자열
value: ""

# 숫자 (문자열로 변환)
value: "12345"
```

**보안 권고**: 비밀값(토큰, 시크릿)을 `value`로 직접 지정하지 않는다(SHOULD NOT). 대신 `valueFrom.env` 또는 `valueFrom.secretRef`를 사용한다.

### 4.4 valueFrom.env 환경변수 해석

```yaml
valueFrom:
  env: "SLACK_CLIENT_ID"
```

**해석 규칙(MUST)**:

1. 런타임은 시작 시점에 해당 환경변수를 조회한다.
2. 환경변수가 존재하면 그 값을 사용한다.
3. 환경변수가 존재하지 않으면:
   - 필수 필드인 경우: 구성 로드 단계에서 오류로 처리한다(MUST).
   - 선택 필드인 경우: 해당 필드를 미설정 상태로 둔다(SHOULD).

```yaml
# 예시: OAuthApp clientId
spec:
  client:
    clientId:
      valueFrom:
        env: "SLACK_CLIENT_ID"         # 환경변수 SLACK_CLIENT_ID 필요
```

### 4.5 valueFrom.secretRef 비밀 저장소 해석

```yaml
valueFrom:
  secretRef:
    ref: "Secret/slack-oauth"
    key: "client_secret"
```

**secretRef.ref 형식 규칙(MUST)**:

1. 형식: `"Secret/<name>"`
2. `Secret`은 런타임이 제공하는 비밀 저장소 엔트리를 가리키는 예약된 kind이다.
3. `<name>`은 비밀 저장소 내 엔트리 이름이다.

**secretRef.key 규칙(MUST)**:

1. 비밀 저장소 엔트리 내 특정 필드를 지정한다.
2. 해당 키가 존재하지 않으면 구성 로드 단계에서 오류로 처리한다(MUST).

### 4.6 Secret/<name> 형식 해석

```yaml
# secretRef 참조
valueFrom:
  secretRef:
    ref: "Secret/slack-oauth"    # Secret kind, name=slack-oauth
    key: "client_secret"
```

**저장소 위치(SHOULD)**:

런타임은 `<stateRootDir>/secrets/<name>.json` 경로에서 비밀 엔트리를 조회한다.

```json
// ~/.goondan/secrets/slack-oauth.json
{
  "client_secret": "xoxb-secret-value",
  "signing_secret": "another-secret"
}
```

**보안 요구사항(MUST)**:

1. 비밀 저장소 파일은 at-rest encryption을 적용해야 한다.
2. 비밀값은 로그, 이벤트 payload, LLM 컨텍스트에 평문으로 노출되어서는 안 된다.

---

## 5. Resource 정의

### 5.1 Model

Model은 LLM 모델 설정을 정의한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: openai-gpt-5
  labels:
    provider: openai
    tier: premium
spec:
  # 필수 필드
  provider: openai                     # openai | anthropic | google | azure | custom
  name: gpt-5                          # 모델 식별자 (provider에서 사용하는 이름)

  # 선택 필드
  endpoint: "https://api.openai.com/v1"    # 커스텀 엔드포인트 (선택)

  options:                             # provider별 옵션 (선택)
    organization: "org-abc123"
    timeout: 30000
    maxRetries: 3

  capabilities:                        # 모델 기능 선언 (선택)
    streaming: true
    toolCalling: true
```

#### 5.1.1 Model 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `spec.provider` | Y | string | LLM 제공자. `openai`, `anthropic`, `google`, `azure`, `custom` 중 하나 |
| `spec.name` | Y | string | 모델 식별자. 예: `gpt-5`, `claude-sonnet-4-5`, `gemini-2.0-pro` |
| `spec.endpoint` | N | string | 커스텀 API 엔드포인트 URL |
| `spec.options` | N | object | provider별 추가 옵션 |
| `spec.capabilities` | N | object | 모델 기능 플래그 (`streaming`, `toolCalling` 등) |

#### 5.1.2 지원 provider 목록

| Provider | SDK 매핑 | 설명 |
|----------|----------|------|
| `openai` | `@ai-sdk/openai` | OpenAI API |
| `anthropic` | `@ai-sdk/anthropic` | Anthropic Claude API |
| `google` | `@ai-sdk/google` | Google Generative AI |
| `azure` | `@ai-sdk/azure` | Azure OpenAI Service |
| `custom` | 구현 선택 | 커스텀 provider |

#### 5.1.3 Model 예시

```yaml
# OpenAI GPT-5
kind: Model
metadata:
  name: gpt-5
spec:
  provider: openai
  name: gpt-5
  options:
    organization: "org-abc123"
  capabilities:
    streaming: true
    toolCalling: true

---

# Anthropic Claude
kind: Model
metadata:
  name: claude-sonnet
spec:
  provider: anthropic
  name: claude-sonnet-4-5
  capabilities:
    streaming: true
    toolCalling: true

---

# Azure OpenAI
kind: Model
metadata:
  name: azure-gpt4
spec:
  provider: azure
  name: gpt-4
  endpoint: "https://myinstance.openai.azure.com"
  options:
    apiVersion: "2024-02-15-preview"
    deploymentName: "gpt-4-deployment"

---

# Custom endpoint
kind: Model
metadata:
  name: local-llm
spec:
  provider: custom
  name: llama-70b
  endpoint: "http://localhost:8080/v1"
```

### 5.2 Tool

Tool은 LLM이 호출할 수 있는 함수 엔드포인트를 정의한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: slackToolkit
  labels:
    tier: base
    category: messaging
spec:
  # 필수 필드
  runtime: node                        # node | python | deno
  entry: "./tools/slack/index.ts"      # 엔트리 파일 경로 (Bundle root 기준)

  # 선택 필드
  errorMessageLimit: 1200              # 오류 메시지 최대 길이 (기본: 1000)

  # OAuth 인증 설정 (선택)
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write", "channels:read"]    # OAuthApp.spec.scopes의 부분집합

  # 필수: 최소 1개의 export
  exports:
    - name: slack.postMessage
      description: "Slack 채널에 메시지를 전송합니다."
      parameters:
        type: object
        properties:
          channel:
            type: string
            description: "대상 채널 ID"
          text:
            type: string
            description: "전송할 메시지 내용"
        required: ["channel", "text"]

      # export-level auth (선택): tool-level보다 좁은 범위만 허용
      auth:
        scopes: ["chat:write"]

    - name: slack.getChannelInfo
      description: "채널 정보를 조회합니다."
      parameters:
        type: object
        properties:
          channel:
            type: string
            description: "조회할 채널 ID"
        required: ["channel"]
      auth:
        scopes: ["channels:read"]
```

#### 5.2.1 Tool 필드 상세

| 필드 | 필수 | 타입 | 기본값 | 설명 |
|------|------|------|--------|------|
| `spec.runtime` | Y | string | - | 런타임 환경. `node`, `python`, `deno` |
| `spec.entry` | Y | string | - | 엔트리 파일 경로 (Bundle root 기준) |
| `spec.errorMessageLimit` | N | number | 1000 | 오류 메시지 최대 길이 (문자 수) |
| `spec.auth` | N | object | - | OAuth 인증 설정 |
| `spec.auth.oauthAppRef` | N | ObjectRef | - | 사용할 OAuthApp 참조 |
| `spec.auth.scopes` | N | string[] | - | 요청 스코프 (OAuthApp.spec.scopes의 부분집합) |
| `spec.exports` | Y | array | - | 노출할 함수 목록 (최소 1개) |

#### 5.2.2 exports 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `exports[].name` | Y | string | 도구 이름 (LLM이 호출할 때 사용) |
| `exports[].description` | Y | string | 도구 설명 (LLM에게 제공) |
| `exports[].parameters` | Y | object | JSON Schema 형식의 파라미터 정의 |
| `exports[].auth` | N | object | export-level 인증 설정 |
| `exports[].auth.scopes` | N | string[] | 이 export에 필요한 스코프 |

#### 5.2.3 auth.scopes 검증 규칙

**Tool-level scopes 검증(MUST)**:

```yaml
# OAuthApp 정의
kind: OAuthApp
metadata:
  name: slack-bot
spec:
  scopes: ["chat:write", "channels:read", "users:read"]

---

# Tool 정의 - 올바른 예시
kind: Tool
metadata:
  name: slackToolkit
spec:
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write", "channels:read"]    # OAuthApp.scopes의 부분집합 - OK

---

# Tool 정의 - 검증 오류
kind: Tool
metadata:
  name: slackToolkit-invalid
spec:
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write", "files:write"]      # files:write는 OAuthApp에 없음 - ERROR
```

**Export-level scopes 검증(MUST)**:

```yaml
kind: Tool
spec:
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write", "channels:read"]

  exports:
    # 올바른 예시: tool-level scopes의 부분집합
    - name: slack.postMessage
      auth:
        scopes: ["chat:write"]                  # OK

    # 검증 오류: tool-level에 없는 scope
    - name: slack.uploadFile
      auth:
        scopes: ["files:write"]                 # ERROR: tool-level에 없음
```

#### 5.2.4 errorMessageLimit 적용

```yaml
kind: Tool
spec:
  errorMessageLimit: 500    # 오류 메시지를 500자로 제한
```

Runtime은 Tool 실행 중 오류 발생 시:
1. `error.message`를 `errorMessageLimit` 길이로 truncate한다(MUST).
2. 기본값 1000을 초과하는 메시지는 잘린다.
3. 잘린 메시지는 `...` 등으로 표시할 수 있다(MAY).

### 5.3 Extension

Extension은 런타임 라이프사이클에 개입하는 확장 로직을 정의한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: skills
  labels:
    category: context
spec:
  # 필수 필드
  runtime: node
  entry: "./extensions/skills/index.ts"

  # 선택 필드
  config:                              # 확장별 설정
    discovery:
      repoSkillDirs: [".claude/skills", ".agent/skills"]
    indexing:
      enabled: true
      maxDepth: 3
```

#### 5.3.1 Extension 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `spec.runtime` | Y | string | 런타임 환경. `node`, `python`, `deno` |
| `spec.entry` | Y | string | 엔트리 파일 경로 (Bundle root 기준) |
| `spec.config` | N | object | 확장별 설정 (확장 구현에서 해석) |

#### 5.3.2 MCP 연동 Extension config 상세

MCP(Model Context Protocol) 연동 Extension은 다음 config 구조를 따른다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: mcp-github
spec:
  runtime: node
  entry: "./extensions/mcp/index.ts"
  config:
    # transport 설정 (필수)
    transport:
      type: stdio                      # stdio | http

      # stdio 전용
      command: ["npx", "-y", "@acme/github-mcp"]
      args: []                         # 추가 인자 (선택)
      env:                             # 환경변수 (선택)
        GITHUB_TOKEN: "${GITHUB_TOKEN}"
      cwd: "/workspace"                # 작업 디렉터리 (선택)

      # http 전용 (대안)
      # url: "https://mcp.example.com/github"
      # headers:                       # 요청 헤더 (선택)
      #   Authorization: "Bearer ${TOKEN}"

    # attach 설정 (선택)
    attach:
      mode: stateful                   # stateful | stateless
      scope: instance                  # instance | agent

      # stateful 전용
      reconnect:
        enabled: true
        maxRetries: 3
        backoffMs: 1000

    # expose 설정 (선택)
    expose:
      tools: true                      # MCP tools 노출
      resources: true                  # MCP resources 노출
      prompts: true                    # MCP prompts 노출

      # 필터링 (선택)
      toolsFilter:
        include: ["github.*"]          # 포함할 패턴
        exclude: ["github.admin.*"]    # 제외할 패턴
```

##### transport 설정

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `transport.type` | Y | string | `stdio` 또는 `http` |
| `transport.command` | stdio | string[] | 실행할 명령어 |
| `transport.args` | N | string[] | 추가 인자 |
| `transport.env` | N | object | 환경변수 |
| `transport.cwd` | N | string | 작업 디렉터리 |
| `transport.url` | http | string | MCP 서버 URL |
| `transport.headers` | N | object | HTTP 요청 헤더 |

##### attach 설정

| 필드 | 필수 | 타입 | 기본값 | 설명 |
|------|------|------|--------|------|
| `attach.mode` | N | string | `stateless` | `stateful`: 연결 유지, `stateless`: 요청마다 연결 |
| `attach.scope` | N | string | `agent` | `instance`: SwarmInstance 단위, `agent`: AgentInstance 단위 |
| `attach.reconnect.enabled` | N | boolean | `true` | 재연결 활성화 |
| `attach.reconnect.maxRetries` | N | number | `3` | 최대 재시도 횟수 |
| `attach.reconnect.backoffMs` | N | number | `1000` | 재시도 간격 (ms) |

##### expose 설정

| 필드 | 필수 | 타입 | 기본값 | 설명 |
|------|------|------|--------|------|
| `expose.tools` | N | boolean | `true` | MCP tools 노출 여부 |
| `expose.resources` | N | boolean | `false` | MCP resources 노출 여부 |
| `expose.prompts` | N | boolean | `false` | MCP prompts 노출 여부 |
| `expose.toolsFilter.include` | N | string[] | `["*"]` | 포함할 도구 패턴 |
| `expose.toolsFilter.exclude` | N | string[] | `[]` | 제외할 도구 패턴 |

#### 5.3.3 Extension 예시

```yaml
# Skill 확장
kind: Extension
metadata:
  name: skills
spec:
  runtime: node
  entry: "./extensions/skills/index.ts"
  config:
    discovery:
      repoSkillDirs: [".claude/skills", ".agent/skills"]

---

# Compaction(압축) 확장
kind: Extension
metadata:
  name: compaction
spec:
  runtime: node
  entry: "./extensions/compaction/index.ts"
  config:
    maxTokens: 8000
    strategy: summarize
    preserveRecent: 5

---

# ToolSearch 확장
kind: Extension
metadata:
  name: toolSearch
spec:
  runtime: node
  entry: "./extensions/tool-search/index.ts"
  config:
    autoAdd: true
    maxResults: 10

---

# MCP GitHub 확장
kind: Extension
metadata:
  name: mcp-github
spec:
  runtime: node
  entry: "./extensions/mcp/index.ts"
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
```

### 5.4 Agent

Agent는 에이전트 실행을 구성하는 중심 리소스이다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
  labels:
    role: orchestrator
spec:
  # 모델 설정 (필수)
  modelConfig:
    modelRef: { kind: Model, name: openai-gpt-5 }
    params:
      temperature: 0.5
      maxTokens: 4096
      topP: 0.9

  # 프롬프트 설정 (필수: system 또는 systemRef 중 하나)
  prompts:
    # 파일 참조 방식
    systemRef: "./prompts/planner.system.md"

    # 또는 인라인 방식
    # system: |
    #   너는 planner 에이전트다.
    #   복잡한 작업을 분해하고 다른 에이전트에게 위임한다.

  # 도구 목록 (선택)
  tools:
    - { kind: Tool, name: slackToolkit }
    - { kind: Tool, name: fileRead }
    # Selector + Overrides
    - selector:
        kind: Tool
        matchLabels:
          tier: base
      overrides:
        spec:
          errorMessageLimit: 2000

  # 확장 목록 (선택)
  extensions:
    - { kind: Extension, name: skills }
    - { kind: Extension, name: toolSearch }
    - { kind: Extension, name: mcp-github }

  # 훅 설정 (선택)
  hooks:
    - id: notify-slack-on-turn-complete
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

  # Changeset 정책 (선택)
  changesets:
    allowed:
      files:
        - "prompts/**"
        - "resources/**"
```

#### 5.4.1 Agent 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `spec.modelConfig` | Y | object | 모델 설정 |
| `spec.modelConfig.modelRef` | Y | ObjectRef | 사용할 Model 참조 |
| `spec.modelConfig.params` | N | object | 모델 파라미터 |
| `spec.prompts` | Y | object | 프롬프트 설정 |
| `spec.prompts.system` | * | string | 인라인 시스템 프롬프트 |
| `spec.prompts.systemRef` | * | string | 시스템 프롬프트 파일 경로 |
| `spec.tools` | N | array | 도구 참조 목록 |
| `spec.extensions` | N | array | 확장 참조 목록 |
| `spec.hooks` | N | array | 훅 설정 목록 |
| `spec.changesets` | N | object | Changeset 정책 |

\* `system`과 `systemRef` 중 하나는 반드시 존재해야 한다(MUST).

#### 5.4.2 modelConfig.params 상세

```yaml
modelConfig:
  modelRef: { kind: Model, name: gpt-5 }
  params:
    temperature: 0.7        # 0.0 ~ 2.0, 기본값: 1.0
    maxTokens: 4096         # 최대 출력 토큰 수
    topP: 0.9               # 0.0 ~ 1.0
    topK: 40                # top-k 샘플링 (일부 모델만)
    frequencyPenalty: 0.5   # -2.0 ~ 2.0
    presencePenalty: 0.5    # -2.0 ~ 2.0
    stopSequences:          # 생성 중단 시퀀스
      - "\n\nHuman:"
      - "```end"
```

#### 5.4.3 hooks 구조 상세

```yaml
hooks:
  # Hook 정의
  - id: unique-hook-id               # 선택: identity key (권장)
    point: turn.post                 # 필수: 파이프라인 포인트
    priority: 0                      # 선택: 실행 순서 (낮을수록 먼저, 기본: 0)
    action:                          # 필수: 스크립트 실행 기술자
      runtime: node                  # 런타임 환경
      entry: "./hooks/notify.js"     # 엔트리 파일 경로
      export: default                # export 함수 이름
      input:                         # 입력 값 (템플릿 지원)
        channel: { expr: "$.turn.origin.channel" }
        text: "Turn 완료!"
```

**중요**: `hooks[].action`은 스크립트 실행 기술자여야 하며, 직접 `toolCall` 스키마를 사용해서는 안 된다(MUST NOT). 필요 시 스크립트 핸들러 내에서 표준 API를 통해 도구를 간접 호출할 수 있다.

##### 지원 파이프라인 포인트

| 카테고리 | 포인트 | 타입 | 설명 |
|----------|--------|------|------|
| Turn | `turn.pre` | Mutator | Turn 시작 전 |
| Turn | `turn.post` | Mutator | Turn 종료 훅 (`base/events` 전달) |
| Step | `step.pre` | Mutator | Step 시작 전 |
| Step | `step.config` | Mutator | Config 로드/적용 |
| Step | `step.tools` | Mutator | Tool Catalog 구성 |
| Step | `step.blocks` | Mutator | Context Blocks 구성 |
| Step | `step.llmCall` | Middleware | LLM 호출 래핑 |
| Step | `step.llmError` | Mutator | LLM 호출 오류 처리 |
| Step | `step.post` | Mutator | Step 완료 후 |
| ToolCall | `toolCall.pre` | Mutator | Tool 호출 전 |
| ToolCall | `toolCall.exec` | Middleware | Tool 실행 래핑 |
| ToolCall | `toolCall.post` | Mutator | Tool 호출 후 |
| Workspace | `workspace.repoAvailable` | Mutator | Repo 사용 가능 시 |
| Workspace | `workspace.worktreeMounted` | Mutator | Worktree 마운트 시 |

##### Hook 필드

| 필드 | 필수 | 타입 | 기본값 | 설명 |
|------|------|------|--------|------|
| `hooks[].id` | N | string | - | Hook identity key (reconcile용) |
| `hooks[].point` | Y | string | - | 파이프라인 포인트 |
| `hooks[].priority` | N | number | 0 | 실행 순서 (낮을수록 먼저) |
| `hooks[].action` | Y | object | - | 스크립트 실행 기술자 |

##### action 필드 (스크립트 실행 기술자)

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `action.runtime` | Y | string | 런타임 환경 (`node`, `python`, `deno`) |
| `action.entry` | Y | string | 엔트리 파일 경로 (Bundle root 기준) |
| `action.export` | Y | string | export 함수 이름 |
| `action.input` | N | object | 입력 파라미터 (정적 값 또는 expr) |

##### input 템플릿 표현식

```yaml
input:
  # 정적 값
  staticField: "고정 문자열"

  # 표현식 (JSONPath 스타일)
  channel: { expr: "$.turn.origin.channel" }

  # 사용 가능한 컨텍스트 경로
  # $.turn         - 현재 Turn 객체
  # $.turn.origin  - Turn 호출 맥락
  # $.turn.auth    - Turn 인증 컨텍스트
  # $.baseMessages - turn 시작 기준 메시지 스냅샷 (turn.post)
  # $.messageEvents - turn 중 누적 메시지 이벤트 (turn.post)
  # $.turn.summary - Turn 요약 (turn.post에서만)
  # $.step         - 현재 Step 객체
  # $.agent        - 현재 Agent 정의
  # $.swarm        - 현재 Swarm 정의
```

##### Hook priority 규칙

1. 동일 point 내에서 priority가 낮은 것이 먼저 실행된다(MUST).
2. priority가 같으면 등록 순서(extensions 배열 순서)대로 실행된다(SHOULD).
3. priority 기본값은 0이다.

```yaml
hooks:
  - point: turn.post
    priority: -10     # 가장 먼저 실행
    action: ...

  - point: turn.post
    priority: 0       # 그 다음 실행
    action: ...

  - point: turn.post
    priority: 100     # 가장 나중에 실행
    action: ...
```

#### 5.4.4 Agent ChangesetPolicy 상세

Agent는 Swarm의 changesets 정책을 **추가 제약(더 좁게)** 하는 allowlist를 제공할 수 있다.

```yaml
kind: Agent
metadata:
  name: planner
spec:
  changesets:
    allowed:
      files:
        - "prompts/**"       # prompts 디렉터리만 허용
        - "resources/**"     # resources 디렉터리만 허용
```

**규칙(MUST)**:

1. Swarm.allowed.files가 "최대 허용 범위"이다.
2. Agent.allowed.files는 "해당 Agent의 추가 제약"으로 해석한다.
3. 해당 Agent가 생성/커밋하는 changeset은 **Swarm.allowed AND Agent.allowed 모두를 만족**해야 허용된다.

```yaml
# Swarm 정책: 넓은 범위
kind: Swarm
spec:
  policy:
    changesets:
      allowed:
        files:
          - "prompts/**"
          - "tools/**"
          - "extensions/**"
          - "resources/**"

---

# Agent 정책: Swarm보다 좁은 범위
kind: Agent
metadata:
  name: planner
spec:
  changesets:
    allowed:
      files:
        - "prompts/**"      # planner는 prompts만 수정 가능
        - "resources/**"

# 결과: planner Agent는 prompts/** 와 resources/** 만 수정 가능
# (tools/**, extensions/**는 Swarm에서 허용하지만 Agent에서 제약)
```

### 5.5 Swarm

Swarm은 에이전트 집합과 실행 정책을 정의한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  # 필수 필드
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
    - { kind: Agent, name: executor }
    - { kind: Agent, name: reviewer }

  # 선택 필드
  policy:
    maxStepsPerTurn: 32
    maxTurnsPerInstance: 1000
    timeoutMs: 300000
    queueMode: serial                    # 큐 처리 모드 (기본: serial)
    lifecycle:                           # 인스턴스 라이프사이클 정책 (선택)
      autoPauseIdleSeconds: 3600         # 유휴 시 자동 일시정지 (초)
      ttlSeconds: 604800                 # 인스턴스 최대 수명 (초)
      gcGraceSeconds: 86400              # GC 유예 기간 (초)

    # Changeset 정책
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

    # Live Config 정책
    liveConfig:
      enabled: true
      applyAt:
        - step.config
      allowedPaths:
        agentRelative:
          - "/spec/tools"
          - "/spec/extensions"
```

#### 5.5.1 Swarm 필드 상세

| 필드 | 필수 | 타입 | 기본값 | 설명 |
|------|------|------|--------|------|
| `spec.entrypoint` | Y | ObjectRef | - | 진입점 Agent |
| `spec.agents` | Y | ObjectRef[] | - | 포함된 Agent 목록 |
| `spec.policy` | N | object | - | 실행 정책 |

#### 5.5.2 policy 필드 상세

| 필드 | 필수 | 타입 | 기본값 | 설명 |
|------|------|------|--------|------|
| `policy.maxStepsPerTurn` | N | number | 32 | Turn 당 최대 Step 수 |
| `policy.maxTurnsPerInstance` | N | number | - | Instance 당 최대 Turn 수 |
| `policy.timeoutMs` | N | number | 300000 | Turn 타임아웃 (ms) |
| `policy.queueMode` | N | string | `serial` | 큐 처리 모드 |
| `policy.lifecycle` | N | object | - | 인스턴스 라이프사이클 정책 |
| `policy.lifecycle.autoPauseIdleSeconds` | N | number | - | 유휴 시 자동 일시정지 (초) |
| `policy.lifecycle.ttlSeconds` | N | number | - | 인스턴스 최대 수명 (초) |
| `policy.lifecycle.gcGraceSeconds` | N | number | - | GC 유예 기간 (초) |
| `policy.changesets` | N | object | - | Changeset 정책 |
| `policy.liveConfig` | N | object | - | Live Config 정책 |

#### 5.5.3 policy.changesets 상세

```yaml
policy:
  changesets:
    enabled: true                    # Changeset 기능 활성화
    applyAt:                         # 적용 시점 (Safe Point)
      - step.config
    allowed:
      files:                         # 허용 파일 패턴 (glob)
        - "resources/**"
        - "prompts/**"
        - "tools/**"
        - "extensions/**"
    emitRevisionChangedEvent: true   # 변경 이벤트 발행
```

| 필드 | 필수 | 타입 | 기본값 | 설명 |
|------|------|------|--------|------|
| `changesets.enabled` | N | boolean | `false` | Changeset 활성화 |
| `changesets.applyAt` | N | string[] | `["step.config"]` | 적용 시점 |
| `changesets.allowed.files` | N | string[] | `[]` | 허용 파일 패턴 |
| `changesets.emitRevisionChangedEvent` | N | boolean | `false` | 변경 이벤트 발행 |

#### 5.5.4 policy.liveConfig 상세

```yaml
policy:
  liveConfig:
    enabled: true
    applyAt:
      - step.config
    allowedPaths:
      # Agent 기준 상대 경로
      agentRelative:
        - "/spec/tools"
        - "/spec/extensions"
        - "/spec/prompts"
      # Swarm 기준 상대 경로
      swarmRelative:
        - "/spec/policy/maxStepsPerTurn"
```

| 필드 | 필수 | 타입 | 기본값 | 설명 |
|------|------|------|--------|------|
| `liveConfig.enabled` | N | boolean | `false` | Live Config 활성화 |
| `liveConfig.applyAt` | N | string[] | `["step.config"]` | 적용 시점 |
| `liveConfig.allowedPaths.agentRelative` | N | string[] | `[]` | 허용 Agent 경로 |
| `liveConfig.allowedPaths.swarmRelative` | N | string[] | `[]` | 허용 Swarm 경로 |

### 5.6 Connector

Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 실행 패키지를 정의한다. entry 모듈은 단일 default export 함수를 제공한다. 인증 정보와 ingress 라우팅 규칙은 Connection 리소스에서 정의한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  # 필수 필드
  runtime: node
  entry: "./connectors/slack/index.ts"

  # 프로토콜 선언 (필수, 최소 1개)
  triggers:
    - type: http
      endpoint:
        path: /webhook/slack/events
        method: POST

  # 이벤트 스키마 선언 (선택)
  events:
    - name: app_mention
      properties:
        channel_id: { type: string }
        ts: { type: string }
        thread_ts: { type: string, optional: true }
    - name: message.im
      properties:
        channel_id: { type: string }
        ts: { type: string }
```

#### 5.6.1 Connector 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `spec.runtime` | Y | string | 런타임 환경 (`node`) |
| `spec.entry` | Y | string | 엔트리 파일 경로 (단일 default export) |
| `spec.triggers` | Y | array | 프로토콜 선언 목록 (최소 1개) |
| `spec.events` | N | array | 이벤트 스키마 선언 |

#### 5.6.2 triggers 프로토콜 선언 상세

Connector가 외부 이벤트를 어떤 프로토콜로 수신할지 선언한다.

```yaml
# HTTP Trigger
triggers:
  - type: http
    endpoint:
      path: /webhook/slack/events      # /로 시작 (필수)
      method: POST                      # HTTP 메서드 (필수)

# Cron Trigger
triggers:
  - type: cron
    schedule: "0 9 * * MON-FRI"        # cron 표현식 (필수)

# CLI Trigger
triggers:
  - type: cli
```

##### triggers[] 필드

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `type` | Y | string | `"http"`, `"cron"`, `"cli"` 중 하나 |
| `endpoint.path` | Y (http) | string | Webhook 수신 경로 (`/`로 시작) |
| `endpoint.method` | Y (http) | string | HTTP 메서드 |
| `schedule` | Y (cron) | string | cron 표현식 |

#### 5.6.3 events 스키마 상세

Connector가 emit할 수 있는 이벤트의 이름과 속성 타입을 선언한다. Connection의 `match.event`는 이 스키마에 선언된 이벤트 이름과 매칭된다.

```yaml
events:
  - name: app_mention
    properties:
      channel_id: { type: string }
      ts: { type: string }
      thread_ts: { type: string, optional: true }
  - name: message.im
    properties:
      channel_id: { type: string }
```

##### events[] 필드

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `name` | Y | string | 이벤트 이름 (Connector 내 고유) |
| `properties` | N | object | 이벤트 속성 타입 선언 |
| `properties.<key>.type` | Y | string | `"string"`, `"number"`, `"boolean"` |
| `properties.<key>.optional` | N | boolean | 선택 속성 여부 |

**규칙(MUST)**:

1. entry 모듈은 단일 default export 함수를 제공해야 한다.
2. `triggers`는 최소 1개 이상의 프로토콜 선언을 포함해야 한다.
3. `events[].name`은 Connector 내에서 고유해야 한다.
4. entry 함수는 ConnectorEvent를 `ctx.emit(...)`으로 Runtime에 전달해야 한다.
5. Connector는 Connection이 제공한 서명 시크릿을 사용하여 inbound 요청의 서명 검증을 수행해야 한다.

#### 5.6.4 Connector 예시

```yaml
# Slack Connector (HTTP trigger + events 스키마)
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
    - name: message.im
      properties:
        channel_id: { type: string }

---

# CLI Connector
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

# Cron Connector
kind: Connector
metadata:
  name: daily-reporter
spec:
  runtime: node
  entry: "./connectors/daily-reporter/index.ts"
  triggers:
    - type: cron
      schedule: "0 9 * * MON-FRI"
  events:
    - name: daily_report
      properties:
        scheduled_at: { type: string }

---

# GitHub Webhook Connector
kind: Connector
metadata:
  name: github-webhook
spec:
  runtime: node
  entry: "./connectors/github/index.ts"
  triggers:
    - type: http
      endpoint:
        path: /webhook/github
        method: POST
  events:
    - name: pull_request
      properties:
        action: { type: string }
        number: { type: number }
    - name: issue_comment
      properties:
        action: { type: string }
```

### 5.7 Connection

Connection은 Connector를 실제 배포 환경에 바인딩하는 리소스다. 인증 정보 제공, ConnectorEvent 기반 ingress 라우팅 규칙, 서명 검증 시크릿 설정을 담당한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-main
spec:
  # 필수: 참조할 Connector
  connectorRef: { kind: Connector, name: slack }

  # 인증 설정 (선택, oauthAppRef와 staticToken 중 택일)
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }

  # ingress 라우팅 규칙 (ConnectorEvent 기반)
  ingress:
    rules:
      - match:
          event: app_mention
        route:
          agentRef: { kind: Agent, name: planner }
      - match:
          event: message.im
        route: {}  # entrypoint Agent로 라우팅

  # 서명 검증 설정 (선택)
  verify:
    webhook:
      signingSecret:
        valueFrom:
          secretRef: { ref: "Secret/slack-webhook", key: "signing_secret" }
```

#### 5.7.1 Connection 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `spec.connectorRef` | Y | ObjectRef | 참조할 Connector |
| `spec.auth` | N | object | 인증 설정 (oauthAppRef 또는 staticToken) |
| `spec.ingress` | N | object | 인바운드 라우팅 설정 |
| `spec.ingress.rules` | N | array | 라우팅 규칙 목록 |
| `spec.verify` | N | object | 서명 검증 설정 |

#### 5.7.2 auth 설정

두 모드는 **동시에 활성화될 수 없다**(MUST).

**OAuthApp 기반 모드:**

```yaml
auth:
  oauthAppRef: { kind: OAuthApp, name: slack-bot }
```

**Static Token 기반 모드:**

```yaml
auth:
  staticToken:
    valueFrom:
      secretRef: { ref: "Secret/slack-bot-token", key: "bot_token" }
```

#### 5.7.3 ingress.rules 설정 상세

```yaml
ingress:
  rules:
    - match:                            # 매칭 조건 (선택)
        event: app_mention              # ConnectorEvent.name과 매칭
        properties:                     # ConnectorEvent.properties와 매칭 (선택)
          channel_id: "C123456"

      route:                            # 라우팅 설정 (필수)
        agentRef: { kind: Agent, name: planner }  # 선택
```

##### ingress.rules[].match 필드

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `match.event` | N | string | ConnectorEvent.name과 매칭할 이벤트 이름 |
| `match.properties` | N | object | ConnectorEvent.properties 값과 매칭할 키-값 쌍 |

##### ingress.rules[].route 필드

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `route.agentRef` | N | ObjectRef | 대상 Agent (생략 시 Swarm entrypoint) |

**매칭 규칙:**
- `match` 내 여러 조건은 AND 조건으로 해석한다(MUST).
- `match`가 생략되면 catch-all 규칙으로 동작한다(MUST).
- 규칙 배열은 순서대로 평가하며, 첫 번째 매칭 규칙이 적용된다(MUST).

#### 5.7.4 verify 설정 상세

Connection은 Connector가 서명 검증에 사용할 시크릿을 제공한다.

```yaml
verify:
  webhook:
    signingSecret:
      valueFrom:
        secretRef: { ref: "Secret/slack-webhook", key: "signing_secret" }
```

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `verify.webhook.signingSecret` | N | ValueSource | 서명 시크릿 |

**규칙(MUST)**:

1. `auth.oauthAppRef`와 `auth.staticToken`은 동시에 존재할 수 없다.
2. Connection은 Connector가 서명 검증에 사용할 시크릿을 제공해야 한다.
3. 서명 검증 실패 시 Connector는 ConnectorEvent를 emit하지 않아야 한다.
4. OAuth를 사용하는 Connection은 Turn 생성 시 필요한 `turn.auth.subjects` 키를 채워야 한다.

#### 5.7.5 Connection 예시

```yaml
# Slack Connection (OAuth + verify + 이벤트 기반 라우팅)
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
        route: {}  # entrypoint로 라우팅
  verify:
    webhook:
      signingSecret:
        valueFrom:
          secretRef: { ref: "Secret/slack-webhook", key: "signing_secret" }

---

# CLI Connection
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - route: {}  # entrypoint Agent로 라우팅

---

# Telegram Connection (Static Token)
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

---

# GitHub Webhook Connection (이벤트별 라우팅)
kind: Connection
metadata:
  name: github-to-review
spec:
  connectorRef: { kind: Connector, name: github-webhook }
  ingress:
    rules:
      - match:
          event: pull_request
        route:
          agentRef: { kind: Agent, name: reviewer }
      - match:
          event: issue_comment
        route:
          agentRef: { kind: Agent, name: responder }
  verify:
    webhook:
      signingSecret:
        valueFrom:
          secretRef: { ref: "Secret/github-webhook", key: "secret" }
```

### 5.8 OAuthApp

OAuthApp은 외부 시스템 OAuth 인증을 위한 클라이언트 및 엔드포인트를 정의한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: OAuthApp
metadata:
  name: slack-bot
spec:
  # 필수 필드
  provider: slack                     # 공급자 식별자
  flow: authorizationCode             # authorizationCode | deviceCode
  subjectMode: global                 # global | user

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

  # 선택 필드
  options:
    slack:
      tokenMode: "bot"                # bot | user
      teamId: "T12345"                # 특정 팀 제한 (선택)
```

#### 5.8.1 OAuthApp 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `spec.provider` | Y | string | 공급자 식별자 |
| `spec.flow` | Y | string | OAuth 플로우 타입 |
| `spec.subjectMode` | Y | string | Subject 결정 모드 |
| `spec.client` | Y | object | 클라이언트 자격 증명 |
| `spec.endpoints` | Y | object | OAuth 엔드포인트 |
| `spec.scopes` | Y | string[] | 요청 스코프 |
| `spec.redirect` | Y | object | 리디렉션 설정 |
| `spec.options` | N | object | 공급자별 옵션 |

#### 5.8.2 flow 별 요구사항

##### authorizationCode (필수 지원)

```yaml
flow: authorizationCode
```

- Runtime은 **Authorization Code + PKCE(S256)**를 필수 지원한다(MUST).
- `endpoints.authorizationUrl`, `endpoints.tokenUrl`, `redirect.callbackPath` 필수.

##### deviceCode (선택 지원)

```yaml
flow: deviceCode
```

- Runtime은 device code 플로우를 선택적으로 지원한다(MAY).
- 미지원 시 구성 로드 단계에서 거부한다(MUST).
- `endpoints.deviceAuthorizationUrl`, `endpoints.tokenUrl` 필수.

```yaml
# Device Code 예시
kind: OAuthApp
metadata:
  name: github-cli
spec:
  provider: github
  flow: deviceCode
  subjectMode: user
  client:
    clientId:
      valueFrom:
        env: "GITHUB_CLIENT_ID"
  endpoints:
    deviceAuthorizationUrl: "https://github.com/login/device/code"
    tokenUrl: "https://github.com/login/oauth/access_token"
  scopes:
    - "repo"
    - "user"
```

#### 5.8.3 subjectMode 상세

```yaml
subjectMode: global    # 전역 토큰 (워크스페이스/팀 단위)
# 또는
subjectMode: user      # 사용자별 토큰
```

| 모드 | turn.auth.subjects 사용 키 | 용도 |
|------|---------------------------|------|
| `global` | `turn.auth.subjects.global` | 워크스페이스/팀/조직 단위 토큰 |
| `user` | `turn.auth.subjects.user` | 개별 사용자 토큰 |

**규칙(MUST)**:

1. `subjectMode`에 해당하는 키가 `turn.auth.subjects`에 없으면 오류로 처리한다.
2. 전역 토큰과 사용자별 토큰이 의미적으로 다르면 별도 OAuthApp으로 분리한다(SHOULD).

#### 5.8.4 endpoints 상세

```yaml
endpoints:
  # Authorization Code 플로우용
  authorizationUrl: "https://provider.example/oauth/authorize"
  tokenUrl: "https://provider.example/oauth/token"

  # Device Code 플로우용 (선택)
  deviceAuthorizationUrl: "https://provider.example/device/code"

  # 토큰 갱신용 (선택, 기본값: tokenUrl)
  refreshUrl: "https://provider.example/oauth/refresh"

  # 토큰 철회용 (선택)
  revokeUrl: "https://provider.example/oauth/revoke"

  # 사용자 정보 조회용 (선택)
  userInfoUrl: "https://provider.example/userinfo"
```

#### 5.8.5 OAuthApp 예시

```yaml
# Slack Bot (전역 토큰)
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
  options:
    slack:
      tokenMode: "bot"

---

# GitHub (사용자별 토큰)
kind: OAuthApp
metadata:
  name: github-user
spec:
  provider: github
  flow: authorizationCode
  subjectMode: user
  client:
    clientId:
      valueFrom:
        env: "GITHUB_CLIENT_ID"
    clientSecret:
      valueFrom:
        secretRef: { ref: "Secret/github-oauth", key: "client_secret" }
  endpoints:
    authorizationUrl: "https://github.com/login/oauth/authorize"
    tokenUrl: "https://github.com/login/oauth/access_token"
  scopes:
    - "repo"
    - "user:email"
  redirect:
    callbackPath: "/oauth/callback/github"

---

# Google (사용자별 토큰)
kind: OAuthApp
metadata:
  name: google-user
spec:
  provider: google
  flow: authorizationCode
  subjectMode: user
  client:
    clientId:
      valueFrom:
        env: "GOOGLE_CLIENT_ID"
    clientSecret:
      valueFrom:
        secretRef: { ref: "Secret/google-oauth", key: "client_secret" }
  endpoints:
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth"
    tokenUrl: "https://oauth2.googleapis.com/token"
  scopes:
    - "https://www.googleapis.com/auth/calendar"
    - "https://www.googleapis.com/auth/gmail.send"
  redirect:
    callbackPath: "/oauth/callback/google"
  options:
    google:
      accessType: "offline"
      prompt: "consent"
```

### 5.9 ResourceType / ExtensionHandler

ResourceType과 ExtensionHandler는 사용자 정의 kind의 등록, 검증, 기본값, 런타임 변환을 지원한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: ResourceType
metadata:
  name: rag.acme.io/Retrieval
spec:
  # 필수 필드
  group: rag.acme.io
  names:
    kind: Retrieval
    plural: retrievals
    singular: retrieval               # 선택
    shortNames: ["ret", "retr"]       # 선택

  versions:
    - name: v1alpha1
      served: true                    # API에서 제공 여부
      storage: true                   # 저장소 버전 여부
      schema:                         # OpenAPI 스키마 (선택)
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                vectorStore:
                  type: string
                dimensions:
                  type: integer

  handlerRef: { kind: ExtensionHandler, name: retrieval-handler }

---

apiVersion: agents.example.io/v1alpha1
kind: ExtensionHandler
metadata:
  name: retrieval-handler
spec:
  # 필수 필드
  runtime: node
  entry: "./extensions/retrieval/handler.ts"

  # 제공하는 함수 목록
  exports:
    - validate                        # 검증 함수
    - default                         # 기본값 적용 함수
    - materialize                     # 런타임 변환 함수
```

#### 5.9.1 ResourceType 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `spec.group` | Y | string | API 그룹 (예: "rag.acme.io") |
| `spec.names.kind` | Y | string | 리소스 종류명 |
| `spec.names.plural` | Y | string | 복수형 이름 |
| `spec.names.singular` | N | string | 단수형 이름 |
| `spec.names.shortNames` | N | string[] | 축약 이름 |
| `spec.versions` | Y | array | 버전 정의 |
| `spec.handlerRef` | Y | ObjectRef | 처리 핸들러 참조 |

#### 5.9.2 versions[] 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `versions[].name` | Y | string | 버전 이름 (예: "v1alpha1") |
| `versions[].served` | Y | boolean | API에서 제공 여부 |
| `versions[].storage` | Y | boolean | 저장소 버전 여부 (하나만 true) |
| `versions[].schema` | N | object | OpenAPI v3 스키마 |

#### 5.9.3 ExtensionHandler 필드 상세

| 필드 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `spec.runtime` | Y | string | 런타임 환경 |
| `spec.entry` | Y | string | 엔트리 파일 경로 |
| `spec.exports` | Y | string[] | 제공 함수 목록 |

#### 5.9.4 Handler exports 함수

| 함수 | 설명 |
|------|------|
| `validate` | 리소스 검증. 오류 시 검증 실패 반환 |
| `default` | 기본값 적용. 누락된 필드에 기본값 설정 |
| `materialize` | 런타임 변환. 리소스를 실행 가능한 형태로 변환 |

#### 5.9.5 사용자 정의 리소스 예시

```yaml
# ResourceType 정의
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

# ExtensionHandler 정의
kind: ExtensionHandler
metadata:
  name: retrieval-handler
spec:
  runtime: node
  entry: "./extensions/retrieval/handler.ts"
  exports: ["validate", "default", "materialize"]

---

# 사용자 정의 리소스 사용
apiVersion: rag.acme.io/v1alpha1
kind: Retrieval
metadata:
  name: code-search
spec:
  vectorStore: pinecone
  dimensions: 1536
  indexName: "code-embeddings"
  topK: 10
```

---

## 6. Validation 포인트 확장

### 6.1 공통 검증 규칙

모든 리소스에 적용되는 검증 규칙:

| 검증 항목 | 규칙 | 수준 |
|-----------|------|------|
| apiVersion | 형식: `<group>/<version>` | MUST |
| kind | 알려진 kind 또는 등록된 ResourceType | MUST |
| metadata.name | 동일 kind 내 고유, 63자 이하 | MUST |
| metadata.labels | 키/값 모두 문자열 | MUST |
| spec | 필수 필드 존재 | MUST |

### 6.2 참조 무결성 검증

| 검증 항목 | 규칙 | 수준 |
|-----------|------|------|
| ObjectRef | 참조 대상 리소스 존재 | MUST |
| 순환 참조 | 탐지 및 거부 | SHOULD |
| 버전 호환성 | apiVersion 호환 여부 | SHOULD |

### 6.3 리소스별 필수/선택 필드

#### Model

| 필드 | 필수 |
|------|------|
| spec.provider | Y |
| spec.name | Y |
| spec.endpoint | N |
| spec.options | N |
| spec.capabilities | N |

#### Tool

| 필드 | 필수 |
|------|------|
| spec.runtime | Y |
| spec.entry | Y |
| spec.exports | Y (최소 1개) |
| spec.exports[].name | Y |
| spec.exports[].description | Y |
| spec.exports[].parameters | Y |
| spec.errorMessageLimit | N |
| spec.auth | N |

#### Extension

| 필드 | 필수 |
|------|------|
| spec.runtime | Y |
| spec.entry | Y |
| spec.config | N |

#### Agent

| 필드 | 필수 |
|------|------|
| spec.modelConfig | Y |
| spec.modelConfig.modelRef | Y |
| spec.prompts.system 또는 systemRef | Y (둘 중 하나) |
| spec.tools | N |
| spec.extensions | N |
| spec.hooks | N |

#### Swarm

| 필드 | 필수 |
|------|------|
| spec.entrypoint | Y |
| spec.agents | Y (최소 1개) |
| spec.policy | N |
| spec.policy.queueMode | N (기본: serial) |
| spec.policy.lifecycle | N |

#### Connector

| 필드 | 필수 |
|------|------|
| spec.runtime | Y |
| spec.entry | Y |
| spec.triggers | Y (최소 1개) |
| spec.triggers[].type | Y |
| spec.triggers[].endpoint.path | N (http trigger에서 Y) |
| spec.triggers[].endpoint.method | N (http trigger에서 Y) |
| spec.triggers[].schedule | N (cron trigger에서 Y) |
| spec.events | N |
| spec.events[].name | N (events 사용 시 Y, Connector 내 고유) |

#### Connection

| 필드 | 필수 |
|------|------|
| spec.connectorRef | Y |
| spec.auth | N |
| spec.ingress.rules | N |
| spec.ingress.rules[].route | Y (rules 사용 시) |
| spec.ingress.rules[].match.event | N (SHOULD: Connector events와 일치) |
| spec.ingress.rules[].route.agentRef | N |
| spec.verify | N |

#### OAuthApp

| 필드 | 필수 |
|------|------|
| spec.provider | Y |
| spec.flow | Y |
| spec.subjectMode | Y |
| spec.client.clientId | Y |
| spec.client.clientSecret | Y (authorizationCode) |
| spec.endpoints.authorizationUrl | Y (authorizationCode) |
| spec.endpoints.tokenUrl | Y |
| spec.scopes | Y |
| spec.redirect.callbackPath | Y (authorizationCode) |

### 6.4 scopes 부분집합 검증

| 검증 항목 | 규칙 | 수준 |
|-----------|------|------|
| Tool.auth.scopes | OAuthApp.spec.scopes의 부분집합 | MUST |
| Tool.exports[].auth.scopes | Tool.auth.scopes의 부분집합 | MUST |

### 6.5 상호 배타 필드 검증

| 리소스 | 상호 배타 필드 | 규칙 |
|--------|---------------|------|
| ValueSource | value, valueFrom | 둘 중 하나만 존재 |
| ValueSource.valueFrom | env, secretRef | 둘 중 하나만 존재 |
| Connection.auth | oauthAppRef, staticToken | 둘 중 하나만 존재 |
| Agent.prompts | system, systemRef | 둘 중 하나 필수 |

### 6.6 특수 검증 규칙

#### OAuthApp flow 검증

```yaml
# authorizationCode: 모든 필드 필수
flow: authorizationCode
# 필수: endpoints.authorizationUrl, endpoints.tokenUrl, redirect.callbackPath

# deviceCode: 런타임 미지원 시 거부
flow: deviceCode
# 필수: endpoints.deviceAuthorizationUrl, endpoints.tokenUrl
```

#### Connector 검증

```yaml
# runtime, entry 필수
# triggers 최소 1개 프로토콜 선언 (http/cron/cli)
# http trigger: endpoint.path (/로 시작), endpoint.method 필수
# cron trigger: schedule (유효한 cron 표현식) 필수
# events[].name: Connector 내 고유
# entry 모듈: 단일 default export 함수 존재
```

#### Connection 검증

```yaml
# Connection.auth: oauthAppRef와 staticToken 동시 불가
# Connection.verify: 서명 검증 시크릿 제공
# Connection.ingress.rules[].match.event: Connector events에 선언된 이름
# Connection.ingress.rules[].route.agentRef: 유효한 Agent 참조 (선택)
```

#### Agent changesets 검증

```yaml
# Agent.allowed.files는 Swarm.allowed.files의 부분집합이어야 함
# (논리적으로 더 좁은 범위)
```

---

## 7. 전체 예시

### 7.1 단일 파일 구성 (goondan.yaml)

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

---

kind: Tool
metadata:
  name: fileRead
  labels:
    tier: base
spec:
  runtime: node
  entry: "./tools/file-read/index.ts"
  exports:
    - name: file.read
      description: "파일 내용을 읽습니다"
      parameters:
        type: object
        properties:
          path:
            type: string
            description: "읽을 파일 경로"
        required: ["path"]

---

kind: Extension
metadata:
  name: compaction
spec:
  runtime: node
  entry: "./extensions/compaction/index.ts"
  config:
    maxTokens: 8000

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
  runtime: node
  entry: "./connectors/cli/index.ts"
  triggers:
    - type: cli
  events:
    - name: user_input

---

kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - route: {}  # entrypoint Agent로 라우팅
```

### 7.2 멀티 에이전트 구성

```yaml
# models.yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: gpt-5
spec:
  provider: openai
  name: gpt-5

---

kind: Model
metadata:
  name: claude-opus
spec:
  provider: anthropic
  name: claude-opus-4-5

---

# agents.yaml
kind: Agent
metadata:
  name: router
spec:
  modelConfig:
    modelRef: { kind: Model, name: gpt-5 }
    params:
      temperature: 0.3
  prompts:
    systemRef: "./prompts/router.system.md"
  tools:
    - { kind: Tool, name: delegateToAgent }

---

kind: Agent
metadata:
  name: coder
spec:
  modelConfig:
    modelRef: { kind: Model, name: claude-opus }
    params:
      temperature: 0.5
  prompts:
    systemRef: "./prompts/coder.system.md"
  tools:
    - { kind: Tool, name: fileRead }
    - { kind: Tool, name: fileWrite }
    - { kind: Tool, name: bash }
  extensions:
    - { kind: Extension, name: mcp-github }

---

kind: Agent
metadata:
  name: researcher
spec:
  modelConfig:
    modelRef: { kind: Model, name: gpt-5 }
  prompts:
    systemRef: "./prompts/researcher.system.md"
  tools:
    - { kind: Tool, name: webSearch }
    - { kind: Tool, name: webFetch }

---

# swarm.yaml
kind: Swarm
metadata:
  name: multi-agent
spec:
  entrypoint: { kind: Agent, name: router }
  agents:
    - { kind: Agent, name: router }
    - { kind: Agent, name: coder }
    - { kind: Agent, name: researcher }
  policy:
    maxStepsPerTurn: 50
    changesets:
      enabled: true
      allowed:
        files:
          - "prompts/**"
          - "resources/**"
```

---

## 부록 A. JSONPath 표현식

Agent Hook의 `action.input` 등에서 사용되는 JSONPath 표현식.

```yaml
# 기본 경로
"$.field"                    # 루트의 field
"$.parent.child"             # 중첩 필드
"$.array[0]"                 # 배열 인덱스
"$.array[*].name"            # 모든 요소의 name

# Hook input 예시
input:
  channel: { expr: "$.turn.origin.channel" }
  text: { expr: "$.turn.summary" }
  firstSystem: { expr: "$.baseMessages[0].content" }
```

## 부록 B. Glob 패턴

Changeset `allowed.files`에서 사용되는 glob 패턴.

| 패턴 | 설명 |
|------|------|
| `*` | 단일 디렉터리 내 모든 파일 |
| `**` | 재귀적으로 모든 하위 디렉터리 |
| `*.md` | .md 확장자 파일 |
| `prompts/**` | prompts 디렉터리 내 모든 파일 |
| `tools/**/index.ts` | tools 하위의 모든 index.ts |

```yaml
allowed:
  files:
    - "prompts/**"           # prompts 디렉터리 전체
    - "resources/*.yaml"     # resources 내 yaml 파일만
    - "tools/**/index.ts"    # tools 하위 모든 index.ts
```

---

**문서 버전**: v0.9
**최종 수정**: 2026-02-05
**참조**: @docs/requirements/index.md, @docs/requirements/06_config-spec.md, @docs/requirements/07_config-resources.md
