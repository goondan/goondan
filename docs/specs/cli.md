# Goondan CLI (gdn) 스펙 (v2.0)

> 이 문서는 Goondan v2 CLI 도구 `gdn`의 유일한 source of truth이다.

---

## 1. 개요

`gdn`은 Goondan Agent Swarm 오케스트레이터의 공식 CLI 도구이다. Orchestrator 상주 프로세스 모델과 Edit & Restart 패턴에 맞춰, Orchestrator 운영(`run`, `restart`)과 인스턴스 운영(`instance list/restart/delete`), 패키지 운영(`package`) 중심의 명령 체계를 제공한다.

CLI 명령 표면은 Orchestrator 운영(`run`, `restart`), 인스턴스 운영(`instance list/restart/delete`), 로그 운영(`logs`), 패키지 운영(`package`), 검증/진단(`validate`, `doctor`)으로 구성한다. CLI를 제공하는 구현은 인스턴스 운영 연산을 사람이 재현 가능하고 스크립트 가능한 형태로 노출해야 한다(SHOULD).

`gdn package` 명령어 매트릭스와 레지스트리 설정 우선순위는 `docs/specs/help.md`를 단일 기준으로 따른다.

### 1.1 설치

```bash
# Bun 사용 (권장)
bun add -g @goondan/cli

# npm/pnpm도 지원
npm install -g @goondan/cli
pnpm add -g @goondan/cli
```

### 1.2 기본 사용법

```bash
gdn <command> [subcommand] [options]
```

### 1.3 전역 옵션

모든 명령에 적용되는 전역 옵션:

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

## 2. 명령어 목록

| 명령어 | 설명 |
|--------|------|
| `gdn init` | 새 Swarm 프로젝트 초기화 |
| `gdn run` | Orchestrator 기동 (상주 프로세스) |
| `gdn restart` | 실행 중인 Orchestrator 재기동 |
| `gdn validate` | Bundle 구성 검증 |
| `gdn instance` | 인스턴스 관리 (list, restart, delete) |
| `gdn logs` | 프로세스 로그 조회 |
| `gdn package` | 패키지 관리 (add, install, publish) |
| `gdn doctor` | 환경 진단 및 문제 확인 |

---

## 3. gdn init

새 Goondan Swarm 프로젝트를 초기화한다.

### 3.1 사용법

```bash
gdn init [path] [options]
```

### 3.2 인자

| 인자 | 설명 | 기본값 |
|------|------|--------|
| `path` | 프로젝트 디렉터리 경로 | `.` (현재 디렉터리) |

### 3.3 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--name <name>` | `-n` | Swarm 이름 | 디렉터리 이름 |
| `--template <name>` | `-t` | 템플릿 사용 | `default` |
| `--package` | | Package로 초기화 | `false` |
| `--git` | | Git 저장소 초기화 | `true` |
| `--no-git` | | Git 저장소 초기화 안 함 | - |
| `--force` | `-f` | 기존 파일 덮어쓰기 | `false` |

### 3.4 템플릿

| 템플릿 | 설명 |
|--------|------|
| `default` | 기본 단일 에이전트 구성 |
| `multi-agent` | 멀티 에이전트 스웜 구성 |
| `package` | Package 구조 |
| `minimal` | 최소 구성 |

### 3.5 예시

```bash
# 현재 디렉터리에 기본 프로젝트 생성
gdn init

# 특정 경로에 프로젝트 생성
gdn init ./my-agent

# 멀티 에이전트 템플릿으로 생성
gdn init --template multi-agent

# Package로 초기화
gdn init --package --name @myorg/my-tools
```

### 3.6 생성되는 파일 구조

**default 템플릿:**

```
<project>/
  goondan.yaml           # 메인 구성 파일 (apiVersion: goondan.ai/v1)
  prompts/
    default.system.md    # 기본 시스템 프롬프트
  .env                   # 환경 변수 템플릿
  .gitignore             # Git 무시 파일
```

**생성되는 goondan.yaml 예시:**

```yaml
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
  modelRef: "Model/claude"
  systemPrompt: |
    You are a helpful assistant.
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  agents:
    - ref: "Agent/assistant"
  entryAgent: "Agent/assistant"
```

---

## 4. gdn run

Orchestrator를 **상주 프로세스**로 기동한다. 에이전트/커넥터 프로세스를 스폰하고 관리한다.

### 4.1 사용법

```bash
gdn run [options]
```

