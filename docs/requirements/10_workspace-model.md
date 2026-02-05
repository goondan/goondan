## 10. 워크스페이스 모델

Runtime은 인스턴스와 에이전트 실행을 위한 파일시스템 워크스페이스를 관리한다. 워크스페이스에는 repo 캐시, 작업트리, 임시 디렉터리, 공유 산출물 영역 등이 포함될 수 있다.

본 문서는 파일시스템 레이아웃을 다음 3개의 “루트”로 분리해 정의한다(MUST).

1. **SwarmBundleRoot**: `gdn init`이 생성하는 프로젝트(= SwarmBundle 정의). Changeset에 의해 변경될 수 있다(MUST).
2. **Instance State Root**: SwarmInstance/AgentInstance의 실행 중 상태(로그 등). SwarmBundleRoot와 분리되어야 한다(MUST).
3. **System State Root**: 인스턴스 생명주기와 무관한 전역 상태(OAuth, Bundle Package cache 등). Instance State Root와 분리되어야 한다(MUST).

권장 레이아웃 예시는 다음과 같다(SHOULD).

* `<goondanHome>/instances/<workspaceId>/<instanceId>/`
* `<goondanHome>/worktrees/<workspaceId>/changesets/<changesetId>/`
* `<goondanHome>/bundles/`
* `<goondanHome>/oauth/`
* `<goondanHome>/secrets/` (구현 선택)

여기서 `<goondanHome>`은 Goondan의 전역 상태 루트이며, 기본값은 `~/.goondan/`이다(구현 선택, SHOULD).  
또한 `<workspaceId>`는 서로 다른 SwarmBundleRoot(프로젝트) 간 인스턴스 충돌을 방지하기 위한 상위 네임스페이스이며, SwarmBundleRoot의 절대 경로 해시 등으로 안정적으로 결정하는 것을 권장한다(SHOULD).

### 10.1 SwarmBundleRoot 레이아웃 (MUST)

SwarmBundleRoot는 Swarm(및 그 하위 Agent/Tool/Extension/Connector/OAuthApp 등)을 정의하는 Bundle의 루트이다. `gdn init`은 1개의 SwarmBundleRoot를 생성해야 하며(MUST), SwarmBundleRoot의 콘텐츠는 Changeset에 의해 변경될 수 있어야 한다(MUST).

권장 레이아웃 예시는 다음과 같다.

```text
<swarmBundleRoot>/
  goondan.yaml                         # SHOULD: 단일 파일 구성(간단 모드)
  resources/                           # MAY: 리소스 분할
  prompts/                             # MAY
  tools/                               # MAY
  extensions/                          # MAY
  connectors/                          # MAY
  bundle.yaml                          # MAY: Bundle Package를 함께 두는 경우
  .git/                                # SHOULD: Git 기반 changeset(§6.4) 권장
```

규칙:

* Runtime은 SwarmBundleRoot 하위에 런타임 상태 디렉터리를 생성해서는 안 된다(MUST NOT). (예: `.goondan/`, `state/`)
* changeset worktree는 System State Root(= `<goondanHome>`) 하위에 생성해야 한다(SHOULD). (§6.4)

### 10.2 Instance State 레이아웃 (MUST)

Instance State Root는 SwarmBundleRoot와 분리되어야 한다(MUST).

권장 레이아웃 예시는 다음과 같다.

```text
<goondanHome>/instances/<workspaceId>/<instanceId>/
  swarm/
    events/
      events.jsonl                     # MUST: SwarmInstance event log (append-only)
  agents/
    <agentName>/
      messages/
        llm.jsonl                      # MUST: LLM message log (append-only)
      events/
        events.jsonl                   # MUST: AgentInstance event log (append-only)
```

Instance State Root에는 SwarmBundle 정의(소스코드/YAML) 또는 changeset worktree를 두지 않는 것을 권장한다(SHOULD). (정의/상태 분리)

### 10.2.1 LLM Message Log (MUST)

Runtime은 AgentInstance별로 LLM 메시지 로그를 append-only JSONL로 기록해야 한다(MUST). 각 레코드는 최소한 다음 필드를 포함해야 한다(MUST).

