# Goondan: Agent Swarm Orchestrator 요구사항 v2.0

본 문서는 "멀티 에이전트 오케스트레이션과 컨텍스트 최적화를 중심으로 한 에이전트 스웜"을 선언형 Config Plane(YAML 리소스), Process-per-Agent 실행 모델의 Runtime Plane(Orchestrator 상주 프로세스 + AgentProcess + IPC), 그리고 Edit & Restart 모델(설정 파일 수정 후 Orchestrator가 에이전트 프로세스를 재시작)과 Middleware Pipeline(turn/step/toolCall 3종 미들웨어)으로 구현하기 위한 통합 요구사항을 정의한다.

---

## 0. 규범적 표현

본 문서에서 MUST/SHOULD/MAY는 RFC 2119 스타일의 규범적 의미로 사용된다.

즉, 문장에 사용된 조동사는 "필수/권장/선택"의 구현 요구 수준을 나타내며, 구현체는 이를 기준으로 호환성과 기대 동작을 맞춰야 한다.

또한 예시는 이해를 돕기 위한 것으로, 실제 값/경로/그룹 이름 등은 구현에 따라 달라질 수 있다.

---

## 1. 배경

AI 에이전트 개발은 단일 에이전트의 tool-using loop를 넘어 멀티 에이전트 오케스트레이션, 장기 상태 유지, 외부 시스템 인증 통합, 설정 변경과 에이전트 프로세스 재시작을 함께 다루는 단계로 빠르게 이동하고 있다.

실무 환경에서는 Slack/Telegram/CLI/Webhook 등 다중 채널을 동시에 지원해야 하고, 동일 사용자 맥락과 인증 주체를 장시간 보존해야 한다. 따라서 "모델 호출" 자체보다 프로세스 격리 기반 Instance/Turn/Step 실행 모델, Middleware Pipeline 확장, Tool/Extension 생태계, 보안/관측성 정책이 핵심 아키텍처가 된다.

Goondan v2는 Bun-native 런타임을 기반으로 하며, 각 에이전트를 독립 프로세스로 격리하여 크래시 격리와 독립 스케일링을 보장한다.

---

## 2. 문제의식

### 2.1 에이전트 제작의 복잡성

모델, 프롬프트, 도구를 조합하는 수준을 넘어 멀티 에이전트 라우팅, 상태 보존, 인증, 설정 변경 반영을 코드로 직접 묶으면 복잡성이 빠르게 증가한다.

### 2.2 에이전틱 루프의 라이프사이클 관리 필요

입력 정규화, 컨텍스트 구성, 도구 노출 제어, 실행 후 요약/회고 등은 실행 시점별 미들웨어로 관리되어야 한다.

### 2.3 Stateful long-running 에이전트의 복잡성

Turn 메시지 상태를 메모리 단일 배열로만 관리하면 메시지 단위 편집과 장애 복원 지점을 잃기 쉽다. `NextMessages = BaseMessages + SUM(Events)` 모델, 컨텍스트 윈도우 관리, 인스턴스 수명주기 정책이 없으면 운영 일관성이 깨진다.

### 2.4 다양한 클라이언트 호출의 필요성

채널별 입력 포맷을 canonical event로 통일하고, 인증 주체를 안전하게 Turn에 전달해야 한다.

### 2.5 구성의 텍스트화 필요성

YAML 기반 선언형 구성은 재사용, 검증, 배포 자동화, AI-assisted 변경에 유리하다.

### 2.6 프로세스 격리의 필요성

단일 프로세스에서 모든 에이전트를 실행하면 하나의 에이전트 크래시가 전체 시스템에 영향을 미친다. 에이전트별 독립 프로세스 격리와 Orchestrator를 통한 중앙 관리가 필요하다.

---

## 3. 솔루션 개요

본 솔루션은 다음 세 요소로 구성된다.

1. **Config Plane(YAML 리소스)**
   `goondan.yaml` 및 분할 YAML 파일로 구성된 선언형 리소스 정의. 8종의 Kind(Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)를 포함한다.

2. **Runtime Plane(Orchestrator + AgentProcess + IPC)**
   Orchestrator는 `gdn run`으로 기동되는 상주 프로세스로, AgentProcess와 ConnectorProcess를 스폰/감시/재시작한다. 각 AgentInstance는 독립 Bun 프로세스로 실행되며, 에이전트 간 통신은 Orchestrator를 경유하는 IPC 메시지 패싱으로 이루어진다. Turn/Step 실행은 단일 AgentProcess 내에서 수행된다.

