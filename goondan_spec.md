# Goondan: Agent Swarm Orchestrator 스펙 v0.8

본 문서는 “멀티 에이전트 오케스트레이션과 컨텍스트 최적화를 중심으로 한 에이전트 스웜”을 **선언형 Config Plane(Base Config)** 과 **stateful long‑running Runtime Plane**, 그리고 런타임 내부 **LiveConfigManager**가 관리하는 **Live Config(동적 오버레이)** 로 구현하기 위한 통합 규격을 정의한다.

---

## 0. 규범적 표현

이 문서에서 MUST, SHOULD, MAY는 RFC 2119 스타일의 규범적 의미로 사용한다.
이 문서의 예시는 설명을 위한 것이며, 예시의 값과 파일 경로, 그룹 이름은 구현에 따라 달라질 수 있다.

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

1. **Config Plane(Base Config)**
   멀티 에이전트 스웜을 구성하기 위한 선언형 리소스 집합을 정의한다. 에이전트의 모델/프롬프트/도구/확장/훅/인터페이스 등을 기술한다.

2. **Runtime Plane**
   stateful long‑running 인스턴스를 유지하며 입력 이벤트를 처리하는 실행 모델(Instance/Turn/Step)과 라이프사이클 파이프라인(훅)을 제공한다. Extension은 파이프라인의 특정 지점에 개입하여 도구 카탈로그, 컨텍스트 블록, 워크스페이스 이벤트 처리, 실행 래핑을 변형할 수 있다.

3. **Live Config(동적 오버레이)**
   Runtime이 long‑running 인스턴스를 운영하는 동안 Base Config 위에 얹히는 동적 구성 레이어이다. Live Config는 “파일로 관측 가능”하지만, 정본(Patch Log/Status/Cursor)은 오직 런타임 내부 **LiveConfigManager**가 기록한다(MUST). Tool/Extension/Sidecar는 patch를 “제안(propose)”할 수 있으며, LiveConfigManager가 이를 수용/기록/적용하여 **다음 Step부터** 반영한다.

---

## 4. 목표와 비목표

### 4.1 목표

1. 시스템은 멀티 에이전트 스웜을 선언형으로 정의할 수 있어야 하며, Runtime은 이 정의를 기반으로 stateful 인스턴스를 생성·운영할 수 있어야 한다.
2. 시스템은 실행의 라이프사이클을 Turn/Step 단위로 추상화하고 표준 지점에 훅/파이프라인을 제공해야 한다.
3. 시스템은 확장을 통해 도구 카탈로그, 컨텍스트 구성, 워크스페이스 이벤트 처리, 실행 래핑을 구현할 수 있어야 한다.
4. 시스템은 다양한 클라이언트/채널에서의 호출과 맥락 유지(진행 업데이트/완료 보고)를 지원할 수 있어야 한다.
5. 시스템은 구성의 재사용과 조합을 지원할 수 있어야 하며, “직접 설정”과 “선택 후 덮어쓰기”를 일관된 문법으로 표현할 수 있어야 한다.
6. 시스템은 런타임 중 구성 변경을 지원하되, 변경의 정본은 LiveConfigManager 단일 작성자 모델로 운영되어야 하고, 적용은 Safe Point에서만 수행되어 다음 Step부터 실행에 반영되어야 한다.

### 4.2 비목표

본 문서는 실행 하네스와 확장 구조를 중심으로 한다. 인증·권한·감사·승인 정책 등은 구현과 운영 요구에 따라 추가 규격으로 확장될 수 있다.

---

## 5. 핵심 개념

### 5.1 Instance, Turn, Step

* **SwarmInstance**: Swarm 정의를 바탕으로 만들어지는 long‑running 실행체. 하나 이상의 AgentInstance 포함.
* **AgentInstance**: Agent 정의를 바탕으로 만들어지는 long‑running 실행체. 이벤트 큐 보유.
* **Turn**: AgentInstance가 “하나의 입력 이벤트”를 처리하는 단위. 작업이 소진될 때까지 Step 반복 후 제어 반납.
* **Step**: “LLM 호출 1회”를 중심으로 한 단위. LLM 응답의 tool call을 모두 처리(또는 비동기 큐잉 제출까지)한 시점에 종료.

규칙:

* Step이 시작되면 해당 Step이 끝날 때까지 **Effective Config는 고정**되어야 한다(MUST).
* Live Config 변경은 **다음 Step부터** 반영된다(MUST).

### 5.2 Tool

Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위이다. Tool은 단순 HTTP 요청 템플릿에 한정되지 않으며 런타임 컨텍스트 및 이벤트 시스템에 접근할 수 있다.

### 5.3 Extension

Extension은 런타임 라이프사이클의 특정 지점에 개입하기 위해 등록되는 실행 로직 묶음이다. Extension은 파이프라인 포인트에 핸들러를 등록하여 도구 카탈로그, 컨텍스트 블록, LLM 호출, 도구 실행, 워크스페이스 이벤트 처리 등에 영향을 줄 수 있다.

### 5.4 Skill

Skill은 SKILL.md를 중심으로 한 파일 번들이며, LLM이 필요 시 SKILL.md를 로드하고 bash를 통해 동봉된 스크립트를 실행하는 형태로 사용된다. Skill의 발견/카탈로그화/주입/열기(open)는 Extension으로 구현될 수 있다.

### 5.5 Connector

Connector는 외부 채널 이벤트를 수신하여 SwarmInstance/AgentInstance로 라우팅하고, 진행상황 업데이트와 완료 보고를 같은 맥락으로 송신한다.

### 5.6 MCPServer

MCPServer는 MCP 프로토콜 기반 도구/리소스/프롬프트 제공자를 연결하기 위한 구성 단위이다. MCPServer는 stateful/stateless 방식과 스코프(인스턴스/에이전트 등)를 포함할 수 있다.

### 5.7 Live Config (Base + Live Overlay + Effective)

#### 5.7.1 Base Config

Config Plane에서 로드된 선언형 리소스 집합이다.

#### 5.7.2 Live Overlay(정본 단일 작성자)

Live Overlay는 Runtime이 long‑running 인스턴스를 운영하는 동안 유지하는 동적 구성 오버레이이다. Live Overlay의 정본(Patch Log/Status/Cursor)은 Runtime 내부의 **LiveConfigManager만이 기록할 수 있다(MUST)**.

Runtime은 다음을 만족해야 한다(MUST).

* Patch Log/Status/Cursor는 LiveConfigManager 단일 작성자(single-writer) 모델로 운영되어야 한다.
* Patch Log/Status/Cursor 파일의 직접 편집은 허용되지 않아야 한다(MUST NOT).
* Runtime은 파일 권한/격리 또는 접근 제어로 직접 수정이 발생하지 않도록 방지해야 한다(SHOULD).

Tool/Extension/Sidecar는 patch를 **제안(propose)** 할 수 있으나, LiveConfigManager가 정본으로 기록하기 전까지는 실행에 영향을 주지 않는다(MUST).

#### 5.7.3 Effective Config

특정 Step에서 실제로 사용되는 실행 구성이다.

* `Effective Config = Base Config + Live Overlay`

#### 5.7.4 Safe Point(적용 시점) 규칙 (MUST)

적용(apply)은 Safe Point에서만 수행되어야 한다.

* Runtime은 최소 `step.config` Safe Point를 MUST 제공한다.
* Step이 시작된 이후에는 Step 종료 전까지 Effective Config가 변경되어서는 안 된다(MUST).

#### 5.7.5 스코프(scope)

* AgentInstance 스코프(필수, MUST)
* SwarmInstance 스코프(선택, MAY)

---

## 6. Config 스펙

### 6.1 리소스 공통 형식

* 모든 리소스는 `apiVersion`, `kind`, `metadata`, `spec`를 MUST 포함한다.
* `metadata.name`은 동일 네임스페이스 내에서 고유해야 한다.
* 단일 YAML 파일에 여러 문서(`---`) 포함 가능.

### 6.2 참조 문법

#### 6.2.1 ObjectRef

