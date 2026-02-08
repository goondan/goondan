# Slack Connector (v1.0)

Slack Events API 이벤트를 처리하여 ConnectorEvent로 변환하는 Connector 구현.
단일 default export 패턴을 따릅니다.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (triggers, events 선언)
- `index.ts` - 단일 default export Entry Function

## 주요 기능

### Entry Function (default export)

- `slackConnector(context: ConnectorContext)` - Slack HTTP webhook 처리
  - `event.type === 'connector.trigger'` 확인
  - `event.trigger` 타입 가드: `isHttpTrigger()`로 HTTP trigger 확인
  - `trigger.payload.request.body`에서 Slack 페이로드 파싱
  - URL verification 요청 로깅 (웹 서버에서 직접 응답 필요)
  - 봇 메시지 무시 (무한 루프 방지)
  - `emit()` 호출로 ConnectorEvent 발행

### ConnectorEvent 발행

- `name: 'slack.message'`
- `message: { type: 'text', text }`
- `properties: { channelId, userId, teamId, threadTs, eventType }`
- `auth.subjects`:
  - `global`: `slack:team:{teamId}` - 워크스페이스 단위 토큰 조회용
  - `user`: `slack:user:{teamId}:{userId}` - 사용자 단위 토큰 조회용

### 서명 검증

- `context.verify.webhook.signingSecret`이 설정된 경우 Slack HMAC-SHA256 서명(`x-slack-signature`)을 검증
- 검증 실패 시 `emit()`을 중단

## connector.yaml 구조

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  runtime: node
  entry: "./connectors/slack/index.js"
  triggers:
    - type: http
      endpoint:
        path: /slack/events
        method: POST
  events:
    - name: slack.message
      properties:
        channelId: { type: string }
        userId: { type: string }
        teamId: { type: string }
        threadTs: { type: string }
        eventType: { type: string }
```

## 타입 import

- `ConnectorContext`, `ConnectorEvent`, `HttpTriggerPayload` from `@goondan/core`

## 수정 시 참고사항

1. Slack Events API 명세 참고: https://api.slack.com/apis/events-api
2. 인증/라우팅/서명 검증 설정은 Connection 리소스에 정의
3. 타입 정의 변경 시 로컬 인터페이스 업데이트

## 관련 스펙

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/connection.md` - Connection 시스템 스펙
