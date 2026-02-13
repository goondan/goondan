# Goondan Connection 스펙 v2.0

> 공통 타입(`ObjectRefLike`, `ValueSource`, `Ingress*`)의 단일 기준은 `docs/specs/shared-types.md`이다.
> 값 해석 정책(`valueFrom.env`, 레지스트리/시크릿 규칙)은 `docs/specs/help.md`의 공통 계약을 따른다.

## 1. 개요

### 1.1 배경 및 설계 철학

Connection은 Connector(독립 프로세스)와 Swarm(에이전트 집합) 사이의 **배포 바인딩**을 정의하는 리소스이다. Connector가 프로토콜 구현을 담당한다면, Connection은 "어떤 인증 정보로, 어떤 이벤트를, 어떤 에이전트에게 전달할 것인가"를 정의한다.

**주의:** 라벨 기반 리소스 선택(Selector)은 현재 지원하지 않으며, ObjectRef 직접 참조만 사용한다.

이 분리를 통해:
- **하나의 Connector를 여러 Connection에서 재사용**할 수 있다. 예를 들어 동일한 Slack Connector를 개발팀과 운영팀이 서로 다른 인증 정보와 라우팅 규칙으로 사용할 수 있다.
- **Connector 패키지는 순수 프로토콜 로직만** 포함한다. 인증이나 라우팅 세부사항이 섞이지 않으므로 재사용성과 테스트 용이성이 높아진다.
- **Connection만 변경하여** 라우팅 규칙이나 인증 정보를 업데이트할 수 있다. Connector 코드를 수정할 필요가 없다.

Connection은 `secrets`를 통해 키-값 형태의 비밀값을 전달한다.
서명 검증 알고리즘은 Connector가 구현하며, OAuth 인증이 필요한 경우 Extension 내부에서 구현한다.

### 1.2 핵심 책임

1. **Connector 참조**: 어떤 프로토콜 구현체(Connector)를 사용할지 지정
2. **Swarm 참조**: 이벤트를 어떤 Swarm으로 라우팅할지 지정
3. **시크릿 제공**: Connector 프로세스에 필요한 비밀값(API 토큰, 서명 시크릿 등) 전달
4. **이벤트 라우팅**: ConnectorEvent를 어떤 Agent로 전달할지 정의

**서명 검증:** Connector 구현체가 `ctx.secrets`에서 시크릿을 읽어 자체적으로 수행합니다.

### 1.3 Connector와 Connection의 분리

| 리소스 | 역할 | 비유 |
|--------|------|------|
| **Connector** | 프로토콜 구현체. entry(실행 코드), events(이벤트 스키마) 보유. 별도 Bun 프로세스로 실행. 서명 검증 자체 수행 | Service (인터페이스) |
| **Connection** | 배포 와이어링. Connector를 Swarm에 바인딩하고 `secrets`, `ingress.rules`를 설정 | Deployment (인스턴스 설정) |

---

## 2. 핵심 규칙

다음은 Connection 시스템 구현 시 반드시 준수해야 하는 규범적 규칙을 요약한 것이다. 세부 사항은 이후 각 섹션에서 설명한다.

### 2.1 참조 규칙

1. `spec.connectorRef`는 필수이며, 유효한 Connector 리소스를 참조해야 한다(MUST).
2. 참조하는 Connector 리소스가 동일 Bundle 내에 존재해야 한다(MUST).
3. `spec.swarmRef`가 생략된 경우, Orchestrator는 Bundle 내 첫 번째(또는 유일한) Swarm을 사용해야 한다(MUST).
4. `spec.swarmRef`가 지정된 경우, 참조하는 Swarm 리소스가 동일 Bundle 내에 존재해야 한다(MUST).

### 2.2 시크릿 규칙

1. `spec.secrets`는 Connector 프로세스에 환경변수 또는 컨텍스트로 전달되어야 한다(MUST).
2. `value`와 `valueFrom`은 동시에 존재할 수 없다(MUST).
3. `valueFrom.env`가 필수 필드에서 미해결되면 구성 로드 단계에서 오류여야 한다(MUST).
4. `valueFrom.env`가 선택 필드에서 미해결되면 해당 필드를 미설정 상태로 둔다(SHOULD).

### 2.3 라우팅 규칙

