# packages/base

기본 확장(Extension/Connector/Tool) 묶음 패키지입니다.

## 디렉터리
- src/extensions: base 확장 모음 (skill, compaction)
- src/connectors: 기본 커넥터 (slack, cli)
- src/tools: 기본 도구 (slack, tool-search, file-read)
- scripts: dist 빌드/복사용 스크립트
- tests: base 단위 테스트

## 참고 사항
- core와의 인터페이스는 docs/requirements/06_config-spec.md 및 docs/spec_bundle.md 기준으로 유지합니다.
- bundle.yaml은 base 번들 매니페스트이며 spec.include는 dist 하위 YAML을 참조합니다.
- dist는 Git에 커밋하며, build 스크립트는 dist 재생성을 담당합니다.
- npm 배포 시 bundle.yaml, dist만 files에 포함합니다.
- publishConfig(access=public) 및 prepublishOnly(build)를 유지합니다.