* `Kind/name` 축약 문자열 MAY
* `{ apiVersion?, kind, name }` 객체형 참조 MUST

#### 6.2.2 Selector

* `{ kind, name }` 단일 선택 MUST
* `{ matchLabels: {...}, kind? }` 라벨 기반 선택 MAY

### 6.3 Selector + Overrides 조립 문법

* 블록에 `selector`가 있으면 선택형으로 해석(MUST)
* 선택형 블록에서 `overrides` 적용 가능(MUST)
* 기본 병합 규칙: 객체 재귀 병합, 스칼라 덮어쓰기, 배열 교체(SHOULD)

---

### 6.4 Live Config 상태 문서(런타임 산출물) 규격

#### 6.4.1 저장소 구조(에이전트 하위 분리) (MUST)

Runtime은 SwarmInstance마다 상태 루트를 제공해야 하며, 각 AgentInstance의 Live Config는 반드시 해당 AgentInstance 하위 디렉터리에 저장되어야 한다(MUST).

* SwarmInstance-level(선택): swarm 스코프 patch 저장소(MAY)
* AgentInstance-level(필수): agent 스코프 patch 저장소(MUST)

#### 6.4.2 정본 파일 및 단일 작성자 (MUST)

다음 파일은 LiveConfigManager가 append-only로 기록하는 정본이어야 하며, 다른 주체가 기록해서는 안 된다(MUST).

* Patch Log (`patches.jsonl`)
* Patch Status Log (`patch-status.jsonl`)
* Apply Cursor (`cursor.yaml`)

#### 6.4.3 Patch Proposal(제안) 규격 (MUST)

Tool/Extension/Sidecar가 제출하는 “제안”은 Patch Log가 아니라 **Proposal API**를 통해 전달되어야 한다(MUST). 제안의 최소 스키마는 다음을 포함해야 한다(MUST).

```json
{
  "scope": "agent",
  "target": { "kind": "AgentInstance", "name": "planner" },
  "applyAt": "step.config",
  "patch": {
    "type": "json6902",
    "ops": [
      { "op": "add", "path": "/spec/tools/-", "value": { "kind": "Tool", "name": "slackToolkit" } }
    ]
  },
  "source": { "type": "tool", "name": "toolSearch" },
  "reason": "다음 Step부터 Slack 진행 업데이트 사용"
}
```

규칙:

* `patch.type`은 `json6902` MUST
* `source.type`은 `"tool" | "extension" | "sidecar" | "system"` 중 하나 MUST
* agent 스코프 제안에서 `target`이 생략되면 “현재 AgentInstance”로 해석하는 것을 MAY로 둔다(구현 선택).

#### 6.4.4 Patch Log(정본) 규격 (MUST)

LiveConfigManager는 수용된 제안을 Patch Log에 기록한다(MUST). Patch Log는 append-only JSON Lines를 권장한다.

각 레코드는 LivePatch 문서 형태를 따른다(정본 기록은 “이미 결정된 patch id를 가진” 형태로 기록됨).

```json
{
  "apiVersion": "agents.example.io/v1alpha1",
  "kind": "LivePatch",
  "metadata": { "name": "p-000123" },
  "spec": {
    "scope": "agent",
    "target": { "kind": "AgentInstance", "name": "planner" },
    "applyAt": "step.config",
    "patch": {
      "type": "json6902",
      "ops": [
        { "op": "add", "path": "/spec/tools/-", "value": { "kind": "Tool", "name": "slackToolkit" } }
      ]
    },
    "source": { "type": "tool", "name": "toolSearch" },
    "reason": "다음 Step부터 Slack 진행 업데이트 사용",
    "recordedAt": "2026-01-31T09:10:00Z"
  }
}
```

규칙:

* `metadata.name`은 Patch Log 내에서 유일해야 한다(MUST).
* `recordedAt`는 LiveConfigManager가 Patch Log에 기록한 시각이며, 기록 시각의 관측 가능성을 위해 SHOULD 포함한다.

#### 6.4.5 LiveConfigManager 및 Proposal API (MUST)

Runtime은 LiveConfigManager 컴포넌트를 MUST 제공한다.

* LiveConfigManager는 Patch Log/Status/Cursor의 유일한 작성자이다(MUST).
* Runtime은 patch 제안을 위한 표준 인터페이스를 MUST 제공한다. 최소 하나를 제공해야 한다(MUST).

  * 이벤트 기반: `api.events.emit("liveConfig.patchProposed", proposal)`
  * RPC/함수 기반: `api.liveConfig.proposePatch(proposal)`

LiveConfigManager는 제안 수신 후 다음을 수행해야 한다(MUST).

1. 스키마 검증
2. allowList/정책 검사
3. 정렬/중복/정규화(필요 시)
4. Patch Log에 정본 기록
5. Patch Status Log에 평가 결과 기록

> “정본 기록 전까지 실행에 영향 없음”을 보장하기 위해, LiveConfigManager는 Patch Log 기록이 완료되기 전 patch를 적용 대상으로 취급해서는 안 된다(MUST).

#### 6.4.6 Patch Status Log(적용/평가 로그) 규격 (MUST)

Runtime은 AgentInstance별로 `patch-status.jsonl`을 MUST 제공해야 한다. 이 로그는 각 LivePatch에 대한 평가/적용 정보를 append-only로 기록한다(MUST).

Status 레코드는 최소 다음 필드를 포함해야 한다(MUST).

* `patchName`: LivePatch.metadata.name
* `agentName`: AgentInstance 식별자
* `result`: `"applied" | "pending" | "rejected" | "failed"`
* `evaluatedAt`: 평가 시각
* `appliedAt`: `result="applied"`인 경우 적용 시각(MUST)
* `effectiveRevision`: `result="applied"`인 경우 적용 이후 revision(MUST)
* `appliedInStepId`: 적용이 반영된 Step 식별자(가능하면 SHOULD)
* `reason`: 짧은 사유 문자열(가능하면 SHOULD)

예시:

```json
{"patchName":"p-000123","agentName":"planner","result":"applied","evaluatedAt":"2026-01-31T09:10:01Z","appliedAt":"2026-01-31T09:10:01Z","effectiveRevision":127,"appliedInStepId":"step-9f3a","reason":"ok"}
{"patchName":"p-000124","agentName":"planner","result":"pending","evaluatedAt":"2026-01-31T09:10:01Z","reason":"targetNotFound"}
{"patchName":"p-000125","agentName":"planner","result":"rejected","evaluatedAt":"2026-01-31T09:10:01Z","reason":"pathNotAllowed"}
```

#### 6.4.7 Apply Cursor 파일 규격 (MUST)

Runtime은 AgentInstance별로 `cursor.yaml`을 MUST 제공해야 한다. cursor는 “어디까지 평가/적용했는지”를 재시작 복구 가능하게 저장한다.

권장 필드 예시:

```yaml
version: 1
patchLog:
  format: jsonl
  lastReadOffsetBytes: 12345          # 구현 선택(MAY)
  lastEvaluatedPatchName: p-000125    # SHOULD
  lastAppliedPatchName: p-000123      # SHOULD
effective:
  revision: 127                       # MUST
  lastAppliedAt: "2026-01-31T09:10:01Z"  # SHOULD
```

#### 6.4.8 Materialized View / Effective Snapshot (선택)

* `overlay.state.yaml`: 사람이 읽기 쉬운 현재 오버레이 뷰 (MAY)
* `effective/effective-<rev>.yaml`: Effective Config 스냅샷 (SHOULD)

#### 6.5 ValueSource / SecretRef(간단 타입) (OAuthApp/Connector에서 사용)

OAuthApp의 clientId/clientSecret, Connector의 고정 토큰 등은 환경/비밀 저장소에서 주입되는 경우가 일반적이므로, 본 문서는 간단한 ValueSource 패턴을 정의한다.

```yaml
# ValueSource
value: "plain-string"           # 또는

valueFrom:
  env: "ENV_VAR_NAME"           # 또는

valueFrom:
  secretRef:
    ref: "Secret/slack-oauth"   # Kind/name 축약 ObjectRef
    key: "client_secret"
```

