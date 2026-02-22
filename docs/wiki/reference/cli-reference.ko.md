# CLI 레퍼런스 (`gdn`)

> Goondan v0.0.3

[English version](./cli-reference.md)

---

## 개요

`gdn`은 Goondan Agent Swarm Orchestrator의 공식 CLI 도구입니다. Orchestrator 실행, 인스턴스 관리, Bundle 검증, 패키지 관리, 환경 진단 등의 명령어를 제공합니다.

### 설치

```bash
# Bun (권장)
bun add -g @goondan/cli

# npm / pnpm
npm install -g @goondan/cli
pnpm add -g @goondan/cli
```

### 기본 사용법

```bash
gdn <command> [subcommand] [options]
```

> Swarm 실행 가이드는 [How to: Swarm 실행하기](../how-to/run-a-swarm.ko.md)를 참조하세요.

---

## 전역 옵션

모든 명령에 적용되는 옵션입니다.

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--help` | `-h` | 도움말 출력 | - |
| `--version` | `-V` | 버전 출력 | - |
| `--verbose` | `-v` | 상세 출력 활성화 | `false` |
| `--quiet` | `-q` | 출력 최소화 | `false` |
| `--config <path>` | `-c` | 설정 파일 경로 | `goondan.yaml` |
| `--state-root <path>` | | System Root 경로 | `~/.goondan` |
| `--no-color` | | 색상 출력 비활성화 | `false` |
| `--json` | | JSON 형식 출력 | `false` |

---

## 명령어 목록

| 명령어 | 설명 |
|--------|------|
| [`gdn init`](#gdn-init) | 새 Swarm 프로젝트 초기화 |
| [`gdn run`](#gdn-run) | Orchestrator 기동 (상주 프로세스) |
| [`gdn restart`](#gdn-restart) | 실행 중인 Orchestrator 재기동 |
| [`gdn validate`](#gdn-validate) | Bundle 구성 검증 |
| [`gdn instance`](#gdn-instance) | 인스턴스 관리 (list, restart, delete) |
| [`gdn logs`](#gdn-logs) | 프로세스 로그 조회 |
| [`gdn package`](#gdn-package) | 패키지 관리 (add, install, publish) |
| [`gdn doctor`](#gdn-doctor) | 환경 진단 |

---

## `gdn init`

새 Goondan Swarm 프로젝트를 초기화합니다. `goondan.yaml`의 첫 문서로 `kind: Package`를 항상 기본 생성합니다.

### 사용법

```bash
gdn init [path] [options]
```

### 인자

| 인자 | 설명 | 기본값 |
|------|------|--------|
| `path` | 프로젝트 디렉터리 경로 | `.` (현재 디렉터리) |

### 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--name <name>` | `-n` | Swarm 이름 | 디렉터리 이름 |
| `--template <name>` | `-t` | 템플릿 사용 | `default` |
| `--git` | | Git 저장소 초기화 | `true` |
| `--no-git` | | Git 저장소 초기화 안 함 | - |
| `--force` | `-f` | 기존 파일 덮어쓰기 | `false` |

### 템플릿

| 템플릿 | 설명 |
|--------|------|
| `default` | 기본 단일 에이전트 구성 |
| `multi-agent` | 멀티 에이전트 스웜 구성 |
| `package` | Package 구조 |
| `minimal` | 최소 구성 |

### 예시

```bash
# 현재 디렉터리에 기본 프로젝트 생성
gdn init

# 특정 경로에 프로젝트 생성
gdn init ./my-agent

# 멀티 에이전트 템플릿으로 생성
gdn init --template multi-agent

# Package 이름 지정
gdn init --name @myorg/my-tools
```

### 생성되는 파일 구조 (default 템플릿)

```
<project>/
  goondan.yaml           # 메인 구성 파일 (apiVersion: goondan.ai/v1)
  prompts/
    default.system.md    # 기본 시스템 프롬프트
  .env                   # 환경 변수 템플릿
  .gitignore             # Git 무시 파일
```

