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
- utils: 공통 유틸리티
- runtime/llm: LLM 어댑터 구현

## 참고 사항
- 런타임 흐름 변경은 runtime 하위에서 수행합니다.
- Live Config 관련 변경은 live-config 하위에서만 수행합니다.
