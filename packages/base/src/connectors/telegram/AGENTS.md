# Telegram Connector (v1.0)

Telegram Bot API Webhook을 통해 메시지를 수신하고 ConnectorEvent로 변환하는 Connector 구현.
단일 default export 패턴을 따릅니다.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (triggers, events 선언)
- `index.ts` - 단일 default export Entry Function

## 주요 기능

### Entry Function (default export)

- `telegramConnector(context: ConnectorContext)` - Telegram Webhook 업데이트 처리
  - `event.type === 'connector.trigger'` 확인
  - `event.trigger` 타입 가드: `isHttpTrigger()`로 HTTP trigger 확인
  - `trigger.payload.request.body`에서 Telegram Update 파싱
  - `message` 또는 `edited_message` 처리
  - 봇 명령어 파싱 (/start, /help 등, @botname 제거)
  - `emit()` 호출로 ConnectorEvent 발행

### ConnectorEvent 발행

- `name: 'telegram.message'`
- `message: { type: 'text', text }`
- `properties: { chatId, userId, chatType, messageId }`
- `auth.subjects`:
  - `global`: `telegram:chat:{chatId}`
  - `user`: `telegram:user:{userId}`

### 서명 검증

- `context.verify.webhook.signingSecret`이 설정된 경우 Telegram secret token 헤더(`x-telegram-bot-api-secret-token`)를 검증
- 검증 실패 시 `emit()`을 중단

## connector.yaml 구조

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: telegram
spec:
  runtime: node
  entry: "./connectors/telegram/index.js"
  triggers:
    - type: http
      endpoint:
        path: /telegram/webhook
        method: POST
  events:
    - name: telegram.message
      properties:
        chatId: { type: string }
        userId: { type: string }
        chatType: { type: string }
        messageId: { type: number }
```

## 타입 import

- `ConnectorContext`, `ConnectorEvent`, `HttpTriggerPayload` from `@goondan/core`

## 수정 시 참고사항

1. Telegram Bot API 명세 참고: https://core.telegram.org/bots/api
2. 인증(Bot Token)/라우팅 설정은 Connection 리소스에 정의
3. 봇 명령어 파싱은 connector 내부에서 처리 (properties.command)

## 관련 스펙

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/connection.md` - Connection 시스템 스펙
