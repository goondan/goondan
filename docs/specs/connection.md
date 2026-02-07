# Goondan Connection 스펙 (v1.0)

본 문서는 `docs/specs/connector.md`, `docs/specs/resources.md`, `docs/specs/runtime.md`를 기반으로 Connection 리소스의 상세 스키마, TypeScript 인터페이스, 검증 규칙을 정의한다.

> **v1.0 주요 변경**: match를 이벤트 스키마 기반으로 변경, route에서 swarmRef/instanceKeyFrom/inputFrom 제거 후 agentRef(선택)로 단순화, verify.webhook.provider 제거, JSONPath 해석 규칙 삭제.

---

## 1. 개요

Connection은 Connector(프로토콜 패키지)와 Swarm(에이전트 집합) 사이의 **배포 바인딩**을 정의하는 리소스이다.

### 1.1 핵심 책임

1. **Connector 참조**: 어떤 프로토콜 구현체(Connector)를 사용할지 지정
2. **인증 설정**: 해당 배포에 필요한 OAuth 또는 Static Token 인증 구성
3. **서명 검증 시크릿 제공**: Connector가 inbound 서명 검증에 사용할 시크릿 제공
4. **이벤트 라우팅**: ConnectorEvent를 어떤 Agent로 전달할지 정의

### 1.2 Connector와 Connection의 분리

| 리소스 | 역할 | 비유 |
|--------|------|------|
| **Connector** | 프로토콜 구현체. triggers(프로토콜 선언), events(이벤트 스키마), entry(실행 코드) 보유 | Service (인터페이스) |
| **Connection** | 배포 와이어링. Connector를 Agent에 바인딩하고 `auth`, `verify`, `ingress.rules`를 설정 | Deployment (인스턴스 설정) |

이 분리를 통해:
- 하나의 Connector를 여러 Connection에서 재사용할 수 있다.
- Connector 패키지는 인증/라우팅 세부사항 없이 순수 프로토콜 로직만 포함한다.
- Connection만 변경하여 라우팅 규칙이나 인증 정보를 업데이트할 수 있다.

### 1.3 설계 원칙

- Connection은 반드시 하나의 Connector를 참조해야 한다(MUST).
- Connection의 `ingress.rules`는 ConnectorEvent의 `name`과 `properties`를 기반으로 라우팅한다(MUST).
- 하나의 Connector에 여러 Connection을 바인딩할 수 있다(MAY).
- `agentRef`가 생략되면 Swarm의 entrypoint Agent로 라우팅한다(MUST).

---

## 2. Connection 리소스 스키마

### 2.1 기본 구조 (YAML)

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: <connection-name>
  labels: {}              # 선택
  annotations: {}         # 선택
spec:
  # 필수: 바인딩할 Connector 참조
  connectorRef: <ObjectRefLike>

  # 선택: 인증 설정
  auth:
    oauthAppRef: { kind: OAuthApp, name: <oauth-app> }
    # 또는
    staticToken:
      value: "<plain-token>"
      # 또는
      valueFrom:
        env: "TOKEN_ENV_VAR"
        # 또는
        secretRef: { ref: "Secret/<name>", key: "<key>" }

  # 선택: 서명 검증 시크릿
  verify:
    webhook:
      signingSecret:
        valueFrom:
          secretRef: { ref: "Secret/<name>", key: "<key>" }

  # 선택: Ingress 라우팅 규칙
  ingress:
    rules:
      - match:
          event: <event-name>
          properties: {}    # 선택: 속성 조건
        route:
          agentRef: { kind: Agent, name: <agent> }  # 선택
```

### 2.2 ConnectionSpec TypeScript 인터페이스

```ts
/**
 * Connection 리소스 스펙
 */
interface ConnectionSpec {
  /** 바인딩할 Connector 참조 (필수) */
  connectorRef: ObjectRefLike;
  /** 인증 설정 */
  auth?: ConnectorAuth;
  /** 서명 검증 시크릿 설정 */
  verify?: ConnectionVerify;
  /** Ingress 라우팅 규칙 */
  ingress?: IngressConfig;
}

