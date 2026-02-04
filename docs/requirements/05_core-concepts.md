## 5. 핵심 개념

### 5.1 Instance, Turn, Step

* **SwarmInstance**: Swarm 정의를 바탕으로 만들어지는 long‑running 실행체. 하나 이상의 AgentInstance 포함.
* **AgentInstance**: Agent 정의를 바탕으로 만들어지는 long‑running 실행체. 이벤트 큐 보유.
* **Turn**: AgentInstance가 “하나의 입력 이벤트”를 처리하는 단위. 작업이 소진될 때까지 Step 반복 후 제어 반납.
* **Step**: “LLM 호출 1회”를 중심으로 한 단위. LLM 응답의 tool call을 모두 처리(또는 비동기 큐잉 제출까지)한 시점에 종료.

규칙:

* Step이 시작되면 해당 Step이 끝날 때까지 **Effective Config와 SwarmBundleRef는 고정**되어야 한다(MUST).
* SwarmBundle 변경(Changeset 커밋으로 생성된 SwarmBundleRef)은 **Safe Point에서만 활성화**되며, **다음 Step부터** 반영된다(MUST).
* Runtime은 각 Step의 LLM 응답 및 Tool 결과를 `Turn.messages`에 append하고, 다음 Step의 입력(컨텍스트)으로 반드시 사용해야 한다(MUST).

### 5.2 Tool

Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위이다. Tool은 단순 HTTP 요청 템플릿에 한정되지 않으며 런타임 컨텍스트 및 이벤트 시스템에 접근할 수 있다.

### 5.3 Extension

Extension은 런타임 라이프사이클의 특정 지점에 개입하기 위해 등록되는 실행 로직 묶음이다. Extension은 파이프라인 포인트에 핸들러를 등록하여 도구 카탈로그, 컨텍스트 블록, LLM 호출, 도구 실행, 워크스페이스 이벤트 처리 등에 영향을 줄 수 있다.

#### 5.3.1 Skill

Skill은 SKILL.md를 중심으로 한 파일 번들이며, LLM이 필요 시 SKILL.md를 로드하고 bash를 통해 동봉된 스크립트를 실행하는 형태로 사용된다. Skill의 발견/카탈로그화/주입/열기(open)는 Extension으로 구현될 수 있다.

#### 5.3.2 Connector

Connector는 외부 채널 이벤트를 수신하여 SwarmInstance/AgentInstance로 라우팅하고, 진행상황 업데이트와 완료 보고를 같은 맥락으로 송신한다.

#### 5.3.3 MCP Extension (패턴)

MCP 연동은 MCP 프로토콜 기반 도구/리소스/프롬프트 제공자를 연결하기 위한 **Extension 패턴**이다. 연결 구성(transport/attach/expose)과 stateful/stateless 모드는 Extension의 config로 캡슐화하며, Agent는 해당 Extension을 `extensions` 목록에 포함해 사용한다.

### 5.4 SwarmBundle / Changeset / SwarmBundleRef

#### 5.4.1 Bundle

Bundle은 **YAML 리소스 + 소스코드(도구/확장/커넥터/프롬프트/기타 파일)** 를 함께 포함하는 **폴더 트리**이다.

#### 5.4.1.1 Bundle Package (기존 Bundle)

Bundle Package는 **Bundle을 Git 기반으로 배포/의존성 해석**하기 위한 패키징 단위이다.  
기존 문서에서 `bundle.yaml`, Bundle Ref, Bundle Root 등으로 설명하던 **“Bundle(배포/패키징 의미)”** 는 이제 **Bundle Package**로 명명한다.  
하위 호환을 위해 `bundle.yaml`의 `kind: Bundle` 표기는 당분간 유지할 수 있다.

#### 5.4.2 SwarmBundle

SwarmBundle은 Swarm(및 그에 포함된 Agent/Tool/Extension/Connector/OAuthApp 등)을 정의하는 Bundle이다.  
SwarmBundle의 YAML/소스코드를 수정하면 **에이전트의 행동(동작과 통합)이 수정**된다.

#### 5.4.3 SwarmBundleRef

SwarmBundleRef는 특정 SwarmBundle 스냅샷을 식별하는 **불변 식별자**이다(opaque string).  
Git 기반 구현에서는 SwarmBundleRoot의 Git commit SHA(또는 tag/branch ref)를 SwarmBundleRef로 사용하는 것을 권장한다(SHOULD).

* 동일 SwarmBundleRef는 동일한 Bundle 콘텐츠를 재현 가능해야 한다(MUST).
* Step은 시작 시점에 특정 SwarmBundleRef로 핀되어야 한다(MUST).

#### 5.4.4 Changeset

Changeset은 SwarmBundleRoot의 변경을 안전하게 수행하기 위한 단위이다. Changeset은 **커밋되기 전에는 실행에 영향을 주지 않으며**, 커밋되면 **새 SwarmBundleRef를 생성**한다.

Git 기반 구현(권장, SHOULD)에서는 changeset을 **Git worktree 1개**로 표현한다.

* SwarmBundleManager가 `swarmBundle.openChangeset`으로 changesetId와 workdir을 발급(open)
* 에이전트(또는 도구/확장)가 그 workdir에서 파일을 수정
* `swarmBundle.commitChangeset`이 Git commit을 만들고 SwarmBundleRoot의 활성 Ref를 업데이트하여 새 SwarmBundleRef를 생성

세부 규격은 §6.4를 따른다.

#### 5.4.5 Canonical Writer(정본 단일 작성자) 규칙 (MUST)

Git 기반 구현에서 정본은 SwarmBundleRoot의 Git history/refs이다. Runtime은 Git과 별개로 병렬 정본 로그/커서를 요구하지 않는다(MUST NOT).  
또한 SwarmBundleRoot에 대한 변경(Ref 이동/commit)은 Runtime 내부 SwarmBundleManager만이 수행할 수 있어야 한다(MUST).

#### 5.4.6 Safe Point(적용 시점) 규칙 (MUST)

* Runtime은 최소 `step.config` Safe Point를 MUST 제공한다.
* Step이 시작된 이후에는 Step 종료 전까지 SwarmBundleRef와 Effective Config가 변경되어서는 안 된다(MUST).
