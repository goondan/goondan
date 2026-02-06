# Goondan Connection 스펙 (v0.1)

본 문서는 `docs/specs/connector.md`, `docs/specs/resources.md`, `docs/specs/runtime.md`를 기반으로 Connection 리소스의 상세 스키마, TypeScript 인터페이스, 검증 규칙을 정의한다.

---

## 1. 개요

Connection은 Connector(프로토콜 패키지)와 Swarm(에이전트 집합) 사이의 **배포 바인딩**을 정의하는 리소스이다.

### 1.1 핵심 책임

1. **Connector 참조**: 어떤 프로토콜 구현체(Connector)를 사용할지 지정
2. **인증 설정**: 해당 배포에 필요한 OAuth 또는 Static Token 인증 구성
3. **라우팅 규칙**: 외부 이벤트를 어떤 Swarm/Instance/Agent로 전달할지 정의
4. **Egress 설정**: 응답 업데이트 정책(replace, updateInThread, append 등) 구성

### 1.2 Connector와 Connection의 분리

Goondan은 Connector와 Connection을 분리하여, Kubernetes의 Service와 Deployment 관계와 유사한 구조를 취한다.

| 리소스 | 역할 | 비유 |
|--------|------|------|
| **Connector** | 프로토콜 구현체 (패키지 배포 단위). `type`, `runtime`, `entry`, `triggers`만 보유 | Service (인터페이스) |
| **Connection** | 배포 와이어링. Connector를 Swarm에 바인딩하고 `auth`, `rules`, `egress`를 설정 | Deployment (인스턴스 설정) |

이 분리를 통해:
- 하나의 Connector를 여러 Connection에서 재사용할 수 있다 (예: 동일한 Slack Connector를 서로 다른 팀/채널/Swarm에 바인딩).
- Connector 패키지는 인증/라우팅 세부사항 없이 순수 프로토콜 로직만 포함하므로, 레지스트리를 통한 배포가 용이하다.
- Connection만 변경하여 라우팅 규칙이나 인증 정보를 업데이트할 수 있다.

### 1.3 설계 원칙

- Connection은 반드시 하나의 Connector를 참조해야 한다(MUST).
- Connection의 `rules`는 Connector의 기존 `ingress`를 대체한다. Connector에 직접 `ingress`가 있더라도 Connection의 `rules`가 우선한다(MUST).
- 하나의 Connector에 여러 Connection을 바인딩할 수 있다(MAY).

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

  # 선택: 라우팅 규칙
  rules:
    - match: {}           # 선택: 매칭 조건
      route: {}           # 필수: 라우팅 설정

  # 선택: Egress 설정
  egress:
    updatePolicy: {}
```

### 2.2 ConnectionSpec TypeScript 인터페이스

```ts
import type { Resource } from '../resource.js';
import type { ObjectRefLike } from '../object-ref.js';
import type {
  ConnectorAuth,
  IngressRule,
  EgressConfig,
} from './connector.js';

/**
 * Connection 리소스 스펙
 */
interface ConnectionSpec {
  /** 바인딩할 Connector 참조 (필수) */
  connectorRef: ObjectRefLike;
  /** 인증 설정 (ConnectorAuth 재사용) */
  auth?: ConnectorAuth;
  /** 라우팅 규칙 (IngressRule과 동일 구조) */
  rules?: ConnectionRule[];
  /** Egress 설정 */
  egress?: EgressConfig;
}

/**
 * Connection 라우팅 규칙
 * IngressRule과 동일한 구조
 */
type ConnectionRule = IngressRule;

/**
 * Connection 리소스 타입
 */
type ConnectionResource = Resource<ConnectionSpec>;
```

`ConnectionRule`은 `IngressRule`의 타입 별칭이다. 기존 Connector 스펙의 Ingress 규칙 구조를 그대로 재사용하여, `match`(조건)와 `route`(라우팅)로 구성된다.

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
  rules:
    - match:
        command: "/agent"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
```

규칙:
1. Runtime은 OAuthApp 참조를 해석하여 토큰 조회 인터페이스를 제공해야 한다(SHOULD).
2. 토큰이 없거나 만료된 경우, 승인 플로우를 트리거할 수 있다(MAY).

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
  rules:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.message.chat.id"
        inputFrom: "$.message.text"
```

규칙:
1. Static Token 모드에서는 OAuth 승인 플로우를 수행하지 않는다(MUST).
2. OAuthStore를 참조하지 않는다(MUST).
3. 토큰은 ValueSource 패턴을 따른다.

### 4.3 ValueSource 패턴

```ts
/**
 * 값 소스 - 직접 값 또는 외부 소스에서 주입
 */
