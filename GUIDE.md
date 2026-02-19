# Goondan 빠른 시작 가이드 (처음 사용자용)

> Kubernetes for Agent Swarm

이 문서는 Goondan을 처음 접한 사람이 `goondan.yaml`을 만들고 실행하고 확장할 수 있게 하는 실전 가이드다.  
런타임 내부 구현 상세(프로세스 상태, IPC 등)는 의도적으로 제외했다.

---

## 1. 시작 전 준비

### 1.1 필수 요구사항

- **Node.js 18+** 또는 **Bun** (권장)
  - 버전 확인: `node -v` 또는 `bun -v`
  - Bun 설치: https://bun.sh
- **LLM API 키** (예: Anthropic, OpenAI)

### 1.2 CLI 설치

```bash
# 권장 (Bun)
bun add -g @goondan/cli

# 대안
npm install -g @goondan/cli
pnpm add -g @goondan/cli
```

**설치 실패 시:**
- Bun 미설치: npm/pnpm으로 대체

---

## 2. 5분 빠른 시작

### 2.1 프로젝트 생성

```bash
gdn init my-first-swarm
cd my-first-swarm
```

`gdn init`은 기본으로 `goondan.yaml` 첫 문서에 `kind: Package`를 생성한다.

### 2.2 환경 변수 설정

`.env` 파일:

```bash
# Anthropic 사용 시
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI 사용 시
OPENAI_API_KEY=sk-...

# Gemini 사용 시
GOOGLE_GENERATIVE_AI_API_KEY=...
```

**다른 provider로 변경하려면:** 2.3 섹션의 Model 블록에서 `provider`와 `model` 값을 함께 변경하세요.

### 2.3 `goondan.yaml` 최소 예시

#### 최소 예시 먼저 보기

아래 내용으로 교체:

```yaml
apiVersion: goondan.ai/v1
kind: Package  # 프로젝트 메타 / 실행 진입점
metadata:
  name: "my-first-swarm"
spec:
  version: "0.1.0"

---
apiVersion: goondan.ai/v1
kind: Model  # Agent가 사용할 LLM 정의
metadata:
  name: default-model
spec:
  provider: anthropic  # 또는 openai, google 등
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY  # .env 파일의 환경 변수 참조

---
apiVersion: goondan.ai/v1
kind: Agent  # 실제 응답을 생성하는 실행 단위
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/default-model"  # ObjectRef: Kind/name
  prompts:
    systemPrompt: |
      You are a helpful assistant.

---
apiVersion: goondan.ai/v1
kind: Swarm  # 어떤 Agent로 진입할지 정하는 오케스트레이션 단위
metadata:
  name: default
spec:
  entryAgent: "Agent/assistant"  # 기본 진입 Agent
  agents:
    - ref: "Agent/assistant"

---
apiVersion: goondan.ai/v1
kind: Connection  # 외부 입력을 Swarm으로 전달
metadata:
  name: cli-to-default
spec:
  connectorRef:  # 입력 채널 (CLI/Telegram/Slack 등)
    kind: Connector
    name: cli
    package: "@goondan/base"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route:
          instanceKey: "local"  # 세션 구분용 임의 문자열 (예시)
```

#### 지금 본 설정의 핵심 용어

- **`Connection`**: 외부 입력(CLI/Slack/Telegram)을 받아 `Swarm`으로 전달하는 진입점
- **`Swarm`**: 여러 Agent를 묶고, `entryAgent`로 시작 Agent를 지정하는 실행 제어자
- **`entryAgent`**: Swarm에서 **첫 번째로 실행되는 Agent**의 참조 (`Swarm.spec.entryAgent`)
- **`instanceKey`**: 같은 Swarm라도 채널/사용자별 대화 상태를 분리하는 세션 키
  - 임의의 문자열을 자유롭게 사용 가능
  - 예시: `"local"`, `"telegram-main"`, `"user-123"` 등
  - 미지정 시: `Swarm.spec.instanceKey ?? Swarm.metadata.name` 사용
  - 실서비스: 사용자/채널/세션 기반 동적 값 권장 (예: Telegram `chat_id`, Slack `channel_id`)

