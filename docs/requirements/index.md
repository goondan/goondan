# Goondan: Agent Swarm Orchestrator 스펙 v0.11

본 문서는 “멀티 에이전트 오케스트레이션과 컨텍스트 최적화를 중심으로 한 에이전트 스웜”을 선언형 Config Plane(= SwarmBundle), stateful long-running Runtime Plane, 그리고 런타임 내부 SwarmBundleManager가 관리하는 Changeset → SwarmBundleRef 메커니즘(구성+코드 변경 반영, Git 기반)으로 구현하기 위한 통합 요구사항을 정의한다.

---

## 0. 규범적 표현

본 문서에서 MUST/SHOULD/MAY는 RFC 2119 스타일의 규범적 의미로 사용된다.

즉, 문장에 사용된 조동사는 “필수/권장/선택”의 구현 요구 수준을 나타내며, 구현체는 이를 기준으로 호환성과 기대 동작을 맞춰야 한다.

또한 예시는 이해를 돕기 위한 것으로, 실제 값/경로/그룹 이름 등은 구현에 따라 달라질 수 있다.

---

## 1. 배경

AI 에이전트 개발은 단일 에이전트의 tool-using loop를 넘어 멀티 에이전트 오케스트레이션, 장기 상태 유지, 외부 시스템 인증 통합, 런타임 중 구성 진화를 함께 다루는 단계로 빠르게 이동하고 있다.

실무 환경에서는 Slack/Telegram/CLI/Webhook 등 다중 채널을 동시에 지원해야 하고, 동일 사용자 맥락과 인증 주체를 장시간 보존해야 한다. 따라서 "모델 호출" 자체보다 Instance/Turn/Step 실행 모델, 파이프라인 확장, Tool/Extension 생태계, 보안/관측성 정책이 핵심 아키텍처가 된다.

---

## 2. 문제의식

### 2.1 에이전트 제작의 복잡성

모델, 프롬프트, 도구를 조합하는 수준을 넘어 멀티 에이전트 라우팅, 상태 보존, 인증, 변경 반영을 코드로 직접 묶으면 복잡성이 빠르게 증가한다.

### 2.2 에이전틱 루프의 라이프사이클 관리 필요

입력 정규화, 컨텍스트 구성, 도구 노출 제어, 실행 후 요약/회고, 승인 재개(auth.granted) 등은 실행 시점별 훅으로 관리되어야 한다.

### 2.3 Stateful long-running 에이전트의 복잡성

Turn 메시지 상태를 메모리 단일 배열로만 관리하면 메시지 단위 편집과 장애 복원 지점을 잃기 쉽다. `NextMessages = BaseMessages + SUM(Events)` 모델, 컨텍스트 윈도우 관리, 인스턴스 수명주기(pause/resume/delete/GC) 정책이 없으면 운영 일관성이 깨진다.

### 2.4 다양한 클라이언트 호출의 필요성

채널별 입력 포맷을 canonical event로 통일하고, 인증 주체를 안전하게 Turn에 전달해야 한다.

### 2.5 구성의 텍스트화 필요성

YAML 기반 선언형 구성은 재사용, 검증, 배포 자동화, AI-assisted 변경에 유리하다.

---

## 3. 솔루션 개요

본 솔루션은 다음 세 요소로 구성된다.

1. **Config Plane(= SwarmBundle)**
   SwarmBundle은 YAML 리소스와 프롬프트/도구/확장/커넥터 구현을 함께 포함하는 번들이다.

2. **Runtime Plane**
   Instance/Turn/Step 실행 모델과 라이프사이클 파이프라인을 제공한다. AgentInstance 이벤트 큐는 FIFO 직렬 처리 규칙을 따른다.

3. **SwarmBundleManager(Changeset → SwarmBundleRef)**
   `swarmBundle.openChangeset`/`swarmBundle.commitChangeset`으로 변경을 커밋하고, Safe Point(최소 `step.config`)에서 새 Ref를 활성화한다.

---

## 4. 목표와 비목표

### 4.1 목표