3. **Edit & Restart**
   `goondan.yaml` 또는 개별 리소스 파일을 수정하면 Orchestrator가 설정 변경을 감지(watch 모드)하거나 CLI 명령(`gdn restart`)을 수신하여 해당 에이전트 프로세스를 kill 후 새 설정으로 re-spawn한다. 기존의 Changeset/SwarmBundleRef 메커니즘을 대체한다.

---

## 4. 목표와 비목표

### 4.1 목표

1. 멀티 에이전트 구성과 오케스트레이션을 선언형으로 정의할 수 있어야 한다.
2. stateful long-running 실행 모델을 Process-per-Agent 아키텍처로 표준화해야 한다.
3. 3종 Middleware Pipeline(turn/step/toolCall)으로 라이프사이클 훅을 모듈화해야 한다.
4. Connector/Connection 분리 모델로 채널 통합과 인증 바인딩을 표준화해야 한다.
5. Edit & Restart 모델로 설정 변경과 에이전트 프로세스 재시작을 간결하게 지원해야 한다.
6. 프로세스 격리를 통해 에이전트별 크래시 격리와 독립 스케일링을 보장해야 한다.
7. Bun-native 런타임으로 빠른 기동과 실행 성능을 제공해야 한다.
8. 관측성(Trace/메트릭/토큰 사용량)과 보안(서명 검증/토큰 보호)을 기본 요구사항으로 포함해야 한다.

### 4.2 비목표

- 특정 LLM Provider/SDK 구현체에 종속되지 않는다(AI SDK를 통한 추상화).
- UI/프론트엔드 스펙은 범위에서 제외한다.
- 벡터 DB/평가 알고리즘 등 내부 알고리즘 선택은 확장 영역으로 둔다.
- 분산 클러스터/멀티 노드 스케줄링은 본 버전 범위에서 다루지 않는다.
- Node.js 호환 레이어는 제공하지 않는다(Bun-native only).

---

## 5. 핵심 개념

Goondan은 Orchestrator 상주 프로세스가 관리하는 AgentProcess 위에서 Turn(입력 1개 처리)과 Step(LLM 호출 중심 단위)을 반복한다. 각 AgentInstance는 독립 Bun 프로세스로 실행되며, Orchestrator와 IPC로 통신한다.

Tool은 실행 단위이며 도구 이름은 `{Tool 리소스 이름}__{하위 도구 이름}` 형식(더블 언더스코어)으로 LLM에 노출된다. Extension은 Middleware Pipeline(turn/step/toolCall)에 개입하는 실행 로직이다. Connector는 별도 프로세스로 프로토콜 수신을 자체 관리하며, Connection은 인증 정보 제공과 ingress 라우팅을 담당한다.

Message는 AI SDK CoreMessage를 감싸는 래퍼로, 고유 ID와 metadata를 통해 메시지 식별/조작을 지원한다. 메시지 상태는 `NextMessages = BaseMessages + SUM(Events)` 이벤트 소싱 모델을 유지한다.

자세한 본문: @05_core-concepts.md

---

## 6. Config 스펙

Config 리소스는 `apiVersion: goondan.ai/v1`과 `kind/metadata/spec` 공통 구조를 따른다. ObjectRef/Selector/Overrides 문법, ValueSource/SecretRef, 구성 검증 시점(로드 시)과 오류 보고 형식을 정의한다.

자세한 본문: @06_config-spec.md

---

## 7. Config 리소스 정의

8종의 Kind를 정의한다: Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package.

- Tool/Extension/Connector는 `runtime` 필드가 제거되어 항상 Bun으로 실행된다.
- Connector는 별도 프로세스로 프로토콜 수신을 자체 관리하며, `triggers` 필드 대신 `events` 스키마만 선언한다.
- Connection은 인증 정보 제공, ingress 라우팅 규칙, 서명 검증 시크릿을 정의한다.
- OAuthApp, ResourceType, ExtensionHandler Kind는 제거되었다. OAuth 관리가 필요한 경우 Extension 내부 구현으로 처리한다.

자세한 본문: @07_config-resources.md

---

## 8. Config 구성 단위와 패키징

패키징 요구사항은 의존성 DAG, 버전 제약, lockfile 재현성, values 병합 우선순위, 레지스트리/캐시 동작, 패키지 게시/폐기 라이프사이클, 레지스트리 인증을 포함해야 한다.

