# src/runtime

Runtime Plane의 Turn/Step 실행 루프와 파이프라인을 구현합니다.

## 주요 파일
- runtime.ts: 전체 런타임 엔트리 (Swarm 인스턴스 생성/이벤트 처리)
- swarm-instance.ts: SwarmInstance 관리
- agent-instance.ts: AgentInstance 큐 및 Turn/Step 실행
- pipelines.ts: 파이프라인 Mutator/Wrapper
- hooks.ts: 간단한 expr 처리 및 hook 입력 해석
- oauth.ts: OAuthManager 구현
- oauth-store.ts: OAuth 토큰/세션 암호화 저장소
- llm/ai-sdk.ts: AI SDK v6 어댑터

## 참고 사항
- Step 시작 시 LiveConfigManager를 통해 Effective Config를 고정합니다.
- toolCall/llmCall 파이프라인은 wrapper 기반 onion 구조를 사용합니다.
- OAuth 암호화 키는 `GOONDAN_DATA_SECRET_KEY`로만 로드합니다.
- 등록되지 않은 Connector 어댑터는 ingress/egress가 있을 때만 경고합니다.
- CLI origin은 첫 LLM 호출 시 진행 메시지를 한 번 출력합니다.
- channel이 없는 Connector(예: cli)는 emitFinal/emitProgress에서 바로 send를 호출합니다.
- 변경 사항에 맞는 테스트를 항상 작성/보완하고, 작업 완료 시 빌드 및 테스트를 반드시 실행합니다.
