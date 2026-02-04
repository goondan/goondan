# Goondan: Agent Swarm Orchestrator 스펙 v0.9

본 문서는 “멀티 에이전트 오케스트레이션과 컨텍스트 최적화를 중심으로 한 에이전트 스웜”을 **선언형 Config Plane(= SwarmBundle)** 과 **stateful long‑running Runtime Plane**, 그리고 런타임 내부 **SwarmBundleManager**가 관리하는 **Changeset → SwarmRevision** 메커니즘(구성+코드 변경 반영)으로 구현하기 위한 통합 규격을 정의한다.

---

## 0. 규범적 표현

본 문서에서 MUST/SHOULD/MAY는 RFC 2119 스타일의 규범적 의미로 사용된다.

즉, 문장에 사용된 조동사는 “필수/권장/선택”의 구현 요구 수준을 나타내며, 구현체는 이를 기준으로 호환성과 기대 동작을 맞춰야 한다.

또한 예시는 이해를 돕기 위한 것으로, 실제 값/경로/그룹 이름 등은 구현에 따라 달라질 수 있다.

자세한 본문: @spec_main_00_normative-language.md

---

## 1. 배경

AI 에이전트 개발의 패러다임은 단일 에이전트가 “도구 호출 루프(tool‑using loop)”를 수행하는 수준에서 빠르게 확장되고 있다. 최근의 에이전트 시스템은 컨텍스트 최적화를 통해 LLM 성능을 끌어올리기 위해 멀티 에이전트를 오케스트레이션하고, 에이전틱 루프의 전후 또는 특정 트리거 시점에 컨텍스트를 재구성·요약·보강하는 방법을 적극적으로 활용한다. 이 과정에서 “메모리 축적과 주입”을 포함한 컨텍스트 조작을 통해 에이전트가 마치 하나의 프로세스처럼 stateful하게 long‑running하는 사용자 경험을 제공하는 설계가 널리 등장하고 있다.

또한 실제 업무 적용에서는 Slack/Telegram/웹/코드리뷰 댓글 등 다양한 인터페이스에서 호출되는 에이전트를 하나의 플랫폼에서 운영해야 하는 요구가 증가하고 있다. 이때 핵심은 단순히 “모델을 호출한다”가 아니라, 멀티 에이전트 구성, 컨텍스트 조립, 도구·스킬·외부 시스템 통합, 진행상황 업데이트, 장기 상태 관리까지 포함하는 **복합적인 실행 하네스(harness)**를 안정적으로 구성하는 것이다.

---

## 2. 문제의식

### 2.1 에이전트 제작의 복잡성

개념적으로 에이전트는 LLM 모델(및 파라미터), 시스템 프롬프트, 그리고 사용 가능한 도구 카탈로그로 정의할 수 있지만, 실제 구현에서는 각 요소를 조합하고 실행 흐름을 관리하기 위한 코드가 빠르게 복잡해진다. 특히 멀티 에이전트 환경에서는 여러 에이전트를 간단하고 일관된 방식으로 선언하고 조립할 수 있는 방법이 필요하다.

### 2.2 에이전틱 루프의 라이프사이클 관리 필요

현대 에이전트 시스템에서는 에이전틱 루프의 전후로 다양한 전처리와 후처리가 필요해진다. 예를 들어 입력 이벤트 정규화, 컨텍스트 구성, 도구 카탈로그 조정, 실행 후 회고/요약, 상태 업데이트 등은 루프의 특정 시점에 맞춰 수행되어야 한다. 따라서 에이전틱 루프의 라이프사이클을 추상화하고, 각 시점 전후에 에이전트의 상태 또는 실행 환경을 조작하는 로직을 삽입할 수 있어야 한다.

### 2.3 Stateful long‑running 에이전트의 복잡성

에이전트의 활동에 따라 메모리 콘텐츠가 축적되고, 그 내용을 적절히 정리·검색·주입하여 컨텍스트를 유지하는 것은 stateful 경험의 핵심이다. 그러나 메모리의 축적과 주입은 실행 라이프사이클과 강하게 결합되며, 일관성 있는 구현을 위해 라이프사이클 관리 체계가 필요해진다.

