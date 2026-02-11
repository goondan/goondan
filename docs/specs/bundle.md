# Goondan Bundle YAML 스펙 (v2.0)

> **v2.0 주요 변경사항:**
> - `apiVersion`: `agents.example.io/v1alpha1` -> `goondan.ai/v1`
> - Kind 축소: 11종 -> **8종** (OAuthApp, ResourceType, ExtensionHandler 제거)
> - `runtime` 필드 제거: Tool, Extension, Connector 모두 항상 Bun으로 실행
> - Connector: `triggers` 필드 제거
> - Tool: `auth` 필드 제거, `exports` 배열 기반 도구 이름 규칙 (`__`)
> - Agent: `hooks`/`changesets` 필드 제거

---

## 1. 개요

### 1.1 배경과 설계 철학

Goondan Bundle(`goondan.yaml`)은 에이전트 스웜을 구성하는 모든 리소스를 **단일 파일 또는 디렉토리**로 관리하기 위한 구성 포맷이다. Kubernetes 매니페스트에서 영감을 받아 다중 YAML 문서(`---`)를 지원하며, 다음 원칙을 따른다:

- **단순한 시작**: 하나의 `goondan.yaml` 파일만으로 에이전트 스웜을 정의하고 실행할 수 있다.
- **점진적 확장**: 프로젝트가 커지면 리소스를 파일/디렉토리로 분할할 수 있다.
- **결정론적 로딩**: 동일 입력에서 항상 동일한 리소스 집합을 생성하여 재현 가능한 실행을 보장한다.
- **Fail-Fast 검증**: 구성 오류를 Runtime 시작 전에 모두 감지하여, 부분 로드로 인한 예측 불가능한 동작을 방지한다.

### 1.2 구성 파일 분할과 로딩

구현은 구성 파일을 폴더/파일 단위로 분할 관리할 수 있어야 한다 (MUST). 로더는 단일 파일, 디렉토리, 다중 YAML 문서를 처리해야 한다 (MUST). 로딩 결과는 결정론적이어야 하며, 동일 입력에서 동일 리소스 집합을 생성해야 한다 (MUST).

---

## 2. 핵심 규칙

본 섹션은 번들 로딩과 검증 시 구현자가 반드시 준수해야 하는 규범적 규칙을 요약한다.

### 2.1 리소스 구조

1. 모든 리소스는 `apiVersion`, `kind`, `metadata`, `spec`를 포함해야 한다 (MUST).
2. `apiVersion`은 `goondan.ai/v1`이어야 한다 (MUST).
3. `metadata.name`은 동일 kind 내에서 고유해야 한다 (MUST).
4. 단일 YAML 파일에서 다중 문서(`---`)를 지원해야 한다 (MUST).

### 2.2 로딩 규칙

1. 로딩 결과는 결정론적이어야 하며, 동일 입력에서 동일 리소스 집합을 생성해야 한다 (MUST).
2. 모든 리소스의 `apiVersion`은 `goondan.ai/v1`이어야 한다 (MUST).
3. Runtime은 지원하지 않는 `apiVersion`을 로드 단계에서 명시적 오류로 거부해야 한다 (MUST).
4. `kind` 필드가 없는 문서는 Goondan 리소스가 아닌 것으로 간주하여 무시해야 한다 (SHOULD).

### 2.3 구성 검증

1. 구성 검증은 Runtime 시작 전 "로드 단계"에서 수행되어야 한다 (MUST).
2. 오류가 하나라도 있으면 부분 로드 없이 전체 구성을 거부해야 한다 (MUST).
3. 검증 오류는 위치와 코드가 포함된 구조화된 형식으로 반환해야 한다 (MUST).
4. 오류 객체는 사용자 복구를 위한 `suggestion`과 선택적 `helpUrl` 필드를 포함하는 것을 권장한다 (SHOULD).

### 2.4 보안

1. 단일 YAML 파일은 1MB를 초과할 수 없다 (MUST).
2. 단일 YAML 파일 내 최대 100개 문서를 허용한다 (MUST).
3. `../`를 포함하는 상위 디렉터리 참조는 거부해야 한다 (MUST).
4. 절대 경로 참조도 거부해야 한다 (MUST).

