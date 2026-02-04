# 작업 보고서

## 2026-02-04

- 작업: spec_main 문서 구조 재정리(14/15 통합, 16/17/18 본문 통합, 불필요한 분할 파일 삭제, 번호 정렬)
- 작업: 전 마크다운 파일의 파일 링크를 멘션(@파일명) 형식으로 변경
- 작업: Bundle 개념을 YAML+코드로 명확화하고, 기존 Bundle을 Bundle Package로 재명명 (GUIDE/spec 반영)
- 작업: GUIDE 핵심 개념에 Bundle/SwarmBundle/Bundle Package 상위 개념 추가
- 작업: MCPServer를 Extension 패턴으로 전환하고 관련 문서를 Extension 예시로 정리(spec_main/spec_bundle/GUIDE 반영)
- 작업: 워크스페이스 모델에서 SwarmBundleRoot(정의)와 Instance/System State Root(상태) 분리 (spec/GUIDE 반영)
- 작업: CLI/Runtime 기본 stateRootDir를 `~/.goondan`로 전환 + `GOONDAN_STATE_ROOT` 지원 + workspaceId 스코핑 적용
- 작업: 인스턴스 상태 경로를 런타임이 단일하게 결정하도록 통일(설정 파일에서 state 경로 오버라이드 금지)
- 작업: SwarmInstance/AgentInstance별 event 로그(`events.jsonl`) append-only 기록 구현
- 작업: 문서 내 `goondan_spec.md`, `docs/spec_config.md` 레퍼런스 제거(현행 스펙 문서로 이관)
- goondan_spec.md: 파일 없음(legacy). docs/requirements/index.md로 레퍼런스 이관
- docs/spec_config.md: 파일 없음(legacy). docs/requirements/06_config-spec.md + docs/spec_bundle.md로 레퍼런스 이관
