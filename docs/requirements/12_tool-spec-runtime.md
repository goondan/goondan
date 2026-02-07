## 12. Tool 스펙(런타임 관점)

### 12.1 도구 레지스트리와 도구 카탈로그

- Tool Registry: 런타임이 실행할 수 있는 전체 도구 집합
- Tool Catalog: 현재 Step에서 LLM에 노출되는 도구 목록

Runtime은 Step마다 `step.tools`에서 Tool Catalog를 구성해야 한다(MUST).

### 12.2 tool call의 허용 범위

규칙:

1. 기본 허용 범위는 Tool Catalog여야 한다(MUST).
2. Catalog에 없는 도구 호출은 명시적 정책이 없는 한 거부해야 한다(MUST).
3. Registry 직접 호출 허용 모드는 명시적 보안 정책으로만 활성화할 수 있다(MAY).
4. 거부 결과는 구조화된 ToolResult(`status="error"`, `code`)로 반환해야 한다(MUST).

### 12.3 동기/비동기 결과

- 동기 완료: `output` 포함
- 비동기 제출: `handle` 포함(완료 이벤트 또는 polling)

#### 12.3.1 Tool 오류 결과 및 메시지 제한

Runtime은 Tool 실행 오류를 예외 전파 대신 ToolResult로 LLM에 전달해야 한다(MUST).

```json
{
  "status": "error",
  "error": {
    "code": "E_TOOL",
    "name": "Error",
    "message": "요청 실패",
    "suggestion": "입력 파라미터를 확인하세요.",
    "helpUrl": "https://docs.goondan.io/errors/E_TOOL"
  }
}
```

규칙:

1. `error.message` 길이는 `Tool.spec.errorMessageLimit`를 적용해야 한다(MUST).
2. 미설정 시 기본값은 1000자여야 한다(MUST).
3. 사용자 복구를 돕는 `suggestion` 필드를 제공하는 것을 권장한다(SHOULD).
4. 문서 링크(`helpUrl`) 제공을 권장한다(SHOULD).

### 12.4 SwarmBundle 변경 도구 패턴

SwarmBundle 변경은 changeset 패턴으로 수행해야 한다(MUST).

1. `swarmBundle.openChangeset`으로 workdir 발급
2. workdir에서 파일 수정
3. `swarmBundle.commitChangeset` 호출
4. Safe Point에서 새 Ref 활성화

규칙:

1. commit 결과는 `ok/rejected/conflict/failed`를 반환해야 한다(MUST).
2. `conflict` 상태는 충돌 파일과 복구 힌트를 포함해야 한다(MUST).
3. 별도 changeset 상태 파일을 정본으로 요구하지 않는다(MUST NOT).

### 12.5 Handoff 도구 패턴

Agent 간 handoff는 tool call 패턴으로 제공한다.

규칙:

1. handoff 요청은 대상 agent와 입력을 포함해야 한다(MUST).
2. handoff는 비동기 제출 모델을 지원해야 한다(SHOULD).
3. 원래 Agent의 Turn/Auth/Trace 컨텍스트는 보존되어야 한다(MUST).
4. 기본 handoff 구현체는 `packages/base`에 제공하는 것을 권장한다(SHOULD).

### 12.6 OAuth 토큰 접근 인터페이스

Tool/Connector는 외부 API 호출을 위해 `ctx.oauth.getAccessToken` 인터페이스를 사용해야 한다(MUST).

```ts
ctx.oauth.getAccessToken({
  oauthAppRef: { kind: "OAuthApp", name: string },
  scopes?: string[],
  minTtlSeconds?: number
}) -> OAuthTokenResult
```

#### 12.6.1 getAccessToken 의미론

1. Runtime은 OAuthApp `subjectMode`에 따라 subject를 결정해야 한다(MUST).
2. `scopes`가 주어지면 `scopes ⊆ OAuthApp.spec.scopes`를 검증해야 한다(MUST).
3. Grant 조회 키는 `(oauthAppRef, subject)`여야 한다(MUST).
4. 유효 토큰이 있으면 `status="ready"`를 반환해야 한다(MUST).
5. 토큰이 없거나 무효면 `status="authorization_required"` 또는 구조화된 `error`를 반환해야 한다(MUST).
6. 만료 임박 시 refresh를 시도하는 것을 권장한다(SHOULD).

#### 12.6.2 OAuthTokenResult

- `ready`: API 호출 가능한 토큰 반환
- `authorization_required`: 승인 링크/세션 정보 반환
- `error`: subject 부재, 스코프 위반 등 비복구 또는 정책 오류 반환

#### 12.6.3 OAuthStore 보안 규칙

1. OAuthStore는 Runtime의 단일 작성자여야 한다(MUST).
2. accessToken/refreshToken/PKCE/state는 at-rest encryption 대상이다(MUST).
3. 민감값은 로그/이벤트/LLM 컨텍스트에 평문 노출 금지다(MUST).
4. refresh 경쟁 방지를 위한 single-flight 또는 락을 제공하는 것을 권장한다(SHOULD).

#### 12.6.4 Authorization Code + PKCE(S256)

1. `authorization_required` 반환 시 AuthSession을 생성/암호화 저장해야 한다(MUST).
2. authorization URL에 `code_challenge`, `code_challenge_method=S256`, `state`를 포함해야 한다(MUST).
3. callback에서 state/session/만료/일회성을 검증해야 한다(MUST).
4. token exchange 시 저장된 `code_verifier`를 사용해야 한다(MUST).
5. 성공 시 OAuthGrant 저장 후 `auth.granted` 이벤트 enqueue를 수행해야 한다(MUST).

#### 12.6.5 Device Code (선택)

1. Runtime은 device code를 지원할 수 있다(MAY).
2. 미지원 Runtime은 `flow=deviceCode` 구성을 로드 단계에서 거부해야 한다(MUST).

#### 12.6.6 승인 안내 블록

Runtime은 `step.blocks`에 승인 대기 정보를 주입할 수 있다(SHOULD).

규칙:

1. 블록에는 비밀값을 포함해서는 안 된다(MUST).
2. 사용자 안내에 필요한 최소 필드(authSessionId, authorizationUrl, expiresAt, message)를 포함하는 것을 권장한다(SHOULD).