1. Connection의 ingress 규칙은 ConnectorEvent를 특정 Agent로 라우팅하는 데 사용되어야 한다(MUST).
2. `ingress.rules[].route.agentRef`가 생략되면 Swarm의 `entryAgent`로 라우팅해야 한다(MUST).
3. `ingress.rules[].match.event`는 Connector의 `events[].name`에 선언된 이름과 일치해야 한다(SHOULD).
4. `match.event`와 `match.properties` 내 여러 조건이 지정되면 AND 조건으로 해석한다(MUST).
5. `match`가 생략되면 catch-all 규칙으로 동작한다(MUST).
6. 규칙 배열은 순서대로 평가하며, 첫 번째 매칭되는 규칙이 적용된다(MUST).

### 2.4 서명 검증 규칙

1. 서명 검증은 Connector 구현체가 자체적으로 수행해야 한다(MUST).
2. 서명 검증 실패 시 Connector는 ConnectorEvent를 emit하지 않아야 한다(MUST).
3. 서명 시크릿은 `secrets`에 일반 ValueSource로 제공되어야 한다(SHOULD).

### 2.5 독립 Turn 처리 규칙

1. 하나의 이벤트가 여러 ConnectorEvent를 emit하면 각 event는 독립 Turn으로 처리되어야 한다(MUST).
2. OAuth 인증이 필요한 경우 Extension 내부에서 구현해야 한다. Connection은 OAuth를 직접 관리하지 않는다(MUST NOT).

---

## 3. Connection 리소스 스키마

### 3.1 기본 구조 (YAML)

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-swarm
spec:
  # 필수: 바인딩할 Connector 참조
  connectorRef: "Connector/telegram"

  # 선택: 바인딩할 Swarm 참조 (생략 시 Bundle 내 첫 번째 Swarm)
  swarmRef: "Swarm/default"

  # 선택: Connector 프로세스에 전달할 시크릿
  # 서명 검증 시크릿도 여기 포함 (권장 이름: SIGNING_SECRET, WEBHOOK_SECRET)
  secrets:
    BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
    PORT:
      valueFrom:
        env: TELEGRAM_WEBHOOK_PORT
    SIGNING_SECRET:
      valueFrom:
        env: TELEGRAM_WEBHOOK_SECRET

  # 선택: Ingress 라우팅 규칙
  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: command
        route: {}  # entryAgent로 라우팅
```

### 3.2 ConnectionSpec TypeScript 인터페이스

```typescript
/**
 * Connection 리소스 스펙
 */
interface ConnectionSpec {
  /** 바인딩할 Connector 참조 (필수) */
  connectorRef: ObjectRefLike;

  /** 바인딩할 Swarm 참조 (선택, 생략 시 Bundle 내 첫 번째 Swarm) */
  swarmRef?: ObjectRefLike;

  /** Connector 프로세스에 전달할 시크릿 (서명 검증 시크릿 포함) */
  secrets?: Record<string, ValueSource>;

  /** Ingress 라우팅 규칙 */
  ingress?: IngressConfig;
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
  /** 대상 Agent (선택, 생략 시 Swarm entryAgent로 라우팅) */
  agentRef?: ObjectRefLike;
}

/**
 * Connection 리소스 타입
 */
type ConnectionResource = Resource<ConnectionSpec>;
```

---

## 4. connectorRef

### 4.1 역할

`connectorRef`는 이 Connection이 바인딩하는 Connector 리소스를 참조한다. Connection은 반드시 하나의 Connector를 참조해야 한다(MUST).

### 4.2 지원 형식

`ObjectRefLike` 타입으로, 문자열 축약 형식과 객체형 참조를 모두 지원한다.

```yaml
# 문자열 축약 형식
connectorRef: "Connector/telegram"

# 객체형 참조
connectorRef: { kind: Connector, name: telegram }
```

### 4.3 규칙

1. `connectorRef`는 필수 필드이다(MUST).
2. 참조하는 Connector 리소스가 동일 Bundle 내에 존재해야 한다(MUST).
3. 참조된 Connector가 존재하지 않으면 검증 단계에서 오류로 처리한다(MUST).

---

## 5. swarmRef

### 5.1 역할

`swarmRef`는 이 Connection이 바인딩하는 Swarm 리소스를 참조한다.

### 5.2 지원 형식

```yaml
# 문자열 축약 형식
swarmRef: "Swarm/default"

