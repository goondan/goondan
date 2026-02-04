# Goondan OAuth 시스템 스펙 (v0.8)

본 문서는 `docs/requirements/index.md`(특히 07_config-resources.md, 10_workspace-model.md, 12_tool-spec-runtime.md)를 기반으로 OAuth 시스템의 **구현 스펙**을 정의한다.

---

## 1. 개요

Goondan OAuth 시스템은 Tool/Connector가 외부 API를 호출할 때 필요한 OAuth 토큰을 관리한다. 주요 구성 요소는 다음과 같다.

- **OAuthApp**: OAuth 클라이언트 및 엔드포인트를 정의하는 Config 리소스
- **OAuthManager**: 토큰 조회/갱신/승인 플로우를 관리하는 런타임 컴포넌트
- **OAuthStore**: 토큰/세션을 암호화하여 저장하는 파일시스템 저장소
- **ctx.oauth**: Tool/Connector 실행 컨텍스트에 제공되는 토큰 접근 인터페이스

---

## 2. OAuthApp 리소스 스키마

### 2.1 YAML 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: OAuthApp
metadata:
  name: slack-bot
  labels: {}                          # 선택
spec:
  provider: slack                     # 필수: OAuth 공급자 식별자

  # 필수: 인증 플로우 타입
  flow: authorizationCode             # authorizationCode | deviceCode

  # 필수: 토큰 소유자 결정 방식
  subjectMode: global                 # global | user

  # 필수: OAuth 클라이언트 자격 증명
  client:
    clientId: <ValueSource>           # 필수
    clientSecret: <ValueSource>       # 필수

  # 필수: OAuth 엔드포인트
  endpoints:
    authorizationUrl: string          # 필수: 승인 URL
    tokenUrl: string                  # 필수: 토큰 교환 URL
    revokeUrl?: string                # 선택: 토큰 철회 URL
    userInfoUrl?: string              # 선택: 사용자 정보 URL

  # 필수: 요청할 권한 범위
  scopes:
    - "chat:write"
    - "channels:read"

  # 필수: 콜백 리다이렉트 설정
  redirect:
    callbackPath: string              # 필수: 콜백 경로 (예: /oauth/callback/slack-bot)
    baseUrl?: string                  # 선택: 기본 URL (환경에서 결정 가능)

  # 선택: 공급자별 추가 옵션
  options?: JsonObject
```

### 2.2 TypeScript 인터페이스

```ts
interface OAuthAppSpec {
  provider: string;
  flow: 'authorizationCode' | 'deviceCode';
  subjectMode: 'global' | 'user';
  client: {
    clientId: ValueSource;
    clientSecret: ValueSource;
  };
  endpoints: {
    authorizationUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
    userInfoUrl?: string;
  };
  scopes: string[];
  redirect: {
    callbackPath: string;
    baseUrl?: string;
  };
  options?: JsonObject;
}

type ValueSource =
  | { value: string }
  | { valueFrom: { env: string } }
  | { valueFrom: { secretRef: { ref: string; key: string } } };
```

### 2.3 필드 설명

| 필드 | 필수 | 설명 |
|------|------|------|
| `provider` | MUST | OAuth 공급자 식별자 (slack, github, google 등) |
| `flow` | MUST | 인증 플로우: `authorizationCode` (MUST 지원), `deviceCode` (MAY 지원) |
| `subjectMode` | MUST | 토큰 소유자 결정: `global` (워크스페이스/팀 단위), `user` (개별 사용자 단위) |
| `client.clientId` | MUST | OAuth 클라이언트 ID (ValueSource로 주입) |
| `client.clientSecret` | MUST | OAuth 클라이언트 시크릿 (ValueSource로 주입) |
| `endpoints.authorizationUrl` | MUST | Authorization Code 플로우의 승인 URL |
| `endpoints.tokenUrl` | MUST | 토큰 교환 엔드포인트 |
| `scopes` | MUST | 요청할 OAuth 스코프 배열 |
| `redirect.callbackPath` | MUST | OAuth 콜백 경로 |
| `options` | MAY | 공급자별 추가 옵션 |

### 2.4 Validation 규칙

1. `flow=authorizationCode`인 경우 `authorizationUrl`, `tokenUrl`, `callbackPath`는 필수(MUST)
2. `flow=deviceCode`인 경우 런타임이 미지원하면 구성 로드 단계에서 거부(MUST)
3. `scopes`는 최소 1개 이상 포함해야 한다(SHOULD)
4. `client.clientId`와 `client.clientSecret`은 `valueFrom`을 사용하여 비밀값을 분리하는 것을 권장(SHOULD)

---

## 3. ctx.oauth 인터페이스

### 3.1 getAccessToken

Tool/Connector는 `ctx.oauth.getAccessToken`을 호출하여 토큰을 요청한다.

```ts
interface OAuthApi {
  getAccessToken(request: GetAccessTokenRequest): Promise<OAuthTokenResult>;
}

