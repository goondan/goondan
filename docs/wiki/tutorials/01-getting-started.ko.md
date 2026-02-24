# 시작하기

> Goondan을 설치하고, 첫 프로젝트를 만들고, AI 에이전트와 대화하기까지 -- 5분이면 충분합니다.

[English version](./01-getting-started.md)

---

## 만들게 될 것

이 튜토리얼을 마치면 다음을 갖게 됩니다:

- `goondan.yaml` 설정 파일이 포함된 Goondan 프로젝트
- Claude (또는 다른 LLM)로 구동되는 단일 AI 에이전트
- 에이전트와 대화할 수 있는 인터랙티브 CLI 세션

Goondan 사전 경험은 필요 없습니다. 터미널을 열고 텍스트 파일을 편집할 수 있다면 준비 완료입니다.

---

## 사전 준비

시작하기 전에 다음 두 가지가 필요합니다:

### 1. Bun 설치

Goondan은 빠른 JavaScript 런타임인 [Bun](https://bun.sh)에서 실행됩니다. 설치합니다:

```bash
curl -fsSL https://bun.sh/install | bash
```

설치를 확인합니다:

```bash
bun -v
```

**예상 출력:**

```
1.x.x
```

버전 번호가 보이면 준비 완료입니다.

### 2. LLM API 키 준비

최소 하나의 LLM 프로바이더에서 API 키가 필요합니다. Goondan이 지원하는 프로바이더:

| 프로바이더 | 환경 변수 | 키 발급 위치 |
|-----------|----------|-------------|
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/) |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/) |