규칙:

1. `value`와 `valueFrom`은 동시에 존재해서는 안 되며, 둘 중 하나만 존재해야 한다(MUST).
2. `valueFrom` 안에서는 `env`와 `secretRef`가 동시에 존재해서는 안 되며, 둘 중 하나만 존재해야 한다(MUST).
3. `secretRef.ref`는 `"Secret/<name>"` 형태의 참조 문자열이며, 여기서 `Secret`은 런타임이 제공하는 비밀 저장소 엔트리를 가리키는 예약된 kind로 취급한다(MUST).
4. Base Config에 비밀값(access token, refresh token, client secret 등)을 직접 포함하지 않도록 구성하는 것을 SHOULD 한다.

---

## 7. Config 리소스 정의

예시는 `agents.example.io/v1alpha1`을 사용한다.

### 7.1 Model

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: openai-gpt-5
spec:
  provider: openai
  name: gpt-5
  endpoint: "https://..."     # 선택
  options: {...}              # 선택
```

### 7.2 Tool

Tool은 LLM에 노출되는 함수 엔드포인트를 포함한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: slackToolkit
spec:
  runtime: node
  entry: "./tools/slack/index.js"

  # 이 Tool이 기본적으로 사용하는 OAuthApp(선택)
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write"]  # 선택: OAuthApp.spec.scopes의 부분집합만 허용

  exports:
    - name: slack.postMessage
      description: "메시지 전송"
      parameters:
        type: object
        additionalProperties: true
      # export-level auth는 tool-level보다 좁게(부분집합으로)만 선언할 수 있다(선택).
      auth:
        scopes: ["chat:write"]
```

규칙:

1. `spec.auth.oauthAppRef`가 존재하면, Runtime은 Tool 실행 컨텍스트에 OAuth 토큰 조회 인터페이스(`ctx.oauth`)를 제공해야 한다(SHOULD).
2. Tool 또는 export가 `auth.scopes`를 선언하는 경우, Runtime은 그 값이 `OAuthApp.spec.scopes`의 부분집합인지 구성 로드/검증 단계에서 검사해야 하며, 부분집합이 아니면 구성을 거부해야 한다(MUST).
3. Tool/export의 `auth.scopes`는 “추가 권한 요청(증분)”을 의미하지 않으며, 선언된 OAuthApp 스코프 중에서 “더 좁은 범위로 제한”하는 의미로만 사용되어야 한다(MUST).

### 7.3 Extension

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: skills
spec:
  runtime: node
  entry: "./extensions/skills/index.js"
  config:
    discovery:
      repoSkillDirs: [".claude/skills", ".agent/skills"]
```

### 7.4 MCPServer

```yaml
apiVersion: agents.example.io/v1alpha1
kind: MCPServer
metadata:
  name: github-mcp
spec:
  transport:
    type: stdio
    command: ["npx", "-y", "@acme/github-mcp"]
  attach:
    mode: stateful
    scope: instance
  expose:
    tools: true
    resources: true
    prompts: true
```

### 7.5 Agent

Agent는 에이전트 실행을 구성하는 중심 리소스이다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
spec:
  modelConfig:
    modelRef: { kind: Model, name: openai-gpt-5 }
    params:
      temperature: 0.5

  prompts:
    # 파일 참조
    systemRef: "./prompts/planner.system.md"
    # 또는 인라인 시스템 프롬프트
    # system: |
    #   너는 planner 에이전트다.

  tools:
    - { kind: Tool, name: slackToolkit }

  extensions:
    - { kind: Extension, name: skills }
    - { kind: Extension, name: toolSearch }

  mcpServers:
    - { kind: MCPServer, name: github-mcp }

  hooks:
    - point: turn.post
      priority: 0
      action:
        toolCall:
          tool: slack.postMessage
          input:
            channel: { expr: "$.turn.origin.channel" }
            threadTs: { expr: "$.turn.origin.threadTs" }
            text: { expr: "$.turn.summary" }
```

#### 7.5.1 Agent 단위 LiveConfigPolicy (MAY)

Agent는 Swarm의 liveConfig 정책을 **추가 제약(더 좁게)** 하는 allowList를 제공할 수 있다(MAY).

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
spec:
  liveConfig:
    allowedPaths:
      agentRelative:
        - "/spec/tools"
        - "/spec/hooks"
```

규칙:

* Swarm.allowedPaths가 “최대 허용 범위”라면, Agent.allowedPaths는 “해당 Agent의 추가 제약”으로 해석한다(MUST).
* 따라서 agent 스코프 patch는 **Swarm.allowedPaths + Agent.allowedPaths 모두를 만족**해야 허용된다(MUST).

### 7.6 Swarm

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
  policy:
    maxStepsPerTurn: 32
```

#### 7.6.1 Swarm LiveConfigPolicy (MAY, 강력 권장)

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
  policy:
    maxStepsPerTurn: 32
    liveConfig:
      enabled: true
      store:
        instanceStateDir: "shared/state/instances/{{instanceId}}"
      applyAt:
        - step.config
      allowedPaths:
        agentRelative:
          - "/spec/tools"
          - "/spec/extensions"
          - "/spec/mcpServers"
          - "/spec/hooks"
        swarmAbsolute:
          - "/spec/policy"
      emitConfigChangedEvent: true
```

##### allowedPaths 해석 규칙 (MUST)

* `scope="agent"` patch의 json6902 path는 AgentInstance 루트를 기준으로 해석한다(MUST).
  `allowedPaths.agentRelative`에 대해 prefix 매칭으로 평가한다(MUST).
* `scope="swarm"` patch의 json6902 path는 SwarmInstance 루트를 기준으로 해석한다(MUST).
  `allowedPaths.swarmAbsolute`에 대해 prefix 매칭으로 평가한다(MUST).
* 허용되지 않은 path를 변경하려는 제안은 `result="rejected"`로 기록되어야 한다(MUST).

### 7.7 Connector

Connector는 외부 채널 이벤트를 수신하여 SwarmInstance/AgentInstance로 라우팅하고, 진행상황 업데이트와 완료 보고를 같은 맥락으로 송신한다.

Connector 인증은 두 가지 모드 중 하나로 구성할 수 있다.

1. OAuthApp 기반 모드(설치/승인 플로우를 통해 토큰을 획득)
2. Static Token 기반 모드(운영자가 발급한 토큰을 Secret으로 주입)

두 모드는 동시에 활성화될 수 없다(MUST).

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack-main
spec:
  type: slack

  # (선택) OAuthApp 기반 인증
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }

  ingress:
    - match:
        command: "/swarm"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"

  egress:
    updatePolicy:
      mode: updateInThread
      debounceMs: 1500
```

Static Token 기반 모드 예시는 다음과 같다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack-main
spec:
  type: slack
  auth:
    staticToken:
      valueFrom:
        secretRef: { ref: "Secret/slack-bot-token", key: "bot_token" }
  ingress:
    - match:
        command: "/swarm"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
```

CLI Connector 예시는 다음과 같다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"
```

규칙:

1. `spec.auth.oauthAppRef`와 `spec.auth.staticToken`은 동시에 존재할 수 없다(MUST).
2. Connector는 ingress 이벤트를 Turn으로 변환할 때, Turn의 인증 컨텍스트(`turn.auth`)를 가능한 한 채워야 한다(SHOULD).
3. Slack Connector의 경우, `turn.auth.subjects.global`은 워크스페이스 단위 토큰 조회를 위해 `slack:team:<team_id>` 형태로 채우는 것을 권장하며, `turn.auth.subjects.user`는 사용자 단위 토큰 조회를 위해 `slack:user:<team_id>:<user_id>` 형태로 채우는 것을 권장한다(SHOULD).
4. Static Token 모드에서는 OAuth 승인 플로우를 수행하지 않으며, OAuthStore를 참조하지 않는다(MUST).

### 7.8 ResourceType / ExtensionHandler (복구: v0.4의 원문 포함)

