# OAuth 스펙 (v2.0)

이 문서는 OAuth 적용 범위를 정의한다.
OAuth는 독립 리소스가 아니라 Extension/Connection 조합으로 구현한다.

---

## 1. 상태

- 단일 기준: `docs/specs/extension.md` (Extension 내부 구현 패턴)

---

## 2. 구현 원칙

1. OAuth 플로우는 Extension 내부에서 직접 구현한다(MUST).
2. 토큰 상태 저장은 `api.state.get()`/`api.state.set()`를 사용한다(MUST).
3. 클라이언트 시크릿 등 민감값은 Connection의 `secrets` 경로로 주입한다(SHOULD).

---

## 관련 문서

- `docs/specs/extension.md` - Extension 시스템 스펙
- `docs/specs/connection.md` - Connection 시크릿/라우팅 스펙
- `docs/specs/help.md` - 공통 계약/문서 소유권
