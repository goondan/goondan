# docs/wiki

Goondan 사용자 관점 위키 문서 폴더입니다. Diataxis 4분할 구조(tutorials / how-to / explanation / reference)로 구성됩니다.

## 파일 구조

- `README.md` - 위키 개요 + 독자별 진입점 (EN)
- `README.ko.md` - 위키 개요 + 독자별 진입점 (KO)
- `WIKI_PLAN.md` - 위키 전체 계획 문서
- `tutorials/` - 단계별 따라하기 (학습 목적)
  - `01-getting-started.md` / `01-getting-started.ko.md` - 시작하기 튜토리얼: Bun/CLI 설치, gdn init 프로젝트 생성, goondan.yaml 구조 이해(Package/Model/Agent/Swarm), .env 환경 변수 설정(Anthropic/OpenAI/Google), gdn validate 검증, gdn run --foreground 실행, CLI 대화, gdn doctor 환경 진단, 다음 단계 안내(Tool/Extension/외부 채널) (EN/KO)
  - `02-build-your-first-tool.md` / `02-build-your-first-tool.ko.md` - 첫 Tool 만들기 튜토리얼: Tool 설계(export/JSON Schema), YAML 리소스 정의(kind: Tool/metadata.name/spec.entry/spec.exports), 더블 언더스코어 네이밍 규칙({리소스}__{export}), 핸들러 모듈 구현(handlers export/ToolHandler 시그니처), ToolContext 활용(workdir/logger/toolCallId/message), Agent spec.tools 등록(ref 문자열 축약형/크로스 패키지), gdn validate 검증(엔트리 경로/export 고유성/핸들러 매칭), gdn run 실행 및 테스트, 오류 처리 개선(suggestion/helpUrl/errorMessageLimit), 전체 예제(string-utils Tool) (EN/KO)
  - `03-build-your-first-extension.md` / `03-build-your-first-extension.ko.md` - 첫 Extension 만들기 튜토리얼: Extension 설계(conversation-stats 대화 로깅), YAML 리소스 정의(kind: Extension/spec.entry), register(api) 엔트리 구현, turn 미들웨어 작성(전처리/next()/후처리 onion 패턴), state API 활용(api.state.get/set으로 통계 영속 저장), Agent.spec.extensions 등록(ref 형식/순서=미들웨어 레이어링), gdn validate 검증 및 gdn run 실행, step 미들웨어 추가(LLM 호출 타이밍/toolCatalog), toolCall 미들웨어 추가(도구별 로깅/args), 중첩 실행 구조(turn>step>toolCall), 상태 영속화 확인, 다음 단계 안내(동적 도구/이벤트 소싱/Connector) (EN/KO)
