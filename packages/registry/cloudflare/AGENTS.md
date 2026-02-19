# packages/registry/cloudflare

`packages/registry/cloudflare`는 Goondan Registry의 Cloudflare Workers 운영 배포 경로를 담당한다.

## 존재 이유

- 전역 접근 가능한 레지스트리 운영 경로를 제공한다.
- 로컬 레지스트리 구현과 동일한 계약을 서버리스 환경에서 유지한다.

## 구조적 결정

1. 라우팅/검증 로직과 Worker 바인딩 연결을 분리한다.
이유: 테스트 가능성과 배포 환경 독립성을 높이기 위해.
2. 메타데이터와 아티팩트 저장소를 분리(KV/R2)한다.
이유: 조회 패턴과 바이너리 저장 특성이 다르기 때문이다.

## 불변 규칙

- 인증 토큰은 `REGISTRY_AUTH_TOKENS` 시크릿으로 관리하고 로테이션 후 publish smoke test를 수행한다.
- API 의미론(인증/접근 제어/버전 처리)은 `packages/registry`와 동일하게 유지한다.
- 버전 정책은 루트 `@goondan/*` 동기화 규칙을 따른다.

## 참조

- `packages/registry/AGENTS.md`
- `docs/specs/bundle_package.md`
- `docs/specs/help.md`