---

## 3. 공통 규칙

### 3.1 리소스 기본 구조

모든 리소스는 다음 필드를 반드시 포함한다(MUST).

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <string>
  labels: {}        # 선택
  annotations: {}   # 선택
spec:
  ...
```

### 3.2 apiVersion 형식 규칙

- **형식**: `goondan.ai/v1`
- `apiVersion`이 생략된 경우, 런타임은 `goondan.ai/v1`을 기본값으로 사용한다(SHOULD).
- 비호환 변경은 `version` 상승(예: `v1` -> `v2`)으로 표현한다(MUST).
- Runtime은 지원하지 않는 `apiVersion`을 로드 단계에서 명시적 오류로 거부해야 한다(MUST).
- Deprecated 리소스/필드는 최소 1개 이상의 하위 버전에서 경고를 제공해야 한다(SHOULD).

```yaml
# 권장: apiVersion 명시
apiVersion: goondan.ai/v1
kind: Model

# apiVersion 생략 시 기본값 적용 (권장하지 않음)
kind: Model
```

### 3.3 kind 목록

v2에서 지원하는 Kind는 **8종**이다.

| Kind | 설명 |
|------|------|
| `Model` | LLM 프로바이더 설정 |
| `Agent` | 에이전트 정의 (모델, 프롬프트, 도구, 익스텐션) |
| `Swarm` | 에이전트 집합 + 실행 정책 |
| `Tool` | LLM이 호출하는 함수 |
| `Extension` | 라이프사이클 미들웨어 인터셉터 |
| `Connector` | 외부 프로토콜 수신 (별도 프로세스, 자체 프로토콜 관리) |
| `Connection` | Connector - Swarm 바인딩 |
| `Package` | 프로젝트 매니페스트/배포 단위 |

**제거된 Kind:** `OAuthApp`, `ResourceType`, `ExtensionHandler`는 v2에서 지원하지 않는다. 이들 Kind를 포함하는 리소스는 로드 단계에서 거부해야 한다(MUST).

### 3.4 metadata.name 유일성 규칙

- `metadata.name`은 **동일 kind 내에서 고유**해야 한다(MUST).
- 네임스페이스가 없는 경우, 전역 범위에서 고유성을 보장한다.
- **명명 규칙**: 소문자, 숫자, 하이픈(`-`)만 허용하며, 문자로 시작해야 한다(SHOULD).
- **최대 길이**: 63자를 초과해서는 안 된다(SHOULD).

```yaml
# 올바른 예시
metadata:
  name: telegram-bot
  name: mcp-github-v2
  name: planner-agent

# 잘못된 예시 (검증 오류)
metadata:
  name: Slack_Bot      # 대문자, 언더스코어 사용
  name: -invalid       # 하이픈으로 시작
```

### 3.5 허용 YAML 파일명

디렉토리 번들 로드 시, 아래 이름의 YAML 파일만 리소스로 인식한다. 이 외의 YAML 파일(`pnpm-lock.yaml`, `docker-compose.yaml` 등)은 무시된다.

| 파일명 (단수/복수) | 용도 |
|---------------------|------|
| `goondan` | 메인 번들 (Package + 모든 리소스) |
| `model` / `models` | Model 리소스 |
| `agent` / `agents` | Agent 리소스 |
| `tool` / `tools` | Tool 리소스 |
| `extension` / `extensions` | Extension 리소스 |
| `connector` / `connectors` | Connector 리소스 |
| `connection` / `connections` | Connection 리소스 |
| `swarm` / `swarms` | Swarm 리소스 |
| `resources` | 여러 종류를 담는 범용 파일 |

확장자는 `.yaml` 또는 `.yml` 모두 허용. 하위 디렉토리 포함 재귀 검색.

> **v2 변경:** `oauth` 파일명은 더 이상 인식하지 않는다 (OAuthApp Kind 제거).

### 3.6 다중 YAML 문서 (---) 처리

- 하나의 YAML 파일에 여러 문서를 `---` 로 구분하여 포함할 수 있다(MAY).
- 각 문서는 독립적인 리소스로 해석된다(MUST).
- 문서 순서는 로딩 순서를 결정하지만, 참조 해석 순서에는 영향을 주지 않는다(SHOULD).
- 빈 문서(--- 만 있는 경우)는 무시한다(SHOULD).
- `kind` 필드가 없는 문서는 Goondan 리소스가 아닌 것으로 간주하여 무시한다(SHOULD).

```yaml
# goondan.yaml - 다중 문서 예시 (Package 없는 단순 구성)
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
  prompts:
    systemPrompt: "You are a coding assistant."

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