### 2.4 다양한 클라이언트 호출의 필요성

에이전트는 Slack, Telegram, 웹, GitHub 댓글 등 다양한 채널에서 호출될 수 있으며, 채널별 메시지 포맷과 맥락(예: Slack thread, GitHub PR comment chain)을 추상화하는 계층이 필요하다. 진행상황 업데이트와 완료 보고는 이 맥락을 유지한 채로 수행되어야 한다.

### 2.5 구성의 텍스트화 필요성

위 요구사항을 코드로 직접 작성하면 생산성과 일관성이 떨어질 수 있다. 반면 JSON/YAML/TOML 같은 추상화된 텍스트 포맷의 config로 정의하면, 재사용과 자동화가 쉬워지고 AI의 도움을 받아 구성을 작성·리팩터링하는 흐름도 자연스럽게 만들 수 있다.

---

## 3. 솔루션 개요

본 솔루션은 다음 세 요소로 구성된다.

1. **Config Plane(= SwarmBundle)**
   SwarmBundle은 Swarm을 정의하는 YAML 리소스들과, 그것이 참조하는 프롬프트/도구/확장/커넥터 구현 소스코드를 함께 포함하는 “번들(폴더 트리)”이다. SwarmBundle은 GitOps 등으로 배포/버전관리될 수 있다.

2. **Runtime Plane**
   stateful long‑running 인스턴스를 유지하며 입력 이벤트를 처리하는 실행 모델(Instance/Turn/Step)과 라이프사이클 파이프라인(훅)을 제공한다. Extension은 파이프라인의 특정 지점에 개입하여 도구 카탈로그, 컨텍스트 블록, LLM 호출, 도구 실행, 워크스페이스 이벤트 등에 영향을 준다.

3. **SwarmBundleManager(Changeset → SwarmRevision)**
   Runtime 내부에 SwarmBundle 변경을 안전하게 반영하기 위한 SwarmBundleManager를 둔다. LLM은 Changeset으로 staging workdir을 열고 파일을 수정한 뒤 커밋하여 새 SwarmRevision을 생성한다. 새 SwarmRevision은 Safe Point에서만 활성화되며, 기본 규칙은 “다음 Step부터 반영”이다.

---

## 4. 목표와 비목표

### 4.1 목표

1. 멀티 에이전트 구성과 오케스트레이션을 선언형 구성으로 정의할 수 있어야 한다.
2. stateful long‑running 실행 모델을 제공하여, 사용자에게 대화형 지속 경험을 제공해야 한다.
3. 실행 라이프사이클 파이프라인을 제공하여 컨텍스트 최적화, 메모리 축적/주입, 도구 노출 최적화 등을 모듈화해야 한다.
4. 다양한 클라이언트 채널(Connector)에서의 호출과 진행상황 업데이트를 표준화해야 한다.
5. SwarmBundle의 구성/코드 변경을 런타임 중 안전하게 반영할 수 있어야 한다(Changeset → SwarmRevision).

### 4.2 비목표

* 특정 LLM Provider/SDK에 종속된 구현을 정의하지 않는다.
* UI/UX(예: 웹 프론트엔드) 구현 스펙은 포함하지 않는다.
* 메모리/리트리벌/평가 시스템의 구체 구현(예: vector DB 선택, 알고리즘)은 본 문서 범위를 벗어난다(확장으로 다룸).
* 분산 클러스터/멀티 노드 스케줄링은 v0.9 범위에서 정의하지 않는다(향후 확장).

---

## 5. 핵심 개념

Goondan 런타임은 SwarmInstance/AgentInstance(장기 실행체) 위에서 Turn(입력 이벤트 1개 처리 단위)과 Step(LLM 호출 1회 중심 단위)을 반복하는 모델을 갖는다. Step이 시작되면 종료까지 Effective Config와 SwarmRevision이 고정되어야 하며, LLM/Tool 결과는 Turn.messages에 누적되어 다음 Step 입력으로 사용된다.

