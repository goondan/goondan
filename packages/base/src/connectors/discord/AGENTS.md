# Discord Connector

Discord Bot API를 통해 메시지를 수신하고 응답을 전송하는 Connector 구현.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (ingress/egress 규칙, 인증 설정)
- `index.ts` - Trigger Handler 구현 (`onDiscordMessage`)

## 주요 기능

### Trigger Handler: `onDiscordMessage`
- Discord Gateway의 `MESSAGE_CREATE` 이벤트를 처리
- 봇 메시지는 무한 루프 방지를 위해 무시 (author.bot === true)
- 빈 메시지 내용도 무시

### auth.subjects 설정 규칙
- `global`: `discord:guild:{guildId}` 또는 `discord:dm:{channelId}` - 서버/DM 단위 토큰 조회용
- `user`: `discord:user:{userId}` - 사용자 단위 토큰 조회용

### instanceKey 생성 규칙
- 서버 내 채널: `discord:{guildId}:{channelId}`
- DM 채널: `discord:dm:{channelId}`

### Egress 헬퍼 함수
- `sendMessage()` - Discord 채널에 메시지 전송
- `editMessage()` - 기존 메시지 수정
- `getErrorMessage()` - API 에러 코드 해석

## 수정 시 참고사항

1. Discord API v10 사용: https://discord.com/developers/docs
2. 새로운 이벤트 타입 지원 시 `connector.yaml`의 ingress 규칙 추가 필요
3. Bot Token은 `Bot` 접두사와 함께 사용 (Authorization: `Bot {token}`)
4. 타입 정의 변경 시 `DiscordMessagePayload`, `DiscordMessageData` 인터페이스 업데이트

## 관련 스펙

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/oauth.md` - OAuth 시스템 스펙