#### 데이터 흐름 이해하기

```
외부 입력(CLI/Telegram/Slack 등)
  ↓
Connection (진입점)
  ↓
Swarm (진입 제어, entryAgent 시작)
  ↓
Agent (실행 단위, Model 참조)
  ↓
Model (LLM 사양/키)
  ↓
실제 추론 엔진

Package는 위 리소스들을 묶어 배포/실행 단위를 만드는 패키지 컨테이너
```

#### ObjectRef 참조 형식

리소스 간 참조는 `Kind/name` 형식을 사용합니다:
- `Model/default-model` → Model 리소스의 `default-model`
- `Agent/assistant` → Agent 리소스의 `assistant`
- `Swarm/default` → Swarm 리소스의 `default`

### 2.4 패키지 설치, 검증, 실행

```bash
gdn package add @goondan/base
gdn package install
gdn validate
gdn run --foreground
```

`--foreground`로 실행하면 CLI 커넥터 입력을 바로 받을 수 있다.
실행 후 터미널에 문장을 입력하면 Agent로 전달된다. 종료는 `Ctrl+C`.

**실패 시:** 섹션 5 "자주 막히는 지점"의 체크리스트를 확인하세요.

---

## 3. `goondan.yaml`를 읽는 기준 (핵심만)

### 3.1 Package

- 프로젝트 식별자
- `gdn run` 필수 전제

### 3.2 Model

- 어떤 모델/프로바이더를 쓸지 정의
- API 키는 `valueFrom.env`로 참조하는 패턴 권장

### 3.3 Agent

- 실제 추론 주체
- `modelConfig.modelRef`로 Model 연결
- `prompts.systemPrompt` 또는 `prompts.systemRef`로 시스템 프롬프트 정의

### 3.4 Swarm

- 어떤 Agent들을 묶어 실행할지 정의
- `entryAgent`가 기본 라우팅 대상
- 필요하면 `spec.instanceKey`로 인스턴스 키 고정 가능

### 3.5 Connection

- 외부 입력 채널(Connector)과 Swarm 연결
- `connectorRef` + `swarmRef`가 핵심
- `ingress.rules[].route`로 라우팅/인스턴스 키 전략 제어

---

## 4. 자주 하는 확장

### 4.1 Agent 추가

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: reviewer
spec:
  modelConfig:
    modelRef: "Model/default-model"
  prompts:
    systemPrompt: |
      You review answers for correctness.
```

그리고 `Swarm.spec.agents`에 추가:

```yaml
agents:
  - ref: "Agent/assistant"
  - ref: "Agent/reviewer"
```

### 4.2 Tool vs Extension 이해하기

**Tool과 Extension의 차이:**
- **Tool**: 에이전트가 LLM tool call로 직접 호출하는 실행 단위
  - 예: bash 명령 실행, 파일 읽기/쓰기, API 호출 등
  - Agent가 "이 작업을 하려면 이 Tool을 써야지" 하고 명시적으로 호출
- **Extension**: 런타임 단계(turn/step/toolCall)에서 자동 적용되는 미들웨어
  - 예: 메시지 히스토리 관리, 로깅, Tool 필터링 등
  - Agent가 직접 호출하지 않고, Runtime이 자동으로 실행

**판단 기준:**
- "무언가를 실행해야" 하는가 → **Tool**
- "대화 흐름/메시지 정책/도구 노출/로그를 자동 제어"해야 하는가 → **Extension**

### 4.3 `@goondan/base` Tool 목록

| Tool | 한 줄 설명 | 언제 쓰면 좋은가 |
| --- | --- | --- |
| `bash` | 쉘 명령/스크립트 실행 | 로컬 빌드/테스트/자동화 |
| `file-system` | 파일 읽기/쓰기/목록/디렉토리 생성 | 코드/문서 생성, 파일 기반 파이프라인 |
| `agents` | 에이전트 간 요청/전달/스폰/조회 | 멀티 에이전트 협업 |
| `self-restart` | 런타임 재시작 신호 | Tool로 자가 재기동 트리거 필요 시 |
| `telegram` | Telegram 메시지 조작 | Telegram 직접 제어 |
| `slack` | Slack 메시지 조작/조회 | Slack 직접 제어 |
| `http-fetch` | GET/POST 호출 | 외부 API 연동 중심 작업 |
| `json-query` | JSON 탐색/추출/카운트/평탄화 | API 응답 가공 |
| `text-transform` | 텍스트 치환/분할/결합/변환 | 텍스트 정제, 포맷 조정 |

**Agent에 Tool 추가:**

```yaml
spec:
  tools:
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
```

### 4.4 `@goondan/base` Extension 목록

| Extension | 한 줄 설명 | 언제 쓰면 좋은가 |
| --- | --- | --- |
| `message-window` | 최근 N개 메시지만 남김 | 단순 token/메모리 절약 |
| `message-compaction` | 초과 메시지 제거/요약 | 장기 대화 유지 + 맥락 보존 |
| `logging` | Turn/Step/ToolCall 로그 | 디버깅·운영 추적 |
| `tool-search` | tool-search__search 도구 + tool catalog 필터 | 도구가 많아 호출 후보가 너무 많을 때 |

**Agent에 Extension 추가:**

```yaml
spec:
  extensions:
    - ref:
        kind: Extension
        name: message-window
        package: "@goondan/base"
    - ref:
        kind: Extension
        name: logging
        package: "@goondan/base"