ResourceType과 ExtensionHandler는 사용자 정의 kind의 등록, 검증, 기본값, 런타임 변환을 지원하기 위한 구성 단위로 사용될 수 있다. 이 메커니즘은 특정 용도(프리셋 제공 등)에 한정되지 않으며, 다양한 도메인 리소스(예: Retrieval, Memory, Evaluator 등)를 정의하는 데 활용될 수 있다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: ResourceType
metadata:
  name: rag.acme.io/Retrieval
spec:
  group: rag.acme.io
  names:
    kind: Retrieval
    plural: retrievals
  versions:
    - name: v1alpha1
      served: true
      storage: true
  handlerRef: { kind: ExtensionHandler, name: retrieval-handler }
---
apiVersion: agents.example.io/v1alpha1
kind: ExtensionHandler
metadata:
  name: retrieval-handler
spec:
  runtime: node
  entry: "./extensions/retrieval/handler.js"
  exports: ["validate", "default", "materialize"]
```

### 7.9 OAuthApp

OAuthApp은 외부 시스템 OAuth 인증을 위한 클라이언트 및 엔드포인트를 정의한다. OAuthApp은 설정 리소스이며, 실제 토큰/그랜트 저장은 런타임의 시스템 전역 OAuthStore(§10.2, §12.5)에 속한다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: OAuthApp
metadata:
  name: slack-bot
spec:
  provider: slack

  # authorizationCode | deviceCode
  flow: authorizationCode

  # global | user
  # - global: turn.auth.subjects.global 을 subject로 사용한다.
  # - user:   turn.auth.subjects.user   를 subject로 사용한다.
  subjectMode: global

  client:
    clientId:
      valueFrom:
        env: "SLACK_CLIENT_ID"
    clientSecret:
      valueFrom:
        secretRef: { ref: "Secret/slack-oauth", key: "client_secret" }

  endpoints:
    authorizationUrl: "https://slack.com/oauth/v2/authorize"   # authorizationCode에서 필요
    tokenUrl: "https://slack.com/api/oauth.v2.access"          # authorizationCode에서 필요
    # deviceAuthorizationUrl: "https://..."                    # deviceCode에서 필요(지원 시)

  # 스코프는 사전 고정이며 런타임 중 증분 확장을 하지 않는다(MUST).
  scopes:
    - "chat:write"
    - "channels:read"

  redirect:
    callbackPath: "/oauth/callback/slack-bot"                  # authorizationCode에서 필요

  options:
    slack:
      tokenMode: "bot"
```

규칙:

1. Runtime은 `flow=authorizationCode`에 대해 **Authorization Code + PKCE(S256)**를 MUST 지원해야 한다. PKCE는 “구성으로 켜고 끄는 옵션”이 아니라, 지원되는 Authorization Code 플로우의 필수 동작으로 간주한다(MUST).
2. Runtime은 `flow=deviceCode`를 MAY 지원할 수 있다. Runtime이 deviceCode를 지원하지 않는 경우, `flow=deviceCode`인 OAuthApp 구성은 로드/검증 단계에서 거부되어야 한다(MUST).
3. `spec.subjectMode`는 Turn의 `turn.auth.subjects`에서 어떤 키를 subject로 사용할지 결정한다(MUST). Runtime은 해당 키가 Turn에 없으면 토큰 발급/조회 절차를 시작하지 말고 오류로 처리해야 한다(MUST).
4. 전역 토큰과 사용자별 토큰이 의미적으로 다른 경우, 이를 하나의 OAuthApp으로 합치지 말고 서로 다른 OAuthApp으로 분리 등록하는 것을 권장한다(SHOULD). 이 방식은 “토큰 소유 단위가 다르면 OAuthApp도 다르다”는 운영 원칙을 구성 수준에서 명확히 만든다.

---

## 8. Config 구성 단위와 패키징

### 8.1 구성 파일 분할과 로딩

구현은 구성 파일을 여러 폴더/파일로 분할하여 관리할 수 있어야 한다. 구현은 디렉터리 단위 로딩, 다중 YAML 문서 로딩, 파일 참조 기반 로딩을 SHOULD 지원한다.

### 8.2 패키지(차트/번들) 개념

구현은 재사용 가능한 구성 묶음을 패키지 형태로 제공할 수 있다. 패키지는 리소스 YAML, 프롬프트 파일, 확장/도구 스크립트, 스킬 파일 번들을 포함할 수 있다. 패키지 간 의존성과 값 주입(values)은 구현에 따라 달라질 수 있다.

---

## 9. Runtime 실행 모델

### 9.1 인스턴스 생성과 라우팅

Runtime은 Connector로부터 입력 이벤트를 수신하고, 라우팅 규칙에 따라 SwarmInstance를 조회/생성한다.

* `instanceKey`를 사용하여 동일 맥락을 같은 인스턴스로 라우팅할 수 있어야 한다(MUST).
* SwarmInstance 내부에 AgentInstance를 생성하고 유지해야 한다(MUST).

### 9.1.1 Turn Origin 컨텍스트와 인증 컨텍스트

Runtime은 Connector로부터 입력 이벤트를 수신하고, 라우팅 규칙에 따라 SwarmInstance를 조회/생성한다. OAuth 기반 통합을 위해 Runtime은 Turn 컨텍스트에 호출 맥락(origin)과 인증 컨텍스트(auth)를 유지해야 한다(SHOULD).

Connector는 ingress 이벤트로부터 최소한 다음 정보를 Turn에 포함시키는 것을 권장한다.

1. `turn.origin`에는 채널/스레드 등 맥락을 식별하는 정보가 포함되어야 한다(SHOULD).
2. `turn.auth.actor`에는 이 Turn을 트리거한 호출자(사람 또는 시스템 계정)의 식별자가 포함되어야 한다(SHOULD).
3. `turn.auth.subjects`에는 OAuthGrant 조회에 사용할 subject 후보들이 포함되어야 한다(SHOULD). Runtime은 OAuthApp의 `subjectMode`에 따라 `subjects.global` 또는 `subjects.user`를 사용한다.

권장 형태 예시는 다음과 같다.

```yaml
turn:
  origin:
    connector: slack-main
    channel: "C123"
    threadTs: "1700000000.000100"

  auth:
    actor:
      type: "user"
      id: "slack:U234567"
      display: "alice"   # 선택
    subjects:
      global: "slack:team:T111"
      user:   "slack:user:T111:U234567"
```

규칙:

1. Runtime이 에이전트 간 handoff를 위해 내부 이벤트를 생성하거나 라우팅할 때, `turn.auth`는 변경 없이 전달되어야 한다(MUST). 이 규칙은 “Turn을 트리거한 사용자 컨텍스트가 handoff 이후에도 유지된다”는 요구를 보장하기 위한 것이다.
2. Runtime은 `turn.auth`가 누락된 Turn에 대해 사용자 토큰이 필요한 OAuthApp(`subjectMode=user`)을 사용해 토큰을 조회하거나 승인 플로우를 시작해서는 안 된다(MUST). 이 경우에는 오류로 처리하고, 에이전트가 사용자에게 필요한 컨텍스트(예: 다시 호출, 계정 연결 필요)를 안내하도록 하는 것이 바람직하다(SHOULD).

### 9.2 이벤트 큐와 Turn 실행

* AgentInstance는 이벤트 큐를 가진다(MUST).
* 큐의 이벤트 하나가 Turn의 입력이 된다(MUST).
* Runtime은 Turn 내에서 Step을 반복 실행할 수 있어야 한다(MUST).
* `Swarm.policy.maxStepsPerTurn` 정책을 적용할 수 있어야 한다(MAY).

### 9.3 Step 실행과 도구 호출 처리

Step은 다음 순서로 진행된다.

1. **step.config**: LiveConfigManager가 Live Config를 평가/적용하여 이번 Step의 Effective Config를 확정
2. `step.tools`: Tool Catalog 구성
3. `step.blocks`: Context Blocks 구성
4. `step.llmCall`: LLM 호출
5. tool call 처리(동기 실행 또는 비동기 큐잉)
6. `step.post`: 결과 반영 후 Step 종료