첫 번째 문서가 `kind: Package`이면 프로젝트의 패키지 메타데이터로 해석하고, 이후 문서들은 리소스로 해석한다. 상세 스펙은 `docs/specs/bundle_package.md`를 참조한다.

```yaml
# goondan.yaml - Package를 포함하는 다중 문서 예시
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
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
```

### 3.7 metadata.labels와 annotations

```yaml
metadata:
  name: bash
  labels:
    tier: base           # Selector에서 matchLabels로 선택 가능
    category: shell
  annotations:
    description: "셸 명령 실행 도구"
```

- **labels**: Selector의 `matchLabels`에서 선택 기준으로 사용된다.
- **annotations**: 메타 정보 저장용으로, 런타임 동작에 영향을 주지 않는다.
- 키/값은 모두 문자열이어야 한다(MUST).

---

## 4. ObjectRef 상세

이 섹션은 번들 문맥의 사용 예시를 다룬다. ObjectRef 타입 원형/규칙의 단일 기준(SSOT)은 `docs/specs/shared-types.md`와 `docs/specs/resources.md`의 `ObjectRef 참조 문법` 섹션이다.

ObjectRef는 다른 리소스를 참조하는 방법을 정의한다.

### 4.1 지원 형식

```yaml
# 1. 문자열 축약 형식 (권장)
"Kind/name"

# 2. 객체형 형식
{ kind: Kind, name: name }

# 3. 패키지 참조 형식 (Package 간 참조)
{ kind: Kind, name: name, package: "@goondan/base" }
```

### 4.2 문자열 축약 형식 해석 규칙

문자열 축약 형식 `"Kind/name"`은 다음 규칙에 따라 해석된다(MUST).

1. `/` 를 구분자로 분리한다.
2. 첫 번째 부분을 `kind`로, 두 번째 부분을 `name`으로 해석한다.
3. `apiVersion`은 `goondan.ai/v1`을 기본값으로 사용한다.
4. `/`가 없거나 2개 이상이면 검증 오류로 처리한다(MUST).

```yaml
# 문자열 축약 형식 예시
tools:
  - ref: "Tool/bash"
  - ref: "Tool/file-system"
modelRef: "Model/claude"
agentRef: "Agent/coder"
connectorRef: "Connector/telegram"

# 잘못된 형식 (검증 오류)
tools:
  - ref: "bash"                  # kind 누락
  - ref: "Tool/slack/post"      # /가 2개 이상
  - ref: "Tool/"                # name 누락
```

### 4.3 객체형 형식 해석 규칙

```yaml
# 기본 형식 (권장)
{ kind: Tool, name: bash }

# 패키지 참조
{ kind: Tool, name: bash, package: "@goondan/base" }
```

1. `kind`와 `name`은 필수이다(MUST).
2. `apiVersion` 생략 시 `goondan.ai/v1`을 기본값으로 사용한다(SHOULD).
3. `package`는 Package 간 참조 시 참조 범위를 명시하는 데 사용할 수 있다(SHOULD).

### 4.4 참조 무결성

- ObjectRef가 참조하는 대상 리소스는 존재해야 한다(MUST).
- 존재하지 않는 리소스를 참조하면 검증 오류로 처리한다(MUST).
- 순환 참조는 허용되지 않으며, 검증 단계에서 탐지해야 한다(SHOULD).

