# Security Tests

보안 감사에서 발견된 취약점에 대한 테스트 모음입니다.

## 테스트 파일

- `input-validation.test.ts` - 입력 검증 보안 테스트
  - SecretsStore 경로 순회(path traversal) 방지
  - YAML 파싱 보안 (크기 제한, 문서 수 제한, prototype pollution)
  - ObjectRef 검증

## 관련 수정 사항

- `workspace/secrets.ts` - 모든 public 메서드에 `validateSecretName` 적용
- `bundle/parser.ts` - YAML 입력 크기 제한 (1MB), 문서 수 제한 (100개)
- `oauth/store.ts` - OAuth ID에 경로 순회 방지 검증 추가
