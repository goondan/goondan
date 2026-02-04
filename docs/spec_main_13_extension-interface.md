## 13. Extension 실행 인터페이스

### 13.1 엔트리포인트

Extension 구현은 `register(api)` 함수를 제공해야 하며, Runtime은 AgentInstance 초기화 시점에 확장 목록 순서대로 이를 호출해야 한다(MUST).

### 13.2 등록 API(개념 규격)

Runtime은 확장에 다음 기능을 제공할 수 있어야 한다(MAY/SHOULD).

* 파이프라인 등록: `api.pipelines.mutate(point, fn)`, `api.pipelines.wrap(point, fn)`
* 도구 등록: `api.tools.register(toolDef)`
* 이벤트 발행: `api.events.emit(type, payload)`
* 워크스페이스 접근: repo 확보, worktree 마운트, 파일 IO 등
* (선택) SwarmBundle 접근: `api.swarmBundle.openChangeset()`, `api.swarmBundle.commitChangeset(...)` (구현 선택)

### 13.3 실행 컨텍스트(ctx)

* `ctx.extState()` 등 확장별 상태 저장소 제공 MAY
* `ctx.instance.shared` 등 인스턴스 공유 상태 제공 MAY

### 13.4 OAuthManager 인터페이스(Extension/Runtime 내부)

Runtime은 OAuthApp을 해석하고 OAuthGrant를 관리하는 OAuthManager를 제공할 수 있다. Extension이 이를 활용할 수 있도록, 다음과 같은 인터페이스를 제공할 수 있다(MAY).

* `api.oauth.getAccessToken(...)` (Tool의 `ctx.oauth`와 동일한 결과 형태 권장)
* `api.oauth.getAuthorizationUrl(...)` 또는 `api.oauth.ensureGrant(...)` (구현 선택)

OAuthManager의 저장소 구조/보존/마스킹 정책은 구현에 따라 달라질 수 있다. 단, Tool/Connector가 “토큰을 얻는 방법”은 `getAccessToken` 류 인터페이스로 표준화하는 것을 SHOULD 한다.
