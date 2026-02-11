## 6. Config 스펙

### 6.1 리소스 공통 형식

1. 모든 리소스는 `apiVersion`, `kind`, `metadata`, `spec`를 포함해야 한다(MUST).
2. `apiVersion`은 `goondan.ai/v1`이어야 한다(MUST).
3. `metadata.name`은 동일한 package 범위에서 `kind+name` 조합으로 고유해야 한다(MUST).
4. 단일 YAML 파일에서 다중 문서(`---`)를 지원해야 한다(MUST).

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <string>
  labels: {}
  annotations: {}
spec:
  # Kind별 스키마
```

#### 6.1.1 apiVersion 버전 정책

1. 비호환 변경은 `version` 상승(예: `v1` → `v2`)으로 표현해야 한다(MUST).
2. Runtime은 지원하지 않는 `apiVersion`을 로드 단계에서 명시적 오류로 거부해야 한다(MUST).
3. Deprecated 리소스/필드는 최소 1개 이상의 하위 버전에서 경고를 제공해야 한다(SHOULD).

#### 6.1.2 지원 Kind

v2에서 지원하는 Kind는 8종이다:

| Kind | 역할 |
|------|------|
| **Model** | LLM 프로바이더 설정 |
| **Agent** | 에이전트 정의 (모델, 프롬프트, 도구, 익스텐션) |
| **Swarm** | 에이전트 집합 + 실행 정책 |
| **Tool** | LLM이 호출하는 함수 |
| **Extension** | 라이프사이클 미들웨어 인터셉터 |
| **Connector** | 외부 프로토콜 수신 (별도 프로세스, 자체 프로토콜 관리) |
| **Connection** | Connector - Swarm 바인딩 |
| **Package** | 프로젝트 매니페스트/배포 단위 |

### 6.2 참조 문법

#### 6.2.1 ObjectRef

ObjectRef는 문자열 축약형 또는 객체형으로 표현한다.

```yaml
# 문자열 축약형 (현재 package 기준)
ref: "Tool/bash"

# 객체형
ref:
  kind: Tool
  name: bash
  package: core-tools        # 선택
  apiVersion: goondan.ai/v1  # 선택
```

규칙:

1. 문자열 축약형은 `Kind/name` 형식이어야 한다(MUST).
2. 객체형은 최소 `kind`, `name`을 포함해야 한다(MUST).
3. namespace 개념은 요구사항 범위에서 정의하지 않으며, 필요 시 `package` 필드로 참조 범위를 명시해야 한다(SHOULD).

#### 6.2.2 Selector

1. `{ kind, name }` 단일 선택을 지원해야 한다(MUST).
2. `{ matchLabels: {...}, kind? }` 라벨 기반 선택을 지원할 수 있다(MAY).

### 6.3 Selector + Overrides 조립 문법

1. 블록에 `selector`가 있으면 선택형 조립으로 해석해야 한다(MUST).
2. 선택된 리소스에 `overrides`를 적용할 수 있어야 한다(MUST).
3. 기본 병합 규칙은 객체 재귀 병합, 스칼라 덮어쓰기, 배열 교체를 따른다(SHOULD).

```yaml
tools:
  - selector:
      kind: Tool
      matchLabels:
        tier: base
    overrides:
      spec:
        errorMessageLimit: 2000
```

### 6.4 ValueSource / SecretRef

```yaml
value: "plain-string"
# 또는
valueFrom:
  env: "ENV_VAR_NAME"
# 또는
valueFrom:
  secretRef:
    ref: "Secret/slack-oauth"
    key: "client_secret"
```

규칙:

1. `value`와 `valueFrom`은 동시에 존재할 수 없다(MUST).
2. `valueFrom`에서 `env`와 `secretRef`는 동시에 존재할 수 없다(MUST).
3. 비밀값(access token, refresh token, client secret 등)은 Base Config에 직접 포함하지 않아야 한다(SHOULD).

### 6.5 구성 검증 시점과 오류 보고

1. 구성 검증은 Runtime 시작 전 "로드 단계"에서 수행되어야 한다(MUST).
2. 오류가 하나라도 있으면 부분 로드 없이 전체 구성을 거부해야 한다(MUST).
3. 검증 오류는 위치와 코드가 포함된 구조화된 형식으로 반환해야 한다(MUST).
4. 오류 객체는 사용자 복구를 위한 `suggestion`과 선택적 `helpUrl` 필드를 포함하는 것을 권장한다(SHOULD).

오류 예시:

```json
{
  "code": "E_CONFIG_REF_NOT_FOUND",
  "message": "Tool/bash 참조를 찾을 수 없습니다.",
  "path": "resources/agent.yaml#spec.tools[0]",
  "suggestion": "kind/name 또는 package 범위를 확인하세요.",
  "helpUrl": "https://docs.goondan.ai/errors/E_CONFIG_REF_NOT_FOUND"
}
```