- `how-to/` - 특정 문제 해결 실용 가이드
  - `run-a-swarm.md` / `run-a-swarm.ko.md` - Swarm 실행/관리: gdn init 프로젝트 초기화, .env/.env.local 환경 변수 설정, gdn validate 검증, gdn run 실행(watch 모드/foreground/단일 입력), gdn restart 재기동, gdn instance(list/TUI/restart/delete) 인스턴스 관리, gdn logs 로그 확인, gdn doctor 환경 진단, 트러블슈팅 가이드 (EN/KO)
  - `use-builtin-tools.md` / `use-builtin-tools.ko.md` - 내장 Tool 활용: @goondan/base 의존성 추가, Agent spec.tools 참조 방법(객체 ref/package), 9종 Tool별(bash/file-system/http-fetch/json-query/text-transform/agents/self-restart/telegram/slack) 활용 예제, Telegram/Slack Connector 연동 Connection 설정, 멀티 Tool 에이전트 전체 goondan.yaml 예제 (EN/KO)
  - `write-a-tool.md` / `write-a-tool.ko.md` - Tool 작성 체크리스트: Tool YAML 리소스 정의, JSON Schema 파라미터 모범 사례, ToolHandler 구현 패턴(handlers export/ctx/input), ToolContext 활용(workdir/logger/runtime), 오류 처리 패턴(suggestion/helpUrl/errorMessageLimit), Agent spec.tools 등록, gdn validate 검증, 단위/통합/E2E 테스트 전략, 프로덕션 체크리스트 (EN/KO)
  - `write-an-extension.md` / `write-an-extension.ko.md` - Extension 작성 체크리스트: Extension YAML 리소스 정의(kind: Extension/spec.entry), register(api) 엔트리 패턴 구현, ExtensionApi 5개 영역 활용법(pipeline/tools/state/events/logger), turn/step/toolCall 3종 미들웨어 작성법, ConversationState 이벤트 소싱 활용(emitMessageEvent), 동적 도구 등록(api.tools.register), 이벤트 발행/구독(api.events.emit/on), Agent.spec.extensions 등록, gdn validate 검증, 단위/통합 테스트 전략, 리소스 정리/에러 처리, 완성 예제(usage-tracker) (EN/KO)
  - `write-a-connector.md` / `write-a-connector.ko.md` - Connector 작성 가이드: Connector YAML 리소스 정의(kind: Connector/spec.entry/spec.events), 엔트리 모듈 구현(단일 default export), ConnectorContext 활용(emit/config/secrets/logger), ConnectorEvent 발행 패턴(name/message/properties/instanceKey), Connection 리소스로 바인딩(connectorRef/swarmRef/config/secrets/ingress), 서명 검증 구현, Ingress 라우팅 규칙, 우아한 종료 처리(SIGINT/SIGTERM), 비HTTP 패턴(폴링/cron), 검증 및 실행(gdn validate/run) (EN/KO)
  - `multi-agent-patterns.md` / `multi-agent-patterns.ko.md` - 멀티 에이전트 패턴: agents 도구 설정, request(동기 요청-응답) 패턴, send(비동기 fire-and-forget) 패턴, spawn(인스턴스 준비) 패턴, list/catalog로 에이전트 발견, Coordinator+Specialist 실전 시나리오(brain-persona 샘플), instanceKey 공유/격리 전략, 자동 스폰 동작, request vs send 선택 기준 (EN/KO)
- `explanation/` - 핵심 개념 이해
  - `core-concepts.md` / `core-concepts.ko.md` - 8종 리소스 Kind, ObjectRef, instanceKey, Bundle, Package, 선언형 구성 모델 (EN/KO)
  - `tool-system.md` / `tool-system.ko.md` - Tool 시스템 심층 이해: 더블 언더스코어 네이밍 규칙, ToolHandler/ToolContext 계약, AgentProcess 내 실행 흐름, Registry vs Catalog, 오류 처리, 내장 Tool, Extension toolCall 미들웨어 관계 (EN/KO)
  - `extension-pipeline.md` / `extension-pipeline.ko.md` - Extension & Pipeline 아키텍처: Onion 모델, turn/step/toolCall 3종 미들웨어, ConversationState 이벤트 소싱, ExtensionApi 5개 영역, register(api) 패턴, 실전 패턴(Skill/Compaction/Logging/MCP) (EN/KO)
  - `runtime-model.md` / `runtime-model.ko.md` - 런타임 실행 모델 이해: Orchestrator 상주 프로세스, Process-per-Agent 크래시 격리, IPC 3종 메시지(event/shutdown/shutdown_ack), 통합 이벤트 모델(AgentEvent/replyTo), ProcessStatus 7종, Reconciliation Loop(K8s 유사 자가 치유), Graceful Shutdown Protocol, Turn/Step 실행 모델, 메시지 이벤트 소싱(base+events), Edit & Restart, Connector/Connection 프로세스 (EN/KO)
