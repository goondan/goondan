# Goondan 빠른 시작 가이드 (처음 사용자용)

> Kubernetes for Agent Swarm

이 문서는 Goondan을 처음 접한 사람이 `goondan.yaml`을 만들고 실행하고 확장할 수 있게 하는 실전 가이드다.  
런타임 내부 구현 상세(프로세스 상태, IPC 등)는 의도적으로 제외했다.

---

## 1. 시작 전 준비

- Node.js 18+ (권장: Bun 사용)
- LLM API 키 (예: `ANTHROPIC_API_KEY`)

CLI 설치:

```bash
# 권장
bun add -g @goondan/cli

# 대안
npm install -g @goondan/cli
pnpm add -g @goondan/cli
```

---

## 2. 5분 빠른 시작

### 2.1 프로젝트 생성

```bash
gdn init my-first-swarm --package
cd my-first-swarm
```

`--package`를 붙이는 이유: 현재 `gdn run`은 로컬 `kind: Package` 문서를 필수로 요구한다.

### 2.2 환경 변수 설정

`.env` 파일:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### 2.3 `goondan.yaml` 최소 예시

아래 내용으로 교체:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: "my-first-swarm"
spec:
  version: "0.1.0"
---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/default-model"
  prompts:
    systemPrompt: |
      You are a helpful assistant.
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/assistant"
  agents:
    - ref: "Agent/assistant"
---
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef:
    kind: Connector
    name: cli
    package: "@goondan/base"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route:
          instanceKey: "local"
```

### 2.4 패키지 설치, 검증, 실행

```bash
gdn package add @goondan/base
gdn package install
gdn validate
gdn run --foreground
```

`--foreground`로 실행하면 CLI 커넥터 입력을 바로 받을 수 있다.  
실행 후 터미널에 문장을 입력하면 Agent로 전달된다. 종료는 `Ctrl+C`.

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

### 4.2 Tool 추가 (`@goondan/base`)

`Agent.spec.tools`에 참조 추가:

```yaml
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

### 4.3 Extension 추가 (메시지 관리)

```yaml
extensions:
  - ref:
      kind: Extension
      name: message-window
      package: "@goondan/base"
  - ref:
      kind: Extension
      name: message-compaction
      package: "@goondan/base"
```

### 4.4 Telegram 연결 예시

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

### 5.1 `gdn init my-first-swarm`은 폴더를 만든다

- `gdn init my-first-swarm`: `my-first-swarm/` 디렉터리 생성
- `gdn init`: 현재 디렉터리에 파일 생성

### 5.2 `goondan.yaml`에 Package가 없으면 실행 실패

- 에러가 나면 첫 문서에 `kind: Package`가 있는지 먼저 확인

### 5.3 CLI 대화를 하려면 `--foreground`를 써야 한다

- `gdn run`(기본)은 백그라운드 실행
- 터미널 입력으로 테스트할 때는 `gdn run --foreground`

### 5.4 여러 Swarm이 있으면 실행 대상을 지정

```bash
gdn run --swarm <name>
```

---

## 6. 자주 쓰는 명령어

```bash
gdn init <path> --package
gdn package add <package-ref>
gdn package install
gdn validate
gdn run --foreground
gdn restart
gdn logs
gdn instance list
```

---

## 7. 더 깊게 볼 때

- 아키텍처 개요: `docs/architecture.md`
- CLI 규범: `docs/specs/cli.md`
- 리소스 필드 정의: `docs/specs/resources.md`
- 런타임 동작 SSOT: `docs/specs/runtime.md`

