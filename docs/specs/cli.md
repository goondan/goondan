# Goondan CLI (gdn) 스펙 (v0.10)

본 문서는 Goondan CLI 도구 `gdn`의 명령어, 옵션, 동작 규격을 정의한다.

---

## 1. 개요

`gdn`은 Goondan Agent Swarm 오케스트레이터의 공식 CLI 도구이다.

### 1.1 설치

```bash
npm install -g @goondan/cli
# 또는
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
| `--state-root <path>` | | System State Root 경로 | `~/.goondan` |
| `--no-color` | | 색상 출력 비활성화 | `false` |
| `--json` | | JSON 형식 출력 | `false` |

---

## 2. 명령어 목록

| 명령어 | 설명 |
|--------|------|
| `gdn init` | 새 Swarm 프로젝트 초기화 |
| `gdn run` | Swarm 실행 |
| `gdn validate` | Bundle 구성 검증 |
| `gdn package` | 패키지 관리 (install, add, remove, publish, login) |
| `gdn instance` | 인스턴스 관리 (list, inspect, delete) |
| `gdn logs` | 로그 조회 |
| `gdn config` | CLI 설정 관리 |
| `gdn completion` | 쉘 자동완성 스크립트 생성 |
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
| `--package` | | Bundle Package로 초기화 | `false` |
| `--git` | | Git 저장소 초기화 | `true` |
| `--no-git` | | Git 저장소 초기화 안 함 | - |
| `--force` | `-f` | 기존 파일 덮어쓰기 | `false` |

### 3.4 템플릿

| 템플릿 | 설명 |
|--------|------|
| `default` | 기본 단일 에이전트 구성 |
| `multi-agent` | 멀티 에이전트 스웜 구성 |
| `package` | Bundle Package 구조 |
| `minimal` | 최소 구성 |

### 3.5 예시

```bash
# 현재 디렉터리에 기본 프로젝트 생성
gdn init

# 특정 경로에 프로젝트 생성
gdn init ./my-agent

# 멀티 에이전트 템플릿으로 생성
gdn init --template multi-agent

# Bundle Package로 초기화
gdn init --package --name @myorg/my-tools
```

### 3.6 생성되는 파일 구조

**default 템플릿:**
```
<project>/
  goondan.yaml           # 메인 구성 파일
  prompts/
    default.system.md    # 기본 시스템 프롬프트
  .gitignore             # Git 무시 파일
```

**package 템플릿:**
```
<project>/
  package.yaml           # Package 매니페스트
  goondan.yaml           # 메인 구성 파일
  src/
    tools/
      example/
        tool.yaml
        index.ts
  dist/                  # 빌드 출력 (gitignore)
  tsconfig.json
  package.json
  .gitignore
```

---

## 4. gdn run

Swarm을 실행한다.

### 4.1 사용법

```bash
gdn run [options]
```

### 4.2 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--swarm <name>` | `-s` | 실행할 Swarm 이름 | `default` |
| `--connector <name>` | | 사용할 Connector | 구성에 따름 |
| `--instance-key <key>` | `-i` | 인스턴스 키 | 자동 생성 |
| `--input <text>` | | 초기 입력 메시지 | - |
| `--input-file <path>` | | 입력 파일 경로 | - |
| `--interactive` | | 대화형 모드 | CLI Connector 시 기본 |
| `--watch` | `-w` | 파일 변경 감시 모드 | `false` |
| `--port <number>` | `-p` | HTTP 서버 포트 | - |
| `--no-install` | | 의존성 자동 설치 안 함 | `false` |

### 4.3 Connector 모드

**CLI Connector (기본):**
```bash
# 대화형 모드
gdn run

# 단일 입력
gdn run --input "Hello, agent!"

# 파일 입력
gdn run --input-file ./request.txt
```

**HTTP Connector:**
```bash
# HTTP 서버 모드로 실행
gdn run --connector http --port 3000
```

**Watch 모드:**
```bash
# 파일 변경 시 자동 재시작
gdn run --watch
```

### 4.4 환경 변수

| 변수 | 설명 |
|------|------|
| `GOONDAN_LOG_LEVEL` | 로그 레벨 (`debug`, `info`, `warn`, `error`) |
| `GOONDAN_STATE_ROOT` | System State Root 경로 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `ANTHROPIC_API_KEY` | Anthropic API 키 |

