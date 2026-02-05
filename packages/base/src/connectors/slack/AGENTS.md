# Slack Connector

Slack Events API 이벤트를 처리하여 Swarm으로 라우팅하는 Connector 구현.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (ingress/egress 규칙, 인증 설정)
- `index.ts` - Trigger Handler 구현 (`onSlackEvent`)

## 주요 기능

### Trigger Handler: `onSlackEvent`
- Slack Events API의 `event_callback` 이벤트를 처리
- URL verification 요청은 로깅만 수행 (웹 서버에서 직접 응답 필요)
- 봇 메시지는 무한 루프 방지를 위해 무시

### auth.subjects 설정 규칙
- `global`: `slack:team:{teamId}` - 워크스페이스 단위 토큰 조회용 (subjectMode=global)
- `user`: `slack:user:{teamId}:{userId}` - 사용자 단위 토큰 조회용 (subjectMode=user)

### Egress 헬퍼 함수
- `postMessage()` - 메시지 전송
- `updateMessage()` - 메시지 업데이트
- `getErrorMessage()` - API 에러 코드 해석

## 수정 시 참고사항

1. Slack Events API 명세 참고: https://api.slack.com/apis/events-api
2. 새로운 이벤트 타입 지원 시 `connector.yaml`의 ingress 규칙 추가 필요
3. OAuth 토큰은 `ctx.oauth.getAccessToken()`으로 획득 (OAuthApp 참조 필요)
4. 타입 정의 변경 시 `SlackEventPayload`, `SlackEvent` 인터페이스 업데이트

## 관련 스펙

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/oauth.md` - OAuth 시스템 스펙