interface GetAccessTokenRequest {
  /** OAuthApp 리소스 참조 */
  oauthAppRef: ObjectRefLike;

  /** 선택: 요청 스코프 (OAuthApp.spec.scopes의 부분집합만 허용) */
  scopes?: string[];

  /** 선택: 만료 임박 판단 기준 (초 단위, 기본 300) */
  minTtlSeconds?: number;
}

type ObjectRefLike = string | { kind: string; name: string };
```

### 3.2 OAuthTokenResult

```ts
type OAuthTokenResult =
  | OAuthTokenReady
  | OAuthTokenAuthorizationRequired
  | OAuthTokenError;

/** 토큰이 준비된 경우 */
interface OAuthTokenReady {
  status: 'ready';
  accessToken: string;
  tokenType: string;              // 예: "bearer"
  expiresAt?: string;             // ISO8601 (없으면 무기한)
  scopes: string[];               // 실제 부여된 스코프
}

/** 사용자 승인이 필요한 경우 */
interface OAuthTokenAuthorizationRequired {
  status: 'authorization_required';
  authSessionId: string;
  authorizationUrl: string;
  expiresAt: string;              // 세션 만료 시각 (ISO8601)
  message: string;                // 사용자 안내 메시지

  /** Device Code 플로우 전용 (선택) */
  deviceCode?: {
    verificationUri: string;
    userCode: string;
    interval: number;             // 폴링 간격 (초)
  };
}

/** 오류 발생 */
interface OAuthTokenError {
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}
```

### 3.3 오류 코드

| 코드 | 설명 |
|------|------|
| `oauthAppNotFound` | OAuthApp 리소스를 찾을 수 없음 |
| `subjectUnavailable` | turn.auth.subjects에서 필요한 subject를 찾을 수 없음 |
| `scopeNotAllowed` | 요청 스코프가 OAuthApp.spec.scopes의 부분집합이 아님 |
| `tokenRevoked` | 토큰이 철회됨 |
| `refreshFailed` | 토큰 갱신 실패 |
| `deviceCodeUnsupported` | Device Code 플로우 미지원 |
| `configurationError` | OAuthApp 구성 오류 |

---

## 4. Subject 결정 로직

### 4.1 알고리즘

```ts
function resolveSubject(
  oauthApp: OAuthAppSpec,
  turnAuth: TurnAuth
): string | null {
  const { subjectMode } = oauthApp;
  const { subjects } = turnAuth;

  if (subjectMode === 'global') {
    return subjects?.global ?? null;
  }

  if (subjectMode === 'user') {
    return subjects?.user ?? null;
  }

  return null;
}
```

### 4.2 Turn Auth 구조

```ts
interface TurnAuth {
  actor?: {
    type: 'user' | 'service' | 'system';
    id: string;
    display?: string;
  };
  subjects?: {
    global?: string;    // 예: "slack:team:T111"
    user?: string;      // 예: "slack:user:T111:U234567"
  };
}
```

### 4.3 Subject 형식 권장

| Connector | subjectMode=global | subjectMode=user |
|-----------|-------------------|------------------|
| Slack | `slack:team:<team_id>` | `slack:user:<team_id>:<user_id>` |
| GitHub | `github:org:<org_name>` | `github:user:<user_id>` |
| Google | `google:domain:<domain>` | `google:user:<user_id>` |

### 4.4 규칙

1. Subject가 없으면 `status="error"`, `code="subjectUnavailable"` 반환(MUST)
2. `subjectMode=user`인 경우 `turn.auth`가 없는 Turn에서 토큰 조회 불가(MUST)
3. 에이전트 간 handoff 시 `turn.auth`는 보존되어야 한다(MUST)

---

## 5. OAuthStore 구조

### 5.1 디렉터리 레이아웃

```
<goondanHome>/oauth/
├── grants/
│   ├── <grantId>.enc.json           # OAuthGrantRecord (암호화)
│   └── index.json                   # 선택: 조회 인덱스
├── sessions/
│   ├── <authSessionId>.enc.json     # AuthSessionRecord (암호화)
│   └── index.json                   # 선택: 조회 인덱스
└── keys/
    └── master.key                   # 선택: 암호화 마스터 키
