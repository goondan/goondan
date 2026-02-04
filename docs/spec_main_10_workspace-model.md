## 10. 워크스페이스 모델

Runtime은 인스턴스와 에이전트 실행을 위한 파일시스템 워크스페이스를 관리한다. 워크스페이스에는 repo 캐시, 작업트리, 임시 디렉터리, 공유 산출물 영역 등이 포함될 수 있다.

권장 레이아웃 예시는 다음과 같다.

* `shared/repo-cache/`
* `agents/<agentId>/worktrees/`
* `agents/<agentId>/scratch/<turnId>/`
* `shared/artifacts/`
* `shared/state/instances/<instanceId>/`

### 10.1 SwarmBundle 상태 디렉터리 레이아웃 (MUST)

```
shared/state/instances/<instanceId>/
  swarm-bundle/                         # MUST
    base.ref                            # MUST: base SwarmRevision(또는 source ref)
    head.ref                            # MUST: head SwarmRevision
    cursor.yaml                         # MUST
    logs/
      changesets.jsonl                  # MUST
      changeset-status.jsonl            # MUST
    changesets/
      <changesetId>/
        workdir/                        # MUST: staging workdir
        diff.patch                      # MAY
    effective/
      effective-<rev>.yaml              # SHOULD
    store/                              # MUST: SwarmBundleStore(opaque)
  agents/
    <agentInstanceNameOrId>/
      messages/
        llm.jsonl                       # MUST: LLM message log (append-only)
  events/
    events.jsonl                        # SHOULD
```

정본 파일(changesets/status/cursor/head/base)은 읽기 전용으로 노출되는 것이 SHOULD이며, SwarmBundleManager 외의 주체가 기록하지 못해야 한다.

### 10.1.1 LLM Message Log (MUST)

Runtime은 AgentInstance별로 LLM 메시지 로그를 append-only JSONL로 기록해야 한다(MUST). 각 레코드는 최소한 다음 필드를 포함해야 한다(MUST).

- `type`: `"llm.message"`
- `recordedAt`: ISO8601 timestamp
- `instanceId`, `agentName`, `turnId`
- `stepId` (선택)
- `message`: `Turn.messages`의 단일 항목

예시:

```json
{
  "type": "llm.message",
  "recordedAt": "2026-02-01T12:34:56.789Z",
  "instanceId": "default-cli",
  "agentName": "planner",
  "turnId": "turn-abc",
  "stepId": "step-xyz",
  "message": { "role": "assistant", "content": "..." }
}
```

### 10.2 System State 디렉터리 레이아웃 (MUST)

Runtime은 인스턴스 상태(`shared/state/instances/<instanceId>/...`)와 별개로, 인스턴스 생명주기와 독립적으로 유지되는 시스템 전역 상태 루트(System State)를 제공해야 한다(MUST). 시스템 전역 상태는 Runtime 재시작 또는 개별 SwarmInstance/AgentInstance의 삭제와 무관하게 유지되어야 하며, 특히 OAuth 토큰/그랜트는 이 영역에 저장되어야 한다(MUST).

권장 레이아웃 예시는 다음과 같다.

```text
shared/state/system/
  oauth/
    grants/
      <oauthAppName>/
        <subjectHash>.sops.yaml
    sessions/
      <oauthAppName>/
        <authSessionId>.sops.yaml
    locks/
      <oauthAppName>/
        <subjectHash>.lock
```

규칙:

1. `shared/state/system/oauth/grants`는 OAuthGrantRecord(§12.5.4)의 저장소이며, 인스턴스가 사라져도 유지되어야 한다(MUST).
2. `shared/state/system/oauth/sessions`는 승인 진행 중(AuthSession) 상태(AuthSessionRecord, §12.5.5)의 저장소이며, 승인 완료 또는 만료 후에는 정리될 수 있다(SHOULD).
3. OAuthStore에 저장되는 문서는 디스크에 평문으로 남지 않도록 반드시 at-rest encryption을 적용해야 한다(MUST). 구현은 SOPS 호환 포맷 또는 동등한 envelope encryption 포맷을 사용하는 것을 권장한다(SHOULD).
4. DB 기반 저장소는 향후 확장으로 고려할 수 있으나, v0.7 범위에서는 정의하지 않으며(스펙 아웃), 표준 저장소는 파일시스템 기반 OAuthStore로 간주한다.