### 생성되는 goondan.yaml

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-agent
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
```

---

## `gdn run`

Orchestrator를 **상주 프로세스**로 기동합니다. 에이전트/커넥터 프로세스를 스폰하고 관리합니다.

### 사용법

```bash
gdn run [options]
```

### 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--swarm <name>` | `-s` | 실행할 Swarm 이름. 미지정 시 `default`를 찾고, 없으면 Swarm이 1개일 때 자동 선택 | `default` |
| `--watch` | `-w` | 파일 변경 감시 모드 (변경 시 자동 재시작) | `false` |
| `--foreground` | | 현재 터미널에 붙어서 실행 | `false` |
| `--input <text>` | | 초기 입력 메시지 | - |
| `--input-file <path>` | | 입력 파일 경로 | - |
| `--interactive` | | 대화형 모드 | CLI Connector 시 기본 |
| `--no-install` | | 의존성 자동 설치 안 함 | `false` |
| `--env-file <path>` | | 커스텀 환경 변수 파일 경로 | - |

### 동작 방식

1. `goondan.yaml` 및 관련 리소스 파일을 파싱
2. 로컬 `kind: Package` 문서와 `metadata.name` 존재를 검증 (없으면 실패)
3. 실행할 Swarm을 선택하고 instanceKey 계산: `Swarm.spec.instanceKey ?? Swarm.metadata.name`
4. 동일 키의 Orchestrator가 이미 실행 중이면 해당 프로세스를 재사용(resume)
5. `@goondan/runtime/runner` 경로를 해석하고 runtime-runner 자식 프로세스를 기동
6. startup handshake(`ready` 또는 `start_error`) 대기
7. Orchestrator 상태 파일(`runtime/active.json`) 갱신
8. 정의된 Connection마다 ConnectorProcess 스폰
9. CLI Connector인 경우 대화형 루프 시작
10. 이벤트 수신 시 필요한 AgentProcess 스폰

Orchestrator는 에이전트가 모두 종료되어도 살아 있으며, 새로운 이벤트가 오면 필요한 AgentProcess를 다시 스폰합니다.

### 환경 변수 파일 자동 로딩

`gdn run`은 프로젝트 루트에서 `.env` 파일을 자동으로 로드합니다.

**로딩 우선순위** (먼저 로드된 값이 우선):

1. `--env-file`로 지정한 파일 (최우선)
2. `.env.local` (로컬 머신 전용, gitignore 대상)
3. `.env` (프로젝트 기본값)

이미 시스템에 설정된 환경 변수는 **우선 유지됩니다** (덮어쓰지 않음).

### Watch 모드

```bash
gdn run --watch
```

`--watch` 모드에서 Orchestrator는:

- `goondan.yaml` 및 관련 리소스 파일의 변경을 감시합니다(MUST).
- 변경된 리소스를 파악하여 영향받는 AgentProcess만 선택적으로 재시작합니다(SHOULD).
- Tool/Extension/Connector entry 파일 변경 시에도 해당 프로세스를 재시작합니다(SHOULD).

### 환경 변수

| 변수 | 설명 |
|------|------|
| `GOONDAN_LOG_LEVEL` | 로그 레벨 (`debug`, `info`, `warn`, `error`) |
| `GOONDAN_STATE_ROOT` | System Root 경로 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API 키 |

### 예시

```bash
# 기본 실행 (CLI 대화형 모드)
gdn run

# 특정 Swarm 실행
gdn run --swarm code-review

# 개발 모드 (watch)
gdn run --watch

# foreground 모드 (Ctrl+C로 종료)
gdn run --foreground

# 단일 입력 후 종료
gdn run --input "Hello, agent!"

# 파일 입력
gdn run --input-file ./request.txt
```

---

## `gdn restart`

실행 중인 Orchestrator 인스턴스를 최신 runner 바이너리로 재기동합니다. active Swarm 정의에서 instanceKey를 다시 계산하고, replacement 프로세스를 먼저 시작한 뒤 기존 프로세스를 종료합니다.

### 사용법

```bash
gdn restart [options]
```

### 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--agent <name>` | `-a` | 지정한 에이전트의 프로세스만 재시작 (선택적 재시작) | - |
| `--fresh` | | 재시작 전에 persisted message history(`base/events/runtime-events`)를 초기화 | `false` |

### 동작 방식

1. `runtime/active.json`에서 active Orchestrator 인스턴스를 읽음
2. active Swarm 정의에서 instanceKey 재계산 (`Swarm.spec.instanceKey ?? Swarm.metadata.name`)
3. `--agent` 지정 시, Orchestrator에 해당 에이전트 프로세스만 재시작하도록 신호 전송
4. 그 외에는 replacement runner를 먼저 기동하고, active PID를 갱신한 뒤 기존 Orchestrator PID를 종료

### 예시