```

### 5.2 Grant ID 생성

```ts
function generateGrantId(oauthAppRef: ObjectRefLike, subject: string): string {
  const key = `${oauthAppRef.kind}/${oauthAppRef.name}:${subject}`;
  return `grant-${sha256(key).substring(0, 16)}`;
}
```

### 5.3 At-Rest Encryption 요구사항

1. 저장되는 모든 비밀값은 디스크에 평문으로 남지 않아야 한다(MUST)
2. 암호화 대상 필드:
   - `accessToken`
   - `refreshToken`
   - `codeVerifier` (PKCE)
   - `state`
3. 권장 암호화 방식:
   - AES-256-GCM (envelope encryption)
   - SOPS 호환 포맷 (선택)
4. 마스터 키 관리:
   - 환경 변수 `GOONDAN_OAUTH_KEY`로 주입 권장(SHOULD)
   - 파일 기반 키 저장 시 적절한 파일 권한 설정(SHOULD)

### 5.4 암호화 인터페이스

```ts
interface EncryptionService {
  encrypt(plaintext: string): Promise<EncryptedValue>;
  decrypt(encrypted: EncryptedValue): Promise<string>;
}

interface EncryptedValue {
  algorithm: 'aes-256-gcm';
  iv: string;           // Base64
  ciphertext: string;   // Base64
  tag: string;          // Base64
  keyId?: string;       // 키 로테이션용
}
```

---

## 6. OAuthGrantRecord 스키마

### 6.1 YAML 형식

```yaml
apiVersion: agents.example.io/v1alpha1
kind: OAuthGrantRecord
metadata:
  name: "grant-a1b2c3d4e5f6"
spec:
  provider: "slack"
  oauthAppRef: { kind: OAuthApp, name: "slack-bot" }
  subject: "slack:team:T111"
  flow: "authorization_code"

  scopesGranted:
    - "chat:write"
    - "channels:read"

  token:
    tokenType: "bearer"
    accessToken: <EncryptedValue>
    refreshToken: <EncryptedValue>     # 공급자가 제공하는 경우
    expiresAt: "2026-02-01T10:00:00Z"  # 없으면 무기한
    issuedAt: "2026-01-31T09:10:01Z"

  createdAt: "2026-01-31T09:10:01Z"
  updatedAt: "2026-01-31T09:10:01Z"
  revokedAt: null                      # 철회 시 설정
  revoked: false

  providerData: {}                     # 선택: 공급자별 원문/파생 메타
```

### 6.2 TypeScript 인터페이스

```ts
interface OAuthGrantRecord {
  apiVersion: string;
  kind: 'OAuthGrantRecord';
  metadata: {
    name: string;
  };
  spec: {
    provider: string;
    oauthAppRef: ObjectRef;
    subject: string;
    flow: 'authorization_code' | 'device_code';
    scopesGranted: string[];
    token: {
      tokenType: string;
      accessToken: EncryptedValue;
      refreshToken?: EncryptedValue;
      expiresAt?: string;
      issuedAt: string;
    };
    createdAt: string;
    updatedAt: string;
    revokedAt?: string;
    revoked: boolean;
    providerData?: JsonObject;
  };
}
```

### 6.3 토큰 유효성 판단

```ts
function isTokenValid(
  grant: OAuthGrantRecord,
  minTtlSeconds: number = 300
): boolean {
  if (grant.spec.revoked) {
    return false;
  }

  const expiresAt = grant.spec.token.expiresAt;
  if (!expiresAt) {
    return true;  // 만료 시각 없음 = 무기한
  }

  const expiresAtMs = new Date(expiresAt).getTime();
  const nowMs = Date.now();
  const minTtlMs = minTtlSeconds * 1000;

  return expiresAtMs - nowMs > minTtlMs;
}
```

---

## 7. AuthSessionRecord 스키마

### 7.1 YAML 형식

```yaml
apiVersion: agents.example.io/v1alpha1
kind: AuthSessionRecord
metadata:
  name: "as-4f2c9a"
