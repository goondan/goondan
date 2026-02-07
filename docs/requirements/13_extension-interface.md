## 13. Extension 실행 인터페이스

### 13.1 엔트리포인트

Extension 구현은 `register(api)` 함수를 제공해야 하며, Runtime은 AgentInstance 초기화 시 확장 목록 순서대로 이를 호출해야 한다(MUST).

### 13.2 등록 API(개념 규격)

Runtime은 Extension에 최소 다음 API를 제공해야 한다(MUST).

- 파이프라인 등록: `api.pipelines.mutate(point, fn)`, `api.pipelines.wrap(point, fn)`
- 도구 등록: `api.tools.register(toolDef)`
- 이벤트 발행: `api.events.emit(type, payload)`
- OAuth 접근: `api.oauth.getAccessToken(...)`

선택 API:

- SwarmBundle API(`openChangeset`, `commitChangeset`)는 제공할 수 있다(MAY).

규칙:

1. 코어 API 부재로 Extension이 초기화 실패하는 상황이 없어야 한다(MUST).
2. Runtime은 제공 가능한 선택 API를 capability 형태로 노출하는 것을 권장한다(SHOULD).

### 13.3 실행 컨텍스트(ctx)

Runtime은 Extension 실행 시 최소 다음 컨텍스트를 제공해야 한다(MUST).

- `ctx.instance`: 현재 인스턴스 식별자/상태/공유 컨텍스트
- `ctx.extension`: 현재 extension 메타/상태 저장소
- `ctx.turn`(Turn 포인트에서)
- `ctx.step`(Step 포인트에서)

`ctx.extension` 규칙:

1. `ctx.extension.getState()`와 `ctx.extension.setState(next)`를 제공해야 한다(MUST).
2. 상태 저장은 extension identity에 귀속되어야 하며 reconcile 규칙을 따라야 한다(MUST).

### 13.4 OAuthManager 인터페이스

Runtime은 Extension 내부에서도 Tool과 동일한 의미론의 OAuthManager를 제공해야 한다(SHOULD).

- `api.oauth.getAccessToken(...)`

규칙:

1. OAuth subject 결정/스코프 검증/보안 정책은 Tool 경로와 동일해야 한다(MUST).
2. Extension이 토큰 저장소 파일을 직접 읽거나 수정해서는 안 된다(MUST).

### 13.5 에러/호환성 정책

1. Extension 초기화/실행 오류는 표준 오류 코드와 함께 보고되어야 한다(MUST).
2. 에러에는 가능한 경우 `suggestion`, `helpUrl`을 포함하는 것을 권장한다(SHOULD).
3. Runtime은 확장 호환성 검증(요구 capability, apiVersion)을 로드 단계에서 수행해야 한다(SHOULD).