```bash
# active Orchestrator 재기동
gdn restart

# 특정 에이전트 프로세스만 재시작
gdn restart --agent coder

# 모든 상태를 초기화하고 재시작
gdn restart --fresh

# 특정 에이전트를 상태 초기화와 함께 재시작
gdn restart --agent coder --fresh
```

---

## `gdn validate`

Bundle 구성을 검증합니다.

### 사용법

```bash
gdn validate [path] [options]
```

### 인자

| 인자 | 설명 | 기본값 |
|------|------|--------|
| `path` | 검증할 Bundle 경로 | `.` |

### 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--strict` | | 엄격 모드 (경고도 오류로 처리) | `false` |
| `--fix` | | 자동 수정 가능한 문제 수정 | `false` |
| `--format <format>` | | 출력 형식 (`text`, `json`, `github`) | `text` |

### 검증 항목

1. **스키마 검증** -- YAML 리소스의 스키마 준수 여부 (`apiVersion: goondan.ai/v1`)
2. **참조 무결성** -- ObjectRef 대상 존재 여부
3. **파일 존재** -- entry 파일 경로 존재 여부
4. **순환 참조** -- 리소스 간 순환 참조 탐지
5. **명명 규칙** -- `metadata.name` 형식 검증
6. **Kind 검증** -- 지원되는 8종 Kind인지 확인 (Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)

### 출력 예시

**텍스트 형식:**

```
Validating /path/to/project...

  Schema validation passed
  Reference integrity passed
  File existence check failed
  - tools/missing/index.ts: File not found (referenced in Tool/missing)
  Naming convention warning
  - Tool/MyTool: Name should be lowercase with hyphens

Errors: 1, Warnings: 1
```

**JSON 형식:**

```json
{
  "valid": false,
  "errors": [
    {
      "code": "FILE_NOT_FOUND",
      "message": "File not found",
      "path": "tools/missing/index.ts",
      "resource": "Tool/missing",
      "field": "spec.entry",
      "suggestion": "해당 파일을 생성하거나 경로를 수정하세요",
      "helpUrl": "https://docs.goondan.io/errors/FILE_NOT_FOUND"
    }
  ],
  "warnings": [
    {
      "code": "NAMING_CONVENTION",
      "message": "Name should be lowercase with hyphens",
      "resource": "Tool/MyTool",
      "suggestion": "my-tool 형식으로 이름을 변경하세요"
    }
  ]
}
```

---

## `gdn instance`

오케스트레이터 인스턴스를 관리합니다. 하위 명령 없이 호출하면 인터랙티브 TUI 모드로 진입합니다.

### 하위 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn instance list` | 인스턴스 목록 |
| `gdn instance restart <key>` | 인스턴스 재시작 |
| `gdn instance delete <key>` | 인스턴스 삭제 |

### `gdn instance` (bare) -- 인터랙티브 TUI

`gdn instance`를 하위 명령 없이 호출하면 인터랙티브 TUI 모드로 진입합니다 (TTY 필요). ANSI 렌더링으로 인스턴스 상태를 실시간 표시합니다. non-TTY이거나 `--json` 지정 시 `gdn instance list`로 폴백합니다.

**단축키:**

| 키 | 동작 |
|----|------|
| `r` | 선택한 인스턴스 재시작 |
| `q` / Ctrl+C | 종료 |

각 행에 `started` 타임스탬프가 표시되어 재시작 여부를 확인할 수 있습니다.

### `gdn instance list`

오케스트레이터 인스턴스 목록을 출력합니다. `runtime/active.json`의 active runtime과 동일 state-root의 managed runtime-runner PID를 함께 표시합니다. Agent 대화 단위 인스턴스는 표시하지 않습니다.

```bash
gdn instance list [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--agent <name>` | `-a` | Agent 이름 필터 (`orchestrator`만 매칭) | - |
| `--limit <n>` | `-n` | 최대 개수 | `20` |
| `--all` | | 감지된 모든 인스턴스 표시 | `false` |

**출력 예시:**

```
INSTANCE KEY    AGENT          STATUS    CREATED              UPDATED
default         orchestrator   running   2026-02-13 09:30:00  2026-02-13 09:30:00
```

### `gdn instance restart`

특정 오케스트레이터 인스턴스를 최신 runner 바이너리로 재시작합니다. active Swarm 정의에서 instanceKey를 재계산하고 `runtime/active.json`의 PID를 갱신합니다.

