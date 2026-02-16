# packages/registry/cloudflare

`packages/registry/cloudflare`는 Cloudflare Workers 환경에서 동작하는 Goondan Registry 구현 경로입니다.

## 책임 범위

- Worker `fetch` 핸들러 기반 Registry API(`GET/PUT/DELETE`) 라우팅 구현
- 메타데이터 저장소(KV) + tarball 저장소(R2) 연결
- Bearer 인증, access(public/restricted), dist-tags, integrity 생성 규칙 유지
- wrangler 배포 예시 설정 제공 (`wrangler.toml.example`)
- 실제 배포는 `pnpx wrangler` 명령(`kv namespace create`, `r2 bucket create`, `secret put`, `deploy`) 기반으로 수행
- 운영 레지스트리 URL: `https://goondan-registry.yechanny.workers.dev`

## 작업 규칙

1. `src/router.ts`는 API 계약/검증/응답을 담당하고 `src/worker.ts`는 바인딩 연결만 담당한다.
2. 타입 단언(`as`, `as unknown as`) 없이 타입 가드와 명시적 타입으로 구현한다.
3. 테스트는 `test/`에서 순수 함수(crypto/route/handler 로직) 중심으로 검증한다.
4. 저장 포맷을 바꾸면 관련 타입(`src/types.ts`)과 테스트를 함께 갱신한다.
5. 인증 토큰 로테이션은 `REGISTRY_AUTH_TOKENS` 시크릿으로 관리하며, 갱신 후 publish smoke test를 수행한다.
