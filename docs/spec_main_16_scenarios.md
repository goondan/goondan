## 16. 예상 사용 시나리오

### 16.1 Slack thread 기반 장기 작업

사용자가 Slack thread에서 Swarm을 호출하면 Connector는 thread 식별자를 instanceKey로 사용하여 동일 스레드의 요청이 동일 SwarmInstance로 라우팅되도록 할 수 있다. AgentInstance는 같은 스레드에 진행 업데이트/완료 보고를 전송한다.

### 16.2 repo가 추가되면서 스킬이 자연스럽게 활성화되는 흐름

AgentInstance가 작업 중 특정 repo를 확보하면 workspace 이벤트가 발생하고 Skill 확장은 해당 repo의 스킬을 스캔해 카탈로그를 갱신한다. 다음 Step에서 갱신된 스킬 카탈로그가 컨텍스트 블록에 포함될 수 있다.

### 16.3 ToolSearch로 도구 노출을 최적화하는 흐름

ToolSearch는 현재 tool catalog에서 필요한 도구를 찾아보고, 검색 결과에 따라 다음 Step부터 도구를 단계적으로 확장한다.

### 16.4 프리셋/번들 선택과 부분 덮어쓰기

조직 내 공통 정책을 리소스로 정의해두면 Agent는 selector+overrides 문법으로 이를 선택하고 일부만 덮어써 구성할 수 있다.

### 16.5 Changeset으로 “도구/프롬프트/코드”가 다음 Step부터 바뀌는 흐름

1. Step N에서 LLM이 `swarmBundle.openChangeset` 호출 → staging workdir 수신
2. LLM이 bash로 workdir 안의 YAML/프롬프트/코드 파일을 수정
3. LLM이 `swarmBundle.commitChangeset` 호출
4. SwarmBundleManager가 정책 검사/검증 후 새 SwarmRevision 생성, head 이동, changesets/status 기록
5. Step N 종료
6. Step N+1의 `step.config`에서 head를 활성화(activeSwarmRevision으로 반영), status에 appliedAt/stepId 기록
7. Step N+1부터 새 SwarmRevision 기반으로 실행

### 16.6 Slack OAuth 설치/토큰 사용 흐름(개념)

1. Slack Connector는 ingress 이벤트로부터 `turn.auth.actor`와 `turn.auth.subjects`를 설정한다. 예를 들어 `turn.auth.subjects.global = slack:team:<team_id>`, `turn.auth.subjects.user = slack:user:<team_id>:<user_id>` 형태로 채우는 것을 권장한다.
2. LLM이 `slack.postMessage`를 호출하면 Tool 구현은 `ctx.oauth.getAccessToken({ oauthAppRef: slack-bot })`로 토큰을 요청한다. 이때 `slack-bot` OAuthApp의 `subjectMode=global`이므로 Runtime은 `turn.auth.subjects.global`을 subject로 사용한다.
3. 토큰이 준비되어 있으면 `status="ready"`가 반환되고 Tool은 Slack API 호출을 수행한다.
4. 토큰이 없다면 `status="authorization_required"`가 반환되며, Runtime은 AuthSession을 생성해 `authorizationUrl`과 안내 메시지를 제공한다. 에이전트는 이 정보를 이용해 사용자에게 승인 링크를 안내한다.
5. 사용자가 승인을 완료하면 Runtime은 callback에서 PKCE/state/subject를 검증한 뒤 OAuthGrant를 저장하고, `auth.granted` 이벤트를 해당 인스턴스/에이전트로 enqueue하여 비동기 재개를 수행한다.