### 4.2 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--swarm <name>` | `-s` | 실행할 Swarm 이름. 미지정 시 `default`를 찾고, 없으면 Swarm이 1개일 때 자동 선택 | `default` |
| `--instance-key <key>` | `-i` | 인스턴스 키 | Project Root + Package 기반 human-readable 해시 키 |
| `--watch` | `-w` | 파일 변경 감시 모드 (변경 시 자동 재시작) | `false` |
| `--foreground` | | 백그라운드 분리 없이 현재 터미널에 붙어서 실행 | `false` |
| `--input <text>` | | 초기 입력 메시지 | - |
| `--input-file <path>` | | 입력 파일 경로 | - |
| `--interactive` | | 대화형 모드 | CLI Connector 시 기본 |
| `--no-install` | | 의존성 자동 설치 안 함 | `false` |
| `--env-file <path>` | | 커스텀 환경 변수 파일 경로 | - |

### 4.3 동작 방식

`gdn run`은 다음 순서로 동작한다:

1. `goondan.yaml` 및 관련 리소스 파일을 파싱
2. `--instance-key` 미지정 시 Project Root + Package 이름 기반 human-readable 해시 인스턴스 키(예: `allied-gray-antelope-darrelle`)를 계산
3. 동일 키의 Orchestrator가 이미 실행 중이면 해당 프로세스를 재사용(resume)하고 새 프로세스는 스폰하지 않음
4. Orchestrator 상주 프로세스 기동 (필요 시)
5. 정의된 Connector에 대해 ConnectorProcess 스폰
6. CLI Connector(기본)인 경우 대화형 루프 시작
7. 이벤트 수신 시 필요한 AgentProcess 스폰

**Orchestrator는 에이전트가 모두 종료되어도 살아 있으며**, 새로운 이벤트가 오면 필요한 AgentProcess를 다시 스폰한다.

### 4.4 환경 변수 파일 자동 로딩

`gdn run`은 프로젝트 루트 디렉토리에서 `.env` 파일을 자동으로 로드한다.

**로딩 우선순위** (먼저 로드된 값이 우선):
1. `--env-file` 로 지정한 파일 (최우선)
2. `.env.local` (로컬 머신 전용, gitignore 대상)
3. `.env` (프로젝트 기본값)

- 이미 시스템에 설정된 환경 변수는 **우선 유지된다.**
- `.env` 파일이 없어도 에러 없이 진행한다.

**예시 `.env` 파일:**

```bash
ANTHROPIC_API_KEY=sk-ant-...
BRAVE_SEARCH_API_KEY=BSA...
TELEGRAM_BOT_TOKEN=123456:ABC...
```

### 4.5 Watch 모드

```bash
# 파일 변경 시 해당 에이전트 자동 재시작
gdn run --watch
```

`--watch` 모드에서 Orchestrator는:
- `goondan.yaml` 및 관련 리소스 파일의 변경을 감시한다(MUST).
- 어떤 리소스가 변경되었는지 파악하여 영향받는 AgentProcess만 선택적으로 재시작한다(SHOULD).
- Tool/Extension/Connector entry 파일 변경 시에도 해당 프로세스를 재시작한다(SHOULD).

### 4.6 환경 변수

| 변수 | 설명 |
|------|------|
| `GOONDAN_LOG_LEVEL` | 로그 레벨 (`debug`, `info`, `warn`, `error`) |
| `GOONDAN_STATE_ROOT` | System Root 경로 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API 키 |

### 4.7 예시

```bash
# 기본 실행 (CLI 대화형 모드)
gdn run

# 특정 Swarm 실행
gdn run --swarm code-review

# 인스턴스 키 지정
gdn run --instance-key session-001

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

## 5. gdn restart

실행 중인 Orchestrator 인스턴스를 최신 runner 바이너리로 재기동한다. active 인스턴스의 bundle/instanceKey를 유지한 채 새 프로세스를 시작하고 기존 PID를 종료한다.

### 5.1 사용법

```bash
gdn restart [options]
```

### 5.2 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--agent <name>` | `-a` | 호환용 필드. 현재 구현은 인스턴스 전체를 재기동 | - |
| `--fresh` | | 호환용 플래그(현재 구현은 인스턴스 재기동에 전달) | `false` |

### 5.3 동작 방식

1. `runtime/active.json`의 active Orchestrator 인스턴스를 읽는다.
2. 동일 `instanceKey`/bundle로 replacement runner를 먼저 기동한다.
3. active pid를 새 값으로 갱신하고, 기존 Orchestrator PID를 종료한다.

### 5.4 예시

```bash
# active Orchestrator 인스턴스 재기동
gdn restart

# agent 지정(호환용)
gdn restart --agent coder

# fresh 플래그 전달(호환용)
gdn restart --fresh

# agent 지정 + fresh(호환용)
gdn restart --agent coder --fresh
```

---

## 6. gdn validate

Bundle 구성을 검증한다.

### 6.1 사용법

```bash
gdn validate [path] [options]
```

### 6.2 인자

| 인자 | 설명 | 기본값 |
|------|------|--------|
| `path` | 검증할 Bundle 경로 | `.` |

