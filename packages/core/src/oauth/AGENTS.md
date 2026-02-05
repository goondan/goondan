# OAuth 시스템

OAuth 시스템은 Tool/Connector가 외부 API를 호출할 때 필요한 OAuth 토큰을 관리합니다.

## 스펙 문서
- `/docs/specs/oauth.md` - OAuth 시스템 전체 스펙

## 디렉토리 구조

```
oauth/
├── types.ts          # OAuth 관련 타입 정의
├── api.ts            # OAuthManager 구현 (getAccessToken)
├── store.ts          # OAuthStore (토큰/세션 파일 저장소)
├── pkce.ts           # PKCE 생성/검증 (S256 방식)
├── authorization.ts  # Authorization Code 플로우 (state, URL 생성)
├── token.ts          # Token 관리 (유효성 판단, RefreshManager)
├── subject.ts        # Subject 결정 로직
├── index.ts          # 모든 기능 re-export
└── AGENTS.md         # 이 파일
```

## 주요 인터페이스

### OAuthApi
```typescript
interface OAuthApi {
  getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
}
```

### OAuthTokenResult (유니온 타입)
- `status: 'ready'` - 토큰이 준비됨
- `status: 'authorization_required'` - 사용자 승인 필요
- `status: 'error'` - 오류 발생

### OAuthStore
Grant와 Session을 파일 시스템에 저장/조회하는 저장소입니다.

## 핵심 규칙

1. **PKCE는 S256 방식 필수** - RFC 7636 준수
2. **Subject 결정**
   - `subjectMode=global`: `turn.auth.subjects.global` 사용
   - `subjectMode=user`: `turn.auth.subjects.user` 사용
3. **단일 작성자 규칙** - OAuthManager만 OAuthStore에 쓰기 가능
4. **At-rest encryption** - 토큰/비밀값은 암호화하여 저장
5. **타입 단언 금지** - `as` 대신 타입 가드 사용

## 테스트 실행
```bash
cd packages/core
npx vitest run __tests__/oauth/
```

## 의존성
- `types/` 모듈의 ObjectRef, ValueSource 타입
- `types/specs/oauth-app.ts`의 OAuthAppSpec 타입