---

## 5. Selector + Overrides 상세

이 섹션은 로딩 시점 동작 예시를 다룬다. `Selector`, `SelectorWithOverrides`, `RefOrSelector` 타입 원형은 `docs/specs/shared-types.md`와 `docs/specs/resources.md`의 `Selector + Overrides 조립 문법` 섹션을 기준으로 한다.

Selector는 라벨 기반으로 리소스를 선택하고, Overrides는 선택된 리소스의 설정을 덮어쓴다.

### 5.1 Selector 형식

```yaml
# 1. 단일 리소스 선택 (name 지정)
selector:
  kind: Tool
  name: bash

# 2. 라벨 기반 선택
selector:
  kind: Tool
  matchLabels:
    tier: base
    category: shell

# 3. kind만 지정 (해당 kind의 모든 리소스)
selector:
  kind: Tool
```

### 5.2 selector 해석 알고리즘

Selector 해석은 다음 단계를 따른다(MUST).

1. **kind 필터링**: `kind`가 지정되면 해당 kind의 리소스만 대상으로 한다.
2. **name 매칭**: `name`이 지정되면 정확히 일치하는 리소스 1개를 선택한다.
3. **matchLabels 매칭**: `matchLabels`가 지정되면 모든 라벨 조건을 만족하는 리소스를 선택한다 (AND 조건).
4. **결과 집합**: 위 조건을 모두 만족하는 리소스 목록을 반환한다.

### 5.3 matchLabels 매칭 규칙

- 모든 지정된 라벨이 일치해야 선택된다(AND 조건)(MUST).
- 라벨 값은 정확히 일치해야 한다(MUST).
- 대상 리소스에 추가 라벨이 있어도 무방하다.
- 라벨 키/값은 대소문자를 구분한다(MUST).

### 5.4 overrides 병합 알고리즘

overrides는 선택된 리소스의 `spec`을 부분적으로 덮어쓴다.

**병합 규칙(MUST)**:

1. **객체(Object)**: 재귀적으로 병합한다. 양쪽에 동일 키가 있으면 overrides 값이 우선한다.
2. **스칼라(Scalar)**: overrides 값으로 완전히 덮어쓴다.
3. **배열(Array)**: overrides 배열로 완전히 교체한다(병합하지 않음).
4. **null 값**: 명시적 null은 해당 필드를 제거한다(SHOULD).

```yaml
# 원본 Tool 리소스
kind: Tool
metadata:
  name: bash
spec:
  entry: "./tools/bash/index.ts"
  errorMessageLimit: 1000

# Selector + Overrides 적용
- selector:
    kind: Tool
    name: bash
  overrides:
    spec:
      errorMessageLimit: 2000              # 스칼라: 덮어쓰기

# 결과
spec:
  entry: "./tools/bash/index.ts"           # 유지
  errorMessageLimit: 2000                   # 덮어쓰기됨
```

### 5.5 Selector + Overrides 사용 위치

Selector + Overrides는 Agent의 `tools`/`extensions`에서 사용할 수 있다.

```yaml
kind: Agent
spec:
  tools:
    # 직접 참조
    - ref: "Tool/bash"

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

## 6. ValueSource 상세

이 섹션은 번들 작성 관점의 예시를 다룬다. `ValueSource`/`SecretRef` 타입 원형은 `docs/specs/shared-types.md`와 `docs/specs/resources.md`의 `ValueSource / SecretRef 타입` 섹션을 기준으로 한다.

ValueSource는 설정 값을 다양한 소스에서 가져오는 패턴을 정의한다. Model의 apiKey, Connection의 secrets 등에서 사용된다.

### 6.1 지원 형식

```yaml
# 1. 직접 값 지정
value: "plain-text-value"

# 2. 환경변수에서 가져오기 (권장)
valueFrom:
  env: "ANTHROPIC_API_KEY"

# 3. 비밀 저장소에서 가져오기
valueFrom:
  secretRef:
    ref: "Secret/api-keys"
    key: "anthropic"