### 4.5 예시

```bash
# 기본 실행
gdn run

# 특정 Swarm 실행
gdn run --swarm code-review

# 인스턴스 키 지정
gdn run --instance-key session-001

# 개발 모드 (watch)
gdn run --watch

# HTTP 서버로 실행
gdn run --connector http --port 8080
```

---

## 5. gdn validate

Bundle 구성을 검증한다.

### 5.1 사용법

```bash
gdn validate [path] [options]
```

### 5.2 인자

| 인자 | 설명 | 기본값 |
|------|------|--------|
| `path` | 검증할 Bundle 경로 | `.` |

### 5.3 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--strict` | | 엄격 모드 (경고도 오류로 처리) | `false` |
| `--fix` | | 자동 수정 가능한 문제 수정 | `false` |
| `--format <format>` | | 출력 형식 (`text`, `json`, `github`) | `text` |

### 5.4 검증 항목

1. **스키마 검증**: YAML 리소스의 스키마 준수 여부
2. **참조 무결성**: ObjectRef 대상 존재 여부
3. **파일 존재**: entry, systemRef 등 파일 경로 존재 여부
4. **scopes 검증**: OAuth scopes 부분집합 관계
5. **순환 참조**: 리소스 간 순환 참조 탐지
6. **명명 규칙**: metadata.name 형식 검증

### 5.5 출력 예시

**텍스트 형식:**
```
Validating /path/to/project...

✓ Schema validation passed
✓ Reference integrity passed
✗ File existence check failed
  - prompts/missing.md: File not found (referenced in Agent/planner)
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
      "path": "prompts/missing.md",
      "resource": "Agent/planner",
      "field": "spec.prompts.systemRef"
    }
  ],
  "warnings": [
    {
      "code": "NAMING_CONVENTION",
      "message": "Name should be lowercase with hyphens",
      "resource": "Tool/MyTool"
    }
  ]
}
```

---

## 6. gdn package

Bundle Package를 관리한다.

### 6.1 하위 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn package install` | 의존성 설치 |
| `gdn package add <ref>` | 의존성 추가 |
| `gdn package remove <ref>` | 의존성 제거 |
| `gdn package update` | 의존성 업데이트 |
| `gdn package list` | 설치된 패키지 목록 |
| `gdn package publish` | 패키지 발행 |
| `gdn package login` | 레지스트리 로그인 |
| `gdn package logout` | 레지스트리 로그아웃 |
| `gdn package pack` | 로컬 tarball 생성 |
| `gdn package info <ref>` | 패키지 정보 조회 |

---

### 6.2 gdn package install

`package.yaml`에 정의된 모든 의존성을 설치한다.

**사용법:**
```bash
gdn package install [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--frozen-lockfile` | | lockfile 업데이트 안 함 | `false` |
| `--ignore-scripts` | | 설치 스크립트 무시 | `false` |
| `--production` | | devDependencies 제외 | `false` |

**예시:**
```bash
# 모든 의존성 설치
gdn package install

# lockfile 기준으로 설치 (CI용)
gdn package install --frozen-lockfile
```

---

### 6.3 gdn package add

새 의존성을 추가한다.

**사용법:**
```bash
gdn package add <ref> [options]
```

**인자:**

| 인자 | 설명 |
|------|------|
| `ref` | Bundle Package Ref (예: `@goondan/base`, `@goondan/base@1.0.0`) |

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

# 개발 의존성으로 추가
gdn package add @goondan/testing --dev
```

---

### 6.4 gdn package remove

의존성을 제거한다.

**사용법:**
```bash
gdn package remove <ref>
```

**예시:**
```bash
gdn package remove @goondan/base
```

---

### 6.5 gdn package update

의존성을 업데이트한다.

**사용법:**
```bash
gdn package update [ref] [options]
```

**인자:**

| 인자 | 설명 |
|------|------|
| `ref` | 업데이트할 패키지 (생략 시 전체) |

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--latest` | | 최신 버전으로 업데이트 | `false` |

**예시:**
```bash
# 모든 패키지 업데이트
gdn package update

# 특정 패키지 업데이트
gdn package update @goondan/base

# 최신 버전으로 업데이트
gdn package update --latest
```

