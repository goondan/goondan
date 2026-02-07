## 6. Config 스펙

### 6.1 리소스 공통 형식

1. 모든 리소스는 `apiVersion`, `kind`, `metadata`, `spec`를 포함해야 한다(MUST).
2. `apiVersion`은 `<group>/<version>` 형식을 따라야 한다(MUST).
3. `metadata.name`은 동일한 package 범위에서 `kind+name` 조합으로 고유해야 한다(MUST).
4. 단일 YAML 파일에서 다중 문서(`---`)를 지원해야 한다(MUST).

#### 6.1.1 apiVersion 버전 정책

1. 비호환 변경은 `version` 상승(예: `v1alpha1` → `v1beta1`)으로 표현해야 한다(MUST).
2. Runtime은 지원하지 않는 `apiVersion`을 로드 단계에서 명시적 오류로 거부해야 한다(MUST).
3. Deprecated 리소스/필드는 최소 1개 이상의 하위 버전에서 경고를 제공해야 한다(SHOULD).

### 6.2 참조 문법

#### 6.2.1 ObjectRef

ObjectRef는 문자열 축약형 또는 객체형으로 표현한다.

```yaml
# 문자열 축약형 (현재 package 기준)
ref: "Tool/slackToolkit"

# 객체형
ref:
  kind: Tool
  name: slackToolkit
  package: core-tools        # 선택
  apiVersion: agents.example.io/v1alpha1  # 선택
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

### 6.4 Changeset / Ref (Git 기반)

Goondan은 SwarmBundleRoot를 Git 저장소로 취급하는 구현을 기본으로 가정한다(SHOULD). Changeset/Ref의 정본은 Git이며, 병렬 정본 파일을 강제하지 않는다(MUST NOT).

#### 6.4.1 Changeset Open

Runtime은 `swarmBundle.openChangeset`을 제공해야 하며, changesetId와 쓰기 가능한 workdir을 반환해야 한다(MUST).

규칙:

1. Open된 workdir은 baseRef 콘텐츠로 초기화되어야 한다(MUST).
2. Open된 changeset은 commit 전까지 실행에 영향을 주지 않아야 한다(MUST).
3. workdir은 SwarmBundleRoot 바깥(System State Root 하위)에 생성되어야 한다(MUST).

#### 6.4.2 Changeset Commit

Runtime은 `swarmBundle.commitChangeset`을 제공해야 하며, 결과에 상태와 참조 정보를 포함해야 한다(MUST).

상태 값:

- `ok`: 커밋 성공
- `rejected`: 정책 위반으로 거부
- `conflict`: Git 충돌 발생
- `failed`: 기타 실행 실패

반환 규칙:

1. 모든 상태는 `changesetId`, `baseRef`, `status`를 포함해야 한다(MUST).
2. `ok`일 때는 `newRef`를 포함해야 한다(MUST).
3. `conflict`일 때는 `currentHeadRef`, `conflicts[]`, `suggestedAction`을 포함해야 한다(MUST).
4. allowlist 위반은 `rejected`로 반환해야 한다(MUST).

충돌 처리 규칙:

1. 여러 Agent가 동시에 changeset을 여는 것은 허용된다(MUST).
2. commit 시 충돌이 발생하면 자동 은폐/자동 폐기해서는 안 되며, 충돌 정보를 에이전트가 복구할 수 있게 반환해야 한다(MUST).

#### 6.4.3 경로 보안 규칙

1. allowlist 검증 전 경로는 정규화(normalize)되어야 한다(MUST).
2. `..`, 절대경로, 심볼릭 링크 탈출로 SwarmBundleRoot 바깥을 수정하는 변경은 즉시 거부해야 한다(MUST).

#### 6.4.4 적용(Activation)

commit된 `newRef`는 Safe Point(기본 `step.config`)에서만 활성화되어야 하며, 일반적으로 다음 Step부터 반영되어야 한다(MUST).

### 6.5 ValueSource / SecretRef

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

### 6.6 구성 검증 시점과 오류 보고

1. 구성 검증은 Runtime 시작 전 "로드 단계"에서 수행되어야 한다(MUST).
2. 오류가 하나라도 있으면 부분 로드 없이 전체 구성을 거부해야 한다(MUST).
3. 검증 오류는 위치와 코드가 포함된 구조화된 형식으로 반환해야 한다(MUST).
4. 오류 객체는 사용자 복구를 위한 `suggestion`과 선택적 `helpUrl` 필드를 포함하는 것을 권장한다(SHOULD).

오류 예시:

```json
{
  "code": "E_CONFIG_REF_NOT_FOUND",
  "message": "Tool/slackToolkit 참조를 찾을 수 없습니다.",
  "path": "resources/agent.yaml#spec.tools[0]",
  "suggestion": "kind/name 또는 package 범위를 확인하세요.",
  "helpUrl": "https://docs.goondan.io/errors/E_CONFIG_REF_NOT_FOUND"
}
```