```

### 4.5 상황별 권장 조합

**로컬 테스트:**
- Tool: 없음 (또는 `bash`, `file-system`)
- Extension: 없음

**로컬 자동화 스크립트:**
- Tool: `bash`, `file-system`
- Extension: `message-window` (선택)

**멀티 에이전트 복잡한 오케스트레이션:**
- Tool: `agents`, `self-restart`, `http-fetch`
- Extension: `tool-search`, `logging`, 메시지 정책

**장기 운영 채널 (Telegram/Slack):**
- Tool: `telegram` 또는 `slack`
- Extension: `message-compaction` 또는 `message-window` + `logging`

**중요:**
- Tool/Extension은 기본적으로 필수가 아닙니다
- 필요에 따라 선택적으로 추가하세요
- 장기 실행 Swarm은 메시지 정책 Extension 권장 (토큰 비용 절감)

### 4.6 Watch 모드와 Self-modification

**Watch 모드 (개발 시 권장):**
```bash
gdn run --watch   # 파일 변경 시 해당 에이전트만 자동 재시작
```

Watch 모드에서 Orchestrator는 `goondan.yaml` 및 리소스 파일의 변경을 감시하고, 영향받는 AgentProcess만 선택적으로 재시작합니다. 대화 히스토리는 유지됩니다.

**Self-modification 시나리오:**
에이전트가 `file-system` 도구로 자기 manifest를 수정하고, `bash` 도구로 `gdn validate`를 실행해 유효성을 확인하면, watch 모드가 변경을 감지하여 해당 에이전트 프로세스만 graceful restart합니다. 메시지 히스토리가 보존되어 에이전트는 "이전의 나"가 왜 수정했는지를 알 수 있습니다.

**선택적 재시작 (`gdn restart`):**
```bash
gdn restart --agent coder    # 특정 에이전트만 재시작
gdn restart --fresh           # 상태 초기화 후 전체 재시작
gdn restart --agent coder --fresh  # 특정 에이전트 상태 초기화 후 재시작
```

### 4.7 Telegram 연결 예시

`.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...
```

`Connection`:

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-default
spec:
  connectorRef:
    kind: Connector
    name: telegram-polling
    package: "@goondan/base"
  swarmRef: "Swarm/default"
  secrets:
    TELEGRAM_BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
  ingress:
    rules:
      - match:
          event: telegram_message
        route:
          instanceKey: "telegram-main"
```

---

## 5. 자주 막히는 지점

### 5.1 실행 전 기본 점검 (공통 체크리스트)

문제가 생겼을 때 이 순서대로 확인하세요:

1. **`gdn instance list`**
   - 같은 `instanceKey`가 이미 `running`인지 확인
   - 충돌하는 인스턴스가 있으면 `gdn instance restart <instanceKey>` 또는 `gdn instance delete <instanceKey>`