### 9.4 Live Config 적용 의미론 (MUST)

##### 9.4.1 적용 단위

* Runtime은 각 Step 시작 시 `step.config`에서 Live Config를 적용해야 한다(MUST).
* Step 실행 중에는 Effective Config를 변경해서는 안 된다(MUST).

##### 9.4.2 적용 절차(권장 표준)

AgentInstance의 `step.config`에서 LiveConfigManager는 최소 다음을 수행하는 것을 SHOULD 한다.

1. proposal 입력(이벤트/RPC)을 drain하여 평가
2. allowList/정책/정규화 후 Patch Log에 기록
3. 적용 가능한 patch를 순서대로 apply
4. Patch Status Log에 `result` 및 (applied이면) `appliedAt/stepId/revision` 기록
5. Cursor 업데이트
6. (선택) Effective Snapshot 기록

##### 9.4.3 반영 시점

Step N에서 제안된 patch는 Step N+1의 `step.config`에서 반영되는 것이 기본 규칙이다(MUST).
(단, 구현이 “Step N 시작 전 이미 기록된 patch”를 Step N에서 적용하는 것은 자연스럽게 허용된다.)

##### 9.4.4 변경 가시성(권장)

`emitConfigChangedEvent=true`인 경우, Runtime은 변경 요약을 다음 Step 입력 또는 블록에 포함시키는 것을 SHOULD 한다.

#### 9.4.7 Effective Config 배열 정규화 규칙 (SHOULD)

Runtime은 LivePatch 적용 후 다음 배열을 **identity key 기반으로 정규화**하는 것을 SHOULD 한다.

* `/spec/tools`, `/spec/extensions`, `/spec/mcpServers`

정규화 규칙(SHOULD):

* identity key가 동일한 항목이 중복될 경우, 마지막에 나타난 항목이 내용을 대표(last-wins)한다.
* 배열의 순서는 patch 적용 결과로 만들어진 순서를 유지한다.
* 실행 상태 유지(reconcile)는 순서가 아니라 identity key 기준으로 수행한다(§11.6).

---

## 10. 워크스페이스 모델

Runtime은 인스턴스와 에이전트 실행을 위한 파일시스템 워크스페이스를 관리한다. 워크스페이스에는 repo 캐시, 작업트리, 임시 디렉터리, 공유 산출물 영역 등이 포함될 수 있다.

권장 레이아웃 예시는 다음과 같다.

* `shared/repo-cache/`
* `agents/<agentId>/worktrees/`
* `agents/<agentId>/scratch/<turnId>/`
* `shared/artifacts/`
* `shared/state/instances/<instanceId>/`

### 10.1 Live Config 상태 디렉터리 레이아웃 (MUST)

```
shared/state/instances/<instanceId>/
  base/
    base-config.ref                    # MUST: Base Config 식별자(커밋/번들 등)
  swarm/                               # MAY: swarm scope live config
    live-config/
      patches.jsonl                    # MAY: canonical
      cursor.yaml                      # MAY
      patch-status.jsonl               # MAY
      overlay.state.yaml               # MAY
  agents/                              # MUST: agent scope live config
    <agentInstanceNameOrId>/           # AgentInstance 식별자(인스턴스 내 유일)
      live-config/
        patches.jsonl                  # MUST: canonical
        cursor.yaml                    # MUST
        patch-status.jsonl             # MUST
        overlay.state.yaml             # MAY
        effective/
          effective-<rev>.yaml         # SHOULD
  events/
    events.jsonl                       # SHOULD
```

정본 파일(patches/patch-status/cursor)은 읽기 전용으로 노출되는 것이 SHOULD이며, LiveConfigManager 외의 주체가 기록하지 못해야 한다.

### 10.2 System State 디렉터리 레이아웃 (MUST)

Runtime은 인스턴스 상태(`shared/state/instances/<instanceId>/...`)와 별개로, 인스턴스 생명주기와 독립적으로 유지되는 시스템 전역 상태 루트(System State)를 제공해야 한다(MUST). 시스템 전역 상태는 Runtime 재시작 또는 개별 SwarmInstance/AgentInstance의 삭제와 무관하게 유지되어야 하며, 특히 OAuth 토큰/그랜트는 이 영역에 저장되어야 한다(MUST).

권장 레이아웃 예시는 다음과 같다.

```text
shared/state/system/
  oauth/
    grants/
      <oauthAppName>/
        <subjectHash>.sops.yaml
    sessions/
      <oauthAppName>/
        <authSessionId>.sops.yaml
    locks/
      <oauthAppName>/
        <subjectHash>.lock
```

규칙:

1. `shared/state/system/oauth/grants`는 OAuthGrantRecord(§12.5.4)의 저장소이며, 인스턴스가 사라져도 유지되어야 한다(MUST).
2. `shared/state/system/oauth/sessions`는 승인 진행 중(AuthSession) 상태(AuthSessionRecord, §12.5.5)의 저장소이며, 승인 완료 또는 만료 후에는 정리될 수 있다(SHOULD).
3. OAuthStore에 저장되는 문서는 디스크에 평문으로 남지 않도록 반드시 at-rest encryption을 적용해야 한다(MUST). 구현은 SOPS 호환 포맷 또는 동등한 envelope encryption 포맷을 사용하는 것을 권장한다(SHOULD).
4. DB 기반 저장소는 향후 확장으로 고려할 수 있으나, v0.7 범위에서는 정의하지 않으며(스펙 아웃), 표준 저장소는 파일시스템 기반 OAuthStore로 간주한다.

---

## 11. 라이프사이클 파이프라인(훅) 스펙

### 11.1 파이프라인 타입

* Mutator: 순차 실행을 통해 상태를 변형
* Middleware: `next()` 기반 래핑(온니언 구조)

### 11.2 표준 파이프라인 포인트

Runtime은 최소 다음 포인트를 제공해야 한다(MUST).

* Turn: `turn.pre`, `turn.post`
* Step: `step.pre`, `step.config`, `step.tools`, `step.blocks`, `step.llmCall`, `step.post`
* ToolCall: `toolCall.pre`, `toolCall.exec`, `toolCall.post`
* Workspace: `workspace.repoAvailable`, `workspace.worktreeMounted`

규칙:

* `step.config`는 `step.tools`보다 먼저 실행되어야 한다(MUST).

### 11.3 실행 순서와 확장 순서

* Mutator 포인트: extensions 등록 순서대로 선형 실행
* Middleware 포인트: 먼저 등록된 확장이 더 바깥 레이어

hooks 합성:

* 동일 포인트 내 실행 순서는 결정론적으로 재현 가능해야 한다(MUST).
* priority가 있으면 priority 정렬 후 안정 정렬(SHOULD).

### 11.4 patch 적용 실패 처리 (SHOULD)

patch 적용 실패는 patch-status에 `result="failed"`로 기록하고, Step 자체는 계속 진행하는 정책을 SHOULD 한다. (fail-fast는 구현 선택)

### 11.6 Reconcile Identity 규칙 (MUST)

Runtime은 step.config 이후 reconcile 단계에서 배열(list)을 인덱스 기반이 아니라 identity 기반으로 비교해야 한다(MUST).

#### 11.6.1 Identity Key 정의 (MUST)

* ToolRef identity: `"{kind}/{name}"`
* ExtensionRef identity: `"{kind}/{name}"`
* MCPServerRef identity: `"{kind}/{name}"`
* Hook identity: `hook.id`(권장) 또는 `(point, priority, actionFingerprint)` 조합(SHOULD)

#### 11.6.2 Reconcile 알고리즘 요구사항 (MUST)

* 동일 identity key가 Effective Config에 계속 존재하는 한, Runtime은 해당 항목의 실행 상태를 유지해야 한다(MUST).
* 배열의 순서 변경은 연결/상태 재생성의 원인이 되어서는 안 된다(MUST).

#### 11.6.3 Stateful MCPServer 연결 유지 규칙 (MUST)