### 6.3 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--strict` | | 엄격 모드 (경고도 오류로 처리) | `false` |
| `--fix` | | 자동 수정 가능한 문제 수정 | `false` |
| `--format <format>` | | 출력 형식 (`text`, `json`, `github`) | `text` |

### 6.4 검증 항목

1. **스키마 검증**: YAML 리소스의 스키마 준수 여부 (`apiVersion: goondan.ai/v1`)
2. **참조 무결성**: ObjectRef 대상 존재 여부
3. **파일 존재**: entry 파일 경로 존재 여부
4. **순환 참조**: 리소스 간 순환 참조 탐지
5. **명명 규칙**: `metadata.name` 형식 검증
6. **Kind 검증**: 지원되는 8종 Kind인지 확인 (Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)

### 6.5 출력 예시

**텍스트 형식:**

```
Validating /path/to/project...

✓ Schema validation passed
✓ Reference integrity passed
✗ File existence check failed
  - tools/missing/index.ts: File not found (referenced in Tool/missing)
⚠ Naming convention warning
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

## 7. gdn instance

인스턴스를 관리한다. 표준 하위 명령은 `list`, `restart`, `delete`다.

### 7.1 하위 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn instance list` | 인스턴스 목록 |
| `gdn instance restart <key>` | 인스턴스 재시작 |
| `gdn instance delete <key>` | 인스턴스 삭제 |

### 7.2 gdn instance list

오케스트레이터 인스턴스 목록을 출력한다. 구현은 `runtime/active.json`의 active runtime과, 동일 `state-root`에서 실행 중인 managed runtime-runner PID를 함께 집계해야 한다(SHOULD). Agent 대화 단위 인스턴스(`workspaces/*/instances/*`)는 표시하지 않는다.

**사용법:**

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
INSTANCE KEY                     AGENT         STATUS    CREATED              UPDATED
allied-gray-antelope-darrelle   orchestrator  running   2026-02-13 09:30:00  2026-02-13 09:30:00
```

### 7.3 gdn instance restart

특정 오케스트레이터 인스턴스를 최신 runner 바이너리로 재시작한다. 재시작 시 동일 `instanceKey`와 bundle 경로를 유지하고, 새 프로세스 PID를 `runtime/active.json`에 반영한다. 인터랙티브 `gdn instance` 화면은 각 행에 `started=<timestamp>`를 표시해 재시작 여부를 눈으로 확인할 수 있어야 한다(SHOULD).

**사용법:**

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
| `--fresh` | fresh restart 플래그 전달 | `false` |

**예시:**

```bash
gdn instance restart allied-gray-antelope-darrelle
```

### 7.4 gdn instance delete

인스턴스 상태를 삭제한다. 메시지 히스토리, Extension 상태 등 인스턴스 디렉터리 전체를 제거한다. 대상 key가 active가 아니어도 동일 `state-root`에서 실행 중인 managed runtime-runner PID를 찾아 종료해야 한다(SHOULD).

**사용법:**

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

## 8. gdn package

Package를 관리한다.

### 8.1 하위 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn package add <ref>` | 의존성 추가 |
| `gdn package install` | 의존성 설치 |
| `gdn package publish` | 패키지 발행 |

`gdn package` 명령어 표면의 단일 기준은 `docs/specs/help.md` 5절을 따른다.

### 8.2 gdn package add

새 의존성을 추가한다.

**사용법:**

```bash
gdn package add <ref> [options]
```

**인자:**

| 인자 | 설명 |
|------|------|
| `ref` | Package Ref (예: `@goondan/base`, `@goondan/base@1.0.0`) |

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--dev` | `-D` | devDependencies로 추가 | `false` |
| `--exact` | `-E` | 정확한 버전 고정 | `false` |
| `--registry <url>` | | 커스텀 레지스트리 | 설정 파일 기준 |

**예시:**

```bash
# 패키지 추가 (최신 버전)
gdn package add @goondan/base

# 특정 버전 추가
gdn package add @goondan/base@1.2.0

# 정확한 버전 고정
gdn package add @goondan/base@1.2.0 --exact
```

### 8.3 gdn package install

`goondan.yaml`의 Package 문서에 정의된 모든 의존성을 설치한다.

**사용법:**

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

### 8.4 gdn package publish

패키지를 레지스트리에 발행한다.

**사용법:**

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

**예시:**

```bash
# 패키지 발행
gdn package publish

# 베타 태그로 발행
gdn package publish --tag beta