type ValueSource =
  | { value: string; valueFrom?: never }
  | { value?: never; valueFrom: ValueFrom };

/**
 * 외부 소스에서 값 주입
 */
type ValueFrom =
  | { env: string; secretRef?: never }
  | { env?: never; secretRef: SecretRef };

/**
 * 비밀 저장소 참조
 */
interface SecretRef {
  /** Secret 참조 (예: "Secret/slack-oauth") */
  ref: string;
  /** Secret 내의 키 */
  key: string;
}
```

규칙:
1. `value`와 `valueFrom`은 동시에 존재할 수 없다(MUST).
2. `valueFrom` 내에서 `env`와 `secretRef`는 동시에 존재할 수 없다(MUST).
3. `secretRef.ref`는 `"Secret/<name>"` 형식이어야 한다(MUST).

### 4.4 ConnectorAuth TypeScript 인터페이스

```ts
/**
 * Connector/Connection 인증 설정
 *
 * MUST: oauthAppRef와 staticToken은 동시에 존재할 수 없음
 */
type ConnectorAuth =
  | { oauthAppRef: ObjectRef; staticToken?: never }
  | { oauthAppRef?: never; staticToken: ValueSource };
```

`ConnectorAuth`는 Connector 스펙에서 정의된 타입을 Connection에서도 동일하게 재사용한다. 이는 Connector와 Connection 간의 인증 설정 호환성을 보장한다.

---

## 5. 라우팅 규칙 (Rules)

`rules`는 외부 이벤트를 어떤 Swarm/Instance/Agent로 전달할지 정의하는 규칙 배열이다. 구조적으로 Connector의 `ingress`와 동일하며, `ConnectionRule`은 `IngressRule`의 타입 별칭이다.

### 5.1 Match 조건

`match` 블록은 외부 이벤트를 필터링하는 조건을 정의한다.

```yaml
rules:
  - match:
      command: "/swarm"        # 명령어 매칭
      eventType: "message"     # 이벤트 타입 매칭
      channel: "C123456"       # 특정 채널 매칭
    route:
      # ...
```

`match`가 생략되면 모든 이벤트가 해당 규칙으로 라우팅된다.

```ts
interface IngressMatch {
  /** 명령어 매칭 (예: "/swarm") */
  command?: string;
  /** 이벤트 타입 매칭 */
  eventType?: string;
  /** 채널 매칭 */
  channel?: string;
}
```

규칙:
1. `match` 내 여러 조건이 지정되면 AND 조건으로 해석한다(MUST).
2. `match`가 생략되면 catch-all 규칙으로 동작한다(MUST).
3. 규칙 배열은 순서대로 평가하며, 첫 번째 매칭되는 규칙이 적용된다(MUST).

### 5.2 Route 설정

`route` 블록은 매칭된 이벤트를 어떤 Swarm/Instance로 전달할지 정의한다.

```yaml
route:
  swarmRef: { kind: Swarm, name: default }
  instanceKeyFrom: "$.event.thread_ts"   # JSONPath
  inputFrom: "$.event.text"              # JSONPath
  agentName: "planner"                   # 선택: 특정 에이전트 이름
