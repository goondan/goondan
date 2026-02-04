## 12. Tool 스펙(런타임 관점)

### 12.1 도구 레지스트리와 도구 카탈로그

* Tool Registry: 실행 가능한 전체 도구 엔드포인트(핸들러 포함) 집합
* Tool Catalog: 특정 Step에서 LLM에 노출되는 도구 목록
  Runtime은 Step마다 `step.tools`를 통해 Tool Catalog를 구성한다.

### 12.2 tool call의 허용 범위

Runtime은 tool call 처리 시 허용 정책을 가질 수 있다(MAY).

* Catalog 기반 허용 / Registry 기반 허용은 구현 선택

### 12.3 동기/비동기 결과

* 동기 완료: `output` 포함
* 비동기 제출: `handle` 포함(완료 이벤트 또는 polling)

#### 12.3.1 Tool 오류 결과 및 메시지 제한 (MUST)

Runtime은 Tool 실행 중 오류가 발생하면 예외를 외부로 전파하지 않고, ToolResult.output에 오류 정보를 포함하여 LLM에 전달해야 한다(MUST).

```json
{
  "status": "error",
  "error": { "message": "요청 실패", "name": "Error", "code": "E_TOOL" }
}
```

* `error.message`는 Tool.spec.errorMessageLimit 길이 제한을 적용한다(MUST).
* errorMessageLimit이 없으면 기본값은 1000자이다(MUST).

### 12.4 SwarmBundle 변경의 표준 패턴 (MUST)

SwarmBundle 변경은 Changeset을 통해 수행되어야 한다(MUST).
LLM은 `swarmBundle.openChangeset`으로 staging workdir을 열고, bash로 파일을 수정한 뒤, `swarmBundle.commitChangeset`으로 커밋한다.

Git 기반 구현에서 changeset 이력은 Git commit history로 추적 가능하며, 별도의 changeset status/log 파일은 요구하지 않는다(MUST NOT). 커밋 결과(성공/거부/실패)는 tool 결과로 관측 가능해야 한다(MUST). 활성화는 Safe Point에서만 수행한다(§6.4, §9.4, §11.2).

### 12.5 OAuth 토큰 접근 인터페이스

Tool/Connector 구현은 외부 API 호출을 위해 OAuth 토큰이 필요할 수 있다. Runtime은 Tool/Connector 실행 컨텍스트에 OAuthManager 인터페이스(`ctx.oauth`)를 제공해야 하며(SHOULD), OAuthManager는 시스템 전역 OAuthStore(§10.3)의 유일한 작성자로 동작해야 한다(MUST).

#### 12.5.1 ctx.oauth.getAccessToken (MUST)

Tool 또는 Connector는 다음 형태로 토큰을 요청할 수 있어야 한다.

```ts
ctx.oauth.getAccessToken({
  oauthAppRef: { kind: "OAuthApp"; name: string },
  scopes?: string[],          // 선택: OAuthApp.spec.scopes의 부분집합만 허용
  minTtlSeconds?: number      // 선택: 만료 임박 판단 기준
}) -> OAuthTokenResult
```

Runtime은 `getAccessToken` 호출에 대해 다음 의미론을 제공해야 한다(MUST).

1. Runtime은 `oauthAppRef`로 OAuthApp을 조회하고, OAuthApp의 `subjectMode`에 따라 Turn에서 subject를 결정한다(MUST).

   * `subjectMode=global`이면 `turn.auth.subjects.global`을 사용한다.
   * `subjectMode=user`이면 `turn.auth.subjects.user`를 사용한다.
2. Runtime은 요청 스코프를 “사전 고정” 규칙에 따라 결정해야 하며, 런타임 중 증분 확장을 수행해서는 안 된다(MUST).

   * `scopes`가 제공되면, Runtime은 `scopes ⊆ OAuthApp.spec.scopes`인지 검사해야 하며, 부분집합이 아니면 즉시 오류를 반환해야 한다(MUST).
   * `scopes`가 제공되지 않으면, Runtime은 `OAuthApp.spec.scopes`를 요청 스코프로 사용한다(SHOULD).
3. Runtime은 `(oauthAppRef, subject)` 키로 OAuthGrant를 조회한다(MUST).
4. Grant가 존재하고 토큰이 유효하면 `status="ready"`를 반환한다(MUST).
5. Grant가 없거나, 토큰이 무효/철회되었거나, 요청 스코프를 충족하지 못하면 Runtime은 AuthSession을 생성하고 `status="authorization_required"`를 반환해야 한다(MUST).
6. access token이 만료되었거나 만료 임박이면 Runtime은 refresh를 시도하는 것을 SHOULD 하며, 성공 시 갱신 저장 후 `ready`를 반환해야 한다(SHOULD).

