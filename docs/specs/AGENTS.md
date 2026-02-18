# docs/specs

Goondan 스펙 문서 폴더입니다. 각 문서는 설계 동기/핵심 규칙/구현 상세를 통합한 **유일한 source of truth**입니다.

## 파일 구조

- `api.md` - Runtime/SDK API 스펙 v0.0.3 (ExtensionApi, ToolHandler/ToolContext, ConnectorContext, ConnectionSpec, Orchestrator/AgentProcess/IPC API, `turn`/`step` 미들웨어 `ctx.agents` API, 통합 이벤트 모델, Runtime Events API 표면)
- `help.md` - 스펙 운영 도움말 v0.0.3 (문서 소유권 매트릭스, 공통 계약, 레지스트리 설정 우선순위, 기본 레지스트리 `https://goondan-registry.yechanny.workers.dev`, `gdn package` 도움말 기준, 문서 링크 자동 점검 체크리스트)
- `layers.md` - 구성 계층 역할 개요 v0.0.3 (`runtime`, `types`, `base`, `cli`, `registry`의 추상 역할, 관계 모델, 책임 경계)
- `shared-types.md` - 공통 타입 스펙 v0.0.3 (Json/ObjectRef/ValueSource/MessageEvent/AgentEvent/EventEnvelope/ExecutionContext/ProcessStatus/IpcMessage/TurnResult/ToolCallResult/AgentToolRuntime(request/send/spawn/list/catalog) SSOT)
- `resources.md` - Config Plane 리소스 정의 스펙 v0.0.3 (설계 철학/핵심 규칙 통합, apiVersion: goondan.ai/v1, 8종 Kind, ObjectRef "Kind/name", ValueSource, Kind별 스키마, SwarmPolicy.shutdown, 검증 오류 형식)
- `bundle.md` - Bundle YAML 스펙 v0.0.3 (설계 철학/핵심 규칙 통합, goondan.yaml 구조, 8종 Kind, 로딩/검증 규칙, Config 참조 모델(ObjectRef/ValueSource) 사용 문맥, YAML 보안, 경로 해석, 분할 파일 구성)
- `bundle_package.md` - Package 스펙 v0.0.3 (설계 철학/핵심 규칙 통합, 프로젝트 매니페스트, ~/.goondan/packages/, 레지스트리 API, 의존성 해석, values 병합 우선순위, **dist/goondan.yaml 배포 규칙/manifest 우선순위/Package Root 경로 규칙**, 보안/검증 오류 코드, CLI 명령어)
- `runtime.md` - **[v0.0.3]** Runtime 실행 모델 스펙 (배경/설계 동기, 핵심 규칙 통합, Orchestrator 상주 프로세스, Process-per-Agent, IPC 메시지 브로커, Reconciliation Loop, Graceful Shutdown Protocol, Turn/Step, Message 이벤트 소싱, `runtime-events.jsonl` 관측 스트림, Extension `ctx.agents` 경로, request 순환 호출 감지, Edit & Restart, Observability)
- `connector.md` - Connector 시스템 스펙 v0.0.3 (설계 철학/핵심 규칙 통합, 별도 Bun 프로세스, 자체 프로토콜 관리, ConnectorEvent 발행)
- `connection.md` - Connection 시스템 스펙 v0.0.3 (설계 철학/핵심 규칙 통합, config/secrets 분리 전달, Ingress 라우팅 규칙, 서명 검증 시크릿)
- `extension.md` - Extension 시스템 스펙 v0.0.3 (배경/설계 동기, 핵심 규칙 통합, ExtensionApi 단순화: pipeline/tools/state/events/logger, `turn`/`step` 컨텍스트의 `ctx.agents` request/send, Middleware 파이프라인, Skill/ToolSearch/Compaction/Logging/MCP 패턴)
- `oauth.md` - OAuth 범위 문서 (Extension/Connection 조합 구현 원칙)
- `pipeline.md` - 라이프사이클 파이프라인 스펙 v0.0.3 (배경/설계 동기, 핵심 규칙 통합, Middleware Only: turn/step/toolCall 3종, Onion 모델, `turn`/`step`의 `ctx.agents` API, ConversationState 이벤트 소싱, PipelineRegistry)
- `tool.md` - Tool 시스템 스펙 v0.0.3 (설계 철학/핵심 규칙 통합, 더블 언더스코어 네이밍, ToolContext 축소, 통합 이벤트 기반 에이전트 간 통신, AgentProcess 내부 Tool 실행 모델, 입력 스키마 설명/검증 규칙)
- `workspace.md` - **[v0.0.3]** Workspace 및 Storage 모델 스펙 (배경/설계 동기, 핵심 규칙 통합, 2루트 분리: Project Root + System Root, Message 영속화(`base/events/runtime-events`), Extension state, 보안 규칙, 프로세스별 로깅)
- `cli.md` - **[v0.0.3]** CLI 도구(gdn) 스펙 (설계 동기 보강, run: Orchestrator 상주 프로세스, restart: active Orchestrator 재기동, validate, instance list/restart/delete, package add/install/publish, doctor, studio)