Tool은 LLM이 tool call로 호출하는 1급 실행 단위이고, Extension은 라이프사이클 포인트에 개입해 도구 카탈로그/컨텍스트 블록/LLM 호출/도구 실행/워크스페이스 이벤트 등에 영향을 주는 실행 로직 묶음이다. Skill은 SKILL.md 중심 번들로서 필요 시 로드/실행되며, Connector는 외부 이벤트를 수신해 동일 맥락으로 라우팅/응답하고, MCPServer는 MCP 기반 도구/리소스/프롬프트 제공자를 연결한다.

SwarmBundle은 구성(YAML)+코드(프롬프트/툴/확장/커넥터)를 담는 번들이며, Changeset 커밋으로 새 SwarmRevision(불변 스냅샷)이 생성된다. 정본 기록은 SwarmBundleManager 단일 작성자 규칙을 따르고, 활성화는 Safe Point(최소 step.config)에서만 이뤄지며 기본 규칙은 “다음 Step부터 반영”이다.

**Bundle/SwarmBundle(구성+코드 번들)**  
Bundle은 YAML 리소스와 프롬프트/툴/확장/커넥터 구현 소스코드를 함께 담는 폴더 트리이며, SwarmBundle은 Swarm을 정의하는 Bundle이다.
Git 기반 배포/의존성 해석 단위(기존 Bundle)는 **Bundle Package**로 명명한다.

자세한 본문: @spec_main_05_core-concepts.md

---

## 6. Config 스펙

Config Plane 리소스는 YAML 기반의 apiVersion/kind/metadata/spec 구조를 기본으로 하며, name 고유성 및 다중 문서(---) 구성을 지원한다.

리소스 간 참조는 ObjectRef(문자열 축약 또는 객체형)로 표현하고, selector+overrides로 선택/덮어쓰기를 조립한다. 병합 규칙은 객체 재귀 병합, 스칼라 덮어쓰기, 배열 교체를 기본으로 한다.

또한 런타임 산출물로서 Changeset/SwarmRevision 상태(정본 로그, cursor/head/base, openChangeset/commitChangeset 인터페이스, status 기록)를 정의하며, OAuth/Connector 등에서 사용하는 ValueSource/SecretRef 주입 패턴과 비밀값 직접 포함 금지 권장을 포함한다.

자세한 본문: @spec_main_06_config-spec.md

---

## 7. Config 리소스 정의

본 섹션은 Model/Tool/Extension/MCPServer/Agent/Swarm 등 핵심 리소스 타입의 스키마와 예시를 정의한다. 특히 Agent는 modelConfig, prompt, tools/extensions/mcpServers, hooks(파이프라인 포인트 실행)를 통해 실행 구성을 조립한다.

ChangesetPolicy는 Swarm(최대 허용 범위)과 Agent(추가 제약)로 중첩되는 allowlist로 정의될 수 있으며, SwarmBundleManager는 commit 시 허용 경로 검사 및 rejected/failed status 기록을 수행한다. Connector는 ingress/egress 라우팅과 OAuthApp 기반/Static Token 기반 인증 모드를 정의하고, trigger handler는 runtime entry 모듈의 export 함수로 해석되며 ctx.emit(canonical event) 기반 실행 모델을 따른다.

확장성 측면에서 ResourceType/ExtensionHandler로 사용자 정의 kind의 등록/검증/변환을 지원할 수 있고, OAuthApp은 flow(authorizationCode/deviceCode), subjectMode(global/user), endpoints, scopes, redirect 등을 정의하며 Authorization Code + PKCE(S256) 지원 및 검증 규칙을 포함한다.

자세한 본문: @spec_main_07_config-resources.md

---

## 8. Config 구성 단위와 패키징

구현은 구성 파일을 여러 폴더/파일로 분할해 관리할 수 있어야 하며, 디렉터리 단위 로딩/다중 YAML 문서 로딩/파일 참조 기반 로딩을 지원하는 것을 권장한다.