# 객체형 참조
swarmRef: { kind: Swarm, name: default }
```

### 5.3 규칙

1. `swarmRef`는 선택 필드이다(MAY).
2. 생략 시 Orchestrator는 Bundle 내 첫 번째(또는 유일한) Swarm을 사용한다(MUST).
3. 지정된 경우, 참조하는 Swarm 리소스가 동일 Bundle 내에 존재해야 한다(MUST).
4. `ingress.rules[].route.agentRef`가 지정된 경우, 해당 Agent가 `swarmRef`가 가리키는 Swarm의 `agents` 배열에 포함되어야 한다(SHOULD).

---

## 6. Secrets

### 6.1 역할

`secrets`는 Connector 프로세스에 전달할 비밀값을 정의한다. Connector의 `ConnectorContext.secrets`에 key-value 형태로 전달된다.

### 6.2 YAML 예시

```yaml
secrets:
  BOT_TOKEN:
    valueFrom:
      env: TELEGRAM_BOT_TOKEN
  PORT:
    value: "3000"
  SIGNING_SECRET:
    valueFrom:
      env: TELEGRAM_WEBHOOK_SECRET
```

### 6.3 ValueSource 패턴

`ValueSource`, `ValueFrom`, `SecretRef` 타입 원형은 `docs/specs/shared-types.md`를 따른다.

Connection 문맥에서 추가 적용되는 규칙:

1. `value`와 `valueFrom`은 동시에 존재할 수 없다(MUST).
2. `valueFrom.env`와 `valueFrom.secretRef`는 동시에 존재할 수 없다(MUST).
3. `secretRef.ref`는 `Secret/<name>` 형식을 따라야 한다(MUST).
4. `secrets`에 정의된 값은 Connector 프로세스의 `ctx.secrets`에 해석된 문자열로 전달되어야 한다(MUST).
5. `valueFrom.env` 해석은 `docs/specs/help.md` 3.2 정책을 따른다(MUST).

### 6.4 권장 시크릿 이름

서명 검증 시크릿은 다음 이름을 권장한다(SHOULD):

- `SIGNING_SECRET`: 일반적인 서명 검증 시크릿
- `WEBHOOK_SECRET`: 웹훅 전용 서명 시크릿

Connector는 `ctx.secrets`에서 이 이름으로 시크릿을 읽어 자체적으로 서명 검증을 수행한다.

---

## 7. Ingress 라우팅 규칙

### 7.1 Match 조건

`match` 블록은 ConnectorEvent의 `name`과 `properties`를 기반으로 필터링한다.

```yaml
ingress:
  rules:
    - match:
        event: app_mention              # ConnectorEvent.name과 매칭
        properties:                     # ConnectorEvent.properties와 매칭 (선택)
          channel_id: "C123456"
      route:
        agentRef: "Agent/planner"
```

`match`가 생략되면 모든 이벤트가 해당 규칙으로 라우팅된다.

규칙:

1. `match.event`와 `match.properties` 내 여러 조건이 지정되면 AND 조건으로 해석한다(MUST).
2. `match`가 생략되면 catch-all 규칙으로 동작한다(MUST).
3. 규칙 배열은 순서대로 평가하며, 첫 번째 매칭되는 규칙이 적용된다(MUST).
4. `match.event`는 Connector의 `events[].name`에 선언된 이벤트 이름과 일치해야 한다(SHOULD).

### 7.2 Route 설정

```yaml
route:
  agentRef: "Agent/planner"   # 선택
```

규칙:

1. `agentRef`가 지정되면 해당 Agent로 직접 라우팅한다(MUST).
2. `agentRef`가 생략되면 Swarm의 `entryAgent`로 라우팅한다(MUST).
3. `agentRef`가 지정된 경우, 해당 Agent가 Swarm의 `agents` 배열에 포함되어야 한다(SHOULD).

---

## 8. Runtime 동작 규칙

### 8.1 독립 Turn 처리

하나의 이벤트가 여러 ConnectorEvent를 emit하면 각 event는 독립 Turn으로 처리되어야 한다(MUST). 각 Turn은 고유한 `traceId`를 가지며, 서로 다른 Agent에 전달될 수 있다.

### 8.2 instanceKey 기반 라우팅

ConnectorEvent의 `instanceKey`는 Orchestrator가 AgentProcess를 매핑하는 데 사용한다. 동일한 `instanceKey`를 가진 이벤트는 동일한 AgentProcess로 라우팅되어 대화 컨텍스트가 유지된다.

---

## 9. 예시

### 9.1 CLI Connection (가장 단순한 구성)

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: cli
spec:
  entry: "./connectors/cli/index.ts"
  events:
    - name: user_input

---

apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: "Connector/cli"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route: {}  # entryAgent로 라우팅
```