```

### 6.2 상호 배타 규칙

1. `value`와 `valueFrom`은 동시에 존재할 수 없다(MUST).
2. `valueFrom` 내에서 `env`와 `secretRef`는 동시에 존재할 수 없다(MUST).
3. 둘 다 없으면 검증 오류로 처리한다(MUST).

### 6.3 valueFrom.env 환경변수 해석

```yaml
valueFrom:
  env: "ANTHROPIC_API_KEY"
```

**해석 규칙(MUST)**:

1. 런타임은 시작 시점에 해당 환경변수를 조회한다.
2. 환경변수가 존재하면 그 값을 사용한다.
3. 환경변수가 존재하지 않으면:
   - 필수 필드인 경우: 구성 로드 단계에서 오류로 처리한다(MUST).
   - 선택 필드인 경우: 해당 필드를 미설정 상태로 둔다(SHOULD).

### 6.4 valueFrom.secretRef 비밀 저장소 해석

```yaml
valueFrom:
  secretRef:
    ref: "Secret/api-keys"
    key: "anthropic"
```

**secretRef.ref 형식 규칙(MUST)**:

1. 형식: `"Secret/<name>"`
2. `Secret`은 런타임이 제공하는 비밀 저장소 엔트리를 가리키는 예약된 kind이다.
3. `<name>`은 비밀 저장소 내 엔트리 이름이다.

**보안 요구사항(MUST)**:

1. 비밀값은 로그, 이벤트 payload, LLM 컨텍스트에 평문으로 노출되어서는 안 된다.
2. 비밀값(토큰, 시크릿)을 `value`로 직접 지정하지 않는다(SHOULD NOT).

---

## 7. 보안: YAML 폭탄 방지

번들 YAML 파싱 시 다음 보안 제한을 적용해야 한다(MUST).

### 7.1 파일 크기 제한

- 단일 YAML 파일은 **1MB**를 초과할 수 없다(MUST).
- 1MB를 초과하는 파일은 파싱 전에 거부한다.

### 7.2 문서 수 제한

- 단일 YAML 파일 내 **최대 100개** 문서(`---`)를 허용한다(MUST).
- 100개를 초과하면 파싱을 중단하고 오류를 반환한다.

### 7.3 앵커/별칭 제한

- YAML 앵커(`&`)와 별칭(`*`)에 의한 확장 결과가 원본 크기의 **10배**를 초과하면 거부한다(SHOULD).

---

## 8. 경로 해석 규칙

### 8.1 entry 필드 경로 해석

Tool, Extension, Connector의 `spec.entry` 경로는 **Bundle Root**(goondan.yaml이 위치한 디렉터리) 기준 상대 경로로 해석한다(MUST).

```yaml
# goondan.yaml이 /workspace/my-swarm/에 위치한 경우
kind: Tool
spec:
  entry: "./tools/bash/index.ts"
  # 실제 경로: /workspace/my-swarm/tools/bash/index.ts
```

### 8.2 경로 보안 규칙

1. `../`를 포함하는 상위 디렉터리 참조는 거부해야 한다(MUST).
2. 절대 경로 참조도 거부해야 한다(MUST).
3. 모든 경로는 Bundle Root 기준 상대 경로여야 한다.

### 8.3 프롬프트 파일 참조

Agent의 `spec.prompts.systemRef` 경로도 Bundle Root 기준 상대 경로로 해석한다(MUST).

```yaml
kind: Agent
spec:
  prompts:
    systemRef: "./prompts/coder.system.md"
    # 실제 경로: /workspace/my-swarm/prompts/coder.system.md