2. **`gdn validate`**
   - Bundle 문서 형식/참조/엔트리 파일 존재를 우선 확인
   - 오류 메시지에서 어떤 리소스가 문제인지 파악

3. **`gdn logs --instance-key <instanceKey>`**
   - 최근 로그로 root cause를 먼저 확인
   - 로그 위치: `~/.goondan/runtime/logs/<instanceKey>/`

4. 위 1~3을 정리한 뒤 재실행

### 5.2 `gdn validate` 실패 대응

**자주 발생하는 오류:**

1. **첫 문서에 `kind: Package` 없음**
   - `goondan.yaml`의 첫 번째 문서는 반드시 `kind: Package`여야 합니다

2. **Model 참조 오류** (`modelRef: "Model/xxx"`)
   - 참조하는 Model 리소스가 정의되어 있는지 확인
   - ObjectRef 형식이 `Kind/name`인지 확인

3. **API 키 환경 변수 누락**
   - `.env` 파일에 필요한 키가 있는지 확인
   - `valueFrom.env: ANTHROPIC_API_KEY` → `.env`의 `ANTHROPIC_API_KEY` 확인

4. **Connector/Tool/Extension 파일 경로 오류**
   - `spec.entry` 경로가 올바른지 확인
   - `@goondan/base` 패키지가 설치되었는지 확인 (`gdn package install`)

**상세 오류 확인:**
```bash
gdn validate --format json
```

### 5.3 `gdn run` 실패 대응

**시작 실패 시:**

1. **로그 먼저 확인**
   ```bash
   gdn logs --instance-key <instanceKey> --process orchestrator --stream both --lines 200
   ```

2. **로그 파일 직접 확인**
   - stdout: `~/.goondan/runtime/logs/<instanceKey>/orchestrator.stdout.log`
   - stderr: `~/.goondan/runtime/logs/<instanceKey>/orchestrator.stderr.log`

3. **일반적인 원인**
   - `gdn validate` 실패 → 먼저 validate 통과 필요
   - 패키지 미설치 → `gdn package install` 실행
   - 환경 변수 누락 → `.env` 파일 확인
   - 포트 충돌 (Connector 사용 시) → 포트 변경 또는 프로세스 종료

### 5.4 `gdn run --foreground` + Ctrl+C 후 재실행

**"이미 활성 runtime이 있습니다" 오류 시:**

1. **현재 상태 확인**
   ```bash
   gdn instance list
   ```

2. **실제 프로세스 확인**
   ```bash
   ps -p <pid> -o pid,ppid,stat,etime,command
   ```

3. **해결 방법**
   - 아직 `running` 상태:
     ```bash
     gdn instance restart <instanceKey>
     # 또는
     gdn instance delete <instanceKey> --force
     ```
   - `terminated` 상태: 보통 바로 재실행 가능

### 5.5 `gdn package add`/`install` 실패 대응

1. **패키지 ref 형식 확인**
   - 올바른 형식: `@scope/name` 또는 `@scope/name@tag`
   - 예: `@goondan/base`, `@goondan/base@latest`

2. **레지스트리/네트워크 확인**
   - 네트워크 연결 확인
   - 프록시 설정 확인

3. **설치 소스 누락/손상**
   ```bash
   gdn package install  # 재실행
   ```

4. **lock 파일 충돌**
   - `goondan.lock.yaml`이 계속 바뀌면 의존성 버전 충돌 메시지 확인

### 5.6 기타 자주 묻는 질문

**Q: `gdn init my-first-swarm`은 폴더를 만드나요?**
- `gdn init my-first-swarm`: `my-first-swarm/` 디렉터리 생성
- `gdn init`: 현재 디렉터리에 파일 생성

**Q: CLI 대화를 하려면 `--foreground`를 써야 하나요?**
- `gdn run` (기본): 백그라운드 실행
- `gdn run --foreground`: 터미널 입력으로 바로 테스트 가능

**Q: 여러 Swarm이 있으면?**
```bash
gdn run --swarm <name>
```
- 기본값: 첫 번째 Swarm

---

## 6. 자주 쓰는 명령어 (목적별 가이드)

