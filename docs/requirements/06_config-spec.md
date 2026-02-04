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

### 6.4 Changeset / Ref (Git 기반) (MUST)

Goondan은 SwarmBundleRoot를 Git 저장소로 취급하는 구현을 기본으로 가정한다(SHOULD). 이 경우 Changeset/Ref의 정본은 Git이며, Runtime은 Git과 별개로 `changesets.jsonl`, `changeset-status.jsonl`, `cursor.yaml`, `head.ref`, `base.ref` 같은 “병렬 정본” 파일을 요구하지 않는다(MUST NOT).

#### 6.4.1 Changeset Open (MUST)

Runtime은 LLM이 사용할 수 있는 도구로 `swarmBundle.openChangeset`을 제공해야 한다(MUST).  
Open은 changesetId와 Git worktree 경로(`workdir`)를 발급하고, 그 workdir은 **쓰기 가능**해야 한다(MUST).

권장: 각 changeset은 Git worktree 1개로 표현한다(SHOULD).

`swarmBundle.openChangeset` 반환 예시:

```json
{
  "changesetId": "cs-000123",
  "baseRef": "git:HEAD",
  "workdir": "<goondanHome>/worktrees/<workspaceId>/changesets/cs-000123/",
  "hint": {
    "bundleRootInWorkdir": ".",
    "recommendedFiles": ["goondan.yaml", "resources/**", "prompts/**", "tools/**", "extensions/**"]
  }
}
```

규칙:

* Open된 changeset의 workdir은 SwarmBundleManager가 선택한 “기준 Ref(=baseRef)”의 콘텐츠로 초기화되어야 한다(MUST).
* Open된 changeset은 commit되기 전까지 실행에 영향을 주지 않는다(MUST).
* workdir은 SwarmBundleRoot 하위에 생성되어서는 안 된다(MUST NOT). (정의/상태 분리, §10)
* workdir은 `<changesetId>/` 디렉터리 자체이며, 그 하위에 `workdir/` 같은 추가 중첩 디렉터리를 두지 않는다(MUST NOT).

#### 6.4.2 Changeset Commit (MUST)

Runtime은 changeset commit을 위한 표준 인터페이스를 MUST 제공한다.

* LLM Tool 기반: `swarmBundle.commitChangeset`
* (선택) 런타임 API 기반: `api.swarmBundle.commitChangeset(changesetId, opts)`

`swarmBundle.commitChangeset`는 workdir의 변경을 **Git commit(들)**로 만들고, SwarmBundleRoot의 활성 브랜치/Ref에 반영해야 한다(MUST).  
반영 방식(fast-forward/merge/squash 등)은 구현 선택이지만, tool 결과로 `baseRef`와 `newRef`(ok인 경우)를 제공해야 한다(MUST).

`swarmBundle.commitChangeset` 반환 예시:

```json
{
  "status": "ok",
  "changesetId": "cs-000123",
  "baseRef": "git:3d2a...9f",
  "newRef": "git:9b1c...77",
  "summary": {
    "filesChanged": ["prompts/planner.system.md"],
    "filesAdded": [],
    "filesDeleted": []
  }
}
```

정책:

* Swarm/Agent ChangesetPolicy(§7.4.1, §7.5.1)의 allowlist를 위반하면 `status="rejected"`로 반환해야 한다(MUST).
* 실패/거부 여부는 tool 결과로 충분히 관측 가능해야 하며, 별도의 status log 파일은 요구하지 않는다(MAY/SHOULD: Instance event log에 기록).

#### 6.4.3 적용(Activation) (MUST)

Commit된 `newRef`는 Safe Point(기본 `step.config`)에서만 활성화되며, 통상 다음 Step부터 반영된다(MUST). 세부 의미론은 §9.4를 따른다.

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