또한 리소스 YAML, 프롬프트, 확장/도구 스크립트, 스킬 번들을 재사용 가능한 패키지(차트/번들) 형태로 제공할 수 있다.

패키지 간 의존성/values 주입과 같은 세부 메커니즘은 구현 선택이지만, 재사용과 배포 단위를 명확히 하는 방향을 전제로 한다.

자세한 본문: @spec_main_08_packaging.md

---

## 9. Runtime 실행 모델

Runtime은 Connector로부터 입력 이벤트를 받아 instanceKey 규칙으로 SwarmInstance를 조회/생성하고, 그 내부에서 AgentInstance 이벤트 큐를 통해 Turn을 실행한다. Turn에는 호출 맥락(origin)과 인증 컨텍스트(auth)가 유지되며, 에이전트 간 handoff에서도 auth는 보존되어야 한다.

Turn은 Step 루프를 수행하며, 표준 순서는 step.config → step.tools → step.blocks → step.llmCall → tool call 처리 → step.post이다. 정책적으로 maxStepsPerTurn을 적용할 수 있고, connector는 canonical event 생성(ctx.emit) 책임만 가지며 실행 모델 자체를 직접 제어하지 않는다.

Changeset 커밋으로 head SwarmRevision이 이동하고, 활성화는 Safe Point(기본 step.config)에서만 일어나며 통상 다음 Step부터 반영된다. 또한 Effective Config의 tools/extensions/mcpServers 배열은 identity 기반 정규화 및 reconcile이 권장된다.

자세한 본문: @spec_main_09_runtime-model.md

---

## 10. 워크스페이스 모델

Runtime은 repo 캐시, 에이전트 worktree, turn 단위 scratch, 공유 artifacts, 인스턴스 상태 루트 등 파일시스템 워크스페이스를 관리한다.

SwarmBundle 관련 상태는 인스턴스별 `shared/state/instances/<instanceId>/swarm-bundle/` 아래에 base/head/cursor, changeset 로그, staging workdir, effective 스냅샷 등을 포함하는 레이아웃을 MUST로 정의한다. 또한 AgentInstance별 LLM 메시지 로그를 append-only JSONL로 기록한다.

인스턴스 생명주기와 독립적인 시스템 전역 상태 루트(`shared/state/system/`)를 제공해 OAuth grants/sessions를 보존해야 하며, 저장되는 비밀값은 반드시 at-rest encryption을 적용해야 한다.

자세한 본문: @spec_main_10_workspace-model.md

---

## 11. 라이프사이클 파이프라인(훅) 스펙

파이프라인은 Mutator(순차 상태 변형)와 Middleware(next() 래핑) 두 타입으로 정의되며, Runtime은 turn/step/toolCall/workspace 표준 포인트를 MUST 제공한다. 특히 step.config는 step.tools보다 앞서 실행되어야 한다.

확장 등록 순서에 따른 실행/래핑(onion) 규칙과 hooks 합성(priority 정렬) 원칙을 정의하며, changeset 커밋/활성화 실패는 status 로그에 기록하고 Step 진행은 계속하는 정책을 권장한다.

또한 reconcile은 배열 인덱스가 아니라 identity key 기반으로 수행되어야 하며, 순서 변경만으로 상태 재생성이 발생하면 안 된다. stateful MCPServer 연결은 동일 identity로 유지되는 동안 계속 유지되어야 한다.

자세한 본문: @spec_main_11_lifecycle-pipelines.md

---

## 12. Tool 스펙(런타임 관점)

Tool Registry(전체 실행 가능 도구)와 Tool Catalog(특정 Step에서 LLM에 노출되는 목록)를 구분하며, Runtime은 step.tools에서 Catalog를 구성한다. ToolResult는 동기 완료(output) 또는 비동기 제출(handle) 모델을 가질 수 있다.