### 6.1 프로젝트 시작
```bash
gdn init my-project            # 새 프로젝트 생성
cd my-project
gdn package add @goondan/base   # 기본 패키지 추가
gdn package install              # 패키지 설치
```

### 6.2 개발/테스트
```bash
gdn validate                # 설정 검증 (실행 전 필수)
gdn run --foreground        # CLI로 대화하며 테스트
gdn run --watch             # 파일 변경 시 해당 에이전트 자동 재시작
gdn logs                    # 로그 확인
gdn studio                  # Studio UI로 trace 기반 시각화 (127.0.0.1:4317)
```

### 6.3 배포/운영
```bash
gdn run                     # 백그라운드 실행
gdn instance list           # 실행 중인 인스턴스 확인
gdn restart                 # 설정 변경 후 전체 재시작
gdn restart --agent coder   # 특정 에이전트 프로세스만 재시작
gdn restart --fresh         # 상태 초기화 후 재시작
gdn instance restart <key>  # 특정 인스턴스만 재시작
```

### 6.4 문제 해결
```bash
gdn instance list                  # 현재 상태 확인
gdn logs --lines 200               # 최근 로그 확인
gdn logs --agent coder             # 특정 에이전트 이벤트만 필터링
gdn logs --trace <traceId>         # 특정 traceId의 이벤트 체인 추적
gdn logs --agent coder --trace abc # 에이전트 + traceId 동시 필터링
gdn validate                       # 설정 검증
gdn instance delete <key>          # 문제 있는 인스턴스 제거
```

### 6.5 명령어 빠른 참조

| 명령어 | 용도 | 주요 옵션 |
| --- | --- | --- |
| `gdn init` | 프로젝트 생성 | `--template <name>` |
| `gdn package add` | 패키지 추가 | |
| `gdn package install` | 패키지 설치 | |
| `gdn validate` | 설정 검증 | `--format json` |
| `gdn run` | 실행 | `--foreground`, `--watch`, `--swarm <name>` |
| `gdn restart` | 재시작 | `--agent <name>`, `--fresh` |
| `gdn logs` | 로그 확인 | `--lines N`, `--agent <name>`, `--trace <traceId>` |
| `gdn studio` | 시각화 UI | `--port <port>`, `--no-open` |
| `gdn instance list` | 인스턴스 목록 | |
| `gdn instance restart` | 인스턴스 재시작 | |
| `gdn instance delete` | 인스턴스 제거 | `--force` |

---

## 7. 테스트

### 7.1 테스트 구조

Goondan은 **단위 테스트**와 **E2E 테스트**를 분리하여 관리한다.

| 레벨 | 위치 | 실행 | 목적 |
|-------|------|------|------|
| 단위 테스트 | `packages/*/test/**/*.test.ts` | `pnpm -r test` | 개별 모듈/함수 단위 검증 |
| E2E 테스트 | `packages/runtime/test/e2e/*.test.ts` | `pnpm --filter @goondan/runtime test:e2e` | Orchestrator + IPC + 멀티에이전트 통합 검증 |

### 7.2 테스트 실행

```bash
# 전체 단위 테스트
pnpm -r test

# Runtime E2E 테스트
pnpm --filter @goondan/runtime test:e2e
```

E2E 테스트는 `--testTimeout 60000`(60초)로 실행된다.

### 7.3 E2E 테스트 구조

E2E 테스트는 `FakeProcessSpawner`/`FakeChildProcess`를 통해 실제 프로세스를 띄우지 않고 Orchestrator의 IPC 라우팅, 크래시 격리, Graceful Shutdown 등을 검증한다.

```
packages/runtime/test/e2e/
├── helpers.ts              # E2E 공통 유틸 (createE2EOrchestrator, 페이로드 생성 등)
├── architecture.test.ts    # Process-per-Agent 아키텍처 (스폰, 크래시 격리, 백오프, Graceful Shutdown)
├── observability.test.ts   # OTel TraceContext 전파, RuntimeEvent 발행
├── inter-agent.test.ts     # IPC request/send/response, 순환 감지, auth 전파
└── fixtures/               # 테스트 fixture (goondan.yaml, mock tool 등)
```

