# Goondan 시스템 개요 (v2.0)

> "Kubernetes for Agent Swarm" - 에이전트 스웜 오케스트레이션 플랫폼

이 문서는 Goondan v2.0 시스템의 철학, 핵심 개념, 설계 원칙, 아키텍처를 통합적으로 이해하기 위한 개요를 제공합니다. 상세 구현 스펙은 `docs/specs/` 디렉터리의 각 문서를 참조하세요.

---

## 목차

1. [시스템 철학](#1-시스템-철학)
2. [핵심 설계 원칙](#2-핵심-설계-원칙)
3. [아키텍처 개요](#3-아키텍처-개요)
4. [핵심 개념](#4-핵심-개념)
5. [실행 모델](#5-실행-모델)
6. [설정 모델](#6-설정-모델)
7. [확장 모델](#7-확장-모델)
8. [패키징 생태계](#8-패키징-생태계)
9. [구현 계층](#9-구현-계층)
10. [스펙 문서 가이드](#10-스펙-문서-가이드)

---

## 1. 시스템 철학

### 1.1 "Kubernetes for Agent Swarm"

Goondan은 Kubernetes가 컨테이너 오케스트레이션에서 제공하는 가치를 에이전트 스웜 영역에 적용합니다.

| Kubernetes 개념 | Goondan 대응 | 핵심 가치 |
|-----------------|--------------|-----------|
| Pod | AgentProcess | 격리된 실행 단위 |
| Deployment | Swarm | 선언적 구성 |
| Service | Connection | 라우팅과 바인딩 |
| ConfigMap/Secret | ValueSource/SecretRef | 설정과 코드 분리 |
| Controller | Orchestrator | 상태 조정 루프 |
| kubectl | gdn CLI | 운영 인터페이스 |

### 1.2 핵심 철학

**선언적 구성 (Declarative Configuration)**
- 모든 구성을 YAML로 선언하며, Runtime이 desired state를 actual state로 조정합니다
- 명령형 API 대신 리소스 정의로 의도를 표현합니다

**프로세스 격리 (Process Isolation)**
- 각 에이전트와 커넥터가 독립 프로세스로 실행되어 크래시를 격리합니다
- 프로세스 간 통신은 IPC를 통해서만 이루어집니다

**Edit & Restart**
- 설정 변경은 파일 수정 + 재시작이라는 직관적 모델을 따릅니다
- Watch 모드로 개발 중 자동 반영이 가능합니다

**이벤트 소싱 (Event Sourcing)**
- 메시지 상태는 `NextMessages = BaseMessages + SUM(Events)` 규칙으로 관리됩니다
- 복구 가능성과 관찰 가능성을 동시에 확보합니다

**생태계 확장**
- Package 시스템으로 재사용 가능한 Tool/Extension/Connector를 배포합니다
- DAG 의존성과 lockfile로 재현 가능한 빌드를 보장합니다

---

## 2. 핵심 설계 원칙

### 2.1 Bun-Native

모든 실행 환경은 Bun으로 통일됩니다.
- **빠른 프로세스 기동**: AgentProcess 스폰 오버헤드 최소화
- **네이티브 TypeScript**: 별도 트랜스파일 없이 `.ts` 파일 직접 실행
- **효율적 IPC**: Bun의 내장 IPC 활용

### 2.2 Fail-Fast Validation

구성 오류는 Runtime 시작 전 "로드 단계"에서 모두 감지합니다.
- 하나라도 오류가 있으면 부분 로드 없이 전체를 거부
- 구조화된 오류 형식(`code`, `path`, `suggestion`, `helpUrl`)
- 예측 불가능한 런타임 오류 방지

### 2.3 Middleware Only Pipeline

모든 파이프라인 훅은 Middleware 형태로 통일됩니다.
- `next()` 호출 전후로 전처리/후처리를 수행하는 Onion 패턴
- 3종 미들웨어: `turn`, `step`, `toolCall`
- 13개 세분화 포인트를 3개로 단순화하여 학습 곡선 감소

### 2.4 타입 안전성

TypeScript를 전면 활용하며, 타입 단언(`as`)을 금지합니다.
- **타입 가드 사용**: `isSwarmSpec()`, `isToolSpec()` 등
- **공통 타입 SSOT**: `docs/specs/shared-types.md`
- **문서-코드 동기화**: 타입 정의가 스펙 문서와 일치

### 2.5 보안 원칙

- **비밀값 분리**: API 키는 ValueSource로 외부 주입
- **경로 탐색 방지**: `../` 및 절대 경로 거부
- **YAML 폭탄 방지**: 1MB/100 문서 제한
- **at-rest encryption**: 저장된 토큰 암호화

---

## 3. 아키텍처 개요

### 3.1 3-Plane 구조

Goondan은 세 개의 Plane으로 구성됩니다.

```
┌─────────────────────────────────────────────────────────┐
│                  Config Plane                            │
│  goondan.yaml - 선언적 리소스 정의 (8종 Kind)            │
│  Model, Agent, Swarm, Tool, Extension,                   │
│  Connector, Connection, Package                          │
└─────────────────────────────────────────────────────────┘
              │
              │ gdn run (로드/검증)
              ▼
┌─────────────────────────────────────────────────────────┐
│                  Runtime Plane                           │
│  Orchestrator (상주 프로세스)                            │
│    ├── AgentProcess (독립 Bun 프로세스)                 │
│    ├── AgentProcess                                     │
│    └── ConnectorProcess (독립 Bun 프로세스)             │
│                                                          │
│  IPC 메시지 브로커 (통합 이벤트 모델)                   │
│  Reconciliation Loop (상태 조정)                        │
└─────────────────────────────────────────────────────────┘
              │
              │ 상태 영속화
              ▼
┌─────────────────────────────────────────────────────────┐
│                  Storage Plane                           │
│  ~/.goondan/                                            │
│    ├── packages/ (설치된 패키지)                        │
│    └── workspaces/<workspaceId>/                       │
│        └── instances/<instanceKey>/                     │
│            ├── messages/ (base.jsonl + events.jsonl)    │
│            └── extensions/ (Extension 상태)             │
└─────────────────────────────────────────────────────────┘
```

### 3.2 프로세스 구조

```
                    Orchestrator (상주 프로세스)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    AgentProcess     AgentProcess    ConnectorProcess
    (Agent A)        (Agent B)       (telegram)
          │                │                │
    Turn → Step      Turn → Step      HTTP Server
      └─ LLM 호출      └─ LLM 호출      (자체 프로토콜)
      └─ Tool 실행     └─ Tool 실행
```

**핵심 특성:**
- Orchestrator는 상주하며 자식 프로세스를 스폰/감시/재시작
- 각 AgentProcess는 독립 메모리 공간에서 Turn/Step 루프 실행
- ConnectorProcess는 프로토콜 수신을 자체적으로 관리
- 프로세스 간 통신은 IPC로만 이루어짐

---

## 4. 핵심 개념

### 4.1 리소스 (Resource)

모든 구성 요소는 리소스로 정의됩니다.

**공통 구조:**
```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <name>
  labels: {}
  annotations: {}
spec:
  # Kind별 스키마
```

**8종 Kind:**

| Kind | 역할 | 프로세스 |
|------|------|----------|
| **Model** | LLM 프로바이더 설정 | - |
| **Tool** | LLM이 호출하는 함수 | AgentProcess 내부 |
| **Extension** | 라이프사이클 미들웨어 | AgentProcess 내부 |
| **Agent** | 에이전트 정의 (모델+프롬프트+도구+확장) | AgentProcess |
| **Swarm** | 에이전트 집합 + 실행 정책 | - |
| **Connector** | 외부 프로토콜 수신 | ConnectorProcess |
| **Connection** | Connector-Swarm 바인딩 | - |
| **Package** | 프로젝트 매니페스트/배포 단위 | - |

### 4.2 ObjectRef (리소스 참조)

리소스 간 참조는 ObjectRef로 표현합니다.

**문자열 축약 형식 (권장):**
```yaml
modelRef: "Model/claude"
toolRef: "Tool/bash"
agentRef: "Agent/coder"
```

**객체형 참조 (패키지 지정 시):**
```yaml
toolRef:
  kind: Tool
  name: bash
  package: "@goondan/base"
```

### 4.3 ValueSource (값 주입)

민감값은 환경변수나 비밀 저장소에서 주입합니다.

```yaml
# 환경 변수에서 주입 (권장)
apiKey:
  valueFrom:
    env: ANTHROPIC_API_KEY

# 비밀 저장소에서 주입
clientSecret:
  valueFrom:
    secretRef:
      ref: "Secret/slack-oauth"
      key: "client_secret"
```

### 4.4 Orchestrator

`gdn run`으로 기동되는 **상주 프로세스**입니다.

**핵심 책임:**
- Config Plane 파싱 및 리소스 로딩
- AgentProcess/ConnectorProcess 스폰, 감시, 재시작
- IPC 메시지 브로커 (통합 이벤트 라우팅)
- Reconciliation Loop (desired vs actual state 조정)
- 설정 변경 감지 (watch 모드)

**중요 특성:**
- 모든 에이전트가 종료되어도 상주
- 새 이벤트 발생 시 필요한 AgentProcess 자동 스폰
- Graceful Shutdown (진행 중 Turn 완료 대기)

### 4.5 AgentProcess

Agent 정의를 바탕으로 생성되는 **독립 Bun 프로세스**입니다.

**핵심 책임:**
- Turn/Step 실행 루프
- LLM 호출 (AI SDK 활용)
- Tool 핸들러 실행 (같은 프로세스 내 모듈 로드)
- Extension 미들웨어 체인 실행
- 메시지 상태 관리 (이벤트 소싱)

**프로세스 특성:**
- 독립 메모리 공간 (크래시 격리)
- Orchestrator와 IPC 통신
- 이벤트 큐 FIFO 직렬 처리
- 크래시 시 자동 재스폰

### 4.6 ConnectorProcess

Connector 정의를 바탕으로 생성되는 **독립 Bun 프로세스**입니다.

**핵심 책임:**
- 외부 프로토콜 수신 (HTTP, WebSocket, 폴링, cron 등)
- 프로토콜별 페이로드 → ConnectorEvent 정규화
- 서명 검증 (Connection이 제공한 시크릿 사용)
- Orchestrator로 이벤트 전달

**중요 특성:**
- 프로토콜 처리를 직접 구현 (Runtime이 대신 관리하지 않음)
- 독립 프로세스로 크래시 격리
- 하나의 Connector를 여러 Connection이 재사용 가능

### 4.7 Turn과 Step

**Turn:**
- 하나의 입력 이벤트(`AgentEvent`)를 처리하는 단위
- 복수의 Step을 포함
- 입력: `AgentEvent` (Connector 이벤트, 에이전트 간 요청, CLI 입력)
- 출력: `TurnResult` (응답 메시지, 종료 사유)

**Step:**
- LLM 호출 1회를 중심으로 하는 실행 단위
- LLM 응답의 tool call 처리까지 포함
- Tool call이 있으면 다음 Step 진행
- 텍스트 응답만 있으면 Turn 종료

### 4.8 Message와 이벤트 소싱

모든 LLM 메시지는 AI SDK의 `CoreMessage`를 `Message`로 감싸서 관리합니다.

**Message 구조:**
```typescript
interface Message {
  readonly id: string;              // 고유 ID
  readonly data: CoreMessage;       // AI SDK 메시지
  metadata: Record<string, JsonValue>; // Extension이 자유롭게 사용
  readonly createdAt: Date;         // 생성 시각
  readonly source: MessageSource;   // 생성 주체
}
```

**이벤트 소싱 규칙:**
```
NextMessages = BaseMessages + SUM(Events)
```

- `BaseMessages`: Turn 시작 시 디스크에서 로드된 확정 메시지 (`base.jsonl`)
- `Events`: Turn 중 누적되는 MessageEvent (`events.jsonl`)
- Turn 종료 시 최종 메시지를 base로 저장하고 events 클리어
- 복구 시 `base + events` 재생으로 정확한 상태 복원

**MessageEvent 타입:**
- `append`: 새 메시지 추가
- `replace`: 기존 메시지 교체 (요약 등)
- `remove`: 메시지 제거 (compaction)
- `truncate`: 모든 메시지 제거

### 4.9 Tool

LLM이 tool call로 호출하는 **1급 실행 단위**입니다.

**도구 이름 규칙:**
```
{Tool 리소스 이름}__{하위 도구 이름}
```

예시:
```
Tool 리소스: bash          → exports: exec, script
LLM 도구 이름: bash__exec, bash__script

Tool 리소스: file-system   → exports: read, write
LLM 도구 이름: file-system__read, file-system__write
```

**실행 방식:**
- Tool 호출은 AgentProcess(Bun) 내부에서 `spec.entry` 모듈 로드 후 핸들러 함수 호출
- 별도 Tool 프로세스를 만들지 않음
- 오류는 예외 전파 대신 구조화된 `ToolCallResult`로 LLM에 전달

### 4.10 Extension

Runtime 라이프사이클에 개입하는 미들웨어 로직 묶음입니다.

**ExtensionApi (5개 핵심 API):**
```typescript
interface ExtensionApi {
  pipeline: PipelineRegistry;   // 미들웨어 등록
  tools: ToolsApi;              // 동적 도구 등록
  state: StateApi;              // JSON 상태 영속화
  events: EventsApi;            // 프로세스 내 이벤트 버스
  logger: Console;              // 로깅
}
```

**대표 활용 패턴:**
- **Skill**: `SKILL.md` 번들을 런타임에 노출
- **ToolSearch**: LLM이 필요한 도구를 선택하도록 지원
- **Compaction**: 메시지 히스토리 요약/압축
- **Logging**: Turn/Step/ToolCall 관찰
- **MCP**: Model Context Protocol 서버 연동

### 4.11 Connector와 Connection

**Connector (프로토콜 구현):**
- 외부 채널 이벤트를 `ConnectorEvent`로 정규화
- 별도 Bun 프로세스로 프로토콜을 자체 관리
- 서명 검증을 자체적으로 수행 (secrets에서 시크릿 읽음)
- 재사용 가능한 프로토콜 어댑터

**Connection (배포 바인딩):**
- Connector를 특정 Swarm에 연결
- 시크릿 제공 (API 토큰, 서명 시크릿 등)
- Ingress 라우팅 규칙 정의
- 하나의 Connector를 여러 Connection이 재사용 가능

**분리의 이점:**
- 프로토콜 구현과 배포 설정을 독립적으로 발전
- 동일 Telegram Connector를 개발팀/운영팀이 다른 인증으로 사용

### 4.12 IPC와 통합 이벤트 모델

에이전트 간 통신은 Orchestrator를 경유하는 **통합 이벤트 모델**(`AgentEvent`)을 사용합니다.

**IPC 메시지 3종:**
- `event`: 에이전트 이벤트 전달 (Connector/에이전트 간 통신/CLI 입력 모두 통합)
- `shutdown`: Graceful shutdown 요청
- `shutdown_ack`: Shutdown 완료 응답

**통신 패턴 2종:**
- **request** (응답 대기): `AgentEvent.replyTo` 설정, `correlationId`로 매칭
- **send** (fire-and-forget): `AgentEvent.replyTo` 생략

**통합 이벤트 흐름:**
```
모든 입력 → AgentEvent (통합)
  - Connector 이벤트: source: { kind: 'connector', name: 'telegram' }
  - 에이전트 요청: source: { kind: 'agent', name: 'coder' } + replyTo
  - CLI 입력: source: { kind: 'connector', name: 'cli' }
```

---

## 5. 실행 모델

### 5.1 Orchestrator 상주 프로세스

```bash
gdn run                    # Orchestrator 기동
```

**실행 흐름:**
1. `goondan.yaml` 파싱 및 리소스 로딩
2. Orchestrator 상주 프로세스 기동
3. ConnectorProcess 스폰 (외부 이벤트 수신 대기)
4. 이벤트 수신 시 필요한 AgentProcess 스폰
5. IPC로 이벤트 라우팅
6. 모든 에이전트 종료 후에도 상주 (새 이벤트 대기)

### 5.2 Turn/Step 실행 루프

```
[AgentEvent 수신 (IPC)]
     │
     ▼
[Turn 시작]
     │
     ├─ base.jsonl 로드 → BaseMessages
     ├─ events.jsonl 로드 → 잔존 Events (복원 시)
     │
     ▼
[Turn 미들웨어 체인]
     │
     ├─ Extension A.turn.pre
     ├─ Extension B.turn.pre
     │
     ▼
[Step Loop (0..N)]
     │
     ├─ Step 미들웨어 체인
     │   ├─ Extension A.step.pre (toolCatalog 조작)
     │   ├─ Extension B.step.pre
     │   │
     │   ├─ [LLM 호출]
     │   │
     │   ├─ [ToolCall Loop (0..M)]
     │   │   ├─ ToolCall 미들웨어 체인
     │   │   │   ├─ Extension A.toolCall.pre (args 검증)
     │   │   │   ├─ [Tool 핸들러 실행]
     │   │   │   └─ Extension A.toolCall.post (결과 로깅)
     │   │
     │   ├─ Extension B.step.post
     │   └─ Extension A.step.post
     │
     ├─ (tool call 있으면 다음 Step, 없으면 종료)
     │
     ▼
     ├─ Extension B.turn.post
     ├─ Extension A.turn.post
     │
     ▼
[Turn 종료]
     │
     ├─ events → base 폴딩
     ├─ base.jsonl 갱신
     ├─ events.jsonl 클리어
     ├─ Extension 상태 디스크 기록
     │
     ▼
[다음 이벤트 대기]
```

### 5.3 Reconciliation Loop

Orchestrator는 주기적으로 desired state와 actual state를 비교하여 불일치를 교정합니다.

**Desired State:**
- `Swarm.agents[]`에 선언된 Agent 목록
- Connection이 참조하는 Connector 목록
- ConnectorProcess는 항상 실행 상태 유지

**Actual State:**
- Orchestrator가 직접 관찰하는 프로세스 맵
- Bun `spawn()` 반환값, exit 이벤트, pid 존재 여부

**조정 동작:**
- ConnectorProcess 미실행 시 스폰
- 설정에 없는 프로세스 graceful shutdown
- `crashed` 상태 프로세스 백오프 정책에 따라 재스폰
- `crashLoopBackOff` 시 지수 백오프 적용

### 5.4 Graceful Shutdown

재시작/종료 시 진행 중 Turn의 데이터 손실을 방지합니다.

**프로토콜:**
```
Orchestrator                    AgentProcess
    │
    ├─ shutdown IPC ───────────>    │
    │   { gracePeriodMs: 30000,     ├─ status → 'draining'
    │     reason: 'config_change' } ├─ 새 이벤트 수신 중단
    │                                ├─ 현재 Turn 완료
    │                                ├─ events → base 폴딩
    │   <───── shutdown_ack ────────┤
    │                                └─ process.exit(0)
    │
    ├─ 정상 종료 확인
    │
    ─── (유예시간 초과) ───>    SIGKILL
```

**규칙:**
- `draining` 상태에서 새 이벤트를 큐에서 꺼내지 않음
- 진행 중 Turn 완료까지 대기
- `gracePeriodMs` 초과 시 강제 종료

### 5.5 ProcessStatus 7종

```typescript
type ProcessStatus =
  | 'spawning'           // 프로세스 기동 중
  | 'idle'               // 이벤트 대기 중
  | 'processing'         // Turn 실행 중
  | 'draining'           // Graceful shutdown 중
  | 'terminated'         // 정상 종료
  | 'crashed'            // 비정상 종료
  | 'crashLoopBackOff';  // 반복 크래시로 백오프 대기
```

---

## 6. 설정 모델

### 6.1 Edit & Restart

설정 변경은 파일 수정 + 재시작이라는 직관적 모델을 따릅니다.

**흐름:**
```
1. goondan.yaml 또는 리소스 파일 수정
2. Orchestrator가 변경 감지 (watch 모드) 또는 gdn restart 수신
3. 영향받는 AgentProcess에 graceful shutdown
4. 새 설정으로 re-spawn
5. 기존 대화 히스토리 유지 (기본) 또는 초기화 (--fresh)
```

**재시작 트리거:**
- Watch 모드: 파일 변경 자동 감지
- CLI 명령: `gdn restart [--agent <name>] [--fresh]`
- 크래시 감지: Reconciliation Loop가 자동 재스폰

### 6.2 2-Root 워크스페이스

정의와 상태를 물리적으로 분리합니다.

**Project Root (프로젝트 디렉터리):**
```
/path/to/project/
├── goondan.yaml          # 리소스 정의
├── tools/                # Tool entry 파일
├── extensions/           # Extension entry 파일
├── connectors/           # Connector entry 파일
└── .git/                 # Git 저장소 (권장)
```

**System Root (`~/.goondan/`):**
```
~/.goondan/
├── config.json           # CLI/시스템 설정
├── packages/             # 설치된 패키지
└── workspaces/
    └── <workspaceId>/    # 프로젝트별 (SHA-256 기반)
        └── instances/
            └── <instanceKey>/  # 인스턴스별
                ├── metadata.json
                ├── messages/
                │   ├── base.jsonl
                │   └── events.jsonl
                └── extensions/
                    └── <ext-name>.json
```

**workspaceId 생성:**
- Project Root 절대 경로의 SHA-256 해시
- 처음 12자(hex)를 workspaceId로 사용
- 결정론적 (동일 경로 → 동일 ID)

---

## 7. 확장 모델

### 7.1 미들웨어 파이프라인

모든 파이프라인 훅은 Middleware 형태로 통일됩니다.

**3종 미들웨어:**

| 미들웨어 | 감싸는 범위 | 주요 역할 |
|----------|-------------|-----------|
| `turn` | Turn 전체 | 메시지 히스토리 조작, compaction |
| `step` | Step (LLM 호출 + 도구 실행) | Tool catalog 조작, 메시지 이벤트 발행 |
| `toolCall` | 개별 도구 호출 | 입력 검증/변환, 결과 로깅 |

**Onion 모델:**
```
Extension A (바깥)
  |-- pre 처리
  |-- Extension B (안쪽)
  |   |-- pre 처리
  |   |-- [핵심 로직]
  |   +-- post 처리
  +-- post 처리
```

먼저 등록된 Extension의 미들웨어가 바깥 레이어가 됩니다.

### 7.2 Extension 등록

```typescript
// extensions/my-extension/index.ts
export function register(api: ExtensionApi): void {
  // 미들웨어 등록
  api.pipeline.register('turn', async (ctx) => {
    // next() 전 = turn.pre: 메시지 조작
    const result = await ctx.next();
    // next() 후 = turn.post: 결과 후처리
    return result;
  });

  // 동적 도구 등록
  api.tools.register(catalogItem, handler);

  // 상태 관리
  const state = await api.state.get();
  await api.state.set(newState);

  // 이벤트 구독
  api.events.on('turn.completed', () => {
    api.logger.info('Turn completed');
  });
}
```

### 7.3 Tool Registry vs Tool Catalog

| 개념 | 설명 |
|------|------|
| **Tool Registry** | AgentProcess가 보유한 실행 가능한 전체 도구 핸들러 집합 |
| **Tool Catalog** | 특정 Step에서 LLM에 노출되는 도구 목록 (Step 미들웨어가 조작) |

Extension은 `step` 미들웨어에서 `ctx.toolCatalog`를 조작하여 LLM에 노출되는 도구를 동적으로 제어할 수 있습니다.

---

## 8. 패키징 생태계

### 8.1 Package 개념

Package는 재사용 가능한 배포 단위입니다.

**포함 아티팩트:**
- 리소스 YAML (Model, Agent, Tool, Extension, Connector 등)
- Tool/Extension/Connector 스크립트
- 프롬프트 파일
- 스킬 번들

**의존성 관리:**
- DAG 구조 (순환 참조 금지)
- semver 버전 제약
- lockfile 재현성 (`goondan.lock.yaml`)
- values 병합 우선순위

### 8.2 Package 워크플로우

```bash
# 의존성 추가
gdn package add @goondan/base

# 의존성 설치
gdn package install

# 패키지 발행
gdn package publish
```

**설치 흐름:**
1. `goondan.yaml`의 `spec.dependencies` 읽기
2. 레지스트리에서 메타데이터 조회
3. 버전 해석 (semver range → 정확한 버전)
4. 의존성 트리 구성 및 충돌 감지
5. tarball 다운로드 및 integrity 검증
6. `~/.goondan/packages/<scope>/<name>/<version>/` 압축 해제
7. `goondan.lock.yaml` 생성/업데이트

### 8.3 배포 manifest 규칙

**manifest 위치 우선순위:**
1. `package/dist/goondan.yaml` (빌드 산출물)
2. `package/goondan.yaml` (소스)

**`files: ["dist"]` 전략:**
- `package.json`의 `files`가 `["dist"]`인 패키지는 빌드 단계에서 `dist/goondan.yaml` 생성 필수
- Runtime 로더는 `dist/goondan.yaml`을 우선 로드
- `gdn package publish`는 manifest 없으면 거부

### 8.4 Package Root vs Bundle Root

**Package Root:**
- tarball 압축 해제된 디렉터리
- 의존 패키지의 entry 경로 해석 기준

**Bundle Root:**
- 현재 프로젝트의 `goondan.yaml`이 위치한 디렉터리
- 프로젝트 자체 리소스의 entry 경로 해석 기준

**경로 해석 규칙:**
- 로컬 프로젝트 리소스: Bundle Root 기준
- 의존 패키지 리소스: 해당 Package Root 기준
- manifest 위치와 무관하게 Package Root 기준 유지

---

## 9. 구현 계층

Goondan 구현은 5개 계층으로 구성됩니다.

### 9.1 계층별 역할

| 계층 | 패키지 | 역할 |
|------|--------|------|
| **Runtime** | `packages/runtime` | 실행 엔진 (Orchestrator, AgentProcess, Turn/Step 파이프라인) |
| **Types** | `packages/types` | 공통 타입 계약 (ExecutionContext, Message, ToolContext 등) |
| **Base** | `packages/base` | 기본 Tool/Extension/Connector 구현 |
| **CLI** | `packages/cli` | 운영 인터페이스 (gdn 명령어) |
| **Registry** | `packages/registry` | 패키지 레지스트리 서버/클라이언트 |

### 9.2 의존 관계

```
사용자/운영자
   ↓
CLI (@goondan/cli)
   ↓
Runtime (runtime)
   ↔
Types (types)
   ↓
Base/사용자 구현 (@goondan/base + 프로젝트 Tool/Extension)
   ↔
Registry (@goondan/registry)
```

### 9.3 책임 경계

**Runtime에 둘 것:**
- 프로세스 스폰/감시, IPC 브로커, Turn/Step 실행, Reconciliation

**Types에 둘 것:**
- 여러 계층이 공유하는 타입 계약

**Base에 둘 것:**
- 재사용 가능한 기본 Tool/Extension/Connector

**CLI에 둘 것:**
- 사용자 명령 UX, 출력 포맷, 운영 워크플로우

**Registry에 둘 것:**
- 패키지 메타데이터/tarball 저장/조회, 배포 정책

---

## 10. 스펙 문서 가이드

### 10.1 문서 소유권

각 스펙 문서가 **소유**하는 개념을 명확히 구분합니다.

| 문서 | 소유 개념 |
|------|-----------|
| `shared-types.md` | 공통 타입 원형 (Json, ObjectRef, ValueSource, Message, AgentEvent, IpcMessage, ToolContext, TurnResult 등) |
| `resources.md` | 8종 Kind 스키마, ObjectRef 검증 규칙 |
| `runtime.md` | Orchestrator/AgentProcess/ConnectorProcess 실행 모델, IPC 흐름, 메시지 상태 실행 규칙 |
| `pipeline.md` | 미들웨어 파이프라인 계약 (turn/step/toolCall), Onion 모델 |
| `tool.md` | Tool 시스템 계약, 도구 이름 규칙, 에이전트 간 통신 패턴 |
| `extension.md` | ExtensionApi, 로딩/상태 모델, 활용 패턴 |
| `connector.md` | ConnectorContext/ConnectorEvent, 프로세스 모델 |
| `connection.md` | ConnectionSpec, Ingress 라우팅, 서명 검증 |
| `bundle.md` | Bundle YAML 구조, 로딩 규칙, YAML 보안 |
| `bundle_package.md` | Package 라이프사이클, 레지스트리 API, lockfile |
| `workspace.md` | 저장소 경로/레이아웃, 파일 포맷 (base.jsonl, events.jsonl) |
| `cli.md` | CLI 명령 인터페이스, 옵션, 출력 형식 |
| `api.md` | Runtime Events API 표면 (이벤트 이름/페이로드) |
| `layers.md` | 계층별 책임 경계 |
| `help.md` | 문서 운영 계약, 공통 정책 |
| `oauth.md` | OAuth 범위 (Extension/Connection 조합 참조) |

### 10.2 참조 우선 원칙

각 스펙 문서는 다음 원칙을 따릅니다.

1. **비소유 타입/계약은 재정의하지 않고 참조**
   - `MessageEvent` 타입은 `shared-types.md` 참조
   - ObjectRef 검증 규칙은 `resources.md` 참조

2. **소유 문서만 규범 규칙을 정의**
   - `runtime.md`는 Turn/Step 실행 규칙 소유
   - `workspace.md`는 파일 저장 레이아웃 소유
   - `pipeline.md`는 저장 규칙을 재정의하지 않음

3. **문맥별 사용 예시는 각 문서가 제공**
   - `bundle.md`는 ObjectRef 사용 예시 제공
   - `api.md`는 ToolContext 사용 예시 제공

### 10.3 스펙 탐색 전략

**처음 접하는 경우:**
1. `GUIDE.md` - 실전 가이드
2. `docs/architecture.md` - 아키텍처 개념
3. 이 문서 (`docs/overview.md`) - 통합 개요

**특정 주제를 찾는 경우:**
1. 문서 소유권 매트릭스 확인 (이 문서 10.1절)
2. 해당 소유 문서 참조
3. 관련 문서 섹션으로 확장

**구현 시:**
1. 타입 정의: `shared-types.md` 먼저 확인
2. 리소스 스키마: `resources.md` 참조
3. 실행 규칙: 해당 도메인 스펙 (`runtime.md`, `pipeline.md` 등) 참조

---

## 11. v2 주요 변경사항 요약

### 11.1 Runtime

**이전 (v1):**
- 단일 프로세스 모델
- Mutator + Middleware 13개 훅

**현재 (v2):**
- Process-per-Agent 아키텍처
- Orchestrator 상주 프로세스
- Middleware 3종 (`turn`, `step`, `toolCall`)
- Reconciliation Loop
- Graceful Shutdown Protocol

### 11.2 Config

**이전:**
- 다양한 apiVersion 혼재

**현재:**
- `apiVersion: goondan.ai/v1` 통일
- 8종 Kind (Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)
- ObjectRef 문자열 축약형 (`"Kind/name"`)

### 11.3 Tool

**이전:**
- 단일 export Tool
- 도구 이름 인코딩 필요

**현재:**
- `exports` 배열 기반 하위 도구 선언
- 더블 언더스코어 네이밍 (`{리소스명}__{export명}`)
- AI SDK 호환 문자열 (별도 인코딩 불필요)

### 11.4 Connector

**이전:**
- Runtime이 HTTP 서버/cron 관리
- `triggers` 필드로 프로토콜 선언

**현재:**
- Connector가 프로토콜을 자체 관리
- `entry` + `events` 중심 구조
- 별도 Bun 프로세스로 실행

### 11.5 IPC

**이전:**
- 에이전트 요청/응답 전용 IPC

**현재:**
- 통합 이벤트 모델 (`AgentEvent`)
- 3종 IPC 메시지 (`event`, `shutdown`, `shutdown_ack`)
- Connector 이벤트/에이전트 간 통신/CLI 입력 모두 통합

### 11.6 Message

**이전:**
- AI SDK 메시지 직접 사용

**현재:**
- `Message` 래퍼 (id, metadata, createdAt, source)
- MessageEvent 이벤트 소싱
- `NextMessages = BaseMessages + SUM(Events)` 규칙

---

## 12. 실전 사용 패턴

### 12.1 최소 프로젝트 시작

```bash
# 1. 프로젝트 초기화
gdn init my-agent
cd my-agent

# 2. 환경 변수 설정
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 3. 검증
gdn validate

# 4. 실행
gdn run
```

### 12.2 의존성 사용

```bash
# 기본 도구 추가
gdn package add @goondan/base

# 설치
gdn package install

# 실행
gdn run
```

### 12.3 개발 모드

```bash
# Watch 모드 실행
gdn run --watch

# (다른 터미널에서) 파일 수정
vim tools/my-tool/index.ts

# → Orchestrator가 자동으로 해당 에이전트 재시작
```

### 12.4 인스턴스 운영

```bash
# 인스턴스 목록
gdn instance list

# 특정 인스턴스 상태 초기화
gdn instance delete user:123

# 로그 확인
gdn logs --instance-key user:123 --lines 100
```

### 12.5 패키지 발행

```bash
# 검증
gdn validate

# 발행 (dry-run)
gdn package publish --dry-run

# 실제 발행
gdn package publish
```

---

## 13. 보안 모델

### 13.1 비밀값 관리

**ValueSource 패턴:**
```yaml
apiKey:
  valueFrom:
    env: ANTHROPIC_API_KEY   # 환경변수에서 주입

clientSecret:
  valueFrom:
    secretRef:
      ref: "Secret/oauth"    # 비밀 저장소에서 주입
      key: "client_secret"
```

**규칙:**
- Base Config에 비밀값 평문 저장 금지
- 로그/메트릭에 마스킹 없이 기록 금지
- at-rest encryption 적용

### 13.2 경로 보안

- `../` 상위 디렉터리 참조 거부
- 절대 경로 거부
- 모든 경로는 Bundle Root/Package Root 기준 상대 경로

### 13.3 YAML 보안

- 단일 파일 1MB 제한
- 최대 100개 문서 제한
- 앵커/별칭 확장 10배 제한

### 13.4 SSRF 방지

- http-fetch Tool은 URL 프로토콜 검증 (http/https만 허용)

---

## 14. 관찰성 (Observability)

### 14.1 로깅

**구조화된 로그:**
```json
{
  "level": "info",
  "timestamp": "2026-02-13T10:30:00Z",
  "traceId": "trace-abc",
  "agent": "coder",
  "instanceKey": "user:123",
  "event": "turn.completed",
  "turnId": "turn-001",
  "latencyMs": 3000,
  "tokenUsage": {"prompt": 150, "completion": 30, "total": 180}
}
```

**프로세스별 로그:**
- Orchestrator, AgentProcess, ConnectorProcess 각각 stdout/stderr 출력
- `gdn logs` 명령으로 통합 조회

### 14.2 Trace Context

- 모든 Turn에 `traceId` 생성/보존
- 에이전트 간 통신 시 `replyTo.correlationId`로 추적
- Turn/Step/ToolCall 로그에 traceId 포함

### 14.3 Runtime Events

Extension은 `api.events.on()`으로 표준 이벤트를 구독할 수 있습니다.

**주요 이벤트:**
- `turn.started`, `turn.completed`, `turn.failed`
- `step.started`, `step.completed`, `step.failed`
- `tool.called`, `tool.completed`, `tool.failed`

---

## 15. 오류 처리

### 15.1 구조화된 오류

모든 오류는 다음 형식을 따릅니다.

```typescript
interface StructuredError {
  code: string;           // 오류 코드 (예: "E_CONFIG_REF_NOT_FOUND")
  message: string;        // 오류 메시지
  path?: string;          // 리소스 내 위치
  suggestion?: string;    // 사용자 복구를 위한 제안
  helpUrl?: string;       // 관련 문서 링크
}
```

**예시:**
```json
{
  "code": "E_CONFIG_REF_NOT_FOUND",
  "message": "Tool/bash 참조를 찾을 수 없습니다.",
  "path": "resources/agent.yaml#spec.tools[0]",
  "suggestion": "kind/name 또는 package 범위를 확인하세요.",
  "helpUrl": "https://docs.goondan.ai/errors/E_CONFIG_REF_NOT_FOUND"
}
```

### 15.2 Tool 오류

Tool 실행 오류는 예외 전파 대신 `ToolCallResult`로 LLM에 전달합니다.

```json
{
  "status": "error",
  "error": {
    "code": "E_TOOL",
    "message": "요청 실패 (길이 제한 적용)",
    "suggestion": "입력 파라미터를 확인하세요."
  }
}
```

### 15.3 환경 진단

```bash
gdn doctor   # 환경 검증 및 문제 진단
```

---

## 16. 주요 설계 결정 (Design Decisions)

### 16.1 왜 Process-per-Agent인가?

**장점:**
- 크래시 격리: 개별 에이전트 실패가 다른 에이전트에 영향 없음
- 독립 스케일링: 각 프로세스가 독립적으로 자원 사용
- 단순한 재시작: 설정 변경 시 영향받는 프로세스만 재시작

**트레이드오프:**
- 프로세스 기동 오버헤드 (Bun으로 최소화)
- 프로세스 간 통신 비용 (IPC)

### 16.2 왜 Middleware Only인가?

**이전 (v1):**
- 13개 세분화 훅 (Mutator + Middleware)
- 복잡한 학습 곡선

**현재 (v2):**
- 3종 미들웨어 (`turn`, `step`, `toolCall`)
- 일관된 `next()` 패턴
- 높은 가독성과 낮은 학습 곡선

### 16.3 왜 이벤트 소싱인가?

**메시지 상태 모델:**
```
NextMessages = BaseMessages + SUM(Events)
```

**이점:**
- 복구 가능성: `base + events` 재생으로 정확한 상태 복원
- 관찰 가능성: 모든 메시지 변경이 이벤트로 추적
- 조작 유연성: Extension이 이벤트 발행으로 메시지 조작
- Compaction: 주기적으로 `events → base` 폴딩

### 16.4 왜 Connector/Connection 분리인가?

**분리 이점:**
- 프로토콜 구현과 배포 바인딩을 독립적으로 발전
- 하나의 Connector를 여러 환경에서 재사용
- Connector는 프로토콜만, Connection은 라우팅/인증만 담당

**예시:**
```yaml
# Connector (재사용 가능)
kind: Connector
metadata:
  name: slack
spec:
  entry: "./connectors/slack/index.ts"

# Connection A (개발팀)
kind: Connection
metadata:
  name: slack-dev
spec:
  connectorRef: "Connector/slack"
  secrets:
    BOT_TOKEN: { valueFrom: { env: SLACK_DEV_TOKEN } }

# Connection B (운영팀)
kind: Connection
metadata:
  name: slack-ops
spec:
  connectorRef: "Connector/slack"
  secrets:
    BOT_TOKEN: { valueFrom: { env: SLACK_OPS_TOKEN } }
```

### 16.5 왜 8종 Kind인가?

**이전:**
- OAuth, Secret 등 별도 Kind 고려

**현재:**
- 8종만 유지 (Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)
- OAuth는 Extension 내부 구현
- Secret은 ValueSource/SecretRef 패턴

**이점:**
- 개념 경계 명확
- 인지 부하 감소
- 도구 구현 단순화

---

## 17. 구현 상태 매트릭스

### 17.1 핵심 기능

| 기능 | 상태 | 위치 |
|------|------|------|
| Orchestrator 상주 프로세스 | ✅ 구현 | `packages/runtime` |
| Process-per-Agent | ✅ 구현 | `packages/runtime` |
| IPC 메시지 브로커 | ✅ 구현 | `packages/runtime` |
| Reconciliation Loop | ⚠️ 부분 | `packages/runtime` |
| Graceful Shutdown | ⚠️ 부분 | `packages/runtime` |
| Turn/Step 파이프라인 | ✅ 구현 | `packages/runtime` |
| 3종 미들웨어 | ✅ 구현 | `packages/runtime` |
| 메시지 이벤트 소싱 | ✅ 구현 | `packages/runtime` |
| Tool 더블 언더스코어 네이밍 | ✅ 구현 | `packages/runtime` |
| Connector 별도 프로세스 | ✅ 구현 | `packages/runtime` |
| Connection Ingress 라우팅 | ✅ 구현 | `packages/cli` |
| 2-root 워크스페이스 | ✅ 구현 | `packages/runtime`, `packages/cli` |
| Package 시스템 | ⚠️ 부분 | `packages/cli`, `packages/registry` |
| Lockfile | ⚠️ 부분 | `packages/cli` |

**범례:**
- ✅ 구현: 완전히 구현되어 동작
- ⚠️ 부분: 기본 동작은 구현되었으나 일부 기능 미완성
- ❌ 미구현: 스펙만 정의되고 구현 없음

### 17.2 기본 구성 요소

| 구성 요소 | 상태 | 위치 |
|-----------|------|------|
| bash Tool | ✅ 구현 | `packages/base/src/tools/bash` |
| file-system Tool | ✅ 구현 | `packages/base/src/tools/file-system` |
| http-fetch Tool | ✅ 구현 | `packages/base/src/tools/http-fetch` |
| json-query Tool | ✅ 구현 | `packages/base/src/tools/json-query` |
| text-transform Tool | ✅ 구현 | `packages/base/src/tools/text-transform` |
| agents Tool | ✅ 구현 | `packages/base/src/tools/agents` |
| basicCompaction Extension | ✅ 구현 | `packages/base/src/extensions/basicCompaction` |
| logging Extension | ✅ 구현 | `packages/base/src/extensions/logging` |
| telegram Connector | ✅ 구현 | `packages/base/src/connectors/telegram` |
| slack Connector | ✅ 구현 | `packages/base/src/connectors/slack` |
| cli Connector | ✅ 구현 | `packages/base/src/connectors/cli` |
| discord Connector | ✅ 구현 | `packages/base/src/connectors/discord` |
| github Connector | ✅ 구현 | `packages/base/src/connectors/github` |

### 17.3 CLI 명령어

| 명령어 | 상태 | 구현 위치 |
|--------|------|-----------|
| `gdn init` | ⚠️ 부분 | `packages/cli/src/commands/init.ts` |
| `gdn run` | ✅ 구현 | `packages/cli/src/commands/run.ts` |
| `gdn restart` | ✅ 구현 | `packages/cli/src/commands/restart.ts` |
| `gdn validate` | ✅ 구현 | `packages/cli/src/commands/validate.ts` |
| `gdn instance list` | ✅ 구현 | `packages/cli/src/commands/instance-list.ts` |
| `gdn instance delete` | ✅ 구현 | `packages/cli/src/commands/instance-delete.ts` |
| `gdn logs` | ✅ 구현 | `packages/cli/src/commands/logs.ts` |
| `gdn package add` | ⚠️ 부분 | `packages/cli/src/commands/package-*.ts` |
| `gdn package install` | ⚠️ 부분 | `packages/cli/src/commands/package-*.ts` |
| `gdn package publish` | ⚠️ 부분 | `packages/cli/src/commands/package-*.ts` |
| `gdn doctor` | ⚠️ 부분 | `packages/cli/src/commands/doctor.ts` |

---

## 18. 확장 가이드

### 18.1 새 Tool 추가

```yaml
# goondan.yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: my-tool
spec:
  entry: "./tools/my-tool/index.ts"
  exports:
    - name: action
      description: "액션 실행"
      parameters:
        type: object
        properties:
          param: { type: string }
```

```typescript
// tools/my-tool/index.ts
export const handlers: Record<string, ToolHandler> = {
  action: async (ctx, input) => {
    // 구현
    return { result: 'ok' };
  },
};
```

### 18.2 새 Extension 작성

```yaml
# goondan.yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: my-extension
spec:
  entry: "./extensions/my-extension/index.ts"
  config:
    option: value
```

```typescript
// extensions/my-extension/index.ts
export function register(api: ExtensionApi): void {
  api.pipeline.register('step', async (ctx) => {
    const result = await ctx.next();
    // 후처리
    return result;
  });
}
```

### 18.3 새 Connector 작성

```yaml
# goondan.yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: my-connector
spec:
  entry: "./connectors/my-connector/index.ts"
  events:
    - name: event_name
      properties:
        prop: { type: string }
```

```typescript
// connectors/my-connector/index.ts
export default async function(ctx: ConnectorContext): Promise<void> {
  // 프로토콜 수신 구현
  Bun.serve({
    port: Number(ctx.secrets.PORT),
    async fetch(req) {
      await ctx.emit({
        name: 'event_name',
        message: { type: 'text', text: '...' },
        properties: { prop: '...' },
        instanceKey: '...',
      });
      return new Response('OK');
    },
  });
}
```

---

## 19. 트러블슈팅

### 19.1 일반적인 문제

**문제: ObjectRef를 찾지 못함**
```bash
# 검증으로 정확한 경로 확인
gdn validate --format json

# 패키지 리소스라면 package 필드 명시
toolRef:
  kind: Tool
  name: bash
  package: "@goondan/base"
```

**문제: 환경 변수 누락**
```bash
# .env 파일 확인
cat .env

# 또는 직접 설정
export ANTHROPIC_API_KEY=sk-ant-...

# 검증
gdn validate
```

**문제: 재시작 후 동작 이상**
```bash
# 상태 초기화 재시작
gdn restart --fresh

# 또는 인스턴스 삭제
gdn instance delete <key>
```

### 19.2 로그 확인

```bash
# active 인스턴스의 orchestrator 로그
gdn logs

# stderr만 최근 100줄
gdn logs --stream stderr --lines 100

# 특정 인스턴스
gdn logs --instance-key user:123
```

### 19.3 Crash Loop

```bash
# 로그에서 연속 크래시 원인 확인
gdn logs --stream stderr

# Tool/Extension 초기화 예외 확인
# → 백오프 상태에서 원인 수정 후 재시작
```

---

## 20. 다음 단계

### 20.1 학습 경로

**입문자:**
1. `GUIDE.md` - 실전 가이드
2. 이 문서 (`overview.md`) - 시스템 개요
3. `docs/architecture.md` - 아키텍처 개념
4. Sample 프로젝트 실행 (`packages/sample/sample-6-cli-chatbot`)

**개발자:**
1. `docs/specs/resources.md` - 리소스 스키마
2. `docs/specs/tool.md` - Tool 작성
3. `docs/specs/extension.md` - Extension 작성
4. `docs/specs/connector.md` - Connector 작성

**아키텍트:**
1. `docs/specs/runtime.md` - 실행 모델
2. `docs/specs/pipeline.md` - 파이프라인
3. `docs/specs/shared-types.md` - 타입 계약
4. `docs/specs/help.md` - 문서 소유권 매트릭스

### 20.2 권장 시작 순서

```bash
# 1. 프로젝트 생성
gdn init my-first-swarm
cd my-first-swarm

# 2. 환경 변수 설정
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 3. 기본 도구 추가
gdn package add @goondan/base
gdn package install

# 4. 검증
gdn validate

# 5. 실행
gdn run --watch

# 6. 점진적 확장
# - Tool/Extension/Connector 추가
# - 설정 변경 시 자동 재시작 확인
```

---

## 21. 스펙 문서 참조 맵

### 21.1 빠른 참조

**타입을 찾는다면:**
- `docs/specs/shared-types.md`

**리소스 스키마를 찾는다면:**
- `docs/specs/resources.md`

**실행 동작을 찾는다면:**
- `docs/specs/runtime.md`

**파이프라인을 찾는다면:**
- `docs/specs/pipeline.md`

**Tool/Extension/Connector를 작성한다면:**
- `docs/specs/tool.md`
- `docs/specs/extension.md`
- `docs/specs/connector.md`

**저장소/파일 경로를 찾는다면:**
- `docs/specs/workspace.md`

**CLI 명령을 찾는다면:**
- `docs/specs/cli.md`

**패키지를 만든다면:**
- `docs/specs/bundle_package.md`

**문서 운영 규칙을 찾는다면:**
- `docs/specs/help.md`

### 21.2 전체 스펙 목록

| 문서 | 범위 |
|------|------|
| `shared-types.md` | 공통 타입 SSOT |
| `resources.md` | 8종 Kind 스키마, ObjectRef/ValueSource |
| `runtime.md` | Orchestrator/AgentProcess/ConnectorProcess, IPC, Turn/Step, 메시지 상태 실행 규칙 |
| `pipeline.md` | 미들웨어 파이프라인 (turn/step/toolCall), Onion 모델 |
| `tool.md` | Tool 시스템, 도구 이름 규칙, 에이전트 간 통신 |
| `extension.md` | ExtensionApi, 로딩/상태 모델, 활용 패턴 |
| `connector.md` | ConnectorContext/ConnectorEvent, 프로세스 모델 |
| `connection.md` | ConnectionSpec, Ingress 라우팅, 서명 검증 |
| `bundle.md` | Bundle YAML 구조, 로딩 규칙, YAML 보안 |
| `bundle_package.md` | Package 라이프사이클, 레지스트리 API, lockfile |
| `workspace.md` | 저장소 경로/레이아웃, 파일 포맷 |
| `cli.md` | CLI 명령 인터페이스, 옵션, 출력 형식 |
| `api.md` | Runtime/SDK API 표면 |
| `layers.md` | 계층별 책임 경계 |
| `help.md` | 문서 운영 계약, 공통 정책 |
| `oauth.md` | OAuth 범위 (Extension/Connection 조합) |

---

## 22. 철학적 배경

### 22.1 "k8s for agent swarm"의 의미

Kubernetes는 컨테이너 오케스트레이션을 다음 원칙으로 해결했습니다:
- 선언적 구성 (desired state)
- 조정 루프 (reconciliation)
- 프로세스 격리 (pod)
- 표준 리소스 모델 (API objects)

Goondan은 이 원칙을 에이전트 스웜에 적용합니다:
- **선언적 구성**: `goondan.yaml`로 전체 Swarm 정의
- **조정 루프**: Orchestrator가 desired vs actual state 조정
- **프로세스 격리**: Process-per-Agent로 크래시 격리
- **표준 리소스**: 8종 Kind의 일관된 구조

### 22.2 생태계 구축 관점

Goondan은 단순한 에이전트 프레임워크가 아니라 **생태계**를 지향합니다.

**npm/pip처럼:**
- Package 시스템으로 재사용 가능한 구성 요소 배포
- 의존성 해석과 버전 관리
- 공개/비공개 레지스트리

**Kubernetes처럼:**
- Helm chart처럼 복잡한 Swarm을 Package로 배포
- values 병합으로 환경별 설정 조정
- 커뮤니티가 기여하는 Tool/Extension/Connector

**예상 생태계:**
- `@goondan/base`: 기본 도구 번들
- `@goondan/slack-toolkit`: Slack 전문 도구/커넥터
- `@community/coding-swarm`: 코딩 에이전트 스웜 템플릿
- `@myorg/internal-tools`: 조직 전용 도구

### 22.3 확장성과 단순성의 균형

**단순한 시작:**
- Package 없이 `goondan.yaml` 하나로 동작
- CLI Connector만으로 즉시 대화 가능
- 기본 템플릿으로 빠른 프로젝트 생성

**점진적 확장:**
- 필요 시 Tool/Extension 추가
- Connector로 외부 채널 연결
- Package로 의존성 관리
- 멀티 에이전트 협업 구성

**확장 한계 제거:**
- Extension으로 모든 라이프사이클 개입 가능
- MCP로 외부 도구 연동
- 프로세스 격리로 안정적 스케일링

---

## 23. 관련 문서

**입문:**
- `GUIDE.md` - 개발자 가이드 (실전)
- `docs/architecture.md` - 아키텍처 개요

**스펙 (SSOT):**
- `docs/specs/shared-types.md` - 공통 타입
- `docs/specs/resources.md` - 리소스 스키마
- `docs/specs/runtime.md` - 실행 모델
- `docs/specs/pipeline.md` - 미들웨어 파이프라인
- `docs/specs/tool.md` - Tool 시스템
- `docs/specs/extension.md` - Extension 시스템
- `docs/specs/connector.md` - Connector 시스템
- `docs/specs/connection.md` - Connection 시스템
- `docs/specs/bundle.md` - Bundle YAML
- `docs/specs/bundle_package.md` - Package 시스템
- `docs/specs/workspace.md` - 워크스페이스/저장소
- `docs/specs/cli.md` - CLI 인터페이스
- `docs/specs/api.md` - Runtime/SDK API
- `docs/specs/layers.md` - 계층별 책임
- `docs/specs/help.md` - 문서 운영 계약
- `docs/specs/oauth.md` - OAuth 범위

---

**문서 버전**: v2.0
**최종 수정**: 2026-02-13