---

### 6.6 gdn package list

설치된 패키지 목록을 출력한다.

**사용법:**
```bash
gdn package list [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--depth <n>` | | 의존성 트리 깊이 | `0` |
| `--all` | `-a` | 모든 의존성 표시 | `false` |

**출력 예시:**
```
@goondan/base@1.0.0
@goondan/slack-toolkit@2.1.0
@myorg/custom-tools@1.0.0
```

**트리 출력 (`--depth 1`):**
```
@goondan/base@1.0.0
├── @goondan/core-utils@0.5.2
└── @goondan/common@1.0.0
@goondan/slack-toolkit@2.1.0
└── @goondan/base@1.0.0
```

---

### 6.7 gdn package publish

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

# 비공개 패키지로 발행
gdn package publish --access restricted

# 시뮬레이션
gdn package publish --dry-run
```

**발행 전 검증:**
1. `package.yaml` 존재 확인
2. `spec.dist` 디렉터리 존재 확인
3. `spec.resources` 파일 존재 확인
4. 버전 중복 확인
5. 구성 검증 (`gdn validate`)

---

### 6.8 gdn package login

레지스트리에 로그인한다.

**사용법:**
```bash
gdn package login [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--registry <url>` | | 레지스트리 URL | `https://registry.goondan.io` |
| `--scope <scope>` | | 스코프별 로그인 | - |
| `--token <token>` | | 토큰 직접 지정 | - |

**예시:**
```bash
# 기본 레지스트리 로그인
gdn package login

# 프라이빗 레지스트리 로그인
gdn package login --registry https://my-registry.example.com

# 스코프별 로그인
gdn package login --scope @myorg --registry https://my-org-registry.example.com

# 토큰으로 로그인 (CI용)
gdn package login --token $GOONDAN_REGISTRY_TOKEN
```

**인증 정보 저장:**
인증 정보는 `~/.goondanrc`에 저장된다:
```yaml
registries:
  "https://registry.goondan.io":
    token: "xxx..."
  "https://my-org-registry.example.com":
    token: "yyy..."

scopedRegistries:
  "@myorg": "https://my-org-registry.example.com"
```

---

### 6.9 gdn package logout

레지스트리에서 로그아웃한다.

**사용법:**
```bash
gdn package logout [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--registry <url>` | | 레지스트리 URL | `https://registry.goondan.io` |
| `--scope <scope>` | | 스코프별 로그아웃 | - |

---

### 6.10 gdn package pack

로컬 tarball 파일을 생성한다.

**사용법:**
```bash
gdn package pack [path] [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--out <path>` | `-o` | 출력 경로 | 현재 디렉터리 |

**예시:**
```bash
# tarball 생성
gdn package pack

# 출력 경로 지정
gdn package pack --out ./dist
```

**출력:**
```
Created: my-package-1.0.0.tgz
```

---

### 6.11 gdn package info

패키지 정보를 조회한다.

**사용법:**
```bash
gdn package info <ref> [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--registry <url>` | | 레지스트리 URL | 설정 파일 기준 |

**출력 예시:**
```
@goondan/base@1.0.0

Description: Goondan 기본 Tool/Extension 번들
Published:   2026-01-15T10:30:00Z

dist-tags:
  latest: 1.0.0
  beta:   2.0.0-beta.1

versions:
  1.0.0, 0.9.0, 0.8.0

dependencies:
  @goondan/core-utils: ^0.5.0

resources:
  - tools/fileRead/tool.yaml
  - extensions/skills/extension.yaml

tarball: https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz
shasum:  abc123def456...
```

---

## 7. gdn instance

실행 중이거나 저장된 인스턴스를 관리한다.

### 7.1 하위 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn instance list` | 인스턴스 목록 |
| `gdn instance inspect <id>` | 인스턴스 상세 정보 |
| `gdn instance delete <id>` | 인스턴스 삭제 |
| `gdn instance resume <id>` | 인스턴스 재개 |

---

### 7.2 gdn instance list

인스턴스 목록을 출력한다.

**사용법:**
```bash
gdn instance list [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--swarm <name>` | `-s` | Swarm 이름으로 필터 | - |
| `--limit <n>` | `-n` | 최대 개수 | `20` |
| `--all` | `-a` | 모든 인스턴스 | `false` |

**출력 예시:**
```
INSTANCE ID          SWARM       STATUS      CREATED              TURNS
default-cli          default     active      2026-02-05 10:30:00  5
default-1700000000   default     idle        2026-02-04 15:20:00  12
code-review-pr-123   code-rev    completed   2026-02-03 09:00:00  8
```

---

### 7.3 gdn instance inspect

인스턴스 상세 정보를 출력한다.

**사용법:**
```bash
gdn instance inspect <id>
```

**출력 예시:**
```
Instance: default-cli
Swarm:    default
Status:   active
Created:  2026-02-05 10:30:00
Updated:  2026-02-05 10:45:00

Agents:
  planner:
    Turns: 3
    Messages: 15
    Last Active: 2026-02-05 10:45:00
  coder:
    Turns: 2
    Messages: 10
    Last Active: 2026-02-05 10:43:00

Active SwarmBundleRef: git:abc123def456...

State Root: ~/.goondan/instances/a1b2c3d4e5f6/default-cli/
```

---

### 7.4 gdn instance delete

인스턴스 상태를 삭제한다.

**사용법:**
```bash
gdn instance delete <id> [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--force` | `-f` | 확인 없이 삭제 | `false` |

---

### 7.5 gdn instance resume

저장된 인스턴스를 재개한다.

**사용법:**
```bash
gdn instance resume <id> [options]
```

**옵션:**

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--input <text>` | | 재개 시 입력 메시지 | - |

---

## 8. gdn logs

인스턴스 로그를 조회한다.

### 8.1 사용법

```bash
gdn logs [instance-id] [options]
```

### 8.2 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--agent <name>` | `-a` | 특정 에이전트 로그만 | - |
| `--type <type>` | `-t` | 로그 유형 (`messages`, `events`, `all`) | `all` |
| `--follow` | `-f` | 실시간 로그 스트리밍 | `false` |
| `--tail <n>` | | 마지막 n줄 | - |
| `--since <time>` | | 특정 시간 이후 | - |
| `--until <time>` | | 특정 시간 이전 | - |
| `--turn <id>` | | 특정 Turn 로그만 | - |

### 8.3 예시

```bash
# 현재 인스턴스 로그
gdn logs

# 특정 인스턴스 로그
gdn logs default-cli

# 실시간 로그
gdn logs --follow

# 메시지 로그만
gdn logs --type messages

# 특정 에이전트 로그
gdn logs --agent planner

# 마지막 100줄
gdn logs --tail 100

# 특정 시간 이후
gdn logs --since "2026-02-05 10:00:00"
```

### 8.4 출력 형식

**기본 출력:**
```
[2026-02-05 10:30:00] [planner] turn.started turnId=turn-abc123
[2026-02-05 10:30:01] [planner] step.started stepId=step-xyz789
[2026-02-05 10:30:02] [planner] user: 파일 목록을 보여줘
[2026-02-05 10:30:03] [planner] assistant: [tool_call] file.list(path=".")
[2026-02-05 10:30:04] [planner] tool: ["README.md", "package.json"]
[2026-02-05 10:30:05] [planner] assistant: 현재 디렉터리에는...
```

**JSON 출력 (`--json`):**
```json
{"timestamp":"2026-02-05T10:30:00.000Z","agent":"planner","type":"event","kind":"turn.started","turnId":"turn-abc123"}
{"timestamp":"2026-02-05T10:30:02.000Z","agent":"planner","type":"message","role":"user","content":"파일 목록을 보여줘"}
```

---

## 9. gdn config

CLI 설정을 관리한다.

### 9.1 하위 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn config get <key>` | 설정 값 조회 |
| `gdn config set <key> <value>` | 설정 값 저장 |
| `gdn config list` | 모든 설정 출력 |
| `gdn config delete <key>` | 설정 삭제 |
| `gdn config path` | 설정 파일 경로 출력 |

### 9.2 설정 키

| 키 | 설명 | 기본값 |
|----|------|--------|
| `registry` | 기본 패키지 레지스트리 | `https://registry.goondan.io` |
| `stateRoot` | System State Root 경로 | `~/.goondan` |
| `logLevel` | 로그 레벨 | `info` |
| `color` | 색상 출력 | `true` |
| `editor` | 기본 에디터 | `$EDITOR` |

### 9.3 예시

```bash
# 설정 조회
gdn config get registry

# 설정 저장
gdn config set registry https://my-registry.example.com

# 모든 설정 출력
gdn config list

# 설정 파일 경로
gdn config path
# => ~/.goondanrc
```

---

## 10. gdn completion

쉘 자동완성 스크립트를 생성한다.

### 10.1 사용법

```bash
gdn completion <shell>
```

### 10.2 지원 쉘

- `bash`
- `zsh`
- `fish`
- `powershell`

### 10.3 설정 방법

**Bash:**
```bash
# ~/.bashrc에 추가
eval "$(gdn completion bash)"
```

**Zsh:**
```bash
# ~/.zshrc에 추가
eval "$(gdn completion zsh)"
```

**Fish:**
```bash
gdn completion fish > ~/.config/fish/completions/gdn.fish
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

### 12.1 ~/.goondanrc

전역 CLI 설정 파일:

```yaml
# 기본 레지스트리
registry: "https://registry.goondan.io"

# System State Root
stateRoot: "~/.goondan"

# 로그 레벨
logLevel: "info"

# 색상 출력
color: true

# 레지스트리 인증
registries:
  "https://registry.goondan.io":
    token: "xxx..."

# 스코프별 레지스트리
scopedRegistries:
  "@myorg": "https://my-org-registry.example.com"
```

### 12.2 환경 변수 우선순위

설정 우선순위 (높은 것이 우선):

1. CLI 옵션 (`--registry`, `--state-root` 등)
2. 환경 변수 (`GOONDAN_REGISTRY`, `GOONDAN_STATE_ROOT` 등)
3. 프로젝트 설정 (`.goondanrc` in project root)
4. 전역 설정 (`~/.goondanrc`)
5. 기본값

---

## 13. gdn doctor

환경을 진단하고 일반적인 문제를 확인한다.

### 13.1 사용법

```bash
gdn doctor [options]
```

### 13.2 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--fix` | | 자동 수정 시도 (placeholder) | `false` |

### 13.3 검사 항목

**System:**
| 항목 | 설명 | 수준 |
|------|------|------|
| Node.js | 버전 >=18 확인 | fail |
| npm | npm 설치 확인 | fail |
| pnpm | pnpm 설치 확인 | warn |
| TypeScript | tsc 설치 확인 | warn |

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
| Dependencies | node_modules 존재 여부 | warn |
| Bundle Validation | goondan.yaml 유효성 검증 | fail/warn |

### 13.4 출력 예시

```
Goondan Doctor
Checking your environment...

System
  ✓ Node.js: Node.js v20.11.0
  ✓ npm: npm 10.2.4
  ✓ pnpm: pnpm 9.1.0
  ✓ TypeScript: TypeScript 5.4.5

API Keys
  ✓ Anthropic API Key: ANTHROPIC_API_KEY is set (sk-a...****)
  ⚠ OpenAI API Key: OPENAI_API_KEY is not set
    Set if using OpenAI: export OPENAI_API_KEY=your-api-key

Goondan Packages
  ✓ @goondan/core: @goondan/core@0.0.1
  ✓ @goondan/cli: @goondan/cli@0.0.1
  ✓ @goondan/base: @goondan/base@0.0.1

Project
  ✓ Bundle Config: Found goondan.yaml
  ✓ Dependencies: node_modules found
  ✓ Bundle Validation: Valid (5 resources)

Summary
  9 passed, 1 warnings, 0 errors
```

### 13.5 예시

```bash
# 환경 진단
gdn doctor

# JSON 형식 출력
gdn doctor --json
```

---

## 14. 관련 문서

- `docs/specs/bundle.md`: Bundle YAML 스펙
- `docs/specs/bundle_package.md`: Bundle Package 스펙
- `docs/specs/workspace.md`: Workspace 모델 스펙
- `docs/specs/runtime.md`: Runtime 실행 모델 스펙
- `docs/specs/changeset.md`: Changeset 스펙

---

**문서 버전**: v0.10
**최종 수정**: 2026-02-06