* `attach.mode=stateful`인 MCPServer는 동일 identity key로 Effective Config에 유지되는 동안 연결(프로세스/세션)을 유지해야 한다(MUST).
* Runtime이 stateful MCP 연결을 재연결할 수 있는 경우는 최소 다음에 한정되어야 한다(MUST).

  * MCPServer가 Effective Config에서 제거된 경우
  * MCPServer의 연결 구성(transport/attach/expose 등)이 변경되어 연결 호환성이 깨진 경우

---

## 12. Tool 스펙(런타임 관점)

### 12.1 도구 레지스트리와 도구 카탈로그

* Tool Registry: 실행 가능한 전체 도구 엔드포인트(핸들러 포함) 집합
* Tool Catalog: 특정 Step에서 LLM에 노출되는 도구 목록
  Runtime은 Step마다 `step.tools`를 통해 Tool Catalog를 구성한다.

### 12.2 tool call의 허용 범위

Runtime은 tool call 처리 시 허용 정책을 가질 수 있다(MAY).

* Catalog 기반 허용 / Registry 기반 허용은 구현 선택

### 12.3 동기/비동기 결과

* 동기 완료: `output` 포함
* 비동기 제출: `handle` 포함(완료 이벤트 또는 polling)

### 12.4 Live Config 변경의 표준 패턴 (MUST)

Tool/Extension/Sidecar는 Live Config 정본 파일을 직접 수정하지 않는다(MUST).
대신 §6.4.5의 Proposal API를 통해 patch를 제안하고, LiveConfigManager가 정본 기록 및 적용을 수행한다(MUST).

### 12.5 OAuth 토큰 접근 인터페이스

Tool/Connector 구현은 외부 API 호출을 위해 OAuth 토큰이 필요할 수 있다. Runtime은 Tool/Connector 실행 컨텍스트에 OAuthManager 인터페이스(`ctx.oauth`)를 제공해야 하며(SHOULD), OAuthManager는 시스템 전역 OAuthStore(§10.2)의 유일한 작성자로 동작해야 한다(MUST).

#### 12.5.1 ctx.oauth.getAccessToken (MUST)

Tool 또는 Connector는 다음 형태로 토큰을 요청할 수 있어야 한다.

```ts
ctx.oauth.getAccessToken({
  oauthAppRef: { kind: "OAuthApp"; name: string },
  scopes?: string[],          // 선택: OAuthApp.spec.scopes의 부분집합만 허용
  minTtlSeconds?: number      // 선택: 만료 임박 판단 기준
}) -> OAuthTokenResult
```

Runtime은 `getAccessToken` 호출에 대해 다음 의미론을 제공해야 한다(MUST).

1. Runtime은 `oauthAppRef`로 OAuthApp을 조회하고, OAuthApp의 `subjectMode`에 따라 Turn에서 subject를 결정한다(MUST).

   * `subjectMode=global`이면 `turn.auth.subjects.global`을 사용한다.
   * `subjectMode=user`이면 `turn.auth.subjects.user`를 사용한다.
2. Runtime은 요청 스코프를 “사전 고정” 규칙에 따라 결정해야 하며, 런타임 중 증분 확장을 수행해서는 안 된다(MUST).

   * `scopes`가 제공되면, Runtime은 `scopes ⊆ OAuthApp.spec.scopes`인지 검사해야 하며, 부분집합이 아니면 즉시 오류를 반환해야 한다(MUST).
   * `scopes`가 제공되지 않으면, Runtime은 `OAuthApp.spec.scopes`를 요청 스코프로 사용한다(SHOULD).
3. Runtime은 `(oauthAppRef, subject)` 키로 OAuthGrant를 조회한다(MUST).
4. Grant가 존재하고 토큰이 유효하면 `status="ready"`를 반환한다(MUST).
5. Grant가 없거나, 토큰이 무효/철회되었거나, 요청 스코프를 충족하지 못하면 Runtime은 AuthSession을 생성하고 `status="authorization_required"`를 반환해야 한다(MUST).
6. access token이 만료되었거나 만료 임박이면 Runtime은 refresh를 시도하는 것을 SHOULD 하며, 성공 시 갱신 저장 후 `ready`를 반환해야 한다(SHOULD).

#### 12.5.2 OAuthTokenResult (SHOULD)

`OAuthTokenResult`는 최소 다음 중 하나 형태를 가진다.

* `ready`는 실제 API 호출에 사용할 토큰을 제공한다.

```json
{
  "status": "ready",
  "accessToken": "*****",
  "tokenType": "bearer",
  "expiresAt": "2026-02-01T10:00:00Z",
  "scopes": ["chat:write"]
}
```

* `authorization_required`는 사용자 승인이 필요함을 나타내며, 에이전트가 사용자에게 안내할 수 있도록 메시지와 링크를 포함한다.

```json
{
  "status": "authorization_required",
  "authSessionId": "as-4f2c9a",
  "authorizationUrl": "https://provider.example/authorize?...",
  "expiresAt": "2026-01-31T09:20:01Z",
  "message": "외부 서비스 연결이 필요합니다. 아래 링크에서 승인을 완료하면 작업을 이어갈 수 있습니다."
}
```

* `error`는 비대화형 오류 또는 구성/컨텍스트 부족 등을 나타낸다.

```json
{
  "status": "error",
  "error": { "code": "subjectUnavailable", "message": "turn.auth.subjects.user 가 없어 사용자 토큰을 조회할 수 없습니다." }
}
```

#### 12.5.3 OAuthStore 파일시스템 저장소 및 암호화 규칙 (MUST)

Runtime은 OAuthGrant와 AuthSession을 시스템 전역 OAuthStore(§10.2)에 저장해야 한다(MUST). Runtime은 OAuthStore의 유일한 작성자이며, Tool/Extension/Sidecar는 OAuthStore 파일을 직접 읽거나 수정해서는 안 된다(MUST).

Runtime은 다음 보안 규칙을 만족해야 한다(MUST).

1. OAuthStore에 저장되는 모든 비밀값(accessToken, refreshToken, PKCE code_verifier, state 등)은 디스크에 평문으로 남지 않도록 반드시 at-rest encryption을 적용해야 한다(MUST).
2. Runtime은 토큰 및 민감 필드를 로그, 이벤트 payload, patch log, Effective Config, LLM 컨텍스트 블록에 평문으로 노출해서는 안 된다(MUST).
3. Runtime은 refresh 동시성 충돌을 방지하기 위해 `(oauthAppRef, subject)` 단위의 락 또는 단일 flight 메커니즘을 제공하는 것을 권장한다(SHOULD).

#### 12.5.4 OAuthGrantRecord 상태 레코드 스키마 (MUST)

OAuthGrantRecord는 “무엇을 저장하는지”를 정의하는 상태 레코드 스키마이며, 실제 저장 위치는 OAuthStore이다(MUST). OAuthGrantRecord의 예시는 다음과 같다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: OAuthGrantRecord
metadata:
  name: "sha256:<subjectHash>"
spec:
  provider: "slack"
  oauthAppRef: { kind: OAuthApp, name: "slack-bot" }
  subject: "slack:team:T111"
  flow: "authorization_code"          # MUST: authorization_code (device_code는 MAY)
  scopesGranted:
    - "chat:write"
    - "channels:read"
  token:
    tokenType: "bearer"
    accessToken: "<secret>"          # MUST: at-rest encryption 대상
    refreshToken: "<secret>"         # provider가 제공하는 경우에만
    expiresAt: "2026-02-01T10:00:00Z"
  createdAt: "2026-01-31T09:10:01Z"
  updatedAt: "2026-01-31T09:10:01Z"
  revoked: false
  providerData: {}                   # 선택: 공급자별 원문/파생 메타
```

#### 12.5.5 AuthSessionRecord 상태 레코드 스키마 (MUST)

AuthSessionRecord는 승인 진행 중 상태를 나타내며, Authorization Code + PKCE 플로우에서 callback 검증과 비동기 재개를 위해 사용된다(MUST). AuthSessionRecord는 승인 완료 또는 만료 후 정리될 수 있다(SHOULD).

```yaml
apiVersion: agents.example.io/v1alpha1
kind: AuthSessionRecord
metadata:
  name: "as-4f2c9a"
