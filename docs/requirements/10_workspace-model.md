## 10. 워크스페이스 모델

Runtime은 인스턴스 실행을 위한 파일시스템 워크스페이스를 관리한다. 본 문서는 파일시스템 레이아웃을 다음 3개 루트로 분리해 정의한다.

1. **SwarmBundleRoot**: 프로젝트 정의(구성+코드)
2. **Instance State Root**: 인스턴스 실행 상태
3. **System State Root**: 인스턴스 생명주기와 무관한 전역 상태

세 루트는 분리되어야 한다(MUST).

권장 레이아웃:

- `<goondanHome>/instances/<workspaceId>/<instanceId>/`
- `<goondanHome>/worktrees/<workspaceId>/changesets/<changesetId>/`
- `<goondanHome>/bundles/`
- `<goondanHome>/oauth/`
- `<goondanHome>/metrics/`

`<goondanHome>` 기본값은 `~/.goondan/`을 권장한다(SHOULD).

### 10.1 SwarmBundleRoot 레이아웃

```text
<swarmBundleRoot>/
  goondan.yaml
  resources/
  prompts/
  tools/
  extensions/
  connectors/
  bundle.yaml
  .git/
```

규칙:

1. `gdn init`은 SwarmBundleRoot를 생성해야 한다(MUST).
2. Runtime은 SwarmBundleRoot 하위에 실행 상태 디렉터리를 생성해서는 안 된다(MUST NOT).
3. changeset worktree는 System State Root 하위에 생성해야 한다(SHOULD).

### 10.2 Instance State Root 레이아웃

```text
<goondanHome>/instances/<workspaceId>/<instanceId>/
  metadata.json                       # 인스턴스 상태(running/paused/terminated), TTL 정보
  swarm/
    events/
      events.jsonl                    # MUST
  agents/
    <agentName>/
      messages/
        llm.jsonl                     # MUST
      events/
        events.jsonl                  # MUST
  metrics/
    turns.jsonl                       # SHOULD
```

규칙:

1. Instance State Root는 SwarmBundle 정의와 분리되어야 한다(MUST).
2. `metadata.json`에는 최소 상태(`running|paused|terminated`)와 갱신 시각을 포함해야 한다(MUST).
3. 인스턴스 pause/resume/delete 연산은 `metadata.json` 및 관련 로그에 반영되어야 한다(MUST).

### 10.2.1 LLM Message Log

Runtime은 AgentInstance별 LLM 메시지 로그를 append-only JSONL로 기록해야 한다(MUST).

필수 필드:

- `type`: `"llm.message"`
- `recordedAt`
- `traceId`
- `instanceId`, `instanceKey`, `agentName`, `turnId`
- `stepId` (선택)
- `stepIndex` (선택)
- `message`
- `usage` (선택: prompt/completion/total)

### 10.2.2 Event Log

Runtime은 Swarm/Agent 이벤트 로그를 append-only JSONL로 기록해야 한다(MUST).

- Swarm: `<goondanHome>/instances/<workspaceId>/<instanceId>/swarm/events/events.jsonl`
- Agent: `<goondanHome>/instances/<workspaceId>/<instanceId>/agents/<agentName>/events/events.jsonl`

필수 필드:

- `type`: `"swarm.event"` 또는 `"agent.event"`
- `recordedAt`
- `traceId`
- `kind`
- `instanceId`, `instanceKey`
- `agentName`(agent.event에서 필수)
- `data`(선택)

### 10.2.3 Metrics Log (권장)

Runtime은 Turn/Step 단위 메트릭 로그를 기록하는 것을 권장한다(SHOULD).

권장 필드:

- `traceId`
- `turnId`, `stepId`
- `latencyMs`
- `tokenUsage.prompt`, `tokenUsage.completion`, `tokenUsage.total`
- `toolCallCount`
- `errorCount`

### 10.3 System State Root 레이아웃

```text
<goondanHome>/
  bundles.json
  bundles/
  worktrees/
    <workspaceId>/
      changesets/
        <changesetId>/
  oauth/
    grants/
      <subjectHash>.<ext>
    sessions/
      <authSessionId>.<ext>
      index.json
  instances/
    <workspaceId>/<instanceId>/...
  metrics/
    runtime.jsonl
  secrets/
```

규칙:

1. OAuth grants/sessions는 인스턴스 삭제와 무관하게 유지되어야 한다(MUST).
2. OAuthStore의 비밀값은 at-rest encryption을 적용해야 한다(MUST).
3. Tool/Extension은 OAuthStore 파일을 직접 읽거나 수정해서는 안 된다(MUST).
4. TTL 만료 인스턴스 정리(GC)는 System State Root 정책으로 수행될 수 있다(SHOULD).

### 10.4 보안 및 데이터 보존

1. access token, refresh token, client secret, PKCE verifier/state는 평문 저장 금지다(MUST).
2. 로그/메트릭/컨텍스트 블록에 비밀값을 마스킹 없이 기록해서는 안 된다(MUST).
3. 감사 추적을 위해 인스턴스 라이프사이클 이벤트(pause/resume/terminate/delete)를 이벤트 로그에 남겨야 한다(SHOULD).
