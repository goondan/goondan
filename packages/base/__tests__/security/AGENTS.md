# Security Tests (Base Package)

기본 도구의 보안 검증 테스트입니다.

## 테스트 파일

- `http-fetch-security.test.ts` - HTTP Fetch Tool URL 검증 테스트
  - SSRF 방지: file://, ftp://, data:, javascript: 프로토콜 차단
  - http://, https: 프로토콜만 허용
  - 잘못된 URL 입력 거부

## 관련 수정 사항

- `tools/http-fetch/index.ts` - `validateUrl()` 함수 추가 (프로토콜 화이트리스트)