1. 멀티 에이전트 구성과 오케스트레이션을 선언형으로 정의할 수 있어야 한다.
2. stateful long-running 실행 모델을 표준화해야 한다.
3. 실행 라이프사이클 파이프라인으로 컨텍스트 최적화와 운영 훅을 모듈화해야 한다.
4. Connector/Connection 분리 모델로 채널 통합과 인증 바인딩을 표준화해야 한다.
5. Changeset → SwarmBundleRef로 런타임 중 구성+코드 변경을 안전하게 반영해야 한다.
6. 관측성(Trace/메트릭/토큰 사용량)과 보안(서명 검증/토큰 보호)을 기본 요구사항으로 포함해야 한다.

### 4.2 비목표

- 특정 LLM Provider/SDK 구현체에 종속되지 않는다.
- UI/프론트엔드 스펙은 범위에서 제외한다.
- 벡터 DB/평가 알고리즘 등 내부 알고리즘 선택은 확장 영역으로 둔다.
- 분산 클러스터/멀티 노드 스케줄링은 본 버전 범위에서 다루지 않는다.

---

## 5. 핵심 개념

Goondan은 SwarmInstance/AgentInstance 위에서 Turn(입력 1개 처리)과 Step(LLM 호출 중심 단위)을 반복한다. Step 실행 중 Effective Config와 SwarmBundleRef는 고정되어야 하며, 변경은 다음 Safe Point에서만 활성화된다.

Tool은 실행 단위이며, Extension은 파이프라인 포인트에 개입하는 실행 로직이다. Connector는 프로토콜 구현과 inbound 서명 검증을 수행하고, Connection은 인증 정보 제공과 ingress 라우팅을 담당하며, Extension과는 독립된 개념이다.

자세한 본문: @05_core-concepts.md

---

## 6. Config 스펙

Config 리소스는 `apiVersion/kind/metadata/spec` 공통 구조를 따른다. ObjectRef/Selector/Overrides 문법, Changeset commit 상태(`ok/rejected/conflict/failed`), ValueSource/SecretRef, 구성 검증 시점(로드 시)과 오류 보고 형식을 정의한다.

자세한 본문: @06_config-spec.md

---

## 7. Config 리소스 정의

Model/Tool/Extension/Agent/Swarm/Connector/Connection/OAuthApp/ResourceType를 정의한다. Connector는 trigger handler, canonical event 생성, inbound 서명 검증을 담당하고, Connection은 인증 정보 제공과 ingress 라우팅 규칙을 정의한다.

자세한 본문: @07_config-resources.md

---

## 8. Config 구성 단위와 패키징

패키징 요구사항은 의존성 DAG, 버전 제약, lockfile 재현성, values 병합 우선순위, 레지스트리/캐시 동작, 패키지 게시/폐기 라이프사이클, 레지스트리 인증을 포함해야 한다.

자세한 본문: @08_packaging.md

---

## 9. Runtime 실행 모델

Runtime은 canonical event를 Turn으로 변환하여 AgentInstance 큐에 enqueue하고 FIFO로 직렬 실행한다. Turn 메시지 처리는 `NextMessages = BaseMessages + SUM(Events)` 규칙으로 계산되며, handoff는 도구 호출 기반 비동기 패턴으로 처리된다. 또한 인스턴스 라이프사이클(pause/resume/terminate/delete/inspect), 코드 변경 반영 의미론(Safe Point 기반, hot-reload 금지), observability(traceId/token/latency) 요구사항을 포함한다.

자세한 본문: @09_runtime-model.md

---

## 10. 워크스페이스 모델

SwarmBundleRoot(정의), Instance State Root(실행 상태), System State Root(전역 상태)를 분리한다. 특히 Agent 메시지 저장소는 `base.jsonl`/`events.jsonl` 이원화 모델을 따라야 하며, 로그/메트릭/OAuth 저장소의 경로와 보안(at-rest encryption) 요구사항을 정의한다.

자세한 본문: @10_workspace-model.md

---

## 11. 라이프사이클 파이프라인(훅) 스펙