#### 12.5.2 OAuthTokenResult (SHOULD)

`OAuthTokenResult`는 최소 다음 중 하나 형태를 가진다.

* `ready`는 실제 API 호출에 사용할 토큰을 제공한다.

```json
{
  "status": "ready",
  "accessToken": "*****",
  "tokenType": "bearer",
  "expiresAt": "2026-02-01T10:00:00Z",
  "scopes": ["chat:write"]
}
```

* `authorization_required`는 사용자 승인이 필요함을 나타내며, 에이전트가 사용자에게 안내할 수 있도록 메시지와 링크를 포함한다.

```json
{
  "status": "authorization_required",
  "authSessionId": "as-4f2c9a",
  "authorizationUrl": "https://provider.example/authorize?...",
  "expiresAt": "2026-01-31T09:20:01Z",
  "message": "외부 서비스 연결이 필요합니다. 아래 링크에서 승인을 완료하면 작업을 이어갈 수 있습니다."
}
```

* `error`는 비대화형 오류 또는 구성/컨텍스트 부족 등을 나타낸다.

```json
{
  "status": "error",
  "error": { "code": "subjectUnavailable", "message": "turn.auth.subjects.user 가 없어 사용자 토큰을 조회할 수 없습니다." }
}
```

#### 12.5.3 OAuthStore 파일시스템 저장소 및 암호화 규칙 (MUST)

Runtime은 OAuthGrant와 AuthSession을 시스템 전역 OAuthStore(§10.3)에 저장해야 한다(MUST). Runtime은 OAuthStore의 유일한 작성자이며, Tool/Extension/Sidecar는 OAuthStore 파일을 직접 읽거나 수정해서는 안 된다(MUST).

Runtime은 다음 보안 규칙을 만족해야 한다(MUST).

1. OAuthStore에 저장되는 모든 비밀값(accessToken, refreshToken, PKCE code_verifier, state 등)은 디스크에 평문으로 남지 않도록 반드시 at-rest encryption을 적용해야 한다(MUST).
2. Runtime은 토큰 및 민감 필드를 로그, 이벤트 payload, patch log, Effective Config, LLM 컨텍스트 블록에 평문으로 노출해서는 안 된다(MUST).
3. Runtime은 refresh 동시성 충돌을 방지하기 위해 `(oauthAppRef, subject)` 단위의 락 또는 단일 flight 메커니즘을 제공하는 것을 권장한다(SHOULD).

#### 12.5.4 OAuthGrantRecord 상태 레코드 스키마 (MUST)

OAuthGrantRecord는 “무엇을 저장하는지”를 정의하는 상태 레코드 스키마이며, 실제 저장 위치는 OAuthStore이다(MUST). OAuthGrantRecord의 예시는 다음과 같다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: OAuthGrantRecord
metadata:
  name: "sha256:<subjectHash>"
spec:
  provider: "slack"
  oauthAppRef: { kind: OAuthApp, name: "slack-bot" }
  subject: "slack:team:T111"
  flow: "authorization_code"          # MUST: authorization_code (device_code는 MAY)
  scopesGranted:
    - "chat:write"
    - "channels:read"
  token:
    tokenType: "bearer"
    accessToken: "<secret>"          # MUST: at-rest encryption 대상
    refreshToken: "<secret>"         # provider가 제공하는 경우에만
    expiresAt: "2026-02-01T10:00:00Z"
  createdAt: "2026-01-31T09:10:01Z"
  updatedAt: "2026-01-31T09:10:01Z"
  revoked: false
  providerData: {}                   # 선택: 공급자별 원문/파생 메타
```

#### 12.5.5 AuthSessionRecord 상태 레코드 스키마 (MUST)

AuthSessionRecord는 승인 진행 중 상태를 나타내며, Authorization Code + PKCE 플로우에서 callback 검증과 비동기 재개를 위해 사용된다(MUST). AuthSessionRecord는 승인 완료 또는 만료 후 정리될 수 있다(SHOULD).

```yaml
apiVersion: agents.example.io/v1alpha1
kind: AuthSessionRecord
metadata:
  name: "as-4f2c9a"
