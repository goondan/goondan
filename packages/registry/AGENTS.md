# Goondan Registry - Cloudflare Workers

이 폴더는 Goondan Bundle Package를 호스팅하는 패키지 레지스트리 서버입니다.

## 아키텍처

- **Cloudflare Workers**: 엣지에서 실행되는 서버리스 런타임
- **Cloudflare R2**: tarball 파일 저장 (S3 호환 오브젝트 스토리지)
- **Cloudflare KV**: 패키지 메타데이터 저장 (키-값 저장소)

## 파일 구조

```
packages/registry/
  src/
    index.ts       # Worker 메인 엔트리 (라우터, 핸들러, 유틸리티)
  wrangler.toml    # Cloudflare Workers 설정 (바인딩, 환경변수)
  tsconfig.json    # TypeScript 설정
  package.json     # 패키지 설정
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/` | 레지스트리 정보 |
| GET | `/<scope>/<name>` | 패키지 메타데이터 조회 |
| GET | `/<scope>/<name>/<version>` | 특정 버전 메타데이터 조회 |
| GET | `/<scope>/<name>/-/<name>-<version>.tgz` | Tarball 다운로드 |
| PUT | `/<scope>/<name>` | 패키지 퍼블리시 (Bearer 인증 필요) |
| DELETE | `/<scope>/<name>` | 패키지 전체 삭제 (Bearer 인증 필요) |
| DELETE | `/<scope>/<name>/<version>` | 특정 버전 삭제 (Bearer 인증 필요) |

## 개발 가이드

### 로컬 개발

```bash
cd packages/registry
pnpm install
pnpm dev  # http://localhost:8787 에서 실행
```

### 배포

```bash
# 시크릿 설정 (최초 1회)
wrangler secret put ADMIN_TOKEN

# 배포
pnpm deploy
```

### 환경변수

- `ADMIN_TOKEN`: 패키지 퍼블리시/삭제에 사용되는 관리자 토큰 (시크릿)
- `REGISTRY_URL`: 레지스트리 기본 URL (tarball URL 생성에 사용)

## 참고 문서

- 스펙: `/docs/specs/bundle_package.md` 섹션 4.2 (레지스트리 API)
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare KV: https://developers.cloudflare.com/kv/

## 주의사항

1. **타입 단언 금지**: `as`, `as unknown as` 사용 금지. 타입 가드로 해결
2. **integrity 검증 필수**: 퍼블리시 시 sha512 integrity hash 검증
3. **CORS 지원**: 모든 응답에 CORS 헤더 포함
4. **에러 처리**: 적절한 HTTP 상태 코드와 에러 메시지 반환
