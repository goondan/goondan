# src

Goondan 오케스트레이터의 실행 코드가 모이는 최상위 소스 폴더입니다.

## 폴더 역할
- config: YAML 기반 Config Plane 로더/레지스트리
- connectors: Connector 런타임 통합
- live-config: LiveConfigManager 및 patch log/cursor 관리
- mcp: MCPServer 런타임 통합
- runtime: Swarm/Agent 인스턴스, Turn/Step 실행 루프, 파이프라인
- extensions: Extension 로더
- tools: Tool 레지스트리
- bundles: Bundle 로더/등록
- cli: core CLI 엔트리
- sdk: SDK 타입 정의
- utils: 공통 유틸리티
- runtime/llm: LLM 어댑터 구현

## 참고 사항
- 런타임 흐름 변경은 runtime 하위에서 수행합니다.
- Live Config 관련 변경은 live-config 하위에서만 수행합니다.
- 변경 사항에 맞는 테스트를 항상 작성/보완하고, 작업 완료 시 빌드 및 테스트를 반드시 실행합니다.
- LLM 메시지 누적/로그는 runtime 하위에서 관리합니다.