spec:
  provider: "slack"
  oauthAppRef: { kind: OAuthApp, name: "slack-bot" }

  subjectMode: "global"                     # OAuthApp.spec.subjectMode의 복사
  subject: "slack:team:T111"                # callback에서 반드시 검증할 기대값

  requestedScopes: ["chat:write","channels:read"]

  flow:
    type: "authorization_code"
    pkce:
      method: "S256"
      codeVerifier: "<secret>"              # MUST: at-rest encryption 대상
      codeChallenge: "<derived>"
    state: "<secret-or-signed>"             # MUST: at-rest encryption 대상

  status: "pending"                         # pending|completed|failed|expired
  createdAt: "2026-01-31T09:10:01Z"
  expiresAt: "2026-01-31T09:20:01Z"

  # 승인 완료 후 런타임이 어디로 재개 이벤트를 넣을지 정의한다.
  resume:
    swarmRef: { kind: Swarm, name: "default" }
    instanceKey: "1700000000.000100"        # 예: Slack thread_ts
    agentName: "planner"
    origin:
      connector: "slack-main"
      channel: "C123"
      threadTs: "1700000000.000100"
    auth:
      actor:
        type: "user"
        id: "slack:U234567"
      subjects:
        global: "slack:team:T111"
        user: "slack:user:T111:U234567"
```

#### 12.5.6 Authorization Code + PKCE(S256) 플로우 (MUST)

Runtime이 `authorization_required`를 반환할 때는 반드시 다음을 수행해야 한다(MUST).

1. Runtime은 `AuthSessionRecord`를 생성하고, PKCE `code_verifier`와 `state`를 포함한 세션 정보를 OAuthStore에 암호화 저장한다(MUST).
2. Runtime은 OAuth provider의 authorization URL을 생성할 때 PKCE 파라미터(`code_challenge`, `code_challenge_method=S256`)와 `state`를 포함해야 한다(MUST).
3. provider callback을 처리할 때 Runtime은 `state`로 AuthSession을 조회하고, 세션 만료/일회성/상태(`pending`)를 검증해야 하며, 검증에 실패하면 grant를 생성해서는 안 된다(MUST).
4. callback에서 Runtime은 코드 교환(token exchange)을 수행할 때 세션에 저장된 PKCE `code_verifier`를 사용해야 한다(MUST).
5. Runtime은 token exchange 결과가 세션의 기대 subject와 일치하는지 검증해야 한다(MUST). 특히 `subjectMode=user`인 경우, callback 결과의 리소스 소유자(예: provider의 user id)가 세션의 사용자 subject와 불일치하면 실패로 처리해야 하며, 다른 사용자에게 토큰이 귀속되는 것을 허용해서는 안 된다(MUST).
6. token exchange에 성공하면 Runtime은 `OAuthGrantRecord`를 생성/갱신하여 OAuthStore의 grants에 암호화 저장하고, AuthSession을 `completed`로 전이시킨 뒤 재사용 불가로 만들어야 한다(MUST).
7. Runtime은 승인 완료 후 `auth.granted` 이벤트를 `resume.agentName`의 이벤트 큐에 enqueue하여 비동기 재개를 트리거해야 한다(MUST). 이 이벤트는 `resume.origin`과 `resume.auth`를 Turn 컨텍스트로 사용해야 한다(SHOULD).

#### 12.5.7 Device Code 플로우 (MAY)

Runtime은 device code 플로우를 MAY 지원할 수 있다. Runtime이 이를 지원하지 않는다면, `flow=deviceCode`인 OAuthApp은 구성 로드/검증 단계에서 거부되어야 한다(MUST). device code 플로우를 지원하는 경우, Runtime은 사용자에게 제공할 `verificationUri`와 `userCode`를 `authorization_required`에 포함시키는 것을 SHOULD 하며, grant 저장과 비동기 재개는 authorization code 플로우와 동일한 원칙으로 동작해야 한다(SHOULD).

#### 12.5.8 승인 안내를 위한 컨텍스트 블록 주입 (SHOULD)

승인 흐름에서 “사용자에게 무엇을 어떻게 안내할지”는 에이전트가 결정할 수 있어야 하므로, Runtime은 `step.blocks`에서 승인 대기 정보를 컨텍스트 블록으로 주입하는 것을 권장한다(SHOULD). 이 블록에는 비밀값이 포함되어서는 안 되며(MUST), 에이전트가 사용자에게 안내할 최소 정보만 포함해야 한다.

권장 블록 예시는 다음과 같다.

```yaml
type: auth.pending
items:
  - authSessionId: "as-4f2c9a"
    oauthAppRef: { kind: OAuthApp, name: "slack-bot" }
    subjectMode: "global"
    authorizationUrl: "https://provider.example/authorize?..."
    expiresAt: "2026-01-31T09:20:01Z"
    message: "외부 서비스 연결이 필요합니다. 아래 링크에서 승인을 완료하면 작업을 이어갈 수 있습니다."