spec:
  provider: "slack"
  oauthAppRef: { kind: OAuthApp, name: "slack-bot" }

  subjectMode: "global"                     # OAuthApp.spec.subjectMode의 복사
  subject: "slack:team:T111"                # callback에서 반드시 검증할 기대값

  requestedScopes: ["chat:write","channels:read"]

  flow:
    type: "authorization_code"
    pkce:
      method: "S256"
      codeVerifier: "<secret>"              # MUST: at-rest encryption 대상
      codeChallenge: "<derived>"
    state: "<secret-or-signed>"             # MUST: at-rest encryption 대상

  status: "pending"                         # pending|completed|failed|expired
  createdAt: "2026-01-31T09:10:01Z"
  expiresAt: "2026-01-31T09:20:01Z"

  # 승인 완료 후 런타임이 어디로 재개 이벤트를 넣을지 정의한다.
  resume:
    swarmRef: { kind: Swarm, name: "default" }
    instanceKey: "1700000000.000100"        # 예: Slack thread_ts
    agentName: "planner"
    origin:
      connector: "slack-main"
      channel: "C123"
      threadTs: "1700000000.000100"
    auth:
      actor:
        type: "user"
        id: "slack:U234567"
      subjects:
        global: "slack:team:T111"
        user: "slack:user:T111:U234567"
```

#### 12.5.6 Authorization Code + PKCE(S256) 플로우 (MUST)

Runtime이 `authorization_required`를 반환할 때는 반드시 다음을 수행해야 한다(MUST).

1. Runtime은 `AuthSessionRecord`를 생성하고, PKCE `code_verifier`와 `state`를 포함한 세션 정보를 OAuthStore에 암호화 저장한다(MUST).
2. Runtime은 OAuth provider의 authorization URL을 생성할 때 PKCE 파라미터(`code_challenge`, `code_challenge_method=S256`)와 `state`를 포함해야 한다(MUST).
3. provider callback을 처리할 때 Runtime은 `state`로 AuthSession을 조회하고, 세션 만료/일회성/상태(`pending`)를 검증해야 하며, 검증에 실패하면 grant를 생성해서는 안 된다(MUST).
4. callback에서 Runtime은 코드 교환(token exchange)을 수행할 때 세션에 저장된 PKCE `code_verifier`를 사용해야 한다(MUST).
5. Runtime은 token exchange 결과가 세션의 기대 subject와 일치하는지 검증해야 한다(MUST). 특히 `subjectMode=user`인 경우, callback 결과의 리소스 소유자(예: provider의 user id)가 세션의 사용자 subject와 불일치하면 실패로 처리해야 하며, 다른 사용자에게 토큰이 귀속되는 것을 허용해서는 안 된다(MUST).
6. token exchange에 성공하면 Runtime은 `OAuthGrantRecord`를 생성/갱신하여 OAuthStore의 grants에 암호화 저장하고, AuthSession을 `completed`로 전이시킨 뒤 재사용 불가로 만들어야 한다(MUST).
7. Runtime은 승인 완료 후 `auth.granted` 이벤트를 `resume.agentName`의 이벤트 큐에 enqueue하여 비동기 재개를 트리거해야 한다(MUST). 이 이벤트는 `resume.origin`과 `resume.auth`를 Turn 컨텍스트로 사용해야 한다(SHOULD).

#### 12.5.7 Device Code 플로우 (MAY)

Runtime은 device code 플로우를 MAY 지원할 수 있다. Runtime이 이를 지원하지 않는다면, `flow=deviceCode`인 OAuthApp은 구성 로드/검증 단계에서 거부되어야 한다(MUST). device code 플로우를 지원하는 경우, Runtime은 사용자에게 제공할 `verificationUri`와 `userCode`를 `authorization_required`에 포함시키는 것을 SHOULD 하며, grant 저장과 비동기 재개는 authorization code 플로우와 동일한 원칙으로 동작해야 한다(SHOULD).

#### 12.5.8 승인 안내를 위한 컨텍스트 블록 주입 (SHOULD)

승인 흐름에서 “사용자에게 무엇을 어떻게 안내할지”는 에이전트가 결정할 수 있어야 하므로, Runtime은 `step.blocks`에서 승인 대기 정보를 컨텍스트 블록으로 주입하는 것을 권장한다(SHOULD). 이 블록에는 비밀값이 포함되어서는 안 되며(MUST), 에이전트가 사용자에게 안내할 최소 정보만 포함해야 한다.

권장 블록 예시는 다음과 같다.

```yaml
type: auth.pending
items:
  - authSessionId: "as-4f2c9a"
    oauthAppRef: { kind: OAuthApp, name: "slack-bot" }
    subjectMode: "global"
    authorizationUrl: "https://provider.example/authorize?..."
    expiresAt: "2026-01-31T09:20:01Z"
    message: "외부 서비스 연결이 필요합니다. 아래 링크에서 승인을 완료하면 작업을 이어갈 수 있습니다."
```
