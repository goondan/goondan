# Discord Connector (v1.0)

Discord Bot API의 MESSAGE_CREATE 이벤트를 처리하여 ConnectorEvent로 변환하는 Connector 구현.
단일 default export 패턴을 따릅니다.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (triggers, events 선언)
- `index.ts` - 단일 default export Entry Function

## 주요 기능

### Entry Function (default export)

- `discordConnector(context: ConnectorContext)` - Discord Webhook 처리
  - `event.type === 'connector.trigger'` 확인
  - `event.trigger` 타입 가드: `isHttpTrigger()`로 HTTP trigger 확인
  - `trigger.payload.request.body`에서 Discord 이벤트 파싱
  - 봇 메시지 무시 (author.bot === true, 무한 루프 방지)
  - 빈 메시지 내용 무시
  - `emit()` 호출로 ConnectorEvent 발행

### ConnectorEvent 발행

- `name: 'discord.message'`
- `message: { type: 'text', text }`
- `properties: { channelId, guildId, userId, username, messageId, timestamp }`
- `auth.subjects`:
  - `global`: `discord:guild:{guildId}` 또는 `discord:dm:{channelId}` (DM)
  - `user`: `discord:user:{userId}`
- `auth.actor.name`: `global_name` 우선, 없으면 `username`

### 서명 검증

- `context.verify.webhook.signingSecret`이 설정된 경우 Discord 서명(`x-signature-ed25519`, `x-signature-timestamp`)을 검증
- 검증 실패 시 `emit()`을 중단

## connector.yaml 구조

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: discord
spec:
  runtime: node
  entry: "./connectors/discord/index.js"
  triggers:
    - type: http
      endpoint:
        path: /discord/interactions
        method: POST
  events:
    - name: discord.message
      properties:
        channelId: { type: string }
        guildId: { type: string }
        userId: { type: string }
        username: { type: string }
        messageId: { type: string }
        timestamp: { type: string }
```

## 타입 import

- `ConnectorContext`, `ConnectorEvent`, `HttpTriggerPayload` from `@goondan/core`

## 수정 시 참고사항

1. Discord API v10 사용: https://discord.com/developers/docs
2. 인증(Bot Token)/라우팅 설정은 Connection 리소스에 정의
3. Bot Token은 `Bot` 접두사와 함께 사용 (Authorization: `Bot {token}`)

## 관련 스펙

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/connection.md` - Connection 시스템 스펙