/**
 * 서명 검증 설정
 */
interface ConnectionVerify {
  /** Webhook 서명 검증 설정 */
  webhook?: {
    /** 서명 시크릿 (ValueSource 패턴) */
    signingSecret: ValueSource;
  };
}

/**
 * Ingress 설정
 */
interface IngressConfig {
  /** 라우팅 규칙 */
  rules?: IngressRule[];
}

/**
 * Ingress 라우팅 규칙
 */
interface IngressRule {
  /** 매칭 조건 */
  match?: IngressMatch;
  /** 라우팅 설정 */
  route: IngressRoute;
}

/**
 * 이벤트 매칭 조건
 * Connector의 events 스키마를 기반으로 매칭
 */
interface IngressMatch {
  /** ConnectorEvent.name과 매칭 */
  event?: string;
  /** ConnectorEvent.properties의 값과 매칭 */
  properties?: Record<string, string | number | boolean>;
}

/**
 * 라우팅 설정
 */
interface IngressRoute {
  /** 대상 Agent (선택, 생략 시 Swarm entrypoint로 라우팅) */
  agentRef?: ObjectRefLike;
}

/**
 * Connection 리소스 타입
 */
type ConnectionResource = Resource<ConnectionSpec>;
```

---

## 3. connectorRef

### 3.1 역할

`connectorRef`는 이 Connection이 바인딩하는 Connector 리소스를 참조한다. Connection은 반드시 하나의 Connector를 참조해야 한다(MUST).

### 3.2 지원 형식

`ObjectRefLike` 타입으로, 문자열 축약 형식과 객체형 참조를 모두 지원한다.

```yaml
# 문자열 축약 형식
connectorRef: "Connector/slack"

# 객체형 참조 (kind 생략 불가)
connectorRef: { kind: Connector, name: slack }

# 전체 형식 (apiVersion 포함)
connectorRef:
  apiVersion: agents.example.io/v1alpha1
  kind: Connector
  name: slack
```

### 3.3 규칙

1. `connectorRef`는 필수 필드이다(MUST).
2. 참조하는 Connector 리소스가 동일 Bundle 내에 존재해야 한다(MUST).
3. 참조된 Connector가 존재하지 않으면 검증 단계에서 오류로 처리한다(MUST).

---

## 4. 인증 모드

Connection은 배포 단위의 인증 설정을 제공한다. 동일한 Connector를 서로 다른 인증 정보로 여러 Connection에 바인딩할 수 있다.

인증은 두 가지 모드 중 하나를 사용할 수 있으며, 두 모드를 동시에 활성화할 수 없다(MUST).

### 4.1 OAuthApp 기반 모드

설치/승인 플로우를 통해 토큰을 획득하는 모드이다.

```yaml
kind: Connection
metadata:
  name: slack-production
spec:
  connectorRef: { kind: Connector, name: slack }
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  ingress:
    rules:
      - match:
          event: app_mention
        route:
          agentRef: { kind: Agent, name: planner }
```

규칙:
1. Runtime은 OAuthApp 참조를 해석하여 토큰 조회 인터페이스를 제공해야 한다(SHOULD).
2. 토큰이 없거나 만료된 경우, 승인 플로우를 트리거할 수 있다(MAY).
3. OAuth를 사용하는 Connection은 Turn 생성 시 `turn.auth.subjects`를 채워야 한다(MUST).

### 4.2 Static Token 기반 모드

운영자가 발급한 토큰을 Secret이나 환경변수로 주입하는 모드이다.

```yaml
kind: Connection
metadata:
  name: telegram-production
spec:
  connectorRef: { kind: Connector, name: telegram }
  auth:
    staticToken:
      valueFrom:
        env: "TELEGRAM_BOT_TOKEN"
  ingress:
    rules:
      - match:
          event: message
        route: {}