- `type`: `"llm.message"`
- `recordedAt`: ISO8601 timestamp
- `instanceId`, `instanceKey`, `agentName`, `turnId`
- `stepId` (선택)
- `stepIndex` (선택)
- `message`: `Turn.messages`의 단일 항목

예시:

```json
{
  "type": "llm.message",
  "recordedAt": "2026-02-01T12:34:56.789Z",
  "instanceId": "default-cli",
  "instanceKey": "cli",
  "agentName": "planner",
  "turnId": "turn-abc",
  "stepId": "step-xyz",
  "stepIndex": 0,
  "message": { "role": "assistant", "content": "..." }
}
```

### 10.2.2 Event Log (MUST)

Runtime은 SwarmInstance 및 AgentInstance별로 이벤트 로그를 append-only JSONL로 기록해야 한다(MUST).

* Swarm event log: `<goondanHome>/instances/<workspaceId>/<instanceId>/swarm/events/events.jsonl`
* Agent event log: `<goondanHome>/instances/<workspaceId>/<instanceId>/agents/<agentName>/events/events.jsonl`

Swarm event 레코드는 최소 다음 필드를 포함해야 한다(MUST).

* `type`: `"swarm.event"`
* `recordedAt`: ISO8601 timestamp
* `kind`: 이벤트 종류(문자열)
* `instanceId`, `instanceKey`, `swarmName`
* `agentName` (선택)
* `data` (선택): JsonObject

Agent event 레코드는 최소 다음 필드를 포함해야 한다(MUST).

* `type`: `"agent.event"`
* `recordedAt`: ISO8601 timestamp
* `kind`: 이벤트 종류(문자열)
* `instanceId`, `instanceKey`, `agentName`
* `turnId`, `stepId`, `stepIndex` (선택)
* `data` (선택): JsonObject

### 10.3 System State 디렉터리 레이아웃 (MUST)

Runtime은 인스턴스 상태(Instance State Root)와 별개로, 인스턴스 생명주기와 독립적으로 유지되는 시스템 전역 상태 루트(System State Root)를 제공해야 한다(MUST). 시스템 전역 상태는 Runtime 재시작 또는 개별 SwarmInstance/AgentInstance의 삭제와 무관하게 유지되어야 하며, 특히 OAuth 토큰/그랜트는 이 영역에 저장되어야 한다(MUST).

권장 레이아웃 예시는 다음과 같다.

```text
<goondanHome>/
  bundles.json                        # Bundle Package registry
  bundles/                            # Bundle Package cache
  worktrees/
    <workspaceId>/
      changesets/
        <changesetId>/                # openChangeset workdir (Git worktree root)
  oauth/
    grants/
      <subjectHash>.<ext>              # MUST: at-rest encryption 적용 (예: .json, .sops.yaml)
    sessions/
      <authSessionId>.<ext>            # MUST: at-rest encryption 적용 (예: .json, .sops.yaml)
      index.json                       # MAY
  instances/
    <workspaceId>/<instanceId>/...     # Instance State Root
  secrets/                             # Secret/<name> 저장소 (구현 선택)
```

규칙:

1. `<goondanHome>/oauth/grants`는 OAuthGrantRecord(§12.5.4)의 저장소이며, 인스턴스가 사라져도 유지되어야 한다(MUST).
2. `<goondanHome>/oauth/sessions`는 승인 진행 중(AuthSession) 상태(AuthSessionRecord, §12.5.5)의 저장소이며, 승인 완료 또는 만료 후에는 정리될 수 있다(SHOULD).
3. OAuthStore에 저장되는 문서는 디스크에 평문으로 남지 않도록 반드시 at-rest encryption을 적용해야 한다(MUST). 구현은 SOPS 호환 포맷(예: `.sops.yaml`) 또는 동등한 envelope encryption 포맷(예: 암호문 필드를 포함한 `.json`)을 사용하는 것을 권장한다(SHOULD).
4. DB 기반 저장소는 향후 확장으로 고려할 수 있으나, v0.7 범위에서는 정의하지 않으며(스펙 아웃), 표준 저장소는 파일시스템 기반 OAuthStore로 간주한다.