### 9.2 Telegram Connection

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-production
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/coding-swarm"

  secrets:
    BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
    PORT:
      value: "3000"
    SIGNING_SECRET:
      valueFrom:
        env: TELEGRAM_WEBHOOK_SECRET

  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/coder"
      - match:
          event: command
        route: {}  # entryAgent로 라우팅
```

### 9.3 Slack Connection

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: slack-main
spec:
  connectorRef: "Connector/slack"
  swarmRef: "Swarm/default"

  secrets:
    BOT_TOKEN:
      valueFrom:
        env: SLACK_BOT_TOKEN
    PORT:
      value: "3001"
    SIGNING_SECRET:
      valueFrom:
        env: SLACK_SIGNING_SECRET

  ingress:
    rules:
      - match:
          event: app_mention
        route:
          agentRef: "Agent/planner"
      - match:
          event: message_im
        route: {}  # entryAgent로 라우팅
```

### 9.4 동일 Connector에 여러 Connection 바인딩

```yaml
# 개발팀 Connection
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: slack-dev-team
spec:
  connectorRef: "Connector/slack"
  swarmRef: "Swarm/dev-swarm"
  secrets:
    BOT_TOKEN:
      valueFrom:
        env: SLACK_DEV_BOT_TOKEN
    PORT:
      value: "3002"
  ingress:
    rules:
      - match:
          event: app_mention
          properties:
            channel_id: "C-DEV-CHANNEL"
        route:
          agentRef: "Agent/dev-agent"

---

# 운영팀 Connection
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: slack-ops-team
spec:
  connectorRef: "Connector/slack"
  swarmRef: "Swarm/ops-swarm"
  secrets:
    BOT_TOKEN:
      valueFrom:
        env: SLACK_OPS_BOT_TOKEN
    PORT:
      value: "3003"
  ingress:
    rules:
      - match:
          event: app_mention
          properties:
            channel_id: "C-OPS-CHANNEL"
        route:
          agentRef: "Agent/ops-agent"
```

---

## 11. Validation 규칙 요약

| 항목 | 규칙 | 수준 |
|------|------|------|
| `spec.connectorRef` | 필수. 유효한 Connector 참조 | MUST |
| `spec.swarmRef` | 선택. 유효한 Swarm 참조 | MAY |
| `spec.secrets` | 선택. 각 값은 유효한 ValueSource (서명 시크릿 포함) | MAY |
| `spec.ingress.rules` | 선택. 있으면 배열 형식 | MAY |
| `spec.ingress.rules[].route` | 필수 | MUST |
| `spec.ingress.rules[].match.event` | Connector의 events[].name에 선언된 이름 | SHOULD |
| `spec.ingress.rules[].route.agentRef` | 유효한 Agent 참조 (선택) | SHOULD |

### 추가 검증 규칙

1. `connectorRef`가 참조하는 Connector 리소스가 Bundle 내에 존재해야 한다(MUST).
2. `swarmRef`가 지정된 경우, 참조하는 Swarm 리소스가 Bundle 내에 존재해야 한다(MUST).
3. `swarmRef`가 생략된 경우, Orchestrator는 Bundle 내 첫 번째(또는 유일한) Swarm을 사용한다(MUST).
4. `ingress.rules[].route.agentRef`가 지정된 경우, 해당 Agent가 `swarmRef`가 가리키는 Swarm의 `agents` 배열에 포함되어야 한다(SHOULD).
5. 하나의 ConnectorEvent가 emit되면 독립 Turn으로 처리되어야 한다(MUST).
6. OAuth 인증이 필요한 경우 Extension 내부에서 구현해야 한다. Connection은 OAuth를 직접 관리하지 않는다(MUST NOT).

---

## 12. 관련 문서

- `docs/specs/connector.md` - Connector 시스템 스펙 (프로토콜 구현, Entry Function)
- `docs/specs/resources.md` - Config Plane 리소스 정의 스펙 (ObjectRef, ValueSource)
- `docs/specs/runtime.md` - Runtime 실행 모델 스펙 (Orchestrator, AgentProcess)
- `docs/architecture.md` - 아키텍처 개요 (핵심 개념, 설계 패턴)

---

**문서 버전**: v2.0
**최종 수정**: 2026-02-12