Tool 실행 실패는 예외 전파 대신 ToolResult.output에 오류 정보를 담아 LLM에 전달해야 하며, error.message 길이는 Tool.spec.errorMessageLimit(기본 1000자)로 제한된다. SwarmBundle 변경은 openChangeset→파일 수정→commitChangeset 흐름으로 수행되고, 활성화는 Safe Point에서만 이뤄진다.

OAuth 통합은 ctx.oauth.getAccessToken 의미론(Subject 결정, scopes 부분집합 검증, grant 조회, authorization_required 반환, refresh 권장)을 정의한다. OAuthStore의 단일 작성자/암호화 규칙, OAuthGrantRecord/AuthSessionRecord 스키마, Authorization Code + PKCE(S256) 필수 플로우, (선택) device code, 승인 안내용 블록 주입 권장을 포함한다.

자세한 본문: @spec_main_12_tool-spec-runtime.md

---

## 13. Extension 실행 인터페이스

Extension은 `register(api)` 엔트리포인트를 제공하고, Runtime은 AgentInstance 초기화 시 확장 목록 순서대로 이를 호출해야 한다.

등록 API는 파이프라인 mutate/wrap, tool 등록, 이벤트 emit, 워크스페이스 접근을 포함하며, 구현 선택으로 swarmBundle open/commitChangeset 같은 번들 접근 API를 제공할 수 있다.

또한 확장별 상태 저장(`ctx.extState()` 등)과 인스턴스 공유 상태, 그리고 내부 OAuthManager를 통해 토큰 취득 인터페이스를 표준화하는 방향을 제시한다.

자세한 본문: @spec_main_13_extension-interface.md

---

## 14. 활용 예시 패턴

### 14.1 Skill 패턴(Extension 기반 구현)

Skill은 SKILL.md 중심 번들로서 다음 기능을 통해 활용된다.

1. 스킬 카탈로그(메타) 제공
2. 선택 시 SKILL.md 전문과 경로 정보 제공
3. bash로 스크립트 실행

이 기능은 Extension으로 구현될 수 있으며 다음 포인트를 활용한다.

* `workspace.repoAvailable`: 스킬 디렉터리 스캔/인덱스 갱신
* `step.blocks`: 카탈로그/열린 스킬 본문 주입
* `skills.list`, `skills.open`: 스킬 목록/전문 로딩 tool 제공

### 14.2 대표 도구 패턴: ToolSearch

ToolSearch는 LLM이 tool catalog를 탐색/요약할 수 있도록 제공되는 **Tool**이다.  
ToolSearch는 “다음 Step부터 사용할 도구/확장/프롬프트 변경”이 필요할 때, 도구 카탈로그를 로드 하는 시점에 도구 목록을 조작하여 검색된 도구를 추가한다.

---

## 15. 예상 사용 시나리오

### 15.1 Slack thread 기반 장기 작업

사용자가 Slack thread에서 Swarm을 호출하면 Connector는 thread 식별자를 instanceKey로 사용하여 동일 스레드의 요청이 동일 SwarmInstance로 라우팅되도록 할 수 있다. AgentInstance는 같은 스레드에 진행 업데이트/완료 보고를 전송한다.

### 15.2 repo가 추가되면서 스킬이 자연스럽게 활성화되는 흐름

AgentInstance가 작업 중 특정 repo를 확보하면 workspace 이벤트가 발생하고 Skill 확장은 해당 repo의 스킬을 스캔해 카탈로그를 갱신한다. 다음 Step에서 갱신된 스킬 카탈로그가 컨텍스트 블록에 포함될 수 있다.

### 15.3 ToolSearch로 도구 노출을 최적화하는 흐름

ToolSearch는 현재 tool catalog에서 필요한 도구를 찾아보고, 검색 결과에 따라 다음 Step부터 도구를 단계적으로 확장한다.

### 15.4 프리셋/번들 선택과 부분 덮어쓰기

조직 내 공통 정책을 리소스로 정의해두면 Agent는 selector+overrides 문법으로 이를 선택하고 일부만 덮어써 구성할 수 있다.

