# Constitution of the Job

1. 반드시 루트와 작업하려는 서비스의 AGENTS.md 파일을 먼저 읽을 것
2. 파일을 편집 하거나 주요한 레퍼런스로 읽을 때에는 해당 파일이 존재하는 폴더부터 최상위 서비스까지의 AGENTS.md 파일을 먼저 읽을 것
3. 아키텍처상 주요한 폴더를 나누게 되면 나눈 폴더에 AGENTS.md 파일을 생성하고, 해당 아키텍처에서 그 폴더의 파일들이 어떤 역할을 하는지와 그 폴더의 파일들을 읽거나 수정할 때에 참고해야 하는 사항들을 작성해 둘것
4. 파일을 수정한 뒤, 파일의 디렉토리 트리를 따라 루트까지의 모든 AGENTS.md 파일에 대해, AGENTS.md 파일이 항상 최신 내용을 유지할 수 있도록 업데이트 할 것

# Goondan(군단) : Agent Swarm Orchestrator

> "Kubernetes for Agent Swarm"

## 주요 파일 목록
- @goondan_spec.md : 스펙 문서
- @TODO.md : 작업 체크리스트 (수행 후 체크 표시)
- @docs/spec_config.md : Config 스펙 구체화 문서
- package.json : pnpm 워크스페이스 루트
- pnpm-workspace.yaml : 워크스페이스 설정
- packages/core/src/* : 오케스트레이터 런타임/Config/LiveConfig
- packages/base/src/* : 기본 Extension/Connector/Tool 묶음

## 작업 규칙
- TODO.md에 있는 항목을 수행한 뒤 체크 표시를 갱신할 것
- 모든 요구사항은 goondan_spec.md 수정 필요 여부와 docs/spec_config.md 수정 필요 여부를 반드시 검토하고 기록할 것
