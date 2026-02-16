# packages/registry

`@goondan/registry`는 Goondan 패키지 유통을 위한 Registry 구현체 묶음이다.

## 책임 범위

- Package 메타데이터/버전/tarball 조회 API 제공
- publish/unpublish/deprecate/deletePackage 쓰기 API 제공
- 중복 버전 publish 방어 (409 PKG_VERSION_EXISTS)
- Bearer 토큰 인증, access(public/restricted), integrity/dist-tags 관리
- `src/`: Node 런타임 파일시스템 기반 서버/클라이언트 유틸 제공
- `cloudflare/`: Cloudflare Worker(KV + R2) 배포 경로 제공
- 기본 운영 엔드포인트: `https://goondan-registry.yechanny.workers.dev`

## 소스 구성

- `src/server.ts`: HTTP 요청 핸들러 (Request → Response), Node HTTP 서버 래퍼
- `src/client.ts`: RegistryClient 클래스 (getMetadata/getVersion/getTarball/publish/unpublish/deprecate/deletePackage)
- `src/storage.ts`: FileRegistryStore (파일시스템 기반 메타데이터/tarball 저장)
- `src/validators.ts`: 타입 가드 및 페이로드 파서 (isRegistryPackageMetadata, parsePublishPayload 등)
- `src/config.ts`: 레지스트리 설정 해석 (옵션 > env > config > default 우선순위)
- `src/types.ts`: 타입 정의 (RegistryPackageMetadata, RegistryPublishPayload 등)
- `src/package-name.ts`: scoped 패키지명 파싱/경로 빌드
- `src/semver.ts`: semver 파싱/비교 유틸

## 작업 규칙

1. 구현은 `docs/specs/bundle_package.md`, `docs/specs/help.md`의 레지스트리 계약을 따른다.
2. 테스트는 `test/`에서 API 라우팅, 인증, 라이프사이클(publish/get/unpublish/deprecate/delete), 중복 방어를 검증한다.
3. 타입 단언(`as`, `as unknown as`) 없이 타입 가드와 명시 타입으로 구현한다.
4. 저장 포맷 변경 시 `src/types.ts`와 테스트 케이스를 함께 갱신한다.
5. Cloudflare 배포 경로에서는 `REGISTRY_AUTH_TOKENS` 시크릿 로테이션 절차와 publish smoke test 결과를 함께 관리한다.