```bash
gdn instance restart <key> [options]
```

**인자:**

| 인자 | 설명 |
|------|------|
| `key` | 재시작할 인스턴스 키 |

**옵션:**

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--fresh` | 재시작 전에 persisted message history(`base/events/runtime-events`)를 초기화 | `false` |

`gdn instance restart --fresh`를 사용하면 Studio가 읽는 메시지/런타임 이벤트 이력이 함께 비워져 새로고침 시 빈 상태로 시작됩니다.

**예시:**

```bash
gdn instance restart default
```

### `gdn instance delete`

인스턴스 상태를 삭제합니다. 메시지 히스토리, Extension 상태, 인스턴스 워크스페이스 디렉터리 전체를 제거합니다. active 여부와 무관하게 동일 state-root의 managed runtime-runner PID를 찾아 종료하며, 해당 runtime-runner의 자식 프로세스(agent/connector child 포함)도 함께 정리합니다.

```bash
gdn instance delete <key> [options]
```

**인자:**

| 인자 | 설명 |
|------|------|
| `key` | 삭제할 인스턴스 키 |

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--force` | `-f` | 확인 없이 삭제 | `false` |

**예시:**

```bash
# 인스턴스 삭제 (확인 프롬프트)
gdn instance delete user:123

# 확인 없이 삭제
gdn instance delete user:123 --force
```

---

## `gdn logs`

프로세스 로그 파일을 조회합니다.

### 사용법

```bash
gdn logs [options]
```

### 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--instance-key <key>` | `-i` | 조회할 인스턴스 키. 생략 시 `runtime/active.json`의 인스턴스 | active instance |
| `--agent <name>` | `-a` | 에이전트 이름으로 이벤트 필터링 | - |
| `--trace <traceId>` | | trace ID로 이벤트 필터링 (에이전트 간 단일 인과 체인 추적) | - |
| `--process <name>` | `-p` | 프로세스 이름 | `orchestrator` |
| `--stream <stdout\|stderr\|both>` | | 로그 스트림 선택 | `both` |
| `--lines <n>` | `-l` | 각 로그 파일에서 마지막 N줄 | `200` |

### 로그 파일 경로

```
~/.goondan/runtime/logs/<instanceKey>/<process>.stdout.log
~/.goondan/runtime/logs/<instanceKey>/<process>.stderr.log
```

### 예시

```bash
# active 인스턴스의 orchestrator 로그 (최근 200줄)
gdn logs

# 에이전트 이름으로 필터링
gdn logs --agent coder

# 특정 trace 체인을 에이전트 간 추적
gdn logs --trace abc-123-def

# 에이전트와 trace 필터 결합
gdn logs --agent coder --trace abc-123-def

# 특정 인스턴스 stderr (최근 100줄)
gdn logs --instance-key session-001 --stream stderr --lines 100

# 특정 프로세스 로그 조회
gdn logs --instance-key session-001 --process connector-telegram
```

---

## `gdn package`

패키지를 관리합니다.

### 하위 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn package add <ref>` | 의존성 추가 |
| `gdn package install` | 의존성 설치 |
| `gdn package publish` | 패키지 발행 |

### `gdn package add`

새 의존성을 추가합니다.

```bash
gdn package add <ref> [options]
```

**인자:**

| 인자 | 설명 |
|------|------|
| `ref` | Package 참조 (예: `@goondan/base`, `@goondan/base@1.0.0`) |

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--dev` | `-D` | devDependencies로 추가 | `false` |
| `--exact` | `-E` | 정확한 버전 고정 | `false` |
| `--registry <url>` | | 커스텀 레지스트리 | 설정 파일 기준 |

**예시:**

```bash
# 최신 버전 추가
gdn package add @goondan/base

# 특정 버전 추가
gdn package add @goondan/base@1.2.0