**3가지 테스트 카테고리:**

| 카테고리 | 파일 | 검증 대상 |
|----------|------|-----------|
| Architecture | `architecture.test.ts` | 프로세스 스폰/크래시 격리/재스폰/백오프/Watch 재시작/Graceful Shutdown |
| Observability | `observability.test.ts` | TraceContext 전파/traceId 유지/span 계층/RuntimeEvent 무결성 |
| Inter-agent | `inter-agent.test.ts` | request-response/fire-and-forget/correlationId/순환 감지/auth 전파 |

### 7.4 새 E2E 테스트 추가

1. `packages/runtime/test/e2e/` 아래에 `*.test.ts` 파일 생성
2. `helpers.ts`의 `createE2EOrchestrator()`로 Orchestrator 세트업
3. `FakeChildProcess`의 IPC 이벤트를 주입/검증

```typescript
import { describe, expect, it } from "vitest";
import { createE2EOrchestrator, spawnAllAgents } from "./helpers.js";

describe("My E2E Test", () => {
  it("should verify something", async () => {
    const { orchestrator, spawner } = createE2EOrchestrator({
      desiredAgents: ["agent-a", "agent-b"],
    });

    await spawnAllAgents(orchestrator, ["agent-a", "agent-b"]);

    // FakeChildProcess에서 IPC 메시지 검증
    const agentA = spawner.getProcess("agent-a");
    expect(agentA).toBeDefined();
  });
});
```

---

## 8. 더 깊게 볼 때 (문제별 진입 가이드)

### 8.1 실행 실패 시
- **`gdn run` 또는 `validate` 실패**: `docs/specs/resources.md` → 리소스 필드 정의 확인
- **런타임 오류**: `docs/specs/runtime.md` → 런타임 동작 모델 이해
- **CLI 명령어 상세**: `docs/specs/cli.md` → 전체 명령어 레퍼런스

### 8.2 설계/의사결정 시
- **전체 아키텍처 이해**: `docs/architecture.md` → 시스템 개요, 핵심 개념, 설계 패턴
- **리소스 간 관계**: `docs/specs/resources.md` → Kind별 스키마, ObjectRef, ValueSource
- **실행 모델 이해**: `docs/specs/runtime.md` → Process-per-Agent, IPC, Reconciliation Loop

### 8.3 확장 적용 시
- **Tool 개발**: `docs/specs/tool.md` → Tool 시스템 스펙, 더블 언더스코어 네이밍
- **Extension 개발**: `docs/specs/extension.md` → ExtensionApi, 미들웨어 파이프라인
- **Connector 개발**: `docs/specs/connector.md` → Connector 프로세스 모델
- **Connection 설정**: `docs/specs/connection.md` → Ingress 라우팅, 서명 검증

### 8.4 관측/디버깅
- **Trace 추적 이해**: `docs/specs/shared-types.md` 5절 → OTel 호환 TraceContext, Span 계층 구조
- **RuntimeEvent 확인**: `docs/specs/shared-types.md` 9절 → 9종 이벤트 계약
- **Studio 시각화**: `gdn studio` → trace 기반 Graph/Flow 뷰로 에이전트 상호작용 관찰
- **이벤트 필터링**: `gdn logs --agent <name> --trace <traceId>` → 에이전트별/trace별 이벤트 조회

### 8.5 패키지 관리
- **패키지 생성/배포**: `docs/specs/bundle_package.md` → Package 스펙, 레지스트리 API

### 8.6 전체 문서 목록
- `docs/architecture.md` - 아키텍처 개요
- `docs/specs/cli.md` - CLI 도구 스펙
- `docs/specs/resources.md` - 리소스 정의
- `docs/specs/runtime.md` - 런타임 실행 모델
- `docs/specs/tool.md` - Tool 시스템
- `docs/specs/extension.md` - Extension 시스템
- `docs/specs/connector.md` - Connector 시스템
- `docs/specs/connection.md` - Connection 시스템
- `docs/specs/bundle.md` - Bundle YAML 스펙
- `docs/specs/bundle_package.md` - Package 스펙
