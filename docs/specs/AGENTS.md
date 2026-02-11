# docs/specs

Goondan 스펙 문서 폴더입니다. 각 문서는 설계 동기/핵심 규칙/구현 상세를 통합한 **유일한 source of truth**입니다.

## 파일 구조

- `api.md` - Runtime/SDK API 스펙 v2.0 (ExtensionApi, ToolHandler/ToolContext, ConnectorContext, ConnectionSpec, Orchestrator/AgentProcess/IPC API, 통합 이벤트 모델, ConversationState 규칙)
- `resources.md` - Config Plane 리소스 정의 스펙 v2.0 (설계 철학/핵심 규칙 통합, apiVersion: goondan.ai/v1, 8종 Kind, ObjectRef "Kind/name", Selector+Overrides, ValueSource, Kind별 스키마, SwarmPolicy.shutdown, 검증 오류 형식)
- `bundle.md` - Bundle YAML 스펙 v2.0 (설계 철학/핵심 규칙 통합, goondan.yaml 구조, 8종 Kind, 로딩/검증 규칙, YAML 보안, 경로 해석, 분할 파일 구성)
- `bundle_package.md` - Package 스펙 v2.0 (설계 철학/핵심 규칙 통합, 프로젝트 매니페스트, ~/.goondan/packages/, 레지스트리 API, 의존성 해석, values 병합 우선순위, 보안/검증 오류 코드, CLI 명령어)
- `runtime.md` - **[v2.0]** Runtime 실행 모델 스펙 (배경/설계 동기, 핵심 규칙 통합, Orchestrator 상주 프로세스, Process-per-Agent, IPC 메시지 브로커, Reconciliation Loop, Graceful Shutdown Protocol, Turn/Step, Message 이벤트 소싱, Edit & Restart, Observability)
- `changeset.md` - Edit & Restart 리다이렉트 (v2에서 Changeset 시스템 제거, runtime.md 참조)
- `connector.md` - Connector 시스템 스펙 v2.0 (설계 철학/핵심 규칙 통합, 별도 Bun 프로세스, 자체 프로토콜 관리, ConnectorEvent 발행)
- `connection.md` - Connection 시스템 스펙 v2.0 (설계 철학/핵심 규칙 통합, secrets 기반 시크릿 전달, Ingress 라우팅 규칙, 서명 검증 시크릿)
- `extension.md` - Extension 시스템 스펙 v2.0 (배경/설계 동기, 핵심 규칙 통합, ExtensionApi 단순화: pipeline/tools/state/events/logger, Middleware 파이프라인, Skill/ToolSearch/Compaction/Logging/MCP 패턴)
- `oauth.md` - OAuth 스펙 v2.0 (OAuthApp Kind 제거, Extension 내부 구현으로 이동)
- `pipeline.md` - 라이프사이클 파이프라인 스펙 v2.0 (배경/설계 동기, 핵심 규칙 통합, Middleware Only: turn/step/toolCall 3종, Onion 모델, ConversationState 이벤트 소싱, PipelineRegistry, 제거된 Mutator/13포인트/Reconcile)
- `tool.md` - Tool 시스템 스펙 v2.0 (설계 철학/핵심 규칙 통합, 더블 언더스코어 네이밍, ToolContext 축소, 통합 이벤트 기반 에이전트 간 통신, Bun-only)
- `workspace.md` - **[v2.0]** Workspace 및 Storage 모델 스펙 (배경/설계 동기, 핵심 규칙 통합, 2루트 분리: Project Root + System Root, Message 영속화, Extension state, 보안 규칙, 프로세스별 로깅)
- `cli.md` - **[v2.0]** CLI 도구(gdn) 스펙 (설계 동기 보강, run: Orchestrator 상주 프로세스, restart: 재시작 신호, validate, instance list/delete, package add/install/publish, doctor)

## 문서 작성 규칙

1. **버전 표기**: 각 스펙 문서 제목에 버전을 명시합니다 (예: `v2.0`).
2. **요구사항 통합**: requirements의 배경/동기/핵심 규칙이 specs에 통합됩니다. specs가 유일한 source of truth입니다. 통합된 문서는 다음 구조를 따릅니다:
   - **1. 개요** (배경/동기/설계 철학)
   - **2. 핵심 규칙** (MUST/SHOULD/MAY 규범적 규칙 요약)
   - **3. 이후** (기존 스펙 상세 내용)
3. **TypeScript 인터페이스**: 구현에 사용할 TypeScript 타입/인터페이스를 정의합니다.
4. **YAML 예시**: 리소스 정의 예시를 포함합니다.
5. **규칙 명시**: MUST/SHOULD/MAY 규범적 표현으로 요구 수준을 명확히 합니다.

## 수정 시 주의사항

1. **아키텍처 일치**: 스펙은 `docs/architecture.md`의 핵심 개념/설계 원칙과 일치해야 합니다.
2. **GUIDE.md 동기화**: 스펙 변경 시 `/GUIDE.md` 반영 여부를 검토합니다.
3. **구현 검증**: 스펙 변경 후 `packages/core` 구현이 스펙을 준수하는지 확인합니다.
4. **메시지 모델 정합성**: Runtime/Workspace/Pipeline/Extension/API 스펙에서 Turn 메시지 처리 규칙은 `NextMessages = BaseMessages + SUM(Events)` 및 `messages/base.jsonl`/`messages/events.jsonl` 구조와 일치해야 합니다.
5. **v2 핵심 변경 사항**:
   - `apiVersion`: `goondan.ai/v1` (기존 `agents.example.io/v1alpha1` 대체)
   - `runtime` 필드: 모든 Kind에서 제거 (항상 Bun)
   - Tool 이름: `__` 더블 언더스코어 구분자 (`{리소스명}__{export명}`)
   - Runtime Process 상태: `ProcessStatus` 7종(`spawning`, `idle`, `processing`, `draining`, `terminated`, `crashed`, `crashLoopBackOff`)
   - IPC: `event`/`shutdown`/`shutdown_ack` 3종 + `AgentEvent.replyTo` 기반 통합 이벤트 모델
   - Connector: 별도 Bun 프로세스, triggers 필드 제거, 자체 프로토콜 관리
   - Connection: `auth` 필드 제거 → `secrets` 필드로 대체, OAuth는 Extension 내부 구현
   - Changeset: 제거 → Edit & Restart 모델 (runtime.md 참조)
   - OAuth: OAuthApp Kind 제거 → Extension 내부 구현
   - Pipeline: Mutator 제거 → Middleware 통합 (turn/step/toolCall 3종)

## 관련 문서

- `/docs/architecture.md` - 아키텍처 개요 (핵심 개념, 다이어그램, 설계 패턴)
- `/docs/new_spec.md` - v2 통합 스펙 원본
- `/GUIDE.md` - 개발자 가이드
- `/CLAUDE.md` - 프로젝트 개요 및 작업 규칙
