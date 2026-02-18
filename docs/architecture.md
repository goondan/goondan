# Goondan 아키텍처 개요

> "Kubernetes for Agent Swarm"

본 문서는 Goondan v0.0.3의 **시스템 설계 철학, 핵심 개념, 아키텍처 구조, 설계 패턴, 기대 효과**를 다룬다.
구현 상세(TypeScript 인터페이스, YAML 스키마, CLI 사용법 등)는 `docs/specs/` 디렉토리의 스펙 문서를 참고하고,
처음 접하는 개발자를 위한 실습 가이드는 `GUIDE.md`를 참고한다.

---

## 목차

1. [핵심 개념](#1-핵심-개념)
2. [아키텍처 다이어그램](#2-아키텍처-다이어그램)
3. [설계 패턴](#3-설계-패턴)
4. [사용 시나리오](#4-사용-시나리오)
5. [기대 효과](#5-기대-효과)
6. [스펙 문서 가이드](#6-스펙-문서-가이드)

---

## 1. 핵심 개념

Goondan v0.0.3은 세 개의 핵심 축으로 구성된다.

- **Config Plane**: `goondan.yaml` 기반 선언형 리소스 정의 (8종 Kind)
- **Runtime Plane**: Orchestrator 상주 프로세스 + Process-per-Agent 실행 모델 + IPC 메시지 브로커
- **Edit & Restart**: 설정 파일 수정 후 Orchestrator가 영향받는 에이전트 프로세스만 재시작하는 운영 모델

### 1.1 Orchestrator

`gdn run`으로 기동되는 **상주 프로세스**다. Swarm 전체의 생명주기를 관리하며, 다음 역할을 수행한다.

실제 실행 엔진 엔트리(`runtime-runner`)는 `@goondan/runtime` 패키지가 소유하며, CLI는 이 엔진을 기동/재기동/관측하는 제어면으로 동작한다.

- `goondan.yaml` 파싱 및 리소스 로딩
- AgentProcess와 ConnectorProcess의 스폰, 감시, 재시작
- IPC 메시지 브로커: 통합 이벤트(`AgentEvent`) 기반 에이전트 간 라우팅
- 설정 변경 감지 (`--watch` 모드)

Orchestrator는 에이전트가 모두 종료되어도 상주하며, 새로운 이벤트(Connector 수신, CLI 입력 등)가 오면 필요한 AgentProcess를 다시 스폰한다.

### 1.2 AgentProcess

Agent 정의를 바탕으로 생성되는 **독립 Bun 프로세스**다. 각 AgentInstance는 자체 메모리 공간을 가지며, 크래시 시 Orchestrator가 감지하여 자동 재스폰한다. 프로세스 간 상태 공유는 IPC를 통해서만 이루어진다.

### 1.3 ConnectorProcess

Connector는 외부 채널 이벤트를 canonical `ConnectorEvent`로 정규화하는 프로토콜 어댑터다. **별도 Bun 프로세스**로 실행되며, 프로토콜 수신(HTTP 서버, cron 스케줄러, WebSocket, 롱 폴링 등)을 자체적으로 관리한다. Runtime이 프로토콜을 대신 관리하지 않는다.

### 1.4 Turn과 Step

- **Turn**: AgentProcess가 하나의 입력 이벤트(`AgentEvent`)를 처리하는 단위. 필요한 Step을 반복한 후 종료한다. AgentInstance 이벤트 큐는 FIFO 직렬 처리된다.
- **Step**: LLM 호출 1회를 중심으로 하는 실행 단위. LLM 응답의 tool call 처리까지 포함한다. LLM이 도구 호출 없이 텍스트만 반환하면 Turn이 종료된다.

### 1.5 IPC (Inter-Process Communication)

에이전트 간 통신은 통합 이벤트 모델(`AgentEvent`)을 사용하며, Orchestrator를 경유하는 메시지 패싱으로 이루어진다.

- 모든 에이전트 입력(Connector 이벤트, 에이전트 간 요청, CLI 입력)은 `AgentEvent`로 통합된다.
- `AgentEvent.replyTo`가 있으면 request(응답 대기), 없으면 send(fire-and-forget) 패턴이다.
- 요청-응답은 `replyTo.correlationId`를 통해 원래 요청자에게 반환된다.
- IPC 메시지 타입: `event`, `shutdown`, `shutdown_ack`

### 1.6 Message와 이벤트 소싱

모든 LLM 메시지는 AI SDK의 `CoreMessage`를 `Message`로 감싸서 관리한다. `Message`는 고유 ID, metadata, 생성 시각, 소스 정보를 포함하여 메시지 식별, 필터링, 조작 판단에 활용된다.

메시지 상태는 **이벤트 소싱 모델**로 관리한다.

```
NextMessages = BaseMessages + SUM(Events)
```

- `BaseMessages`: Turn 시작 시 디스크(`base.jsonl`)에서 로드된 기준 메시지 집합
- `Events`: Turn 중 누적되는 `MessageEvent` 집합 (`append`, `replace`, `remove`, `truncate`)
- `RuntimeEvents`: Turn/Step/Tool 실행 관측 이벤트 집합 (`runtime-events.jsonl`)
- Turn 종료 시 최종 `BaseMessages + SUM(Events)`를 새로운 base로 저장하고, Events를 비운다
- `runtime-events.jsonl`은 관측성 용도로 append-only 기록되며 `NextMessages` 계산에는 포함되지 않는다
- 복구 시 `base + events` 재생으로 정확한 상태를 복원할 수 있다

Extension 미들웨어는 메시지를 직접 배열 변경하는 대신 `MessageEvent`를 발행하여 조작한다. 이 모델은 메시지 단위 편집 유연성과 장애 복원 가능성을 동시에 확보한다.

### 1.7 Tool

Tool은 LLM이 tool call로 호출하는 1급 실행 단위다. LLM에 노출되는 도구 이름은 **`{Tool 리소스 이름}__{하위 도구 이름}`** 형식을 따른다(더블 언더스코어 구분자).

```
Tool 리소스: bash        -> exports: exec, script
LLM 도구 이름: bash__exec, bash__script
```

Tool 오류는 예외 전파 대신 구조화된 ToolResult로 LLM에 전달된다.

### 1.8 Extension과 미들웨어

Extension은 런타임 라이프사이클에 개입하는 미들웨어 로직 묶음이다. 모든 파이프라인 훅은 **Middleware** 형태로 통일되며, `next()` 호출 전후로 전처리(pre)/후처리(post)를 수행하는 Onion 모델을 따른다.

| 미들웨어 | 감싸는 범위 | 전처리(next 전) | 후처리(next 후) |
|----------|-----------|----------------|----------------|
| `turn` | Turn 전체 | 메시지 히스토리 조작, message-window/message-compaction | 결과 후처리 |
| `step` | Step(LLM 호출 + 도구 실행) | 도구 카탈로그 조작, 메시지 이벤트 발행 | 결과 변환, 로깅, 재시도 |
| `toolCall` | 개별 도구 호출 | 입력 검증/변환 | 결과 변환/로깅 |

미들웨어 실행 순서는 Extension 등록 순서를 따르며, `next()`를 호출하지 않으면 해당 실행 단계가 스킵된다.

### 1.9 Connector와 Connection

- **Connector**: 외부 채널 이벤트를 정규화하는 프로토콜 어댑터. 별도 프로세스로 프로토콜을 자체 관리하므로, 프로토콜 구현과 배포 바인딩을 독립적으로 발전시킬 수 있다.
- **Connection**: Connector를 특정 배포 환경에 바인딩하는 리소스. `config`(동작 설정)와 `secrets`(민감값)를 제공하고, ingress 라우팅 규칙을 정의한다. 하나의 Connector를 여러 Connection이 서로 다른 설정/라우팅으로 재사용할 수 있다.

### 1.10 Bundle과 Package

- **Bundle**: YAML 리소스와 소스코드를 함께 포함하는 폴더 트리. 기본 번들 파일은 `goondan.yaml`이며, 단일 파일에 다중 문서(`---`)를 포함하거나 여러 YAML 파일로 분리 가능하다.
- **Package**: goondan 프로젝트의 최상위 리소스. 의존성 해석, 배포, 버전 관리를 위한 메타데이터를 포함하며 DAG 의존성, lockfile 재현성, values 병합 우선순위를 지원한다.

### 1.11 Edit & Restart

설정 변경은 파일 수정 + Orchestrator 재시작이라는 직관적 모델을 따른다.

- `goondan.yaml` 또는 개별 리소스 파일을 수정하면, Orchestrator가 설정 변경을 감지(`--watch` 모드)하거나 CLI 명령(`gdn restart`)을 수신하여 해당 에이전트 프로세스를 재시작한다.
- 재시작 시 기본적으로 기존 대화 히스토리를 유지한다. `--fresh` 옵션으로 초기화를 선택할 수 있다.
- Orchestrator는 영향받는 AgentProcess만 선택적으로 재시작하며, 변경되지 않은 프로세스는 계속 실행 상태를 유지한다.

---

## 2. 아키텍처 다이어그램

### 2.1 Orchestrator - AgentProcess/ConnectorProcess 프로세스 구조

```
                    ┌─────────────────────────────────────────────┐
                    │          Orchestrator (상주 프로세스)          │
                    │                                             │
                    │  - goondan.yaml 파싱/리소스 로딩             │
                    │  - 프로세스 스폰/감시/재시작                  │
                    │  - IPC 메시지 브로커 (AgentEvent 통합 라우팅)  │
                    │  - 설정 변경 감지 (--watch)                  │
                    └───────┬──────────────┬──────────────┬───────┘
                            │              │              │
                     IPC    │       IPC    │       IPC    │
                            │              │              │
                    ┌───────▼──────┐ ┌─────▼──────┐ ┌────▼─────────────┐
                    │ AgentProcess │ │ AgentProcess│ │ ConnectorProcess │
                    │   (Agent A)  │ │  (Agent B)  │ │   (telegram)     │
                    │              │ │             │ │                  │
                    │ Turn → Step  │ │ Turn → Step │ │ 자체 HTTP 서버   │
                    │   루프 실행  │ │   루프 실행 │ │ /cron 등 프로토콜│
                    └──────────────┘ └─────────────┘ └──────────────────┘
```

### 2.2 AgentProcess 내부: Turn - Step 실행 흐름과 3-Layer 미들웨어

```
[Orchestrator로부터 AgentEvent 수신 (IPC)]
          │
          ▼
   [AgentProcess (agentName, instanceKey)]
          │
          │ 메시지 상태 로드
          │  - base.jsonl → BaseMessages
          │  - events.jsonl → 잔존 Events (크래시 복원 시)
          │  - runtime-events.jsonl → Turn/Step/Tool 관측 로그 (상태 복원 입력 아님)
          ▼
   ┌──────────────────────────────────────────────────────────┐
   │                                                          │
   │  ┌────────────────────────────────────────────────────┐  │
   │  │         Turn Middleware (onion 체이닝)              │  │
   │  │                                                    │  │
   │  │  Extension A (turn) ─┐                             │  │
   │  │  Extension B (turn) ─┤  next() 전 = 전처리(pre)    │  │
   │  │        ...           │                             │  │
   │  │                      ▼                             │  │
   │  │  ┌──────────────────────────────────────────────┐  │  │
   │  │  │         코어 Turn 로직                       │  │  │
   │  │  │                                              │  │  │
   │  │  │  ConversationState 준비                      │  │  │
   │  │  │   - baseMessages 로드                        │  │  │
   │  │  │   - emitMessageEvent → events 누적           │  │  │
   │  │  │   - nextMessages = base + SUM(events)        │  │  │
   │  │  │                                              │  │  │
   │  │  │  ┌──────────── Step Loop (0..N) ──────────┐  │  │  │
   │  │  │  │                                        │  │  │  │
   │  │  │  │  ┌──────────────────────────────────┐  │  │  │  │
   │  │  │  │  │  Step Middleware (onion 체이닝)   │  │  │  │  │
   │  │  │  │  │                                  │  │  │  │  │
   │  │  │  │  │  next() 전:                      │  │  │  │  │
   │  │  │  │  │   - toolCatalog 조작 가능        │  │  │  │  │
   │  │  │  │  │   - emitMessageEvent 가능        │  │  │  │  │
   │  │  │  │  │                                  │  │  │  │  │
   │  │  │  │  │  ┌────────────────────────────┐  │  │  │  │  │
   │  │  │  │  │  │  코어 Step 로직            │  │  │  │  │  │
   │  │  │  │  │  │                            │  │  │  │  │  │
   │  │  │  │  │  │  1. LLM 호출               │  │  │  │  │  │
   │  │  │  │  │  │     (toLlmMessages() 전달) │  │  │  │  │  │
   │  │  │  │  │  │                            │  │  │  │  │  │
   │  │  │  │  │  │  2. 응답 파싱              │  │  │  │  │  │
   │  │  │  │  │  │     ├─ 텍스트만 → Step 종료│  │  │  │  │  │
   │  │  │  │  │  │     └─ tool_calls 존재:    │  │  │  │  │  │
   │  │  │  │  │  │                            │  │  │  │  │  │
   │  │  │  │  │  │  3. 각 tool call 실행:     │  │  │  │  │  │
   │  │  │  │  │  │  ┌──────────────────────┐  │  │  │  │  │  │
   │  │  │  │  │  │  │ ToolCall Middleware  │  │  │  │  │  │  │
   │  │  │  │  │  │  │  (onion 체이닝)     │  │  │  │  │  │  │
   │  │  │  │  │  │  │                     │  │  │  │  │  │  │
   │  │  │  │  │  │  │ next() 전:          │  │  │  │  │  │  │
   │  │  │  │  │  │  │  - args 검증/변환   │  │  │  │  │  │  │
   │  │  │  │  │  │  │                     │  │  │  │  │  │  │
   │  │  │  │  │  │  │ ┌─────────────────┐ │  │  │  │  │  │  │
   │  │  │  │  │  │  │ │ 코어 Tool 실행  │ │  │  │  │  │  │  │
   │  │  │  │  │  │  │ │ (ToolHandler)   │ │  │  │  │  │  │  │
   │  │  │  │  │  │  │ └─────────────────┘ │  │  │  │  │  │  │
   │  │  │  │  │  │  │                     │  │  │  │  │  │  │
   │  │  │  │  │  │  │ next() 후:          │  │  │  │  │  │  │
   │  │  │  │  │  │  │  - 결과 변환/로깅   │  │  │  │  │  │  │
   │  │  │  │  │  │  └──────────────────────┘  │  │  │  │  │  │
   │  │  │  │  │  │                            │  │  │  │  │  │
   │  │  │  │  │  └────────────────────────────┘  │  │  │  │  │
   │  │  │  │  │                                  │  │  │  │  │
   │  │  │  │  │  next() 후:                      │  │  │  │  │
   │  │  │  │  │   - 결과 검사/변환               │  │  │  │  │
   │  │  │  │  │   - 로깅, 재시도 판단            │  │  │  │  │
   │  │  │  │  └──────────────────────────────────┘  │  │  │  │
   │  │  │  │                                        │  │  │  │
   │  │  │  │  tool_calls 있으면 → 다음 Step         │  │  │  │
   │  │  │  │  텍스트 응답만 있으면 → Step Loop 종료  │  │  │  │
   │  │  │  └────────────────────────────────────────┘  │  │  │
   │  │  │                                              │  │  │
   │  │  └──────────────────────────────────────────────┘  │  │
   │  │                      ▲                             │  │
   │  │  Extension B (turn) ─┤  next() 후 = 후처리(post)   │  │
   │  │  Extension A (turn) ─┘                             │  │
   │  │                                                    │  │
   │  └────────────────────────────────────────────────────┘  │
   │                                                          │
   └──────────────────────────────────────────────────────────┘
          │
          │ Turn 종료 처리
          ▼
   ┌──────────────────────────────────────────────────────────┐
   │ 메시지 상태 영속화                                       │
   │                                                          │
   │  1. events → base 폴딩                                   │
   │     NextMessages = BaseMessages + SUM(Events)            │
   │  2. base.jsonl 갱신 (확정된 Message 목록)                │
   │  3. events.jsonl 클리어                                  │
   │  4. runtime-events.jsonl append-only 유지                │
   │  5. Extension 상태 디스크 기록                           │
   └──────────────────────────────────────────────────────────┘
          │
          ▼
   다음 이벤트 대기 (Orchestrator IPC 수신)
```

### 2.3 메시지 상태 모델: 이벤트 소싱 흐름

```
   Turn 시작
       │
       ▼
  ┌─────────────────┐
  │  base.jsonl     │ ──→ BaseMessages 로드
  │  (확정 메시지)  │
  └─────────────────┘
       │
       │  + 미들웨어 emitMessageEvent()
       │    (append / replace / remove / truncate)
       ▼
  ┌─────────────────┐
  │  events.jsonl   │ ──→ Events 누적
  │  (이벤트 로그)  │
  └─────────────────┘
       │
       │  NextMessages = Base + SUM(Events)
       ▼
  ┌─────────────────┐
  │  nextMessages   │ ──→ toLlmMessages() → LLM 호출
  │  (계산된 상태)  │
  └─────────────────┘
       │
       │  Turn 종료
       ▼
  ┌─────────────────┐
  │  base.jsonl     │ ──→ events 폴딩된 새 base
  │  (갱신)         │
  └─────────────────┘
  ┌─────────────────┐
  │  events.jsonl   │ ──→ 클리어
  │  (비움)         │
  └─────────────────┘
  ┌─────────────────────────────┐
  │  runtime-events.jsonl       │ ──→ append-only 유지
  │  (Turn/Step/Tool 관측 로그) │     (상태 계산 미포함)
  └─────────────────────────────┘
```

---

## 3. 설계 패턴

Goondan의 Extension 시스템은 다양한 설계 패턴을 미들웨어 조합으로 구현할 수 있다.

### 3.1 Skill 패턴

Skill은 `SKILL.md` 중심 파일 번들을 런타임에 노출하는 Extension 패턴이다. `step` 미들웨어에서 스킬 관련 도구를 `toolCatalog`에 추가하고, 스킬 컨텍스트를 메시지 이벤트로 주입한다. `turn` 미들웨어에서 스킬 실행 결과를 Turn 단위로 추적하고 후처리한다.

핵심 동작:
1. 스킬 카탈로그 인덱싱
2. 선택된 스킬 본문 로드
3. 스크립트 실행 연결

### 3.2 ToolSearch 패턴

ToolSearch는 LLM이 "다음 Step에서 필요한 도구"를 선택하도록 돕는 메타 도구다. 현재 Catalog를 기반으로 검색/요약하고, 결과를 Extension 상태(`api.state`)에 저장한다. `step` 미들웨어에서 저장된 결과를 참조하여 `ctx.toolCatalog`를 동적으로 조정함으로써, LLM에 노출되는 도구 수를 최적화한다.

도구 수가 많은 Swarm에서 과도한 도구 노출을 줄여 LLM의 도구 선택 정확도를 높이는 데 유용하다.

### 3.3 컨텍스트 윈도우 최적화 패턴 (Message Window + Compaction)

컨텍스트 윈도우 관리는 코어 런타임의 강제 책임이 아니며, Extension의 `turn` 미들웨어로 구현한다. `emitMessageEvent`로 MessageEvent를 발행하여 메시지를 조작한다.
`@goondan/base`는 이 패턴의 기본 구현으로 `message-window`, `message-compaction` Extension을 제공한다.

권장 전략:
- **Sliding window**: 오래된 메시지 `remove` 이벤트 발행
- **Turn 요약(compaction)**: 복수 메시지를 `remove` 후 요약 메시지 `append`
- **중요 메시지 pinning**: `metadata`에 `pinned: true` 표시하여 compaction 대상에서 제외
- **Truncate**: 전체 메시지 초기화 후 요약 `append`

모든 compaction 작업은 `MessageEvent`를 통해 이루어지므로 `base + events` 이벤트 소싱 구조가 유지된다. compaction 과정은 traceId 기준으로 추적 가능하다.

### 3.4 통합 이벤트 기반 에이전트 통신 패턴

에이전트 간 통신은 통합 이벤트 모델(`AgentEvent`)을 사용하며, Orchestrator를 경유하는 IPC로 구현된다. 두 가지 패턴을 지원한다:

- **request (tool 경로)**: `agents__request` 도구 호출로 요청-응답을 매칭한다.
- **request (middleware 경로)**: `turn`/`step` 미들웨어에서 `ctx.agents.request`로 요청-응답을 매칭한다.
- **send** (fire-and-forget): `AgentEvent.replyTo`를 생략하여 단방향 알림을 보낸다.
- **보조 운영 API**: `agents__spawn`(인스턴스 준비), `agents__list`(spawn 목록 복원), `agents__catalog`(호출 가능한 Agent 카탈로그 조회)

tool request 흐름:
1. 원 Agent가 `agents__request` 도구를 호출한다.
2. AgentProcess가 Orchestrator에 IPC `event` 메시지를 전송한다 (`AgentEvent.replyTo` 포함).
3. Orchestrator가 대상 AgentProcess로 라우팅한다 (필요시 스폰).
4. 대상 Agent의 Turn 완료 후 Orchestrator에 응답 `event`를 전송한다.
5. Orchestrator가 `correlationId`로 매칭하여 원 Agent에 결과를 전달한다.

middleware request 흐름:
1. Extension의 `turn`/`step` 미들웨어가 `ctx.agents.request`를 호출한다.
2. AgentProcess가 동일한 IPC `event` 경로로 Orchestrator에 요청을 전달한다.
3. Orchestrator가 대상 AgentProcess로 라우팅한다 (필요시 스폰).
4. 대상 Agent의 응답이 원 미들웨어로 반환된다.

trace 컨텍스트는 `replyTo.correlationId`로 보존되며, 프로세스 격리를 유지하면서 IPC를 통해서만 통신한다.

### 3.5 MCP Extension 패턴

MCP(Model Context Protocol) 연동은 MCP 서버의 tool/resource/prompt를 런타임에 연결하는 Extension 패턴이다. Extension의 `tools.register`를 통해 MCP 서버가 제공하는 도구를 동적으로 등록하는 방식으로 구현할 수 있다.

---

## 4. 사용 시나리오

### 4.1 Slack thread 기반 장기 작업

사용자가 Slack thread에서 Swarm을 호출하면, Connection 규칙이 thread 식별자를 `instanceKey`로 계산해 동일 스레드를 동일 인스턴스로 라우팅한다. Connector는 별도 Bun 프로세스로 Slack 이벤트를 수신하고, ConnectorEvent를 Orchestrator에 IPC로 전달한다. Orchestrator는 해당 instanceKey의 AgentProcess로 라우팅하며, AgentProcess가 없으면 자동 스폰한다.

### 4.2 Edit & Restart

운영자 또는 개발자가 에이전트 동작을 변경하고자 할 때:

1. `goondan.yaml` 또는 개별 리소스 파일을 수정한다.
2. Orchestrator가 설정 변경을 감지하거나(`--watch` 모드), 운영자가 `gdn restart` 명령을 실행한다.
3. Orchestrator가 **영향받는 AgentProcess만** kill하고, 새 설정으로 re-spawn한다.
4. 기본적으로 기존 대화 히스토리(`base.jsonl`)가 유지되어 대화 연속성이 보장된다.
5. `--fresh` 옵션을 사용하면 대화 히스토리를 초기화하고 새로 시작할 수 있다.

변경되지 않은 AgentProcess와 ConnectorProcess는 계속 실행 상태를 유지한다.

### 4.3 Watch 모드 개발

개발 중 빠른 반복을 위해 watch 모드를 사용한다:

1. `gdn run --watch`로 Orchestrator를 기동한다.
2. 개발자가 Tool 구현 파일, Extension 파일, 또는 `goondan.yaml`을 편집한다.
3. Orchestrator가 파일 변경을 감지하고, 영향받는 리소스를 판별한다.
4. 해당 리소스를 사용하는 AgentProcess를 자동으로 kill -> re-spawn한다.
5. 새 AgentProcess는 업데이트된 코드/설정으로 기동되며, 기존 대화 히스토리를 이어받는다.

Watch 모드는 `goondan.yaml` 및 리소스 `spec.entry`에 선언된 파일을 감시하며, 빈번한 변경에 대해 debounce를 적용한다.

### 4.4 ToolSearch 기반 도구 최적화

Agent가 ToolSearch 메타 도구로 필요한 도구를 탐색한 뒤, Extension이 다음 Step의 `toolCatalog`를 조정해 과도한 도구 노출을 줄인다. 도구 수가 많은 Swarm에서 LLM의 도구 선택 정확도를 높이는 데 활용한다.

### 4.5 AgentProcess 크래시 후 복원

AgentProcess가 비정상 종료되었을 때:

1. Orchestrator가 자식 프로세스의 exit 이벤트를 감지한다.
2. Orchestrator가 즉시 해당 Agent의 새 프로세스를 자동 re-spawn한다.
3. 새 AgentProcess는 마지막 `base.jsonl`과 잔존 `events.jsonl`을 읽어 `NextMessages = BaseMessages + SUM(Events)`를 재계산한다.
4. 복원된 메시지 상태로 새로운 이벤트 처리를 재개한다.

반복 크래시(crash loop) 감지 시 재시작 간격을 점진적으로 늘리며, 크래시 원인을 로그에 기록하여 디버깅을 돕는다.

### 4.6 AgentProcess 수동 재시작

운영자가 실행 중인 특정 Agent를 재시작하고자 할 때:

1. `gdn restart --agent coder` 명령을 실행한다.
2. 명령이 실행 중인 Orchestrator에 IPC/신호를 전송한다.
3. Orchestrator가 해당 Agent의 모든 인스턴스 프로세스를 kill한다.
4. Orchestrator가 새 설정으로 AgentProcess를 re-spawn한다.
5. 새 프로세스는 `base.jsonl` + 잔존 `events.jsonl`에서 메시지 상태를 복원한다.

`gdn restart --fresh`를 사용하면 모든 AgentProcess의 대화 히스토리를 초기화하고 재시작한다.

---

## 5. 기대 효과

### 5.1 프로세스 격리로 안정성 향상

Process-per-Agent 모델로 개별 에이전트 크래시가 다른 에이전트에 영향을 미치지 않으며, Orchestrator가 자동 재스폰하여 시스템 가용성을 높인다.

### 5.2 Bun 네이티브 성능

Bun 런타임 전용 설계로 빠른 프로세스 기동, 네이티브 TypeScript 지원, 효율적인 IPC를 활용하여 에이전트 스웜의 전체 성능을 개선한다.

### 5.3 미들웨어 단순화로 개발 생산성 향상

13개 세분화 파이프라인 포인트(Mutator + Middleware)를 3개 미들웨어(turn/step/toolCall)로 통합하여, Extension 개발자의 학습 곡선을 낮추고 코드 복잡성을 줄인다. `next()` 전후로 전처리/후처리를 수행하는 일관된 패턴으로 가독성이 높아진다.

### 5.4 Edit & Restart 단순성

설정 변경은 파일 수정 + Orchestrator 재시작 모델을 사용한다. Watch 모드로 개발 중 자동 반영이 가능해 개발 속도가 향상된다.

### 5.5 이벤트 소싱 메시지 모델

`NextMessages = BaseMessages + SUM(Events)` 모델로 메시지 단위 편집 유연성과 장애 복원 가능성을 동시에 확보한다. `base.jsonl` + `events.jsonl` 이원화 저장으로 Turn 중 크래시 시에도 정확한 상태 복원이 가능하며, `runtime-events.jsonl`은 관측성 스트림으로 분리해 상태 계산과 독립적으로 유지한다.

### 5.6 Connector/Connection 분리로 독립적 진화

Connector가 별도 프로세스로 프로토콜을 자체 관리하므로, 프로토콜 구현과 배포 바인딩을 독립적으로 발전시킬 수 있다. Connection은 라우팅과 인증 바인딩에만 집중한다.

### 5.7 리소스 Kind 축소로 인지 부하 감소

8종 Kind(Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)로 개념 경계를 유지하여 개발자가 파악해야 할 대상 수를 줄인다. OAuth는 Extension 내부 구현으로 다룬다.

### 5.8 도구 이름 규칙 표준화

`{리소스명}__{하위도구명}` 더블 언더스코어 규칙으로 도구의 소속과 기능을 명확히 구분하며, AI SDK 호환성을 유지한다.

### 5.9 Workspace 2-root 단순화

2-root(프로젝트 디렉토리 + `~/.goondan/`) 구조로 파일 경로 관리를 단순화하고, 개발자의 프로젝트 구조 이해를 돕는다.

### 5.10 Observability 표준화

traceId, tokenUsage, latency 등 관측성 표준으로 디버깅과 비용 추적이 용이하다. Turn/Step/Tool 실행 이벤트를 `runtime-events.jsonl`에 저장해 `gdn studio` 시각화 입력으로 재사용할 수 있고, 각 AgentProcess의 stdout/stderr로도 로그를 직접 확인할 수 있어 운영 추적이 단순해진다.

### 5.11 패키징 생태계

DAG 의존성, lockfile 재현성, values 병합 우선순위 등 패키징 요구사항으로 재현 가능한 배포와 생태계 확장을 지원한다.

### 5.12 오류 UX 개선

오류 코드 + `suggestion`/`helpUrl` 패턴으로 개발자 경험(DX)과 복구 속도를 개선한다.

---

## 6. 스펙 문서 가이드

각 스펙 문서가 다루는 범위를 안내한다. 구현 상세와 인터페이스 정의는 해당 문서를 참고한다.

| 문서 | 범위 |
|------|------|
| `specs/help.md` | 스펙 운영 도움말 - 문서 소유권 매트릭스, 공통 계약(ObjectRef/ValueSource/env 해석), 레지스트리 설정 우선순위, `gdn package` 도움말 기준, 문서 링크 자동 점검 체크리스트 |
| `specs/shared-types.md` | 공통 타입 SSOT - Json/ObjectRef/ValueSource/MessageEvent/AgentEvent/EventEnvelope/ExecutionContext/ProcessStatus/IpcMessage/TurnResult/ToolCallResult |
| `specs/resources.md` | Config Plane 리소스 정의 - 8종 Kind(Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package), ObjectRef, Selector+Overrides, ValueSource |
| `specs/runtime.md` | Orchestrator 상주 프로세스, Process-per-Agent 실행 모델, `@goondan/runtime/runner` 실행 엔진, IPC 메시지 브로커, Turn/Step 흐름, Message 이벤트 소싱, Runtime Event Stream(`runtime-events.jsonl`), Edit & Restart, Observability |
| `specs/pipeline.md` | 라이프사이클 파이프라인 - Middleware 3종(turn/step/toolCall), Onion 모델, ConversationState 이벤트 소싱, PipelineRegistry |
| `specs/tool.md` | Tool 시스템 - 더블 언더스코어 네이밍, ToolContext, 통합 이벤트 기반 에이전트 간 통신, Bun-only 실행 |
| `specs/extension.md` | Extension 시스템 - ExtensionApi(pipeline/tools/state/events/logger), Middleware 파이프라인, Skill/ToolSearch/MessageWindow/Compaction/Logging/MCP 패턴 |
| `specs/connector.md` | Connector 시스템 - 별도 Bun 프로세스, 자체 프로토콜 관리, ConnectorEvent 발행 |
| `specs/connection.md` | Connection 시스템 - config/secrets 분리 전달, Ingress 라우팅 규칙, 서명 검증 |
| `specs/bundle.md` | Bundle YAML - goondan.yaml 구조, 8종 Kind, 로딩/검증 규칙, YAML 보안 |
| `specs/bundle_package.md` | Package - 프로젝트 매니페스트, `~/.goondan/packages/`, 레지스트리 API, CLI 명령어 |
| `specs/workspace.md` | Workspace 및 Storage 모델 - 2루트 분리(Project Root + System Root), Message 영속화(`base/events/runtime-events`), Extension state, 프로세스별 로깅 |
| `specs/cli.md` | CLI 도구(gdn) - run, restart, validate, instance, logs, package, doctor, studio |
| `specs/api.md` | Runtime/SDK API - ExtensionApi, ToolHandler/ToolContext, ConnectorContext, ConnectionSpec, Orchestrator/AgentProcess/IPC API, Runtime Events API 표면 |
| `specs/oauth.md` | OAuth 범위 문서 - Extension/Connection 조합 구현 원칙 |

---

**문서 버전**: v0.0.3
**최종 수정**: 2026-02-18