자세한 본문: @08_packaging.md

---

## 9. Runtime 실행 모델

Runtime은 Process-per-Agent 아키텍처를 따른다. Orchestrator는 `gdn run`으로 기동되는 상주 프로세스로, AgentProcess와 ConnectorProcess를 스폰/감시/재시작하며, IPC 메시지 브로커 역할을 수행한다.

각 AgentInstance는 독립 Bun 프로세스에서 실행되며, canonical event를 Turn으로 변환하여 처리한다. Turn 메시지 처리는 `NextMessages = BaseMessages + SUM(Events)` 규칙으로 계산되며, 위임(delegate)은 Orchestrator 경유 IPC 기반 비동기 패턴으로 처리된다.

설정 변경은 Edit & Restart 모델을 따른다. `goondan.yaml` 수정 후 Orchestrator가 해당 에이전트 프로세스를 kill 후 새 설정으로 re-spawn한다. `--watch` 모드에서는 파일 변경 감지 시 자동 재시작되며, `gdn restart` CLI 명령으로도 재시작을 트리거할 수 있다.

자세한 본문: @09_runtime-model.md

---

## 10. 워크스페이스 모델

2-root 분리 모델을 따른다.

- **SwarmBundleRoot** = 사용자 프로젝트 디렉토리(`goondan.yaml` 및 리소스 파일 위치)
- **System Root** = `~/.goondan/` (CLI 설정, 설치된 패키지, 워크스페이스별 인스턴스 상태)

인스턴스 상태는 `~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/` 하위에 저장된다. Agent 메시지 저장소는 `messages/base.jsonl`/`messages/events.jsonl` 이원화 모델을 따르며, Extension 상태는 `extensions/<ext-name>.json`으로 영속화된다.

자세한 본문: @10_workspace-model.md

---

## 11. 라이프사이클 파이프라인(Middleware) 스펙

모든 파이프라인 훅은 Middleware 형태로 통일된다. `next()` 호출 전후로 전처리(pre)/후처리(post)를 수행하는 3종 미들웨어를 정의한다.

| 미들웨어 | 설명 |
|----------|------|
| `turn` | Turn 전체를 감싸는 미들웨어. `next()` 전: 메시지 히스토리 조작. `next()` 후: 결과 후처리 |
| `step` | Step(LLM 호출 + 도구 실행)을 감싸는 미들웨어. `next()` 전: 도구/컨텍스트 조작. `next()` 후: 결과 변환, 로깅, 재시도 |
| `toolCall` | 개별 도구 호출을 감싸는 미들웨어. `next()` 전: 입력 검증/변환. `next()` 후: 결과 변환 |

기존의 Mutator/Middleware 이원화, 13개 파이프라인 포인트, Reconcile identity 규칙은 제거되었다. Extension은 `api.pipeline.register('turn' | 'step' | 'toolCall', handler)` 인터페이스를 통해 미들웨어를 등록한다.

자세한 본문: @11_lifecycle-pipelines.md

---

## 12. Tool 스펙(런타임 관점)

Tool은 `{Tool 리소스 이름}__{하위 도구 이름}` 형식(더블 언더스코어)으로 LLM에 노출되며, Bun 프로세스 내에서 실행된다. `runtime` 필드는 제거되어 항상 Bun으로 실행된다.

Tool Handler는 `ToolContext`와 `JsonObject` 입력을 받아 `JsonValue`를 반환한다. ToolContext는 agentName, instanceKey, turnId, toolCallId, message(트리거 메시지) 등을 포함한다.

자세한 본문: @12_tool-spec-runtime.md

---

## 13. Extension 실행 인터페이스

Extension은 `register(api: ExtensionApi)`를 통해 Middleware Pipeline, 동적 도구 등록, Extension 상태 관리, 이벤트 버스 API를 사용한다. ExtensionApi는 `pipeline`, `tools`, `state`, `events`, `logger` 인터페이스를 제공한다.

Extension은 Middleware에서 `ConversationState`를 받아 metadata 기반으로 MessageEvent를 발행하여 메시지를 조작할 수 있다.

자세한 본문: @13_extension-interface.md

---

## 14. 활용 예시 패턴

Compaction(메시지 요약/압축), Handoff(에이전트 간 위임), Logging(구조화된 로깅), Multi-model(복수 LLM 조합) 등 대표 패턴을 정리한다.

