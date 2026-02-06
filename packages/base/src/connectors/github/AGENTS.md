# GitHub Connector

GitHub Webhook 이벤트를 처리하여 Swarm으로 라우팅하는 Connector 구현.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (ingress/egress 규칙, 인증 설정)
- `index.ts` - Trigger Handler 구현 (`onGitHubEvent`)

## 주요 기능

### Trigger Handler: `onGitHubEvent`
- GitHub Webhook의 다양한 이벤트를 처리:
  - `issues` - Issue 생성/수정/닫기
  - `pull_request` - PR 생성/수정/닫기
  - `issue_comment` - Issue/PR 코멘트
  - `push` - 코드 푸시
- 봇 이벤트(sender.type === 'Bot')는 무한 루프 방지를 위해 무시

### auth.subjects 설정 규칙
- `global`: `github:repo:{owner}/{repo}` - 리포지토리 단위 토큰 조회용
- `user`: `github:user:{userId}` - 사용자 단위 토큰 조회용

### instanceKey 생성 규칙
- Issue: `github:{owner/repo}:issue:{number}`
- PR: `github:{owner/repo}:pr:{number}`
- Push: `github:{owner/repo}:push:{ref}`

### 이벤트 타입 해석
- `metadata.githubEvent`에 X-GitHub-Event 헤더 값이 있으면 사용
- 없으면 payload 구조에서 이벤트 타입 추론 (pull_request, issue, push 등)

### Egress 헬퍼 함수
- `createIssueComment()` - Issue/PR에 코멘트 작성
- `createPRReview()` - PR 리뷰 작성 (APPROVE, REQUEST_CHANGES, COMMENT)

## 수정 시 참고사항

1. GitHub Webhook 명세: https://docs.github.com/en/webhooks
2. GitHub REST API v3: https://docs.github.com/en/rest
3. 새로운 이벤트 타입 지원 시 `resolveEventType()`, `buildInput()`, `buildInstanceKey()` 함수 확장
4. `match.channel` 필드는 `repository.full_name`으로 매칭

## 관련 스펙

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/oauth.md` - OAuth 시스템 스펙