spec:
  provider: "slack"
  oauthAppRef: { kind: OAuthApp, name: "slack-bot" }

  subjectMode: "global"
  subject: "slack:team:T111"

  requestedScopes:
    - "chat:write"
    - "channels:read"

  flow:
    type: "authorization_code"
    pkce:
      method: "S256"
      codeVerifier: <EncryptedValue>
      codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    state: <EncryptedValue>

  status: "pending"                    # pending | completed | failed | expired
  statusReason: null                   # 실패 시 사유

  createdAt: "2026-01-31T09:10:01Z"
  expiresAt: "2026-01-31T09:20:01Z"   # 세션 유효 기간 (기본 10분)

  resume:
    swarmRef: { kind: Swarm, name: "default" }
    instanceKey: "1700000000.000100"
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

### 7.2 TypeScript 인터페이스

```ts
interface AuthSessionRecord {
  apiVersion: string;
  kind: 'AuthSessionRecord';
  metadata: {
    name: string;
  };
  spec: {
    provider: string;
    oauthAppRef: ObjectRef;
    subjectMode: 'global' | 'user';
    subject: string;
    requestedScopes: string[];
    flow: AuthSessionFlow;
    status: 'pending' | 'completed' | 'failed' | 'expired';
    statusReason?: string;
    createdAt: string;
    expiresAt: string;
    resume: ResumeInfo;
  };
}

interface AuthSessionFlow {
  type: 'authorization_code' | 'device_code';
  pkce?: {
    method: 'S256';
    codeVerifier: EncryptedValue;
    codeChallenge: string;
  };
  state: EncryptedValue;
  /** Device Code 전용 */
  deviceCode?: {
    deviceCode: EncryptedValue;
    verificationUri: string;
    userCode: string;
    interval: number;
    expiresAt: string;
  };
}

interface ResumeInfo {
  swarmRef: ObjectRef;
  instanceKey: string;
  agentName: string;
  origin: JsonObject;
  auth: TurnAuth;
}
```

---

## 8. Authorization Code + PKCE(S256) 플로우

### 8.1 플로우 다이어그램

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Authorization Code + PKCE Flow                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Tool/Connector calls ctx.oauth.getAccessToken()                         │
│           │                                                                  │
│           ▼                                                                  │
│  2. OAuthManager: Grant exists? ──yes──► Return status="ready"              │
│           │no                                                                │
│           ▼                                                                  │
│  3. Create AuthSession with PKCE code_verifier/challenge, state             │
│           │                                                                  │
│           ▼                                                                  │
│  4. Return status="authorization_required" with authorizationUrl            │
│           │                                                                  │
│           ▼                                                                  │
│  5. User clicks authorizationUrl → OAuth Provider                           │
│           │                                                                  │
│           ▼                                                                  │
│  6. User authorizes → Provider redirects to callbackPath with code, state   │
│           │                                                                  │
│           ▼                                                                  │
│  7. OAuthManager.handleCallback():                                          │
│      a. Validate state → Lookup AuthSession                                 │
│      b. Verify session: status=pending, not expired                         │
│      c. Exchange code with code_verifier → Get tokens                       │
│      d. Verify subject matches (especially for subjectMode=user)            │
│      e. Create/Update OAuthGrant                                            │
│      f. Mark AuthSession completed                                          │
│      g. Emit auth.granted event to AgentInstance queue                      │
│           │                                                                  │
│           ▼                                                                  │
│  8. AgentInstance receives auth.granted event → Resume Turn                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 PKCE 생성

```ts
import { randomBytes, createHash } from 'crypto';

interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

function generatePKCE(): PKCEChallenge {
  // 43-128자의 URL-safe random string
  const codeVerifier = randomBytes(32)
    .toString('base64url')
    .substring(0, 43);

  // SHA256(code_verifier) → Base64URL
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}
```

### 8.3 State 생성

```ts
import { randomBytes } from 'crypto';

interface StatePayload {
  sessionId: string;
  nonce: string;
  timestamp: number;
}

function generateState(sessionId: string): string {
  const payload: StatePayload = {
    sessionId,
    nonce: randomBytes(16).toString('hex'),
    timestamp: Date.now(),
  };

  // HMAC으로 서명하여 변조 방지 (선택)
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function parseState(state: string): StatePayload | null {
  try {
    const json = Buffer.from(state, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}
```

### 8.4 Authorization URL 생성

```ts
function buildAuthorizationUrl(
  oauthApp: OAuthAppSpec,
  session: AuthSessionRecord,
  pkce: PKCEChallenge
): string {
  const url = new URL(oauthApp.endpoints.authorizationUrl);

  const clientId = resolveValueSource(oauthApp.client.clientId);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', buildCallbackUrl(oauthApp));
  url.searchParams.set('scope', session.spec.requestedScopes.join(' '));
  url.searchParams.set('state', session.spec.flow.state);
  url.searchParams.set('code_challenge', pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);

  // 공급자별 추가 파라미터
  if (oauthApp.options) {
    for (const [key, value] of Object.entries(oauthApp.options)) {
      if (typeof value === 'string') {
        url.searchParams.set(key, value);
      }
    }
  }

  return url.toString();
}
```