# 정확한 버전 고정
gdn package add @goondan/base@1.2.0 --exact
```

### `gdn package install`

`goondan.yaml`의 Package 문서에 정의된 모든 의존성을 설치합니다.

```bash
gdn package install [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--frozen-lockfile` | | lockfile 업데이트 안 함 | `false` |

**예시:**

```bash
# 모든 의존성 설치
gdn package install

# lockfile 기준으로 설치 (CI용)
gdn package install --frozen-lockfile
```

### `gdn package publish`

패키지를 레지스트리에 발행합니다.

```bash
gdn package publish [path] [options]
```

**인자:**

| 인자 | 설명 | 기본값 |
|------|------|--------|
| `path` | 패키지 경로 | `.` |

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--tag <tag>` | | 배포 태그 | `latest` |
| `--access <level>` | | 접근 수준 (`public`, `restricted`) | `public` |
| `--dry-run` | | 실제 발행하지 않고 시뮬레이션 | `false` |
| `--registry <url>` | | 커스텀 레지스트리 | 설정 파일 기준 |

**발행 전 검증:**

1. `goondan.yaml`의 Package 문서 존재 확인
2. `spec.dist` 디렉터리 존재 확인
3. `spec.exports` 파일 존재 확인
4. 버전 중복 확인
5. 구성 검증 (`gdn validate`)

**예시:**

```bash
# 패키지 발행
gdn package publish

# 베타 태그로 발행
gdn package publish --tag beta

# 시뮬레이션
gdn package publish --dry-run
```

---

## `gdn doctor`

환경을 진단하고 일반적인 문제를 확인합니다.

### 사용법

```bash
gdn doctor [options]
```

### 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--fix` | | 자동 수정 시도 (placeholder) | `false` |

### 검사 항목

**System:**

| 항목 | 설명 | 수준 |
|------|------|------|
| Bun | 버전 확인 | fail |
| npm/pnpm | 패키지 매니저 설치 확인 | warn |

**API Keys:**

| 항목 | 설명 | 수준 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 키 | warn |
| `OPENAI_API_KEY` | OpenAI API 키 | warn |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API 키 | warn |

**Goondan Packages:**

| 항목 | 설명 | 수준 |
|------|------|------|
| `@goondan/core` | core 패키지 버전 | warn |
| `@goondan/cli` | cli 패키지 버전 | warn |
| `@goondan/base` | base 패키지 버전 | warn |

**Project:**

| 항목 | 설명 | 수준 |
|------|------|------|
| Bundle Config | `goondan.yaml` 존재 여부 | warn |
| Bundle Validation | `goondan.yaml` 유효성 검증 | fail/warn |

### 출력 예시

```
Goondan Doctor
Checking your environment...

System
  Bun: Bun 1.1.x
  pnpm: pnpm 9.x.x

API Keys
  Anthropic API Key: ANTHROPIC_API_KEY is set (sk-a...****)
  OpenAI API Key: OPENAI_API_KEY is not set
    Set if using OpenAI: export OPENAI_API_KEY=your-api-key

Goondan Packages
  @goondan/core: @goondan/core@2.0.0
  @goondan/cli: @goondan/cli@2.0.0
  @goondan/base: @goondan/base@2.0.0

Project
  Bundle Config: Found goondan.yaml
  Bundle Validation: Valid (5 resources)

Summary
  8 passed, 1 warnings, 0 errors
```

---

## 종료 코드

| 코드 | 의미 |
|------|------|
| `0` | 성공 |
| `1` | 일반 오류 |
| `2` | 잘못된 인자/옵션 |
| `3` | 구성 오류 |
| `4` | 검증 오류 |
| `5` | 네트워크 오류 |
| `6` | 인증 오류 |
| `130` | 사용자 인터럽트 (Ctrl+C) |

---

## 설정 파일

### `~/.goondan/config.json`

전역 CLI 설정 파일입니다.

```json
{
  "registry": "https://goondan-registry.yechanny.workers.dev",
  "logLevel": "info",
  "registries": {
    "https://goondan-registry.yechanny.workers.dev": {
      "token": "xxx..."
    }
  },
  "scopedRegistries": {
    "@myorg": "https://my-org-registry.example.com"
  }
}
```

### 설정 우선순위

설정 우선순위 (높은 것이 우선):

1. CLI 옵션 (`--state-root` 등)
2. 환경 변수 (`GOONDAN_STATE_ROOT`, `GOONDAN_REGISTRY` 등)
3. `~/.goondan/config.json`
4. 기본값

---

## 관련 문서

- [How to: Swarm 실행하기](../how-to/run-a-swarm.ko.md) -- Swarm 실행 및 관리
- [레퍼런스: 리소스](./resources.ko.md) -- 8종 리소스 Kind 스키마
- [레퍼런스: Connector API](./connector-api.ko.md) -- Connector/Connection API 레퍼런스
- [설명: 런타임 모델](../explanation/runtime-model.ko.md) -- 실행 모델 이해

---

_위키 버전: v0.0.3_
