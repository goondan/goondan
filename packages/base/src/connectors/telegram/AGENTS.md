# Telegram Connector (v1.0)

Telegram Bot API를 통해 메시지를 수신하고 ConnectorEvent로 변환하는 Connector 구현.
두 가지 trigger 모드를 지원합니다: HTTP Webhook (push)과 Custom (long polling, pull).
단일 default export 패턴을 따릅니다.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (triggers, events 선언)
- `index.ts` - 단일 default export Entry Function

## 주요 기능

### Entry Function (default export)

- `telegramConnector(context: ConnectorContext)` - Telegram 업데이트 처리
  - `event.type === 'connector.trigger'` 확인
  - **HTTP Webhook 모드**: `isHttpTrigger()`로 분기 → `handleWebhookTrigger()` 호출
  - **Custom (롱 폴링) 모드**: `isCustomTrigger()`로 분기 → `handleCustomTrigger()` 호출
    - `getUpdates` API를 사용한 long polling 루프
    - `AbortSignal`로 graceful shutdown 지원
    - 에러 발생 시 5초 backoff 후 재시도
  - 공통 처리: `processUpdate()` → `message` 또는 `edited_message` 파싱 → `emit()` 호출
  - 봇 명령어 파싱 (/start, /help 등, @botname 제거)

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
    - type: custom       # Long polling (pull) 모드
    - type: http          # Webhook (push) 모드
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

- `ConnectorContext`, `ConnectorEvent`, `HttpTriggerPayload`, `CustomTriggerPayload` from `@goondan/core`

## 수정 시 참고사항

1. Telegram Bot API 명세 참고: https://core.telegram.org/bots/api
2. 인증(Bot Token)/라우팅 설정은 Connection 리소스에 정의
3. 봇 명령어 파싱은 connector 내부에서 처리 (properties.command)

## 관련 스펙

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/connection.md` - Connection 시스템 스펙