### 8.5 Callback 처리

```ts
interface CallbackParams {
  code: string;
  state: string;
  error?: string;
  error_description?: string;
}

async function handleCallback(params: CallbackParams): Promise<void> {
  // 1. State로 세션 조회
  const statePayload = parseState(params.state);
  if (!statePayload) {
    throw new OAuthError('invalid_state', 'Invalid state parameter');
  }

  const session = await oauthStore.getSession(statePayload.sessionId);
  if (!session) {
    throw new OAuthError('session_not_found', 'Auth session not found');
  }

  // 2. 세션 상태 검증
  if (session.spec.status !== 'pending') {
    throw new OAuthError('session_already_used', 'Auth session already used');
  }

  if (new Date(session.spec.expiresAt) < new Date()) {
    await oauthStore.updateSessionStatus(session, 'expired');
    throw new OAuthError('session_expired', 'Auth session expired');
  }

  // 3. OAuth 오류 확인
  if (params.error) {
    await oauthStore.updateSessionStatus(session, 'failed', params.error_description);
    throw new OAuthError(params.error, params.error_description || 'Authorization failed');
  }

  // 4. 토큰 교환
  const oauthApp = await configLoader.getOAuthApp(session.spec.oauthAppRef);
  const tokens = await exchangeCode(oauthApp, session, params.code);

  // 5. Subject 검증 (특히 subjectMode=user인 경우)
  await verifySubject(oauthApp, session, tokens);

  // 6. Grant 저장
  const grant = await oauthStore.saveGrant({
    provider: oauthApp.spec.provider,
    oauthAppRef: session.spec.oauthAppRef,
    subject: session.spec.subject,
    flow: 'authorization_code',
    scopesGranted: tokens.scope?.split(' ') || session.spec.requestedScopes,
    token: {
      tokenType: tokens.token_type,
      accessToken: await encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? await encrypt(tokens.refresh_token) : undefined,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : undefined,
      issuedAt: new Date().toISOString(),
    },
  });

  // 7. 세션 완료 처리
  await oauthStore.updateSessionStatus(session, 'completed');

  // 8. auth.granted 이벤트 발행
  await emitAuthGrantedEvent(session.spec.resume, grant);
}
```

### 8.6 토큰 교환

```ts
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

async function exchangeCode(
  oauthApp: OAuthAppSpec,
  session: AuthSessionRecord,
  code: string
): Promise<TokenResponse> {
  const clientId = resolveValueSource(oauthApp.client.clientId);
  const clientSecret = resolveValueSource(oauthApp.client.clientSecret);
  const codeVerifier = await decrypt(session.spec.flow.pkce!.codeVerifier);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: buildCallbackUrl(oauthApp),
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });

  const response = await fetch(oauthApp.endpoints.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new OAuthError(
      error.error || 'token_exchange_failed',
      error.error_description || 'Token exchange failed'
    );
  }

  return response.json();
}
```

### 8.7 Subject 검증

```ts
async function verifySubject(
  oauthApp: OAuthAppSpec,
  session: AuthSessionRecord,
  tokens: TokenResponse
): Promise<void> {
  // subjectMode=global인 경우 provider 수준의 검증만 수행
  if (oauthApp.spec.subjectMode === 'global') {
    return;  // 또는 provider별 팀/조직 검증
  }

  // subjectMode=user인 경우 userInfo 엔드포인트로 사용자 확인
  if (!oauthApp.endpoints.userInfoUrl) {
    // userInfo 엔드포인트 없으면 검증 스킵 (주의: 보안 위험)
    return;
  }

  const userInfo = await fetchUserInfo(oauthApp, tokens.access_token);
  const actualSubject = buildUserSubject(oauthApp.spec.provider, userInfo);

  if (actualSubject !== session.spec.subject) {
    throw new OAuthError(
      'subject_mismatch',
      `Expected subject ${session.spec.subject} but got ${actualSubject}`
    );
  }
}
```

---

## 9. Token Refresh 로직

### 9.1 Refresh 조건

토큰 갱신은 다음 조건에서 수행한다(SHOULD).