Mutator/Middleware 타입, 표준 포인트, 실행 순서(Extension 파이프라인 우선, Agent Hook 후순), 실패 처리, reconcile identity 규칙을 정의한다. Reconcile 대상은 "이전 활성 Effective Config ↔ 다음 활성 Effective Config"이다.

자세한 본문: @11_lifecycle-pipelines.md

---

## 12. Tool 스펙(런타임 관점)

Tool Registry/Catalog 구분, 허용 범위(기본 catalog 기반), 동기/비동기 결과, 오류 메시지 표준, Changeset 도구 패턴, OAuth 토큰 접근 인터페이스를 정의한다.

자세한 본문: @12_tool-spec-runtime.md

---

## 13. Extension 실행 인터페이스

Extension은 `register(api)`를 통해 파이프라인/도구/이벤트/OAuth API를 사용한다. `ctx.instance`, `ctx.extension.getState/setState`는 표준 컨텍스트로 제공되어야 한다.

자세한 본문: @13_extension-interface.md

---

## 14. 활용 예시 패턴

Skill, ToolSearch, 컨텍스트 compaction, handoff 같은 대표 패턴을 정리한다.

자세한 본문: @14_usage-patterns.md

---

## 15. 예상 사용 시나리오

Slack 장기 스레드, OAuth 승인 재개, 동시 Changeset 충돌 복구, ToolSearch 도구 최적화, 인스턴스 pause/resume, turn 중 장애 후 메시지 복원 시나리오를 정리한다.

자세한 본문: @15_usage-scenarios.md

---

## 16. 기대 효과

요구사항 적용 시 얻는 기술적/운영적 효과를 정리한다.

자세한 본문: @16_expected-outcomes.md

---

## 부록 A. 실행 모델 및 훅 위치 다이어그램

Instance → Turn → Step 실행 흐름과 핵심 파이프라인 포인트를 ASCII 다이어그램으로 제공한다.

자세한 본문: @appendix_a_diagram.md

---

## 변경 이력 및 정합성 검토

- 2026-02-08: §5.4.1 Connector 이벤트 수신 방식 구분(Runtime 관리 vs Custom) 추가, §7.6 `custom` trigger 규칙 추가, §9.1.3 Custom Trigger 실행 모델 추가. 관련 스펙 동기화: `docs/specs/connector.md`, `docs/specs/resources.md`.
- 2026-02-07: Turn 메시지 처리 모델을 `NextMessages = BaseMessages + SUM(Events)`로 전환. `base.jsonl`/`events.jsonl` 저장 구조, turn.post `(base, events)` 전달 및 최종 fold-commit 규칙 추가. 관련 요구사항/구현 스펙 동기화 완료.
- 2026-02-07: 영향 스펙 동기화: `docs/specs/runtime.md`, `docs/specs/workspace.md`, `docs/specs/pipeline.md`, `docs/specs/api.md`, `docs/specs/extension.md`, `docs/specs/tool.md`, `docs/specs/bundle.md`, `docs/specs/resources.md` 업데이트.
- 2026-02-07: `_improve-claude.md`, `_improve-codex.md` 반영.
- 2026-02-07: `7.7 Connection` 요구사항 추가, `8` 패키징 요구사항 확장, 인스턴스 라이프사이클/동시성/observability/오류 UX 요구사항 강화.
- 2026-02-07: `14~16` 섹션을 분할 파일로 독립.
- 2026-02-07: `docs/specs/*.md` 수정 필요 여부 검토 완료. 이번 변경은 요구사항 계층 정비 범위로 한정하며, 구현 스펙은 현행 문서와 정합하도록 요구사항을 상향/명확화함.
- 2026-02-07: §5 Connector/Connection을 Extension 하위에서 독립 섹션(5.4)으로 분리. §8 패키지 게시/폐기/인증 요구사항 추가. §9.4.5 코드 변경 반영 의미론 추가. §11.3.1 Extension-Hook 실행 순서 명시. §7.1 capability 불일치 거부 규칙 추가. §11.5/§15 workspace 비표준 포인트 정리.