## 문서 작성 규칙

1. **버전 표기**: 각 스펙 문서 제목에 버전을 명시합니다 (예: `v0.0.3`).
2. **요구사항 통합**: requirements의 배경/동기/핵심 규칙이 specs에 통합됩니다. specs가 유일한 source of truth입니다. 통합된 문서는 다음 구조를 따릅니다:
   - **1. 개요** (배경/동기/설계 철학)
   - **2. 핵심 규칙** (MUST/SHOULD/MAY 규범적 규칙 요약)
   - **3. 이후** (스펙 상세 내용)
3. **TypeScript 인터페이스**: 구현에 사용할 TypeScript 타입/인터페이스를 정의합니다.
4. **YAML 예시**: 리소스 정의 예시를 포함합니다.
5. **규칙 명시**: MUST/SHOULD/MAY 규범적 표현으로 요구 수준을 명확히 합니다.

## 수정 시 주의사항

1. **아키텍처 일치**: 스펙은 `docs/architecture.md`의 핵심 개념/설계 원칙과 일치해야 합니다.
2. **GUIDE.md 동기화**: 스펙 변경 시 `/GUIDE.md` 반영 여부를 검토합니다.
3. **구현 검증**: 스펙 변경 후 `packages/runtime` 및 `packages/types` 구현이 스펙을 준수하는지 확인합니다.
4. **메시지 모델 정합성**: Runtime/Workspace/Pipeline/Extension/API 스펙에서 Turn 메시지 처리 규칙은 `NextMessages = BaseMessages + SUM(Events)` 및 `messages/base.jsonl`/`messages/events.jsonl` 구조와 일치해야 합니다. `messages/runtime-events.jsonl`은 관측성 스트림으로 분리되어야 합니다.
5. **v0.0.3 핵심 변경 사항**:
   - `apiVersion`: `goondan.ai/v1`
   - 실행 환경: Bun (Tool은 AgentProcess 내부 모듈 로드/핸들러 실행)
   - Tool 이름: `__` 더블 언더스코어 구분자 (`{리소스명}__{export명}`)
   - Runtime Process 상태: `ProcessStatus` 7종(`spawning`, `idle`, `processing`, `draining`, `terminated`, `crashed`, `crashLoopBackOff`)
   - IPC: `event`/`shutdown`/`shutdown_ack` 3종 + `AgentEvent.replyTo` 기반 통합 이벤트 모델
   - 공통 타입 SSOT: `shared-types.md` 기준으로 문서 간 타입 드리프트 방지
   - Connector: 별도 Bun 프로세스, 자체 프로토콜 관리
   - Connection: `config`/`secrets` 분리 전달, OAuth는 Extension 내부 구현
   - 설정 변경 모델: Edit & Restart (runtime.md 참조)
   - Pipeline: Middleware 통합 (turn/step/toolCall 3종)
   - Runtime Event Stream: `runtime-events.jsonl` append-only 기록, 메시지 상태 계산과 분리
   - CLI Studio: `gdn studio` 명령으로 인스턴스 시각화 서버 제공
6. **공통 타입 단일 기준**: 문서 간 공유 타입은 `shared-types.md`를 먼저 갱신하고, 개별 스펙은 링크/참조 중심으로 유지합니다.
7. **도움말 단일 기준**: 공통 운영 규칙(레지스트리 설정, `gdn package` 명령어 매트릭스, env 해석 정책)은 `help.md`를 기준으로 유지합니다.
8. **소유권 기반 작성**: 타입/계약의 소유 문서는 `help.md` 2절 매트릭스를 따르며, 비소유 문서에서의 중복 재정의는 피하고 참조를 우선합니다.
9. **참조 안정성**: 문서 간 참조는 섹션 번호(`§n`)보다 섹션명/앵커 기반 표현을 우선하여 재구성 시 깨짐을 줄입니다.
10. **apiVersion 명시 원칙**: 리소스 문서 예시/규칙에서 `apiVersion` 생략 기본값을 재도입하지 않습니다. 모든 리소스는 `goondan.ai/v1` 명시를 원칙으로 유지합니다.
11. **메시지 상태 책임 분리**: 실행 규칙은 `runtime.md`, 저장 레이아웃은 `workspace.md`를 단일 기준으로 유지하고, 다른 문서는 재정의하지 않습니다.
12. **Package 매트릭스 단일화**: `gdn package` 명령어 표는 `help.md` 단일 기준으로 유지하고, `cli.md`/`bundle_package.md`는 참조 중심으로 작성합니다.
13. **링크 자동 점검**: 문서 변경 시 `help.md` 7절의 자동 점검 체크리스트를 실행하고 결과를 확인합니다.

## 관련 문서

- `/docs/architecture.md` - 아키텍처 개요 (핵심 개념, 다이어그램, 설계 패턴)
- `/docs/specs/help.md` - 스펙 운영 도움말 SSOT
- `/GUIDE.md` - 개발자 가이드
- `/CLAUDE.md` - 프로젝트 개요 및 작업 규칙