```

```ts
interface IngressRoute {
  /** 대상 Swarm */
  swarmRef: ObjectRefLike;
  /** instanceKey 추출 표현식 (JSONPath) */
  instanceKeyFrom?: string;
  /** 입력 텍스트 추출 표현식 (JSONPath) */
  inputFrom?: string;
  /** 대상 에이전트 이름 (선택) */
  agentName?: string;
}
```

규칙:
1. `swarmRef`는 필수이며, 유효한 Swarm을 참조해야 한다(MUST).
2. `instanceKeyFrom`은 JSONPath 표현식으로, 동일 맥락의 이벤트를 같은 인스턴스로 라우팅한다(SHOULD).
3. `inputFrom`은 JSONPath 표현식으로, LLM에 전달할 입력 텍스트를 추출한다(SHOULD).
4. `agentName`이 지정되면 해당 에이전트로 직접 라우팅하고, 생략되면 Swarm의 entrypoint 에이전트로 라우팅한다(SHOULD).
5. `instanceKeyFrom`이 생략되면 런타임은 기본 인스턴스 키를 사용한다(MAY).
6. `inputFrom`이 생략되면 런타임은 페이로드 전체를 문자열로 변환하여 사용한다(MAY).

### 5.3 JSONPath 해석 규칙

Connection의 `instanceKeyFrom`, `inputFrom` 등에서 사용되는 JSONPath 간단 구현 규칙이다.

```
"$.field"                    # 루트의 field
"$.parent.child"             # 중첩 필드
"$.event.thread_ts"          # 2단계 중첩
"$.message.chat.id"          # 3단계 중첩
```

규칙:
1. `$`는 페이로드 루트 객체를 의미한다(MUST).
2. `.`은 속성 접근 구분자이다(MUST).
3. 경로가 `$.`로 시작하지 않으면 무시한다(SHOULD).
4. 경로 탐색 중 `null` 또는 `undefined`를 만나면 `undefined`를 반환한다(MUST).

---

## 6. Egress 설정

Egress는 에이전트의 응답을 외부 채널로 전송할 때의 정책을 정의한다.

### 6.1 UpdatePolicy

```yaml
egress:
  updatePolicy:
    mode: updateInThread   # replace | updateInThread | append
    debounceMs: 1500       # 선택: 디바운스 시간(ms)
```

```ts
interface EgressConfig {
  /** 업데이트 정책 */
  updatePolicy?: UpdatePolicy;
}

interface UpdatePolicy {
  /** 업데이트 모드 */
  mode: 'replace' | 'updateInThread' | 'append';
  /** 디바운스 시간 (밀리초) */
  debounceMs?: number;
}
```

| Mode | 설명 |
|------|------|
| `replace` | 기존 메시지를 새 메시지로 교체. 최신 응답만 표시할 때 사용 |
| `updateInThread` | 동일 스레드에 메시지 업데이트/추가. Slack 스레드 등에 적합 |
| `append` | 새 메시지를 추가만 함. 모든 업데이트를 별도 메시지로 표시 |

### 6.2 Progress vs Final

Connector의 `send` 메서드는 `kind` 파라미터로 진행상황과 최종 응답을 구분한다.

```ts
interface ConnectorSendInput {
  text: string;
  origin?: JsonObject;
  auth?: JsonObject;
  metadata?: JsonObject;
  kind?: 'progress' | 'final';
}
```

| kind | 설명 |
|------|------|
| `progress` | Step 진행 중 중간 응답. `debounceMs`가 적용됨 |
| `final` | Turn 완료 후 최종 응답. 디바운스 없이 즉시 전송 |

규칙:
1. `kind`가 생략되면 `final`로 처리한다(SHOULD).
2. `progress` 메시지에는 `debounceMs`가 적용되어, 짧은 간격의 중간 업데이트를 병합할 수 있다(SHOULD).
3. `final` 메시지는 디바운스를 무시하고 즉시 전송한다(MUST).

---

## 7. 예시

### 7.1 CLI Connection (가장 단순한 구성)

인증이 필요 없는 CLI Connector를 기본 Swarm에 바인딩하는 최소 구성이다.

```yaml
# Connector 정의 (프로토콜 패키지)
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  type: cli

---

# Connection 정의 (배포 와이어링)
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  rules:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"
```

### 7.2 Slack Connection (OAuthApp)

OAuthApp을 통한 인증으로 Slack Connector를 Swarm에 바인딩하는 구성이다. 여러 규칙으로 명령어/이벤트를 구분하고, Egress 정책을 포함한다.

```yaml
# Connector 정의
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  type: slack

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
  name: slack-to-default
spec:
  connectorRef: { kind: Connector, name: slack }

  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }

  rules:
    # /agent 명령어 매칭
    - match:
        command: "/agent"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"

    # app_mention 이벤트 매칭
    - match:
        eventType: "app_mention"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"

  egress:
    updatePolicy:
      mode: updateInThread
      debounceMs: 1500
```

### 7.3 Telegram Connection (Static Token)

환경변수를 통한 Static Token 인증으로 Telegram Connector를 바인딩하는 구성이다. 여러 명령어에 대해 서로 다른 라우팅을 설정한다.

```yaml
# Connector 정의
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: telegram
spec:
  type: telegram

---