- `reference/` - API/스키마/CLI 정보 조회
  - `resources.md` / `resources.ko.md` - 8종 리소스 Kind YAML 스키마 레퍼런스: 공통 리소스 구조(apiVersion/kind/metadata/spec), ObjectRef 참조 패턴(문자열 축약/객체형/RefItem), ValueSource(literal/env/secretRef), Model/Agent/Swarm/Tool/Extension/Connector/Connection/Package Kind별 스키마와 필드 테이블, 검증 규칙 요약 (EN/KO)
  - `builtin-tools.md` / `builtin-tools.ko.md` - 내장 Tool 카탈로그: @goondan/base 패키지의 9종 Tool(bash/file-system/http-fetch/json-query/text-transform/agents/self-restart/telegram/slack) 파라미터 테이블, 반환값 구조, 더블 언더스코어 네이밍 실제 이름, YAML 사용 예제 (EN/KO)
  - `tool-api.md` / `tool-api.ko.md` - Tool API 레퍼런스: ToolHandler 시그니처, ToolContext(workdir/logger/runtime) 프로퍼티, AgentToolRuntime(request/send/spawn/list/catalog) 메서드, ToolCallResult 구조, ToolExportSpec/JSON Schema 파라미터 정의, 최소 Tool 구현 예제 (EN/KO)
  - `extension-api.md` / `extension-api.ko.md` - Extension API 레퍼런스: register(api) 엔트리 패턴, ExtensionApi 5개 영역(pipeline/tools/state/events/logger), PipelineRegistry 인터페이스, TurnMiddleware/StepMiddleware/ToolCallMiddleware 시그니처 및 컨텍스트 필드, ExtensionToolsApi 동적 도구 등록, ExtensionStateApi 영속 상태 관리, ExtensionEventsApi 이벤트 버스, 표준 런타임 이벤트 목록, Onion 실행 모델 다이어그램, 보조 타입(ConversationState/MessageEvent/Message/ExecutionContext) (EN/KO)
  - `connector-api.md` / `connector-api.ko.md` - Connector API 레퍼런스: Connector 리소스 스키마(entry/events), ConnectorEntryFunction default export 패턴, ConnectorContext(emit/config/secrets/logger), ConnectorEvent(name/message/properties/instanceKey), ConnectorEventMessage 3종(text/image/file), 서명 검증 권장 절차, Connection 리소스 스키마(connectorRef/swarmRef/config/secrets/ingress), IngressRule match/route 패턴, instanceKey 오버라이드, 이벤트 흐름 다이어그램 (EN/KO)
  - `cli-reference.md` / `cli-reference.ko.md` - CLI(gdn) 명령어 레퍼런스: 전역 옵션, gdn init(템플릿/생성 파일), gdn run(옵션/동작 방식/환경 변수 로딩/watch 모드), gdn restart, gdn validate(검증 항목/출력 형식), gdn instance(TUI/list/restart/delete), gdn logs, gdn package(add/install/publish), gdn doctor(검사 항목), 종료 코드, 설정 파일/우선순위 (EN/KO)

## 작성 규칙

1. **언어 쌍**: 모든 문서는 `.md`(EN) + `.ko.md`(KO) 쌍으로 작성
2. **상대 경로 링크**: 교차 참조는 상대 경로 사용 (예: `./tutorials/01-getting-started.md`)
3. **스펙 비복사**: `docs/specs/*.md` 내용을 그대로 복사하지 말고, 사용자 관점으로 요약 후 상세는 스펙으로 링크
4. **스키마 일치**: 예제는 `docs/specs/resources.md`에 정의된 YAML 스키마와 일치해야 함
5. **기능 미발명**: 스펙에 없는 기능을 위키에서 발명하거나 추가 설명하지 않음

## 수정 시 주의사항

1. EN/KO 파일을 항상 동시에 수정하여 내용 동기화 유지
2. 새 문서 추가 시 `README.md`와 `README.ko.md`의 목록을 함께 갱신
3. `docs/specs/*.md` 내용 변경 또는 삭제 금지
4. `GUIDE.md` 삭제 또는 병합 금지

## 관련 문서

- `/GUIDE.md` - 빠른 시작 가이드 (처음 사용자용)
- `/docs/architecture.md` - 아키텍처 개요
- `/docs/specs/` - 구현 스펙 (SSOT)
- `/docs/specs/AGENTS.md` - 스펙 폴더 안내
