## 6. Config 스펙

### 6.1 리소스 공통 형식

* 모든 리소스는 `apiVersion`, `kind`, `metadata`, `spec`를 MUST 포함한다.
* `metadata.name`은 동일 네임스페이스 내에서 고유해야 한다.
* 단일 YAML 파일에 여러 문서(`---`) 포함 가능.

### 6.2 참조 문법

#### 6.2.1 ObjectRef

* `Kind/name` 축약 문자열 MAY
* `{ apiVersion?, kind, name }` 객체형 참조 MUST

#### 6.2.2 Selector

* `{ kind, name }` 단일 선택 MUST
* `{ matchLabels: {...}, kind? }` 라벨 기반 선택 MAY

### 6.3 Selector + Overrides 조립 문법

* 블록에 `selector`가 있으면 선택형으로 해석(MUST)
* 선택형 블록에서 `overrides` 적용 가능(MUST)
* 기본 병합 규칙: 객체 재귀 병합, 스칼라 덮어쓰기, 배열 교체(SHOULD)

---

### 6.4 Changeset/SwarmRevision 상태 문서(런타임 산출물) 규격

#### 6.4.1 저장소 구조(인스턴스 단일) (MUST)

Runtime은 SwarmInstance마다 상태 루트를 제공해야 하며, Changeset/SwarmRevision 관련 상태는 **인스턴스 단일 저장소**로 관리되어야 한다(MUST).

#### 6.4.2 정본 파일 및 단일 작성자 (MUST)

다음 파일은 SwarmBundleManager가 append-only 또는 원자적 교체 방식으로 기록하는 정본이어야 하며, 다른 주체가 기록해서는 안 된다(MUST).

* Changeset Log (`changesets.jsonl`) — append-only
* Changeset Status Log (`changeset-status.jsonl`) — append-only
* Cursor (`cursor.yaml`) — 원자적 교체(atomic replace) 권장
* Head Reference (`head.ref`) — 원자적 교체(atomic replace) 권장
* Base Reference (`base.ref`) — 원자적 교체(atomic replace) 권장(초기화 이후 변경은 구현 선택)

#### 6.4.3 Changeset Open(스테이징 디렉터리) (MUST)

Runtime은 LLM이 사용할 수 있는 도구로 `swarmBundle.openChangeset`을 제공해야 한다(MUST).  
Open은 changesetId와 staging workdir 경로를 발급하고, 그 workdir은 **쓰기 가능**해야 한다(MUST).

`swarmBundle.openChangeset` 반환 예시:

```json
{
  "changesetId": "cs-000123",
  "baseSwarmRevision": "rev-000100",
  "workdir": "/workspace/shared/state/instances/inst-1/swarm-bundle/changesets/cs-000123/workdir",
  "hint": {
    "bundleRootInWorkdir": ".",
    "recommendedFiles": ["resources/*.yaml", "prompts/*.md", "tools/**", "extensions/**"]
  }
}
````

규칙:

* Open된 changeset의 workdir은 SwarmBundleManager가 선택한 “기준 SwarmRevision”의 콘텐츠로 초기화되어야 한다(MUST).
* Open된 changeset은 commit되기 전까지 실행에 영향을 주지 않는다(MUST).

#### 6.4.4 Changeset Log(정본) 규격 (MUST)

SwarmBundleManager는 커밋된 Changeset을 changesets.jsonl에 append해야 한다(MUST).
각 레코드는 최소 다음 필드를 포함해야 한다(MUST).

* `changesetId` (또는 `metadata.name`)
* `baseSwarmRevision`
* `newSwarmRevision`
* `message`
* `source` (type/name)
* `recordedAt`
* `summary` (변경 파일 목록/카운트 등, 구현 선택)

예시:

```json
{
  "apiVersion":"agents.example.io/v1alpha1",
  "kind":"SwarmChangesetRecord",
  "metadata":{"name":"cs-000123"},
  "spec":{
    "baseSwarmRevision":"rev-000100",
    "newSwarmRevision":"rev-000101",
    "message":"planner 프롬프트 업데이트 + slack tool 추가",
    "source":{"type":"agent","name":"planner"},
    "recordedAt":"2026-02-03T01:02:03Z",
    "summary":{
      "filesChanged":["prompts/planner.system.md","resources/agents.yaml","tools/slack/index.js"],
      "filesAdded":["tools/slack/README.md"]
    }
  }
}
```

#### 6.4.5 SwarmBundleManager 및 Changeset API (MUST)

Runtime은 SwarmBundleManager 컴포넌트를 MUST 제공해야 한다.

* SwarmBundleManager는 changesets/status/cursor/head/base의 유일한 작성자이다(MUST).
* Runtime은 Changeset commit을 위한 표준 인터페이스를 MUST 제공한다.

  * LLM Tool 기반: `swarmBundle.commitChangeset`
  * (선택) 런타임 API 기반: `api.swarmBundle.commitChangeset(changesetId, opts)`

SwarmBundleManager는 commit 시 최소 다음을 수행해야 한다(MUST).

1. 정책(allowlist) 검사
2. (선택) 구성 로드/검증(예: YAML 파싱, entry 파일 존재, exports 스키마 유효성)
3. diff 계산 및 기록(요약 또는 아티팩트 파일)
4. SwarmRevision 생성(새 스냅샷 저장)
5. Head를 새 SwarmRevision으로 이동
6. Changeset Log + Status Log 기록

#### 6.4.6 Changeset Status Log(평가/적용 로그) 규격 (MUST)

Runtime은 인스턴스별로 `changeset-status.jsonl`을 MUST 제공해야 한다. 이 로그는 Changeset의 커밋/활성화 결과를 append-only로 기록한다(MUST).

Status 레코드는 최소 다음 필드를 포함해야 한다(MUST).

* `changesetId`
* `phase`: `"commit" | "activate"`
* `result`: `"ok" | "rejected" | "failed" | "skipped"`
* `evaluatedAt`
* `baseSwarmRevision` (commit phase에서는 SHOULD)
* `newSwarmRevision` (commit phase에서 ok면 MUST)
* `appliedAt` (activate phase에서 ok면 MUST)
* `appliedInStepId` (가능하면 SHOULD)
* `reason` (가능하면 SHOULD)

예시:

```json
{"changesetId":"cs-000123","phase":"commit","result":"ok","evaluatedAt":"2026-02-03T01:02:03Z","baseSwarmRevision":"rev-000100","newSwarmRevision":"rev-000101","reason":"ok"}
{"changesetId":"cs-000123","phase":"activate","result":"ok","evaluatedAt":"2026-02-03T01:02:10Z","appliedAt":"2026-02-03T01:02:10Z","appliedInStepId":"step-9f3a","reason":"activated"}
```

#### 6.4.7 Cursor 파일 규격 (MUST)

Runtime은 인스턴스별로 `cursor.yaml`을 MUST 제공해야 한다. cursor는 재시작 복구를 위해 “현재 활성 SwarmRevision”과 “처리 커서”를 저장한다.

권장 예시:

```yaml
version: 1
swarmBundle:
  baseSwarmRevision: "rev-000100"      # MUST
  headSwarmRevision: "rev-000101"      # MUST
  activeSwarmRevision: "rev-000101"    # MUST (현재 Step들이 사용할 기준)
  lastActivatedAt: "2026-02-03T01:02:10Z"  # SHOULD
changesets:
  lastCommittedChangesetId: "cs-000123"    # SHOULD
  lastActivatedChangesetId: "cs-000123"    # SHOULD
```

#### 6.4.8 Materialized View / Effective Snapshot (선택)

* `effective/effective-<rev>.yaml`: Effective Config 스냅샷(SHOULD)
* `diffs/<changesetId>.patch`: changeset diff 아티팩트(MAY)

---

### 6.5 ValueSource / SecretRef(간단 타입) (OAuthApp/Connector에서 사용)

OAuthApp의 clientId/clientSecret, Connector의 고정 토큰 등은 환경/비밀 저장소에서 주입되는 경우가 일반적이므로, 본 문서는 간단한 ValueSource 패턴을 정의한다.

```yaml
# ValueSource
value: "plain-string"           # 또는

valueFrom:
  env: "ENV_VAR_NAME"           # 또는

valueFrom:
  secretRef:
    ref: "Secret/slack-oauth"   # Kind/name 축약 ObjectRef
    key: "client_secret"
```

규칙:

1. `value`와 `valueFrom`은 동시에 존재해서는 안 되며, 둘 중 하나만 존재해야 한다(MUST).
2. `valueFrom` 안에서는 `env`와 `secretRef`가 동시에 존재해서는 안 되며, 둘 중 하나만 존재해야 한다(MUST).
3. `secretRef.ref`는 `"Secret/<name>"` 형태의 참조 문자열이며, 여기서 `Secret`은 런타임이 제공하는 비밀 저장소 엔트리를 가리키는 예약된 kind로 취급한다(MUST).
4. Base Config에 비밀값(access token, refresh token, client secret 등)을 직접 포함하지 않도록 구성하는 것을 SHOULD 한다.