# Connection 정의 (Static Token 기반)
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: telegram-to-coding-swarm
spec:
  connectorRef: { kind: Connector, name: telegram }

  auth:
    staticToken:
      valueFrom:
        env: "TELEGRAM_BOT_TOKEN"

  rules:
    # /start 명령어 매칭 - planner 에이전트로 라우팅
    - match:
        command: "/start"
      route:
        swarmRef: { kind: Swarm, name: coding-swarm }
        instanceKeyFrom: "$.message.chat.id"
        inputFrom: "$.message.text"
        agentName: "planner"

    # /code 명령어 매칭 - coder 에이전트로 라우팅
    - match:
        command: "/code"
      route:
        swarmRef: { kind: Swarm, name: coding-swarm }
        instanceKeyFrom: "$.message.chat.id"
        inputFrom: "$.message.text"
        agentName: "coder"

    # 기본 라우팅 (매칭 없는 모든 메시지)
    - route:
        swarmRef: { kind: Swarm, name: coding-swarm }
        instanceKeyFrom: "$.message.chat.id"
        inputFrom: "$.message.text"

  egress:
    updatePolicy:
      mode: append
```

### 7.4 동일 Connector에 여러 Connection 바인딩

하나의 Slack Connector를 팀별로 서로 다른 Connection으로 분리하는 구성이다.

```yaml
# 공통 Connector
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  type: slack

---

# 개발팀 Connection
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-dev-team
spec:
  connectorRef: { kind: Connector, name: slack }
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  rules:
    - match:
        channel: "C-DEV-CHANNEL"
      route:
        swarmRef: { kind: Swarm, name: dev-swarm }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"

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
  rules:
    - match:
        channel: "C-OPS-CHANNEL"
      route:
        swarmRef: { kind: Swarm, name: ops-swarm }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
  egress:
    updatePolicy:
      mode: replace
```

---

## 8. Validation 규칙 요약

Runtime/Validator는 다음 규칙을 검증해야 한다.

| 항목 | 규칙 | 수준 |
|------|------|------|
| `spec.connectorRef` | 필수. 유효한 Connector 참조 | MUST |
| `spec.auth` | `oauthAppRef`와 `staticToken` 중 하나만 허용 | MUST |
| `spec.auth.oauthAppRef` | 유효한 OAuthApp 참조 | MUST |
| `spec.auth.staticToken` | 유효한 ValueSource | MUST |
| `spec.rules` | 선택. 있으면 배열 형식 | MAY |
| `spec.rules[].route` | 필수 | MUST |
| `spec.rules[].route.swarmRef` | 유효한 Swarm 참조 | MUST |
| `spec.rules[].route.instanceKeyFrom` | JSONPath 표현식 (선택) | SHOULD |
| `spec.rules[].route.inputFrom` | JSONPath 표현식 (선택) | SHOULD |
| `spec.rules[].route.agentName` | 해당 Swarm의 agents에 포함된 에이전트 이름 | SHOULD |
| `spec.egress.updatePolicy.mode` | `replace`, `updateInThread`, `append` 중 하나 | MUST |
| `spec.egress.updatePolicy.debounceMs` | 0 이상의 정수 | SHOULD |

### 추가 검증 규칙

1. `connectorRef`가 참조하는 Connector 리소스가 Bundle 내에 존재해야 한다(MUST).
2. `auth.oauthAppRef`와 `auth.staticToken`은 동시에 존재할 수 없다(MUST).
3. `rules[].route.swarmRef`가 참조하는 Swarm 리소스가 Bundle 내에 존재해야 한다(MUST).
4. `rules[].route.agentName`이 지정된 경우, 해당 에이전트가 참조된 Swarm의 `agents` 배열에 포함되어야 한다(SHOULD).
5. `auth`가 생략된 경우, 연결된 Connector의 `type`이 인증을 필요로 하지 않는 타입인지 확인한다(SHOULD). CLI 등 인증이 불필요한 Connector는 `auth` 생략이 허용된다.

---

## 9. 참고 문서

- `docs/specs/connector.md` - Connector 시스템 스펙 (프로토콜 패키지, Trigger Handler, ConnectorAdapter)
- `docs/specs/resources.md` - Config Plane 리소스 정의 스펙 (ObjectRef, Selector, ValueSource 등)
- `docs/specs/runtime.md` - Runtime 실행 모델 스펙 (Instance/Turn/Step, 라우팅)
- `docs/specs/oauth.md` - OAuth 시스템 스펙 (OAuthApp, OAuthStore, Token 관리)
- `docs/specs/bundle.md` - Bundle YAML 스펙 (리소스 정의, 검증 규칙)

---

**문서 버전**: v0.1
**최종 수정**: 2026-02-06
**참조**: @docs/specs/connector.md, @docs/specs/resources.md, @docs/specs/runtime.md