```

---

## 13. Extension 실행 인터페이스

### 13.1 엔트리포인트

Extension 구현은 `register(api)` 함수를 제공해야 하며, Runtime은 AgentInstance 초기화 시점에 확장 목록 순서대로 이를 호출해야 한다(MUST).

### 13.2 등록 API(개념 규격)

Runtime은 확장에 다음 기능을 제공할 수 있어야 한다(MAY/SHOULD).

* 파이프라인 등록: `api.pipelines.mutate(point, fn)`, `api.pipelines.wrap(point, fn)`
* 도구 등록: `api.tools.register(toolDef)`
* 이벤트 발행: `api.events.emit(type, payload)`
* 워크스페이스 접근: repo 확보, worktree 마운트, 파일 IO 등

### 13.3 실행 컨텍스트(ctx)

* `ctx.extState()` 등 확장별 상태 저장소 제공 MAY
* `ctx.instance.shared` 등 인스턴스 공유 상태 제공 MAY

### 13.4 OAuthManager 인터페이스(Extension/Runtime 내부)

Runtime은 OAuthApp을 해석하고 OAuthGrant를 관리하는 OAuthManager를 제공할 수 있다. Extension이 이를 활용할 수 있도록, 다음과 같은 인터페이스를 제공할 수 있다(MAY).

* `api.oauth.getAccessToken(...)` (Tool의 `ctx.oauth`와 동일한 결과 형태 권장)
* `api.oauth.getAuthorizationUrl(...)` 또는 `api.oauth.ensureGrant(...)` (구현 선택)

OAuthManager의 저장소 구조/보존/마스킹 정책은 구현에 따라 달라질 수 있다. 단, Tool/Connector가 “토큰을 얻는 방법”은 `getAccessToken` 류 인터페이스로 표준화하는 것을 SHOULD 한다.

---

## 14. Skill 패턴(Extension 기반 구현)

Skill은 SKILL.md 중심 번들로서 다음 기능을 통해 활용된다.

1. 스킬 카탈로그(메타) 제공
2. 선택 시 SKILL.md 전문과 경로 정보 제공
3. bash로 스크립트 실행

이 기능은 Extension으로 구현될 수 있으며 다음 포인트를 활용한다.

* `workspace.repoAvailable`: 스킬 디렉터리 스캔/인덱스 갱신
* `step.blocks`: 카탈로그/열린 스킬 본문 주입
* `skills.list`, `skills.open`: 스킬 목록/전문 로딩 tool 제공

---

## 15. 대표 도구 패턴: ToolSearch

ToolSearch는 LLM이 tool catalog를 탐색/요약할 수 있도록 제공되는 **Tool**이다.
ToolSearch는 검색 결과에 따라 다음 Step부터 필요한 도구를 활성화하기 위해 LiveConfigManager에 patch를 제안할 수 있다(§12.4).

---

## 16. 예상 사용 시나리오

### 16.1 Slack thread 기반 장기 작업

사용자가 Slack thread에서 Swarm을 호출하면 Connector는 thread 식별자를 instanceKey로 사용하여 동일 스레드의 요청이 동일 SwarmInstance로 라우팅되도록 할 수 있다. AgentInstance는 같은 스레드에 진행 업데이트/완료 보고를 전송한다.

### 16.2 repo가 추가되면서 스킬이 자연스럽게 활성화되는 흐름

AgentInstance가 작업 중 특정 repo를 확보하면 workspace 이벤트가 발생하고 Skill 확장은 해당 repo의 스킬을 스캔해 카탈로그를 갱신한다. 다음 Step에서 갱신된 스킬 카탈로그가 컨텍스트 블록에 포함될 수 있다.

### 16.3 ToolSearch로 도구 노출을 최적화하는 흐름

ToolSearch는 현재 tool catalog에서 필요한 도구를 찾아보고, 검색 결과에 따라 다음 Step부터 도구를 단계적으로 확장한다.

### 16.4 프리셋/번들 선택과 부분 덮어쓰기

조직 내 공통 정책을 리소스로 정의해두면 Agent는 selector+overrides 문법으로 이를 선택하고 일부만 덮어써 구성할 수 있다.

### 16.5 (Live Config) 도구 호출이 다음 Step의 toolset을 변경하는 흐름

1. Step N에서 LLM이 toolSearch 도구를 호출
2. toolSearch는 patch proposal을 제출
3. LiveConfigManager는 policy/allowList 검사 후 Patch Log 기록
4. Step N 종료
5. Step N+1의 `step.config`에서 patch 적용 → patch-status에 appliedAt/revision/stepId 기록
6. Step N+1부터 새 도구가 Catalog에 포함되어 LLM이 사용 가능

### 16.6 Slack OAuth 설치/토큰 사용 흐름(개념)

1. Slack Connector는 ingress 이벤트로부터 `turn.auth.actor`와 `turn.auth.subjects`를 설정한다. 예를 들어 `turn.auth.subjects.global = slack:team:<team_id>`, `turn.auth.subjects.user = slack:user:<team_id>:<user_id>` 형태로 채우는 것을 권장한다.
2. LLM이 `slack.postMessage`를 호출하면 Tool 구현은 `ctx.oauth.getAccessToken({ oauthAppRef: slack-bot })`로 토큰을 요청한다. 이때 `slack-bot` OAuthApp의 `subjectMode=global`이므로 Runtime은 `turn.auth.subjects.global`을 subject로 사용한다.
3. 토큰이 준비되어 있으면 `status="ready"`가 반환되고 Tool은 Slack API 호출을 수행한다.
4. 토큰이 없다면 `status="authorization_required"`가 반환되며, Runtime은 AuthSession을 생성해 `authorizationUrl`과 안내 메시지를 제공한다. 에이전트는 이 정보를 이용해 사용자에게 승인 링크를 안내한다.
5. 사용자가 승인을 완료하면 Runtime은 callback에서 PKCE/state/subject를 검증한 뒤 OAuthGrant를 저장하고, `auth.granted` 이벤트를 해당 인스턴스/에이전트로 enqueue하여 비동기 재개를 수행한다.


---

## 17. 기대 효과

1. 멀티 에이전트 구성과 컨텍스트 최적화 로직이 선언형 구성과 파이프라인으로 체계적으로 조직된다.
2. stateful long‑running 에이전트 경험을 Turn/Step 모델과 이벤트 큐로 일관되게 구현할 수 있다.
3. 확장을 통해 도구 카탈로그, 컨텍스트 조립, 메모리 축적/주입, 클라이언트 업데이트 전략을 모듈화할 수 있다.
4. 구성 파일 기반 정의로 재사용과 자동화가 쉬워지고 AI가 구성을 생성·수정·검토하는 흐름이 자연스럽다.
5. Live Config는 “파일로 관측 가능”하지만 정본 기록은 LiveConfigManager 단일 작성자 모델로 안정적으로 운영된다.
6. reconcile이 identity 기반으로 수행되고 stateful MCP 연결이 유지되어, 구성 진화가 불필요한 연결 흔들림을 유발하지 않는다.
7. OAuthApp 도입으로 Tool/Connector의 인증/토큰 취득 방식이 표준화되어, 통합 난이도와 운영 복잡성이 감소한다.

---

## 18. Bundle(확장 묶음)

Bundle은 Tool/Extension/Connector 등 **확장을 묶어서 등록**하기 위한 패키징 단위이다. Bundle의 실체는 `bundle.yaml`이 위치한 **폴더 전체**이며, 이 폴더 안에는 스크립트(예: Node/Python), YAML 정의, 기타 실행 리소스가 함께 포함될 수 있다.

Bundle은 **Git 기반으로 식별/다운로드**되는 것을 기본으로 한다. 번들 참조는 `github.com/<org>/<repo>/<path>@<ref?>` 형태를 권장하며, `@ref`가 없으면 기본 브랜치를 사용한다(MAY). 번들 다운로드 시 `bundle.yaml`이 있는 폴더는 **전체를 내려받아야** 하며, `spec.include`는 **최종 Config에 포함할 YAML 목록**을 정의할 뿐 다운로드 범위를 제한하지 않는다(MUST).

각 리소스의 `spec.entry` 경로는 **Bundle Root 기준 상대 경로**로 해석한다(MUST). 런타임은 등록된 Bundle의 리소스를 ConfigRegistry에 합쳐 사용하며, 충돌 시 정책에 따라 덮어쓰기/에러 처리한다(MAY).

npm은 **선택적 호스팅 채널**로만 활용할 수 있으며, 번들 배포/해석의 필수 요건은 아니다. 번들 스펙 및 상세 예시는 `docs/spec_bundle.md`를 참조한다.

예시:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Bundle
metadata:
  name: base
spec:
  dependencies:
    - github.com/goondan/foo-bar@v0.2.0
  include:
    - tools/fileRead/tool.yaml
    - extensions/skills/extension.yaml
```

---

## 부록 A. 실행 모델 및 훅 위치 다이어그램

### A-1. Instance → Turn → Step 라이프사이클과 파이프라인 포인트(ASCII)

```
[External Event via Connector]
          │
          ▼
   [SwarmInstance (instanceKey)]
          │
          ▼
   [AgentInstance Event Queue]
          │  (dequeue 1 event)
          ▼
     ┌───────────────┐
     │   Turn Start   │
     └───────────────┘
          │
          │ turn.pre        (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │            Step Loop (0..N)           │
   └───────────────────────────────────────┘
          │
          │ step.pre        (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.config     (Mutator)  [NEW]      │
   │  - apply Live Overlay → EffectiveCfg  │
   └───────────────────────────────────────┘
          │
          │ step.tools      (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.tools      (Mutator)             │
   │  - build/transform Tool Catalog       │
   └───────────────────────────────────────┘
          │
          │ step.blocks     (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.blocks     (Mutator)             │
   │  - build/transform Context Blocks     │
   └───────────────────────────────────────┘
          │
          │ step.llmCall    (Middleware)
          ▼
   ┌───────────────────────────────────────┐
   │ step.llmCall    (Middleware onion)    │
   │  EXT.before → CORE LLM → EXT.after    │
   └───────────────────────────────────────┘
          │
          ├──── tool calls exist? ────┐
          │                           │
          ▼                           ▼
 (for each tool call)            (no tool call)
          │
          │ toolCall.pre   (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ toolCall.exec   (Middleware onion)    │
   │  EXT.before → CORE exec → EXT.after   │
   └───────────────────────────────────────┘
          │
          │ toolCall.post  (Mutator)
          ▼
          │ step.post      (Mutator)
          ▼
     ┌───────────────────────┐
     │ Continue Step loop?   │
     └───────────────────────┘
          │yes                      │no
          └───────────┐             └─────────────┐
                      ▼                           ▼
                  (next Step)               turn.post (Mutator)
                                                │
                                                ▼
                                             Turn End
                                                │
                                                ▼
                                        wait next event…
```