```

---

## 9. 완전한 번들 예시

### 9.1 최소 프로젝트

```
my-agent/
├── goondan.yaml          # 모든 리소스 정의
└── (tools/, extensions/, connectors/ - 필요시)
```

### 9.2 goondan.yaml 전체 예시

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
kind: Tool
metadata:
  name: bash
  labels:
    tier: base
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
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coder
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompts:
    systemPrompt: |
      You are a coding assistant.
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

### 9.3 분할 파일 구성 예시

```
my-swarm/
├── goondan.yaml          # Package + Swarm + Connection
├── models.yaml           # Model 리소스
├── agents.yaml           # Agent 리소스
├── tools/
│   ├── tools.yaml        # Tool 리소스 정의
│   ├── bash/index.ts
│   └── file-system/index.ts
├── extensions/
│   ├── extensions.yaml   # Extension 리소스 정의
│   └── logging/index.ts
├── connectors/
│   ├── connectors.yaml   # Connector 리소스 정의
│   └── telegram/index.ts
└── prompts/
    └── coder.system.md
```

---

## 10. Validation 규칙 요약

공통 검증 규칙(참조 무결성, ValueSource 상호배타, Kind별 스키마)은 `docs/specs/resources.md`를 단일 기준으로 한다. 본 섹션은 번들 로더 관점의 추가 제약만 요약한다.

### 10.1 로드 단계 검증

구성 검증은 Runtime 시작 전 "로드 단계"에서 수행되어야 한다(MUST).

1. 오류가 하나라도 있으면 부분 로드 없이 전체 구성을 거부해야 한다(MUST).
2. 검증 오류는 위치와 코드가 포함된 구조화된 형식으로 반환해야 한다(MUST).
3. 오류 객체는 사용자 복구를 위한 `suggestion`과 선택적 `helpUrl` 필드를 포함하는 것을 권장한다(SHOULD).

검증 오류 예시:

```json
{
  "code": "E_CONFIG_REF_NOT_FOUND",
  "message": "Tool/bash 참조를 찾을 수 없습니다.",
  "path": "resources/agent.yaml#spec.tools[0]",
  "suggestion": "kind/name 또는 package 범위를 확인하세요.",
  "helpUrl": "https://docs.goondan.ai/errors/E_CONFIG_REF_NOT_FOUND"
}
```

### 10.2 공통 검증

| 규칙 | 수준 |
|------|------|
| `apiVersion`은 `goondan.ai/v1`이어야 함 | MUST |
| `kind`는 8종 중 하나여야 함 | MUST |
| `metadata.name`은 비어있지 않아야 함 | MUST |
| 동일 Kind 내 name 고유성 | MUST |
| YAML 파일 크기 1MB 이하 | MUST |
| YAML 문서 수 100개 이하 | MUST |
| entry 경로에 `../` 또는 절대 경로 금지 | MUST |
| ObjectRef 참조 대상 존재 | MUST |
| ValueSource에서 value/valueFrom 상호 배타 | MUST |

### 10.3 Kind별 필수 필드 검증

| Kind | 필수 필드 |
|------|----------|
| Model | `provider`, `model` |
| Tool | `entry`, `exports` (1개 이상) |
| Extension | `entry` |
| Agent | `modelConfig.modelRef`, `prompts` (systemPrompt 또는 systemRef) |
| Swarm | `entryAgent`, `agents` (1개 이상), entryAgent는 agents에 포함 |
| Connector | `entry`, `events` (1개 이상) |
| Connection | `connectorRef` |
| Package | `metadata.name`, 첫 번째 YAML 문서에만 위치 |

### 10.4 제거된 필드 검증

다음 필드가 존재하면 경고 또는 오류를 발생시켜야 한다(SHOULD).

| 필드 | 이전 위치 | v2 상태 |
|------|-----------|---------|
| `runtime` | Tool/Extension/Connector spec | 제거 (항상 Bun) |
| `triggers` | Connector spec | 제거 (자체 프로토콜 관리) |
| `auth` | Tool spec | 제거 (Extension에서 관리) |
| `hooks` | Agent spec | 제거 (Extension 미들웨어) |
| `changesets` | Agent/Swarm spec | 제거 (Edit & Restart) |
| `liveConfig` | Swarm policy | 제거 |
| `queueMode` | Swarm policy | 제거 |

---

## 관련 문서

- `/docs/specs/resources.md` - Config Plane 리소스 정의 스펙
- `/docs/specs/bundle_package.md` - Package 스펙
- `/GUIDE.md` - 개발자 가이드