```

규칙:
1. Static Token 모드에서는 OAuth 승인 플로우를 수행하지 않는다(MUST).
2. OAuthStore를 참조하지 않는다(MUST).
3. 토큰은 ValueSource 패턴을 따른다.

### 4.3 ValueSource 패턴

```ts
type ValueSource =
  | { value: string; valueFrom?: never }
  | { value?: never; valueFrom: ValueFrom };

type ValueFrom =
  | { env: string; secretRef?: never }
  | { env?: never; secretRef: SecretRef };

interface SecretRef {
  ref: string;
  key: string;
}
```

규칙:
1. `value`와 `valueFrom`은 동시에 존재할 수 없다(MUST).
2. `valueFrom` 내에서 `env`와 `secretRef`는 동시에 존재할 수 없다(MUST).
3. `secretRef.ref`는 `"Secret/<name>"` 형식이어야 한다(MUST).

### 4.4 ConnectorAuth TypeScript 인터페이스

```ts
type ConnectorAuth =
  | { oauthAppRef: ObjectRef; staticToken?: never }
  | { oauthAppRef?: never; staticToken: ValueSource };
```

---

## 5. Ingress 라우팅 규칙

`ingress.rules`는 ConnectorEvent를 어떤 Agent로 전달할지 정의하는 규칙 배열이다.

### 5.1 Match 조건

`match` 블록은 ConnectorEvent의 `name`과 `properties`를 기반으로 필터링한다.

```yaml
ingress:
  rules:
    - match:
        event: app_mention              # ConnectorEvent.name과 매칭
        properties:                     # ConnectorEvent.properties와 매칭 (선택)
          channel_id: "C123456"
      route:
        agentRef: { kind: Agent, name: planner }
```

`match`가 생략되면 모든 이벤트가 해당 규칙으로 라우팅된다.

```ts
interface IngressMatch {
  /** ConnectorEvent.name과 매칭 */
  event?: string;
  /** ConnectorEvent.properties의 값과 매칭 */
  properties?: Record<string, string | number | boolean>;
}
```

규칙:
1. `match.event`와 `match.properties` 내 여러 조건이 지정되면 AND 조건으로 해석한다(MUST).
2. `match`가 생략되면 catch-all 규칙으로 동작한다(MUST).
3. 규칙 배열은 순서대로 평가하며, 첫 번째 매칭되는 규칙이 적용된다(MUST).
4. `match.event`는 Connector의 `events[].name`에 선언된 이벤트 이름과 일치해야 한다(SHOULD).

### 5.2 Route 설정

`route` 블록은 매칭된 이벤트를 어떤 Agent로 전달할지 정의한다.

```yaml
route:
  agentRef: { kind: Agent, name: planner }   # 선택
```

```ts
interface IngressRoute {
  /** 대상 Agent (선택, 생략 시 Swarm entrypoint로 라우팅) */
  agentRef?: ObjectRefLike;
}
```

규칙:
1. `agentRef`가 지정되면 해당 Agent로 직접 라우팅한다(MUST).
2. `agentRef`가 생략되면 Swarm의 entrypoint Agent로 라우팅한다(MUST).
3. `agentRef`가 지정된 경우, 해당 Agent가 Swarm의 `agents` 배열에 포함되어야 한다(SHOULD).

---

## 6. 서명 검증 (Verify)

`verify` 블록은 Connector가 inbound 요청의 서명을 검증할 때 사용할 시크릿을 정의한다. `auth`(OAuth/Token 인증)와 독립적으로 설정할 수 있다.

### 6.1 Webhook 서명 검증

```yaml
verify:
  webhook:
    signingSecret:
      valueFrom:
        secretRef: { ref: "Secret/slack-webhook", key: "signing_secret" }
