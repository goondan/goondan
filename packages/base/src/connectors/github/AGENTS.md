# GitHub Connector (v1.0)

GitHub Webhook 이벤트를 처리하여 ConnectorEvent로 변환하는 Connector 구현.
단일 default export 패턴을 따릅니다.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (triggers, events 선언)
- `index.ts` - 단일 default export Entry Function

## 주요 기능

### Entry Function (default export)

- `githubConnector(context: ConnectorContext)` - GitHub Webhook 처리
  - `event.type === 'connector.trigger'` 확인
  - `event.trigger` 타입 가드: `isHttpTrigger()`로 HTTP trigger 확인
  - `trigger.payload.request.body`에서 GitHub 페이로드 파싱
  - `trigger.payload.request.headers`의 `x-github-event`로 이벤트 타입 결정
  - 봇 이벤트 무시 (sender.type === 'Bot', 무한 루프 방지)
  - `emit()` 호출로 ConnectorEvent 발행

### 이벤트 타입 해석

- `resolveEventType(headers, payload)`: X-GitHub-Event 헤더 우선, 없으면 payload 구조에서 추론
- 지원 이벤트: `issues`, `pull_request`, `push`, `issue_comment`

### ConnectorEvent 발행

- `name`: `github.{eventType}` (예: `github.issues`, `github.pull_request`)
- `message: { type: 'text', text }` - `buildInput()`으로 이벤트별 포맷된 텍스트
- `properties`: 기본 `{ repository, action? }`, `github.push`는 `{ repository, ref, action? }` (`ref` 필수)
- `auth.subjects`:
  - `global`: `github:repo:{owner}/{repo}`
  - `user`: `github:user:{userId}`

지원되지 않는 이벤트(`issues`, `issue_comment`, `pull_request`, `push` 외)는 emit하지 않습니다.

### 서명 검증

- `context.verify.webhook.signingSecret`이 설정된 경우 GitHub HMAC-SHA256 서명(`x-hub-signature-256`)을 검증
- 검증 실패 시 `emit()`을 중단

## connector.yaml 구조

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: github
spec:
  runtime: node
  entry: "./connectors/github/index.js"
  triggers:
    - type: http
      endpoint:
        path: /github/webhook
        method: POST
  events:
    - name: github.push
      properties:
        repository: { type: string }
        ref: { type: string }
        action: { type: string, optional: true }
    - name: github.pull_request
      properties:
        repository: { type: string }
        action: { type: string, optional: true }
    - name: github.issues
      properties:
        repository: { type: string }
        action: { type: string, optional: true }
    - name: github.issue_comment
      properties:
        repository: { type: string }
        action: { type: string, optional: true }
```

## 타입 import

- `ConnectorContext`, `ConnectorEvent`, `HttpTriggerPayload` from `@goondan/core`

## 수정 시 참고사항

1. GitHub Webhook 명세: https://docs.github.com/en/webhooks
2. 인증/라우팅/서명 검증 설정은 Connection 리소스에 정의
3. 새 이벤트 타입 추가 시 `resolveEventType()`, `buildInput()` 함수 확장

## 관련 스펙

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/connection.md` - Connection 시스템 스펙
