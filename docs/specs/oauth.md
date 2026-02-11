# OAuth 스펙 v2.0

> v2에서 OAuthApp Kind가 제거되었습니다.

OAuth 기능은 Extension 내부 구현으로 이동했습니다. 필요한 Extension이 자체적으로 OAuth 플로우를 관리합니다.

## 제거된 개념

- OAuthApp Kind (1급 리소스)
- OAuthStore (시스템 레벨 토큰 관리)
- PKCE 플로우 내장 지원
- Token 자동 갱신

## v2 접근 방식

Extension이 필요한 OAuth 처리를 직접 구현:
- Token 저장: `api.state.get()`/`api.state.set()` 활용
- OAuth 라이브러리: Extension 코드에서 직접 사용
- Secrets: Connection의 `secrets` 필드를 통해 client_id/secret 전달