이 튜토리얼은 Anthropic (Claude)을 기본으로 사용합니다. 다른 프로바이더로 변경하려면 [4단계](#4단계-환경-변수-설정)를 참고하세요.

---

## 1단계: Goondan CLI 설치

`gdn` 명령줄 도구를 전역으로 설치합니다:

```bash
bun add -g @goondan/cli
```

확인:

```bash
gdn --version
```

**예상 출력:**

```
0.0.3
```

> **다른 패키지 매니저**: `npm install -g @goondan/cli` 또는 `pnpm add -g @goondan/cli`도 사용할 수 있지만, 최상의 경험을 위해 Bun을 권장합니다.

---

## 2단계: 새 프로젝트 생성

`gdn init`으로 새 Goondan 프로젝트를 스캐폴드합니다:

```bash
gdn init my-first-swarm
cd my-first-swarm
```

**예상 출력:**

```
Created my-first-swarm/goondan.yaml
Created my-first-swarm/prompts/default.system.md
Created my-first-swarm/.env
Created my-first-swarm/.gitignore
Initialized git repository
```

다음과 같은 파일 구조가 생성됩니다:

```
my-first-swarm/
  goondan.yaml           # 메인 설정 파일
  prompts/
    default.system.md    # 에이전트 시스템 프롬프트
  .env                   # 환경 변수 템플릿
  .gitignore             # Git ignore 규칙
```

> **팁**: 경로 없이 `gdn init`을 실행하면 현재 디렉터리에서 초기화하고, `gdn init --template multi-agent`를 사용하면 멀티 에이전트 구성으로 시작합니다. 모든 옵션은 [CLI 레퍼런스: `gdn init`](../reference/cli-reference.ko.md#gdn-init)을 참고하세요.

---

## 3단계: `goondan.yaml` 이해하기

에디터에서 `goondan.yaml`을 엽니다. `---`로 구분된 네 개의 리소스 문서가 보입니다:

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
  name: claude
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
    modelRef: "Model/claude"
  prompt:
    system: |
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
```

각 리소스의 역할:

| 리소스 | 역할 |
|--------|------|
| **Package** | 프로젝트 메타데이터. `gdn run` 실행에 필수. 반드시 첫 번째 문서여야 합니다. |
| **Model** | 어떤 LLM을 사용하고 어떻게 인증할지 정의합니다. `valueFrom.env` 패턴으로 `.env` 파일에서 API 키를 읽습니다 -- 시크릿이 YAML에 직접 들어가지 않습니다. |
| **Agent** | 연산의 단위. Model을 참조하고 에이전트의 행동을 결정하는 시스템 프롬프트를 정의합니다. |
| **Swarm** | 에이전트들을 묶고 진입점을 설정합니다. `entryAgent`가 첫 번째 메시지를 받는 에이전트입니다. |

### 데이터 흐름

```
사용자 입력 (CLI)
  --> Swarm (entryAgent로 라우팅)
    --> Agent (Model을 사용해 응답 생성)
      --> Model (LLM API 호출)
```

### ObjectRef: 리소스가 서로를 참조하는 방법

`modelRef: "Model/claude"`와 `entryAgent: "Agent/assistant"`를 주목하세요. 이들은 **ObjectRef** 형식인 `Kind/name`을 사용합니다. 리소스가 서로 연결되는 방식입니다. 참조를 잘못 입력하면 `gdn validate`가 실행 전에 잡아냅니다.

> **더 깊이 알고 싶다면?** 리소스 모델, ObjectRef, ValueSource, instanceKey에 대한 자세한 설명은 [핵심 개념](../explanation/core-concepts.ko.md)을 참고하세요.

---

## 4단계: 환경 변수 설정

`.env` 파일을 열고 API 키를 추가합니다:

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**다른 프로바이더를 사용하나요?** `.env` 파일과 `goondan.yaml`의 Model 리소스를 함께 수정합니다:

**OpenAI** 사용 시:

```bash
# .env
OPENAI_API_KEY=sk-your-key-here
```

```yaml
# goondan.yaml에서 Model 문서를 교체:
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude   # 원한다면 "openai"로 변경 가능
spec:
  provider: openai
  model: gpt-4o
  apiKey:
    valueFrom:
      env: OPENAI_API_KEY
```

**Google (Gemini)** 사용 시:

```bash
# .env
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
```

```yaml
# goondan.yaml에서 Model 문서를 교체:
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude   # 원한다면 "gemini"로 변경 가능
spec:
  provider: google
  model: gemini-2.0-flash
  apiKey:
    valueFrom:
      env: GOOGLE_GENERATIVE_AI_API_KEY
```

> **보안 참고**: `.env` 파일은 절대 버전 관리에 커밋하지 마세요. 생성된 `.gitignore`에 이미 `.env.local`이 포함되어 있습니다. 팀 프로젝트에서는 `.env`를 플레이스홀더 값이 있는 템플릿으로 사용하고, 실제 키는 `.env.local`에 넣으세요.

---

## 5단계: 설정 검증

실행 전에 모든 것이 올바르게 설정되었는지 확인합니다:

```bash
gdn validate
```

**예상 출력 (성공 시):**

```
Validating /path/to/my-first-swarm...

  Schema validation passed
  Reference integrity passed
  File existence check passed
  Naming convention check passed

Errors: 0, Warnings: 0
```

**검증이 실패하면** 자주 발생하는 문제들:

| 오류 | 원인 | 해결 방법 |
|------|------|----------|
| "Package document not found" | 첫 번째 문서가 `kind: Package`가 아님 | `kind: Package`가 첫 `---` 섹션인지 확인 |
| "Model/xxx not found" | Agent가 존재하지 않는 Model을 참조 | `modelRef`가 Model의 `metadata.name`과 일치하는지 확인 |
| "ANTHROPIC_API_KEY not set" | 환경 변수 누락 | `.env`에 추가 |

> [CLI 레퍼런스: `gdn validate`](../reference/cli-reference.ko.md#gdn-validate)에서 검증 상세 및 JSON 출력 형식을 확인할 수 있습니다.

---

## 6단계: 스웜 실행

포그라운드 모드로 스웜을 시작하여 직접 상호작용합니다:

```bash
gdn run --foreground
```

**예상 출력:**

```
Orchestrator started (instanceKey: default)
Connector: cli ready
>
```

`>` 프롬프트가 보이면 에이전트가 준비되었고 입력을 기다리고 있다는 뜻입니다.

### 내부에서 일어나는 일

1. Goondan이 `goondan.yaml`을 파싱하고 모든 리소스를 검증합니다
2. Orchestrator가 상주 프로세스로 시작됩니다
3. CLI Connector가 활성화되어 인터랙티브 프롬프트를 제공합니다
4. 메시지를 입력하면 Swarm을 통해 진입 Agent로 라우팅됩니다
5. Agent가 LLM API를 호출하고 응답을 스트리밍합니다

---

## 7단계: 에이전트와 대화하기

`>` 프롬프트에 메시지를 입력합니다:

```
> 안녕하세요! 어떤 도움을 줄 수 있나요?
```

**예상 출력 (예시):**

```
안녕하세요! 저는 도움을 드리는 어시스턴트입니다. 다양한 작업을 도와드릴 수 있습니다:

- 다양한 주제에 대한 질문 답변
- 글 작성 및 편집
- 개념 설명
- 문제 해결 및 브레인스토밍
- 그 외 많은 것들!

오늘 무엇을 도와드릴까요?
>
```

더 많은 메시지를 시도해 보세요:

```
> "Kubernetes for Agent Swarm"이 무슨 의미인지 한 문단으로 설명해줘.
```

에이전트는 세션 내에서 대화 기록을 유지하므로, 앞서 논의한 내용을 기억합니다.

### 스웜 종료

**Ctrl+C**를 눌러 Orchestrator를 종료하고 셸로 돌아갑니다.

---

## 8단계: 프로젝트 정상 동작 확인

모든 것이 올바르게 설정되었는지 빠르게 확인합니다:

```bash
# 1. 설정 검증
gdn validate

# 2. 실행 중인 인스턴스 확인
gdn instance list

# 3. 환경 진단
gdn doctor
```

`gdn doctor`는 환경에 대한 종합 보고서를 보여줍니다:

```
Goondan Doctor
Checking your environment...

System
  Bun: Bun 1.x.x

API Keys
  Anthropic API Key: ANTHROPIC_API_KEY is set (sk-a...****)

Project
  Bundle Config: Found goondan.yaml
  Bundle Validation: Valid (4 resources)

Summary
  4 passed, 0 warnings, 0 errors
```

모두 통과하면 Goondan 설치가 완료되었고 정상 동작합니다.

---

## 배운 것

이 튜토리얼에서 다음을 수행했습니다:

1. Bun과 Goondan CLI (`gdn`)를 설치했습니다
2. `gdn init`으로 새 프로젝트를 생성했습니다
3. `goondan.yaml`의 구조를 배웠습니다 (Package, Model, Agent, Swarm)
4. `.env`와 `valueFrom.env`를 사용하여 API 키를 안전하게 설정했습니다
5. `gdn validate`로 설정을 검증했습니다
6. `gdn run --foreground`로 스웜을 실행하고 인터랙티브하게 대화했습니다
7. `gdn doctor`로 환경을 확인했습니다

---

## 다음 단계

스웜이 동작하니, 다음 경로를 탐색해 보세요:

### 에이전트에 도구 추가하기

`@goondan/base`의 도구를 추가하여 에이전트가 셸 명령 실행, 파일 읽기, HTTP API 호출 등을 할 수 있게 합니다:

1. 기본 패키지 추가: `gdn package add @goondan/base`
2. 설치: `gdn package install`
3. `goondan.yaml`의 Agent에 도구 추가:

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

> 사용 가능한 전체 도구 목록은 [How to: 내장 Tool 활용하기](../how-to/use-builtin-tools.ko.md)를 참고하세요.

### 커스텀 도구 만들기

에이전트가 호출할 수 있는 자체 도구를 만듭니다:

> 단계별 가이드는 [튜토리얼: 첫 번째 Tool 만들기](./02-build-your-first-tool.ko.md)를 참고하세요.

### 커스텀 Extension 만들기

turn/step/toolCall 파이프라인에 연결되는 미들웨어를 만듭니다:

> 단계별 가이드는 [튜토리얼: 첫 번째 Extension 만들기](./03-build-your-first-extension.ko.md)를 참고하세요.

### 외부 채널 연결하기

CLI Connector를 Telegram이나 Slack으로 교체하여 메시징 플랫폼을 통해 에이전트와 소통합니다:

> Connection 설정 예시는 [How to: Swarm 실행하기](../how-to/run-a-swarm.ko.md)를 참고하세요.

### 핵심 개념 배우기

리소스 모델, ObjectRef, instanceKey, 그리고 "Kubernetes for Agent Swarm" 철학을 이해합니다:

> 종합적인 설명은 [핵심 개념](../explanation/core-concepts.ko.md)을 참고하세요.

---

## 관련 문서

- [How to: Swarm 실행하기](../how-to/run-a-swarm.ko.md) -- 스웜 인스턴스 실행, 재시작, 관리
- [핵심 개념](../explanation/core-concepts.ko.md) -- 리소스 Kind, ObjectRef, instanceKey, Bundle, Package
- [CLI 레퍼런스](../reference/cli-reference.ko.md) -- `gdn` 전체 명령어 레퍼런스
- [리소스 레퍼런스](../reference/resources.ko.md) -- 8종 리소스 Kind YAML 스키마

---

_위키 버전: v0.0.3_