자세한 본문: @14_usage-patterns.md

---

## 15. 예상 사용 시나리오

Telegram 장기 대화, CLI 채팅봇, 에이전트 간 위임(delegate) 흐름, 설정 변경 후 watch 모드 자동 재시작, 컨텍스트 compaction을 통한 장기 대화 유지, Turn 중 장애 후 메시지 복원(이벤트 소싱 기반) 시나리오를 정리한다.

자세한 본문: @15_usage-scenarios.md

---

## 16. 기대 효과

요구사항 적용 시 얻는 기술적/운영적 효과를 정리한다. Process-per-Agent 격리에 의한 안정성 향상, Bun-native 성능, Middleware Pipeline 단순화에 의한 확장 용이성, Edit & Restart 모델의 운영 편의성을 포함한다.

자세한 본문: @16_expected-outcomes.md

---

## 부록 A. 실행 모델 및 Middleware 위치 다이어그램

Orchestrator → AgentProcess → Turn → Step 실행 흐름과 3종 Middleware(turn/step/toolCall) 적용 지점을 ASCII 다이어그램으로 제공한다.

자세한 본문: @appendix_a_diagram.md

---

## 변경 이력 및 정합성 검토

- 2026-02-12: **v2.0 마이그레이션** — 전체 요구사항을 Goondan v2 스펙에 맞춰 재작성.
  - `apiVersion`을 `goondan.ai/v1`로 변경.
  - Bun-native 런타임, Process-per-Agent 실행 모델 도입.
  - Changeset/SwarmBundleRef/SwarmBundleManager를 제거하고 Edit & Restart 모델로 대체.
  - Mutator/Middleware 이원화 및 13개 파이프라인 포인트를 3종 Middleware(turn/step/toolCall)로 통합.
  - Message 타입 도입(AI SDK CoreMessage 래퍼, 이벤트 소싱 유지).
  - Tool 이름 규칙을 더블 언더스코어(`__`)로 변경.
  - 리소스 Kind를 11종에서 8종으로 축소(OAuthApp, ResourceType, ExtensionHandler 제거).
  - Connector를 자체 관리 프로세스 모델로 변경.
  - Workspace를 3-root에서 2-root(`~/.goondan/`)로 축소.
  - CLI 명령어 축소: `gdn restart` 추가, pause/resume/terminate/logs/config 제거.
- 2026-02-08: §5.4.1 Connector 이벤트 수신 방식 구분(Runtime 관리 vs Custom) 추가, §7.6 `custom` trigger 규칙 추가, §9.1.3 Custom Trigger 실행 모델 추가. 관련 스펙 동기화: `docs/specs/connector.md`, `docs/specs/resources.md`.
- 2026-02-07: Turn 메시지 처리 모델을 `NextMessages = BaseMessages + SUM(Events)`로 전환. `base.jsonl`/`events.jsonl` 저장 구조, turn.post `(base, events)` 전달 및 최종 fold-commit 규칙 추가. 관련 요구사항/구현 스펙 동기화 완료.
- 2026-02-07: 영향 스펙 동기화: `docs/specs/runtime.md`, `docs/specs/workspace.md`, `docs/specs/pipeline.md`, `docs/specs/api.md`, `docs/specs/extension.md`, `docs/specs/tool.md`, `docs/specs/bundle.md`, `docs/specs/resources.md` 업데이트.
- 2026-02-07: `_improve-claude.md`, `_improve-codex.md` 반영.
- 2026-02-07: `7.7 Connection` 요구사항 추가, `8` 패키징 요구사항 확장, 인스턴스 라이프사이클/동시성/observability/오류 UX 요구사항 강화.
- 2026-02-07: `14~16` 섹션을 분할 파일로 독립.
- 2026-02-07: `docs/specs/*.md` 수정 필요 여부 검토 완료. 이번 변경은 요구사항 계층 정비 범위로 한정하며, 구현 스펙은 현행 문서와 정합하도록 요구사항을 상향/명확화함.
- 2026-02-07: §5 Connector/Connection을 Extension 하위에서 독립 섹션(5.4)으로 분리. §8 패키지 게시/폐기/인증 요구사항 추가. §9.4.5 코드 변경 반영 의미론 추가. §11.3.1 Extension-Hook 실행 순서 명시. §7.1 capability 불일치 거부 규칙 추가. §11.5/§15 workspace 비표준 포인트 정리.