### 15.5 Changeset으로 “도구/프롬프트/코드”가 다음 Step부터 바뀌는 흐름

1. Step N에서 LLM이 `swarmBundle.openChangeset` 호출 → staging workdir 수신
2. LLM이 bash로 workdir 안의 YAML/프롬프트/코드 파일을 수정
3. LLM이 `swarmBundle.commitChangeset` 호출
4. SwarmBundleManager가 정책 검사/검증 후 새 SwarmRevision 생성, head 이동, changesets/status 기록
5. Step N 종료
6. Step N+1의 `step.config`에서 head를 활성화(activeSwarmRevision으로 반영), status에 appliedAt/stepId 기록
7. Step N+1부터 새 SwarmRevision 기반으로 실행

### 15.6 Slack OAuth 설치/토큰 사용 흐름(개념)

1. Slack Connector는 ingress 이벤트로부터 `turn.auth.actor`와 `turn.auth.subjects`를 설정한다. 예를 들어 `turn.auth.subjects.global = slack:team:<team_id>`, `turn.auth.subjects.user = slack:user:<team_id>:<user_id>` 형태로 채우는 것을 권장한다.
2. LLM이 `slack.postMessage`를 호출하면 Tool 구현은 `ctx.oauth.getAccessToken({ oauthAppRef: slack-bot })`로 토큰을 요청한다. 이때 `slack-bot` OAuthApp의 `subjectMode=global`이므로 Runtime은 `turn.auth.subjects.global`을 subject로 사용한다.
3. 토큰이 준비되어 있으면 `status="ready"`가 반환되고 Tool은 Slack API 호출을 수행한다.
4. 토큰이 없다면 `status="authorization_required"`가 반환되며, Runtime은 AuthSession을 생성해 `authorizationUrl`과 안내 메시지를 제공한다. 에이전트는 이 정보를 이용해 사용자에게 승인 링크를 안내한다.
5. 사용자가 승인을 완료하면 Runtime은 callback에서 PKCE/state/subject를 검증한 뒤 OAuthGrant를 저장하고, `auth.granted` 이벤트를 해당 인스턴스/에이전트로 enqueue하여 비동기 재개를 수행한다.

---

## 16. 기대 효과

1. 멀티 에이전트 구성과 컨텍스트 최적화 로직이 선언형 구성과 파이프라인으로 체계적으로 조직된다.
2. stateful long‑running 에이전트 경험을 Turn/Step 모델과 이벤트 큐로 일관되게 구현할 수 있다.
3. 확장을 통해 도구 카탈로그, 컨텍스트 조립, 메모리 축적/주입, 클라이언트 업데이트 전략을 모듈화할 수 있다.
4. 구성 파일 기반 정의로 재사용과 자동화가 쉬워지고 AI가 구성을 생성·수정·검토하는 흐름이 자연스럽다.
5. Changeset → SwarmRevision 모델로 “구성뿐 아니라 코드까지” 런타임 중 변경·반영할 수 있다.
6. reconcile이 identity 기반으로 수행되고 stateful MCP 연결이 유지되어, 구성 진화가 불필요한 연결 흔들림을 유발하지 않는다.
7. OAuthApp 도입으로 Tool/Connector의 인증/토큰 취득 방식이 표준화되어, 통합 난이도와 운영 복잡성이 감소한다.

---

## 부록 A. 실행 모델 및 훅 위치 다이어그램

Instance → Turn → Step 실행 흐름과 turn/step/toolCall 파이프라인 포인트의 위치를 ASCII 다이어그램으로 제시한다.

특히 step.config에서 SwarmRevision 활성화와 config 로딩이 이뤄지고, step.llmCall/toolCall.exec가 middleware onion 구조로 확장에 의해 래핑될 수 있음을 한눈에 보여준다.

구현/디버깅 시 “어느 시점에 무엇이 실행되어야 하는지”를 빠르게 확인하는 참고용 부록이다.

자세한 본문: @spec_main_appendix_a_diagram.md

---