# 시뮬레이션
gdn package publish --dry-run
```

**발행 전 검증:**

1. `goondan.yaml`의 Package 문서 존재 확인
2. `spec.dist` 디렉터리 존재 확인
3. `spec.exports` 파일 존재 확인
4. 버전 중복 확인
5. 구성 검증 (`gdn validate`)

---

## 9. gdn logs

프로세스 로그 파일을 조회한다.

### 9.1 사용법

```bash
gdn logs [options]
```

### 9.2 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--instance-key <key>` | `-i` | 조회할 인스턴스 키. 생략 시 `runtime/active.json`의 인스턴스 | active instance |
| `--process <name>` | `-p` | 프로세스 이름 | `orchestrator` |
| `--stream <stdout\|stderr\|both>` | | 로그 스트림 선택 | `both` |
| `--lines <n>` | `-l` | 각 로그 파일에서 마지막 N줄 | `200` |

### 9.3 로그 파일 경로

기본 로그 경로는 다음을 따른다.

```text
~/.goondan/runtime/logs/<instanceKey>/<process>.stdout.log
~/.goondan/runtime/logs/<instanceKey>/<process>.stderr.log
```

### 9.4 예시

```bash
# active 인스턴스의 orchestrator stdout/stderr 최근 200줄
gdn logs

# 특정 인스턴스 stderr 최근 100줄
gdn logs --instance-key session-001 --stream stderr --lines 100

# 특정 프로세스 로그 조회
gdn logs --instance-key session-001 --process connector-telegram
```

---

## 10. gdn doctor

환경을 진단하고 일반적인 문제를 확인한다.

### 10.1 사용법

```bash
gdn doctor [options]
```

### 10.2 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--fix` | | 자동 수정 시도 (placeholder) | `false` |

### 10.3 검사 항목

**System:**

| 항목 | 설명 | 수준 |
|------|------|------|
| Bun | 버전 확인 | fail |
| npm/pnpm | 패키지 매니저 설치 확인 | warn |

**API Keys:**

| 항목 | 설명 | 수준 |
|------|------|------|
| ANTHROPIC_API_KEY | Anthropic API 키 | warn |
| OPENAI_API_KEY | OpenAI API 키 | warn |
| GOOGLE_GENERATIVE_AI_API_KEY | Google AI API 키 | warn |

**Goondan Packages:**

| 항목 | 설명 | 수준 |
|------|------|------|
| @goondan/core | core 패키지 버전 | warn |
| @goondan/cli | cli 패키지 버전 | warn |
| @goondan/base | base 패키지 버전 | warn |

**Project:**

| 항목 | 설명 | 수준 |
|------|------|------|
| Bundle Config | goondan.yaml 존재 여부 | warn |
| Bundle Validation | goondan.yaml 유효성 검증 | fail/warn |

### 10.4 출력 예시

```
Goondan Doctor
Checking your environment...

System
  ✓ Bun: Bun 1.1.x
  ✓ pnpm: pnpm 9.x.x

API Keys
  ✓ Anthropic API Key: ANTHROPIC_API_KEY is set (sk-a...****)
  ⚠ OpenAI API Key: OPENAI_API_KEY is not set
    Set if using OpenAI: export OPENAI_API_KEY=your-api-key

Goondan Packages
  ✓ @goondan/core: @goondan/core@2.0.0
  ✓ @goondan/cli: @goondan/cli@2.0.0
  ✓ @goondan/base: @goondan/base@2.0.0

Project
  ✓ Bundle Config: Found goondan.yaml
  ✓ Bundle Validation: Valid (5 resources)

Summary
  8 passed, 1 warnings, 0 errors
```

---

## 11. 종료 코드

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

## 12. 설정 파일

### 12.1 ~/.goondan/config.json

전역 CLI 설정 파일 경로는 `~/.goondan/config.json`이다.

```json
{
  "registry": "https://registry.goondan.ai",
  "logLevel": "info",
  "registries": {
    "https://registry.goondan.ai": {
      "token": "xxx..."
    }
  },
  "scopedRegistries": {
    "@myorg": "https://my-org-registry.example.com"
  }
}
```

설정을 변경하려면 이 파일을 직접 편집한다.
레지스트리 설정 소스/우선순위의 규범 기준은 `docs/specs/help.md` 4절을 따른다.

### 12.2 환경 변수 우선순위

설정 우선순위 (높은 것이 우선):

1. CLI 옵션 (`--state-root` 등)
2. 환경 변수 (`GOONDAN_STATE_ROOT`, `GOONDAN_REGISTRY` 등)
3. `~/.goondan/config.json`
4. 기본값

---

## 13. 관련 문서

- `docs/specs/runtime.md`: Runtime 실행 모델 스펙
- `docs/specs/workspace.md`: Workspace 모델 스펙
- `docs/specs/bundle.md`: Bundle YAML 스펙
- `docs/specs/bundle_package.md`: Package 스펙

---

**문서 버전**: v2.0
**최종 수정**: 2026-02-12
