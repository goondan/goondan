# packages/base

기본 확장(Extension/Connector/Tool) 묶음 패키지입니다.

## 디렉터리
- src/extensions: base 확장 모음 (skill, compaction)
- src/connectors: 기본 커넥터 (slack, cli)
- src/tools: 기본 도구 (slack, tool-search, file-read)
- tests: base 단위 테스트

## 참고 사항
- core와의 인터페이스는 spec_config.md 기준으로 유지합니다.
- bundle.yaml은 base 확장 묶음 등록용 매니페스트입니다.