1. access_token이 만료됨 (`expiresAt < now`)
2. access_token이 만료 임박 (`expiresAt - now < minTtlSeconds`)
3. refresh_token이 존재함

### 9.2 Single-Flight 패턴

동시 refresh 요청으로 인한 충돌을 방지하기 위해 single-flight 패턴을 권장한다(SHOULD).

```ts
class RefreshManager {
  private inflight: Map<string, Promise<OAuthGrantRecord>> = new Map();

  async refresh(grantId: string): Promise<OAuthGrantRecord> {
    // 이미 진행 중인 refresh가 있으면 그 결과를 기다림
    const existing = this.inflight.get(grantId);
    if (existing) {
      return existing;
    }

    // 새 refresh 시작
    const promise = this.doRefresh(grantId);
    this.inflight.set(grantId, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(grantId);
    }
  }

  private async doRefresh(grantId: string): Promise<OAuthGrantRecord> {
    const grant = await oauthStore.getGrant(grantId);
    if (!grant) {
      throw new OAuthError('grant_not_found', 'Grant not found');
    }

    if (!grant.spec.token.refreshToken) {
      throw new OAuthError('refresh_unavailable', 'No refresh token available');
    }

    const oauthApp = await configLoader.getOAuthApp(grant.spec.oauthAppRef);
    const tokens = await refreshTokens(oauthApp, grant);

    return oauthStore.updateGrant(grantId, {
      token: {
        ...grant.spec.token,
        accessToken: await encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token
          ? await encrypt(tokens.refresh_token)
          : grant.spec.token.refreshToken,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : undefined,
      },
      updatedAt: new Date().toISOString(),
    });
  }
}
```

### 9.3 Refresh 토큰 교환

```ts
async function refreshTokens(
  oauthApp: OAuthAppSpec,
  grant: OAuthGrantRecord
): Promise<TokenResponse> {
  const clientId = resolveValueSource(oauthApp.client.clientId);
  const clientSecret = resolveValueSource(oauthApp.client.clientSecret);
  const refreshToken = await decrypt(grant.spec.token.refreshToken!);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(oauthApp.endpoints.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json();

    // refresh_token이 무효화된 경우 grant를 철회 처리
    if (error.error === 'invalid_grant') {
      await oauthStore.revokeGrant(grant.metadata.name);
    }

    throw new OAuthError(
      error.error || 'refresh_failed',
      error.error_description || 'Token refresh failed'
    );
  }

  return response.json();
}
```

---

## 10. 승인 안내 컨텍스트 블록

### 10.1 auth.pending 블록

Runtime은 `step.blocks`에서 승인 대기 정보를 컨텍스트 블록으로 주입하는 것을 권장한다(SHOULD).

```yaml
type: auth.pending
items:
  - authSessionId: "as-4f2c9a"
    oauthAppRef: { kind: OAuthApp, name: "slack-bot" }
    provider: "slack"
    subjectMode: "global"
    authorizationUrl: "https://slack.com/oauth/v2/authorize?..."
    expiresAt: "2026-01-31T09:20:01Z"
    message: "외부 서비스 연결이 필요합니다. 아래 링크에서 승인을 완료하면 작업을 이어갈 수 있습니다."
```

### 10.2 TypeScript 인터페이스

```ts
interface AuthPendingBlock {
  type: 'auth.pending';
  items: AuthPendingItem[];
}

interface AuthPendingItem {
  authSessionId: string;
  oauthAppRef: ObjectRef;
  provider: string;
  subjectMode: 'global' | 'user';
  authorizationUrl: string;
  expiresAt: string;
  message: string;

  /** Device Code 플로우 전용 */
  deviceCode?: {
    verificationUri: string;
    userCode: string;
  };
}
```

### 10.3 보안 규칙

1. 블록에 `accessToken`, `refreshToken`, `codeVerifier`, `state` 등 비밀값을 포함해서는 안 된다(MUST)
2. 에이전트가 사용자에게 안내할 최소 정보만 포함해야 한다(SHOULD)
3. `authorizationUrl`은 이미 공개된 정보이므로 포함 가능(MAY)

---

## 11. Device Code 플로우 (선택 구현)

### 11.1 지원 여부

- Runtime은 Device Code 플로우를 MAY 지원할 수 있다
- 미지원 시 `flow=deviceCode` OAuthApp은 구성 로드 단계에서 거부해야 한다(MUST)

### 11.2 플로우 개요