```

```ts
interface ConnectionVerify {
  webhook?: {
    /** 서명 시크릿 (ValueSource 패턴) */
    signingSecret: ValueSource;
  };
}
```

규칙:
1. `verify.webhook.signingSecret`은 ValueSource 패턴을 따른다(MUST).
2. Connection은 Connector가 서명 검증에 사용할 서명 시크릿을 제공해야 한다(MUST).
3. 서명 검증 실패 시 Connector는 ConnectorEvent를 emit하지 않아야 한다(MUST).
4. `verify`는 `auth`와 독립적으로 설정할 수 있다(MAY).

### 6.2 auth와 verify의 분리

| 블록 | 용도 | 예시 |
|------|------|------|
| `auth` | OAuth/Static Token 인증. Turn의 인증 컨텍스트 제공 | Slack Bot Token, Telegram Bot Token |
| `verify` | Inbound 서명 검증. 요청 무결성 확인 | Slack Signing Secret, GitHub Webhook Secret |

두 블록은 서로 독립적이다:
- `auth`만 설정: 인증은 있지만 서명 검증 없음 (예: CLI Connector)
- `verify`만 설정: 서명 검증만 수행하고 별도 인증 없음 (예: 공개 webhook)
- 둘 다 설정: 인증과 서명 검증 모두 수행 (예: Slack Bot)
- 둘 다 없음: 인증/검증 없는 단순 연결 (예: 로컬 개발용 CLI)

---

## 7. Runtime 동작 규칙

### 7.1 turn.auth.subjects 규칙

OAuth를 사용하는 Connection(`auth.oauthAppRef`가 설정된 경우)은 Turn 생성 시 `turn.auth.subjects`를 채워야 한다(MUST).

```yaml
# subjectMode=global 예시
turn:
  auth:
    actor:
      id: "slack:U234567"
    subjects:
      global: "slack:team:T111"

# subjectMode=user 예시
turn:
  auth:
    actor:
      id: "slack:U234567"
    subjects:
      global: "slack:team:T111"
      user: "slack:user:T111:U234567"
```

### 7.2 독립 Turn 처리

하나의 trigger가 여러 ConnectorEvent를 emit하면 각 event는 독립 Turn으로 처리되어야 한다(MUST). 각 Turn은 고유한 `traceId`를 가지며, 서로 다른 Agent에 전달될 수 있다.

---

## 8. 예시

### 8.1 CLI Connection (가장 단순한 구성)

```yaml
# Connector 정의
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  runtime: node
  entry: "./connectors/cli/index.ts"
  triggers:
    - type: cli
  events:
    - name: user_input

---

# Connection 정의
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - route: {}  # entrypoint Agent로 라우팅
```

### 8.2 Slack Connection (OAuthApp)

```yaml
# Connector 정의
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  runtime: node
  entry: "./connectors/slack/index.ts"
  triggers:
    - type: http
      endpoint:
        path: /webhook/slack/events
        method: POST
  events:
    - name: app_mention
      properties:
        channel_id: { type: string }
        ts: { type: string }
        thread_ts: { type: string, optional: true }
    - name: message.im
      properties:
        channel_id: { type: string }
        ts: { type: string }

---

# OAuthApp 정의
apiVersion: agents.example.io/v1alpha1
kind: OAuthApp
metadata:
  name: slack-bot
spec:
  provider: slack
  flow: authorizationCode
  subjectMode: global
  client:
    clientId:
      valueFrom:
        env: "SLACK_CLIENT_ID"
    clientSecret:
      valueFrom:
        secretRef: { ref: "Secret/slack-oauth", key: "client_secret" }
  endpoints:
    authorizationUrl: "https://slack.com/oauth/v2/authorize"
    tokenUrl: "https://slack.com/api/oauth.v2.access"
  scopes:
    - "chat:write"
    - "channels:read"
  redirect:
    callbackPath: "/oauth/callback/slack-bot"

---

# Connection 정의 (OAuthApp 기반)
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-main
spec:
  connectorRef: { kind: Connector, name: slack }

  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }

  verify:
    webhook:
      signingSecret:
        valueFrom:
          secretRef: { ref: "Secret/slack-webhook", key: "signing_secret" }

  ingress:
    rules:
      - match:
          event: app_mention
        route:
          agentRef: { kind: Agent, name: planner }
      - match:
          event: message.im
        route: {}  # entrypoint로 라우팅
