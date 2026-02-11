# docs/requirements

Goondan 요구사항 스펙 문서 폴더입니다.

## 파일 구조

- `index.md` - 메인 스펙 요약 및 인덱스 (§0~§16)
- `05_core-concepts.md` - 핵심 개념 (§5)
- `06_config-spec.md` - Config 스펙 (§6)
- `07_config-resources.md` - Config 리소스 정의 (§7)
- `08_packaging.md` - Config 구성 단위와 패키징 (§8)
- `09_runtime-model.md` - Runtime 실행 모델 (§9): Orchestrator 상주 프로세스, Process-per-Agent, IPC, Turn/Step, 메시지 이벤트 소싱, Edit & Restart
- `10_workspace-model.md` - 워크스페이스 모델 (§10): 2-root 구조 (Project Root + System Root ~/.goondan/), Instance State, 메시지 영속화
- `11_lifecycle-pipelines.md` - 라이프사이클 파이프라인 (§11): Middleware only, 3종 미들웨어 (turn/step/toolCall), 온니언 모델
- `12_tool-spec-runtime.md` - Tool 스펙(런타임 관점) (§12): Registry/Catalog, 이름 규칙(`__` 더블 언더스코어), ToolContext(workdir 포함), Handoff(IPC 기반)
- `13_extension-interface.md` - Extension 실행 인터페이스 (§13): ExtensionApi(pipeline/tools/state/events/logger), 3 미들웨어 컨텍스트, ConversationState, MessageEvent
- `14_usage-patterns.md` - 활용 예시 패턴 (§14): Skill(step 미들웨어), ToolSearch(toolCatalog 조작), Compaction(emitMessageEvent), Handoff(IPC 기반)
- `15_usage-scenarios.md` - 예상 사용 시나리오 (§15): Slack, Edit & Restart, Watch 모드, ToolSearch, 재시작, 크래시 복원
- `16_expected-outcomes.md` - 기대 효과 (§16): 프로세스 격리, Bun 성능, 미들웨어 단순화, Edit & Restart, 이벤트 소싱, 2-root 등
- `appendix_a_diagram.md` - 실행 모델 및 미들웨어 다이어그램: Orchestrator/AgentProcess/ConnectorProcess 구조, 3-Layer 미들웨어, 메시지 이벤트 소싱
- `_improve-claude.md` - 요구사항 개선 리뷰 보고서(Claude 작성)
- `_improve-codex.md` - 요구사항 개선 리뷰 보고서(Codex 작성)

## v2 주요 변경사항

- **apiVersion**: `goondan.ai/v1` (기존 `agents.example.io/v1alpha1`에서 변경)
- **Kind**: 8종으로 축소 (Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package). OAuthApp/ResourceType/ExtensionHandler 제거
- **Bun-native**: `runtime` 필드 제거, 항상 Bun으로 실행
- **Process-per-Agent**: 각 AgentInstance는 독립 Bun 프로세스, Orchestrator가 상주 프로세스로 관리
- **Middleware 통일**: Mutator 제거, 3종 미들웨어(turn/step/toolCall)로 통합
- **Message**: AI SDK CoreMessage를 `data` 필드로 래핑. MessageEvent 타입: append/replace/remove/truncate
- **Tool 이름**: `__` 더블 언더스코어 구분 (예: `bash__exec`)
- **Connector**: 자체 프로세스로 프로토콜 직접 관리. `triggers` 필드 제거
- **Edit & Restart**: Changeset/SwarmBundleRef/Safe Point 제거. 파일 수정 후 Orchestrator 재시작

## 수정 시 주의사항

1. **섹션 번호 유지**: 각 분할 파일의 섹션 번호(§)는 `index.md`와 일치해야 합니다.
2. **내부 참조 형식**: 분할 파일 간 참조는 `@XX_파일명.md` 형식을 사용합니다.
3. **RFC 2119 규범**: MUST/SHOULD/MAY 표현은 규범적 의미로 사용합니다.
4. **연관 문서 동기화**: 요구사항 수정 시 `docs/specs/*.md`, `/GUIDE.md` 반영 필요 여부를 검토하고 기록합니다.
5. **구현 검증**: 요구사항 변경 후 `packages/core`, `packages/cli`, `packages/base` 구현 정합성을 확인합니다.
6. **품질 점검**: 섹션 번호 누락, 깨진 참조, 오래된 apiVersion 표기 불일치를 점검합니다.
7. **메시지 상태 모델 일관성**: Turn 메시지 규칙은 `NextMessages = BaseMessages + SUM(Events)`를 기준으로 유지하며, `base.jsonl`/`events.jsonl` 저장 규칙과 함께 검토합니다.
8. **v2 정합성**: 제거된 개념(Changeset, SwarmBundleRef, Safe Point, OAuthApp, ResourceType, Mutator, triggers)이 문서에 남아있지 않은지 확인합니다.

## 참고

- 기존 `spec_main.md` 및 `spec_main_*.md` 파일들이 이 폴더로 이동되었습니다.