```
1. Tool calls ctx.oauth.getAccessToken()
2. OAuthManager: No grant → Start device code flow
3. Request device code from provider
4. Return status="authorization_required" with verificationUri, userCode
5. User visits verificationUri and enters userCode
6. OAuthManager polls token endpoint at interval
7. On success: Create grant, emit auth.granted event
```

### 11.3 Device Code 응답

```ts
interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface OAuthTokenAuthorizationRequired {
  status: 'authorization_required';
  authSessionId: string;
  authorizationUrl: string;  // verification_uri
  expiresAt: string;
  message: string;
  deviceCode: {
    verificationUri: string;
    userCode: string;
    interval: number;
  };
}
```

### 11.4 폴링 로직 (구현 선택)

```ts
async function pollDeviceCodeGrant(
  oauthApp: OAuthAppSpec,
  session: AuthSessionRecord
): Promise<void> {
  const deviceCode = session.spec.flow.deviceCode!;
  const interval = deviceCode.interval * 1000;
  const expiresAt = new Date(deviceCode.expiresAt).getTime();

  while (Date.now() < expiresAt) {
    await sleep(interval);

    try {
      const tokens = await requestDeviceToken(oauthApp, deviceCode.deviceCode);

      // 성공: Grant 저장 및 이벤트 발행
      const grant = await oauthStore.saveGrant({ ... });
      await oauthStore.updateSessionStatus(session, 'completed');
      await emitAuthGrantedEvent(session.spec.resume, grant);
      return;

    } catch (error) {
      if (error.code === 'authorization_pending') {
        continue;  // 아직 대기 중
      }
      if (error.code === 'slow_down') {
        await sleep(5000);  // 간격 증가
        continue;
      }
      // 그 외 오류는 실패 처리
      await oauthStore.updateSessionStatus(session, 'failed', error.message);
      return;
    }
  }

  // 만료
  await oauthStore.updateSessionStatus(session, 'expired');
}
```

---

## 12. OAuthManager 구현

### 12.1 인터페이스

```ts
interface OAuthManager {
  /** 토큰 조회 (Tool/Connector용) */
  getAccessToken(
    request: GetAccessTokenRequest,
    turnAuth: TurnAuth
  ): Promise<OAuthTokenResult>;

  /** OAuth callback 처리 (HTTP handler) */
  handleCallback(params: CallbackParams): Promise<void>;

  /** Grant 철회 */
  revokeGrant(oauthAppRef: ObjectRefLike, subject: string): Promise<void>;

  /** 세션 정리 (만료된 세션 삭제) */
  cleanupExpiredSessions(): Promise<void>;
}
```

### 12.2 getAccessToken 구현

```ts
async function getAccessToken(
  request: GetAccessTokenRequest,
  turnAuth: TurnAuth
): Promise<OAuthTokenResult> {
  // 1. OAuthApp 조회
  const oauthApp = await configLoader.getOAuthApp(request.oauthAppRef);
  if (!oauthApp) {
    return {
      status: 'error',
      error: { code: 'oauthAppNotFound', message: 'OAuthApp not found' },
    };
  }

  // 2. Subject 결정
  const subject = resolveSubject(oauthApp.spec, turnAuth);
  if (!subject) {
    return {
      status: 'error',
      error: {
        code: 'subjectUnavailable',
        message: `turn.auth.subjects.${oauthApp.spec.subjectMode} is required`,
      },
    };
  }

  // 3. 스코프 검증
  const requestedScopes = request.scopes || oauthApp.spec.scopes;
  if (!isSubset(requestedScopes, oauthApp.spec.scopes)) {
    return {
      status: 'error',
      error: {
        code: 'scopeNotAllowed',
        message: 'Requested scopes exceed OAuthApp scopes',
      },
    };
  }

  // 4. Grant 조회
  const grantId = generateGrantId(request.oauthAppRef, subject);
  const grant = await oauthStore.getGrant(grantId);

  if (grant && !grant.spec.revoked) {
    // 5. 토큰 유효성 확인
    const minTtl = request.minTtlSeconds ?? 300;

    if (isTokenValid(grant, minTtl)) {
      const accessToken = await decrypt(grant.spec.token.accessToken);
      return {
        status: 'ready',
        accessToken,
        tokenType: grant.spec.token.tokenType,
        expiresAt: grant.spec.token.expiresAt,
        scopes: grant.spec.scopesGranted,
      };
    }

    // 6. Refresh 시도
    if (grant.spec.token.refreshToken) {
      try {
        const refreshed = await refreshManager.refresh(grantId);
        const accessToken = await decrypt(refreshed.spec.token.accessToken);
        return {
          status: 'ready',
          accessToken,
          tokenType: refreshed.spec.token.tokenType,
          expiresAt: refreshed.spec.token.expiresAt,
          scopes: refreshed.spec.scopesGranted,
        };
      } catch (error) {
        // Refresh 실패 → 새 승인 필요
      }
    }
  }

  // 7. AuthSession 생성
  const session = await createAuthSession(oauthApp, subject, requestedScopes, turnAuth);

  // 8. authorization_required 반환
  return {
    status: 'authorization_required',
    authSessionId: session.metadata.name,
    authorizationUrl: session.authorizationUrl,
    expiresAt: session.spec.expiresAt,
    message: `${oauthApp.spec.provider} 연결이 필요합니다. 링크에서 승인을 완료해 주세요.`,
  };
}
```