```

### 8.3 Telegram Connection (Static Token)

```yaml
# Connection 정의 (Static Token 기반)
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: telegram-main
spec:
  connectorRef: { kind: Connector, name: telegram }

  auth:
    staticToken:
      valueFrom:
        env: "TELEGRAM_BOT_TOKEN"

  ingress:
    rules:
      - match:
          event: message
        route:
          agentRef: { kind: Agent, name: planner }
      - match:
          event: command
        route:
          agentRef: { kind: Agent, name: coder }
      - route: {}  # 기본: entrypoint로 라우팅
```

### 8.4 동일 Connector에 여러 Connection 바인딩

```yaml
# 개발팀 Connection
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-dev-team
spec:
  connectorRef: { kind: Connector, name: slack }
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  ingress:
    rules:
      - match:
          event: app_mention
          properties:
            channel_id: "C-DEV-CHANNEL"
        route:
          agentRef: { kind: Agent, name: dev-agent }

---

# 운영팀 Connection
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-ops-team
spec:
  connectorRef: { kind: Connector, name: slack }
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  ingress:
    rules:
      - match:
          event: app_mention
          properties:
            channel_id: "C-OPS-CHANNEL"
        route:
          agentRef: { kind: Agent, name: ops-agent }
```

---

## 9. Validation 규칙 요약

Runtime/Validator는 다음 규칙을 검증해야 한다.

| 항목 | 규칙 | 수준 |
|------|------|------|
| `spec.connectorRef` | 필수. 유효한 Connector 참조 | MUST |
| `spec.auth` | `oauthAppRef`와 `staticToken` 중 하나만 허용 | MUST |
| `spec.auth.oauthAppRef` | 유효한 OAuthApp 참조 | MUST |
| `spec.auth.staticToken` | 유효한 ValueSource | MUST |
| `spec.verify.webhook.signingSecret` | 설정된 경우 유효한 ValueSource | MUST |
| `spec.ingress.rules` | 선택. 있으면 배열 형식 | MAY |
| `spec.ingress.rules[].route` | 필수 | MUST |
| `spec.ingress.rules[].match.event` | Connector의 events[].name에 선언된 이름 | SHOULD |
| `spec.ingress.rules[].route.agentRef` | 유효한 Agent 참조 (선택) | SHOULD |

### 추가 검증 규칙

1. `connectorRef`가 참조하는 Connector 리소스가 Bundle 내에 존재해야 한다(MUST).
2. `auth.oauthAppRef`와 `auth.staticToken`은 동시에 존재할 수 없다(MUST).
3. `auth`와 `verify`는 독립적으로 설정할 수 있다(MAY).
4. `ingress.rules[].route.agentRef`가 지정된 경우, 해당 Agent가 Swarm의 `agents` 배열에 포함되어야 한다(SHOULD).
5. OAuth를 사용하는 Connection은 Turn 생성 시 `turn.auth.subjects`를 채워야 한다(MUST).
6. 하나의 trigger가 여러 ConnectorEvent를 emit하면 각 event는 독립 Turn으로 처리되어야 한다(MUST).

---

## 10. 참고 문서

- `docs/specs/connector.md` - Connector 시스템 스펙 (프로토콜 선언, events 스키마, Entry Function)
- `docs/specs/resources.md` - Config Plane 리소스 정의 스펙 (ObjectRef, Selector, ValueSource 등)
- `docs/specs/runtime.md` - Runtime 실행 모델 스펙 (Instance/Turn/Step, 라우팅)
- `docs/specs/oauth.md` - OAuth 시스템 스펙 (OAuthApp, OAuthStore, Token 관리)
- `docs/specs/bundle.md` - Bundle YAML 스펙 (리소스 정의, 검증 규칙)

---

**문서 버전**: v1.0
**최종 수정**: 2026-02-08
**참조**: @docs/specs/connector.md, @docs/specs/resources.md, @docs/specs/runtime.md
