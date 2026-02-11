# Goondan Bundle YAML 스펙 (v2.0)

> **현재 규범 요약:**
> - `apiVersion`: `goondan.ai/v1`
> - 지원 Kind: **8종**
> - 실행 환경: Bun
> - Connector 스키마: `entry` + `events`
> - Tool 스키마: `exports` 배열 기반 도구 이름 규칙 (`__`)
> - Agent: 라이프사이클 개입은 Extension 미들웨어 사용

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
- `apiVersion`은 모든 리소스에서 명시되어야 한다(MUST).
- 비호환 변경은 `version` 상승(예: `v1` -> `v2`)으로 표현한다(MUST).
- Runtime은 지원하지 않는 `apiVersion`을 로드 단계에서 명시적 오류로 거부해야 한다(MUST).

```yaml
# 올바른 예시
apiVersion: goondan.ai/v1
kind: Model

# 잘못된 예시 (검증 오류)
kind: Model
```

### 3.3 kind 목록

지원하는 Kind는 **8종**이다.

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

### 3.4 metadata.name 유일성 규칙

- `metadata.name`은 **동일 kind 내에서 고유**해야 한다(MUST).
- 네임스페이스가 없는 경우, 전역 범위에서 고유성을 보장한다.
- **명명 규칙**: 소문자, 숫자, 하이픈(`-`)만 허용하며, 문자로 시작해야 한다(SHOULD).
- **최대 길이**: 63자를 초과해서는 안 된다(SHOULD).

```yaml
# 올바른 예시
metadata:
  name: telegram-bot

# 다른 올바른 예시
metadata:
  name: mcp-github-v2

# 또 다른 올바른 예시
metadata:
  name: planner-agent

# 잘못된 예시 (검증 오류)
metadata:
  name: Slack_Bot      # 대문자, 언더스코어 사용

# 잘못된 예시 (검증 오류)
metadata:
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

## 4. ObjectRef 사용 요약

ObjectRef 타입 원형과 해석/검증 규칙의 단일 기준(SSOT)은 `docs/specs/resources.md`의 `ObjectRef 참조 문법`과 `docs/specs/shared-types.md` 2절이다.
이 문서는 번들 작성 문맥의 사용 위치와 예시만 제공한다.

### 4.1 번들에서의 사용 예시

```yaml
spec:
  modelConfig:
    modelRef: "Model/claude"
  tools:
    - ref: "Tool/bash"
  connectorRef:
    kind: Connector
    name: telegram
```

### 4.2 번들 문맥 규칙

1. 번들 로더는 ObjectRef 파싱/검증 시 `docs/specs/resources.md` 규칙을 그대로 적용해야 한다(MUST).
2. 번들 문서는 ObjectRef 파싱 알고리즘을 별도로 재정의하지 않아야 한다(MUST NOT).

---

## 5. Selector + Overrides 사용 요약

`Selector`/`SelectorWithOverrides`/`RefOrSelector`의 단일 기준은 `docs/specs/resources.md`의 `Selector + Overrides 조립 문법`이다.
이 문서는 Agent 구성에서의 대표 사용 패턴만 다룬다.

### 5.1 번들에서의 사용 예시

```yaml
kind: Agent
spec:
  tools:
    - selector:
        kind: Tool
        matchLabels:
          tier: base
      overrides:
        spec:
          errorMessageLimit: 2000
```

### 5.2 번들 문맥 규칙

1. Selector 매칭 및 overrides 병합 알고리즘은 `docs/specs/resources.md`를 단일 기준으로 따른다(MUST).
2. 번들 문서는 알고리즘 상세를 중복 정의하지 않고 사용 위치/예시 중심으로 유지해야 한다(SHOULD).

---

## 6. ValueSource 사용 요약

`ValueSource`/`ValueFrom`/`SecretRef`의 단일 기준은 `docs/specs/resources.md` 7절과 `docs/specs/shared-types.md` 3절이다.
환경변수 해석 정책은 `docs/specs/help.md` 3.2절을 따른다.

### 6.1 번들에서의 사용 예시

```yaml
apiKey:
  valueFrom:
    env: ANTHROPIC_API_KEY

secrets:
  webhookSecret:
    valueFrom:
      secretRef:
        ref: "Secret/webhooks"
        key: "telegram"
```

### 6.2 번들 문맥 규칙

1. `value`/`valueFrom` 상호 배타 및 `valueFrom` 하위 규칙은 `docs/specs/resources.md`를 따른다(MUST).
2. 번들 문서는 ValueSource 해석 정책을 재정의하지 않아야 한다(MUST NOT).

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

### 10.4 스키마 엄격 검증

스키마에 정의된 필드 집합만 허용하며, 정의되지 않은 필드는 검증 오류를 반환해야 한다(MUST).

---

## 관련 문서

- `/docs/specs/resources.md` - Config Plane 리소스 정의 스펙
- `/docs/specs/bundle_package.md` - Package 스펙
- `/GUIDE.md` - 개발자 가이드
