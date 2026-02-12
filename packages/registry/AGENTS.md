# packages/registry

`@goondan/registry`는 Goondan 패키지 유통을 위한 Registry 구현체 묶음이다.

## 책임 범위

- Package 메타데이터/버전/tarball 조회 API 제공
- publish/unpublish/deprecate 쓰기 API 제공
- Bearer 토큰 인증, access(public/restricted), integrity/dist-tags 관리
- `src/`: Node 런타임 파일시스템 기반 서버/클라이언트 유틸 제공
- `cloudflare/`: Cloudflare Worker(KV + R2) 배포 경로 제공

## 작업 규칙

1. 구현은 `docs/specs/bundle_package.md`, `docs/specs/help.md`의 레지스트리 계약을 따른다.
2. 테스트는 `test/`에서 API 라우팅, 인증, 라이프사이클(publish/get/unpublish/deprecate)을 검증한다.
3. 타입 단언(`as`, `as unknown as`) 없이 타입 가드와 명시 타입으로 구현한다.
4. 저장 포맷 변경 시 `src/types.ts`와 테스트 케이스를 함께 갱신한다.