### 12.3 단일 작성자 규칙

OAuthManager는 OAuthStore의 **유일한 작성자**이다(MUST).

1. Tool/Extension/Sidecar는 OAuthStore 파일을 직접 읽거나 수정해서는 안 된다(MUST)
2. 토큰 조회는 반드시 `ctx.oauth.getAccessToken`을 통해 수행한다(MUST)
3. OAuthManager만이 Grant/Session을 생성/수정/삭제할 수 있다(MUST)

---

## 13. 보안 요구사항 요약

### 13.1 MUST 요구사항

| 요구사항 | 설명 |
|----------|------|
| At-rest encryption | 저장되는 모든 비밀값은 암호화 |
| PKCE(S256) | Authorization Code 플로우에서 필수 |
| State 검증 | Callback에서 state 파라미터 검증 |
| Subject 검증 | subjectMode=user일 때 사용자 일치 확인 |
| 단일 작성자 | OAuthManager만 OAuthStore에 쓰기 |
| 세션 일회성 | 완료된 세션 재사용 불가 |
| 토큰 노출 금지 | 로그, LLM 컨텍스트에 토큰 평문 노출 금지 |

### 13.2 SHOULD 요구사항

| 요구사항 | 설명 |
|----------|------|
| Token refresh | 만료 임박 시 자동 갱신 |
| Single-flight refresh | 동시 refresh 요청 병합 |
| Session 정리 | 만료된 세션 주기적 삭제 |
| Grant 정리 | 철회된 grant 정리 |
| HMAC state | state에 서명 추가 |

---

## 14. 이벤트

### 14.1 auth.granted

승인 완료 시 발행되는 이벤트.

```ts
interface AuthGrantedEvent {
  type: 'auth.granted';
  oauthAppRef: ObjectRef;
  provider: string;
  subject: string;
  scopesGranted: string[];
  grantId: string;
}
```

### 14.2 이벤트 라우팅

`auth.granted` 이벤트는 `AuthSession.resume` 정보를 기반으로 해당 AgentInstance의 이벤트 큐에 enqueue한다(MUST).

```ts
async function emitAuthGrantedEvent(
  resume: ResumeInfo,
  grant: OAuthGrantRecord
): Promise<void> {
  const event: AuthGrantedEvent = {
    type: 'auth.granted',
    oauthAppRef: grant.spec.oauthAppRef,
    provider: grant.spec.provider,
    subject: grant.spec.subject,
    scopesGranted: grant.spec.scopesGranted,
    grantId: grant.metadata.name,
  };

  await runtime.enqueueEvent({
    swarmRef: resume.swarmRef,
    instanceKey: resume.instanceKey,
    agentName: resume.agentName,
    input: JSON.stringify(event),
    origin: resume.origin,
    auth: resume.auth,
    metadata: { eventType: 'auth.granted' },
  });
}
```

---

## 15. Validation 포인트 요약

| 검증 대상 | 규칙 |
|-----------|------|
| OAuthApp.flow | `authorizationCode` 필수 지원, `deviceCode` 선택 지원 |
| OAuthApp.endpoints | flow=authorizationCode 시 authorizationUrl, tokenUrl 필수 |
| OAuthApp.redirect | flow=authorizationCode 시 callbackPath 필수 |
| OAuthApp.scopes | 최소 1개 권장 |
| Tool.auth.scopes | OAuthApp.spec.scopes의 부분집합이어야 함 |
| GetAccessToken.scopes | OAuthApp.spec.scopes의 부분집합이어야 함 |
| Subject | subjectMode에 따른 turn.auth.subjects 키 존재 필수 |
