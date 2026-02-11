# docs/specs

Goondan 구현 스펙 문서 폴더입니다. 요구사항 문서(docs/requirements)를 기반으로 실제 구현에 필요한 상세 스펙을 정의합니다.

## 파일 구조

- `api.md` - Runtime/SDK API 스펙 v2.0 (ExtensionApi, ToolHandler/ToolContext, ConnectorContext, ConnectionSpec, Orchestrator/AgentProcess/IPC API)
- `resources.md` - Config Plane 리소스 정의 스펙 v2.0 (apiVersion: goondan.ai/v1, 8종 Kind, ObjectRef "Kind/name", Selector+Overrides, ValueSource, Kind별 스키마)
- `bundle.md` - Bundle YAML 스펙 v2.0 (goondan.yaml 구조, 8종 Kind, 로딩/검증 규칙, YAML 보안, 경로 해석)
- `bundle_package.md` - Package 스펙 v2.0 (프로젝트 매니페스트, ~/.goondan/packages/, 레지스트리 API, 의존성 해석, CLI 명령어)
- `runtime.md` - **[v2.0]** Runtime 실행 모델 스펙 (Orchestrator 상주 프로세스, Process-per-Agent, IPC 메시지 브로커, Turn/Step, Message 이벤트 소싱, Edit & Restart, Observability)
- `changeset.md` - Edit & Restart 리다이렉트 (v2에서 Changeset 시스템 제거, runtime.md 참조)
- `connector.md` - Connector 시스템 스펙 v2.0 (별도 Bun 프로세스, 자체 프로토콜 관리, ConnectorEvent 발행)
- `connection.md` - Connection 시스템 스펙 v2.0 (secrets 기반 시크릿 전달, Ingress 라우팅 규칙, 서명 검증 시크릿)
- `extension.md` - Extension 시스템 스펙 v2.0 (ExtensionApi 단순화: pipeline/tools/state/events/logger, Middleware 파이프라인, Skill/ToolSearch/Compaction/Logging/MCP 패턴)
- `oauth.md` - OAuth 스펙 v2.0 (OAuthApp Kind 제거, Extension 내부 구현으로 이동)
- `pipeline.md` - 라이프사이클 파이프라인 스펙 v2.0 (Middleware Only: turn/step/toolCall 3종, Onion 모델, ConversationState 이벤트 소싱, PipelineRegistry, 제거된 Mutator/13포인트/Reconcile)
- `tool.md` - Tool 시스템 스펙 v2.0 (더블 언더스코어 네이밍, ToolContext 축소, IPC Handoff, Bun-only)
- `workspace.md` - **[v2.0]** Workspace 및 Storage 모델 스펙 (2루트 분리: Project Root + System Root, Message 영속화, Extension state, 프로세스별 로깅)
- `cli.md` - **[v2.0]** CLI 도구(gdn) 스펙 (run: Orchestrator 상주 프로세스, restart: 재시작 신호, validate, instance list/delete, package add/install/publish, doctor)

## 문서 작성 규칙

1. **버전 표기**: 각 스펙 문서 제목에 버전을 명시합니다 (예: `v2.0`).
2. **요구사항 참조**: 해당 스펙이 기반하는 요구사항 문서를 명시합니다.
3. **TypeScript 인터페이스**: 구현에 사용할 TypeScript 타입/인터페이스를 정의합니다.
4. **YAML 예시**: 리소스 정의 예시를 포함합니다.
5. **규칙 명시**: MUST/SHOULD/MAY 규범적 표현으로 요구 수준을 명확히 합니다.

## 수정 시 주의사항

1. **요구사항 일치**: 스펙은 `docs/requirements/*.md`의 요구사항과 일치해야 합니다.
2. **GUIDE.md 동기화**: 스펙 변경 시 `/GUIDE.md` 반영 여부를 검토합니다.
3. **구현 검증**: 스펙 변경 후 `packages/core` 구현이 스펙을 준수하는지 확인합니다.
4. **메시지 모델 정합성**: Runtime/Workspace/Pipeline/Extension/API 스펙에서 Turn 메시지 처리 규칙은 `NextMessages = BaseMessages + SUM(Events)` 및 `messages/base.jsonl`/`messages/events.jsonl` 구조와 일치해야 합니다.
5. **v2 핵심 변경 사항**:
   - `apiVersion`: `goondan.ai/v1` (기존 `agents.example.io/v1alpha1` 대체)
   - `runtime` 필드: 모든 Kind에서 제거 (항상 Bun)
   - Tool 이름: `__` 더블 언더스코어 구분자 (`{리소스명}__{export명}`)
   - Connector: 별도 Bun 프로세스, triggers 필드 제거, 자체 프로토콜 관리
   - Connection: `auth` 필드 제거 → `secrets` 필드로 대체, OAuth는 Extension 내부 구현
   - Changeset: 제거 → Edit & Restart 모델 (runtime.md 참조)
   - OAuth: OAuthApp Kind 제거 → Extension 내부 구현
   - Pipeline: Mutator 제거 → Middleware 통합 (turn/step/toolCall 3종)

## 관련 문서

- `/docs/requirements/index.md` - 요구사항 메인 문서
- `/docs/new_spec.md` - v2 통합 스펙 원본
- `/GUIDE.md` - 개발자 가이드
- `/CLAUDE.md` - 프로젝트 개요 및 작업 규칙
